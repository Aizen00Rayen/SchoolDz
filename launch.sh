#!/usr/bin/env bash
# =============================================================================
# SchoolDZ — local launcher
#
# Starts everything needed to run the app on your machine:
#   1. MongoDB        (Docker container "schooldz-mongo", data kept in a volume)
#   2. Backend API    (FastAPI/uvicorn in Docker container "schooldz-backend"
#                      on http://localhost:8001, live-reloads on code changes)
#   3. Frontend       (React dev server on http://localhost:3000)
#
# First run generates backend/.env and frontend/.env with fresh secrets and
# installs all dependencies. Later runs reuse everything and start in seconds.
#
# Usage:   ./launch.sh          start everything (Ctrl+C stops all)
#          ./launch.sh stop     stop backend/frontend leftovers + mongo container
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
LOG_DIR="$ROOT/.logs"

BACKEND_PORT=8001
FRONTEND_PORT=3000
MONGO_PORT=27017
MONGO_CONTAINER=schooldz-mongo
MONGO_VOLUME=schooldz-mongo-data
BACKEND_CONTAINER=schooldz-backend
BACKEND_IMAGE=schooldz-backend

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m▸ %s\033[0m\n' "$*"; }
ok()    { printf '\033[32m✔ %s\033[0m\n' "$*"; }
fail()  { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

# craco/react-scripts can leave an orphaned dev-server process behind when the
# port briefly conflicts with a prior run's leftovers, so free the port outright.
free_port() { fuser -k "$1"/tcp >/dev/null 2>&1 || true; }

# ----------------------------------------------------------------- stop mode
if [[ "${1:-}" == "stop" ]]; then
  info "Stopping SchoolDZ…"
  docker rm -f "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
  pkill -f "$FRONTEND_DIR/node_modules/.bin/craco" 2>/dev/null || true
  free_port "$FRONTEND_PORT"
  docker stop "$MONGO_CONTAINER" >/dev/null 2>&1 || true
  ok "Stopped."
  exit 0
fi

# ------------------------------------------------------------- prerequisites
command -v node    >/dev/null || fail "node is required"
command -v npm     >/dev/null || fail "npm is required"
command -v docker  >/dev/null || fail "docker is required (used to run MongoDB and the backend)"
docker info >/dev/null 2>&1   || fail "Docker daemon is not running (or you lack permission). Start Docker and retry."

mkdir -p "$LOG_DIR"

# ------------------------------------------------------------------ env files
gen_secret() { tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 43; echo; }

if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  info "Creating backend/.env (first run)…"
  ADMIN_PASSWORD="$(gen_secret | cut -c1-16)"
  cat > "$BACKEND_DIR/.env" <<EOF
MONGO_URL=mongodb://localhost:$MONGO_PORT
DB_NAME=schooldz
JWT_SECRET=$(gen_secret)

# Platform super admin (login at /admin/login)
ADMIN_EMAIL=admin@schooldz.com
ADMIN_PASSWORD=$ADMIN_PASSWORD

# Local development conveniences — set all of these to false in production
DEV_EXPOSE_RESET_TOKENS=true
COOKIE_SECURE=false

CORS_ORIGINS=http://localhost:$FRONTEND_PORT,http://127.0.0.1:$FRONTEND_PORT
FRONTEND_URL=http://localhost:$FRONTEND_PORT
GOOGLE_REDIRECT_URI=http://localhost:$BACKEND_PORT/api/v1/auth/google/callback

# Google OAuth (Sign in / Sign up with Google) — optional. Get these from
# Google Cloud Console > APIs & Services > Credentials, and add the exact
# GOOGLE_REDIRECT_URI above to that client's "Authorized redirect URIs".
# Leave blank to disable Google sign-in.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
EOF
  ok "backend/.env created (super admin password: $ADMIN_PASSWORD — saved in backend/.env)"
fi

if [[ ! -f "$FRONTEND_DIR/.env" ]]; then
  info "Creating frontend/.env (first run)…"
  cat > "$FRONTEND_DIR/.env" <<EOF
REACT_APP_BACKEND_URL=http://localhost:$BACKEND_PORT
BROWSER=none
PORT=$FRONTEND_PORT
EOF
  ok "frontend/.env created"
fi

# -------------------------------------------------------------------- MongoDB
if ! (exec 3<>/dev/tcp/127.0.0.1/$MONGO_PORT) 2>/dev/null; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$MONGO_CONTAINER"; then
    info "Starting existing MongoDB container…"
    docker start "$MONGO_CONTAINER" >/dev/null
  else
    info "Creating MongoDB container (mongo:7, data persisted in volume $MONGO_VOLUME)…"
    docker run -d --name "$MONGO_CONTAINER" \
      -p 127.0.0.1:$MONGO_PORT:27017 \
      -v "$MONGO_VOLUME":/data/db \
      mongo:7 >/dev/null
  fi
  for _ in $(seq 1 30); do
    (exec 3<>/dev/tcp/127.0.0.1/$MONGO_PORT) 2>/dev/null && break
    sleep 1
  done
  (exec 3<>/dev/tcp/127.0.0.1/$MONGO_PORT) 2>/dev/null || fail "MongoDB did not come up on port $MONGO_PORT"
fi
ok "MongoDB is up on port $MONGO_PORT"

# -------------------------------------------------------------------- backend
# The backend runs in Docker so no Python/pip setup is needed on the host.
# Code is volume-mounted and uvicorn --reload picks up edits live.
REQ_HASH="$(sha256sum "$BACKEND_DIR/requirements.txt" | cut -d' ' -f1 | cut -c1-12)"
if ! docker image inspect "$BACKEND_IMAGE:$REQ_HASH" >/dev/null 2>&1; then
  info "Building backend image (dependencies changed or first run)…"
  docker build -t "$BACKEND_IMAGE:$REQ_HASH" -f - "$BACKEND_DIR" > "$LOG_DIR/backend-build.log" 2>&1 <<'DOCKERFILE' \
    || fail "Backend image build failed — see $LOG_DIR/backend-build.log"
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", "--reload"]
DOCKERFILE
  ok "Backend image built"
fi

info "Starting backend on http://localhost:$BACKEND_PORT …"
docker rm -f "$BACKEND_CONTAINER" >/dev/null 2>&1 || true
run_backend_container() {
  docker run -d --name "$BACKEND_CONTAINER" \
    --network host \
    --env-file "$BACKEND_DIR/.env" \
    -v "$BACKEND_DIR":/app \
    "$BACKEND_IMAGE:$REQ_HASH" >/dev/null
}
# Occasionally races with the `docker rm -f` above (name not yet released) —
# one retry clears it without failing the whole run.
run_backend_container || { sleep 1; docker rm -f "$BACKEND_CONTAINER" >/dev/null 2>&1 || true; run_backend_container; } \
  || fail "Could not start the backend container"

# ------------------------------------------------------------------- frontend
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
  ok "Stopped backend and frontend (MongoDB container keeps running; './launch.sh stop' stops it too)"
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
bold "  SchoolDZ is running"
bold "════════════════════════════════════════════════════════════"
echo "  App:            http://localhost:$FRONTEND_PORT"
echo "  API:            http://localhost:$BACKEND_PORT/api/v1"
echo "  API docs:       http://localhost:$BACKEND_PORT/docs"
echo
echo "  No demo data is seeded. Register a new workspace at /register, or"
echo "  log in as the platform super admin (http://localhost:$FRONTEND_PORT/admin/login):"
echo "      admin@schooldz.com / <ADMIN_PASSWORD in backend/.env>"
echo
echo "  Logs:           docker logs -f $BACKEND_CONTAINER   |   .logs/frontend.log"
echo "  Stop:           Ctrl+C   (or ./launch.sh stop)"
bold "════════════════════════════════════════════════════════════"
echo

# Keep running until Ctrl+C; if the frontend dies, shut everything down
wait "$FRONTEND_PID" || true
info "Frontend exited — check .logs/frontend.log. Shutting down."
cleanup
