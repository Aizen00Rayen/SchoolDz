import uuid
from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager

def generate_uuid():
    return str(uuid.uuid4())

# The tabs an owner/director can grant secretary/accountant/teacher users
# access to, and the levels each can be set to. Kept here (not just in the
# frontend) so serializers/views validate against the same source of truth.
PERMISSION_MODULES = [
    'students', 'teachers', 'parents', 'courses', 'groups',
    'sessions', 'payments', 'grades', 'attendance', 'messages', 'quizzes',
]
PERMISSION_LEVELS = ['hidden', 'view', 'edit']

class Tenant(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    name = models.CharField(max_length=255)
    slug = models.CharField(max_length=255, unique=True)
    center_type = models.CharField(max_length=255, default='tutoring')
    STATUS_CHOICES = [
        ('pending_payment', 'pending_payment'),
        ('active', 'active'),
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
    # {"students": "edit", "payments": "view"}. Missing key = hidden.
    # Ignored for owner/director/super_admin, who always have full access
    # (see get_permission below and PERMISSION_MODULES for the valid keys).
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

    def get_permission(self, module_key):
        """Effective access level for a tab/module: 'edit', 'view', or 'hidden'.
        Owner/director/super_admin always get 'edit' — only secretary/
        accountant/teacher are limited by the stored `permissions` map."""
        if self.is_super_admin() or self.role in ('owner', 'director'):
            return 'edit'
        return (self.permissions or {}).get(module_key, 'hidden')

    @property
    def is_staff(self):
        return self.role in ['super_admin', 'owner', 'director', 'secretary', 'accountant']

    def has_perm(self, perm, obj=None):
        return True

    def has_module_perms(self, app_label):
        return True


class Guardian(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='guardians')
    name = models.CharField(max_length=255)
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
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, db_column='user_id', related_name='guardians')
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
    email = models.EmailField(null=True, blank=True)
    phone = models.CharField(max_length=255, null=True, blank=True)
    address = models.CharField(max_length=255, null=True, blank=True)
    subjects = models.JSONField(null=True, blank=True)
    hourly_rate = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    monthly_salary = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    photo_url = models.CharField(max_length=255, null=True, blank=True)
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
    GENDER_CHOICES = [
        ('male', 'male'),
        ('female', 'female'),
        ('other', 'other'),
    ]
    gender = models.CharField(max_length=50, choices=GENDER_CHOICES, null=True, blank=True)
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
    duration_weeks = models.IntegerField(default=12)
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    max_students = models.IntegerField(default=20)
    color = models.CharField(max_length=16, default='#E53935')
    image_url = models.CharField(max_length=255, null=True, blank=True)
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


class Group(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='groups')
    course = models.ForeignKey(Course, on_delete=models.CASCADE, db_column='course_id', related_name='groups')
    teacher = models.ForeignKey(Teacher, on_delete=models.SET_NULL, null=True, blank=True, db_column='teacher_id', related_name='groups')
    name = models.CharField(max_length=255)
    room = models.CharField(max_length=255, null=True, blank=True)
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
    room = models.CharField(max_length=255, null=True, blank=True)
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
    marked_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, db_column='marked_by', related_name='marked_attendance')
    marked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'attendance'
        unique_together = ('tenant', 'session', 'student')


class Payment(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='payments')
    student = models.ForeignKey(Student, on_delete=models.CASCADE, db_column='student_id', related_name='payments')
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, null=True, blank=True, db_column='course_id', related_name='payments')
    group = models.ForeignKey(Group, on_delete=models.SET_NULL, null=True, blank=True, db_column='group_id', related_name='payments')
    KIND_CHOICES = [
        ('registration', 'registration'),
        ('monthly', 'monthly'),
        ('course', 'course'),
        ('installment', 'installment'),
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


class Question(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='+')
    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, db_column='quiz_id', related_name='questions')
    text = models.TextField()
    points = models.DecimalField(max_digits=6, decimal_places=2, default=1)
    order = models.IntegerField(default=0)

    class Meta:
        db_table = 'quiz_questions'
        ordering = ['order']


class Choice(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='+')
    question = models.ForeignKey(Question, on_delete=models.CASCADE, db_column='question_id', related_name='choices')
    text = models.CharField(max_length=500)
    is_correct = models.BooleanField(default=False)
    order = models.IntegerField(default=0)

    class Meta:
        db_table = 'quiz_choices'
        ordering = ['order']


class QuizAttempt(models.Model):
    """One row per submission on the quiz's single shared link — created
    only at submit time (there's no "started but not submitted" state to
    track anymore, since the link isn't tied to a specific person ahead of
    time). `student` is a best-effort match of `solver_name` against the
    quiz's group roster (see public_quiz_attempt_submit); it's null when
    nobody on the roster matched what was typed (typo, not on this group,
    etc.) — the attempt is still recorded either way."""
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='+')
    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, db_column='quiz_id', related_name='attempts')
    student = models.ForeignKey(Student, on_delete=models.SET_NULL, null=True, blank=True, db_column='student_id', related_name='quiz_attempts')
    solver_name = models.CharField(max_length=255)
    score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    max_score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'quiz_attempts'
        ordering = ['-created_at']


class Answer(models.Model):
    id = models.CharField(max_length=36, primary_key=True, default=generate_uuid, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, db_column='tenant_id', related_name='+')
    attempt = models.ForeignKey(QuizAttempt, on_delete=models.CASCADE, db_column='attempt_id', related_name='answers')
    question = models.ForeignKey(Question, on_delete=models.CASCADE, db_column='question_id', related_name='+')
    choice = models.ForeignKey(Choice, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')

    class Meta:
        db_table = 'quiz_answers'
        unique_together = ('attempt', 'question')


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
