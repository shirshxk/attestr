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

# Azure App Service (and most PaaS) inject the listening port via $PORT.
# Fall back to 8000 for local runs. --reload is intentionally omitted in prod.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
