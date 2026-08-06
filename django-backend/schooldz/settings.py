import os
from pathlib import Path
from dotenv import load_dotenv

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables
load_dotenv(os.path.join(BASE_DIR, '.env'))

# SECURITY WARNING: don't run with debug turned on in production!
# Defaults to False so a missing/typo'd APP_DEBUG can never silently expose
# tracebacks (which leak settings, SQL and env vars) on a live server.
# launch.sh writes APP_DEBUG=true into the local .env, so dev is unaffected.
DEBUG = os.environ.get('APP_DEBUG', 'false').lower() == 'true'

# SECURITY WARNING: keep the secret key used in production secret!
# Falling back to a hardcoded key in production would let anyone who has read
# this repo forge session cookies and signed tokens, so outside DEBUG we
# refuse to boot rather than come up quietly insecure.
SECRET_KEY = os.environ.get('APP_KEY', '').replace('base64:', '')
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = 'django-insecure-local-dev-only-not-for-production'
    else:
        raise RuntimeError(
            'APP_KEY is not set. Refusing to start with an insecure fallback secret key. '
            'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(50))"'
        )

# Comma-separated in production (e.g. ALLOWED_HOSTS=scolarisdz.duckdns.org).
# '*' is allowed only in DEBUG; in production an unset value is a
# misconfiguration we want to fail loudly on, not paper over.
_allowed_hosts = os.environ.get('ALLOWED_HOSTS', '')
ALLOWED_HOSTS = [h.strip() for h in _allowed_hosts.split(',') if h.strip()]
if not ALLOWED_HOSTS:
    if DEBUG:
        ALLOWED_HOSTS = ['*']
    else:
        raise RuntimeError(
            'ALLOWED_HOSTS is not set. Set it to your domain, e.g. '
            'ALLOWED_HOSTS=scolarisdz.duckdns.org'
        )


# Application definition

INSTALLED_APPS = [
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    
    # Third party
    'corsheaders',
    'rest_framework',
    'rest_framework.authtoken',
    
    # Local
    'api',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware', # Must be first
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'schooldz.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'schooldz.wsgi.application'

# Cache — use file-based so OAuth exchange codes survive StatReloader restarts
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.filebased.FileBasedCache',
        'LOCATION': '/tmp/schooldz_cache',
        'TIMEOUT': 300,
        'OPTIONS': {
            'MAX_ENTRIES': 1000,
        }
    }
}


# Database
# https://docs.djangoproject.com/en/5.2/ref/settings/#databases
#
# DB_CONNECTION=sqlite (e.g. on a free PythonAnywhere account, which has no
# free MySQL/Postgres) stores everything in a single file — no separate DB
# service to set up. Local dev keeps using MySQL via Docker (DB_CONNECTION
# is explicitly set to 'mysql' in launch.sh's generated .env), unaffected.
if os.environ.get('DB_CONNECTION', 'mysql') == 'sqlite':
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': os.environ.get('DB_DATABASE', str(BASE_DIR / 'db.sqlite3')),
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.mysql',
            'NAME': os.environ.get('DB_DATABASE', 'schooldz'),
            'USER': os.environ.get('DB_USERNAME', 'schooldz'),
            'PASSWORD': os.environ.get('DB_PASSWORD', 'schooldzpass'),
            'HOST': os.environ.get('DB_HOST', '127.0.0.1'),
            'PORT': os.environ.get('DB_PORT', '3306'),
            # Reuse each worker's DB connection across requests instead of
            # doing a TCP + auth handshake per request. Kept under MySQL's
            # default wait_timeout so we never hand a stale socket to a query.
            'CONN_MAX_AGE': int(os.environ.get('DB_CONN_MAX_AGE', '60')),
            'CONN_HEALTH_CHECKS': True,
            'OPTIONS': {
                'charset': 'utf8mb4',
            }
        }
    }


# Password validation
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/5.2/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.2/howto/static-files/

STATIC_URL = 'static/'

# The built React app (npm run build in frontend/). When present, Django
# serves index.html for any non-API route so the whole site — API and SPA —
# can run from a single free-tier host with one WSGI app (see serve_frontend
# in api/views.py and the catch-all route in schooldz/urls.py).
FRONTEND_BUILD_DIR = BASE_DIR.parent / 'frontend' / 'build'

# CRA's build output already lives under build/static/, matching STATIC_URL.
# In DEBUG (local runserver) this makes /static/* work automatically via
# Django's own static-files dev handler — no route needed in urls.py. In
# real production (PythonAnywhere), a native static-files mapping serves
# /static/ directly and never touches Django at all; this setting is unused
# there but harmless to leave in.
if (FRONTEND_BUILD_DIR / 'static').exists():
    STATICFILES_DIRS = [FRONTEND_BUILD_DIR / 'static']

# Default primary key field type
# https://docs.djangoproject.com/en/5.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


# CORS Configuration
# CORS_ALLOW_ALL_ORIGINS together with CORS_ALLOW_CREDENTIALS lets *any*
# website read authenticated API responses in a logged-in user's browser, so
# the wildcard is confined to DEBUG. In production an unset CORS_ORIGINS
# yields an empty allow-list (same-origin only) rather than "allow everyone".
cors_origins = os.environ.get('CORS_ORIGINS', '')
CORS_ALLOWED_ORIGINS = [o.strip() for o in cors_origins.split(',') if o.strip()]
if not CORS_ALLOWED_ORIGINS and DEBUG:
    CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True

# Production hardening. Behind nginx+certbot (the live setup), these make the
# browser enforce HTTPS and stop cookies leaking over plaintext.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = os.environ.get('SECURE_SSL_REDIRECT', 'true').lower() == 'true'
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_REFERRER_POLICY = 'same-origin'
    X_FRAME_OPTIONS = 'DENY'


# Authentication
AUTH_USER_MODEL = 'api.User'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'api.services.BearerTokenAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    # Brute-force protection for auth endpoints — now shared by the web app
    # and three mobile apps. Applied per-view (see LoginRateThrottle /
    # PasswordResetRateThrottle in api/services.py), not globally, so
    # everything else is unaffected.
    'DEFAULT_THROTTLE_RATES': {
        'login': '10/min',
        'password_reset': '5/min',
        'enrollment': '5/min',
    },
}

PASSWORD_HASHERS = [
    'api.hashers.LaravelBCryptPasswordHasher',
    'api.hashers.Laravel2aPasswordHasher',
    'django.contrib.auth.hashers.BCryptPasswordHasher',
    'django.contrib.auth.hashers.BCryptSHA256PasswordHasher',
    'django.contrib.auth.hashers.PBKDF2PasswordHasher',
]


# Logo uploads & serving config
MEDIA_URL = '/uploads/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'uploads')


# Local development settings & integrations
# Returns password-reset tokens directly in the API response — an
# unauthenticated account-takeover primitive for any known email address.
# `and DEBUG` is deliberate: launch.sh writes DEV_EXPOSE_RESET_TOKENS=true
# into the generated .env, so if that file is ever copied to a server this
# flag alone would hand out reset tokens. Gating it on DEBUG means production
# cannot enable it even by misconfiguration.
DEV_EXPOSE_RESET_TOKENS = (
    os.environ.get('DEV_EXPOSE_RESET_TOKENS', 'false').lower() == 'true' and DEBUG
)
GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
GOOGLE_REDIRECT_URI = os.environ.get('GOOGLE_REDIRECT_URI', 'http://localhost:8002/api/v1/auth/google/callback')
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:3000')
APP_URL = os.environ.get('APP_URL', 'http://localhost:8002')

CHARGILY_SECRET_KEY = os.environ.get('CHARGILY_SECRET_KEY', '')
CHARGILY_TEST_MODE = os.environ.get('CHARGILY_TEST_MODE', 'true').lower() == 'true'
CHARGILY_KEY = os.environ.get('CHARGILY_PUBLIC_KEY', '')
CHARGILY_SECRET = CHARGILY_SECRET_KEY
CHARGILY_URL = "https://pay.chargily.net/test/api/v2/" if CHARGILY_TEST_MODE else "https://pay.chargily.net/api/v2/"
