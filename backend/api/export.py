"""
api/export.py — Export endpoints (PDF, JSON, Tessera download)
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from api.auth import require_auditor
from models.database import get_db, Organization, Tessera, Submission, Answer, Questionnaire
from export.pdf import generate_pdf_report
from export.json_export import export_to_json
from audit.verify import verify_tessera

router = APIRouter(tags=["Export"])


def _get_bundle_data(tessera_id: str, db: Session):
    """Helper to load all data needed for export."""
    t = db.query(Tessera).filter(Tessera.id == tessera_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tessera not found.")

    bundle = json.loads(t.bundle_json)
    sub    = db.query(Submission).filter(Submission.id == t.submission_id).first()
    q      = db.query(Questionnaire).filter(Questionnaire.id == sub.questionnaire_id).first()

    answers_raw = db.query(Answer).filter(Answer.submission_id == t.submission_id).all()
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

    from models.database import Organization as Org
    auditor = db.query(Org).filter(Org.id == q.auditor_id).first()
    vendor  = db.query(Org).filter(Org.id == sub.vendor_id).first()

    vr = verify_tessera(bundle, answers)

    return bundle, answers, vr, auditor.name if auditor else "", vendor.name if vendor else "", q.title


@router.get("/export/{tessera_id}/pdf")
def export_pdf(
    tessera_id: str,
    auditor: Organization = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    """Generate and download a PDF compliance report."""
    bundle, answers, vr, auditor_name, vendor_name, q_title = _get_bundle_data(tessera_id, db)
    pdf_bytes = generate_pdf_report(bundle, answers, vr, auditor_name, vendor_name, q_title)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="attestr_report_{tessera_id[:8]}.pdf"'},
    )


@router.get("/export/{tessera_id}/json")
def export_json(
    tessera_id: str,
    auditor: Organization = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    """Export structured JSON for GRC tool integration."""
    bundle, answers, vr, auditor_name, vendor_name, _ = _get_bundle_data(tessera_id, db)
    json_str = export_to_json(bundle, answers, vr, auditor_name, vendor_name)

    return Response(
        content=json_str,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="attestr_export_{tessera_id[:8]}.json"'},
    )
