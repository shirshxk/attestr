"""
api/remediation.py — Remediation cycle endpoints
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List
from sqlalchemy.orm import Session

from api.auth import require_auditor, require_vendor
from models.database import get_db, Organization, Questionnaire, Tessera, RemediationRequest
from remediation.request import create_remediation_request, INSUFFICIENCY_REASONS
from notifications.inapp import create_notification
from notifications.email import notify_remediation_requested
from audit.hmac_log import append_log

router = APIRouter(tags=["Remediation"])


def _auditor_key(auditor_id: str) -> str:
    """Fetch the auditor's private key from the keystore to sign flags server-side."""
    from keystore.store import get_org_private_key
    key = get_org_private_key(auditor_id)
    if not key:
        raise HTTPException(status_code=400, detail="Auditor signing key not found in keystore.")
    return key


class FlagRequest(BaseModel):
    tessera_id: str
    flags: List[dict]  # [{question_id, reasons: [str], comment: str}]


class AdditionalContextRequest(BaseModel):
    tessera_id: str
    question_id: str
    comment: str


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
        auditor_private_key_pem = _auditor_key(auditor.id),
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


@router.post("/remediation/request-context")
def request_additional_context(
    body: AdditionalContextRequest,
    auditor: Organization = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    """
    Auditor requests additional context on a single answer.
    Lighter than a full remediation flag — keeps the questionnaire moving
    to 'under_review' and notifies the vendor with a targeted comment.
    """
    from models.database import Submission
    t = db.query(Tessera).filter(Tessera.id == body.tessera_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tessera not found.")

    sub    = db.query(Submission).filter(Submission.id == t.submission_id).first()
    vendor = db.query(Organization).filter(Organization.id == sub.vendor_id).first()
    q      = db.query(Questionnaire).filter(Questionnaire.id == sub.questionnaire_id).first()

    if q and q.status == "submitted":
        q.status = "under_review"
    db.commit()

    if vendor:
        create_notification(db, vendor.id, "Additional context requested",
            f"{auditor.name} asked for more detail on {body.question_id}: {body.comment}")

    append_log(db, "context_requested", actor_id=auditor.id, target_id=body.tessera_id,
               details={"question_id": body.question_id})

    return {"message": "Context request sent to vendor.", "status": "under_review"}


@router.post("/remediation/close/{questionnaire_id}")
def close_questionnaire(
    questionnaire_id: str,
    auditor: Organization = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    """Auditor closes the questionnaire cycle."""
    q = db.query(Questionnaire).filter(Questionnaire.id == questionnaire_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Questionnaire not found.")
    if q.auditor_id != auditor.id:
        raise HTTPException(status_code=403, detail="Not your questionnaire.")

    q.status = "closed"
    db.commit()

    append_log(db, "questionnaire_closed", actor_id=auditor.id,
               target_id=questionnaire_id)

    return {"message": "Questionnaire cycle closed.", "status": "closed"}
