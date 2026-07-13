from django.urls import path, include
from rest_framework.routers import DefaultRouter

from . import views

# trailing_slash=False: every axios call in the frontend hits these endpoints
# without a trailing slash (e.g. `/users/${id}`). With the default
# trailing_slash=True, DRF only generates slash-suffixed routes, so those
# requests 404 and Django's APPEND_SLASH tries to redirect — which it flatly
# refuses to do for unsafe methods (POST/PUT/PATCH/DELETE), raising a
# RuntimeError (500) in DEBUG mode. Matching the router to what the frontend
# actually sends removes the redirect (and the crash) entirely.
router = DefaultRouter(trailing_slash=False)
router.register('tenants', views.TenantViewSet, basename='tenant')
router.register('users', views.UserViewSet, basename='user')
router.register('students', views.StudentViewSet, basename='student')
router.register('parents', views.GuardianViewSet, basename='parent')
router.register('teachers', views.TeacherViewSet, basename='teacher')
router.register('courses', views.CourseViewSet, basename='course')
router.register('groups', views.GroupViewSet, basename='group')
router.register('sessions', views.ClassSessionViewSet, basename='session')
router.register('payments', views.PaymentViewSet, basename='payment')

def _both(route, view, name):
    """Return URL patterns for route both with and without trailing slash."""
    return [
        path(route + '/', view, name=name),
        path(route, view, name=name + '_noslash'),
    ]

urlpatterns = [
    # Health check
    *_both('health', views.health, 'health'),
    *_both('config', views.server_config, 'server_config'),

    # Auth routes
    *_both('auth/register', views.auth_register, 'auth_register'),
    *_both('auth/login', views.auth_login, 'auth_login'),
    *_both('auth/logout', views.auth_logout, 'auth_logout'),
    *_both('auth/me', views.auth_me, 'auth_me'),
    *_both('auth/refresh', views.auth_refresh, 'auth_refresh'),
    *_both('auth/forgot-password', views.auth_forgot_password, 'auth_forgot_password'),
    *_both('auth/reset-password', views.auth_reset_password, 'auth_reset_password'),

    # Google OAuth
    *_both('auth/google/start', views.google_start, 'google_start'),
    *_both('auth/google/callback', views.google_callback, 'google_callback'),
    *_both('auth/google/exchange', views.google_exchange, 'google_exchange'),

    # Billing routes
    *_both('plans', views.billing_plans, 'billing_plans'),
    *_both('billing/checkout', views.billing_checkout, 'billing_checkout'),
    path('billing/checkout/<str:checkout_id>/', views.billing_checkout_status, name='billing_checkout_status'),
    path('billing/checkout/<str:checkout_id>', views.billing_checkout_status, name='billing_checkout_status_noslash'),
    *_both('billing/renew/quote', views.billing_renew_quote, 'billing_renew_quote'),
    *_both('billing/renew', views.billing_renew, 'billing_renew'),
    *_both('billing/upgrade/quote', views.billing_upgrade_quote, 'billing_upgrade_quote'),
    *_both('billing/upgrade', views.billing_upgrade, 'billing_upgrade'),
    *_both('billing/webhook', views.billing_webhook, 'billing_webhook'),

    # Dashboard & Search
    *_both('dashboard/summary', views.dashboard_summary, 'dashboard_summary'),
    *_both('search', views.global_search, 'global_search'),

    # Attendance
    path('attendance/session/<str:session_id>/', views.attendance_for_session, name='attendance_for_session'),
    path('attendance/session/<str:session_id>', views.attendance_for_session, name='attendance_for_session_noslash'),
    path('attendance/student/<str:student_id>/', views.attendance_for_student, name='attendance_for_student'),
    path('attendance/student/<str:student_id>', views.attendance_for_student, name='attendance_for_student_noslash'),

    # Super Admin Platform
    *_both('admin/platform-summary', views.admin_platform_summary, 'admin_platform_summary'),
    path('admin/tenants/<str:tenant_id>/status/', views.admin_set_tenant_status, name='admin_set_tenant_status'),
    path('admin/tenants/<str:tenant_id>/status', views.admin_set_tenant_status, name='admin_set_tenant_status_noslash'),
    path('admin/tenants/<str:tenant_id>/', views.admin_destroy_tenant, name='admin_destroy_tenant'),
    path('admin/tenants/<str:tenant_id>', views.admin_destroy_tenant, name='admin_destroy_tenant_noslash'),

    # Default router URLs
    path('', include(router.urls)),
]
