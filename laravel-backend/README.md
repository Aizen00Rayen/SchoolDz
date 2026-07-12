# SchoolDZ backend (Laravel)

API-only Laravel 12 + MySQL backend for SchoolDZ, built as a drop-in
replacement for the original FastAPI + MongoDB backend (`../backend/`) —
same `/api/v1/...` routes, same JSON response shapes — so the React frontend
in `../frontend/` works against either one unchanged (just point
`REACT_APP_BACKEND_URL` at whichever is running).

Built specifically to deploy on plain PHP/MySQL shared hosting (no SSH, no
Composer, no `artisan` access on the server required) — see
[`HOSTINGER_DEPLOY.md`](./HOSTINGER_DEPLOY.md) for the full deployment
walkthrough.

## Local development

Requires Docker (no PHP/Composer/MySQL install needed on the host):

```bash
# One-time: build the dev image (PHP 8.3 + pdo_mysql + composer)
docker build -t schooldz-laravel-dev -f Dockerfile.dev .

# Install dependencies
docker run --rm -v "$(pwd)":/app -w /app schooldz-laravel-dev composer install

# Start a local MySQL (see README in ../ for the exact command, or reuse
# any MySQL 8 instance and point .env DB_* at it)

# Copy .env.production.example to .env, fill in local values, then:
docker run --rm -v "$(pwd)":/app -w /app --network host schooldz-laravel-dev \
  php artisan migrate --seed

docker run --rm -v "$(pwd)":/app -w /app --network host -p 8002:8002 schooldz-laravel-dev \
  php artisan serve --host 0.0.0.0 --port 8002
```

## Architecture notes

- **UUID primary keys** everywhere (`App\Concerns\HasUuid`), not
  auto-increment integers — matches the string `id` values the frontend
  already expects.
- **Auth**: Laravel Sanctum, bearer-token mode (not cookie/session SPA mode).
- **Tenant scoping**: `App\Support\TenantScope::apply()` — the same pattern
  every controller uses, mirroring `tenant_filter()` in the original
  FastAPI backend.
- **Errors**: a custom exception handler in `bootstrap/app.php` renders
  `{"detail": ...}` (FastAPI's shape) instead of Laravel's default
  `{"message": ...}`, so the frontend's error handling needs no changes.
- **File uploads** (tenant logos) are written directly to `public/uploads/`
  and served as plain static files — deliberately not using Laravel's
  `storage/app/public` symlink convention, since `artisan storage:link`
  isn't runnable without SSH on shared hosting.
- **Google OAuth** is a manual authorization-code flow (not Socialite),
  matching the original backend's exact endpoint contract.
