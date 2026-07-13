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

class BearerTokenAuthentication(TokenAuthentication):
    keyword = 'Bearer'


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
        payload_str = raw_body_bytes.decode('utf-8') if isinstance(raw_body_bytes, bytes) else raw_body_bytes
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
