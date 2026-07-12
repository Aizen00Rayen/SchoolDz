"""
SchoolDZ core: auth, dependencies, models base, tenant isolation.
"""
from __future__ import annotations

import base64
import json
import os
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Any

import bcrypt
import jwt
from fastapi import HTTPException, Request, Depends
from pydantic import BaseModel, EmailStr, Field, ConfigDict
from motor.motor_asyncio import AsyncIOMotorDatabase


JWT_ALGORITHM = "HS256"
ACCESS_TTL_MINUTES = 60 * 12  # 12h for dev friendliness
REFRESH_TTL_DAYS = 14


# ----------------------------- Password ------------------------------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ----------------------------- JWT ------------------------------

def _jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user: dict) -> str:
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "role": user.get("role"),
        "tenant_id": user.get("tenant_id"),
        "type": "access",
        "iat": int(datetime.now(timezone.utc).timestamp()),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TTL_MINUTES),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user: dict) -> str:
    payload = {
        "sub": user["id"],
        "type": "refresh",
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TTL_DAYS),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])


def cookies_secure() -> bool:
    return os.environ.get("COOKIE_SECURE", "false").lower() == "true"


def set_auth_cookies(response, access: str, refresh: str) -> None:
    response.set_cookie(
        "access_token", access, httponly=True, secure=cookies_secure(), samesite="lax",
        max_age=ACCESS_TTL_MINUTES * 60, path="/",
    )
    response.set_cookie(
        "refresh_token", refresh, httponly=True, secure=cookies_secure(), samesite="lax",
        max_age=REFRESH_TTL_DAYS * 86400, path="/",
    )


def clear_auth_cookies(response) -> None:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")


# ----------------------------- Models base ------------------------------

def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


class TimestampedModel(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    id: str = Field(default_factory=new_id)
    created_at: str = Field(default_factory=utcnow_iso)
    updated_at: str = Field(default_factory=utcnow_iso)


# ----------------------------- Roles ------------------------------

ROLE_SUPER_ADMIN = "super_admin"
ROLE_OWNER = "owner"
ROLE_DIRECTOR = "director"
ROLE_SECRETARY = "secretary"
ROLE_ACCOUNTANT = "accountant"
ROLE_TEACHER = "teacher"
ROLE_PARENT = "parent"
ROLE_STUDENT = "student"

ALL_ROLES = [
    ROLE_SUPER_ADMIN, ROLE_OWNER, ROLE_DIRECTOR, ROLE_SECRETARY,
    ROLE_ACCOUNTANT, ROLE_TEACHER, ROLE_PARENT, ROLE_STUDENT,
]

STAFF_ROLES = {ROLE_OWNER, ROLE_DIRECTOR, ROLE_SECRETARY, ROLE_ACCOUNTANT, ROLE_TEACHER}
ADMIN_ROLES = {ROLE_OWNER, ROLE_DIRECTOR}

# Roles a tenant admin is allowed to assign. Never super_admin: that would be
# a platform-level privilege escalation from inside a tenant.
TENANT_ASSIGNABLE_ROLES = {
    ROLE_OWNER, ROLE_DIRECTOR, ROLE_SECRETARY, ROLE_ACCOUNTANT,
    ROLE_TEACHER, ROLE_PARENT, ROLE_STUDENT,
}

MIN_PASSWORD_LENGTH = 8


def validate_password(password: str) -> None:
    if not password or len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    if len(password) > 128:
        raise HTTPException(400, "Password too long")


# ----------------------------- Rate limiting ------------------------------
# Simple in-memory sliding-window limiter for auth endpoints. Good enough for
# a single-process deployment; swap for redis-backed limiting when scaling out.

_rate_buckets: dict[str, list[float]] = {}


def rate_limit(request: Request, scope: str, limit: int = 10, window_seconds: int = 60) -> None:
    ip = request.client.host if request.client else "unknown"
    key = f"{scope}:{ip}"
    now = datetime.now(timezone.utc).timestamp()
    bucket = [t for t in _rate_buckets.get(key, []) if now - t < window_seconds]
    if len(bucket) >= limit:
        raise HTTPException(429, "Too many attempts, please try again later")
    bucket.append(now)
    _rate_buckets[key] = bucket
    # Opportunistic cleanup to keep memory bounded
    if len(_rate_buckets) > 10000:
        stale = [k for k, v in _rate_buckets.items() if not v or now - v[-1] > window_seconds]
        for k in stale:
            _rate_buckets.pop(k, None)


# ----------------------------- Google OAuth ------------------------------
# Short-lived signed "state" so /auth/google/callback can trust what intent
# (login vs. register) and tenant details a /auth/google/start redirect carried,
# without a server-side session.

def create_oauth_state(payload: dict, ttl_minutes: int = 10) -> str:
    data = dict(payload)
    data["type"] = "oauth_state"
    data["exp"] = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)
    return jwt.encode(data, _jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_oauth_state(token: str) -> dict:
    payload = decode_token(token)
    if payload.get("type") != "oauth_state":
        raise jwt.InvalidTokenError("not an oauth state token")
    return payload


def decode_google_id_token(id_token_str: str, client_id: str) -> dict:
    """Decode a Google id_token payload without verifying its signature.

    Safe here because the token was obtained directly from Google's token
    endpoint over a server-to-server TLS call (not supplied by the browser),
    so the transport itself already authenticates it. We still check aud/iss/exp
    so a token minted for a different app or already expired is rejected.
    """
    parts = id_token_str.split(".")
    if len(parts) != 3:
        raise ValueError("malformed id_token")
    padded = parts[1] + "=" * (-len(parts[1]) % 4)
    payload = json.loads(base64.urlsafe_b64decode(padded))
    if payload.get("aud") != client_id:
        raise ValueError("audience mismatch")
    if payload.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise ValueError("issuer mismatch")
    exp = payload.get("exp")
    if not exp or datetime.now(timezone.utc).timestamp() > exp:
        raise ValueError("expired id_token")
    if not payload.get("email"):
        raise ValueError("missing email")
    return payload


# One-time codes handing off the tokens minted at the end of the Google OAuth
# redirect dance to the SPA, so access/refresh tokens never sit in a URL
# (browser history, referrer headers, server logs).
_oauth_exchange_codes: dict[str, dict] = {}
OAUTH_CODE_TTL_SECONDS = 120


def store_oauth_exchange(payload: dict) -> str:
    code = secrets.token_urlsafe(32)
    _oauth_exchange_codes[code] = {
        "payload": payload,
        "expires": datetime.now(timezone.utc).timestamp() + OAUTH_CODE_TTL_SECONDS,
    }
    return code


def pop_oauth_exchange(code: str) -> Optional[dict]:
    entry = _oauth_exchange_codes.pop(code, None)
    if not entry:
        return None
    if entry["expires"] < datetime.now(timezone.utc).timestamp():
        return None
    return entry["payload"]


# ----------------------------- Auth dependency ------------------------------

def _extract_token(request: Request) -> Optional[str]:
    token = request.cookies.get("access_token")
    if token:
        return token
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


async def get_db(request: Request) -> AsyncIOMotorDatabase:
    return request.app.state.db


async def get_current_user(request: Request, db: AsyncIOMotorDatabase = Depends(get_db)) -> dict:
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_roles(*roles: str):
    async def _guard(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles and user.get("role") != ROLE_SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
    return _guard


async def get_tenant_scope(user: dict = Depends(get_current_user)) -> dict:
    """Returns the current user + tenant_id it operates within.
    Super admins must specify tenant via query param `?tenant_id=` for tenant-scoped endpoints
    (handled per-route). Regular users are pinned to their tenant.
    """
    return user


def tenant_filter(user: dict, extra: dict | None = None) -> dict:
    q = dict(extra or {})
    if user.get("role") != ROLE_SUPER_ADMIN:
        if not user.get("tenant_id"):
            raise HTTPException(status_code=403, detail="User has no tenant")
        q["tenant_id"] = user["tenant_id"]
    elif "tenant_id" not in q and user.get("tenant_id"):
        # Super admin can optionally be scoped
        q["tenant_id"] = user["tenant_id"]
    return q


# ----------------------------- Sanitize output ------------------------------

def sanitize(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    doc = dict(doc)
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc


def sanitize_many(docs: List[dict]) -> List[dict]:
    return [sanitize(d) for d in docs]
