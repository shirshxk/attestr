# Deploying Attestr to Azure

> ⚠️ **REQUIRED BEFORE ANY PRODUCTION DEPLOY.** Set these environment variables to
> strong, unique values (≥16 chars). The app **refuses to start** in production
> (`ATTESTR_ENV=production`) if they're left at their development defaults:
>
> - `JWT_SECRET` — signs session tokens. If left default, anyone can forge logins.
> - `CA_PASSPHRASE` — encrypts the CA keystore. If left default, the root key is exposed.
> - `ALLOWED_ORIGINS` — comma-separated frontend origins for CORS (e.g. `https://attestr.example.com`).
> - `ATTESTR_ENV=production` — also disables the `/demo/*` quick-login endpoints.
>
> Generate strong values with: `python -c "import secrets; print(secrets.token_urlsafe(32))"`

This guide deploys Attestr using the **GitHub Student Pack** Azure credit ($100, no card).
You'll stand up three things:

1. **Azure Database for PostgreSQL** (managed, persistent — replaces local SQLite)
2. **Backend** — FastAPI container on Azure App Service
3. **Frontend** — React static build, also on App Service (or Azure Static Web Apps)

Everything below uses the Azure Portal (point-and-click). A CLI version is at the end.

---

## 0. One-time setup

1. Activate Azure for Students: connect your GitHub account at the Azure offer in your Student Pack. You get $100 credit, no credit card.
2. Push this repo to GitHub (App Service can deploy straight from GitHub).

---

## 1. Create the PostgreSQL database

Azure Portal → **Create a resource** → **Azure Database for PostgreSQL** → **Flexible Server**.

- Workload type: **Development** (cheapest; uses the least credit)
- Compute + storage: **Burstable B1ms** is plenty for a demo
- Admin username / password: set and **save them**
- Networking: enable **"Allow public access from Azure services"** and add your own IP if you want to connect with a client
- After it's created, open the server → **Databases** → create one called `attestr`

Your connection string will look like:

```
postgresql://<admin>:<password>@<server-name>.postgres.database.azure.com:5432/attestr?sslmode=require
```

Keep that handy — it becomes `DATABASE_URL`.

---

## 2. Deploy the backend (FastAPI)

Azure Portal → **Create a resource** → **Web App**.

- Publish: **Container**
- Operating System: **Linux**
- Pricing plan: **B1** (Basic) is fine for a demo and light on credit
- In the **Container** tab, point it at your image. Two options:
  - **Build from GitHub** via GitHub Actions (Azure can scaffold this), using `backend/Dockerfile`, **or**
  - Build locally and push to Azure Container Registry / Docker Hub, then reference it.

After the Web App exists, open **Settings → Environment variables** (Application settings) and add:

| Name | Value |
|------|-------|
| `DATABASE_URL` | your Postgres connection string from step 1 |
| `CA_PASSPHRASE` | a long random string (this wraps the CA keystore) |
| `JWT_SECRET` | another long random string |
| `ATTESTR_ENV` | `production` |
| `CA_KEYSTORE_PATH` | `/app/data/ca_keystore.json` |
| `ATTESTR_CORS_ORIGINS` | your frontend URL once you have it (or `*` to start) |
| `WEBSITES_PORT` | `8000` |

> The backend already reads `$PORT`; `WEBSITES_PORT=8000` tells App Service which port the container listens on. The Dockerfile's start command honors `$PORT`.

The backend auto-creates tables and seeds the demo orgs on first startup, so there's no migration step. Once it's running, visit `https://<backend>.azurewebsites.net/docs` to confirm the API is live.

---

## 3. Deploy the frontend (React)

The frontend needs to know the backend URL **at build time** (Vite bakes it in).

Build the production image with the backend URL:

```bash
cd frontend
docker build -f Dockerfile.prod \
  --build-arg VITE_API_URL=https://<backend>.azurewebsites.net \
  -t attestr-frontend:prod .
```

Then create a second **Web App** (Container, Linux, B1) pointing at that image, with `WEBSITES_PORT=80`.

**Simpler alternative — Azure Static Web Apps (free tier):**

1. Create resource → **Static Web App** → connect your GitHub repo
2. App location: `/frontend`
3. Build command: `npm run build`
4. Output location: `dist`
5. In the Static Web App config, set the build-time env var `VITE_API_URL` to your backend URL

Static Web Apps is free and gives you HTTPS automatically — recommended for the frontend.

---

## 4. Wire them together

1. Copy the frontend URL (e.g. `https://attestr.azurestaticapps.net`)
2. Back in the **backend** Web App env vars, set `ATTESTR_CORS_ORIGINS` to that exact URL
3. Restart the backend

Now visit the frontend URL. Because it's served over **HTTPS**, the browser exposes the native Web Crypto API — so the offline verifier uses fast native SHA-256, and the whole certificate/mTLS story holds up properly. (The pure-JS fallback we built still covers any non-HTTPS access.)

---

## 5. Custom domain (optional, from the Student Pack)

Grab a free domain from **Name.com** or **.TECH** in your Student Pack, e.g. `attestr.tech`.
In the Static Web App (or Web App) → **Custom domains** → add it and follow the DNS/validation steps. Azure provisions a free managed TLS certificate.

---

## CLI version (faster, if you have `az` installed)

```bash
# Login (uses your student account)
az login

# Resource group
az group create --name attestr-rg --location eastus

# Postgres
az postgres flexible-server create \
  --resource-group attestr-rg \
  --name attestr-db \
  --tier Burstable --sku-name Standard_B1ms \
  --admin-user attestradmin --admin-password '<STRONG-PASSWORD>' \
  --public-access 0.0.0.0 \
  --database-name attestr

# Backend (container web app) — assumes image already pushed to a registry
az webapp create \
  --resource-group attestr-rg \
  --plan attestr-plan \
  --name attestr-backend \
  --deployment-container-image-name <your-registry>/attestr-backend:latest

az webapp config appsettings set \
  --resource-group attestr-rg --name attestr-backend \
  --settings \
    DATABASE_URL='postgresql://attestradmin:<PW>@attestr-db.postgres.database.azure.com:5432/attestr?sslmode=require' \
    CA_PASSPHRASE='<RANDOM>' JWT_SECRET='<RANDOM>' \
    ATTESTR_ENV=production WEBSITES_PORT=8000
```

---

## Notes specific to Attestr

- **Persistence:** moving from SQLite to managed Postgres means your orgs, certificates, questionnaires, and Tesseras survive restarts and redeploys. The private keys stored on `Certificate.private_key_pem` persist with them.
- **Keystore file:** the app mirrors keys to a keystore file under `/app/data`. On App Service the container filesystem is ephemeral, but since the DB is the primary key store (added in an earlier pass), this is fine — the file mirror just won't persist, and the DB-backed lookup covers it.
- **Secrets:** never commit `CA_PASSPHRASE` or `JWT_SECRET`. Set them only as App Service environment variables.
- **First boot:** demo orgs (Elastic, Airtable, Grammarly, Plaid) auto-seed on startup, so the deployed app is immediately demoable with the quick-login buttons.
