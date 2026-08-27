from rest_framework import serializers

# NOTE: every `tenant_id` below is deliberately read_only. It used to be a
# writable PrimaryKeyRelatedField over Tenant.objects.all(), which meant any
# authenticated user could PATCH a record's tenant_id and move it into a
# workspace they controlled — a staff member could walk a whole school's
# student list out into a tenant they registered themselves. Nothing
# legitimate needs it writable: creation sets the tenant server-side via
# perform_create()'s save(tenant_id=...) kwarg, which bypasses this field.
from .models import Tenant, User, Guardian, Teacher, Student, Course, Group, ClassSession, Room, Attendance, Payment, Trip, Book, BookCopy, Grade, ChargilyCheckout, Conversation, Message, Coupon, Quiz, QuizAttempt, QuizSubmissionFile, SchoolGalleryPhoto, Expense, ExpenseCategory, TeacherPayout, ActivityLog, TimetableEntry

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
    user_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), source='user', allow_null=True, required=False
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
    user_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), source='user', allow_null=True, required=False
    )

    class Meta:
        model = Teacher
        exclude = ['tenant', 'user']


class StudentSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    parent_id = serializers.PrimaryKeyRelatedField(
        queryset=Guardian.objects.all(), source='parent', allow_null=True, required=False
    )

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
    course_id = serializers.PrimaryKeyRelatedField(
        queryset=Course.objects.all(), source='course'
    )
    teacher_id = serializers.PrimaryKeyRelatedField(
        queryset=Teacher.objects.all(), source='teacher', allow_null=True, required=False
    )
    room_id = serializers.PrimaryKeyRelatedField(
        queryset=Room.objects.all(), source='room_ref', allow_null=True, required=False
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
    group_id = serializers.PrimaryKeyRelatedField(
        queryset=Group.objects.all(), source='group', required=False, allow_null=True
    )
    teacher_id = serializers.PrimaryKeyRelatedField(
        queryset=Teacher.objects.all(), source='teacher', allow_null=True, required=False
    )
    course_id = serializers.PrimaryKeyRelatedField(
        queryset=Course.objects.all(), source='course', allow_null=True, required=False
    )
    room_id = serializers.PrimaryKeyRelatedField(
        queryset=Room.objects.all(), source='room_ref', allow_null=True, required=False
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
    session_id = serializers.PrimaryKeyRelatedField(
        queryset=ClassSession.objects.all(), source='session', required=False, allow_null=True
    )
    student_id = serializers.PrimaryKeyRelatedField(
        queryset=Student.objects.all(), source='student', required=False, allow_null=True
    )
    marked_by = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), allow_null=True, required=False
    )

    class Meta:
        model = Attendance
        exclude = ['tenant', 'session', 'student']


class PaymentSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    student_id = serializers.PrimaryKeyRelatedField(
        queryset=Student.objects.all(), source='student', required=False, allow_null=True
    )
    course_id = serializers.PrimaryKeyRelatedField(
        queryset=Course.objects.all(), source='course', allow_null=True, required=False
    )
    group_id = serializers.PrimaryKeyRelatedField(
        queryset=Group.objects.all(), source='group', allow_null=True, required=False
    )
    trip_id = serializers.PrimaryKeyRelatedField(
        queryset=Trip.objects.all(), source='trip', allow_null=True, required=False
    )
    book_id = serializers.PrimaryKeyRelatedField(
        queryset=Book.objects.all(), source='book', allow_null=True, required=False
    )
    # The specific copy sold is picked server-side (see PaymentViewSet.create),
    # never chosen by the caller — read-only here, just for display.
    book_copy_id = serializers.PrimaryKeyRelatedField(source='book_copy', read_only=True)
    book_copy_code = serializers.CharField(source='book_copy.copy_code', read_only=True, default=None)

    class Meta:
        model = Payment
        exclude = ['tenant', 'student', 'course', 'group', 'trip', 'book', 'book_copy']


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
    in_stock_count = serializers.SerializerMethodField()
    sold_count = serializers.SerializerMethodField()

    class Meta:
        model = Book
        exclude = ['tenant']

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

    def get_buyer_name(self, obj):
        payment = obj.sale_payment.select_related('student').first()
        return f'{payment.student.first_name} {payment.student.last_name}' if payment and payment.student else None

    def get_payment_id(self, obj):
        payment = obj.sale_payment.first()
        return payment.id if payment else None


class GradeSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    student_id = serializers.PrimaryKeyRelatedField(
        queryset=Student.objects.all(), source='student', required=False, allow_null=True
    )
    course_id = serializers.PrimaryKeyRelatedField(
        queryset=Course.objects.all(), source='course', allow_null=True, required=False
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
    course_id = serializers.PrimaryKeyRelatedField(
        queryset=Course.objects.all(), source='course', allow_null=True, required=False
    )
    group_id = serializers.PrimaryKeyRelatedField(
        queryset=Group.objects.all(), source='group', allow_null=True, required=False
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
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=ExpenseCategory.objects.all(), source='category', allow_null=True, required=False
    )
    category_key = serializers.CharField(source='category.key', read_only=True, default=None)
    category_name = serializers.CharField(source='category.name', read_only=True, default=None)

    class Meta:
        model = Expense
        exclude = ['tenant', 'category', 'created_by']


class TeacherPayoutSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(source='tenant', read_only=True)
    teacher_id = serializers.PrimaryKeyRelatedField(
        queryset=Teacher.objects.all(), source='teacher'
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

    class Meta:
        model = TimetableEntry
        exclude = ['tenant']
