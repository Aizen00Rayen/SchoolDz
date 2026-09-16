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
    @patch('api.views.StudentInsurance')
    @patch('api.views.compute_teacher_earnings')
    @patch('api.views.OtherIncome')
    @patch('api.views.Expense')
    @patch('api.views.Payment')
    def test_finance_report_includes_other_income(self, mock_payment, mock_expense, mock_other_income, mock_cte, mock_insurance):
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





