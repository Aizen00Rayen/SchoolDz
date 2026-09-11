import hmac
import hashlib
import json
import base64
import time
import requests
from django.conf import settings
from django.core import signing
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.throttling import AnonRateThrottle

class BearerTokenAuthentication(TokenAuthentication):
    """DRF's own Token model has no expiry — a key issued once stays valid
    forever, so a token copied off a shared school PC or lifted from storage
    never stops working. Age it out here instead, and delete the stale row so
    the next login mints a fresh one. AUTH_TOKEN_MAX_AGE_DAYS = 0 disables."""
    keyword = 'Bearer'

    def authenticate_credentials(self, key):
        user, token = super().authenticate_credentials(key)
        max_age_days = getattr(settings, 'AUTH_TOKEN_MAX_AGE_DAYS', 0)
        if max_age_days:
            from django.utils import timezone
            from datetime import timedelta
            if timezone.now() - token.created > timedelta(days=max_age_days):
                token.delete()
                raise AuthenticationFailed('Session expired — please sign in again.')
        return user, token


class LoginRateThrottle(AnonRateThrottle):
    """Per-IP brute-force guard on /auth/login — shared by the web app and
    all three mobile apps. Rate comes from DEFAULT_THROTTLE_RATES['login']."""
    scope = 'login'


class PasswordResetRateThrottle(AnonRateThrottle):
    """Per-IP guard on the forgot/reset-password endpoints, so they can't be
    used to spam a target's inbox or brute-force reset tokens."""
    scope = 'password_reset'


class EnrollmentRateThrottle(AnonRateThrottle):
    """Per-IP guard on the public self-enrollment endpoint — it creates a
    real user account + student record per call, unlike a plain lookup."""
    scope = 'enrollment'


class StudentLookupRateThrottle(AnonRateThrottle):
    """Per-IP guard on the no-login student badge lookup. Student codes are
    sequential (STU-00001, STU-00002, ...) and a school's slug is public, so
    without a limit this endpoint is a directory of every child's name and
    photo, walkable in seconds. Rate comes from
    DEFAULT_THROTTLE_RATES['student_lookup']."""
    scope = 'student_lookup'


class RegisterRateThrottle(AnonRateThrottle):
    """Per-IP guard on /auth/register — like EnrollmentRateThrottle, this
    creates a real Tenant + User row per call and its 409 responses ("Email
    already registered") let an unthrottled caller enumerate accounts."""
    scope = 'register'


class QuizSubmitRateThrottle(AnonRateThrottle):
    """Per-IP guard on the no-login shared-link quiz submission endpoint —
    each call can persist several uploaded files with no login required."""
    scope = 'quiz_submit'


from chargily_pay import ChargilyClient as SDKChargilyClient
from chargily_pay.entity import Checkout as SDKCheckout

class ChargilyClient:
    def __init__(self):
        self.key = getattr(settings, 'CHARGILY_KEY', '')
        self.secret = getattr(settings, 'CHARGILY_SECRET', '')
        self.url = getattr(settings, 'CHARGILY_URL', 'https://pay.chargily.net/test/api/v2/')
        
        # Initialize the official SDK client
        self.sdk_client = SDKChargilyClient(
            key=self.key,
            secret=self.secret,
            url=self.url
        )

    def createCheckout(self, data):
        if not self.secret:
            raise RuntimeError('Chargily is not configured (CHARGILY_SECRET_KEY missing).')
        
        # Construct Checkout entity for the SDK
        checkout = SDKCheckout(
            success_url=data.get('success_url'),
            amount=data.get('amount'),
            currency=data.get('currency', 'dzd'),
            failure_url=data.get('failure_url'),
            description=data.get('description'),
            locale=data.get('locale'),
            webhook_endpoint=data.get('webhook_endpoint'),
            metadata=data.get('metadata')
        )
        return self.sdk_client.create_checkout(checkout)

    def getCheckout(self, chargily_checkout_id):
        if not self.secret:
            raise RuntimeError('Chargily is not configured (CHARGILY_SECRET_KEY missing).')
        
        try:
            return self.sdk_client.retrieve_checkout(chargily_checkout_id)
        except requests.exceptions.HTTPError as e:
            if hasattr(e, 'response') and e.response is not None and e.response.status_code == 404:
                return None
            raise

    def verifyWebhookSignature(self, raw_body_bytes, signature_header):
        if not signature_header or not self.secret:
            return False
        try:
            payload_str = raw_body_bytes.decode('utf-8') if isinstance(raw_body_bytes, bytes) else raw_body_bytes
        except UnicodeDecodeError:
            # A genuine Chargily payload is always UTF-8 JSON — a body that
            # isn't decodable at all can't possibly carry a valid signature,
            # so this is just another way to fail verification, not a
            # reason to 500.
            return False
        return self.sdk_client.validate_signature(signature_header, payload_str)


class GoogleOAuthService:
    @staticmethod
    def get_signed_state(intent, tenant_name=None, tenant_slug=None, center_type=None):
        payload = {
            'intent': intent,
            'exp': int(time.time()) + 600 # 10 minutes expiry
        }
        if intent == 'register':
            payload['tenant_name'] = tenant_name
            payload['tenant_slug'] = tenant_slug
            payload['center_type'] = center_type or 'tutoring'
            
        # We can use django's signing.dumps to securely sign the state payload.
        # This will be URL safe and tamper-proof.
        return signing.dumps(payload)

    @staticmethod
    def decode_state(state_str):
        try:
            payload = signing.loads(state_str)
            if not isinstance(payload, dict):
                return None
            if payload.get('exp', 0) < time.time():
                return None
            return payload
        except Exception:
            return None

    @staticmethod
    def decode_google_id_token(id_token, client_id):
        try:
            parts = id_token.split('.')
            if len(parts) != 3:
                return None
                
            # Decode payload
            payload_b64 = parts[1]
            # Add padding if needed
            padding = len(payload_b64) % 4
            if padding:
                payload_b64 += '=' * (4 - padding)
            
            # Decode base64
            decoded_bytes = base64.urlsafe_b64decode(payload_b64)
            payload = json.loads(decoded_bytes.decode('utf-8'))
            
            if not isinstance(payload, dict):
                return None
                
            # Verification matching Laravel's decodeGoogleIdToken:
            # aud == client_id, issuer, exp in future, email is not empty
            aud = payload.get('aud')
            if aud != client_id:
                return None
                
            iss = payload.get('iss')
            if iss not in ['accounts.google.com', 'https://accounts.google.com']:
                return None
                
            exp = payload.get('exp', 0)
            if exp < time.time():
                return None
                
            if not payload.get('email'):
                return None
                
            return payload
        except Exception:
            return None


def client_ip(request):
    """Real client IP behind nginx — X-Forwarded-For's first hop, since
    REMOTE_ADDR is the proxy itself on the live setup."""
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip()[:64]
    return (request.META.get('REMOTE_ADDR') or '')[:64]


def log_activity(request, tenant_id, action, *, category='data', user=None,
                 entity_type=None, entity_id=None, description=None):
    """Append one row to the tenant's audit trail. Deliberately swallows its
    own errors: an audit write must never be the reason a user's action
    fails, and the alternative (500s on every request if the table is mid
    migration) is far worse than a missing log line."""
    from .models import ActivityLog
    try:
        if not tenant_id:
            return
        actor = user if user is not None else getattr(request, 'user', None)
        actor = actor if getattr(actor, 'is_authenticated', False) else None
        ActivityLog.objects.create(
            tenant_id=tenant_id,
            user=actor,
            user_label=(getattr(actor, 'name', None) or getattr(actor, 'email', None) or 'Anonymous')[:255],
            category=category,
            action=action[:50],
            entity_type=(entity_type or None) and entity_type[:50],
            entity_id=(entity_id or None) and str(entity_id)[:36],
            description=(description or None) and description[:500],
            ip_address=client_ip(request) if request is not None else None,
            user_agent=(request.META.get('HTTP_USER_AGENT', '')[:255] or None) if request is not None else None,
        )
    except Exception:
        pass
