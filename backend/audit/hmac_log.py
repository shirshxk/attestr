"""
audit/hmac_log.py — Tamper-Evident HMAC Chained Audit Log

Every platform event is recorded here.
Each entry's HMAC is computed over:
  HMAC-SHA256( event_type + actor_id + target_id + details + prev_hmac )

This creates a hash chain. Deleting, editing, or inserting any single entry
causes every subsequent entry's HMAC to fail verification.

HMAC key: derived from the CA master passphrase so only the CA controls the log.
"""

import hashlib
import hmac
import json
from datetime import datetime

from sqlalchemy.orm import Session

from config import settings


def _hmac_key() -> bytes:
    """Derive HMAC key from the CA passphrase using SHA-256."""
    return hashlib.sha256(settings.ca_passphrase.encode()).digest()


def _compute_hmac(
    event_type: str,
    actor_id: str | None,
    target_id: str | None,
    details_json: str | None,
    prev_hmac: str,
) -> str:
    """
    Compute HMAC-SHA256 over the canonical representation of this log entry
    chained to the previous entry's HMAC.
    """
    canonical = "|".join([
        event_type or "",
        actor_id   or "",
        target_id  or "",
        details_json or "",
        prev_hmac,
    ]).encode()

    return hmac.new(_hmac_key(), canonical, hashlib.sha256).hexdigest()


def append_log(
    db: Session,
    event_type: str,
    actor_id: str | None = None,
    target_id: str | None = None,
    details: dict | None = None,
) -> None:
    """
    Append a new tamper-evident entry to the audit log.
    Fetches the previous entry's HMAC to chain against.
    """
    from models.database import AuditLogEntry

    # Get the HMAC of the last entry (chain anchor)
    last_entry = (
        db.query(AuditLogEntry)
        .order_by(AuditLogEntry.id.desc())
        .first()
    )
    prev_hmac = last_entry.hmac_hex if last_entry else "GENESIS"

    details_json = json.dumps(details, default=str) if details else None

    entry_hmac = _compute_hmac(
        event_type, actor_id, target_id, details_json, prev_hmac
    )

    entry = AuditLogEntry(
        event_type=event_type,
        actor_id=actor_id,
        target_id=target_id,
        details_json=details_json,
        hmac_hex=entry_hmac,
    )
    db.add(entry)
    db.commit()


def verify_log(db: Session) -> dict:
    """
    Verify the integrity of the entire audit log.
    Returns {"valid": bool, "broken_at_id": int | None, "total": int}
    """
    from models.database import AuditLogEntry

    entries = db.query(AuditLogEntry).order_by(AuditLogEntry.id.asc()).all()
    prev_hmac = "GENESIS"

    for entry in entries:
        expected = _compute_hmac(
            entry.event_type,
            entry.actor_id,
            entry.target_id,
            entry.details_json,
            prev_hmac,
        )
        if not hmac.compare_digest(expected, entry.hmac_hex):
            return {"valid": False, "broken_at_id": entry.id, "total": len(entries)}
        prev_hmac = entry.hmac_hex

    return {"valid": True, "broken_at_id": None, "total": len(entries)}
