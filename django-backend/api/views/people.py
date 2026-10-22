"""Tenants (schools), users, coupons, parents, teachers and students."""
import csv
import re
import io
import secrets
from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound
from ..models import (
    Tenant,
    User,
    TenantMembership,
    Guardian,
    Teacher,
    Student,
    Group,
    Payment,
    PasswordResetToken,
    Coupon,
    SchoolGalleryPhoto,
    PERMISSION_MODULES,
    PERMISSION_FLAGS,
)
from ..serializers import validate_hex_color
from ..serializers import (
    TenantSerializer,
    UserSerializer,
    GuardianSerializer,
    TeacherSerializer,
    StudentSerializer,
    CouponSerializer,
    SchoolGalleryPhotoSerializer,
)
from ..services import log_activity
from .common import (
    GALLERY_MAX_PHOTOS,
    PLANS_CONFIG,
    TenantScopedViewSet,
    _next_sequence_code,
    check_website_builder,
    delete_uploaded_image,
    export_rows,
    issue_reset_token,
    name_search_q,
    password_policy_error,
    save_uploaded_document,
    save_uploaded_image,
)
from .platform_admin import (
    _delete_tenant_cascade,
)


# ViewSets implementing standard CRUD
class TenantViewSet(viewsets.ModelViewSet):
    queryset = Tenant.objects.all()
    serializer_class = TenantSerializer

    def retrieve(self, request, *args, **kwargs):
        user = request.user
        tenant_id = kwargs.get('pk')
        if not user.is_super_admin() and tenant_id != user.tenant_id:
            raise PermissionDenied('Forbidden')
        if not user.is_super_admin() and not user.can_view('settings'):
            raise PermissionDenied('Forbidden')
        tenant = Tenant.objects.filter(id=tenant_id).first()
        if not tenant:
            raise NotFound('Not found')
        return Response(TenantSerializer(tenant).data)

    def destroy(self, request, *args, **kwargs):
        if not request.user.is_super_admin():
            raise PermissionDenied('Forbidden')
        tenant = Tenant.objects.filter(id=kwargs.get('pk')).first()
        if not tenant:
            raise NotFound('Not found')
        _delete_tenant_cascade(tenant)
        return Response({'ok': True})

    @action(detail=False, methods=['get'], url_path='by-slug/(?P<slug>[^/.]+)', permission_classes=[AllowAny])
    def by_slug(self, request, slug):
        tenant = Tenant.objects.filter(slug=slug.strip().lower()).first()
        if not tenant:
            raise NotFound('Tenant not found')
            
        public_fields = ['id', 'name', 'slug', 'center_type', 'status', 'logo_url', 'primary_color', 'accent_color', 'language']
        # Serialize subset
        data = {}
        for f in public_fields:
            val = getattr(tenant, f)
            if hasattr(val, 'isoformat'): # DateTime
                val = val.isoformat()
            data[f] = val
        return Response(data)

    def list(self, request, *args, **kwargs):
        if not request.user.is_super_admin():
            raise PermissionDenied('Forbidden')
        queryset = self.get_queryset()
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        if not request.user.is_super_admin():
            raise PermissionDenied('Forbidden')

        # Two owner modes: create a brand-new owner account (default, as
        # before), or attach this new workspace to an existing owner/
        # director's login via TenantMembership — the admin-side equivalent
        # of a self-service owner clicking "add another school", except the
        # admin can do it on any existing owner's behalf. In link mode the
        # owner_name/email/password fields aren't needed at all.
        link_to_owner_email = (request.data.get('link_to_owner_email') or '').strip().lower()

        required_fields = ['name', 'slug']
        if not link_to_owner_email:
            required_fields += ['owner_email', 'owner_password', 'owner_name']
        for f in required_fields:
            if not request.data.get(f):
                return Response({'error': f'{f} is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not link_to_owner_email:
            password_error = password_policy_error(request.data.get('owner_password'),
                                                   request.data.get('owner_email'), request.data.get('owner_name'))
            if password_error:
                return Response({'error': password_error}, status=status.HTTP_400_BAD_REQUEST)

        slug = request.data['slug'].strip().lower()
        if not re.match(r'^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$', slug):
            return Response({'error': 'Invalid slug'}, status=status.HTTP_400_BAD_REQUEST)

        if Tenant.objects.filter(slug=slug).exists():
            return Response({'error': 'Slug already taken'}, status=status.HTTP_409_CONFLICT)

        existing_owner = None
        if link_to_owner_email:
            existing_owner = User.objects.filter(email=link_to_owner_email).first()
            if not existing_owner:
                return Response({'error': 'No account with that owner email exists'}, status=status.HTTP_404_NOT_FOUND)
            if existing_owner.role not in ('owner', 'director'):
                return Response({'error': 'That account is not an owner/director'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            email = request.data['owner_email'].strip().lower()
            if User.objects.filter(email=email).exists():
                return Response({'error': 'Owner email already registered'}, status=status.HTTP_409_CONFLICT)

        # Optional: grant a plan directly (skips Chargily entirely) for a
        # duration the super admin picks — e.g. comping a school, running a
        # trial, a sales demo. Once set, the tenant's existing renew/upgrade
        # flows (billing_renew/billing_upgrade) already work unmodified off
        # of plan/status/plan_expires_at, so "purchase and extend later"
        # needs no extra wiring beyond populating those fields correctly here.
        plan = request.data.get('plan') or None
        if plan and plan not in PLANS_CONFIG['tiers']:
            return Response({'error': 'Invalid plan'}, status=status.HTTP_400_BAD_REQUEST)

        plan_expires_at = None
        if plan:
            try:
                duration_days = int(request.data.get('duration_days') or 30)
            except (TypeError, ValueError):
                return Response({'error': 'duration_days must be an integer'}, status=status.HTTP_400_BAD_REQUEST)
            if duration_days < 1:
                return Response({'error': 'duration_days must be at least 1'}, status=status.HTTP_400_BAD_REQUEST)
            plan_expires_at = timezone.now() + timedelta(days=duration_days)

        with transaction.atomic():
            tenant_fields = dict(
                name=request.data['name'].strip(),
                slug=slug,
                center_type=request.data.get('center_type', 'tutoring') or 'tutoring',
                status='active',
            )
            if plan:
                tier = PLANS_CONFIG['tiers'][plan]
                tenant_fields.update(
                    plan=plan,
                    billing_cycle='monthly',
                    max_students=tier['max_students'],
                    max_users=tier['max_users'],
                    plan_started_at=timezone.now(),
                    plan_expires_at=plan_expires_at,
                )
            tenant = Tenant.objects.create(**tenant_fields)

            if existing_owner:
                owner = existing_owner
                # Their very first membership is trivially their principal
                # school; later ones stay non-primary unless the admin
                # explicitly changes it via admin_set_tenant_ownership.
                is_first_membership = not TenantMembership.objects.filter(user=owner).exists()
                TenantMembership.objects.create(user=owner, tenant=tenant, role='owner', is_primary=is_first_membership)
                # Deliberately NOT switching the owner's active tenant here —
                # unlike owner_create_school (self-service, the caller IS the
                # owner and expects to land in what they just created), this
                # is an admin acting on someone else's behalf; silently
                # moving them out of whatever school they're actively using
                # right now would be surprising. They switch via the
                # workspace dropdown themselves whenever they're ready.
            else:
                owner = User.objects.create_user(
                    email=email,
                    password=request.data['owner_password'],
                    name=request.data['owner_name'].strip(),
                    tenant=tenant,
                    role='owner',
                    email_verified=True
                )
                TenantMembership.objects.create(user=owner, tenant=tenant, role='owner', is_primary=True)

        return Response({
            'tenant': TenantSerializer(tenant).data,
            'owner': UserSerializer(owner).data
        })

    def update(self, request, *args, **kwargs):
        user = request.user
        if not user.is_super_admin() and user.role not in ['owner', 'director']:
            raise PermissionDenied('Forbidden')
            
        tenant_id = kwargs.get('pk')
        if not user.is_super_admin() and tenant_id != user.tenant_id:
            raise PermissionDenied('Cannot edit another tenant')
            
        tenant = Tenant.objects.filter(id=tenant_id).first()
        if not tenant:
            raise NotFound('Not found')
            
        website_fields = {'enrollment_description', 'address', 'phone', 'map_url', 'social_links', 'hero_image_url'}
        owner_editable = [
            'name', 'center_type', 'logo_url', 'primary_color', 'accent_color',
            'language', 'currency', 'timezone', 'invoice_prefix', 'student_prefix',
            'timetable_end_time',
            *website_fields,
        ]

        updates = {}
        for key, val in request.data.items():
            if user.is_super_admin():
                if key not in ['id', 'created_at', 'slug']:
                    updates[key] = val
            else:
                if key in owner_editable:
                    updates[key] = val

        if not updates:
            return Response({'error': 'No editable fields in payload'}, status=status.HTTP_400_BAD_REQUEST)

        # These values end up inside inline styles and printable HTML, so
        # they must be plain values: hex colors, and image paths produced by
        # our own upload endpoints (never an arbitrary URL or markup).
        for key in ('primary_color', 'accent_color'):
            if key in updates:
                updates[key] = validate_hex_color(updates[key]) or Tenant._meta.get_field(key).default
        for key, subdir in (('logo_url', 'logos'), ('hero_image_url', 'hero')):
            val = updates.get(key)
            # The settings form resubmits the stored value unchanged; only
            # new values are checked, so older stored paths keep working.
            if val and val != getattr(tenant, key) and not re.fullmatch(rf'/uploads/{subdir}/[A-Za-z0-9._-]+', str(val)):
                raise ValidationError({key: 'Upload the image instead of pasting a link.'})

        if website_fields & updates.keys():
            check_website_builder(user, tenant)

        # logo_url sat in owner_editable with no equivalent check at all —
        # a plain PATCH here bypassed both the plan gate AND the Pillow
        # decode/size/EXIF validation the real /logo upload action
        # enforces, accepting any string (including a non-image URL) on a
        # plan that shouldn't have custom branding at all.
        if 'logo_url' in updates and not user.is_super_admin():
            custom_branding = bool(tenant.plan) and PLANS_CONFIG['tiers'][tenant.plan].get('custom_branding', False)
            if not custom_branding:
                raise PermissionDenied('Custom branding (logo upload) is available on the Standard and Premium plans. Upgrade your plan to use it.')

        for key, val in updates.items():
            setattr(tenant, key, val)
        tenant.save()
        
        return Response(TenantSerializer(tenant).data)

    @action(detail=True, methods=['post'], url_path='logo')
    def upload_logo(self, request, pk=None):
        user = request.user
        if not user.is_super_admin() and user.role != 'owner':
            raise PermissionDenied('Forbidden')
        if not user.is_super_admin() and pk != user.tenant_id:
            raise PermissionDenied('Cannot edit another tenant')
            
        if 'file' not in request.FILES:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        tenant = Tenant.objects.filter(id=pk).first()
        if not tenant:
            raise NotFound('Tenant not found')

        # Plan branding eligibility check
        custom_branding = False
        if tenant.plan:
            custom_branding = PLANS_CONFIG['tiers'][tenant.plan].get('custom_branding', False)
        if not user.is_super_admin() and not custom_branding:
            raise PermissionDenied('Custom branding (logo upload) is available on the Standard and Premium plans. Upgrade your plan to use it.')

        # Shared helper: validates it's a real image, strips EXIF, downscales
        # and recompresses (see save_uploaded_image).
        new_url = save_uploaded_image(request.FILES['file'], 'logos', pk)
        delete_uploaded_image(tenant.logo_url, 'logos')
        tenant.logo_url = new_url
        tenant.save()

        return Response(TenantSerializer(tenant).data)

    @action(detail=True, methods=['post'], url_path='hero-image')
    def upload_hero_image(self, request, pk=None):
        user = request.user
        if not user.is_super_admin() and user.role != 'owner':
            raise PermissionDenied('Forbidden')
        if not user.is_super_admin() and pk != user.tenant_id:
            raise PermissionDenied('Cannot edit another tenant')
        if 'file' not in request.FILES:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        tenant = Tenant.objects.filter(id=pk).first()
        if not tenant:
            raise NotFound('Tenant not found')
        check_website_builder(user, tenant)

        new_url = save_uploaded_image(request.FILES['file'], 'hero', pk)
        delete_uploaded_image(tenant.hero_image_url, 'hero')
        tenant.hero_image_url = new_url
        tenant.save()

        return Response(TenantSerializer(tenant).data)

    @action(detail=True, methods=['get', 'post'], url_path='gallery')
    def gallery(self, request, pk=None):
        user = request.user
        if not user.is_super_admin() and pk != user.tenant_id:
            raise PermissionDenied('Cannot access another tenant')

        tenant = Tenant.objects.filter(id=pk).first()
        if not tenant:
            raise NotFound('Tenant not found')

        if request.method == 'GET':
            photos = tenant.gallery_photos.all()
            return Response({'items': SchoolGalleryPhotoSerializer(photos, many=True).data})

        if not user.is_super_admin() and user.role != 'owner':
            raise PermissionDenied('Forbidden')
        check_website_builder(user, tenant)
        if 'file' not in request.FILES:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        # Hard cap — without one, a single tenant can fill the VPS disk one
        # upload at a time (there's no per-tenant storage quota anywhere else).
        next_order = tenant.gallery_photos.count()
        if next_order >= GALLERY_MAX_PHOTOS:
            raise ValidationError(f'A gallery can hold up to {GALLERY_MAX_PHOTOS} photos. Delete one to add another.')

        image_url = save_uploaded_image(request.FILES['file'], 'gallery', pk)
        photo = SchoolGalleryPhoto.objects.create(
            tenant=tenant, image_url=image_url,
            caption=(request.data.get('caption') or '').strip() or None,
            order=next_order,
        )
        return Response(SchoolGalleryPhotoSerializer(photo).data, status=status.HTTP_200_OK)


def _clean_permissions(raw):
    """Validate a {module: {view, add, modify, delete}} payload against the
    known modules/flags. Returns a cleaned dict (unknown modules and flag
    keys dropped, non-true flags omitted) or raises ValidationError."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValidationError({'permissions': 'Must be an object of module -> {view, add, modify, delete}'})
    cleaned = {}
    for module_key, flags in raw.items():
        if module_key not in PERMISSION_MODULES:
            continue
        if not isinstance(flags, dict):
            raise ValidationError({'permissions': f"Invalid value for '{module_key}' — expected an object"})
        entry = {}
        for flag_key, flag_val in flags.items():
            if flag_key not in PERMISSION_FLAGS:
                continue
            if not isinstance(flag_val, bool):
                raise ValidationError({'permissions': f"Invalid value for '{module_key}.{flag_key}' — expected true/false"})
            if flag_val:
                entry[flag_key] = True
        cleaned[module_key] = entry
    return cleaned


class CouponViewSet(viewsets.ModelViewSet):
    # Platform-wide resource (Coupon has no tenant) — every action is
    # super-admin-only, same gating style as TenantViewSet's list/create.
    queryset = Coupon.objects.all().order_by('-created_at')
    serializer_class = CouponSerializer

    def _require_super_admin(self, request):
        if not request.user.is_super_admin():
            raise PermissionDenied('Forbidden')

    def list(self, request, *args, **kwargs):
        self._require_super_admin(request)
        serializer = self.get_serializer(self.get_queryset(), many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def retrieve(self, request, *args, **kwargs):
        self._require_super_admin(request)
        return super().retrieve(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        self._require_super_admin(request)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(created_by=request.user)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        self._require_super_admin(request)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._require_super_admin(request)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self._require_super_admin(request)
        return super().destroy(request, *args, **kwargs)


class UserViewSet(TenantScopedViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    # Without this, check_module_view() is a no-op for every action on this
    # ViewSet (it only fires when module_key is set) — list()/retrieve() were
    # reachable by any authenticated staff member regardless of role or
    # granted permissions, leaking every user's email/role/permissions JSON.
    module_key = 'users'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        role = request.GET.get('role')
        if role:
            queryset = queryset.filter(role=role)
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(
                Q(name__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q)
            )
        queryset = queryset.order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    def create(self, request, *args, **kwargs):
        user = request.user
        if not user.is_super_admin() and user.role not in ['owner', 'director']:
            raise PermissionDenied('Only owners/directors can add users')
            
        # Validate role
        role = request.data.get('role')
        tenant_assignable = ['owner', 'director', 'secretary', 'accountant', 'teacher', 'parent', 'student']
        if role not in tenant_assignable:
            return Response({'error': 'Invalid role'}, status=status.HTTP_400_BAD_REQUEST)
            
        email = request.data.get('email')
        password = request.data.get('password')
        name = request.data.get('name')
        
        if not email or not password or not name:
            return Response({'error': 'email, password and name are required'}, status=status.HTTP_400_BAD_REQUEST)
        password_error = password_policy_error(password, email, name)
        if password_error:
            return Response({'error': password_error}, status=status.HTTP_400_BAD_REQUEST)
            
        email_clean = email.strip().lower()
        if User.objects.filter(email=email_clean).exists():
            return Response({'error': 'Email already registered'}, status=status.HTTP_409_CONFLICT)
            
        # Check quota
        if user.tenant_id:
            tenant = Tenant.objects.filter(id=user.tenant_id).first()
            if tenant and tenant.max_users is not None:
                current_count = User.objects.filter(tenant_id=user.tenant_id).count()
                if current_count >= tenant.max_users:
                    raise PermissionDenied(f"Your {tenant.plan} plan allows up to {tenant.max_users} users. Upgrade your plan to add more.")
                    
        permissions = _clean_permissions(request.data.get('permissions'))

        with transaction.atomic():
            new_user = User.objects.create_user(
                email=email_clean,
                password=password,
                name=name.strip(),
                tenant=user.tenant,
                role=role,
                phone=request.data.get('phone'),
                email_verified=True,
                permissions=permissions,
            )

        return Response(UserSerializer(new_user).data)

    def update(self, request, *args, **kwargs):
        user = request.user
        if not user.is_super_admin() and user.role not in ['owner', 'director']:
            raise PermissionDenied('Forbidden')
            
        target_id = kwargs.get('pk')
        target = self.filter_queryset(self.get_queryset()).filter(id=target_id).first()
        if not target:
            raise NotFound('Not found')
            
        if target.role == 'super_admin':
            return Response({'error': 'Cannot edit a super admin account'}, status=status.HTTP_400_BAD_REQUEST)
            
        updates = {}
        if 'name' in request.data and request.data['name'] is not None:
            name = request.data['name'].strip()
            if not name:
                return Response({'error': 'Name cannot be empty'}, status=status.HTTP_400_BAD_REQUEST)
            updates['name'] = name
            
        if 'phone' in request.data:
            updates['phone'] = request.data['phone']
            
        if 'role' in request.data and request.data['role'] is not None:
            role = request.data['role']
            tenant_assignable = ['owner', 'director', 'secretary', 'accountant', 'teacher', 'parent', 'student']
            if role not in tenant_assignable:
                return Response({'error': 'Invalid role'}, status=status.HTTP_400_BAD_REQUEST)
            updates['role'] = role
            
        if 'is_active' in request.data and request.data['is_active'] is not None:
            is_active_val = bool(request.data['is_active'])
            if target_id == user.id and not is_active_val:
                return Response({'error': 'Cannot deactivate your own account'}, status=status.HTTP_400_BAD_REQUEST)
            updates['is_active'] = is_active_val
            
        if 'email' in request.data and request.data['email'] is not None:
            email_clean = request.data['email'].strip().lower()
            if email_clean != target.email and User.objects.filter(email=email_clean).exists():
                return Response({'error': 'Email already registered'}, status=status.HTTP_409_CONFLICT)
            updates['email'] = email_clean

        if 'permissions' in request.data:
            updates['permissions'] = _clean_permissions(request.data['permissions'])

        if not updates:
            return Response({'error': 'No editable fields in payload'}, status=status.HTTP_400_BAD_REQUEST)
            
        for key, val in updates.items():
            setattr(target, key, val)
        target.save()
        
        return Response(UserSerializer(target).data)

    def destroy(self, request, *args, **kwargs):
        user = request.user
        if not user.is_super_admin() and user.role not in ['owner', 'director']:
            raise PermissionDenied('Forbidden')
            
        target_id = kwargs.get('pk')
        if target_id == user.id:
            return Response({'error': 'Cannot delete yourself'}, status=status.HTTP_400_BAD_REQUEST)
            
        target = self.filter_queryset(self.get_queryset()).filter(id=target_id).first()
        if not target:
            raise NotFound('Not found')
            
        if target.role == 'super_admin':
            return Response({'error': 'Cannot delete a super admin account'}, status=status.HTTP_400_BAD_REQUEST)
            
        target.delete()
        return Response({'ok': True})


class GuardianViewSet(TenantScopedViewSet):
    queryset = Guardian.objects.all()
    serializer_class = GuardianSerializer
    module_key = 'parents'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(
                Q(name__icontains=q) | Q(name_latin__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q)
            )
        queryset = queryset.prefetch_related('students').order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset()).prefetch_related('students').order_by('-created_at')
        headers = ['Name', 'Name (Latin)', 'Email', 'Phone', 'Address', 'Occupation', 'Relationship', 'Emergency Contact', 'Students']
        rows = [[
            g.name, g.name_latin or '', g.email or '', g.phone or '', g.address or '', g.occupation or '', g.relationship,
            g.emergency_contact or '', ', '.join(f"{s.first_name} {s.last_name}" for s in g.students.all()),
        ] for g in queryset]
        return export_rows(headers, rows, 'parents', request.GET.get('type'))

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        data = request.data.copy()
        student_ids = data.pop('student_ids', None)

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        guardian = serializer.instance

        if student_ids:
            Student.objects.filter(id__in=student_ids, tenant_id=guardian.tenant_id).update(parent=guardian)

        return Response(self.get_serializer(guardian).data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        self.check_module_modify()
        instance = self.get_object()
        data = request.data.copy()
        student_ids = data.pop('student_ids', None)

        serializer = self.get_serializer(instance, data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        if student_ids is not None:
            Student.objects.filter(parent=instance, tenant_id=instance.tenant_id).exclude(id__in=student_ids).update(parent=None)
            Student.objects.filter(id__in=student_ids, tenant_id=instance.tenant_id).update(parent=instance)

        return Response(self.get_serializer(instance).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """A guardian self-registered via the public enrollment page
        (source='public') starts life as approval_status='pending', in
        lockstep with the student created in the same enrollment. Approving
        either one cascades to the other — they're two halves of one
        application — but only touches counterparts still 'pending', so it
        never overwrites an explicit prior rejection."""
        self.check_module_modify()
        guardian = self.get_object()
        guardian.approval_status = 'approved'
        guardian.save(update_fields=['approval_status', 'updated_at'])
        guardian.students.filter(approval_status='pending').update(approval_status='approved')
        log_activity(request, guardian.tenant_id, 'update', entity_type='parents', entity_id=guardian.id,
                     description=f'Approved enrollment: {guardian.name}')
        return Response(GuardianSerializer(guardian).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        self.check_module_modify()
        guardian = self.get_object()
        guardian.approval_status = 'rejected'
        guardian.save(update_fields=['approval_status', 'updated_at'])
        guardian.students.filter(approval_status='pending').update(approval_status='rejected')
        log_activity(request, guardian.tenant_id, 'update', entity_type='parents', entity_id=guardian.id,
                     description=f'Rejected enrollment: {guardian.name}')
        return Response(GuardianSerializer(guardian).data)

    @action(detail=True, methods=['post'])
    def invite(self, request, pk=None):
        user = request.user
        if not user.is_super_admin() and user.role not in ['owner', 'director', 'secretary']:
            raise PermissionDenied('Forbidden')

        tenant = Tenant.objects.filter(id=user.tenant_id).first()
        if not tenant:
            raise ValidationError('Tenant not found')

        parent_portal = bool(tenant.plan) and PLANS_CONFIG['tiers'][tenant.plan].get('parent_portal', False)
        if not user.is_super_admin() and not parent_portal:
            raise PermissionDenied('The parent portal is available on the Standard and Premium plans. Upgrade your plan to invite parents.')

        guardian = self.get_object()
        if not guardian.email:
            return Response({'error': 'Add an email to this parent before inviting them'}, status=status.HTTP_400_BAD_REQUEST)

        email = guardian.email.strip().lower()
        existing = User.objects.filter(email=email).first()
        if existing and existing.id != (guardian.user_id or ''):
            return Response({'error': 'This email is already registered to a different account'}, status=status.HTTP_409_CONFLICT)

        if guardian.user_id:
            invited_user = guardian.user
        else:
            invited_user = User.objects.create_user(
                email=email,
                name=guardian.name,
                tenant=tenant,
                role='parent',
                email_verified=False,
            )
            invited_user.set_unusable_password()
            invited_user.save()
            guardian.user = invited_user
            guardian.save(update_fields=['user', 'updated_at'])

        token = issue_reset_token(invited_user, timedelta(days=7))
        invite_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
        return Response({'guardian': GuardianSerializer(guardian).data, 'invite_url': invite_url})


class TeacherViewSet(TenantScopedViewSet):
    queryset = Teacher.objects.all()
    serializer_class = TeacherSerializer
    module_key = 'teachers'

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        q = request.GET.get('q')
        if q:
            queryset = queryset.filter(name_search_q(q, 'first_name', 'last_name', 'first_name_latin', 'last_name_latin', 'email'))
        queryset = queryset.order_by('-created_at')[:500]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset()).order_by('-created_at')
        headers = ['First Name', 'Last Name', 'First Name (Latin)', 'Last Name (Latin)', 'Email', 'Phone', 'Address', 'Subjects', 'Hourly Rate', 'Monthly Salary', 'Status', 'Hire Date']
        rows = [[
            t.first_name, t.last_name, t.first_name_latin or '', t.last_name_latin or '', t.email or '', t.phone or '', t.address or '',
            ', '.join(t.subjects) if t.subjects else '', t.hourly_rate, t.monthly_salary, t.status,
            t.hire_date.isoformat() if t.hire_date else '',
        ] for t in queryset]
        return export_rows(headers, rows, 'teachers', request.GET.get('type'))

    @action(detail=True, methods=['post'], url_path='photo')
    def upload_photo(self, request, pk=None):
        self.check_module_modify()
        teacher = self.get_object()
        tenant = Tenant.objects.filter(id=teacher.tenant_id).first()
        check_website_builder(request.user, tenant)
        if 'file' not in request.FILES:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        new_url = save_uploaded_image(request.FILES['file'], 'teachers', teacher.id)
        delete_uploaded_image(teacher.photo_url, 'teachers')
        teacher.photo_url = new_url
        teacher.save(update_fields=['photo_url', 'updated_at'])
        return Response(TeacherSerializer(teacher).data)

    @action(detail=True, methods=['post'], url_path='cv')
    def upload_cv(self, request, pk=None):
        self.check_module_modify()
        teacher = self.get_object()
        if 'file' not in request.FILES:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        new_url = save_uploaded_document(request.FILES['file'], 'documents', f'{teacher.id}-cv')
        delete_uploaded_image(teacher.cv_url, 'documents')
        teacher.cv_url = new_url
        teacher.save(update_fields=['cv_url', 'updated_at'])
        return Response(TeacherSerializer(teacher).data)

    @action(detail=True, methods=['post'], url_path='diploma')
    def upload_diploma(self, request, pk=None):
        self.check_module_modify()
        teacher = self.get_object()
        if 'file' not in request.FILES:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)

        new_url = save_uploaded_document(request.FILES['file'], 'documents', f'{teacher.id}-diploma')
        delete_uploaded_image(teacher.diploma_url, 'documents')
        teacher.diploma_url = new_url
        teacher.save(update_fields=['diploma_url', 'updated_at'])
        return Response(TeacherSerializer(teacher).data)

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        data = request.data.copy()
        # Auto hire date
        data['hire_date'] = timezone.now().date().isoformat()
        self._guard_percentage_edit(request, data)

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        self.check_module_modify()
        self._guard_percentage_edit(request, request.data, current=self.get_object())
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self.check_module_modify()
        self._guard_percentage_edit(request, request.data, current=self.get_object())
        return super().partial_update(request, *args, **kwargs)

    def _guard_percentage_edit(self, request, data, current=None):
        """Teacher.payment_percentage and Teacher.book_percentage both decide
        real money owed at payout time, so unlike the rest of this form
        neither is gated by the Teachers tab's own 'edit' permission —
        they're gated by 'modify' on Teacher payments instead (the module
        whose page actually offers these fields), same as an owner/director/
        super admin always get via their full-access shortcut.

        But the Teachers edit form is pre-filled from the full teacher
        record and resubmits every field verbatim on save — including these,
        with no input for them there — so both show up in the payload on
        every edit regardless of whether anyone touched them. Only enforce
        the permission when a value is actually *changing* from what's
        already stored; a secretary with modify on Teachers but no access at
        all to Teacher payments can otherwise freely edit a teacher's other
        fields without ever tripping this, exactly because they have no way
        to change either one in the first place."""
        user = request.user
        for field in ('payment_percentage', 'book_percentage'):
            if field not in data:
                continue
            try:
                pct = float(data[field])
            except (TypeError, ValueError):
                raise ValidationError(f'{field} must be a number')
            if pct < 0 or pct > 100:
                raise ValidationError(f'{field} must be between 0 and 100')
            if current is not None and pct == float(getattr(current, field)):
                continue
            if not user.is_super_admin() and not user.can_modify('teacher_payments'):
                raise PermissionDenied('You do not have permission to set teacher payment percentages.')

    @action(detail=True, methods=['post'])
    def invite(self, request, pk=None):
        user = request.user
        if not user.is_super_admin() and user.role not in ['owner', 'director', 'secretary']:
            raise PermissionDenied('Forbidden')

        tenant = Tenant.objects.filter(id=user.tenant_id).first()
        if not tenant:
            raise ValidationError('Tenant not found')

        teacher = self.get_object()
        if not teacher.email:
            return Response({'error': 'Add an email to this teacher before inviting them'}, status=status.HTTP_400_BAD_REQUEST)

        email = teacher.email.strip().lower()
        existing = User.objects.filter(email=email).first()
        if existing and existing.id != (teacher.user_id or ''):
            return Response({'error': 'This email is already registered to a different account'}, status=status.HTTP_409_CONFLICT)

        if teacher.user_id:
            invited_user = teacher.user
        else:
            invited_user = User.objects.create_user(
                email=email,
                name=f"{teacher.first_name} {teacher.last_name}".strip(),
                tenant=tenant,
                role='teacher',
                email_verified=False,
            )
            invited_user.set_unusable_password()
            invited_user.save()
            teacher.user = invited_user
            teacher.save(update_fields=['user', 'updated_at'])

        token = issue_reset_token(invited_user, timedelta(days=7))
        invite_url = f"{settings.FRONTEND_URL}/reset-password?token={token}"
        return Response({'teacher': TeacherSerializer(teacher).data, 'invite_url': invite_url})


class StudentViewSet(TenantScopedViewSet):
    queryset = Student.objects.all()
    serializer_class = StudentSerializer
    module_key = 'students'
    module_view_exempt_actions = ['verify']

    def list(self, request, *args, **kwargs):
        # select_related keeps the serializer's new parent_name field from
        # firing a query per row.
        queryset = self.filter_queryset(self.get_queryset()).select_related('parent')
        status_val = request.GET.get('status')
        if status_val:
            queryset = queryset.filter(status=status_val)
        q = request.GET.get('q')
        if q:
            # Also matches the raw id exactly — a PC-connected QR scanner
            # acts as a keyboard, "typing" the scanned card's payload (the
            # student's id, see student_id_cards_print) straight into
            # whichever search box has focus and hitting Enter. Without this,
            # a scan would search name/email/phone/code for a UUID and never
            # match anything.
            queryset = queryset.filter(
                name_search_q(q, 'first_name', 'last_name', 'first_name_latin', 'last_name_latin', 'email', 'phone', 'student_code') | Q(id=q)
            )
        ids_param = request.GET.get('ids')
        if ids_param:
            queryset = queryset.filter(id__in=[i for i in ids_param.split(',') if i])
        # A picker searching a tenant with thousands of students only wants a
        # handful of matches, not the full 500-row cap this endpoint normally
        # allows — capped at that same 500 either way.
        try:
            limit = min(int(request.GET.get('limit', 500)), 500)
        except (TypeError, ValueError):
            limit = 500
        queryset = queryset.order_by('-created_at')[:limit]
        serializer = self.get_serializer(queryset, many=True)
        return Response({'items': serializer.data, 'total': len(serializer.data)})

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset()).select_related('parent').order_by('-created_at')
        headers = [
            'Student Code', 'First Name', 'Last Name', 'First Name (Latin)', 'Last Name (Latin)', 'Gender', 'School Level', 'School Year', 'Specialty',
            'Insurance', 'Health Condition', 'Blood Type',
            'Birth Date', 'Email', 'Phone', 'Address',
            'Emergency Contact', 'Status', 'Parent Name', 'Parent Email', 'Parent Phone', 'Parent ID Card Number', 'Enrollment Date',
        ]
        rows = [[
            s.student_code or '', s.first_name, s.last_name, s.first_name_latin or '', s.last_name_latin or '', s.gender or '',
            s.school_level or '', s.school_year or '', s.specialty or '',
            s.insurance_status or '', s.health_condition or '', s.blood_type or '',
            s.birth_date.isoformat() if s.birth_date else '', s.email or '', s.phone or '', s.address or '',
            s.emergency_contact or '', s.status, s.parent.name if s.parent else '',
            s.parent.email if s.parent and s.parent.email else '', s.parent.phone if s.parent and s.parent.phone else '',
            s.parent.id_card_number if s.parent and s.parent.id_card_number else '',
            s.enrollment_date.date().isoformat() if s.enrollment_date else '',
        ] for s in queryset]
        return export_rows(headers, rows, 'students', request.GET.get('type'))

    def create(self, request, *args, **kwargs):
        self.check_module_add()
        user = request.user
        tenant = Tenant.objects.filter(id=user.tenant_id).first()
        if not tenant:
            raise ValidationError('Tenant not found')

        count = Student.objects.filter(tenant_id=user.tenant_id).count()
        if tenant.max_students is not None and count >= tenant.max_students:
            raise PermissionDenied(f"Your {tenant.plan} plan allows up to {tenant.max_students} students. Upgrade your plan to add more.")

        data = request.data.copy()
        data['enrollment_date'] = timezone.now().isoformat()

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            # Locks this tenant's row so two concurrent creates can't
            # compute the same student_code — see _next_sequence_code.
            Tenant.objects.select_for_update().get(id=tenant.id)
            serializer.validated_data['student_code'] = _next_sequence_code(
                tenant.id, Student, 'student_code', tenant.student_prefix or 'STU-', 5,
            )
            self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='import')
    def import_csv(self, request):
        self.check_module_add()
        user = request.user
        tenant = Tenant.objects.filter(id=user.tenant_id).first()
        if not tenant:
            raise ValidationError('Tenant not found')

        upload = request.FILES.get('file')
        if not upload:
            return Response({'error': 'file is required'}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > 2 * 1024 * 1024:
            return Response({'error': 'CSV must be under 2MB'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            reader = csv.DictReader(io.TextIOWrapper(upload.file, encoding='utf-8-sig'))
            rows = list(reader)
        except (UnicodeDecodeError, csv.Error):
            return Response({'error': 'Could not parse file as CSV (UTF-8 expected)'}, status=status.HTTP_400_BAD_REQUEST)

        if len(rows) > 1000:
            return Response({'error': 'CSV cannot have more than 1000 rows'}, status=status.HTTP_400_BAD_REQUEST)

        existing_count = Student.objects.filter(tenant_id=tenant.id).count()
        max_students = tenant.max_students
        created_count = 0
        failed = []

        for i, row in enumerate(rows, start=2):  # row 1 is the header
            first_name = (row.get('first_name') or '').strip()
            last_name = (row.get('last_name') or '').strip()
            if not first_name or not last_name:
                failed.append({'row': i, 'error': 'first_name and last_name are required'})
                continue

            if max_students is not None and existing_count + created_count >= max_students:
                failed.append({'row': i, 'error': f'Your {tenant.plan} plan allows up to {max_students} students'})
                continue

            school_level = (row.get('school_level') or '').strip().lower()
            if school_level and school_level not in ('preschool', 'primary', 'middle', 'high'):
                failed.append({'row': i, 'error': 'school_level must be preschool, primary, middle, or high'})
                continue

            school_year_raw = (row.get('school_year') or '').strip()
            school_year = None
            if school_year_raw:
                try:
                    school_year = int(school_year_raw)
                except ValueError:
                    failed.append({'row': i, 'error': 'school_year must be a number'})
                    continue

            insurance_status = (row.get('insurance_status') or '').strip().lower()
            if insurance_status and insurance_status not in ('insured', 'uninsured'):
                failed.append({'row': i, 'error': 'insurance_status must be insured or uninsured'})
                continue

            blood_type = (row.get('blood_type') or '').strip().upper()
            if blood_type and blood_type not in dict(Student.BLOOD_TYPE_CHOICES):
                failed.append({'row': i, 'error': 'blood_type must be one of O+, O-, A+, A-, B+, B-, AB+, AB-'})
                continue

            try:
                with transaction.atomic():
                    # Locks this tenant's row so a concurrent request can't
                    # compute the same student_code — see _next_sequence_code.
                    Tenant.objects.select_for_update().get(id=tenant.id)
                    guardian = None
                    parent_email = (row.get('parent_email') or '').strip().lower()
                    if parent_email:
                        guardian, _ = Guardian.objects.get_or_create(
                            tenant=tenant, email=parent_email,
                            defaults={
                                'name': (row.get('parent_name') or parent_email).strip(),
                                'phone': (row.get('parent_phone') or '').strip(),
                                'id_card_number': (row.get('parent_id_card_number') or '').strip() or None,
                            },
                        )

                    student_code = _next_sequence_code(tenant.id, Student, 'student_code', tenant.student_prefix or 'STU-', 5)
                    Student.objects.create(
                        tenant=tenant,
                        parent=guardian,
                        first_name=first_name,
                        last_name=last_name,
                        email=(row.get('email') or '').strip() or None,
                        phone=(row.get('phone') or '').strip() or None,
                        gender=(row.get('gender') or '').strip() or None,
                        school_level=school_level or None,
                        school_year=school_year,
                        specialty=(row.get('specialty') or '').strip() or None,
                        insurance_status=insurance_status or None,
                        health_condition=(row.get('health_condition') or '').strip() or None,
                        blood_type=blood_type or None,
                        birth_date=(row.get('birth_date') or '').strip() or None,
                        address=(row.get('address') or '').strip() or None,
                        emergency_contact=(row.get('emergency_contact') or '').strip() or None,
                        student_code=student_code,
                        enrollment_date=timezone.now(),
                    )
                    created_count += 1
            except Exception as e:
                failed.append({'row': i, 'error': str(e)})

        return Response({'created': created_count, 'failed': failed, 'total': len(rows)})

    @action(detail=True, methods=['get'])
    def verify(self, request, pk=None):
        """Scanned-QR lookup for the teacher app: is this student enrolled
        here, and are they clear of overdue payments right now?"""
        student = self.get_object()

        # 'partial' counts as collected money elsewhere now — only a still-
        # fully-unpaid 'pending' invoice is genuinely overdue.
        has_overdue = Payment.objects.filter(
            tenant_id=student.tenant_id,
            student_id=student.id,
            status='pending',
            due_date__lt=timezone.now().date(),
        ).exists()

        groups = Group.objects.filter(tenant_id=student.tenant_id, students=student, status='active')

        return Response({
            'id': student.id,
            'first_name': student.first_name,
            'last_name': student.last_name,
            'student_code': student.student_code,
            'photo_url': student.photo_url,
            'status': student.status,
            'paid': not has_overdue,
            'groups': [g.name for g in groups],
        })

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """A student self-enrolled via the public page (source='public')
        starts life as approval_status='pending' — a secretary reviews and
        confirms them here before they count as a normal record. Cascades to
        the parent guardian created in the same enrollment (only if it's
        still pending — never overwrites an explicit prior decision on the
        guardian), since they're two halves of one application."""
        self.check_module_modify()
        student = self.get_object()
        student.approval_status = 'approved'
        student.save(update_fields=['approval_status', 'updated_at'])
        if student.parent_id and student.parent.approval_status == 'pending':
            student.parent.approval_status = 'approved'
            student.parent.save(update_fields=['approval_status', 'updated_at'])
        log_activity(request, student.tenant_id, 'update', entity_type='students', entity_id=student.id,
                     description=f'Approved enrollment: {student.first_name} {student.last_name}')
        return Response(StudentSerializer(student).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        self.check_module_modify()
        student = self.get_object()
        student.approval_status = 'rejected'
        student.save(update_fields=['approval_status', 'updated_at'])
        if student.parent_id and student.parent.approval_status == 'pending':
            student.parent.approval_status = 'rejected'
            student.parent.save(update_fields=['approval_status', 'updated_at'])
        log_activity(request, student.tenant_id, 'update', entity_type='students', entity_id=student.id,
                     description=f'Rejected enrollment: {student.first_name} {student.last_name}')
        return Response(StudentSerializer(student).data)


@api_view(['DELETE', 'PATCH'])
@permission_classes([IsAuthenticated])
def gallery_photo_detail(request, tenant_id, photo_id):
    user = request.user
    if not user.is_super_admin() and tenant_id != user.tenant_id:
        raise PermissionDenied('Cannot edit another tenant')

    photo = SchoolGalleryPhoto.objects.filter(id=photo_id, tenant_id=tenant_id).first()
    if not photo:
        raise NotFound('Photo not found')

    if not user.is_super_admin() and user.role != 'owner':
        raise PermissionDenied('Forbidden')
    tenant = Tenant.objects.filter(id=tenant_id).first()
    check_website_builder(user, tenant)

    if request.method == 'DELETE':
        delete_uploaded_image(photo.image_url, 'gallery')
        photo.delete()
        return Response({'ok': True})

    # PATCH: edit caption, or swap `order` with an adjacent photo to reorder
    # (simple up/down buttons client-side — no drag-and-drop needed).
    if 'caption' in request.data:
        photo.caption = (request.data.get('caption') or '').strip() or None
        photo.save(update_fields=['caption'])
    swap_with = request.data.get('swap_with_id')
    if swap_with:
        other = SchoolGalleryPhoto.objects.filter(id=swap_with, tenant_id=tenant_id).first()
        if other:
            photo.order, other.order = other.order, photo.order
            photo.save(update_fields=['order'])
            other.save(update_fields=['order'])

    return Response(SchoolGalleryPhotoSerializer(photo).data)
