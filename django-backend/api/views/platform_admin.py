"""Super-admin platform management."""
import os
from datetime import time, datetime, timedelta
from django.conf import settings
from django.db import transaction
from django.db.models import Sum, Count
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, NotFound
from ..models import (
    Tenant,
    User,
    TenantMembership,
    Guardian,
    Teacher,
    Student,
    Course,
    Group,
    ClassSession,
    Attendance,
    Payment,
    ChargilyCheckout,
    SchoolGalleryPhoto,
)
from ..serializers import TenantSerializer
from ..services import log_activity
from .common import (
    PLANS_CONFIG,
)


# Super Admin Platform Views
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_platform_summary(request):
    if not request.user.is_super_admin():
        raise PermissionDenied('Forbidden')
        
    revenue_data = ChargilyCheckout.objects.filter(status='paid').aggregate(total=Sum('amount'))
    revenue = float(revenue_data['total'] or 0)
    
    tenants = Tenant.objects.order_by('-created_at')[:200]
    tenant_ids = [t.id for t in tenants]
    users_counts = dict(User.objects.filter(tenant_id__in=tenant_ids).values('tenant_id').annotate(c=Count('id')).values_list('tenant_id', 'c'))
    students_counts = dict(Student.objects.filter(tenant_id__in=tenant_ids).values('tenant_id').annotate(c=Count('id')).values_list('tenant_id', 'c'))

    # Owner/linking info for the multi-school admin UI: which account owns
    # each tenant, whether it's that owner's principal school, and how many
    # schools that same owner has linked in total (so the panel can show a
    # "3 schools" badge without a query per row).
    memberships = list(
        TenantMembership.objects.filter(tenant_id__in=tenant_ids).select_related('user').order_by('created_at')
    )
    membership_by_tenant = {}
    schools_per_owner = {}
    for m in memberships:
        schools_per_owner[m.user_id] = schools_per_owner.get(m.user_id, 0) + 1
        current = membership_by_tenant.get(m.tenant_id)
        # Prefer whichever membership is flagged primary for this tenant;
        # otherwise prefer the most recently linked one (iterating
        # oldest→newest, so a later membership overwrites an earlier
        # non-primary one, but never overwrites an already-primary one).
        # Previously this always kept whichever was linked FIRST, so
        # re-linking a tenant to a different/primary owner via the
        # Ownership dialog never showed up here even though the write
        # itself succeeded.
        if current is None or m.is_primary or not current.is_primary:
            membership_by_tenant[m.tenant_id] = m

    tenants_list = []
    for t in tenants:
        t_data = TenantSerializer(t).data
        t_data['users_count'] = users_counts.get(t.id, 0)
        t_data['students_count'] = students_counts.get(t.id, 0)
        owner_membership = membership_by_tenant.get(t.id)
        t_data['owner_email'] = owner_membership.user.email if owner_membership else None
        t_data['is_primary_school'] = bool(owner_membership.is_primary) if owner_membership else False
        t_data['linked_schools_count'] = schools_per_owner.get(owner_membership.user_id, 0) if owner_membership else 0
        tenants_list.append(t_data)
        
    return Response({
        'kpis': {
            'tenants_total': Tenant.objects.count(),
            'tenants_active': Tenant.objects.filter(status='active').count(),
            'tenants_pending_payment': Tenant.objects.filter(status='pending_payment').count(),
            'tenants_suspended': Tenant.objects.filter(status='suspended').count(),
            'users_total': User.objects.count(),
            'students_total': Student.objects.count(),
            'payments_total': Payment.objects.count(),
            'platform_revenue': round(revenue, 2)
        },
        'tenants': tenants_list
    })


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def admin_set_tenant_status(request, tenant_id):
    if not request.user.is_super_admin():
        raise PermissionDenied('Forbidden')
        
    status_val = request.data.get('status')
    if status_val not in ['active', 'pending_payment', 'suspended']:
        return Response({'error': 'Invalid status'}, status=status.HTTP_400_BAD_REQUEST)
        
    tenant = Tenant.objects.filter(id=tenant_id).first()
    if not tenant:
        raise NotFound('Not found')
        
    tenant.status = status_val
    tenant.save()
    
    return Response(TenantSerializer(tenant).data)


MAX_EXTEND_DAYS = 3650  # 10 years — a sane ceiling, not a real business limit


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def admin_set_tenant_subscription(request, tenant_id):
    """Super-admin subscription control: change a tenant's plan and/or move
    its expiry date, without going through Chargily. Covers the cases the
    payment flow can't — comping a school, granting a trial, fixing a
    payment that arrived out-of-band (cash, bank transfer), or correcting a
    mistake.

    Extension is relative to whichever is later, now or the current expiry:
    extending a still-active subscription adds to the time remaining rather
    than truncating it, while extending an already-expired one starts the
    clock today instead of from a date in the past (which would otherwise
    leave it expired even after "extending" it).
    """
    if not request.user.is_super_admin():
        raise PermissionDenied('Forbidden')

    tenant = Tenant.objects.filter(id=tenant_id).first()
    if not tenant:
        raise NotFound('Not found')

    plan = request.data.get('plan')
    billing_cycle = request.data.get('billing_cycle')
    extend_days = request.data.get('extend_days')
    expires_at_raw = request.data.get('expires_at')

    if plan is not None and plan not in PLANS_CONFIG['tiers']:
        return Response({'error': 'Invalid plan'}, status=status.HTTP_400_BAD_REQUEST)
    if billing_cycle is not None and billing_cycle not in ['monthly', 'annual']:
        return Response({'error': 'Invalid billing cycle'}, status=status.HTTP_400_BAD_REQUEST)
    if extend_days is not None and expires_at_raw:
        return Response(
            {'error': 'Send either extend_days or expires_at, not both'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    now = timezone.now()
    before = {
        'plan': tenant.plan,
        'status': tenant.status,
        'expires_at': tenant.plan_expires_at.isoformat() if tenant.plan_expires_at else None,
    }

    new_expiry = None
    if extend_days is not None:
        try:
            days = int(extend_days)
        except (TypeError, ValueError):
            return Response({'error': 'extend_days must be an integer'}, status=status.HTTP_400_BAD_REQUEST)
        if days < 1 or days > MAX_EXTEND_DAYS:
            return Response(
                {'error': f'extend_days must be between 1 and {MAX_EXTEND_DAYS}'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        base = tenant.plan_expires_at if (tenant.plan_expires_at and tenant.plan_expires_at > now) else now
        new_expiry = base + timedelta(days=days)
    elif expires_at_raw:
        parsed = parse_datetime(expires_at_raw)
        if parsed is None:
            parsed_date = parse_date(expires_at_raw)
            if parsed_date is None:
                return Response({'error': 'expires_at must be an ISO date or datetime'}, status=status.HTTP_400_BAD_REQUEST)
            parsed = datetime.combine(parsed_date, time(23, 59, 59))
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed)
        if parsed > now + timedelta(days=MAX_EXTEND_DAYS):
            return Response(
                {'error': f'expires_at cannot be more than {MAX_EXTEND_DAYS} days out'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        new_expiry = parsed

    if plan is None and billing_cycle is None and new_expiry is None:
        return Response({'error': 'Nothing to update'}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        if plan is not None:
            tier = PLANS_CONFIG['tiers'][plan]
            tenant.plan = plan
            # Seat/student caps belong to the tier, so they move with it —
            # otherwise a downgrade would leave the old, larger allowance.
            tenant.max_students = tier['max_students']
            tenant.max_users = tier['max_users']
            if not tenant.plan_started_at:
                tenant.plan_started_at = now
        if billing_cycle is not None:
            tenant.billing_cycle = billing_cycle
        if new_expiry is not None:
            tenant.plan_expires_at = new_expiry
            if not tenant.plan_started_at:
                tenant.plan_started_at = now

        # Granting time to a locked-out workspace is the whole point of this
        # endpoint, so let it back in — but never override a deliberate
        # 'suspended', which is a moderation decision, not a billing one.
        if (
            tenant.status in ('pending_payment', 'expired')
            and tenant.plan
            and tenant.plan_expires_at
            and tenant.plan_expires_at > now
        ):
            tenant.status = 'active'

        tenant.save()

    log_activity(
        request, tenant.id, 'update', category='billing',
        entity_type='tenant', entity_id=tenant.id,
        description=(
            f"Super admin changed subscription: plan {before['plan']} -> {tenant.plan}, "
            f"status {before['status']} -> {tenant.status}, "
            f"expires {before['expires_at']} -> "
            f"{tenant.plan_expires_at.isoformat() if tenant.plan_expires_at else None}"
        ),
    )

    return Response(TenantSerializer(tenant).data)


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def admin_set_tenant_ownership(request, tenant_id):
    """Links a tenant to an existing owner/director account (creating a
    TenantMembership if one doesn't already exist) and/or marks it as that
    owner's principal school. This is the admin-side complement to
    TenantViewSet.create's link_to_owner_email — that only covers linking
    at creation time, this retroactively groups workspaces that were each
    created separately (e.g. three schools set up one at a time, each with
    its own owner account, that the admin now wants to consolidate under
    one login) or simply relabels which one is principal."""
    if not request.user.is_super_admin():
        raise PermissionDenied('Forbidden')

    tenant = Tenant.objects.filter(id=tenant_id).first()
    if not tenant:
        raise NotFound('Not found')

    owner_email = (request.data.get('owner_email') or '').strip().lower()
    if not owner_email:
        return Response({'error': 'owner_email is required'}, status=status.HTTP_400_BAD_REQUEST)

    owner = User.objects.filter(email=owner_email).first()
    if not owner:
        return Response({'error': 'No account with that email exists'}, status=status.HTTP_404_NOT_FOUND)
    if owner.role not in ('owner', 'director'):
        return Response({'error': 'That account is not an owner/director'}, status=status.HTTP_400_BAD_REQUEST)

    make_primary = bool(request.data.get('is_primary'))

    with transaction.atomic():
        membership, created = TenantMembership.objects.get_or_create(
            user=owner, tenant=tenant, defaults={'role': 'owner'},
        )
        # Explicit request, or this owner's very first membership ever —
        # either way they should never end up with zero principal schools.
        if make_primary or not TenantMembership.objects.filter(user=owner, is_primary=True).exists():
            TenantMembership.objects.filter(user=owner).exclude(id=membership.id).update(is_primary=False)
            membership.is_primary = True
            membership.save(update_fields=['is_primary'])

    log_activity(
        request, tenant.id, 'update', category='billing',
        entity_type='tenant', entity_id=tenant.id,
        description=(
            f"Super admin {'linked' if created else 're-linked'} this workspace to owner {owner.email}"
            + (" as their principal school" if membership.is_primary else "")
        ),
    )

    return Response(TenantSerializer(tenant).data)


def _delete_tenant_cascade(tenant):
    tenant_id = tenant.id
    logo_url = tenant.logo_url

    with transaction.atomic():
        User.objects.filter(tenant_id=tenant_id).delete()
        Student.objects.filter(tenant_id=tenant_id).delete()
        Guardian.objects.filter(tenant_id=tenant_id).delete()
        Teacher.objects.filter(tenant_id=tenant_id).delete()
        Course.objects.filter(tenant_id=tenant_id).delete()
        Group.objects.filter(tenant_id=tenant_id).delete()
        ClassSession.objects.filter(tenant_id=tenant_id).delete()
        Attendance.objects.filter(tenant_id=tenant_id).delete()
        Payment.objects.filter(tenant_id=tenant_id).delete()
        SchoolGalleryPhoto.objects.filter(tenant_id=tenant_id).delete()

        tenant.delete()

    # Remove logo file if exists
    if logo_url and logo_url.startswith('/uploads/logos/'):
        filename = logo_url.split('/')[-1]
        path = os.path.join(settings.MEDIA_ROOT, 'logos', filename)
        if os.path.isfile(path):
            try:
                os.remove(path)
            except Exception:
                pass


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def admin_destroy_tenant(request, tenant_id):
    if not request.user.is_super_admin():
        raise PermissionDenied('Forbidden')

    tenant = Tenant.objects.filter(id=tenant_id).first()
    if not tenant:
        return Response({'ok': True})

    _delete_tenant_cascade(tenant)
    return Response({'ok': True})
