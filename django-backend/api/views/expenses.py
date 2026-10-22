"""Expenses, other incomes and student insurance."""
from django.db.models import Q, Sum, Count
from django.http import Http404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied, APIException
import traceback
from ..models import (
    Tenant,
    Expense,
    ExpenseCategory,
    OtherIncome,
    OtherIncomeCategory,
    DEFAULT_EXPENSE_CATEGORIES,
    DEFAULT_OTHER_INCOME_CATEGORIES,
    StudentInsurance,
)
from ..serializers import (
    ExpenseSerializer,
    ExpenseCategorySerializer,
    OtherIncomeSerializer,
    OtherIncomeCategorySerializer,
    StudentInsuranceSerializer,
)
from ..services import log_activity
from .common import (
    TenantScopedViewSet,
    _inactive_tenant_message,
    export_rows,
    filter_by_date_range,
    logger,
)


# ---------------------------------------------------------------- Expenses

def ensure_default_expense_categories(tenant_id):
    """Seed every DEFAULT_EXPENSE_CATEGORIES key the very first time a
    tenant's Expenses page is loaded — and only that once (see
    Tenant.default_expense_categories_seeded_at). Re-deriving "which keys
    are missing" from what currently exists on every load couldn't tell a
    key the tenant never saw apart from one they'd deliberately deleted, so
    a deleted default category always silently came back on the next load;
    seeding exactly once means a delete actually sticks. The one accepted
    trade-off: a key added to DEFAULT_EXPENSE_CATEGORIES later won't
    retroactively appear for tenants already seeded before that."""
    updated = Tenant.objects.filter(
        id=tenant_id, default_expense_categories_seeded_at__isnull=True,
    ).update(default_expense_categories_seeded_at=timezone.now())
    if not updated:
        return
    existing_keys = set(
        ExpenseCategory.objects.filter(tenant_id=tenant_id, key__isnull=False).values_list('key', flat=True)
    )
    missing = [key for key in DEFAULT_EXPENSE_CATEGORIES if key not in existing_keys]
    if missing:
        ExpenseCategory.objects.bulk_create([
            ExpenseCategory(tenant_id=tenant_id, key=key) for key in missing
        ])


class ExpenseCategoryViewSet(TenantScopedViewSet):
    queryset = ExpenseCategory.objects.all()
    serializer_class = ExpenseCategorySerializer
    module_key = 'expenses'

    def list(self, request, *args, **kwargs):
        ensure_default_expense_categories(request.user.tenant_id)
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        name = (request.data.get('name') or '').strip()
        if not name:
            raise ValidationError('name is required')
        category = ExpenseCategory.objects.create(tenant_id=request.user.tenant_id, name=name)
        log_activity(request, request.user.tenant_id, 'create', entity_type='expense_category',
                     entity_id=category.id, description=f'Added expense category "{name}"')
        return Response(ExpenseCategorySerializer(category).data)

    def destroy(self, request, *args, **kwargs):
        self.check_module_delete()
        category = self.get_object()
        log_activity(request, request.user.tenant_id, 'delete', entity_type='expense_category',
                     entity_id=category.id, description=f'Deleted expense category "{category.key or category.name}"')
        return super().destroy(request, *args, **kwargs)


class ExpenseViewSet(TenantScopedViewSet):
    queryset = Expense.objects.all()
    serializer_class = ExpenseSerializer
    module_key = 'expenses'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset()).select_related('category')
        queryset = filter_by_date_range(queryset, request, 'spent_at')
        category_id = request.GET.get('category_id')
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(Q(title__icontains=q) | Q(notes__icontains=q))
        queryset = queryset.order_by('-spent_at', '-created_at')[:1000]
        serializer = self.get_serializer(queryset, many=True)
        total = sum(float(e.amount) for e in queryset)
        return Response({'items': serializer.data, 'total': len(serializer.data), 'total_amount': total})

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset()).select_related('category')
        queryset = filter_by_date_range(queryset, request, 'spent_at').order_by('-spent_at')
        headers = ['Date', 'Title', 'Category', 'Amount', 'Method', 'Notes']
        rows = [[
            e.spent_at.isoformat() if e.spent_at else '', e.title,
            e.category.key or e.category.name if e.category else '',
            float(e.amount), e.method, e.notes or '',
        ] for e in queryset]
        return export_rows(headers, rows, 'expenses', request.GET.get('type'))


# -------------------------------------------------------- Other Incomes

def ensure_default_other_income_categories(tenant_id):
    """Seed every DEFAULT_OTHER_INCOME_CATEGORIES key the very first time a
    tenant's Other Incomes page is loaded — and only that once (see
    Tenant.default_other_income_categories_seeded_at). Seeding exactly once
    means deleted default categories stay deleted."""
    updated = Tenant.objects.filter(
        id=tenant_id, default_other_income_categories_seeded_at__isnull=True,
    ).update(default_other_income_categories_seeded_at=timezone.now())
    if not updated:
        return
    existing_keys = set(
        OtherIncomeCategory.objects.filter(tenant_id=tenant_id, key__isnull=False).values_list('key', flat=True)
    )
    missing = [key for key in DEFAULT_OTHER_INCOME_CATEGORIES if key not in existing_keys]
    if missing:
        OtherIncomeCategory.objects.bulk_create([
            OtherIncomeCategory(tenant_id=tenant_id, key=key) for key in missing
        ])


class OtherIncomeCategoryViewSet(TenantScopedViewSet):
    queryset = OtherIncomeCategory.objects.all()
    serializer_class = OtherIncomeCategorySerializer
    module_key = 'other_incomes'

    def list(self, request, *args, **kwargs):
        ensure_default_other_income_categories(request.user.tenant_id)
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        name = (request.data.get('name') or '').strip()
        if not name:
            raise ValidationError('name is required')
        category = OtherIncomeCategory.objects.create(tenant_id=request.user.tenant_id, name=name)
        log_activity(request, request.user.tenant_id, 'create', entity_type='other_income_category',
                     entity_id=category.id, description=f'Added other income category "{name}"')
        return Response(OtherIncomeCategorySerializer(category).data)

    def destroy(self, request, *args, **kwargs):
        self.check_module_delete()
        category = self.get_object()
        log_activity(request, request.user.tenant_id, 'delete', entity_type='other_income_category',
                     entity_id=category.id, description=f'Deleted other income category "{category.key or category.name}"')
        return super().destroy(request, *args, **kwargs)


class OtherIncomeViewSet(TenantScopedViewSet):
    queryset = OtherIncome.objects.all()
    serializer_class = OtherIncomeSerializer
    module_key = 'other_incomes'

    def perform_create(self, serializer):
        self.check_module_add()
        instance = serializer.save(tenant_id=self.request.user.tenant_id, created_by=self.request.user)
        self._log_model_action('create', instance)

    def perform_update(self, serializer):
        self.check_module_modify()
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        self.check_module_delete()
        super().perform_destroy(instance)

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset()).select_related('category')
        queryset = filter_by_date_range(queryset, request, 'received_at')
        category_id = request.GET.get('category_id')
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(Q(title__icontains=q) | Q(notes__icontains=q))
        queryset = queryset.order_by('-received_at', '-created_at')[:1000]
        serializer = self.get_serializer(queryset, many=True)
        total = sum(float(e.amount) for e in queryset)
        return Response({'items': serializer.data, 'total': len(serializer.data), 'total_amount': total})

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset()).select_related('category')
        queryset = filter_by_date_range(queryset, request, 'received_at').order_by('-received_at')
        headers = ['Date', 'Title', 'Category', 'Amount', 'Method', 'Notes']
        rows = [[
            e.received_at.isoformat() if e.received_at else '', e.title,
            e.category.key or e.category.name if e.category else '',
            float(e.amount), e.method, e.notes or '',
        ] for e in queryset]
        return export_rows(headers, rows, 'other_incomes', request.GET.get('type'))


class StudentInsuranceViewSet(TenantScopedViewSet):
    queryset = StudentInsurance.objects.all()
    serializer_class = StudentInsuranceSerializer
    module_key = 'insurances'

    def check_module_view(self):
        user = self.request.user
        if user.is_super_admin() or user.role in ('owner', 'director', 'accountant') or user.can_view('insurances') or user.can_view('payments'):
            return
        raise PermissionDenied('Forbidden')

    def check_module_add(self):
        user = self.request.user
        if user.is_super_admin() or user.role in ('owner', 'director', 'accountant') or user.can_add('insurances') or user.can_add('payments'):
            return
        raise PermissionDenied('Forbidden')

    def check_module_modify(self):
        user = self.request.user
        if user.is_super_admin() or user.role in ('owner', 'director', 'accountant') or user.can_modify('insurances') or user.can_modify('payments'):
            return
        raise PermissionDenied('Forbidden')

    def check_module_delete(self):
        user = self.request.user
        if user.is_super_admin() or user.role in ('owner', 'director', 'accountant') or user.can_delete('insurances') or user.can_delete('payments'):
            return
        raise PermissionDenied('Forbidden')

    def list(self, request, *args, **kwargs):
        try:
            queryset = self.filter_queryset(self.get_queryset()).select_related('student', 'student__parent')
            queryset = filter_by_date_range(queryset, request, 'paid_at')
            student_id = request.GET.get('student_id')
            if student_id:
                queryset = queryset.filter(student_id=student_id)
            q = request.GET.get('q', '').strip()
            if q:
                queryset = queryset.filter(
                    Q(student__first_name__icontains=q) |
                    Q(student__last_name__icontains=q) |
                    Q(student__parent__name__icontains=q) |
                    Q(student__parent__name_latin__icontains=q) |
                    Q(academic_year__icontains=q) |
                    Q(notes__icontains=q)
                )

            if request.GET.get('type') in ('csv', 'xlsx'):
                headers = ['Date', 'Student', 'Parent', 'Phone', 'Amount', 'Academic Year', 'Notes']
                rows = []
                for ins in queryset.order_by('-paid_at'):
                    st = ins.student
                    p = st.parent if st else None
                    rows.append([
                        ins.paid_at.isoformat() if ins.paid_at else '',
                        f"{st.first_name} {st.last_name}" if st else '',
                        (p.name or p.name_latin) if p else '',
                        p.phone if p else '',
                        float(ins.amount),
                        ins.academic_year or '',
                        ins.notes or '',
                    ])
                return export_rows(headers, rows, 'insurances', request.GET.get('type'))

            agg = queryset.aggregate(total_amount=Sum('amount'), total_count=Count('id'))
            total_amount = round(float(agg['total_amount'] or 0), 2)
            total_count = agg['total_count'] or 0
            queryset = queryset.order_by('-paid_at', '-created_at')[:1000]
            serializer = self.get_serializer(queryset, many=True)
            return Response({
                'items': serializer.data,
                'total_count': total_count,
                'total_amount': total_amount,
            })
        except (APIException, Http404):
            raise
        except Exception as e:
            logger.error("StudentInsuranceViewSet.list failed: %s", traceback.format_exc())
            return Response({'error': 'Could not load insurances.', 'items': [], 'total_count': 0, 'total_amount': 0}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except (APIException, Http404):
            raise
        except Exception as e:
            logger.error("StudentInsuranceViewSet.create failed: %s", traceback.format_exc())
            return Response({'error': 'Could not save the insurance record.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset()).select_related('student', 'student__parent')
        queryset = filter_by_date_range(queryset, request, 'paid_at')
        student_id = request.GET.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)
        q = request.GET.get('q', '').strip()
        if q:
            queryset = queryset.filter(
                Q(student__first_name__icontains=q) |
                Q(student__last_name__icontains=q) |
                Q(student__parent__name__icontains=q) |
                Q(student__parent__name_latin__icontains=q) |
                Q(academic_year__icontains=q) |
                Q(notes__icontains=q)
            )
        headers = ['Date', 'Student', 'Parent', 'Phone', 'Amount', 'Academic Year', 'Notes']
        rows = []
        for ins in queryset.order_by('-paid_at'):
            st = ins.student
            p = st.parent if st else None
            rows.append([
                ins.paid_at.isoformat() if ins.paid_at else '',
                f"{st.first_name} {st.last_name}" if st else '',
                (p.name or p.name_latin) if p else '',
                p.phone if p else '',
                float(ins.amount),
                ins.academic_year or '',
                ins.notes or '',
            ])
        return export_rows(headers, rows, 'insurances', request.GET.get('type'))

    def perform_create(self, serializer):
        user = self.request.user
        student = serializer.validated_data.get('student')
        tenant_id = getattr(user, 'tenant_id', None) or getattr(student, 'tenant_id', None)
        if not tenant_id:
            raise PermissionDenied('No tenant found for this record.')
        if getattr(user, 'tenant_id', None) and not user.is_super_admin():
            if getattr(user.tenant, 'status', None) != 'active':
                raise PermissionDenied(_inactive_tenant_message(user.tenant))
        insurance = serializer.save(tenant_id=tenant_id, created_by=user if user.is_authenticated else None)
        try:
            self._log_model_action('create', insurance)
        except Exception:
            pass
        if insurance.student:
            try:
                if insurance.student.insurance_status != 'insured':
                    insurance.student.insurance_status = 'insured'
                    insurance.student.save(update_fields=['insurance_status', 'updated_at'])
            except Exception:
                pass

    def perform_update(self, serializer):
        user = self.request.user
        original_tenant_id = getattr(serializer.instance, 'tenant_id', None)
        tenant_id = original_tenant_id or getattr(user, 'tenant_id', None)
        insurance = serializer.save(tenant_id=tenant_id)
        try:
            self._log_model_action('update', insurance)
        except Exception:
            pass
        if insurance.student:
            try:
                if insurance.student.insurance_status != 'insured':
                    insurance.student.insurance_status = 'insured'
                    insurance.student.save(update_fields=['insurance_status', 'updated_at'])
            except Exception:
                pass

    def perform_destroy(self, instance):
        student = instance.student
        try:
            self._log_model_action('delete', instance)
        except Exception:
            pass
        instance.delete()
        if student:
            try:
                if not student.insurances.exists():
                    student.insurance_status = 'uninsured'
                    student.save(update_fields=['insurance_status', 'updated_at'])
            except Exception:
                pass
