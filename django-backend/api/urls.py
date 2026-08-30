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
router.register('rooms', views.RoomViewSet, basename='room')
router.register('timetable', views.TimetableEntryViewSet, basename='timetable')
router.register('sessions', views.ClassSessionViewSet, basename='session')
router.register('payments', views.PaymentViewSet, basename='payment')
router.register('trips', views.TripViewSet, basename='trip')
router.register('books', views.BookViewSet, basename='book')
router.register('grades', views.GradeViewSet, basename='grade')
router.register('conversations', views.ConversationViewSet, basename='conversation')
router.register('quizzes', views.QuizViewSet, basename='quiz')
router.register('coupons', views.CouponViewSet, basename='coupon')
router.register('expenses', views.ExpenseViewSet, basename='expense')
router.register('expense-categories', views.ExpenseCategoryViewSet, basename='expense-category')
router.register('teacher-payouts', views.TeacherPayoutViewSet, basename='teacher-payout')

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
    *_both('auth/switch-tenant', views.auth_switch_tenant, 'auth_switch_tenant'),

    # Multi-school ownership — one login, many schools (see TenantMembership)
    *_both('owner/schools', views.owner_my_tenants, 'owner_my_tenants'),
    *_both('owner/schools/new', views.owner_create_school, 'owner_create_school'),
    *_both('owner/master-dashboard', views.owner_master_dashboard, 'owner_master_dashboard'),

    # Public student-badge lookup (student mobile app — no login, see docstring)
    *_both('public/student-lookup', views.public_student_lookup, 'public_student_lookup'),

    # Public quiz-taking link (no student login, see docstring)
    path('public/quiz-attempts/<str:token>/', views.public_quiz_attempt, name='public_quiz_attempt'),
    path('public/quiz-attempts/<str:token>', views.public_quiz_attempt, name='public_quiz_attempt_noslash'),
    *_both('public/quiz-attempts/<str:token>/submit', views.public_quiz_attempt_submit, 'public_quiz_attempt_submit'),

    # SEO: dynamic sitemap of per-tenant enrollment pages — referenced from
    # the static frontend/public/robots.txt as a second Sitemap: line, since
    # the set of tenants isn't known at frontend build time.
    path('sitemap-schools.xml', views.sitemap_schools_xml, name='sitemap_schools_xml'),

    # Public self-enrollment page (per-school, unauthenticated)
    path('public/schools/<str:slug>/enroll/', views.public_school_enroll, name='public_school_enroll'),
    path('public/schools/<str:slug>/enroll', views.public_school_enroll, name='public_school_enroll_noslash'),
    path('public/schools/<str:slug>/', views.public_school_info, name='public_school_info'),
    path('public/schools/<str:slug>', views.public_school_info, name='public_school_info_noslash'),

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
    path('attendance/session/<str:session_id>/print/', views.attendance_session_print, name='attendance_session_print'),
    path('attendance/session/<str:session_id>/print', views.attendance_session_print, name='attendance_session_print_noslash'),
    path('attendance/student/<str:student_id>/', views.attendance_for_student, name='attendance_for_student'),
    path('attendance/student/<str:student_id>', views.attendance_for_student, name='attendance_for_student_noslash'),
    *_both('attendance/<str:attendance_id>/excuse-document', views.attendance_upload_excuse, 'attendance_upload_excuse'),
    *_both('attendance/<str:attendance_id>/recovery', views.attendance_set_recovery, 'attendance_set_recovery'),

    # Session Sheet — printable per-group monthly attendance + payment grid
    *_both('groups/session-sheet', views.group_session_sheet, 'group_session_sheet'),
    *_both('groups/session-sheet/print', views.group_session_sheet_print, 'group_session_sheet_print'),

    # Payments
    *_both('payments/overdue', views.payments_overdue, 'payments_overdue'),
    *_both('payments/balances', views.payments_balances, 'payments_balances'),
    path('payments/<str:payment_id>/invoice/', views.payment_invoice_pdf, name='payment_invoice_pdf'),
    path('payments/<str:payment_id>/invoice', views.payment_invoice_pdf, name='payment_invoice_pdf_noslash'),

    # Website builder — gallery photo delete/reorder (needs a second id
    # beyond the tenant pk, so it's a plain path rather than a router action)
    path('tenants/<str:tenant_id>/gallery/<str:photo_id>/', views.gallery_photo_detail, name='gallery_photo_detail'),
    path('tenants/<str:tenant_id>/gallery/<str:photo_id>', views.gallery_photo_detail, name='gallery_photo_detail_noslash'),

    # Expenses, teacher payments, reports & audit log
    *_both('teacher-payments/summary', views.teacher_payments_summary, 'teacher_payments_summary'),
    *_both('logs', views.activity_logs, 'activity_logs'),
    *_both('reports/finance', views.finance_report, 'finance_report'),
    *_both('reports/finance/print', views.finance_report_print, 'finance_report_print'),

    # Parent portal
    *_both('portal/children', views.portal_children, 'portal_children'),
    path('portal/children/<str:student_id>/attendance/', views.portal_child_attendance, name='portal_child_attendance'),
    path('portal/children/<str:student_id>/attendance', views.portal_child_attendance, name='portal_child_attendance_noslash'),
    path('portal/children/<str:student_id>/sessions/', views.portal_child_sessions, name='portal_child_sessions'),
    path('portal/children/<str:student_id>/sessions', views.portal_child_sessions, name='portal_child_sessions_noslash'),
    path('portal/children/<str:student_id>/payments/', views.portal_child_payments, name='portal_child_payments'),
    path('portal/children/<str:student_id>/payments', views.portal_child_payments, name='portal_child_payments_noslash'),
    path('portal/children/<str:student_id>/grades/', views.portal_child_grades, name='portal_child_grades'),
    path('portal/children/<str:student_id>/grades', views.portal_child_grades, name='portal_child_grades_noslash'),
    path('portal/children/<str:student_id>/teachers/', views.portal_child_teachers, name='portal_child_teachers'),
    path('portal/children/<str:student_id>/teachers', views.portal_child_teachers, name='portal_child_teachers_noslash'),
    *_both('portal/conversation', views.portal_conversation, 'portal_conversation'),
    *_both('portal/conversation/messages', views.portal_conversation_messages, 'portal_conversation_messages'),
    path('portal/payment-checkout/<str:checkout_id>/', views.portal_payment_checkout_status, name='portal_payment_checkout_status'),
    path('portal/payment-checkout/<str:checkout_id>', views.portal_payment_checkout_status, name='portal_payment_checkout_status_noslash'),

    # Super Admin Platform
    *_both('admin/platform-summary', views.admin_platform_summary, 'admin_platform_summary'),
    path('admin/tenants/<str:tenant_id>/status/', views.admin_set_tenant_status, name='admin_set_tenant_status'),
    path('admin/tenants/<str:tenant_id>/status', views.admin_set_tenant_status, name='admin_set_tenant_status_noslash'),
    path('admin/tenants/<str:tenant_id>/subscription/', views.admin_set_tenant_subscription, name='admin_set_tenant_subscription'),
    path('admin/tenants/<str:tenant_id>/subscription', views.admin_set_tenant_subscription, name='admin_set_tenant_subscription_noslash'),
    path('admin/tenants/<str:tenant_id>/ownership/', views.admin_set_tenant_ownership, name='admin_set_tenant_ownership'),
    path('admin/tenants/<str:tenant_id>/ownership', views.admin_set_tenant_ownership, name='admin_set_tenant_ownership_noslash'),
    path('admin/tenants/<str:tenant_id>/', views.admin_destroy_tenant, name='admin_destroy_tenant'),
    path('admin/tenants/<str:tenant_id>', views.admin_destroy_tenant, name='admin_destroy_tenant_noslash'),

    # Default router URLs
    path('', include(router.urls)),
]
