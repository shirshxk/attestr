"""
questionnaire/processor.py — Answer normalization and Merkle leaf preparation

Normalizes every answer into the Attestr Answer Schema before signing.
This ensures byte-for-byte consistency — the same answers always produce
the same Merkle leaves regardless of how the data arrived (form, CSV, JSON import).
"""

import hashlib
import json
from datetime import datetime, timezone


def normalize_answer(
    question_id: str,
    question_text: str,
    answer_value: str,
    answer_type: str,
    evidence_note: str = "",
    answered_at: str = None,
) -> dict:
    """
    Normalize an answer into the canonical Attestr Answer Schema.
    This is what gets hashed into a Merkle leaf.
    """
    return {
        "question_id":   question_id,
        "question_text": question_text,
        "answer_value":  str(answer_value).strip(),
        "answer_type":   answer_type,
        "evidence_note": evidence_note or "",
        "answered_at":   answered_at or datetime.now(timezone.utc).isoformat(),
    }


def normalize_answers_for_submission(answers_raw: list) -> list:
    """Normalize a list of raw answer dicts into canonical schema."""
    normalized = []
    for a in answers_raw:
        normalized.append(normalize_answer(
            question_id   = a.get("question_id", ""),
            question_text = a.get("question_text", ""),
            answer_value  = a.get("answer_value", ""),
            answer_type   = a.get("answer_type", "free_text"),
            evidence_note = a.get("evidence_note", ""),
            answered_at   = a.get("answered_at"),
        ))
    return normalized
