"""
api/questionnaire.py — Questionnaire CRUD endpoints
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Form, Form, Form, Form
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from sqlalchemy.orm import Session

from api.auth import require_auditor, require_vendor, require_auth
from models.database import get_db, Organization, Questionnaire, Submission, Answer
from questionnaire.builder import (
    create_questionnaire_from_template,
    create_custom_questionnaire,
    get_questionnaire_with_questions,
)
from questionnaire.processor import normalize_answers_for_submission
from questionnaire.importer import import_from_csv, import_from_json
from notifications.inapp import create_notification
from notifications.email import notify_questionnaire_sent, notify_submission_received
from audit.hmac_log import append_log
import json

router = APIRouter(tags=["Questionnaires"])


class CreateFromTemplateRequest(BaseModel):
    template_type: str   # "soc2" or "iso27001"
    vendor_id: str
    deadline: Optional[str] = None
    custom_title: Optional[str] = None
    question_overrides: Optional[List[dict]] = None


class CreateCustomRequest(BaseModel):
    title: str
    vendor_id: str
    deadline: Optional[str] = None
    questions: List[dict]


class SaveDraftRequest(BaseModel):
    answers: List[dict]


class SubmitAnswersRequest(BaseModel):
    answers: List[dict]


# ── Auditor: create questionnaire ─────────────────────────

@router.post("/questionnaires/from-template")
def create_from_template(
    body: CreateFromTemplateRequest,
    auditor: Organization = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    deadline = datetime.fromisoformat(body.deadline) if body.deadline else None
    q = create_questionnaire_from_template(
        template_type      = body.template_type,
        auditor_id         = auditor.id,
        vendor_id          = body.vendor_id,
        deadline           = deadline,
        db                 = db,
        custom_title       = body.custom_title,
        question_overrides = body.question_overrides,
    )
    vendor = db.query(Organization).filter(Organization.id == body.vendor_id).first()
    if vendor:
        create_notification(db, vendor.id, "New questionnaire assigned",
            f"{auditor.name} has sent you a compliance questionnaire: {q.title}")
        notify_questionnaire_sent(vendor.email, auditor.name, q.title,
                                  body.deadline or "No deadline set")
    return {"id": q.id, "title": q.title, "status": q.status}


@router.post("/questionnaires/custom")
def create_custom(
    body: CreateCustomRequest,
    auditor: Organization = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    deadline = datetime.fromisoformat(body.deadline) if body.deadline else None
    q = create_custom_questionnaire(
        title=body.title, auditor_id=auditor.id,
        vendor_id=body.vendor_id, deadline=deadline,
        questions_data=body.questions, db=db,
    )
    return {"id": q.id, "title": q.title}


# ── Custom questionnaire from uploaded CSV/XLSX ───────────────

@router.post("/questionnaires/custom/upload")
async def create_custom_from_upload(
    title: str = Form(...),
    vendor_id: str = Form(...),
    deadline: Optional[str] = Form(None),
    file: UploadFile = File(...),
    auditor: Organization = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    """Create a custom questionnaire by uploading a CSV or XLSX file."""
    from questionnaire.upload_parser import parse_upload

    content = await file.read()
    try:
        questions = parse_upload(file.filename, content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    dl = datetime.fromisoformat(deadline) if deadline else None
    q = create_custom_questionnaire(
        title=title, auditor_id=auditor.id,
        vendor_id=vendor_id, deadline=dl,
        questions_data=questions, db=db,
    )

    vendor = db.query(Organization).filter(Organization.id == vendor_id).first()
    if vendor:
        create_notification(db, vendor.id, "New questionnaire assigned",
            f"{auditor.name} sent you a custom questionnaire: {q.title}")

    return {"id": q.id, "title": q.title, "question_count": len(questions)}


@router.get("/questionnaires/template/{fmt}")
def download_template(fmt: str):
    """Download a blank questionnaire template (csv or xlsx)."""
    from fastapi.responses import Response
    import io, csv as _csv

    headers = ["question_id", "question_text", "question_type", "is_required"]
    sample = [
        ["cc1.1", "Do you enforce MFA on all admin accounts?", "boolean", "yes"],
        ["cc1.2", "Describe your incident response process.", "free_text", "yes"],
        ["cc1.3", "How many security staff do you employ?", "numeric", "no"],
        ["cc1.4", "Upload your latest pentest report.", "file_attachment", "no"],
    ]

    if fmt == "csv":
        buf = io.StringIO()
        w = _csv.writer(buf)
        w.writerow(headers); w.writerows(sample)
        return Response(content=buf.getvalue(), media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="attestr_questionnaire_template.csv"'})

    if fmt == "xlsx":
        from openpyxl import Workbook
        wb = Workbook(); ws = wb.active; ws.title = "Questions"
        ws.append(headers)
        for row in sample: ws.append(row)
        out = io.BytesIO(); wb.save(out); out.seek(0)
        return Response(content=out.read(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="attestr_questionnaire_template.xlsx"'})

    raise HTTPException(status_code=400, detail="Format must be csv or xlsx.")

@router.get("/questionnaires/{questionnaire_id}")
def get_questionnaire(
    questionnaire_id: str,
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    q = get_questionnaire_with_questions(questionnaire_id, db)
    if not q:
        raise HTTPException(status_code=404, detail="Questionnaire not found.")
    return q


@router.get("/questionnaires")
def list_questionnaires(
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    if org.role == "auditor":
        qs = db.query(Questionnaire).filter(Questionnaire.auditor_id == org.id).all()
    elif org.role == "vendor":
        qs = db.query(Questionnaire).filter(Questionnaire.vendor_id == org.id).all()
    else:
        qs = db.query(Questionnaire).all()

    # name lookup for labels
    org_names = { o.id: o.name for o in db.query(Organization).all() }

    return [
        {
            "id":         q.id,
            "title":      q.title,
            "type":       q.type,
            "status":     q.status,
            "deadline":   q.deadline.isoformat() if q.deadline else None,
            "created_at": q.created_at.isoformat(),
            "auditor_id": q.auditor_id,
            "vendor_id":  q.vendor_id,
            "vendor_name":  org_names.get(q.vendor_id),
            "auditor_name": org_names.get(q.auditor_id),
        }
        for q in qs
    ]


# ── Vendor: draft save ────────────────────────────────────

@router.post("/questionnaires/{questionnaire_id}/draft")
def save_draft(
    questionnaire_id: str,
    body: SaveDraftRequest,
    vendor: Organization = Depends(require_vendor),
    db: Session = Depends(get_db),
):
    """Save encrypted draft answers. Relay never sees plaintext."""
    from models.database import Submission, Certificate
    from crypto.hybrid import encrypt_draft

    cert = db.query(Certificate).filter(
        Certificate.org_id == vendor.id,
        Certificate.is_revoked == False,  # noqa
    ).first()
    if not cert:
        raise HTTPException(status_code=400, detail="No active certificate found.")

    # Encrypt client-side equivalent: encrypt before storing
    encrypted = encrypt_draft({"answers": body.answers}, cert.public_key_pem)

    sub = db.query(Submission).filter(
        Submission.questionnaire_id == questionnaire_id,
        Submission.vendor_id == vendor.id,
        Submission.is_draft == True,  # noqa
    ).first()

    if not sub:
        sub = Submission(
            questionnaire_id = questionnaire_id,
            vendor_id        = vendor.id,
            is_draft         = True,
            encrypted_draft  = json.dumps(encrypted).encode(),
        )
        db.add(sub)
    else:
        sub.encrypted_draft = json.dumps(encrypted).encode()

    db.commit()
    return {"message": "Draft saved (encrypted)."}


# ── Vendor: submit answers ────────────────────────────────

@router.post("/questionnaires/{questionnaire_id}/submit")
def submit_answers(
    questionnaire_id: str,
    body: SubmitAnswersRequest,
    vendor: Organization = Depends(require_vendor),
    db: Session = Depends(get_db),
):
    """
    Submit final answers. Triggers the full signing + encryption pipeline.
    Returns the assembled Tessera bundle.
    """
    from models.database import Certificate, Tessera as TesseraModel
    from audit.bundle import assemble_tessera
    from questionnaire.processor import normalize_answers_for_submission

    q = db.query(Questionnaire).filter(Questionnaire.id == questionnaire_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Questionnaire not found.")
    if q.vendor_id != vendor.id:
        raise HTTPException(status_code=403, detail="Not your questionnaire.")

    # Get vendor cert and private key
    vendor_cert = db.query(Certificate).filter(
        Certificate.org_id == vendor.id,
        Certificate.is_revoked == False,  # noqa
    ).first()
    if not vendor_cert:
        raise HTTPException(status_code=400, detail="No active certificate found.")

    # Get auditor cert
    auditor_cert = db.query(Certificate).filter(
        Certificate.org_id == q.auditor_id,
        Certificate.is_revoked == False,  # noqa
    ).first()
    if not auditor_cert:
        raise HTTPException(status_code=400, detail="Auditor has no active certificate.")

    # Normalize answers
    answers = normalize_answers_for_submission(body.answers)

    # NOTE: In production the vendor private key comes from their local keystore.
    # For demo purposes we retrieve it from the DB (stored during cert issuance in seed script).
    # This is flagged in the demo scenario documentation.
    vendor_private_key_pem = _get_vendor_private_key(vendor.id, db)
    if not vendor_private_key_pem:
        raise HTTPException(status_code=400,
            detail="Vendor private key not found. Please ensure your keystore is configured.")

    # Assemble Tessera
    try:
        tessera = assemble_tessera(
            questionnaire_id       = questionnaire_id,
            answers                = answers,
            vendor_cert_pem        = vendor_cert.cert_pem,
            auditor_cert_pem       = auditor_cert.cert_pem,
            auditor_public_key_pem = auditor_cert.public_key_pem,
            vendor_private_key_pem = vendor_private_key_pem,
            db                     = db,
        )
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Tessera assembly failed: {type(e).__name__}: {e}")

    # Save to DB.
    # Each submission round gets its OWN Submission + Tessera row (Tessera.submission_id
    # is unique), so re-submitting during remediation creates a new round rather than
    # colliding with the prior Tessera.
    prior_sub = db.query(Submission).filter(
        Submission.questionnaire_id == questionnaire_id,
        Submission.vendor_id == vendor.id,
    ).order_by(Submission.id.desc()).first()

    prior_tessera = None
    if prior_sub:
        prior_tessera = db.query(TesseraModel).filter(
            TesseraModel.submission_id == prior_sub.id
        ).first()

    is_remediation = q.status == "in_remediation"

    if prior_sub and not prior_tessera:
        # Prior submission was only a draft (no Tessera yet) — reuse it.
        sub = prior_sub
    else:
        # First real submission, or a new remediation round — fresh submission.
        sub = Submission(questionnaire_id=questionnaire_id, vendor_id=vendor.id)
        db.add(sub)
    sub.is_draft     = False
    sub.submitted_at = datetime.utcnow()
    db.flush()

    # Clear any prior answers for THIS submission so a draft->submit replaces them.
    db.query(Answer).filter(Answer.submission_id == sub.id).delete()
    db.flush()

    # Save answers — preserve the exact answered_at that was hashed into the
    # Merkle leaf, so DB-derived verification matches byte-for-byte.
    for ans in answers:
        _raw = ans.get("answered_at")
        try:
            _at = datetime.fromisoformat(_raw) if _raw else datetime.utcnow()
        except Exception:
            _at = datetime.utcnow()
        a = Answer(
            submission_id  = sub.id,
            question_id    = ans["question_id"],
            question_text  = ans["question_text"],
            answer_value   = ans["answer_value"],
            answer_type    = ans["answer_type"],
            evidence_note  = ans.get("evidence_note", ""),
            answered_at    = _at,
        )
        db.add(a)

    # Save Tessera record
    t = TesseraModel(
        submission_id    = sub.id,
        bundle_json      = json.dumps(tessera),
        merkle_root      = tessera["merkle_root"],
        ecdsa_signature  = tessera["ecdsa_signature"],
        rfc3161_token    = tessera["rfc3161_timestamp_token"],
    )
    # Chain this round to the previous Tessera for an immutable remediation history
    if prior_tessera:
        t.parent_tessera_id = prior_tessera.id
        t.remediation_round = (prior_tessera.remediation_round or 0) + 1
    db.add(t)

    # Update questionnaire status: a remediation re-submit goes back to 'submitted'
    # for the auditor to re-review.
    q.status = "submitted"
    db.commit()

    # Notify auditor (best-effort — never fail the submission over a notification)
    try:
        auditor = db.query(Organization).filter(Organization.id == q.auditor_id).first()
        if auditor:
            create_notification(db, auditor.id, f"{vendor.name} submitted their response",
                f"A new Tessera bundle is ready for verification: {q.title}")
            try:
                notify_submission_received(auditor.email, vendor.name, q.title)
            except Exception:
                pass
    except Exception as e:
        print(f"[submit] notification step failed (non-fatal): {e}")

    append_log(db, "questionnaire_submitted", actor_id=vendor.id,
               target_id=questionnaire_id,
               details={"tessera_id": t.id, "answer_count": len(answers)})

    return {
        "message":    "Questionnaire submitted and Tessera assembled.",
        "tessera_id": t.id,
        "bundle_id":  tessera["bundle_id"],
        "merkle_root": tessera["merkle_root"],
    }


def _get_vendor_private_key(vendor_id: str, db) -> Optional[str]:
    """Retrieve a vendor's private key from the keystore (demo)."""
    from keystore.store import get_org_private_key
    return get_org_private_key(vendor_id)


# ── CSV/JSON import ───────────────────────────────────────

@router.post("/questionnaires/{questionnaire_id}/import/csv")
async def import_csv(
    questionnaire_id: str,
    file: UploadFile = File(...),
    vendor: Organization = Depends(require_vendor),
    db: Session = Depends(get_db),
):
    content = await file.read()
    mapping = {
        "question_id":   "question_id",
        "question_text": "question_text",
        "answer_value":  "answer_value",
        "answer_type":   "answer_type",
        "evidence_note": "evidence_note",
    }
    answers = import_from_csv(content.decode(), mapping)
    return {"imported": len(answers), "answers": answers}


@router.post("/questionnaires/{questionnaire_id}/import/json")
async def import_json_answers(
    questionnaire_id: str,
    file: UploadFile = File(...),
    vendor: Organization = Depends(require_vendor),
    db: Session = Depends(get_db),
):
    content = await file.read()
    answers = import_from_json(content.decode())
    return {"imported": len(answers), "answers": answers}
