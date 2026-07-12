"""
api/admin.py — CA Admin endpoints

Only the CA Admin role can call these.

Endpoints:
  POST /admin/invite              Send an invite to an org
  GET  /admin/organizations       List all orgs + cert status
  POST /admin/certificates/issue  Issue cert to an org after invite accepted
  POST /admin/certificates/revoke Revoke a cert
  GET  /admin/audit-log           View the full HMAC audit log
  POST /admin/audit-log/verify    Verify audit log integrity
  GET  /admin/stats               Platform-wide statistics
"""

import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from api.auth import require_ca_admin, require_auth, login_with_certificate
from audit.hmac_log import append_log, verify_log
from ca.authority import ca
from models.database import (
    get_db, Organization, Invitation, Certificate, AuditLogEntry
)

router = APIRouter(prefix="/admin", tags=["CA Admin"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class InviteRequest(BaseModel):
    email: str
    org_name: str
    role: str  # "auditor" | "vendor"


class RevokeCertRequest(BaseModel):
    serial_hex: str
    reason: str = "unspecified"


class LoginRequest(BaseModel):
    cert_pem: str


# ── Auth ──────────────────────────────────────────────────────────────────────

@router.post("/login")
def admin_login(body: LoginRequest, db: Session = Depends(get_db)):
    """
    Exchange a client certificate for a session token.
    The CA Admin logs in by presenting their certificate.
    """
    return login_with_certificate(body.cert_pem, db)


# ── Invite ────────────────────────────────────────────────────────────────────

@router.post("/invite")
def invite_organization(
    body: InviteRequest,
    admin: Organization = Depends(require_ca_admin),
    db: Session = Depends(get_db),
):
    """
    Issue an invite token for a new organization.
    The token is emailed to them and used to complete registration.
    """
    if body.role not in ("auditor", "vendor"):
        raise HTTPException(status_code=400, detail="Role must be 'auditor' or 'vendor'.")

    # Check email not already registered
    existing = db.query(Organization).filter(Organization.email == body.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered.")

    token   = secrets.token_urlsafe(48)
    expires = datetime.utcnow() + timedelta(days=7)

    invite = Invitation(
        token=token,
        email=body.email,
        intended_role=body.role,
        org_name=body.org_name,
        invited_by_id=admin.id,
        expires_at=expires,
    )
    db.add(invite)
    db.commit()

    append_log(db, "invite_sent", actor_id=admin.id,
               details={"email": body.email, "role": body.role})

    # TODO Sprint 7: send email via Mailhog
    return {
        "message": "Invitation created.",
        "invite_token": token,
        "expires_at": expires.isoformat(),
    }


# ── Registration (called by invited org) ──────────────────────────────────────

class RegisterRequest(BaseModel):
    invite_token: str
    org_name: str  # confirm or override the name in the invite


@router.post("/register", tags=["Auth"])
def register_organization(
    body: RegisterRequest,
    db: Session = Depends(get_db),
):
    """
    Complete registration using an invite token.
    Creates the Organization record. Certificate is issued separately.
    """
    invite = db.query(Invitation).filter(
        Invitation.token == body.invite_token,
        Invitation.is_used == False,  # noqa: E712
    ).first()

    if not invite:
        raise HTTPException(status_code=404, detail="Invalid or expired invite token.")
    if datetime.utcnow() > invite.expires_at:
        raise HTTPException(status_code=400, detail="Invite token has expired.")

    org = Organization(
        name=body.org_name or invite.org_name,
        role=invite.intended_role,
        email=invite.email,
    )
    db.add(org)
    db.flush()  # get the org.id before commit

    invite.is_used     = True
    invite.invited_org_id = org.id
    db.commit()

    append_log(db, "org_registered", target_id=org.id,
               details={"name": org.name, "role": org.role})

    return {
        "message":  "Organization registered. Await certificate issuance from CA Admin.",
        "org_id":   org.id,
        "org_name": org.name,
        "role":     org.role,
    }


# ── Issue certificate ─────────────────────────────────────────────────────────

class IssueCertRequest(BaseModel):
    org_id: str


@router.post("/certificates/issue")
def issue_certificate(
    body: IssueCertRequest,
    admin: Organization = Depends(require_ca_admin),
    db: Session = Depends(get_db),
):
    """
    Issue an X.509 certificate to a registered organization.
    The org's ECC keypair is generated here.
    The private key is returned ONCE — the org must store it securely.
    """
    org = db.query(Organization).filter(Organization.id == body.org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found.")

    # Issue via the CA
    cert_pem, public_key_pem, private_key_pem, serial_hex, expires = ca.issue_certificate(
        org_id=org.id,
        org_name=org.name,
        org_role=org.role,
        email=org.email,
    )

    # Store cert metadata in DB (not the private key — that goes to the org)
    cert_record = Certificate(
        org_id=org.id,
        serial_number=serial_hex,
        cert_pem=cert_pem,
        public_key_pem=public_key_pem,
        expires_at=expires,
    )
    db.add(cert_record)
    db.commit()

    append_log(db, "cert_issued", actor_id=admin.id, target_id=org.id,
               details={"serial": serial_hex, "expires_at": expires.isoformat()})

    return {
        "message":        "Certificate issued.",
        "cert_pem":       cert_pem,
        "public_key_pem": public_key_pem,
        "private_key_pem": private_key_pem,  # returned once only
        "serial_hex":     serial_hex,
        "expires_at":     expires.isoformat(),
        "warning":        "Store the private key securely. It will not be shown again.",
    }


# ── Revoke certificate ────────────────────────────────────────────────────────

@router.post("/certificates/revoke")
def revoke_certificate(
    body: RevokeCertRequest,
    admin: Organization = Depends(require_ca_admin),
    db: Session = Depends(get_db),
):
    """Revoke a certificate by serial number. Adds it to the CRL."""
    cert = db.query(Certificate).filter(
        Certificate.serial_number == body.serial_hex
    ).first()
    if not cert:
        raise HTTPException(status_code=404, detail="Certificate not found.")

    ca.revoke_certificate(body.serial_hex, body.reason)

    cert.is_revoked        = True
    cert.revoked_at        = datetime.utcnow()
    cert.revocation_reason = body.reason
    db.commit()

    append_log(db, "cert_revoked", actor_id=admin.id, target_id=cert.org_id,
               details={"serial": body.serial_hex, "reason": body.reason})

    return {"message": "Certificate revoked.", "serial_hex": body.serial_hex}


# ── Organizations list ────────────────────────────────────────────────────────

@router.get("/organizations")
def list_organizations(
    admin: Organization = Depends(require_ca_admin),
    db: Session = Depends(get_db),
):
    """Return all organizations with their certificate status."""
    orgs = db.query(Organization).all()
    result = []
    for org in orgs:
        certs = db.query(Certificate).filter(Certificate.org_id == org.id).all()
        active_cert = next((c for c in certs if not c.is_revoked), None)
        result.append({
            "id":          org.id,
            "name":        org.name,
            "role":        org.role,
            "email":       org.email,
            "is_active":   org.is_active,
            "created_at":  org.created_at.isoformat(),
            "has_cert":    active_cert is not None,
            "cert_expires": active_cert.expires_at.isoformat() if active_cert else None,
            "cert_serial":  active_cert.serial_number if active_cert else None,
        })
    return result


# ── Audit log ─────────────────────────────────────────────────────────────────

@router.get("/audit-log")
def get_audit_log(
    admin: Organization = Depends(require_ca_admin),
    db: Session = Depends(get_db),
    limit: int = 100,
    offset: int = 0,
):
    """Return paginated audit log entries."""
    entries = (
        db.query(AuditLogEntry)
        .order_by(AuditLogEntry.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [
        {
            "id":           e.id,
            "event_type":   e.event_type,
            "actor_id":     e.actor_id,
            "target_id":    e.target_id,
            "details":      e.details_json,
            "hmac_hex":     e.hmac_hex,
            "created_at":   e.created_at.isoformat(),
        }
        for e in entries
    ]


@router.post("/audit-log/verify")
def verify_audit_log(
    admin: Organization = Depends(require_ca_admin),
    db: Session = Depends(get_db),
):
    """Verify the integrity of the entire HMAC audit log chain."""
    result = verify_log(db)
    return result


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats")
def get_platform_stats(
    admin: Organization = Depends(require_ca_admin),
    db: Session = Depends(get_db),
):
    """Platform-wide statistics for the CA Admin dashboard."""
    from models.database import Questionnaire, Tessera

    return {
        "total_orgs":           db.query(Organization).count(),
        "super_admin_count":    db.query(Organization).filter(Organization.role.in_(["super_admin","ca_admin"])).count(),
        "auditor_count":        db.query(Organization).filter(Organization.role == "auditor").count(),
        "privileged_auditors":  db.query(Organization).filter(Organization.role == "auditor", Organization.is_privileged == True).count(),  # noqa
        "vendor_count":         db.query(Organization).filter(Organization.role == "vendor").count(),
        "active_certs":         db.query(Certificate).filter(Certificate.is_revoked == False).count(),  # noqa
        "revoked_certs":        db.query(Certificate).filter(Certificate.is_revoked == True).count(),   # noqa
        "total_questionnaires": db.query(Questionnaire).count(),
        "total_tesseras":       db.query(Tessera).count(),
        "audit_log_entries":    db.query(AuditLogEntry).count(),
    }


# ── Auditor-accessible vendor list ───────────────────────────────────────────

@router.get("/vendors")
def list_vendors(
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """
    Return vendor organizations visible to this caller.
    - super_admin / ca_admin: all vendors.
    - Auditor in a workspace: only vendors assigned to their workspace via
      VendorWorkspaceAccess (privacy — auditor firms shouldn't see each other's vendors).
    - Auditor not in a workspace: all vendors (backwards-compat for demo orgs).
    """
    from models.database import Certificate, VendorWorkspaceAccess
    if org.role == "auditor" and org.workspace_id:
        assigned_ids = [a.vendor_id for a in db.query(VendorWorkspaceAccess).filter(
            VendorWorkspaceAccess.workspace_id == org.workspace_id
        ).all()]
        vendors = db.query(Organization).filter(
            Organization.role == "vendor",
            Organization.id.in_(assigned_ids),
        ).all() if assigned_ids else []
    else:
        vendors = db.query(Organization).filter(Organization.role == "vendor").all()

    result = []
    for v in vendors:
        cert = db.query(Certificate).filter(
            Certificate.org_id == v.id,
            Certificate.is_revoked == False,  # noqa
        ).first()
        result.append({
            "id":       v.id,
            "name":     v.name,
            "email":    v.email,
            "has_cert": cert is not None,
        })
    return result
