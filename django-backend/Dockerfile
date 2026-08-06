FROM python:3.11-slim

# Install system dependencies for mysqlclient, plus the native libs
# WeasyPrint needs to render invoice PDFs (Pango/Cairo/GDK-Pixbuf for text
# shaping and rendering — there's no pure-Python alternative for this).
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    pkg-config \
    default-libmysqlclient-dev \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libcairo2 \
    libffi-dev \
    shared-mime-info \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8002

# Production-safe defaults. Tunables come from the environment so the same
# image serves both local dev and the VPS:
#   GUNICORN_WORKERS   — rule of thumb (2 x CPU cores) + 1; KVM1 (1 vCPU) -> 3
#   GUNICORN_THREADS   — threads per worker; this app is I/O-bound (DB +
#                        Chargily HTTP), so threads add throughput cheaply
#                        without the memory cost of more processes
#   GUNICORN_CMD_ARGS  — read natively by gunicorn; launch.sh sets --reload
#                        here for local dev. NOT set in production, where
#                        --reload would stat the whole tree continuously.
ENV GUNICORN_WORKERS=3 \
    GUNICORN_THREADS=4

CMD gunicorn schooldz.wsgi:application \
    --bind 0.0.0.0:8002 \
    --workers "$GUNICORN_WORKERS" \
    --threads "$GUNICORN_THREADS" \
    --worker-class gthread \
    --timeout 60 \
    --graceful-timeout 30 \
    --max-requests 1000 \
    --max-requests-jitter 100 \
    --access-logfile - \
    --error-logfile -
