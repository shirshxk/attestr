"""
api/keys.py — Key management endpoints

Endpoints:
  POST /keys/rotate              Rotate your own ECC keypair
  GET  /keys/my-cert             Get your current certificate
  POST /admin/keys/shamir/split  Split CA key into Shamir shares (admin only)
  POST /admin/keys/shamir/reconstruct  Reconstruct CA key from shares (admin only)
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List

from api.auth import require_auth, require_ca_admin
from keystore.rotation import rotate_org_key
from keystore.shamir import split_ca_key, reconstruct_ca_key
from models.database import get_db, Organization, Certificate
from config import settings

router = APIRouter(tags=["Key Management"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ShamirSplitRequest(BaseModel):
    n: int = 5   # total shares
    k: int = 3   # threshold


class ShamirReconstructRequest(BaseModel):
    shares: List[str]  # list of base64 encoded share strings


# ── My certificate ────────────────────────────────────────────────────────────

@router.get("/keys/my-cert")
def get_my_cert(
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Return the caller's current active certificate."""
    cert = (
        db.query(Certificate)
        .filter(Certificate.org_id == org.id, Certificate.is_revoked == False)  # noqa
        .order_by(Certificate.issued_at.desc())
        .first()
    )
    if not cert:
        raise HTTPException(status_code=404, detail="No active certificate found.")

    return {
        "org_id":         org.id,
        "org_name":       org.name,
        "cert_pem":       cert.cert_pem,
        "public_key_pem": cert.public_key_pem,
        "serial":         cert.serial_number,
        "issued_at":      cert.issued_at.isoformat(),
        "expires_at":     cert.expires_at.isoformat(),
    }


# ── Key rotation ──────────────────────────────────────────────────────────────

@router.post("/keys/rotate")
def rotate_key(
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """
    Rotate your ECC keypair.
    Generates a new keypair, issues a new certificate, revokes the old one.
    The new private key is returned ONCE — store it securely.
    """
    result = rotate_org_key(
        org_id=org.id,
        org_name=org.name,
        org_role=org.role,
        org_email=org.email,
        db=db,
    )
    return result


# ── Shamir Secret Sharing (CA Admin only) ─────────────────────────────────────

@router.post("/admin/keys/shamir/split")
def shamir_split(
    body: ShamirSplitRequest,
    admin: Organization = Depends(require_ca_admin),
    db: Session = Depends(get_db),
):
    """
    Split the CA master private key into N shares using Shamir's Secret Sharing.
    Any K shares can reconstruct it. K-1 shares reveal nothing.

    Returns N encoded shares. Distribute one to each custodian.
    Never store all shares together.

    Default: 3-of-5
    """
    from keystore.store import KeystoreManager

    ks = KeystoreManager(settings.ca_keystore_path, settings.ca_passphrase)
    ks.load()
    ca_private_key_pem = ks.get_key("ca_private_key")

    shares = split_ca_key(ca_private_key_pem, n=body.n, k=body.k)

    from audit.hmac_log import append_log
    append_log(db, "shamir_split", actor_id=admin.id,
               details={"n": body.n, "k": body.k})

    return {
        "message":   f"CA key split into {body.n} shares. Any {body.k} can reconstruct it.",
        "threshold": body.k,
        "total":     body.n,
        "shares":    shares,
        "warning":   "Distribute one share to each custodian. Never store together.",
    }


@router.post("/admin/keys/shamir/reconstruct")
def shamir_reconstruct(
    body: ShamirReconstructRequest,
    admin: Organization = Depends(require_ca_admin),
    db: Session = Depends(get_db),
):
    """
    Reconstruct the CA private key from K or more Shamir shares.
    Used only in emergency key recovery scenarios.
    """
    try:
        reconstructed_pem = reconstruct_ca_key(body.shares)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Reconstruction failed: {e}")

    # Verify the reconstructed key is valid by loading it
    try:
        from cryptography.hazmat.primitives import serialization
        serialization.load_pem_private_key(reconstructed_pem.encode(), password=None)
    except Exception:
        raise HTTPException(status_code=400, detail="Reconstructed key is invalid.")

    from audit.hmac_log import append_log
    append_log(db, "shamir_reconstruct", actor_id=admin.id,
               details={"shares_used": len(body.shares)})

    return {
        "message":           "CA key successfully reconstructed.",
        "private_key_pem":   reconstructed_pem,
        "warning":           "Store this securely. This operation is logged.",
    }
