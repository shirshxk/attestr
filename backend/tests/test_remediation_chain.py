"""
tests/test_remediation_chain.py — Remediation chain tests
"""

import pytest
from crypto.merkle import build_merkle_for_answers
from crypto.signing import sign_merkle_root, verify_ecdsa_signature
from crypto.ecc import generate_keypair

ROUND_0_ANSWERS = [
    {"question_id": "cc6.1", "question_text": "MFA enforced?",
     "answer_value": "Yes", "answer_type": "boolean",
     "evidence_note": "", "answered_at": "2026-06-01T10:00:00Z"},
    {"question_id": "cc6.2", "question_text": "Patch cadence?",
     "answer_value": "Quarterly", "answer_type": "free_text",
     "evidence_note": "", "answered_at": "2026-06-01T10:01:00Z"},
]

ROUND_1_ANSWERS = [
    {"question_id": "cc6.1", "question_text": "MFA enforced?",
     "answer_value": "Yes", "answer_type": "boolean",
     "evidence_note": "", "answered_at": "2026-06-01T10:00:00Z"},
    {"question_id": "cc6.2", "question_text": "Patch cadence?",
     "answer_value": "Monthly",  # improved answer
     "answer_type": "free_text",
     "evidence_note": "Updated to monthly as of Q2 2026",
     "answered_at": "2026-06-05T10:01:00Z"},
]


def test_round_0_signs_correctly():
    priv, pub = generate_keypair()
    merkle = build_merkle_for_answers(ROUND_0_ANSWERS)
    sig = sign_merkle_root(merkle["root"], priv)
    result = verify_ecdsa_signature(merkle["root"], sig, pub)
    assert result["valid"] is True


def test_round_1_produces_different_root():
    """Remediation answers produce a different Merkle Root."""
    r0 = build_merkle_for_answers(ROUND_0_ANSWERS)["root"]
    r1 = build_merkle_for_answers(ROUND_1_ANSWERS)["root"]
    assert r0 != r1


def test_round_0_signature_invalid_for_round_1():
    """A Round 0 signature must not verify against Round 1 answers."""
    priv, pub = generate_keypair()
    r0_root = build_merkle_for_answers(ROUND_0_ANSWERS)["root"]
    r1_root = build_merkle_for_answers(ROUND_1_ANSWERS)["root"]

    sig = sign_merkle_root(r0_root, priv)
    result = verify_ecdsa_signature(r1_root, sig, pub)
    assert result["valid"] is False


def test_each_round_independently_verifiable():
    """Each remediation round can be independently verified."""
    priv, pub = generate_keypair()

    r0_root = build_merkle_for_answers(ROUND_0_ANSWERS)["root"]
    r1_root = build_merkle_for_answers(ROUND_1_ANSWERS)["root"]

    sig0 = sign_merkle_root(r0_root, priv)
    sig1 = sign_merkle_root(r1_root, priv)

    assert verify_ecdsa_signature(r0_root, sig0, pub)["valid"] is True
    assert verify_ecdsa_signature(r1_root, sig1, pub)["valid"] is True
    assert verify_ecdsa_signature(r0_root, sig1, pub)["valid"] is False
