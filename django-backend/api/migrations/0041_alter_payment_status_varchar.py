from django.db import migrations
from ._mysql_only import mysql_only


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0040_payment_and_item_status_and_amount_min_zero'),
    ]

    operations = [
        mysql_only(
            sql="ALTER TABLE payments MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'paid';",
            reverse_sql="",
        ),
        mysql_only(
            sql="ALTER TABLE payment_items MODIFY COLUMN status VARCHAR(20) NOT NULL DEFAULT 'paid';",
            reverse_sql="",
        ),
    ]
