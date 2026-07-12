"""SchoolDZ REST API routes."""
from __future__ import annotations

import os
import re
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from motor.motor_asyncio import AsyncIOMotorDatabase

from core import (
    ADMIN_ROLES, ALL_ROLES, ROLE_OWNER, ROLE_SUPER_ADMIN, STAFF_ROLES,
    clear_auth_cookies, create_access_token, create_refresh_token, decode_token,
    get_current_user, get_db, hash_password, new_id, require_roles,
    sanitize, sanitize_many, set_auth_cookies, tenant_filter, utcnow_iso,
    verify_password,
)
from models import (
    AttendanceBulk, ClassSession, Course, CourseCreate, Group, GroupCreate,
    GroupEnrollment, LoginRequest, Parent, ParentCreate, Payment, PaymentCreate,
    SessionCreate, Student, StudentCreate, Teacher, TeacherCreate, Tenant,
    TenantCreate, User, UserCreate, UserRegisterPublic,
    ForgotPasswordRequest, ResetPasswordRequest,
)


router = APIRouter(prefix="/api/v1")

SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$")

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
async def register(payload: UserRegisterPublic, response: Response,
                   db: AsyncIOMotorDatabase = Depends(get_db)):
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
async def login(payload: LoginRequest, response: Response,
                db: AsyncIOMotorDatabase = Depends(get_db)):
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
    response.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax",
                        max_age=12 * 3600, path="/")
    return {"access_token": access}


@auth_router.post("/forgot-password")
async def forgot(payload: ForgotPasswordRequest, db: AsyncIOMotorDatabase = Depends(get_db)):
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
        # In dev, return token; production would send email
        return {"ok": True, "dev_token": token, "message": "Reset link generated (dev mode)"}
    return {"ok": True, "message": "If this email exists, a reset link has been sent"}


@auth_router.post("/reset-password")
async def reset(payload: ResetPasswordRequest, db: AsyncIOMotorDatabase = Depends(get_db)):
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


router.include_router(auth_router)


# --------------------------------------------------------------------
# Tenants (Super Admin + public info)
# --------------------------------------------------------------------
tenants_router = APIRouter(prefix="/tenants", tags=["tenants"])


@tenants_router.get("/by-slug/{slug}")
async def get_tenant_by_slug(slug: str, db: AsyncIOMotorDatabase = Depends(get_db)):
    t = await db.tenants.find_one({"slug": slug.lower()})
    if not t:
        raise HTTPException(404, "Tenant not found")
    return sanitize(t)


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


@tenants_router.patch("/{tenant_id}")
async def update_tenant(tenant_id: str, updates: dict,
                        db: AsyncIOMotorDatabase = Depends(get_db),
                        user: dict = Depends(get_current_user)):
    if user["role"] not in (ROLE_SUPER_ADMIN, ROLE_OWNER):
        raise HTTPException(403, "Forbidden")
    if user["role"] != ROLE_SUPER_ADMIN and user.get("tenant_id") != tenant_id:
        raise HTTPException(403, "Cannot edit another tenant")
    updates = {k: v for k, v in updates.items() if k not in ("id", "created_at", "slug")}
    updates["updated_at"] = utcnow_iso()
    await db.tenants.update_one({"id": tenant_id}, {"$set": updates})
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
    if payload.role not in ALL_ROLES:
        raise HTTPException(400, "Invalid role")
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
    new_user = User(tenant_id=user.get("tenant_id"), email=email, name=payload.name,
                    role=payload.role, phone=payload.phone, email_verified=True)
    doc = new_user.model_dump()
    doc["password_hash"] = hash_password(payload.password)
    await db.users.insert_one(doc)
    return sanitize(doc)


@users_router.delete("/{user_id}")
async def delete_user(user_id: str, db: AsyncIOMotorDatabase = Depends(get_db),
                      user: dict = Depends(get_current_user)):
    if user["role"] not in ADMIN_ROLES and user["role"] != ROLE_SUPER_ADMIN:
        raise HTTPException(403, "Forbidden")
    q = tenant_filter(user, {"id": user_id})
    if user_id == user["id"]:
        raise HTTPException(400, "Cannot delete yourself")
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


async def _update_scoped(db, collection: str, item_id: str, updates: dict, user: dict):
    q = tenant_filter(user, {"id": item_id})
    updates = {k: v for k, v in updates.items() if k not in ("id", "tenant_id", "created_at")}
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
            {"first_name": {"$regex": q, "$options": "i"}},
            {"last_name": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
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
            {"name": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
            {"phone": {"$regex": q, "$options": "i"}},
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
            {"first_name": {"$regex": q, "$options": "i"}},
            {"last_name": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
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
            {"title": {"$regex": q, "$options": "i"}},
            {"category": {"$regex": q, "$options": "i"}},
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
    rx = {"$regex": q, "$options": "i"}
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
