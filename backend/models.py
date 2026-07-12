"""SchoolDZ pydantic models for all core entities."""
from __future__ import annotations
from typing import Optional, List, Literal
from pydantic import BaseModel, EmailStr, Field, ConfigDict

from core import new_id, utcnow_iso


# ----------------------------- Tenant ------------------------------

class TenantCreate(BaseModel):
    name: str
    slug: str
    owner_email: EmailStr
    owner_password: str
    owner_name: str
    center_type: Optional[str] = "tutoring"  # tutoring, language, coding, robotics, music, art, camp, other


class Tenant(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    slug: str
    center_type: str = "tutoring"
    status: Literal["active", "suspended", "trial"] = "trial"
    plan: Literal["free", "starter", "pro", "business"] = "free"
    logo_url: Optional[str] = None
    primary_color: str = "#0A0A0B"
    accent_color: str = "#E53935"
    language: Literal["en", "fr", "ar"] = "en"
    currency: str = "USD"
    timezone: str = "UTC"
    invoice_prefix: str = "INV-"
    student_prefix: str = "STU-"
    max_students: int = 500
    max_users: int = 20
    trial_ends_at: Optional[str] = None
    created_at: str = Field(default_factory=utcnow_iso)
    updated_at: str = Field(default_factory=utcnow_iso)


# ----------------------------- User ------------------------------

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "secretary"
    phone: Optional[str] = None


class UserRegisterPublic(BaseModel):
    """Registers a new tenant + its owner user."""
    tenant_name: str
    tenant_slug: str
    center_type: Optional[str] = "tutoring"
    name: str
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    tenant_slug: Optional[str] = None  # optional, resolves user in that tenant
    remember_me: Optional[bool] = False


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class User(BaseModel):
    id: str = Field(default_factory=new_id)
    tenant_id: Optional[str] = None  # None for super_admin
    email: EmailStr
    name: str
    role: str
    phone: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: bool = True
    email_verified: bool = False
    created_at: str = Field(default_factory=utcnow_iso)
    updated_at: str = Field(default_factory=utcnow_iso)


# ----------------------------- Student ------------------------------

class StudentBase(BaseModel):
    first_name: str
    last_name: str
    gender: Optional[Literal["male", "female", "other"]] = None
    birth_date: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    parent_id: Optional[str] = None
    emergency_contact: Optional[str] = None
    medical_notes: Optional[str] = None
    photo_url: Optional[str] = None
    status: Literal["active", "inactive", "graduated", "suspended"] = "active"
    notes: Optional[str] = None


class StudentCreate(StudentBase):
    pass


class Student(StudentBase):
    id: str = Field(default_factory=new_id)
    tenant_id: str
    student_code: Optional[str] = None
    enrollment_date: str = Field(default_factory=utcnow_iso)
    created_at: str = Field(default_factory=utcnow_iso)
    updated_at: str = Field(default_factory=utcnow_iso)


# ----------------------------- Parent ------------------------------

class ParentBase(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    occupation: Optional[str] = None
    relationship: Optional[Literal["father", "mother", "guardian", "other"]] = "guardian"
    emergency_contact: Optional[str] = None


class ParentCreate(ParentBase):
    pass


class Parent(ParentBase):
    id: str = Field(default_factory=new_id)
    tenant_id: str
    created_at: str = Field(default_factory=utcnow_iso)
    updated_at: str = Field(default_factory=utcnow_iso)


# ----------------------------- Teacher ------------------------------

class TeacherBase(BaseModel):
    first_name: str
    last_name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    subjects: List[str] = []
    hourly_rate: Optional[float] = 0
    monthly_salary: Optional[float] = 0
    photo_url: Optional[str] = None
    status: Literal["active", "inactive"] = "active"
    notes: Optional[str] = None


class TeacherCreate(TeacherBase):
    pass


class Teacher(TeacherBase):
    id: str = Field(default_factory=new_id)
    tenant_id: str
    user_id: Optional[str] = None  # link to user account if teacher can log in
    hire_date: str = Field(default_factory=utcnow_iso)
    created_at: str = Field(default_factory=utcnow_iso)
    updated_at: str = Field(default_factory=utcnow_iso)


# ----------------------------- Course & Group ------------------------------

class CourseBase(BaseModel):
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    duration_weeks: Optional[int] = 12
    price: float = 0
    max_students: int = 20
    color: str = "#E53935"
    image_url: Optional[str] = None
    status: Literal["active", "draft", "archived"] = "active"


class CourseCreate(CourseBase):
    pass


class Course(CourseBase):
    id: str = Field(default_factory=new_id)
    tenant_id: str
    created_at: str = Field(default_factory=utcnow_iso)
    updated_at: str = Field(default_factory=utcnow_iso)


class GroupBase(BaseModel):
    course_id: str
    name: str
    teacher_id: Optional[str] = None
    room: Optional[str] = None
    capacity: int = 20
    schedule: Optional[str] = None  # e.g. "Mon,Wed 18:00-20:00"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: Literal["active", "completed", "cancelled"] = "active"


class GroupCreate(GroupBase):
    pass


class Group(GroupBase):
    id: str = Field(default_factory=new_id)
    tenant_id: str
    student_ids: List[str] = []
    created_at: str = Field(default_factory=utcnow_iso)
    updated_at: str = Field(default_factory=utcnow_iso)


class GroupEnrollment(BaseModel):
    student_id: str


# ----------------------------- Session ------------------------------

class SessionBase(BaseModel):
    group_id: str
    teacher_id: Optional[str] = None
    room: Optional[str] = None
    start_at: str  # ISO
    end_at: str
    topic: Optional[str] = None
    notes: Optional[str] = None
    homework: Optional[str] = None
    status: Literal["scheduled", "completed", "cancelled"] = "scheduled"


class SessionCreate(SessionBase):
    pass


class ClassSession(SessionBase):
    id: str = Field(default_factory=new_id)
    tenant_id: str
    course_id: Optional[str] = None
    created_at: str = Field(default_factory=utcnow_iso)
    updated_at: str = Field(default_factory=utcnow_iso)


# ----------------------------- Attendance ------------------------------

AttendanceStatus = Literal["present", "absent", "late", "excused"]


class AttendanceMark(BaseModel):
    student_id: str
    status: AttendanceStatus
    note: Optional[str] = None


class AttendanceBulk(BaseModel):
    marks: List[AttendanceMark]


class Attendance(BaseModel):
    id: str = Field(default_factory=new_id)
    tenant_id: str
    session_id: str
    student_id: str
    status: AttendanceStatus
    note: Optional[str] = None
    marked_by: Optional[str] = None
    marked_at: str = Field(default_factory=utcnow_iso)


# ----------------------------- Payment ------------------------------

PaymentKind = Literal["registration", "monthly", "course", "installment", "other"]
PaymentStatus = Literal["paid", "pending", "partial", "refunded", "cancelled"]
PaymentMethod = Literal["cash", "card", "bank_transfer", "cheque", "other"]


class PaymentBase(BaseModel):
    student_id: str
    course_id: Optional[str] = None
    group_id: Optional[str] = None
    kind: PaymentKind = "monthly"
    amount: float
    discount: float = 0
    method: PaymentMethod = "cash"
    status: PaymentStatus = "paid"
    due_date: Optional[str] = None
    paid_at: Optional[str] = None
    reference: Optional[str] = None
    notes: Optional[str] = None


class PaymentCreate(PaymentBase):
    pass


class Payment(PaymentBase):
    id: str = Field(default_factory=new_id)
    tenant_id: str
    invoice_number: Optional[str] = None
    created_at: str = Field(default_factory=utcnow_iso)
    updated_at: str = Field(default_factory=utcnow_iso)
