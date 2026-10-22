"""Subscription plans and Chargily checkouts/webhooks."""
import json
from datetime import timedelta
from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound
import logging
from ..models import STAFF_ROLES, Tenant, ChargilyCheckout
from ..serializers import TenantSerializer, PaymentSerializer
from ..services import ChargilyClient
from .common import (
    PLANS_CONFIG,
    annual_discount_pct,
    apply_coupon_discount,
    logger,
    prorate_upgrade_amount,
    resolve_amount,
    validate_coupon,
)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_payment_checkout_status(request, checkout_id):
    """Lets a freshly-enrolled parent poll their own tuition checkout after
    returning from Chargily, mirroring billing_checkout_status but scoped to
    a Payment instead of the tenant's own subscription."""
    user = request.user
    checkout = ChargilyCheckout.objects.filter(id=checkout_id, type='student_payment').select_related(
        'payment', 'payment__student', 'payment__student__parent').first()
    if not checkout or checkout.tenant_id != user.tenant_id:
        raise NotFound('Checkout not found')
    # Only the paying family (or staff who handle payments) may see it.
    student = checkout.payment.student if checkout.payment else None
    is_family = bool(student and student.parent and student.parent.user_id == user.id)
    is_payments_staff = user.role in STAFF_ROLES and user.can_view('payments')
    if not (is_family or is_payments_staff or user.is_super_admin()):
        raise NotFound('Checkout not found')

    if checkout.status == 'pending' and checkout.chargily_checkout_id:
        client = ChargilyClient()
        try:
            remote = client.getCheckout(checkout.chargily_checkout_id)
            if remote:
                apply_remote_status(checkout, remote.get('status', 'pending'))
        except Exception:
            pass

    return Response({
        'status': checkout.status,
        'payment': PaymentSerializer(checkout.payment).data if checkout.payment else None,
    })


# Billing Views
@api_view(['GET'])
@permission_classes([AllowAny])
def billing_plans(request):
    currency = PLANS_CONFIG['currency']
    plans = []
    for key, tier in PLANS_CONFIG['tiers'].items():
        plans.append({
            'key': key,
            'name': tier['name'],
            'monthly': tier['monthly'],
            'annual': resolve_amount(key, 'annual'),
            'annual_discount_pct': annual_discount_pct(tier),
            'currency': currency,
            'custom_branding': tier['custom_branding'],
            'parent_portal': tier['parent_portal'],
            'calendar_planner': tier['calendar_planner'],
            'quiz_builder': tier['quiz_builder'],
            'website_builder': tier['website_builder'],
        })
    return Response({'plans': plans})


def get_billable_tenant(user):
    if user.role not in ['owner', 'director'] and not user.is_super_admin():
        raise PermissionDenied('Only the workspace owner or director can manage billing')
    if not user.tenant_id:
        raise ValidationError('This account has no workspace to bill.')
    tenant = Tenant.objects.filter(id=user.tenant_id).first()
    if not tenant:
        raise NotFound('Workspace not found')
    return tenant


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def billing_checkout(request):
    tenant = get_billable_tenant(request.user)
    if tenant.status not in ('pending_payment', 'expired'):
        return Response({'error': 'This workspace is already active. Use renew or upgrade instead.'}, status=status.HTTP_400_BAD_REQUEST)

    plan = request.data.get('plan')
    billing_cycle = request.data.get('billing_cycle')
    if plan not in ['basic', 'standard', 'premium'] or billing_cycle not in ['monthly', 'annual']:
        return Response({'error': 'Invalid plan or billing cycle'}, status=status.HTTP_400_BAD_REQUEST)

    amount = resolve_amount(plan, billing_cycle)
    plan_name = PLANS_CONFIG['tiers'][plan]['name']
    description = f"Scolaris {plan_name} plan ({billing_cycle}) — {tenant.name}"

    coupon = None
    discount_amount = 0
    coupon_code = request.data.get('coupon_code')
    if coupon_code:
        coupon = validate_coupon(coupon_code, plan)
        amount, discount_amount = apply_coupon_discount(amount, coupon)

    return start_chargily_checkout(tenant, plan, billing_cycle, amount, 'signup', description, coupon=coupon, discount_amount=discount_amount)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def billing_renew_quote(request):
    tenant = get_billable_tenant(request.user)
    cycle = request.GET.get('billing_cycle', tenant.billing_cycle or 'monthly')
    if cycle not in ['monthly', 'annual']:
        return Response({'error': 'Invalid billing cycle'}, status=status.HTTP_400_BAD_REQUEST)
    if tenant.status != 'active' or not tenant.plan:
        return Response({'error': 'Your subscription must be active to renew.'}, status=status.HTTP_400_BAD_REQUEST)
        
    amount = resolve_amount(tenant.plan, cycle)
    return Response({
        'plan': tenant.plan,
        'billing_cycle': cycle,
        'amount': amount,
        'currency': PLANS_CONFIG['currency']
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def billing_renew(request):
    tenant = get_billable_tenant(request.user)
    if tenant.status != 'active' or not tenant.plan:
        return Response({'error': 'Your subscription must be active to renew.'}, status=status.HTTP_400_BAD_REQUEST)
        
    cycle = request.data.get('billing_cycle', tenant.billing_cycle or 'monthly')
    if cycle not in ['monthly', 'annual']:
        return Response({'error': 'Invalid billing cycle'}, status=status.HTTP_400_BAD_REQUEST)
        
    amount = resolve_amount(tenant.plan, cycle)
    plan_name = PLANS_CONFIG['tiers'][tenant.plan]['name']
    description = f"Scolaris {plan_name} plan renewal ({cycle}) — {tenant.name}"
    
    return start_chargily_checkout(tenant, tenant.plan, cycle, amount, 'renew', description)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def billing_upgrade_quote(request):
    tenant = get_billable_tenant(request.user)
    new_plan = request.GET.get('plan')
    if new_plan not in ['basic', 'standard', 'premium']:
        return Response({'error': 'Invalid plan'}, status=status.HTTP_400_BAD_REQUEST)
        
    amount = prorate_upgrade_amount(tenant, new_plan)
    return Response({
        'plan': new_plan,
        'billing_cycle': tenant.billing_cycle,
        'amount': amount,
        'currency': PLANS_CONFIG['currency']
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def billing_upgrade(request):
    tenant = get_billable_tenant(request.user)
    new_plan = request.data.get('plan')
    if new_plan not in ['basic', 'standard', 'premium']:
        return Response({'error': 'Invalid plan'}, status=status.HTTP_400_BAD_REQUEST)
        
    amount = prorate_upgrade_amount(tenant, new_plan)
    cycle = tenant.billing_cycle or 'monthly'
    plan_name = PLANS_CONFIG['tiers'][new_plan]['name']
    
    if amount <= 0:
        tier = PLANS_CONFIG['tiers'][new_plan]
        tenant.plan = new_plan
        tenant.max_students = tier['max_students']
        tenant.max_users = tier['max_users']
        tenant.save()
        return Response({
            'checkout_url': None,
            'applied_immediately': True,
            'tenant': TenantSerializer(tenant).data
        })
        
    description = f"Scolaris upgrade to {plan_name} (prorated) — {tenant.name}"
    return start_chargily_checkout(tenant, new_plan, cycle, amount, 'upgrade', description)


def start_chargily_checkout(tenant, plan, billing_cycle, amount, checkout_type, description, coupon=None, discount_amount=0):
    checkout = ChargilyCheckout.objects.create(
        tenant=tenant,
        plan=plan,
        billing_cycle=billing_cycle,
        type=checkout_type,
        amount=amount,
        currency=PLANS_CONFIG['currency'],
        coupon=coupon,
        discount_amount=discount_amount,
        status='pending'
    )

    # A coupon can discount the price to zero — Chargily has no "free" checkout
    # (it rejects amount=0 with "Either items or amount must be provided"), so
    # apply the plan directly instead of ever calling out to them.
    if amount <= 0:
        apply_remote_status(checkout, 'paid')
        tenant.refresh_from_db()
        return Response({
            'checkout_url': None,
            'applied_immediately': True,
            'tenant': TenantSerializer(tenant).data,
        })

    frontend = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000').rstrip('/')
    app_url = getattr(settings, 'APP_URL', 'http://localhost:8002').rstrip('/')
    locale = tenant.language if tenant.language in ['ar', 'fr'] else 'en'
    
    client = ChargilyClient()
    try:
        response = client.createCheckout({
            'amount': amount,
            'currency': PLANS_CONFIG['currency'],
            'locale': locale,
            'description': description,
            'success_url': f"{frontend}/billing/success?checkout={checkout.id}",
            'failure_url': f"{frontend}/billing/failure?checkout={checkout.id}",
            'webhook_endpoint': f"{app_url}/api/v1/billing/webhook",
            'metadata': {'checkout_id': checkout.id, 'tenant_id': tenant.id},
        })
    except Exception as e:
        checkout.status = 'failed'
        checkout.save()
        # Log error in django
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f'Chargily checkout creation failed: {str(e)}')
        return Response({'error': 'Could not reach the payment provider. Please try again.'}, status=status.HTTP_502_BAD_GATEWAY)
        
    checkout.chargily_checkout_id = response.get('id')
    checkout.checkout_url = response.get('checkout_url')
    checkout.save()
    
    return Response({'checkout_url': checkout.checkout_url})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def billing_checkout_status(request, checkout_id):
    user = request.user
    checkout = ChargilyCheckout.objects.filter(id=checkout_id).first()
    if not checkout:
        raise NotFound('Checkout not found')
        
    if not user.is_super_admin() and checkout.tenant_id != user.tenant_id:
        raise PermissionDenied('Checkout not found')
        
    if checkout.status == 'pending' and checkout.chargily_checkout_id:
        client = ChargilyClient()
        try:
            remote = client.getCheckout(checkout.chargily_checkout_id)
            if remote:
                apply_remote_status(checkout, remote.get('status', 'pending'))
        except Exception:
            pass
            
    return Response({
        'status': checkout.status,
        'tenant': TenantSerializer(checkout.tenant).data
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def billing_webhook(request):
    raw_body = request.body
    signature = request.headers.get('Signature')
    
    client = ChargilyClient()
    if not client.verifyWebhookSignature(raw_body, signature):
        import logging
        logger = logging.getLogger(__name__)
        logger.warning('Chargily webhook: invalid signature')
        return Response({'error': 'Invalid signature'}, status=status.HTTP_400_BAD_REQUEST)
        
    try:
        event = json.loads(raw_body.decode('utf-8'))
    except Exception:
        return Response({'error': 'Invalid JSON'}, status=status.HTTP_400_BAD_REQUEST)
        
    event_type = event.get('type', '')
    event_data = event.get('data', {})
    
    if event_type.startswith('checkout.'):
        checkout_id = event_data.get('metadata', {}).get('checkout_id')
        checkout = ChargilyCheckout.objects.filter(id=checkout_id).first() if checkout_id else None
        
        if checkout:
            apply_remote_status(checkout, event_data.get('status', 'pending'))
        else:
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f'Chargily webhook: unknown checkout {checkout_id}')
            
    return Response({'ok': True})


def apply_remote_status(checkout, remote_status):
    if checkout.status == 'paid':
        return

    if checkout.type == 'student_payment':
        if remote_status == 'paid':
            payment = checkout.payment
            if payment and payment.status != 'paid':
                payment.status = 'paid'
                payment.paid_at = timezone.now()
                payment.save(update_fields=['status', 'paid_at', 'updated_at'])
            checkout.status = 'paid'
            checkout.save()
        elif remote_status in ['failed', 'canceled', 'expired']:
            checkout.status = 'failed' if remote_status == 'canceled' else remote_status
            checkout.save()
        return

    if remote_status == 'paid':
        tenant = checkout.tenant
        now = timezone.now()
        tier = PLANS_CONFIG['tiers'][checkout.plan]

        def get_period_expiration(from_dt):
            if checkout.billing_cycle == 'annual':
                # Add a year. To avoid calendar month edge cases, estimate or add exactly:
                try:
                    return from_dt.replace(year=from_dt.year + 1)
                except ValueError: # leap year
                    return from_dt + timedelta(days=365)
            else:
                # Add a month
                import calendar
                month = from_dt.month
                year = from_dt.year + month // 12
                month = month % 12 + 1
                day = min(from_dt.day, calendar.monthrange(year, month)[1])
                return from_dt.replace(year=year, month=month, day=day)

        if checkout.type == 'signup':
            tenant.status = 'active'
            tenant.plan = checkout.plan
            tenant.billing_cycle = checkout.billing_cycle
            tenant.plan_started_at = now
            tenant.plan_expires_at = get_period_expiration(now)
            tenant.max_students = tier['max_students']
            tenant.max_users = tier['max_users']
            tenant.save()
            
        elif checkout.type == 'renew':
            tenant.status = 'active'
            tenant.billing_cycle = checkout.billing_cycle
            base_dt = tenant.plan_expires_at if (tenant.plan_expires_at and tenant.plan_expires_at > now) else now
            tenant.plan_expires_at = get_period_expiration(base_dt)
            tenant.save()
            
        elif checkout.type == 'upgrade':
            tenant.plan = checkout.plan
            tenant.max_students = tier['max_students']
            tenant.max_users = tier['max_users']
            tenant.save()
            
        checkout.status = 'paid'
        checkout.save()
        
    elif remote_status in ['failed', 'canceled', 'expired']:
        checkout.status = 'failed' if remote_status == 'canceled' else remote_status
        checkout.save()
