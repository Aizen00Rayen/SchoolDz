"""No-login endpoints: public school pages, enrollment, quiz links, badges, uploads, SPA."""
import os
import mimetypes
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, NotFound, NotAuthenticated
from rest_framework.authtoken.models import Token
import logging
from ..models import (
    Tenant,
    User,
    Guardian,
    Teacher,
    Student,
    Course,
    Group,
    Attendance,
    Payment,
    PaymentItem,
    ChargilyCheckout,
    Quiz,
    QuizAttempt,
    QuizSubmissionFile,
)
from ..serializers import UserSerializer, StudentSerializer, PaymentSerializer
from ..services import (
    ChargilyClient,
    EnrollmentRateThrottle,
    StudentLookupRateThrottle,
    QuizSubmitRateThrottle,
    log_activity,
)
from .common import (
    PRIVATE_UPLOAD_SUBDIRS,
    PUBLIC_LOW_SEATS_THRESHOLD,
    QUIZ_MAX_SUBMISSION_FILES,
    UPLOAD_SUBDIRS,
    _next_sequence_code,
    delete_uploaded_image,
    logger,
    password_policy_error,
    save_uploaded_document,
)


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
@throttle_classes([QuizSubmitRateThrottle])
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

    # A page refresh/double-tap on submit used to silently create a second
    # attempt with no warning — harmless until someone grades both (see
    # Grade.quiz_attempt), at which point whichever got graded second wins
    # with no indication the first's score was ever there. Once this
    # solver's most recent attempt has actually been graded, a further
    # submission is a legitimate new attempt (a real retry/correction), not
    # an accidental duplicate, so only the ungraded case is blocked.
    pending = QuizAttempt.objects.filter(
        quiz=quiz, solver_name__iexact=solver_name, graded_at__isnull=True,
    ).exists()
    if pending:
        return Response(
            {'error': 'You already submitted this quiz — wait for it to be graded before submitting again.'},
            status=status.HTTP_409_CONFLICT,
        )

    # Validate/convert every upload before writing any DB row, so a bad file
    # halfway through doesn't leave a half-submitted attempt behind. Files
    # are still written to disk one at a time as each is validated — if a
    # later file in the batch fails, clean up whatever earlier ones already
    # made it to disk rather than leaving them permanently orphaned (no DB
    # row will ever point at them, since the whole request is rejected).
    saved = []
    try:
        for f in files:
            saved.append((save_uploaded_document(f, 'submissions', quiz.id), f.name))
    except ValidationError:
        for url, _name in saved:
            delete_uploaded_image(url, 'submissions')
        raise

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
    checkout for online payment. A parent can enroll one child in several
    courses at once (group_ids, plural) — one PaymentItem per course under
    a single combined bill, the same shape PaymentViewSet.create already
    uses for a multi-course bill made from the staff side."""
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
    group_ids = data.get('group_ids')
    if isinstance(group_ids, str):
        group_ids = [group_ids]
    group_ids = list(dict.fromkeys(g for g in (group_ids or []) if g))  # de-dupe, keep order
    # The public enrollment page no longer offers an online-payment choice —
    # parents just fill the form and pay at the school office — but keep
    # accepting 'online' here too, since nothing about the Chargily checkout
    # path below actually depends on the frontend exposing that choice.
    payment_method = data.get('payment_method') or 'office'

    if not all([guardian_name, guardian_email, guardian_phone, password, student_first, student_last]) or not group_ids:
        return Response({'error': 'All fields are required'}, status=status.HTTP_400_BAD_REQUEST)
    if payment_method not in ['online', 'office']:
        return Response({'error': 'Choose a payment method'}, status=status.HTTP_400_BAD_REQUEST)
    password_error = password_policy_error(password, guardian_email, guardian_name)
    if password_error:
        return Response({'error': password_error}, status=status.HTTP_400_BAD_REQUEST)

    groups = list(Group.objects.filter(
        id__in=group_ids, tenant=tenant, status='active', course__show_on_enrollment=True,
    ).select_related('course'))
    if len(groups) != len(group_ids):
        raise NotFound('One or more selected courses are not available for enrollment')

    full_courses = [g.course.title for g in groups if g.students.count() >= g.capacity]
    if full_courses:
        return Response({
            'error': f"These courses are full — please remove them and try again: {', '.join(full_courses)}",
        }, status=status.HTTP_409_CONFLICT)

    if User.objects.filter(email=guardian_email).exists():
        return Response({
            'error': 'An account with this email already exists. Log in to the parent portal to enroll another child.',
        }, status=status.HTTP_409_CONFLICT)

    existing_count = Student.objects.filter(tenant_id=tenant.id).count()
    if tenant.max_students is not None and existing_count >= tenant.max_students:
        return Response({'error': 'This school is at capacity — please contact them directly.'}, status=status.HTTP_400_BAD_REQUEST)

    total_amount = sum(g.course.price for g in groups)

    with transaction.atomic():
        # Locks this tenant's row for the rest of the block so two
        # concurrent enrollments can't compute the same student_code/
        # invoice_number — see _next_sequence_code's docstring.
        Tenant.objects.select_for_update().get(id=tenant.id)
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
        student_code = _next_sequence_code(tenant.id, Student, 'student_code', tenant.student_prefix or 'STU-', 5)
        student = Student.objects.create(
            tenant=tenant, parent=guardian, first_name=student_first, last_name=student_last,
            student_code=student_code, enrollment_date=timezone.now(), status='active',
            # Self-enrolled — a secretary reviews it on the Students page
            # before it counts as a confirmed record (see StudentViewSet.approve).
            source='public', approval_status='pending',
        )
        for g in groups:
            g.students.add(student)
        log_activity(request, tenant.id, 'create', category='data', entity_type='students', entity_id=student.id,
                     description=f'Public enrollment: {student.first_name} {student.last_name} (pending approval)')

        invoice_number = _next_sequence_code(tenant.id, Payment, 'invoice_number', tenant.invoice_prefix or 'INV-', 6)
        payment = Payment.objects.create(
            tenant=tenant, student=student, amount=total_amount,
            method='card' if payment_method == 'online' else 'cash',
            status='pending', due_date=timezone.now().date(), invoice_number=invoice_number,
        )
        for g in groups:
            PaymentItem.objects.create(payment=payment, kind='registration', course=g.course, group=g, amount=g.course.price)

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
        amount=int(total_amount), currency=tenant.currency.lower(), status='pending',
    )
    client = ChargilyClient()
    try:
        response = client.createCheckout({
            'amount': int(total_amount),
            'currency': tenant.currency.lower(),
            'locale': locale,
            'description': f"{', '.join(g.course.title for g in groups)} — {student_first} {student_last}",
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
