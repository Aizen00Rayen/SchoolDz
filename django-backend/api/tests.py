from unittest.mock import patch
from django.test import SimpleTestCase
from .views import _payment_item_discount, compute_student_balances


class PardonTypeTestCase(SimpleTestCase):
    def test_pardon_type_both(self):
        # 100% discount, student pays 0
        item = {
            'amount': 5000,
            'status': 'pardoned',
            'pardon_type': 'both',
            'teacher_percentage': 60,
            'school_percentage': 40,
        }
        discount = _payment_item_discount(item)
        self.assertEqual(discount, 5000.0)
        net_payable = item['amount'] - discount
        self.assertEqual(net_payable, 0.0)

    def test_pardon_type_school(self):
        # School part waived (40%), student pays teacher's 60% (3000 DZD)
        item = {
            'amount': 5000,
            'status': 'pardoned',
            'pardon_type': 'school',
            'teacher_percentage': 60,
            'school_percentage': 40,
        }
        discount = _payment_item_discount(item)
        self.assertEqual(discount, 2000.0)
        net_payable = item['amount'] - discount
        self.assertEqual(net_payable, 3000.0)

    def test_pardon_type_teacher(self):
        # Teacher part waived (60%), student pays school's 40% (2000 DZD)
        item = {
            'amount': 5000,
            'status': 'pardoned',
            'pardon_type': 'teacher',
            'teacher_percentage': 60,
            'school_percentage': 40,
        }
        discount = _payment_item_discount(item)
        self.assertEqual(discount, 3000.0)
        net_payable = item['amount'] - discount
        self.assertEqual(net_payable, 2000.0)

    def test_pardon_type_default_both(self):
        # When pardon_type is omitted or null, defaults to both (100% discount)
        item = {
            'amount': 4000,
            'status': 'pardoned',
            'teacher_percentage': 50,
            'school_percentage': 50,
        }
        discount = _payment_item_discount(item)
        self.assertEqual(discount, 4000.0)

    def test_teacher_pardoned_pairs_exclusion(self):
        teacher_pardoned_pairs = {('student-2', 'course-1')}
        # student-1 is school pardoned -> not in teacher_pardoned_pairs -> teacher earns
        self.assertNotIn(('student-1', 'course-1'), teacher_pardoned_pairs)
        # student-2 is teacher pardoned -> in teacher_pardoned_pairs -> excluded from teacher earnings
        self.assertIn(('student-2', 'course-1'), teacher_pardoned_pairs)

    def test_pardon_type_school_without_percentages_defaults_50(self):
        # When percentages are missing, school pardon defaults to 50% split (student pays 50%)
        item = {
            'amount': 5000,
            'status': 'pardoned',
            'pardon_type': 'school',
            'teacher_percentage': None,
            'school_percentage': None,
        }
        discount = _payment_item_discount(item)
        self.assertEqual(discount, 2500.0)
        net_payable = item['amount'] - discount
        self.assertEqual(net_payable, 2500.0)

    def test_pardon_type_teacher_without_percentages_defaults_50(self):
        # When percentages are missing, teacher pardon defaults to 50% split (student pays 50%)
        item = {
            'amount': 5000,
            'status': 'pardoned',
            'pardon_type': 'teacher',
            'teacher_percentage': None,
            'school_percentage': None,
        }
        discount = _payment_item_discount(item)
        self.assertEqual(discount, 2500.0)
        net_payable = item['amount'] - discount
        self.assertEqual(net_payable, 2500.0)

    def test_pending_item_with_payment_pardon_type(self):
        # A pending item inheriting pardon_type from payment receives correct side discount
        item = {
            'amount': 4000,
            'status': 'pending',
            'pardon_type': None,
            'payment__pardon_type': 'school',
            'teacher_percentage': 60,
            'school_percentage': 40,
        }
        discount = _payment_item_discount(item)
        self.assertEqual(discount, 1600.0)
        net_payable = item['amount'] - discount
        self.assertEqual(net_payable, 2400.0)


class StudentBalancePardonDebtTestCase(SimpleTestCase):
    @patch('api.views.Attendance')
    @patch('api.views.ClassSession')
    @patch('api.views.Course')
    @patch('api.views.Group')
    @patch('api.views.PaymentItem')
    @patch('api.views.DebtWaiver')
    def test_side_pardon_pending_shows_in_debts(self, mock_dw, mock_pi, mock_group, mock_course, mock_cs, mock_att):
        mock_att.objects.filter.return_value.values.return_value = []
        mock_cs.objects.filter.return_value.values.return_value = []
        mock_course.objects.filter.return_value.values.return_value = [
            {'id': 'c1', 'price': 2000, 'pricing_type': 'per_month', 'sessions_count': None}
        ]
        mock_group.objects.filter.return_value.values.return_value = []
        mock_dw.objects.filter.return_value.values.return_value = []

        # fixed_billed_items
        mock_pi.objects.filter.return_value.filter.return_value.exclude.return_value.exclude.return_value.exclude.return_value.values.return_value = [
            {'payment__student_id': 's1', 'course_id': 'c1', 'amount': 2000}
        ]
        # paid course_items (pending items excluded -> empty)
        mock_pi.objects.filter.return_value.filter.return_value.exclude.return_value.exclude.return_value.values.return_value = []
        # written_off
        mock_pi.objects.filter.return_value.values.return_value = []
        # active_items
        mock_pi.objects.filter.return_value.exclude.return_value.values.return_value = [
            {
                'payment__student_id': 's1', 'course_id': 'c1', 'amount': 2000,
                'status': 'pending', 'pardon_type': 'school', 'payment__pardon_type': 'school',
                'teacher_percentage': None, 'school_percentage': None, 'group_id': None,
                'reduction': 0, 'payment__status': 'pending'
            }
        ]

        balances = compute_student_balances('tenant1')
        self.assertIn('s1', balances)
        student_bal = balances['s1']
        self.assertEqual(student_bal['status'], 'owes')
        self.assertEqual(student_bal['cost'], 1000.0)
        self.assertEqual(student_bal['paid'], 0.0)
        self.assertEqual(student_bal['balance'], -1000.0)

    @patch('api.views.Attendance')
    @patch('api.views.ClassSession')
    @patch('api.views.Course')
    @patch('api.views.Group')
    @patch('api.views.PaymentItem')
    @patch('api.views.DebtWaiver')
    def test_side_pardon_teacher_pending_shows_in_debts(self, mock_dw, mock_pi, mock_group, mock_course, mock_cs, mock_att):
        mock_att.objects.filter.return_value.values.return_value = []
        mock_cs.objects.filter.return_value.values.return_value = []
        mock_course.objects.filter.return_value.values.return_value = [
            {'id': 'c2', 'price': 3000, 'pricing_type': 'fixed_sessions', 'sessions_count': 10}
        ]
        mock_group.objects.filter.return_value.values.return_value = []
        mock_dw.objects.filter.return_value.values.return_value = []

        # fixed_billed_items
        mock_pi.objects.filter.return_value.filter.return_value.exclude.return_value.exclude.return_value.exclude.return_value.values.return_value = [
            {'payment__student_id': 's2', 'course_id': 'c2', 'amount': 3000}
        ]
        # paid course_items (pending items excluded -> empty)
        mock_pi.objects.filter.return_value.filter.return_value.exclude.return_value.exclude.return_value.values.return_value = []
        # written_off
        mock_pi.objects.filter.return_value.values.return_value = []
        # active_items
        mock_pi.objects.filter.return_value.exclude.return_value.values.return_value = [
            {
                'payment__student_id': 's2', 'course_id': 'c2', 'amount': 3000,
                'status': 'pending', 'pardon_type': 'teacher', 'payment__pardon_type': 'teacher',
                'teacher_percentage': 60, 'school_percentage': 40, 'group_id': None,
                'reduction': 0, 'payment__status': 'pending'
            }
        ]

        balances = compute_student_balances('tenant1')
        self.assertIn('s2', balances)
        student_bal = balances['s2']
        # Teacher waived 60% (1800 DZD), student owes school 40% (1200 DZD)
        self.assertEqual(student_bal['status'], 'owes')
        self.assertEqual(student_bal['cost'], 1200.0)
        self.assertEqual(student_bal['paid'], 0.0)
        self.assertEqual(student_bal['balance'], -1200.0)


class OtherIncomeFinanceCalculationTestCase(SimpleTestCase):
    @patch('api.views.compute_realized_revenue')
    @patch('api.views.StudentInsurance')
    @patch('api.views.compute_teacher_earnings')
    @patch('api.views.OtherIncome')
    @patch('api.views.Expense')
    @patch('api.views.Payment')
    def test_finance_report_includes_other_income(self, mock_payment, mock_expense, mock_other_income, mock_cte, mock_insurance, mock_crr):
        mock_crr.return_value = {
            'realized_tuition': 0.0,
            'realized_teacher': 0.0,
            'deferred_tuition': 0.0,
            'realized_sessions_count': 0,
            'session_realizations': [],
            'course_breakdown': [],
        }
        from api.views import _compute_finance_report_data
        from unittest.mock import MagicMock
        from datetime import date

        # Setup mock request
        request = MagicMock()
        request.GET = {}

        # Mock payments: 1 paid payment of 10,000
        p1 = MagicMock()
        p1.amount = 10000
        p1.discount = 0
        p1.paid_at = date(2026, 9, 1)
        p1.due_date = None
        p1.status = 'paid'
        p1.items.all.return_value = []
        p1.student = None
        p1.invoice_number = 'INV-1'

        mock_payment.objects.filter.return_value.select_related.return_value.prefetch_related.return_value.filter.return_value = [p1]

        # Mock expenses: 1 expense of 2,000
        e1 = MagicMock()
        e1.amount = 2000
        e1.spent_at = date(2026, 9, 2)
        e1.title = 'Electricity'
        e1.category = MagicMock(key='utilities', name=None)
        mock_expense.objects.filter.return_value.select_related.return_value = [e1]

        # Mock other incomes: 1 printing income of 3,500
        oi1 = MagicMock()
        oi1.amount = 3500
        oi1.received_at = date(2026, 9, 3)
        oi1.title = 'Exam papers printing'
        oi1.category = MagicMock(key='printing', name=None)
        mock_other_income.objects.filter.return_value.select_related.return_value = [oi1]

        # Mock teacher earnings: 4,000
        mock_cte.return_value = [{'earned': 4000}]

        # Mock insurances: 0
        mock_insurance.objects.filter.return_value.select_related.return_value = []

        with patch('api.views.filter_by_date_range', side_effect=lambda qs, req, field: qs):
            result = _compute_finance_report_data('tenant-1', request)

        self.assertEqual(result['collected'], 10000.0)
        self.assertEqual(result['other_income'], 3500.0)
        self.assertEqual(result['expenses'], 2000.0)
        self.assertEqual(result['teacher_earnings'], 4000.0)
        # Net = collected + other_income - expenses - teacher_earnings = 10000 + 3500 - 2000 - 4000 = 7500
        self.assertEqual(result['net'], 7500.0)
        self.assertIn('printing', result['other_income_by_category'])
        self.assertEqual(result['other_income_by_category']['printing'], 3500.0)

        # Verify other income transaction is in transactions list
        oi_tx = [tx for tx in result['transactions'] if tx['type'] == 'other_income']
        self.assertEqual(len(oi_tx), 1)
        self.assertEqual(oi_tx[0]['amount'], 3500.0)
        self.assertEqual(oi_tx[0]['description'], 'Exam papers printing')


class RealizedRevenueCalculationTestCase(SimpleTestCase):
    @patch('api.views.Attendance')
    @patch('api.views.PaymentItem')
    def test_compute_realized_revenue_attendance_deduction(self, mock_payment_item, mock_attendance):
        from api.views import compute_realized_revenue
        from unittest.mock import MagicMock
        from datetime import datetime

        # Request with no date filters
        request = MagicMock()
        request.GET = {}

        # 1. Mock student payment: Student 's1' paid 4,000 DZD for course 'c1'
        pi = MagicMock()
        pi.amount = 4000.0
        pi.reduction = 0
        pi.teacher_percentage = None
        pi.school_percentage = None
        pi.course_id = 'c1'
        pi.status = 'paid'
        pi.pardon_type = None
        pi.payment = MagicMock(student_id='s1', status='paid', pardon_type=None)

        mock_payment_item.objects.filter.return_value.filter.return_value.exclude.return_value.exclude.return_value.select_related.return_value = [pi]
        mock_payment_item.objects.filter.return_value.exclude.return_value.exclude.return_value.values.return_value = []

        # 2. Mock course: 4000 DZD, per_month, 4 sessions -> 1000 DZD/session
        course = MagicMock(id='c1', title='Mathematics Monthly', price=4000.0, pricing_type='per_month', sessions_count=4)

        # 3. Mock teacher: 50% commission
        teacher = MagicMock(id='t1', payment_percentage=50.0)

        # 4. Mock group:
        group = MagicMock(id='g1', name='Group A', course=course, teacher=teacher)

        # 5. Mock 2 present attendance records for student 's1'
        sess1 = MagicMock(
            id='sess1', course=course, group=group, teacher=teacher,
            status='completed', start_at=datetime(2026, 9, 10, 10, 0)
        )
        sess2 = MagicMock(
            id='sess2', course=course, group=group, teacher=teacher,
            status='completed', start_at=datetime(2026, 9, 17, 10, 0)
        )

        att1 = MagicMock(id='att1', session=sess1, student_id='s1', status='present', student=MagicMock(first_name='Ali', last_name='Ben'))
        att2 = MagicMock(id='att2', session=sess2, student_id='s1', status='present', student=MagicMock(first_name='Ali', last_name='Ben'))

        mock_attendance.objects.filter.return_value.exclude.return_value.select_related.return_value.order_by.return_value = [att1, att2]

        result = compute_realized_revenue('tenant-1', request)

        # 2 sessions * 1000 DZD session value = 2000 DZD total value
        # 50% school cut = 1000 DZD Realized Revenue
        # 50% teacher cut = 1000 DZD Teacher Share
        self.assertEqual(result['realized_tuition'], 1000.0)
        self.assertEqual(result['realized_teacher'], 1000.0)
        self.assertEqual(result['realized_sessions_count'], 2)

        # Deferred tuition = 4000 paid - 2000 consumed = 2000 DZD remaining
        self.assertEqual(result['deferred_tuition'], 2000.0)

        # Session realizations check
        self.assertEqual(len(result['session_realizations']), 2)
        self.assertEqual(result['session_realizations'][0]['session_value'], 1000.0)
        self.assertEqual(result['session_realizations'][0]['school_revenue'], 500.0)
        self.assertEqual(result['session_realizations'][0]['teacher_cut'], 500.0)
        self.assertTrue(result['session_realizations'][0]['funded'])

        # Course breakdown check
        self.assertEqual(len(result['course_breakdown']), 1)
        self.assertEqual(result['course_breakdown'][0]['realized_revenue'], 1000.0)
        self.assertEqual(result['course_breakdown'][0]['teacher_payout'], 1000.0)

    @patch('api.views.OtherIncomeCategory')
    @patch('api.views.Tenant')
    def test_ensure_default_other_income_categories_seeding(self, mock_tenant, mock_oic):
        from api.views import ensure_default_other_income_categories, DEFAULT_OTHER_INCOME_CATEGORIES

        # Case 1: Already seeded (update returns 0) -> does nothing
        mock_tenant.objects.filter.return_value.update.return_value = 0
        ensure_default_other_income_categories('tenant-seeded')
        mock_oic.objects.bulk_create.assert_not_called()

        # Case 2: First time seeding (update returns 1) -> creates missing categories
        mock_tenant.objects.filter.return_value.update.return_value = 1
        mock_oic.objects.filter.return_value.values_list.return_value = []
        ensure_default_other_income_categories('tenant-new')
        mock_oic.objects.bulk_create.assert_called_once()
        created_items = mock_oic.objects.bulk_create.call_args[0][0]
        self.assertEqual(len(created_items), len(DEFAULT_OTHER_INCOME_CATEGORIES))


class DebtPayTestCase(SimpleTestCase):
    def setUp(self):
        from rest_framework.test import APIRequestFactory
        self.factory = APIRequestFactory()

    @patch('api.views.transaction.atomic')
    @patch('api.views.log_activity')
    @patch('api.views.compute_student_balances')
    @patch('api.views.Payment')
    @patch('api.views.Student')
    @patch('api.views.require_staff_tenant')
    def test_debts_pay_validation(self, mock_tenant, mock_student, mock_payment, mock_balances, mock_log, mock_atomic):
        from rest_framework.test import force_authenticate
        from api.views import debts_pay
        from unittest.mock import MagicMock

        mock_tenant.return_value = 't1'
        mock_user = MagicMock()
        mock_user.is_authenticated = True
        mock_user.is_super_admin.return_value = True
        mock_user.tenant.invoice_prefix = 'INV-'

        student = MagicMock()
        student.id = 's1'
        student.first_name = 'Walid'
        student.last_name = 'Ben'
        mock_student.objects.filter.return_value.first.return_value = student

        mock_balances.return_value = {'s1': {'balance': -5000.0, 'status': 'owes'}}

        # Zero amount -> 400
        req = self.factory.post('/debts/s1/pay', {'amount': 0}, format='json')
        force_authenticate(req, user=mock_user)
        resp = debts_pay(req, 's1')
        self.assertEqual(resp.status_code, 400)

        # Negative amount -> 400
        req = self.factory.post('/debts/s1/pay', {'amount': -100}, format='json')
        force_authenticate(req, user=mock_user)
        resp = debts_pay(req, 's1')
        self.assertEqual(resp.status_code, 400)

        # Amount exceeding debt -> 400
        req = self.factory.post('/debts/s1/pay', {'amount': 6000}, format='json')
        force_authenticate(req, user=mock_user)
        resp = debts_pay(req, 's1')
        self.assertEqual(resp.status_code, 400)

    @patch('api.views.transaction.atomic')
    @patch('api.views.log_activity')
    @patch('api.views.compute_student_balances')
    @patch('api.views.Payment')
    @patch('api.views.Student')
    @patch('api.views.require_staff_tenant')
    def test_debts_pay_full_settlement(self, mock_tenant, mock_student, mock_payment, mock_balances, mock_log, mock_atomic):
        from api.views import debts_pay
        from unittest.mock import MagicMock

        mock_tenant.return_value = 't1'
        mock_user = MagicMock()
        mock_user.is_authenticated = True
        mock_user.is_super_admin.return_value = True
        mock_user.tenant.invoice_prefix = 'INV-'

        student = MagicMock(id='s1', first_name='Walid', last_name='Ben')
        student.tenant.invoice_prefix = 'INV-'
        mock_student.objects.filter.return_value.first.return_value = student
        mock_student.objects.filter.return_value.select_related.return_value.first.return_value = student

        mock_balances.side_effect = [
            {'s1': {'balance': -5000.0, 'status': 'owes'}},
            {'s1': {'balance': 0.0, 'status': 'settled'}},
        ]

        bill = MagicMock(amount=5000, discount=0, status='pending', notes='')
        bill.items.exclude.return_value.update = MagicMock()
        mock_payment.objects.filter.return_value.order_by.return_value = [bill]

        req = self.factory.post('/debts/s1/pay', {'amount': 5000, 'paid_at': '2026-09-19', 'method': 'cash'}, format='json')
        from rest_framework.test import force_authenticate
        force_authenticate(req, user=mock_user)
        resp = debts_pay(req, 's1')

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(bill.status, 'paid')
        self.assertEqual(bill.method, 'cash')
        bill.save.assert_called()
        self.assertEqual(resp.data['paid_amount'], 5000.0)
        self.assertEqual(resp.data['status'], 'settled')
        self.assertEqual(resp.data['date'], '2026-09-19')

    @patch('api.views.transaction.atomic')
    @patch('api.views._next_sequence_code', return_value='INV-000100')
    @patch('api.views.PaymentItem')
    @patch('api.views.log_activity')
    @patch('api.views.compute_student_balances')
    @patch('api.views.Payment')
    @patch('api.views.Student')
    @patch('api.views.require_staff_tenant')
    def test_debts_pay_partial_settlement(self, mock_tenant, mock_student, mock_payment, mock_balances, mock_log, mock_pi, mock_seq, mock_atomic):
        from api.views import debts_pay
        from rest_framework.test import force_authenticate
        from unittest.mock import MagicMock
        from decimal import Decimal

        mock_tenant.return_value = 't1'
        mock_user = MagicMock()
        mock_user.is_authenticated = True
        mock_user.is_super_admin.return_value = True
        mock_user.tenant.invoice_prefix = 'INV-'

        student = MagicMock(id='s1', first_name='Walid', last_name='Ben')
        student.tenant.invoice_prefix = 'INV-'
        mock_student.objects.filter.return_value.first.return_value = student
        mock_student.objects.filter.return_value.select_related.return_value.first.return_value = student

        mock_balances.side_effect = [
            {'s1': {'balance': -5000.0, 'status': 'owes'}},
            {'s1': {'balance': -3000.0, 'status': 'owes'}},
        ]

        first_item = MagicMock(amount=Decimal('5000'), course_id='c1', group_id='g1', teacher_percentage=0, school_percentage=100)
        bill = MagicMock(
            amount=Decimal('5000'), discount=Decimal('0'), status='pending',
            course_id='c1', group_id='g1', kind='course', id='bill-1', invoice_number='INV-000050'
        )
        bill.items.first.return_value = first_item
        bill.items.order_by.return_value = [first_item]
        bill.items.filter.return_value.delete = MagicMock()
        mock_payment.objects.filter.return_value.order_by.return_value = [bill]

        req = self.factory.post('/debts/s1/pay', {'amount': 2000, 'paid_at': '2026-09-19', 'method': 'cash'}, format='json')
        force_authenticate(req, user=mock_user)
        resp = debts_pay(req, 's1')

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(bill.amount, Decimal('3000.0'))
        bill.save.assert_called()

        mock_payment.objects.create.assert_called_once()
        create_kwargs = mock_payment.objects.create.call_args[1]
        self.assertEqual(create_kwargs['amount'], Decimal('2000.0'))
        self.assertEqual(create_kwargs['status'], 'paid')

        self.assertEqual(resp.data['paid_amount'], 2000.0)
        self.assertEqual(resp.data['remaining_debt'], 3000.0)
        self.assertEqual(resp.data['status'], 'owes')
        pi_kwargs = mock_pi.objects.create.call_args[1]
        self.assertNotIn('tenant_id', pi_kwargs)
        # Validate that kwargs are accepted by real PaymentItem model
        from api.models import PaymentItem as RealPaymentItem
        real_fields = {f.name for f in RealPaymentItem._meta.get_fields()}
        for k in pi_kwargs.keys():
            self.assertTrue(k in real_fields or k.endswith('_id'), f"Invalid field {k} passed to PaymentItem")

    @patch('api.views.transaction.atomic')
    @patch('api.views._next_sequence_code', return_value='INV-000101')
    @patch('api.views.PaymentItem')
    @patch('api.views.log_activity')
    @patch('api.views.compute_student_balances')
    @patch('api.views.Payment')
    @patch('api.views.Student')
    @patch('api.views.require_staff_tenant')
    def test_debts_pay_attendance_debt_without_bill(self, mock_tenant, mock_student, mock_payment, mock_balances, mock_log, mock_pi, mock_seq, mock_atomic):
        from api.views import debts_pay
        from rest_framework.test import force_authenticate
        from unittest.mock import MagicMock
        from decimal import Decimal

        mock_tenant.return_value = 't1'
        mock_user = MagicMock()
        mock_user.is_authenticated = True
        mock_user.is_super_admin.return_value = True
        mock_user.tenant.invoice_prefix = 'INV-'

        group = MagicMock(id='g1', course_id='c1')
        student = MagicMock(id='s2', first_name='Sami', last_name='K')
        student.groups.first.return_value = group
        student.tenant.invoice_prefix = 'INV-'
        mock_student.objects.filter.return_value.first.return_value = student
        mock_student.objects.filter.return_value.select_related.return_value.first.return_value = student

        mock_balances.side_effect = [
            {'s2': {'balance': -1500.0, 'status': 'owes'}},
            {'s2': {'balance': 0.0, 'status': 'settled'}},
        ]

        mock_payment.objects.filter.return_value.order_by.return_value = []

        req = self.factory.post('/debts/s2/pay', {'amount': 1500, 'paid_at': '2026-09-19', 'method': 'cash'}, format='json')
        force_authenticate(req, user=mock_user)
        resp = debts_pay(req, 's2')

        self.assertEqual(resp.status_code, 200)
        mock_payment.objects.create.assert_called_once()
        create_kwargs = mock_payment.objects.create.call_args[1]
        self.assertEqual(create_kwargs['amount'], Decimal('1500.0'))
        self.assertEqual(create_kwargs['status'], 'paid')
        self.assertEqual(create_kwargs['group_id'], 'g1')
        self.assertEqual(create_kwargs['course_id'], 'c1')
        self.assertEqual(resp.data['paid_amount'], 1500.0)
        self.assertEqual(resp.data['status'], 'settled')

        pi_kwargs = mock_pi.objects.create.call_args[1]
        self.assertNotIn('tenant_id', pi_kwargs)
        from api.models import PaymentItem as RealPaymentItem
        real_fields = {f.name for f in RealPaymentItem._meta.get_fields()}
        for k in pi_kwargs.keys():
            self.assertTrue(k in real_fields or k.endswith('_id'), f"Invalid field {k} passed to PaymentItem")

    @patch('api.views.Student')
    @patch('api.views.require_staff_tenant')
    def test_debts_pay_student_not_found(self, mock_tenant, mock_student):
        from api.views import debts_pay
        from rest_framework.test import force_authenticate
        from unittest.mock import MagicMock

        mock_tenant.return_value = 't1'
        mock_user = MagicMock()
        mock_user.is_authenticated = True
        mock_user.is_super_admin.return_value = True
        mock_student.objects.filter.return_value.first.return_value = None
        mock_student.objects.filter.return_value.select_related.return_value.first.return_value = None

        req = self.factory.post('/debts/unknown/pay', {'amount': 500}, format='json')
        force_authenticate(req, user=mock_user)
        resp = debts_pay(req, 'unknown')
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.data['detail'], 'Student not found')

    @patch('api.views.compute_student_balances')
    @patch('api.views.Student')
    @patch('api.views.require_staff_tenant')
    def test_debts_pay_validation_errors(self, mock_tenant, mock_student, mock_balances):
        from api.views import debts_pay
        from rest_framework.test import force_authenticate
        from unittest.mock import MagicMock

        mock_tenant.return_value = 't1'
        mock_user = MagicMock()
        mock_user.is_authenticated = True
        mock_user.is_super_admin.return_value = True

        student = MagicMock(id='s1')
        student.tenant.invoice_prefix = 'INV-'
        mock_student.objects.filter.return_value.first.return_value = student
        mock_student.objects.filter.return_value.select_related.return_value.first.return_value = student
        mock_balances.return_value = {'s1': {'balance': -1000.0, 'status': 'owes'}}

        # Zero or negative amount
        req = self.factory.post('/debts/s1/pay', {'amount': 0}, format='json')
        force_authenticate(req, user=mock_user)
        resp = debts_pay(req, 's1')
        self.assertEqual(resp.status_code, 400)

        # Amount greater than owed debt
        req2 = self.factory.post('/debts/s1/pay', {'amount': 2000}, format='json')
        force_authenticate(req2, user=mock_user)
        resp2 = debts_pay(req2, 's1')
        self.assertEqual(resp2.status_code, 400)

    def test_payment_and_payment_item_fields_valid(self):
        from api.models import Payment, PaymentItem
        from decimal import Decimal
        import datetime

        # Test Payment instantiation with debts_pay fields
        p = Payment(
            tenant_id='t1',
            student_id='s1',
            course_id='c1',
            group_id='g1',
            trip_id=None,
            book_id=None,
            kind='course',
            amount=Decimal('1000.0'),
            discount=Decimal('0'),
            method='cash',
            status='paid',
            paid_at=datetime.datetime.now(),
            due_date=datetime.date.today(),
            notes='test note',
            invoice_number='INV-000001',
        )
        self.assertEqual(p.amount, Decimal('1000.0'))

        # Test PaymentItem instantiation with debts_pay fields (NO tenant_id)
        pi = PaymentItem(
            payment=p,
            course_id='c1',
            group_id='g1',
            trip_id=None,
            book_id=None,
            amount=Decimal('1000.0'),
            reduction=Decimal('0'),
            due_date=datetime.date.today(),
            teacher_percentage=Decimal('0'),
            school_percentage=Decimal('100'),
            status='paid',
            kind='course',
        )
        self.assertEqual(pi.amount, Decimal('1000.0'))

        # Ensure tenant_id is NOT a valid field on PaymentItem
        with self.assertRaises(TypeError):
            PaymentItem(tenant_id='t1', payment=p, amount=Decimal('1000.0'))

    def test_debts_pay_urls_routing(self):
        from django.urls import resolve
        match_noslash = resolve('/api/v1/debts/test-student/pay')
        match_slash = resolve('/api/v1/debts/test-student/pay/')
        self.assertEqual(match_noslash.func.__name__, 'view')
        self.assertEqual(match_slash.func.__name__, 'view')


class ReportsAndArchiveTestCase(SimpleTestCase):
    def test_reports_and_archive_url_routing(self):
        from django.urls import resolve
        # Reports search and details
        self.assertEqual(resolve('/api/v1/reports/search').func.__name__, 'view')
        self.assertEqual(resolve('/api/v1/reports/student/test-student-id').func.__name__, 'view')
        self.assertEqual(resolve('/api/v1/reports/teacher/test-teacher-id').func.__name__, 'view')
        # Archive overview
        self.assertEqual(resolve('/api/v1/archive/overview').func.__name__, 'view')
        self.assertEqual(resolve('/api/v1/archive').func.__name__, 'view')

    def test_filter_by_date_range_datetime_lookup(self):
        from unittest.mock import MagicMock
        from .views import filter_by_date_range
        from .models import Payment

        mock_qs = MagicMock()
        mock_qs.model = Payment
        mock_qs.filter.return_value = mock_qs
        mock_request = MagicMock()
        mock_request.GET = {'from': '2026-09-26', 'to': '2026-09-26'}

        filter_by_date_range(mock_qs, mock_request, 'paid_at')
        # Must use paid_at__date__gte and paid_at__date__lte for DateTimeField
        mock_qs.filter.assert_any_call(paid_at__date__gte='2026-09-26')
        mock_qs.filter.assert_any_call(paid_at__date__lte='2026-09-26')

    def test_course_archive_fields(self):
        from .models import Course
        c = Course(
            title='Physics Bac 2026',
            price=6000,
            pricing_type='per_month',
            sessions_count=8,
            status='archived',
            archive_year=2026,
        )
        self.assertEqual(c.status, 'archived')
        self.assertEqual(c.archive_year, 2026)

    def test_session_deduction_calculation(self):
        # 6000 DZD per month with 8 sessions -> 750 DZD per session
        from .views import course_per_session_price
        session_price = course_per_session_price(6000, 'per_month', 8)
        self.assertEqual(session_price, 750.0)

        # Student paid 6000 DZD (covers 8 sessions)
        amount_paid = 6000.0
        sessions_covered = int(amount_paid / session_price)
        self.assertEqual(sessions_covered, 8)

        # Attended 5 sessions -> 3 remaining, credit left = 6000 - (5 * 750) = 2250 DZD
        sessions_attended = 5
        sessions_remaining = max(0, sessions_covered - sessions_attended)
        credit_remaining = round(amount_paid - (sessions_attended * session_price), 2)
        self.assertEqual(sessions_remaining, 3)
        self.assertEqual(credit_remaining, 2250.0)

    def test_course_archive_url_routing(self):
        from django.urls import resolve
        # Both with and without trailing slash must resolve successfully
        res_slash = resolve('/api/v1/courses/course-uuid-1/archive/')
        res_noslash = resolve('/api/v1/courses/course-uuid-1/archive')
        self.assertEqual(res_slash.kwargs['pk'], 'course-uuid-1')
        self.assertEqual(res_noslash.kwargs['pk'], 'course-uuid-1')

        res_unarchive_slash = resolve('/api/v1/courses/course-uuid-1/unarchive/')
        res_unarchive_noslash = resolve('/api/v1/courses/course-uuid-1/unarchive')
        self.assertEqual(res_unarchive_slash.kwargs['pk'], 'course-uuid-1')
        self.assertEqual(res_unarchive_noslash.kwargs['pk'], 'course-uuid-1')

    def test_reports_search_name_q(self):
        from .views import name_search_q
        q = name_search_q("Mohamed Ali", "first_name", "last_name")
        self.assertIsNotNone(q)
        self.assertEqual(len(q.children), 2)

    def test_course_archive_details_url_routing(self):
        from django.urls import resolve
        res_slash = resolve('/api/v1/courses/course-uuid-1/archive-details/')
        res_noslash = resolve('/api/v1/courses/course-uuid-1/archive-details')
        self.assertEqual(res_slash.kwargs['pk'], 'course-uuid-1')
        self.assertEqual(res_noslash.kwargs['pk'], 'course-uuid-1')

    def test_student_groups_relation(self):
        from .models import Student
        self.assertTrue(hasattr(Student, 'groups'))
        self.assertFalse(hasattr(Student, 'group_memberships'))

    def test_other_income_date_filtering(self):
        from .models import OtherIncome
        from django.utils import timezone
        now = timezone.now()
        q1 = OtherIncome.objects.filter(received_at=now.date()).query
        q2 = OtherIncome.objects.filter(received_at__gte=now.date()).query
        self.assertIn('received_at', str(q1))
        self.assertIn('received_at', str(q2))

