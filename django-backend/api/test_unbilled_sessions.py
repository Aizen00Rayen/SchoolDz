"""Sessions a student attended beyond what was billed are a debt, priced at
the student's own share (a pardoned student's sessions cost less). Paying or
writing that debt off must keep it from coming back."""
from datetime import timedelta
from decimal import Decimal

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .models import (
    Tenant, User, Teacher, Student, Course, Group, ClassSession, Attendance, Payment, DebtWaiver,
)
from .views import compute_student_balances, compute_course_payment_status

API = '/api/v1/'


@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}, REST_FRAMEWORK={
    'DEFAULT_AUTHENTICATION_CLASSES': ['api.services.BearerTokenAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_THROTTLE_CLASSES': [],
})
class UnbilledSessionDebtTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name='School', slug='school', plan='premium', status='active')
        owner = User.objects.create_user(email='o@s.test', password='pw-12345678', name='O',
                                         tenant=self.tenant, role='owner')
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {Token.objects.create(user=owner).key}')
        self.teacher = Teacher.objects.create(tenant=self.tenant, first_name='T', last_name='T',
                                              payment_percentage=Decimal('50'))
        self.student = Student.objects.create(tenant=self.tenant, first_name='Ali', last_name='B')
        self.n = 0

    # ---- helpers ---------------------------------------------------------
    def pack(self, pricing='per_month', price='2000', count=4):
        self.course = Course.objects.create(tenant=self.tenant, title='Pack', price=Decimal(price),
                                            pricing_type=pricing, sessions_count=count)
        self.group = Group.objects.create(tenant=self.tenant, course=self.course, teacher=self.teacher, name='G')
        self.group.students.add(self.student)

    def attend(self, times):
        for _ in range(times):
            self.n += 1
            start = timezone.now() - timedelta(days=100 - self.n)
            s = ClassSession.objects.create(tenant=self.tenant, group=self.group, course=self.course,
                                            teacher=self.teacher, start_at=start, end_at=start + timedelta(hours=1))
            Attendance.objects.create(tenant=self.tenant, session=s, student=self.student, status='present')

    def bill(self, amount='2000', status='paid', **item):
        payload = {'kind': 'monthly', 'course_id': self.course.pk, 'group_id': self.group.pk,
                   'amount': str(amount), 'status': status, **item}
        res = self.client.post(f'{API}payments', {'student_id': self.student.pk, 'items': [payload]}, format='json')
        self.assertIn(res.status_code, (200, 201), res.content[:400])
        return Payment.objects.get(pk=res.json()['id'])

    def balance(self):
        return compute_student_balances(self.tenant.id).get(self.student.id, {})

    def badge(self):
        return compute_course_payment_status(self.tenant.id, self.course.id).get(self.student.id)

    PARDON = dict(pardon_type='school', teacher_percentage=50, school_percentage=50)

    # ---- the school-pardoned pack from the report ------------------------
    def test_pardoned_pack_covers_four_sessions_then_each_costs_250(self):
        self.pack()
        self.bill(**self.PARDON)            # 2000 pack, school waives its 50%: student paid 1000
        self.attend(4)
        self.assertEqual(self.balance()['status'], 'settled')
        self.assertTrue(self.badge())
        self.attend(1)                      # 5th session: one session at 250
        b = self.balance()
        self.assertEqual(b['status'], 'owes')
        self.assertAlmostEqual(b['debt'], 250)
        self.assertFalse(self.badge())
        self.attend(3)                      # 8 sessions: 4 extra x 250
        self.assertAlmostEqual(self.balance()['debt'], 1000)

    def test_unpardoned_pack_charges_the_full_session_price_beyond_the_pack(self):
        self.pack()
        self.bill()
        self.attend(6)
        self.assertAlmostEqual(self.balance()['debt'], 1000)   # 2 x 500

    def test_teacher_pardon_charges_the_school_share(self):
        self.pack()
        self.bill(pardon_type='teacher', teacher_percentage=50, school_percentage=50)
        self.attend(5)
        self.assertAlmostEqual(self.balance()['debt'], 250)

    def test_uneven_split_uses_the_students_real_share(self):
        self.pack()
        self.bill(pardon_type='school', teacher_percentage=70, school_percentage=30)  # student pays 70%
        self.attend(5)
        self.assertAlmostEqual(self.balance()['debt'], 350)    # 500 x 70%

    def test_fully_pardoned_student_owes_nothing(self):
        self.pack()
        self.bill(status='pardoned', pardon_type='both')
        self.attend(6)
        self.assertNotEqual(self.balance().get('status'), 'owes')

    def test_never_billed_student_owes_every_attended_session(self):
        self.pack()
        self.attend(3)
        self.assertAlmostEqual(self.balance()['debt'], 1500)

    def test_a_pending_bill_covers_sessions_and_is_not_counted_twice(self):
        self.pack()
        self.bill(status='pending')
        self.attend(4)
        self.assertAlmostEqual(self.balance()['debt'], 2000)   # just the pending bill

    def test_fixed_sessions_course_is_not_charged_beyond_its_session_count(self):
        self.pack('fixed_sessions', '2000', 4)
        self.bill()
        self.attend(7)
        self.assertNotEqual(self.balance().get('status'), 'owes')

    # ---- paying and writing off ------------------------------------------
    def test_paying_an_unbilled_debt_settles_it_for_good(self):
        self.pack()
        self.bill(**self.PARDON)
        self.attend(6)                       # 2 extra x 250 = 500
        res = self.client.post(f'{API}debts/{self.student.pk}/pay', {'amount': 500}, format='json')
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertNotEqual(self.balance().get('status'), 'owes')
        self.assertTrue(self.badge())
        self.attend(1)                       # a new session starts a new debt
        self.assertAlmostEqual(self.balance()['debt'], 250)

    def test_part_paying_an_unbilled_debt_leaves_the_rest(self):
        self.pack()
        self.bill(**self.PARDON)
        self.attend(6)
        self.client.post(f'{API}debts/{self.student.pk}/pay', {'amount': 200}, format='json')
        self.assertAlmostEqual(self.balance()['debt'], 300)

    def test_writing_off_an_unbilled_debt_keeps_it_gone(self):
        self.pack()
        self.bill(**self.PARDON)
        self.attend(6)
        res = self.client.delete(f'{API}debts/{self.student.pk}/waive')
        self.assertEqual(res.status_code, 200, res.content[:300])
        self.assertAlmostEqual(res.json()['waived'], 500)
        self.assertEqual(DebtWaiver.objects.filter(student=self.student).count(), 1)
        self.assertNotEqual(self.balance().get('status'), 'owes')   # does not come back
        self.attend(1)
        self.assertAlmostEqual(self.balance()['debt'], 250)         # only the new session
