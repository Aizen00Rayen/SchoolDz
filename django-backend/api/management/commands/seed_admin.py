import os
from django.core.management.base import BaseCommand
from api.models import User

class Command(BaseCommand):
    help = 'Seeds or updates the platform super admin user from environment variables.'

    def handle(self, *args, **options):
        email = os.environ.get('ADMIN_EMAIL', 'admin@schooldz.com').strip().lower()
        password = os.environ.get('ADMIN_PASSWORD', 'admin123')
        
        if password == 'admin123':
            self.stdout.write(self.style.WARNING(
                'ADMIN_PASSWORD is not set or uses default — the super admin uses a weak default. '
                'Set a strong ADMIN_PASSWORD before exposing this server.'
            ))
            
        user = User.objects.filter(email=email).first()
        if not user:
            User.objects.create_user(
                email=email,
                password=password,
                name='Platform Admin',
                role='super_admin',
                email_verified=True
            )
            self.stdout.write(self.style.SUCCESS(f"Seeded super admin: {email}"))
        else:
            user.set_password(password)
            user.role = 'super_admin'
            user.save()
            self.stdout.write(self.style.SUCCESS("Updated super admin password"))
