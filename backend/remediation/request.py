"""
remediation/request.py — Remediation request creation

When an auditor flags answers as insufficient, they create a signed
Remediation Request referencing the original bundle_id.
"""

import json
import uuid
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from models.database import RemediationRequest, Tessera
from audit.hmac_log import append_log
from crypto.signing import sign_merkle_root

INSUFFICIENCY_REASONS = [
    "Evidence not provided",
    "Answer too vague or generic",
    "Policy document outdated or expired",
    "Scope does not cover required systems",
    "Contradicts previously submitted evidence",
    "Control not fully implemented",
]


def create_remediation_request(
    tessera_id: str,
    auditor_id: str,
    flags: list,
    db: Session,
    auditor_private_key_pem: str = None,
) -> RemediationRequest:
    """
    Create a signed remediation request.

    flags: [{"question_id": str, "reasons": [str], "comment": str}]
    """
    flags_json = json.dumps(flags)

    # Optionally sign the flags JSON to prove the auditor issued this request.
    # Signing requires the auditor's private key, which lives on their device and
    # isn't available in this server-side flow, so it's best-effort.
    import hashlib
    flags_hash  = hashlib.sha256(flags_json.encode()).hexdigest()
    signed_hash = None
    if auditor_private_key_pem:
        try:
            signed_hash = sign_merkle_root(flags_hash, auditor_private_key_pem)
        except Exception:
            signed_hash = None

    req = RemediationRequest(
        tessera_id    = tessera_id,
        auditor_id    = auditor_id,
        flags_json    = flags_json,
        signed_request = signed_hash,
    )
    db.add(req)
    db.commit()

    append_log(db, "remediation_requested", actor_id=auditor_id, target_id=tessera_id,
               details={"flagged_count": len(flags)})

    return req
