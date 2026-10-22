"""Parent portal endpoints."""
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, NotFound
from ..models import (
    Tenant,
    Guardian,
    Teacher,
    Student,
    Group,
    ClassSession,
    Attendance,
    Payment,
    Grade,
    Conversation,
    Message,
)
from ..serializers import (
    TeacherSerializer,
    StudentSerializer,
    ClassSessionSerializer,
    AttendanceSerializer,
    PaymentSerializer,
    GradeSerializer,
    ConversationSerializer,
    MessageSerializer,
)
from .common import (
    PLANS_CONFIG,
    _inactive_tenant_message,
)
from .payments import (
    compute_student_balances,
)


# Parent Portal — read-only endpoints for role='parent' users, scoped to only
# the children linked to their own Guardian record. Gated on the tenant's
# parent_portal plan flag so a downgrade after a parent already has a login
# revokes access immediately rather than just hiding the invite button.
def _portal_guardian(request):
    user = request.user
    if user.role != 'parent' or not user.tenant_id:
        raise PermissionDenied('Forbidden')

    tenant = Tenant.objects.filter(id=user.tenant_id).first()
    # Staff access is fully locked out the moment a tenant stops being
    # 'active' (TenantScopedViewSet.get_queryset) — a parent's existing
    # session used to keep full portal access indefinitely through a
    # suspension/expiry/unpaid period, since only the plan's feature flag
    # was ever checked here.
    if not tenant or tenant.status != 'active':
        raise PermissionDenied(_inactive_tenant_message(tenant))
    parent_portal = bool(tenant.plan and PLANS_CONFIG['tiers'][tenant.plan].get('parent_portal', False))
    if not parent_portal:
        raise PermissionDenied('The parent portal is not available on this workspace\'s current plan')

    guardian = Guardian.objects.filter(user_id=user.id, tenant_id=user.tenant_id).first()
    if not guardian:
        raise PermissionDenied('No parent profile linked to this account')
    return guardian


def _portal_child(request, student_id):
    guardian = _portal_guardian(request)
    student = Student.objects.filter(id=student_id, tenant_id=request.user.tenant_id, parent_id=guardian.id).first()
    if not student:
        raise NotFound('Student not found')
    return student


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_children(request):
    guardian = _portal_guardian(request)
    children = list(Student.objects.filter(tenant_id=request.user.tenant_id, parent_id=guardian.id).order_by('first_name'))
    # 'partial' counts as collected money elsewhere now — only a still-fully-
    # unpaid 'pending' invoice is genuinely overdue.
    overdue_ids = set(Payment.objects.filter(
        tenant_id=request.user.tenant_id,
        student_id__in=[c.id for c in children],
        status='pending',
        due_date__lt=timezone.now().date(),
    ).values_list('student_id', flat=True))
    data = StudentSerializer(children, many=True).data
    for row in data:
        row['has_overdue_payment'] = row['id'] in overdue_ids
    return Response({'items': data, 'total': len(children)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_child_attendance(request, student_id):
    student = _portal_child(request, student_id)
    items = Attendance.objects.filter(tenant_id=request.user.tenant_id, student_id=student.id).order_by('-marked_at')[:200]
    return Response({'items': AttendanceSerializer(items, many=True).data, 'total': len(items)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_child_sessions(request, student_id):
    student = _portal_child(request, student_id)
    qs = ClassSession.objects.filter(tenant_id=request.user.tenant_id, group__students=student)
    from_date = request.GET.get('from_date')
    if from_date:
        qs = qs.filter(start_at__gte=from_date)
    to_date = request.GET.get('to_date')
    if to_date:
        qs = qs.filter(start_at__lte=to_date)
    items = qs.order_by('-start_at')[:300]
    return Response({'items': ClassSessionSerializer(items, many=True).data, 'total': len(items)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_child_teachers(request, student_id):
    student = _portal_child(request, student_id)
    teacher_ids = Group.objects.filter(
        tenant_id=request.user.tenant_id, students=student, teacher__isnull=False,
    ).values_list('teacher_id', flat=True).distinct()
    items = Teacher.objects.filter(tenant_id=request.user.tenant_id, id__in=teacher_ids)
    return Response({'items': TeacherSerializer(items, many=True).data, 'total': items.count()})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_conversation(request):
    guardian = _portal_guardian(request)
    convo, _ = Conversation.objects.get_or_create(tenant_id=request.user.tenant_id, guardian=guardian)
    return Response(ConversationSerializer(convo, context={'request': request}).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def portal_conversation_messages(request):
    guardian = _portal_guardian(request)
    convo, _ = Conversation.objects.get_or_create(tenant_id=request.user.tenant_id, guardian=guardian)

    if request.method == 'POST':
        body = (request.data.get('body') or '').strip()
        if not body:
            return Response({'error': 'Message body is required'}, status=status.HTTP_400_BAD_REQUEST)
        if len(body) > 10000:
            return Response({'error': 'Message is too long (10,000 characters max).'}, status=status.HTTP_400_BAD_REQUEST)
        now = timezone.now()
        Message.objects.create(
            tenant_id=request.user.tenant_id, conversation=convo,
            sender_user=request.user, sender_role='parent', body=body,
        )
        convo.last_message_at = now
        convo.last_read_by_guardian_at = now
        convo.save(update_fields=['last_message_at', 'last_read_by_guardian_at', 'updated_at'])
    else:
        convo.last_read_by_guardian_at = timezone.now()
        convo.save(update_fields=['last_read_by_guardian_at', 'updated_at'])

    # Newest 500, oldest-first for display — see the staff-side messages
    # action's identical comment for why this isn't just order_by('created_at').
    items = list(convo.messages.select_related('sender_user').order_by('-created_at')[:500])
    items.reverse()
    return Response({'items': MessageSerializer(items, many=True).data, 'total': len(items)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_child_payments(request, student_id):
    student = _portal_child(request, student_id)
    items = Payment.objects.filter(tenant_id=request.user.tenant_id, student_id=student.id).order_by('-created_at')[:200]
    # The raw invoice list alone can look deceptively clean — a student can
    # have zero Payment rows and still owe real, attendance-accrued debt.
    # Surface the same balance figure staff see for this student
    # (payments_student_summary) so a parent isn't left with a false "all
    # clear" impression.
    balance = compute_student_balances(request.user.tenant_id).get(
        student.id, {'paid': 0.0, 'cost': 0.0, 'balance': 0.0, 'status': 'settled'},
    )
    return Response({'items': PaymentSerializer(items, many=True).data, 'total': len(items), 'balance': balance})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_child_grades(request, student_id):
    student = _portal_child(request, student_id)
    items = Grade.objects.filter(tenant_id=request.user.tenant_id, student_id=student.id).order_by('-date')[:200]
    return Response({'items': GradeSerializer(items, many=True).data, 'total': len(items)})
