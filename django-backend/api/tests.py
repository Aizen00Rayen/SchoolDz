from django.test import SimpleTestCase
from .views import _payment_item_discount


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

