#!/usr/bin/env bash
# =============================================================================
# Scolaris — local launcher (Django Backend Edition)
#
# Stack:
#   - django-backend/   Python + Django + MySQL
#   - frontend/         React (CRA/craco)
#
#   1. MySQL          (Docker container "schooldz-mysql", data kept in a volume)
#   2. Backend API    (Django in Docker container
#                      "schooldz-django-backend" on http://localhost:8002)
#   3. Frontend       (React dev server on http://localhost:3000)
#
# First run generates */.env with fresh secrets and installs all dependencies.
# Later runs reuse everything and start in seconds.
#
# Usage:   ./launch.sh          start the stack (Ctrl+C stops all)
#          ./launch.sh stop     stop the containers + frontend
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT/frontend"
BACKEND_DIR="$ROOT/django-backend"
LOG_DIR="$ROOT/.logs"
FRONTEND_PORT=3000
BACKEND_PORT=8002
BACKEND_CONTAINER=schooldz-django-backend
BACKEND_IMAGE=schooldz-django-backend
MYSQL_PORT=3306
MYSQL_CONTAINER=schooldz-mysql
MYSQL_VOLUME=schooldz-mysql-data
MYSQL_ROOT_PASSWORD=rootpass
MYSQL_DATABASE=schooldz
MYSQL_USER=schooldz
MYSQL_PASSWORD=schooldzpass

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m▸ %s\033[0m\n' "$*"; }
ok()    { printf '\033[32m✔ %s\033[0m\n' "$*"; }
fail()  { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

# craco/react-scripts can leave an orphaned dev-server process behind when the
# port briefly conflicts with a prior run's leftovers, so free the port outright.
free_port() { fuser -k "$1"/tcp >/dev/null 2>&1 || true; }

# ----------------------------------------------------------------- stop mode
if [[ "${1:-}" == "stop" ]]; then
  info "Stopping Scolaris…"
  docker rm -f "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
  pkill -f "$FRONTEND_DIR/node_modules/.bin/craco" 2>/dev/null || true
  free_port "$FRONTEND_PORT"
  docker stop "$MYSQL_CONTAINER" >/dev/null 2>&1 || true
  ok "Stopped."
  exit 0
fi

[[ -z "${1:-}" ]] || fail "Usage: ./launch.sh [stop]"

# ------------------------------------------------------------- prerequisites
command -v node    >/dev/null || fail "node is required"
command -v npm     >/dev/null || fail "npm is required"
command -v docker  >/dev/null || fail "docker is required (used to run the database and backend)"
docker info >/dev/null 2>&1   || fail "Docker daemon is not running (or you lack permission). Start Docker and retry."

mkdir -p "$LOG_DIR"
gen_secret() { tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 43; echo; }

[[ -d "$BACKEND_DIR" ]] || fail "django-backend/ not found"

# ------------------------------------------------------------ django .env
if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  info "Creating django-backend/.env (first run)…"
  ADMIN_PASSWORD="$(gen_secret | cut -c1-16)"
  cat > "$BACKEND_DIR/.env" <<EOF
APP_NAME=Scolaris
APP_ENV=local
APP_KEY=
APP_DEBUG=true
APP_URL=http://localhost:$BACKEND_PORT

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=$MYSQL_PORT
DB_DATABASE=$MYSQL_DATABASE
DB_USERNAME=$MYSQL_USER
DB_PASSWORD=$MYSQL_PASSWORD

# ----------------------------- Scolaris -----------------------------
FRONTEND_URL=http://localhost:$FRONTEND_PORT
CORS_ORIGINS=http://localhost:$FRONTEND_PORT,http://127.0.0.1:$FRONTEND_PORT

ADMIN_EMAIL=admin@schooldz.com
ADMIN_PASSWORD=$ADMIN_PASSWORD

# Local development conveniences — set all of these to false in production
DEV_EXPOSE_RESET_TOKENS=true

# Leave blank to disable Google sign-in locally (the frontend hides the
# button automatically — see GET /api/v1/config). Fill in your own OAuth
# client from https://console.cloud.google.com/apis/credentials if you need
# to test it; never commit real values here, this file is version-controlled.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:$BACKEND_PORT/api/v1/auth/google/callback

# Chargily Pay (https://pay.chargily.net) — test mode. Leave blank to disable
# billing (the billing gate will show a payment-provider error). Fill in
# your own test keys from the Chargily dashboard; never commit real values
# here, this file is version-controlled.
CHARGILY_PUBLIC_KEY=
CHARGILY_SECRET_KEY=
CHARGILY_TEST_MODE=true
EOF
  ok "django-backend/.env created (super admin password: $ADMIN_PASSWORD — saved in django-backend/.env)"
fi

# ------------------------------------------------------------------ APP_KEY
# Ensure APP_KEY exists and has a value
if ! grep -q '^APP_KEY=' "$BACKEND_DIR/.env" 2>/dev/null || [[ -z "$(grep '^APP_KEY=' "$BACKEND_DIR/.env" | cut -d'=' -f2)" ]]; then
  info "Generating APP_KEY/SECRET_KEY…"
  GENERATED_KEY="$(gen_secret | cut -c1-32)"
  # If APP_KEY line exists but is empty, replace it. Otherwise append it.
  if grep -q '^APP_KEY=' "$BACKEND_DIR/.env" 2>/dev/null; then
    sed -i "s/^APP_KEY=.*/APP_KEY=$GENERATED_KEY/" "$BACKEND_DIR/.env"
  else
    echo "APP_KEY=$GENERATED_KEY" >> "$BACKEND_DIR/.env"
  fi
fi

# -------------------------------------------------------------------- MySQL
if ! (exec 3<>/dev/tcp/127.0.0.1/$MYSQL_PORT) 2>/dev/null; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$MYSQL_CONTAINER"; then
    info "Starting existing MySQL container…"
    docker start "$MYSQL_CONTAINER" >/dev/null
  else
    info "Creating MySQL container (mysql:8.0, data persisted in volume $MYSQL_VOLUME)…"
    docker run -d --name "$MYSQL_CONTAINER" \
      -p 127.0.0.1:$MYSQL_PORT:3306 \
      -e MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD" \
      -e MYSQL_DATABASE="$MYSQL_DATABASE" \
      -e MYSQL_USER="$MYSQL_USER" \
      -e MYSQL_PASSWORD="$MYSQL_PASSWORD" \
      -v "$MYSQL_VOLUME":/var/lib/mysql \
      mysql:8.0 >/dev/null
  fi
  for _ in $(seq 1 60); do
    docker exec "$MYSQL_CONTAINER" mysqladmin ping -h 127.0.0.1 -u root -p"$MYSQL_ROOT_PASSWORD" --silent >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$MYSQL_CONTAINER" mysqladmin ping -h 127.0.0.1 -u root -p"$MYSQL_ROOT_PASSWORD" --silent >/dev/null 2>&1 \
    || fail "MySQL did not come up on port $MYSQL_PORT"
fi
ok "MySQL is up on port $MYSQL_PORT"

# ------------------------------------------------------------------- image
# Build the Django backend image using local Dockerfile
REQ_HASH="$(sha256sum "$BACKEND_DIR/requirements.txt" | cut -d' ' -f1 | cut -c1-12)"
if ! docker image inspect "$BACKEND_IMAGE:$REQ_HASH" >/dev/null 2>&1; then
  info "Building Django backend image (dependencies changed or first run)…"
  docker build -t "$BACKEND_IMAGE:$REQ_HASH" "$BACKEND_DIR" > "$LOG_DIR/django-build.log" 2>&1 \
    || fail "Django backend image build failed — see $LOG_DIR/django-build.log"
  ok "Django backend image built"
fi

# ------------------------------------------------------ migrate + seed
info "Running Django migrations…"
# Create database migrations if any model changed
docker run --rm --network host -v "$BACKEND_DIR":/app -w /app "$BACKEND_IMAGE:$REQ_HASH" \
  python manage.py makemigrations api > "$LOG_DIR/django-makemigrations.log" 2>&1 \
  || fail "makemigrations failed — see $LOG_DIR/django-makemigrations.log"
  
# Run migrations, using --fake-initial since tables already exist in the MySQL DB
docker run --rm --network host -v "$BACKEND_DIR":/app -w /app "$BACKEND_IMAGE:$REQ_HASH" \
  python manage.py migrate --fake-initial > "$LOG_DIR/django-migrate.log" 2>&1 \
  || fail "Migration failed — see $LOG_DIR/django-migrate.log"
  
# Run the custom seed command to create/update the super admin
docker run --rm --network host --env-file "$BACKEND_DIR/.env" -v "$BACKEND_DIR":/app -w /app "$BACKEND_IMAGE:$REQ_HASH" \
  python manage.py seed_admin > "$LOG_DIR/django-seed.log" 2>&1 \
  || fail "Seeding failed — see $LOG_DIR/django-seed.log"
ok "Database migrated and super admin seeded"

info "Starting backend on http://localhost:$BACKEND_PORT …"
# Kill any ghost containers (named or unnamed) that are using the backend image / port
docker rm -f "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
docker ps -q --filter "ancestor=$BACKEND_IMAGE:$REQ_HASH" | xargs -r docker rm -f >/dev/null 2>&1 || true
run_backend_container() {
  docker run -d --name "$BACKEND_CONTAINER" \
    --network host \
    --env-file "$BACKEND_DIR/.env" \
    -v "$BACKEND_DIR":/app \
    "$BACKEND_IMAGE:$REQ_HASH" >/dev/null
}
run_backend_container || { sleep 2; docker rm -f "$BACKEND_CONTAINER" >/dev/null 2>&1 || true; run_backend_container; } \
  || fail "Could not start the Django backend container"

# ------------------------------------------------------------------ frontend
if [[ ! -f "$FRONTEND_DIR/.env" ]] || ! grep -q "^REACT_APP_BACKEND_URL=http://localhost:$BACKEND_PORT" "$FRONTEND_DIR/.env" 2>/dev/null; then
  info "Configuring frontend/.env…"
  cat > "$FRONTEND_DIR/.env" <<EOF
REACT_APP_BACKEND_URL=http://localhost:$BACKEND_PORT
BROWSER=none
PORT=$FRONTEND_PORT
EOF
fi

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  info "Installing frontend dependencies (first run, takes a few minutes)…"
  (cd "$FRONTEND_DIR" && npm install --legacy-peer-deps --no-audit --no-fund) > "$LOG_DIR/npm-install.log" 2>&1 \
    || fail "npm install failed — see $LOG_DIR/npm-install.log"
  ok "Frontend dependencies installed"
fi

free_port "$FRONTEND_PORT"
info "Starting frontend on http://localhost:$FRONTEND_PORT …"
(cd "$FRONTEND_DIR" && exec npm start) > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

# -------------------------------------------------------------------- cleanup
cleanup() {
  echo
  info "Shutting down…"
  kill "$FRONTEND_PID" 2>/dev/null || true
  wait "$FRONTEND_PID" 2>/dev/null || true
  free_port "$FRONTEND_PORT"
  docker rm -f "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
  ok "Stopped backend and frontend (database container keeps running; './launch.sh stop' stops it too)"
  exit 0
}
trap cleanup INT TERM

# ------------------------------------------------------------------ readiness
backend_logs() { docker logs --tail 25 "$BACKEND_CONTAINER" 2>&1 || true; }

info "Waiting for backend to be ready…"
for _ in $(seq 1 60); do
  curl -sf "http://localhost:$BACKEND_PORT/api/v1/health" >/dev/null 2>&1 && break
  [[ "$(docker inspect -f '{{.State.Running}}' "$BACKEND_CONTAINER" 2>/dev/null)" == "true" ]] \
    || { backend_logs; fail "Backend container crashed — run 'docker logs $BACKEND_CONTAINER'"; }
  sleep 1
done
curl -sf "http://localhost:$BACKEND_PORT/api/v1/health" >/dev/null \
  || { backend_logs; fail "Backend not responding — run 'docker logs $BACKEND_CONTAINER'"; }
ok "Backend ready"

info "Waiting for frontend to compile (first compile can take a minute)…"
for _ in $(seq 1 180); do
  curl -sf "http://localhost:$FRONTEND_PORT" >/dev/null 2>&1 && break
  kill -0 "$FRONTEND_PID" 2>/dev/null || { tail -20 "$LOG_DIR/frontend.log"; fail "Frontend crashed — see $LOG_DIR/frontend.log"; }
  sleep 1
done
ok "Frontend ready"

echo
bold "════════════════════════════════════════════════════════════"
bold "  Scolaris is running (Django Backend)"
bold "════════════════════════════════════════════════════════════"
echo "  App:            http://localhost:$FRONTEND_PORT"
echo "  API:            http://localhost:$BACKEND_PORT/api/v1"
echo
echo "  No demo data is seeded. Register a new workspace at /register — new"
echo "  workspaces land on the billing gate and need a Chargily checkout (test"
echo "  mode) to activate. Or log in as the platform super admin"
echo "  (http://localhost:$FRONTEND_PORT/admin/login):"
echo "      admin@schooldz.com / <ADMIN_PASSWORD in $BACKEND_DIR/.env>"
echo
echo "  Logs:           docker logs -f $BACKEND_CONTAINER   |   .logs/frontend.log"
echo "  Stop:           Ctrl+C   (or ./launch.sh stop)"
bold "════════════════════════════════════════════════════════════"
echo

# Keep running until Ctrl+C; if the frontend dies, shut everything down
wait "$FRONTEND_PID" || true
info "Frontend exited — check .logs/frontend.log. Shutting down."
cleanup
