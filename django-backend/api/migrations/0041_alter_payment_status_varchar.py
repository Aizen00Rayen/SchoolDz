from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0040_payment_and_item_status_and_amount_min_zero'),
    ]

    operations = [
        migrations.RunSQL(
            sql="ALTER TABLE payments MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'paid';",
            reverse_sql="",
        ),
        migrations.RunSQL(
            sql="ALTER TABLE payment_items MODIFY COLUMN status VARCHAR(20) NOT NULL DEFAULT 'paid';",
            reverse_sql="",
        ),
    ]
