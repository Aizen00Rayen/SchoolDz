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
from datetime import datetime, timedelta
from django.conf import settings
from django.db import transaction
from django.db.models import Q, Sum, F, Count
from django.http import FileResponse, Http404, HttpResponse
from django.template.loader import render_to_string
from django.utils import timezone
from django.shortcuts import redirect
from weasyprint import HTML
from rest_framework import viewsets, status, serializers
from rest_framework.decorators import api_view, permission_classes, throttle_classes, action
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound, APIException
from rest_framework.authtoken.models import Token

from .models import Tenant, User, Guardian, Teacher, Student, Course, Group, ClassSession, Attendance, Payment, Grade, ChargilyCheckout, PasswordResetToken, Conversation, Message, Coupon, Quiz, Question, Choice, QuizAttempt, Answer, SchoolGalleryPhoto, PERMISSION_MODULES, PERMISSION_LEVELS
from .serializers import TenantSerializer, UserSerializer, GuardianSerializer, TeacherSerializer, StudentSerializer, CourseSerializer, GroupSerializer, ClassSessionSerializer, AttendanceSerializer, PaymentSerializer, GradeSerializer, ChargilyCheckoutSerializer, ConversationSerializer, MessageSerializer, CouponSerializer, QuizSerializer, QuestionSerializer, QuizAttemptSerializer, SchoolGalleryPhotoSerializer
from .services import GoogleOAuthService, ChargilyClient, LoginRateThrottle, PasswordResetRateThrottle, EnrollmentRateThrottle

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


UPLOAD_SUBDIRS = {'logos', 'hero', 'teachers', 'courses', 'gallery'}
IMAGE_UPLOAD_EXTS = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'}


# Longest-edge cap per upload purpose. Anything bigger is downscaled before
# it ever touches disk — a modern phone photo is ~4000px/5MB, which is pure
# waste for a 96px avatar and adds up fast across every tenant.
UPLOAD_MAX_EDGE = {'logos': 512, 'teachers': 600, 'courses': 1280, 'gallery': 1600, 'hero': 2000}
UPLOAD_JPEG_QUALITY = 82
GALLERY_MAX_PHOTOS = 40

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
        if self.module_key and not user.is_super_admin() and user.get_permission(self.module_key) == 'hidden':
            raise PermissionDenied('Forbidden')

    def check_module_edit(self):
        """Raise unless the current user has edit rights on this module."""
        user = self.request.user
        if self.module_key and not user.is_super_admin() and user.get_permission(self.module_key) != 'edit':
            raise PermissionDenied('You do not have permission to modify this.')

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

    def perform_create(self, serializer):
        user = self.request.user
        if user.tenant_id:
            if not user.is_super_admin() and user.tenant.status != 'active':
                raise PermissionDenied('This workspace is not active yet — complete billing to continue.')
            serializer.save(tenant_id=user.tenant_id)
        else:
            serializer.save()

    def create(self, request, *args, **kwargs):
        self.check_module_edit()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        self.check_module_edit()
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self.check_module_edit()
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self.check_module_edit()
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
        return Response({'error': 'Invalid credentials'}, status=status.HTTP_401_UNAUTHORIZED)
        
    if not user.is_active:
        return Response({'error': 'Account disabled'}, status=status.HTTP_403_FORBIDDEN)

    token, _ = Token.objects.get_or_create(user=user)
    return Response({
        'access_token': token.key,
        'refresh_token': token.key,
        'user': UserSerializer(user).data
    })


@api_view(['GET'])
@permission_classes([AllowAny])
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

    questions = [{
        'id': q.id,
        'text': q.text,
        'points': q.points,
        'choices': [{'id': c.id, 'text': c.text} for c in q.choices.all()],
    } for q in quiz.questions.all().prefetch_related('choices')]

    return Response({
        'quiz_title': quiz.title,
        'description': quiz.description,
        'time_limit_minutes': quiz.time_limit_minutes,
        'questions': questions,
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

    answers_data = request.data.get('answers', [])
    if not isinstance(answers_data, list):
        return Response({'error': 'answers must be a list'}, status=status.HTTP_400_BAD_REQUEST)

    questions = {q.id: q for q in quiz.questions.all().prefetch_related('choices')}
    max_score = sum(float(q.points) for q in questions.values())
    score = 0.0
    matched_student = _match_student_by_name(quiz.group, solver_name)

    with transaction.atomic():
        attempt = QuizAttempt.objects.create(
            tenant_id=quiz.tenant_id, quiz=quiz, student=matched_student,
            solver_name=solver_name, max_score=max_score,
        )
        for a in answers_data:
            question = questions.get(a.get('question_id'))
            if not question:
                continue
            choice = None
            choice_id = a.get('choice_id')
            if choice_id:
                choice = next((c for c in question.choices.all() if c.id == choice_id), None)
            Answer.objects.create(tenant_id=quiz.tenant_id, attempt=attempt, question=question, choice=choice)
            if choice and choice.is_correct:
                score += float(question.points)

        attempt.score = score
        attempt.save(update_fields=['score'])

        # Only when the typed name actually matched someone on the roster —
        # an unmatched name has no student to attribute a grade to.
        if matched_student:
            Grade.objects.create(
                tenant_id=quiz.tenant_id,
                student=matched_student,
                course=quiz.course,
                title=quiz.title,
                score=score,
                max_score=max_score,
                date=timezone.now().date(),
            )

    return Response({'score': score, 'max_score': max_score, 'matched': matched_student is not None})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def auth_logout(request):
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
            })
        course_data.append({
            'id': c.id,
            'title': c.title,
            'description': c.description,
            'category': c.category,
            'duration_weeks': c.duration_weeks,
            'price': str(c.price),
            'color': c.color,
            'image_url': c.image_url,
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
    payment_method = data.get('payment_method')  # 'online' | 'office'

    if not all([guardian_name, guardian_email, password, student_first, student_last, group_id]):
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
        )
        student_code = f"{tenant.student_prefix or 'STU-'}{str(existing_count + 1).zfill(5)}"
        student = Student.objects.create(
            tenant=tenant, parent=guardian, first_name=student_first, last_name=student_last,
            student_code=student_code, enrollment_date=timezone.now(), status='active',
        )
        group.students.add(student)

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

    if payment.status == 'paid':
        status_label = 'Paid'
        status_line = f"Paid — {payment.paid_at.strftime('%d %b %Y')}" if payment.paid_at else 'Paid'
    elif is_overdue:
        status_label = 'Overdue'
        status_line = f"Overdue since {payment.due_date.strftime('%d %b %Y')}"
    elif payment.status in ['pending', 'partial']:
        status_label = 'Pending'
        status_line = f"Due {payment.due_date.strftime('%d %b %Y')}" if payment.due_date else 'Pending'
    else:
        status_label = payment.get_status_display().capitalize()
        status_line = status_label

    item_sub_parts = []
    if payment.group:
        item_sub_parts.append(payment.group.name)
    # Only add the kind label when it isn't already the item title (that
    # happens when there's no linked course — kind is the title itself then).
    if payment.course:
        item_sub_parts.append(payment.get_kind_display().capitalize())

    subtotal = payment.amount
    discount = payment.discount or 0
    total = subtotal - discount

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
        'issued_date': payment.created_at.strftime('%d %b %Y'),
        'student_name': f"{student.first_name} {student.last_name}",
        'guardian_name': student.parent.name if student.parent else None,
        'method_label': payment.get_method_display().replace('_', ' ').capitalize(),
        'due_date': payment.due_date.strftime('%d %b %Y') if payment.due_date and payment.status != 'paid' else None,
        'student_code': student.student_code,
        'item_title': payment.course.title if payment.course else payment.get_kind_display().capitalize(),
        'item_sub': ' · '.join(item_sub_parts),
        'subtotal': f"{subtotal:,.2f}",
        'discount': f"{discount:,.2f}",
        'total': f"{total:,.2f}",
        'currency': tenant.currency or 'DZD',
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
    if tenant.status != 'pending_payment':
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
    tid = request.user.tenant_id
    if not tid:
        return Response({'error': 'no tenant'}, status=status.HTTP_400_BAD_REQUEST)
        
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
        
        m_total = float(m_rev_data['total'] or 0)
        trend.append({
            'month': m_date.strftime('%b'),
            'revenue': round(m_total, 2)
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
            'outstanding': round(outstanding, 2),
            'attendance_pct': attendance_pct,
            'sessions_today': len(today_sessions),
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
        
    tid = request.user.tenant_id
    if not tid:
        return Response({'results': []})
        
    results = []
    
    # Students
    students = Student.objects.filter(tenant_id=tid).filter(
        Q(first_name__icontains=q) | Q(last_name__icontains=q) | Q(email__icontains=q)
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
        Q(first_name__icontains=q) | Q(last_name__icontains=q) | Q(email__icontains=q)
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
    if not user.is_super_admin() and user.get_permission('attendance') == 'hidden':
        raise PermissionDenied('Forbidden')

    if request.method == 'GET':
        items = Attendance.objects.filter(tenant_id=tid, session_id=session_id)
        return Response({'items': AttendanceSerializer(items, many=True).data, 'total': items.count()})

    elif request.method == 'POST':
        # Bulk Mark
        if not user.is_super_admin() and user.get_permission('attendance') != 'edit':
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
                    
                Attendance.objects.update_or_create(
                    tenant_id=tid,
                    session_id=session_id,
                    student_id=student_id,
                    defaults={
                        'status': status_val,
                        'note': note or None,
                        'marked_by': user,
                        'marked_at': timezone.now()
                    }
                )
                
        items = Attendance.objects.filter(tenant_id=tid, session_id=session_id)
        return Response({'items': AttendanceSerializer(items, many=True).data, 'total': items.count()})


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
    """Validate a {module: level} payload against the known modules/levels.
    Returns a cleaned dict (unknown modules dropped) or raises ValidationError."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValidationError({'permissions': 'Must be an object of module -> level'})
    cleaned = {}
    for module_key, level in raw.items():
        if module_key not in PERMISSION_MODULES:
            continue
        if level not in PERMISSION_LEVELS:
            raise ValidationError({'permissions': f"Invalid level '{level}' for '{module_key}'"})
        cleaned[module_key] = level
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
                Q(name__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q)
            )
        queryset = queryset.prefetch_related('students').order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset()).prefetch_related('students').order_by('-created_at')
        headers = ['Name', 'Email', 'Phone', 'Address', 'Occupation', 'Relationship', 'Emergency Contact', 'Students']
        rows = [[
            g.name, g.email or '', g.phone or '', g.address or '', g.occupation or '', g.relationship,
            g.emergency_contact or '', ', '.join(f"{s.first_name} {s.last_name}" for s in g.students.all()),
        ] for g in queryset]
        return export_rows(headers, rows, 'parents', request.GET.get('type'))

    def create(self, request, *args, **kwargs):
        self.check_module_edit()
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
        self.check_module_edit()
        instance = self.get_object()
        data = request.data.copy()
        student_ids = data.pop('student_ids', None)

        serializer = self.get_serializer(instance, data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        if student_ids is not None:
            Student.objects.filter(parent=instance, tenant_id=instance.tenant_id).exclude(id__in=student_ids).update(parent=None)
            Student.objects.filter(id__in=student_ids, tenant_id=instance.tenant_id).update(parent=instance)

        return Response(self.get_serializer(instance).data, status=status.HTTP_200_OK)

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
            queryset = queryset.filter(
                Q(first_name__icontains=q) | Q(last_name__icontains=q) | Q(email__icontains=q)
            )
        queryset = queryset.order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset()).order_by('-created_at')
        headers = ['First Name', 'Last Name', 'Email', 'Phone', 'Address', 'Subjects', 'Hourly Rate', 'Monthly Salary', 'Status', 'Hire Date']
        rows = [[
            t.first_name, t.last_name, t.email or '', t.phone or '', t.address or '',
            ', '.join(t.subjects) if t.subjects else '', t.hourly_rate, t.monthly_salary, t.status,
            t.hire_date.isoformat() if t.hire_date else '',
        ] for t in queryset]
        return export_rows(headers, rows, 'teachers', request.GET.get('type'))

    @action(detail=True, methods=['post'], url_path='photo')
    def upload_photo(self, request, pk=None):
        self.check_module_edit()
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

    def create(self, request, *args, **kwargs):
        self.check_module_edit()
        data = request.data.copy()
        # Auto hire date
        data['hire_date'] = timezone.now().date().isoformat()

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)

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
            queryset = queryset.filter(
                Q(first_name__icontains=q) | Q(last_name__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q)
            )
        queryset = queryset.order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset()).select_related('parent').order_by('-created_at')
        headers = [
            'Student Code', 'First Name', 'Last Name', 'Gender', 'Birth Date', 'Email', 'Phone', 'Address',
            'Emergency Contact', 'Status', 'Parent Name', 'Parent Email', 'Parent Phone', 'Enrollment Date',
        ]
        rows = [[
            s.student_code or '', s.first_name, s.last_name, s.gender or '',
            s.birth_date.isoformat() if s.birth_date else '', s.email or '', s.phone or '', s.address or '',
            s.emergency_contact or '', s.status, s.parent.name if s.parent else '',
            s.parent.email if s.parent and s.parent.email else '', s.parent.phone if s.parent and s.parent.phone else '',
            s.enrollment_date.date().isoformat() if s.enrollment_date else '',
        ] for s in queryset]
        return export_rows(headers, rows, 'students', request.GET.get('type'))

    def create(self, request, *args, **kwargs):
        self.check_module_edit()
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
        self.check_module_edit()
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

            try:
                with transaction.atomic():
                    guardian = None
                    parent_email = (row.get('parent_email') or '').strip().lower()
                    if parent_email:
                        guardian, _ = Guardian.objects.get_or_create(
                            tenant=tenant, email=parent_email,
                            defaults={'name': (row.get('parent_name') or parent_email).strip(), 'phone': (row.get('parent_phone') or '').strip()},
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
        self.check_module_edit()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='photo')
    def upload_photo(self, request, pk=None):
        self.check_module_edit()
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
        queryset = queryset.prefetch_related('students').order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_edit()
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
        self.check_module_edit()
        instance = self.get_object()
        data = request.data.copy()
        student_ids = data.pop('student_ids', None)

        partial = kwargs.pop('partial', False)
        serializer = self.get_serializer(instance, data=data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        if student_ids is not None:
            students = Student.objects.filter(id__in=student_ids, tenant_id=instance.tenant_id)
            instance.students.set(students)

        return Response(self.get_serializer(instance).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def enroll(self, request, pk=None):
        self.check_module_edit()
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
        self.check_module_edit()
        student_id = request.data.get('student_id')
        if not student_id:
            return Response({'error': 'student_id is required'}, status=status.HTTP_400_BAD_REQUEST)
            
        group = self.get_object()
        student = Student.objects.filter(id=student_id, tenant_id=group.tenant_id).first()
        if not student:
            raise NotFound('Student not found')
            
        group.students.remove(student)
        return Response(GroupSerializer(group).data)


class ClassSessionViewSet(TenantScopedViewSet):
    queryset = ClassSession.objects.all()
    serializer_class = ClassSessionSerializer
    module_key = 'sessions'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
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
        self.check_module_edit()
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
        self.check_module_edit()
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
        queryset = queryset.order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_edit()
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
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payments_overdue(request):
    tid = request.user.tenant_id
    if not tid:
        raise PermissionDenied('User has no tenant')

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
        self.check_module_edit()
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
        self.check_module_edit()
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
        self.check_module_edit()
        quiz = self.get_object()
        self._check_quiz_builder(quiz.tenant)
        return super().update(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def save_questions(self, request, pk=None):
        self.check_module_edit()
        quiz = self.get_object()
        self._check_quiz_builder(quiz.tenant)

        questions_data = request.data.get('questions', [])
        if not isinstance(questions_data, list):
            raise ValidationError('questions must be a list')

        with transaction.atomic():
            quiz.questions.all().delete()  # cascades to choices
            for qi, q in enumerate(questions_data):
                text = (q.get('text') or '').strip()
                if not text:
                    continue
                question = Question.objects.create(
                    tenant_id=quiz.tenant_id, quiz=quiz, text=text,
                    points=q.get('points') or 1, order=q.get('order', qi),
                )
                for ci, c in enumerate(q.get('choices') or []):
                    c_text = (c.get('text') or '').strip()
                    if not c_text:
                        continue
                    Choice.objects.create(
                        tenant_id=quiz.tenant_id, question=question, text=c_text,
                        is_correct=bool(c.get('is_correct')), order=c.get('order', ci),
                    )
        return Response(QuizSerializer(quiz).data)

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        self.check_module_edit()
        quiz = self.get_object()
        self._check_quiz_builder(quiz.tenant)
        if not quiz.group_id:
            raise ValidationError('Assign a group to this quiz before publishing.')
        if not quiz.questions.exists():
            raise ValidationError('Add at least one question before publishing.')

        # ONE shared link for the whole class — generated once and reused on
        # every re-publish, so a link already shared with students doesn't
        # go stale if the teacher edits questions and republishes.
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
        attempts = quiz.attempts.select_related('student').order_by('-created_at')
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
        self.check_module_edit()
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
            self.check_module_edit()
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


# Serves uploaded tenant/teacher/course/gallery images directly.
@api_view(['GET'])
@permission_classes([AllowAny])
def serve_upload(request, subdir, filename):
    if subdir not in UPLOAD_SUBDIRS:
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
