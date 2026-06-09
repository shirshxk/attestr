"""
api/bundle.py — Tessera verification and download endpoints
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional, List

from api.auth import require_auditor, require_auth
from models.database import get_db, Organization, Tessera, Submission, Answer, Questionnaire
from audit.verify import verify_tessera
from audit.hmac_log import append_log

router = APIRouter(tags=["Tessera Bundles"])


class VerifyRequest(BaseModel):
    tessera_json: str
    answers: Optional[List[dict]] = None


@router.get("/tesseras/{tessera_id}")
def get_tessera(
    tessera_id: str,
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Get Tessera metadata and bundle."""
    t = db.query(Tessera).filter(Tessera.id == tessera_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tessera not found.")
    bundle = json.loads(t.bundle_json)
    return {
        "id":                  t.id,
        "bundle_id":           bundle.get("bundle_id"),
        "merkle_root":         t.merkle_root,
        "remediation_round":   t.remediation_round,
        "parent_tessera_id":   t.parent_tessera_id,
        "verification_status": t.verification_status,
        "created_at":          t.created_at.isoformat(),
        "bundle":              bundle,
    }


@router.get("/tesseras/{tessera_id}/download")
def download_tessera(
    tessera_id: str,
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Download the raw .tessera file."""
    t = db.query(Tessera).filter(Tessera.id == tessera_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tessera not found.")

    return Response(
        content=t.bundle_json,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="attestr_{tessera_id[:8]}.tessera"'},
    )


@router.get("/tesseras/{tessera_id}/answers")
def get_tessera_answers(
    tessera_id: str,
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Return submitted answers for a Tessera so the auditor can review them."""
    t = db.query(Tessera).filter(Tessera.id == tessera_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tessera not found.")
    rows = (
        db.query(Answer)
        .filter(Answer.submission_id == t.submission_id)
        .order_by(Answer.id)
        .all()
    )
    return [
        {
            "question_id":   a.question_id,
            "question_text": a.question_text,
            "answer_value":  a.answer_value,
            "answer_type":   a.answer_type,
            "evidence_note": a.evidence_note or "",
        }
        for a in rows
    ]


@router.post("/tesseras/{tessera_id}/verify")
def verify_tessera_bundle(
    tessera_id: str,
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """
    Run full offline verification of a Tessera bundle.
    Checks: cert chain, CRL, ECDSA signature, Merkle proofs, RFC 3161 timestamp.
    """
    t = db.query(Tessera).filter(Tessera.id == tessera_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tessera not found.")

    bundle = json.loads(t.bundle_json)

    # Prefer the exact normalized answers snapshot stored at signing time.
    # This guarantees byte-for-byte identical leaf hashing during verification.
    # Falling back to DB-derived answers can mismatch (e.g. timezone/precision
    # differences in answered_at), which would wrongly flag a valid Merkle tree.
    snapshot = bundle.get("merkle_answers_snapshot")
    if snapshot:
        answers = snapshot
    else:
        answers_raw = (
            db.query(Answer)
            .filter(Answer.submission_id == t.submission_id)
            .order_by(Answer.id)
            .all()
        )
        answers = [
            {
                "question_id":   a.question_id,
                "question_text": a.question_text,
                "answer_value":  a.answer_value,
                "answer_type":   a.answer_type,
                "evidence_note": a.evidence_note or "",
                "answered_at":   a.answered_at.isoformat(),
            }
            for a in answers_raw
        ]

    result = verify_tessera(bundle, answers)

    # Update verification status in DB
    t.verification_status = "verified" if result["overall_valid"] else "tampered"
    db.commit()

    append_log(db, "tessera_verified", actor_id=org.id, target_id=tessera_id,
               details={"valid": result["overall_valid"]})

    return result


@router.post("/tesseras/verify-offline")
def verify_tessera_offline(body: VerifyRequest):
    """
    Verify a Tessera bundle offline from raw JSON.
    No authentication required — anyone can verify a Tessera.
    This is the 'no platform required' guarantee.
    """
    try:
        bundle = json.loads(body.tessera_json)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Tessera JSON.")

    result = verify_tessera(bundle, body.answers)
    return result


@router.get("/questionnaires/{questionnaire_id}/tesseras")
def list_tesseras_for_questionnaire(
    questionnaire_id: str,
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """List all Tesseras (remediation rounds) for a questionnaire."""
    submissions = db.query(Submission).filter(
        Submission.questionnaire_id == questionnaire_id,
        Submission.is_draft == False,  # noqa
    ).all()

    result = []
    for sub in submissions:
        if sub.tessera:
            result.append({
                "tessera_id":          sub.tessera.id,
                "remediation_round":   sub.tessera.remediation_round,
                "verification_status": sub.tessera.verification_status,
                "created_at":          sub.tessera.created_at.isoformat(),
            })
    return result
