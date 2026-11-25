"""The students list is capped at the newest 500, so pages that need a
specific group's students must be able to fetch them by id."""
from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .models import Tenant, User, Student

API = '/api/v1/'


@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}, REST_FRAMEWORK={
    'DEFAULT_AUTHENTICATION_CLASSES': ['api.services.BearerTokenAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_THROTTLE_CLASSES': [],
})
class StudentsListCapTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name='School', slug='school', plan='premium', status='active')
        owner = User.objects.create_user(email='o@s.test', password='pw-12345678', name='O',
                                         tenant=self.tenant, role='owner')
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {Token.objects.create(user=owner).key}')
        Student.objects.bulk_create([
            Student(tenant=self.tenant, first_name=f'S{i}', last_name='X', student_code=f'STU-{i:05d}')
            for i in range(510)
        ])
        # The very first student is the oldest, so it falls outside the newest 500.
        self.oldest = Student.objects.get(student_code='STU-00000')
        Student.objects.filter(pk=self.oldest.pk).update(created_at=timezone.now() - timedelta(days=400))

    def test_list_is_capped_and_omits_the_oldest_student(self):
        items = self.client.get(f'{API}students').json()['items']
        self.assertEqual(len(items), 500)
        self.assertNotIn(self.oldest.id, {s['id'] for s in items})

    def test_oldest_student_can_still_be_fetched_by_id(self):
        items = self.client.get(f'{API}students', {'ids': self.oldest.id}).json()['items']
        self.assertEqual([s['id'] for s in items], [self.oldest.id])

    def test_fetching_by_id_never_returns_another_schools_student(self):
        other = Tenant.objects.create(name='Other', slug='other', plan='premium', status='active')
        stranger = Student.objects.create(tenant=other, first_name='Z', last_name='Y')
        items = self.client.get(f'{API}students', {'ids': stranger.id}).json()['items']
        self.assertEqual(items, [])

    def test_grade_rows_carry_the_student_name_even_for_the_oldest_student(self):
        from .models import Grade
        Grade.objects.create(tenant=self.tenant, student=self.oldest, title='Exam', score=10, max_score=20,
                             date=timezone.now().date())
        rows = self.client.get(f'{API}grades').json()['items']
        self.assertEqual(rows[0]['student_name'], 'S0 X')


@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}, REST_FRAMEWORK={
    'DEFAULT_AUTHENTICATION_CLASSES': ['api.services.BearerTokenAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_THROTTLE_CLASSES': [],
})
class StudentsGradeFilterTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name='School', slug='school', plan='premium', status='active')
        owner = User.objects.create_user(email='o@s.test', password='pw-12345678', name='O',
                                         tenant=self.tenant, role='owner')
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {Token.objects.create(user=owner).key}')
        mk = lambda name, **kw: Student.objects.create(tenant=self.tenant, first_name=name, last_name='X', **kw)
        self.p1 = mk('P1', school_level='primary', school_year=1)
        self.p2 = mk('P2', school_level='primary', school_year=2)
        self.m1 = mk('M1', school_level='middle', school_year=1)
        self.h2s = mk('H2S', school_level='high', school_year=2, specialty='math')
        self.h2o = mk('H2O', school_level='high', school_year=2, specialty='science_exp')
        self.none = mk('N')

    def names(self, **params):
        return sorted(s['first_name'] for s in self.client.get(f'{API}students', params).json()['items'])

    def test_filter_by_level(self):
        self.assertEqual(self.names(school_level='primary'), ['P1', 'P2'])

    def test_filter_by_level_and_year(self):
        self.assertEqual(self.names(school_level='primary', school_year=2), ['P2'])

    def test_filter_by_specialty(self):
        self.assertEqual(self.names(school_level='high', school_year=2, specialty='math'), ['H2S'])

    def test_students_without_a_grade_can_be_listed(self):
        self.assertEqual(self.names(school_level='none'), ['N'])

    def test_no_filter_returns_everyone_and_filters_combine_with_search(self):
        self.assertEqual(len(self.names()), 6)
        self.assertEqual(self.names(school_level='primary', q='P1'), ['P1'])
