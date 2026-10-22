"""Activity log, finance report and all-time student/teacher reports."""
import os
from types import SimpleNamespace
from datetime import datetime, timedelta
from django.conf import settings
from django.db.models import Q, TextField
from django.db.models.functions import Cast
from django.http import HttpResponse
from django.template.loader import render_to_string
from django.utils import timezone
from weasyprint import HTML
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound
from ..models import (
    Tenant,
    Teacher,
    Student,
    Course,
    Group,
    ClassSession,
    Attendance,
    Payment,
    PaymentItem,
    Expense,
    OtherIncome,
    TeacherPayout,
    ActivityLog,
    StudentInsurance,
)
from ..serializers import ActivityLogSerializer
from .common import (
    ATTENDED_STATUSES,
    EXPENSE_CATEGORY_AR,
    INVOICE_CURRENCY_AR,
    INVOICE_KIND_AR,
    INVOICE_STATUS_AR,
    OTHER_INCOME_CATEGORY_AR,
    course_per_session_price,
    export_rows,
    filter_by_date_range,
    logger,
    name_search_q,
    require_staff_tenant,
)
from .attendance import (
    _file_data_uri,
)
from .payments import (
    _payment_item_discount,
    compute_student_balances,
)
from .teacher_payments import (
    compute_teacher_earnings,
)


# ------------------------------------------------------------ Activity log

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def activity_logs(request):
    user = request.user
    require_staff_tenant(user)
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

def compute_realized_revenue(tid, request):
    """
    Computes accrual/realized revenue based on session attendance:
    When a student pays upfront (e.g. 4000 DZD for 4 monthly sessions), the cash
    is deferred until the student actually attends sessions (present or late).
    Upon attendance, each session's value (e.g. 1000 DZD) is deducted from their
    payment credit:
      - Teacher's commission percentage (e.g. 50% = 500 DZD)
      - Institute Realized Revenue (e.g. 50% = 500 DZD)
    Unconsumed payments remain as Deferred Revenue.
    """
    student_course_paid = {}
    try:
        paid_items = PaymentItem.objects.filter(
            payment__tenant_id=tid, course_id__isnull=False,
        ).filter(
            Q(status='paid') | Q(payment__status='paid') |
            Q(status='partial') | Q(payment__status='partial')
        ).exclude(status='cancelled').exclude(payment__status='cancelled').select_related('payment')

        for it in paid_items:
            net_paid = max(0.0, float(it.amount or 0) - _payment_item_discount(it))
            if net_paid > 0 and it.payment and it.payment.student_id:
                key = (it.payment.student_id, it.course_id)
                student_course_paid[key] = student_course_paid.get(key, 0.0) + net_paid
    except Exception as e:
        logger.warning(f"Error computing student_course_paid: {e}")

    try:
        attendance_qs = Attendance.objects.filter(
            tenant_id=tid, status__in=ATTENDED_STATUSES
        ).exclude(session__status='cancelled').select_related(
            'session', 'student', 'session__group', 'session__group__teacher',
            'session__group__course', 'session__course', 'session__teacher'
        )

        group_id = request.GET.get('group_id')
        if group_id:
            attendance_qs = attendance_qs.filter(session__group_id=group_id)

        teacher_id = request.GET.get('teacher_id')
        if teacher_id:
            attendance_qs = attendance_qs.filter(
                Q(session__teacher_id=teacher_id) | (Q(session__teacher_id__isnull=True) & Q(session__group__teacher_id=teacher_id))
            )

        all_att = list(attendance_qs.order_by('session__start_at'))
    except Exception as e:
        logger.warning(f"Error querying attendance in compute_realized_revenue: {e}")
        all_att = []

    date_from_str = request.GET.get('from')
    date_to_str = request.GET.get('to')
    date_from = None
    date_to = None
    if date_from_str:
        try:
            date_from = datetime.strptime(date_from_str[:10], '%Y-%m-%d').date()
        except Exception:
            pass
    if date_to_str:
        try:
            date_to = datetime.strptime(date_to_str[:10], '%Y-%m-%d').date()
        except Exception:
            pass

    student_course_pardons = {}
    try:
        pardon_items = PaymentItem.objects.filter(
            payment__tenant_id=tid, course_id__isnull=False,
        ).exclude(status='cancelled').exclude(payment__status='cancelled').values(
            'payment__student_id', 'course_id', 'pardon_type', 'payment__pardon_type'
        )
        for pi in pardon_items:
            ptype = pi.get('pardon_type') or pi.get('payment__pardon_type')
            if ptype:
                student_course_pardons[(pi['payment__student_id'], pi['course_id'])] = ptype
    except Exception:
        pass

    consumed_by_sc = {}
    realized_tuition = 0.0
    realized_teacher = 0.0
    realized_sessions_count = 0
    session_realizations = []
    course_breakdown = {}

    for att in all_att:
        sess = getattr(att, 'session', None)
        if not sess:
            continue
        course = sess.course or (sess.group.course if sess.group else None)
        if not course:
            continue

        c_id = course.id
        s_id = att.student_id

        session_price = course_per_session_price(course.price, course.pricing_type, course.sessions_count)

        teacher = sess.teacher or (sess.group.teacher if sess.group else None)
        t_pct = float(teacher.payment_percentage or 50) if teacher else 50.0
        s_pct = max(0.0, 100.0 - t_pct)

        p_type = student_course_pardons.get((s_id, c_id))
        if p_type == 'both':
            s_pct = 0.0
            t_pct = 0.0
        elif p_type == 'school':
            s_pct = 0.0
        elif p_type == 'teacher':
            t_pct = 0.0

        school_cut = session_price * (s_pct / 100.0)
        teacher_cut = session_price * (t_pct / 100.0)

        total_paid = student_course_paid.get((s_id, c_id), 0.0)
        prior_consumed = consumed_by_sc.get((s_id, c_id), 0.0)
        available = max(0.0, total_paid - prior_consumed)

        if available >= session_price and session_price > 0:
            funded_ratio = 1.0
            consumed_from_payment = session_price
        elif available > 0 and session_price > 0:
            funded_ratio = available / session_price
            consumed_from_payment = available
        else:
            funded_ratio = 0.0
            consumed_from_payment = 0.0

        consumed_by_sc[(s_id, c_id)] = prior_consumed + session_price

        if sess.start_at:
            sess_dt = timezone.localtime(sess.start_at) if timezone.is_aware(sess.start_at) else sess.start_at
            sess_date = sess_dt.date()
        else:
            sess_date = None

        if date_from and (not sess_date or sess_date < date_from):
            continue
        if date_to and (not sess_date or sess_date > date_to):
            continue

        actual_school_rev = round(school_cut * (funded_ratio if total_paid > 0 else 1.0), 2)
        actual_teacher_earned = round(teacher_cut, 2)

        realized_tuition += actual_school_rev
        realized_teacher += actual_teacher_earned
        realized_sessions_count += 1

        student_name = f"{att.student.first_name} {att.student.last_name}".strip() if att.student else "—"
        group_name = sess.group.name if sess.group else "—"

        session_realizations.append({
            'id': att.id,
            'date': sess.start_at.strftime('%Y-%m-%d %H:%M') if sess.start_at else '',
            'student_id': s_id,
            'student_name': student_name,
            'course_id': c_id,
            'course_title': course.title,
            'group_name': group_name,
            'session_value': round(session_price, 2),
            'school_revenue': actual_school_rev,
            'teacher_cut': actual_teacher_earned,
            'funded': funded_ratio >= 1.0,
            'consumed_from_payment': round(consumed_from_payment, 2),
        })

        cb = course_breakdown.setdefault(c_id, {
            'course_id': c_id,
            'title': course.title,
            'sessions_count': 0,
            'realized_revenue': 0.0,
            'teacher_payout': 0.0,
            'total_value': 0.0,
        })
        cb['sessions_count'] += 1
        cb['realized_revenue'] = round(cb['realized_revenue'] + actual_school_rev, 2)
        cb['teacher_payout'] = round(cb['teacher_payout'] + actual_teacher_earned, 2)
        cb['total_value'] = round(cb['total_value'] + session_price, 2)

    session_realizations.sort(key=lambda x: x['date'] or '', reverse=True)

    deferred_tuition = 0.0
    for key, paid_amt in student_course_paid.items():
        consumed = consumed_by_sc.get(key, 0.0)
        remaining = max(0.0, paid_amt - consumed)
        deferred_tuition += remaining

    return {
        'realized_tuition': round(realized_tuition, 2),
        'deferred_tuition': round(deferred_tuition, 2),
        'realized_teacher': round(realized_teacher, 2),
        'realized_sessions_count': realized_sessions_count,
        'session_realizations': session_realizations,
        'course_breakdown': list(course_breakdown.values()),
    }


def _compute_finance_report_data(tid, request):
    """Payments + expenses + net for a date range, optionally narrowed to
    one group or teacher — the shared core behind finance_report (JSON +
    Excel) and finance_report_print (the monthly PDF). Reads from/to/
    group_id/teacher_id off request.GET, same as filter_by_date_range and
    compute_teacher_earnings already do."""
    payments_base = Payment.objects.filter(tenant_id=tid).select_related('student').prefetch_related('items')
    group_id = request.GET.get('group_id')
    if group_id:
        # A bill matches (and counts in full — see the docstring above,
        # this doesn't try to split a bill's total across its items) if
        # ANY of its items belong to the group/teacher, since a bill can
        # now cover several groups/courses at once via PaymentItem.
        payments_base = payments_base.filter(items__group_id=group_id).distinct()
    teacher_id = request.GET.get('teacher_id')
    if teacher_id:
        payments_base = payments_base.filter(items__group__teacher_id=teacher_id).distinct()

    # 'partial' counts as collected money (see compute_student_balances), so
    # it belongs in `paid`; only a still-fully-unpaid 'pending' invoice is
    # genuinely outstanding.
    #
    # Each status group is scoped by whichever date actually means "this
    # transaction happened in the requested window" for it: a paid/partial
    # bill by paid_at (the same field dashboard_summary's revenue figures
    # use, so "this month's collected" means the same thing on both pages —
    # due_date is never set by the real payment form, so filtering paid
    # bills by it silently excluded every real invoice); a still-unpaid
    # pending bill has no paid_at at all, so due_date (matching
    # payments_overdue elsewhere) is the only date that means anything for it.
    paid = list(filter_by_date_range(payments_base.filter(status__in=('paid', 'partial', 'pardoned')), request, 'paid_at'))
    outstanding = list(filter_by_date_range(payments_base.filter(status='pending'), request, 'due_date'))
    # Cancelled/refunded bills don't count toward collected/outstanding
    # (see compute_student_balances's write-off comment), but still belong
    # in the "every money movement" transactions list below if they were
    # genuinely collected at some point — scoped by paid_at for the same
    # reason a written-off debt is gated on paid_at IS NOT NULL elsewhere.
    voided = list(filter_by_date_range(
        payments_base.filter(status__in=('cancelled', 'refunded'), paid_at__isnull=False), request, 'paid_at',
    ))
    payments = paid + outstanding + voided
    collected = 0.0
    for p in paid:
        if p.status == 'partial':
            items = getattr(p, '_prefetched_objects_cache', {}).get('items')
            if items is None:
                items = list(p.items.all())
            paid_sum = sum(
                max(0.0, float(it.amount or 0) - _payment_item_discount(it))
                for it in items if it.status == 'paid'
            )
            collected += paid_sum
        else:
            collected += max(0.0, float(p.amount) - float(p.discount or 0))
    collected = round(collected, 2)
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

    # Other Incomes — like expenses, belongs to the school as a whole (not scoped to group or teacher)
    other_incomes = OtherIncome.objects.filter(tenant_id=tid).select_related('category')
    other_incomes = filter_by_date_range(other_incomes, request, 'received_at')
    other_income_total = 0.0 if scoped_to_subset else round(sum(float(oi.amount) for oi in other_incomes), 2)

    other_income_by_category = {}
    if not scoped_to_subset:
        for oi in other_incomes:
            label = (oi.category.key or oi.category.name) if oi.category else 'uncategorized'
            other_income_by_category[label] = round(other_income_by_category.get(label, 0.0) + float(oi.amount), 2)

    teacher_rows = compute_teacher_earnings(tid, request)
    teacher_total = round(sum(r['earned'] for r in teacher_rows), 2)

    # Insurances collected in window (tracked separately from tuition revenue,
    # excluded from net profit calculations).
    insurances_qs = StudentInsurance.objects.filter(tenant_id=tid).select_related('student')
    insurances_qs = filter_by_date_range(insurances_qs, request, 'paid_at')
    if group_id:
        insurances_qs = insurances_qs.filter(student__group_memberships__group_id=group_id)
    if teacher_id:
        insurances_qs = insurances_qs.filter(student__group_memberships__group__teacher_id=teacher_id)
    insurance_list = list(insurances_qs)
    insurance_total = round(sum(float(ins.amount or 0) for ins in insurance_list), 2)

    # Every individual money movement in the window — every payment
    # (whatever its status) plus every expense — so the tenant can see
    # exactly what happened, not just the totals. Expenses are left out
    # when scoped to a group/teacher for the same reason expense_total is
    # zeroed above: they aren't scoped that way, so including them here
    # would misleadingly suggest they belong to that subset.
    transactions = []
    for p in payments:
        item_kinds = {it.kind for it in p.items.all()}
        bill_kind = next(iter(item_kinds)) if len(item_kinds) == 1 else 'mixed'
        transactions.append({
            'date': (p.paid_at.isoformat() if p.paid_at else None) or (p.due_date.isoformat() if p.due_date else None),
            'type': 'revenue',
            'kind': bill_kind,
            'status': p.status,
            'description': f'{p.student.first_name} {p.student.last_name}' if p.student else p.invoice_number,
            'reference': p.invoice_number,
            'amount': round(float(p.amount) - float(p.discount or 0), 2),
        })
    for ins in insurance_list:
        st = ins.student
        transactions.append({
            'date': ins.paid_at.isoformat() if ins.paid_at else None,
            'type': 'insurance',
            'kind': 'insurance',
            'status': 'paid',
            'description': f'{st.first_name} {st.last_name}' if st else 'Insurance',
            'reference': ins.academic_year or 'Insurance',
            'amount': round(float(ins.amount or 0), 2),
        })
    if not scoped_to_subset:
        for oi in other_incomes:
            transactions.append({
                'date': oi.received_at.isoformat() if oi.received_at else None,
                'type': 'other_income',
                'kind': (oi.category.key or oi.category.name) if oi.category else 'uncategorized',
                'status': 'paid',
                'description': oi.title,
                'reference': None,
                'amount': round(float(oi.amount), 2),
            })
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

    realized_info = compute_realized_revenue(tid, request)

    return {
        'collected': collected,
        'outstanding': pending_amount,
        'insurances': insurance_total,
        'other_income': other_income_total,
        'other_income_by_category': other_income_by_category,
        'expenses': expense_total,
        'expenses_by_category': by_category,
        'teacher_earnings': teacher_total,
        'net': round(collected + other_income_total - expense_total - teacher_total, 2),
        'payments_count': len(paid),
        'expenses_scoped_out': scoped_to_subset,
        'teachers': teacher_rows,
        'transactions': transactions,

        # Realized (Accrual) Revenue Engine
        'realized_tuition': realized_info.get('realized_tuition', 0.0),
        'deferred_tuition': realized_info.get('deferred_tuition', 0.0),
        'realized_total': round(realized_info.get('realized_tuition', 0.0) + other_income_total, 2),
        'realized_net': round(realized_info.get('realized_tuition', 0.0) + other_income_total - expense_total, 2),
        'realized_teacher': realized_info.get('realized_teacher', 0.0),
        'realized_sessions_count': realized_info.get('realized_sessions_count', 0),
        'session_realizations': realized_info.get('session_realizations', []),
        'course_breakdown': realized_info.get('course_breakdown', []),
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def finance_report(request):
    """Payments + expenses + net for a date range, optionally narrowed to one
    group or teacher. Backs the Reports page and its Excel export."""
    user = request.user
    tid = require_staff_tenant(user)
    if not user.can_view('reports'):
        raise PermissionDenied('Forbidden')

    result = _compute_finance_report_data(tid, request)

    if request.GET.get('type') in ('csv', 'xlsx'):
        headers = ['Metric', 'Amount', 'Kind', 'Status', 'Description', 'Reference']
        rows = [
            ['Collected', result['collected'], '', '', '', ''],
            ['Insurances entered', result['insurances'], '', '', '', ''],
            ['Other income', result['other_income'], '', '', '', ''],
            ['Outstanding', result['outstanding'], '', '', '', ''],
            ['Expenses', result['expenses'], '', '', '', ''],
            ['Teacher earnings', result['teacher_earnings'], '', '', '', ''],
            ['Net', result['net'], '', '', '', ''],
        ] + [[f'Other income — {k}', v, '', '', '', ''] for k, v in sorted(result['other_income_by_category'].items())] + [[f'Expenses — {k}', v, '', '', '', ''] for k, v in sorted(result['expenses_by_category'].items())]
        rows.append(['', '', '', '', '', ''])
        rows.append(['Transactions', 'Amount', 'Kind', 'Status', 'Description', 'Reference'])
        rows += [[
            t['date'] or '', t['amount'], f"{t['type']}: {t['kind']}", t['status'] or '', t['description'], t['reference'] or '',
        ] for t in result['transactions']]
        return export_rows(headers, rows, 'financial-report', request.GET.get('type'))

    return Response(result)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def finance_report_print(request):
    """PDF version of the finance report, scoped to a single calendar month
    ("similar to the bill we give students" — same branded/RTL invoice
    look, but for the tenant's own monthly totals + transaction list rather
    than one student's bill). Reuses _compute_finance_report_data by
    synthesizing ?from=/?to= for the requested month onto a mutable copy of
    request.GET, so the numbers are guaranteed identical to what the
    on-screen Reports page and Excel export would show for that month."""
    user = request.user
    tid = require_staff_tenant(user)
    if not user.can_view('reports'):
        raise PermissionDenied('Forbidden')

    month_str = request.GET.get('month')
    try:
        if month_str:
            year, month = (int(p) for p in month_str.split('-'))
        else:
            today = timezone.now()
            year, month = today.year, today.month
        if not (1 <= month <= 12):
            raise ValueError
    except (TypeError, ValueError):
        raise ValidationError({'month': 'month must be YYYY-MM'})

    first_day = datetime(year, month, 1)
    next_month_first = datetime(year + 1, 1, 1) if month == 12 else datetime(year, month + 1, 1)
    last_day = next_month_first - timedelta(days=1)

    scoped_get = request.GET.copy()
    scoped_get['from'] = first_day.strftime('%Y-%m-%d')
    scoped_get['to'] = last_day.strftime('%Y-%m-%d')
    request.GET = scoped_get

    result = _compute_finance_report_data(tid, request)

    tenant = Tenant.objects.filter(id=tid).first()
    logo_data_uri = None
    if tenant and tenant.logo_url:
        filename = tenant.logo_url.rsplit('/', 1)[-1]
        logo_data_uri = _file_data_uri(os.path.join(settings.MEDIA_ROOT, 'logos', filename))

    currency = (tenant.currency if tenant else None) or 'DZD'
    currency_label = INVOICE_CURRENCY_AR.get(currency, currency)

    def fmt(amount):
        return f'{amount:,.2f}'

    # Pre-resolved into display strings here rather than in the template —
    # Django templates can't do a dynamic dict[key] lookup without a custom
    # filter (same constraint as session_sheet.html elsewhere in this app).
    by_category = [
        {'label': EXPENSE_CATEGORY_AR.get(key, key.replace('_', ' ').title()), 'amount': fmt(amount)}
        for key, amount in sorted(result['expenses_by_category'].items(), key=lambda kv: -kv[1])
    ]
    other_income_by_category = [
        {'label': OTHER_INCOME_CATEGORY_AR.get(key, key.replace('_', ' ').title()), 'amount': fmt(amount)}
        for key, amount in sorted(result.get('other_income_by_category', {}).items(), key=lambda kv: -kv[1])
    ]
    transactions = [{
        'date': datetime.fromisoformat(t['date']).strftime('%d/%m/%Y') if t['date'] else '—',
        'description': t['description'],
        'reference': t['reference'],
        'kind_label': (OTHER_INCOME_CATEGORY_AR.get(t['kind'], t['kind']) if t['type'] == 'other_income' else EXPENSE_CATEGORY_AR.get(t['kind'], t['kind']) if t['type'] == 'expense' else INVOICE_KIND_AR.get(t['kind'], t['kind'])),
        'status_label': INVOICE_STATUS_AR.get(t['status'], t['status']) if t['status'] else None,
        'is_expense': t['type'] == 'expense',
        'amount': fmt(t['amount']),
    } for t in result['transactions']]

    context = {
        'primary_color': (tenant.primary_color if tenant else None) or '#0A0A0B',
        'accent_color': (tenant.accent_color if tenant else None) or '#E53935',
        'tenant_name': tenant.name if tenant else '',
        'tenant_initial': ((tenant.name if tenant else None) or 'S')[0].upper(),
        'logo_data_uri': logo_data_uri,
        'printed_at': timezone.localtime(timezone.now()).strftime('%d/%m/%Y %H:%M'),
        'month_label': f'{month:02d}/{year}',
        'currency_label': currency_label,
        'collected': fmt(result['collected']),
        'outstanding': fmt(result['outstanding']),
        'insurances': fmt(result['insurances']),
        'other_income': fmt(result.get('other_income', 0)),
        'expenses': fmt(result['expenses']),
        'teacher_earnings': fmt(result['teacher_earnings']),
        'net': fmt(result['net']),
        'expenses_scoped_out': result['expenses_scoped_out'],
        'by_category': by_category,
        'other_income_by_category': other_income_by_category,
        'transactions': transactions,
    }

    html_string = render_to_string('finance_report.html', context)
    pdf_bytes = HTML(string=html_string).write_pdf()

    response = HttpResponse(pdf_bytes, content_type='application/pdf')
    response['Content-Disposition'] = 'inline; filename="financial-report.pdf"'
    return response


# ------------------------------------------------------- All-Time Reports & Archive

def _teacher_subject_label(teacher):
    """Teacher.subjects is a JSON list; the Reports page shows one string."""
    subjects = teacher.subjects
    if isinstance(subjects, (list, tuple)):
        return ', '.join(str(x) for x in subjects if x) or None
    return str(subjects) if subjects else None


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def reports_search(request):
    """Searches students and teachers for all-time reports in the Reports page."""
    user = request.user
    tid = require_staff_tenant(user)
    if not user.can_view('reports'):
        raise PermissionDenied('Forbidden')

    q = (request.GET.get('q') or '').strip()
    if not q:
        students = Student.objects.filter(tenant_id=tid).order_by('-created_at')[:25]
        teachers = Teacher.objects.filter(tenant_id=tid).order_by('-created_at')[:25]
    else:
        student_name_q = name_search_q(q, 'first_name', 'last_name', 'first_name_latin', 'last_name_latin')
        student_q = (
            student_name_q |
            Q(student_code__icontains=q) |
            Q(phone__icontains=q) |
            Q(email__icontains=q)
        )
        # Arabic normalization fallback (e.g. أ / إ / آ -> ا, ة -> ه, ى -> ي)
        alt_q = q.replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا').replace('ة', 'ه').replace('ى', 'ي')
        if alt_q != q:
            student_q |= name_search_q(alt_q, 'first_name', 'last_name', 'first_name_latin', 'last_name_latin')

        students = Student.objects.filter(tenant_id=tid).filter(student_q)[:30]

        teacher_name_q = name_search_q(q, 'first_name', 'last_name')
        teacher_q = (
            teacher_name_q |
            Q(phone__icontains=q) |
            Q(subjects_text__icontains=q) |
            Q(email__icontains=q)
        )
        if alt_q != q:
            teacher_q |= name_search_q(alt_q, 'first_name', 'last_name')

        teachers = Teacher.objects.filter(tenant_id=tid).annotate(
            subjects_text=Cast('subjects', output_field=TextField())
        ).filter(teacher_q)[:30]

    return Response({
        'students': [{
            'id': s.id,
            'name': f"{s.first_name} {s.last_name}".strip(),
            'first_name': s.first_name,
            'last_name': s.last_name,
            'first_name_latin': s.first_name_latin,
            'last_name_latin': s.last_name_latin,
            'code': s.student_code,
            'phone': s.phone,
            'school_level': s.school_level,
            'school_year': s.school_year,
            'specialty': s.specialty,
            'status': s.status,
        } for s in students],
        'teachers': [{
            'id': t.id,
            'name': f"{t.first_name} {t.last_name}".strip(),
            'first_name': t.first_name,
            'last_name': t.last_name,
            'phone': t.phone,
            'subject': _teacher_subject_label(t),
            'status': t.status,
        } for t in teachers],
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def reports_student_detail(request, student_id):
    """Comprehensive all-time report for one student: payments, debts,
    enrolled courses, and attendance session history."""
    user = request.user
    tid = require_staff_tenant(user)
    if not user.can_view('reports'):
        raise PermissionDenied('Forbidden')

    student = Student.objects.filter(id=student_id, tenant_id=tid).select_related('parent').first()
    if not student:
        raise NotFound('Student not found')

    # All-time running balance
    balances = compute_student_balances(tid)
    balance_info = balances.get(student_id, {'paid': 0.0, 'cost': 0.0, 'balance': 0.0, 'status': 'settled'})

    # All payments / invoices
    payments_qs = Payment.objects.filter(tenant_id=tid, student_id=student_id).prefetch_related('items__course', 'items__trip', 'items__book', 'items__group').order_by('-created_at')
    invoices = []
    total_paid_cash = 0.0
    total_pending_debt = 0.0

    for p in payments_qs:
        p_items = list(p.items.all())
        items_data = []
        p_paid = 0.0
        p_pending = 0.0
        for it in p_items:
            it_disc = _payment_item_discount(it)
            it_net = max(0.0, float(it.amount or 0) - it_disc)
            if it.status in ('paid', 'partial') or (not it.status and p.status in ('paid', 'partial')):
                p_paid += it_net
            elif it.status == 'pending' or (not it.status and p.status == 'pending'):
                p_pending += it_net

            cid = it.course_id or (it.group.course_id if it.group else None)
            title = it.course.title if it.course else (it.trip.title if it.trip else (it.book.title if it.book else it.kind))
            items_data.append({
                'id': it.id,
                'course_id': cid,
                'title': title,
                'kind': it.kind,
                'amount': float(it.amount),
                'discount': it_disc,
                'net_amount': it_net,
                'status': it.status,
            })

        if not p_items:
            disc = float(p.discount or 0)
            net = max(0.0, float(p.amount or 0) - disc)
            if p.status in ('paid', 'partial'):
                p_paid = net
            elif p.status == 'pending':
                p_pending = net
            if p.course_id and p.status in ('paid', 'partial'):
                items_data.append({
                    'id': p.id,
                    'course_id': p.course_id,
                    'title': p.course.title if p.course else p.kind,
                    'kind': p.kind,
                    'amount': float(p.amount),
                    'discount': disc,
                    'net_amount': net,
                    'status': p.status,
                })

        total_paid_cash += p_paid
        total_pending_debt += p_pending

        invoices.append({
            'id': p.id,
            'invoice_number': p.invoice_number,
            'created_at': p.created_at.isoformat() if p.created_at else None,
            'paid_at': p.paid_at.isoformat() if p.paid_at else None,
            'due_date': p.due_date.isoformat() if p.due_date else None,
            'amount': float(p.amount),
            'discount': float(p.discount or 0),
            'paid_amount': round(p_paid, 2),
            'pending_amount': round(p_pending, 2),
            'status': p.status,
            'method': p.method,
            'notes': p.notes,
            'items': items_data,
        })

    # Enrolled courses and session breakdown
    groups = Group.objects.filter(tenant_id=tid, students__id=student_id).select_related('course', 'teacher')
    
    # Calculate attendance
    attendances_qs = Attendance.objects.filter(
        tenant_id=tid, student_id=student_id
    ).select_related('session__group', 'session__course', 'session__teacher', 'session__room_ref').order_by('-session__start_at')
    
    attendance_by_group = {}
    sessions_history = []
    for a in attendances_qs:
        s = a.session
        gid = s.group_id
        if gid:
            if gid not in attendance_by_group:
                attendance_by_group[gid] = {'present': 0, 'absent': 0, 'excused': 0, 'total': 0}
            attendance_by_group[gid]['total'] += 1
            if a.status in ('present', 'late'):
                attendance_by_group[gid]['present'] += 1
            elif a.status == 'absent':
                attendance_by_group[gid]['absent'] += 1
            elif a.status == 'excused':
                attendance_by_group[gid]['excused'] += 1

        teacher_name = f"{s.teacher.first_name} {s.teacher.last_name}" if s.teacher else (f"{s.group.teacher.first_name} {s.group.teacher.last_name}" if s.group and s.group.teacher else '—')
        sessions_history.append({
            'id': a.id,
            'session_id': s.id,
            'date': s.start_at.isoformat() if s.start_at else None,
            'group_name': s.group.name if s.group else '—',
            'course_title': s.course.title if s.course else (s.group.course.title if s.group and s.group.course else '—'),
            'teacher_name': teacher_name,
            'status': a.status,
            'recovery_status': a.recovery_status,
            'note': a.note,
        })

    # Group paid amounts
    paid_by_course = {}
    for inv in invoices:
        for it in inv['items']:
            cid = it.get('course_id')
            if cid and it['status'] in ('paid', 'partial'):
                paid_by_course[cid] = paid_by_course.get(cid, 0.0) + it['net_amount']

    courses = []
    for g in groups:
        course = g.course
        session_price = course_per_session_price(course.price, course.pricing_type, course.sessions_count) if course else 0.0
        course_paid = paid_by_course.get(course.id if course else None, 0.0)
        att = attendance_by_group.get(g.id, {'present': 0, 'absent': 0, 'excused': 0, 'total': 0})
        attended_count = att['present']
        sessions_covered = int(course_paid / session_price) if session_price > 0 else (course.sessions_count or 0 if course else 0)
        sessions_remaining = max(0, sessions_covered - attended_count)
        credit_remaining = round(max(0.0, course_paid - (attended_count * session_price)), 2)

        courses.append({
            'group_id': g.id,
            'group_name': g.name,
            'course_id': g.course_id,
            'course_title': course.title if course else '—',
            'teacher_name': f"{g.teacher.first_name} {g.teacher.last_name}" if g.teacher else '—',
            'pricing_type': course.pricing_type if course else 'fixed_sessions',
            'course_price': float(course.price or 0) if course else 0.0,
            'sessions_count': course.sessions_count or 0 if course else 0,
            'cost_per_session': session_price,
            'amount_paid': round(course_paid, 2),
            'sessions_covered': sessions_covered,
            'sessions_attended': attended_count,
            'sessions_absent': att['absent'],
            'sessions_excused': att['excused'],
            'sessions_remaining': sessions_remaining,
            'credit_remaining': credit_remaining,
        })

    return Response({
        'student': {
            'id': student.id,
            'name': f"{student.first_name} {student.last_name}",
            'code': student.student_code,
            'phone': student.phone,
            'email': student.email,
            'school_level': student.school_level,
            'school_year': student.school_year,
            'specialty': student.specialty,
            'status': student.status,
            'created_at': student.created_at.isoformat() if student.created_at else None,
            'parent_name': student.parent.name if student.parent else None,
            'parent_phone': student.parent.phone if student.parent else None,
        },
        'financial_summary': {
            'total_paid': round(total_paid_cash, 2),
            'total_debt': round(max(total_pending_debt, abs(balance_info['balance']) if balance_info['status'] == 'owes' else 0.0), 2),
            'total_cost': round(balance_info['cost'], 2),
            'balance': balance_info['balance'],
            'balance_status': balance_info['status'],
        },
        'courses': courses,
        'invoices': invoices,
        'sessions_history': sessions_history[:150],
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def reports_teacher_detail(request, teacher_id):
    """Comprehensive all-time report for one teacher: courses/groups taught,
    sessions conducted, total earnings accrued, payouts received, and balance."""
    user = request.user
    tid = require_staff_tenant(user)
    if not user.can_view('reports'):
        raise PermissionDenied('Forbidden')

    teacher = Teacher.objects.filter(id=teacher_id, tenant_id=tid).first()
    if not teacher:
        raise NotFound('Teacher not found')

    # All groups taught by this teacher
    groups = list(Group.objects.filter(tenant_id=tid, teacher_id=teacher_id).select_related('course'))
    group_ids = [g.id for g in groups]

    # Sessions conducted
    sessions = list(ClassSession.objects.filter(
        Q(teacher_id=teacher_id) | Q(group_id__in=group_ids),
        tenant_id=tid,
    ).select_related('course', 'group', 'room_ref').order_by('-start_at'))
    session_ids = [s.id for s in sessions]

    # Attendances for those sessions
    attendances = list(Attendance.objects.filter(
        tenant_id=tid,
        session_id__in=session_ids
    ).values('session_id', 'status'))

    att_by_session = {}
    for a in attendances:
        sid = a['session_id']
        if sid not in att_by_session:
            att_by_session[sid] = {'present': 0, 'absent': 0, 'excused': 0}
        if a['status'] in ('present', 'late'):
            att_by_session[sid]['present'] += 1
        elif a['status'] == 'absent':
            att_by_session[sid]['absent'] += 1
        elif a['status'] == 'excused':
            att_by_session[sid]['excused'] += 1

    # Payouts to this teacher
    payouts = list(TeacherPayout.objects.filter(tenant_id=tid, teacher_id=teacher_id).order_by('-paid_at'))
    total_paid_out = sum(float(p.amount or 0) for p in payouts)

    # Earnings: same engine as the Teacher Payments page (sessions, book
    # royalties, standalone courses, waivers and reductions), so both pages
    # always show the same figure for this teacher.
    earnings_request = SimpleNamespace(GET={'teacher_id': teacher_id})
    earnings_rows = compute_teacher_earnings(tid, earnings_request)
    earnings = earnings_rows[0] if earnings_rows else {}
    total_earned = float(earnings.get('earned') or 0)
    total_revenue_generated = 0.0

    # Course pricing lookup
    course_ids = {g.course_id for g in groups if g.course_id}
    for s in sessions:
        if s.course_id:
            course_ids.add(s.course_id)
    courses_dict = {c.id: c for c in Course.objects.filter(tenant_id=tid, id__in=course_ids)}

    # Session earnings (regular courses)
    for s in sessions:
        cid = s.course_id or (s.group.course_id if s.group else None)
        c = courses_dict.get(cid)
        if not c:
            continue
        session_price = course_per_session_price(c.price, c.pricing_type, c.sessions_count)
        pres_count = att_by_session.get(s.id, {}).get('present', 0)
        session_rev = pres_count * session_price
        if c.kind not in ('package', 'standalone'):
            total_revenue_generated += session_rev

    # Package/standalone earnings
    package_items = PaymentItem.objects.filter(
        payment__tenant_id=tid,
        kind='course',
        course__in=[c for c in courses_dict.values() if c.kind in ('package', 'standalone')],
        status__in=('paid', 'partial', 'pending', 'pardoned')
    )
    for it in package_items:
        it_rev = float(it.amount or 0)
        total_revenue_generated += it_rev

    # Groups summary
    groups_data = []
    for g in groups:
        stu_count = g.students.count()
        g_sessions_count = sum(1 for s in sessions if s.group_id == g.id)
        groups_data.append({
            'id': g.id,
            'name': g.name,
            'course_id': g.course_id,
            'course_title': g.course.title if g.course else '—',
            'students_count': stu_count,
            'sessions_count': g_sessions_count,
            'status': g.status,
        })

    # Sessions history list
    sessions_data = []
    for s in sessions[:120]:
        att = att_by_session.get(s.id, {'present': 0, 'absent': 0, 'excused': 0})
        sessions_data.append({
            'id': s.id,
            'title': s.topic or (s.group.name if s.group else 'Session'),
            'start_at': s.start_at.isoformat() if s.start_at else None,
            'group_name': s.group.name if s.group else '—',
            'course_title': s.course.title if s.course else (s.group.course.title if s.group and s.group.course else '—'),
            'room_name': s.room_ref.name if s.room_ref else (s.room or '—'),
            'present_count': att['present'],
            'absent_count': att['absent'],
            'status': s.status,
        })

    payouts_data = [{
        'id': p.id,
        'payment_date': p.paid_at.isoformat() if p.paid_at else None,
        'amount': float(p.amount),
        'method': getattr(p, 'method', None),
        'notes': p.notes,
        'created_at': p.created_at.isoformat() if p.created_at else None,
    } for p in payouts]

    balance_due = max(0.0, total_earned - total_paid_out)

    return Response({
        'teacher': {
            'id': teacher.id,
            'name': f"{teacher.first_name} {teacher.last_name}",
            'phone': teacher.phone,
            'email': teacher.email,
            'subject': _teacher_subject_label(teacher),
            'payment_percentage': float(teacher.payment_percentage or 0),
            'status': teacher.status,
            'created_at': teacher.created_at.isoformat() if teacher.created_at else None,
        },
        'financial_summary': {
            'total_revenue_generated': round(total_revenue_generated, 2),
            'total_earned': round(total_earned, 2),
            'total_paid_out': round(total_paid_out, 2),
            'balance_due': round(balance_due, 2),
            'session_earned': round(total_earned - float(earnings.get('book_earned') or 0) - float(earnings.get('standalone_earned') or 0), 2),
            'book_earned': float(earnings.get('book_earned') or 0),
            'standalone_earned': float(earnings.get('standalone_earned') or 0),
            'book_percentage': float(teacher.book_percentage or 0),
        },
        'groups': groups_data,
        'sessions': sessions_data,
        'payouts': payouts_data,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def archive_overview(request):
    """Returns archive structure: years and archived courses counts."""
    user = request.user
    tid = require_staff_tenant(user)
    if not user.can_view('courses'):
        raise PermissionDenied('Forbidden')
    archived_courses = Course.objects.filter(tenant_id=tid, status='archived')

    years_set = set()
    counts = {}
    for c in archived_courses:
        y = c.archive_year or (c.updated_at.year if c.updated_at else 2026)
        years_set.add(y)
        counts[y] = counts.get(y, 0) + 1

    years_set.add(2026)
    if 2026 not in counts:
        counts[2026] = 0

    sorted_years = sorted(list(years_set), reverse=True)
    return Response({
        'years': sorted_years,
        'counts': counts,
    })
