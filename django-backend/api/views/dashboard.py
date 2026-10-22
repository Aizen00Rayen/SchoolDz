"""Dashboard KPIs and global search."""
from datetime import timedelta
from django.db.models import Q, Sum, F
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from ..models import (
    User,
    Guardian,
    Teacher,
    Student,
    Course,
    Group,
    ClassSession,
    Attendance,
    Payment,
    PaymentItem,
    Grade,
    Expense,
    OtherIncome,
)
from ..serializers import (
    UserSerializer,
    GuardianSerializer,
    TeacherSerializer,
    StudentSerializer,
    CourseSerializer,
    GroupSerializer,
    ClassSessionSerializer,
    PaymentSerializer,
    GradeSerializer,
)
from .common import (
    name_search_q,
    require_staff_tenant,
)
from .payments import (
    BALANCE_THRESHOLD,
    _payment_item_discount,
    compute_student_balances,
)
from .teacher_payments import (
    _teacher_earnings_context,
    compute_teacher_earned_total,
    compute_teacher_earnings,
)


# Dashboard View
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def dashboard_summary(request):
    tid = require_staff_tenant(request.user)

    if not request.user.is_super_admin() and not request.user.can_view('dashboard'):
        raise PermissionDenied("You do not have permission to view the dashboard.")

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
    ).select_related('teacher', 'course', 'group', 'room_ref').order_by('start_at')[:50]

    upcoming_sessions = ClassSession.objects.filter(
        tenant_id=tid,
        start_at__range=(now, now + timedelta(days=7))
    ).select_related('teacher', 'course', 'group', 'room_ref').order_by('start_at')[:20]
    
    # Calculate revenue today — accurately sums full bills and paid portions of partial bills
    today_payments = Payment.objects.filter(
        tenant_id=tid,
        status__in=('paid', 'partial', 'pardoned'),
        paid_at__range=(day_start, day_end)
    ).prefetch_related('items')
    revenue_today = 0.0
    for p in today_payments:
        if p.status == 'partial':
            items = list(p.items.all())
            paid_sum = sum(
                max(0.0, float(it.amount or 0) - _payment_item_discount(it))
                for it in items if it.status == 'paid'
            )
            revenue_today += paid_sum
        else:
            revenue_today += max(0.0, float(p.amount or 0) - float(p.discount or 0))

    # Calculate revenue month
    month_payments = Payment.objects.filter(
        tenant_id=tid,
        status__in=('paid', 'partial', 'pardoned'),
        paid_at__gte=month_start
    ).prefetch_related('items')
    revenue_month = 0.0
    for p in month_payments:
        if p.status == 'partial':
            items = list(p.items.all())
            paid_sum = sum(
                max(0.0, float(it.amount or 0) - _payment_item_discount(it))
                for it in items if it.status == 'paid'
            )
            revenue_month += paid_sum
        else:
            revenue_month += max(0.0, float(p.amount or 0) - float(p.discount or 0))

    # Other income (100% school revenue, not split with teachers)
    # received_at is a DateField — querying directly with date objects without __date
    other_inc_today_data = OtherIncome.objects.filter(
        tenant_id=tid, received_at=day_start.date()
    ).aggregate(total=Sum('amount'))
    other_income_today = float(other_inc_today_data['total'] or 0)

    other_inc_month_data = OtherIncome.objects.filter(
        tenant_id=tid, received_at__gte=month_start.date()
    ).aggregate(total=Sum('amount'))
    other_income_month = float(other_inc_month_data['total'] or 0)

    revenue_today += other_income_today
    revenue_month += other_income_month
    
    # Outstanding — 'pending' bills plus pending items on partial bills
    out_data = Payment.objects.filter(
        tenant_id=tid,
        status='pending'
    ).aggregate(total=Sum(F('amount') - F('discount')))
    outstanding = float(out_data['total'] or 0)
    for pi in PaymentItem.objects.filter(payment__tenant_id=tid, payment__status='partial', status='pending').select_related('payment'):
        outstanding += max(0.0, float(pi.amount or 0) - _payment_item_discount(pi))


    # Expenses — same today/month windows as revenue, so profit/loss compares
    # like-for-like periods.
    exp_today_data = Expense.objects.filter(tenant_id=tid, spent_at__range=(day_start.date(), day_end.date())).aggregate(total=Sum('amount'))
    expenses_today = float(exp_today_data['total'] or 0)
    exp_month_data = Expense.objects.filter(tenant_id=tid, spent_at__gte=month_start.date()).aggregate(total=Sum('amount'))
    expenses_month = float(exp_month_data['total'] or 0)

    # Built once and threaded through every compute_teacher_earned_total/
    # compute_teacher_earnings call below (today, month, the 6-month trend,
    # and the balances breakdown) instead of each one independently
    # refetching every session/course/teacher row in the tenant.
    earn_ctx = _teacher_earnings_context(tid)

    # Teachers' share of revenue — the piece that never reaches the
    # institution. Reports already nets this out of its own "net" figure;
    # the dashboard's net_profit_month didn't, which overstated what the
    # school actually keeps by the full amount owed to teachers.
    teacher_earnings_today = compute_teacher_earned_total(tid, date_from=day_start.date(), date_to=day_end.date(), _context=earn_ctx)
    teacher_earnings_month = compute_teacher_earned_total(tid, date_from=month_start.date(), _context=earn_ctx)

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

    teacher_rows = compute_teacher_earnings(tid, request, _context=earn_ctx)
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
            status__in=('paid', 'partial', 'pardoned'),
            paid_at__range=(m_date, m_end)
        ).aggregate(total=Sum(F('amount') - F('discount')))
        m_other_inc_data = OtherIncome.objects.filter(
            tenant_id=tid,
            received_at__range=(m_date.date(), m_end.date())
        ).aggregate(total=Sum('amount'))
        m_exp_data = Expense.objects.filter(
            tenant_id=tid,
            spent_at__range=(m_date.date(), m_end.date())
        ).aggregate(total=Sum('amount'))

        m_total = float(m_rev_data['total'] or 0) + float(m_other_inc_data['total'] or 0)
        m_expenses = float(m_exp_data['total'] or 0)
        # Kept as its own series rather than folded into 'expenses' — that
        # field mirrors the Expenses page's own total, and silently padding
        # it with the teacher share would make the two pages disagree.
        m_teacher = compute_teacher_earned_total(tid, date_from=m_date.date(), date_to=m_end.date(), _context=earn_ctx)
        trend.append({
            'month': m_date.strftime('%b'),
            'month_start': m_date.date().isoformat(),
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
            'other_income_today': round(other_income_today, 2),
            'other_income_month': round(other_income_month, 2),
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
    # 'partial' counts as collected money elsewhere now — only a still-fully-
    # unpaid 'pending' invoice is genuinely overdue.
    for student_id, amount, discount in Payment.objects.filter(
        tenant_id=tid, status='pending', due_date__lt=today
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
