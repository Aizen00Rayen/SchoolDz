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
    ATTENDED_STATUSES,
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


PARDONED_STATUSES = ('pardoned', 'pardonned')


def _item_pardon_type(item):
    """Which party waived this line item: 'teacher', 'school', 'both' or None.
    An item marked pardoned with no explicit type means a full waiver. The
    bill-level type is only used for items that are themselves pardoned, so
    one waived line doesn't spill onto the other lines of the same bill."""
    if item.pardon_type:
        return item.pardon_type
    if item.status in PARDONED_STATUSES:
        return getattr(item.payment, 'pardon_type', None) or 'both'
    return None


def _in_bill_window(qs, date_from, date_to):
    """Bills are dated by paid_at, or created_at while still unpaid."""
    if date_from:
        qs = qs.filter(
            Q(payment__paid_at__date__gte=date_from) | (Q(payment__paid_at__isnull=True) & Q(payment__created_at__date__gte=date_from))
        )
    if date_to:
        qs = qs.filter(
            Q(payment__paid_at__date__lte=date_to) | (Q(payment__paid_at__isnull=True) & Q(payment__created_at__date__lte=date_to))
        )
    return qs


def _teacher_earnings_context(tenant_id):
    """Per-tenant lookup tables shared by every teacher-earnings figure.
    Build it once per request (the dashboard needs ~9 figures) and pass it
    in via `_context`."""
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
    teacher_rows = list(Teacher.objects.filter(tenant_id=tenant_id).values_list('id', 'payment_percentage', 'book_percentage'))
    teacher_pct = {tid: float(p or 0) for tid, p, _ in teacher_rows}
    book_pct = {tid: float(b or 0) for tid, _, b in teacher_rows}
    # Package/standalone courses earn from billing, not attendance.
    standalone_course_ids = set(
        Course.objects.filter(tenant_id=tenant_id, kind__in=['package', 'standalone']).values_list('id', flat=True)
    )

    # Bills rarely carry a group, so a bill line is matched to its teacher
    # by (1) the group the student is enrolled in for that course, then
    # (2) the course's only teacher. Ambiguous cases stay unmatched rather
    # than credited to the wrong teacher.
    by_course = {}
    by_student_course = {}
    for group_id, course_id, teacher_id in Group.objects.filter(
        tenant_id=tenant_id, teacher_id__isnull=False,
    ).values_list('id', 'course_id', 'teacher_id'):
        by_course.setdefault(course_id, set()).add(teacher_id)
    for student_id, course_id, teacher_id in Group.students.through.objects.filter(
        group__tenant_id=tenant_id, group__teacher_id__isnull=False,
    ).values_list('student_id', 'group__course_id', 'group__teacher_id'):
        by_student_course.setdefault((student_id, course_id), set()).add(teacher_id)
    course_teacher = {cid: next(iter(t)) for cid, t in by_course.items() if len(t) == 1}
    student_course_teacher = {k: next(iter(t)) for k, t in by_student_course.items() if len(t) == 1}

    return {
        'session_info': session_info,
        'price_per_session': price_per_session,
        'teacher_pct': teacher_pct,
        'book_pct': book_pct,
        'standalone_course_ids': standalone_course_ids,
        'course_teacher': course_teacher,
        'student_course_teacher': student_course_teacher,
    }


def _item_teacher(item, ctx):
    if item.group_id and item.group and item.group.teacher_id:
        return item.group.teacher_id
    student_id = item.payment.student_id if item.payment else None
    return (ctx['student_course_teacher'].get((student_id, item.course_id))
            or ctx['course_teacher'].get(item.course_id))


def compute_teacher_breakdown(tenant_id, date_from=None, date_to=None, teacher_id=None, group_id=None, _context=None, detail=False):
    """The single teacher-pay engine. Returns {teacher_id: figures}.

    1. Sessions: for every attended student (present or late) in a regular
       course, the teacher earns their % of that course's per-session price.
    2. Books: their book % of every paid sale of a book they authored.
    3. Package/standalone courses: their % of each bill line, from billing.
    4. Waivers: a bill line the teacher waived (teacher/both) covers the
       teacher's share of THAT bill only. Bills carry no period, so the
       waived amount is applied to that student's attended sessions in that
       course in date order: sessions it fully covers are "pardoned" (the
       student is not counted and earns the teacher nothing), a partly
       covered session is reduced. With detail=True each teacher's row also
       has `sessions`: {session_id: attended / pardoned / waived / gross}.
    5. Discounts: "deduct from teacher" takes the discount from the teacher,
       "total" takes their % of it; either way capped at the teacher's share
       of that bill line.
    """
    ctx = _context or _teacher_earnings_context(tenant_id)
    figures = {}

    def row(tid):
        return figures.setdefault(tid, {
            'present_count': 0, 'pardoned_count': 0, 'session_earned': 0.0, 'book_revenue': 0.0, 'book_earned': 0.0,
            'standalone_earned': 0.0, 'waivers': 0.0, 'reductions': 0.0, 'earned': 0.0,
        })

    # 1. Sessions
    attendance = Attendance.objects.filter(tenant_id=tenant_id, status__in=ATTENDED_STATUSES)
    if date_from:
        attendance = attendance.filter(session__start_at__date__gte=date_from)
    if date_to:
        attendance = attendance.filter(session__start_at__date__lte=date_to)
    if group_id:
        attendance = attendance.filter(session__group_id=group_id)
    records = []  # (start, session, teacher, student, course, share)
    for a in attendance.values('session_id', 'student_id', 'session__start_at'):
        info = ctx['session_info'].get(a['session_id'])
        if not info or not info['teacher_id'] or info['course_id'] in ctx['standalone_course_ids']:
            continue
        tid = info['teacher_id']
        share = ctx['price_per_session'].get(info['course_id'], 0.0) * ctx['teacher_pct'].get(tid, 0.0) / 100
        row(tid)['session_earned'] += share
        records.append((a['session__start_at'], a['session_id'], tid, a['student_id'], info['course_id'], share))

    # 2. Books
    book_items = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id, payment__status='paid', kind='book',
        book__author_teacher_id__isnull=False,
    ).select_related('book')
    if date_from:
        book_items = book_items.filter(payment__paid_at__date__gte=date_from)
    if date_to:
        book_items = book_items.filter(payment__paid_at__date__lte=date_to)
    for item in book_items:
        r = row(item.book.author_teacher_id)
        r['book_revenue'] += float(item.amount or 0)
    for tid, r in figures.items():
        r['book_earned'] = round(r['book_revenue'] * ctx['book_pct'].get(tid, 0.0) / 100, 2)

    # 3 + 4 + 5: every non-cancelled course or book line, once.
    items = _in_bill_window(PaymentItem.objects.filter(payment__tenant_id=tenant_id).filter(
        Q(kind='course', course_id__isnull=False) | Q(kind='book', book__author_teacher_id__isnull=False)
    ).exclude(payment__status='cancelled').exclude(status='cancelled').select_related(
        'group', 'payment', 'book'), date_from, date_to)
    waived = {}  # (teacher, student, course) -> teacher share waived
    for item in items:
        amount = float(item.amount or 0)
        if item.kind == 'book':
            if item.payment.status != 'paid':
                continue  # no royalty yet, so nothing to discount
            tid = item.book.author_teacher_id
            pct = ctx['book_pct'].get(tid, 0.0)
        else:
            tid = _item_teacher(item, ctx)
            if not tid:
                continue
            pct = float(item.teacher_percentage) if item.teacher_percentage is not None else ctx['teacher_pct'].get(tid, 0.0)
        teacher_share = amount * pct / 100
        p_type = _item_pardon_type(item)
        teacher_waived = p_type in ('teacher', 'both')

        if item.kind == 'course' and item.course_id in ctx['standalone_course_ids']:
            if not teacher_waived:
                row(tid)['standalone_earned'] += teacher_share
        elif item.kind == 'course' and teacher_waived:
            key = (tid, item.payment.student_id, item.course_id)
            waived[key] = waived.get(key, 0.0) + teacher_share

        reduction = float(item.reduction or 0)
        if reduction > 0 and not teacher_waived and item.reduction_target in ('teacher', 'total'):
            ded = reduction if item.reduction_target == 'teacher' else reduction * pct / 100
            row(tid)['reductions'] += min(ded, teacher_share)

    # Apply each teacher waiver to that student's earliest attended sessions.
    remaining = dict(waived)
    sessions_detail = {}
    for start, session_id, tid, student_id, course_id, share in sorted(records, key=lambda x: (x[0] is None, x[0])):
        left = remaining.get((tid, student_id, course_id), 0.0)
        absorbed = min(left, share) if left > 0.005 else 0.0
        if absorbed:
            remaining[(tid, student_id, course_id)] = left - absorbed
        fully = share > 0 and absorbed >= share - 0.005
        r = row(tid)
        r['waivers'] += absorbed
        if fully:
            r['pardoned_count'] += 1
        else:
            r['present_count'] += 1
        if detail:
            d = r.setdefault('sessions', {}).setdefault(session_id, {'attended': 0, 'pardoned': 0, 'waived': 0.0, 'gross': 0.0})
            d['attended'] += 1
            d['pardoned'] += 1 if fully else 0
            d['waived'] += absorbed
            d['gross'] += share

    for r in figures.values():
        r['session_earned'] = round(r['session_earned'], 2)
        r['standalone_earned'] = round(r['standalone_earned'], 2)
        r['waivers'] = round(r['waivers'], 2)
        r['reductions'] = round(r['reductions'], 2)
        r['earned'] = round(max(0.0, r['session_earned'] + r['book_earned'] + r['standalone_earned']
                                - r['waivers'] - r['reductions']), 2)
    if teacher_id:
        figures = {k: v for k, v in figures.items() if k == teacher_id}
    return figures


def compute_teacher_earned_total(tenant_id, date_from=None, date_to=None, _context=None):
    """Total owed to all teachers in an optional date window (dashboard,
    revenue trend, net profit). Same engine as the Teacher Payments page."""
    breakdown = compute_teacher_breakdown(tenant_id, date_from=date_from, date_to=date_to, _context=_context)
    return round(sum(r['earned'] for r in breakdown.values()), 2)


def compute_teacher_earnings(tenant_id, request, _context=None):
    """Per-teacher rows for the Teacher Payments page: earned (see
    compute_teacher_breakdown), already paid out, and the balance.
    Reads ?from=, ?to=, ?teacher_id= and ?group_id= from the request."""
    teachers = Teacher.objects.filter(tenant_id=tenant_id).order_by('first_name', 'last_name')
    teacher_id = request.GET.get('teacher_id')
    if teacher_id:
        teachers = teachers.filter(id=teacher_id)

    breakdown = compute_teacher_breakdown(
        tenant_id, date_from=request.GET.get('from'), date_to=request.GET.get('to'),
        teacher_id=teacher_id, group_id=request.GET.get('group_id'), _context=_context,
    )

    payouts = filter_by_date_range(TeacherPayout.objects.filter(tenant_id=tenant_id), request, 'paid_at')
    paid_out = {}
    for po in payouts:
        paid_out[po.teacher_id] = paid_out.get(po.teacher_id, 0.0) + float(po.amount)

    empty = {'present_count': 0, 'pardoned_count': 0, 'session_earned': 0.0, 'book_earned': 0.0, 'standalone_earned': 0.0,
             'waivers': 0.0, 'reductions': 0.0, 'earned': 0.0}
    rows = []
    for t in teachers:
        b = breakdown.get(t.id, empty)
        already = round(paid_out.get(t.id, 0.0), 2)
        rows.append({
            'teacher_id': t.id,
            'teacher_name': f'{t.first_name} {t.last_name}',
            'percentage': float(t.payment_percentage or 0),
            'present_count': b['present_count'],
            'pardoned_count': b['pardoned_count'],
            'book_percentage': float(t.book_percentage or 0),
            'session_earned': b['session_earned'],
            'book_earned': b['book_earned'],
            'standalone_earned': b['standalone_earned'],
            'waivers_deducted': b['waivers'],
            'reductions_deducted': b['reductions'],
            'earned': b['earned'],
            'paid_out': already,
            'balance': round(b['earned'] - already, 2),
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
    teacher_pct = float(teacher.payment_percentage or 0)
    # The shared engine decides which students count: attended students the
    # teacher waived (pardoned) are not counted and earn nothing.
    engine = compute_teacher_breakdown(tid, date_from=date_from, date_to=date_to, teacher_id=teacher.id, detail=True).get(teacher.id, {})
    session_detail = engine.get('sessions', {})
    sessions_list = []
    sessions_earned_total = 0.0

    for s in session_rows:
        course = s.course or (s.group.course if s.group else None)
        price_per_session = course_per_session_price(course.price, course.pricing_type, course.sessions_count) if course else 0.0
        d = session_detail.get(s.id, {'attended': 0, 'pardoned': 0, 'waived': 0.0, 'gross': 0.0})
        pardoned_count = d['pardoned']
        present_count = d['attended'] - pardoned_count
        earned = round(max(0.0, d['gross'] - d['waived']), 2)
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
            'pardoned_count': pardoned_count,
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
        waived_by_teacher = _item_pardon_type(item) in ('teacher', 'both')
        earned = 0.0 if waived_by_teacher else round(amount * pct / 100, 2)
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

    # The headline total comes from the shared engine, so it always matches
    # the Teacher Payments table (waivers and discounts included).
    waivers_deducted = engine.get('waivers', 0.0)
    reductions_deducted = engine.get('reductions', 0.0)
    total_earned = round(engine.get('earned', 0.0), 2)
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
            'pardoned_count': engine.get('pardoned_count', 0),
            'packages_count': len(packages_list),
            'packages_earned': round(packages_earned_total, 2),
            'books_earned': books_earned_total,
            'waivers_deducted': waivers_deducted,
            'reductions_deducted': reductions_deducted,
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
