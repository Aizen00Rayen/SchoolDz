"""Database-backed tests for debts: what a student owes, paying it down, and
writing it off. A student owes exactly what is still pending on their bills;
no pending bill means no debt, however many sessions they attended."""
from datetime import timedelta
from decimal import Decimal

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .models import (
    Tenant, User, Teacher, Student, Course, Group, ClassSession, Attendance,
    Payment, PaymentItem, TeacherPayout,
)
from .views import compute_student_balances

API = '/api/v1/'


@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}, REST_FRAMEWORK={
    'DEFAULT_AUTHENTICATION_CLASSES': ['api.services.BearerTokenAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_THROTTLE_CLASSES': [],
})
class DebtTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name='School', slug='school', plan='premium', status='active')
        self.owner = User.objects.create_user(email='o@s.test', password='pw-12345678', name='O',
                                              tenant=self.tenant, role='owner')
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {Token.objects.create(user=self.owner).key}')
        self.teacher = Teacher.objects.create(tenant=self.tenant, first_name='T', last_name='T',
                                              payment_percentage=Decimal('65'))
        self.course = Course.objects.create(tenant=self.tenant, title='Math', price=Decimal('500'),
                                            pricing_type='per_session')
        self.group = Group.objects.create(tenant=self.tenant, course=self.course, teacher=self.teacher, name='G')
        self.student = Student.objects.create(tenant=self.tenant, first_name='Ali', last_name='B')
        self.group.students.add(self.student)

    # ---- helpers ---------------------------------------------------------
    def attend(self, times=3):
        for i in range(times):
            start = timezone.now() - timedelta(days=i + 1)
            s = ClassSession.objects.create(tenant=self.tenant, group=self.group, course=self.course, teacher=self.teacher,
                                            start_at=start, end_at=start + timedelta(hours=1))
            Attendance.objects.create(tenant=self.tenant, session=s, student=self.student, status='present')

    def bill(self, amount, status='pending', **item):
        payload = {'kind': 'per_session', 'course_id': self.course.pk, 'group_id': self.group.pk,
                   'amount': str(amount), 'status': status}
        payload.update(item)
        res = self.client.post(f'{API}payments', {'student_id': self.student.pk, 'items': [payload]}, format='json')
        self.assertIn(res.status_code, (200, 201), res.content[:400])
        return Payment.objects.get(pk=res.json()['id'])

    def balance(self):
        return compute_student_balances(self.tenant.id).get(self.student.id, {})

    def pay(self, amount, **extra):
        return self.client.post(f'{API}debts/{self.student.pk}/pay', {'amount': amount, **extra}, format='json')

    # ---- no pending bill = no debt ---------------------------------------
    def test_student_with_only_paid_bills_owes_nothing_even_after_attending(self):
        self.attend(3)                      # 3 x 500 of sessions attended
        self.bill(500, status='paid')       # but only one paid bill
        b = self.balance()
        self.assertNotEqual(b['status'], 'owes')
        self.assertEqual(b['debt'], 0)

    def test_attended_but_never_billed_owes_nothing(self):
        self.attend(4)
        self.assertNotEqual(self.balance().get('status'), 'owes')

    def test_payments_balances_endpoint_has_no_red_students_without_pending_bills(self):
        self.attend(2)
        self.bill(500, status='paid')
        rows = self.client.get(f'{API}payments/balances').json()['items']
        self.assertEqual([r for r in rows if r['status'] == 'owes'], [])

    def test_a_pending_bill_makes_the_student_owe_exactly_its_amount(self):
        self.bill(800, status='pending')
        b = self.balance()
        self.assertEqual(b['status'], 'owes')
        self.assertAlmostEqual(b['debt'], 800)
        self.assertAlmostEqual(b['balance'], -800)

    def test_pending_bill_with_school_pardon_owes_only_the_teacher_share(self):
        self.bill(500, status='pending', pardon_type='school', teacher_percentage=65, school_percentage=35)
        self.assertAlmostEqual(self.balance()['debt'], 325)

    # ---- paying a debt deducts it ----------------------------------------
    def test_full_payment_settles_the_bill_and_the_debt(self):
        bill = self.bill(800)
        res = self.pay(800, paid_at=timezone.now().date().isoformat())
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertAlmostEqual(res.json()['remaining_debt'], 0)
        bill.refresh_from_db()
        self.assertEqual(bill.status, 'paid')
        self.assertIsNotNone(bill.paid_at)
        self.assertNotEqual(self.balance()['status'], 'owes')
        self.assertAlmostEqual(self.balance()['paid'], 800)

    def test_part_payment_leaves_exactly_the_rest_owed(self):
        bill = self.bill(1000)
        res = self.pay(400)
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertAlmostEqual(res.json()['remaining_debt'], 600)
        bill.refresh_from_db()
        self.assertEqual(bill.status, 'pending')
        self.assertAlmostEqual(float(bill.amount), 600)
        paid_bill = Payment.objects.exclude(pk=bill.pk).get(student=self.student)
        self.assertEqual(paid_bill.status, 'paid')
        self.assertAlmostEqual(float(paid_bill.amount), 400)
        b = self.balance()
        self.assertAlmostEqual(b['debt'], 600)
        self.assertAlmostEqual(b['paid'], 400)
        # Paying the rest clears it.
        self.assertAlmostEqual(self.pay(600).json()['remaining_debt'], 0)
        self.assertNotEqual(self.balance()['status'], 'owes')

    def test_part_payment_on_a_school_pardoned_bill_keeps_the_pardon_share_right(self):
        # 500 with the school's 35% waived: the student owes 325.
        self.bill(500, status='pending', pardon_type='school', teacher_percentage=65, school_percentage=35)
        res = self.pay(150)
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertAlmostEqual(res.json()['remaining_debt'], 175)
        self.assertAlmostEqual(self.balance()['paid'], 150)
        self.assertAlmostEqual(self.pay(175).json()['remaining_debt'], 0)
        self.assertAlmostEqual(self.balance()['paid'], 325)

    def test_payment_is_applied_to_the_oldest_bill_first(self):
        first = self.bill(300)
        second = self.bill(500)
        Payment.objects.filter(pk=first.pk).update(created_at=timezone.now() - timedelta(days=5))
        res = self.pay(300)
        self.assertEqual(res.status_code, 200)
        first.refresh_from_db(); second.refresh_from_db()
        self.assertEqual(first.status, 'paid')
        self.assertEqual(second.status, 'pending')
        self.assertAlmostEqual(res.json()['remaining_debt'], 500)

    def test_cannot_pay_more_than_owed_or_without_a_debt(self):
        self.bill(300)
        self.assertEqual(self.pay(400).status_code, 400)
        self.pay(300)
        self.assertEqual(self.pay(10).status_code, 400)   # nothing left to pay

    # ---- a payment tagged "pardoned by both" must still count as money ----
    def test_a_paid_line_with_a_leftover_both_tag_is_real_money(self):
        bill = self.bill(150, status='paid')
        PaymentItem.objects.filter(payment=bill).update(pardon_type='both', teacher_percentage=0, school_percentage=100)
        Payment.objects.filter(pk=bill.pk).update(pardon_type='both')
        self.assertAlmostEqual(self.balance()['paid'], 150)

    def test_a_leftover_both_tag_does_not_waive_the_teacher(self):
        from .views import compute_teacher_earnings
        from types import SimpleNamespace
        self.attend(1)
        bill = self.bill(500, status='paid')
        PaymentItem.objects.filter(payment=bill).update(pardon_type='both')
        rows = compute_teacher_earnings(self.tenant.id, SimpleNamespace(GET={}))
        self.assertEqual(rows[0]['pardoned_count'], 0)
        self.assertAlmostEqual(rows[0]['earned'], 325)

    # ---- writing a debt off ----------------------------------------------
    def test_writing_off_a_debt_cancels_the_pending_bills(self):
        self.attend(1)
        bill = self.bill(700)
        res = self.client.delete(f'{API}debts/{self.student.pk}/waive')
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertAlmostEqual(res.json()['waived'], 700)
        bill.refresh_from_db()
        self.assertEqual(bill.status, 'cancelled')
        self.assertNotEqual(self.balance().get('status'), 'owes')
        # The teacher is still paid for the session that was attended.
        from .views import compute_teacher_earnings
        from types import SimpleNamespace
        self.assertAlmostEqual(compute_teacher_earnings(self.tenant.id, SimpleNamespace(GET={}))[0]['earned'], 325)
