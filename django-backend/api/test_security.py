"""Database-backed tests for tenant isolation and role/module permissions.

These run real HTTP requests through the API (DRF APIClient + the real URL
conf), so they cover authentication, routing, serializers and views together.
Every test builds two schools (A and B) and checks that users of school A can
never read, change or link to school B's records, and that limited roles only
reach what they were granted.
"""
from datetime import timedelta
from decimal import Decimal

from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .models import (
    Tenant, User, TenantMembership, Guardian, Teacher, Student, Course, Room,
    Group, ClassSession, Attendance, Payment, PaymentItem, Book, Trip, Grade,
    Expense, OtherIncome, TeacherPayout, StudentInsurance, Quiz, Conversation,
    TimetableEntry,
)

API = '/api/v1/'

# Router resources every tenant user works with. `tenants` and `coupons` are
# platform-level and checked separately.
TENANT_RESOURCES = [
    'students', 'parents', 'teachers', 'courses', 'groups', 'rooms',
    'timetable', 'sessions', 'payments', 'trips', 'books', 'grades',
    'conversations', 'quizzes', 'expenses', 'other-incomes',
    'teacher-payouts', 'insurances',
]

# Function-based endpoints that only staff may use (no path id).
STAFF_GET_ENDPOINTS = [
    'dashboard/summary', 'search?q=a', 'payments/overdue', 'payments/balances',
    'payments/student-summary', 'teacher-payments/summary', 'logs',
    'reports/finance', 'reports/search?q=a', 'archive/overview',
    'groups/session-sheet',
]


def build_school(slug, plan='premium', status='active'):
    """One complete school with a record in every main table."""
    tenant = Tenant.objects.create(name=f'School {slug}', slug=slug, plan=plan, status=status)
    owner = User.objects.create_user(email=f'owner@{slug}.test', password='pw-12345678',
                                     name=f'Owner {slug}', tenant=tenant, role='owner')
    TenantMembership.objects.create(user=owner, tenant=tenant, role='owner')
    teacher = Teacher.objects.create(tenant=tenant, first_name='T', last_name=slug,
                                     payment_percentage=Decimal('60'), book_percentage=Decimal('10'))
    guardian = Guardian.objects.create(tenant=tenant, name=f'Parent {slug}')
    student = Student.objects.create(tenant=tenant, first_name='S', last_name=slug, parent=guardian)
    course = Course.objects.create(tenant=tenant, title=f'Math {slug}')
    room = Room.objects.create(tenant=tenant, name=f'Room {slug}')
    group = Group.objects.create(tenant=tenant, course=course, teacher=teacher, name=f'G {slug}')
    group.students.add(student)
    now = timezone.now()
    session = ClassSession.objects.create(tenant=tenant, group=group, teacher=teacher, course=course,
                                          start_at=now, end_at=now + timedelta(hours=1))
    attendance = Attendance.objects.create(tenant=tenant, session=session, student=student, status='present')
    payment = Payment.objects.create(tenant=tenant, student=student, course=course, amount=Decimal('1000'),
                                     status='paid')
    PaymentItem.objects.create(payment=payment, course=course, amount=Decimal('1000'))
    book = Book.objects.create(tenant=tenant, title=f'Book {slug}', price=Decimal('500'))
    trip = Trip.objects.create(tenant=tenant, title='Trip', destination='Oran', price=Decimal('100'))
    grade = Grade.objects.create(tenant=tenant, student=student, title='Exam', score=15, date=now.date())
    expense = Expense.objects.create(tenant=tenant, title='Rent', amount=Decimal('10'), spent_at=now.date())
    income = OtherIncome.objects.create(tenant=tenant, title='Print', amount=Decimal('5'), received_at=now.date())
    payout = TeacherPayout.objects.create(tenant=tenant, teacher=teacher, amount=Decimal('1'), paid_at=now.date())
    insurance = StudentInsurance.objects.create(tenant=tenant, student=student, amount=Decimal('1'), paid_at=now.date())
    quiz = Quiz.objects.create(tenant=tenant, title='Quiz')
    conversation = Conversation.objects.create(tenant=tenant, guardian=guardian)
    timetable = TimetableEntry.objects.create(tenant=tenant, day_of_week=1, start_time='09:00', title='Slot')
    return {
        'tenant': tenant, 'owner': owner, 'teacher': teacher, 'guardian': guardian,
        'student': student, 'course': course, 'room': room, 'group': group,
        'session': session, 'attendance': attendance, 'payment': payment,
        'book': book, 'trip': trip, 'grade': grade, 'expense': expense,
        'income': income, 'payout': payout, 'insurance': insurance, 'quiz': quiz,
        'conversation': conversation, 'timetable': timetable,
    }


# Maps each router resource to the fixture key holding that school's record.
RESOURCE_FIXTURE = {
    'students': 'student', 'parents': 'guardian', 'teachers': 'teacher',
    'courses': 'course', 'groups': 'group', 'rooms': 'room',
    'timetable': 'timetable', 'sessions': 'session', 'payments': 'payment',
    'trips': 'trip', 'books': 'book', 'grades': 'grade',
    'conversations': 'conversation', 'quizzes': 'quiz', 'expenses': 'expense',
    'other-incomes': 'income', 'teacher-payouts': 'payout', 'insurances': 'insurance',
}


@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}, REST_FRAMEWORK={
    'DEFAULT_AUTHENTICATION_CLASSES': ['api.services.BearerTokenAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    # Throttling is tested on its own; switch it off so the many requests
    # here don't trip the per-IP limits.
    'DEFAULT_THROTTLE_CLASSES': [],
    'DEFAULT_THROTTLE_RATES': {k: None for k in (
        'login', 'password_reset', 'enrollment', 'student_lookup', 'register', 'quiz_submit')},
})
class SecurityTestBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.a = build_school('alpha')
        cls.b = build_school('bravo')

    def setUp(self):
        from django.core.cache import cache
        cache.clear()

    def client_for(self, user):
        client = APIClient()
        token, _ = Token.objects.get_or_create(user=user)
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {token.key}')
        return client

    def make_user(self, role, tenant, permissions=None, email=None):
        return User.objects.create_user(
            email=email or f'{role}-{User.objects.count()}@{tenant.slug}.test',
            password='pw-12345678', name=role, tenant=tenant, role=role,
            permissions=permissions or {},
        )

    @staticmethod
    def ids(response):
        data = response.json()
        items = data.get('items', data.get('results', data)) if isinstance(data, dict) else data
        return {str(row.get('id')) for row in items if isinstance(row, dict)}


class TenantIsolationTests(SecurityTestBase):
    def test_lists_never_include_other_school_records(self):
        client = self.client_for(self.a['owner'])
        for resource in TENANT_RESOURCES:
            with self.subTest(resource=resource):
                res = client.get(f'{API}{resource}')
                self.assertEqual(res.status_code, 200, res.content[:300])
                foreign_id = str(self.b[RESOURCE_FIXTURE[resource]].pk)
                self.assertNotIn(foreign_id, self.ids(res))

    def test_cannot_read_change_or_delete_other_school_records(self):
        client = self.client_for(self.a['owner'])
        for resource in TENANT_RESOURCES:
            obj = self.b[RESOURCE_FIXTURE[resource]]
            url = f'{API}{resource}/{obj.pk}'
            with self.subTest(resource=resource, method='GET'):
                self.assertIn(client.get(url).status_code, (403, 404))
            with self.subTest(resource=resource, method='PATCH'):
                self.assertIn(client.patch(url, {'name': 'hacked', 'title': 'hacked'}, format='json').status_code,
                              (400, 403, 404, 405))
            with self.subTest(resource=resource, method='DELETE'):
                self.assertIn(client.delete(url).status_code, (403, 404, 405))
            self.assertTrue(type(obj).objects.filter(pk=obj.pk).exists(), f'{resource} was deleted')

    def test_patch_cannot_move_record_to_another_school(self):
        client = self.client_for(self.a['owner'])
        student = self.a['student']
        res = client.patch(f'{API}students/{student.pk}', {'tenant_id': self.b['tenant'].pk}, format='json')
        self.assertIn(res.status_code, (200, 400))
        student.refresh_from_db()
        self.assertEqual(student.tenant_id, self.a['tenant'].pk)

    def test_cannot_link_other_school_records_on_create(self):
        client = self.client_for(self.a['owner'])
        res = client.post(f'{API}groups', {
            'name': 'Mixed', 'course_id': self.b['course'].pk, 'teacher_id': self.b['teacher'].pk,
        }, format='json')
        self.assertEqual(res.status_code, 400, res.content[:300])

        res = client.post(f'{API}grades', {
            'student_id': self.b['student'].pk, 'title': 'x', 'score': 10, 'date': '2026-01-01',
        }, format='json')
        self.assertEqual(res.status_code, 400, res.content[:300])

        res = client.post(f'{API}payments', {
            'student_id': self.b['student'].pk,
            'items': [{'course_id': self.a['course'].pk, 'amount': 100}],
        }, format='json')
        self.assertIn(res.status_code, (400, 404), res.content[:300])
        self.assertFalse(Payment.objects.filter(student=self.b['student'], tenant=self.a['tenant']).exists())

    def test_path_id_endpoints_reject_other_school_ids(self):
        client = self.client_for(self.a['owner'])
        b = self.b
        urls = [
            f"attendance/session/{b['session'].pk}",
            f"attendance/student/{b['student'].pk}",
            f"payments/{b['payment'].pk}/invoice",
            f"reports/student/{b['student'].pk}",
            f"reports/teacher/{b['teacher'].pk}",
            f"teacher-payments/{b['teacher'].pk}/history",
            f"courses/{b['course'].pk}/archive-details",
        ]
        for url in urls:
            with self.subTest(url=url):
                res = client.get(API + url)
                if res.status_code == 200:
                    # Allowed only if it leaks nothing (an empty list scoped to A).
                    body = res.content.decode(errors='ignore')
                    self.assertNotIn(b['student'].last_name, body.replace('alpha', ''))
                    self.assertNotIn(str(b['student'].pk), body)
                else:
                    self.assertIn(res.status_code, (403, 404))

        self.assertIn(client.post(f"{API}debts/{b['student'].pk}/pay", {'amount': 1}, format='json').status_code,
                      (400, 403, 404))
        self.assertIn(client.delete(f"{API}debts/{b['student'].pk}/waive").status_code, (400, 403, 404))

    def test_attendance_post_cannot_mark_other_school_session(self):
        client = self.client_for(self.a['owner'])
        res = client.post(f"{API}attendance/session/{self.b['session'].pk}",
                          {'records': [{'student_id': self.b['student'].pk, 'status': 'absent'}]}, format='json')
        self.assertIn(res.status_code, (400, 403, 404))
        self.assertEqual(Attendance.objects.get(pk=self.b['attendance'].pk).status, 'present')

    def test_tenant_endpoint_only_exposes_own_school(self):
        client = self.client_for(self.a['owner'])
        self.assertIn(client.get(f"{API}tenants/{self.b['tenant'].pk}").status_code, (403, 404))
        res = client.patch(f"{API}tenants/{self.b['tenant'].pk}", {'name': 'pwned'}, format='json')
        self.assertIn(res.status_code, (403, 404))
        self.assertEqual(Tenant.objects.get(pk=self.b['tenant'].pk).name, 'School bravo')

    def test_switch_tenant_requires_membership(self):
        client = self.client_for(self.a['owner'])
        res = client.post(f'{API}auth/switch-tenant', {'tenant_id': self.b['tenant'].pk}, format='json')
        self.assertIn(res.status_code, (403, 404))
        self.a['owner'].refresh_from_db()
        self.assertEqual(self.a['owner'].tenant_id, self.a['tenant'].pk)


class RolePermissionTests(SecurityTestBase):
    def test_unauthenticated_requests_are_rejected(self):
        client = APIClient()
        for resource in TENANT_RESOURCES + ['users', 'tenants']:
            with self.subTest(resource=resource):
                self.assertEqual(client.get(f'{API}{resource}').status_code, 401)
        for url in STAFF_GET_ENDPOINTS:
            with self.subTest(url=url):
                self.assertEqual(client.get(API + url).status_code, 401)

    def test_parent_cannot_use_staff_api(self):
        parent = self.make_user('parent', self.a['tenant'])
        client = self.client_for(parent)
        for resource in TENANT_RESOURCES + ['users']:
            with self.subTest(resource=resource):
                self.assertEqual(client.get(f'{API}{resource}').status_code, 403)
        for url in STAFF_GET_ENDPOINTS:
            with self.subTest(url=url):
                self.assertEqual(client.get(API + url).status_code, 403)

    def test_student_role_cannot_use_staff_api(self):
        student_user = self.make_user('student', self.a['tenant'])
        client = self.client_for(student_user)
        for url in STAFF_GET_ENDPOINTS:
            with self.subTest(url=url):
                self.assertEqual(client.get(API + url).status_code, 403)

    def test_secretary_without_grants_cannot_see_sensitive_modules(self):
        secretary = self.make_user('secretary', self.a['tenant'])
        client = self.client_for(secretary)
        for resource in ('students', 'payments', 'teachers', 'expenses', 'other-incomes',
                         'teacher-payouts', 'users'):
            with self.subTest(resource=resource):
                self.assertEqual(client.get(f'{API}{resource}').status_code, 403)
        for url in ('payments/overdue', 'payments/balances', 'teacher-payments/summary', 'logs'):
            with self.subTest(url=url):
                self.assertEqual(client.get(API + url).status_code, 403)
        # Defaults keep the dashboard visible.
        self.assertEqual(client.get(f'{API}dashboard/summary').status_code, 200)

    def test_view_only_grant_blocks_add_modify_delete(self):
        secretary = self.make_user('secretary', self.a['tenant'], permissions={'students': {'view': True}})
        client = self.client_for(secretary)
        self.assertEqual(client.get(f'{API}students').status_code, 200)
        self.assertEqual(client.post(f'{API}students', {'first_name': 'X', 'last_name': 'Y'}, format='json').status_code, 403)
        url = f"{API}students/{self.a['student'].pk}"
        self.assertEqual(client.patch(url, {'first_name': 'Z'}, format='json').status_code, 403)
        self.assertEqual(client.delete(url).status_code, 403)
        self.assertTrue(Student.objects.filter(pk=self.a['student'].pk).exists())

    def test_add_grant_allows_create_only(self):
        secretary = self.make_user('secretary', self.a['tenant'], permissions={'students': {'view': True, 'add': True}})
        client = self.client_for(secretary)
        res = client.post(f'{API}students', {'first_name': 'New', 'last_name': 'Kid'}, format='json')
        self.assertIn(res.status_code, (200, 201), res.content[:300])
        self.assertEqual(Student.objects.get(pk=res.json()['id']).tenant_id, self.a['tenant'].pk)
        self.assertEqual(client.delete(f"{API}students/{res.json()['id']}").status_code, 403)

    def test_staff_cannot_grant_themselves_more_rights(self):
        secretary = self.make_user('secretary', self.a['tenant'], permissions={'users': {'view': True, 'modify': True}})
        client = self.client_for(secretary)
        res = client.patch(f'{API}users/{secretary.pk}', {'role': 'owner'}, format='json')
        secretary.refresh_from_db()
        self.assertNotEqual(secretary.role, 'owner', res.content[:300])
        res = client.patch(f"{API}users/{self.a['owner'].pk}", {'email': 'evil@x.test'}, format='json')
        self.a['owner'].refresh_from_db()
        self.assertEqual(self.a['owner'].email, 'owner@alpha.test', res.content[:300])

    def test_non_super_admin_cannot_use_platform_admin(self):
        client = self.client_for(self.a['owner'])
        self.assertEqual(client.get(f'{API}admin/platform-summary').status_code, 403)
        res = client.patch(f"{API}admin/tenants/{self.b['tenant'].pk}/status", {'status': 'suspended'}, format='json')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(Tenant.objects.get(pk=self.b['tenant'].pk).status, 'active')
        self.assertEqual(client.delete(f"{API}admin/tenants/{self.b['tenant'].pk}").status_code, 403)
        self.assertIn(client.get(f'{API}coupons').status_code, (403, 404))

    def test_suspended_school_is_locked_out(self):
        tenant = self.a['tenant']
        tenant.status = 'suspended'
        tenant.save()
        client = self.client_for(self.a['owner'])
        for resource in ('students', 'payments', 'teachers'):
            with self.subTest(resource=resource):
                self.assertEqual(client.get(f'{API}{resource}').status_code, 403)
        for url in STAFF_GET_ENDPOINTS + [f"attendance/session/{self.a['session'].pk}"]:
            with self.subTest(url=url):
                self.assertEqual(client.get(API + url).status_code, 403)
        res = client.post(f"{API}debts/{self.a['student'].pk}/pay", {'amount': 1}, format='json')
        self.assertEqual(res.status_code, 403)


class ParentPortalTests(SecurityTestBase):
    def setUp(self):
        super().setUp()
        self.parent_user = self.make_user('parent', self.a['tenant'])
        self.a['guardian'].user = self.parent_user
        self.a['guardian'].save()
        # A second family in the same school.
        other_guardian = Guardian.objects.create(tenant=self.a['tenant'], name='Other family')
        self.other_child = Student.objects.create(tenant=self.a['tenant'], first_name='O', last_name='Child',
                                                  parent=other_guardian)
        self.other_payment = Payment.objects.create(tenant=self.a['tenant'], student=self.other_child,
                                                    amount=Decimal('10'), status='paid')

    def test_parent_sees_only_own_children(self):
        client = self.client_for(self.parent_user)
        res = client.get(f'{API}portal/children')
        self.assertEqual(res.status_code, 200)
        body = res.content.decode()
        self.assertIn(str(self.a['student'].pk), body)
        self.assertNotIn(str(self.other_child.pk), body)

        for sub in ('attendance', 'sessions', 'payments', 'grades', 'teachers'):
            with self.subTest(sub=sub):
                self.assertEqual(client.get(f'{API}portal/children/{self.a["student"].pk}/{sub}').status_code, 200)
                self.assertEqual(client.get(f'{API}portal/children/{self.other_child.pk}/{sub}').status_code, 404)
                self.assertEqual(client.get(f'{API}portal/children/{self.b["student"].pk}/{sub}').status_code, 404)

    def test_parent_cannot_poll_other_family_checkout(self):
        from .models import ChargilyCheckout
        other = ChargilyCheckout.objects.create(tenant=self.a['tenant'], type='student_payment',
                                                payment=self.other_payment, amount=100)
        mine = ChargilyCheckout.objects.create(tenant=self.a['tenant'], type='student_payment',
                                               payment=self.a['payment'], amount=100)
        client = self.client_for(self.parent_user)
        self.assertEqual(client.get(f'{API}portal/payment-checkout/{other.pk}').status_code, 404)
        self.assertEqual(client.get(f'{API}portal/payment-checkout/{mine.pk}').status_code, 200)

    def test_parent_cannot_download_other_family_invoice(self):
        client = self.client_for(self.parent_user)
        self.assertEqual(client.get(f'{API}payments/{self.other_payment.pk}/invoice').status_code, 404)
        self.assertEqual(client.get(f"{API}payments/{self.b['payment'].pk}/invoice").status_code, 404)


class AuthenticationTests(SecurityTestBase):
    def test_login_rejects_wrong_password_and_accepts_right_one(self):
        client = APIClient()
        res = client.post(f'{API}auth/login', {'email': 'owner@alpha.test', 'password': 'wrong'}, format='json')
        self.assertEqual(res.status_code, 401)
        res = client.post(f'{API}auth/login', {'email': 'owner@alpha.test', 'password': 'pw-12345678'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertNotIn('password', res.json()['user'])

    def test_login_with_other_school_slug_fails(self):
        client = APIClient()
        res = client.post(f'{API}auth/login', {'email': 'owner@alpha.test', 'password': 'pw-12345678',
                                              'tenant_slug': 'bravo'}, format='json')
        self.assertEqual(res.status_code, 401)

    def test_disabled_account_cannot_log_in(self):
        user = self.make_user('secretary', self.a['tenant'])
        user.is_active = False
        user.save()
        res = APIClient().post(f'{API}auth/login', {'email': user.email, 'password': 'pw-12345678'}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_expired_token_is_rejected(self):
        token, _ = Token.objects.get_or_create(user=self.a['owner'])
        Token.objects.filter(pk=token.pk).update(created=timezone.now() - timedelta(days=365))
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {token.key}')
        self.assertEqual(client.get(f'{API}auth/me').status_code, 401)
        self.assertFalse(Token.objects.filter(pk=token.pk).exists())

    def test_logout_invalidates_token(self):
        client = self.client_for(self.a['owner'])
        self.assertEqual(client.get(f'{API}auth/me').status_code, 200)
        client.post(f'{API}auth/logout')
        self.assertEqual(client.get(f'{API}auth/me').status_code, 401)

    def test_private_uploads_need_owning_school(self):
        teacher = self.b['teacher']
        teacher.cv_url = '/uploads/documents/secret.pdf'
        teacher.save()
        self.assertEqual(APIClient().get('/uploads/documents/secret.pdf').status_code, 401)
        self.assertEqual(self.client_for(self.a['owner']).get('/uploads/documents/secret.pdf').status_code, 404)

    def test_upload_path_traversal_is_blocked(self):
        client = self.client_for(self.a['owner'])
        for path in ('/uploads/../settings.py', '/uploads/logos/..%2F..%2Fschooldz%2Fsettings.py',
                     '/uploads/etc/passwd'):
            with self.subTest(path=path):
                self.assertIn(client.get(path).status_code, (400, 404))


@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
class RateLimitTests(TestCase):
    def test_login_limit_cannot_be_bypassed_with_forwarded_for_header(self):
        from django.core.cache import cache
        cache.clear()
        client = APIClient()
        codes = [
            client.post(f'{API}auth/login', {'email': 'x@y.test', 'password': 'bad'}, format='json',
                        HTTP_X_FORWARDED_FOR=f'10.0.0.{i}').status_code
            for i in range(12)
        ]
        cache.clear()
        self.assertIn(429, codes)


class PasswordPolicyTests(SecurityTestBase):
    def test_weak_passwords_are_rejected_everywhere(self):
        res = APIClient().post(f'{API}auth/register', {
            'tenant_name': 'New', 'tenant_slug': 'new-school', 'name': 'N', 'email': 'n@new.test',
            'password': '12345678',
        }, format='json')
        self.assertEqual(res.status_code, 400)

        client = self.client_for(self.a['owner'])
        res = client.post(f'{API}users', {'email': 's@alpha.test', 'password': 'password', 'name': 'S',
                                          'role': 'secretary'}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_reset_token_is_hashed_and_enforces_policy(self):
        from .models import PasswordResetToken
        from .views import issue_reset_token
        raw = issue_reset_token(self.a['owner'], timedelta(hours=1))
        self.assertFalse(PasswordResetToken.objects.filter(token=raw).exists())
        client = APIClient()
        self.assertEqual(client.post(f'{API}auth/reset-password', {'token': raw, 'new_password': 'abc'},
                                     format='json').status_code, 400)
        res = client.post(f'{API}auth/reset-password', {'token': raw, 'new_password': 'Strong-Pass-2026!'},
                          format='json')
        self.assertEqual(res.status_code, 200)
        self.a['owner'].refresh_from_db()
        self.assertTrue(self.a['owner'].check_password('Strong-Pass-2026!'))
        # Single use.
        self.assertEqual(client.post(f'{API}auth/reset-password', {'token': raw, 'new_password': 'Other-Pass-2026!'},
                                     format='json').status_code, 400)


class InputValidationTests(SecurityTestBase):
    def test_tenant_image_urls_and_colors_are_validated(self):
        client = self.client_for(self.a['owner'])
        url = f"{API}tenants/{self.a['tenant'].pk}"
        self.assertEqual(client.patch(url, {'logo_url': 'x" onerror="alert(1)'}, format='json').status_code, 400)
        self.assertEqual(client.patch(url, {'hero_image_url': 'https://evil.test/a.png'}, format='json').status_code, 400)
        self.assertEqual(client.patch(url, {'logo_url': '/uploads/logos/abc-123.png'}, format='json').status_code, 200)
        client.patch(url, {'primary_color': 'red;}</style><script>'}, format='json')
        self.a['tenant'].refresh_from_db()
        self.assertTrue(self.a['tenant'].primary_color.startswith('#'))

    def test_course_color_must_be_hex(self):
        client = self.client_for(self.a['owner'])
        res = client.patch(f"{API}courses/{self.a['course'].pk}", {'color': '"><svg onload=1>'}, format='json')
        self.assertEqual(res.status_code, 400)


class ExportTests(SimpleTestCase):
    def test_formula_like_text_is_neutralised(self):
        from .views.common import export_rows
        res = export_rows(['Name', 'Amount'], [['=HYPERLINK("http://evil")', -5], ['Ali', 10]], 'x', 'csv')
        body = res.content.decode()
        self.assertIn("'=HYPERLINK", body)
        self.assertIn('-5', body)


class GoogleOAuthStateTests(TestCase):
    def test_callback_requires_the_browser_that_started_the_flow(self):
        from .services import GoogleOAuthService
        state = GoogleOAuthService.get_signed_state(intent='login', nonce='abc123')
        client = APIClient()
        res = client.get(f'{API}auth/google/callback', {'code': 'x', 'state': state})
        self.assertEqual(res.status_code, 302)
        self.assertIn('error=invalid_state', res['Location'])
        client.cookies['scolaris_oauth_state'] = 'other'
        res = client.get(f'{API}auth/google/callback', {'code': 'x', 'state': state})
        self.assertIn('error=invalid_state', res['Location'])


@override_settings(CHARGILY_SECRET='test-secret')
class ChargilyWebhookTests(TestCase):
    def setUp(self):
        from .models import ChargilyCheckout
        self.tenant = Tenant.objects.create(name='Pay', slug='pay', status='pending_payment')
        self.checkout = ChargilyCheckout.objects.create(tenant=self.tenant, plan='standard',
                                                        billing_cycle='monthly', amount=6000)

    def post(self, body, signature):
        return APIClient().generic('POST', f'{API}billing/webhook', body, content_type='application/json',
                                   HTTP_SIGNATURE=signature)

    def test_unsigned_or_forged_webhook_is_rejected(self):
        import json
        body = json.dumps({'type': 'checkout.paid', 'data': {'status': 'paid',
                           'metadata': {'checkout_id': self.checkout.id}}})
        self.assertEqual(self.post(body, '').status_code, 400)
        self.assertEqual(self.post(body, 'deadbeef').status_code, 400)
        self.tenant.refresh_from_db()
        self.assertEqual(self.tenant.status, 'pending_payment')

    def test_signed_webhook_activates_the_school(self):
        import hashlib, hmac, json
        body = json.dumps({'type': 'checkout.paid', 'data': {'status': 'paid',
                           'metadata': {'checkout_id': self.checkout.id}}})
        sig = hmac.new(b'test-secret', body.encode(), hashlib.sha256).hexdigest()
        self.assertEqual(self.post(body, sig).status_code, 200)
        self.tenant.refresh_from_db()
        self.assertEqual(self.tenant.status, 'active')
        self.assertEqual(self.tenant.plan, 'standard')


class SessionSheetDateTests(SecurityTestBase):
    def test_sheet_slots_carry_the_real_date_of_each_session(self):
        client = self.client_for(self.a['owner'])
        res = client.get(f"{API}groups/session-sheet", {'group_id': self.a['group'].pk})
        self.assertEqual(res.status_code, 200)
        slot = res.json()['sheets'][0]['sessions'][0]
        session = self.a['session']
        from django.utils import timezone as tz
        local = tz.localtime(session.start_at)
        self.assertEqual(slot['id'], session.pk)
        self.assertEqual(slot['date'], local.strftime('%d/%m'))
        self.assertEqual(slot['iso'], local.date().isoformat())
