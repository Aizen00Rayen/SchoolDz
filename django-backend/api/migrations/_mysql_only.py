"""Helper for migrations that need raw MySQL SQL (ENUM -> VARCHAR column
conversions). On any other database (SQLite on PythonAnywhere, the test
suite) those columns were never ENUMs, so the SQL is skipped.

The leading underscore keeps Django's migration loader from treating this
file as a migration."""
from django.db import migrations


def mysql_only(sql, reverse_sql=''):
    def forward(apps, schema_editor):
        if schema_editor.connection.vendor == 'mysql':
            schema_editor.execute(sql)

    def backward(apps, schema_editor):
        if reverse_sql and schema_editor.connection.vendor == 'mysql':
            schema_editor.execute(reverse_sql)

    # atomic=False: MySQL refuses DDL inside a transaction (like the RunSQL
    # this replaces, which never ran in one).
    return migrations.RunPython(forward, backward, atomic=False)
