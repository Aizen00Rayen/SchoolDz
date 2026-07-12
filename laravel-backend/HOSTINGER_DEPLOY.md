# Deploying SchoolDZ to Hostinger shared hosting

This backend is Laravel 12 + MySQL, built specifically to run on a plain
"Website HTML/PHP" shared hosting plan — no SSH, no Composer, and no
`php artisan` access on the server required. Everything below only needs
**File Manager (or FTP)** and **phpMyAdmin**, both in hPanel.

You'll end up with two document roots on the same hosting account:

| Domain/subdomain | Serves |
|---|---|
| `yourdomain.com` | the React frontend (static files) |
| `api.yourdomain.com` | this Laravel backend |

## 0. Before you start

- [ ] Your domain is added to this Hostinger hosting account (hPanel → Domains).
- [ ] Check **hPanel → Advanced → PHP Configuration** and note the PHP version
      available. This app needs **PHP 8.2 or newer**. If only older versions
      are offered, tell me and I'll adjust the code to match.
- [ ] Decide your real domain now — you'll need it in step 4 and 6.

## 1. Create the `api` subdomain

hPanel → **Domains → Subdomains** → create `api` on your domain. Hostinger
will create a folder for it, typically `public_html/api/` — note the exact
path shown, you'll need it in step 3.

## 2. Create the MySQL database

hPanel → **Databases → MySQL Databases**:

1. Create a new database (e.g. `u123456789_schooldz`) and a new user with a
   strong password, and attach the user to the database with **all privileges**.
2. Note the three values Hostinger shows you: database name, username,
   password. You'll paste these into `.env` in step 5. The host is almost
   always `localhost`.

## 3. Import the database schema

`database/schema/seed-super-admin.sql` is deliberately **not** checked into
git (it would contain a real plaintext password in a comment) — generate it
fresh right before you deploy, either by asking me to generate one for you
locally, or yourself:

```bash
cd laravel-backend
ADMIN_PW=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)
HASH=$(docker run --rm php:8.3-cli php -r "echo password_hash('$ADMIN_PW', PASSWORD_BCRYPT);")
UUID=$(docker run --rm php:8.3-cli php -r "echo bin2hex(random_bytes(16));" | sed -E 's/(.{8})(.{4})(.{4})(.{4})(.{12})/\1-\2-\3-\4-\5/')
echo "Super admin password: $ADMIN_PW"   # write this down, it won't be shown again
cat > database/schema/seed-super-admin.sql <<SQL
INSERT INTO \`users\` (\`id\`, \`tenant_id\`, \`email\`, \`name\`, \`role\`, \`is_active\`, \`email_verified\`, \`password\`, \`created_at\`, \`updated_at\`)
VALUES ('$UUID', NULL, 'admin@schooldz.com', 'Platform Admin', 'super_admin', 1, 1, '$HASH', NOW(), NOW());
SQL
```

Then, hPanel → **Databases → phpMyAdmin** → open your new database → **Import** tab:

1. Import `database/schema/hostinger-schema.sql` (from this folder). This
   creates every table.
2. Import the `seed-super-admin.sql` you just generated. This creates the
   platform super admin account. **The password only exists in your terminal
   output above — write it down now**, there's no other way to recover it
   besides the forgot-password email flow (which needs mail configured).

## 4. Configure `.env`

1. Copy `.env.production.example` (in this folder) to a new file named
   `.env`.
2. Fill in every `REPLACE_ME`:
   - `APP_URL` → `https://api.yourdomain.com`
   - `DB_DATABASE` / `DB_USERNAME` / `DB_PASSWORD` → from step 2
   - `FRONTEND_URL` and `CORS_ORIGINS` → `https://yourdomain.com`
   - `ADMIN_PASSWORD` → must match whatever password is in
     `seed-super-admin.sql` (see step 3)
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` → from Google Cloud Console
   - `GOOGLE_REDIRECT_URI` → `https://api.yourdomain.com/api/v1/auth/google/callback`
3. **Double-check `APP_DEBUG=false` and `DEV_EXPOSE_RESET_TOKENS=false`.**
   Leaving either on in production leaks stack traces / lets anyone take
   over any account by email address.

## 5. Upload the backend

Upload the **entire contents** of the `laravel-backend/` folder **on your
local machine** — including `vendor/`, already built there so no Composer is
needed on the server — to the `api` subdomain's folder from step 1 (e.g.
`public_html/api/`). Note: `vendor/` is intentionally excluded from git (it's
45MB of reproducible dependency code), so if you re-clone this repo fresh,
run `composer install --no-dev --optimize-autoloader` locally first to
regenerate it before uploading.

Then, in hPanel's subdomain settings, make sure the **document root** for
`api.yourdomain.com` points to `public_html/api/public` (the `public`
subfolder, not the folder root — this is the single most common mistake in
Laravel shared-hosting deploys and shows a blank page or directory listing
if wrong).

## 6. Build and upload the frontend

On your own machine (not on Hostinger):

```bash
cd frontend
REACT_APP_BACKEND_URL=https://api.yourdomain.com npm run build
```

Upload everything **inside** the resulting `frontend/build/` folder (not the
folder itself) to your main domain's document root (`public_html/`). This
includes a `.htaccess` that makes React Router's client-side routes work
correctly on refresh/direct links.

## 7. Google OAuth

In Google Cloud Console → APIs & Services → Credentials → your OAuth client:

- **Authorized redirect URIs**: add `https://api.yourdomain.com/api/v1/auth/google/callback` exactly.
- If you don't need Google sign-in yet, leave `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
  blank in `.env` — the buttons will just show a "not configured" error
  instead of breaking anything else.

## 8. SSL

hPanel → SSL → enable Hostinger's free SSL for both `yourdomain.com` and
`api.yourdomain.com`. Every URL above must be `https://` once this is on —
mixed http/https will break CORS and cookie-less bearer-token auth alike.

## 9. Test it

- [ ] `https://api.yourdomain.com/api/v1/health` returns `{"status":"ok",...}`
- [ ] `https://yourdomain.com` loads the marketing page
- [ ] Register a new workspace end-to-end
- [ ] Log in as the super admin (`/admin/login`) with the password from step 3
- [ ] Create a student, mark attendance, record a payment
- [ ] Upload a tenant logo (Settings → Branding) and confirm it renders in the sidebar

## Notes for later

- **No SSH means no `php artisan migrate` for future schema changes.** If
  the data model changes later, I'll generate a new schema diff SQL file for
  you to run through phpMyAdmin, the same way as steps 2–3 here.
- **File uploads (logos) live in `api/public/uploads/logos/`** as plain
  files, not Laravel's storage-symlink convention — this was a deliberate
  choice so nothing here ever needs `artisan storage:link`.
- If you later upgrade to a VPS or get SSH access, everything here still
  works normally with `php artisan migrate`/`db:seed` — the SQL files are
  just a shared-hosting-only workaround, not a fork of how the app is built.
