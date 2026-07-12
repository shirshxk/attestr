"""
api/remediation.py — Remediation cycle endpoints
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session

from api.auth import require_auditor, require_vendor, require_privileged_auditor
from models.database import get_db, Organization, Questionnaire, Tessera, RemediationRequest
from remediation.request import create_remediation_request, INSUFFICIENCY_REASONS
from notifications.inapp import create_notification
from notifications.email import notify_remediation_requested
from audit.hmac_log import append_log

router = APIRouter(tags=["Remediation"])


class FlagRequest(BaseModel):
    tessera_id: str
    flags: List[dict]  # [{question_id, reasons: [str], comment: str}]
    auditor_private_key_pem: Optional[str] = None


class RemediationSubmitRequest(BaseModel):
    questionnaire_id: str
    answers: List[dict]
    parent_tessera_id: str


@router.get("/remediation/reasons")
def get_insufficiency_reasons():
    """Return the predefined list of insufficiency reason categories."""
    return {"reasons": INSUFFICIENCY_REASONS}


@router.post("/remediation/flag")
def flag_answers(
    body: FlagRequest,
    auditor: Organization = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    """Auditor flags specific answers as insufficient."""
    t = db.query(Tessera).filter(Tessera.id == body.tessera_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tessera not found.")

    req = create_remediation_request(
        tessera_id              = body.tessera_id,
        auditor_id              = auditor.id,
        flags                   = body.flags,
        auditor_private_key_pem = body.auditor_private_key_pem,
        db                      = db,
    )

    # Get vendor from submission
    from models.database import Submission
    sub    = db.query(Submission).filter(Submission.id == t.submission_id).first()
    vendor = db.query(Organization).filter(Organization.id == sub.vendor_id).first()

    if vendor:
        create_notification(db, vendor.id, "Remediation requested",
            f"{auditor.name} has flagged {len(body.flags)} answer(s) for remediation.")
        notify_remediation_requested(vendor.email, auditor.name, len(body.flags))

    # Update questionnaire status
    q = db.query(Questionnaire).filter(
        Questionnaire.id == sub.questionnaire_id
    ).first()
    if q:
        q.status = "in_remediation"
        db.commit()

    return {
        "remediation_request_id": req.id,
        "flagged_count": len(body.flags),
        "message": "Remediation request created and vendor notified.",
    }


@router.get("/remediation/{tessera_id}/flags")
def get_remediation_flags(
    tessera_id: str,
    org: Organization = Depends(require_vendor),
    db: Session = Depends(get_db),
):
    """Vendor retrieves the remediation flags for their Tessera."""
    req = db.query(RemediationRequest).filter(
        RemediationRequest.tessera_id == tessera_id
    ).order_by(RemediationRequest.created_at.desc()).first()

    if not req:
        raise HTTPException(status_code=404, detail="No remediation request found.")

    return {
        "tessera_id":    tessera_id,
        "flags":         json.loads(req.flags_json),
        "created_at":    req.created_at.isoformat(),
    }


@router.post("/remediation/close/{questionnaire_id}")
def close_questionnaire(
    questionnaire_id: str,
    auditor: Organization = Depends(require_privileged_auditor),
    db: Session = Depends(get_db),
):
    """Close the questionnaire cycle. This is the authoritative final sign-off and
    is restricted to privileged auditors (and admin-tier), not normal auditors."""
    q = db.query(Questionnaire).filter(Questionnaire.id == questionnaire_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Questionnaire not found.")

    # Owned-but-visible: a privileged auditor may close any cycle owned by a
    # teammate in their workspace (not just their own). Super-admins can close any.
    from api.auth import is_admin_tier
    owner_ok = q.auditor_id == auditor.id
    if not owner_ok and auditor.workspace_id:
        owner = db.query(Organization).filter(Organization.id == q.auditor_id).first()
        owner_ok = bool(owner and owner.workspace_id == auditor.workspace_id)
    if not owner_ok and is_admin_tier(auditor):
        owner_ok = True
    if not owner_ok:
        raise HTTPException(status_code=403, detail="This questionnaire belongs to another team.")

    q.status = "closed"
    db.commit()

    append_log(db, "questionnaire_closed", actor_id=auditor.id,
               target_id=questionnaire_id)

    return {"message": "Questionnaire cycle closed.", "status": "closed"}
