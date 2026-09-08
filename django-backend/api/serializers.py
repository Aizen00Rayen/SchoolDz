from rest_framework import serializers

# NOTE: every `tenant_id` below is deliberately read_only. It used to be a
# writable PrimaryKeyRelatedField over Tenant.objects.all(), which meant any
# authenticated user could PATCH a record's tenant_id and move it into a
# workspace they controlled — a staff member could walk a whole school's
# student list out into a tenant they registered themselves. Nothing
# legitimate needs it writable: creation sets the tenant server-side via
# perform_create()'s save(tenant_id=...) kwarg, which bypasses this field.
from .models import Tenant, User, Guardian, Teacher, Student, Course, Group, ClassSession, Room, Attendance, Payment, PaymentItem, Trip, Book, BookCopy, Grade, ChargilyCheckout, Conversation, Message, Coupon, Quiz, QuizAttempt, QuizSubmissionFile, SchoolGalleryPhoto, Expense, ExpenseCategory, TeacherPayout, ActivityLog, TimetableEntry


class TenantScopedPKField(serializers.PrimaryKeyRelatedField):
    """A PrimaryKeyRelatedField restricted to the requesting user's own
    tenant. Plain PrimaryKeyRelatedField(queryset=Model.objects.all())
    resolves against every tenant's rows, so a payload like
    {"student_id": "<uuid belonging to another school>"} would silently
    attach a cross-tenant record — the same bug class the read_only note
    on `tenant_id` above already documents, just on the other end of the
    relation. Requires the serializer to be built with request context
    (true for every DRF ViewSet call); with no request/tenant, resolves
    to an empty queryset so the write is rejected rather than unscoped.
    """
    def __init__(self, model, **kwargs):
        self._related_model = model
        kwargs.setdefault('queryset', model.objects.none())
        super().__init__(**kwargs)

    def get_queryset(self):
        request = self.context.get('request')
        tenant_id = getattr(getattr(request, 'user', None), 'tenant_id', None)
        if not tenant_id:
            return self._related_model.objects.none()
        return self._related_model.objects.filter(tenant_id=tenant_id)


class TenantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tenant
        fields = '__all__'


class UserSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'tenant_id', 'email', 'name', 'role', 'permissions', 'phone', 'avatar_url',
            'is_active', 'email_verified', 'auth_provider', 'google_sub',
            'created_at', 'updated_at'
        ]


class GuardianSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    user_id = TenantScopedPKField(
        User, source='user', allow_null=True, required=False
    )
    student_ids = serializers.SerializerMethodField()

    class Meta:
        model = Guardian
        exclude = ['tenant', 'user']

    def get_student_ids(self, obj):
        # .all() reuses prefetch_related('students') from the view; using
        # .values_list() here silently bypasses that cache and fires one
        # extra query per row (a 500-row page = 500 extra queries).
        return [s.id for s in obj.students.all()]


class TeacherSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    user_id = TenantScopedPKField(
        User, source='user', allow_null=True, required=False
    )

    class Meta:
        model = Teacher
        exclude = ['tenant', 'user']


class StudentSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    parent_id = TenantScopedPKField(
        Guardian, source='parent', allow_null=True, required=False
    )
    # Surfaced so the search dropdown/list can tell same-name students apart
    # by their guardian, without a lookup request per row.
    parent_name = serializers.CharField(source='parent.name', read_only=True, default=None)

    class Meta:
        model = Student
        exclude = ['tenant', 'parent']


class CourseSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)

    class Meta:
        model = Course
        exclude = ['tenant']


class GroupSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    course_id = TenantScopedPKField(
        Course, source='course'
    )
    teacher_id = TenantScopedPKField(
        Teacher, source='teacher', allow_null=True, required=False
    )
    room_id = TenantScopedPKField(
        Room, source='room_ref', allow_null=True, required=False
    )
    room_name = serializers.CharField(source='room_ref.name', read_only=True, default=None)
    student_ids = serializers.SerializerMethodField()

    class Meta:
        model = Group
        exclude = ['tenant', 'course', 'teacher', 'students', 'room_ref']

    def get_student_ids(self, obj):
        # See GuardianSerializer.get_student_ids — .all() hits the
        # prefetch cache, .values_list() would re-query per row.
        return [s.id for s in obj.students.all()]


class ClassSessionSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    group_id = TenantScopedPKField(
        Group, source='group', required=False, allow_null=True
    )
    teacher_id = TenantScopedPKField(
        Teacher, source='teacher', allow_null=True, required=False
    )
    course_id = TenantScopedPKField(
        Course, source='course', allow_null=True, required=False
    )
    room_id = TenantScopedPKField(
        Room, source='room_ref', allow_null=True, required=False
    )
    room_name = serializers.CharField(source='room_ref.name', read_only=True, default=None)
    # Read-only labels so the planner can show who/what/where without a
    # lookup request per session.
    group_name = serializers.CharField(source='group.name', read_only=True, default=None)
    course_title = serializers.CharField(source='course.title', read_only=True, default=None)
    teacher_name = serializers.SerializerMethodField()

    class Meta:
        model = ClassSession
        exclude = ['tenant', 'group', 'teacher', 'course', 'room_ref']

    def get_teacher_name(self, obj):
        return f"{obj.teacher.first_name} {obj.teacher.last_name}" if obj.teacher else None


class AttendanceSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    session_id = TenantScopedPKField(
        ClassSession, source='session', required=False, allow_null=True
    )
    student_id = TenantScopedPKField(
        Student, source='student', required=False, allow_null=True
    )
    marked_by = TenantScopedPKField(
        User, allow_null=True, required=False
    )

    class Meta:
        model = Attendance
        exclude = ['tenant', 'session', 'student']


class PaymentItemSerializer(serializers.ModelSerializer):
    """One line on a bill. Written by PaymentViewSet.create directly (not
    through PaymentSerializer's own write path — see its docstring), but
    still goes through this serializer's is_valid() per item so the same
    TenantScopedPKField checks apply to each line's course/group/trip/book
    as to every other cross-model write in the app."""
    course_id = TenantScopedPKField(
        Course, source='course', allow_null=True, required=False
    )
    group_id = TenantScopedPKField(
        Group, source='group', allow_null=True, required=False
    )
    trip_id = TenantScopedPKField(
        Trip, source='trip', allow_null=True, required=False
    )
    book_id = TenantScopedPKField(
        Book, source='book', allow_null=True, required=False
    )
    # The specific copy sold is picked server-side (see PaymentViewSet.create),
    # never chosen by the caller — read-only here, just for display.
    book_copy_id = serializers.PrimaryKeyRelatedField(source='book_copy', read_only=True)
    book_copy_code = serializers.CharField(source='book_copy.copy_code', read_only=True, default=None)
    course_title = serializers.CharField(source='course.title', read_only=True, default=None)
    trip_title = serializers.CharField(source='trip.title', read_only=True, default=None)
    book_title = serializers.CharField(source='book.title', read_only=True, default=None)
    group_name = serializers.CharField(source='group.name', read_only=True, default=None)

    class Meta:
        model = PaymentItem
        exclude = ['payment', 'course', 'group', 'trip', 'book', 'book_copy']


class PaymentSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    student_id = TenantScopedPKField(
        Student, source='student', required=False, allow_null=True
    )
    # Always server-computed as sum(items.amount) — see
    # PaymentViewSet.create — never trusted from the client, so a payload
    # can't claim a bill total that doesn't match what its items actually
    # add up to.
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    # A bill's line items — set at creation time by PaymentViewSet.create
    # (see PaymentItemSerializer), immutable afterwards; read-only here
    # since the write path for these goes through the view, not a nested
    # writable serializer.
    items = PaymentItemSerializer(many=True, read_only=True)

    class Meta:
        model = Payment
        # course/group/trip/book/book_copy/kind are the old single-item
        # fields — superseded by `items` (see PaymentItem's docstring) and
        # excluded here so new code can't accidentally read/write them.
        exclude = ['tenant', 'student', 'course', 'group', 'trip', 'book', 'book_copy', 'kind']


class TripSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    student_ids = serializers.SerializerMethodField()

    class Meta:
        model = Trip
        exclude = ['tenant', 'students']

    def get_student_ids(self, obj):
        # See GroupSerializer.get_student_ids — .all() hits the prefetch
        # cache, .values_list() would re-query per row.
        return [s.id for s in obj.students.all()]


class BookSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    author_teacher_id = TenantScopedPKField(
        Teacher, source='author_teacher', allow_null=True, required=False
    )
    author_teacher_name = serializers.SerializerMethodField()
    in_stock_count = serializers.SerializerMethodField()
    sold_count = serializers.SerializerMethodField()

    class Meta:
        model = Book
        exclude = ['tenant', 'author_teacher']

    def get_author_teacher_name(self, obj):
        return f'{obj.author_teacher.first_name} {obj.author_teacher.last_name}' if obj.author_teacher else None

    def get_in_stock_count(self, obj):
        # .all() hits the prefetch cache set up by the view (prefetch_related
        # 'copies') rather than re-querying per row.
        return sum(1 for c in obj.copies.all() if c.status == 'in_stock')

    def get_sold_count(self, obj):
        return sum(1 for c in obj.copies.all() if c.status == 'sold')


class BookCopySerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    book_id = serializers.PrimaryKeyRelatedField(source='book', read_only=True)
    sold_by_name = serializers.CharField(source='sold_by.name', read_only=True, default=None)
    buyer_name = serializers.SerializerMethodField()
    payment_id = serializers.SerializerMethodField()

    class Meta:
        model = BookCopy
        exclude = ['tenant', 'book', 'sold_by']

    def _latest_sale(self, obj):
        # obj.sale_payment is prefetched (ordered newest-first, with
        # 'student' select_related) by the view — .all() hits that cache;
        # calling .select_related()/.first() here instead would silently
        # discard the prefetch and re-query per row.
        payments = list(obj.sale_payment.all())
        return payments[0] if payments else None

    def get_buyer_name(self, obj):
        payment = self._latest_sale(obj)
        return f'{payment.student.first_name} {payment.student.last_name}' if payment and payment.student else None

    def get_payment_id(self, obj):
        payment = self._latest_sale(obj)
        return payment.id if payment else None


class GradeSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    student_id = TenantScopedPKField(
        Student, source='student', required=False, allow_null=True
    )
    course_id = TenantScopedPKField(
        Course, source='course', allow_null=True, required=False
    )

    class Meta:
        model = Grade
        exclude = ['tenant', 'student', 'course']


class ChargilyCheckoutSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)

    class Meta:
        model = ChargilyCheckout
        fields = '__all__'


class MessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.SerializerMethodField()

    class Meta:
        model = Message
        exclude = ['tenant', 'conversation']

    def get_sender_name(self, obj):
        if obj.sender_user_id and obj.sender_user:
            return obj.sender_user.name
        return 'Staff' if obj.sender_role == 'staff' else 'Parent'


class ConversationSerializer(serializers.ModelSerializer):
    guardian_name = serializers.CharField(source='guardian.name', read_only=True)
    guardian_email = serializers.CharField(source='guardian.email', read_only=True)
    unread_by_staff = serializers.SerializerMethodField()
    unread_by_guardian = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        exclude = ['tenant']

    def get_unread_by_staff(self, obj):
        return bool(obj.last_message_at and (not obj.last_read_by_staff_at or obj.last_message_at > obj.last_read_by_staff_at))

    def get_unread_by_guardian(self, obj):
        return bool(obj.last_message_at and (not obj.last_read_by_guardian_at or obj.last_message_at > obj.last_read_by_guardian_at))


class CouponSerializer(serializers.ModelSerializer):
    times_redeemed = serializers.SerializerMethodField()
    redemptions_left = serializers.SerializerMethodField()

    class Meta:
        model = Coupon
        exclude = ['created_by']

    def get_times_redeemed(self, obj):
        return obj.checkouts.filter(status='paid').count()

    def get_redemptions_left(self, obj):
        if obj.max_redemptions is None:
            return None
        return max(0, obj.max_redemptions - self.get_times_redeemed(obj))


class QuizSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    course_id = TenantScopedPKField(
        Course, source='course', allow_null=True, required=False
    )
    group_id = TenantScopedPKField(
        Group, source='group', allow_null=True, required=False
    )
    group_name = serializers.CharField(source='group.name', read_only=True, default=None)
    # Every QuizAttempt row is a completed submission now (the shared-link
    # flow only ever creates one at submit time — see
    # public_quiz_attempt_submit) — just the one count, no submitted/total
    # split like the old per-student-link model had.
    attempts_total = serializers.SerializerMethodField()

    class Meta:
        model = Quiz
        exclude = ['tenant', 'course', 'group']

    def get_attempts_total(self, obj):
        return obj.attempts.count()


class QuizSubmissionFileSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuizSubmissionFile
        exclude = ['tenant', 'attempt']


class QuizAttemptSerializer(serializers.ModelSerializer):
    student_name = serializers.SerializerMethodField()
    files = QuizSubmissionFileSerializer(many=True, read_only=True)

    class Meta:
        model = QuizAttempt
        exclude = ['tenant']

    def get_student_name(self, obj):
        return f"{obj.student.first_name} {obj.student.last_name}" if obj.student else None


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        exclude = ['tenant']


class ExpenseSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    category_id = TenantScopedPKField(
        ExpenseCategory, source='category', allow_null=True, required=False
    )
    category_key = serializers.CharField(source='category.key', read_only=True, default=None)
    category_name = serializers.CharField(source='category.name', read_only=True, default=None)

    class Meta:
        model = Expense
        exclude = ['tenant', 'category', 'created_by']


class TeacherPayoutSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    teacher_id = TenantScopedPKField(
        Teacher, source='teacher'
    )
    teacher_name = serializers.SerializerMethodField()

    class Meta:
        model = TeacherPayout
        exclude = ['tenant', 'teacher', 'created_by']

    def get_teacher_name(self, obj):
        return f"{obj.teacher.first_name} {obj.teacher.last_name}" if obj.teacher else None


class ActivityLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityLog
        exclude = ['tenant', 'user']


class SchoolGalleryPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = SchoolGalleryPhoto
        exclude = ['tenant']


class RoomSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)

    class Meta:
        model = Room
        exclude = ['tenant']


class TimetableEntrySerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    room_id = TenantScopedPKField(
        Room, source='room', allow_null=True, required=False
    )
    room_name = serializers.CharField(source='room.name', read_only=True, default=None)

    class Meta:
        model = TimetableEntry
        exclude = ['tenant', 'room']
