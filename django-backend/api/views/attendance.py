"""Attendance marking, rosters, session sheets and printable ID cards."""
import io
import os
import base64
import mimetypes
import qrcode
from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.template.loader import render_to_string
from django.utils import timezone
from weasyprint import HTML
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, NotFound
from ..models import Tenant, Student, Group, ClassSession, Attendance
from ..serializers import AttendanceSerializer
from .common import (
    delete_uploaded_image,
    require_staff_tenant,
    save_uploaded_document,
)
from .payments import (
    compute_course_payment_status,
)


# Attendance Custom Views
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def attendance_for_session(request, session_id):
    user = request.user
    tid = require_staff_tenant(user)
    if not user.is_super_admin() and not user.can_view('attendance'):
        raise PermissionDenied('Forbidden')

    def session_paid_status(session):
        """Which of this session's course's students have paid enough to
        cover what they've attended so far — see
        compute_course_payment_status's docstring for exactly what "paid"
        means here (course-specific, not the student's overall balance)."""
        if not session:
            return {}
        course_id = session.course_id or (session.group.course_id if session.group_id else None)
        if not course_id:
            return {}
        student_ids = list(session.group.students.values_list('id', flat=True)) if session.group_id else None
        return compute_course_payment_status(tid, course_id, student_ids=student_ids)

    if request.method == 'GET':
        items = Attendance.objects.filter(tenant_id=tid, session_id=session_id)
        session = ClassSession.objects.filter(id=session_id, tenant_id=tid).select_related('group').first()
        return Response({
            'items': AttendanceSerializer(items, many=True).data,
            'total': items.count(),
            'paid_status': session_paid_status(session),
        })

    elif request.method == 'POST':
        # Bulk Mark — an upsert on existing session/student attendance rows.
        if not user.is_super_admin() and not user.can_modify('attendance'):
            raise PermissionDenied('Forbidden')

        marks = request.data.get('marks')
        if not isinstance(marks, list):
            return Response({'error': 'marks must be an array'}, status=status.HTTP_400_BAD_REQUEST)

        session = ClassSession.objects.filter(id=session_id, tenant_id=tid).select_related('group').first()
        if not session:
            raise NotFound('Session not found')

        with transaction.atomic():
            for mark in marks:
                student_id = mark.get('student_id')
                status_val = mark.get('status')
                note = mark.get('note')

                if not student_id or status_val not in ['present', 'absent', 'late', 'excused']:
                    continue

                # update_or_create's lookup below only scopes by tenant_id on
                # the Attendance row itself — student_id is taken from the
                # request body as-is, so without this check a caller could
                # attach another tenant's student UUID and have a brand-new
                # Attendance row silently created for it (there'd be no
                # existing same-tenant row to match, so it can't clobber an
                # existing record, just plant a cross-tenant one).
                if not Student.objects.filter(id=student_id, tenant_id=tid).exists():
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
        return Response({
            'items': AttendanceSerializer(items, many=True).data,
            'total': items.count(),
            'paid_status': session_paid_status(session),
        })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def attendance_upload_excuse(request, attendance_id):
    """Attaches a photo/PDF of the excuse document (doctor's note, etc.) to
    an excused absence — only meaningful for status='excused' records."""
    user = request.user
    tid = require_staff_tenant(user)
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


def _qr_data_uri(data):
    """PNG data URI for a QR code encoding `data` — same box=/border= a
    phone camera can read comfortably at ID-card size once printed."""
    img = qrcode.make(data, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"


def _darken_hex(hex_color, factor):
    """`factor` < 1 darkens (e.g. 0.72 = 72% brightness) — used for the ID
    card's two-stop gradient panel so it has real depth instead of a flat
    fill, without needing a design-time second color from the tenant."""
    h = (hex_color or '').lstrip('#')
    if len(h) != 6:
        return hex_color
    try:
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return hex_color
    r, g, b = (max(0, min(255, int(c * factor))) for c in (r, g, b))
    return f'#{r:02x}{g:02x}{b:02x}'


# Same wording as SCHOOL_LEVEL_AR/SPECIALTY_AR/YEAR_ORDINALS_AR in the
# frontend's EnrollPage.jsx, kept here too since the printed ID card is
# server-rendered and can't reach the frontend's i18n.
SCHOOL_LEVEL_AR = {'preschool': 'التحضيري', 'primary': 'ابتدائي', 'middle': 'متوسط', 'high': 'ثانوي'}


SPECIALTY_AR = {
    'common_science': 'جذع مشترك علوم وتكنولوجيا',
    'common_arts': 'جذع مشترك آداب وفلسفة',
    'science_exp': 'علوم تجريبية',
    'math': 'رياضيات',
    'tech_math': 'تقني رياضي',
    'management_econ': 'تسيير واقتصاد',
    'arts_philo': 'آداب وفلسفة',
    'foreign_lang': 'لغات أجنبية',
}


YEAR_ORDINALS_AR = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة']


def _student_grade_label_ar(student):
    """"ثانوي · الثانية · علوم تجريبية" — the same level/year/specialty
    composition courseLevelLabel() builds client-side, from the student's
    own school_level/school_year/specialty (not a course's)."""
    if not student.school_level:
        return None
    parts = [SCHOOL_LEVEL_AR.get(student.school_level, student.school_level)]
    if student.school_year:
        parts.append(YEAR_ORDINALS_AR[student.school_year - 1] if student.school_year <= len(YEAR_ORDINALS_AR) else f'السنة {student.school_year}')
    if student.specialty:
        parts.append(SPECIALTY_AR.get(student.specialty, student.specialty))
    return ' · '.join(parts)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def student_id_cards_print(request):
    """Printable student ID badges — accepts repeated ?student_id=. One
    student prints as a single card sized to fit real ID-card stock; two or
    more tile onto A4 sheets (see student_id_card.html) so a batch print
    doesn't waste paper on one card per page. The QR encodes the student's
    raw id — exactly what the teacher mobile app's badge scanner already
    sends to GET /students/<id>/verify (see StudentViewSet.verify), so a
    card printed here is immediately scannable with the existing app, no
    new lookup path needed."""
    user = request.user
    tid = require_staff_tenant(user)
    if not user.can_view('students'):
        raise PermissionDenied('Forbidden')

    student_ids = request.GET.getlist('student_id')
    if not student_ids:
        return Response({'error': 'student_id is required'}, status=status.HTTP_400_BAD_REQUEST)

    students = list(Student.objects.filter(tenant_id=tid, id__in=student_ids))
    if not students:
        raise NotFound('No matching students')
    # Preserve the order the caller asked for (matches selection order in
    # the UI) rather than whatever the DB happened to return.
    by_id = {s.id: s for s in students}
    students = [by_id[sid] for sid in student_ids if sid in by_id]

    tenant = Tenant.objects.filter(id=tid).first()
    logo_data_uri = None
    if tenant and tenant.logo_url:
        filename = tenant.logo_url.rsplit('/', 1)[-1]
        logo_data_uri = _file_data_uri(os.path.join(settings.MEDIA_ROOT, 'logos', filename))

    cards = [{
        'first_name': s.first_name,
        'last_name': s.last_name,
        'student_code': s.student_code,
        'grade_label': _student_grade_label_ar(s),
        'qr_data_uri': _qr_data_uri(s.id),
    } for s in students]

    # 2x4 = 8 per A4 sheet ("if there is more than 8 only then we use
    # another page") — chunked here rather than left to CSS wrapping/
    # page-break-after guesswork, same explicit-sheets approach already
    # proven in session_sheet.html/finance_report.html.
    CARDS_PER_SHEET = 8
    sheets = [cards[i:i + CARDS_PER_SHEET] for i in range(0, len(cards), CARDS_PER_SHEET)]

    is_single = len(cards) == 1
    primary_color = (tenant.primary_color if tenant else None) or '#0A0A0B'
    context = {
        'primary_color': primary_color,
        'primary_color_dark': _darken_hex(primary_color, 0.72),
        'accent_color': (tenant.accent_color if tenant else None) or '#E53935',
        'tenant_name': tenant.name if tenant else '',
        'tenant_initial': ((tenant.name if tenant else None) or 'S')[0].upper(),
        'logo_data_uri': logo_data_uri,
        'sheets': sheets,
        'is_single': is_single,
        'page_size': '86mm 54mm' if is_single else 'A4',
        'page_margin': '0' if is_single else '10mm',
    }

    html_string = render_to_string('student_id_card.html', context)
    pdf_bytes = HTML(string=html_string).write_pdf()

    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    response['Content-Disposition'] = 'inline; filename="student-id-cards.pdf"'
    return response


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
    tid = require_staff_tenant(user)
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

    paid_status = compute_course_payment_status(tid, course.id) if course else {}

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
        paid = paid_status.get(a.student_id)
        rows.append({
            'student_name': f'{a.student.first_name} {a.student.last_name}',
            'student_code': a.student.student_code,
            'status': a.status,
            'status_label': ATTENDANCE_STATUS_AR.get(a.status, a.status),
            'marked_at': timezone.localtime(a.marked_at).strftime('%H:%M'),
            'has_document': has_document,
            # None when the student has no present/excused attendance in
            # this course yet (nothing to have paid for) — the template
            # shows nothing rather than a misleading "unpaid".
            'paid': paid,
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


def _build_session_sheet(tid, group):
    """One group's Session Sheet data — the paper ledger the client sent —
    covering the group's WHOLE course planning rather than a single month:
    a row per enrolled student, one column per session across the entire
    ClassSession schedule (past and future), so printing shows every
    session at once, matching the client's request to see the full plan
    rather than pick a month.

    Column count is at least the number of real ClassSessions scheduled so
    far, extended to Course.sessions_count when pricing_type is
    'fixed_sessions' (that field is literally "the total number of
    sessions the whole course is spread across" for that pricing model) so
    the sheet still shows the full intended plan even before every session
    has been individually scheduled. Boxes past however many sessions
    actually exist are blank placeholders — no id, not markable — same as
    an untouched box on the physical paper. Colored per
    compute_course_payment_status's running balance, checked per box from
    that session's Attendance record."""
    course = group.course
    teacher = group.teacher

    sessions = list(
        ClassSession.objects.filter(tenant_id=tid, group_id=group.id).order_by('start_at')
    )

    nominal_count = None
    if course and course.pricing_type == 'fixed_sessions' and course.sessions_count:
        nominal_count = course.sessions_count
    box_count = max(nominal_count or 0, len(sessions))

    session_ids = [s.id for s in sessions]
    # `date` is the short dd/mm text used by the printed sheet; `iso` is the
    # full calendar date for the web page to format in the user's language.
    session_slots = [{
        'id': s.id,
        'date': timezone.localtime(s.start_at).strftime('%d/%m'),
        'iso': timezone.localtime(s.start_at).date().isoformat(),
    } for s in sessions]
    session_slots += [{'id': None, 'date': None, 'iso': None}] * (box_count - len(session_slots))

    paid_status = compute_course_payment_status(tid, course.id) if course else {}

    marks_by_student = {}
    if session_ids:
        for a in Attendance.objects.filter(tenant_id=tid, session_id__in=session_ids):
            marks_by_student.setdefault(a.student_id, {})[a.session_id] = a.status

    students = []
    for s in group.students.all().order_by('first_name', 'last_name'):
        student_marks = marks_by_student.get(s.id, {})
        # One entry per slot, in the same order as `session_slots` below —
        # keeps both the print template and the frontend from needing a
        # dynamic dict-key lookup (Django templates can't do `dict[var]`
        # without a custom filter); box i always corresponds to slot i.
        # A blank slot (id None) has no attendance record to look up.
        boxes = [student_marks.get(slot['id']) if slot['id'] else None for slot in session_slots]
        students.append({
            'id': s.id,
            'first_name': s.first_name,
            'last_name': s.last_name,
            'phone': s.phone,
            # None when the student has no present/excused attendance in
            # this course yet — see compute_course_payment_status.
            'paid': paid_status.get(s.id),
            'boxes': boxes,
        })

    return {
        'group_id': group.id,
        'group_name': group.name,
        'teacher_name': f'{teacher.first_name} {teacher.last_name}' if teacher else None,
        'course_id': course.id if course else None,
        'course_title': course.title if course else None,
        # Lets the frontend's "Make Payment" quick action on an unpaid
        # student prefill a sensible amount/kind without a second fetch.
        'course_price': str(course.price) if course else None,
        'course_pricing_type': course.pricing_type if course else None,
        'sessions': session_slots,
        'students': students,
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def group_session_sheet(request):
    """Data for the Session Sheet page (see _build_session_sheet's
    docstring). Accepts repeated ?group_id=."""
    user = request.user
    tid = require_staff_tenant(user)
    if user.role == 'parent':
        raise PermissionDenied('Forbidden')
    if not user.is_super_admin() and not user.can_view('attendance'):
        raise PermissionDenied('Forbidden')

    group_ids = request.GET.getlist('group_id')
    if not group_ids:
        return Response({'sheets': []})

    groups = Group.objects.filter(tenant_id=tid, id__in=group_ids).select_related('course', 'teacher')
    sheets = [_build_session_sheet(tid, group) for group in groups]
    return Response({'sheets': sheets})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def group_session_sheet_print(request):
    """PDF version of group_session_sheet — one section per group, each
    starting on its own page (see session_sheet.html), so requesting
    several groups in one call prints them as separate sheets in a single
    document ("each group has that paper, or we can combine multiple
    groups" per the client's own framing)."""
    user = request.user
    tid = require_staff_tenant(user)
    if user.role == 'parent':
        raise PermissionDenied('Forbidden')
    if not user.is_super_admin() and not user.can_view('attendance'):
        raise PermissionDenied('Forbidden')

    group_ids = request.GET.getlist('group_id')
    if not group_ids:
        return Response({'error': 'group_id is required'}, status=status.HTTP_400_BAD_REQUEST)

    tenant = Tenant.objects.filter(id=tid).first()
    logo_data_uri = None
    if tenant and tenant.logo_url:
        filename = tenant.logo_url.rsplit('/', 1)[-1]
        logo_data_uri = _file_data_uri(os.path.join(settings.MEDIA_ROOT, 'logos', filename))

    groups = Group.objects.filter(tenant_id=tid, id__in=group_ids).select_related('course', 'teacher')
    sheets = [_build_session_sheet(tid, group) for group in groups]

    context = {
        'primary_color': (tenant.primary_color if tenant else None) or '#0A0A0B',
        'accent_color': (tenant.accent_color if tenant else None) or '#E53935',
        'tenant_name': tenant.name if tenant else '',
        'tenant_initial': ((tenant.name if tenant else None) or 'S')[0].upper(),
        'logo_data_uri': logo_data_uri,
        'printed_at': timezone.localtime(timezone.now()).strftime('%d/%m/%Y %H:%M'),
        'sheets': sheets,
    }

    html_string = render_to_string('session_sheet.html', context)
    pdf_bytes = HTML(string=html_string).write_pdf()

    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    response['Content-Disposition'] = 'inline; filename="session-sheet.pdf"'
    return response


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def attendance_set_recovery(request, attendance_id):
    """Manually toggles whether a student has made up an excused absence —
    a plain status flag, no makeup-session scheduling involved."""
    user = request.user
    tid = require_staff_tenant(user)
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
    tid = require_staff_tenant(user)
    # Parents have their own scoped route (portal_child_attendance, which
    # checks _portal_child) — this general staff route must not be usable
    # to read a family it isn't _portal_child-verified against, and must
    # respect the same module permission its siblings (attendance_for_session,
    # attendance_session_print) already enforce.
    if user.role == 'parent':
        raise PermissionDenied('Forbidden')
    if not user.is_super_admin() and not user.can_view('attendance'):
        raise PermissionDenied('Forbidden')

    items = Attendance.objects.filter(tenant_id=tid, student_id=student_id).order_by('-marked_at')[:500]
    return Response({'items': AttendanceSerializer(items, many=True).data, 'total': len(items)})
