"""Student billing, invoices, balances and debts."""
import os
import base64
import mimetypes
from datetime import datetime, timedelta
from decimal import Decimal
from django.conf import settings
from django.db import transaction
from django.db.models import Q, Sum, F, Count, Prefetch
from django.http import Http404, HttpResponse
from django.template.loader import render_to_string
from django.utils import timezone
from weasyprint import HTML
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound, APIException
from ..models import (
    Tenant,
    Guardian,
    Student,
    Course,
    Group,
    ClassSession,
    Attendance,
    Payment,
    PaymentItem,
    BookCopy,
    DebtWaiver,
)
from ..serializers import PaymentSerializer, PaymentItemSerializer
from ..services import log_activity
from .common import (
    ATTENDED_STATUSES,
    INVOICE_CURRENCY_AR,
    INVOICE_KIND_AR,
    INVOICE_METHOD_AR,
    INVOICE_STATUS_AR,
    TenantScopedViewSet,
    _inactive_tenant_message,
    _next_sequence_code,
    course_per_session_price,
    logger,
    name_search_q,
    require_staff_tenant,
)


STAMP_COLORS = {
    'paid': '#2F6B4F',
    'partial': '#3E7CB1',
    'pending': '#A8762C',
    'pardoned': '#5E35B1',
    'pardonned': '#5E35B1',
    'overdue': '#B23A2E',
    'refunded': '#8A8478',
    'cancelled': '#8A8478',
}


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payment_invoice_pdf(request, payment_id):
    """Renders the approved invoice template (see api/templates/invoice.html)
    for a single payment. Reachable by staff of that tenant, the payment's
    own guardian, or a super admin — deliberately not a PaymentViewSet action
    since TenantScopedViewSet blocks role='parent' outright."""
    try:
        user = request.user
        payment = Payment.objects.select_related('student', 'student__parent', 'tenant').prefetch_related(
            Prefetch('items', queryset=PaymentItem.objects.select_related('course', 'group', 'trip', 'book', 'book_copy'))
        ).filter(id=payment_id).first()
        if not payment:
            raise NotFound('Payment not found')

        if user.is_super_admin():
            pass
        elif user.role == 'parent':
            guardian = Guardian.objects.filter(user_id=user.id, tenant_id=user.tenant_id).first()
            if not guardian or payment.tenant_id != user.tenant_id or (payment.student and payment.student.parent_id != guardian.id):
                raise NotFound('Payment not found')
        else:
            if not user.tenant_id or payment.tenant_id != user.tenant_id:
                raise NotFound('Payment not found')

        tenant = payment.tenant
        student = payment.student

        logo_data_uri = None
        if tenant and tenant.logo_url:
            try:
                filename = tenant.logo_url.rsplit('/', 1)[-1]
                logo_path = os.path.join(settings.MEDIA_ROOT, 'logos', filename)
                with open(logo_path, 'rb') as f:
                    raw = f.read()
                mime = mimetypes.guess_type(filename)[0] or 'image/png'
                logo_data_uri = f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"
            except OSError:
                logo_data_uri = None

        today = timezone.now().date()
        # 'partial' now means real money was received for exactly this receipt
        # (see compute_student_balances) — it's no longer "this bill itself is
        # unpaid," so it's excluded from the overdue check and gets its own
        # label/stamp instead of being lumped in with 'pending'.
        is_overdue = payment.status == 'pending' and payment.due_date and payment.due_date < today
        stamp_key = 'overdue' if is_overdue else payment.status
        stamp_color = STAMP_COLORS.get(stamp_key, '#8A8478')

        # Invoices are handed to Algerian parents, so the status reads in Arabic.
        if payment.status == 'paid':
            status_label = INVOICE_STATUS_AR.get('paid', 'مدفوع')
            status_line = f"{status_label} — {payment.paid_at.strftime('%d/%m/%Y')}" if payment.paid_at else status_label
        elif payment.status == 'partial':
            status_label = INVOICE_STATUS_AR.get('partial', 'جزئي')
            status_line = f"{status_label} — {payment.paid_at.strftime('%d/%m/%Y')}" if payment.paid_at else status_label
        elif payment.status in ('pardoned', 'pardonned'):
            p_type = getattr(payment, 'pardon_type', None) or 'both'
            if p_type == 'school':
                status_label = 'معفى من المؤسسة'
            elif p_type == 'teacher':
                status_label = 'معفى من الأستاذ'
            else:
                status_label = INVOICE_STATUS_AR.get('pardoned', 'معفى')
            status_line = f"{status_label} — {payment.paid_at.strftime('%d/%m/%Y')}" if payment.paid_at else status_label
        elif is_overdue:
            status_label = INVOICE_STATUS_AR.get('overdue', 'متأخر')
            status_line = f"{status_label} — {payment.due_date.strftime('%d/%m/%Y')}" if payment.due_date else status_label
        elif payment.status == 'pending':
            status_label = INVOICE_STATUS_AR.get('pending', 'معلق')
            status_line = f"{INVOICE_STATUS_AR.get('due_on', 'مستحق في')} {payment.due_date.strftime('%d/%m/%Y')}" if payment.due_date else status_label
        else:
            status_label = INVOICE_STATUS_AR.get(payment.status, payment.get_status_display() if hasattr(payment, 'get_status_display') else str(payment.status))
            status_line = status_label

        lines = []
        paid_sum = 0.0
        pending_sum = 0.0
        for item in payment.items.all():
            item_discount = _payment_item_discount(item)
            item_net = max(0.0, float(item.amount or 0) - item_discount)
            item_st = getattr(item, 'status', None) or ('paid' if payment.status in ('paid', 'partial', 'pardoned') else payment.status)
            if item_st in ('paid', 'partial') or (item_st in ('pardoned', 'pardonned') and payment.paid_at):
                paid_sum += item_net
            elif item_st == 'pending':
                pending_sum += item_net

            kind_label_ar = INVOICE_KIND_AR.get(item.kind, item.get_kind_display() if hasattr(item, 'get_kind_display') else str(item.kind))
            sub_parts = []
            if item.group:
                sub_parts.append(item.group.name)
            if item.trip:
                sub_parts.append(item.trip.destination)
            if item.book_copy:
                sub_parts.append(item.book_copy.copy_code)
            # Only add the kind label when it isn't already the line's title
            # (that happens when there's no linked course/trip/book — kind is
            # the title itself then).
            if item.course or item.trip or item.book:
                sub_parts.append(kind_label_ar)
            if item_st == 'pending' and item.due_date:
                due_str = item.due_date.strftime('%d/%m/%Y') if hasattr(item.due_date, 'strftime') else str(item.due_date)
                sub_parts.append(f"{INVOICE_STATUS_AR.get('due_on', 'مستحق في')} {due_str}")

            line_status_label = INVOICE_STATUS_AR.get(item_st, item_st)
            it_pt = getattr(item, 'pardon_type', None) or getattr(payment, 'pardon_type', None)
            if item_st in ('pardoned', 'pardonned'):
                if it_pt == 'school':
                    line_status_label = 'معفى من المؤسسة'
                elif it_pt == 'teacher':
                    line_status_label = 'معفى من الأستاذ'
                else:
                    line_status_label = 'معفى'
            elif item_st == 'pending' and it_pt in ('school', 'teacher'):
                if it_pt == 'school':
                    line_status_label = 'معفى من المؤسسة (معلق)'
                elif it_pt == 'teacher':
                    line_status_label = 'معفى من الأستاذ (معلق)'

            lines.append({
                'title': item.trip.title if item.trip else (item.course.title if item.course else (item.book.title if item.book else kind_label_ar)),
                'sub': ' · '.join(sub_parts),
                'amount': f"{float(item.amount or 0):,.2f}",
                'status': item_st,
                'status_label': line_status_label,
            })

        subtotal = float(payment.amount or 0)
        discount = float(payment.discount or 0)
        reduction_amt = float(getattr(payment, 'reduction', 0) or 0)
        total = max(0.0, subtotal - discount)
        currency_code = (tenant.currency if tenant else None) or 'DZD'
        is_partial = payment.status == 'partial' or (paid_sum > 0 and pending_sum > 0)

        # Handed to Algerian parents, so the whole document — not just the
        # status — reads in Arabic: numeric dates (no English month names),
        # Arabic kind/method/currency wording, RTL template.
        context = {
            'primary_color': (tenant.primary_color if tenant else None) or '#0A0A0B',
            'accent_color': (tenant.accent_color if tenant else None) or '#E53935',
            'overdue_color': '#B23A2E',
            'stamp_color': stamp_color,
            'status_label': status_label,
            'status_line': status_line,
            'tenant_name': tenant.name if tenant else 'Scolaris',
            'tenant_initial': (tenant.name or 'S')[0].upper() if tenant else 'S',
            'tenant_currency': None,
            'logo_data_uri': logo_data_uri,
            'invoice_number': payment.invoice_number or payment.id,
            'issued_date': payment.created_at.strftime('%d/%m/%Y') if payment.created_at else '',
            'student_name': f"{student.first_name} {student.last_name}" if student else "—",
            'guardian_name': (student.parent.name if student.parent else None) if student else None,
            'method_label': INVOICE_METHOD_AR.get(payment.method, payment.get_method_display() if hasattr(payment, 'get_method_display') else str(payment.method)),
            'due_date': payment.due_date.strftime('%d/%m/%Y') if (payment.due_date and payment.status != 'paid') else None,
            'student_code': student.student_code if student else None,
            'lines': lines,
            'subtotal': f"{subtotal:,.2f}",
            'discount': f"{discount:,.2f}",
            'reduction': f"{reduction_amt:,.2f}" if reduction_amt > 0 else None,
            'reduction_target': getattr(payment, 'reduction_target', None),
            'total': f"{total:,.2f}",
            'is_partial': is_partial,
            'paid_amount': f"{paid_sum:,.2f}",
            'pending_amount': f"{pending_sum:,.2f}",
            'currency': INVOICE_CURRENCY_AR.get(currency_code, currency_code),
        }

        html_string = render_to_string('invoice.html', context)
        pdf_bytes = HTML(string=html_string).write_pdf()

        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="{payment.invoice_number or payment.id}.pdf"'
        return response
    except (APIException, Http404):
        raise
    except Exception as e:
        logger.exception("Failed to generate payment invoice PDF: %s", e)
        return Response({'detail': 'Invoice generation failed. Please try again or contact support.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _payment_item_discount(item_payload):
    """How much of one item's own amount is waived.
    - For regular split items: amount * (1 - (teacher_pct + school_pct)/100).
    - For pardoned items (status='pardoned' or pardon_type in ('both', 'school', 'teacher')):
        * pardon_type='both' (or unset): fully waived (discount = amount, pays 0 DZD).
        * pardon_type='school': school part waived (discount = amount * school_pct/100, student pays teacher_pct).
        * pardon_type='teacher': teacher part waived (discount = amount * teacher_pct/100, student pays school_pct).
    - Also adds any item-level reduction (capped at item amount).
    """
    try:
        if isinstance(item_payload, dict):
            amount = float(item_payload.get('amount') or 0)
            teacher_pct = item_payload.get('teacher_percentage')
            school_pct = item_payload.get('school_percentage')
            status = item_payload.get('status')
            pardon_type = item_payload.get('pardon_type') or item_payload.get('payment__pardon_type')
            payment_status = item_payload.get('payment__status')
            reduction = float(item_payload.get('reduction') or 0)
        else:
            amount = float(getattr(item_payload, 'amount', 0) or 0)
            teacher_pct = getattr(item_payload, 'teacher_percentage', None)
            school_pct = getattr(item_payload, 'school_percentage', None)
            status = getattr(item_payload, 'status', None)
            pardon_type = getattr(item_payload, 'pardon_type', None) or getattr(getattr(item_payload, 'payment', None), 'pardon_type', None)
            payment_status = getattr(getattr(item_payload, 'payment', None), 'status', None)
            reduction = float(getattr(item_payload, 'reduction', 0) or 0)

        base_discount = 0.0
        if status in ('pardoned', 'pardonned') or (pardon_type in ('both', 'school', 'teacher') and pardon_type) or payment_status in ('pardoned', 'pardonned'):
            p_type = pardon_type or 'both'
            if p_type == 'both':
                base_discount = amount
            else:
                t_pct = float(teacher_pct or 0)
                s_pct = float(school_pct or 0)
                if t_pct <= 0 and s_pct <= 0:
                    t_pct = 50.0
                    s_pct = 50.0
                elif t_pct <= 0:
                    t_pct = max(0.0, 100.0 - s_pct)
                elif s_pct <= 0:
                    s_pct = max(0.0, 100.0 - t_pct)

                if p_type == 'school':
                    base_discount = max(0.0, round(amount * (s_pct / 100.0), 2))
                elif p_type == 'teacher':
                    base_discount = max(0.0, round(amount * (t_pct / 100.0), 2))
                else:
                    base_discount = amount
        elif teacher_pct is not None and school_pct is not None:
            t_pct = float(teacher_pct)
            s_pct = float(school_pct)
            base_discount = max(0.0, amount * (1 - (t_pct + s_pct) / 100))

        return min(amount, round(base_discount + max(0.0, reduction), 2))
    except (TypeError, ValueError, AttributeError):
        return 0.0


class PaymentViewSet(TenantScopedViewSet):
    queryset = Payment.objects.all()
    serializer_class = PaymentSerializer
    module_key = 'payments'

    def get_queryset(self):
        # PaymentSerializer.items iterates payment.items.all() per row —
        # without this, a 500-row payments list fires a query per row just
        # to list each bill's line items. select_related('student') ensures
        # student details are loaded in a single join.
        return super().get_queryset().select_related('student').prefetch_related(
            Prefetch('items', queryset=PaymentItem.objects.select_related('course', 'trip', 'book', 'book_copy', 'group'))
        )

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        student_id = request.GET.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)
        status_val = request.GET.get('status')
        if status_val:
            queryset = queryset.filter(Q(status=status_val) | Q(items__status=status_val)).distinct()
        q = request.GET.get('q')
        if q:
            q = q.strip()
            # Invoice reference / number / notes / phone / code search
            bill_q = (
                Q(invoice_number__icontains=q)
                | Q(reference__icontains=q)
                | Q(notes__icontains=q)
                | Q(student__student_code__icontains=q)
                | Q(student__phone__icontains=q)
                | Q(student__parent__phone__icontains=q)
            )
            # Full student name search across first/last names (both Arabic and Latin)
            student_name_q = name_search_q(
                q,
                'student__first_name',
                'student__last_name',
                'student__first_name_latin',
                'student__last_name_latin',
            )
            # Course / trip / book title search
            item_q = (
                Q(items__course__title__icontains=q)
                | Q(items__trip__title__icontains=q)
                | Q(items__book__title__icontains=q)
            )
            queryset = queryset.filter(bill_q | student_name_q | item_q).distinct()
        balance_status = request.GET.get('balance_status')
        if balance_status in ('owes', 'overpaid', 'settled'):
            balances = compute_student_balances(request.user.tenant_id)
            matching_ids = [sid for sid, b in balances.items() if b['status'] == balance_status]
            queryset = queryset.filter(student_id__in=matching_ids)

        # Date filtering: period=day|week|month or from/to
        period = request.GET.get('period')
        date_from = request.GET.get('from')
        date_to = request.GET.get('to')

        today = timezone.localdate() if hasattr(timezone, 'localdate') else timezone.now().date()
        if period == 'day':
            date_from = today.isoformat()
            date_to = today.isoformat()
        elif period == 'week':
            start_week = today - timedelta(days=today.weekday())
            end_week = start_week + timedelta(days=6)
            date_from = start_week.isoformat()
            date_to = end_week.isoformat()
        elif period == 'month':
            start_month = today.replace(day=1)
            import calendar
            _, last_day = calendar.monthrange(today.year, today.month)
            end_month = today.replace(day=last_day)
            date_from = start_month.isoformat()
            date_to = end_month.isoformat()

        if date_from:
            queryset = queryset.filter(
                Q(paid_at__date__gte=date_from) |
                Q(paid_at__isnull=True, due_date__gte=date_from) |
                Q(paid_at__isnull=True, due_date__isnull=True, created_at__date__gte=date_from)
            )
        if date_to:
            queryset = queryset.filter(
                Q(paid_at__date__lte=date_to) |
                Q(paid_at__isnull=True, due_date__lte=date_to) |
                Q(paid_at__isnull=True, due_date__isnull=True, created_at__date__lte=date_to)
            )

        queryset = queryset.order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        """A bill is one or more line items (course/trip/book, each with its
        own amount) under one student/status/discount/method — see
        PaymentItem's docstring. Items are validated and created one at a
        time inside the same atomic block as the bill itself, so an
        out-of-stock book anywhere in the list rolls back the whole bill
        rather than leaving a partial invoice behind."""
        try:
            self.check_module_add()
            user = request.user
            tenant_id = getattr(user, 'tenant_id', None)
            if not tenant_id and getattr(user, 'is_super_admin', lambda: False)():
                student_id = request.data.get('student_id')
                if student_id:
                    stu = Student.objects.filter(id=student_id).first()
                    if stu:
                        tenant_id = stu.tenant_id
            tenant = Tenant.objects.filter(id=tenant_id).first() if tenant_id else None
            if not tenant:
                raise ValidationError('Tenant not found')

            items_payload = request.data.get('items')
            if not isinstance(items_payload, list) or not items_payload:
                raise ValidationError({'items': 'At least one item is required.'})

            bill_data = {k: v for k, v in request.data.items() if k != 'items'}

            # Determine statuses across items
            item_statuses = []
            for item in items_payload:
                raw_st = item.get('status') or bill_data.get('status', 'paid')
                if raw_st == 'pardonned':
                    raw_st = 'pardoned'
                if raw_st not in ('paid', 'pending', 'partial', 'pardoned', 'refunded', 'cancelled'):
                    raw_st = 'paid'
                item['status'] = raw_st
                item_statuses.append(raw_st)

            distinct_statuses = set(item_statuses)
            if len(distinct_statuses) == 1:
                status_val = list(distinct_statuses)[0]
            elif 'pending' in distinct_statuses and ('paid' in distinct_statuses or 'partial' in distinct_statuses or 'pardoned' in distinct_statuses):
                status_val = 'partial'
            elif 'partial' in distinct_statuses or ('paid' in distinct_statuses and 'pardoned' in distinct_statuses):
                status_val = 'partial'
            else:
                status_val = bill_data.get('status', 'paid')
                if status_val == 'pardonned':
                    status_val = 'pardoned'
                if status_val not in ('paid', 'pending', 'partial', 'pardoned', 'refunded', 'cancelled'):
                    status_val = 'paid'

            bill_data['status'] = status_val
            bill_pardon = bill_data.get('pardon_type') or next((it.get('pardon_type') for it in items_payload if it.get('pardon_type')), None)
            if status_val == 'pardoned':
                bill_data['pardon_type'] = bill_pardon or 'both'
            else:
                bill_data['pardon_type'] = bill_pardon

            try:
                bill_data['amount'] = sum(float(item.get('amount') or 0) for item in items_payload)
            except (TypeError, AttributeError, ValueError):
                raise ValidationError({'items': 'Each item needs a numeric amount.'})

            try:
                bill_reduction = max(0.0, float(bill_data.get('reduction') or 0))
            except (ValueError, TypeError):
                bill_reduction = 0.0
            bill_data['reduction'] = round(bill_reduction, 2)
            bill_target = bill_data.get('reduction_target') or 'total'
            if bill_target not in ('total', 'school', 'teacher'):
                bill_target = 'total'
            bill_data['reduction_target'] = bill_target

            items_discount = sum(_payment_item_discount(item) for item in items_payload)
            items_have_reduction = any(float(it.get('reduction') or 0) > 0 for it in items_payload)
            if not items_have_reduction and bill_reduction > 0:
                bill_data['discount'] = round(min(bill_data['amount'], items_discount + bill_reduction), 2)
            else:
                bill_data['discount'] = round(min(bill_data['amount'], items_discount), 2)

            if status_val == 'pending' or ('pending' in distinct_statuses and 'paid' not in distinct_statuses):
                bill_data['paid_at'] = None
            elif status_val in ('paid', 'partial') or ('paid' in distinct_statuses and status_val != 'pending'):
                if not bill_data.get('paid_at'):
                    bill_data['paid_at'] = timezone.now().isoformat()
            elif status_val == 'pardoned' and 'pending' not in distinct_statuses:
                if not bill_data.get('paid_at'):
                    bill_data['paid_at'] = timezone.now().isoformat()

            if 'pending' in distinct_statuses and not bill_data.get('due_date'):
                item_due = next((it.get('due_date') for it in items_payload if it.get('status') == 'pending' and it.get('due_date')), None)
                if item_due:
                    bill_data['due_date'] = item_due

            if not bill_data.get('due_date'):
                bill_data['due_date'] = None
            if not bill_data.get('paid_at') or status_val == 'pending':
                bill_data['paid_at'] = None
            for fk in ('course_id', 'group_id', 'trip_id', 'book_id'):
                if fk in bill_data and not bill_data[fk]:
                    bill_data[fk] = None
            if not bill_data.get('student_id'):
                raise ValidationError({'student_id': 'يرجى اختيار تلميذ أولاً.'})

            serializer = self.get_serializer(data=bill_data)
            serializer.is_valid(raise_exception=True)

            with transaction.atomic():
                if user.tenant_id and not user.is_super_admin() and user.tenant.status != 'active':
                    raise PermissionDenied(_inactive_tenant_message(user.tenant))
                Tenant.objects.select_for_update().get(id=tenant.id)
                invoice_number = _next_sequence_code(tenant.id, Payment, 'invoice_number', tenant.invoice_prefix or 'INV-', 6)
                payment = serializer.save(tenant_id=tenant.id, amount=bill_data['amount'], invoice_number=invoice_number)
                self._log_model_action('create', payment)
                self._create_items(payment, items_payload, user)

            return Response(self.get_serializer(payment).data, status=status.HTTP_200_OK)
        except (APIException, Http404):
            raise
        except Exception as e:
            logger.exception("Failed to create payment: %s", e)
            return Response({'detail': 'Payment creation failed. Please try again or contact support.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def _create_items(self, payment, items_payload, user):
        """Validates and saves each line item onto `payment` — shared by
        create() and by update() when a caller replaces a bill's items to
        correct one that was billed under an earlier (buggy) price/discount
        rule. Callers are responsible for the item's own validation
        (PaymentItemSerializer) and stock allocation happening together,
        atomically, with whatever cleanup they need on the items being
        replaced (see update())."""
        rem_reduction = float(payment.reduction or 0)
        total_amt = float(payment.amount or 0)
        items_have_reduction = any(float(it.get('reduction') or 0) > 0 for it in items_payload)

        for i, item_payload in enumerate(items_payload):
            clean_item_payload = {k: v for k, v in item_payload.items() if k not in ('id', 'item_type')}
            clean_item_status = clean_item_payload.get('status')
            if clean_item_status == 'pardonned':
                clean_item_status = 'pardoned'
            if not clean_item_status:
                clean_item_status = 'paid' if payment.status in ('paid', 'partial', 'pardoned') else payment.status
            clean_item_payload['status'] = clean_item_status

            if clean_item_status == 'pardoned':
                clean_item_payload['pardon_type'] = clean_item_payload.get('pardon_type') or payment.pardon_type or 'both'
            elif clean_item_payload.get('pardon_type'):
                clean_item_payload['pardon_type'] = clean_item_payload.get('pardon_type')
            elif payment.pardon_type:
                clean_item_payload['pardon_type'] = payment.pardon_type
            else:
                clean_item_payload['pardon_type'] = None

            if not items_have_reduction and rem_reduction > 0:
                item_amt = float(clean_item_payload.get('amount') or 0)
                if i == len(items_payload) - 1:
                    item_share = round(rem_reduction, 2)
                else:
                    item_share = round(rem_reduction * (item_amt / total_amt), 2) if total_amt > 0 else 0.0
                    rem_reduction = max(0.0, rem_reduction - item_share)
                clean_item_payload['reduction'] = item_share
                clean_item_payload['reduction_target'] = payment.reduction_target or 'total'
            else:
                if 'reduction' in clean_item_payload:
                    try:
                        clean_item_payload['reduction'] = round(max(0.0, float(clean_item_payload['reduction'] or 0)), 2)
                    except (ValueError, TypeError):
                        clean_item_payload['reduction'] = 0.0
                if 'reduction_target' in clean_item_payload and clean_item_payload['reduction_target'] not in ('total', 'school', 'teacher'):
                    clean_item_payload['reduction_target'] = 'total'

            if not clean_item_payload.get('due_date'):
                clean_item_payload['due_date'] = None
            for fk in ('course_id', 'group_id', 'trip_id', 'book_id'):
                if fk in clean_item_payload and not clean_item_payload[fk]:
                    clean_item_payload[fk] = None

            # Only course items may have teacher or school percentage
            if not clean_item_payload.get('course_id'):
                clean_item_payload['teacher_percentage'] = None
                clean_item_payload['school_percentage'] = None
            else:
                for pct_f in ('teacher_percentage', 'school_percentage'):
                    if pct_f in clean_item_payload:
                        v = clean_item_payload[pct_f]
                        if v == '' or v is None:
                            clean_item_payload[pct_f] = None
                        else:
                            try:
                                clean_item_payload[pct_f] = round(float(v), 2)
                            except (ValueError, TypeError):
                                clean_item_payload[pct_f] = None

                # Automatically resolve or default percentages when missing
                if clean_item_payload.get('teacher_percentage') is None:
                    gid = clean_item_payload.get('group_id')
                    resolved_tp = None
                    if gid:
                        grp = Group.objects.filter(id=gid, tenant_id=payment.tenant_id).select_related('teacher').first()
                        if grp and grp.teacher and grp.teacher.payment_percentage:
                            resolved_tp = float(grp.teacher.payment_percentage)
                    if resolved_tp is None and clean_item_payload.get('course_id'):
                        cand_teachers = list(Group.objects.filter(course_id=clean_item_payload['course_id'], tenant_id=payment.tenant_id, teacher__isnull=False).values_list('teacher__payment_percentage', flat=True))
                        if cand_teachers and all(tp == cand_teachers[0] for tp in cand_teachers) and cand_teachers[0]:
                            resolved_tp = float(cand_teachers[0])
                    if resolved_tp is None and clean_item_payload.get('pardon_type') in ('school', 'teacher'):
                        resolved_tp = 50.0
                    if resolved_tp is not None:
                        clean_item_payload['teacher_percentage'] = resolved_tp
                        if clean_item_payload.get('school_percentage') is None:
                            clean_item_payload['school_percentage'] = round(max(0.0, 100.0 - resolved_tp), 2)

                if clean_item_payload.get('teacher_percentage') is not None and clean_item_payload.get('school_percentage') is None:
                    clean_item_payload['school_percentage'] = round(max(0.0, 100.0 - float(clean_item_payload['teacher_percentage'])), 2)
                elif clean_item_payload.get('school_percentage') is not None and clean_item_payload.get('teacher_percentage') is None:
                    clean_item_payload['teacher_percentage'] = round(max(0.0, 100.0 - float(clean_item_payload['school_percentage'])), 2)

            item_serializer = PaymentItemSerializer(data=clean_item_payload, context=self.get_serializer_context())
            item_serializer.is_valid(raise_exception=True)
            item = item_serializer.save(payment=payment)

            # Auto-enroll student into group if not already enrolled
            if item.group and payment.student:
                item.group.students.add(payment.student)

            # A book item doesn't let the caller pick which physical
            # copy goes out — lock and grab the next available one
            # atomically so two simultaneous sales of the last copy
            # can't both succeed.
            if item.book_id:
                copy = (
                    BookCopy.objects.select_for_update()
                    .filter(tenant_id=payment.tenant_id, book_id=item.book_id, status='in_stock')
                    .order_by('copy_code')
                    .first()
                )
                if not copy:
                    raise ValidationError({'items': f'"{item.book.title}" is out of stock.'})
                copy.status = 'sold'
                copy.sold_by = user
                copy.sold_at = timezone.now()
                copy.save(update_fields=['status', 'sold_by', 'sold_at'])
                item.book_copy = copy
                item.save(update_fields=['book_copy'])

    def _restore_book_copies(self, payment):
        """Undoes the stock decrement from create() for every book item on
        this bill — called when the sale is cancelled/refunded/deleted, so
        each physical copy becomes available to sell again instead of
        permanently vanishing from inventory counts. Keeps each item's
        book_copy pointed at the copy (for the invoice's own history) and
        only flips the copy's own status."""
        for copy in BookCopy.objects.filter(sale_items__payment=payment, status='sold'):
            copy.status = 'in_stock'
            copy.sold_by = None
            copy.sold_at = None
            copy.save(update_fields=['status', 'sold_by', 'sold_at'])

    def update(self, request, *args, **kwargs):
        """Bill-level fields (status/method/due_date/notes) are always
        editable. When the payload also includes `items`, this bill's whole
        line-item list is replaced — same per-item validation and stock
        allocation create() uses — and amount/discount are recomputed from
        the new items server-side, same as create(). That's what lets a
        bill that was billed under an earlier (buggy) price/percentage rule
        get corrected in place rather than cancelled and re-billed."""
        try:
            self.check_module_modify()
            partial = kwargs.get('partial', False)
            instance = self.get_object()
            previous_status = instance.status
            user = request.user

            data = request.data.copy()
            items_payload = data.get('items')
            replace_items = isinstance(items_payload, list) and len(items_payload) > 0

            # Reactivating a cancelled/refunded bill (paid/partial/pending again)
            # without an explicit items payload used to leave its book items'
            # `book_copy` pointing at whatever copy they held before — which
            # _restore_book_copies had already freed back to in_stock when the
            # bill was voided. Re-run allocation so they grab a fresh copy
            # if one's available, instead of an inconsistent state where
            # the invoice claims a copy that's actually on the shelf.
            if (
                not replace_items
                and previous_status in ('cancelled', 'refunded')
                and data.get('status') in ('paid', 'partial', 'pending', 'pardoned', 'pardonned')
                and instance.items.filter(book_id__isnull=False).exists()
            ):
                items_payload = [{
                    'kind': item.kind,
                    'amount': item.amount,
                    'course_id': item.course_id,
                    'group_id': item.group_id,
                    'trip_id': item.trip_id,
                    'book_id': item.book_id,
                    'teacher_percentage': item.teacher_percentage,
                    'school_percentage': item.school_percentage,
                    'reduction': item.reduction,
                    'reduction_target': item.reduction_target,
                    'status': item.status,
                    'pardon_type': item.pardon_type,
                    'due_date': item.due_date,
                } for item in instance.items.all()]
                if not items_payload:
                    raise ValidationError({'items': 'This bill has no items to reactivate.'})
                data['items'] = items_payload
                replace_items = True

            save_kwargs = {}
            if replace_items:
                try:
                    save_kwargs['amount'] = sum(float(item.get('amount') or 0) for item in items_payload)
                except (TypeError, AttributeError, ValueError):
                    raise ValidationError({'items': 'Each item needs a numeric amount.'})

                try:
                    bill_reduction = max(0.0, float(data.get('reduction') or instance.reduction or 0))
                except (ValueError, TypeError):
                    bill_reduction = 0.0
                data['reduction'] = round(bill_reduction, 2)
                bill_target = data.get('reduction_target') or instance.reduction_target or 'total'
                if bill_target not in ('total', 'school', 'teacher'):
                    bill_target = 'total'
                data['reduction_target'] = bill_target

                items_discount = sum(_payment_item_discount(item) for item in items_payload)
                items_have_reduction = any(float(it.get('reduction') or 0) > 0 for it in items_payload)
                if not items_have_reduction and bill_reduction > 0:
                    data['discount'] = round(min(save_kwargs['amount'], items_discount + bill_reduction), 2)
                else:
                    data['discount'] = round(min(save_kwargs['amount'], items_discount), 2)

                item_statuses = {('pardoned' if it.get('status') == 'pardonned' else it.get('status')) for it in items_payload if it.get('status')}
                if len(item_statuses) == 1:
                    data['status'] = list(item_statuses)[0]
                elif 'pending' in item_statuses and ('paid' in item_statuses or 'partial' in item_statuses or 'pardoned' in item_statuses):
                    data['status'] = 'partial'
                elif 'partial' in item_statuses or ('paid' in item_statuses and 'pardoned' in item_statuses):
                    data['status'] = 'partial'

                bill_pardon = data.get('pardon_type') or next((it.get('pardon_type') for it in items_payload if it.get('pardon_type')), None)
                if data.get('status') == 'pardoned':
                    data['pardon_type'] = bill_pardon or 'both'
                else:
                    data['pardon_type'] = bill_pardon

            if data.get('status') == 'pardonned':
                data['status'] = 'pardoned'

            if data.get('status') == 'pending':
                data['paid_at'] = None
            elif data.get('status') in ('paid', 'partial') and not data.get('paid_at'):
                data['paid_at'] = timezone.now().isoformat()
            elif data.get('status') == 'pardoned' and data.get('status') != 'pending' and not data.get('paid_at'):
                data['paid_at'] = timezone.now().isoformat()

            serializer = self.get_serializer(instance, data=data, partial=partial)
            serializer.is_valid(raise_exception=True)

            with transaction.atomic():
                if replace_items:
                    # Release whatever book stock the old items held before
                    # deleting them — otherwise a swapped-out book item's copy
                    # would stay marked "sold" forever with nothing pointing at it.
                    self._restore_book_copies(instance)
                    instance.items.all().delete()

                # amount is read_only on PaymentSerializer (never trusted from
                # the client), same as create() — pass it as an explicit save()
                # kwarg here instead of going through self.perform_update()'s
                # normal validated_data-only save. tenant_id is re-pinned
                # explicitly too, matching perform_update()'s own belt-and-braces
                # guard against a payload ever moving a record cross-tenant.
                original_tenant_id = instance.tenant_id
                payment = serializer.save(tenant_id=original_tenant_id, **save_kwargs) if original_tenant_id else serializer.save(**save_kwargs)
                self._log_model_action('update', payment)

                if replace_items:
                    self._create_items(payment, items_payload, user)

                new_status = payment.status
                if previous_status not in ('cancelled', 'refunded') and new_status in ('cancelled', 'refunded'):
                    self._restore_book_copies(payment)

            return Response(self.get_serializer(payment).data)
        except (APIException, Http404):
            raise
        except Exception as e:
            logger.exception("Failed to update payment: %s", e)
            return Response({'detail': 'Payment update failed. Please try again or contact support.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self.check_module_delete()
        instance = self.get_object()
        with transaction.atomic():
            if instance.status not in ('cancelled', 'refunded'):
                self._restore_book_copies(instance)
            self.perform_destroy(instance)
        return Response({'message': 'Deleted successfully'}, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payments_overdue(request):
    tid = require_staff_tenant(request.user)
    if not request.user.can_view('payments'):
        raise PermissionDenied('Forbidden')

    # 'partial' now counts as collected money (see compute_student_balances),
    # so only a still-fully-unpaid 'pending' invoice is genuinely overdue.
    items = Payment.objects.filter(
        tenant_id=tid,
        status='pending',
        due_date__lt=timezone.now().date(),
    ).prefetch_related('items').order_by('due_date')[:500]

    total_data = Payment.objects.filter(
        tenant_id=tid,
        status='pending',
        due_date__lt=timezone.now().date(),
    ).aggregate(total=Sum(F('amount') - F('discount')))

    return Response({
        'items': PaymentSerializer(items, many=True).data,
        'total': len(items),
        'total_owed': float(total_data['total'] or 0),
    })


BALANCE_THRESHOLD = 1.0  # DZD-scale rounding noise shouldn't read as owing/overpaid


def compute_student_balances(tenant_id):
    """Per-student running balance = actual cash collected from COURSE items
    only (paid/partial PaymentItem rows with a course set, net of any
    discount — see `paid` below; a book/trip item never counts here, since
    `cost` is entirely course-attendance-driven) minus the cost of
    every session they've actually used (present, or
    excused-but-not-yet-recovered attendance, priced via
    course_per_session_price), itself reduced by any teacher/school
    %-discount already billed (see `active_discount` below — a discount is
    never debt, whether or not it's been collected yet) — collection status
    is tracked by attendance, not by manually re-deriving what's "owed"
    from enrollment alone.
    Returns {student_id: {paid, cost, balance, status}}, status one of
    'owes' (they owe the school), 'overpaid' (the school owes them),
    'settled'.

    Cost is accumulated per (student, course) before being summed, because a
    'fixed_sessions' course's price is a flat total for the whole course —
    sessions_count is how many sessions that flat price covers, not a rate.
    A group that keeps running past its nominal session count (a make-up
    class, a term that overran by a week) must not silently keep inflating
    what that student owes for a course they already paid for in full, so a
    fixed_sessions course's cost is capped at its price. 'per_session' and
    'per_month' have no such cap — they're deliberately unit-rate and
    recurring, so cost is meant to keep pace with however much was actually
    attended.

    A 'fixed_sessions' course's cost is additionally floored at what's
    actually been billed for it (see the fixed_billed_items block below) -
    its price is due as a lump sum at enrollment, not earned session by
    session, so a student with a real pending/paid/partial bill for one but
    no attendance yet still owes it, rather than showing as settled.

    An 'excused' absence stops being charged once staff mark it recovered
    (Attendance.recovery_status) — the make-up session itself bills normally
    through the ordinary 'present' path, so nothing is charged twice for one
    missed lesson. recovery_status has no link to which later session is the
    actual make-up (it's a bare staff-toggled flag), so this can't be scoped
    any more precisely than "stop billing the missed slot once marked
    recovered" without a schema change."""
    attendance = Attendance.objects.filter(tenant_id=tenant_id).filter(
        Q(status__in=ATTENDED_STATUSES) | Q(status='excused', recovery_status__in=('not_applicable', 'needs_recovery'))
    )

    sessions = ClassSession.objects.filter(tenant_id=tenant_id).values('id', 'course_id', 'group__course_id')
    session_course = {}
    course_ids = set()
    for s in sessions:
        course_id = s['course_id'] or s['group__course_id']
        session_course[s['id']] = course_id
        if course_id:
            course_ids.add(course_id)

    courses = {c['id']: c for c in Course.objects.filter(tenant_id=tenant_id).values('id', 'price', 'pricing_type', 'sessions_count')}
    price_per_session = {
        cid: course_per_session_price(c['price'], c['pricing_type'], c['sessions_count'])
        for cid, c in courses.items()
    }

    cost_by_student_course = {}
    for a in attendance.values('student_id', 'session_id'):
        course_id = session_course.get(a['session_id'])
        if not course_id:
            continue
        key = (a['student_id'], course_id)
        cost_by_student_course[key] = cost_by_student_course.get(key, 0.0) + price_per_session.get(course_id, 0.0)

    # Cap attendance-derived cost at the course price for fixed_sessions
    # courses (overrun protection, see docstring above) — applied only to
    # the attendance-derived figure, before the billed floor below, so it
    # never clamps down a genuinely billed amount (see that block's comment
    # for why the two must stay separate).
    for key in list(cost_by_student_course.keys()):
        course = courses.get(key[1])
        if course and course['pricing_type'] == 'fixed_sessions':
            cost_by_student_course[key] = min(cost_by_student_course[key], float(course['price'] or 0))

    # A 'fixed_sessions' course's full price is due the moment it's billed —
    # unlike per_session/per_month, it isn't earned session-by-session — so a
    # student who hasn't attended yet but already has a real (paid/partial/
    # pending) bill for one must not show zero cost just because attendance
    # hasn't started (this used to make a real pending debt look "settled").
    # Floors the attendance-derived figure at what's actually been billed,
    # deliberately NOT re-capped at the course's current price — a bill's
    # amount is ground truth for what was actually charged (staff may bill a
    # custom amount, or the course's price may have since changed), unlike
    # the attendance-derived figure above, which has to be capped since it
    # accrues per session and could otherwise overrun. `max`, not addition,
    # keeps this a floor rather than double-counting once attendance for
    # that course does start accruing.
    #
    # Uses the item's GROSS amount, not net of its own teacher/school
    # discount — same convention as the attendance-derived figure above
    # (itself gross, priced via course_per_session_price with no discount
    # applied). The discount is forgiven exactly once, for every course
    # item regardless of pricing_type, by `active_discount` further below;
    # netting it out here too would double-subtract it (a 1500 DZD bill
    # with a 630 DZD discount floors cost at 870 here, active_discount
    # forgives another 630, and cost ends up 240 instead of the correct
    # 870).
    # Pre-fetch groups and teacher percentages for fallback resolution
    groups_dict = {
        g['id']: g for g in Group.objects.filter(tenant_id=tenant_id).values('id', 'course_id', 'teacher_id', 'teacher__payment_percentage')
    }
    course_teacher_pct = {}
    for g in groups_dict.values():
        tp = float(g.get('teacher__payment_percentage') or 0)
        cid = g.get('course_id')
        if cid and tp > 0 and cid not in course_teacher_pct:
            course_teacher_pct[cid] = tp

    fixed_billed_items = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id, course__isnull=False,
    ).filter(
        Q(payment__status__in=('paid', 'partial', 'pending', 'pardoned')) |
        Q(status__in=('paid', 'partial', 'pending', 'pardoned')) |
        Q(pardon_type__in=('school', 'teacher')) |
        Q(payment__pardon_type__in=('school', 'teacher'))
    ).exclude(
        status='cancelled'
    ).exclude(
        payment__status='cancelled'
    ).exclude(
        Q(pardon_type='both') | (Q(status__in=('pardoned', 'pardonned')) & Q(pardon_type__isnull=True) & Q(payment__pardon_type__isnull=True))
    ).values('payment__student_id', 'course_id', 'amount')
    billed_fixed = {}
    for row in fixed_billed_items:
        key = (row['payment__student_id'], row['course_id'])
        c_price = float(courses.get(row['course_id'], {}).get('price') or 0)
        item_amt = float(row['amount'] or 0) or c_price
        billed_fixed[key] = billed_fixed.get(key, 0.0) + item_amt
    for key, billed_amount in billed_fixed.items():
        cost_by_student_course[key] = max(cost_by_student_course.get(key, 0.0), billed_amount)

    cost = {}
    for (student_id, course_id), amount in cost_by_student_course.items():
        cost[student_id] = cost.get(student_id, 0.0) + amount

    paid = {}
    course_items = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id, course__isnull=False,
    ).filter(
        Q(status__in=('paid', 'partial')) |
        Q(status__in=['', None], payment__status__in=('paid', 'partial')) |
        Q(status__in=('pardoned', 'pardonned'), payment__status__in=('paid', 'partial'), payment__paid_at__isnull=False)
    ).exclude(
        status='pending'
    ).exclude(
        payment__status='pending'
    ).values(
        'payment__student_id', 'amount', 'teacher_percentage', 'school_percentage',
        'status', 'pardon_type', 'payment__pardon_type', 'reduction', 'group_id', 'course_id'
    )
    for row in course_items:
        net = float(row['amount']) - _payment_item_discount(row)
        if net > 0:
            paid[row['payment__student_id']] = paid.get(row['payment__student_id'], 0.0) + net

    # A payment that's cancelled or refunded stops counting as money
    # received (see `paid` above), but cost here comes purely from
    # attendance — independent of any specific payment — so without this,
    # voiding it would leave the student looking like they now owe back
    # whatever that payment used to cover. Writing the same amount off
    # `cost` instead means voiding it is a net no-op on the student's
    # balance rather than a new debt.
    #
    # Gated on paid_at IS NOT NULL: paid_at is only ever stamped when a
    # payment is (or becomes) 'paid'/'partial' — i.e. money was genuinely
    # collected at some point — and is never cleared afterward. Without this
    # gate, cancelling a 'pending' invoice that was never actually paid
    # would wrongly forgive real debt that was never collected in the first
    # place.
    written_off = {}
    written_off_items = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id, payment__status__in=('cancelled', 'refunded'),
        payment__paid_at__isnull=False, course__isnull=False,
    ).values('payment__student_id', 'amount')
    for row in written_off_items:
        written_off[row['payment__student_id']] = written_off.get(row['payment__student_id'], 0.0) + float(row['amount'])

    # A written-off debt (see DebtWaiver) works the same way — subtracted
    # from cost, never counted as paid, since it was never actually collected.
    waived = {}
    for w in DebtWaiver.objects.filter(tenant_id=tenant_id).values('student_id', 'amount'):
        waived[w['student_id']] = waived.get(w['student_id'], 0.0) + float(w['amount'])

    # A %-discount is the school's decision about what an item actually
    # costs, not "money not yet in hand" — so it's forgiven from `cost`
    # immediately, the moment it's billed, whether or not the bill has been
    # collected yet ('paid'/'partial'/'pending' all count the same way
    # here). Only the discount portion is credited; the rest of a bill's
    # amount is genuinely still due until it's actually collected (that's
    # what `paid` above is for).
    active_discount = {}
    active_items = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id, payment__status__in=('paid', 'partial', 'pending', 'pardoned'),
    ).exclude(status='cancelled').values(
        'payment__student_id', 'amount', 'teacher_percentage', 'school_percentage',
        'status', 'course_id', 'group_id', 'pardon_type', 'payment__pardon_type',
        'reduction', 'payment__status'
    )
    course_pardon_applied = set()
    for row in active_items:
        p_type = row.get('pardon_type') or row.get('payment__pardon_type')
        if row.get('status') in ('pardoned', 'pardonned') or p_type or row.get('payment__status') in ('pardoned', 'pardonned'):
            key = (row['payment__student_id'], row.get('course_id'))
            if key in course_pardon_applied:
                continue
            course_pardon_applied.add(key)
            course_price = float(courses.get(row['course_id'], {}).get('price') or 0) if row.get('course_id') else 0.0
            item_amt = float(row['amount'] or 0) or course_price
            gross_base = max(item_amt, cost_by_student_course.get(key, 0.0), course_price)
            if not p_type or p_type == 'both':
                pardoned_amount = gross_base
            else:
                t_pct = float(row.get('teacher_percentage') or 0)
                if t_pct <= 0:
                    gid = row.get('group_id')
                    if gid and gid in groups_dict:
                        t_pct = float(groups_dict[gid].get('teacher__payment_percentage') or 0)
                    if t_pct <= 0 and row.get('course_id') in course_teacher_pct:
                        t_pct = course_teacher_pct[row['course_id']]
                    if t_pct <= 0:
                        t_pct = 50.0

                s_pct = float(row.get('school_percentage') or 0)
                if s_pct <= 0:
                    s_pct = max(0.0, 100.0 - t_pct)

                if p_type == 'school':
                    pardoned_amount = round(gross_base * (s_pct / 100.0), 2)
                elif p_type == 'teacher':
                    pardoned_amount = round(gross_base * (t_pct / 100.0), 2)
                else:
                    pardoned_amount = gross_base

            red = float(row.get('reduction') or 0)
            discount_total = min(gross_base, round(pardoned_amount + red, 2))
            if discount_total:
                active_discount[row['payment__student_id']] = active_discount.get(row['payment__student_id'], 0.0) + discount_total
        else:
            discount = _payment_item_discount(row)
            if discount:
                active_discount[row['payment__student_id']] = active_discount.get(row['payment__student_id'], 0.0) + discount

    balances = {}
    candidate_students = set(cost) | set(paid) | set(active_discount) | {row['payment__student_id'] for row in active_items}
    for student_id in candidate_students:
        paid_amount = round(paid.get(student_id, 0.0), 2)
        cost_amount = round(max(0.0, (
            cost.get(student_id, 0.0)
            - written_off.get(student_id, 0.0)
            - waived.get(student_id, 0.0)
            - active_discount.get(student_id, 0.0)
        )), 2)
        balance = round(paid_amount - cost_amount, 2)
        if balance > BALANCE_THRESHOLD:
            balance_status = 'overpaid'
        elif balance < -BALANCE_THRESHOLD:
            balance_status = 'owes'
        else:
            balance_status = 'settled'
        balances[student_id] = {'paid': paid_amount, 'cost': cost_amount, 'balance': balance, 'status': balance_status}
    return balances


def compute_course_payment_status(tenant_id, course_id, student_ids=None):
    """Whether each student has paid enough for `course_id` to cover the
    present (or excused-but-not-yet-recovered) sessions they've actually
    attended in it — same session-based cost model as
    compute_student_balances (including the recovered-excused-absence
    exclusion, see its docstring), but scoped to one course and counting
    only the portion of a bill that's actually for that course (via
    PaymentItem, since a bill can now cover a course, a trip, and a book
    together — the trip/book portions shouldn't count toward "did they pay
    for this course"). Each item carries its own teacher_percentage/
    school_percentage (see PaymentItem), so its own discount is known
    exactly rather than prorated from the bill's total. This is what backs
    the "did they pay for this yet" indicator next to each student on the
    attendance roster — a course-specific answer, not the student's overall
    balance across everything. Returns {student_id: bool}, present only for
    students with at least one billable attendance in this course."""
    course = Course.objects.filter(id=course_id, tenant_id=tenant_id).values(
        'price', 'pricing_type', 'sessions_count'
    ).first()
    if not course:
        return {}
    per_session_price = course_per_session_price(course['price'], course['pricing_type'], course['sessions_count'])

    sessions = ClassSession.objects.filter(tenant_id=tenant_id).values('id', 'course_id', 'group__course_id')
    session_ids_for_course = {
        s['id'] for s in sessions if (s['course_id'] or s['group__course_id']) == course_id
    }

    attendance_qs = Attendance.objects.filter(
        tenant_id=tenant_id, session_id__in=session_ids_for_course,
    ).filter(
        Q(status__in=ATTENDED_STATUSES) | Q(status='excused', recovery_status__in=('not_applicable', 'needs_recovery'))
    )
    if student_ids is not None:
        attendance_qs = attendance_qs.filter(student_id__in=student_ids)

    cost = {}
    for row in attendance_qs.values('student_id').annotate(n=Count('id')):
        amount = per_session_price * row['n']
        if course['pricing_type'] == 'fixed_sessions':
            amount = min(amount, float(course['price'] or 0))
        cost[row['student_id']] = amount

    billed_qs = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id, course_id=course_id,
    ).filter(
        Q(payment__status__in=('paid', 'partial', 'pending', 'pardoned')) |
        Q(status__in=('paid', 'partial', 'pending', 'pardoned')) |
        Q(pardon_type__in=('school', 'teacher')) |
        Q(payment__pardon_type__in=('school', 'teacher'))
    ).exclude(
        status='cancelled'
    ).exclude(
        payment__status='cancelled'
    ).exclude(
        Q(pardon_type='both') | (Q(status__in=('pardoned', 'pardonned')) & Q(pardon_type__isnull=True) & Q(payment__pardon_type__isnull=True))
    )
    if student_ids is not None:
        billed_qs = billed_qs.filter(payment__student_id__in=student_ids)
    billed = {}
    for row in billed_qs.values('payment__student_id', 'amount'):
        sid = row['payment__student_id']
        amt = float(row['amount'] or 0) or float(course['price'] or 0)
        billed[sid] = billed.get(sid, 0.0) + amt
    for sid, amount in billed.items():
        cost[sid] = max(cost.get(sid, 0.0), amount)

    paid = {}
    items_qs = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id, course_id=course_id,
    ).filter(
        Q(status__in=('paid', 'partial')) |
        Q(status__in=['', None], payment__status__in=('paid', 'partial')) |
        Q(status__in=('pardoned', 'pardonned'), payment__status__in=('paid', 'partial'), payment__paid_at__isnull=False)
    ).exclude(
        status='pending'
    ).exclude(
        payment__status='pending'
    )
    if student_ids is not None:
        items_qs = items_qs.filter(payment__student_id__in=student_ids)
    for row in items_qs.values('payment__student_id', 'amount', 'teacher_percentage', 'school_percentage', 'status', 'pardon_type', 'payment__pardon_type', 'reduction'):
        net = float(row['amount']) - _payment_item_discount(row)
        if net > 0:
            paid[row['payment__student_id']] = paid.get(row['payment__student_id'], 0.0) + net

    written_off = {}
    written_off_items_qs = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id, payment__status__in=('cancelled', 'refunded'),
        payment__paid_at__isnull=False, course_id=course_id,
    )
    if student_ids is not None:
        written_off_items_qs = written_off_items_qs.filter(payment__student_id__in=student_ids)
    for row in written_off_items_qs.values('payment__student_id', 'amount'):
        written_off[row['payment__student_id']] = written_off.get(row['payment__student_id'], 0.0) + float(row['amount'])

    active_discount = {}
    active_items_qs = PaymentItem.objects.filter(
        payment__tenant_id=tenant_id, payment__status__in=('paid', 'partial', 'pending', 'pardoned'), course_id=course_id,
    ).exclude(status='cancelled')
    if student_ids is not None:
        active_items_qs = active_items_qs.filter(payment__student_id__in=student_ids)

    course_groups = {
        g['id']: g for g in Group.objects.filter(tenant_id=tenant_id, course_id=course_id).values('id', 'teacher_id', 'teacher__payment_percentage')
    }
    course_teacher_default = 0.0
    for g in course_groups.values():
        tp = float(g.get('teacher__payment_percentage') or 0)
        if tp > 0:
            course_teacher_default = tp
            break

    course_pardon_applied = set()
    for row in active_items_qs.values('payment__student_id', 'amount', 'teacher_percentage', 'school_percentage', 'status', 'pardon_type', 'payment__pardon_type', 'reduction', 'group_id', 'payment__status'):
        p_type = row.get('pardon_type') or row.get('payment__pardon_type')
        if row.get('status') in ('pardoned', 'pardonned') or p_type or row.get('payment__status') in ('pardoned', 'pardonned'):
            sid = row['payment__student_id']
            if sid in course_pardon_applied:
                continue
            course_pardon_applied.add(sid)
            course_price = float(course['price'] or 0)
            item_amt = float(row['amount'] or 0) or course_price
            gross_base = max(item_amt, cost.get(sid, 0.0), course_price)
            if not p_type or p_type == 'both':
                pardoned_amount = gross_base
            else:
                t_pct = float(row.get('teacher_percentage') or 0)
                if t_pct <= 0:
                    gid = row.get('group_id')
                    if gid and gid in course_groups:
                        t_pct = float(course_groups[gid].get('teacher__payment_percentage') or 0)
                    if t_pct <= 0:
                        t_pct = course_teacher_default or 50.0

                s_pct = float(row.get('school_percentage') or 0)
                if s_pct <= 0:
                    s_pct = max(0.0, 100.0 - t_pct)

                if p_type == 'school':
                    pardoned_amount = round(gross_base * (s_pct / 100.0), 2)
                elif p_type == 'teacher':
                    pardoned_amount = round(gross_base * (t_pct / 100.0), 2)
                else:
                    pardoned_amount = gross_base

            red = float(row.get('reduction') or 0)
            discount_total = min(gross_base, round(pardoned_amount + red, 2))
            if discount_total:
                active_discount[sid] = active_discount.get(sid, 0.0) + discount_total
        else:
            discount = _payment_item_discount(row)
            if discount:
                active_discount[row['payment__student_id']] = active_discount.get(row['payment__student_id'], 0.0) + discount

    return {
        student_id: (
            paid.get(student_id, 0.0) + active_discount.get(student_id, 0.0) + BALANCE_THRESHOLD
            >= (cost_amount - written_off.get(student_id, 0.0))
        )
        for student_id, cost_amount in cost.items()
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payments_balances(request):
    user = request.user
    tid = require_staff_tenant(user)
    # Shared by the Payments page (balance coloring/filter) and the standalone
    # Debts page — a user only granted one of those two modules must still be
    # able to load it, so this only blocks someone with neither.
    if not user.can_view('payments') and not user.can_view('debts'):
        raise PermissionDenied('Forbidden')

    balances = compute_student_balances(tid)
    students = Student.objects.filter(tenant_id=tid, id__in=balances.keys()).select_related('parent')
    rows = [{
        'student_id': s.id,
        'student_name': f'{s.first_name} {s.last_name}',
        'student_phone': s.phone,
        'parent_name': s.parent.name if s.parent else None,
        'parent_phone': s.parent.phone if s.parent else None,
        **balances[s.id],
    } for s in students]
    rows.sort(key=lambda r: r['balance'])
    return Response({'items': rows, 'total': len(rows)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def payments_student_summary(request):
    """Backs the Payments page's "click a student" detail panel: their
    running balance (same figures as payments_balances, for one student) plus
    which courses they're currently enrolled in — two things a secretary
    otherwise has to open the Students and Groups pages separately to see."""
    user = request.user
    tid = require_staff_tenant(user)
    if not user.can_view('payments') and not user.can_view('debts'):
        raise PermissionDenied('Forbidden')

    student_id = request.GET.get('student_id')
    student = Student.objects.filter(id=student_id, tenant_id=tid).select_related('parent').first()
    if not student:
        raise NotFound('Student not found')

    balance = compute_student_balances(tid).get(
        student_id, {'paid': 0.0, 'cost': 0.0, 'balance': 0.0, 'status': 'settled'},
    )
    groups = Group.objects.filter(tenant_id=tid, students__id=student_id).select_related('course', 'teacher')

    # Compute per-course statistics
    course_items = PaymentItem.objects.filter(
        payment__tenant_id=tid,
        payment__student_id=student_id,
        status__in=('paid', 'partial')
    ).select_related('payment')
    paid_by_course = {}
    for it in course_items:
        cid = it.course_id or (it.group.course_id if it.group else None)
        if cid:
            paid_by_course[cid] = paid_by_course.get(cid, 0.0) + max(0.0, float(it.amount or 0) - _payment_item_discount(it))

    legacy_payments = Payment.objects.filter(
        tenant_id=tid, student_id=student_id, status__in=('paid', 'partial'), items__isnull=True
    )
    for lp in legacy_payments:
        cid = lp.course_id or (lp.group.course_id if lp.group else None)
        if cid:
            paid_by_course[cid] = paid_by_course.get(cid, 0.0) + max(0.0, float(lp.amount or 0) - float(lp.discount or 0))

    # Attended sessions per group
    attendances = Attendance.objects.filter(
        tenant_id=tid, student_id=student_id, status__in=('present', 'late', 'excused')
    ).values('session__group_id')
    attended_by_group = {}
    for a in attendances:
        gid = a['session__group_id']
        if gid:
            attended_by_group[gid] = attended_by_group.get(gid, 0) + 1

    courses = []
    for g in groups:
        course = g.course
        session_price = course_per_session_price(course.price, course.pricing_type, course.sessions_count) if course else 0.0
        course_paid = paid_by_course.get(course.id if course else None, 0.0)
        attended_count = attended_by_group.get(g.id, 0)
        sessions_covered = int(course_paid / session_price) if session_price > 0 else (course.sessions_count or 0 if course else 0)
        sessions_remaining = max(0, sessions_covered - attended_count)
        credit_remaining = round(max(0.0, course_paid - (attended_count * session_price)), 2)

        courses.append({
            'group_id': g.id,
            'group_name': g.name,
            'course_id': g.course_id,
            'course_title': course.title if course else '—',
            'teacher_name': f"{g.teacher.first_name} {g.teacher.last_name}" if g.teacher else '—',
            'pricing_type': course.pricing_type if course else 'fixed_sessions',
            'course_price': float(course.price or 0) if course else 0.0,
            'sessions_count': course.sessions_count or 0 if course else 0,
            'cost_per_session': session_price,
            'amount_paid': round(course_paid, 2),
            'sessions_covered': sessions_covered,
            'sessions_deducted': attended_count,
            'sessions_remaining': sessions_remaining,
            'credit_remaining': credit_remaining,
        })

    return Response({
        'student_id': student.id,
        'student_name': f'{student.first_name} {student.last_name}',
        'balance': balance,
        'courses': courses,
    })


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def debts_waive(request, student_id):
    """The Debts page's delete button. A debt isn't a stored row — it's
    compute_student_balances() finding cost > paid for this student — so
    "deleting" it writes off the exact amount currently owed (looked up
    server-side, never trusted from the client) as a DebtWaiver, which that
    same function already knows to subtract from cost. Nothing to touch on
    the revenue side: an unpaid debt was never counted as revenue to begin
    with, only as cost the student hadn't covered yet."""
    user = request.user
    tid = require_staff_tenant(user)
    if not user.is_super_admin() and not user.can_delete('debts'):
        raise PermissionDenied('Forbidden')

    student = Student.objects.filter(id=student_id, tenant_id=tid).first()
    if not student:
        raise NotFound('Student not found')

    balance = compute_student_balances(tid).get(student_id)
    owed = abs(balance['balance']) if balance and balance['status'] == 'owes' else 0.0
    if owed <= 0:
        raise ValidationError('This student has no outstanding debt to write off.')

    waiver = DebtWaiver.objects.create(tenant_id=tid, student_id=student_id, amount=round(owed, 2), created_by=user)
    log_activity(
        request, tid, 'delete', category='data', entity_type='debts', entity_id=waiver.id,
        description=f'Wrote off {waiver.amount} owed by {student.first_name} {student.last_name}',
    )
    return Response({'waived': float(waiver.amount)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def debts_pay(request, student_id):
    """Settles a student's debt, supporting either full or partial payment,
    labeled with a specified date (defaulting to today).
    
    The collected money is recorded as a paid Payment with paid_at set to the
    chosen payment date (so it enters the income of that specific day, NOT the
    date of the original pending invoice).
    
    If the student has pending invoices:
      - Any bill covered in full becomes 'paid' with paid_at = date.
      - If a bill is partially covered, the paid portion is recorded as 'paid'
        for that date, and the remaining unpaid portion continues as 'pending'.
    If the student owes debt from attendance without an existing bill:
      - A new paid Payment and PaymentItem are created for the settled amount.
    """
    user = request.user
    tid = require_staff_tenant(user)
    if not user.is_super_admin() and not user.can_modify('debts') and not user.can_add('payments') and not user.can_modify('payments'):
        raise PermissionDenied('Forbidden')

    student = Student.objects.filter(id=student_id, tenant_id=tid).select_related('tenant').first()
    if not student:
        raise NotFound('Student not found')

    balance_info = compute_student_balances(tid).get(student_id)
    owed = abs(balance_info['balance']) if balance_info and balance_info['status'] == 'owes' else 0.0
    if owed <= 0.01:
        raise ValidationError('This student has no outstanding debt to settle.')

    raw_amount = request.data.get('amount')
    try:
        pay_amount = round(float(raw_amount), 2)
    except (TypeError, ValueError):
        raise ValidationError({'amount': 'Valid payment amount is required.'})

    if pay_amount <= 0:
        raise ValidationError({'amount': 'Payment amount must be greater than zero.'})
    if pay_amount > round(owed, 2) + 0.01:
        raise ValidationError({'amount': f'Amount ({pay_amount}) cannot exceed total debt ({round(owed, 2)}).'})

    raw_date = request.data.get('paid_at')
    if raw_date:
        try:
            raw_str = str(raw_date).strip()
            if 'T' in raw_str:
                paid_at_dt = datetime.fromisoformat(raw_str.replace('Z', '+00:00'))
            else:
                d = datetime.strptime(raw_str[:10], '%Y-%m-%d').date()
                now_t = timezone.now().time()
                combined = datetime.combine(d, now_t)
                paid_at_dt = timezone.make_aware(combined) if timezone.is_naive(combined) else combined
        except Exception:
            paid_at_dt = timezone.now()
    else:
        paid_at_dt = timezone.now()

    method = request.data.get('method', 'cash')
    if method not in ('cash', 'card', 'bank_transfer', 'cheque', 'other'):
        method = 'cash'
    notes = (request.data.get('notes') or '').strip()

    tenant_prefix = (getattr(student.tenant, 'invoice_prefix', 'INV-') if getattr(student, 'tenant', None) else 'INV-') or 'INV-'

    remaining_to_settle = pay_amount
    paid_payments = []

    with transaction.atomic():
        # Look for pending bills for this student
        pending_bills = list(Payment.objects.filter(
            tenant_id=tid, student_id=student_id, status__in=('pending', 'partial')
        ).order_by('created_at'))

        for p in pending_bills:
            if remaining_to_settle <= 0.001:
                break
            # Net unpaid amount on this pending bill
            bill_net = max(0.0, float(p.amount) - float(p.discount))
            if bill_net <= 0.01:
                continue

            if remaining_to_settle >= bill_net - 0.01:
                # Fully covers this pending bill
                p.status = 'paid'
                p.paid_at = paid_at_dt
                p.due_date = paid_at_dt.date()
                p.method = method
                if not p.invoice_number:
                    p.invoice_number = _next_sequence_code(tid, Payment, 'invoice_number', tenant_prefix, 6)
                if notes:
                    p.notes = f"{p.notes}\n{notes}".strip() if p.notes else notes
                p.save()
                p.items.exclude(status='cancelled').update(status='paid', due_date=paid_at_dt.date())
                remaining_to_settle = max(0.0, round(remaining_to_settle - bill_net, 2))
                paid_payments.append(p)
            else:
                # Partially covers this bill: split it
                portion = round(remaining_to_settle, 2)
                inv_code = _next_sequence_code(tid, Payment, 'invoice_number', tenant_prefix, 6)

                paid_p = Payment.objects.create(
                    tenant_id=tid,
                    student_id=student_id,
                    course_id=p.course_id,
                    group_id=p.group_id,
                    trip_id=p.trip_id,
                    book_id=p.book_id,
                    kind=p.kind or 'course',
                    amount=Decimal(str(portion)),
                    discount=Decimal('0'),
                    method=method,
                    status='paid',
                    paid_at=paid_at_dt,
                    due_date=paid_at_dt.date(),
                    notes=notes or f"دفعة من الفاتورة {p.invoice_number or p.id}",
                    invoice_number=inv_code,
                )

                first_item = p.items.first()
                c_id = first_item.course_id if first_item else p.course_id
                g_id = first_item.group_id if first_item else p.group_id
                trip_id = first_item.trip_id if first_item else p.trip_id
                book_id = first_item.book_id if first_item else p.book_id
                t_pct = first_item.teacher_percentage if first_item else Decimal('0')
                s_pct = first_item.school_percentage if first_item else Decimal('100')

                PaymentItem.objects.create(
                    payment=paid_p,
                    course_id=c_id,
                    group_id=g_id,
                    trip_id=trip_id,
                    book_id=book_id,
                    amount=Decimal(str(portion)),
                    reduction=Decimal('0'),
                    due_date=paid_at_dt.date(),
                    teacher_percentage=t_pct,
                    school_percentage=s_pct,
                    status='paid',
                    kind=p.kind or 'course',
                )

                # Reduce original pending bill and its items
                new_pending_amt = max(0.0, round(float(p.amount) - portion, 2))
                p.amount = Decimal(str(new_pending_amt))
                rem_deduct = portion
                for it in p.items.order_by('id'):
                    if rem_deduct <= 0:
                        break
                    it_amt = float(it.amount)
                    if rem_deduct >= it_amt:
                        it.amount = Decimal('0')
                        it.save()
                        rem_deduct = round(rem_deduct - it_amt, 2)
                    else:
                        it.amount = Decimal(str(round(it_amt - rem_deduct, 2)))
                        it.save()
                        rem_deduct = 0.0
                p.items.filter(amount=Decimal('0')).delete()
                p.save()

                paid_payments.append(paid_p)
                remaining_to_settle = 0.0
                break

        # If still remaining (e.g. debt originated directly from attendance cost without a bill)
        if remaining_to_settle > 0.001:
            portion = round(remaining_to_settle, 2)
            inv_code = _next_sequence_code(tid, Payment, 'invoice_number', tenant_prefix, 6)

            primary_group = student.groups.first()
            c_id = primary_group.course_id if primary_group else None
            g_id = primary_group.id if primary_group else None
            if not c_id:
                last_att = Attendance.objects.filter(tenant_id=tid, student_id=student_id).select_related('session').last()
                if last_att and last_att.session:
                    c_id = last_att.session.course_id or getattr(last_att.session.group, 'course_id', None)
                    g_id = last_att.session.group_id
            if not c_id:
                c_id = Course.objects.filter(tenant_id=tid).values_list('id', flat=True).first()

            paid_p = Payment.objects.create(
                tenant_id=tid,
                student_id=student_id,
                course_id=c_id,
                group_id=g_id,
                kind='course' if c_id else 'other',
                amount=Decimal(str(portion)),
                discount=Decimal('0'),
                method=method,
                status='paid',
                paid_at=paid_at_dt,
                due_date=paid_at_dt.date(),
                notes=notes or "تسديد دين",
                invoice_number=inv_code,
            )
            PaymentItem.objects.create(
                payment=paid_p,
                course_id=c_id,
                group_id=g_id,
                amount=Decimal(str(portion)),
                reduction=Decimal('0'),
                due_date=paid_at_dt.date(),
                teacher_percentage=Decimal('0'),
                school_percentage=Decimal('100'),
                status='paid',
                kind='course' if c_id else 'other',
            )
            paid_payments.append(paid_p)

        log_activity(
            request, tid, 'create', category='financial', entity_type='payments',
            entity_id=paid_payments[0].id if paid_payments else None,
            description=f"Paid debt of {pay_amount} for {student.first_name} {student.last_name} on {paid_at_dt.strftime('%Y-%m-%d')}",
        )

    new_balance = compute_student_balances(tid).get(student_id, {})
    new_owed = abs(new_balance.get('balance', 0.0)) if new_balance.get('status') == 'owes' else 0.0

    return Response({
        'paid_amount': pay_amount,
        'date': paid_at_dt.strftime('%Y-%m-%d'),
        'new_balance': new_balance.get('balance', 0.0),
        'remaining_debt': new_owed,
        'status': new_balance.get('status', 'settled'),
    })
