"""
api/users.py — User & role management (RBAC)

Hierarchy:  super_admin (the CA)  >  admin  >  auditor / vendor

Rules enforced here:
  - Only super_admins can create super_admins or admins.
  - admins (and super_admins) can create auditors and vendors.
  - Only super_admins can grant/revoke the 'privileged auditor' flag and toggle admin.
  - A user cannot deactivate or demote themselves.
  - Creating a user issues their certificate immediately (and stores the
    private key on the cert row, matching the rest of the app).
"""

import os
import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from api.auth import (
    require_admin, require_super_admin, require_auth, is_admin_tier, is_super_admin,
)
from models.database import get_db, Organization, Certificate, Enrollment
from ca.authority import ca
from audit.hmac_log import append_log

router = APIRouter(prefix="/users", tags=["User Management"])

CREATABLE_BY_SUPER = {"super_admin", "auditor", "vendor"}
CREATABLE_BY_ADMIN = {"auditor", "vendor"}

ENROLL_TTL_HOURS = 72


def _frontend_base() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:5173")


class CreateUserRequest(BaseModel):
    name: str
    email: str
    role: str                     # super_admin | admin | auditor | vendor
    is_privileged: bool = False   # only applies to auditors


class UpdateUserRequest(BaseModel):
    is_privileged: Optional[bool] = None
    is_active: Optional[bool] = None
    role: Optional[str] = None


class CompleteEnrollmentRequest(BaseModel):
    token: str
    csr_pem: str


@router.get("")
def list_users(
    admin: Organization = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """List all organizations/users (admin-tier only)."""
    orgs = db.query(Organization).order_by(Organization.created_at.desc()).all()
    has_cert = {
        c.org_id for c in db.query(Certificate).filter(Certificate.is_revoked == False).all()  # noqa: E712
    }
    pending = {
        e.org_id for e in db.query(Enrollment).filter(Enrollment.status == "pending").all()
    }
    return [
        {
            "id": o.id, "name": o.name, "email": o.email,
            "role": "super_admin" if o.role == "ca_admin" else o.role,
            "is_privileged": bool(o.is_privileged),
            "is_active": o.is_active,
            "has_cert": o.id in has_cert,
            "enrollment_pending": o.id in pending and o.id not in has_cert,
            "created_at": o.created_at.isoformat() if o.created_at else None,
        }
        for o in orgs
    ]


@router.post("")
def create_user(
    body: CreateUserRequest,
    creator: Organization = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Create a new user/org and start a CSR-based enrollment.

    No keypair is generated here. We create the org record and a one-time
    enrollment token, then email an enrollment link. The user generates their
    own keypair in the browser and submits a CSR to receive their certificate —
    so the private key never touches the server or the admin.
    """
    role = "super_admin" if body.role == "ca_admin" else body.role
    if role not in ("super_admin", "admin", "auditor", "vendor"):
        raise HTTPException(status_code=400, detail="Invalid role.")

    allowed = CREATABLE_BY_SUPER if is_super_admin(creator) else CREATABLE_BY_ADMIN
    if role not in allowed:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have permission to create a '{role}'. "
                   f"Only a super-admin can create super-admins and admins.",
        )

    if db.query(Organization).filter(Organization.email == body.email).first():
        raise HTTPException(status_code=409, detail="An organization with this email already exists.")

    org = Organization(
        name=body.name,
        email=body.email,
        role=role,
        is_privileged=bool(body.is_privileged) if role == "auditor" else False,
        created_by=creator.id,
    )
    db.add(org)
    db.flush()

    token = secrets.token_urlsafe(32)
    enr = Enrollment(
        org_id=org.id, token=token, status="pending",
        created_by=creator.id,
        expires_at=datetime.utcnow() + timedelta(hours=ENROLL_TTL_HOURS),
    )
    db.add(enr)

    append_log(db, "user_created", actor_id=creator.id, target_id=org.id,
               details={"role": role, "is_privileged": org.is_privileged, "enrollment": "pending"})
    db.commit()

    enroll_url = f"{_frontend_base()}/enroll?token={token}"

    # Email the enrollment link (best-effort; never fail creation over email)
    try:
        from notifications.email import send_email
        send_email(
            to=body.email,
            subject="Your Attestr enrollment — generate your certificate",
            body=(
                f"Hello {body.name},\n\n"
                f"An Attestr {role.replace('_',' ')} account has been created for you.\n\n"
                f"Open this one-time link to generate your private key (in your browser, "
                f"it never leaves your device) and receive your certificate:\n\n"
                f"{enroll_url}\n\n"
                f"This link expires in {ENROLL_TTL_HOURS} hours.\n"
            ),
        )
    except Exception:
        pass

    return {
        "message": f"{role.replace('_',' ').title()} created. Enrollment link sent.",
        "org_id": org.id,
        "role": role,
        "is_privileged": org.is_privileged,
        "enroll_url": enroll_url,   # also returned so the admin can copy/share if needed
    }


@router.get("/enroll/{token}")
def get_enrollment(token: str, db: Session = Depends(get_db)):
    """Public: validate an enrollment token and return who it's for (no secrets)."""
    enr = db.query(Enrollment).filter(Enrollment.token == token).first()
    if not enr:
        raise HTTPException(status_code=404, detail="Invalid enrollment link.")
    if enr.status != "pending":
        raise HTTPException(status_code=410, detail="This enrollment link has already been used.")
    if datetime.utcnow() > enr.expires_at:
        enr.status = "expired"; db.commit()
        raise HTTPException(status_code=410, detail="This enrollment link has expired.")
    org = db.query(Organization).filter(Organization.id == enr.org_id).first()
    return {
        "org_name": org.name, "email": org.email,
        "role": "super_admin" if org.role == "ca_admin" else org.role,
    }


@router.post("/enroll/complete")
def complete_enrollment(body: CompleteEnrollmentRequest, db: Session = Depends(get_db)):
    """
    Public: the user submits a CSR (generated in their browser). The CA verifies
    proof-of-possession, signs it, and returns the certificate. The server never
    sees the private key.
    """
    enr = db.query(Enrollment).filter(Enrollment.token == body.token).first()
    if not enr:
        raise HTTPException(status_code=404, detail="Invalid enrollment link.")
    if enr.status != "pending":
        raise HTTPException(status_code=410, detail="This enrollment link has already been used.")
    if datetime.utcnow() > enr.expires_at:
        enr.status = "expired"; db.commit()
        raise HTTPException(status_code=410, detail="This enrollment link has expired.")

    org = db.query(Organization).filter(Organization.id == enr.org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found.")

    try:
        cert_pem, pub_pem, serial, expires = ca.sign_csr(
            csr_pem=body.csr_pem,
            org_id=org.id, org_name=org.name, org_role=org.role, email=org.email,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    cert = Certificate(
        org_id=org.id, serial_number=serial,
        cert_pem=cert_pem, public_key_pem=pub_pem, expires_at=expires,
    )
    db.add(cert)
    enr.status = "completed"
    enr.completed_at = datetime.utcnow()
    append_log(db, "enrollment_completed", target_id=org.id, details={"serial": serial})
    db.commit()

    return {
        "message": "Certificate issued.",
        "certificate_pem": cert_pem,
        "org_name": org.name,
        "role": "super_admin" if org.role == "ca_admin" else org.role,
    }


@router.post("/{org_id}/enrollment")
def resend_enrollment(
    org_id: str,
    creator: Organization = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Regenerate (or refresh) the enrollment link for a user who hasn't completed
    enrollment yet. Issues a fresh token, invalidates old pending ones, re-emails.
    """
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="User not found.")
    # If they already have a live cert, no enrollment needed
    has_cert = db.query(Certificate).filter(
        Certificate.org_id == org_id, Certificate.is_revoked == False  # noqa: E712
    ).first()
    if has_cert:
        raise HTTPException(status_code=400, detail="This user is already enrolled.")

    # expire old pending tokens
    for old in db.query(Enrollment).filter(Enrollment.org_id == org_id, Enrollment.status == "pending").all():
        old.status = "expired"

    token = secrets.token_urlsafe(32)
    enr = Enrollment(
        org_id=org.id, token=token, status="pending", created_by=creator.id,
        expires_at=datetime.utcnow() + timedelta(hours=ENROLL_TTL_HOURS),
    )
    db.add(enr)
    append_log(db, "enrollment_resent", actor_id=creator.id, target_id=org.id)
    db.commit()

    enroll_url = f"{_frontend_base()}/enroll?token={token}"
    try:
        from notifications.email import send_email
        send_email(
            to=org.email,
            subject="Your Attestr enrollment link",
            body=(f"Hello {org.name},\n\nHere is your enrollment link:\n\n{enroll_url}\n\n"
                  f"It expires in {ENROLL_TTL_HOURS} hours.\n"),
        )
    except Exception:
        pass
    return {"message": "Enrollment link refreshed.", "enroll_url": enroll_url}


@router.patch("/{org_id}")
def update_user(
    org_id: str,
    body: UpdateUserRequest,
    creator: Organization = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Update a user. Sensitive changes require super_admin."""
    target = db.query(Organization).filter(Organization.id == org_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    if target.id == creator.id:
        raise HTTPException(status_code=400, detail="You cannot modify your own account here.")

    target_is_elevated = is_admin_tier(target)

    if body.is_privileged is not None:
        if not is_super_admin(creator):
            raise HTTPException(status_code=403, detail="Only a super-admin can change auditor privileges.")
        if target.role != "auditor":
            raise HTTPException(status_code=400, detail="Only auditors can be made privileged.")
        target.is_privileged = bool(body.is_privileged)

    if body.role is not None:
        if not is_super_admin(creator):
            raise HTTPException(status_code=403, detail="Only a super-admin can change roles.")
        new_role = "super_admin" if body.role == "ca_admin" else body.role
        if new_role not in ("super_admin", "admin", "auditor", "vendor"):
            raise HTTPException(status_code=400, detail="Invalid role.")
        target.role = new_role
        if new_role != "auditor":
            target.is_privileged = False

    if body.is_active is not None:
        if target_is_elevated and not is_super_admin(creator):
            raise HTTPException(status_code=403, detail="Only a super-admin can deactivate an admin or super-admin.")
        target.is_active = bool(body.is_active)

    append_log(db, "user_updated", actor_id=creator.id, target_id=target.id,
               details={"role": target.role, "is_privileged": target.is_privileged, "is_active": target.is_active})
    db.commit()
    return {"message": "User updated.", "id": target.id}


@router.delete("/{org_id}")
def delete_user(
    org_id: str,
    creator: Organization = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Permanently remove a user. Only inactive users can be deleted, to prevent
    accidental removal of active accounts. Elevated targets require super-admin."""
    target = db.query(Organization).filter(Organization.id == org_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    if target.id == creator.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")
    if target.is_active:
        raise HTTPException(status_code=400, detail="Deactivate the user before deleting.")
    if is_admin_tier(target) and not is_super_admin(creator):
        raise HTTPException(status_code=403, detail="Only a super-admin can delete an admin or super-admin.")

    # Clean up dependent records so the delete doesn't orphan data or fail on FK.
    from models.database import Certificate
    db.query(Certificate).filter(Certificate.org_id == target.id).delete(synchronize_session=False)

    name = target.name
    append_log(db, "user_deleted", actor_id=creator.id, target_id=target.id,
               details={"name": name, "role": target.role})
    db.delete(target)
    db.commit()
    return {"message": f"{name} has been removed.", "id": org_id}


@router.get("/me")
def whoami(
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Return the current user's fresh session data. Any authenticated user can
    call this — useful for refreshing the frontend session after role/workspace
    changes without a full re-login."""
    return {
        "org_id":            org.id,
        "org_name":          org.name,
        "role":              "super_admin" if org.role == "ca_admin" else org.role,
        "is_privileged":     bool(org.is_privileged),
        "workspace_id":      org.workspace_id,
        "is_workspace_admin": bool(org.is_workspace_admin),
    }
