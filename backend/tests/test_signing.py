"""
tests/test_signing.py — ECDSA signing tests
"""

import pytest
from crypto.ecc import generate_keypair
from crypto.signing import sign_merkle_root, verify_ecdsa_signature
from crypto.merkle import build_merkle_for_answers

ANSWERS = [
    {"question_id": "cc6.1", "answer_value": "Yes",
     "answer_type": "boolean", "question_text": "MFA?",
     "evidence_note": "", "answered_at": "2026-06-01T10:00:00Z"},
    {"question_id": "cc6.2", "answer_value": "No",
     "answer_type": "boolean", "question_text": "WAF?",
     "evidence_note": "", "answered_at": "2026-06-01T10:01:00Z"},
]


def test_sign_and_verify():
    """Valid signature over correct root verifies successfully."""
    private_pem, public_pem = generate_keypair()
    result = build_merkle_for_answers(ANSWERS)
    root   = result["root"]

    signature = sign_merkle_root(root, private_pem)
    verified  = verify_ecdsa_signature(root, signature, public_pem)

    assert verified["valid"] is True


def test_wrong_key_fails():
    """Signature from one keypair does not verify with a different public key."""
    priv1, pub1 = generate_keypair()
    priv2, pub2 = generate_keypair()

    result    = build_merkle_for_answers(ANSWERS)
    root      = result["root"]
    signature = sign_merkle_root(root, priv1)

    # Verify with the WRONG public key
    verified = verify_ecdsa_signature(root, signature, pub2)
    assert verified["valid"] is False


def test_tampered_root_fails():
    """Signature does not verify if the root has been changed."""
    private_pem, public_pem = generate_keypair()
    result    = build_merkle_for_answers(ANSWERS)
    root      = result["root"]
    signature = sign_merkle_root(root, private_pem)

    # Tamper with the root
    tampered_root = "0" * 64

    verified = verify_ecdsa_signature(tampered_root, signature, public_pem)
    assert verified["valid"] is False


def test_signature_is_deterministic_per_session():
    """Two different signatures over the same root are both valid (ECDSA uses randomness)."""
    private_pem, public_pem = generate_keypair()
    result = build_merkle_for_answers(ANSWERS)
    root   = result["root"]

    sig1 = sign_merkle_root(root, private_pem)
    sig2 = sign_merkle_root(root, private_pem)

    # Both should verify (ECDSA is randomized but both valid)
    assert verify_ecdsa_signature(root, sig1, public_pem)["valid"]
    assert verify_ecdsa_signature(root, sig2, public_pem)["valid"]
