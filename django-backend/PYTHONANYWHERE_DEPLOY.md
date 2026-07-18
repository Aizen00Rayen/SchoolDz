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
- Everything that doesn't need Google or Chargily (see below)

## What does NOT work on the free tier — this one blocks signups entirely
Free PythonAnywhere accounts can only make outbound HTTPS requests to a
small allowlist of domains. **`accounts.google.com`, `oauth2.googleapis.com`,
and `pay.chargily.net` are not on it.** Concretely:
- Google sign-in/sign-up will fail — leave `GOOGLE_CLIENT_ID` unset in `.env`
  and the frontend automatically hides the "Continue with Google" button
  (see `GET /api/v1/config`).
- **Chargily checkout will fail.** There is no free trial — every new
  registration lands on the billing gate and must complete a Chargily
  checkout before the workspace activates. On the free tier that checkout
  call can never reach `pay.chargily.net`, so **no new tenant can ever
  activate** — registration effectively dead-ends. This is a hard blocker,
  not a degraded-but-usable feature like Google sign-in is.

Both come back automatically the moment you upgrade to a paid PythonAnywhere
plan (removes the allowlist) and set the corresponding `.env` values — no
code changes needed. Until then, the free tier is only useful for demoing
the marketing site and admin login, not for real signups.

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

### 3. The frontend build — do NOT build it on PythonAnywhere

Don't `npm install` on the server. This app's `node_modules` is ~765MB
locally, but the PythonAnywhere **free tier's entire disk quota is 512MB**
— `npm install` will run out of space partway through and fail with cryptic
errors like `npm warn tar TAR_ENTRY_ERROR Unknown system error -122` (that's
Linux `EDQUOT`, disk quota exceeded) and a subsequent `craco: not found`.
There is no fix for this on the free tier short of not installing
`node_modules` there at all — retrying, clearing npm's cache, etc. won't
help, since the problem is disk space, not the install itself.

Instead, **build the frontend on your own machine** (or anywhere with
normal disk space — this Claude Code sandbox works fine too) and commit the
compiled output. `frontend/.gitignore` has a `!/build` exception carved out
specifically for this — the build directory is meant to be committed for
this project, unlike a typical CRA app:
```bash
cd frontend
npm install --legacy-peer-deps
REACT_APP_BACKEND_URL="" npm run build
git add build && git commit -m "Build frontend for deploy" && git push
```
`REACT_APP_BACKEND_URL=""` is important — it makes the frontend call the API
as a relative path (`/api/v1/...`), so it works regardless of your actual
`*.pythonanywhere.com` domain, with no hardcoded URL to update later.

Then on PythonAnywhere, `git pull` (step 1) already brought the built
`frontend/build/` folder down with everything else — nothing else to do
here, and Node.js never needs to exist on the server at all.

### 4. `django-backend/.env`
Create it:
```
APP_NAME=Scolaris
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
Scolaris landing page. Register a workspace at `/register`, or log in as
the super admin at `/admin/login` with the `ADMIN_EMAIL`/`ADMIN_PASSWORD`
from step 4.

## Redeploying after a code change

If you only changed backend code:
```bash
cd ~/schooldz && git pull
cd django-backend && workon schooldz-venv && python manage.py migrate
```

If you also changed frontend code, build and commit it **locally first**
(see step 3 — never `npm run build` on PythonAnywhere itself), push, then
`git pull` on the server as above; the freshly built `frontend/build/`
comes down with the rest of the repo, no separate build step needed there.

Then hit **Reload** on the Web tab either way.

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
