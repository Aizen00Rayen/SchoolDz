from django.db import migrations


class Migration(migrations.Migration):
    """payments.kind is a native MySQL ENUM inherited from this app's
    pre-Django schema, so 0013's AlterField silently changed nothing (Django
    compares its own CharField db_parameters and sees no diff) and writing
    'per_session' would fail with "Data truncated for column 'kind'". Same
    trap as tenants.status in 0011 — convert the column for real, then move
    existing rows off the retired 'installment' value.
    """

    dependencies = [
        ('api', '0013_remove_choice_question_remove_choice_tenant_and_more'),
    ]

    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE payments MODIFY COLUMN kind VARCHAR(50) NOT NULL DEFAULT 'monthly';",
            reverse_sql=(
                "ALTER TABLE payments MODIFY COLUMN kind "
                "ENUM('registration','monthly','course','installment','other') "
                "NOT NULL DEFAULT 'monthly';"
            ),
        ),
        migrations.RunSQL(
            sql="UPDATE payments SET kind = 'per_session' WHERE kind = 'installment';",
            reverse_sql="UPDATE payments SET kind = 'installment' WHERE kind = 'per_session';",
        ),
    ]
