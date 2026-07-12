"""
api/questionnaire.py — Questionnaire CRUD endpoints
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from sqlalchemy.orm import Session

from api.auth import require_auditor, require_vendor, require_auth
from models.database import get_db, Organization, Questionnaire, Submission, Answer, Tessera, RemediationRequest
from questionnaire.builder import (
    create_questionnaire_from_template,
    create_custom_questionnaire,
    get_questionnaire_with_questions,
)
from questionnaire.processor import normalize_answers_for_submission
from questionnaire.importer import import_from_csv, import_from_json
from questionnaire.question_import import (
    parse_questions_file,
    build_template_csv,
    build_template_xlsx,
    QuestionImportError,
)
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


# ── Auditor: custom questionnaire via file upload (CSV / XLSX) ─────────────

@router.get("/questionnaires/custom/template")
@router.get("/questionnaires/template/{fmt}")
def download_question_template(
    fmt: str = "xlsx",
    auditor: Organization = Depends(require_auditor),
):
    """
    Download a starter template the auditor can fill in and re-upload.
    fmt=xlsx (default) or fmt=csv.
    """
    if fmt == "csv":
        data = build_template_csv()
        return Response(
            content=data,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="attestr_questions_template.csv"'},
        )
    data = build_template_xlsx()
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="attestr_questions_template.xlsx"'},
    )


@router.post("/questionnaires/custom/preview")
async def preview_custom_upload(
    file: UploadFile = File(...),
    auditor: Organization = Depends(require_auditor),
):
    """
    Parse an uploaded CSV/XLSX and return the questions WITHOUT creating
    anything. Lets the auditor review before committing.
    """
    content = await file.read()
    try:
        questions = parse_questions_file(file.filename, content)
    except QuestionImportError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"count": len(questions), "questions": questions}


@router.post("/questionnaires/custom/upload")
async def create_custom_from_upload(
    file: UploadFile = File(...),
    vendor_id: str = Form(...),
    title: str = Form("Custom questionnaire"),
    deadline: Optional[str] = Form(None),
    auditor: Organization = Depends(require_auditor),
    db: Session = Depends(get_db),
):
    """
    Create a custom questionnaire from an uploaded CSV/XLSX of questions,
    then assign it to the vendor (same notify flow as templates).
    """
    content = await file.read()
    try:
        questions = parse_questions_file(file.filename, content)
    except QuestionImportError as e:
        raise HTTPException(status_code=400, detail=str(e))

    parsed_deadline = datetime.fromisoformat(deadline) if deadline else None
    q = create_custom_questionnaire(
        title=title or "Custom questionnaire",
        auditor_id=auditor.id,
        vendor_id=vendor_id,
        deadline=parsed_deadline,
        questions_data=questions,
        db=db,
    )

    vendor = db.query(Organization).filter(Organization.id == vendor_id).first()
    if vendor:
        create_notification(db, vendor.id, "New questionnaire assigned",
            f"{auditor.name} has sent you a compliance questionnaire: {q.title}")
        notify_questionnaire_sent(vendor.email, auditor.name, q.title,
                                  deadline or "No deadline set")

    return {"id": q.id, "title": q.title, "question_count": len(questions)}


# ── Get questionnaire ──────────────────────────────────────

@router.get("/questionnaires/{questionnaire_id}")
def get_questionnaire(
    questionnaire_id: str,
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    q = get_questionnaire_with_questions(questionnaire_id, db)
    if not q:
        raise HTTPException(status_code=404, detail="Questionnaire not found.")

    # Attach the vendor's most recent answers so the fill view can prefill them
    # (essential for remediation re-submit — locked/accepted answers must carry
    # over, only flagged ones get edited).
    latest_sub = (
        db.query(Submission)
        .filter(Submission.questionnaire_id == questionnaire_id)
        .order_by(Submission.id.desc())
        .first()
    )
    existing = {}
    flagged_qids = []
    if latest_sub:
        for a in db.query(Answer).filter(Answer.submission_id == latest_sub.id).all():
            existing[a.question_id] = {
                "answer_value":  a.answer_value,
                "answer_type":   a.answer_type,
                "evidence_note": a.evidence_note or "",
            }
        # Which questions were flagged in the latest remediation request?
        latest_tessera = db.query(Tessera).filter(Tessera.submission_id == latest_sub.id).first()
        if latest_tessera:
            rr = (
                db.query(RemediationRequest)
                .filter(RemediationRequest.tessera_id == latest_tessera.id)
                .order_by(RemediationRequest.id.desc())
                .first()
            )
            if rr:
                try:
                    flagged_qids = [f.get("question_id") for f in json.loads(rr.flags_json)]
                except Exception:
                    flagged_qids = []

    q["existing_answers"] = existing
    q["flagged_questions"] = flagged_qids
    return q


@router.get("/questionnaires")
def list_questionnaires(
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    if org.role == "auditor":
        # Owned-but-visible: own questionnaires + those of workspace teammates.
        if org.workspace_id:
            mate_ids = [o.id for o in db.query(Organization.id).filter(Organization.workspace_id == org.workspace_id).all()]
            qs = db.query(Questionnaire).filter(Questionnaire.auditor_id.in_(mate_ids)).all()
        else:
            qs = db.query(Questionnaire).filter(Questionnaire.auditor_id == org.id).all()
    elif org.role == "vendor":
        if org.workspace_id:
            mate_ids = [o.id for o in db.query(Organization.id).filter(Organization.workspace_id == org.workspace_id).all()]
            qs = db.query(Questionnaire).filter(Questionnaire.vendor_id.in_(mate_ids)).all()
        else:
            qs = db.query(Questionnaire).filter(Questionnaire.vendor_id == org.id).all()
    else:
        qs = db.query(Questionnaire).all()

    # Build a lookup for vendor names in one query
    vendor_ids = list({q.vendor_id for q in qs if q.vendor_id})
    vendors = {o.id: o.name for o in db.query(Organization).filter(Organization.id.in_(vendor_ids)).all()} if vendor_ids else {}

    return [
        {
            "id":          q.id,
            "title":       q.title,
            "type":        q.type,
            "status":      q.status,
            "deadline":    q.deadline.isoformat() if q.deadline else None,
            "created_at":  q.created_at.isoformat(),
            "auditor_id":  q.auditor_id,
            "vendor_id":   q.vendor_id,
            "vendor_name": vendors.get(q.vendor_id, "—"),
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

    q = db.query(Questionnaire).filter(Questionnaire.id == questionnaire_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Questionnaire not found.")
    if q.vendor_id != vendor.id:
        raise HTTPException(status_code=403, detail="Not your questionnaire.")

    # Get vendor cert and private key
    if q.status == "closed":
        raise HTTPException(status_code=403, detail="This compliance cycle is closed.")
    if q.status in ("submitted", "under_review"):
        raise HTTPException(
            status_code=403,
            detail="Already submitted and sealed. It can only be re-opened if the auditor flags answers for remediation.",
        )

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
    tessera = assemble_tessera(
        questionnaire_id       = questionnaire_id,
        answers                = answers,
        vendor_cert_pem        = vendor_cert.cert_pem,
        auditor_cert_pem       = auditor_cert.cert_pem,
        auditor_public_key_pem = auditor_cert.public_key_pem,
        vendor_private_key_pem = vendor_private_key_pem,
        db                     = db,
    )

    # Save to DB. Each submission round gets its OWN Submission + Tessera
    # (Tessera.submission_id is unique), so a remediation re-submit creates a new
    # round instead of colliding with the prior Tessera.
    prior_sub = db.query(Submission).filter(
        Submission.questionnaire_id == questionnaire_id,
        Submission.vendor_id == vendor.id,
    ).order_by(Submission.id.desc()).first()

    prior_tessera = None
    if prior_sub:
        prior_tessera = db.query(TesseraModel).filter(
            TesseraModel.submission_id == prior_sub.id
        ).first()

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

    # Replace any prior answers on THIS submission (draft → submit).
    db.query(Answer).filter(Answer.submission_id == sub.id).delete()
    db.flush()

    # Save answers. CRITICAL: persist the SAME answered_at string that was hashed
    # into the Merkle leaf (the canonical normalized value), otherwise verification
    # recomputes a different leaf hash and Merkle proofs fail.
    from datetime import datetime as _dt
    for ans in answers:
        # ans["answered_at"] is an ISO string from normalize_answer; parse it back
        # to a datetime for storage, preserving the exact instant.
        try:
            _ts = _dt.fromisoformat(ans["answered_at"])
        except Exception:
            _ts = datetime.utcnow()
        a = Answer(
            submission_id  = sub.id,
            question_id    = ans["question_id"],
            question_text  = ans["question_text"],
            answer_value   = ans["answer_value"],
            answer_type    = ans["answer_type"],
            evidence_note  = ans.get("evidence_note", ""),
            answered_at    = _ts,
            answered_at_iso = ans["answered_at"],   # exact string hashed into the leaf
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
    # Chain to the previous round for an immutable remediation history
    if prior_tessera:
        if hasattr(t, "parent_tessera_id"):
            t.parent_tessera_id = prior_tessera.id
        if hasattr(t, "remediation_round"):
            t.remediation_round = (prior_tessera.remediation_round or 0) + 1
    db.add(t)

    # Update questionnaire status (remediation re-submit → back to 'submitted')
    q.status = "submitted"
    db.commit()

    # Notify auditor
    auditor = db.query(Organization).filter(Organization.id == q.auditor_id).first()
    if auditor:
        create_notification(db, auditor.id, f"{vendor.name} submitted their response",
            f"A new Tessera bundle is ready for verification: {q.title}")
        notify_submission_received(auditor.email, vendor.name, q.title)

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
    """
    Retrieve vendor private key for demo purposes.
    In production this would come from the vendor's local keystore.
    """
    from models.database import Certificate
    # Check if stored in demo keystore
    import os
    from keystore.store import KeystoreManager
    from config import settings

    ks_path = settings.ca_keystore_path.replace("ca_keystore", f"vendor_{vendor_id}_key")
    if os.path.exists(ks_path):
        try:
            ks = KeystoreManager(ks_path, settings.ca_passphrase)
            ks.load()
            return ks.get_key("private_key")
        except Exception:
            pass
    return None


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

@router.post("/questionnaires/{questionnaire_id}/answers/upload")
async def upload_answer_file(
    questionnaire_id: str,
    question_id: str = Form(...),
    file: UploadFile = File(...),
    vendor: Organization = Depends(require_vendor),
    db: Session = Depends(get_db),
):
    """Upload a file for a file_attachment answer. Stores the file and returns a
    download key. The answer_value is set to the filename; the file is retrievable
    via GET /questionnaires/answers/files/{file_id}."""
    import os, uuid as _uuid
    q = db.query(Questionnaire).filter(Questionnaire.id == questionnaire_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Questionnaire not found.")
    if q.vendor_id != vendor.id:
        raise HTTPException(status_code=403, detail="Not your questionnaire.")

    upload_dir = "/app/data/uploads"
    os.makedirs(upload_dir, exist_ok=True)
    file_id = str(_uuid.uuid4())
    ext = os.path.splitext(file.filename)[1] if file.filename else ""
    dest = os.path.join(upload_dir, f"{file_id}{ext}")
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)
    # Sidecar metadata so downloads can enforce ownership (no schema change needed).
    import json as _json
    with open(os.path.join(upload_dir, f"{file_id}.meta.json"), "w") as mf:
        _json.dump({
            "file_id": file_id, "ext": ext,
            "questionnaire_id": questionnaire_id,
            "vendor_id": vendor.id,
            "original_name": file.filename,
        }, mf)
    return {
        "file_id": file_id,
        "filename": file.filename,
        "size": len(content),
        "download_path": f"/questionnaires/answers/files/{file_id}",
    }


@router.get("/questionnaires/answers/files/{file_id}")
def download_answer_file(
    file_id: str,
    org: Organization = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Stream a previously uploaded answer file, enforcing ownership:
    the owning vendor, an auditor in the owning questionnaire's workspace, or
    admin-tier. Prevents cross-tenant access (IDOR)."""
    import os, json as _json, re
    from fastapi.responses import FileResponse
    from api.auth import is_admin_tier

    # Accept either a bare UUID or UUID.ext (older download paths included ext).
    m = re.match(r"^([0-9a-fA-F-]{36})", file_id or "")
    if not m:
        raise HTTPException(status_code=404, detail="File not found.")
    file_id = m.group(1)

    upload_dir = "/app/data/uploads"
    meta_path = os.path.join(upload_dir, f"{file_id}.meta.json")
    if not os.path.isfile(meta_path):
        raise HTTPException(status_code=404, detail="File not found.")
    try:
        with open(meta_path) as mf:
            meta = _json.load(mf)
    except Exception:
        raise HTTPException(status_code=404, detail="File not found.")

    # Authorization: owning vendor, workspace auditor, or admin-tier.
    q = db.query(Questionnaire).filter(Questionnaire.id == meta.get("questionnaire_id")).first()
    allowed = False
    if is_admin_tier(org):
        allowed = True
    elif org.role == "vendor" and org.id == meta.get("vendor_id"):
        allowed = True
    elif org.role == "auditor" and q:
        if q.auditor_id == org.id:
            allowed = True
        elif org.workspace_id:
            owner = db.query(Organization).filter(Organization.id == q.auditor_id).first()
            allowed = bool(owner and owner.workspace_id == org.workspace_id)
    if not allowed:
        raise HTTPException(status_code=403, detail="You don't have access to this file.")

    # Resolve the actual stored file by exact id + recorded extension.
    fname = f"{file_id}{meta.get('ext','')}"
    fpath = os.path.join(upload_dir, fname)
    if not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(fpath, filename=meta.get("original_name") or fname)

