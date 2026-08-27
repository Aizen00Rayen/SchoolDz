import uuid
from datetime import time
from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager

def generate_uuid():
    return str(uuid.uuid4())

# The tabs an owner/director can grant secretary/accountant/teacher users
# access to, and the levels each can be set to. Kept here (not just in the
# frontend) so serializers/views validate against the same source of truth.
# Roles that belong inside the staff workspace at all. 'parent'/'student' are
# external-facing logins served by their own dedicated endpoints (the portal
# and the public badge lookup), and must never reach a staff-only view — see
# require_staff_tenant() in views.py.
STAFF_ROLES = ('owner', 'director', 'secretary', 'accountant', 'teacher')

PERMISSION_MODULES = [
    'dashboard', 'students', 'teachers', 'parents', 'courses', 'groups',
    'sessions', 'calendar', 'timetable', 'rooms', 'payments', 'debts', 'expenses', 'teacher_payments',
    'grades', 'attendance', 'messages', 'quizzes', 'website', 'reports',
    'logs', 'users', 'settings', 'trips', 'books',
]
# Each module's stored permission is now a flag object rather than a single
# level string, so "can edit" can be granted as any independent combination
# of add/modify/delete instead of one all-or-nothing tier — e.g. a data-entry
# clerk can get {"view": True, "add": True} without also being able to modify
# or delete existing records. `view` gates the whole module (add/modify/
# delete are meaningless — and ignored — without it); a module with no entry,
# or an entry with view missing/false, is hidden.
PERMISSION_FLAGS = ['view', 'add', 'modify', 'delete']
# Kept only as the historical set of values PERMISSION_MODULES entries used
# to hold pre-migration-0022 (see that migration's LEVEL_MAP) — nothing at
# runtime reads this anymore.
PERMISSION_LEVELS = ['hidden', 'view', 'edit']

# What a module resolves to for a limited role (secretary/accountant/teacher)
# that has no explicit entry for it. Modules that were never permission-gated
# before default to view-only so extending PERMISSION_MODULES doesn't
# silently take pages away from existing staff accounts; genuinely sensitive
# ones (money, audit trail, user management) stay hidden until granted.
DEFAULT_MODULE_PERMISSIONS = {
    'dashboard': {'view': True},
    'calendar': {'view': True},
    'timetable': {'view': True},
    # view-only by default so existing staff can still populate the room
    # dropdown when creating a group/session — only full room management
    # (the Rooms page's create/edit/delete) needs an explicit grant.
    'rooms': {'view': True},
    'reports': {'view': True},
    'settings': {'view': True},
    'website': {'view': True},
}

class Tenant(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    name = models.CharField(max_length=255)
    slug = models.CharField(max_length=255, unique=True)
    center_type = models.CharField(max_length=255, default='tutoring')
    STATUS_CHOICES = [
        ('pending_payment', 'pending_payment'),
        ('active', 'active'),
        ('expired', 'expired'),
        ('suspended', 'suspended'),
    ]
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='pending_payment')
    PLAN_CHOICES = [
        ('basic', 'basic'),
        ('standard', 'standard'),
        ('premium', 'premium'),
    ]
    plan = models.CharField(max_length=50, choices=PLAN_CHOICES, null=True, blank=True)
    BILLING_CYCLE_CHOICES = [
        ('monthly', 'monthly'),
        ('annual', 'annual'),
    ]
    billing_cycle = models.CharField(max_length=50, choices=BILLING_CYCLE_CHOICES, null=True, blank=True)
    plan_started_at = models.DateTimeField(null=True, blank=True)
    plan_expires_at = models.DateTimeField(null=True, blank=True)
    logo_url = models.CharField(max_length=255, null=True, blank=True)
    primary_color = models.CharField(max_length=16, default='#0A0A0B')
    accent_color = models.CharField(max_length=16, default='#E53935')
    LANGUAGE_CHOICES = [
        ('en', 'en'),
        ('fr', 'fr'),
        ('ar', 'ar'),
    ]
    language = models.CharField(max_length=10, choices=LANGUAGE_CHOICES, default='en')
    currency = models.CharField(max_length=8, default='DZD')
    timezone = models.CharField(max_length=255, default='UTC')
    invoice_prefix = models.CharField(max_length=16, default='INV-')
    student_prefix = models.CharField(max_length=16, default='STU-')
    max_students = models.IntegerField(null=True, blank=True)
    max_users = models.IntegerField(null=True, blank=True)
    trial_ends_at = models.DateTimeField(null=True, blank=True)
    enrollment_description = models.TextField(null=True, blank=True)
    # Premium "Website" builder fields — public landing page content.
    hero_image_url = models.CharField(max_length=255, null=True, blank=True)
    address = models.CharField(max_length=255, null=True, blank=True)
    phone = models.CharField(max_length=50, null=True, blank=True)
    map_url = models.CharField(max_length=500, null=True, blank=True)
    # Free-form {facebook, instagram, twitter, youtube, linkedin, tiktok} —
    # missing/empty keys just don't render a link on the public page.
    social_links = models.JSONField(default=dict, blank=True)
    # Weekly timetable (استعمال الزمن) grid bounds — every day starts at
    # 08:00 (fixed, not configurable) and runs until this time, 22:00 by
    # default, until the tenant narrows/widens it in Settings.
    timetable_end_time = models.TimeField(default=time(22, 0))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'tenants'


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError('Email must be set')
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        if password:
            user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault('role', 'super_admin')
        extra_fields.setdefault('is_active', True)
        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.SET_NULL, null=True, blank=True, db_column='tenant_id', related_name='users')
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=255)
    ROLE_CHOICES = [
        ('super_admin', 'super_admin'),
        ('owner', 'owner'),
        ('director', 'director'),
        ('secretary', 'secretary'),
        ('accountant', 'accountant'),
        ('teacher', 'teacher'),
        ('parent', 'parent'),
        ('student', 'student'),
    ]
    role = models.CharField(max_length=50, choices=ROLE_CHOICES)
    # Per-module tab access for secretary/accountant/teacher, set by the
    # owner/director when creating or editing a staff user — e.g.
    # {"students": {"view": True, "add": True}, "payments": {"view": True}}.
    # Missing key, or an entry with "view" missing/false, = hidden. Ignored
    # for owner/director/super_admin, who always have full access (see
    # can_view/can_add/can_modify/can_delete below and PERMISSION_MODULES
    # for the valid module keys).
    permissions = models.JSONField(null=True, blank=True, default=dict)
    phone = models.CharField(max_length=255, null=True, blank=True)
    avatar_url = models.CharField(max_length=255, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    email_verified = models.BooleanField(default=False)
    auth_provider = models.CharField(max_length=255, null=True, blank=True)
    google_sub = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Required for AbstractBaseUser:
    last_login = None
    
    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['name']

    class Meta:
        db_table = 'users'

    def is_super_admin(self):
        return self.role == 'super_admin'

    def _module_flags(self, module_key):
        """Raw {view, add, modify, delete} flag dict for a module. Owner/
        director/super_admin always get every flag — only secretary/
        accountant/teacher are limited by the stored `permissions` map."""
        if self.is_super_admin() or self.role in ('owner', 'director'):
            return {flag: True for flag in PERMISSION_FLAGS}
        entry = (self.permissions or {}).get(module_key)
        if entry is None:
            entry = DEFAULT_MODULE_PERMISSIONS.get(module_key, {})
        return entry if isinstance(entry, dict) else {}

    def can_view(self, module_key):
        return bool(self._module_flags(module_key).get('view'))

    def can_add(self, module_key):
        flags = self._module_flags(module_key)
        return bool(flags.get('view') and flags.get('add'))

    def can_modify(self, module_key):
        flags = self._module_flags(module_key)
        return bool(flags.get('view') and flags.get('modify'))

    def can_delete(self, module_key):
        flags = self._module_flags(module_key)
        return bool(flags.get('view') and flags.get('delete'))

    @property
    def is_staff(self):
        return self.role in ['super_admin', 'owner', 'director', 'secretary', 'accountant']

    def has_perm(self, perm, obj=None):
        return True

    def has_module_perms(self, app_label):
        return True


class TenantMembership(models.Model):
    """Marks a User as an owner of a Tenant beyond whichever one is
    currently their `tenant` FK (their "active" workspace — see
    auth_switch_tenant in views.py). A school owner who buys a second
    school keeps their single login/User row; switching schools just
    updates `User.tenant` to point at a Tenant they hold a membership for,
    which is why every existing `request.user.tenant_id`-scoped check in
    this codebase keeps working unchanged — there's no new "active tenant"
    concept layered on top, the existing one just becomes switchable.
    A regular single-school owner has exactly one row here, created by the
    one-time backfill migration (or by auth_register going forward)."""
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, db_column='user_id', related_name='tenant_memberships')
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='memberships')
    role = models.CharField(max_length=50, default='owner')
    # Which of a multi-school owner's linked workspaces is their "main" one —
    # purely a label the owner/admin sets (doesn't affect access or scoping
    # at all), surfaced in the workspace switcher and the admin panel.
    # Enforced as at-most-one-per-user at the application layer (see
    # admin_set_tenant_ownership / TenantViewSet.create in views.py), not a
    # DB constraint, since "no primary yet" is a valid transient state.
    is_primary = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'tenant_memberships'
        constraints = [
            models.UniqueConstraint(fields=['user', 'tenant'], name='unique_user_tenant_membership'),
        ]


class Guardian(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='guardians')
    name = models.CharField(max_length=255)
    # Latin-script transliteration (French/English) of `name` — most schools
    # enter names in Arabic, but paperwork, IDs, and cross-referencing often
    # need the Latin spelling too. Search matches either.
    name_latin = models.CharField(max_length=255, null=True, blank=True)
    email = models.EmailField(null=True, blank=True)
    phone = models.CharField(max_length=255, null=True, blank=True)
    address = models.CharField(max_length=255, null=True, blank=True)
    occupation = models.CharField(max_length=255, null=True, blank=True)
    RELATIONSHIP_CHOICES = [
        ('father', 'father'),
        ('mother', 'mother'),
        ('guardian', 'guardian'),
        ('other', 'other'),
    ]
    relationship = models.CharField(max_length=50, choices=RELATIONSHIP_CHOICES, default='guardian')
    emergency_contact = models.CharField(max_length=255, null=True, blank=True)
    id_card_number = models.CharField(max_length=50, null=True, blank=True)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, db_column='user_id', related_name='guardians')
    SOURCE_CHOICES = [
        ('staff', 'staff'),
        ('public', 'public'),
    ]
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default='staff')
    # Only meaningful when source='public' — mirrors Student.approval_status.
    # A public enrollment's guardian and student are two halves of one
    # application, so approving/rejecting either one cascades to the other
    # (see StudentViewSet.approve/reject and GuardianViewSet.approve/reject).
    APPROVAL_CHOICES = [
        ('approved', 'approved'),
        ('pending', 'pending'),
        ('rejected', 'rejected'),
    ]
    approval_status = models.CharField(max_length=20, choices=APPROVAL_CHOICES, default='approved')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'parents'


class Teacher(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='teachers')
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, db_column='user_id', related_name='teachers')
    first_name = models.CharField(max_length=255)
    last_name = models.CharField(max_length=255)
    # Latin-script transliteration of first/last name — see Guardian.name_latin.
    first_name_latin = models.CharField(max_length=255, null=True, blank=True)
    last_name_latin = models.CharField(max_length=255, null=True, blank=True)
    email = models.EmailField(null=True, blank=True)
    phone = models.CharField(max_length=255, null=True, blank=True)
    address = models.CharField(max_length=255, null=True, blank=True)
    subjects = models.JSONField(null=True, blank=True)
    hourly_rate = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    monthly_salary = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # Share of their students' payments this teacher earns, in percent — the
    # basis for the Teacher payments page. 0 means nothing is owed.
    payment_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    photo_url = models.CharField(max_length=255, null=True, blank=True)
    # Optional HR documents — image or PDF, viewable/downloadable by the
    # tenant only (not shown on the public website, unlike photo_url).
    cv_url = models.CharField(max_length=255, null=True, blank=True)
    diploma_url = models.CharField(max_length=255, null=True, blank=True)
    # Whether this teacher appears on the tenant's public website — same
    # semantics as Course.show_on_enrollment.
    show_on_website = models.BooleanField(default=False)
    STATUS_CHOICES = [
        ('active', 'active'),
        ('inactive', 'inactive'),
    ]
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='active')
    notes = models.TextField(null=True, blank=True)
    hire_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'teachers'


class Student(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='students')
    parent = models.ForeignKey(Guardian, on_delete=models.SET_NULL, null=True, blank=True, db_column='parent_id', related_name='students')
    first_name = models.CharField(max_length=255)
    last_name = models.CharField(max_length=255)
    # Latin-script transliteration of first/last name — see Guardian.name_latin.
    first_name_latin = models.CharField(max_length=255, null=True, blank=True)
    last_name_latin = models.CharField(max_length=255, null=True, blank=True)
    GENDER_CHOICES = [
        ('male', 'male'),
        ('female', 'female'),
        ('other', 'other'),
    ]
    gender = models.CharField(max_length=50, choices=GENDER_CHOICES, null=True, blank=True)
    SCHOOL_LEVEL_CHOICES = [
        ('primary', 'primary'),
        ('middle', 'middle'),
        ('high', 'high'),
    ]
    school_level = models.CharField(max_length=20, choices=SCHOOL_LEVEL_CHOICES, null=True, blank=True)
    # 1-5 for primary, 1-4 for middle, 1-3 for high — semantics depend on school_level.
    school_year = models.IntegerField(null=True, blank=True)
    # Only meaningful when school_level='high'. Year 1 (1AS) picks between the
    # two common-core tracks; years 2-3 (2AS/3AS) pick a specialty branch —
    # see SPECIALTY_CHOICES-equivalent list documented in the frontend, kept
    # as a free CharField here since the set is Algeria-specific curriculum
    # data, not a DB-level constraint.
    specialty = models.CharField(max_length=50, null=True, blank=True)
    INSURANCE_CHOICES = [
        ('insured', 'insured'),
        ('uninsured', 'uninsured'),
    ]
    insurance_status = models.CharField(max_length=20, choices=INSURANCE_CHOICES, null=True, blank=True)
    health_condition = models.TextField(null=True, blank=True)
    BLOOD_TYPE_CHOICES = [
        ('O+', 'O+'), ('O-', 'O-'), ('A+', 'A+'), ('A-', 'A-'),
        ('B+', 'B+'), ('B-', 'B-'), ('AB+', 'AB+'), ('AB-', 'AB-'),
    ]
    blood_type = models.CharField(max_length=3, choices=BLOOD_TYPE_CHOICES, null=True, blank=True)
    # ID cards live on the Guardian (parent), not the student.
    SOURCE_CHOICES = [
        ('staff', 'staff'),
        ('public', 'public'),
    ]
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default='staff')
    # Only meaningful when source='public' — a self-enrolled student needs a
    # secretary's review before counting as a real record. Staff-entered
    # students skip this (approved outright).
    APPROVAL_CHOICES = [
        ('approved', 'approved'),
        ('pending', 'pending'),
        ('rejected', 'rejected'),
    ]
    approval_status = models.CharField(max_length=20, choices=APPROVAL_CHOICES, default='approved')
    birth_date = models.DateField(null=True, blank=True)
    email = models.EmailField(null=True, blank=True)
    phone = models.CharField(max_length=255, null=True, blank=True)
    address = models.CharField(max_length=255, null=True, blank=True)
    emergency_contact = models.CharField(max_length=255, null=True, blank=True)
    medical_notes = models.TextField(null=True, blank=True)
    photo_url = models.CharField(max_length=255, null=True, blank=True)
    STATUS_CHOICES = [
        ('active', 'active'),
        ('inactive', 'inactive'),
        ('graduated', 'graduated'),
        ('suspended', 'suspended'),
    ]
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='active')
    notes = models.TextField(null=True, blank=True)
    student_code = models.CharField(max_length=255, null=True, blank=True)
    enrollment_date = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'students'


class Course(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='courses')
    title = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    category = models.CharField(max_length=255, null=True, blank=True)
    PRICING_TYPE_CHOICES = [
        # price is already a per-session rate.
        ('per_session', 'per_session'),
        # price is a recurring monthly rate; sessions_count holds how many
        # sessions happen per month, to derive a per-session value.
        ('per_month', 'per_month'),
        # price is the total for the whole course; sessions_count holds the
        # total number of sessions it's spread across.
        ('fixed_sessions', 'fixed_sessions'),
    ]
    pricing_type = models.CharField(max_length=20, choices=PRICING_TYPE_CHOICES, default='fixed_sessions')
    # Meaning depends on pricing_type — see choices above. Unused (null) for
    # per_session, since there's nothing to divide by there.
    sessions_count = models.IntegerField(null=True, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    max_students = models.IntegerField(default=20)
    color = models.CharField(max_length=16, default='#E53935')
    image_url = models.CharField(max_length=255, null=True, blank=True)
    # Which class this course targets — same vocabulary as Student.school_level
    # /school_year/specialty so a course can be matched to its audience.
    school_level = models.CharField(max_length=20, choices=Student.SCHOOL_LEVEL_CHOICES, null=True, blank=True)
    school_year = models.IntegerField(null=True, blank=True)
    specialty = models.CharField(max_length=50, null=True, blank=True)
    STATUS_CHOICES = [
        ('active', 'active'),
        ('draft', 'draft'),
        ('archived', 'archived'),
    ]
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='active')
    show_on_enrollment = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'courses'


class Room(models.Model):
    """A physical room the tenant can assign to groups/sessions and check
    for scheduling conflicts (see rooms_occupancy view)."""
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='rooms')
    name = models.CharField(max_length=255)
    capacity = models.IntegerField(null=True, blank=True)
    notes = models.CharField(max_length=255, null=True, blank=True)
    STATUS_CHOICES = [
        ('active', 'active'),
        ('inactive', 'inactive'),
    ]
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='active')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'rooms'


class Group(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='groups')
    course = models.ForeignKey(Course, on_delete=models.CASCADE, db_column='course_id', related_name='groups')
    teacher = models.ForeignKey(Teacher, on_delete=models.SET_NULL, null=True, blank=True, db_column='teacher_id', related_name='groups')
    name = models.CharField(max_length=255)
    # Legacy free-text room (kept so existing data keeps displaying); new
    # groups should set room_ref instead, which is what rooms_occupancy uses.
    room = models.CharField(max_length=255, null=True, blank=True)
    room_ref = models.ForeignKey(Room, on_delete=models.SET_NULL, null=True, blank=True, db_column='room_id', related_name='groups')
    capacity = models.IntegerField(default=20)
    schedule = models.CharField(max_length=255, null=True, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    STATUS_CHOICES = [
        ('active', 'active'),
        ('completed', 'completed'),
        ('cancelled', 'cancelled'),
    ]
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='active')
    students = models.ManyToManyField(Student, related_name='groups', db_table='group_student')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'groups'


class ClassSession(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='sessions')
    group = models.ForeignKey(Group, on_delete=models.CASCADE, db_column='group_id', related_name='sessions')
    teacher = models.ForeignKey(Teacher, on_delete=models.SET_NULL, null=True, blank=True, db_column='teacher_id', related_name='sessions')
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, null=True, blank=True, db_column='course_id', related_name='sessions')
    # Legacy free-text room (kept so existing data keeps displaying); new
    # sessions should set room_ref instead, which is what rooms_occupancy uses.
    room = models.CharField(max_length=255, null=True, blank=True)
    room_ref = models.ForeignKey(Room, on_delete=models.SET_NULL, null=True, blank=True, db_column='room_id', related_name='sessions')
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    topic = models.CharField(max_length=255, null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    homework = models.TextField(null=True, blank=True)
    STATUS_CHOICES = [
        ('scheduled', 'scheduled'),
        ('completed', 'completed'),
        ('cancelled', 'cancelled'),
    ]
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='scheduled')
    series_id = models.CharField(max_length=36, null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'class_sessions'


class Attendance(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='attendance')
    session = models.ForeignKey(ClassSession, on_delete=models.CASCADE, db_column='session_id', related_name='attendance')
    student = models.ForeignKey(Student, on_delete=models.CASCADE, db_column='student_id', related_name='attendance')
    STATUS_CHOICES = [
        ('present', 'present'),
        ('absent', 'absent'),
        ('late', 'late'),
        ('excused', 'excused'),
    ]
    status = models.CharField(max_length=50, choices=STATUS_CHOICES)
    note = models.CharField(max_length=255, null=True, blank=True)
    # Photo/PDF of the excuse (doctor's note, etc.) for an 'excused' absence —
    # unused for any other status.
    excuse_document_url = models.CharField(max_length=255, null=True, blank=True)
    RECOVERY_CHOICES = [
        # Default for present/absent/late — recovery doesn't apply to them.
        ('not_applicable', 'not_applicable'),
        # Set automatically when status becomes 'excused'; the tenant flips
        # this by hand once the student has made up the missed session.
        ('needs_recovery', 'needs_recovery'),
        ('recovered', 'recovered'),
    ]
    recovery_status = models.CharField(max_length=20, choices=RECOVERY_CHOICES, default='not_applicable')
    marked_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, db_column='marked_by', related_name='marked_attendance')
    marked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'attendance'
        unique_together = ('tenant', 'session', 'student')
        indexes = [
            # Backs dashboard_summary's today-attendance count and every
            # compute_teacher_earnings/compute_student_balances status='present'
            # filter — both hit on every dashboard/reports load.
            models.Index(fields=['tenant', 'status'], name='attendance_tenant_status_idx'),
        ]


class Payment(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='payments')
    student = models.ForeignKey(Student, on_delete=models.CASCADE, db_column='student_id', related_name='payments')
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, null=True, blank=True, db_column='course_id', related_name='payments')
    group = models.ForeignKey(Group, on_delete=models.SET_NULL, null=True, blank=True, db_column='group_id', related_name='payments')
    # A payment is for a course, a trip, or a book, never more than one — the
    # frontend form only shows one selector at a time based on which the
    # user picked.
    trip = models.ForeignKey('Trip', on_delete=models.SET_NULL, null=True, blank=True, db_column='trip_id', related_name='payments')
    book = models.ForeignKey('Book', on_delete=models.SET_NULL, null=True, blank=True, db_column='book_id', related_name='payments')
    # The exact physical copy sold — assigned atomically at payment-creation
    # time from the book's in-stock copies (see PaymentViewSet.create), not
    # chosen by the caller. Lets a specific copy_code be traced back to
    # which student bought it, when, and which staff member sold it.
    book_copy = models.ForeignKey('BookCopy', on_delete=models.SET_NULL, null=True, blank=True, db_column='book_copy_id', related_name='sale_payment')
    KIND_CHOICES = [
        ('registration', 'registration'),
        ('monthly', 'monthly'),
        ('course', 'course'),
        ('per_session', 'per_session'),
        ('trip', 'trip'),
        ('book', 'book'),
        ('other', 'other'),
    ]
    kind = models.CharField(max_length=50, choices=KIND_CHOICES, default='monthly')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    METHOD_CHOICES = [
        ('cash', 'cash'),
        ('card', 'card'),
        ('bank_transfer', 'bank_transfer'),
        ('cheque', 'cheque'),
        ('other', 'other'),
    ]
    method = models.CharField(max_length=50, choices=METHOD_CHOICES, default='cash')
    STATUS_CHOICES = [
        ('paid', 'paid'),
        ('pending', 'pending'),
        ('partial', 'partial'),
        ('refunded', 'refunded'),
        ('cancelled', 'cancelled'),
    ]
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='paid')
    due_date = models.DateField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    reference = models.CharField(max_length=255, null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    invoice_number = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'payments'
        indexes = [
            # Backs dashboard_summary/finance_report/owner_master_dashboard's
            # status='paid' + paid_at-range revenue aggregates — the single
            # hottest query shape in the app.
            models.Index(fields=['tenant', 'status', 'paid_at'], name='pay_tenant_status_paid_idx'),
        ]


class PaymentItem(models.Model):
    """One line on a bill — a payment can now cover several of these (a
    course + a book + a trip in one invoice) instead of exactly one. Payment
    itself stays the bill: student, discount, method, status, paid_at,
    invoice_number, and `amount` (kept as a real stored column, server-set
    to sum(items.amount) at creation — every existing revenue/balance query
    in the app reads Payment.amount directly, and this way none of them
    needed to change to support multiple items per bill).

    Payment's own course/group/trip/book/book_copy/kind columns are no
    longer written to by new payments (superseded by this model) but are
    deliberately left in place rather than dropped, with historical rows
    backfilled into one PaymentItem each — dropping columns on a live
    production Payment table is exactly the kind of one-way risk this
    migration doesn't need to take just to tidy up."""
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, db_column='payment_id', related_name='items')
    KIND_CHOICES = [
        ('registration', 'registration'),
        ('monthly', 'monthly'),
        ('course', 'course'),
        ('per_session', 'per_session'),
        ('trip', 'trip'),
        ('book', 'book'),
        ('other', 'other'),
    ]
    kind = models.CharField(max_length=50, choices=KIND_CHOICES, default='monthly')
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, null=True, blank=True, db_column='course_id', related_name='payment_items')
    group = models.ForeignKey(Group, on_delete=models.SET_NULL, null=True, blank=True, db_column='group_id', related_name='payment_items')
    trip = models.ForeignKey('Trip', on_delete=models.SET_NULL, null=True, blank=True, db_column='trip_id', related_name='payment_items')
    book = models.ForeignKey('Book', on_delete=models.SET_NULL, null=True, blank=True, db_column='book_id', related_name='payment_items')
    # Same server-side atomic assignment as Payment.book_copy used to do —
    # see PaymentViewSet.create.
    book_copy = models.ForeignKey('BookCopy', on_delete=models.SET_NULL, null=True, blank=True, db_column='book_copy_id', related_name='sale_items')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'payment_items'


class Trip(models.Model):
    """A school outing — a group of students going somewhere for a price,
    separate from the regular Course/Group enrollment model since a trip is
    a one-off event rather than an ongoing class."""
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='trips')
    title = models.CharField(max_length=255)
    destination = models.CharField(max_length=255)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    trip_date = models.DateField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    students = models.ManyToManyField(Student, related_name='trips', db_table='trip_student', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'trips'
        ordering = ['-trip_date', '-created_at']


class Book(models.Model):
    """A book/material catalog entry a school prints or buys and resells to
    students — a revenue stream (sale) and an expense (printing/purchase)
    separate from course enrollment. Each physical unit is its own BookCopy
    row, not a bare count, so a specific copy can be traced back to who
    bought it, when, and which staff member sold it."""
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='books')
    title = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'books'
        ordering = ['title']


class BookCopy(models.Model):
    """One physical unit of a Book. `copy_code` is the tenant-scoped,
    human-readable label (mirrors Student.student_code/Payment.invoice_number)
    staff use to look a specific copy up; `id` remains the real PK. Restocking
    a book bulk-creates new rows here with status='in_stock'; selling one
    (via PaymentViewSet.create) flips a single row to 'sold' and stamps who
    sold it and when."""
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='book_copies')
    book = models.ForeignKey(Book, on_delete=models.CASCADE, db_column='book_id', related_name='copies')
    copy_code = models.CharField(max_length=32)
    STATUS_CHOICES = [
        ('in_stock', 'in_stock'),
        ('sold', 'sold'),
    ]
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='in_stock')
    sold_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    sold_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'book_copies'
        ordering = ['copy_code']
        indexes = [
            # Backs PaymentViewSet.create's select_for_update() stock-
            # assignment lock — the exact filter/order_by it runs under
            # contention on every book sale.
            models.Index(fields=['tenant', 'book', 'status', 'copy_code'], name='book_copies_stock_lookup_idx'),
        ]


class Grade(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='grades')
    student = models.ForeignKey(Student, on_delete=models.CASCADE, db_column='student_id', related_name='grades')
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, null=True, blank=True, db_column='course_id', related_name='grades')
    title = models.CharField(max_length=255)
    score = models.DecimalField(max_digits=6, decimal_places=2)
    max_score = models.DecimalField(max_digits=6, decimal_places=2, default=100)
    date = models.DateField()
    notes = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'grades'


class ChargilyCheckout(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='chargily_checkouts')
    PLAN_CHOICES = [
        ('basic', 'basic'),
        ('standard', 'standard'),
        ('premium', 'premium'),
    ]
    plan = models.CharField(max_length=50, choices=PLAN_CHOICES, null=True, blank=True)
    BILLING_CYCLE_CHOICES = [
        ('monthly', 'monthly'),
        ('annual', 'annual'),
    ]
    billing_cycle = models.CharField(max_length=50, choices=BILLING_CYCLE_CHOICES, null=True, blank=True)
    TYPE_CHOICES = [
        ('signup', 'signup'),
        ('renew', 'renew'),
        ('upgrade', 'upgrade'),
        ('student_payment', 'student_payment'),
    ]
    type = models.CharField(max_length=50, choices=TYPE_CHOICES, default='signup')
    # Only set when type='student_payment' — the tuition Payment this checkout
    # is paying off, as opposed to a tenant plan/subscription checkout.
    payment = models.ForeignKey('Payment', on_delete=models.SET_NULL, null=True, blank=True, related_name='chargily_checkouts')
    amount = models.PositiveIntegerField()
    currency = models.CharField(max_length=8, default='dzd')
    # Coupon applied at checkout creation time, if any — kept even if the
    # coupon is later deleted (SET_NULL) so past checkouts still show what
    # was actually charged via discount_amount.
    coupon = models.ForeignKey('Coupon', on_delete=models.SET_NULL, null=True, blank=True, related_name='checkouts')
    discount_amount = models.PositiveIntegerField(default=0)
    chargily_checkout_id = models.CharField(max_length=255, unique=True, null=True, blank=True)
    checkout_url = models.CharField(max_length=255, null=True, blank=True)
    STATUS_CHOICES = [
        ('pending', 'pending'),
        ('paid', 'paid'),
        ('failed', 'failed'),
        ('expired', 'expired'),
    ]
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'chargily_checkouts'


class PasswordResetToken(models.Model):
    token = models.CharField(max_length=255, primary_key=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, db_column='user_id', related_name='password_reset_tokens')
    expires_at = models.DateTimeField()
    used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'password_reset_tokens'


class Conversation(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='conversations')
    guardian = models.OneToOneField(Guardian, on_delete=models.CASCADE, db_column='guardian_id', related_name='conversation')
    last_message_at = models.DateTimeField(null=True, blank=True)
    last_read_by_guardian_at = models.DateTimeField(null=True, blank=True)
    last_read_by_staff_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'conversations'


class Message(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='messages')
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, db_column='conversation_id', related_name='messages')
    sender_user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, db_column='sender_user_id', related_name='sent_messages')
    SENDER_ROLE_CHOICES = [
        ('staff', 'staff'),
        ('parent', 'parent'),
    ]
    sender_role = models.CharField(max_length=20, choices=SENDER_ROLE_CHOICES)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'messages'


class Coupon(models.Model):
    # Platform-wide, not tenant-scoped — only the super admin manages these.
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    code = models.CharField(max_length=32, unique=True)
    description = models.CharField(max_length=255, null=True, blank=True)
    DISCOUNT_TYPE_CHOICES = [
        ('percent', 'percent'),
        ('fixed', 'fixed'),
    ]
    discount_type = models.CharField(max_length=20, choices=DISCOUNT_TYPE_CHOICES, default='percent')
    discount_value = models.DecimalField(max_digits=10, decimal_places=2)
    # List of plan keys ('basic'/'standard'/'premium') this coupon applies
    # to — an empty list means "any plan".
    applicable_plans = models.JSONField(default=list, blank=True)
    # Total number of paid checkouts this coupon may be used for, platform-
    # wide — null means unlimited. Redemption count is computed on demand
    # from ChargilyCheckout(status='paid'), not stored here, so an abandoned
    # checkout never eats into the limit.
    max_redemptions = models.IntegerField(null=True, blank=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    active = models.BooleanField(default=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'coupons'


class Quiz(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='quizzes')
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, null=True, blank=True, db_column='course_id', related_name='quizzes')
    group = models.ForeignKey(Group, on_delete=models.SET_NULL, null=True, blank=True, db_column='group_id', related_name='quizzes')
    title = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    time_limit_minutes = models.IntegerField(null=True, blank=True)
    # The exercise itself: a photo or PDF the teacher uploads. Students read
    # it from the public take-link and upload photos of their worked answers
    # (see QuizSubmissionFile) — there is no multiple-choice authoring.
    exercise_file_url = models.CharField(max_length=255, null=True, blank=True)
    exercise_file_name = models.CharField(max_length=255, null=True, blank=True)
    max_score = models.DecimalField(max_digits=6, decimal_places=2, default=20)
    STATUS_CHOICES = [
        ('draft', 'draft'),
        ('published', 'published'),
        ('closed', 'closed'),
    ]
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    # ONE shared take-link for the whole class, set the first time the quiz
    # is published — not per-student. Whoever opens it types their own name
    # (see QuizAttempt.solver_name); there's no student pre-assigned to it.
    public_token = models.CharField(max_length=64, unique=True, null=True, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'quizzes'


class QuizAttempt(models.Model):
    """One row per submission on the quiz's single shared link — created
    only at submit time (there's no "started but not submitted" state to
    track anymore, since the link isn't tied to a specific person ahead of
    time). `student` is a best-effort match of `solver_name` against the
    quiz's group roster (see public_quiz_attempt_submit); it's null when
    nobody on the roster matched what was typed (typo, not on this group,
    etc.) — the attempt is still recorded either way. Scoring is manual:
    the teacher reads the uploaded solution photos and sets `score`."""
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='+')
    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, db_column='quiz_id', related_name='attempts')
    student = models.ForeignKey(Student, on_delete=models.SET_NULL, null=True, blank=True, db_column='student_id', related_name='quiz_attempts')
    solver_name = models.CharField(max_length=255)
    score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    max_score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    feedback = models.TextField(null=True, blank=True)
    graded_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'quiz_attempts'
        ordering = ['-created_at']


class QuizSubmissionFile(models.Model):
    """A photo (or PDF) of the student's handwritten solution, uploaded from
    the public take-link. One attempt can carry several pages."""
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='+')
    attempt = models.ForeignKey(QuizAttempt, on_delete=models.CASCADE, db_column='attempt_id', related_name='files')
    file_url = models.CharField(max_length=255)
    file_name = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'quiz_submission_files'
        ordering = ['created_at']


class SchoolGalleryPhoto(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='gallery_photos')
    image_url = models.CharField(max_length=255)
    caption = models.CharField(max_length=255, null=True, blank=True)
    order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'school_gallery_photos'
        ordering = ['order']


# Seeded into ExpenseCategory the first time a tenant opens the Expenses page
# (see ensure_default_expense_categories). Stored as `key` so the UI can
# translate them; tenant-added categories carry a free-text `name` instead.
DEFAULT_EXPENSE_CATEGORIES = [
    'rent', 'salaries', 'utilities', 'supplies', 'maintenance',
    'marketing', 'transport', 'taxes', 'equipment', 'trip', 'books', 'other',
]


class ExpenseCategory(models.Model):
    """Either one of DEFAULT_EXPENSE_CATEGORIES (`key` set, `name` blank — the
    frontend translates it) or a tenant-created one (`name` set, `key` null)."""
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='expense_categories')
    key = models.CharField(max_length=50, null=True, blank=True)
    name = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'expense_categories'
        ordering = ['created_at']


class Expense(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='expenses')
    category = models.ForeignKey(ExpenseCategory, on_delete=models.SET_NULL, null=True, blank=True, db_column='category_id', related_name='expenses')
    title = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    spent_at = models.DateField()
    METHOD_CHOICES = [
        ('cash', 'cash'),
        ('card', 'card'),
        ('bank_transfer', 'bank_transfer'),
        ('cheque', 'cheque'),
        ('other', 'other'),
    ]
    method = models.CharField(max_length=50, choices=METHOD_CHOICES, default='cash')
    notes = models.TextField(null=True, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'expenses'
        ordering = ['-spent_at', '-created_at']


class TeacherPayout(models.Model):
    """A recorded settlement with a teacher. What they have *earned* is derived
    live from paid student payments x Teacher.payment_percentage; this table
    only records what has actually been handed over, so the page can show a
    remaining balance."""
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='teacher_payouts')
    teacher = models.ForeignKey(Teacher, on_delete=models.CASCADE, db_column='teacher_id', related_name='payouts')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    paid_at = models.DateField()
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'teacher_payouts'
        ordering = ['-paid_at', '-created_at']


class ActivityLog(models.Model):
    """Append-only audit trail of who did what inside a tenant. Written by
    log_activity() in api/services.py — never edited or deleted through the
    API, and scoped to the tenant so one workspace can't read another's."""
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='activity_logs')
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, db_column='user_id', related_name='+')
    # Denormalised so the trail still reads correctly after a user is deleted.
    user_label = models.CharField(max_length=255, null=True, blank=True)
    CATEGORY_CHOICES = [
        ('auth', 'auth'),
        ('data', 'data'),
        ('security', 'security'),
        ('billing', 'billing'),
    ]
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='data')
    action = models.CharField(max_length=50)
    entity_type = models.CharField(max_length=50, null=True, blank=True)
    entity_id = models.CharField(max_length=36, null=True, blank=True)
    description = models.CharField(max_length=500, null=True, blank=True)
    ip_address = models.CharField(max_length=64, null=True, blank=True)
    user_agent = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'activity_logs'
        ordering = ['-created_at']
        indexes = [models.Index(fields=['tenant', '-created_at'])]


class TimetableEntry(models.Model):
    """One colored block on the weekly timetable (استعمال الزمن) — a fixed
    weekly grid that repeats all year until the tenant changes it, distinct
    from ClassSession's dated, one-off occurrences. day_of_week/start_time
    place it in the grid (Tenant.timetable_end_time bounds how late the grid
    runs; the grid always starts at 08:00); duration_minutes is one of a
    small fixed set so blocks always align to the grid's rows."""
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='timetable_entries')
    # Nullable so pre-existing entries (from before per-room timetables) don't
    # get silently dropped — they just show up under the "General" tab
    # instead of a specific room's.
    room = models.ForeignKey(Room, on_delete=models.SET_NULL, null=True, blank=True, db_column='room_id', related_name='timetable_entries')
    DAY_CHOICES = [
        ('mon', 'mon'), ('tue', 'tue'), ('wed', 'wed'), ('thu', 'thu'),
        ('fri', 'fri'), ('sat', 'sat'), ('sun', 'sun'),
    ]
    day_of_week = models.CharField(max_length=3, choices=DAY_CHOICES)
    start_time = models.TimeField()
    DURATION_CHOICES = [(60, '1h'), (90, '1h30'), (120, '2h'), (180, '3h')]
    duration_minutes = models.IntegerField(choices=DURATION_CHOICES, default=60)
    title = models.CharField(max_length=255)
    color = models.CharField(max_length=16, default='#E53935')
    notes = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'timetable_entries'
        ordering = ['day_of_week', 'start_time']
