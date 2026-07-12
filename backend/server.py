"""SchoolDZ FastAPI application entry point."""
from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from fastapi import FastAPI  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from core import (  # noqa: E402
    ROLE_SUPER_ADMIN, hash_password, utcnow_iso,
)
from models import User  # noqa: E402
from routes import router as api_router  # noqa: E402


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("schooldz")


app = FastAPI(title="SchoolDZ API", version="1.0.0")

# Restrict CORS to known frontend origins (comma-separated in CORS_ORIGINS).
# A wildcard here would let any website drive the API with a victim's token.
_cors_origins = [
    o.strip() for o in os.environ.get(
        "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

# Locally-stored uploads (tenant logos, etc.), served back at /uploads/...
UPLOAD_ROOT = ROOT_DIR / "uploads"
UPLOAD_ROOT.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_ROOT)), name="uploads")


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
    logger.info("SchoolDZ ready")


@app.on_event("shutdown")
async def shutdown() -> None:
    app.state.mongo_client.close()


async def seed_super_admin(db) -> None:
    email = os.environ.get("ADMIN_EMAIL", "admin@schooldz.com").lower()
    password = os.environ.get("ADMIN_PASSWORD", "admin123")
    if password == "admin123":
        logger.warning("ADMIN_PASSWORD is not set — the super admin uses a weak default. "
                       "Set a strong ADMIN_PASSWORD in backend/.env before exposing this server.")
    from core import verify_password
    existing = await db.users.find_one({"email": email})
    if not existing:
        u = User(tenant_id=None, email=email, name="Platform Admin",
                 role=ROLE_SUPER_ADMIN, email_verified=True)
        doc = u.model_dump()
        doc["password_hash"] = hash_password(password)
        await db.users.insert_one(doc)
        logger.info("Seeded super admin: %s", email)
    elif not verify_password(password, existing.get("password_hash", "")):
        await db.users.update_one({"email": email},
                                  {"$set": {"password_hash": hash_password(password),
                                            "role": ROLE_SUPER_ADMIN,
                                            "updated_at": utcnow_iso()}})
        logger.info("Updated super admin password")
