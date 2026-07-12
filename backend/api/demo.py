"""
api/demo.py — Demo endpoints

Includes:
  - Merkle Tree build and verify (for the live demo page)
  - Quick login helpers (for the demo org buttons on the login page)
  - Cert fetch by org name
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List

from crypto.merkle import build_merkle_for_answers, verify_all_answers

router = APIRouter(prefix="/demo", tags=["Demo"])


# ── Merkle demo ───────────────────────────────────────────────────────

class BuildRequest(BaseModel):
    answers: List[dict]

class VerifyRequest(BaseModel):
    answers: List[dict]
    tree: List[List[str]]
    merkle_root: str

@router.post("/merkle/build")
def build_merkle(body: BuildRequest):
    result = build_merkle_for_answers(body.answers)
    return {"root": result["root"], "leaves": result["leaves"], "tree": result["tree"]}

@router.post("/merkle/verify")
def verify_merkle(body: VerifyRequest):
    return verify_all_answers(body.answers, body.tree, body.merkle_root)


# ── Quick login ───────────────────────────────────────────────────────

class QuickLoginRequest(BaseModel):
    name: str  # org name or "ca_admin"

@router.post("/quick-login")
def quick_login(body: QuickLoginRequest):
    """
    One-click demo login. Returns a session token for the named org.
    Used by the demo buttons on the login page.
    Run 'make seed' first to create the demo orgs.
    """
    from models.database import SessionLocal, Organization, Certificate
    from api.auth import create_session_token
    from ca.authority import ca

    ca.initialize()
    db = SessionLocal()
    try:
        if body.name in ("ca_admin", "super_admin"):
            org = db.query(Organization).filter(Organization.role.in_(["super_admin","ca_admin"])).first()
        else:
            org = db.query(Organization).filter(Organization.name == body.name).first()

        if not org:
            raise HTTPException(
                status_code=404,
                detail=f"Org '{body.name}' not found. Run 'make seed' first."
            )

        cert = db.query(Certificate).filter(
            Certificate.org_id == org.id,
            Certificate.is_revoked == False,
        ).first()

        if not cert:
            raise HTTPException(
                status_code=400,
                detail=f"'{org.name}' has no active certificate. Run 'make seed' first."
            )

        token = create_session_token(org.id, org.role)

        return {
            "access_token": token,
            "token_type":   "bearer",
            "org_id":       org.id,
            "org_name":     org.name,
            "role":         "super_admin" if org.role == "ca_admin" else org.role,
            "is_privileged": bool(getattr(org, "is_privileged", False)),
        "workspace_id": getattr(org, "workspace_id", None),
        "is_workspace_admin": bool(getattr(org, "is_workspace_admin", False)),
        }
    finally:
        db.close()


@router.get("/cert/{name}")
def get_cert_by_name(name: str):
    """Return cert PEM for a named org. Fallback for the login page."""
    from models.database import SessionLocal, Organization, Certificate
    from ca.authority import ca

    ca.initialize()
    db = SessionLocal()
    try:
        if name in ("ca_admin", "super_admin"):
            org = db.query(Organization).filter(Organization.role.in_(["super_admin","ca_admin"])).first()
        else:
            org = db.query(Organization).filter(Organization.name == name).first()

        if not org:
            raise HTTPException(status_code=404, detail=f"Org '{name}' not found.")

        cert = db.query(Certificate).filter(
            Certificate.org_id == org.id,
            Certificate.is_revoked == False,
        ).first()

        if not cert:
            raise HTTPException(status_code=404, detail=f"No certificate for '{name}'.")

        return {
            "org_id":   org.id,
            "org_name": org.name,
            "role":     org.role,
            "cert_pem": cert.cert_pem,
        }
    finally:
        db.close()


@router.get("/orgs")
def list_demo_orgs():
    """List all seeded orgs — used by the login page to show demo buttons."""
    from models.database import SessionLocal, Organization, Certificate

    db = SessionLocal()
    try:
        orgs = db.query(Organization).all()
        result = []
        for org in orgs:
            cert = db.query(Certificate).filter(
                Certificate.org_id == org.id,
                Certificate.is_revoked == False,
            ).first()
            result.append({
                "name":     org.name,
                "role":     org.role,
                "has_cert": cert is not None,
            })
        return result
    finally:
        db.close()
