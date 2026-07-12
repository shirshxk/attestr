"""
scripts/seed_demo.py — Seed the four demo organizations

Run: docker exec -it attestr_backend python scripts/seed_demo.py

Creates:
  - Elastic (Auditor)
  - Airtable (Auditor)
  - Grammarly (Vendor)
  - Plaid (Vendor)

Each org gets a certificate. Private keys are saved to keystores.
Prints login tokens for all four orgs.
"""

import sys
import os
import json
sys.path.insert(0, '/app')

from models.database import SessionLocal, Organization, Certificate, init_db
from ca.authority import ca
from config import settings
from keystore.store import KeystoreManager
import httpx

# Initialize
init_db()
ca.initialize()

db = SessionLocal()

ORGS = [
    {"name": "Elastic",   "role": "auditor", "email": "security@elastic.co"},
    {"name": "Airtable",  "role": "auditor", "email": "security@airtable.com"},
    {"name": "Grammarly", "role": "vendor",  "email": "security@grammarly.com"},
    {"name": "Plaid",     "role": "vendor",  "email": "security@plaid.com"},
]

print("=== Attestr Demo Seed ===\n")

for org_data in ORGS:
    # Skip if already exists
    existing = db.query(Organization).filter(Organization.name == org_data["name"]).first()
    if existing:
        print(f"✓ {org_data['name']} already exists")
        org = existing
    else:
        org = Organization(**org_data)
        db.add(org)
        db.flush()
        print(f"+ Created {org.name} ({org.role})")

    # Check if cert exists
    existing_cert = db.query(Certificate).filter(
        Certificate.org_id == org.id,
        Certificate.is_revoked == False,
    ).first()

    if not existing_cert:
        cert_pem, pub_pem, priv_pem, serial, expires = ca.issue_certificate(
            org_id=org.id, org_name=org.name,
            org_role=org.role, email=org.email
        )
        cert = Certificate(
            org_id=org.id, serial_number=serial,
            cert_pem=cert_pem, public_key_pem=pub_pem, expires_at=expires,
        )
        db.add(cert)
        db.flush()

        # Save private key to keystore for demo use
        role_prefix = "vendor" if org.role == "vendor" else "auditor"
        ks_path = settings.ca_keystore_path.replace("ca_keystore", f"{role_prefix}_{org.id}_key")
        ks = KeystoreManager(ks_path, settings.ca_passphrase)
        ks.store_key("private_key", priv_pem)
        ks.save()
        print(f"  ✓ Certificate issued, private key saved")
    else:
        print(f"  ✓ Certificate already exists")

db.commit()
print()

# Print login tokens
print("=== Login Tokens ===\n")
for org_data in ORGS:
    org  = db.query(Organization).filter(Organization.name == org_data["name"]).first()
    cert = db.query(Certificate).filter(
        Certificate.org_id == org.id,
        Certificate.is_revoked == False,
    ).first()
    if cert:
        try:
            r = httpx.post("http://localhost:8000/admin/login",
                           json={"cert_pem": cert.cert_pem})
            token = r.json().get("access_token", "ERROR")
            print(f"{org.name} ({org.role}):")
            print(f"  {token[:60]}...")
            print()
        except Exception as e:
            print(f"{org.name}: Login failed — {e}")

db.close()
print("Done. Open http://localhost:5173 and use the cert PEM to log in.")
print("Or use the tokens above in Swagger at http://localhost:8000/docs")
