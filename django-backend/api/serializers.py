from rest_framework import serializers
from .models import Tenant, User, Guardian, Teacher, Student, Course, Group, ClassSession, Attendance, Payment, ChargilyCheckout

class TenantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tenant
        fields = '__all__'


class UserSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(), source='tenant', allow_null=True, required=False
    )

    class Meta:
        model = User
        fields = [
            'id', 'tenant_id', 'email', 'name', 'role', 'phone', 'avatar_url',
            'is_active', 'email_verified', 'auth_provider', 'google_sub',
            'created_at', 'updated_at'
        ]


class GuardianSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(), source='tenant', required=False, allow_null=True
    )

    class Meta:
        model = Guardian
        exclude = ['tenant']


class TeacherSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(), source='tenant', required=False, allow_null=True
    )
    user_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), source='user', allow_null=True, required=False
    )

    class Meta:
        model = Teacher
        exclude = ['tenant', 'user']


class StudentSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(), source='tenant', required=False, allow_null=True
    )
    parent_id = serializers.PrimaryKeyRelatedField(
        queryset=Guardian.objects.all(), source='parent', allow_null=True, required=False
    )

    class Meta:
        model = Student
        exclude = ['tenant', 'parent']


class CourseSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(), source='tenant', required=False, allow_null=True
    )

    class Meta:
        model = Course
        exclude = ['tenant']


class GroupSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(), source='tenant', required=False, allow_null=True
    )
    course_id = serializers.PrimaryKeyRelatedField(
        queryset=Course.objects.all(), source='course', required=False, allow_null=True
    )
    teacher_id = serializers.PrimaryKeyRelatedField(
        queryset=Teacher.objects.all(), source='teacher', allow_null=True, required=False
    )
    student_ids = serializers.SerializerMethodField()

    class Meta:
        model = Group
        exclude = ['tenant', 'course', 'teacher', 'students']

    def get_student_ids(self, obj):
        return list(obj.students.values_list('id', flat=True))


class ClassSessionSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(), source='tenant', required=False, allow_null=True
    )
    group_id = serializers.PrimaryKeyRelatedField(
        queryset=Group.objects.all(), source='group', required=False, allow_null=True
    )
    teacher_id = serializers.PrimaryKeyRelatedField(
        queryset=Teacher.objects.all(), source='teacher', allow_null=True, required=False
    )
    course_id = serializers.PrimaryKeyRelatedField(
        queryset=Course.objects.all(), source='course', allow_null=True, required=False
    )

    class Meta:
        model = ClassSession
        exclude = ['tenant', 'group', 'teacher', 'course']


class AttendanceSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(), source='tenant', required=False, allow_null=True
    )
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
    tenant_id = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(), source='tenant', required=False, allow_null=True
    )
    student_id = serializers.PrimaryKeyRelatedField(
        queryset=Student.objects.all(), source='student', required=False, allow_null=True
    )
    course_id = serializers.PrimaryKeyRelatedField(
        queryset=Course.objects.all(), source='course', allow_null=True, required=False
    )
    group_id = serializers.PrimaryKeyRelatedField(
        queryset=Group.objects.all(), source='group', allow_null=True, required=False
    )

    class Meta:
        model = Payment
        exclude = ['tenant', 'student', 'course', 'group']


class ChargilyCheckoutSerializer(serializers.ModelSerializer):
    tenant_id = serializers.PrimaryKeyRelatedField(
        queryset=Tenant.objects.all(), source='tenant'
    )

    class Meta:
        model = ChargilyCheckout
        fields = '__all__'
