"""Login, registration, tokens, password reset, Google OAuth and multi-school owners."""
import secrets
import requests
from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.db.models import Sum, F, Count
from django.utils import timezone
from django.shortcuts import redirect
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound
from rest_framework.authtoken.models import Token
import logging
import traceback
from ..models import Tenant, User, TenantMembership, Teacher, Student, Payment, PasswordResetToken
from ..serializers import TenantSerializer, UserSerializer
from ..services import (
    GoogleOAuthService,
    LoginRateThrottle,
    PasswordResetRateThrottle,
    RegisterRateThrottle,
    log_activity,
)
from .common import (
    PLANS_CONFIG,
    filter_by_date_range,
    find_reset_token,
    issue_reset_token,
    logger,
    password_policy_error,
)


# Health View
@api_view(['GET'])
@permission_classes([AllowAny])
def health(request):
    return Response({
        'status': 'ok',
        'service': 'scolaris',
        'time': timezone.now().isoformat()
    })


# Public server config — lets the frontend hide features that aren't
# configured on this deployment (e.g. Google OAuth on a host that can't
# reach accounts.google.com).
@api_view(['GET'])
@permission_classes([AllowAny])
def server_config(request):
    return Response({
        'google_oauth_enabled': bool(getattr(settings, 'GOOGLE_CLIENT_ID', '')),
    })


# Auth Views
@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([RegisterRateThrottle])
def auth_register(request):
    # Validation
    required_fields = ['tenant_name', 'tenant_slug', 'name', 'email', 'password']
    for field in required_fields:
        if not request.data.get(field):
            return Response({'error': f'{field} is required'}, status=status.HTTP_400_BAD_REQUEST)
            
    password = request.data.get('password')
    password_error = password_policy_error(password, request.data.get('email'), request.data.get('name'))
    if password_error:
        return Response({'error': password_error}, status=status.HTTP_400_BAD_REQUEST)
            
    slug = request.data['tenant_slug'].strip().lower()
    import re
    if not re.match(r'^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$', slug):
        return Response({'error': 'Invalid slug (a-z, 0-9, hyphens, 3-32 chars)'}, status=status.HTTP_400_BAD_REQUEST)
        
    if Tenant.objects.filter(slug=slug).exists():
        return Response({'error': 'This workspace URL is already taken'}, status=status.HTTP_409_CONFLICT)
        
    email = request.data['email'].strip().lower()
    if User.objects.filter(email=email).exists():
        return Response({'error': 'Email already registered'}, status=status.HTTP_409_CONFLICT)
        
    basic_tier = PLANS_CONFIG['tiers']['basic']
    with transaction.atomic():
        tenant = Tenant.objects.create(
            name=request.data['tenant_name'].strip(),
            slug=slug,
            center_type=request.data.get('center_type', 'tutoring') or 'tutoring',
            status='pending_payment',
            max_students=basic_tier['max_students'],
            max_users=basic_tier['max_users'],
        )

        user = User.objects.create_user(
            email=email,
            password=request.data['password'],
            name=request.data['name'].strip(),
            tenant=tenant,
            role='owner',
            email_verified=True
        )
        TenantMembership.objects.create(user=user, tenant=tenant, role='owner')

    token, _ = Token.objects.get_or_create(user=user)
    return Response({
        'access_token': token.key,
        'refresh_token': token.key,
        'user': UserSerializer(user).data
    })


GOOGLE_STATE_COOKIE = 'scolaris_oauth_state'

@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([LoginRateThrottle])
def auth_login(request):
    email = request.data.get('email')
    password = request.data.get('password')
    tenant_slug = request.data.get('tenant_slug')
    
    if not email or not password:
        return Response({'error': 'Email and password are required'}, status=status.HTTP_400_BAD_REQUEST)
        
    query = User.objects.filter(email=email.strip().lower())
    switch_to_tenant = None

    if tenant_slug:
        tenant = Tenant.objects.filter(slug=tenant_slug.strip().lower()).first()
        if not tenant:
            return Response({'error': 'Workspace not found'}, status=status.HTTP_404_NOT_FOUND)
        # A user's `tenant` FK only ever points at whichever workspace is
        # currently their *active* one (see auth_switch_tenant) — an owner
        # logging directly into a second school they hold a
        # TenantMembership for, but that isn't their active one right now,
        # would otherwise get a misleading "Invalid credentials" here even
        # with the correct password. Fall back to membership, matching the
        # access boundary auth_switch_tenant already uses.
        scoped_query = query.filter(tenant=tenant)
        if scoped_query.exists():
            query = scoped_query
        else:
            member_query = query.filter(tenant_memberships__tenant=tenant)
            if member_query.exists():
                query = member_query
                switch_to_tenant = tenant
            else:
                query = scoped_query  # no match either way — fall through to the normal 401 below

    user = query.first()
    if not user or not user.check_password(password):
        # Logged against the tenant the address belongs to (when it resolves
        # to one) so an owner can actually see brute-force attempts on their
        # workspace — that's the whole point of a security log.
        if user is not None:
            log_activity(request, user.tenant_id, 'login_failed', category='security', user=user,
                         description=f'Failed login for {email}')
        return Response({'error': 'Invalid credentials'}, status=status.HTTP_401_UNAUTHORIZED)
        
    if not user.is_active:
        log_activity(request, user.tenant_id, 'login_blocked', category='security', user=user,
                     description='Login attempt on a disabled account')
        return Response({'error': 'Account disabled'}, status=status.HTTP_403_FORBIDDEN)

    if switch_to_tenant is not None:
        user.tenant = switch_to_tenant
        user.save(update_fields=['tenant_id'])

    token, _ = Token.objects.get_or_create(user=user)
    log_activity(request, user.tenant_id, 'login', category='auth', user=user,
                 description=f'{user.name or user.email} signed in')
    return Response({
        'access_token': token.key,
        'refresh_token': token.key,
        'user': UserSerializer(user).data
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def auth_logout(request):
    log_activity(request, request.user.tenant_id, 'logout', category='auth',
                 description=f'{request.user.name or request.user.email} signed out')
    request.auth.delete()
    return Response({'ok': True})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def auth_me(request):
    user = request.user
    tenant = user.tenant
    tenant_data = TenantSerializer(tenant).data if tenant else None
    return Response({
        'user': UserSerializer(user).data,
        'tenant': tenant_data
    })


def _require_owner(user):
    if not user.is_super_admin() and user.role not in ('owner', 'director'):
        raise PermissionDenied('Only a workspace owner or director can manage schools.')


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def owner_my_tenants(request):
    """Every school the caller holds a TenantMembership for — powers the
    workspace-switcher dropdown. A plain staff user (secretary/accountant/
    teacher/parent) never has a membership row, so this is naturally empty
    for them rather than needing a role check."""
    tenants = Tenant.objects.filter(memberships__user=request.user).order_by('name')
    return Response({'items': TenantSerializer(tenants, many=True).data})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def auth_switch_tenant(request):
    """Switches the caller's *active* workspace. This is deliberately just
    one UPDATE on User.tenant_id rather than a new per-session/per-request
    concept — every existing request.user.tenant_id-scoped check across the
    codebase keeps working completely unchanged. Trade-off: "active tenant"
    is account-wide, not per-browser-tab, so switching in one tab affects
    any other open tab/session for the same login on next request — an
    acceptable trade-off matching how most multi-org SaaS products behave
    (e.g. switching org context), and far simpler than session-scoped state."""
    user = request.user
    tenant_id = request.data.get('tenant_id')
    if not tenant_id:
        raise ValidationError('tenant_id is required')
    if not TenantMembership.objects.filter(user=user, tenant_id=tenant_id).exists():
        raise PermissionDenied('You do not have access to this workspace.')
    tenant = Tenant.objects.filter(id=tenant_id).first()
    if not tenant:
        raise NotFound('Workspace not found')
    user.tenant = tenant
    user.save(update_fields=['tenant_id'])
    log_activity(request, tenant.id, 'login', category='auth', user=user,
                 description=f'{user.name or user.email} switched to this workspace')
    return Response({'user': UserSerializer(user).data, 'tenant': TenantSerializer(tenant).data})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def owner_create_school(request):
    """Adds another school under the caller's existing login — same
    validation as auth_register's tenant creation, minus creating a new
    User row (the whole point: one login, many schools). Immediately
    switches the caller's active tenant to the new one so they land
    straight in the familiar billing gate to pay for it, reusing that flow
    unchanged."""
    user = request.user
    _require_owner(user)

    tenant_name = (request.data.get('tenant_name') or '').strip()
    tenant_slug = (request.data.get('tenant_slug') or '').strip().lower()
    if not tenant_name or not tenant_slug:
        return Response({'error': 'tenant_name and tenant_slug are required'}, status=status.HTTP_400_BAD_REQUEST)

    import re
    if not re.match(r'^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$', tenant_slug):
        return Response({'error': 'Invalid slug (a-z, 0-9, hyphens, 3-32 chars)'}, status=status.HTTP_400_BAD_REQUEST)
    if Tenant.objects.filter(slug=tenant_slug).exists():
        return Response({'error': 'This workspace URL is already taken'}, status=status.HTTP_409_CONFLICT)

    basic_tier = PLANS_CONFIG['tiers']['basic']
    with transaction.atomic():
        tenant = Tenant.objects.create(
            name=tenant_name,
            slug=tenant_slug,
            center_type=request.data.get('center_type', 'tutoring') or 'tutoring',
            status='pending_payment',
            max_students=basic_tier['max_students'],
            max_users=basic_tier['max_users'],
        )
        TenantMembership.objects.create(user=user, tenant=tenant, role='owner')
        # Backfill a membership for whatever tenant was active before this
        # call, if the caller doesn't already have one — a director added
        # through the normal staff-add flow never gets one (only
        # auth_register/this function/admin_set_tenant_ownership create
        # them), so without this, switching to the new school here would
        # leave them with zero membership in their original one: switching
        # back would 403, and even a fresh login scoped to that slug would
        # 401 "Invalid credentials" since the active tenant FK just moved.
        original_tenant_id = user.tenant_id
        if original_tenant_id and not TenantMembership.objects.filter(user=user, tenant_id=original_tenant_id).exists():
            TenantMembership.objects.create(user=user, tenant_id=original_tenant_id, role=user.role)
        user.tenant = tenant
        user.save(update_fields=['tenant_id'])

    return Response({'user': UserSerializer(user).data, 'tenant': TenantSerializer(tenant).data})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def owner_master_dashboard(request):
    """One-page rollup across every school the caller owns — same
    cross-tenant aggregation shape as admin_platform_summary, just scoped
    to the caller's TenantMembership set instead of the whole platform.
    Only meaningful (and only shown in the UI) once someone owns 2+
    schools, but works for exactly one too."""
    owned_ids = list(TenantMembership.objects.filter(user=request.user).values_list('tenant_id', flat=True))
    if not owned_ids:
        raise PermissionDenied('Forbidden')

    # ?tenant_id=<id> may repeat to narrow the rollup to a subset — anything
    # not in the caller's own membership set is silently dropped rather than
    # erroring, so a stale/tampered id can't be used to peek at another
    # owner's school.
    requested_ids = request.GET.getlist('tenant_id')
    selected_ids = [tid for tid in requested_ids if tid in owned_ids] if requested_ids else owned_ids

    tenants = Tenant.objects.filter(id__in=selected_ids).order_by('name')

    students_counts = dict(
        Student.objects.filter(tenant_id__in=selected_ids).values('tenant_id').annotate(c=Count('id')).values_list('tenant_id', 'c')
    )
    teachers_counts = dict(
        Teacher.objects.filter(tenant_id__in=selected_ids).values('tenant_id').annotate(c=Count('id')).values_list('tenant_id', 'c')
    )

    # 'partial' and 'pardoned' count as collected money too (see compute_student_balances).
    payments_qs = Payment.objects.filter(tenant_id__in=selected_ids, status__in=('paid', 'partial', 'pardoned'))
    payments_qs = filter_by_date_range(payments_qs, request, 'paid_at')
    # Sum(amount - discount), matching dashboard_summary/finance_report —
    # a plain Sum('amount') would overstate revenue on every discounted
    # invoice.
    revenue_by_tenant = dict(
        payments_qs.values('tenant_id').annotate(total=Sum(F('amount') - F('discount'))).values_list('tenant_id', 'total')
    )

    schools = []
    for t in tenants:
        t_data = TenantSerializer(t).data
        t_data['students_count'] = students_counts.get(t.id, 0)
        t_data['teachers_count'] = teachers_counts.get(t.id, 0)
        t_data['revenue'] = float(revenue_by_tenant.get(t.id) or 0)
        schools.append(t_data)

    return Response({
        'kpis': {
            'schools_total': len(selected_ids),
            'students_total': sum(students_counts.values()),
            'teachers_total': sum(teachers_counts.values()),
            'revenue_total': round(float(sum(revenue_by_tenant.values()) or 0), 2),
        },
        'schools': schools,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def auth_refresh(request):
    user = request.user
    # Regenerate token
    Token.objects.filter(user=user).delete()
    token = Token.objects.create(user=user)
    return Response({'access_token': token.key})


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([PasswordResetRateThrottle])
def auth_forgot_password(request):
    email = request.data.get('email')
    if not email:
        return Response({'error': 'Email is required'}, status=status.HTTP_400_BAD_REQUEST)
        
    user = User.objects.filter(email=email.strip().lower()).first()
    if user:
        token = issue_reset_token(user, timedelta(hours=1))
        
        dev_expose = getattr(settings, 'DEV_EXPOSE_RESET_TOKENS', False)
        if dev_expose:
            return Response({
                'ok': True,
                'dev_token': token,
                'message': 'Reset link generated (dev mode)'
            })
            
    return Response({'ok': True, 'message': 'If this email exists, a reset link has been sent'})


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([PasswordResetRateThrottle])
def auth_reset_password(request):
    token = request.data.get('token')
    new_password = request.data.get('new_password')
    if not token or not new_password:
        return Response({'error': 'Token and new_password are required'}, status=status.HTTP_400_BAD_REQUEST)
        
    row = find_reset_token(token)
    if not row or row.used:
        return Response({'error': 'Invalid or expired token'}, status=status.HTTP_400_BAD_REQUEST)
        
    if timezone.now() > row.expires_at:
        return Response({'error': 'Token expired'}, status=status.HTTP_400_BAD_REQUEST)
        
    password_error = password_policy_error(new_password, row.user.email, row.user.name)
    if password_error:
        return Response({'error': password_error}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        user = row.user
        user.set_password(new_password)
        user.save()
        
        row.used = True
        row.save()

        # Resetting the password is how someone recovers a compromised
        # account, so every session issued before this moment has to die with
        # it — otherwise the attacker's Bearer token keeps working.
        Token.objects.filter(user=user).delete()

    return Response({'ok': True})


# Google OAuth Views
@api_view(['GET'])
@permission_classes([AllowAny])
def google_start(request):
    intent = request.GET.get('intent', 'login')
    if intent not in ['login', 'register']:
        return Response({'error': 'Invalid intent'}, status=status.HTTP_400_BAD_REQUEST)
        
    state_data = {'intent': intent}
    
    if intent == 'register':
        tenant_name = request.GET.get('tenant_name')
        tenant_slug = request.GET.get('tenant_slug')
        if not tenant_name or not tenant_slug:
            return Response({'error': 'tenant_name and tenant_slug are required to sign up'}, status=status.HTTP_400_BAD_REQUEST)
            
        slug = tenant_slug.strip().lower()
        import re
        if not re.match(r'^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$', slug):
            return Response({'error': 'Invalid slug (a-z, 0-9, hyphens, 3-32 chars)'}, status=status.HTTP_400_BAD_REQUEST)
            
        state_data['tenant_name'] = tenant_name.strip()[:120]
        state_data['tenant_slug'] = slug
        state_data['center_type'] = request.GET.get('center_type', 'tutoring') or 'tutoring'
        
    nonce = secrets.token_urlsafe(16)
    signed_state = GoogleOAuthService.get_signed_state(
        nonce=nonce,
        intent=intent,
        tenant_name=state_data.get('tenant_name'),
        tenant_slug=state_data.get('tenant_slug'),
        center_type=state_data.get('center_type')
    )
    
    client_id = getattr(settings, 'GOOGLE_CLIENT_ID', '')
    redirect_uri = getattr(settings, 'GOOGLE_REDIRECT_URI', 'http://localhost:8002/api/v1/auth/google/callback')
    
    if not client_id:
        return Response({'error': 'Google sign-in is not configured on this server'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        
    params = {
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': 'openid email profile',
        'state': signed_state,
        'access_type': 'online',
        'prompt': 'select_account',
    }
    
    import urllib.parse
    url = 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode(params)
    response = redirect(url)
    response.set_cookie(GOOGLE_STATE_COOKIE, nonce, max_age=600, httponly=True,
                        secure=not settings.DEBUG, samesite='Lax', path='/api/v1/auth/google/')
    return response


@api_view(['GET'])
@permission_classes([AllowAny])
def google_callback(request):
    front = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000').rstrip('/')
    code = request.GET.get('code')
    state = request.GET.get('state')
    error = request.GET.get('error')
    
    if error or not code or not state:
        return redirect(f"{front}/oauth/callback?error=access_denied")
        
    state_payload = GoogleOAuthService.decode_state(state)
    cookie_nonce = request.COOKIES.get(GOOGLE_STATE_COOKIE)
    if (not state_payload or not cookie_nonce
            or not secrets.compare_digest(str(state_payload.get('nonce') or ''), cookie_nonce)):
        return redirect(f"{front}/oauth/callback?error=invalid_state")
        
    client_id = getattr(settings, 'GOOGLE_CLIENT_ID', '')
    client_secret = getattr(settings, 'GOOGLE_CLIENT_SECRET', '')
    redirect_uri = getattr(settings, 'GOOGLE_REDIRECT_URI', 'http://localhost:8002/api/v1/auth/google/callback')
    
    try:
        response = requests.post('https://oauth2.googleapis.com/token', data={
            'code': code,
            'client_id': client_id,
            'client_secret': client_secret,
            'redirect_uri': redirect_uri,
            'grant_type': 'authorization_code',
        }, timeout=15)
    except Exception as e:
        import traceback, logging
        logger = logging.getLogger(__name__)
        logger.error('google_callback token exchange exception: %s\n%s', e, traceback.format_exc())
        return redirect(f"{front}/oauth/callback?error=google_unreachable")
        
    if not response.ok:
        return redirect(f"{front}/oauth/callback?error=google_token_exchange_failed")
        
    id_token = response.json().get('id_token')
    if not id_token:
        return redirect(f"{front}/oauth/callback?error=no_id_token")
        
    profile = GoogleOAuthService.decode_google_id_token(id_token, client_id)
    if not profile:
        return redirect(f"{front}/oauth/callback?error=invalid_token")
        
    if not profile.get('email_verified'):
        return redirect(f"{front}/oauth/callback?error=email_not_verified")
        
    email = profile['email'].strip().lower()
    user = User.objects.filter(email=email).first()
    
    if user:
        if not user.is_active:
            return redirect(f"{front}/oauth/callback?error=account_disabled")
        if not user.google_sub:
            user.google_sub = profile['sub']
            user.auth_provider = 'google'
            user.save()
    else:
        if state_payload.get('intent') != 'register':
            import urllib.parse
            q = urllib.parse.urlencode({'error': 'no_account', 'email': email})
            return redirect(f"{front}/oauth/callback?{q}")
            
        slug = state_payload['tenant_slug']
        if Tenant.objects.filter(slug=slug).exists():
            return redirect(f"{front}/oauth/callback?error=slug_taken")
            
        basic_tier = PLANS_CONFIG['tiers']['basic']
        with transaction.atomic():
            tenant = Tenant.objects.create(
                name=state_payload['tenant_name'],
                slug=slug,
                center_type=state_payload.get('center_type') or 'tutoring',
                status='pending_payment',
                max_students=basic_tier['max_students'],
                max_users=basic_tier['max_users'],
            )

            user = User.objects.create_user(
                email=email,
                password=secrets.token_urlsafe(30),
                name=profile.get('name') or email.split('@')[0],
                tenant=tenant,
                role='owner',
                email_verified=True,
                google_sub=profile['sub'],
                auth_provider='google'
            )
            TenantMembership.objects.create(user=user, tenant=tenant, role='owner')
            
    token, _ = Token.objects.get_or_create(user=user)
    exchange_code = secrets.token_urlsafe(32)
    
    # Store token and user payload in cache (or simulate it using django cache)
    from django.core.cache import cache
    cache.set(f"oauth_exchange:{exchange_code}", {
        'access_token': token.key,
        'refresh_token': token.key,
        'user': UserSerializer(user).data
    }, timeout=120)
    
    response = redirect(f"{front}/oauth/callback?code={exchange_code}")
    response.delete_cookie(GOOGLE_STATE_COOKIE, path='/api/v1/auth/google/')
    return response


@api_view(['POST'])
@permission_classes([AllowAny])
def google_exchange(request):
    code = request.data.get('code')
    if not code:
        return Response({'error': 'code is required'}, status=status.HTTP_400_BAD_REQUEST)
        
    from django.core.cache import cache
    payload = cache.get(f"oauth_exchange:{code}")
    if not payload:
        return Response({'error': 'Invalid or expired code'}, status=status.HTTP_400_BAD_REQUEST)
        
    cache.delete(f"oauth_exchange:{code}")
    return Response(payload)
