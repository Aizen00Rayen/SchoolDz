import os
from pathlib import Path
from dotenv import load_dotenv

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables
load_dotenv(os.path.join(BASE_DIR, '.env'))

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.environ.get('APP_KEY', 'django-insecure-%q(fy0te%gstq%wv2pevrtwm^9h%7!xitq5ny2!qan#331^&pd').replace('base64:', '')

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.environ.get('APP_DEBUG', 'true').lower() == 'true'

ALLOWED_HOSTS = ['*']


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

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': os.environ.get('DB_DATABASE', 'schooldz'),
        'USER': os.environ.get('DB_USERNAME', 'schooldz'),
        'PASSWORD': os.environ.get('DB_PASSWORD', 'schooldzpass'),
        'HOST': os.environ.get('DB_HOST', '127.0.0.1'),
        'PORT': os.environ.get('DB_PORT', '3306'),
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
cors_origins = os.environ.get('CORS_ORIGINS', '')
if cors_origins:
    CORS_ALLOWED_ORIGINS = [origin.strip() for origin in cors_origins.split(',') if origin.strip()]
else:
    CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_CREDENTIALS = True


# Authentication
AUTH_USER_MODEL = 'api.User'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'api.services.BearerTokenAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
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
DEV_EXPOSE_RESET_TOKENS = os.environ.get('DEV_EXPOSE_RESET_TOKENS', 'false').lower() == 'true'
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
