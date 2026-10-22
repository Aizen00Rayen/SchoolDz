"""Courses, rooms, timetable, groups, trips, books, sessions, grades, quizzes, messages."""
import secrets
import uuid
from datetime import datetime, timedelta
from django.conf import settings
from django.db import transaction
from django.db.models import Q, Prefetch
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound
from ..models import (
    Tenant,
    Guardian,
    Student,
    Course,
    Group,
    ClassSession,
    Room,
    Attendance,
    PaymentItem,
    Trip,
    Book,
    BookCopy,
    Grade,
    Conversation,
    ConversationStaffRead,
    Message,
    Quiz,
    TimetableEntry,
)
from ..serializers import (
    CourseSerializer,
    GroupSerializer,
    ClassSessionSerializer,
    RoomSerializer,
    TripSerializer,
    BookSerializer,
    BookCopySerializer,
    GradeSerializer,
    ConversationSerializer,
    MessageSerializer,
    QuizSerializer,
    QuizAttemptSerializer,
    TimetableEntrySerializer,
)
from ..services import log_activity
from .common import (
    PLANS_CONFIG,
    TenantScopedViewSet,
    check_website_builder,
    course_per_session_price,
    delete_uploaded_image,
    save_uploaded_document,
    save_uploaded_image,
)
from .payments import (
    _payment_item_discount,
)


class CourseViewSet(TenantScopedViewSet):
    queryset = Course.objects.all()
    serializer_class = CourseSerializer
    module_key = 'courses'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(
                Q(title__icontains=q) | Q(category__icontains=q)
            )
        status_filter = request.GET.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        else:
            queryset = queryset.exclude(status='archived')
        year_filter = request.GET.get('year')
        if year_filter:
            try:
                y = int(year_filter)
                queryset = queryset.filter(Q(archive_year=y) | Q(updated_at__year=y))
            except (ValueError, TypeError):
                pass
        queryset = queryset.order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], url_path='archive')
    def archive_course(self, request, pk=None):
        self.check_module_modify()
        course = self.get_object()
        year = request.data.get('year')
        try:
            year_val = int(year) if year else timezone.now().year
        except (ValueError, TypeError):
            year_val = timezone.now().year
        course.status = 'archived'
        course.archive_year = year_val
        course.save(update_fields=['status', 'archive_year', 'updated_at'])
        log_activity(request, course.tenant_id, 'update', entity_type='courses', entity_id=course.id,
                     description=f'Archived course: {course.title} (Year {year_val})')
        return Response(self.get_serializer(course).data)

    @action(detail=True, methods=['post'], url_path='unarchive')
    def unarchive_course(self, request, pk=None):
        self.check_module_modify()
        course = self.get_object()
        course.status = 'active'
        course.archive_year = None
        course.save(update_fields=['status', 'archive_year', 'updated_at'])
        log_activity(request, course.tenant_id, 'update', entity_type='courses', entity_id=course.id,
                     description=f'Restored course from archive: {course.title}')
        return Response(self.get_serializer(course).data)

    @action(detail=True, methods=['get'], url_path='archive-details')
    def archive_details(self, request, pk=None):
        course = self.get_object()
        tid = course.tenant_id
        groups = list(Group.objects.filter(tenant_id=tid, course_id=course.id).select_related('teacher'))
        group_ids = [g.id for g in groups]

        sessions = list(ClassSession.objects.filter(
            Q(course_id=course.id) | (Q(group_id__in=group_ids) if group_ids else Q(pk__in=[])),
            tenant_id=tid,
        ).select_related('teacher', 'group', 'room_ref').order_by('-start_at'))
        session_ids = [s.id for s in sessions]

        teachers = []
        seen_tids = set()
        for g in groups:
            if g.teacher and g.teacher.id not in seen_tids:
                seen_tids.add(g.teacher.id)
                teachers.append({
                    'id': g.teacher.id,
                    'name': f"{g.teacher.first_name} {g.teacher.last_name}".strip(),
                    'phone': g.teacher.phone,
                    'payment_percentage': float(g.teacher.payment_percentage or 0),
                })
        for s in sessions:
            if s.teacher and s.teacher.id not in seen_tids:
                seen_tids.add(s.teacher.id)
                teachers.append({
                    'id': s.teacher.id,
                    'name': f"{s.teacher.first_name} {s.teacher.last_name}".strip(),
                    'phone': s.teacher.phone,
                    'payment_percentage': float(s.teacher.payment_percentage or 0),
                })

        # Gather all students linked to this course via groups, payments, or attendance
        student_ids = set()
        if group_ids:
            group_student_ids = Student.objects.filter(
                tenant_id=tid,
                groups__id__in=group_ids
            ).values_list('id', flat=True)
            student_ids.update(group_student_ids)

        payment_student_ids = PaymentItem.objects.filter(
            Q(course_id=course.id) | (Q(group_id__in=group_ids) if group_ids else Q(pk__in=[])),
            payment__tenant_id=tid,
        ).values_list('payment__student_id', flat=True)
        student_ids.update(filter(None, payment_student_ids))

        if session_ids:
            att_student_ids = Attendance.objects.filter(
                tenant_id=tid,
                session_id__in=session_ids
            ).values_list('student_id', flat=True)
            student_ids.update(filter(None, att_student_ids))

        enrolled_students = list(Student.objects.filter(
            id__in=student_ids,
            tenant_id=tid,
        ).select_related('parent').order_by('first_name', 'last_name'))

        attendances = list(Attendance.objects.filter(
            tenant_id=tid,
            session_id__in=session_ids
        ).values('student_id', 'status', 'session_id'))

        student_att = {}
        for a in attendances:
            sid = a['student_id']
            if sid not in student_att:
                student_att[sid] = {'present': 0, 'absent': 0, 'excused': 0, 'total': 0}
            student_att[sid]['total'] += 1
            if a['status'] in ('present', 'late'):
                student_att[sid]['present'] += 1
            elif a['status'] == 'absent':
                student_att[sid]['absent'] += 1
            elif a['status'] == 'excused':
                student_att[sid]['excused'] += 1

        items = list(PaymentItem.objects.filter(
            Q(course_id=course.id) | (Q(group_id__in=group_ids) if group_ids else Q(pk__in=[])),
            payment__tenant_id=tid,
        ).select_related('payment', 'group'))
        total_revenue = 0.0
        for it in items:
            if it.status in ('paid', 'partial') or (not it.status and it.payment and it.payment.status in ('paid', 'partial')):
                total_revenue += max(0.0, float(it.amount or 0) - _payment_item_discount(it))

        teacher_earnings = 0.0
        session_price = course_per_session_price(course.price, course.pricing_type, course.sessions_count)
        teacher_earned_map = {t['id']: 0.0 for t in teachers}

        if course.kind in ('package', 'standalone'):
            for it in items:
                if it.status in ('paid', 'partial', 'pending', 'pardoned'):
                    pct = float(it.teacher_percentage or 0)
                    share = float(it.amount or 0) * (pct / 100.0)
                    teacher_earnings += share
                    if it.group and it.group.teacher_id in teacher_earned_map:
                        teacher_earned_map[it.group.teacher_id] += share
                    elif teachers:
                        teacher_earned_map[teachers[0]['id']] += share
        else:
            for s in sessions:
                t_pct = float(s.teacher.payment_percentage or 0) if s.teacher else 0.0
                t_id = s.teacher_id if s.teacher else None
                if not t_pct and s.group and s.group.teacher:
                    t_pct = float(s.group.teacher.payment_percentage or 0)
                    t_id = s.group.teacher_id
                pres_count = sum(1 for a in attendances if a['session_id'] == s.id and a['status'] in ('present', 'late'))
                s_earned = pres_count * session_price * (t_pct / 100.0)
                teacher_earnings += s_earned
                if t_id and t_id in teacher_earned_map:
                    teacher_earned_map[t_id] += s_earned

        for t in teachers:
            t['earned'] = round(teacher_earned_map.get(t['id'], 0.0), 2)

        student_payments = {}
        for it in items:
            s_id = it.payment.student_id if it.payment else None
            if s_id:
                if s_id not in student_payments:
                    student_payments[s_id] = {'paid': 0.0, 'pending': 0.0, 'status': 'not_billed'}
                it_disc = _payment_item_discount(it)
                it_net = max(0.0, float(it.amount or 0) - it_disc)
                if it.status in ('paid', 'partial') or (not it.status and it.payment and it.payment.status in ('paid', 'partial')):
                    student_payments[s_id]['paid'] += it_net
                if it.status == 'pending' or (not it.status and it.payment and it.payment.status == 'pending'):
                    student_payments[s_id]['pending'] += it_net
                if student_payments[s_id]['pending'] > 0 and student_payments[s_id]['paid'] > 0:
                    student_payments[s_id]['status'] = 'partial'
                elif student_payments[s_id]['paid'] > 0:
                    student_payments[s_id]['status'] = 'paid'
                elif student_payments[s_id]['pending'] > 0:
                    student_payments[s_id]['status'] = 'pending'
                else:
                    student_payments[s_id]['status'] = it.status or (it.payment.status if it.payment else 'not_billed')

        students_data = []
        for stu in enrolled_students:
            att = student_att.get(stu.id, {'present': 0, 'absent': 0, 'excused': 0, 'total': 0})
            sp = student_payments.get(stu.id, {'paid': 0.0, 'pending': 0.0, 'status': 'not_billed'})
            students_data.append({
                'id': stu.id,
                'name': f"{stu.first_name} {stu.last_name}".strip(),
                'first_name': stu.first_name,
                'last_name': stu.last_name,
                'code': stu.student_code,
                'school_level': stu.school_level,
                'school_year': stu.school_year,
                'specialty': stu.specialty,
                'phone': stu.phone,
                'parent_phone': stu.parent.phone if stu.parent else None,
                'attendance': att,
                'paid_amount': round(sp['paid'], 2),
                'pending_amount': round(sp['pending'], 2),
                'payment_status': sp['status'],
            })

        sessions_data = []
        for s in sessions[:100]:
            sessions_data.append({
                'id': s.id,
                'title': getattr(s, 'topic', None) or (s.group.name if s.group else course.title),
                'start_at': s.start_at.isoformat() if s.start_at else None,
                'group_name': s.group.name if s.group else '—',
                'teacher_name': f"{s.teacher.first_name} {s.teacher.last_name}".strip() if s.teacher else (f"{s.group.teacher.first_name} {s.group.teacher.last_name}".strip() if s.group and s.group.teacher else '—'),
                'room_name': s.room_ref.name if s.room_ref else (s.room or '—'),
                'status': s.status,
            })

        return Response({
            'course': CourseSerializer(course).data,
            'teachers': teachers,
            'groups': [{'id': g.id, 'name': g.name} for g in groups],
            'total_students': len(students_data),
            'students': students_data,
            'total_sessions': len(sessions),
            'sessions': sessions_data,
            'total_revenue': round(total_revenue, 2),
            'teacher_earnings': round(teacher_earnings, 2),
            'net_profit': round(max(0.0, total_revenue - teacher_earnings), 2),
        })

    @action(detail=True, methods=['post'], url_path='photo')
    def upload_photo(self, request, pk=None):
        self.check_module_modify()
        course = self.get_object()
        tenant = Tenant.objects.filter(id=course.tenant_id).first()
        check_website_builder(request.user, tenant)
        if 'file' not in request.FILES:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        new_url = save_uploaded_image(request.FILES['file'], 'courses', course.id)
        delete_uploaded_image(course.image_url, 'courses')
        course.image_url = new_url
        course.save(update_fields=['image_url', 'updated_at'])
        return Response(CourseSerializer(course).data)


class RoomViewSet(TenantScopedViewSet):
    queryset = Room.objects.all()
    serializer_class = RoomSerializer
    module_key = 'rooms'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset()).order_by('name')
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(Q(name__icontains=q) | Q(notes__icontains=q))

        rooms = list(queryset)

        # Optional occupancy check: does this room have a session overlapping
        # [from, to]? Defaults to "right now" so the Rooms page can show a
        # live free/occupied state without the caller passing a range.
        from_raw = request.GET.get('from')
        to_raw = request.GET.get('to')
        now = timezone.now()
        range_start = parse_datetime(from_raw) if from_raw else now
        range_end = parse_datetime(to_raw) if to_raw else (range_start + timedelta(minutes=1))
        if range_start and range_end:
            # room_ref__in=rooms is already tenant-scoped (rooms came from
            # get_queryset(), which filters by tenant) so no separate
            # tenant_id filter is needed here.
            occupied_sessions = ClassSession.objects.filter(
                room_ref__in=rooms,
                start_at__lt=range_end,
                end_at__gt=range_start,
            ).exclude(status='cancelled').select_related('group', 'course')
            by_room = {}
            for s in occupied_sessions:
                # Groups are frequently named the same across different
                # courses ("Groupe A" everywhere), so the room card needs the
                # same course/level disambiguation the group picker uses
                # elsewhere — school_level etc. ride along for the frontend
                # to build that label, same as it already does for groups.
                course = s.course
                by_room.setdefault(s.room_ref_id, []).append({
                    'session_id': s.id,
                    'group_name': s.group.name if s.group else None,
                    'course_title': course.title if course else None,
                    'school_level': course.school_level if course else None,
                    'school_year': course.school_year if course else None,
                    'specialty': course.specialty if course else None,
                    'start_at': s.start_at,
                    'end_at': s.end_at,
                })
        else:
            by_room = {}

        data = self.get_serializer(rooms, many=True).data
        for row in data:
            row['occupied'] = bool(by_room.get(row['id']))
            row['occupying_sessions'] = by_room.get(row['id'], [])
        return Response({'items': data, 'total': len(data)})


class TimetableEntryViewSet(TenantScopedViewSet):
    """The weekly timetable (استعمال الزمن) — a fixed grid that repeats all
    year, unlike ClassSession's dated occurrences. Each entry now belongs to
    a room, and the grid is viewed one room at a time (?room_id=<id>, or
    ?room_id=none for legacy entries with no room). list() also returns the
    tenant's grid bounds and its room list so the frontend doesn't need a
    second request to build the room switcher."""
    queryset = TimetableEntry.objects.all()
    serializer_class = TimetableEntrySerializer
    module_key = 'timetable'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset()).order_by('day_of_week', 'start_time')
        room_id = request.GET.get('room_id')
        if room_id == 'none':
            queryset = queryset.filter(room__isnull=True)
        elif room_id:
            queryset = queryset.filter(room_id=room_id)
        data = self.get_serializer(queryset, many=True).data
        tenant = Tenant.objects.filter(id=request.user.tenant_id).first()
        rooms = list(
            Room.objects.filter(tenant_id=request.user.tenant_id, status='active')
            .order_by('name').values('id', 'name')
        )
        return Response({
            'items': data,
            'total': len(data),
            'grid_start': '08:00',
            'grid_end': tenant.timetable_end_time.strftime('%H:%M') if tenant else '22:00',
            'rooms': rooms,
        })

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        self.check_module_modify()
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self.check_module_delete()
        return super().destroy(request, *args, **kwargs)


class GroupViewSet(TenantScopedViewSet):
    queryset = Group.objects.all()
    serializer_class = GroupSerializer
    module_key = 'groups'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        course_id = request.GET.get('course_id')
        if course_id:
            queryset = queryset.filter(course_id=course_id)
        # Narrowing by the course's level/year — lets a school with many
        # groups filter down to "middle school, year 2" etc. without
        # already knowing which course/group name to look for.
        school_level = request.GET.get('school_level')
        if school_level:
            queryset = queryset.filter(course__school_level=school_level)
        school_year = request.GET.get('school_year')
        if school_year:
            queryset = queryset.filter(course__school_year=school_year)
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(
                Q(name__icontains=q) | Q(room__icontains=q) | Q(schedule__icontains=q)
            )
        # Prefetch students for efficient SerializerMethodField
        queryset = queryset.select_related('room_ref').prefetch_related('students').order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        data = request.data.copy()
        student_ids = data.pop('student_ids', None)

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        group = serializer.instance

        if student_ids:
            students = Student.objects.filter(id__in=student_ids, tenant_id=group.tenant_id)
            group.students.set(students)

        return Response(self.get_serializer(group).data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        self.check_module_modify()
        instance = self.get_object()
        data = request.data.copy()
        student_ids = data.pop('student_ids', None)

        partial = kwargs.pop('partial', False)
        serializer = self.get_serializer(instance, data=data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        if student_ids is not None:
            students = Student.objects.filter(id__in=student_ids, tenant_id=instance.tenant_id)
            instance.students.set(students)

        return Response(self.get_serializer(instance).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def enroll(self, request, pk=None):
        self.check_module_modify()
        student_id = request.data.get('student_id')
        if not student_id:
            return Response({'error': 'student_id is required'}, status=status.HTTP_400_BAD_REQUEST)
            
        group = self.get_object()
        student = Student.objects.filter(id=student_id, tenant_id=group.tenant_id).first()
        if not student:
            raise NotFound('Student not found')
            
        group.students.add(student)
        return Response(GroupSerializer(group).data)

    @action(detail=True, methods=['post'])
    def unenroll(self, request, pk=None):
        self.check_module_modify()
        student_id = request.data.get('student_id')
        if not student_id:
            return Response({'error': 'student_id is required'}, status=status.HTTP_400_BAD_REQUEST)
            
        group = self.get_object()
        student = Student.objects.filter(id=student_id, tenant_id=group.tenant_id).first()
        if not student:
            raise NotFound('Student not found')
            
        group.students.remove(student)
        return Response(GroupSerializer(group).data)


class TripViewSet(TenantScopedViewSet):
    queryset = Trip.objects.all()
    serializer_class = TripSerializer
    module_key = 'trips'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(Q(title__icontains=q) | Q(destination__icontains=q))
        queryset = queryset.prefetch_related('students').order_by('-trip_date', '-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        data = request.data.copy()
        student_ids = data.pop('student_ids', None)

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        trip = serializer.instance

        if student_ids:
            students = Student.objects.filter(id__in=student_ids, tenant_id=trip.tenant_id)
            trip.students.set(students)

        return Response(self.get_serializer(trip).data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        self.check_module_modify()
        instance = self.get_object()
        data = request.data.copy()
        student_ids = data.pop('student_ids', None)

        partial = kwargs.pop('partial', False)
        serializer = self.get_serializer(instance, data=data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        if student_ids is not None:
            students = Student.objects.filter(id__in=student_ids, tenant_id=instance.tenant_id)
            instance.students.set(students)

        return Response(self.get_serializer(instance).data, status=status.HTTP_200_OK)

    def destroy(self, request, *args, **kwargs):
        self.check_module_delete()
        instance = self.get_object()
        # PaymentItem.trip is SET_NULL — deleting a trip that's already been
        # sold would silently null out a paid invoice's link to what was
        # actually sold, with the money collected left untraceable.
        if PaymentItem.objects.filter(trip=instance).exists():
            raise ValidationError('This trip has payments recorded against it and can’t be deleted.')
        self.perform_destroy(instance)
        return Response({'message': 'Deleted successfully'}, status=status.HTTP_200_OK)


class BookViewSet(TenantScopedViewSet):
    queryset = Book.objects.all()
    serializer_class = BookSerializer
    module_key = 'books'

    def get_queryset(self):
        # in_stock_count/sold_count on BookSerializer iterate obj.copies.all()
        # — prefetch here so a book list of N titles doesn't fire N queries.
        return super().get_queryset().prefetch_related('copies')

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(title__icontains=q)
        queryset = queryset.order_by('title')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    @action(detail=True, methods=['post'])
    def restock(self, request, pk=None):
        """Bulk-creates `quantity` new in-stock copies — adding inventory,
        so gated the same as creating any other new record."""
        self.check_module_add()
        book = self.get_object()
        try:
            quantity = int(request.data.get('quantity'))
        except (TypeError, ValueError):
            raise ValidationError('quantity must be an integer')
        if quantity < 1 or quantity > 1000:
            raise ValidationError('quantity must be between 1 and 1000')

        # Tenant-wide sequential counter (not per-title), same convention as
        # Student.student_code / Payment.invoice_number — derived from the
        # MAX numeric suffix among copy_codes that still exist, not a live
        # row count, so a previously-deleted/sold-then-removed copy never
        # causes a later restock to reuse its code (see
        # _next_sequence_code's docstring).
        with transaction.atomic():
            Tenant.objects.select_for_update().get(id=book.tenant_id)
            max_n = 0
            for code in BookCopy.objects.filter(tenant_id=book.tenant_id).values_list('copy_code', flat=True):
                if code and code.startswith('BK-') and code[3:].isdigit():
                    max_n = max(max_n, int(code[3:]))
            BookCopy.objects.bulk_create([
                BookCopy(tenant_id=book.tenant_id, book=book, copy_code=f"BK-{str(max_n + i + 1).zfill(6)}")
                for i in range(quantity)
            ])
        log_activity(request, book.tenant_id, 'update', entity_type='books', entity_id=book.id,
                     description=f'Restocked {quantity} cop{"y" if quantity == 1 else "ies"} of "{book.title}"')
        # `book` carries a prefetched (now-stale) `copies` cache from
        # get_object() above — re-fetch a clean instance so in_stock_count/
        # sold_count reflect the copies just bulk-created.
        book = Book.objects.get(pk=book.pk)
        return Response(self.get_serializer(book).data)

    @action(detail=True, methods=['get'])
    def copies(self, request, pk=None):
        """Per-copy lookup — who bought copy X, when, and which staff member
        sold it. get_object() already enforces the module view-check via
        get_queryset()."""
        book = self.get_object()
        queryset = book.copies.select_related('sold_by').prefetch_related(
            Prefetch('sale_items', queryset=PaymentItem.objects.select_related('payment__student').order_by('-created_at'))
        )
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(copy_code__icontains=q)
        status_val = request.GET.get('status')
        if status_val in ('in_stock', 'sold'):
            queryset = queryset.filter(status=status_val)
        queryset = queryset.order_by('-created_at')[:500]
        serializer = BookCopySerializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def destroy(self, request, *args, **kwargs):
        self.check_module_delete()
        instance = self.get_object()
        # PaymentItem.book is SET_NULL — deleting a book that's already been
        # sold would silently null out a paid invoice's link to what was
        # actually sold, with the money collected left untraceable.
        if PaymentItem.objects.filter(book=instance).exists():
            raise ValidationError('This book has sales recorded against it and can’t be deleted.')
        self.perform_destroy(instance)
        return Response({'message': 'Deleted successfully'}, status=status.HTTP_200_OK)


class ClassSessionViewSet(TenantScopedViewSet):
    queryset = ClassSession.objects.all()
    serializer_class = ClassSessionSerializer
    module_key = 'sessions'

    def list(self, request, *args, **kwargs):
        # select_related keeps the serializer's group/course/teacher labels
        # from firing a query per row in the planner's month view.
        queryset = self.filter_queryset(self.get_queryset()).select_related('group', 'course', 'teacher', 'room_ref')
        group_id = request.GET.get('group_id')
        if group_id:
            queryset = queryset.filter(group_id=group_id)
            
        from_date = request.GET.get('from_date')
        if from_date:
            queryset = queryset.filter(start_at__gte=from_date)
            
        to_date = request.GET.get('to_date')
        if to_date:
            queryset = queryset.filter(start_at__lte=to_date)

        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(
                Q(topic__icontains=q) | Q(room__icontains=q)
            )

        session_status = request.GET.get('status')
        if session_status in ('scheduled', 'completed', 'cancelled'):
            queryset = queryset.filter(status=session_status)

        # Newest-first — a school accumulates a year's worth of sessions, and
        # the ones anyone actually wants to look at (today's, this week's)
        # are always at the top, not buried below terms of history.
        queryset = queryset.order_by('-start_at')[:1000]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        user = request.user
        group_id = request.data.get('group_id')
        if not group_id:
            return Response({'error': 'group_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        group = Group.objects.filter(id=group_id, tenant_id=user.tenant_id).first()
        if not group:
            raise NotFound('Group not found')

        data = request.data.copy()
        data['course_id'] = group.course_id

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='generate-recurring')
    def generate_recurring(self, request):
        self.check_module_add()
        user = request.user
        tenant = Tenant.objects.filter(id=user.tenant_id).first()
        if not tenant:
            raise ValidationError('Tenant not found')

        calendar_planner = bool(tenant.plan) and PLANS_CONFIG['tiers'][tenant.plan].get('calendar_planner', False)
        if not user.is_super_admin() and not calendar_planner:
            raise PermissionDenied('Recurring sessions are available on the Premium plan. Upgrade your plan to use them.')

        group_id = request.data.get('group_id')
        if not group_id:
            return Response({'error': 'group_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        group = Group.objects.filter(id=group_id, tenant_id=user.tenant_id).first()
        if not group:
            raise NotFound('Group not found')

        start_at = request.data.get('start_at')
        end_at = request.data.get('end_at')
        if not start_at or not end_at:
            return Response({'error': 'start_at and end_at are required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            weeks = int(request.data.get('weeks', 8))
        except (TypeError, ValueError):
            return Response({'error': 'weeks must be an integer'}, status=status.HTTP_400_BAD_REQUEST)
        if weeks < 1 or weeks > 12:
            return Response({'error': 'weeks must be between 1 and 12'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            start_dt = datetime.fromisoformat(start_at)
            end_dt = datetime.fromisoformat(end_at)
        except ValueError:
            return Response({'error': 'start_at/end_at must be ISO datetimes'}, status=status.HTTP_400_BAD_REQUEST)

        series_id = str(uuid.uuid4())
        created = []
        with transaction.atomic():
            for i in range(weeks):
                delta = timedelta(weeks=i)
                session = ClassSession.objects.create(
                    tenant_id=user.tenant_id,
                    group=group,
                    teacher_id=request.data.get('teacher_id'),
                    course_id=group.course_id,
                    room=request.data.get('room'),
                    start_at=start_dt + delta,
                    end_at=end_dt + delta,
                    topic=request.data.get('topic'),
                    series_id=series_id,
                )
                created.append(session)

        return Response({'items': ClassSessionSerializer(created, many=True).data, 'series_id': series_id})


class GradeViewSet(TenantScopedViewSet):
    queryset = Grade.objects.all()
    serializer_class = GradeSerializer
    module_key = 'grades'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        student_id = request.GET.get('student_id')
        if student_id:
            queryset = queryset.filter(student_id=student_id)
        course_id = request.GET.get('course_id')
        if course_id:
            queryset = queryset.filter(course_id=course_id)
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(title__icontains=q)
        queryset = queryset.order_by('-date')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)


class QuizViewSet(TenantScopedViewSet):
    queryset = Quiz.objects.all()
    serializer_class = QuizSerializer
    module_key = 'quizzes'

    def _check_quiz_builder(self, tenant):
        quiz_builder = bool(tenant.plan) and PLANS_CONFIG['tiers'][tenant.plan].get('quiz_builder', False)
        if not self.request.user.is_super_admin() and not quiz_builder:
            raise PermissionDenied('The quiz builder is available on the Premium plan. Upgrade your plan to use it.')

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset()).order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        user = request.user
        tenant = Tenant.objects.filter(id=user.tenant_id).first()
        if not tenant:
            raise ValidationError('Tenant not found')
        self._check_quiz_builder(tenant)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        serializer.instance.created_by = user
        serializer.instance.save(update_fields=['created_by'])
        return Response(serializer.data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        self.check_module_modify()
        quiz = self.get_object()
        self._check_quiz_builder(quiz.tenant)
        return super().update(request, *args, **kwargs)

    @action(detail=True, methods=['post'], url_path='exercise')
    def exercise(self, request, pk=None):
        """Upload the exercise sheet students will answer — a photo or a PDF."""
        self.check_module_modify()
        quiz = self.get_object()
        self._check_quiz_builder(quiz.tenant)

        upload = request.FILES.get('file')
        if not upload:
            raise ValidationError('file is required')

        old_url = quiz.exercise_file_url
        quiz.exercise_file_url = save_uploaded_document(upload, 'quizzes', quiz.id)
        quiz.exercise_file_name = upload.name[:255]
        quiz.save(update_fields=['exercise_file_url', 'exercise_file_name', 'updated_at'])
        if old_url and old_url != quiz.exercise_file_url:
            delete_uploaded_image(old_url, 'quizzes')
        return Response(QuizSerializer(quiz).data)

    @action(detail=True, methods=['post'], url_path='grade')
    def grade(self, request, pk=None):
        """Score one submission by hand and mirror it into Grades. Re-grading
        updates the existing Grade row rather than stacking duplicates."""
        self.check_module_modify()
        quiz = self.get_object()
        self._check_quiz_builder(quiz.tenant)

        attempt = quiz.attempts.filter(id=request.data.get('attempt_id')).select_related('student').first()
        if not attempt:
            raise NotFound('Submission not found')

        try:
            score = float(request.data.get('score'))
        except (TypeError, ValueError):
            raise ValidationError('score must be a number')
        max_score = float(attempt.max_score or quiz.max_score or 20)
        if score < 0 or score > max_score:
            raise ValidationError(f'score must be between 0 and {max_score:g}')

        with transaction.atomic():
            attempt.score = score
            attempt.max_score = max_score
            attempt.feedback = (request.data.get('feedback') or '').strip() or None
            attempt.graded_at = timezone.now()
            attempt.save(update_fields=['score', 'max_score', 'feedback', 'graded_at'])

            if attempt.student_id:
                # Keyed on this specific attempt, not just (student, title)
                # — two different attempts from the same student for the
                # same quiz (e.g. a resubmission) now each get their own
                # Grade row instead of the second grading silently
                # overwriting the first's score with no warning.
                Grade.objects.update_or_create(
                    tenant_id=quiz.tenant_id,
                    quiz_attempt=attempt,
                    defaults={
                        'student_id': attempt.student_id,
                        'title': quiz.title,
                        'course': quiz.course,
                        'score': score,
                        'max_score': max_score,
                        'date': timezone.now().date(),
                    },
                )
        return Response(QuizAttemptSerializer(attempt).data)

    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        self.check_module_modify()
        quiz = self.get_object()
        self._check_quiz_builder(quiz.tenant)
        if not quiz.group_id:
            raise ValidationError('Assign a group to this quiz before publishing.')
        if not quiz.exercise_file_url:
            raise ValidationError('Upload the exercise (photo or PDF) before publishing.')

        # ONE shared link for the whole class — generated once and reused on
        # every re-publish, so a link already shared with students doesn't
        # go stale if the teacher swaps the exercise and republishes.
        if not quiz.public_token:
            quiz.public_token = secrets.token_urlsafe(24)
        quiz.status = 'published'
        quiz.save(update_fields=['status', 'public_token', 'updated_at'])

        frontend = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000').rstrip('/')
        return Response({
            'quiz': QuizSerializer(quiz).data,
            'take_url': f"{frontend}/quiz/take/{quiz.public_token}",
        })

    @action(detail=True, methods=['get'])
    def results(self, request, pk=None):
        quiz = self.get_object()
        attempts = quiz.attempts.select_related('student').prefetch_related('files').order_by('-created_at')
        return Response({'items': QuizAttemptSerializer(attempts, many=True).data})


class ConversationViewSet(TenantScopedViewSet):
    queryset = Conversation.objects.all()
    serializer_class = ConversationSerializer
    module_key = 'messages'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset()).select_related('guardian')
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(
                Q(guardian__name__icontains=q) | Q(guardian__email__icontains=q)
            )
        queryset = queryset.order_by('-last_message_at', '-created_at')[:200]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        user = request.user
        guardian = Guardian.objects.filter(id=request.data.get('guardian_id'), tenant_id=user.tenant_id).first()
        if not guardian:
            raise NotFound('Parent not found')

        convo, _ = Conversation.objects.get_or_create(tenant_id=user.tenant_id, guardian=guardian)
        return Response(self.get_serializer(convo).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'post'])
    def messages(self, request, pk=None):
        convo = self.get_object()

        if request.method == 'POST':
            self.check_module_add()
            body = (request.data.get('body') or '').strip()
            if not body:
                return Response({'error': 'Message body is required'}, status=status.HTTP_400_BAD_REQUEST)
            if len(body) > 10000:
                return Response({'error': 'Message is too long (10,000 characters max).'}, status=status.HTTP_400_BAD_REQUEST)
            now = timezone.now()
            Message.objects.create(
                tenant_id=request.user.tenant_id, conversation=convo,
                sender_user=request.user, sender_role='staff', body=body,
            )
            convo.last_message_at = now
            convo.last_read_by_staff_at = now
            convo.save(update_fields=['last_message_at', 'last_read_by_staff_at', 'updated_at'])
        else:
            now = timezone.now()
            convo.last_read_by_staff_at = now
            convo.save(update_fields=['last_read_by_staff_at', 'updated_at'])

        # Per-user read position — see ConversationStaffRead's docstring for
        # why this can't just be the conversation-wide field above (that one
        # stays too, as a cheap "has ANY staff member seen this" signal).
        ConversationStaffRead.objects.update_or_create(
            conversation=convo, user=request.user, defaults={'last_read_at': now},
        )

        # Newest 500, oldest-first for display — taking the first 500
        # chronologically instead used to silently hide the newest messages
        # once a thread passed 500 total, with no pagination to reach them.
        items = list(convo.messages.select_related('sender_user').order_by('-created_at')[:500])
        items.reverse()
        return Response({'items': MessageSerializer(items, many=True).data, 'total': len(items)})
