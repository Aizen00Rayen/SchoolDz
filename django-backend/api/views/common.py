"""Shared helpers, constants and the tenant-scoped base ViewSet."""
import csv
import io
import os
from datetime import time
import hashlib
import secrets
import openpyxl
from PIL import Image, ImageOps
from datetime import datetime
from django.conf import settings
from django.db import models
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied
import logging
from ..models import (
    Tenant,
    User,
    PasswordResetToken,
    ClassSession,
    Payment,
    ChargilyCheckout,
    Coupon,
    TeacherPayout,
    STAFF_ROLES,
    StudentInsurance,
)
from ..services import log_activity

# Keep the original logger name so existing log config/filters still match.
logger = logging.getLogger('api.views')


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
            'annual': 89000,
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
    if not tenant_id and user.is_super_admin():
        first_tenant = Tenant.objects.first()
        if first_tenant:
            tenant_id = first_tenant.id
    if not tenant_id:
        raise PermissionDenied('User has no tenant')
    if not user.is_super_admin() and user.role not in STAFF_ROLES:
        raise PermissionDenied('Forbidden')
    # Same lockout TenantScopedViewSet.get_queryset() applies: staff of a
    # suspended/expired/unpaid workspace must not keep reading or changing
    # its data through the function-based endpoints either.
    if not user.is_super_admin():
        tenant = user.tenant
        if tenant is None or tenant.status != 'active':
            raise PermissionDenied(_inactive_tenant_message(tenant))
    return tenant_id


def _inactive_tenant_message(tenant):
    """`suspended` is a moderation decision (only a super-admin can lift it)
    — telling that user to "complete billing" is actively misleading, since
    paying wouldn't fix anything. `pending_payment`/`expired` genuinely are
    billing issues, so they keep the original message."""
    if tenant and tenant.status == 'suspended':
        return 'This workspace has been suspended. Contact support to resolve this.'
    return 'This workspace is not active yet — complete billing to continue.'


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


_FORMULA_PREFIXES = ('=', '+', '-', '@', '\t', '\r')


def _safe_cell(value):
    """Text that starts like a formula (=, +, -, @) is run as one by Excel /
    LibreOffice when the export is opened. Names and notes can come from the
    public enrollment form, so such text is prefixed with a quote to keep it
    plain text. Numbers are left alone."""
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


def export_rows(headers, rows, filename, fmt):
    """Builds a downloadable CSV or XLSX response from a header row + data rows."""
    fmt = (fmt or 'csv').lower()
    if fmt not in ('csv', 'xlsx'):
        raise ValidationError('format must be csv or xlsx')
    rows = [[_safe_cell(v) for v in row] for row in rows]

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
    'pardoned': 'معفى',
    'pardonned': 'معفى',
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
    'insurance': 'تأمين',
    'other': 'آخر',
    'mixed': 'عدة عناصر',
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


# Same set/wording as expense_category.* in the frontend's i18n.jsx — backs
# the printed monthly finance report's expense-by-category breakdown.
EXPENSE_CATEGORY_AR = {
    'rent': 'الإيجار',
    'salaries': 'الأجور',
    'utilities': 'الماء والكهرباء',
    'supplies': 'اللوازم',
    'maintenance': 'الصيانة',
    'marketing': 'التسويق',
    'transport': 'النقل',
    'taxes': 'الضرائب',
    'equipment': 'التجهيزات',
    'trip': 'رحلة مدرسية',
    'other': 'أخرى',
    'uncategorized': 'بدون فئة',
}


OTHER_INCOME_CATEGORY_AR = {
    'printing': 'طباعة ونسخ وثائق',
    'canteen': 'مقصف ومشروبات',
    'supplies': 'أدوات ولوازم مدرسية',
    'room_rental': 'تأجير قاعات',
    'badges': 'بطاقات وأوشحة',
    'registration_fees': 'رسوم تسجيل وملفات',
    'other': 'أخرى',
    'uncategorized': 'بدون فئة',
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
            raise PermissionDenied(_inactive_tenant_message(user.tenant))

        return queryset.filter(tenant_id=user.tenant_id)

    def _entity_label(self, instance):
        """Best-effort human-readable name for the activity log line — most
        models here have one of these fields. Payment/ClassSession/
        TeacherPayout have none of them, so without a model-specific
        fallback they fell through to a raw, meaningless UUID (the log line
        literally said "Added payments: e5bcebec-70f4-...")."""
        if isinstance(instance, Payment):
            who = f"{instance.student.first_name} {instance.student.last_name}" if instance.student_id else None
            return instance.invoice_number or who or str(instance.pk)
        if isinstance(instance, ClassSession):
            if instance.topic:
                return instance.topic
            group_name = instance.group.name if instance.group_id else None
            when = instance.start_at.strftime('%Y-%m-%d %H:%M') if instance.start_at else ''
            return f"{group_name or 'session'} {when}".strip()
        if isinstance(instance, TeacherPayout):
            teacher_name = f"{instance.teacher.first_name} {instance.teacher.last_name}" if instance.teacher_id else 'teacher'
            return f"{teacher_name} ({instance.amount})"
        if isinstance(instance, StudentInsurance):
            st = instance.student
            student_name = f"{st.first_name} {st.last_name}" if st else 'student'
            return f"{student_name} ({instance.amount})"
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
                raise PermissionDenied(_inactive_tenant_message(user.tenant))
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


def _next_sequence_code(tenant_id, model, field, prefix, width):
    """Race-reduced, deletion-proof next sequential code (invoice_number,
    student_code, copy_code) for a tenant. Previously derived from a live
    row COUNT, which silently reuses an already-issued number as soon as
    any earlier row is deleted (Payment/Student/BookCopy can all be
    hard-deleted) — several payments in production ended up sharing one
    invoice_number this way. Deriving it from the MAX numeric suffix among
    codes that still exist is immune to deletions: a deleted row's number
    is never picked again unless it happened to be the single highest one,
    in which case reusing it is correct (nothing else holds it). Callers
    must run this inside the same transaction.atomic() block as the row's
    own creation, right after locking the tenant row with
    select_for_update(), so two concurrent requests can't both compute the
    same number before either commits."""
    max_n = 0
    for code in model.objects.filter(tenant_id=tenant_id).values_list(field, flat=True):
        if not code or not code.startswith(prefix):
            continue
        suffix = code[len(prefix):]
        if suffix.isdigit():
            max_n = max(max_n, int(suffix))
    return f"{prefix}{str(max_n + 1).zfill(width)}"


# ------------------------------------------------------- Teacher payments

def filter_by_date_range(queryset, request, field):
    """Shared ?from=YYYY-MM-DD&to=YYYY-MM-DD filter used by expenses,
    teacher payments and reports."""
    date_from = request.GET.get('from')
    date_to = request.GET.get('to')
    model = getattr(queryset, 'model', None)
    is_datetime = False
    if model:
        try:
            model_field = model._meta.get_field(field)
            is_datetime = isinstance(model_field, models.DateTimeField)
        except Exception:
            is_datetime = False

    if is_datetime:
        if date_from:
            try:
                d_from = parse_date(date_from[:10]) if isinstance(date_from, str) else date_from
                if d_from:
                    dt_from = timezone.make_aware(datetime.combine(d_from, time.min)) if settings.USE_TZ else datetime.combine(d_from, time.min)
                    queryset = queryset.filter(**{f'{field}__gte': dt_from})
                else:
                    queryset = queryset.filter(**{f'{field}__gte': date_from})
            except Exception:
                queryset = queryset.filter(**{f'{field}__gte': date_from})
        if date_to:
            try:
                d_to = parse_date(date_to[:10]) if isinstance(date_to, str) else date_to
                if d_to:
                    dt_to = timezone.make_aware(datetime.combine(d_to, time.max)) if settings.USE_TZ else datetime.combine(d_to, time.max)
                    queryset = queryset.filter(**{f'{field}__lte': dt_to})
                else:
                    queryset = queryset.filter(**{f'{field}__lte': date_to})
            except Exception:
                queryset = queryset.filter(**{f'{field}__lte': date_to})
    else:
        lookup_from = f'{field}__gte'
        lookup_to = f'{field}__lte'
        if date_from:
            queryset = queryset.filter(**{lookup_from: date_from})
        if date_to:
            queryset = queryset.filter(**{lookup_to: date_to})
    return queryset


def password_policy_error(password, email=None, name=None):
    """Runs Django's AUTH_PASSWORD_VALIDATORS (length, common passwords,
    all-numeric, too similar to the email/name). Returns a readable error
    string, or None when the password is acceptable. Used everywhere a
    password is chosen: sign-up, staff accounts, enrollment and reset."""
    from django.contrib.auth.password_validation import validate_password
    from django.core.exceptions import ValidationError as DjangoValidationError
    if not isinstance(password, str) or not password:
        return 'Password is required'
    if len(password) > 128:
        return 'Password must be at most 128 characters'
    probe = User(email=email or '', name=name or '')
    try:
        validate_password(password, user=probe)
    except DjangoValidationError as exc:
        return ' '.join(exc.messages)
    return None


def _hash_reset_token(raw):
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def issue_reset_token(user, lifetime):
    """Creates a password-reset / invite token. Only a SHA-256 hash is stored,
    so a leaked database backup can't be used to take over accounts. Returns
    the raw token for the link."""
    raw = secrets.token_urlsafe(32)
    PasswordResetToken.objects.create(
        token=_hash_reset_token(raw), user=user,
        expires_at=timezone.now() + lifetime, used=False,
    )
    return raw


def find_reset_token(raw):
    """Looks a raw token up by its hash. Falls back to a plain match so
    invite links issued before tokens were hashed keep working until they
    expire."""
    if not raw or not isinstance(raw, str):
        return None
    return (PasswordResetToken.objects.filter(token=_hash_reset_token(raw)).first()
            or PasswordResetToken.objects.filter(token=raw).first())
