from django.urls import path, re_path, include
from api.views import serve_upload, serve_frontend

urlpatterns = [
    path('api/v1/', include('api.urls')),
    path('uploads/<str:subdir>/<str:filename>', serve_upload, name='serve_upload'),
    # Catch-all for the SPA — must stay last so it never shadows the routes
    # above. /static/* (the CRA build's JS/CSS) never reaches this: Django's
    # own dev static handler serves it locally (via STATICFILES_DIRS), and
    # PythonAnywhere's native static-files mapping serves it in production.
    # The negative lookahead keeps a mistyped/removed /api/v1/* path a real
    # 404 instead of silently falling through to index.html — Django's
    # resolver otherwise catches the include()'s Resolver404 and keeps
    # trying later patterns, so an unguarded `.*` here would swallow it.
    re_path(r'^(?!api/|uploads/).*$', serve_frontend),
]
