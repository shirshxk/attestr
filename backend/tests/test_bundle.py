"""
tests/test_bundle.py — Tessera assembly and verification tests
"""

import pytest
from crypto.ecc import generate_keypair
from crypto.merkle import build_merkle_for_answers
from crypto.signing import sign_merkle_root, extract_public_key_from_cert
from crypto.hybrid import encrypt_payload, decrypt_payload
from crypto.encryption import encrypt, decrypt
import os

ANSWERS = [
    {"question_id": "cc6.1", "question_text": "Do you enforce MFA?",
     "answer_value": "Yes", "answer_type": "boolean",
     "evidence_note": "Via Okta", "answered_at": "2026-06-01T10:00:00Z"},
    {"question_id": "cc6.2", "question_text": "Is data encrypted at rest?",
     "answer_value": "Yes", "answer_type": "boolean",
     "evidence_note": "AES-256", "answered_at": "2026-06-01T10:01:00Z"},
    {"question_id": "cc6.3", "question_text": "Patch cadence?",
     "answer_value": "Monthly", "answer_type": "free_text",
     "evidence_note": "", "answered_at": "2026-06-01T10:02:00Z"},
]


def test_full_pipeline_sign_and_verify():
    """Full pipeline: build Merkle, sign, verify — all pass."""
    vendor_priv, vendor_pub   = generate_keypair()
    auditor_priv, auditor_pub = generate_keypair()

    # Build Merkle
    merkle = build_merkle_for_answers(ANSWERS)
    root   = merkle["root"]

    # Sign
    sig = sign_merkle_root(root, vendor_priv)

    # Encrypt for auditor
    encrypted = encrypt_payload(ANSWERS, auditor_pub)

    # Decrypt
    decrypted = decrypt_payload(
        ephemeral_public_key_pem  = encrypted["ephemeral_public_key_pem"],
        ciphertext_hex            = encrypted["ciphertext_hex"],
        iv_hex                    = encrypted["iv_hex"],
        auth_tag_hex              = encrypted["auth_tag_hex"],
        hkdf_salt_hex             = encrypted["hkdf_salt_hex"],
        recipient_private_key_pem = auditor_priv,
    )
    assert decrypted == ANSWERS


def test_tamper_after_signing_detected():
    """Tampering with an answer after signing must invalidate Merkle proof."""
    from crypto.merkle import verify_all_answers

    vendor_priv, vendor_pub = generate_keypair()
    merkle = build_merkle_for_answers(ANSWERS)

    tampered = [a.copy() for a in ANSWERS]
    tampered[1]["answer_value"] = "No"  # was "Yes"

    result = verify_all_answers(tampered, merkle["tree"], merkle["root"])
    assert result["valid"] is False
    assert 1 in result["failed_indices"]


def test_aes_gcm_auth_tag_catches_ciphertext_flip():
    """AES-GCM auth tag must catch any ciphertext modification."""
    from cryptography.exceptions import InvalidTag
    key       = os.urandom(32)
    plaintext = b"sensitive compliance answer"
    ct, iv, tag = encrypt(plaintext, key)

    # Flip one byte
    flipped = bytes([ct[0] ^ 0x01]) + ct[1:]
    with pytest.raises(Exception):
        decrypt(flipped, iv, tag, key)


def test_draft_encrypt_decrypt():
    """Draft encrypted with vendor pubkey decrypts correctly with privkey."""
    from crypto.hybrid import encrypt_draft, decrypt_draft
    priv, pub = generate_keypair()
    draft = {"answers": ANSWERS, "partial": True}

    encrypted = encrypt_draft(draft, pub)
    decrypted = decrypt_draft(encrypted, priv)
    assert decrypted == draft
