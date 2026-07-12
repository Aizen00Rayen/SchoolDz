"""SchoolDZ FastAPI application entry point."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from core import (  # noqa: E402
    ROLE_OWNER, ROLE_SUPER_ADMIN, ROLE_TEACHER, hash_password, utcnow_iso,
)
from models import Tenant, User  # noqa: E402
from routes import router as api_router  # noqa: E402


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("schooldz")


app = FastAPI(title="SchoolDZ API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/")
async def root():
    return {"service": "SchoolDZ API", "version": "1.0.0"}


@app.get("/api")
async def api_root():
    return {"service": "SchoolDZ API", "docs": "/docs", "prefix": "/api/v1"}


@app.on_event("startup")
async def startup() -> None:
    mongo_url = os.environ["MONGO_URL"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[os.environ["DB_NAME"]]
    app.state.mongo_client = client
    app.state.db = db

    # Indexes
    await db.users.create_index("email", unique=True)
    await db.tenants.create_index("slug", unique=True)
    await db.students.create_index([("tenant_id", 1), ("last_name", 1)])
    await db.students.create_index([("tenant_id", 1), ("created_at", -1)])
    await db.teachers.create_index([("tenant_id", 1), ("last_name", 1)])
    await db.parents.create_index([("tenant_id", 1), ("name", 1)])
    await db.courses.create_index([("tenant_id", 1), ("title", 1)])
    await db.groups.create_index([("tenant_id", 1), ("course_id", 1)])
    await db.sessions.create_index([("tenant_id", 1), ("start_at", 1)])
    await db.attendance.create_index([("tenant_id", 1), ("session_id", 1), ("student_id", 1)],
                                     unique=True)
    await db.payments.create_index([("tenant_id", 1), ("student_id", 1)])
    await db.password_reset_tokens.create_index("token", unique=True)

    await seed_super_admin(db)
    await seed_demo_tenant(db)
    logger.info("SchoolDZ ready")


@app.on_event("shutdown")
async def shutdown() -> None:
    app.state.mongo_client.close()


async def seed_super_admin(db) -> None:
    email = os.environ.get("ADMIN_EMAIL", "admin@schooldz.com").lower()
    password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": email})
    if not existing:
        u = User(tenant_id=None, email=email, name="Platform Admin",
                 role=ROLE_SUPER_ADMIN, email_verified=True)
        doc = u.model_dump()
        doc["password_hash"] = hash_password(password)
        await db.users.insert_one(doc)
        logger.info("Seeded super admin: %s", email)


async def seed_demo_tenant(db) -> None:
    slug = os.environ.get("DEMO_TENANT_SLUG", "dteduc").lower()
    tenant = await db.tenants.find_one({"slug": slug})
    if not tenant:
        t = Tenant(name="DT Educ", slug=slug, center_type="tutoring", status="active", plan="pro",
                   language="fr", currency="DZD", primary_color="#0A0A0B", accent_color="#E53935",
                   trial_ends_at=(datetime.now(timezone.utc) + timedelta(days=90)).isoformat())
        await db.tenants.insert_one(t.model_dump())
        tenant = t.model_dump()

    owner_email = os.environ.get("DEMO_OWNER_EMAIL", "owner@dteduc.schooldz.com").lower()
    owner_pass = os.environ.get("DEMO_OWNER_PASSWORD", "owner123")
    existing_owner = await db.users.find_one({"email": owner_email})
    if not existing_owner:
        u = User(tenant_id=tenant["id"], email=owner_email, name="Youssef Bencheikh",
                 role=ROLE_OWNER, phone="+213 555 000 111", email_verified=True)
        doc = u.model_dump()
        doc["password_hash"] = hash_password(owner_pass)
        await db.users.insert_one(doc)

    teacher_email = os.environ.get("DEMO_TEACHER_EMAIL", "teacher@dteduc.schooldz.com").lower()
    teacher_pass = os.environ.get("DEMO_TEACHER_PASSWORD", "teacher123")
    existing_teacher = await db.users.find_one({"email": teacher_email})
    if not existing_teacher:
        u = User(tenant_id=tenant["id"], email=teacher_email, name="Amina Ould-Ali",
                 role=ROLE_TEACHER, phone="+213 555 222 333", email_verified=True)
        doc = u.model_dump()
        doc["password_hash"] = hash_password(teacher_pass)
        await db.users.insert_one(doc)

    # Seed sample data only if empty
    tid = tenant["id"]
    if await db.students.count_documents({"tenant_id": tid}) == 0:
        await _seed_sample_data(db, tid)


async def _seed_sample_data(db, tenant_id: str) -> None:
    """Seed a rich sample dataset for the demo tenant."""
    from models import Course, Group, Parent, Payment, Student, Teacher, ClassSession
    from core import new_id

    now = datetime.now(timezone.utc)

    # Parents
    parents = [
        {"name": "Karim Belkacem", "phone": "+213 555 100 100", "email": "karim.b@example.dz",
         "relationship": "father", "occupation": "Engineer"},
        {"name": "Souad Meziane", "phone": "+213 555 100 200", "email": "souad.m@example.dz",
         "relationship": "mother", "occupation": "Doctor"},
        {"name": "Farid Haddad", "phone": "+213 555 100 300", "email": "farid.h@example.dz",
         "relationship": "father", "occupation": "Merchant"},
    ]
    parent_ids: list[str] = []
    for p in parents:
        doc = Parent(**p, tenant_id=tenant_id).model_dump()
        await db.parents.insert_one(doc)
        parent_ids.append(doc["id"])

    # Teachers
    teachers = [
        {"first_name": "Amina", "last_name": "Ould-Ali", "email": "amina@dteduc.schooldz.com",
         "phone": "+213 555 222 333", "subjects": ["English", "IELTS"], "hourly_rate": 2000},
        {"first_name": "Mohammed", "last_name": "Kaci", "email": "mohammed@dteduc.schooldz.com",
         "phone": "+213 555 333 444", "subjects": ["Python", "Web"], "hourly_rate": 2500},
        {"first_name": "Nadia", "last_name": "Benaissa", "email": "nadia@dteduc.schooldz.com",
         "phone": "+213 555 444 555", "subjects": ["French", "Grammar"], "hourly_rate": 1800},
    ]
    teacher_ids: list[str] = []
    for t in teachers:
        doc = Teacher(**t, tenant_id=tenant_id).model_dump()
        await db.teachers.insert_one(doc)
        teacher_ids.append(doc["id"])

    # Courses
    courses_seed = [
        {"title": "English A2", "category": "Languages", "price": 8000, "color": "#3B82F6",
         "description": "Elementary English for teens and adults."},
        {"title": "Python for Beginners", "category": "Coding", "price": 12000, "color": "#10B981",
         "description": "Learn programming from scratch with Python."},
        {"title": "French Grammar", "category": "Languages", "price": 7000, "color": "#F59E0B",
         "description": "Master French grammar rules."},
        {"title": "BAC Math Prep", "category": "Academic", "price": 10000, "color": "#E53935",
         "description": "Intensive math preparation for Baccalaureate."},
    ]
    course_ids: list[str] = []
    for c in courses_seed:
        doc = Course(**c, tenant_id=tenant_id).model_dump()
        await db.courses.insert_one(doc)
        course_ids.append(doc["id"])

    # Students
    first_names = ["Yasmine", "Rayan", "Lina", "Ilyes", "Malak", "Adem", "Nour", "Salah",
                   "Meriem", "Anis", "Hiba", "Ahmed", "Sarah", "Walid", "Sofia"]
    last_names = ["Belkacem", "Meziane", "Haddad", "Boudiaf", "Khelifi", "Cherif", "Zerrouki",
                  "Chettouh", "Djellal", "Saidi"]
    student_ids: list[str] = []
    for i in range(15):
        fn = first_names[i % len(first_names)]
        ln = last_names[i % len(last_names)]
        s = Student(
            tenant_id=tenant_id,
            first_name=fn, last_name=ln,
            gender="female" if i % 2 == 0 else "male",
            birth_date=(now - timedelta(days=365 * (12 + i % 8))).date().isoformat(),
            email=f"{fn.lower()}.{ln.lower()}@student.dteduc.dz",
            phone=f"+213 555 {700 + i:03d} {100 + i:03d}",
            parent_id=parent_ids[i % len(parent_ids)],
            status="active",
            student_code=f"STU-{i + 1:05d}",
        ).model_dump()
        await db.students.insert_one(s)
        student_ids.append(s["id"])

    # Groups + enroll students
    group_ids: list[str] = []
    for idx, cid in enumerate(course_ids):
        g = Group(
            tenant_id=tenant_id, course_id=cid,
            name=f"Group {chr(65 + idx)}",
            teacher_id=teacher_ids[idx % len(teacher_ids)],
            room=f"Room {101 + idx}",
            capacity=15,
            schedule="Mon,Wed 18:00-20:00" if idx % 2 == 0 else "Tue,Thu 17:00-19:00",
            student_ids=student_ids[idx * 3:(idx * 3) + 4],
        ).model_dump()
        await db.groups.insert_one(g)
        group_ids.append(g["id"])

    # Sessions (today + next 6 days)
    session_ids: list[str] = []
    for day_off in range(-2, 6):
        for gi, gid in enumerate(group_ids):
            start = now.replace(hour=17 + gi, minute=0, second=0, microsecond=0) + timedelta(days=day_off)
            end = start + timedelta(hours=2)
            g = await db.groups.find_one({"id": gid})
            sess = ClassSession(
                tenant_id=tenant_id,
                group_id=gid,
                course_id=g["course_id"],
                teacher_id=g["teacher_id"],
                room=g.get("room"),
                start_at=start.isoformat(),
                end_at=end.isoformat(),
                topic=f"Lesson {day_off + 3}",
                status="completed" if day_off < 0 else "scheduled",
            ).model_dump()
            await db.sessions.insert_one(sess)
            session_ids.append(sess["id"])

    # Attendance for past sessions
    past_sessions = await db.sessions.find(
        {"tenant_id": tenant_id, "status": "completed"}, {"_id": 0}
    ).to_list(1000)
    for sess in past_sessions:
        g = await db.groups.find_one({"id": sess["group_id"]})
        for i, sid in enumerate(g.get("student_ids", [])):
            status = ["present", "present", "present", "late", "absent"][i % 5]
            await db.attendance.insert_one({
                "id": new_id(),
                "tenant_id": tenant_id,
                "session_id": sess["id"],
                "student_id": sid,
                "status": status,
                "marked_at": sess["start_at"],
            })

    # Payments
    for i, sid in enumerate(student_ids):
        cid = course_ids[i % len(course_ids)]
        # Registration
        p = Payment(
            tenant_id=tenant_id, student_id=sid, course_id=cid,
            kind="registration", amount=2000, status="paid",
            paid_at=(now - timedelta(days=20 + i)).isoformat(),
            invoice_number=f"INV-{i * 2 + 1:06d}",
            method="cash",
        ).model_dump()
        await db.payments.insert_one(p)
        # Monthly
        p2 = Payment(
            tenant_id=tenant_id, student_id=sid, course_id=cid,
            kind="monthly", amount=8000 + (i % 3) * 2000,
            status="paid" if i % 3 != 0 else "pending",
            paid_at=(now - timedelta(days=i)).isoformat() if i % 3 != 0 else None,
            due_date=(now + timedelta(days=5)).isoformat() if i % 3 == 0 else None,
            invoice_number=f"INV-{i * 2 + 2:06d}",
            method="cash",
        ).model_dump()
        await db.payments.insert_one(p2)

    logger.info("Seeded demo data for tenant %s", tenant_id)
