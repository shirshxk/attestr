"""
main.py — Attestr FastAPI application

Startup sequence:
  1. Initialize the database (create tables)
  2. Initialize the CA (load or generate root keypair)
  3. Bootstrap the CA Admin org if it doesn't exist yet
  4. Register all API routers
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ca.authority import ca
from ca.timestamp import tsa
from config import settings
from models.database import init_db, SessionLocal, Organization


# ── Lifespan (runs at startup / shutdown) ─────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ⓪ Refuse to boot in production with insecure default secrets.
    from config import validate_production_secrets
    validate_production_secrets(settings)

    # ① Create all DB tables
    init_db()

    # ② Initialize the CA (loads or generates root cert + key)
    ca.initialize()

    # ③ Give the TSA a reference to the CA signing key
    #    (the CA private key is accessed via the keystore)
    from keystore.store import KeystoreManager
    from cryptography.hazmat.primitives import serialization
    ks = KeystoreManager(settings.ca_keystore_path, settings.ca_passphrase)
    ks.load()
    ca_key_pem = ks.get_key("ca_private_key").encode()
    ca_private_key = serialization.load_pem_private_key(ca_key_pem, password=None)
    tsa.set_signing_key(ca_private_key)

    # ④ Bootstrap the CA Admin org if it doesn't exist yet
    _bootstrap_ca_admin()
    # Demo orgs are a development-only convenience — never auto-seed in production.
    if settings.attestr_env == "development":
        _autoseed_demo_orgs()

    yield
    # Nothing to clean up on shutdown for now


def _bootstrap_ca_admin():
    """
    Create the single super-admin (the CA) on first startup. This is the root
    trust anchor — it must exist before anything else. Also migrates any legacy
    'ca_admin' role to 'super_admin'.
    """
    db = SessionLocal()
    try:
        # Migrate legacy role name
        legacy = db.query(Organization).filter(Organization.role == "ca_admin").all()
        for o in legacy:
            o.role = "super_admin"
        if legacy:
            db.commit()
            print(f"[Attestr] Migrated {len(legacy)} ca_admin → super_admin")

        existing = db.query(Organization).filter(Organization.role == "super_admin").first()
        if not existing:
            admin_org = Organization(
                name="Attestr CA (Super Admin)",
                role="super_admin",
                email="admin@attestr.local",
            )
            db.add(admin_org)
            db.commit()
            print(f"[Attestr] Super-admin (CA) org bootstrapped: {admin_org.id}")
        else:
            print(f"[Attestr] Super-admin (CA) org exists: {existing.id}")
    finally:
        db.close()


def _autoseed_demo_orgs():
    """
    Auto-create demo orgs (Elastic, Airtable, Grammarly, Plaid) with certificates
    on first startup so the app is usable immediately without a manual seed step.
    Also ensures the CA Admin has a certificate.
    """
    from models.database import Certificate
    from ca.authority import ca
    from keystore.store import KeystoreManager
    from config import settings

    DEMO = [
        ("Elastic",   "auditor", "security@elastic.co"),
        ("Airtable",  "auditor", "security@airtable.com"),
        ("Grammarly", "vendor",  "security@grammarly.com"),
        ("Plaid",     "vendor",  "security@plaid.com"),
    ]

    db = SessionLocal()
    try:
        def ensure_cert(org, prefix):
            existing = db.query(Certificate).filter(
                Certificate.org_id == org.id,
                Certificate.is_revoked == False,  # noqa
            ).first()
            if existing:
                return
            cert_pem, pub_pem, priv_pem, serial, expires = ca.issue_certificate(
                org_id=org.id, org_name=org.name, org_role=org.role, email=org.email
            )
            db.add(Certificate(
                org_id=org.id, serial_number=serial,
                cert_pem=cert_pem, public_key_pem=pub_pem, expires_at=expires,
            ))
            db.flush()
            try:
                ks_path = settings.ca_keystore_path.replace("ca_keystore", f"{prefix}_{org.id}_key")
                ks = KeystoreManager(ks_path, settings.ca_passphrase)
                ks.store_key("private_key", priv_pem)
                ks.save()
            except Exception:
                pass

        # CA Admin cert
        admin = db.query(Organization).filter(Organization.role.in_(["super_admin","ca_admin"])).first()
        if admin:
            ensure_cert(admin, "admin")

        # Demo orgs
        for name, role, email in DEMO:
            org = db.query(Organization).filter(Organization.name == name).first()
            if not org:
                org = Organization(name=name, role=role, email=email)
                db.add(org)
                db.flush()
                print(f"[Attestr] Auto-seeded {name} ({role})")
            ensure_cert(org, role)

        db.commit()
        print("[Attestr] Demo orgs ready.")
    except Exception as e:
        print(f"[Attestr] Auto-seed skipped: {e}")
        db.rollback()
    finally:
        db.close()


# ── Application ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="Attestr API",
    description="Zero-trust cryptographic platform for TPRM and compliance verification.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — permissive in dev; in production, set ALLOWED_ORIGINS (comma-separated).
import os as _os
_cors_origins = (
    ["*"] if settings.attestr_env == "development"
    else [o.strip() for o in _os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

from api.admin import router as admin_router
from api.keys  import router as keys_router
from api.demo  import router as demo_router
from api.vendor_requests import router as vendor_requests_router
from api.users import router as users_router
from api.workspaces import router as workspaces_router

app.include_router(admin_router)
app.include_router(keys_router)
# /demo/* issues unauthenticated convenience sessions — DEVELOPMENT ONLY.
if settings.attestr_env == "development":
    app.include_router(demo_router)
app.include_router(vendor_requests_router)
app.include_router(users_router)
app.include_router(workspaces_router)

# All sprint routers now active
from api.questionnaire import router as questionnaire_router
from api.bundle        import router as bundle_router
from api.remediation   import router as remediation_router
from api.notifications import router as notifications_router
from api.performance   import router as performance_router
from api.export        import router as export_router

app.include_router(questionnaire_router)
app.include_router(bundle_router)
app.include_router(remediation_router)
app.include_router(notifications_router)
app.include_router(performance_router)
app.include_router(export_router)

# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health", tags=["System"])
def health_check():
    return {
        "status": "ok",
        "ca_ready": ca._ca_cert is not None,
        "env": settings.attestr_env,
    }


@app.get("/", tags=["System"])
def root():
    return {
        "app":     "Attestr",
        "version": "1.0.0",
        "docs":    "/docs",
    }
