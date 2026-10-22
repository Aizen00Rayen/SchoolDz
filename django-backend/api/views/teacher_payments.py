"""Teacher earnings (sessions, books, standalone courses) and payouts."""
from django.db import transaction
from django.db.models import Q, Sum, Count
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound
from ..models import Teacher, Course, Group, ClassSession, Attendance, PaymentItem, TeacherPayout
from ..serializers import TeacherPayoutSerializer
from .common import (
    TenantScopedViewSet,
    course_per_session_price,
    export_rows,
    filter_by_date_range,
    require_staff_tenant,
)
from .payments import (
    BALANCE_THRESHOLD,
    _payment_item_discount,
)


def _teacher_earnings_context(tenant_id):
    """The per-tenant session/course/teacher lookup tables that both
    compute_teacher_earned_total and compute_teacher_earnings independently
    rebuilt from scratch — a single dashboard_summary request used to call
    them 9 times combined (today + month + 6 trend months + the balances
    breakdown), each refetching every session/course/teacher row in the
    tenant. Build it once per request and pass it in via `_context` instead."""
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
    # A 'standalone' course's teacher earnings come entirely from a
    # payment-driven stream (see compute_teacher_earned_total/
    # compute_teacher_earnings) — its course_ids are excluded from the
    # attendance loop below, queried tenant-wide rather than just
    # course_ids above since a standalone course may have a group with no
    # sessions at all (attendance never applies to it).
    standalone_course_ids = set(
        Course.objects.filter(tenant_id=tenant_id, kind__in=['package', 'standalone']).values_list('id', flat=True)
    )
    # A standalone course's own PaymentItems essentially never carry a
    # group_id in practice (staff bill the course amount directly, without
    # picking a specific group) — even though the item's teacher_percentage
    # is correctly set. Falling back to "which teacher teaches this course"
    # only works when every group teaching it agrees on the teacher; a
    # course split across groups with different teachers is left unmapped
    # (contributes nothing, same as before) rather than guessing wrong.
    standalone_course_teacher = {}
    if standalone_course_ids:
        by_course = {}
        for course_id, teacher_id in Group.objects.filter(
            tenant_id=tenant_id, course_id__in=standalone_course_ids, teacher_id__isnull=False,
        ).values_list('course_id', 'teacher_id'):
            by_course.setdefault(course_id, set()).add(teacher_id)
        standalone_course_teacher = {cid: next(iter(tids)) for cid, tids in by_course.items() if len(tids) == 1}

    teacher_pardoned_pairs = set(
        PaymentItem.objects.filter(
            payment__tenant_id=tenant_id,
            course_id__isnull=False,
        ).filter(
            Q(pardon_type__in=('teacher', 'both')) |
            Q(payment__pardon_type__in=('teacher', 'both')) |
            Q(status__in=('pardoned', 'pardonned'), pardon_type__isnull=True) |
            Q(payment__status__in=('pardoned', 'pardonned'), payment__pardon_type__isnull=True)
        ).exclude(payment__status='cancelled').values_list('payment__student_id', 'course_id')
    )
    return session_info, price_per_session, teacher_pct, standalone_course_ids, standalone_course_teacher, teacher_pardoned_pairs


def compute_teacher_earned_total(tenant_id, date_from=None, date_to=None, _context=None):
    """Sum of every teacher's earned share (percentage x per-session price,
    for every present attendance) in an optional date window — the slice of
    collected revenue that belongs to teachers, not the school. A lighter
    sibling of compute_teacher_earnings(): no per-teacher breakdown, no
    already-paid-out figure, just the one number the dashboard and revenue
    trend need to net revenue down to what the institution actually keeps.
    Takes explicit dates rather than a request, since the dashboard has no
    ?from=/?to= of its own to read via filter_by_date_range. Pass `_context`
    (from _teacher_earnings_context) to skip rebuilding the lookup tables
    when the caller already has one for this tenant/request."""
    attendance = Attendance.objects.filter(tenant_id=tenant_id, status='present')
    if date_from:
        attendance = attendance.filter(session__start_at__date__gte=date_from)
    if date_to:
        attendance = attendance.filter(session__start_at__date__lte=date_to)

    session_info, price_per_session, teacher_pct, standalone_course_ids, standalone_course_teacher, teacher_pardoned_pairs = _context or _teacher_earnings_context(tenant_id)

    total = 0.0
    for a in attendance.values('session_id', 'student_id'):
        info = session_info.get(a['session_id'])
        if not info or not info['teacher_id']:
            continue
        # Attendance never earns a standalone course's teacher anything —
        # its cut comes entirely from the fully-paid-bill stream below.
        if info['course_id'] in standalone_course_ids:
            continue
        if (a['student_id'], info['course_id']) in teacher_pardoned_pairs:
            continue
        pct = float(teacher_pct.get(info['teacher_id']) or 0)
        total += price_per_session.get(info['course_id'], 0.0) * pct / 100

    # Book royalties — same second income stream compute_teacher_earnings
    # includes (see its docstring). Without this, "teacher share" here was
    # course-teaching-only, disagreeing with the Teacher Payments page's
    # total for any teacher who also authors books, and net_profit was
    # correspondingly overstated (the royalty is money owed to the teacher,
    # not money the school keeps).
    book_items = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id, payment__status='paid', kind='book',
        book__author_teacher_id__isnull=False,
    ).select_related('book')
    if date_from:
        book_items = book_items.filter(payment__paid_at__date__gte=date_from)
    if date_to:
        book_items = book_items.filter(payment__paid_at__date__lte=date_to)
    book_revenue = {}
    for item in book_items:
        author_id = item.book.author_teacher_id
        book_revenue[author_id] = book_revenue.get(author_id, 0.0) + float(item.amount)
    book_pct_by_teacher = dict(Teacher.objects.filter(tenant_id=tenant_id).values_list('id', 'book_percentage'))
    for teacher_id, revenue in book_revenue.items():
        book_pct = float(book_pct_by_teacher.get(teacher_id) or 0)
        total += revenue * book_pct / 100

    # Package & standalone-course teacher earnings — driven by student bills
    # created/issued rather than attendance (the teacher earns their cut from
    # the beginning when billed, even while student payment is pending,
    # unless cancelled). Uses each PaymentItem's own teacher_percentage
    # (falling back to the teacher's standing percentage if unset) against
    # that item's own amount. The item itself almost never carries a group_id in
    # practice (staff bill the course amount directly, without picking a
    # specific group) — fall back to the course's own teacher when the
    # course teaches through exactly one (see standalone_course_teacher's
    # docstring in _teacher_earnings_context).
    standalone_items = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id, kind='course',
        course_id__in=standalone_course_ids,
    ).exclude(payment__status='cancelled').select_related('group', 'payment')
    if date_from:
        standalone_items = standalone_items.filter(
            Q(payment__paid_at__date__gte=date_from) | (Q(payment__paid_at__isnull=True) & Q(payment__created_at__date__gte=date_from))
        )
    if date_to:
        standalone_items = standalone_items.filter(
            Q(payment__paid_at__date__lte=date_to) | (Q(payment__paid_at__isnull=True) & Q(payment__created_at__date__lte=date_to))
        )
    for item in standalone_items:
        tid = item.group.teacher_id if item.group_id else standalone_course_teacher.get(item.course_id)
        if not tid:
            continue
        p_type = item.pardon_type or getattr(item.payment, 'pardon_type', None)
        if p_type in ('teacher', 'both') or (item.status in ('pardoned', 'pardonned') and not p_type):
            continue
        pct = float(item.teacher_percentage) if item.teacher_percentage is not None else float(teacher_pct.get(tid) or 0)
        total += float(item.amount or 0) * pct / 100

    # Teacher reductions from payments with reduction_target in ('total', 'teacher')
    red_items = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id,
        reduction__gt=0,
        reduction_target__in=('total', 'teacher'),
    ).exclude(payment__status='cancelled').select_related('group', 'book')
    if date_from:
        red_items = red_items.filter(
            Q(payment__paid_at__date__gte=date_from) | (Q(payment__paid_at__isnull=True) & Q(payment__created_at__date__gte=date_from))
        )
    if date_to:
        red_items = red_items.filter(
            Q(payment__paid_at__date__lte=date_to) | (Q(payment__paid_at__isnull=True) & Q(payment__created_at__date__lte=date_to))
        )
    teacher_reduction_deductions = 0.0
    for r_item in red_items:
        tid = None
        pct = None
        if r_item.group_id:
            tid = r_item.group.teacher_id
        elif r_item.course_id:
            tid = standalone_course_teacher.get(r_item.course_id)
        elif r_item.kind == 'book' and r_item.book:
            tid = r_item.book.author_teacher_id
            pct = float(book_pct_by_teacher.get(tid) or 0)

        if not tid:
            continue
        if pct is None:
            pct = float(r_item.teacher_percentage) if r_item.teacher_percentage is not None else float(teacher_pct.get(tid) or 0)

        if r_item.reduction_target == 'teacher':
            teacher_reduction_deductions += float(r_item.reduction)
        elif r_item.reduction_target == 'total':
            teacher_reduction_deductions += float(r_item.reduction) * pct / 100.0

    total = max(0.0, total - teacher_reduction_deductions)
    return round(total, 2)


def compute_teacher_earnings(tenant_id, request, _context=None):
    """What each teacher has earned = their percentage of the per-session
    value of every present-student attendance record across their sessions,
    minus what's already been paid out. A course's per-session value comes
    from course_per_session_price() — so for each present student, the
    teacher earns percentage% of that course's per-session price.

    Driven by attendance rather than payments: a teacher is owed for
    students who actually showed up and were taught, regardless of whether
    that student's invoice has been settled yet — collection is the
    school's problem, not something that should delay a teacher's pay.
    Pass `_context` (from _teacher_earnings_context) to reuse an
    already-built session/course lookup for this tenant/request instead of
    rebuilding it — see compute_teacher_earned_total's docstring."""
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
    session_info, price_per_session, teacher_pct, standalone_course_ids, standalone_course_teacher, teacher_pardoned_pairs = _context or _teacher_earnings_context(tenant_id)

    present_count = {}
    base_value = {}
    for a in attendance:
        info = session_info.get(a.session_id)
        tid = info['teacher_id'] if info else None
        if not tid:
            continue
        # Attendance never earns a standalone course's teacher anything —
        # its cut comes entirely from the standalone_earned stream below.
        if info['course_id'] in standalone_course_ids:
            continue
        present_count[tid] = present_count.get(tid, 0) + 1
        if (a.student_id, info['course_id']) not in teacher_pardoned_pairs:
            base_value[tid] = base_value.get(tid, 0.0) + price_per_session.get(info['course_id'], 0.0)

    payouts = TeacherPayout.objects.filter(tenant_id=tenant_id)
    payouts = filter_by_date_range(payouts, request, 'paid_at')
    paid_out = {}
    for po in payouts:
        paid_out[po.teacher_id] = paid_out.get(po.teacher_id, 0.0) + float(po.amount)

    # Book royalties: PaymentItems for books this teacher authored, on paid
    # bills, times their book_percentage — a second income stream alongside
    # session-teaching earnings, driven by sales rather than attendance so
    # it's computed independently of the attendance loop above. A book item
    # never carries its own teacher_percentage/school_percentage (that's a
    # course-item-only mechanism — see PaymentItem), so its own discount is
    # always 0 here; earlier this used to prorate the *bill's* discount onto
    # the book regardless of which item actually earned it, which wrongly
    # docked a book's royalty for an unrelated course item's family discount
    # in the same multi-item bill.
    book_items = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id, payment__status='paid', kind='book',
        book__author_teacher_id__isnull=False,
    ).select_related('book')
    book_items = filter_by_date_range(book_items, request, 'payment__paid_at__date')
    if teacher_id:
        book_items = book_items.filter(book__author_teacher_id=teacher_id)
    book_revenue = {}
    for item in book_items:
        author_id = item.book.author_teacher_id
        book_revenue[author_id] = book_revenue.get(author_id, 0.0) + float(item.amount)

    # Package/standalone-course earnings: driven by bills created/issued
    # rather than attendance. The teacher earns their cut from the beginning
    # even while student payment is pending, unless the payment is cancelled.
    # Uses each PaymentItem's own teacher_percentage (falling back to the
    # teacher's standing percentage if unset) against that item's own amount,
    # credited to that group/course's teacher.
    standalone_items = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id, kind='course',
        course_id__in=standalone_course_ids,
    ).exclude(payment__status='cancelled').select_related('group', 'payment')
    date_from = request.GET.get('from')
    date_to = request.GET.get('to')
    if date_from:
        standalone_items = standalone_items.filter(
            Q(payment__paid_at__date__gte=date_from) | (Q(payment__paid_at__isnull=True) & Q(payment__created_at__date__gte=date_from))
        )
    if date_to:
        standalone_items = standalone_items.filter(
            Q(payment__paid_at__date__lte=date_to) | (Q(payment__paid_at__isnull=True) & Q(payment__created_at__date__lte=date_to))
        )
    standalone_revenue = {}
    for item in standalone_items:
        tid = item.group.teacher_id if item.group_id else standalone_course_teacher.get(item.course_id)
        if not tid or (teacher_id and tid != teacher_id):
            continue
        p_type = item.pardon_type or getattr(item.payment, 'pardon_type', None)
        if p_type in ('teacher', 'both') or (item.status in ('pardoned', 'pardonned') and not p_type):
            continue
        pct = float(item.teacher_percentage) if item.teacher_percentage is not None else float(teacher_pct.get(tid) or 0)
        standalone_revenue[tid] = standalone_revenue.get(tid, 0.0) + float(item.amount or 0) * pct / 100

    # Reduction deductions per teacher
    red_items = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id,
        reduction__gt=0,
        reduction_target__in=('total', 'teacher'),
    ).exclude(payment__status='cancelled').select_related('group', 'book')
    if date_from:
        red_items = red_items.filter(
            Q(payment__paid_at__date__gte=date_from) | (Q(payment__paid_at__isnull=True) & Q(payment__created_at__date__gte=date_from))
        )
    if date_to:
        red_items = red_items.filter(
            Q(payment__paid_at__date__lte=date_to) | (Q(payment__paid_at__isnull=True) & Q(payment__created_at__date__lte=date_to))
        )
    teacher_reductions = {}
    book_pct_by_teacher = dict(Teacher.objects.filter(tenant_id=tenant_id).values_list('id', 'book_percentage'))
    for r_item in red_items:
        tid = None
        pct = None
        if r_item.group_id:
            tid = r_item.group.teacher_id
        elif r_item.course_id:
            tid = standalone_course_teacher.get(r_item.course_id)
        elif r_item.kind == 'book' and r_item.book:
            tid = r_item.book.author_teacher_id
            pct = float(book_pct_by_teacher.get(tid) or 0)

        if not tid or (teacher_id and tid != teacher_id):
            continue
        if pct is None:
            pct = float(r_item.teacher_percentage) if r_item.teacher_percentage is not None else float(teacher_pct.get(tid) or 0)

        if r_item.reduction_target == 'teacher':
            ded = float(r_item.reduction)
        elif r_item.reduction_target == 'total':
            ded = float(r_item.reduction) * pct / 100.0
        else:
            ded = 0.0
        teacher_reductions[tid] = teacher_reductions.get(tid, 0.0) + ded

    rows = []
    for t in teachers:
        count = present_count.get(t.id, 0)
        pct = float(t.payment_percentage or 0)
        session_earned = base_value.get(t.id, 0.0) * pct / 100
        book_pct = float(t.book_percentage or 0)
        book_earned = round(book_revenue.get(t.id, 0.0) * book_pct / 100, 2)
        standalone_earned = round(standalone_revenue.get(t.id, 0.0), 2)
        earned = round(max(0.0, session_earned + book_earned + standalone_earned - teacher_reductions.get(t.id, 0.0)), 2)
        already = round(paid_out.get(t.id, 0.0), 2)
        rows.append({
            'teacher_id': t.id,
            'teacher_name': f'{t.first_name} {t.last_name}',
            'percentage': pct,
            'present_count': count,
            'book_percentage': book_pct,
            'book_earned': book_earned,
            'standalone_earned': standalone_earned,
            'earned': earned,
            'paid_out': already,
            'balance': round(earned - already, 2),
        })
    return rows


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def teacher_payments_summary(request):
    user = request.user
    require_staff_tenant(user)
    if not user.can_view('teacher_payments'):
        raise PermissionDenied('Forbidden')

    rows = compute_teacher_earnings(user.tenant_id, request)
    if request.GET.get('type') in ('csv', 'xlsx'):
        headers = ['Teacher', 'Percentage', 'Present count', 'Books %', 'Book earned', 'Earned', 'Paid out', 'Balance']
        return export_rows(
            headers,
            [[r['teacher_name'], r['percentage'], r['present_count'], r['book_percentage'], r['book_earned'], r['earned'], r['paid_out'], r['balance']] for r in rows],
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


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def teacher_payments_history(request, teacher_id):
    """Teaching and earnings history for a teacher:
    1. All sessions taught (date, course, group, room, present count, rate, earned)
    2. All package courses taught/billed (date, course, student, invoice, status, amount, teacher cut)
    Plus summary totals for each stream. Supports optional ?from=YYYY-MM-DD&to=YYYY-MM-DD."""
    user = request.user
    tid = require_staff_tenant(user)
    if not user.can_view('teacher_payments') and not user.can_view('teachers'):
        raise PermissionDenied('Forbidden')

    teacher = Teacher.objects.filter(id=teacher_id, tenant_id=tid).first()
    if not teacher:
        raise NotFound('Teacher not found')

    package_course_ids = set(
        Course.objects.filter(tenant_id=tid, kind__in=['package', 'standalone']).values_list('id', flat=True)
    )

    date_from = request.GET.get('from')
    date_to = request.GET.get('to')

    # 1. SESSIONS
    sessions_qs = ClassSession.objects.filter(tenant_id=tid).filter(
        Q(teacher_id=teacher_id) | (Q(teacher__isnull=True) & Q(group__teacher_id=teacher_id))
    ).exclude(
        status='cancelled'
    ).exclude(
        course_id__in=package_course_ids
    ).exclude(
        group__course_id__in=package_course_ids
    ).select_related('course', 'group', 'group__course', 'room_ref').order_by('-start_at')

    if date_from:
        sessions_qs = sessions_qs.filter(start_at__date__gte=date_from)
    if date_to:
        sessions_qs = sessions_qs.filter(start_at__date__lte=date_to)

    session_rows = list(sessions_qs[:1000])
    session_ids = [s.id for s in session_rows]
    attendance_counts = {}
    if session_ids:
        for row in Attendance.objects.filter(
            session_id__in=session_ids, status='present'
        ).values('session_id').annotate(c=Count('id')):
            attendance_counts[row['session_id']] = row['c']

    teacher_pct = float(teacher.payment_percentage or 0)
    sessions_list = []
    sessions_earned_total = 0.0

    for s in session_rows:
        course = s.course or (s.group.course if s.group else None)
        price_per_session = course_per_session_price(course.price, course.pricing_type, course.sessions_count) if course else 0.0
        present_count = attendance_counts.get(s.id, 0)
        earned = round(present_count * price_per_session * teacher_pct / 100, 2)
        sessions_earned_total += earned

        sessions_list.append({
            'id': s.id,
            'start_at': s.start_at.isoformat() if s.start_at else None,
            'end_at': s.end_at.isoformat() if s.end_at else None,
            'course_title': course.title if course else '—',
            'course_id': course.id if course else None,
            'group_name': s.group.name if s.group else '—',
            'group_id': s.group_id,
            'room': s.room or (s.room_ref.name if s.room_ref else '—'),
            'topic': s.topic or '',
            'status': s.status,
            'present_count': present_count,
            'price_per_session': price_per_session,
            'teacher_percentage': teacher_pct,
            'earned': earned,
        })

    # 2. PACKAGES / FORMATIONS
    by_course = {}
    if package_course_ids:
        for course_id, t_id in Group.objects.filter(
            tenant_id=tid, course_id__in=package_course_ids, teacher_id__isnull=False,
        ).values_list('course_id', 'teacher_id'):
            by_course.setdefault(course_id, set()).add(t_id)
    standalone_course_teacher = {cid: next(iter(tids)) for cid, tids in by_course.items() if len(tids) == 1}

    package_items_qs = PaymentItem.objects.filter(
        payment__tenant_id=tid,
        kind='course',
        course_id__in=package_course_ids,
    ).exclude(
        payment__status='cancelled'
    ).select_related('group', 'course', 'payment', 'payment__student')

    if date_from:
        package_items_qs = package_items_qs.filter(
            Q(payment__paid_at__date__gte=date_from) | (Q(payment__paid_at__isnull=True) & Q(payment__created_at__date__gte=date_from))
        )
    if date_to:
        package_items_qs = package_items_qs.filter(
            Q(payment__paid_at__date__lte=date_to) | (Q(payment__paid_at__isnull=True) & Q(payment__created_at__date__lte=date_to))
        )

    packages_list = []
    packages_earned_total = 0.0

    for item in package_items_qs:
        t_id = item.group.teacher_id if item.group_id else standalone_course_teacher.get(item.course_id)
        if t_id != teacher.id:
            continue

        pct = float(item.teacher_percentage) if item.teacher_percentage is not None else teacher_pct
        amount = float(item.amount or 0)
        earned = round(amount * pct / 100, 2)
        packages_earned_total += earned

        dt = item.payment.paid_at or item.payment.created_at
        student = item.payment.student
        packages_list.append({
            'id': item.id,
            'payment_id': item.payment.id,
            'date': dt.isoformat() if dt else None,
            'course_title': item.course.title if item.course else '—',
            'course_id': item.course_id,
            'student_name': f"{student.first_name} {student.last_name}" if student else '—',
            'student_id': item.payment.student_id,
            'invoice_number': item.payment.invoice_number or '—',
            'status': item.payment.status,
            'amount': amount,
            'teacher_percentage': pct,
            'earned': earned,
        })

    packages_list.sort(key=lambda x: x['date'] or '', reverse=True)

    # 3. BOOK ROYALTIES
    book_items = PaymentItem.objects.filter(
        payment__tenant_id=tid, payment__status='paid', kind='book',
        book__author_teacher_id=teacher.id,
    )
    if date_from:
        book_items = book_items.filter(payment__paid_at__date__gte=date_from)
    if date_to:
        book_items = book_items.filter(payment__paid_at__date__lte=date_to)
    book_rev = sum(float(it.amount or 0) for it in book_items)
    book_pct = float(teacher.book_percentage or 0)
    books_earned_total = round(book_rev * book_pct / 100, 2)

    total_earned = round(sessions_earned_total + packages_earned_total + books_earned_total, 2)
    payouts_total = TeacherPayout.objects.filter(tenant_id=tid, teacher_id=teacher.id).aggregate(t=Sum('amount'))['t'] or 0
    payouts_total = round(float(payouts_total), 2)

    return Response({
        'teacher': {
            'id': teacher.id,
            'name': f"{teacher.first_name} {teacher.last_name}",
            'payment_percentage': teacher_pct,
            'book_percentage': book_pct,
        },
        'totals': {
            'sessions_count': len(sessions_list),
            'sessions_earned': round(sessions_earned_total, 2),
            'packages_count': len(packages_list),
            'packages_earned': round(packages_earned_total, 2),
            'books_earned': books_earned_total,
            'total_earned': total_earned,
            'paid_out': payouts_total,
            'balance': round(total_earned - payouts_total, 2),
        },
        'sessions': sessions_list,
        'packages': packages_list,
    })


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def teacher_payment_remove_package_item(request, item_id):
    """Removes a package course PaymentItem. If the parent payment has no remaining
    items, the payment itself is deleted. Otherwise, payment amount and discount are recalculated."""
    user = request.user
    tid = require_staff_tenant(user)
    if not (user.can_modify('teacher_payments') or user.can_delete('teacher_payments') or user.can_modify('payments') or user.can_delete('payments')):
        raise PermissionDenied('Forbidden')

    item = PaymentItem.objects.filter(id=item_id, payment__tenant_id=tid).select_related('payment').first()
    if not item:
        raise NotFound('Payment item not found')

    payment = item.payment
    with transaction.atomic():
        item.delete()
        remaining_items = list(payment.items.all())
        if not remaining_items:
            payment.delete()
        else:
            payment.amount = sum(it.amount for it in remaining_items)
            payment.discount = sum(_payment_item_discount({
                'amount': it.amount,
                'teacher_percentage': it.teacher_percentage,
                'school_percentage': it.school_percentage,
            }) for it in remaining_items)
            payment.save()

    return Response({'message': 'Package item removed successfully'})


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def teacher_payment_remove_session(request, session_id):
    """Deletes a session from teacher history."""
    user = request.user
    tid = require_staff_tenant(user)
    if not (user.can_modify('teacher_payments') or user.can_delete('teacher_payments') or user.can_delete('sessions')):
        raise PermissionDenied('Forbidden')

    session = ClassSession.objects.filter(id=session_id, tenant_id=tid).first()
    if not session:
        raise NotFound('Session not found')

    session.delete()
    return Response({'message': 'Session removed successfully'})


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
        teacher_id = request.data.get('teacher_id')
        try:
            amount = float(request.data.get('amount') or 0)
        except (TypeError, ValueError):
            raise ValidationError({'amount': 'Must be a number.'})
        # Unlike debts_waive (which validates a write-off against the
        # student's actual owed amount server-side), this previously
        # trusted any amount outright — a negative or wildly excessive
        # payout was accepted and corrupted the reported balance.
        if teacher_id and amount > 0:
            rows = compute_teacher_earnings(request.user.tenant_id, request)
            row = next((r for r in rows if r['teacher_id'] == teacher_id), None)
            if row and amount > row['balance'] + BALANCE_THRESHOLD:
                raise ValidationError({
                    'amount': f"Exceeds this teacher's current balance ({row['balance']}).",
                })
        return super().create(request, *args, **kwargs)
