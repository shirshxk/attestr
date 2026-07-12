FROM python:3.11-slim

WORKDIR /app

# System deps needed by pyca/cryptography
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create data directory for SQLite + keystores
RUN mkdir -p /app/data

COPY . .

EXPOSE 8000
