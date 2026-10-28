"""Database-backed tests for teacher earnings: session percentage, book
royalties, standalone courses, waivers (pardons), reductions and payouts.

They hit the real /teacher-payments/summary endpoint and also check that
the per-teacher report on the Reports page reports the same total.
"""
from datetime import timedelta
from decimal import Decimal

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .models import (
    Tenant, User, Teacher, Student, Course, Group, ClassSession, Attendance,
    Payment, PaymentItem, Book, BookCopy, TeacherPayout,
)

API = '/api/v1/'


@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}, REST_FRAMEWORK={
    'DEFAULT_AUTHENTICATION_CLASSES': ['api.services.BearerTokenAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_THROTTLE_CLASSES': [],
})
class TeacherEarningsTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name='School', slug='school', plan='premium', status='active')
        self.owner = User.objects.create_user(email='o@s.test', password='pw-12345678', name='O',
                                              tenant=self.tenant, role='owner')
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {Token.objects.create(user=self.owner).key}')
        # Teacher keeps 60% of session value and 10% of their book sales.
        self.teacher = Teacher.objects.create(tenant=self.tenant, first_name='Amine', last_name='T',
                                              payment_percentage=Decimal('60'), book_percentage=Decimal('10'))
        self.students = [Student.objects.create(tenant=self.tenant, first_name=f'S{i}', last_name='X')
                         for i in range(3)]

    # ---- helpers --------------------------------------------------------
    def regular_course(self, price, pricing_type='per_session', sessions_count=None):
        course = Course.objects.create(tenant=self.tenant, title='Math', price=Decimal(price),
                                       pricing_type=pricing_type, sessions_count=sessions_count)
        group = Group.objects.create(tenant=self.tenant, course=course, teacher=self.teacher, name='G1')
        group.students.add(*self.students)
        return course, group

    def session(self, group, days_ago=0, statuses=('present', 'present', 'present')):
        start = timezone.now() - timedelta(days=days_ago)
        s = ClassSession.objects.create(tenant=self.tenant, group=group, course=group.course,
                                        start_at=start, end_at=start + timedelta(hours=1))
        for student, st in zip(self.students, statuses):
            if st:
                Attendance.objects.create(tenant=self.tenant, session=s, student=student, status=st)
        return s

    def bill(self, student, amount, status='paid', **item):
        """Create a bill through the real POST /payments endpoint, so the
        same code that runs in production decides the bill's status,
        waiver type and discount."""
        payload = {'amount': str(amount), 'status': status}
        for key, value in item.items():
            if key in ('course', 'group', 'book'):
                payload[f'{key}_id'] = value.pk
            else:
                payload[key] = str(value)
        res = self.client.post(f'{API}payments', {'student_id': student.pk, 'items': [payload]}, format='json')
        self.assertIn(res.status_code, (200, 201), res.content[:500])
        payment = Payment.objects.get(pk=res.json()['id'])
        return payment

    def book(self, title, author, copies=5):
        book = Book.objects.create(tenant=self.tenant, title=title, price=Decimal('800'), author_teacher=author)
        for i in range(copies):
            BookCopy.objects.create(tenant=self.tenant, book=book, copy_code=f'{title}-{i}')
        return book

    def summary(self, **params):
        res = self.client.get(f'{API}teacher-payments/summary', params)
        self.assertEqual(res.status_code, 200, res.content[:300])
        rows = {r['teacher_id']: r for r in res.json()['items']}
        return rows[self.teacher.id]

    # ---- sessions -------------------------------------------------------
    def test_session_share_is_percentage_of_per_session_price(self):
        _, group = self.regular_course('1000', 'per_session')
        self.session(group)                                    # 3 present
        self.session(group, statuses=('present', 'absent', None))  # 1 present
        row = self.summary()
        self.assertEqual(row['present_count'], 4)
        self.assertAlmostEqual(row['earned'], 4 * 1000 * 0.60)  # 2400

    def test_monthly_price_is_split_by_sessions_per_month(self):
        # 4000/month over 8 sessions = 500 per session -> 60% = 300 per present
        _, group = self.regular_course('4000', 'per_month', 8)
        self.session(group)
        self.assertAlmostEqual(self.summary()['earned'], 3 * 300)

    def test_fixed_course_price_is_split_by_total_sessions(self):
        # 12000 for 24 sessions = 500 per session
        _, group = self.regular_course('12000', 'fixed_sessions', 24)
        self.session(group, statuses=('present', None, None))
        self.assertAlmostEqual(self.summary()['earned'], 300)

    def test_absent_and_excused_students_earn_nothing(self):
        _, group = self.regular_course('1000')
        self.session(group, statuses=('absent', 'excused', None))
        self.assertEqual(self.summary()['earned'], 0)

    def test_teacher_waiver_removes_that_students_share(self):
        course, group = self.regular_course('1000')
        self.session(group)
        self.bill(self.students[0], '1000', kind='course', course=course, group=group,
                  status='pardoned', pardon_type='teacher')
        # Only students 1 and 2 still earn the teacher their 60%.
        self.assertAlmostEqual(self.summary()['earned'], 2 * 600)

    def test_school_waiver_keeps_teacher_share(self):
        course, group = self.regular_course('1000')
        self.session(group)
        self.bill(self.students[0], '1000', kind='course', course=course, group=group,
                  status='pardoned', pardon_type='school')
        self.assertAlmostEqual(self.summary()['earned'], 3 * 600)

    def test_reduction_targets(self):
        course, group = self.regular_course('1000')
        self.session(group)  # 1800 base
        # 100 off charged to the teacher only -> -100
        self.bill(self.students[0], '1000', kind='course', course=course, group=group,
                  reduction=Decimal('100'), reduction_target='teacher')
        # 100 off shared -> teacher absorbs 60%
        self.bill(self.students[1], '1000', kind='course', course=course, group=group,
                  reduction=Decimal('100'), reduction_target='total')
        # 100 off charged to the school -> teacher untouched
        self.bill(self.students[2], '1000', kind='course', course=course, group=group,
                  reduction=Decimal('100'), reduction_target='school')
        self.assertAlmostEqual(self.summary()['earned'], 1800 - 100 - 60)

    def test_payouts_reduce_balance_not_earned(self):
        _, group = self.regular_course('1000')
        self.session(group)
        TeacherPayout.objects.create(tenant=self.tenant, teacher=self.teacher, amount=Decimal('500'),
                                     paid_at=timezone.now().date())
        row = self.summary()
        self.assertAlmostEqual(row['earned'], 1800)
        self.assertAlmostEqual(row['paid_out'], 500)
        self.assertAlmostEqual(row['balance'], 1300)

    def test_date_filter_limits_sessions(self):
        _, group = self.regular_course('1000')
        self.session(group, days_ago=40)
        self.session(group, days_ago=0)
        today = timezone.now().date().isoformat()
        self.assertAlmostEqual(self.summary(**{'from': today, 'to': today})['earned'], 1800)
        self.assertAlmostEqual(self.summary()['earned'], 3600)

    # ---- books ----------------------------------------------------------
    def test_book_royalty_is_book_percentage_of_paid_sales(self):
        book = self.book('Algebra', self.teacher)
        self.bill(self.students[0], '800', kind='book', book=book)
        self.bill(self.students[1], '800', kind='book', book=book)
        row = self.summary()
        self.assertAlmostEqual(row['book_earned'], 2 * 800 * 0.10)  # 160
        self.assertAlmostEqual(row['earned'], 160)

    def test_unpaid_or_cancelled_book_sales_earn_nothing(self):
        book = self.book('Algebra', self.teacher)
        self.bill(self.students[0], '800', status='pending', kind='book', book=book)
        self.bill(self.students[1], '800', status='cancelled', kind='book', book=book)
        self.assertEqual(self.summary()['book_earned'], 0)

    def test_books_by_another_author_do_not_count(self):
        other = Teacher.objects.create(tenant=self.tenant, first_name='B', last_name='T',
                                       book_percentage=Decimal('50'))
        book = self.book('Physics', other)
        self.bill(self.students[0], '800', kind='book', book=book)
        self.assertEqual(self.summary()['book_earned'], 0)

    def test_sessions_and_books_add_up(self):
        _, group = self.regular_course('1000')
        self.session(group)
        book = self.book('Algebra', self.teacher)
        self.bill(self.students[0], '800', kind='book', book=book)
        self.assertAlmostEqual(self.summary()['earned'], 1800 + 80)

    # ---- standalone / package courses ----------------------------------
    def test_standalone_course_earns_on_billing_not_attendance(self):
        course = Course.objects.create(tenant=self.tenant, title='Workshop', price=Decimal('5000'),
                                       kind='standalone')
        group = Group.objects.create(tenant=self.tenant, course=course, teacher=self.teacher, name='W')
        group.students.add(*self.students)
        self.session(group)  # attendance must not count for standalone courses
        self.bill(self.students[0], '5000', kind='course', course=course)  # teacher default 60%
        self.bill(self.students[1], '5000', status='pending', kind='course', course=course,
                  teacher_percentage=Decimal('40'))  # per-item override
        self.bill(self.students[2], '5000', status='cancelled', kind='course', course=course)
        row = self.summary()
        self.assertAlmostEqual(row['standalone_earned'], 3000 + 2000)
        self.assertAlmostEqual(row['earned'], 5000)

    # ---- dashboard + reports agree --------------------------------------
    def test_teacher_report_matches_teacher_payments(self):
        course, group = self.regular_course('1000')
        self.session(group)
        book = self.book('Algebra', self.teacher)
        self.bill(self.students[0], '800', kind='book', book=book)
        self.bill(self.students[1], '1000', kind='course', course=course, group=group,
                  reduction=Decimal('100'), reduction_target='teacher')
        TeacherPayout.objects.create(tenant=self.tenant, teacher=self.teacher, amount=Decimal('200'),
                                     paid_at=timezone.now().date())
        expected = self.summary()
        res = self.client.get(f'{API}reports/teacher/{self.teacher.id}')
        self.assertEqual(res.status_code, 200, res.content[:500])
        fin = res.json()['financial_summary']
        self.assertAlmostEqual(fin['total_earned'], expected['earned'])
        self.assertAlmostEqual(fin['total_paid_out'], 200)
        self.assertAlmostEqual(fin['book_earned'], 80)
        self.assertEqual(len(res.json()['payouts']), 1)

    # ---- 2026-10 rule fixes --------------------------------------------
    def test_late_students_count_for_the_teacher(self):
        _, group = self.regular_course('1000')
        self.session(group, statuses=('late', 'late', 'present'))
        row = self.summary()
        self.assertEqual(row['present_count'], 3)
        self.assertAlmostEqual(row['earned'], 3 * 600)

    def test_late_students_are_billed_like_present_ones(self):
        from .views import compute_student_balances
        _, group = self.regular_course('1000')
        self.session(group, statuses=('late', 'present', 'absent'))
        balances = compute_student_balances(self.tenant.id)
        self.assertAlmostEqual(balances[self.students[0].id]['cost'], 1000)
        self.assertAlmostEqual(balances[self.students[1].id]['cost'], 1000)
        self.assertAlmostEqual(balances.get(self.students[2].id, {}).get('cost', 0), 0)

    def test_teacher_discount_applies_to_bill_without_group(self):
        course, group = self.regular_course('1000')
        self.session(group)  # 1800
        # The payment form never sends a group for course lines.
        self.bill(self.students[0], '1000', kind='course', course=course,
                  reduction=Decimal('100'), reduction_target='teacher')
        self.bill(self.students[1], '1000', kind='course', course=course,
                  reduction=Decimal('100'), reduction_target='total')
        row = self.summary()
        self.assertAlmostEqual(row['reductions_deducted'], 100 + 60)
        self.assertAlmostEqual(row['earned'], 1800 - 160)

    def test_discount_without_group_goes_to_the_students_own_teacher(self):
        course, group = self.regular_course('1000')
        other = Teacher.objects.create(tenant=self.tenant, first_name='Other', last_name='T',
                                       payment_percentage=Decimal('50'))
        other_student = Student.objects.create(tenant=self.tenant, first_name='Z', last_name='Y')
        g2 = Group.objects.create(tenant=self.tenant, course=course, teacher=other, name='G2')
        g2.students.add(other_student)
        self.session(group)
        self.bill(other_student, '1000', kind='course', course=course,
                  reduction=Decimal('100'), reduction_target='teacher')
        self.assertAlmostEqual(self.summary()['earned'], 1800)  # not docked for someone else's student
        res = self.client.get(f'{API}teacher-payments/summary')
        rows = {r['teacher_id']: r for r in res.json()['items']}
        self.assertAlmostEqual(rows[other.id]['reductions_deducted'], 100)

    def test_waiver_covers_only_its_own_bill(self):
        # 4000/month over 4 sessions = 1000 per session -> 600 teacher share.
        course, group = self.regular_course('4000', 'per_month', 4)
        self.session(group, days_ago=35, statuses=('present', None, None))
        self.session(group, days_ago=0, statuses=('present', None, None))
        # Only one session's worth was waived by the teacher.
        self.bill(self.students[0], '1000', kind='course', course=course,
                  status='pardoned', pardon_type='teacher')
        row = self.summary()
        self.assertAlmostEqual(row['waivers_deducted'], 600)
        self.assertAlmostEqual(row['earned'], 1200 - 600)  # used to be 0

    def test_waiver_never_takes_more_than_that_student_earned_the_teacher(self):
        course, group = self.regular_course('1000')
        self.session(group)  # 3 x 600
        # A large waived bill for student 0, who attended once.
        self.bill(self.students[0], '12000', kind='course', course=course,
                  status='pardoned', pardon_type='both')
        row = self.summary()
        self.assertAlmostEqual(row['waivers_deducted'], 600)
        self.assertAlmostEqual(row['earned'], 1200)  # other students untouched

    def test_school_waiver_does_not_touch_teacher(self):
        course, group = self.regular_course('1000')
        self.session(group)
        self.bill(self.students[0], '1000', kind='course', course=course,
                  status='pardoned', pardon_type='school')
        self.assertAlmostEqual(self.summary()['earned'], 1800)

    def test_book_discount_is_capped_at_the_royalty(self):
        _, group = self.regular_course('1000')
        self.session(group)  # 1800 from sessions
        book = self.book('Algebra', self.teacher)
        self.bill(self.students[0], '800', kind='book', book=book,
                  reduction=Decimal('300'), reduction_target='teacher')
        row = self.summary()
        self.assertAlmostEqual(row['book_earned'], 80)
        self.assertAlmostEqual(row['reductions_deducted'], 80)
        self.assertAlmostEqual(row['earned'], 1800)  # session pay untouched

    def test_course_discount_is_capped_at_teacher_share_of_the_bill(self):
        course, group = self.regular_course('1000')
        self.session(group)
        self.bill(self.students[0], '1000', kind='course', course=course,
                  reduction=Decimal('900'), reduction_target='teacher')
        self.assertAlmostEqual(self.summary()['reductions_deducted'], 600)

    def test_all_pages_agree(self):
        course, group = self.regular_course('1000')
        self.session(group, statuses=('present', 'late', 'present'))
        self.bill(self.students[0], '1000', kind='course', course=course,
                  status='pardoned', pardon_type='teacher')
        self.bill(self.students[1], '1000', kind='course', course=course,
                  reduction=Decimal('100'), reduction_target='teacher')
        book = self.book('Algebra', self.teacher)
        self.bill(self.students[2], '800', kind='book', book=book)
        expected = self.summary()['earned']
        self.assertAlmostEqual(expected, 1800 - 600 - 100 + 80)
        history = self.client.get(f'{API}teacher-payments/{self.teacher.id}/history').json()
        self.assertAlmostEqual(history['totals']['total_earned'], expected)
        report = self.client.get(f'{API}reports/teacher/{self.teacher.id}').json()
        self.assertAlmostEqual(report['financial_summary']['total_earned'], expected)
        dash = self.client.get(f'{API}dashboard/summary').json()
        self.assertAlmostEqual(dash['kpis']['teacher_earnings_month'] if 'kpis' in dash
                               else dash['teacher_earnings_month'], expected)

    # ---- pardoned students in the history dialog / counts ----------------
    def test_pardoned_present_student_is_not_counted_or_paid(self):
        course, group = self.regular_course('1000')
        self.session(group)  # 3 present
        self.bill(self.students[0], '1000', kind='course', course=course, group=group,
                  status='pardoned', pardon_type='teacher')
        row = self.summary()
        self.assertEqual(row['present_count'], 2)
        self.assertEqual(row['pardoned_count'], 1)
        self.assertAlmostEqual(row['earned'], 2 * 600)

        history = self.client.get(f'{API}teacher-payments/{self.teacher.id}/history').json()
        s = history['sessions'][0]
        self.assertEqual(s['present_count'], 2)
        self.assertEqual(s['pardoned_count'], 1)
        self.assertAlmostEqual(s['earned'], 2 * 600)
        self.assertAlmostEqual(history['totals']['sessions_earned'], 2 * 600)
        self.assertAlmostEqual(history['totals']['total_earned'], row['earned'])

    def test_waiver_covers_earliest_sessions_first_across_the_history(self):
        # 4000/month over 4 sessions = 1000 per session -> 600 teacher share.
        course, group = self.regular_course('4000', 'per_month', 4)
        self.session(group, days_ago=10, statuses=('present', None, None))
        self.session(group, days_ago=5, statuses=('present', None, None))
        self.session(group, days_ago=0, statuses=('present', None, None))
        # Two sessions' worth waived (2 x 600 = 1200 = 2000 x 60%).
        self.bill(self.students[0], '2000', kind='course', course=course, group=group,
                  status='pardoned', pardon_type='teacher')
        history = self.client.get(f'{API}teacher-payments/{self.teacher.id}/history').json()
        by_age = sorted(history['sessions'], key=lambda s: s['start_at'])
        self.assertEqual([x['pardoned_count'] for x in by_age], [1, 1, 0])
        self.assertEqual([x['present_count'] for x in by_age], [0, 0, 1])
        self.assertEqual([round(x['earned']) for x in by_age], [0, 0, 600])
        self.assertAlmostEqual(history['totals']['total_earned'], 600)

    def test_school_only_pardon_still_counts_and_pays(self):
        course, group = self.regular_course('1000')
        self.session(group)
        self.bill(self.students[0], '1000', kind='course', course=course, group=group,
                  status='pardoned', pardon_type='school')
        row = self.summary()
        self.assertEqual(row['present_count'], 3)
        self.assertEqual(row['pardoned_count'], 0)
        self.assertAlmostEqual(row['earned'], 1800)
