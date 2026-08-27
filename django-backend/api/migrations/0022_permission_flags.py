from django.db import migrations

LEVEL_MAP = {
    'hidden': {},
    'view': {'view': True},
    'edit': {'view': True, 'add': True, 'modify': True, 'delete': True},
}


def migrate_forward(apps, schema_editor):
    """Rewrite every User.permissions module entry from the old 'hidden'/
    'view'/'edit' string into the new {view, add, modify, delete} flag
    object, preserving exactly the same effective access (see LEVEL_MAP)."""
    User = apps.get_model('api', 'User')
    for user in User.objects.exclude(permissions=None):
        perms = user.permissions
        if not isinstance(perms, dict) or not perms:
            continue
        new_perms = {}
        changed = False
        for key, value in perms.items():
            if isinstance(value, str):
                new_perms[key] = LEVEL_MAP.get(value, {})
                changed = True
            else:
                new_perms[key] = value
        if changed:
            user.permissions = new_perms
            user.save(update_fields=['permissions'])


def migrate_backward(apps, schema_editor):
    User = apps.get_model('api', 'User')
    for user in User.objects.exclude(permissions=None):
        perms = user.permissions
        if not isinstance(perms, dict) or not perms:
            continue
        new_perms = {}
        changed = False
        for key, value in perms.items():
            if isinstance(value, dict):
                if value.get('add') or value.get('modify') or value.get('delete'):
                    new_perms[key] = 'edit'
                elif value.get('view'):
                    new_perms[key] = 'view'
                else:
                    new_perms[key] = 'hidden'
                changed = True
            else:
                new_perms[key] = value
        if changed:
            user.permissions = new_perms
            user.save(update_fields=['permissions'])


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0021_alter_payment_kind_trip_payment_trip'),
    ]

    operations = [
        migrations.RunPython(migrate_forward, migrate_backward),
    ]
