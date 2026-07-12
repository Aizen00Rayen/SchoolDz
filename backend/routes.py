"""SchoolDZ REST API routes."""
from __future__ import annotations

import os
import re
import secrets
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional, List
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import RedirectResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from core import (
    ADMIN_ROLES, ROLE_OWNER, ROLE_SUPER_ADMIN, STAFF_ROLES,
    TENANT_ASSIGNABLE_ROLES,
    clear_auth_cookies, cookies_secure, create_access_token, create_refresh_token,
    create_oauth_state, decode_google_id_token, decode_oauth_state, decode_token,
    get_current_user, get_db, hash_password, new_id, pop_oauth_exchange, rate_limit,
    require_roles, sanitize, set_auth_cookies, store_oauth_exchange, tenant_filter,
    utcnow_iso, validate_password, verify_password,
)
from models import (
    AttendanceBulk, ClassSession, Course, CourseCreate, Group, GroupCreate,
    GroupEnrollment, LoginRequest, Parent, ParentCreate, Payment, PaymentCreate,
    SessionCreate, Student, StudentCreate, Teacher, TeacherCreate, Tenant,
    TenantCreate, User, UserCreate, UserRegisterPublic, UserUpdate,
    ForgotPasswordRequest, ResetPasswordRequest, GoogleExchangeRequest,
)


router = APIRouter(prefix="/api/v1")

SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$")


def safe_regex(q: str) -> dict:
    """Case-insensitive regex filter with user input escaped (no regex injection/ReDoS)."""
    return {"$regex": re.escape(q), "$options": "i"}

# --------------------------------------------------------------------
# Health
# --------------------------------------------------------------------
@router.get("/health")
async def health():
    return {"status": "ok", "service": "schooldz", "time": utcnow_iso()}


# --------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------
auth_router = APIRouter(prefix="/auth", tags=["auth"])


async def _issue_tokens_for(user_doc: dict, response: Response) -> dict:
    access = create_access_token(user_doc)
    refresh = create_refresh_token(user_doc)
    set_auth_cookies(response, access, refresh)
    return {"access_token": access, "refresh_token": refresh, "user": sanitize(user_doc)}


@auth_router.post("/register")
async def register(payload: UserRegisterPublic, request: Request, response: Response,
                   db: AsyncIOMotorDatabase = Depends(get_db)):
    rate_limit(request, "register", limit=5, window_seconds=60)
    validate_password(payload.password)
    slug = payload.tenant_slug.strip().lower()
    if not SLUG_RE.match(slug):
        raise HTTPException(400, "Invalid slug (a-z, 0-9, hyphens, 3-32 chars)")
    if await db.tenants.find_one({"slug": slug}):
        raise HTTPException(409, "This workspace URL is already taken")
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")

    tenant = Tenant(
        name=payload.tenant_name.strip(),
        slug=slug,
        center_type=payload.center_type or "tutoring",
        status="trial",
        trial_ends_at=(datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
    )
    await db.tenants.insert_one(tenant.model_dump())

    user = User(
        tenant_id=tenant.id,
        email=email,
        name=payload.name.strip(),
        role=ROLE_OWNER,
        email_verified=True,
    )
    doc = user.model_dump()
    doc["password_hash"] = hash_password(payload.password)
    await db.users.insert_one(doc)

    return await _issue_tokens_for(doc, response)


@auth_router.post("/login")
async def login(payload: LoginRequest, request: Request, response: Response,
                db: AsyncIOMotorDatabase = Depends(get_db)):
    rate_limit(request, "login", limit=10, window_seconds=60)
    email = payload.email.lower()
    query: dict = {"email": email}
    if payload.tenant_slug:
        tenant = await db.tenants.find_one({"slug": payload.tenant_slug.lower()})
        if not tenant:
            raise HTTPException(404, "Workspace not found")
        query["tenant_id"] = tenant["id"]

    user_doc = await db.users.find_one(query)
    if not user_doc or not verify_password(payload.password, user_doc.get("password_hash", "")):
        raise HTTPException(401, "Invalid credentials")
    if not user_doc.get("is_active", True):
        raise HTTPException(403, "Account disabled")

    return await _issue_tokens_for(user_doc, response)


@auth_router.post("/logout")
async def logout(response: Response, _: dict = Depends(get_current_user)):
    clear_auth_cookies(response)
    return {"ok": True}


@auth_router.get("/me")
async def me(user: dict = Depends(get_current_user),
             db: AsyncIOMotorDatabase = Depends(get_db)):
    tenant = None
    if user.get("tenant_id"):
        tenant = sanitize(await db.tenants.find_one({"id": user["tenant_id"]}))
    return {"user": user, "tenant": tenant}


@auth_router.post("/refresh")
async def refresh(request: Request, response: Response,
                  db: AsyncIOMotorDatabase = Depends(get_db)):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(401, "No refresh token")
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(401, "Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(401, "Invalid token type")
    user_doc = await db.users.find_one({"id": payload["sub"]})
    if not user_doc:
        raise HTTPException(401, "User not found")
    access = create_access_token(user_doc)
    response.set_cookie("access_token", access, httponly=True, secure=cookies_secure(),
                        samesite="lax", max_age=12 * 3600, path="/")
    return {"access_token": access}


@auth_router.post("/forgot-password")
async def forgot(payload: ForgotPasswordRequest, request: Request,
                 db: AsyncIOMotorDatabase = Depends(get_db)):
    rate_limit(request, "forgot", limit=5, window_seconds=300)
    user = await db.users.find_one({"email": payload.email.lower()})
    if user:
        token = secrets.token_urlsafe(32)
        await db.password_reset_tokens.insert_one({
            "token": token,
            "user_id": user["id"],
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
            "used": False,
            "created_at": utcnow_iso(),
        })
        # Production sends the token by email. Returning it in the response is
        # account takeover for anyone who knows a victim's email, so it is only
        # exposed when explicitly enabled for local development.
        if os.environ.get("DEV_EXPOSE_RESET_TOKENS", "false").lower() == "true":
            return {"ok": True, "dev_token": token, "message": "Reset link generated (dev mode)"}
    # Same response whether or not the email exists (no account enumeration)
    return {"ok": True, "message": "If this email exists, a reset link has been sent"}


@auth_router.post("/reset-password")
async def reset(payload: ResetPasswordRequest, request: Request,
                db: AsyncIOMotorDatabase = Depends(get_db)):
    rate_limit(request, "reset", limit=10, window_seconds=300)
    validate_password(payload.new_password)
    row = await db.password_reset_tokens.find_one({"token": payload.token})
    if not row or row.get("used"):
        raise HTTPException(400, "Invalid or expired token")
    if row["expires_at"] < utcnow_iso():
        raise HTTPException(400, "Token expired")
    await db.users.update_one({"id": row["user_id"]},
                              {"$set": {"password_hash": hash_password(payload.new_password),
                                        "updated_at": utcnow_iso()}})
    await db.password_reset_tokens.update_one({"token": payload.token}, {"$set": {"used": True}})
    return {"ok": True}


# --------------------------------------------------------------------
# Google OAuth (Sign in / Sign up with Google)
# --------------------------------------------------------------------
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def _google_client_id() -> str:
    v = os.environ.get("GOOGLE_CLIENT_ID", "")
    if not v:
        raise HTTPException(503, "Google sign-in is not configured on this server")
    return v


def _google_client_secret() -> str:
    v = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    if not v:
        raise HTTPException(503, "Google sign-in is not configured on this server")
    return v


def _google_redirect_uri() -> str:
    return os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:8001/api/v1/auth/google/callback")


def _frontend_url() -> str:
    return os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")


@auth_router.get("/google/start")
async def google_start(request: Request, intent: str = "login",
                       tenant_name: Optional[str] = None, tenant_slug: Optional[str] = None,
                       center_type: Optional[str] = None):
    rate_limit(request, "google_start", limit=20, window_seconds=60)
    if intent not in ("login", "register"):
        raise HTTPException(400, "Invalid intent")

    state_payload: dict = {"intent": intent}
    if intent == "register":
        if not tenant_name or not tenant_slug:
            raise HTTPException(400, "tenant_name and tenant_slug are required to sign up")
        slug = tenant_slug.strip().lower()
        if not SLUG_RE.match(slug):
            raise HTTPException(400, "Invalid slug (a-z, 0-9, hyphens, 3-32 chars)")
        state_payload.update({
            "tenant_name": tenant_name.strip()[:120],
            "tenant_slug": slug,
            "center_type": center_type or "tutoring",
        })

    state = create_oauth_state(state_payload)
    params = {
        "client_id": _google_client_id(),
        "redirect_uri": _google_redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}", status_code=302)


@auth_router.get("/google/callback")
async def google_callback(request: Request, code: Optional[str] = None,
                          state: Optional[str] = None, error: Optional[str] = None,
                          db: AsyncIOMotorDatabase = Depends(get_db)):
    front = _frontend_url()
    rate_limit(request, "google_callback", limit=30, window_seconds=60)

    if error or not code or not state:
        return RedirectResponse(f"{front}/oauth/callback?error=access_denied", status_code=302)

    try:
        state_payload = decode_oauth_state(state)
    except Exception:
        return RedirectResponse(f"{front}/oauth/callback?error=invalid_state", status_code=302)

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            token_resp = await client.post(GOOGLE_TOKEN_URL, data={
                "code": code,
                "client_id": _google_client_id(),
                "client_secret": _google_client_secret(),
                "redirect_uri": _google_redirect_uri(),
                "grant_type": "authorization_code",
            })
    except httpx.HTTPError:
        return RedirectResponse(f"{front}/oauth/callback?error=google_unreachable", status_code=302)

    if token_resp.status_code != 200:
        return RedirectResponse(f"{front}/oauth/callback?error=google_token_exchange_failed", status_code=302)

    id_token_str = token_resp.json().get("id_token")
    if not id_token_str:
        return RedirectResponse(f"{front}/oauth/callback?error=no_id_token", status_code=302)

    try:
        profile = decode_google_id_token(id_token_str, _google_client_id())
    except ValueError:
        return RedirectResponse(f"{front}/oauth/callback?error=invalid_token", status_code=302)

    if not profile.get("email_verified"):
        return RedirectResponse(f"{front}/oauth/callback?error=email_not_verified", status_code=302)

    email = profile["email"].lower()
    existing = await db.users.find_one({"email": email})

    if existing:
        if not existing.get("is_active", True):
            return RedirectResponse(f"{front}/oauth/callback?error=account_disabled", status_code=302)
        user_doc = existing
        if not user_doc.get("google_sub"):
            await db.users.update_one(
                {"id": user_doc["id"]},
                {"$set": {"google_sub": profile["sub"], "auth_provider": "google",
                          "updated_at": utcnow_iso()}},
            )
    else:
        if state_payload.get("intent") != "register":
            q = urlencode({"error": "no_account", "email": email})
            return RedirectResponse(f"{front}/oauth/callback?{q}", status_code=302)

        slug = state_payload["tenant_slug"]
        if await db.tenants.find_one({"slug": slug}):
            return RedirectResponse(f"{front}/oauth/callback?error=slug_taken", status_code=302)

        tenant = Tenant(
            name=state_payload["tenant_name"], slug=slug,
            center_type=state_payload.get("center_type") or "tutoring",
            status="trial",
            trial_ends_at=(datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
        )
        await db.tenants.insert_one(tenant.model_dump())

        new_user = User(
            tenant_id=tenant.id, email=email,
            name=profile.get("name") or email.split("@")[0],
            role=ROLE_OWNER, email_verified=True,
        )
        user_doc = new_user.model_dump()
        # Random, never-shared password hash: this account only authenticates via
        # Google unless the owner later sets a password through forgot-password.
        user_doc["password_hash"] = hash_password(secrets.token_urlsafe(32))
        user_doc["google_sub"] = profile["sub"]
        user_doc["auth_provider"] = "google"
        await db.users.insert_one(user_doc)

    access = create_access_token(user_doc)
    refresh = create_refresh_token(user_doc)
    exchange_code = store_oauth_exchange({
        "access_token": access, "refresh_token": refresh, "user": sanitize(user_doc),
    })
    return RedirectResponse(f"{front}/oauth/callback?code={exchange_code}", status_code=302)


@auth_router.post("/google/exchange")
async def google_exchange(payload: GoogleExchangeRequest, request: Request, response: Response):
    rate_limit(request, "google_exchange", limit=20, window_seconds=60)
    data = pop_oauth_exchange(payload.code)
    if not data:
        raise HTTPException(400, "Invalid or expired code")
    set_auth_cookies(response, data["access_token"], data["refresh_token"])
    return data


router.include_router(auth_router)


# --------------------------------------------------------------------
# Tenants (Super Admin + public info)
# --------------------------------------------------------------------
tenants_router = APIRouter(prefix="/tenants", tags=["tenants"])


# Fields safe to expose on the unauthenticated by-slug endpoint (branding only)
TENANT_PUBLIC_FIELDS = ("id", "name", "slug", "center_type", "status", "logo_url",
                        "primary_color", "accent_color", "language")


@tenants_router.get("/by-slug/{slug}")
async def get_tenant_by_slug(slug: str, db: AsyncIOMotorDatabase = Depends(get_db)):
    t = await db.tenants.find_one({"slug": slug.lower()})
    if not t:
        raise HTTPException(404, "Tenant not found")
    return {k: t.get(k) for k in TENANT_PUBLIC_FIELDS}


@tenants_router.get("")
async def list_tenants(db: AsyncIOMotorDatabase = Depends(get_db),
                       _: dict = Depends(require_roles(ROLE_SUPER_ADMIN))):
    items = await db.tenants.find({}, {"_id": 0}).to_list(1000)
    return {"items": items, "total": len(items)}


@tenants_router.post("")
async def create_tenant(payload: TenantCreate, db: AsyncIOMotorDatabase = Depends(get_db),
                        _: dict = Depends(require_roles(ROLE_SUPER_ADMIN))):
    slug = payload.slug.lower()
    if not SLUG_RE.match(slug):
        raise HTTPException(400, "Invalid slug")
    if await db.tenants.find_one({"slug": slug}):
        raise HTTPException(409, "Slug already taken")
    validate_password(payload.owner_password)
    email = payload.owner_email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Owner email already registered")
    t = Tenant(name=payload.name, slug=slug, center_type=payload.center_type or "tutoring",
               status="active")
    await db.tenants.insert_one(t.model_dump())
    u = User(tenant_id=t.id, email=email, name=payload.owner_name, role=ROLE_OWNER,
             email_verified=True)
    doc = u.model_dump()
    doc["password_hash"] = hash_password(payload.owner_password)
    await db.users.insert_one(doc)
    return {"tenant": t.model_dump(), "owner": sanitize(doc)}


# Settings a tenant owner may edit. Plan, status, quotas and trial dates are
# billing-controlled: letting an owner PATCH them is a subscription bypass.
TENANT_OWNER_EDITABLE = {
    "name", "center_type", "logo_url", "primary_color", "accent_color",
    "language", "currency", "timezone", "invoice_prefix", "student_prefix",
}


@tenants_router.patch("/{tenant_id}")
async def update_tenant(tenant_id: str, updates: dict,
                        db: AsyncIOMotorDatabase = Depends(get_db),
                        user: dict = Depends(get_current_user)):
    if user["role"] not in (ROLE_SUPER_ADMIN, ROLE_OWNER):
        raise HTTPException(403, "Forbidden")
    if user["role"] != ROLE_SUPER_ADMIN and user.get("tenant_id") != tenant_id:
        raise HTTPException(403, "Cannot edit another tenant")
    if user["role"] == ROLE_SUPER_ADMIN:
        updates = {k: v for k, v in updates.items() if k not in ("id", "created_at", "slug")}
    else:
        updates = {k: v for k, v in updates.items() if k in TENANT_OWNER_EDITABLE}
    if not updates:
        raise HTTPException(400, "No editable fields in payload")
    updates["updated_at"] = utcnow_iso()
    await db.tenants.update_one({"id": tenant_id}, {"$set": updates})
    return sanitize(await db.tenants.find_one({"id": tenant_id}))


MAX_LOGO_BYTES = 3 * 1024 * 1024  # 3MB
ALLOWED_LOGO_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
LOGO_UPLOAD_DIR = Path(__file__).parent / "uploads" / "logos"


@tenants_router.post("/{tenant_id}/logo")
async def upload_tenant_logo(tenant_id: str, file: UploadFile = File(...),
                             db: AsyncIOMotorDatabase = Depends(get_db),
                             user: dict = Depends(get_current_user)):
    if user["role"] not in (ROLE_SUPER_ADMIN, ROLE_OWNER):
        raise HTTPException(403, "Forbidden")
    if user["role"] != ROLE_SUPER_ADMIN and user.get("tenant_id") != tenant_id:
        raise HTTPException(403, "Cannot edit another tenant")

    ext = ALLOWED_LOGO_TYPES.get(file.content_type)
    if not ext:
        raise HTTPException(400, "Only PNG, JPEG, WEBP or GIF images are allowed")

    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")
    if len(content) > MAX_LOGO_BYTES:
        raise HTTPException(400, "Logo must be under 3MB")

    tenant = await db.tenants.find_one({"id": tenant_id})
    if not tenant:
        raise HTTPException(404, "Tenant not found")

    LOGO_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    # Random filename: never trust the client-supplied name for a filesystem path.
    filename = f"{tenant_id}-{secrets.token_hex(6)}{ext}"
    (LOGO_UPLOAD_DIR / filename).write_bytes(content)

    # Best-effort cleanup of the previous logo so uploads don't accumulate forever.
    old_logo = tenant.get("logo_url") or ""
    if old_logo.startswith("/uploads/logos/"):
        (LOGO_UPLOAD_DIR / old_logo.rsplit("/", 1)[-1]).unlink(missing_ok=True)

    new_url = f"/uploads/logos/{filename}"
    await db.tenants.update_one({"id": tenant_id},
                                {"$set": {"logo_url": new_url, "updated_at": utcnow_iso()}})
    return sanitize(await db.tenants.find_one({"id": tenant_id}))


router.include_router(tenants_router)


# --------------------------------------------------------------------
# Users (tenant-scoped staff management)
# --------------------------------------------------------------------
users_router = APIRouter(prefix="/users", tags=["users"])


@users_router.get("")
async def list_users(db: AsyncIOMotorDatabase = Depends(get_db),
                     user: dict = Depends(get_current_user),
                     role: Optional[str] = None):
    q = tenant_filter(user)
    if role:
        q["role"] = role
    items = await db.users.find(q, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    return {"items": items, "total": len(items)}


@users_router.post("")
async def create_user(payload: UserCreate, db: AsyncIOMotorDatabase = Depends(get_db),
                      user: dict = Depends(get_current_user)):
    if user["role"] not in ADMIN_ROLES and user["role"] != ROLE_SUPER_ADMIN:
        raise HTTPException(403, "Only owners/directors can add users")
    if payload.role not in TENANT_ASSIGNABLE_ROLES:
        raise HTTPException(400, "Invalid role")
    validate_password(payload.password)
    # Enforce the tenant's user quota
    if user.get("tenant_id"):
        tenant = await db.tenants.find_one({"id": user["tenant_id"]})
        max_users = (tenant or {}).get("max_users", 20)
        current = await db.users.count_documents({"tenant_id": user["tenant_id"]})
        if current >= max_users:
            raise HTTPException(403, "User limit reached for your plan")
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
    new_user = User(tenant_id=user.get("tenant_id"), email=email, name=payload.name,
                    role=payload.role, phone=payload.phone, email_verified=True)
    doc = new_user.model_dump()
    doc["password_hash"] = hash_password(payload.password)
    await db.users.insert_one(doc)
    return sanitize(doc)


@users_router.patch("/{user_id}")
async def update_user(user_id: str, payload: UserUpdate, db: AsyncIOMotorDatabase = Depends(get_db),
                      user: dict = Depends(get_current_user)):
    if user["role"] not in ADMIN_ROLES and user["role"] != ROLE_SUPER_ADMIN:
        raise HTTPException(403, "Forbidden")
    q = tenant_filter(user, {"id": user_id})
    target = await db.users.find_one(q)
    if not target:
        raise HTTPException(404, "Not found")
    if target.get("role") == ROLE_SUPER_ADMIN:
        raise HTTPException(400, "Cannot edit a super admin account")

    updates: dict = {}
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(400, "Name cannot be empty")
        updates["name"] = name
    if payload.phone is not None:
        updates["phone"] = payload.phone
    if payload.role is not None:
        if payload.role not in TENANT_ASSIGNABLE_ROLES:
            raise HTTPException(400, "Invalid role")
        updates["role"] = payload.role
    if payload.is_active is not None:
        if user_id == user["id"] and not payload.is_active:
            raise HTTPException(400, "Cannot deactivate your own account")
        updates["is_active"] = payload.is_active
    if payload.email is not None:
        email = payload.email.lower()
        if email != target["email"] and await db.users.find_one({"email": email}):
            raise HTTPException(409, "Email already registered")
        updates["email"] = email

    if not updates:
        raise HTTPException(400, "No editable fields in payload")
    updates["updated_at"] = utcnow_iso()
    await db.users.update_one(q, {"$set": updates})
    return sanitize(await db.users.find_one(q, {"_id": 0, "password_hash": 0}))


@users_router.delete("/{user_id}")
async def delete_user(user_id: str, db: AsyncIOMotorDatabase = Depends(get_db),
                      user: dict = Depends(get_current_user)):
    if user["role"] not in ADMIN_ROLES and user["role"] != ROLE_SUPER_ADMIN:
        raise HTTPException(403, "Forbidden")
    if user_id == user["id"]:
        raise HTTPException(400, "Cannot delete yourself")
    q = tenant_filter(user, {"id": user_id})
    target = await db.users.find_one(q)
    if not target:
        raise HTTPException(404, "Not found")
    if target.get("role") == ROLE_SUPER_ADMIN:
        raise HTTPException(400, "Cannot delete a super admin account")
    await db.users.delete_one(q)
    return {"ok": True}


router.include_router(users_router)


# --------------------------------------------------------------------
# Generic CRUD helper
# --------------------------------------------------------------------
async def _create_scoped(db, collection: str, doc: dict, user: dict):
    doc["tenant_id"] = user["tenant_id"]
    await db[collection].insert_one(doc)
    return sanitize(doc)


async def _list_scoped(db, collection: str, user: dict, extra: dict | None = None,
                       limit: int = 500, sort_key: str = "created_at"):
    q = tenant_filter(user, extra or {})
    items = await db[collection].find(q, {"_id": 0}).sort(sort_key, -1).to_list(limit)
    return {"items": items, "total": len(items)}


async def _get_scoped(db, collection: str, item_id: str, user: dict):
    q = tenant_filter(user, {"id": item_id})
    doc = await db[collection].find_one(q, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    return doc


PROTECTED_UPDATE_FIELDS = ("id", "tenant_id", "created_at", "password_hash")


async def _update_scoped(db, collection: str, item_id: str, updates: dict, user: dict):
    q = tenant_filter(user, {"id": item_id})
    # Drop protected fields and any key that could smuggle Mongo operators/paths
    updates = {k: v for k, v in updates.items()
               if k not in PROTECTED_UPDATE_FIELDS
               and isinstance(k, str) and not k.startswith("$") and "." not in k}
    updates["updated_at"] = utcnow_iso()
    r = await db[collection].update_one(q, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return await _get_scoped(db, collection, item_id, user)


async def _delete_scoped(db, collection: str, item_id: str, user: dict):
    q = tenant_filter(user, {"id": item_id})
    r = await db[collection].delete_one(q)
    if r.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# --------------------------------------------------------------------
# Students
# --------------------------------------------------------------------
students_router = APIRouter(prefix="/students", tags=["students"])


@students_router.get("")
async def list_students(db=Depends(get_db), user=Depends(get_current_user),
                        q: Optional[str] = None, status: Optional[str] = None):
    extra: dict = {}
    if status:
        extra["status"] = status
    if q:
        extra["$or"] = [
            {"first_name": safe_regex(q)},
            {"last_name": safe_regex(q)},
            {"email": safe_regex(q)},
            {"phone": safe_regex(q)},
        ]
    return await _list_scoped(db, "students", user, extra)


@students_router.post("")
async def create_student(payload: StudentCreate, db=Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in STAFF_ROLES and user["role"] != ROLE_SUPER_ADMIN:
        raise HTTPException(403, "Forbidden")
    # Generate student_code
    tenant = await db.tenants.find_one({"id": user["tenant_id"]})
    prefix = (tenant or {}).get("student_prefix", "STU-")
    count = await db.students.count_documents({"tenant_id": user["tenant_id"]})
    student = Student(**payload.model_dump(), tenant_id=user["tenant_id"],
                      student_code=f"{prefix}{count + 1:05d}")
    return await _create_scoped(db, "students", student.model_dump(), user)


@students_router.get("/{item_id}")
async def get_student(item_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await _get_scoped(db, "students", item_id, user)


@students_router.patch("/{item_id}")
async def update_student(item_id: str, updates: dict, db=Depends(get_db),
                         user=Depends(get_current_user)):
    return await _update_scoped(db, "students", item_id, updates, user)


@students_router.delete("/{item_id}")
async def delete_student(item_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await _delete_scoped(db, "students", item_id, user)


router.include_router(students_router)


# --------------------------------------------------------------------
# Parents
# --------------------------------------------------------------------
parents_router = APIRouter(prefix="/parents", tags=["parents"])


@parents_router.get("")
async def list_parents(db=Depends(get_db), user=Depends(get_current_user), q: Optional[str] = None):
    extra: dict = {}
    if q:
        extra["$or"] = [
            {"name": safe_regex(q)},
            {"email": safe_regex(q)},
            {"phone": safe_regex(q)},
        ]
    return await _list_scoped(db, "parents", user, extra)


@parents_router.post("")
async def create_parent(payload: ParentCreate, db=Depends(get_db), user=Depends(get_current_user)):
    parent = Parent(**payload.model_dump(), tenant_id=user["tenant_id"])
    return await _create_scoped(db, "parents", parent.model_dump(), user)


@parents_router.get("/{item_id}")
async def get_parent(item_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await _get_scoped(db, "parents", item_id, user)


@parents_router.patch("/{item_id}")
async def update_parent(item_id: str, updates: dict, db=Depends(get_db),
                        user=Depends(get_current_user)):
    return await _update_scoped(db, "parents", item_id, updates, user)


@parents_router.delete("/{item_id}")
async def delete_parent(item_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await _delete_scoped(db, "parents", item_id, user)


router.include_router(parents_router)


# --------------------------------------------------------------------
# Teachers
# --------------------------------------------------------------------
teachers_router = APIRouter(prefix="/teachers", tags=["teachers"])


@teachers_router.get("")
async def list_teachers(db=Depends(get_db), user=Depends(get_current_user), q: Optional[str] = None):
    extra: dict = {}
    if q:
        extra["$or"] = [
            {"first_name": safe_regex(q)},
            {"last_name": safe_regex(q)},
            {"email": safe_regex(q)},
        ]
    return await _list_scoped(db, "teachers", user, extra)


@teachers_router.post("")
async def create_teacher(payload: TeacherCreate, db=Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in STAFF_ROLES and user["role"] != ROLE_SUPER_ADMIN:
        raise HTTPException(403, "Forbidden")
    teacher = Teacher(**payload.model_dump(), tenant_id=user["tenant_id"])
    return await _create_scoped(db, "teachers", teacher.model_dump(), user)


@teachers_router.get("/{item_id}")
async def get_teacher(item_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await _get_scoped(db, "teachers", item_id, user)


@teachers_router.patch("/{item_id}")
async def update_teacher(item_id: str, updates: dict, db=Depends(get_db),
                         user=Depends(get_current_user)):
    return await _update_scoped(db, "teachers", item_id, updates, user)


@teachers_router.delete("/{item_id}")
async def delete_teacher(item_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await _delete_scoped(db, "teachers", item_id, user)


router.include_router(teachers_router)


# --------------------------------------------------------------------
# Courses
# --------------------------------------------------------------------
courses_router = APIRouter(prefix="/courses", tags=["courses"])


@courses_router.get("")
async def list_courses(db=Depends(get_db), user=Depends(get_current_user), q: Optional[str] = None):
    extra: dict = {}
    if q:
        extra["$or"] = [
            {"title": safe_regex(q)},
            {"category": safe_regex(q)},
        ]
    return await _list_scoped(db, "courses", user, extra)


@courses_router.post("")
async def create_course(payload: CourseCreate, db=Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in STAFF_ROLES and user["role"] != ROLE_SUPER_ADMIN:
        raise HTTPException(403, "Forbidden")
    course = Course(**payload.model_dump(), tenant_id=user["tenant_id"])
    return await _create_scoped(db, "courses", course.model_dump(), user)


@courses_router.get("/{item_id}")
async def get_course(item_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await _get_scoped(db, "courses", item_id, user)


@courses_router.patch("/{item_id}")
async def update_course(item_id: str, updates: dict, db=Depends(get_db),
                        user=Depends(get_current_user)):
    return await _update_scoped(db, "courses", item_id, updates, user)


@courses_router.delete("/{item_id}")
async def delete_course(item_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await _delete_scoped(db, "courses", item_id, user)


router.include_router(courses_router)


# --------------------------------------------------------------------
# Groups
# --------------------------------------------------------------------
groups_router = APIRouter(prefix="/groups", tags=["groups"])


@groups_router.get("")
async def list_groups(db=Depends(get_db), user=Depends(get_current_user),
                      course_id: Optional[str] = None):
    extra: dict = {}
    if course_id:
        extra["course_id"] = course_id
    return await _list_scoped(db, "groups", user, extra)


@groups_router.post("")
async def create_group(payload: GroupCreate, db=Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in STAFF_ROLES and user["role"] != ROLE_SUPER_ADMIN:
        raise HTTPException(403, "Forbidden")
    group = Group(**payload.model_dump(), tenant_id=user["tenant_id"])
    return await _create_scoped(db, "groups", group.model_dump(), user)


@groups_router.get("/{item_id}")
async def get_group(item_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await _get_scoped(db, "groups", item_id, user)


@groups_router.patch("/{item_id}")
async def update_group(item_id: str, updates: dict, db=Depends(get_db),
                       user=Depends(get_current_user)):
    return await _update_scoped(db, "groups", item_id, updates, user)


@groups_router.delete("/{item_id}")
async def delete_group(item_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await _delete_scoped(db, "groups", item_id, user)


@groups_router.post("/{item_id}/enroll")
async def enroll_student(item_id: str, payload: GroupEnrollment,
                         db=Depends(get_db), user=Depends(get_current_user)):
    group = await _get_scoped(db, "groups", item_id, user)
    if payload.student_id in group.get("student_ids", []):
        return group
    q = tenant_filter(user, {"id": item_id})
    await db.groups.update_one(q, {"$addToSet": {"student_ids": payload.student_id},
                                   "$set": {"updated_at": utcnow_iso()}})
    return await _get_scoped(db, "groups", item_id, user)


@groups_router.post("/{item_id}/unenroll")
async def unenroll_student(item_id: str, payload: GroupEnrollment,
                           db=Depends(get_db), user=Depends(get_current_user)):
    q = tenant_filter(user, {"id": item_id})
    await db.groups.update_one(q, {"$pull": {"student_ids": payload.student_id},
                                   "$set": {"updated_at": utcnow_iso()}})
    return await _get_scoped(db, "groups", item_id, user)


router.include_router(groups_router)


# --------------------------------------------------------------------
# Sessions
# --------------------------------------------------------------------
sessions_router = APIRouter(prefix="/sessions", tags=["sessions"])


@sessions_router.get("")
async def list_sessions(db=Depends(get_db), user=Depends(get_current_user),
                        group_id: Optional[str] = None,
                        from_date: Optional[str] = None, to_date: Optional[str] = None):
    extra: dict = {}
    if group_id:
        extra["group_id"] = group_id
    if from_date or to_date:
        rng: dict = {}
        if from_date:
            rng["$gte"] = from_date
        if to_date:
            rng["$lte"] = to_date
        extra["start_at"] = rng
    q = tenant_filter(user, extra)
    items = await db.sessions.find(q, {"_id": 0}).sort("start_at", 1).to_list(1000)
    return {"items": items, "total": len(items)}


@sessions_router.post("")
async def create_session(payload: SessionCreate, db=Depends(get_db),
                         user=Depends(get_current_user)):
    if user["role"] not in STAFF_ROLES and user["role"] != ROLE_SUPER_ADMIN:
        raise HTTPException(403, "Forbidden")
    # Attach course_id from group
    group = await db.groups.find_one({"id": payload.group_id, "tenant_id": user["tenant_id"]})
    if not group:
        raise HTTPException(404, "Group not found")
    s = ClassSession(**payload.model_dump(), tenant_id=user["tenant_id"],
                     course_id=group.get("course_id"))
    return await _create_scoped(db, "sessions", s.model_dump(), user)


@sessions_router.get("/{item_id}")
async def get_session(item_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await _get_scoped(db, "sessions", item_id, user)


@sessions_router.patch("/{item_id}")
async def update_session(item_id: str, updates: dict, db=Depends(get_db),
                         user=Depends(get_current_user)):
    return await _update_scoped(db, "sessions", item_id, updates, user)


@sessions_router.delete("/{item_id}")
async def delete_session(item_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await _delete_scoped(db, "sessions", item_id, user)


router.include_router(sessions_router)


# --------------------------------------------------------------------
# Attendance
# --------------------------------------------------------------------
attendance_router = APIRouter(prefix="/attendance", tags=["attendance"])


@attendance_router.get("/session/{session_id}")
async def get_attendance(session_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    q = tenant_filter(user, {"session_id": session_id})
    items = await db.attendance.find(q, {"_id": 0}).to_list(1000)
    return {"items": items, "total": len(items)}


@attendance_router.post("/session/{session_id}")
async def bulk_mark(session_id: str, payload: AttendanceBulk,
                    db=Depends(get_db), user=Depends(get_current_user)):
    if user["role"] not in STAFF_ROLES and user["role"] != ROLE_SUPER_ADMIN:
        raise HTTPException(403, "Forbidden")
    # Ensure session belongs to tenant
    sess = await db.sessions.find_one({"id": session_id, "tenant_id": user["tenant_id"]})
    if not sess:
        raise HTTPException(404, "Session not found")
    now = utcnow_iso()
    for m in payload.marks:
        await db.attendance.update_one(
            {"tenant_id": user["tenant_id"], "session_id": session_id, "student_id": m.student_id},
            {"$set": {
                "id": new_id(),
                "tenant_id": user["tenant_id"],
                "session_id": session_id,
                "student_id": m.student_id,
                "status": m.status,
                "note": m.note,
                "marked_by": user["id"],
                "marked_at": now,
            }},
            upsert=True,
        )
    items = await db.attendance.find(
        {"tenant_id": user["tenant_id"], "session_id": session_id}, {"_id": 0}
    ).to_list(1000)
    return {"items": items, "total": len(items)}


@attendance_router.get("/student/{student_id}")
async def student_attendance(student_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    q = tenant_filter(user, {"student_id": student_id})
    items = await db.attendance.find(q, {"_id": 0}).sort("marked_at", -1).to_list(500)
    return {"items": items, "total": len(items)}


router.include_router(attendance_router)


# --------------------------------------------------------------------
# Payments
# --------------------------------------------------------------------
payments_router = APIRouter(prefix="/payments", tags=["payments"])


@payments_router.get("")
async def list_payments(db=Depends(get_db), user=Depends(get_current_user),
                        student_id: Optional[str] = None, status: Optional[str] = None):
    extra: dict = {}
    if student_id:
        extra["student_id"] = student_id
    if status:
        extra["status"] = status
    return await _list_scoped(db, "payments", user, extra)


@payments_router.post("")
async def create_payment(payload: PaymentCreate, db=Depends(get_db),
                         user=Depends(get_current_user)):
    if user["role"] not in STAFF_ROLES and user["role"] != ROLE_SUPER_ADMIN:
        raise HTTPException(403, "Forbidden")
    tenant = await db.tenants.find_one({"id": user["tenant_id"]})
    prefix = (tenant or {}).get("invoice_prefix", "INV-")
    count = await db.payments.count_documents({"tenant_id": user["tenant_id"]})
    p = Payment(**payload.model_dump(), tenant_id=user["tenant_id"],
                invoice_number=f"{prefix}{count + 1:06d}")
    if p.status == "paid" and not p.paid_at:
        p.paid_at = utcnow_iso()
    return await _create_scoped(db, "payments", p.model_dump(), user)


@payments_router.get("/{item_id}")
async def get_payment(item_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await _get_scoped(db, "payments", item_id, user)


@payments_router.patch("/{item_id}")
async def update_payment(item_id: str, updates: dict, db=Depends(get_db),
                         user=Depends(get_current_user)):
    return await _update_scoped(db, "payments", item_id, updates, user)


@payments_router.delete("/{item_id}")
async def delete_payment(item_id: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await _delete_scoped(db, "payments", item_id, user)


router.include_router(payments_router)


# --------------------------------------------------------------------
# Dashboard aggregations
# --------------------------------------------------------------------
dashboard_router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@dashboard_router.get("/summary")
async def dashboard_summary(db=Depends(get_db), user=Depends(get_current_user)):
    tid = user.get("tenant_id")
    if not tid:
        return {"error": "no tenant"}
    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    day_end = now.replace(hour=23, minute=59, second=59, microsecond=999999).isoformat()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    students_total = await db.students.count_documents({"tenant_id": tid, "status": "active"})
    teachers_total = await db.teachers.count_documents({"tenant_id": tid, "status": "active"})
    courses_total = await db.courses.count_documents({"tenant_id": tid, "status": "active"})
    groups_total = await db.groups.count_documents({"tenant_id": tid, "status": "active"})

    # Today's sessions
    today_sessions = await db.sessions.find(
        {"tenant_id": tid, "start_at": {"$gte": day_start, "$lte": day_end}},
        {"_id": 0}
    ).sort("start_at", 1).to_list(50)

    # Upcoming sessions (next 7 days)
    week_end = (now + timedelta(days=7)).isoformat()
    upcoming_sessions = await db.sessions.find(
        {"tenant_id": tid, "start_at": {"$gte": now.isoformat(), "$lte": week_end}},
        {"_id": 0}
    ).sort("start_at", 1).to_list(20)

    # Revenue
    revenue_today = 0.0
    revenue_month = 0.0
    outstanding = 0.0
    async for p in db.payments.find({"tenant_id": tid}, {"_id": 0}):
        amt = float(p.get("amount", 0) or 0) - float(p.get("discount", 0) or 0)
        if p.get("status") == "paid":
            paid_at = p.get("paid_at") or p.get("created_at") or ""
            if paid_at >= day_start:
                revenue_today += amt
            if paid_at >= month_start:
                revenue_month += amt
        elif p.get("status") in ("pending", "partial"):
            outstanding += amt

    # Recent activities: last 10 students / payments
    recent_students = await db.students.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(5)
    recent_payments = await db.payments.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(5)

    # Attendance today %
    today_session_ids = [s["id"] for s in today_sessions]
    att_total = 0
    att_present = 0
    if today_session_ids:
        async for a in db.attendance.find(
            {"tenant_id": tid, "session_id": {"$in": today_session_ids}}, {"_id": 0}
        ):
            att_total += 1
            if a.get("status") in ("present", "late"):
                att_present += 1

    attendance_pct = (att_present / att_total * 100) if att_total else 0

    # Revenue trend (last 6 months)
    trend: List[dict] = []
    for i in range(5, -1, -1):
        m = (now.replace(day=1) - timedelta(days=i * 30)).replace(day=1)
        m_start = m.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        next_m = (m.replace(day=28) + timedelta(days=4)).replace(day=1)
        m_end = next_m.isoformat()
        total = 0.0
        async for p in db.payments.find(
            {"tenant_id": tid, "status": "paid", "paid_at": {"$gte": m_start, "$lt": m_end}},
            {"_id": 0}
        ):
            total += float(p.get("amount", 0) or 0) - float(p.get("discount", 0) or 0)
        trend.append({"month": m.strftime("%b"), "revenue": round(total, 2)})

    return {
        "kpis": {
            "students_total": students_total,
            "teachers_total": teachers_total,
            "courses_total": courses_total,
            "groups_total": groups_total,
            "revenue_today": round(revenue_today, 2),
            "revenue_month": round(revenue_month, 2),
            "outstanding": round(outstanding, 2),
            "attendance_pct": round(attendance_pct, 1),
            "sessions_today": len(today_sessions),
        },
        "today_sessions": today_sessions,
        "upcoming_sessions": upcoming_sessions,
        "recent_students": recent_students,
        "recent_payments": recent_payments,
        "revenue_trend": trend,
    }


router.include_router(dashboard_router)


# --------------------------------------------------------------------
# Global Search
# --------------------------------------------------------------------
search_router = APIRouter(prefix="/search", tags=["search"])


@search_router.get("")
async def global_search(q: str = Query(..., min_length=1),
                        db=Depends(get_db), user=Depends(get_current_user)):
    tid = user.get("tenant_id")
    if not tid:
        return {"results": []}
    rx = safe_regex(q)
    results: list = []

    async def add(coll: str, filt: dict, label: str, name_fn):
        async for d in db[coll].find({"tenant_id": tid, **filt}, {"_id": 0}).limit(5):
            results.append({"type": label, "id": d["id"], "label": name_fn(d), "data": d})

    await add("students", {"$or": [{"first_name": rx}, {"last_name": rx}, {"email": rx}]},
              "student", lambda d: f"{d.get('first_name','')} {d.get('last_name','')}")
    await add("teachers", {"$or": [{"first_name": rx}, {"last_name": rx}, {"email": rx}]},
              "teacher", lambda d: f"{d.get('first_name','')} {d.get('last_name','')}")
    await add("parents", {"$or": [{"name": rx}, {"email": rx}]}, "parent", lambda d: d.get("name", ""))
    await add("courses", {"title": rx}, "course", lambda d: d.get("title", ""))
    await add("groups", {"name": rx}, "group", lambda d: d.get("name", ""))
    await add("payments", {"invoice_number": rx}, "payment",
              lambda d: f"{d.get('invoice_number','')} — {d.get('amount','')}")
    return {"results": results, "query": q}


router.include_router(search_router)


# --------------------------------------------------------------------
# Super-admin platform endpoints
# --------------------------------------------------------------------
admin_router = APIRouter(prefix="/admin", tags=["admin"])


@admin_router.get("/platform-summary")
async def platform_summary(db=Depends(get_db),
                           _: dict = Depends(require_roles(ROLE_SUPER_ADMIN))):
    tenants_total = await db.tenants.count_documents({})
    tenants_active = await db.tenants.count_documents({"status": "active"})
    tenants_trial = await db.tenants.count_documents({"status": "trial"})
    tenants_suspended = await db.tenants.count_documents({"status": "suspended"})
    users_total = await db.users.count_documents({})
    students_total = await db.students.count_documents({})
    payments_total = await db.payments.count_documents({})

    # Revenue across all tenants
    revenue = 0.0
    async for p in db.payments.find({"status": "paid"}, {"_id": 0, "amount": 1, "discount": 1}):
        revenue += float(p.get("amount", 0) or 0) - float(p.get("discount", 0) or 0)

    # Tenant list with basic counts
    tenants = await db.tenants.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for t in tenants:
        t["users_count"] = await db.users.count_documents({"tenant_id": t["id"]})
        t["students_count"] = await db.students.count_documents({"tenant_id": t["id"]})

    return {
        "kpis": {
            "tenants_total": tenants_total,
            "tenants_active": tenants_active,
            "tenants_trial": tenants_trial,
            "tenants_suspended": tenants_suspended,
            "users_total": users_total,
            "students_total": students_total,
            "payments_total": payments_total,
            "platform_revenue": round(revenue, 2),
        },
        "tenants": tenants,
    }


@admin_router.patch("/tenants/{tenant_id}/status")
async def set_tenant_status(tenant_id: str, payload: dict,
                            db=Depends(get_db),
                            _: dict = Depends(require_roles(ROLE_SUPER_ADMIN))):
    status = payload.get("status")
    if status not in ("active", "trial", "suspended"):
        raise HTTPException(400, "Invalid status")
    await db.tenants.update_one({"id": tenant_id},
                                {"$set": {"status": status, "updated_at": utcnow_iso()}})
    return sanitize(await db.tenants.find_one({"id": tenant_id}))


@admin_router.delete("/tenants/{tenant_id}")
async def hard_delete_tenant(tenant_id: str, db=Depends(get_db),
                             _: dict = Depends(require_roles(ROLE_SUPER_ADMIN))):
    """Cascade delete everything owned by a tenant."""
    tenant = await db.tenants.find_one({"id": tenant_id})
    for coll in ("users", "students", "parents", "teachers", "courses",
                 "groups", "sessions", "attendance", "payments"):
        await db[coll].delete_many({"tenant_id": tenant_id})
    await db.tenants.delete_one({"id": tenant_id})
    logo_url = (tenant or {}).get("logo_url") or ""
    if logo_url.startswith("/uploads/logos/"):
        (LOGO_UPLOAD_DIR / logo_url.rsplit("/", 1)[-1]).unlink(missing_ok=True)
    return {"ok": True}


router.include_router(admin_router)
