"""
api/workspaces.py — Workspace (team) management

A workspace groups auditors (a firm) or vendors (a company). Members see each
other's work (owned-but-visible). Super-admins create workspaces and seed the
first member as workspace admin; that admin can then invite teammates.
"""

from datetime import datetime, timedelta
import os, secrets
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from api.auth import require_super_admin, require_auth, is_admin_tier, is_super_admin
from models.database import get_db, Organization, Workspace, Enrollment, VendorWorkspaceAccess
from audit.hmac_log import append_log

router = APIRouter(prefix="/workspaces", tags=["Workspaces"])
ENROLL_TTL_HOURS = 72


def _frontend_base() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:5173")


class CreateWorkspaceRequest(BaseModel):
    name: str
    kind: str   # auditor | vendor


class InviteMemberRequest(BaseModel):
    name: str
    email: str
    is_privileged: bool = False   # only for auditor workspaces


def _ws_dict(ws: Workspace, db: Session) -> dict:
    # Members are the auditors who belong to this workspace.
    members = db.query(Organization).filter(Organization.workspace_id == ws.id).all()
    # Vendors are assigned via VendorWorkspaceAccess (many-to-many), shown separately.
    vendor_ids = [a.vendor_id for a in db.query(VendorWorkspaceAccess).filter(VendorWorkspaceAccess.workspace_id == ws.id).all()]
    vendors = db.query(Organization).filter(Organization.id.in_(vendor_ids)).all() if vendor_ids else []
    return {
        "id": ws.id, "name": ws.name, "kind": ws.kind,
        "member_count": len(members),
        "vendor_count": len(vendors),
        "members": [
            {
                "id": m.id, "name": m.name, "email": m.email,
                "role": "super_admin" if m.role == "ca_admin" else m.role,
                "is_privileged": bool(m.is_privileged),
                "is_workspace_admin": bool(m.is_workspace_admin),
                "is_active": m.is_active,
            } for m in members
        ],
        "vendors": [
            {"id": v.id, "name": v.name, "email": v.email} for v in vendors
        ],
    }


@router.get("")
def list_workspaces(org: Organization = Depends(require_auth), db: Session = Depends(get_db)):
    """Super-admins see all workspaces; a member sees only their own."""
    if is_admin_tier(org):
        wss = db.query(Workspace).order_by(Workspace.created_at.desc()).all()
        return [_ws_dict(w, db) for w in wss]
    if org.workspace_id:
        ws = db.query(Workspace).filter(Workspace.id == org.workspace_id).first()
        return [_ws_dict(ws, db)] if ws else []
    return []


@router.post("")
def create_workspace(
    body: CreateWorkspaceRequest,
    admin: Organization = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    if body.kind not in ("auditor", "vendor"):
        raise HTTPException(status_code=400, detail="kind must be 'auditor' or 'vendor'.")
    ws = Workspace(name=body.name, kind=body.kind, created_by=admin.id)
    db.add(ws); db.flush()
    append_log(db, "workspace_created", actor_id=admin.id, target_id=ws.id, details={"kind": body.kind})
    db.commit()
    return {"message": "Workspace created.", "id": ws.id, "name": ws.name, "kind": ws.kind}


@router.post("/{workspace_id}/invite")
def invite_member(
    workspace_id: str,
    body: InviteMemberRequest,
    inviter: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """
    Add a member to a workspace via the CSR-enrollment flow. Allowed for
    super-admins, or the workspace admin of THIS workspace.
    """
    ws = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    allowed = is_super_admin(inviter) or (
        inviter.workspace_id == workspace_id and inviter.is_workspace_admin
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Only a super-admin or this workspace's admin can invite members.")

    if db.query(Organization).filter(Organization.email == body.email).first():
        raise HTTPException(status_code=409, detail="An organization with this email already exists.")

    # New member inherits the workspace's kind as its role.
    org = Organization(
        name=body.name, email=body.email, role=ws.kind,
        is_privileged=bool(body.is_privileged) if ws.kind == "auditor" else False,
        workspace_id=ws.id, is_workspace_admin=False, created_by=inviter.id,
    )
    db.add(org); db.flush()

    token = secrets.token_urlsafe(32)
    enr = Enrollment(org_id=org.id, token=token, status="pending", created_by=inviter.id,
                     expires_at=datetime.utcnow() + timedelta(hours=ENROLL_TTL_HOURS))
    db.add(enr)
    append_log(db, "workspace_member_invited", actor_id=inviter.id, target_id=org.id, details={"workspace": ws.id})
    db.commit()

    enroll_url = f"{_frontend_base()}/enroll?token={token}"
    try:
        from notifications.email import send_email
        send_email(to=body.email,
                   subject=f"Join {ws.name} on Attestr",
                   body=f"Hello {body.name},\n\nYou've been invited to the {ws.name} workspace.\n\n"
                        f"Open this link to generate your key and certificate:\n\n{enroll_url}\n\n"
                        f"Expires in {ENROLL_TTL_HOURS} hours.\n")
    except Exception:
        pass
    return {"message": "Member invited.", "org_id": org.id, "enroll_url": enroll_url}


@router.post("/{workspace_id}/assign/{org_id}")
def assign_member(
    workspace_id: str, org_id: str,
    admin: Organization = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """
    Assign an existing auditor org to a workspace (as a member), OR assign a
    vendor to an auditor workspace (via VendorWorkspaceAccess — a vendor can be
    assigned to multiple auditor workspaces, e.g. audited by multiple firms).
    """
    ws = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not ws or not org:
        raise HTTPException(status_code=404, detail="Workspace or org not found.")

    if org.role == "vendor" and ws.kind == "auditor":
        # Many-to-many: vendor ↔ auditor-workspace
        existing = db.query(VendorWorkspaceAccess).filter(
            VendorWorkspaceAccess.vendor_id == org_id,
            VendorWorkspaceAccess.workspace_id == workspace_id,
        ).first()
        if not existing:
            db.add(VendorWorkspaceAccess(vendor_id=org_id, workspace_id=workspace_id))
            append_log(db, "vendor_assigned_to_workspace", actor_id=admin.id, target_id=org.id, details={"workspace": ws.id})
            db.commit()
        return {"message": f"{org.name} assigned to workspace as vendor."}

    if org.role != ws.kind:
        raise HTTPException(status_code=400, detail=f"Only {ws.kind}s can join this workspace.")
    org.workspace_id = ws.id
    append_log(db, "workspace_member_assigned", actor_id=admin.id, target_id=org.id, details={"workspace": ws.id})
    db.commit()
    return {"message": "Member assigned."}


@router.post("/{workspace_id}/admin/{org_id}")
def set_workspace_admin(
    workspace_id: str, org_id: str,
    admin: Organization = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Super-admin designates a workspace admin (the teammate who can invite others)."""
    org = db.query(Organization).filter(Organization.id == org_id, Organization.workspace_id == workspace_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Member not found in this workspace.")
    if org.role not in ("auditor", "super_admin", "ca_admin"):
        raise HTTPException(status_code=400, detail="Only auditors can be workspace admins.")
    org.is_workspace_admin = True
    db.commit()
    return {"message": f"{org.name} is now the workspace admin."}

@router.get("/my")
def my_workspace(org: Organization = Depends(require_auth), db: Session = Depends(get_db)):
    """Return the workspace(s) this org belongs to. Vendors use VendorWorkspaceAccess."""
    from models.database import VendorWorkspaceAccess
    if org.role == "vendor":
        access = db.query(VendorWorkspaceAccess).filter(VendorWorkspaceAccess.vendor_id == org.id).all()
        wss = [db.query(Workspace).filter(Workspace.id == a.workspace_id).first() for a in access]
        return [_ws_dict(w, db) for w in wss if w]
    if org.workspace_id:
        ws = db.query(Workspace).filter(Workspace.id == org.workspace_id).first()
        return [_ws_dict(ws, db)] if ws else []
    return []


class PrivilegeRequest(BaseModel):
    is_privileged: bool


@router.post("/{workspace_id}/privilege/{org_id}")
def set_member_privilege(
    workspace_id: str, org_id: str,
    body: PrivilegeRequest,
    actor: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """
    Grant or revoke privileged status for an auditor in a workspace.
    Allowed for super-admins, or the workspace admin of this workspace (who must
    themselves be a privileged auditor).
    """
    ws = db.query(Workspace).filter(Workspace.id == workspace_id).first()
    if not ws or ws.kind != "auditor":
        raise HTTPException(status_code=404, detail="Auditor workspace not found.")

    allowed = is_super_admin(actor) or (
        actor.workspace_id == workspace_id and actor.is_workspace_admin and actor.is_privileged
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Only a super-admin or this workspace's privileged admin can change privilege.")

    member = db.query(Organization).filter(
        Organization.id == org_id,
        Organization.workspace_id == workspace_id,
        Organization.role == "auditor",
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Auditor not found in this workspace.")
    if member.id == actor.id and not body.is_privileged:
        raise HTTPException(status_code=400, detail="You can't revoke your own privileged status.")

    member.is_privileged = bool(body.is_privileged)
    append_log(db, "workspace_privilege_changed", actor_id=actor.id, target_id=member.id,
               details={"workspace": workspace_id, "is_privileged": body.is_privileged})
    db.commit()
    return {"message": f"{member.name} is {'now privileged' if body.is_privileged else 'no longer privileged'}."}
