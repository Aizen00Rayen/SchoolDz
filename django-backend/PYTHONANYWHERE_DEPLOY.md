# Deploying to PythonAnywhere (free tier)

The whole site — API and React frontend — runs from **one** Django WSGI app.
Django serves `/api/v1/*` as usual and now also serves the built React app
for every other route (see `serve_frontend` in `api/views.py` and the
catch-all in `schooldz/urls.py`), so a single free PythonAnywhere web app is
enough. No second host, no separate static site needed.

## Database: SQLite, not MySQL

As of January 2026, PythonAnywhere no longer gives **new** free accounts a
MySQL database — that moved to the paid Developer tier ($10/mo). Postgres
has always been paid-only. The free tier still gets SQLite (a single file,
no separate DB service to run), which is what this guide uses.

If your PythonAnywhere account predates January 2026, you're grandfathered
in with free MySQL access — set `DB_CONNECTION=mysql` instead in step 5 and
everything else in this guide is unchanged.

An externally-hosted database (a free-tier MySQL/Postgres from some other
provider) won't work on the free tier either: free accounts can only make
*HTTP(S)* requests to a small domain allowlist, and a database connection
isn't HTTP(S) at all — it's blocked regardless of whitelisting.

SQLite is fine for an early-access launch at modest traffic — PythonAnywhere
itself recommends it for exactly this. The free tier only runs one process
anyway, so SQLite's single-writer model isn't a practical bottleneck yet. If
you outgrow it, upgrading to the Developer tier and switching
`DB_CONNECTION=mysql` needs no code changes (see the end of this doc).

## What works on the free tier
- Django + the built React frontend, both from one web app
- SQLite (see above)
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
plan (removes the allowlist) and set the corresponding `.env` values — no
code changes needed.

## Steps

### 1. Get the code onto PythonAnywhere
Open a **Bash console** (Dashboard → New console → Bash) and:
```bash
git clone https://github.com/YOUR_USERNAME/SchoolDz.git ~/schooldz
```

### 2. Python environment
```bash
cd ~/schooldz/django-backend
mkvirtualenv --python=/usr/bin/python3.11 schooldz-venv
```
If `pip install` immediately fails with
`ModuleNotFoundError: No module named '_posixsubprocess'`, that's a known
PythonAnywhere issue with some Python 3.11 virtualenvs, not your setup —
recreate it on a different version:
```bash
deactivate
rmvirtualenv schooldz-venv
ls /usr/bin/python3.*                          # see what's actually available
mkvirtualenv --python=/usr/bin/python3.13 schooldz-venv   # or the highest listed
python -c "import subprocess; print('ok')"     # confirm it's fixed before continuing
```
Then install the deps — skip `mysqlclient`, it needs system headers this
account may not have, and SQLite (Python's built-in `sqlite3` module)
doesn't need it at all:
```bash
pip install django djangorestframework django-cors-headers requests \
  python-dotenv bcrypt gunicorn chargily-pay
```

### 3. Build the frontend
Node isn't preinstalled account-wide, and there's no root to `apt install`
it — use PythonAnywhere's documented `nvm` setup instead (one-time, then
`node`/`npm` are just always on your PATH):
```bash
cd ~
git clone --depth 1 https://github.com/creationix/nvm.git
source ~/nvm/nvm.sh
echo 'source ~/nvm/nvm.sh' >> ~/.bashrc

nvm install 20
nvm use 20
nvm alias default 20
node -v && npm -v      # should print real version numbers, not "command not found"
```
Then build:
```bash
cd ~/schooldz/frontend
npm install --legacy-peer-deps
REACT_APP_BACKEND_URL="" npm run build
```
`REACT_APP_BACKEND_URL=""` is important — it makes the frontend call the API
as a relative path (`/api/v1/...`), so it works regardless of your actual
`*.pythonanywhere.com` domain, with no hardcoded URL to update later.

### 4. `django-backend/.env`
Create it:
```
APP_NAME=SchoolDZ
APP_ENV=production
APP_KEY=<run: python -c "import secrets; print(secrets.token_urlsafe(32))">
APP_DEBUG=false
APP_URL=https://yourusername.pythonanywhere.com

DB_CONNECTION=sqlite
DB_DATABASE=/home/yourusername/schooldz/django-backend/db.sqlite3

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

### 5. Migrate + seed the super admin
```bash
cd ~/schooldz/django-backend
python manage.py migrate
python manage.py seed_admin
```

### 6. Web tab — create the web app
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
from step 4.

## Redeploying after a code change
```bash
cd ~/schooldz && git pull
cd frontend && REACT_APP_BACKEND_URL="" npm run build
cd ../django-backend && workon schooldz-venv && python manage.py migrate
```
Then hit **Reload** on the Web tab.

## Backing up your data
SQLite is one file — back it up by just downloading it:
```bash
# from a Bash console, zip it up so you can download via the Files tab
cd ~/schooldz/django-backend && gzip -k db.sqlite3
```

## After you outgrow the free tier
Upgrading to the Developer tier ($10/mo) gets you MySQL:
1. Create a MySQL database in the **Databases** tab, note the host shown
   there (`yourusername.mysql.pythonanywhere-services.com`).
2. `pip install mysqlclient` in your virtualenv.
3. In `.env`, switch `DB_CONNECTION=mysql` and add `DB_HOST`/`DB_USERNAME`/
   `DB_PASSWORD` (matching the values on the Databases page).
4. `python manage.py migrate` to build the schema on the new database —
   note this starts empty; there's no automatic SQLite → MySQL data copy,
   so do this early rather than after you have real tenant data, or ask for
   help migrating the data across if you're already live.
5. Set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and
   `CHARGILY_SECRET_KEY`/`CHARGILY_PUBLIC_KEY` to activate Google sign-in and
   real payments — no code changes needed, both already degrade gracefully
   when unset and activate the moment they're configured.
6. Reload the web app.
