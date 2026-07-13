# Deploying to PythonAnywhere (free tier)

The whole site — API and React frontend — runs from **one** Django WSGI app.
Django serves `/api/v1/*` as usual and now also serves the built React app
for every other route (see `serve_frontend` in `api/views.py` and the
catch-all in `schooldz/urls.py`), so a single free PythonAnywhere web app is
enough. No second host, no separate static site needed.

## What works on the free tier
- Django + the built React frontend, both from one web app
- The free MySQL database (Databases tab → set a password, note the host,
  e.g. `yourusername.mysql.pythonanywhere-services.com`)
- Email/password signup, the 14-day trial, and the full app once a workspace
  is on a trial or active plan

## What does NOT work on the free tier
Free PythonAnywhere accounts can only make outbound HTTPS requests to a
small allowlist of domains. **`accounts.google.com`, `oauth2.googleapis.com`,
and `pay.chargily.net` are not on it.** Concretely:
- Google sign-in/sign-up will fail — leave `GOOGLE_CLIENT_ID` unset in `.env`
  and the frontend automatically hides the "Continue with Google" button
  (see `GET /api/v1/config`).
- Chargily checkout will fail — a trial tenant can use the whole product for
  14 days without hitting this; only the actual "Choose a plan" payment step
  needs it. Leave `CHARGILY_SECRET_KEY` unset and that step will show a
  clear "payment provider unreachable" error instead of crashing.

Both come back automatically the moment you upgrade to a paid PythonAnywhere
plan (from $5/mo, removes the allowlist) and set the corresponding `.env`
values — no code changes needed.

## Steps

### 1. Get the code onto PythonAnywhere
Open a **Bash console** (Dashboard → New console → Bash) and:
```bash
git clone https://github.com/YOUR_USERNAME/SchoolDz.git ~/schooldz
```

### 2. Create the MySQL database
**Databases** tab → set a database password (top of the page, once) → under
"Create a database", name it e.g. `schooldz` (PythonAnywhere prefixes it
automatically, giving `yourusername$schooldz`) → Create.
Note the host shown on that page — it's `yourusername.mysql.pythonanywhere-services.com`.

### 3. Python environment
In the Bash console:
```bash
cd ~/schooldz/django-backend
mkvirtualenv --python=/usr/bin/python3.11 schooldz-venv
pip install -r requirements.txt
```

### 4. Build the frontend
Also in the Bash console (PythonAnywhere has Node preinstalled):
```bash
cd ~/schooldz/frontend
npm install --legacy-peer-deps
REACT_APP_BACKEND_URL="" npm run build
```
`REACT_APP_BACKEND_URL=""` is important — it makes the frontend call the API
as a relative path (`/api/v1/...`), so it works regardless of your actual
`*.pythonanywhere.com` domain, with no hardcoded URL to update later.

### 5. `django-backend/.env`
Create it (copy your local `.env` as a starting point if you have one, then
edit):
```
APP_NAME=SchoolDZ
APP_ENV=production
APP_KEY=<run: python -c "import secrets; print(secrets.token_urlsafe(32))">
APP_DEBUG=false
APP_URL=https://yourusername.pythonanywhere.com

DB_CONNECTION=mysql
DB_HOST=yourusername.mysql.pythonanywhere-services.com
DB_PORT=3306
DB_DATABASE=yourusername$schooldz
DB_USERNAME=yourusername
DB_PASSWORD=<the database password you set in step 2>

FRONTEND_URL=https://yourusername.pythonanywhere.com
CORS_ORIGINS=https://yourusername.pythonanywhere.com

ADMIN_EMAIL=you@yourschool.com
ADMIN_PASSWORD=<pick something strong — this is your platform super admin>

DEV_EXPOSE_RESET_TOKENS=false

# Leave both blank on the free tier — see "What does NOT work" above.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
CHARGILY_SECRET_KEY=
CHARGILY_PUBLIC_KEY=
```

### 6. Migrate + seed the super admin
```bash
cd ~/schooldz/django-backend
python manage.py migrate
python manage.py seed_admin
```

### 7. Web tab — create the web app
Dashboard → **Web** → Add a new web app → **Manual configuration** →
Python 3.11.

- **Virtualenv**: `/home/yourusername/.virtualenvs/schooldz-venv`
- **WSGI configuration file**: click the link PythonAnywhere gives you and
  replace its contents with:
  ```python
  import sys, os

  path = '/home/yourusername/schooldz/django-backend'
  if path not in sys.path:
      sys.path.insert(0, path)

  os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'schooldz.settings')

  from django.core.wsgi import get_wsgi_application
  application = get_wsgi_application()
  ```
- **Static files** section, add two mappings:
  | URL | Directory |
  |---|---|
  | `/static/` | `/home/yourusername/schooldz/frontend/build/static` |
  | `/uploads/` | `/home/yourusername/schooldz/django-backend/uploads` |

  These are served directly by PythonAnywhere, never touching Django — the
  JS/CSS bundle and tenant logo uploads load fast and don't count against
  your app's request quota.
- Hit the big green **Reload** button.

Visit `https://yourusername.pythonanywhere.com` — you should see the
SchoolDZ landing page. Register a workspace at `/register`, or log in as
the super admin at `/admin/login` with the `ADMIN_EMAIL`/`ADMIN_PASSWORD`
from step 5.

## Redeploying after a code change
```bash
cd ~/schooldz && git pull
cd frontend && REACT_APP_BACKEND_URL="" npm run build
cd ../django-backend && workon schooldz-venv && python manage.py migrate
```
Then hit **Reload** on the Web tab.

## After you outgrow the free tier
Upgrading removes the network allowlist — set `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` and `CHARGILY_SECRET_KEY` / `CHARGILY_PUBLIC_KEY` in
`.env`, reload, and both features activate immediately — no code changes.
