from django.db import migrations, models

WRITE_OFF_NOTE = 'تم شطب الدين'


def backfill(apps, schema_editor):
    """Lines cancelled by an earlier "write off debt" carried this note on
    their bill; flag them so their sessions are still counted as covered."""
    PaymentItem = apps.get_model('api', 'PaymentItem')
    PaymentItem.objects.filter(status='cancelled', payment__notes__contains=WRITE_OFF_NOTE).update(written_off=True)


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0047_course_archive_year'),
    ]

    operations = [
        migrations.AddField(
            model_name='paymentitem',
            name='written_off',
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
