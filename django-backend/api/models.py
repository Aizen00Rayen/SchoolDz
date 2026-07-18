import uuid
from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager

def generate_uuid():
    return str(uuid.uuid4())

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
    plan = models.CharField(max_length=50, choices=PLAN_CHOICES)
    BILLING_CYCLE_CHOICES = [
        ('monthly', 'monthly'),
        ('annual', 'annual'),
    ]
    billing_cycle = models.CharField(max_length=50, choices=BILLING_CYCLE_CHOICES)
    TYPE_CHOICES = [
        ('signup', 'signup'),
        ('renew', 'renew'),
        ('upgrade', 'upgrade'),
    ]
    type = models.CharField(max_length=50, choices=TYPE_CHOICES, default='signup')
    amount = models.PositiveIntegerField()
    currency = models.CharField(max_length=8, default='dzd')
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
