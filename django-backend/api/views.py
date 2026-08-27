import csv
import io
import json
import os
import time
import secrets
import uuid
import base64
import mimetypes
import requests
import openpyxl
from PIL import Image, ImageOps
from datetime import datetime, time, timedelta
from django.conf import settings
from django.db import transaction
from django.db.models import Q, Sum, F, Count
from django.http import FileResponse, Http404, HttpResponse
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.shortcuts import redirect
from weasyprint import HTML
from rest_framework import viewsets, status, serializers
from rest_framework.decorators import api_view, permission_classes, throttle_classes, action
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound, APIException, NotAuthenticated
from rest_framework.authtoken.models import Token

from .models import Tenant, User, TenantMembership, Guardian, Teacher, Student, Course, Group, ClassSession, Room, Attendance, Payment, Trip, Book, BookCopy, Grade, ChargilyCheckout, PasswordResetToken, Conversation, Message, Coupon, Quiz, QuizAttempt, QuizSubmissionFile, SchoolGalleryPhoto, Expense, ExpenseCategory, TeacherPayout, ActivityLog, TimetableEntry, DEFAULT_EXPENSE_CATEGORIES, PERMISSION_MODULES, PERMISSION_FLAGS, STAFF_ROLES
from .serializers import TenantSerializer, UserSerializer, GuardianSerializer, TeacherSerializer, StudentSerializer, CourseSerializer, GroupSerializer, ClassSessionSerializer, RoomSerializer, AttendanceSerializer, PaymentSerializer, TripSerializer, BookSerializer, BookCopySerializer, GradeSerializer, ChargilyCheckoutSerializer, ConversationSerializer, MessageSerializer, CouponSerializer, QuizSerializer, QuizAttemptSerializer, SchoolGalleryPhotoSerializer, ExpenseSerializer, ExpenseCategorySerializer, TeacherPayoutSerializer, ActivityLogSerializer, TimetableEntrySerializer
from .services import GoogleOAuthService, ChargilyClient, LoginRateThrottle, PasswordResetRateThrottle, EnrollmentRateThrottle, StudentLookupRateThrottle, log_activity

# Single source of truth for pricing:
PLANS_CONFIG = {
    'currency': 'dzd',
    'tiers': {
        'basic': {
            'name': 'Basic',
            'monthly': 2500,
            'annual': 25000,
            'max_students': 200,
            'max_users': 3,
            'custom_branding': False,
            'parent_portal': False,
            'calendar_planner': False,
            'quiz_builder': False,
            'website_builder': False,
        },
        'standard': {
            'name': 'Standard',
            'monthly': 6000,
            'annual': 60000,
            'max_students': 500,
            'max_users': 20,
            'custom_branding': True,
            'parent_portal': True,
            'calendar_planner': False,
            'quiz_builder': False,
            'website_builder': False,
        },
        'premium': {
            'name': 'Premium',
            'monthly': 9000,
            'annual': 75000,
            'max_students': None,
            'max_users': None,
            'custom_branding': True,
            'parent_portal': True,
            'calendar_planner': True,
            'quiz_builder': True,
            'website_builder': True,
        },
    }
}

def resolve_amount(plan_key, billing_cycle):
    tier = PLANS_CONFIG['tiers'].get(plan_key)
    if not tier:
        raise ValidationError('Invalid plan')
    if billing_cycle == 'annual':
        return tier['annual']
    return tier['monthly']

def annual_discount_pct(tier):
    return round((1 - tier['annual'] / (tier['monthly'] * 12)) * 100)

def prorate_upgrade_amount(tenant, new_plan):
    PLAN_RANK = {'basic': 1, 'standard': 2, 'premium': 3}
    if tenant.status != 'active' or not tenant.plan or not tenant.plan_expires_at:
        raise ValidationError('Your subscription must be active to upgrade.')
    if new_plan not in PLAN_RANK or PLAN_RANK[new_plan] <= PLAN_RANK.get(tenant.plan, 0):
        raise ValidationError('Choose a higher plan to upgrade to.')
    
    now = timezone.now()
    if tenant.plan_expires_at <= now:
        raise ValidationError('Your subscription has expired — renew before upgrading.')
        
    cycle = tenant.billing_cycle or 'monthly'
    cycle_days = 365 if cycle == 'annual' else 30
    
    # Calculate days remaining as a float for precision
    seconds_remaining = (tenant.plan_expires_at - now).total_seconds()
    days_remaining = max(0.0, seconds_remaining / (24 * 3600))
    
    current_price = resolve_amount(tenant.plan, cycle)
    new_price = resolve_amount(new_plan, cycle)
    
    unused_credit = (current_price / cycle_days) * days_remaining
    new_remaining_cost = (new_price / cycle_days) * days_remaining

    return max(0, int(round(new_remaining_cost - unused_credit)))


def require_staff_tenant(user):
    """Guard for the staff-only function-based views, returning the caller's
    tenant id.

    TenantScopedViewSet.get_queryset() already refuses role='parent' outright,
    which is why every CRUD route is safe. The function-based views don't
    inherit that, and relying on can_view()/can_add() etc. instead is not
    equivalent: those helpers fall through to DEFAULT_MODULE_PERMISSIONS,
    which describes *staff* defaults, so a parent silently inherited view
    access on any module whose default isn't hidden — enough to read the
    school's P&L, its global search index and every student's balance. Roles
    outside the staff set have no business on these endpoints at all, so gate
    on the role itself rather than on a per-module default.
    """
    tenant_id = getattr(user, 'tenant_id', None)
    if not tenant_id:
        raise PermissionDenied('User has no tenant')
    if not user.is_super_admin() and user.role not in STAFF_ROLES:
        raise PermissionDenied('Forbidden')
    return tenant_id


def course_per_session_price(price, pricing_type, sessions_count):
    """A course's price means different things depending on pricing_type:
    already-per-session, a recurring monthly rate split across the sessions
    that happen in a month, or a total split across the course's whole
    session count. Both of the latter two divide by sessions_count — it's
    just 'sessions per month' vs 'total sessions' depending on which type.
    Used for both teacher-earnings and student-balance calculations, so a
    course's per-session value means the same thing everywhere."""
    price = float(price or 0)
    if pricing_type == 'per_session':
        return price
    if sessions_count and sessions_count > 0:
        return price / sessions_count
    return price


def name_search_q(q, *field_groups):
    """Builds a Q for searching a first/last-name-split model by a free-typed
    query. Matching a single field against the whole query (e.g.
    first_name__icontains="John Smith") never matches once the query spans
    both names, so instead each whitespace-separated word must independently
    match at least one of the given fields."""
    query = Q()
    for word in q.split():
        word_q = Q()
        for field in field_groups:
            word_q |= Q(**{f'{field}__icontains': word})
        query &= word_q
    return query


def validate_coupon(code, plan):
    """Raises ValidationError with a specific reason, or returns the Coupon.
    Redemption count is computed live from paid checkouts (Coupon.checkouts),
    not a stored counter — see the Coupon model docstring."""
    coupon = Coupon.objects.filter(code__iexact=(code or '').strip(), active=True).first()
    if not coupon:
        raise ValidationError('Invalid coupon code')
    now = timezone.now()
    if coupon.starts_at and now < coupon.starts_at:
        raise ValidationError('This coupon is not active yet')
    if coupon.expires_at and now > coupon.expires_at:
        raise ValidationError('This coupon has expired')
    if coupon.applicable_plans and plan not in coupon.applicable_plans:
        raise ValidationError('This coupon is not valid for the selected plan')
    if coupon.max_redemptions is not None:
        used = ChargilyCheckout.objects.filter(coupon_id=coupon.id, status='paid').count()
        if used >= coupon.max_redemptions:
            raise ValidationError('This coupon has reached its usage limit')
    return coupon


def apply_coupon_discount(amount, coupon):
    if not coupon:
        return amount, 0
    if coupon.discount_type == 'percent':
        discount = int(round(amount * float(coupon.discount_value) / 100))
    else:
        discount = int(coupon.discount_value)
    discount = min(discount, amount)
    return max(0, amount - discount), discount


def export_rows(headers, rows, filename, fmt):
    """Builds a downloadable CSV or XLSX response from a header row + data rows."""
    fmt = (fmt or 'csv').lower()
    if fmt not in ('csv', 'xlsx'):
        raise ValidationError('format must be csv or xlsx')

    if fmt == 'csv':
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(headers)
        writer.writerows(rows)
        response = HttpResponse(buffer.getvalue(), content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="{filename}.csv"'
        return response

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    response = HttpResponse(
        buffer.getvalue(),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = f'attachment; filename="{filename}.xlsx"'
    return response


INVOICE_STATUS_AR = {
    'paid': 'مدفوع',
    'pending': 'قيد الانتظار',
    'overdue': 'متأخر',
    'partial': 'مدفوع جزئيًا',
    'refunded': 'مسترد',
    'cancelled': 'ملغى',
    'due_on': 'يُستحق في',
}

# Payment.kind/method choices store identical value/label pairs (e.g.
# ('cash', 'cash')), so get_FOO_display() just returns the raw English key —
# these translate what the invoice actually prints, matching the same
# Arabic wording already used for kind.*/method.* in the frontend (i18n.jsx)
# so a school sees the same word on-screen and on the printed invoice.
INVOICE_KIND_AR = {
    'registration': 'تسجيل',
    'monthly': 'شهري',
    'course': 'دورة',
    'per_session': 'بالحصة',
    'trip': 'رحلة مدرسية',
    'book': 'كتاب',
    'other': 'آخر',
}
INVOICE_METHOD_AR = {
    'cash': 'نقدًا',
    'card': 'بطاقة',
    'bank_transfer': 'تحويل بنكي',
    'cheque': 'شيك',
    'other': 'آخر',
}
INVOICE_CURRENCY_AR = {
    'DZD': 'دج',
}

# Anything under a public subdir is deliberately readable by anyone with the
# link — it's the branding and course imagery rendered on a school's public
# enrollment page, plus the quiz exercise sheet that the no-login take-link
# has to show. Everything else is personal data (a teacher's CV and diploma, a
# child's medical excuse note, a student's answer sheet) and is served only to
# a signed-in member of the tenant that owns it — see serve_upload.
PUBLIC_UPLOAD_SUBDIRS = {'logos', 'hero', 'teachers', 'courses', 'gallery', 'quizzes'}
PRIVATE_UPLOAD_SUBDIRS = {'submissions', 'documents', 'excuses'}
UPLOAD_SUBDIRS = PUBLIC_UPLOAD_SUBDIRS | PRIVATE_UPLOAD_SUBDIRS
IMAGE_UPLOAD_EXTS = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'}


# Longest-edge cap per upload purpose. Anything bigger is downscaled before
# it ever touches disk — a modern phone photo is ~4000px/5MB, which is pure
# waste for a 96px avatar and adds up fast across every tenant.
UPLOAD_MAX_EDGE = {
    'logos': 512, 'teachers': 600, 'courses': 1280, 'gallery': 1600, 'hero': 2000,
    # Exercise sheets and handwritten answers have to stay readable when
    # zoomed, so they keep more detail than a decorative photo.
    'quizzes': 2200, 'submissions': 2200,
}
UPLOAD_JPEG_QUALITY = 82
GALLERY_MAX_PHOTOS = 40
PUBLIC_LOW_SEATS_THRESHOLD = 5
QUIZ_MAX_SUBMISSION_FILES = 10

# A ~1MB PNG can decompress to a multi-GB bitmap and OOM the worker
# ("decompression bomb"). Pillow warns above ~89M pixels by default; make it
# a hard error well below that since no legitimate upload here is that big.
Image.MAX_IMAGE_PIXELS = 50_000_000


def save_uploaded_image(file, subdir, id_prefix):
    """Validates that the upload is a *real* image (not just a spoofed
    Content-Type header), strips metadata, downscales it to the purpose's max
    edge and recompresses it, then writes it to MEDIA_ROOT/<subdir>/.
    Returns the relative /uploads/<subdir>/<file> path stored on the model.

    Re-encoding through Pillow is what makes this safe: whatever bytes came
    in, what lands on disk is a freshly-encoded image and nothing else — so a
    payload disguised with an image Content-Type can't survive the round trip.
    It also drops EXIF, which matters because phone photos of students and
    staff routinely carry GPS coordinates."""
    assert subdir in UPLOAD_SUBDIRS
    if file.content_type not in IMAGE_UPLOAD_EXTS:
        raise ValidationError('Only PNG, JPEG, WEBP or GIF images are allowed')
    if file.size > 8 * 1024 * 1024:
        # Generous inbound cap — what actually gets stored is far smaller
        # after downscaling, so users aren't punished for straight-from-phone
        # photos the way a hard 3MB limit did.
        raise ValidationError('Image must be under 8MB')

    try:
        file.seek(0)
        img = Image.open(file)
        img.load()  # forces real decode — a spoofed/corrupt file fails here
    except ValidationError:
        raise
    except Exception:
        raise ValidationError('That file is not a valid image')

    # Honour EXIF rotation before we discard EXIF, else portrait phone photos
    # come out sideways.
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass

    has_alpha = img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info)
    if has_alpha:
        img = img.convert('RGBA')
        ext, fmt, save_kwargs = 'png', 'PNG', {'optimize': True}
    else:
        img = img.convert('RGB')
        ext, fmt, save_kwargs = 'jpg', 'JPEG', {'quality': UPLOAD_JPEG_QUALITY, 'optimize': True, 'progressive': True}

    max_edge = UPLOAD_MAX_EDGE.get(subdir, 1280)
    if max(img.size) > max_edge:
        img.thumbnail((max_edge, max_edge), Image.LANCZOS)

    filename = f"{id_prefix}-{secrets.token_urlsafe(12)}.{ext}"
    upload_dir = os.path.join(settings.MEDIA_ROOT, subdir)
    os.makedirs(upload_dir, exist_ok=True)
    # Saving from the decoded image (never the raw upload stream) is what
    # guarantees only re-encoded pixel data is written.
    img.save(os.path.join(upload_dir, filename), fmt, **save_kwargs)
    return f"/uploads/{subdir}/{filename}"


PDF_MAX_BYTES = 15 * 1024 * 1024


def save_uploaded_document(file, subdir, id_prefix):
    """Like save_uploaded_image but also accepts PDFs — what quizzes need,
    since a teacher may photograph an exercise or scan it to PDF, and a
    student may answer with either.

    Images still go through the full re-encode pipeline. PDFs can't be
    re-encoded that way, so they're accepted only after the magic header
    confirms they really are PDFs and are stored under a generated name with
    a forced .pdf extension — the original filename never reaches the
    filesystem, so it can't be used to smuggle a different extension."""
    assert subdir in UPLOAD_SUBDIRS
    if file.content_type in IMAGE_UPLOAD_EXTS:
        return save_uploaded_image(file, subdir, id_prefix)

    if file.content_type != 'application/pdf':
        raise ValidationError('Only images (PNG, JPEG, WEBP, GIF) or PDF files are allowed')
    if file.size > PDF_MAX_BYTES:
        raise ValidationError('PDF must be under 15MB')

    file.seek(0)
    header = file.read(5)
    if header != b'%PDF-':
        raise ValidationError('That file is not a valid PDF')

    filename = f"{id_prefix}-{secrets.token_urlsafe(12)}.pdf"
    upload_dir = os.path.join(settings.MEDIA_ROOT, subdir)
    os.makedirs(upload_dir, exist_ok=True)
    file.seek(0)
    with open(os.path.join(upload_dir, filename), 'wb') as out:
        for chunk in file.chunks():
            out.write(chunk)
    return f"/uploads/{subdir}/{filename}"


def delete_uploaded_image(url, subdir):
    if url and url.startswith(f'/uploads/{subdir}/'):
        path = os.path.join(settings.MEDIA_ROOT, subdir, url.split('/')[-1])
        if os.path.isfile(path):
            try:
                os.remove(path)
            except Exception:
                pass


def check_website_builder(user, tenant):
    website_builder = bool(tenant.plan) and PLANS_CONFIG['tiers'][tenant.plan].get('website_builder', False)
    if not user.is_super_admin() and not website_builder:
        raise PermissionDenied('The website builder is available on the Premium plan. Upgrade your plan to use it.')


# Base Tenant-Scoped ViewSet
class TenantScopedViewSet(viewsets.ModelViewSet):
    # Subclasses for a permission-gated module (students, payments, etc. —
    # see PERMISSION_MODULES) set this so secretary/accountant/teacher users
    # are restricted per User.permissions. Owner/director/super_admin always
    # get full access regardless (see User.get_permission). Leave None for
    # resources that aren't part of the per-tab permission system.
    module_key = None
    # Actions that must stay reachable regardless of the module_key tab
    # permission — e.g. StudentViewSet.verify is the QR-scanner lookup the
    # teacher mobile app depends on, unrelated to the desktop Students tab.
    module_view_exempt_actions = []

    def check_module_view(self):
        """Raise if the current user can't even see this module's tab."""
        user = self.request.user
        if getattr(self, 'action', None) in self.module_view_exempt_actions:
            return
        if self.module_key and not user.is_super_admin() and not user.can_view(self.module_key):
            raise PermissionDenied('Forbidden')

    def check_module_add(self):
        """Raise unless the current user can create new records in this module."""
        user = self.request.user
        if self.module_key and not user.is_super_admin() and not user.can_add(self.module_key):
            raise PermissionDenied('You do not have permission to add records here.')

    def check_module_modify(self):
        """Raise unless the current user can modify existing records in this module."""
        user = self.request.user
        if self.module_key and not user.is_super_admin() and not user.can_modify(self.module_key):
            raise PermissionDenied('You do not have permission to modify this.')

    def check_module_delete(self):
        """Raise unless the current user can delete records in this module."""
        user = self.request.user
        if self.module_key and not user.is_super_admin() and not user.can_delete(self.module_key):
            raise PermissionDenied('You do not have permission to delete this.')

    def get_queryset(self):
        user = self.request.user
        queryset = super().get_queryset()

        # Parents only ever get read access to their own linked children via
        # the dedicated /portal/* endpoints (see _portal_guardian/_portal_child
        # below) — the general CRUD list/retrieve routes here have no
        # per-row filtering beyond tenant_id, so without this a parent login
        # could list every student/payment/guardian in the whole tenant.
        if user.role == 'parent':
            raise PermissionDenied('Forbidden')

        self.check_module_view()

        if user.is_super_admin():
            if user.tenant_id:
                return queryset.filter(tenant_id=user.tenant_id)
            return queryset

        if not user.tenant_id:
            raise PermissionDenied('User has no tenant')

        if user.tenant.status != 'active':
            raise PermissionDenied('This workspace is not active yet — complete billing to continue.')

        return queryset.filter(tenant_id=user.tenant_id)

    def _entity_label(self, instance):
        """Best-effort human-readable name for the activity log line — most
        models here have one of these fields."""
        for field in ('title', 'name'):
            if hasattr(instance, field) and getattr(instance, field):
                return getattr(instance, field)
        if hasattr(instance, 'first_name'):
            return f"{instance.first_name} {getattr(instance, 'last_name', '')}".strip()
        return str(getattr(instance, 'pk', instance))

    def _log_model_action(self, action, instance):
        """Fires on every create/update/delete across every TenantScopedViewSet
        subclass — this one hook is what backs the Logs page (item 9) without
        needing a log_activity() call sprinkled through every viewset."""
        module = self.module_key or instance.__class__.__name__.lower()
        tenant_id = getattr(instance, 'tenant_id', None) or getattr(self.request.user, 'tenant_id', None)
        verb = {'create': 'Added', 'update': 'Updated', 'delete': 'Deleted'}[action]
        log_activity(
            self.request, tenant_id, action, entity_type=module, entity_id=getattr(instance, 'pk', None),
            description=f'{verb} {module}: {self._entity_label(instance)}',
        )

    def perform_create(self, serializer):
        user = self.request.user
        if user.tenant_id:
            if not user.is_super_admin() and user.tenant.status != 'active':
                raise PermissionDenied('This workspace is not active yet — complete billing to continue.')
            instance = serializer.save(tenant_id=user.tenant_id)
        else:
            instance = serializer.save()
        self._log_model_action('create', instance)

    def perform_update(self, serializer):
        # Pin the tenant explicitly rather than trusting the payload. The
        # serializers keep tenant_id read-only, so this is belt-and-braces —
        # but tenant isolation is the one control where a single regression
        # (someone making the field writable again for convenience) silently
        # turns an update into a cross-tenant record move, so it's re-asserted
        # at the point of save instead of only being enforced one layer up.
        original_tenant_id = getattr(serializer.instance, 'tenant_id', None)
        if original_tenant_id is not None:
            instance = serializer.save(tenant_id=original_tenant_id)
        else:
            instance = serializer.save()
        self._log_model_action('update', instance)

    def perform_destroy(self, instance):
        self._log_model_action('delete', instance)
        instance.delete()

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        self.check_module_modify()
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self.check_module_modify()
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self.check_module_delete()
        instance = self.get_object()
        self.perform_destroy(instance)
        return Response({'message': 'Deleted successfully'}, status=status.HTTP_200_OK)

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        # Order by created_at desc if field exists
        if hasattr(self.get_queryset().model, 'created_at'):
            queryset = queryset.order_by('-created_at')
            
        # Limit to 500 items to match Laravel limit(500)
        queryset = queryset[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})


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
def auth_register(request):
    # Validation
    required_fields = ['tenant_name', 'tenant_slug', 'name', 'email', 'password']
    for field in required_fields:
        if not request.data.get(field):
            return Response({'error': f'{field} is required'}, status=status.HTTP_400_BAD_REQUEST)
            
    password = request.data.get('password')
    if len(password) < 8 or len(password) > 128:
        return Response({'error': 'Password must be between 8 and 128 characters'}, status=status.HTTP_400_BAD_REQUEST)
            
    slug = request.data['tenant_slug'].strip().lower()
    import re
    if not re.match(r'^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$', slug):
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
    
    if tenant_slug:
        tenant = Tenant.objects.filter(slug=tenant_slug.strip().lower()).first()
        if not tenant:
            return Response({'error': 'Workspace not found'}, status=status.HTTP_404_NOT_FOUND)
        query = query.filter(tenant=tenant)
        
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

    token, _ = Token.objects.get_or_create(user=user)
    log_activity(request, user.tenant_id, 'login', category='auth', user=user,
                 description=f'{user.name or user.email} signed in')
    return Response({
        'access_token': token.key,
        'refresh_token': token.key,
        'user': UserSerializer(user).data
    })


@api_view(['GET'])
@permission_classes([AllowAny])
@throttle_classes([StudentLookupRateThrottle])
def public_student_lookup(request):
    """No-login lookup for the student mobile app: a student punches in their
    workspace slug + student code and gets back just enough to render their
    own QR badge. No password — this is a digital ID card, not an account."""
    tenant_slug = (request.GET.get('tenant_slug') or '').strip().lower()
    student_code = (request.GET.get('student_code') or '').strip()

    if not tenant_slug or not student_code:
        return Response({'error': 'tenant_slug and student_code are required'}, status=status.HTTP_400_BAD_REQUEST)

    tenant = Tenant.objects.filter(slug=tenant_slug).first()
    if not tenant:
        return Response({'error': 'Workspace not found'}, status=status.HTTP_404_NOT_FOUND)

    student = Student.objects.filter(tenant=tenant, student_code__iexact=student_code).first()
    if not student:
        return Response({'error': 'Student not found'}, status=status.HTTP_404_NOT_FOUND)

    return Response({
        'id': student.id,
        'first_name': student.first_name,
        'last_name': student.last_name,
        'student_code': student.student_code,
        'photo_url': student.photo_url,
        'tenant_name': tenant.name,
    })


@api_view(['GET'])
@permission_classes([AllowAny])
def public_quiz_attempt(request, token):
    """No-login quiz-taking link — ONE shared link per quiz for the whole
    class (posted to a group chat, etc.), not one per student. There's no
    pre-assigned identity behind the token; whoever opens it types their
    own name right before answering (see public_quiz_attempt_submit)."""
    quiz = Quiz.objects.filter(public_token=token, status='published').first()
    if not quiz:
        return Response({'error': 'Invalid or expired link'}, status=status.HTTP_404_NOT_FOUND)

    return Response({
        'quiz_title': quiz.title,
        'description': quiz.description,
        'time_limit_minutes': quiz.time_limit_minutes,
        'exercise_file_url': quiz.exercise_file_url,
        'exercise_file_name': quiz.exercise_file_name,
        'max_score': quiz.max_score,
    })


def _match_student_by_name(group, typed_name):
    """Best-effort, case/whitespace-insensitive full-name match against a
    group's roster — the shared-link flow has no other way to know which
    enrolled student is answering."""
    if not group:
        return None
    normalized = ' '.join(typed_name.lower().split())
    for s in group.students.all():
        if ' '.join(f"{s.first_name} {s.last_name}".lower().split()) == normalized:
            return s
    return None


@api_view(['POST'])
@permission_classes([AllowAny])
def public_quiz_attempt_submit(request, token):
    quiz = Quiz.objects.filter(public_token=token, status='published').select_related('group').first()
    if not quiz:
        return Response({'error': 'Invalid or expired link'}, status=status.HTTP_404_NOT_FOUND)

    solver_name = (request.data.get('solver_name') or '').strip()
    if not solver_name:
        return Response({'error': 'Please enter your full name before submitting'}, status=status.HTTP_400_BAD_REQUEST)

    files = request.FILES.getlist('files')
    if not files:
        return Response({'error': 'Attach at least one photo or PDF of your answers'}, status=status.HTTP_400_BAD_REQUEST)
    if len(files) > QUIZ_MAX_SUBMISSION_FILES:
        return Response(
            {'error': f'You can attach at most {QUIZ_MAX_SUBMISSION_FILES} files'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    matched_student = _match_student_by_name(quiz.group, solver_name)

    # Validate/convert every upload before writing any DB row, so a bad file
    # halfway through doesn't leave a half-submitted attempt behind.
    saved = []
    for f in files:
        saved.append((save_uploaded_document(f, 'submissions', quiz.id), f.name))

    with transaction.atomic():
        attempt = QuizAttempt.objects.create(
            tenant_id=quiz.tenant_id, quiz=quiz, student=matched_student,
            solver_name=solver_name, max_score=quiz.max_score,
        )
        for url, name in saved:
            QuizSubmissionFile.objects.create(
                tenant_id=quiz.tenant_id, attempt=attempt, file_url=url, file_name=name[:255],
            )

    # No auto-grading in the file flow — the teacher reads the pages and sets
    # the score later (see QuizViewSet.grade), which is what also creates the
    # Grade row.
    return Response({'files': len(saved), 'matched': matched_student is not None})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def auth_logout(request):
    log_activity(request, request.user.tenant_id, 'logout', category='auth',
                 description=f'{request.user.name or request.user.email} signed out')
    request.auth.delete()
    return Response({'ok': True})


@api_view(['GET'])
@permission_classes([AllowAny])
def public_school_info(request, slug):
    """Public-facing catalog for a school's self-enrollment page: just the
    branding and whichever courses/groups staff opted into showing."""
    tenant = Tenant.objects.filter(slug=slug.strip().lower(), status='active').first()
    if not tenant:
        raise NotFound('School not found')

    courses = Course.objects.filter(tenant=tenant, show_on_enrollment=True, status='active').prefetch_related('groups')
    course_data = []
    for c in courses:
        groups = []
        for g in c.groups.filter(status='active'):
            seats_left = max(g.capacity - g.students.count(), 0)
            groups.append({
                'id': g.id,
                'name': g.name,
                'schedule': g.schedule,
                'room': g.room,
                'capacity': g.capacity,
                'seats_left': seats_left,
                # Only surfaced publicly when it's genuinely scarce — "12
                # places left" reads as "no rush"; showing nothing is the
                # better default, and a low number then carries real urgency.
                'seats_left_is_low': 0 < seats_left <= PUBLIC_LOW_SEATS_THRESHOLD,
                'is_full': seats_left == 0,
            })
        course_data.append({
            'id': c.id,
            'title': c.title,
            'description': c.description,
            'category': c.category,
            'pricing_type': c.pricing_type,
            'sessions_count': c.sessions_count,
            'price': str(c.price),
            'color': c.color,
            'image_url': c.image_url,
            'school_level': c.school_level,
            'school_year': c.school_year,
            'specialty': c.specialty,
            'groups': groups,
        })

    teachers = Teacher.objects.filter(tenant=tenant, show_on_website=True, status='active')
    teacher_data = [{
        'id': t.id, 'first_name': t.first_name, 'last_name': t.last_name,
        'photo_url': t.photo_url, 'subjects': t.subjects,
    } for t in teachers]

    gallery = tenant.gallery_photos.all()
    gallery_data = [{'id': p.id, 'image_url': p.image_url, 'caption': p.caption} for p in gallery]

    return Response({
        'id': tenant.id,
        'name': tenant.name,
        'slug': tenant.slug,
        'logo_url': tenant.logo_url,
        'hero_image_url': tenant.hero_image_url,
        'primary_color': tenant.primary_color,
        'accent_color': tenant.accent_color,
        'language': tenant.language,
        'currency': tenant.currency,
        'enrollment_description': tenant.enrollment_description,
        'address': tenant.address,
        'phone': tenant.phone,
        'map_url': tenant.map_url,
        'social_links': tenant.social_links,
        'courses': course_data,
        'teachers': teacher_data,
        'gallery': gallery_data,
    })


@api_view(['GET'])
@permission_classes([AllowAny])
def sitemap_schools_xml(request):
    """The marketing site's static sitemap.xml (frontend/public/) only lists
    the handful of evergreen pages known at build time — every tenant's own
    public enrollment page (/enroll/<slug>) is a legitimate, separately
    indexable page too (a parent searching the school's own name should find
    it), but the set of tenants changes constantly, so it can't live in a
    static file. Served from here instead and referenced as a second
    `Sitemap:` line in robots.txt — a sitemap index isn't needed since a
    plain robots.txt can list multiple sitemap files directly. Only tenants
    with at least one course actually open for enrollment are included, so
    Google isn't sent to a page that's just an empty catalog."""
    from xml.sax.saxutils import escape as xml_escape

    tenants = (
        Tenant.objects
        .filter(status='active', courses__show_on_enrollment=True, courses__status='active')
        .distinct()
        .values('slug', 'updated_at')
    )
    entries = []
    for t in tenants:
        slug = (t['slug'] or '').strip()
        if not slug:
            continue
        lastmod = t['updated_at'].strftime('%Y-%m-%d') if t['updated_at'] else ''
        entries.append(
            f"  <url><loc>https://scolaris.cloud/enroll/{xml_escape(slug)}</loc>"
            f"<lastmod>{lastmod}</lastmod><changefreq>weekly</changefreq></url>"
        )

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + '\n'.join(entries) + ('\n' if entries else '') +
        '</urlset>'
    )
    return HttpResponse(xml, content_type='application/xml')


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([EnrollmentRateThrottle])
def public_school_enroll(request, slug):
    """Self-service enrollment from a school's public page: creates the
    guardian's parent-portal account, the student, and a tuition Payment —
    either left pending for in-person payment, or backed by a fresh Chargily
    checkout for online payment."""
    tenant = Tenant.objects.filter(slug=slug.strip().lower(), status='active').first()
    if not tenant:
        raise NotFound('School not found')

    data = request.data
    guardian_name = (data.get('guardian_name') or '').strip()
    guardian_email = (data.get('guardian_email') or '').strip().lower()
    guardian_phone = (data.get('guardian_phone') or '').strip()
    password = data.get('password') or ''
    student_first = (data.get('student_first_name') or '').strip()
    student_last = (data.get('student_last_name') or '').strip()
    group_id = data.get('group_id')
    # The public enrollment page no longer offers an online-payment choice —
    # parents just fill the form and pay at the school office — but keep
    # accepting 'online' here too, since nothing about the Chargily checkout
    # path below actually depends on the frontend exposing that choice.
    payment_method = data.get('payment_method') or 'office'

    if not all([guardian_name, guardian_email, guardian_phone, password, student_first, student_last, group_id]):
        return Response({'error': 'All fields are required'}, status=status.HTTP_400_BAD_REQUEST)
    if payment_method not in ['online', 'office']:
        return Response({'error': 'Choose a payment method'}, status=status.HTTP_400_BAD_REQUEST)
    if len(password) < 8:
        return Response({'error': 'Password must be at least 8 characters'}, status=status.HTTP_400_BAD_REQUEST)

    group = Group.objects.filter(
        id=group_id, tenant=tenant, status='active', course__show_on_enrollment=True,
    ).select_related('course').first()
    if not group:
        raise NotFound('That course is not available for enrollment')

    if group.students.count() >= group.capacity:
        return Response({'error': 'This group is full — please choose another.'}, status=status.HTTP_409_CONFLICT)

    if User.objects.filter(email=guardian_email).exists():
        return Response({
            'error': 'An account with this email already exists. Log in to the parent portal to enroll another child.',
        }, status=status.HTTP_409_CONFLICT)

    existing_count = Student.objects.filter(tenant_id=tenant.id).count()
    if tenant.max_students is not None and existing_count >= tenant.max_students:
        return Response({'error': 'This school is at capacity — please contact them directly.'}, status=status.HTTP_400_BAD_REQUEST)

    course = group.course

    with transaction.atomic():
        guardian_user = User.objects.create_user(
            email=guardian_email, password=password, name=guardian_name,
            tenant=tenant, role='parent', phone=guardian_phone or None, email_verified=False,
        )
        guardian = Guardian.objects.create(
            tenant=tenant, user=guardian_user, name=guardian_name,
            email=guardian_email, phone=guardian_phone or None, relationship='guardian',
            # Reviewed together with the student on approve/reject — see
            # GuardianViewSet.approve/reject.
            source='public', approval_status='pending',
        )
        student_code = f"{tenant.student_prefix or 'STU-'}{str(existing_count + 1).zfill(5)}"
        student = Student.objects.create(
            tenant=tenant, parent=guardian, first_name=student_first, last_name=student_last,
            student_code=student_code, enrollment_date=timezone.now(), status='active',
            # Self-enrolled — a secretary reviews it on the Students page
            # before it counts as a confirmed record (see StudentViewSet.approve).
            source='public', approval_status='pending',
        )
        group.students.add(student)
        log_activity(request, tenant.id, 'create', category='data', entity_type='students', entity_id=student.id,
                     description=f'Public enrollment: {student.first_name} {student.last_name} (pending approval)')

        invoice_count = Payment.objects.filter(tenant_id=tenant.id).count()
        invoice_number = f"{tenant.invoice_prefix or 'INV-'}{str(invoice_count + 1).zfill(6)}"
        payment = Payment.objects.create(
            tenant=tenant, student=student, course=course, group=group, kind='registration',
            amount=course.price, method='card' if payment_method == 'online' else 'cash',
            status='pending', due_date=timezone.now().date(), invoice_number=invoice_number,
        )

        auth_token = Token.objects.create(user=guardian_user)

    result = {
        'access_token': auth_token.key,
        'user': UserSerializer(guardian_user).data,
        'student': StudentSerializer(student).data,
        'payment': PaymentSerializer(payment).data,
    }

    if payment_method == 'office':
        return Response(result)

    # Online: kick off a Chargily checkout tied to this specific payment.
    frontend = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000').rstrip('/')
    app_url = getattr(settings, 'APP_URL', 'http://localhost:8002').rstrip('/')
    locale = tenant.language if tenant.language in ['ar', 'fr'] else 'en'

    checkout = ChargilyCheckout.objects.create(
        tenant=tenant, type='student_payment', payment=payment,
        amount=int(course.price), currency=tenant.currency.lower(), status='pending',
    )
    client = ChargilyClient()
    try:
        response = client.createCheckout({
            'amount': int(course.price),
            'currency': tenant.currency.lower(),
            'locale': locale,
            'description': f"{course.title} — {student_first} {student_last}",
            'success_url': f"{frontend}/enroll/{tenant.slug}/success?checkout={checkout.id}",
            'failure_url': f"{frontend}/enroll/{tenant.slug}/failure?checkout={checkout.id}",
            'webhook_endpoint': f"{app_url}/api/v1/billing/webhook",
            'metadata': {'checkout_id': checkout.id, 'tenant_id': tenant.id},
        })
    except Exception as e:
        checkout.status = 'failed'
        checkout.save()
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f'Chargily checkout creation failed for enrollment: {str(e)}')
        result['payment_error'] = (
            'Enrollment succeeded, but the payment provider could not be reached. '
            'You can pay at the office, or retry payment from your parent portal.'
        )
        return Response(result)

    checkout.chargily_checkout_id = response.get('id')
    checkout.checkout_url = response.get('checkout_url')
    checkout.save()
    result['checkout_url'] = checkout.checkout_url
    return Response(result)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_payment_checkout_status(request, checkout_id):
    """Lets a freshly-enrolled parent poll their own tuition checkout after
    returning from Chargily, mirroring billing_checkout_status but scoped to
    a Payment instead of the tenant's own subscription."""
    user = request.user
    checkout = ChargilyCheckout.objects.filter(id=checkout_id, type='student_payment').select_related('payment').first()
    if not checkout or checkout.tenant_id != user.tenant_id:
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


STAMP_COLORS = {
    'paid': '#2F6B4F',
    'pending': '#A8762C',
    'overdue': '#B23A2E',
    'refunded': '#8A8478',
    'cancelled': '#8A8478',
}


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payment_invoice_pdf(request, payment_id):
    """Renders the approved invoice template (see api/templates/invoice.html)
    for a single payment. Reachable by staff of that tenant, the payment's
    own guardian, or a super admin — deliberately not a PaymentViewSet action
    since TenantScopedViewSet blocks role='parent' outright."""
    user = request.user
    payment = Payment.objects.select_related('student', 'student__parent', 'course', 'group', 'tenant').filter(id=payment_id).first()
    if not payment:
        raise NotFound('Payment not found')

    if user.is_super_admin():
        pass
    elif user.role == 'parent':
        guardian = Guardian.objects.filter(user_id=user.id, tenant_id=user.tenant_id).first()
        if not guardian or payment.tenant_id != user.tenant_id or payment.student.parent_id != guardian.id:
            raise NotFound('Payment not found')
    else:
        if not user.tenant_id or payment.tenant_id != user.tenant_id:
            raise NotFound('Payment not found')

    tenant = payment.tenant
    student = payment.student

    logo_data_uri = None
    if tenant.logo_url:
        try:
            filename = tenant.logo_url.rsplit('/', 1)[-1]
            logo_path = os.path.join(settings.MEDIA_ROOT, 'logos', filename)
            with open(logo_path, 'rb') as f:
                raw = f.read()
            mime = mimetypes.guess_type(filename)[0] or 'image/png'
            logo_data_uri = f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"
        except OSError:
            logo_data_uri = None

    today = timezone.now().date()
    is_overdue = payment.status in ['pending', 'partial'] and payment.due_date and payment.due_date < today
    stamp_key = 'overdue' if is_overdue else payment.status
    stamp_color = STAMP_COLORS.get(stamp_key, '#8A8478')

    # Invoices are handed to Algerian parents, so the status reads in Arabic.
    if payment.status == 'paid':
        status_label = INVOICE_STATUS_AR['paid']
        status_line = f"{INVOICE_STATUS_AR['paid']} — {payment.paid_at.strftime('%d/%m/%Y')}" if payment.paid_at else INVOICE_STATUS_AR['paid']
    elif is_overdue:
        status_label = INVOICE_STATUS_AR['overdue']
        status_line = f"{INVOICE_STATUS_AR['overdue']} — {payment.due_date.strftime('%d/%m/%Y')}"
    elif payment.status in ['pending', 'partial']:
        status_label = INVOICE_STATUS_AR['pending']
        status_line = f"{INVOICE_STATUS_AR['due_on']} {payment.due_date.strftime('%d/%m/%Y')}" if payment.due_date else INVOICE_STATUS_AR['pending']
    else:
        status_label = INVOICE_STATUS_AR.get(payment.status, payment.get_status_display())
        status_line = status_label

    kind_label_ar = INVOICE_KIND_AR.get(payment.kind, payment.get_kind_display())

    item_sub_parts = []
    if payment.group:
        item_sub_parts.append(payment.group.name)
    if payment.trip:
        item_sub_parts.append(payment.trip.destination)
    if payment.book_copy:
        item_sub_parts.append(payment.book_copy.copy_code)
    # Only add the kind label when it isn't already the item title (that
    # happens when there's no linked course/trip/book — kind is the title itself then).
    if payment.course or payment.trip or payment.book:
        item_sub_parts.append(kind_label_ar)

    subtotal = payment.amount
    discount = payment.discount or 0
    total = subtotal - discount
    currency_code = tenant.currency or 'DZD'

    # Handed to Algerian parents, so the whole document — not just the
    # status — reads in Arabic: numeric dates (no English month names),
    # Arabic kind/method/currency wording, RTL template.
    context = {
        'primary_color': tenant.primary_color or '#0A0A0B',
        'accent_color': tenant.accent_color or '#E53935',
        'overdue_color': '#B23A2E',
        'stamp_color': stamp_color,
        'status_label': status_label,
        'status_line': status_line,
        'tenant_name': tenant.name,
        'tenant_initial': (tenant.name or 'S')[0].upper(),
        'tenant_currency': None,
        'logo_data_uri': logo_data_uri,
        'invoice_number': payment.invoice_number or payment.id,
        'issued_date': payment.created_at.strftime('%d/%m/%Y'),
        'student_name': f"{student.first_name} {student.last_name}",
        'guardian_name': student.parent.name if student.parent else None,
        'method_label': INVOICE_METHOD_AR.get(payment.method, payment.get_method_display()),
        'due_date': payment.due_date.strftime('%d/%m/%Y') if payment.due_date and payment.status != 'paid' else None,
        'student_code': student.student_code,
        'item_title': payment.trip.title if payment.trip else (payment.course.title if payment.course else (payment.book.title if payment.book else kind_label_ar)),
        'item_sub': ' · '.join(item_sub_parts),
        'subtotal': f"{subtotal:,.2f}",
        'discount': f"{discount:,.2f}",
        'total': f"{total:,.2f}",
        'currency': INVOICE_CURRENCY_AR.get(currency_code, currency_code),
    }

    html_string = render_to_string('invoice.html', context)
    pdf_bytes = HTML(string=html_string).write_pdf()

    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="{payment.invoice_number or payment.id}.pdf"'
    return response


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
    if not re.match(r'^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$', tenant_slug):
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

    payments_qs = Payment.objects.filter(tenant_id__in=selected_ids, status='paid')
    payments_qs = filter_by_date_range(payments_qs, request, 'paid_at')
    revenue_by_tenant = dict(
        payments_qs.values('tenant_id').annotate(total=Sum('amount')).values_list('tenant_id', 'total')
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
        token = secrets.token_urlsafe(32)
        expires_at = timezone.now() + timedelta(hours=1)
        PasswordResetToken.objects.create(
            token=token,
            user=user,
            expires_at=expires_at,
            used=False
        )
        
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
        
    row = PasswordResetToken.objects.filter(token=token).first()
    if not row or row.used:
        return Response({'error': 'Invalid or expired token'}, status=status.HTTP_400_BAD_REQUEST)
        
    if timezone.now() > row.expires_at:
        return Response({'error': 'Token expired'}, status=status.HTTP_400_BAD_REQUEST)
        
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
        if not re.match(r'^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$', slug):
            return Response({'error': 'Invalid slug (a-z, 0-9, hyphens, 3-32 chars)'}, status=status.HTTP_400_BAD_REQUEST)
            
        state_data['tenant_name'] = tenant_name.strip()[:120]
        state_data['tenant_slug'] = slug
        state_data['center_type'] = request.GET.get('center_type', 'tutoring') or 'tutoring'
        
    signed_state = GoogleOAuthService.get_signed_state(
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
    return redirect(url)


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
    if not state_payload:
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
        print(f'[google_callback] EXCEPTION during token exchange: {type(e).__name__}: {e}')
        traceback.print_exc()
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
            
    token, _ = Token.objects.get_or_create(user=user)
    exchange_code = secrets.token_urlsafe(32)
    
    # Store token and user payload in cache (or simulate it using django cache)
    from django.core.cache import cache
    cache.set(f"oauth_exchange:{exchange_code}", {
        'access_token': token.key,
        'refresh_token': token.key,
        'user': UserSerializer(user).data
    }, timeout=120)
    
    return redirect(f"{front}/oauth/callback?code={exchange_code}")


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


# Dashboard View
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_summary(request):
    tid = require_staff_tenant(request.user)

    now = timezone.now()
    # Today range in local time or simple date comparison
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    
    students_total = Student.objects.filter(tenant_id=tid, status='active').count()
    teachers_total = Teacher.objects.filter(tenant_id=tid, status='active').count()
    courses_total = Course.objects.filter(tenant_id=tid, status='active').count()
    groups_total = Group.objects.filter(tenant_id=tid, status='active').count()
    
    today_sessions = ClassSession.objects.filter(
        tenant_id=tid,
        start_at__range=(day_start, day_end)
    ).order_by('start_at')[:50]
    
    upcoming_sessions = ClassSession.objects.filter(
        tenant_id=tid,
        start_at__range=(now, now + timedelta(days=7))
    ).order_by('start_at')[:20]
    
    # Calculate revenue today
    rev_today_data = Payment.objects.filter(
        tenant_id=tid,
        status='paid',
        paid_at__range=(day_start, day_end)
    ).aggregate(total=Sum(F('amount') - F('discount')))
    revenue_today = float(rev_today_data['total'] or 0)
    
    # Calculate revenue month
    rev_month_data = Payment.objects.filter(
        tenant_id=tid,
        status='paid',
        paid_at__gte=month_start
    ).aggregate(total=Sum(F('amount') - F('discount')))
    revenue_month = float(rev_month_data['total'] or 0)
    
    # Outstanding
    out_data = Payment.objects.filter(
        tenant_id=tid,
        status__in=['pending', 'partial']
    ).aggregate(total=Sum(F('amount') - F('discount')))
    outstanding = float(out_data['total'] or 0)

    # Expenses — same today/month windows as revenue, so profit/loss compares
    # like-for-like periods.
    exp_today_data = Expense.objects.filter(tenant_id=tid, spent_at__range=(day_start.date(), day_end.date())).aggregate(total=Sum('amount'))
    expenses_today = float(exp_today_data['total'] or 0)
    exp_month_data = Expense.objects.filter(tenant_id=tid, spent_at__gte=month_start.date()).aggregate(total=Sum('amount'))
    expenses_month = float(exp_month_data['total'] or 0)

    # Teachers' share of revenue — the piece that never reaches the
    # institution. Reports already nets this out of its own "net" figure;
    # the dashboard's net_profit_month didn't, which overstated what the
    # school actually keeps by the full amount owed to teachers.
    teacher_earnings_today = compute_teacher_earned_total(tid, date_from=day_start.date(), date_to=day_end.date())
    teacher_earnings_month = compute_teacher_earned_total(tid, date_from=month_start.date())

    # Money owed to/by the school — receivables from students who've used
    # more than they've paid for, payables from what's earned-but-unpaid to
    # teachers plus students who've overpaid (the school owes them back).
    # See compute_student_balances/compute_teacher_earnings docstrings for
    # what "owes"/"overpaid"/earned-but-unpaid actually mean.
    student_balances = compute_student_balances(tid)
    receivables_total = round(sum(-b['balance'] for b in student_balances.values() if b['status'] == 'owes'), 2)
    overpaid_students_total = round(sum(b['balance'] for b in student_balances.values() if b['status'] == 'overpaid'), 2)
    students_owing_count = sum(1 for b in student_balances.values() if b['status'] == 'owes')
    students_overpaid_count = sum(1 for b in student_balances.values() if b['status'] == 'overpaid')

    teacher_rows = compute_teacher_earnings(tid, request)
    teacher_payouts_due = round(sum(max(r['balance'], 0) for r in teacher_rows), 2)
    teachers_awaiting_payout_count = sum(1 for r in teacher_rows if r['balance'] > BALANCE_THRESHOLD)
    payables_total = round(teacher_payouts_due + overpaid_students_total, 2)

    recent_students = Student.objects.filter(tenant_id=tid).order_by('-created_at')[:5]
    recent_payments = Payment.objects.filter(tenant_id=tid).order_by('-created_at')[:5]
    
    # Attendance percentage for today
    today_session_ids = list(today_sessions.values_list('id', flat=True))
    att_total = 0
    att_present = 0
    if today_session_ids:
        att_total = Attendance.objects.filter(tenant_id=tid, session_id__in=today_session_ids).count()
        att_present = Attendance.objects.filter(
            tenant_id=tid,
            session_id__in=today_session_ids,
            status__in=['present', 'late']
        ).count()
        
    attendance_pct = round((att_present / att_total) * 100, 1) if att_total else 0.0
    
    # Revenue Trend (last 6 months)
    trend = []
    # Note: Carbon subMonths(i) was used. In Python:
    for i in range(5, -1, -1):
        # Calculate start of month for subtraction
        # To match Laravel's Carbon logic, subtract months:
        # e.g., if now is July: i=5 (Feb), i=4 (Mar), i=3 (Apr), i=2 (May), i=1 (Jun), i=0 (Jul)
        # Using date math:
        m_date = month_start
        for _ in range(i):
            # Go back one month
            m_date = (m_date - timedelta(days=1)).replace(day=1)
            
        # End of that month
        # Next month start
        import calendar
        last_day = calendar.monthrange(m_date.year, m_date.month)[1]
        m_end = m_date.replace(day=last_day, hour=23, minute=59, second=59, microsecond=999999)
        
        m_rev_data = Payment.objects.filter(
            tenant_id=tid,
            status='paid',
            paid_at__range=(m_date, m_end)
        ).aggregate(total=Sum(F('amount') - F('discount')))
        m_exp_data = Expense.objects.filter(
            tenant_id=tid,
            spent_at__range=(m_date.date(), m_end.date())
        ).aggregate(total=Sum('amount'))

        m_total = float(m_rev_data['total'] or 0)
        m_expenses = float(m_exp_data['total'] or 0)
        # Kept as its own series rather than folded into 'expenses' — that
        # field mirrors the Expenses page's own total, and silently padding
        # it with the teacher share would make the two pages disagree.
        m_teacher = compute_teacher_earned_total(tid, date_from=m_date.date(), date_to=m_end.date())
        trend.append({
            'month': m_date.strftime('%b'),
            'revenue': round(m_total, 2),
            'expenses': round(m_expenses, 2),
            'teacher_earnings': round(m_teacher, 2),
            'profit': round(m_total - m_expenses - m_teacher, 2),
        })

    at_risk_students = compute_at_risk_students(tid)

    return Response({
        'kpis': {
            'students_total': students_total,
            'teachers_total': teachers_total,
            'courses_total': courses_total,
            'groups_total': groups_total,
            'revenue_today': round(revenue_today, 2),
            'revenue_month': round(revenue_month, 2),
            'expenses_today': round(expenses_today, 2),
            'expenses_month': round(expenses_month, 2),
            'teacher_earnings_today': round(teacher_earnings_today, 2),
            'teacher_earnings_month': round(teacher_earnings_month, 2),
            'net_profit_month': round(revenue_month - teacher_earnings_month - expenses_month, 2),
            'outstanding': round(outstanding, 2),
            'receivables_total': receivables_total,
            'payables_total': payables_total,
            'teacher_payouts_due': teacher_payouts_due,
            'overpaid_students_total': overpaid_students_total,
            'attendance_pct': attendance_pct,
            'sessions_today': len(today_sessions),
        },
        'financial_alerts': {
            'students_owing_count': students_owing_count,
            'students_overpaid_count': students_overpaid_count,
            'teachers_awaiting_payout_count': teachers_awaiting_payout_count,
        },
        'today_sessions': ClassSessionSerializer(today_sessions, many=True).data,
        'upcoming_sessions': ClassSessionSerializer(upcoming_sessions, many=True).data,
        'recent_students': StudentSerializer(recent_students, many=True).data,
        'recent_payments': PaymentSerializer(recent_payments, many=True).data,
        'revenue_trend': trend,
        'at_risk_students': at_risk_students,
    })


def compute_at_risk_students(tid):
    """Flags active students with overdue payments and/or a low attendance
    rate over the last 30 days. Computed live on every dashboard/reports
    load — this codebase has no persisted notification/alert model, and
    every other "risk" signal (e.g. payments_overdue) already works this
    way, so this matches the existing pattern rather than introducing new
    stored state."""
    today = timezone.now().date()
    overdue_by_student = {}
    for student_id, amount, discount in Payment.objects.filter(
        tenant_id=tid, status__in=['pending', 'partial'], due_date__lt=today
    ).values_list('student_id', 'amount', 'discount'):
        overdue_by_student[student_id] = overdue_by_student.get(student_id, 0) + float(amount - discount)

    cutoff = timezone.now() - timedelta(days=30)
    session_ids = list(ClassSession.objects.filter(tenant_id=tid, start_at__gte=cutoff).values_list('id', flat=True))
    totals = {}
    presents = {}
    if session_ids:
        for student_id, mark_status in Attendance.objects.filter(
            tenant_id=tid, session_id__in=session_ids
        ).values_list('student_id', 'status'):
            totals[student_id] = totals.get(student_id, 0) + 1
            if mark_status in ('present', 'late'):
                presents[student_id] = presents.get(student_id, 0) + 1

    flagged_ids = set(overdue_by_student) | {
        sid for sid, total in totals.items() if total >= 3 and (presents.get(sid, 0) / total) < 0.7
    }
    if not flagged_ids:
        return []

    results = []
    for student in Student.objects.filter(tenant_id=tid, status='active', id__in=flagged_ids):
        reasons = []
        attendance_rate = None
        total = totals.get(student.id, 0)
        if total >= 3:
            attendance_rate = round((presents.get(student.id, 0) / total) * 100, 1)
            if attendance_rate < 70:
                reasons.append('low_attendance')
        overdue_amount = overdue_by_student.get(student.id)
        if overdue_amount:
            reasons.append('overdue_payment')
        if not reasons:
            continue
        results.append({
            'id': student.id,
            'first_name': student.first_name,
            'last_name': student.last_name,
            'reasons': reasons,
            'attendance_rate': attendance_rate,
            'overdue_amount': round(overdue_amount, 2) if overdue_amount else 0,
        })

    results.sort(key=lambda r: (r['attendance_rate'] if r['attendance_rate'] is not None else 100, -r['overdue_amount']))
    return results


# Global Search View
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def global_search(request):
    q = request.GET.get('q', '').strip()
    if not q:
        return Response({'error': 'Query parameter q is required'}, status=status.HTTP_400_BAD_REQUEST)
        
    tid = require_staff_tenant(request.user)

    results = []
    
    # Students
    students = Student.objects.filter(tenant_id=tid).filter(
        name_search_q(q, 'first_name', 'last_name', 'email')
    )[:5]
    for s in students:
        results.append({
            'type': 'student',
            'id': s.id,
            'label': f"{s.first_name} {s.last_name}".strip(),
            'data': StudentSerializer(s).data
        })
        
    # Teachers
    teachers = Teacher.objects.filter(tenant_id=tid).filter(
        name_search_q(q, 'first_name', 'last_name', 'email')
    )[:5]
    for t in teachers:
        results.append({
            'type': 'teacher',
            'id': t.id,
            'label': f"{t.first_name} {t.last_name}".strip(),
            'data': TeacherSerializer(t).data
        })
        
    # Guardians
    guardians = Guardian.objects.filter(tenant_id=tid).filter(
        Q(name__icontains=q) | Q(email__icontains=q)
    )[:5]
    for g in guardians:
        results.append({
            'type': 'parent',
            'id': g.id,
            'label': g.name,
            'data': GuardianSerializer(g).data
        })
        
    # Courses
    courses = Course.objects.filter(tenant_id=tid, title__icontains=q)[:5]
    for c in courses:
        results.append({
            'type': 'course',
            'id': c.id,
            'label': c.title,
            'data': CourseSerializer(c).data
        })
        
    # Groups
    groups = Group.objects.filter(tenant_id=tid, name__icontains=q)[:5]
    for g in groups:
        results.append({
            'type': 'group',
            'id': g.id,
            'label': g.name,
            'data': GroupSerializer(g).data
        })
        
    # Payments
    payments = Payment.objects.filter(tenant_id=tid).filter(
        Q(invoice_number__icontains=q) | Q(reference__icontains=q)
    )[:5]
    for p in payments:
        results.append({
            'type': 'payment',
            'id': p.id,
            'label': f"{p.invoice_number} — {p.amount}",
            'data': PaymentSerializer(p).data
        })

    # Sessions
    sessions = ClassSession.objects.filter(tenant_id=tid).filter(
        Q(topic__icontains=q) | Q(room__icontains=q)
    )[:5]
    for sess in sessions:
        results.append({
            'type': 'session',
            'id': sess.id,
            'label': sess.topic or f"Session — {sess.start_at.strftime('%Y-%m-%d %H:%M')}",
            'data': ClassSessionSerializer(sess).data
        })

    # Grades
    grades = Grade.objects.filter(tenant_id=tid, title__icontains=q)[:5]
    for gr in grades:
        results.append({
            'type': 'grade',
            'id': gr.id,
            'label': f"{gr.title} — {gr.score}/{gr.max_score}",
            'data': GradeSerializer(gr).data
        })

    # Users
    users = User.objects.filter(tenant_id=tid).filter(
        Q(name__icontains=q) | Q(email__icontains=q)
    )[:5]
    for u in users:
        results.append({
            'type': 'user',
            'id': u.id,
            'label': u.name or u.email,
            'data': UserSerializer(u).data
        })

    return Response({'results': results, 'query': q})


# Attendance Custom Views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def attendance_for_session(request, session_id):
    user = request.user
    tid = user.tenant_id
    if not tid:
        raise PermissionDenied('User has no tenant')
    if not user.is_super_admin() and not user.can_view('attendance'):
        raise PermissionDenied('Forbidden')

    if request.method == 'GET':
        items = Attendance.objects.filter(tenant_id=tid, session_id=session_id)
        return Response({'items': AttendanceSerializer(items, many=True).data, 'total': items.count()})

    elif request.method == 'POST':
        # Bulk Mark — an upsert on existing session/student attendance rows.
        if not user.is_super_admin() and not user.can_modify('attendance'):
            raise PermissionDenied('Forbidden')

        marks = request.data.get('marks')
        if not isinstance(marks, list):
            return Response({'error': 'marks must be an array'}, status=status.HTTP_400_BAD_REQUEST)
            
        session = ClassSession.objects.filter(id=session_id, tenant_id=tid).first()
        if not session:
            raise NotFound('Session not found')
            
        with transaction.atomic():
            for mark in marks:
                student_id = mark.get('student_id')
                status_val = mark.get('status')
                note = mark.get('note')

                if not student_id or status_val not in ['present', 'absent', 'late', 'excused']:
                    continue

                # Recovery only applies to excused absences. Re-saving an
                # already-excused record (e.g. fixing the note) must not
                # clobber a recovery_status the tenant already progressed —
                # only a *fresh* transition into 'excused' starts it at
                # needs_recovery. Any other status resets it to n/a.
                existing = Attendance.objects.filter(tenant_id=tid, session_id=session_id, student_id=student_id).first()
                if status_val == 'excused':
                    recovery_status = existing.recovery_status if existing and existing.status == 'excused' else 'needs_recovery'
                else:
                    recovery_status = 'not_applicable'

                Attendance.objects.update_or_create(
                    tenant_id=tid,
                    session_id=session_id,
                    student_id=student_id,
                    defaults={
                        'status': status_val,
                        'note': note or None,
                        'recovery_status': recovery_status,
                        'marked_by': user,
                        'marked_at': timezone.now()
                    }
                )
                
        items = Attendance.objects.filter(tenant_id=tid, session_id=session_id)
        return Response({'items': AttendanceSerializer(items, many=True).data, 'total': items.count()})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def attendance_upload_excuse(request, attendance_id):
    """Attaches a photo/PDF of the excuse document (doctor's note, etc.) to
    an excused absence — only meaningful for status='excused' records."""
    user = request.user
    tid = user.tenant_id
    if not tid:
        raise PermissionDenied('User has no tenant')
    if not user.is_super_admin() and not user.can_modify('attendance'):
        raise PermissionDenied('Forbidden')

    attendance = Attendance.objects.filter(id=attendance_id, tenant_id=tid).first()
    if not attendance:
        raise NotFound('Attendance record not found')
    if attendance.status != 'excused':
        return Response({'error': 'Only excused absences can have an excuse document'}, status=status.HTTP_400_BAD_REQUEST)
    if 'file' not in request.FILES:
        return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

    new_url = save_uploaded_document(request.FILES['file'], 'excuses', attendance.id)
    delete_uploaded_image(attendance.excuse_document_url, 'excuses')
    attendance.excuse_document_url = new_url
    attendance.save(update_fields=['excuse_document_url'])
    return Response(AttendanceSerializer(attendance).data)


ATTENDANCE_STATUS_AR = {
    'present': 'حاضر',
    'late': 'متأخر',
    'excused': 'معذور',
    'absent': 'غائب',
}


def _file_data_uri(path):
    try:
        with open(path, 'rb') as f:
            raw = f.read()
        mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
        return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"
    except OSError:
        return None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def attendance_session_print(request, session_id):
    """One printable PDF for a session's saved attendance: a roster (student,
    status, time marked) followed by every attached excuse document — a
    photo is embedded as its own page in the same render, a PDF excuse note
    is spliced in afterwards with pypdf (WeasyPrint can render HTML into a
    PDF but can't graft an already-existing PDF's pages into that output by
    itself). One combined file, so nothing needs opening separately."""
    user = request.user
    tid = user.tenant_id
    if not tid:
        raise PermissionDenied('User has no tenant')
    if user.role == 'parent':
        raise PermissionDenied('Forbidden')
    if not user.is_super_admin() and not user.can_view('attendance'):
        raise PermissionDenied('Forbidden')

    session = ClassSession.objects.filter(id=session_id, tenant_id=tid).select_related(
        'group', 'group__course', 'group__teacher', 'course', 'teacher', 'room_ref',
    ).first()
    if not session:
        raise NotFound('Session not found')

    tenant = Tenant.objects.filter(id=tid).first()
    group = session.group
    course = session.course or (group.course if group else None)
    teacher = session.teacher or (group.teacher if group else None)

    attendance_qs = Attendance.objects.filter(tenant_id=tid, session_id=session_id).select_related('student').order_by(
        'student__first_name', 'student__last_name',
    )
    if not attendance_qs.exists():
        return Response({'error': 'No attendance has been saved for this session yet'}, status=status.HTTP_400_BAD_REQUEST)

    logo_data_uri = None
    if tenant and tenant.logo_url:
        filename = tenant.logo_url.rsplit('/', 1)[-1]
        logo_data_uri = _file_data_uri(os.path.join(settings.MEDIA_ROOT, 'logos', filename))

    counts = {'present': 0, 'late': 0, 'excused': 0, 'absent': 0}
    rows = []
    image_docs = []
    pdf_docs = []  # merged in after the WeasyPrint render, see below
    for a in attendance_qs:
        counts[a.status] = counts.get(a.status, 0) + 1
        has_document = bool(a.excuse_document_url)
        if has_document:
            ext = a.excuse_document_url.rsplit('.', 1)[-1].lower()
            filename = a.excuse_document_url.rsplit('/', 1)[-1]
            disk_path = os.path.join(settings.MEDIA_ROOT, 'excuses', filename)
            student_label = f'{a.student.first_name} {a.student.last_name}'
            if ext == 'pdf':
                pdf_docs.append({'student_name': student_label, 'path': disk_path})
            else:
                data_uri = _file_data_uri(disk_path)
                if data_uri:
                    image_docs.append({'student_name': student_label, 'data_uri': data_uri})
                else:
                    has_document = False
        rows.append({
            'student_name': f'{a.student.first_name} {a.student.last_name}',
            'student_code': a.student.student_code,
            'status': a.status,
            'status_label': ATTENDANCE_STATUS_AR.get(a.status, a.status),
            'marked_at': timezone.localtime(a.marked_at).strftime('%H:%M'),
            'has_document': has_document,
        })

    if group and course:
        group_label = f'{group.name} — {course.title}'
    elif group:
        group_label = group.name
    else:
        group_label = '—'

    context = {
        'primary_color': (tenant.primary_color if tenant else None) or '#0A0A0B',
        'accent_color': (tenant.accent_color if tenant else None) or '#E53935',
        'tenant_name': tenant.name if tenant else '',
        'tenant_initial': ((tenant.name if tenant else None) or 'S')[0].upper(),
        'logo_data_uri': logo_data_uri,
        'printed_at': timezone.localtime(timezone.now()).strftime('%d/%m/%Y %H:%M'),
        'group_label': group_label,
        'session_datetime': f"{timezone.localtime(session.start_at).strftime('%d/%m/%Y %H:%M')} — {timezone.localtime(session.end_at).strftime('%H:%M')}",
        'teacher_name': f'{teacher.first_name} {teacher.last_name}' if teacher else None,
        'topic': session.topic,
        'rows': rows,
        'counts': counts,
        'image_docs': image_docs,
    }

    html_string = render_to_string('attendance_roster.html', context)
    pdf_bytes = HTML(string=html_string).write_pdf()

    if pdf_docs:
        from pypdf import PdfReader, PdfWriter

        writer = PdfWriter()
        for page in PdfReader(io.BytesIO(pdf_bytes)).pages:
            writer.add_page(page)

        for doc in pdf_docs:
            label_html = render_to_string('attendance_doc_label.html', {
                'primary_color': context['primary_color'],
                'student_name': doc['student_name'],
            })
            label_bytes = HTML(string=label_html).write_pdf()
            for page in PdfReader(io.BytesIO(label_bytes)).pages:
                writer.add_page(page)
            try:
                for page in PdfReader(doc['path']).pages:
                    writer.add_page(page)
            except Exception:
                pass  # a missing/corrupt file shouldn't break the whole roster

        out = io.BytesIO()
        writer.write(out)
        pdf_bytes = out.getvalue()

    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    response['Content-Disposition'] = f'inline; filename="attendance-{session_id}.pdf"'
    return response


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def attendance_set_recovery(request, attendance_id):
    """Manually toggles whether a student has made up an excused absence —
    a plain status flag, no makeup-session scheduling involved."""
    user = request.user
    tid = user.tenant_id
    if not tid:
        raise PermissionDenied('User has no tenant')
    if not user.is_super_admin() and not user.can_modify('attendance'):
        raise PermissionDenied('Forbidden')

    recovery_status = request.data.get('recovery_status')
    if recovery_status not in ('needs_recovery', 'recovered'):
        return Response({'error': "recovery_status must be 'needs_recovery' or 'recovered'"}, status=status.HTTP_400_BAD_REQUEST)

    attendance = Attendance.objects.filter(id=attendance_id, tenant_id=tid).first()
    if not attendance:
        raise NotFound('Attendance record not found')
    if attendance.status != 'excused':
        return Response({'error': 'Recovery only applies to excused absences'}, status=status.HTTP_400_BAD_REQUEST)

    attendance.recovery_status = recovery_status
    attendance.save(update_fields=['recovery_status'])
    return Response(AttendanceSerializer(attendance).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def attendance_for_student(request, student_id):
    user = request.user
    tid = user.tenant_id
    if not tid:
        raise PermissionDenied('User has no tenant')
        
    items = Attendance.objects.filter(tenant_id=tid, student_id=student_id).order_by('-marked_at')[:500]
    return Response({'items': AttendanceSerializer(items, many=True).data, 'total': len(items)})


# Parent Portal — read-only endpoints for role='parent' users, scoped to only
# the children linked to their own Guardian record. Gated on the tenant's
# parent_portal plan flag so a downgrade after a parent already has a login
# revokes access immediately rather than just hiding the invite button.
def _portal_guardian(request):
    user = request.user
    if user.role != 'parent' or not user.tenant_id:
        raise PermissionDenied('Forbidden')

    tenant = Tenant.objects.filter(id=user.tenant_id).first()
    parent_portal = bool(tenant and tenant.plan and PLANS_CONFIG['tiers'][tenant.plan].get('parent_portal', False))
    if not parent_portal:
        raise PermissionDenied('The parent portal is not available on this workspace\'s current plan')

    guardian = Guardian.objects.filter(user_id=user.id, tenant_id=user.tenant_id).first()
    if not guardian:
        raise PermissionDenied('No parent profile linked to this account')
    return guardian


def _portal_child(request, student_id):
    guardian = _portal_guardian(request)
    student = Student.objects.filter(id=student_id, tenant_id=request.user.tenant_id, parent_id=guardian.id).first()
    if not student:
        raise NotFound('Student not found')
    return student


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_children(request):
    guardian = _portal_guardian(request)
    children = list(Student.objects.filter(tenant_id=request.user.tenant_id, parent_id=guardian.id).order_by('first_name'))
    overdue_ids = set(Payment.objects.filter(
        tenant_id=request.user.tenant_id,
        student_id__in=[c.id for c in children],
        status__in=['pending', 'partial'],
        due_date__lt=timezone.now().date(),
    ).values_list('student_id', flat=True))
    data = StudentSerializer(children, many=True).data
    for row in data:
        row['has_overdue_payment'] = row['id'] in overdue_ids
    return Response({'items': data, 'total': len(children)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_child_attendance(request, student_id):
    student = _portal_child(request, student_id)
    items = Attendance.objects.filter(tenant_id=request.user.tenant_id, student_id=student.id).order_by('-marked_at')[:200]
    return Response({'items': AttendanceSerializer(items, many=True).data, 'total': len(items)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_child_sessions(request, student_id):
    student = _portal_child(request, student_id)
    qs = ClassSession.objects.filter(tenant_id=request.user.tenant_id, group__students=student)
    from_date = request.GET.get('from_date')
    if from_date:
        qs = qs.filter(start_at__gte=from_date)
    to_date = request.GET.get('to_date')
    if to_date:
        qs = qs.filter(start_at__lte=to_date)
    items = qs.order_by('-start_at')[:300]
    return Response({'items': ClassSessionSerializer(items, many=True).data, 'total': len(items)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_child_teachers(request, student_id):
    student = _portal_child(request, student_id)
    teacher_ids = Group.objects.filter(
        tenant_id=request.user.tenant_id, students=student, teacher__isnull=False,
    ).values_list('teacher_id', flat=True).distinct()
    items = Teacher.objects.filter(tenant_id=request.user.tenant_id, id__in=teacher_ids)
    return Response({'items': TeacherSerializer(items, many=True).data, 'total': items.count()})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_conversation(request):
    guardian = _portal_guardian(request)
    convo, _ = Conversation.objects.get_or_create(tenant_id=request.user.tenant_id, guardian=guardian)
    return Response(ConversationSerializer(convo).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def portal_conversation_messages(request):
    guardian = _portal_guardian(request)
    convo, _ = Conversation.objects.get_or_create(tenant_id=request.user.tenant_id, guardian=guardian)

    if request.method == 'POST':
        body = (request.data.get('body') or '').strip()
        if not body:
            return Response({'error': 'Message body is required'}, status=status.HTTP_400_BAD_REQUEST)
        now = timezone.now()
        Message.objects.create(
            tenant_id=request.user.tenant_id, conversation=convo,
            sender_user=request.user, sender_role='parent', body=body,
        )
        convo.last_message_at = now
        convo.last_read_by_guardian_at = now
        convo.save(update_fields=['last_message_at', 'last_read_by_guardian_at', 'updated_at'])
    else:
        convo.last_read_by_guardian_at = timezone.now()
        convo.save(update_fields=['last_read_by_guardian_at', 'updated_at'])

    items = convo.messages.select_related('sender_user').order_by('created_at')[:500]
    return Response({'items': MessageSerializer(items, many=True).data, 'total': len(items)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_child_payments(request, student_id):
    student = _portal_child(request, student_id)
    items = Payment.objects.filter(tenant_id=request.user.tenant_id, student_id=student.id).order_by('-created_at')[:200]
    return Response({'items': PaymentSerializer(items, many=True).data, 'total': len(items)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_child_grades(request, student_id):
    student = _portal_child(request, student_id)
    items = Grade.objects.filter(tenant_id=request.user.tenant_id, student_id=student.id).order_by('-date')[:200]
    return Response({'items': GradeSerializer(items, many=True).data, 'total': len(items)})


# ViewSets implementing standard CRUD
class TenantViewSet(viewsets.ModelViewSet):
    queryset = Tenant.objects.all()
    serializer_class = TenantSerializer

    def retrieve(self, request, *args, **kwargs):
        user = request.user
        tenant_id = kwargs.get('pk')
        if not user.is_super_admin() and tenant_id != user.tenant_id:
            raise PermissionDenied('Forbidden')
        tenant = Tenant.objects.filter(id=tenant_id).first()
        if not tenant:
            raise NotFound('Not found')
        return Response(TenantSerializer(tenant).data)

    def destroy(self, request, *args, **kwargs):
        if not request.user.is_super_admin():
            raise PermissionDenied('Forbidden')
        tenant = Tenant.objects.filter(id=kwargs.get('pk')).first()
        if not tenant:
            raise NotFound('Not found')
        _delete_tenant_cascade(tenant)
        return Response({'ok': True})

    @action(detail=False, methods=['get'], url_path='by-slug/(?P<slug>[^/.]+)', permission_classes=[AllowAny])
    def by_slug(self, request, slug):
        tenant = Tenant.objects.filter(slug=slug.strip().lower()).first()
        if not tenant:
            raise NotFound('Tenant not found')
            
        public_fields = ['id', 'name', 'slug', 'center_type', 'status', 'logo_url', 'primary_color', 'accent_color', 'language']
        # Serialize subset
        data = {}
        for f in public_fields:
            val = getattr(tenant, f)
            if hasattr(val, 'isoformat'): # DateTime
                val = val.isoformat()
            data[f] = val
        return Response(data)

    def list(self, request, *args, **kwargs):
        if not request.user.is_super_admin():
            raise PermissionDenied('Forbidden')
        queryset = self.get_queryset()
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        if not request.user.is_super_admin():
            raise PermissionDenied('Forbidden')
            
        required_fields = ['name', 'slug', 'owner_email', 'owner_password', 'owner_name']
        for f in required_fields:
            if not request.data.get(f):
                return Response({'error': f'{f} is required'}, status=status.HTTP_400_BAD_REQUEST)
                
        slug = request.data['slug'].strip().lower()
        import re
        if not re.match(r'^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$', slug):
            return Response({'error': 'Invalid slug'}, status=status.HTTP_400_BAD_REQUEST)
            
        if Tenant.objects.filter(slug=slug).exists():
            return Response({'error': 'Slug already taken'}, status=status.HTTP_409_CONFLICT)
            
        email = request.data['owner_email'].strip().lower()
        if User.objects.filter(email=email).exists():
            return Response({'error': 'Owner email already registered'}, status=status.HTTP_409_CONFLICT)

        # Optional: grant a plan directly (skips Chargily entirely) for a
        # duration the super admin picks — e.g. comping a school, running a
        # trial, a sales demo. Once set, the tenant's existing renew/upgrade
        # flows (billing_renew/billing_upgrade) already work unmodified off
        # of plan/status/plan_expires_at, so "purchase and extend later"
        # needs no extra wiring beyond populating those fields correctly here.
        plan = request.data.get('plan') or None
        if plan and plan not in PLANS_CONFIG['tiers']:
            return Response({'error': 'Invalid plan'}, status=status.HTTP_400_BAD_REQUEST)

        plan_expires_at = None
        if plan:
            try:
                duration_days = int(request.data.get('duration_days') or 30)
            except (TypeError, ValueError):
                return Response({'error': 'duration_days must be an integer'}, status=status.HTTP_400_BAD_REQUEST)
            if duration_days < 1:
                return Response({'error': 'duration_days must be at least 1'}, status=status.HTTP_400_BAD_REQUEST)
            plan_expires_at = timezone.now() + timedelta(days=duration_days)

        with transaction.atomic():
            tenant_fields = dict(
                name=request.data['name'].strip(),
                slug=slug,
                center_type=request.data.get('center_type', 'tutoring') or 'tutoring',
                status='active',
            )
            if plan:
                tier = PLANS_CONFIG['tiers'][plan]
                tenant_fields.update(
                    plan=plan,
                    billing_cycle='monthly',
                    max_students=tier['max_students'],
                    max_users=tier['max_users'],
                    plan_started_at=timezone.now(),
                    plan_expires_at=plan_expires_at,
                )
            tenant = Tenant.objects.create(**tenant_fields)
            owner = User.objects.create_user(
                email=email,
                password=request.data['owner_password'],
                name=request.data['owner_name'].strip(),
                tenant=tenant,
                role='owner',
                email_verified=True
            )

        return Response({
            'tenant': TenantSerializer(tenant).data,
            'owner': UserSerializer(owner).data
        })

    def update(self, request, *args, **kwargs):
        user = request.user
        if not user.is_super_admin() and user.role not in ['owner', 'director']:
            raise PermissionDenied('Forbidden')
            
        tenant_id = kwargs.get('pk')
        if not user.is_super_admin() and tenant_id != user.tenant_id:
            raise PermissionDenied('Cannot edit another tenant')
            
        tenant = Tenant.objects.filter(id=tenant_id).first()
        if not tenant:
            raise NotFound('Not found')
            
        website_fields = {'enrollment_description', 'address', 'phone', 'map_url', 'social_links', 'hero_image_url'}
        owner_editable = [
            'name', 'center_type', 'logo_url', 'primary_color', 'accent_color',
            'language', 'currency', 'timezone', 'invoice_prefix', 'student_prefix',
            'timetable_end_time',
            *website_fields,
        ]

        updates = {}
        for key, val in request.data.items():
            if user.is_super_admin():
                if key not in ['id', 'created_at', 'slug']:
                    updates[key] = val
            else:
                if key in owner_editable:
                    updates[key] = val

        if not updates:
            return Response({'error': 'No editable fields in payload'}, status=status.HTTP_400_BAD_REQUEST)

        if website_fields & updates.keys():
            check_website_builder(user, tenant)

        for key, val in updates.items():
            setattr(tenant, key, val)
        tenant.save()
        
        return Response(TenantSerializer(tenant).data)

    @action(detail=True, methods=['post'], url_path='logo')
    def upload_logo(self, request, pk=None):
        user = request.user
        if not user.is_super_admin() and user.role != 'owner':
            raise PermissionDenied('Forbidden')
        if not user.is_super_admin() and pk != user.tenant_id:
            raise PermissionDenied('Cannot edit another tenant')
            
        if 'file' not in request.FILES:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        tenant = Tenant.objects.filter(id=pk).first()
        if not tenant:
            raise NotFound('Tenant not found')

        # Plan branding eligibility check
        custom_branding = False
        if tenant.plan:
            custom_branding = PLANS_CONFIG['tiers'][tenant.plan].get('custom_branding', False)
        if not user.is_super_admin() and not custom_branding:
            raise PermissionDenied('Custom branding (logo upload) is available on the Standard and Premium plans. Upgrade your plan to use it.')

        # Shared helper: validates it's a real image, strips EXIF, downscales
        # and recompresses (see save_uploaded_image).
        new_url = save_uploaded_image(request.FILES['file'], 'logos', pk)
        delete_uploaded_image(tenant.logo_url, 'logos')
        tenant.logo_url = new_url
        tenant.save()

        return Response(TenantSerializer(tenant).data)

    @action(detail=True, methods=['post'], url_path='hero-image')
    def upload_hero_image(self, request, pk=None):
        user = request.user
        if not user.is_super_admin() and user.role != 'owner':
            raise PermissionDenied('Forbidden')
        if not user.is_super_admin() and pk != user.tenant_id:
            raise PermissionDenied('Cannot edit another tenant')
        if 'file' not in request.FILES:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        tenant = Tenant.objects.filter(id=pk).first()
        if not tenant:
            raise NotFound('Tenant not found')
        check_website_builder(user, tenant)

        new_url = save_uploaded_image(request.FILES['file'], 'hero', pk)
        delete_uploaded_image(tenant.hero_image_url, 'hero')
        tenant.hero_image_url = new_url
        tenant.save()

        return Response(TenantSerializer(tenant).data)

    @action(detail=True, methods=['get', 'post'], url_path='gallery')
    def gallery(self, request, pk=None):
        user = request.user
        if not user.is_super_admin() and pk != user.tenant_id:
            raise PermissionDenied('Cannot access another tenant')

        tenant = Tenant.objects.filter(id=pk).first()
        if not tenant:
            raise NotFound('Tenant not found')

        if request.method == 'GET':
            photos = tenant.gallery_photos.all()
            return Response({'items': SchoolGalleryPhotoSerializer(photos, many=True).data})

        if not user.is_super_admin() and user.role != 'owner':
            raise PermissionDenied('Forbidden')
        check_website_builder(user, tenant)
        if 'file' not in request.FILES:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        # Hard cap — without one, a single tenant can fill the VPS disk one
        # upload at a time (there's no per-tenant storage quota anywhere else).
        next_order = tenant.gallery_photos.count()
        if next_order >= GALLERY_MAX_PHOTOS:
            raise ValidationError(f'A gallery can hold up to {GALLERY_MAX_PHOTOS} photos. Delete one to add another.')

        image_url = save_uploaded_image(request.FILES['file'], 'gallery', pk)
        photo = SchoolGalleryPhoto.objects.create(
            tenant=tenant, image_url=image_url,
            caption=(request.data.get('caption') or '').strip() or None,
            order=next_order,
        )
        return Response(SchoolGalleryPhotoSerializer(photo).data, status=status.HTTP_200_OK)


def _clean_permissions(raw):
    """Validate a {module: {view, add, modify, delete}} payload against the
    known modules/flags. Returns a cleaned dict (unknown modules and flag
    keys dropped, non-true flags omitted) or raises ValidationError."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValidationError({'permissions': 'Must be an object of module -> {view, add, modify, delete}'})
    cleaned = {}
    for module_key, flags in raw.items():
        if module_key not in PERMISSION_MODULES:
            continue
        if not isinstance(flags, dict):
            raise ValidationError({'permissions': f"Invalid value for '{module_key}' — expected an object"})
        entry = {}
        for flag_key, flag_val in flags.items():
            if flag_key not in PERMISSION_FLAGS:
                continue
            if not isinstance(flag_val, bool):
                raise ValidationError({'permissions': f"Invalid value for '{module_key}.{flag_key}' — expected true/false"})
            if flag_val:
                entry[flag_key] = True
        cleaned[module_key] = entry
    return cleaned


class CouponViewSet(viewsets.ModelViewSet):
    # Platform-wide resource (Coupon has no tenant) — every action is
    # super-admin-only, same gating style as TenantViewSet's list/create.
    queryset = Coupon.objects.all().order_by('-created_at')
    serializer_class = CouponSerializer

    def _require_super_admin(self, request):
        if not request.user.is_super_admin():
            raise PermissionDenied('Forbidden')

    def list(self, request, *args, **kwargs):
        self._require_super_admin(request)
        serializer = self.get_serializer(self.get_queryset(), many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def retrieve(self, request, *args, **kwargs):
        self._require_super_admin(request)
        return super().retrieve(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        self._require_super_admin(request)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(created_by=request.user)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        self._require_super_admin(request)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._require_super_admin(request)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self._require_super_admin(request)
        return super().destroy(request, *args, **kwargs)


class UserViewSet(TenantScopedViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        role = request.GET.get('role')
        if role:
            queryset = queryset.filter(role=role)
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(
                Q(name__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q)
            )
        queryset = queryset.order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        user = request.user
        if not user.is_super_admin() and user.role not in ['owner', 'director']:
            raise PermissionDenied('Only owners/directors can add users')
            
        # Validate role
        role = request.data.get('role')
        tenant_assignable = ['owner', 'director', 'secretary', 'accountant', 'teacher', 'parent', 'student']
        if role not in tenant_assignable:
            return Response({'error': 'Invalid role'}, status=status.HTTP_400_BAD_REQUEST)
            
        email = request.data.get('email')
        password = request.data.get('password')
        name = request.data.get('name')
        
        if not email or not password or not name:
            return Response({'error': 'email, password and name are required'}, status=status.HTTP_400_BAD_REQUEST)
            
        email_clean = email.strip().lower()
        if User.objects.filter(email=email_clean).exists():
            return Response({'error': 'Email already registered'}, status=status.HTTP_409_CONFLICT)
            
        # Check quota
        if user.tenant_id:
            tenant = Tenant.objects.filter(id=user.tenant_id).first()
            if tenant and tenant.max_users is not None:
                current_count = User.objects.filter(tenant_id=user.tenant_id).count()
                if current_count >= tenant.max_users:
                    raise PermissionDenied(f"Your {tenant.plan} plan allows up to {tenant.max_users} users. Upgrade your plan to add more.")
                    
        permissions = _clean_permissions(request.data.get('permissions'))

        with transaction.atomic():
            new_user = User.objects.create_user(
                email=email_clean,
                password=password,
                name=name.strip(),
                tenant=user.tenant,
                role=role,
                phone=request.data.get('phone'),
                email_verified=True,
                permissions=permissions,
            )

        return Response(UserSerializer(new_user).data)

    def update(self, request, *args, **kwargs):
        user = request.user
        if not user.is_super_admin() and user.role not in ['owner', 'director']:
            raise PermissionDenied('Forbidden')
            
        target_id = kwargs.get('pk')
        target = self.filter_queryset(self.get_queryset()).filter(id=target_id).first()
        if not target:
            raise NotFound('Not found')
            
        if target.role == 'super_admin':
            return Response({'error': 'Cannot edit a super admin account'}, status=status.HTTP_400_BAD_REQUEST)
            
        updates = {}
        if 'name' in request.data and request.data['name'] is not None:
            name = request.data['name'].strip()
            if not name:
                return Response({'error': 'Name cannot be empty'}, status=status.HTTP_400_BAD_REQUEST)
            updates['name'] = name
            
        if 'phone' in request.data:
            updates['phone'] = request.data['phone']
            
        if 'role' in request.data and request.data['role'] is not None:
            role = request.data['role']
            tenant_assignable = ['owner', 'director', 'secretary', 'accountant', 'teacher', 'parent', 'student']
            if role not in tenant_assignable:
                return Response({'error': 'Invalid role'}, status=status.HTTP_400_BAD_REQUEST)
            updates['role'] = role
            
        if 'is_active' in request.data and request.data['is_active'] is not None:
            is_active_val = bool(request.data['is_active'])
            if target_id == user.id and not is_active_val:
                return Response({'error': 'Cannot deactivate your own account'}, status=status.HTTP_400_BAD_REQUEST)
            updates['is_active'] = is_active_val
            
        if 'email' in request.data and request.data['email'] is not None:
            email_clean = request.data['email'].strip().lower()
            if email_clean != target.email and User.objects.filter(email=email_clean).exists():
                return Response({'error': 'Email already registered'}, status=status.HTTP_409_CONFLICT)
            updates['email'] = email_clean

        if 'permissions' in request.data:
            updates['permissions'] = _clean_permissions(request.data['permissions'])

        if not updates:
            return Response({'error': 'No editable fields in payload'}, status=status.HTTP_400_BAD_REQUEST)
            
        for key, val in updates.items():
            setattr(target, key, val)
        target.save()
        
        return Response(UserSerializer(target).data)

    def destroy(self, request, *args, **kwargs):
        user = request.user
        if not user.is_super_admin() and user.role not in ['owner', 'director']:
            raise PermissionDenied('Forbidden')
            
        target_id = kwargs.get('pk')
        if target_id == user.id:
            return Response({'error': 'Cannot delete yourself'}, status=status.HTTP_400_BAD_REQUEST)
            
        target = self.filter_queryset(self.get_queryset()).filter(id=target_id).first()
        if not target:
            raise NotFound('Not found')
            
        if target.role == 'super_admin':
            return Response({'error': 'Cannot delete a super admin account'}, status=status.HTTP_400_BAD_REQUEST)
            
        target.delete()
        return Response({'ok': True})


class GuardianViewSet(TenantScopedViewSet):
    queryset = Guardian.objects.all()
    serializer_class = GuardianSerializer
    module_key = 'parents'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(
                Q(name__icontains=q) | Q(name_latin__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q)
            )
        queryset = queryset.prefetch_related('students').order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset()).prefetch_related('students').order_by('-created_at')
        headers = ['Name', 'Name (Latin)', 'Email', 'Phone', 'Address', 'Occupation', 'Relationship', 'Emergency Contact', 'Students']
        rows = [[
            g.name, g.name_latin or '', g.email or '', g.phone or '', g.address or '', g.occupation or '', g.relationship,
            g.emergency_contact or '', ', '.join(f"{s.first_name} {s.last_name}" for s in g.students.all()),
        ] for g in queryset]
        return export_rows(headers, rows, 'parents', request.GET.get('type'))

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        data = request.data.copy()
        student_ids = data.pop('student_ids', None)

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        guardian = serializer.instance

        if student_ids:
            Student.objects.filter(id__in=student_ids, tenant_id=guardian.tenant_id).update(parent=guardian)

        return Response(self.get_serializer(guardian).data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        self.check_module_modify()
        instance = self.get_object()
        data = request.data.copy()
        student_ids = data.pop('student_ids', None)

        serializer = self.get_serializer(instance, data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        if student_ids is not None:
            Student.objects.filter(parent=instance, tenant_id=instance.tenant_id).exclude(id__in=student_ids).update(parent=None)
            Student.objects.filter(id__in=student_ids, tenant_id=instance.tenant_id).update(parent=instance)

        return Response(self.get_serializer(instance).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """A guardian self-registered via the public enrollment page
        (source='public') starts life as approval_status='pending', in
        lockstep with the student created in the same enrollment. Approving
        either one cascades to the other — they're two halves of one
        application — but only touches counterparts still 'pending', so it
        never overwrites an explicit prior rejection."""
        self.check_module_modify()
        guardian = self.get_object()
        guardian.approval_status = 'approved'
        guardian.save(update_fields=['approval_status', 'updated_at'])
        guardian.students.filter(approval_status='pending').update(approval_status='approved')
        log_activity(request, guardian.tenant_id, 'update', entity_type='parents', entity_id=guardian.id,
                     description=f'Approved enrollment: {guardian.name}')
        return Response(GuardianSerializer(guardian).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        self.check_module_modify()
        guardian = self.get_object()
        guardian.approval_status = 'rejected'
        guardian.save(update_fields=['approval_status', 'updated_at'])
        guardian.students.filter(approval_status='pending').update(approval_status='rejected')
        log_activity(request, guardian.tenant_id, 'update', entity_type='parents', entity_id=guardian.id,
                     description=f'Rejected enrollment: {guardian.name}')
        return Response(GuardianSerializer(guardian).data)

    @action(detail=True, methods=['post'])
    def invite(self, request, pk=None):
        user = request.user
        if not user.is_super_admin() and user.role not in ['owner', 'director', 'secretary']:
            raise PermissionDenied('Forbidden')

        tenant = Tenant.objects.filter(id=user.tenant_id).first()
        if not tenant:
            raise ValidationError('Tenant not found')

        parent_portal = bool(tenant.plan) and PLANS_CONFIG['tiers'][tenant.plan].get('parent_portal', False)
        if not user.is_super_admin() and not parent_portal:
            raise PermissionDenied('The parent portal is available on the Standard and Premium plans. Upgrade your plan to invite parents.')

        guardian = self.get_object()
        if not guardian.email:
            return Response({'error': 'Add an email to this parent before inviting them'}, status=status.HTTP_400_BAD_REQUEST)

        email = guardian.email.strip().lower()
        existing = User.objects.filter(email=email).first()
        if existing and existing.id != (guardian.user_id or ''):
            return Response({'error': 'This email is already registered to a different account'}, status=status.HTTP_409_CONFLICT)

        if guardian.user_id:
            invited_user = guardian.user
        else:
            invited_user = User.objects.create_user(
                email=email,
                name=guardian.name,
                tenant=tenant,
                role='parent',
                email_verified=False,
            )
            invited_user.set_unusable_password()
            invited_user.save()
            guardian.user = invited_user
            guardian.save(update_fields=['user', 'updated_at'])

        token = secrets.token_urlsafe(32)
        PasswordResetToken.objects.create(
            token=token,
            user=invited_user,
            expires_at=timezone.now() + timedelta(days=7),
            used=False,
        )
        invite_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
        return Response({'guardian': GuardianSerializer(guardian).data, 'invite_url': invite_url})


class TeacherViewSet(TenantScopedViewSet):
    queryset = Teacher.objects.all()
    serializer_class = TeacherSerializer
    module_key = 'teachers'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(name_search_q(q, 'first_name', 'last_name', 'first_name_latin', 'last_name_latin', 'email'))
        queryset = queryset.order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset()).order_by('-created_at')
        headers = ['First Name', 'Last Name', 'First Name (Latin)', 'Last Name (Latin)', 'Email', 'Phone', 'Address', 'Subjects', 'Hourly Rate', 'Monthly Salary', 'Status', 'Hire Date']
        rows = [[
            t.first_name, t.last_name, t.first_name_latin or '', t.last_name_latin or '', t.email or '', t.phone or '', t.address or '',
            ', '.join(t.subjects) if t.subjects else '', t.hourly_rate, t.monthly_salary, t.status,
            t.hire_date.isoformat() if t.hire_date else '',
        ] for t in queryset]
        return export_rows(headers, rows, 'teachers', request.GET.get('type'))

    @action(detail=True, methods=['post'], url_path='photo')
    def upload_photo(self, request, pk=None):
        self.check_module_modify()
        teacher = self.get_object()
        tenant = Tenant.objects.filter(id=teacher.tenant_id).first()
        check_website_builder(request.user, tenant)
        if 'file' not in request.FILES:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        new_url = save_uploaded_image(request.FILES['file'], 'teachers', teacher.id)
        delete_uploaded_image(teacher.photo_url, 'teachers')
        teacher.photo_url = new_url
        teacher.save(update_fields=['photo_url', 'updated_at'])
        return Response(TeacherSerializer(teacher).data)

    @action(detail=True, methods=['post'], url_path='cv')
    def upload_cv(self, request, pk=None):
        self.check_module_modify()
        teacher = self.get_object()
        if 'file' not in request.FILES:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        new_url = save_uploaded_document(request.FILES['file'], 'documents', f'{teacher.id}-cv')
        delete_uploaded_image(teacher.cv_url, 'documents')
        teacher.cv_url = new_url
        teacher.save(update_fields=['cv_url', 'updated_at'])
        return Response(TeacherSerializer(teacher).data)

    @action(detail=True, methods=['post'], url_path='diploma')
    def upload_diploma(self, request, pk=None):
        self.check_module_modify()
        teacher = self.get_object()
        if 'file' not in request.FILES:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        new_url = save_uploaded_document(request.FILES['file'], 'documents', f'{teacher.id}-diploma')
        delete_uploaded_image(teacher.diploma_url, 'documents')
        teacher.diploma_url = new_url
        teacher.save(update_fields=['diploma_url', 'updated_at'])
        return Response(TeacherSerializer(teacher).data)

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        data = request.data.copy()
        # Auto hire date
        data['hire_date'] = timezone.now().date().isoformat()
        self._guard_percentage_edit(request, data)

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        self.check_module_modify()
        self._guard_percentage_edit(request, request.data)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self.check_module_modify()
        self._guard_percentage_edit(request, request.data)
        return super().partial_update(request, *args, **kwargs)

    def _guard_percentage_edit(self, request, data):
        """Teacher.payment_percentage decides real money owed at payout time,
        so unlike the rest of this form it isn't something a secretary's
        'edit' access to the Teachers tab should reach — only the workspace
        owner/director (or super admin) may set it. The Teacher Payments
        page is the only place the UI actually offers this field."""
        if 'payment_percentage' in data:
            user = request.user
            if not user.is_super_admin() and user.role not in ('owner', 'director'):
                raise PermissionDenied('Only the workspace owner or director can set teacher payment percentages.')
            try:
                pct = float(data['payment_percentage'])
            except (TypeError, ValueError):
                raise ValidationError('payment_percentage must be a number')
            if pct < 0 or pct > 100:
                raise ValidationError('payment_percentage must be between 0 and 100')

    @action(detail=True, methods=['post'])
    def invite(self, request, pk=None):
        user = request.user
        if not user.is_super_admin() and user.role not in ['owner', 'director', 'secretary']:
            raise PermissionDenied('Forbidden')

        tenant = Tenant.objects.filter(id=user.tenant_id).first()
        if not tenant:
            raise ValidationError('Tenant not found')

        teacher = self.get_object()
        if not teacher.email:
            return Response({'error': 'Add an email to this teacher before inviting them'}, status=status.HTTP_400_BAD_REQUEST)

        email = teacher.email.strip().lower()
        existing = User.objects.filter(email=email).first()
        if existing and existing.id != (teacher.user_id or ''):
            return Response({'error': 'This email is already registered to a different account'}, status=status.HTTP_409_CONFLICT)

        if teacher.user_id:
            invited_user = teacher.user
        else:
            invited_user = User.objects.create_user(
                email=email,
                name=f"{teacher.first_name} {teacher.last_name}".strip(),
                tenant=tenant,
                role='teacher',
                email_verified=False,
            )
            invited_user.set_unusable_password()
            invited_user.save()
            teacher.user = invited_user
            teacher.save(update_fields=['user', 'updated_at'])

        token = secrets.token_urlsafe(32)
        PasswordResetToken.objects.create(
            token=token,
            user=invited_user,
            expires_at=timezone.now() + timedelta(days=7),
            used=False,
        )
        invite_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
        return Response({'teacher': TeacherSerializer(teacher).data, 'invite_url': invite_url})


class StudentViewSet(TenantScopedViewSet):
    queryset = Student.objects.all()
    serializer_class = StudentSerializer
    module_key = 'students'
    module_view_exempt_actions = ['verify']

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        status_val = request.GET.get('status')
        if status_val:
            queryset = queryset.filter(status=status_val)
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(name_search_q(q, 'first_name', 'last_name', 'first_name_latin', 'last_name_latin', 'email', 'phone', 'student_code'))
        ids_param = request.GET.get('ids')
        if ids_param:
            queryset = queryset.filter(id__in=[i for i in ids_param.split(',') if i])
        # A picker searching a tenant with thousands of students only wants a
        # handful of matches, not the full 500-row cap this endpoint normally
        # allows — capped at that same 500 either way.
        try:
            limit = min(int(request.GET.get('limit', 500)), 500)
        except (TypeError, ValueError):
            limit = 500
        queryset = queryset.order_by('-created_at')[:limit]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset()).select_related('parent').order_by('-created_at')
        headers = [
            'Student Code', 'First Name', 'Last Name', 'First Name (Latin)', 'Last Name (Latin)', 'Gender', 'School Level', 'School Year', 'Specialty',
            'Insurance', 'Health Condition', 'Blood Type',
            'Birth Date', 'Email', 'Phone', 'Address',
            'Emergency Contact', 'Status', 'Parent Name', 'Parent Email', 'Parent Phone', 'Parent ID Card Number', 'Enrollment Date',
        ]
        rows = [[
            s.student_code or '', s.first_name, s.last_name, s.first_name_latin or '', s.last_name_latin or '', s.gender or '',
            s.school_level or '', s.school_year or '', s.specialty or '',
            s.insurance_status or '', s.health_condition or '', s.blood_type or '',
            s.birth_date.isoformat() if s.birth_date else '', s.email or '', s.phone or '', s.address or '',
            s.emergency_contact or '', s.status, s.parent.name if s.parent else '',
            s.parent.email if s.parent and s.parent.email else '', s.parent.phone if s.parent and s.parent.phone else '',
            s.parent.id_card_number if s.parent and s.parent.id_card_number else '',
            s.enrollment_date.date().isoformat() if s.enrollment_date else '',
        ] for s in queryset]
        return export_rows(headers, rows, 'students', request.GET.get('type'))

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        user = request.user
        tenant = Tenant.objects.filter(id=user.tenant_id).first()
        if not tenant:
            raise ValidationError('Tenant not found')

        count = Student.objects.filter(tenant_id=user.tenant_id).count()
        if tenant.max_students is not None and count >= tenant.max_students:
            raise PermissionDenied(f"Your {tenant.plan} plan allows up to {tenant.max_students} students. Upgrade your plan to add more.")
            
        student_code = f"{tenant.student_prefix or 'STU-'}{str(count + 1).zfill(5)}"
        
        data = request.data.copy()
        data['student_code'] = student_code
        data['enrollment_date'] = timezone.now().isoformat()
        
        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='import')
    def import_csv(self, request):
        self.check_module_add()
        user = request.user
        tenant = Tenant.objects.filter(id=user.tenant_id).first()
        if not tenant:
            raise ValidationError('Tenant not found')

        upload = request.FILES.get('file')
        if not upload:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > 2 * 1024 * 1024:
            return Response({'error': 'CSV must be under 2MB'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            reader = csv.DictReader(io.TextIOWrapper(upload.file, encoding='utf-8-sig'))
            rows = list(reader)
        except (UnicodeDecodeError, csv.Error):
            return Response({'error': 'Could not parse file as CSV (UTF-8 expected)'}, status=status.HTTP_400_BAD_REQUEST)

        if len(rows) > 1000:
            return Response({'error': 'CSV cannot have more than 1000 rows'}, status=status.HTTP_400_BAD_REQUEST)

        existing_count = Student.objects.filter(tenant_id=tenant.id).count()
        max_students = tenant.max_students
        created_count = 0
        failed = []

        for i, row in enumerate(rows, start=2):  # row 1 is the header
            first_name = (row.get('first_name') or '').strip()
            last_name = (row.get('last_name') or '').strip()
            if not first_name or not last_name:
                failed.append({'row': i, 'error': 'first_name and last_name are required'})
                continue

            if max_students is not None and existing_count + created_count >= max_students:
                failed.append({'row': i, 'error': f'Your {tenant.plan} plan allows up to {max_students} students'})
                continue

            school_level = (row.get('school_level') or '').strip().lower()
            if school_level and school_level not in ('primary', 'middle', 'high'):
                failed.append({'row': i, 'error': 'school_level must be primary, middle, or high'})
                continue

            school_year_raw = (row.get('school_year') or '').strip()
            school_year = None
            if school_year_raw:
                try:
                    school_year = int(school_year_raw)
                except ValueError:
                    failed.append({'row': i, 'error': 'school_year must be a number'})
                    continue

            insurance_status = (row.get('insurance_status') or '').strip().lower()
            if insurance_status and insurance_status not in ('insured', 'uninsured'):
                failed.append({'row': i, 'error': 'insurance_status must be insured or uninsured'})
                continue

            blood_type = (row.get('blood_type') or '').strip().upper()
            if blood_type and blood_type not in dict(Student.BLOOD_TYPE_CHOICES):
                failed.append({'row': i, 'error': 'blood_type must be one of O+, O-, A+, A-, B+, B-, AB+, AB-'})
                continue

            try:
                with transaction.atomic():
                    guardian = None
                    parent_email = (row.get('parent_email') or '').strip().lower()
                    if parent_email:
                        guardian, _ = Guardian.objects.get_or_create(
                            tenant=tenant, email=parent_email,
                            defaults={
                                'name': (row.get('parent_name') or parent_email).strip(),
                                'phone': (row.get('parent_phone') or '').strip(),
                                'id_card_number': (row.get('parent_id_card_number') or '').strip() or None,
                            },
                        )

                    student_code = f"{tenant.student_prefix or 'STU-'}{str(existing_count + created_count + 1).zfill(5)}"
                    Student.objects.create(
                        tenant=tenant,
                        parent=guardian,
                        first_name=first_name,
                        last_name=last_name,
                        email=(row.get('email') or '').strip() or None,
                        phone=(row.get('phone') or '').strip() or None,
                        gender=(row.get('gender') or '').strip() or None,
                        school_level=school_level or None,
                        school_year=school_year,
                        specialty=(row.get('specialty') or '').strip() or None,
                        insurance_status=insurance_status or None,
                        health_condition=(row.get('health_condition') or '').strip() or None,
                        blood_type=blood_type or None,
                        birth_date=(row.get('birth_date') or '').strip() or None,
                        address=(row.get('address') or '').strip() or None,
                        emergency_contact=(row.get('emergency_contact') or '').strip() or None,
                        student_code=student_code,
                        enrollment_date=timezone.now(),
                    )
                    created_count += 1
            except Exception as e:
                failed.append({'row': i, 'error': str(e)})

        return Response({'created': created_count, 'failed': failed, 'total': len(rows)})

    @action(detail=True, methods=['get'])
    def verify(self, request, pk=None):
        """Scanned-QR lookup for the teacher app: is this student enrolled
        here, and are they clear of overdue payments right now?"""
        student = self.get_object()

        has_overdue = Payment.objects.filter(
            tenant_id=student.tenant_id,
            student_id=student.id,
            status__in=['pending', 'partial'],
            due_date__lt=timezone.now().date(),
        ).exists()

        groups = Group.objects.filter(tenant_id=student.tenant_id, students=student, status='active')

        return Response({
            'id': student.id,
            'first_name': student.first_name,
            'last_name': student.last_name,
            'student_code': student.student_code,
            'photo_url': student.photo_url,
            'status': student.status,
            'paid': not has_overdue,
            'groups': [g.name for g in groups],
        })

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """A student self-enrolled via the public page (source='public')
        starts life as approval_status='pending' — a secretary reviews and
        confirms them here before they count as a normal record. Cascades to
        the parent guardian created in the same enrollment (only if it's
        still pending — never overwrites an explicit prior decision on the
        guardian), since they're two halves of one application."""
        self.check_module_modify()
        student = self.get_object()
        student.approval_status = 'approved'
        student.save(update_fields=['approval_status', 'updated_at'])
        if student.parent_id and student.parent.approval_status == 'pending':
            student.parent.approval_status = 'approved'
            student.parent.save(update_fields=['approval_status', 'updated_at'])
        log_activity(request, student.tenant_id, 'update', entity_type='students', entity_id=student.id,
                     description=f'Approved enrollment: {student.first_name} {student.last_name}')
        return Response(StudentSerializer(student).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        self.check_module_modify()
        student = self.get_object()
        student.approval_status = 'rejected'
        student.save(update_fields=['approval_status', 'updated_at'])
        if student.parent_id and student.parent.approval_status == 'pending':
            student.parent.approval_status = 'rejected'
            student.parent.save(update_fields=['approval_status', 'updated_at'])
        log_activity(request, student.tenant_id, 'update', entity_type='students', entity_id=student.id,
                     description=f'Rejected enrollment: {student.first_name} {student.last_name}')
        return Response(StudentSerializer(student).data)


class CourseViewSet(TenantScopedViewSet):
    queryset = Course.objects.all()
    serializer_class = CourseSerializer
    module_key = 'courses'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(
                Q(title__icontains=q) | Q(category__icontains=q)
            )
        queryset = queryset.order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='photo')
    def upload_photo(self, request, pk=None):
        self.check_module_modify()
        course = self.get_object()
        tenant = Tenant.objects.filter(id=course.tenant_id).first()
        check_website_builder(request.user, tenant)
        if 'file' not in request.FILES:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        new_url = save_uploaded_image(request.FILES['file'], 'courses', course.id)
        delete_uploaded_image(course.image_url, 'courses')
        course.image_url = new_url
        course.save(update_fields=['image_url', 'updated_at'])
        return Response(CourseSerializer(course).data)


class RoomViewSet(TenantScopedViewSet):
    queryset = Room.objects.all()
    serializer_class = RoomSerializer
    module_key = 'rooms'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset()).order_by('name')
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(Q(name__icontains=q) | Q(notes__icontains=q))

        rooms = list(queryset)

        # Optional occupancy check: does this room have a session overlapping
        # [from, to]? Defaults to "right now" so the Rooms page can show a
        # live free/occupied state without the caller passing a range.
        from_raw = request.GET.get('from')
        to_raw = request.GET.get('to')
        now = timezone.now()
        range_start = parse_datetime(from_raw) if from_raw else now
        range_end = parse_datetime(to_raw) if to_raw else (range_start + timedelta(minutes=1))
        if range_start and range_end:
            # room_ref__in=rooms is already tenant-scoped (rooms came from
            # get_queryset(), which filters by tenant) so no separate
            # tenant_id filter is needed here.
            occupied_sessions = ClassSession.objects.filter(
                room_ref__in=rooms,
                start_at__lt=range_end,
                end_at__gt=range_start,
            ).exclude(status='cancelled').select_related('group', 'course')
            by_room = {}
            for s in occupied_sessions:
                # Groups are frequently named the same across different
                # courses ("Groupe A" everywhere), so the room card needs the
                # same course/level disambiguation the group picker uses
                # elsewhere — school_level etc. ride along for the frontend
                # to build that label, same as it already does for groups.
                course = s.course
                by_room.setdefault(s.room_ref_id, []).append({
                    'session_id': s.id,
                    'group_name': s.group.name if s.group else None,
                    'course_title': course.title if course else None,
                    'school_level': course.school_level if course else None,
                    'school_year': course.school_year if course else None,
                    'specialty': course.specialty if course else None,
                    'start_at': s.start_at,
                    'end_at': s.end_at,
                })
        else:
            by_room = {}

        data = self.get_serializer(rooms, many=True).data
        for row in data:
            row['occupied'] = bool(by_room.get(row['id']))
            row['occupying_sessions'] = by_room.get(row['id'], [])
        return Response({'items': data, 'total': len(data)})


class TimetableEntryViewSet(TenantScopedViewSet):
    """The weekly timetable (استعمال الزمن) — a fixed grid that repeats all
    year, unlike ClassSession's dated occurrences. list() also returns the
    tenant's grid bounds (fixed 08:00 start, tenant-configurable end) so the
    frontend doesn't need a second request to know how many rows to draw."""
    queryset = TimetableEntry.objects.all()
    serializer_class = TimetableEntrySerializer
    module_key = 'timetable'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset()).order_by('day_of_week', 'start_time')
        data = self.get_serializer(queryset, many=True).data
        tenant = Tenant.objects.filter(id=request.user.tenant_id).first()
        return Response({
            'items': data,
            'total': len(data),
            'grid_start': '08:00',
            'grid_end': tenant.timetable_end_time.strftime('%H:%M') if tenant else '22:00',
        })

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        self.check_module_modify()
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self.check_module_delete()
        return super().destroy(request, *args, **kwargs)


class GroupViewSet(TenantScopedViewSet):
    queryset = Group.objects.all()
    serializer_class = GroupSerializer
    module_key = 'groups'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        course_id = request.GET.get('course_id')
        if course_id:
            queryset = queryset.filter(course_id=course_id)
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(
                Q(name__icontains=q) | Q(room__icontains=q) | Q(schedule__icontains=q)
            )
        # Prefetch students for efficient SerializerMethodField
        queryset = queryset.select_related('room_ref').prefetch_related('students').order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        data = request.data.copy()
        student_ids = data.pop('student_ids', None)

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        group = serializer.instance

        if student_ids:
            students = Student.objects.filter(id__in=student_ids, tenant_id=group.tenant_id)
            group.students.set(students)

        return Response(self.get_serializer(group).data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        self.check_module_modify()
        instance = self.get_object()
        data = request.data.copy()
        student_ids = data.pop('student_ids', None)

        partial = kwargs.pop('partial', False)
        serializer = self.get_serializer(instance, data=data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        if student_ids is not None:
            students = Student.objects.filter(id__in=student_ids, tenant_id=instance.tenant_id)
            instance.students.set(students)

        return Response(self.get_serializer(instance).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def enroll(self, request, pk=None):
        self.check_module_modify()
        student_id = request.data.get('student_id')
        if not student_id:
            return Response({'error': 'student_id is required'}, status=status.HTTP_400_BAD_REQUEST)
            
        group = self.get_object()
        student = Student.objects.filter(id=student_id, tenant_id=group.tenant_id).first()
        if not student:
            raise NotFound('Student not found')
            
        group.students.add(student)
        return Response(GroupSerializer(group).data)

    @action(detail=True, methods=['post'])
    def unenroll(self, request, pk=None):
        self.check_module_modify()
        student_id = request.data.get('student_id')
        if not student_id:
            return Response({'error': 'student_id is required'}, status=status.HTTP_400_BAD_REQUEST)
            
        group = self.get_object()
        student = Student.objects.filter(id=student_id, tenant_id=group.tenant_id).first()
        if not student:
            raise NotFound('Student not found')
            
        group.students.remove(student)
        return Response(GroupSerializer(group).data)


class TripViewSet(TenantScopedViewSet):
    queryset = Trip.objects.all()
    serializer_class = TripSerializer
    module_key = 'trips'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(Q(title__icontains=q) | Q(destination__icontains=q))
        queryset = queryset.prefetch_related('students').order_by('-trip_date', '-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        data = request.data.copy()
        student_ids = data.pop('student_ids', None)

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        trip = serializer.instance

        if student_ids:
            students = Student.objects.filter(id__in=student_ids, tenant_id=trip.tenant_id)
            trip.students.set(students)

        return Response(self.get_serializer(trip).data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        self.check_module_modify()
        instance = self.get_object()
        data = request.data.copy()
        student_ids = data.pop('student_ids', None)

        partial = kwargs.pop('partial', False)
        serializer = self.get_serializer(instance, data=data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        if student_ids is not None:
            students = Student.objects.filter(id__in=student_ids, tenant_id=instance.tenant_id)
            instance.students.set(students)

        return Response(self.get_serializer(instance).data, status=status.HTTP_200_OK)


class BookViewSet(TenantScopedViewSet):
    queryset = Book.objects.all()
    serializer_class = BookSerializer
    module_key = 'books'

    def get_queryset(self):
        # in_stock_count/sold_count on BookSerializer iterate obj.copies.all()
        # — prefetch here so a book list of N titles doesn't fire N queries.
        return super().get_queryset().prefetch_related('copies')

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(title__icontains=q)
        queryset = queryset.order_by('title')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    @action(detail=True, methods=['post'])
    def restock(self, request, pk=None):
        """Bulk-creates `quantity` new in-stock copies — adding inventory,
        so gated the same as creating any other new record."""
        self.check_module_add()
        book = self.get_object()
        try:
            quantity = int(request.data.get('quantity'))
        except (TypeError, ValueError):
            raise ValidationError('quantity must be an integer')
        if quantity < 1 or quantity > 1000:
            raise ValidationError('quantity must be between 1 and 1000')

        # Tenant-wide sequential counter (not per-title), same convention as
        # Student.student_code / Payment.invoice_number.
        existing_count = BookCopy.objects.filter(tenant_id=book.tenant_id).count()
        BookCopy.objects.bulk_create([
            BookCopy(tenant_id=book.tenant_id, book=book, copy_code=f"BK-{str(existing_count + i + 1).zfill(6)}")
            for i in range(quantity)
        ])
        log_activity(request, book.tenant_id, 'update', entity_type='books', entity_id=book.id,
                     description=f'Restocked {quantity} cop{"y" if quantity == 1 else "ies"} of "{book.title}"')
        # `book` carries a prefetched (now-stale) `copies` cache from
        # get_object() above — re-fetch a clean instance so in_stock_count/
        # sold_count reflect the copies just bulk-created.
        book = Book.objects.get(pk=book.pk)
        return Response(self.get_serializer(book).data)

    @action(detail=True, methods=['get'])
    def copies(self, request, pk=None):
        """Per-copy lookup — who bought copy X, when, and which staff member
        sold it. get_object() already enforces the module view-check via
        get_queryset()."""
        book = self.get_object()
        queryset = book.copies.select_related('sold_by')
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(copy_code__icontains=q)
        status_val = request.GET.get('status')
        if status_val in ('in_stock', 'sold'):
            queryset = queryset.filter(status=status_val)
        queryset = queryset.order_by('-created_at')[:500]
        serializer = BookCopySerializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})


class ClassSessionViewSet(TenantScopedViewSet):
    queryset = ClassSession.objects.all()
    serializer_class = ClassSessionSerializer
    module_key = 'sessions'

    def list(self, request, *args, **kwargs):
        # select_related keeps the serializer's group/course/teacher labels
        # from firing a query per row in the planner's month view.
        queryset = self.filter_queryset(self.get_queryset()).select_related('group', 'course', 'teacher', 'room_ref')
        group_id = request.GET.get('group_id')
        if group_id:
            queryset = queryset.filter(group_id=group_id)
            
        from_date = request.GET.get('from_date')
        if from_date:
            queryset = queryset.filter(start_at__gte=from_date)
            
        to_date = request.GET.get('to_date')
        if to_date:
            queryset = queryset.filter(start_at__lte=to_date)

        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(
                Q(topic__icontains=q) | Q(room__icontains=q)
            )

        queryset = queryset.order_by('start_at')[:1000]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        user = request.user
        group_id = request.data.get('group_id')
        if not group_id:
            return Response({'error': 'group_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        group = Group.objects.filter(id=group_id, tenant_id=user.tenant_id).first()
        if not group:
            raise NotFound('Group not found')

        data = request.data.copy()
        data['course_id'] = group.course_id

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='generate-recurring')
    def generate_recurring(self, request):
        self.check_module_add()
        user = request.user
        tenant = Tenant.objects.filter(id=user.tenant_id).first()
        if not tenant:
            raise ValidationError('Tenant not found')

        calendar_planner = bool(tenant.plan) and PLANS_CONFIG['tiers'][tenant.plan].get('calendar_planner', False)
        if not user.is_super_admin() and not calendar_planner:
            raise PermissionDenied('Recurring sessions are available on the Premium plan. Upgrade your plan to use them.')

        group_id = request.data.get('group_id')
        if not group_id:
            return Response({'error': 'group_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        group = Group.objects.filter(id=group_id, tenant_id=user.tenant_id).first()
        if not group:
            raise NotFound('Group not found')

        start_at = request.data.get('start_at')
        end_at = request.data.get('end_at')
        if not start_at or not end_at:
            return Response({'error': 'start_at and end_at are required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            weeks = int(request.data.get('weeks', 8))
        except (TypeError, ValueError):
            return Response({'error': 'weeks must be an integer'}, status=status.HTTP_400_BAD_REQUEST)
        if weeks < 1 or weeks > 12:
            return Response({'error': 'weeks must be between 1 and 12'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            start_dt = datetime.fromisoformat(start_at)
            end_dt = datetime.fromisoformat(end_at)
        except ValueError:
            return Response({'error': 'start_at/end_at must be ISO datetimes'}, status=status.HTTP_400_BAD_REQUEST)

        series_id = str(uuid.uuid4())
        created = []
        with transaction.atomic():
            for i in range(weeks):
                delta = timedelta(weeks=i)
                session = ClassSession.objects.create(
                    tenant_id=user.tenant_id,
                    group=group,
                    teacher_id=request.data.get('teacher_id'),
                    course_id=group.course_id,
                    room=request.data.get('room'),
                    start_at=start_dt + delta,
                    end_at=end_dt + delta,
                    topic=request.data.get('topic'),
                    series_id=series_id,
                )
                created.append(session)

        return Response({'items': ClassSessionSerializer(created, many=True).data, 'series_id': series_id})


class PaymentViewSet(TenantScopedViewSet):
    queryset = Payment.objects.all()
    serializer_class = PaymentSerializer
    module_key = 'payments'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        student_id = request.GET.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)
        status_val = request.GET.get('status')
        if status_val:
            queryset = queryset.filter(status=status_val)
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(
                Q(invoice_number__icontains=q) | Q(reference__icontains=q) | Q(notes__icontains=q)
            )
        balance_status = request.GET.get('balance_status')
        if balance_status in ('owes', 'overpaid', 'settled'):
            balances = compute_student_balances(request.user.tenant_id)
            matching_ids = [sid for sid, b in balances.items() if b['status'] == balance_status]
            queryset = queryset.filter(student_id__in=matching_ids)
        queryset = queryset.order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        user = request.user
        tenant = Tenant.objects.filter(id=user.tenant_id).first()
        if not tenant:
            raise ValidationError('Tenant not found')

        count = Payment.objects.filter(tenant_id=user.tenant_id).count()
        invoice_number = f"{tenant.invoice_prefix or 'INV-'}{str(count + 1).zfill(6)}"

        data = request.data.copy()
        data['invoice_number'] = invoice_number

        status_val = data.get('status', 'paid')
        if status_val == 'paid' and not data.get('paid_at'):
            data['paid_at'] = timezone.now().isoformat()

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            self.perform_create(serializer)
            payment = serializer.instance
            # A book sale doesn't let the caller pick which physical copy
            # goes out — lock and grab the next available one atomically so
            # two simultaneous sales of the last copy can't both succeed.
            if payment.book_id:
                copy = (
                    BookCopy.objects.select_for_update()
                    .filter(tenant_id=user.tenant_id, book_id=payment.book_id, status='in_stock')
                    .order_by('copy_code')
                    .first()
                )
                if not copy:
                    raise ValidationError({'book_id': 'This book is out of stock.'})
                copy.status = 'sold'
                copy.sold_by = user
                copy.sold_at = timezone.now()
                copy.save(update_fields=['status', 'sold_by', 'sold_at'])
                payment.book_copy = copy
                payment.save(update_fields=['book_copy'])

        return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payments_overdue(request):
    tid = require_staff_tenant(request.user)

    items = Payment.objects.filter(
        tenant_id=tid,
        status__in=['pending', 'partial'],
        due_date__lt=timezone.now().date(),
    ).order_by('due_date')[:500]

    total_data = Payment.objects.filter(
        tenant_id=tid,
        status__in=['pending', 'partial'],
        due_date__lt=timezone.now().date(),
    ).aggregate(total=Sum(F('amount') - F('discount')))

    return Response({
        'items': PaymentSerializer(items, many=True).data,
        'total': len(items),
        'total_owed': float(total_data['total'] or 0),
    })


BALANCE_THRESHOLD = 1.0  # DZD-scale rounding noise shouldn't read as owing/overpaid


def compute_student_balances(tenant_id):
    """Per-student running balance = money actually received (paid Payment
    rows) minus the cost of every session they've actually used (present or
    excused attendance, priced via course_per_session_price) — collection
    status is tracked by attendance, not by manually re-deriving what's
    "owed" from enrollment alone. Returns {student_id: {paid, cost, balance,
    status}}, status one of 'owes' (they owe the school), 'overpaid' (the
    school owes them), 'settled'.

    Cost is accumulated per (student, course) before being summed, because a
    'fixed_sessions' course's price is a flat total for the whole course —
    sessions_count is how many sessions that flat price covers, not a rate.
    A group that keeps running past its nominal session count (a make-up
    class, a term that overran by a week) must not silently keep inflating
    what that student owes for a course they already paid for in full, so a
    fixed_sessions course's cost is capped at its price. 'per_session' and
    'per_month' have no such cap — they're deliberately unit-rate and
    recurring, so cost is meant to keep pace with however much was actually
    attended."""
    attendance = Attendance.objects.filter(tenant_id=tenant_id, status__in=['present', 'excused'])

    sessions = ClassSession.objects.filter(tenant_id=tenant_id).values('id', 'course_id', 'group__course_id')
    session_course = {}
    course_ids = set()
    for s in sessions:
        course_id = s['course_id'] or s['group__course_id']
        session_course[s['id']] = course_id
        if course_id:
            course_ids.add(course_id)

    courses = {c['id']: c for c in Course.objects.filter(id__in=course_ids).values('id', 'price', 'pricing_type', 'sessions_count')}
    price_per_session = {
        cid: course_per_session_price(c['price'], c['pricing_type'], c['sessions_count'])
        for cid, c in courses.items()
    }

    cost_by_student_course = {}
    for a in attendance.values('student_id', 'session_id'):
        course_id = session_course.get(a['session_id'])
        if not course_id:
            continue
        key = (a['student_id'], course_id)
        cost_by_student_course[key] = cost_by_student_course.get(key, 0.0) + price_per_session.get(course_id, 0.0)

    cost = {}
    for (student_id, course_id), amount in cost_by_student_course.items():
        course = courses.get(course_id)
        if course and course['pricing_type'] == 'fixed_sessions':
            amount = min(amount, float(course['price'] or 0))
        cost[student_id] = cost.get(student_id, 0.0) + amount

    paid = {}
    payments = Payment.objects.filter(tenant_id=tenant_id, status='paid').values('student_id', 'amount', 'discount')
    for p in payments:
        paid[p['student_id']] = paid.get(p['student_id'], 0.0) + float(p['amount']) - float(p['discount'])

    balances = {}
    for student_id in set(cost) | set(paid):
        paid_amount = round(paid.get(student_id, 0.0), 2)
        cost_amount = round(cost.get(student_id, 0.0), 2)
        balance = round(paid_amount - cost_amount, 2)
        if balance > BALANCE_THRESHOLD:
            balance_status = 'overpaid'
        elif balance < -BALANCE_THRESHOLD:
            balance_status = 'owes'
        else:
            balance_status = 'settled'
        balances[student_id] = {'paid': paid_amount, 'cost': cost_amount, 'balance': balance, 'status': balance_status}
    return balances


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payments_balances(request):
    user = request.user
    tid = require_staff_tenant(user)
    # Shared by the Payments page (balance coloring/filter) and the standalone
    # Debts page — a user only granted one of those two modules must still be
    # able to load it, so this only blocks someone with neither.
    if not user.can_view('payments') and not user.can_view('debts'):
        raise PermissionDenied('Forbidden')

    balances = compute_student_balances(tid)
    students = Student.objects.filter(tenant_id=tid, id__in=balances.keys()).select_related('parent')
    rows = [{
        'student_id': s.id,
        'student_name': f'{s.first_name} {s.last_name}',
        'student_phone': s.phone,
        'parent_name': s.parent.name if s.parent else None,
        'parent_phone': s.parent.phone if s.parent else None,
        **balances[s.id],
    } for s in students]
    rows.sort(key=lambda r: r['balance'])
    return Response({'items': rows, 'total': len(rows)})


class GradeViewSet(TenantScopedViewSet):
    queryset = Grade.objects.all()
    serializer_class = GradeSerializer
    module_key = 'grades'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        student_id = request.GET.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)
        course_id = request.GET.get('course_id')
        if course_id:
            queryset = queryset.filter(course_id=course_id)
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(title__icontains=q)
        queryset = queryset.order_by('-date')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)


class QuizViewSet(TenantScopedViewSet):
    queryset = Quiz.objects.all()
    serializer_class = QuizSerializer
    module_key = 'quizzes'

    def _check_quiz_builder(self, tenant):
        quiz_builder = bool(tenant.plan) and PLANS_CONFIG['tiers'][tenant.plan].get('quiz_builder', False)
        if not self.request.user.is_super_admin() and not quiz_builder:
            raise PermissionDenied('The quiz builder is available on the Premium plan. Upgrade your plan to use it.')

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset()).order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        user = request.user
        tenant = Tenant.objects.filter(id=user.tenant_id).first()
        if not tenant:
            raise ValidationError('Tenant not found')
        self._check_quiz_builder(tenant)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        serializer.instance.created_by = user
        serializer.instance.save(update_fields=['created_by'])
        return Response(serializer.data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        self.check_module_modify()
        quiz = self.get_object()
        self._check_quiz_builder(quiz.tenant)
        return super().update(request, *args, **kwargs)

    @action(detail=True, methods=['post'], url_path='exercise')
    def exercise(self, request, pk=None):
        """Upload the exercise sheet students will answer — a photo or a PDF."""
        self.check_module_modify()
        quiz = self.get_object()
        self._check_quiz_builder(quiz.tenant)

        upload = request.FILES.get('file')
        if not upload:
            raise ValidationError('file is required')

        old_url = quiz.exercise_file_url
        quiz.exercise_file_url = save_uploaded_document(upload, 'quizzes', quiz.id)
        quiz.exercise_file_name = upload.name[:255]
        quiz.save(update_fields=['exercise_file_url', 'exercise_file_name', 'updated_at'])
        if old_url and old_url != quiz.exercise_file_url:
            delete_uploaded_image(old_url, 'quizzes')
        return Response(QuizSerializer(quiz).data)

    @action(detail=True, methods=['post'], url_path='grade')
    def grade(self, request, pk=None):
        """Score one submission by hand and mirror it into Grades. Re-grading
        updates the existing Grade row rather than stacking duplicates."""
        self.check_module_modify()
        quiz = self.get_object()
        self._check_quiz_builder(quiz.tenant)

        attempt = quiz.attempts.filter(id=request.data.get('attempt_id')).select_related('student').first()
        if not attempt:
            raise NotFound('Submission not found')

        try:
            score = float(request.data.get('score'))
        except (TypeError, ValueError):
            raise ValidationError('score must be a number')
        max_score = float(attempt.max_score or quiz.max_score or 20)
        if score < 0 or score > max_score:
            raise ValidationError(f'score must be between 0 and {max_score:g}')

        with transaction.atomic():
            attempt.score = score
            attempt.max_score = max_score
            attempt.feedback = (request.data.get('feedback') or '').strip() or None
            attempt.graded_at = timezone.now()
            attempt.save(update_fields=['score', 'max_score', 'feedback', 'graded_at'])

            if attempt.student_id:
                Grade.objects.update_or_create(
                    tenant_id=quiz.tenant_id,
                    student_id=attempt.student_id,
                    title=quiz.title,
                    defaults={
                        'course': quiz.course,
                        'score': score,
                        'max_score': max_score,
                        'date': timezone.now().date(),
                    },
                )
        return Response(QuizAttemptSerializer(attempt).data)

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        self.check_module_modify()
        quiz = self.get_object()
        self._check_quiz_builder(quiz.tenant)
        if not quiz.group_id:
            raise ValidationError('Assign a group to this quiz before publishing.')
        if not quiz.exercise_file_url:
            raise ValidationError('Upload the exercise (photo or PDF) before publishing.')

        # ONE shared link for the whole class — generated once and reused on
        # every re-publish, so a link already shared with students doesn't
        # go stale if the teacher swaps the exercise and republishes.
        if not quiz.public_token:
            quiz.public_token = secrets.token_urlsafe(24)
        quiz.status = 'published'
        quiz.save(update_fields=['status', 'public_token', 'updated_at'])

        frontend = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000').rstrip('/')
        return Response({
            'quiz': QuizSerializer(quiz).data,
            'take_url': f"{frontend}/quiz/take/{quiz.public_token}",
        })

    @action(detail=True, methods=['get'])
    def results(self, request, pk=None):
        quiz = self.get_object()
        attempts = quiz.attempts.select_related('student').prefetch_related('files').order_by('-created_at')
        return Response({'items': QuizAttemptSerializer(attempts, many=True).data})


class ConversationViewSet(TenantScopedViewSet):
    queryset = Conversation.objects.all()
    serializer_class = ConversationSerializer
    module_key = 'messages'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset()).select_related('guardian')
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(
                Q(guardian__name__icontains=q) | Q(guardian__email__icontains=q)
            )
        queryset = queryset.order_by('-last_message_at', '-created_at')[:200]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        user = request.user
        guardian = Guardian.objects.filter(id=request.data.get('guardian_id'), tenant_id=user.tenant_id).first()
        if not guardian:
            raise NotFound('Parent not found')

        convo, _ = Conversation.objects.get_or_create(tenant_id=user.tenant_id, guardian=guardian)
        return Response(self.get_serializer(convo).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'post'])
    def messages(self, request, pk=None):
        convo = self.get_object()

        if request.method == 'POST':
            self.check_module_add()
            body = (request.data.get('body') or '').strip()
            if not body:
                return Response({'error': 'Message body is required'}, status=status.HTTP_400_BAD_REQUEST)
            now = timezone.now()
            Message.objects.create(
                tenant_id=request.user.tenant_id, conversation=convo,
                sender_user=request.user, sender_role='staff', body=body,
            )
            convo.last_message_at = now
            convo.last_read_by_staff_at = now
            convo.save(update_fields=['last_message_at', 'last_read_by_staff_at', 'updated_at'])
        else:
            convo.last_read_by_staff_at = timezone.now()
            convo.save(update_fields=['last_read_by_staff_at', 'updated_at'])

        items = convo.messages.select_related('sender_user').order_by('created_at')[:500]
        return Response({'items': MessageSerializer(items, many=True).data, 'total': len(items)})


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

    tenants_list = []
    for t in tenants:
        t_data = TenantSerializer(t).data
        t_data['users_count'] = users_counts.get(t.id, 0)
        t_data['students_count'] = students_counts.get(t.id, 0)
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


@api_view(['DELETE', 'PATCH'])
@permission_classes([IsAuthenticated])
def gallery_photo_detail(request, tenant_id, photo_id):
    user = request.user
    if not user.is_super_admin() and tenant_id != user.tenant_id:
        raise PermissionDenied('Cannot edit another tenant')

    photo = SchoolGalleryPhoto.objects.filter(id=photo_id, tenant_id=tenant_id).first()
    if not photo:
        raise NotFound('Photo not found')

    if not user.is_super_admin() and user.role != 'owner':
        raise PermissionDenied('Forbidden')
    tenant = Tenant.objects.filter(id=tenant_id).first()
    check_website_builder(user, tenant)

    if request.method == 'DELETE':
        delete_uploaded_image(photo.image_url, 'gallery')
        photo.delete()
        return Response({'ok': True})

    # PATCH: edit caption, or swap `order` with an adjacent photo to reorder
    # (simple up/down buttons client-side — no drag-and-drop needed).
    if 'caption' in request.data:
        photo.caption = (request.data.get('caption') or '').strip() or None
        photo.save(update_fields=['caption'])
    swap_with = request.data.get('swap_with_id')
    if swap_with:
        other = SchoolGalleryPhoto.objects.filter(id=swap_with, tenant_id=tenant_id).first()
        if other:
            photo.order, other.order = other.order, photo.order
            photo.save(update_fields=['order'])
            other.save(update_fields=['order'])

    return Response(SchoolGalleryPhotoSerializer(photo).data)


def _tenant_owns_upload(user, url):
    """True when a record in the requesting user's own tenant references this
    exact stored path. Filenames carry ~72 bits of entropy, but an unguessable
    URL is still a bearer credential that leaks through referrers, history and
    shared screenshots — so private files are checked against real ownership,
    not just knowledge of the link."""
    tenant_id = getattr(user, 'tenant_id', None)
    if not tenant_id:
        return False
    if Teacher.objects.filter(tenant_id=tenant_id).filter(Q(cv_url=url) | Q(diploma_url=url)).exists():
        return True
    if Attendance.objects.filter(tenant_id=tenant_id, excuse_document_url=url).exists():
        return True
    if QuizSubmissionFile.objects.filter(tenant_id=tenant_id, file_url=url).exists():
        return True
    return False


# Serves uploaded tenant/teacher/course/gallery images directly. Runs through
# @api_view so DRF's Bearer authentication populates request.user — the
# private-subdir check below depends on it, and a plain Django view would only
# ever see AnonymousUser.
@api_view(['GET'])
@permission_classes([AllowAny])
def serve_upload(request, subdir, filename):
    if subdir not in UPLOAD_SUBDIRS:
        raise Http404("Not found")

    if subdir in PRIVATE_UPLOAD_SUBDIRS:
        user = request.user
        if not getattr(user, 'is_authenticated', False):
            raise NotAuthenticated('Authentication required')
        if user.role == 'parent':
            raise Http404("Not found")
        if not user.is_super_admin() and not _tenant_owns_upload(user, f'/uploads/{subdir}/{filename}'):
            # 404, not 403 — a wrong answer here would confirm the file exists.
            raise Http404("Not found")

    file_path = os.path.join(settings.MEDIA_ROOT, subdir, filename)
    if not os.path.isfile(file_path):
        raise Http404("Not found")

    content_type, _ = mimetypes.guess_type(file_path)
    if not content_type:
        content_type = 'application/octet-stream'

    return FileResponse(open(file_path, 'rb'), content_type=content_type)


# Serves the built React SPA for any non-API route, so a single WSGI app
# (Django) can host the whole site — used on hosts like PythonAnywhere where
# running two separate always-on processes isn't available on the free tier.
# Local dev doesn't hit this at all (the frontend runs on its own dev server).
@api_view(['GET'])
@permission_classes([AllowAny])
def serve_frontend(request, path=''):
    index_path = os.path.join(settings.FRONTEND_BUILD_DIR, 'index.html')
    if not os.path.isfile(index_path):
        raise Http404(
            "Frontend build not found — run `npm run build` in frontend/ "
            "and make sure frontend/build/ exists next to django-backend/."
        )
    return FileResponse(open(index_path, 'rb'), content_type='text/html')


# ---------------------------------------------------------------- Expenses

def ensure_default_expense_categories(tenant_id):
    """Seed DEFAULT_EXPENSE_CATEGORIES the first time a tenant touches
    expenses, and backfill any keys added to that list later (e.g. 'trip')
    that this tenant never had. Only ever adds keys the tenant has literally
    never seen — it can't resurrect one a tenant deliberately deleted, since
    that would require the key to have existed in DEFAULT_EXPENSE_CATEGORIES
    at some point before this tenant was seeded, then been removed here."""
    existing_keys = set(
        ExpenseCategory.objects.filter(tenant_id=tenant_id, key__isnull=False).values_list('key', flat=True)
    )
    missing = [key for key in DEFAULT_EXPENSE_CATEGORIES if key not in existing_keys]
    if missing:
        ExpenseCategory.objects.bulk_create([
            ExpenseCategory(tenant_id=tenant_id, key=key) for key in missing
        ])


class ExpenseCategoryViewSet(TenantScopedViewSet):
    queryset = ExpenseCategory.objects.all()
    serializer_class = ExpenseCategorySerializer
    module_key = 'expenses'

    def list(self, request, *args, **kwargs):
        ensure_default_expense_categories(request.user.tenant_id)
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        name = (request.data.get('name') or '').strip()
        if not name:
            raise ValidationError('name is required')
        category = ExpenseCategory.objects.create(tenant_id=request.user.tenant_id, name=name)
        log_activity(request, request.user.tenant_id, 'create', entity_type='expense_category',
                     entity_id=category.id, description=f'Added expense category "{name}"')
        return Response(ExpenseCategorySerializer(category).data)

    def destroy(self, request, *args, **kwargs):
        self.check_module_delete()
        category = self.get_object()
        log_activity(request, request.user.tenant_id, 'delete', entity_type='expense_category',
                     entity_id=category.id, description=f'Deleted expense category "{category.key or category.name}"')
        return super().destroy(request, *args, **kwargs)


class ExpenseViewSet(TenantScopedViewSet):
    queryset = Expense.objects.all()
    serializer_class = ExpenseSerializer
    module_key = 'expenses'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset()).select_related('category')
        queryset = filter_by_date_range(queryset, request, 'spent_at')
        category_id = request.GET.get('category_id')
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(Q(title__icontains=q) | Q(notes__icontains=q))
        queryset = queryset.order_by('-spent_at', '-created_at')[:1000]
        serializer = self.get_serializer(queryset, many=True)
        total = sum(float(e.amount) for e in queryset)
        return Response({'items': serializer.data, 'total': len(serializer.data), 'total_amount': total})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        response = super().create(request, *args, **kwargs)
        log_activity(request, request.user.tenant_id, 'create', entity_type='expense',
                     entity_id=response.data.get('id'),
                     description=f"Recorded expense {response.data.get('title')} ({response.data.get('amount')})")
        return response

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset()).select_related('category')
        queryset = filter_by_date_range(queryset, request, 'spent_at').order_by('-spent_at')
        headers = ['Date', 'Title', 'Category', 'Amount', 'Method', 'Notes']
        rows = [[
            e.spent_at.isoformat() if e.spent_at else '', e.title,
            e.category.key or e.category.name if e.category else '',
            float(e.amount), e.method, e.notes or '',
        ] for e in queryset]
        return export_rows(headers, rows, 'expenses', request.GET.get('type'))


# ------------------------------------------------------- Teacher payments

def filter_by_date_range(queryset, request, field):
    """Shared ?from=YYYY-MM-DD&to=YYYY-MM-DD filter used by expenses,
    teacher payments and reports."""
    date_from = request.GET.get('from')
    date_to = request.GET.get('to')
    if date_from:
        queryset = queryset.filter(**{f'{field}__gte': date_from})
    if date_to:
        queryset = queryset.filter(**{f'{field}__lte': date_to})
    return queryset


def compute_teacher_earned_total(tenant_id, date_from=None, date_to=None):
    """Sum of every teacher's earned share (percentage x per-session price,
    for every present attendance) in an optional date window — the slice of
    collected revenue that belongs to teachers, not the school. A lighter
    sibling of compute_teacher_earnings(): no per-teacher breakdown, no
    already-paid-out figure, just the one number the dashboard and revenue
    trend need to net revenue down to what the institution actually keeps.
    Takes explicit dates rather than a request, since the dashboard has no
    ?from=/?to= of its own to read via filter_by_date_range."""
    attendance = Attendance.objects.filter(tenant_id=tenant_id, status='present')
    if date_from:
        attendance = attendance.filter(session__start_at__date__gte=date_from)
    if date_to:
        attendance = attendance.filter(session__start_at__date__lte=date_to)

    sessions = ClassSession.objects.filter(tenant_id=tenant_id).values(
        'id', 'teacher_id', 'group__teacher_id', 'course_id', 'group__course_id',
    )
    session_info = {}
    course_ids = set()
    for s in sessions:
        course_id = s['course_id'] or s['group__course_id']
        session_info[s['id']] = {'teacher_id': s['teacher_id'] or s['group__teacher_id'], 'course_id': course_id}
        if course_id:
            course_ids.add(course_id)

    price_per_session = {
        c['id']: course_per_session_price(c['price'], c['pricing_type'], c['sessions_count'])
        for c in Course.objects.filter(id__in=course_ids).values('id', 'price', 'pricing_type', 'sessions_count')
    }
    teacher_pct = dict(Teacher.objects.filter(tenant_id=tenant_id).values_list('id', 'payment_percentage'))

    total = 0.0
    for a in attendance.values('session_id'):
        info = session_info.get(a['session_id'])
        if not info or not info['teacher_id']:
            continue
        pct = float(teacher_pct.get(info['teacher_id']) or 0)
        total += price_per_session.get(info['course_id'], 0.0) * pct / 100
    return round(total, 2)


def compute_teacher_earnings(tenant_id, request):
    """What each teacher has earned = their percentage of the per-session
    value of every present-student attendance record across their sessions,
    minus what's already been paid out. A course's per-session value comes
    from course_per_session_price() — so for each present student, the
    teacher earns percentage% of that course's per-session price.

    Driven by attendance rather than payments: a teacher is owed for
    students who actually showed up and were taught, regardless of whether
    that student's invoice has been settled yet — collection is the
    school's problem, not something that should delay a teacher's pay."""
    teachers = Teacher.objects.filter(tenant_id=tenant_id).order_by('first_name', 'last_name')
    teacher_id = request.GET.get('teacher_id')
    if teacher_id:
        teachers = teachers.filter(id=teacher_id)

    attendance = Attendance.objects.filter(tenant_id=tenant_id, status='present').select_related('session')
    attendance = filter_by_date_range(attendance, request, 'session__start_at__date')
    group_id = request.GET.get('group_id')
    if group_id:
        attendance = attendance.filter(session__group_id=group_id)

    # session -> (teacher, course), resolved once so we don't hit the DB per
    # attendance row. Teacher falls back to the session's own teacher_id when
    # set (a substitute covering someone else's group), else the group's
    # regular teacher; course similarly falls back to the group's course.
    sessions = ClassSession.objects.filter(tenant_id=tenant_id).values(
        'id', 'teacher_id', 'group__teacher_id', 'course_id', 'group__course_id',
    )
    session_info = {}
    course_ids = set()
    for s in sessions:
        course_id = s['course_id'] or s['group__course_id']
        session_info[s['id']] = {
            'teacher_id': s['teacher_id'] or s['group__teacher_id'],
            'course_id': course_id,
        }
        if course_id:
            course_ids.add(course_id)

    # Per-session price for each course, computed once.
    price_per_session = {}
    for c in Course.objects.filter(id__in=course_ids).values('id', 'price', 'pricing_type', 'sessions_count'):
        price_per_session[c['id']] = course_per_session_price(c['price'], c['pricing_type'], c['sessions_count'])

    present_count = {}
    base_value = {}
    for a in attendance:
        info = session_info.get(a.session_id)
        tid = info['teacher_id'] if info else None
        if not tid:
            continue
        present_count[tid] = present_count.get(tid, 0) + 1
        base_value[tid] = base_value.get(tid, 0.0) + price_per_session.get(info['course_id'], 0.0)

    payouts = TeacherPayout.objects.filter(tenant_id=tenant_id)
    payouts = filter_by_date_range(payouts, request, 'paid_at')
    paid_out = {}
    for po in payouts:
        paid_out[po.teacher_id] = paid_out.get(po.teacher_id, 0.0) + float(po.amount)

    rows = []
    for t in teachers:
        count = present_count.get(t.id, 0)
        pct = float(t.payment_percentage or 0)
        earned = round(base_value.get(t.id, 0.0) * pct / 100, 2)
        already = round(paid_out.get(t.id, 0.0), 2)
        rows.append({
            'teacher_id': t.id,
            'teacher_name': f'{t.first_name} {t.last_name}',
            'percentage': pct,
            'present_count': count,
            'earned': earned,
            'paid_out': already,
            'balance': round(earned - already, 2),
        })
    return rows


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def teacher_payments_summary(request):
    user = request.user
    if not user.tenant_id:
        raise PermissionDenied('User has no tenant')
    if not user.can_view('teacher_payments'):
        raise PermissionDenied('Forbidden')

    rows = compute_teacher_earnings(user.tenant_id, request)
    if request.GET.get('type') in ('csv', 'xlsx'):
        headers = ['Teacher', 'Percentage', 'Present count', 'Earned', 'Paid out', 'Balance']
        return export_rows(
            headers,
            [[r['teacher_name'], r['percentage'], r['present_count'], r['earned'], r['paid_out'], r['balance']] for r in rows],
            'teacher-payments', request.GET.get('type'),
        )
    return Response({
        'items': rows,
        'totals': {
            'present_count': sum(r['present_count'] for r in rows),
            'earned': round(sum(r['earned'] for r in rows), 2),
            'paid_out': round(sum(r['paid_out'] for r in rows), 2),
            'balance': round(sum(r['balance'] for r in rows), 2),
        },
    })


class TeacherPayoutViewSet(TenantScopedViewSet):
    queryset = TeacherPayout.objects.all()
    serializer_class = TeacherPayoutSerializer
    module_key = 'teacher_payments'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset()).select_related('teacher')
        queryset = filter_by_date_range(queryset, request, 'paid_at')
        teacher_id = request.GET.get('teacher_id')
        if teacher_id:
            queryset = queryset.filter(teacher_id=teacher_id)
        queryset = queryset.order_by('-paid_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        response = super().create(request, *args, **kwargs)
        log_activity(request, request.user.tenant_id, 'create', entity_type='teacher_payout',
                     entity_id=response.data.get('id'),
                     description=f"Paid teacher {response.data.get('teacher_name')} {response.data.get('amount')}")
        return response


# ------------------------------------------------------------ Activity log

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def activity_logs(request):
    user = request.user
    if not user.tenant_id:
        raise PermissionDenied('User has no tenant')
    if not user.can_view('logs'):
        raise PermissionDenied('Forbidden')

    logs = ActivityLog.objects.filter(tenant_id=user.tenant_id)
    category = request.GET.get('category')
    if category:
        logs = logs.filter(category=category)
    log_user = request.GET.get('user_id')
    if log_user:
        logs = logs.filter(user_id=log_user)
    q = request.GET.get('q')
    if q:
        logs = logs.filter(
            Q(description__icontains=q) | Q(user_label__icontains=q) | Q(action__icontains=q)
        )
    date_from = request.GET.get('from')
    date_to = request.GET.get('to')
    if date_from:
        logs = logs.filter(created_at__date__gte=date_from)
    if date_to:
        logs = logs.filter(created_at__date__lte=date_to)

    logs = logs.order_by('-created_at')[:500]
    if request.GET.get('type') in ('csv', 'xlsx'):
        headers = ['When', 'User', 'Category', 'Action', 'Entity', 'Description', 'IP']
        rows = [[
            l.created_at.strftime('%Y-%m-%d %H:%M:%S'), l.user_label or '', l.category,
            l.action, l.entity_type or '', l.description or '', l.ip_address or '',
        ] for l in logs]
        return export_rows(headers, rows, 'activity-logs', request.GET.get('type'))
    return Response({'items': ActivityLogSerializer(logs, many=True).data, 'total': len(logs)})


# ------------------------------------------------------------ Finance report

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def finance_report(request):
    """Payments + expenses + net for a date range, optionally narrowed to one
    group or teacher. Backs the Reports page and its Excel export."""
    user = request.user
    tid = require_staff_tenant(user)
    if not user.can_view('reports'):
        raise PermissionDenied('Forbidden')

    payments = Payment.objects.filter(tenant_id=tid).select_related('student', 'group', 'course')
    payments = filter_by_date_range(payments, request, 'due_date')
    group_id = request.GET.get('group_id')
    if group_id:
        payments = payments.filter(group_id=group_id)
    teacher_id = request.GET.get('teacher_id')
    if teacher_id:
        payments = payments.filter(group__teacher_id=teacher_id)

    paid = [p for p in payments if p.status == 'paid']
    outstanding = [p for p in payments if p.status in ('pending', 'partial')]
    collected = round(sum(float(p.amount) - float(p.discount or 0) for p in paid), 2)
    pending_amount = round(sum(float(p.amount) - float(p.discount or 0) for p in outstanding), 2)

    expenses = Expense.objects.filter(tenant_id=tid).select_related('category')
    expenses = filter_by_date_range(expenses, request, 'spent_at')
    # An expense belongs to the school as a whole, not to a group or teacher,
    # so narrowing by those would silently mix a filtered income figure with
    # an unfiltered cost one. Report zero instead of a misleading net.
    scoped_to_subset = bool(group_id or teacher_id)
    expense_total = 0.0 if scoped_to_subset else round(sum(float(e.amount) for e in expenses), 2)

    by_category = {}
    if not scoped_to_subset:
        for e in expenses:
            label = (e.category.key or e.category.name) if e.category else 'uncategorized'
            by_category[label] = round(by_category.get(label, 0.0) + float(e.amount), 2)

    teacher_rows = compute_teacher_earnings(tid, request)
    teacher_total = round(sum(r['earned'] for r in teacher_rows), 2)

    # Every individual money movement in the window — every payment
    # (whatever its status) plus every expense — so the tenant can see
    # exactly what happened, not just the totals. Expenses are left out
    # when scoped to a group/teacher for the same reason expense_total is
    # zeroed above: they aren't scoped that way, so including them here
    # would misleadingly suggest they belong to that subset.
    transactions = []
    for p in payments:
        transactions.append({
            'date': (p.paid_at.isoformat() if p.paid_at else None) or (p.due_date.isoformat() if p.due_date else None),
            'type': 'revenue',
            'kind': p.kind,
            'status': p.status,
            'description': f'{p.student.first_name} {p.student.last_name}' if p.student else p.invoice_number,
            'reference': p.invoice_number,
            'amount': round(float(p.amount) - float(p.discount or 0), 2),
        })
    if not scoped_to_subset:
        for e in expenses:
            transactions.append({
                'date': e.spent_at.isoformat() if e.spent_at else None,
                'type': 'expense',
                'kind': (e.category.key or e.category.name) if e.category else 'uncategorized',
                'status': None,
                'description': e.title,
                'reference': None,
                'amount': round(float(e.amount), 2),
            })
    transactions.sort(key=lambda t: t['date'] or '', reverse=True)

    if request.GET.get('type') in ('csv', 'xlsx'):
        headers = ['Metric', 'Amount', 'Kind', 'Status', 'Description', 'Reference']
        rows = [
            ['Collected', collected, '', '', '', ''],
            ['Outstanding', pending_amount, '', '', '', ''],
            ['Expenses', expense_total, '', '', '', ''],
            ['Teacher earnings', teacher_total, '', '', '', ''],
            ['Net', round(collected - expense_total - teacher_total, 2), '', '', '', ''],
        ] + [[f'Expenses — {k}', v, '', '', '', ''] for k, v in sorted(by_category.items())]
        rows.append(['', '', '', '', '', ''])
        rows.append(['Transactions', 'Amount', 'Kind', 'Status', 'Description', 'Reference'])
        rows += [[
            t['date'] or '', t['amount'], f"{t['type']}: {t['kind']}", t['status'] or '', t['description'], t['reference'] or '',
        ] for t in transactions]
        return export_rows(headers, rows, 'financial-report', request.GET.get('type'))

    return Response({
        'collected': collected,
        'outstanding': pending_amount,
        'expenses': expense_total,
        'expenses_by_category': by_category,
        'teacher_earnings': teacher_total,
        'net': round(collected - expense_total - teacher_total, 2),
        'payments_count': len(paid),
        'expenses_scoped_out': scoped_to_subset,
        'teachers': teacher_rows,
        'transactions': transactions,
    })
