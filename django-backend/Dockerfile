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

CMD ["gunicorn", "schooldz.wsgi:application", "--bind", "0.0.0.0:8002", "--workers", "3", "--timeout", "60", "--reload", "--access-logfile", "-", "--error-logfile", "-"]
