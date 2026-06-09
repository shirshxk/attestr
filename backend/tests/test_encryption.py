"""
tests/test_encryption.py — AES-256-GCM and hybrid encryption tests
"""

import pytest
import os
from crypto.encryption import encrypt, decrypt, encrypt_to_hex, decrypt_from_hex
from crypto.ecc import generate_keypair
from crypto.hybrid import encrypt_payload, decrypt_payload


def test_aes_gcm_roundtrip():
    """Encrypt then decrypt returns original plaintext."""
    key       = os.urandom(32)
    plaintext = b"Attestr test payload"

    ciphertext, iv, tag = encrypt(plaintext, key)
    result = decrypt(ciphertext, iv, tag, key)

    assert result == plaintext


def test_aes_gcm_ciphertext_differs():
    """Two encryptions of the same plaintext produce different ciphertext (random IV)."""
    key       = os.urandom(32)
    plaintext = b"Same plaintext"

    ct1, iv1, _ = encrypt(plaintext, key)
    ct2, iv2, _ = encrypt(plaintext, key)

    assert iv1 != iv2  # fresh IV each time
    assert ct1 != ct2


def test_aes_gcm_tamper_detection():
    """Flipping one bit in ciphertext causes decryption to fail."""
    from cryptography.exceptions import InvalidTag

    key       = os.urandom(32)
    plaintext = b"Do not tamper with this"

    ciphertext, iv, tag = encrypt(plaintext, key)

    # Flip the first byte
    tampered = bytes([ciphertext[0] ^ 0xFF]) + ciphertext[1:]

    with pytest.raises(Exception):  # InvalidTag
        decrypt(tampered, iv, tag, key)


def test_hybrid_encryption_roundtrip():
    """Full hybrid encrypt → decrypt returns original payload."""
    private_pem, public_pem = generate_keypair()

    payload = {
        "question_id":   "cc6.1",
        "answer_value":  "Yes",
        "answer_type":   "boolean",
        "question_text": "Do you enforce MFA?",
        "evidence_note": "Via Okta",
        "answered_at":   "2026-06-01T10:00:00Z",
    }

    encrypted = encrypt_payload(payload, public_pem)
    decrypted = decrypt_payload(
        ephemeral_public_key_pem  = encrypted["ephemeral_public_key_pem"],
        ciphertext_hex            = encrypted["ciphertext_hex"],
        iv_hex                    = encrypted["iv_hex"],
        auth_tag_hex              = encrypted["auth_tag_hex"],
        hkdf_salt_hex             = encrypted["hkdf_salt_hex"],
        recipient_private_key_pem = private_pem,
    )

    assert decrypted == payload


def test_hybrid_wrong_key_fails():
    """Decrypting with a different private key fails."""
    priv1, pub1 = generate_keypair()
    priv2, pub2 = generate_keypair()

    payload   = {"answer": "Yes"}
    encrypted = encrypt_payload(payload, pub1)

    with pytest.raises(Exception):
        decrypt_payload(
            ephemeral_public_key_pem  = encrypted["ephemeral_public_key_pem"],
            ciphertext_hex            = encrypted["ciphertext_hex"],
            iv_hex                    = encrypted["iv_hex"],
            auth_tag_hex              = encrypted["auth_tag_hex"],
            hkdf_salt_hex             = encrypted["hkdf_salt_hex"],
            recipient_private_key_pem = priv2,  # wrong key
        )
