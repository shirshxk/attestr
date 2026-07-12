"""
api/vendor_requests.py — Auditor → CA Admin vendor onboarding flow

Flow:
  1. Auditor submits a request to onboard a vendor (name + email)
  2. CA Admin sees pending requests, approves or rejects
  3. On approval: vendor org is created + certificate auto-issued
  4. Vendor then appears in the auditor's vendor list
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime
from sqlalchemy.orm import Session

from api.auth import require_auth, require_ca_admin, require_auditor
from models.database import (
    get_db, Organization, Certificate, VendorRequest,
)
from audit.hmac_log import append_log
from notifications.inapp import create_notification

router = APIRouter(tags=["Vendor Requests"])


class CreateVendorRequest(BaseModel):
    vendor_name:  str
    vendor_email: str
    note:         Optional[str] = None


# ── Auditor: submit a request ─────────────────────────────────────────────────

@router.post("/vendor-requests")
def submit_vendor_request(
    body: CreateVendorRequest,
    auditor: Organization = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    """Auditor requests that a new vendor be onboarded."""
    # If a vendor with this email already exists, link directly
    existing = db.query(Organization).filter(
        Organization.email == body.vendor_email,
        Organization.role == "vendor",
    ).first()

    if existing:
        return {
            "status": "already_exists",
            "vendor_id": existing.id,
            "vendor_name": existing.name,
            "message": f"{existing.name} already exists — you can assign questionnaires now.",
        }

    # Avoid duplicate pending requests
    dup = db.query(VendorRequest).filter(
        VendorRequest.vendor_email == body.vendor_email,
        VendorRequest.status == "pending",
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail="A pending request for this email already exists.")

    req = VendorRequest(
        auditor_id   = auditor.id,
        vendor_name  = body.vendor_name,
        vendor_email = body.vendor_email,
        note         = body.note,
    )
    db.add(req)
    db.commit()

    append_log(db, "vendor_request_submitted", actor_id=auditor.id,
               details={"vendor_email": body.vendor_email})

    # Notify all CA admins
    admins = db.query(Organization).filter(Organization.role == "ca_admin").all()
    for admin in admins:
        create_notification(db, admin.id, "New vendor request",
            f"{auditor.name} requested onboarding for {body.vendor_name} ({body.vendor_email})")

    return {
        "status": "pending",
        "request_id": req.id,
        "message": "Request submitted. Awaiting CA Admin approval.",
    }


# ── Auditor: see own requests ─────────────────────────────────────────────────

@router.get("/vendor-requests/mine")
def my_vendor_requests(
    auditor: Organization = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    reqs = db.query(VendorRequest).filter(
        VendorRequest.auditor_id == auditor.id
    ).order_by(VendorRequest.created_at.desc()).all()
    return [_serialize(r) for r in reqs]


# ── CA Admin: see all pending requests ────────────────────────────────────────

@router.get("/vendor-requests")
def list_vendor_requests(
    admin: Organization = Depends(require_ca_admin),
    db: Session = Depends(get_db),
):
    reqs = db.query(VendorRequest).order_by(VendorRequest.created_at.desc()).all()
    out = []
    for r in reqs:
        d = _serialize(r)
        auditor = db.query(Organization).filter(Organization.id == r.auditor_id).first()
        d["auditor_name"] = auditor.name if auditor else "Unknown"
        out.append(d)
    return out


# ── CA Admin: approve ─────────────────────────────────────────────────────────

@router.post("/vendor-requests/{request_id}/approve")
def approve_vendor_request(
    request_id: str,
    admin: Organization = Depends(require_ca_admin),
    db: Session = Depends(get_db),
):
    """Approve a vendor request — creates the org and issues a certificate."""
    from ca.authority import ca
    from keystore.store import KeystoreManager
    from config import settings

    req = db.query(VendorRequest).filter(VendorRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found.")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail=f"Request already {req.status}.")

    # Create vendor org
    vendor = Organization(name=req.vendor_name, role="vendor", email=req.vendor_email)
    db.add(vendor)
    db.flush()

    # Issue certificate
    cert_pem, pub_pem, priv_pem, serial, expires = ca.issue_certificate(
        org_id=vendor.id, org_name=vendor.name,
        org_role=vendor.role, email=vendor.email,
    )
    cert = Certificate(
        org_id=vendor.id, serial_number=serial,
        cert_pem=cert_pem, public_key_pem=pub_pem, expires_at=expires,
    )
    db.add(cert)

    # Save private key to keystore for demo quick-login
    try:
        ks_path = settings.ca_keystore_path.replace("ca_keystore", f"vendor_{vendor.id}_key")
        ks = KeystoreManager(ks_path, settings.ca_passphrase)
        ks.store_key("private_key", priv_pem)
        ks.save()
    except Exception:
        pass

    # Update request
    req.status = "approved"
    req.created_vendor_id = vendor.id
    req.reviewed_by_id = admin.id
    req.reviewed_at = datetime.utcnow()
    db.commit()

    append_log(db, "vendor_request_approved", actor_id=admin.id, target_id=vendor.id,
               details={"vendor_name": vendor.name})

    # Notify the auditor
    create_notification(db, req.auditor_id, "Vendor approved",
        f"{vendor.name} has been onboarded and is ready to receive questionnaires.")

    return {
        "status": "approved",
        "vendor_id": vendor.id,
        "vendor_name": vendor.name,
        "message": f"{vendor.name} onboarded with an active certificate.",
    }


# ── CA Admin: reject ──────────────────────────────────────────────────────────

@router.post("/vendor-requests/{request_id}/reject")
def reject_vendor_request(
    request_id: str,
    admin: Organization = Depends(require_ca_admin),
    db: Session = Depends(get_db),
):
    req = db.query(VendorRequest).filter(VendorRequest.id == request_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Request not found.")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail=f"Request already {req.status}.")

    req.status = "rejected"
    req.reviewed_by_id = admin.id
    req.reviewed_at = datetime.utcnow()
    db.commit()

    append_log(db, "vendor_request_rejected", actor_id=admin.id,
               details={"vendor_email": req.vendor_email})

    create_notification(db, req.auditor_id, "Vendor request declined",
        f"Your request to onboard {req.vendor_name} was declined.")

    return {"status": "rejected"}


def _serialize(r: VendorRequest) -> dict:
    return {
        "id":           r.id,
        "vendor_name":  r.vendor_name,
        "vendor_email": r.vendor_email,
        "status":       r.status,
        "note":         r.note,
        "created_vendor_id": r.created_vendor_id,
        "created_at":   r.created_at.isoformat(),
        "reviewed_at":  r.reviewed_at.isoformat() if r.reviewed_at else None,
    }
