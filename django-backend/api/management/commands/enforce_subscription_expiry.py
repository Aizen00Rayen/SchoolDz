from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from api.models import Tenant

GRACE_PERIOD_DAYS = 15


class Command(BaseCommand):
    help = (
        "Locks out tenants whose subscription just expired, and permanently "
        "erases tenants whose 15-day grace period has elapsed. Intended to "
        "run daily via cron."
    )

    def handle(self, *args, **options):
        now = timezone.now()

        locked = Tenant.objects.filter(status='active', plan_expires_at__lt=now).update(status='expired')
        if locked:
            self.stdout.write(self.style.WARNING(f'Locked {locked} expired tenant(s).'))

        cutoff = now - timedelta(days=GRACE_PERIOD_DAYS)
        to_erase = Tenant.objects.filter(status='expired', plan_expires_at__lt=cutoff)
        for tenant in list(to_erase):
            name, tenant_id = tenant.name, tenant.id
            # Users have on_delete=SET_NULL (a login can outlive its tenant
            # in the normal flow), but here the whole point is erasure, so
            # delete them explicitly instead of letting them go orphaned.
            tenant.users.all().delete()
            tenant.delete()  # cascades to students, guardians, payments, etc.
            self.stdout.write(self.style.SUCCESS(f'Erased tenant "{name}" ({tenant_id}) — grace period elapsed.'))
