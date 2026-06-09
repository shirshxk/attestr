"""
crypto/encryption.py — AES-256-GCM symmetric encryption

AES-256-GCM (Galois/Counter Mode) provides:
  - Confidentiality: the ciphertext reveals nothing about the plaintext
  - Integrity:       the 16-byte authentication tag detects any tampering
                     with the ciphertext, even a single bit flip
  - Authenticity:    decryption fails if the ciphertext was modified

This is authenticated encryption — one operation gives you both
encryption and a MAC. No separate HMAC needed for the payload.

Key source: derived from ephemeral ECDH exchange via HKDF (see crypto/ecc.py)
The key is NEVER transmitted — both parties derive it independently.
"""

import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def encrypt(
    plaintext: bytes,
    key: bytes,
    associated_data: bytes | None = None,
) -> tuple[bytes, bytes, bytes]:
    """
    Encrypt plaintext with AES-256-GCM.

    Args:
        plaintext:       raw bytes to encrypt
        key:             32-byte AES key (from HKDF)
        associated_data: optional bytes that are authenticated but NOT encrypted
                         (e.g. metadata like bundle_id — tampering with it
                          will cause decryption to fail)

    Returns:
        (ciphertext, iv, auth_tag) — all as bytes

    The IV (Initialization Vector) is 12 bytes of random data.
    A fresh IV must be used for every encryption — NEVER reuse.
    GCM appends the 16-byte auth tag to the end of the ciphertext.
    We split them here for clarity in the bundle format.
    """
    if len(key) != 32:
        raise ValueError(f"AES-256 requires a 32-byte key, got {len(key)} bytes")

    iv     = os.urandom(12)
    aesgcm = AESGCM(key)

    # encrypt() returns ciphertext + 16-byte auth tag appended
    ciphertext_with_tag = aesgcm.encrypt(iv, plaintext, associated_data)

    ciphertext = ciphertext_with_tag[:-16]
    auth_tag   = ciphertext_with_tag[-16:]

    return ciphertext, iv, auth_tag


def decrypt(
    ciphertext: bytes,
    iv: bytes,
    auth_tag: bytes,
    key: bytes,
    associated_data: bytes | None = None,
) -> bytes:
    """
    Decrypt AES-256-GCM ciphertext and verify its authentication tag.

    Args:
        ciphertext:      encrypted bytes
        iv:              12-byte initialization vector from encrypt()
        auth_tag:        16-byte authentication tag from encrypt()
        key:             32-byte AES key
        associated_data: must match what was passed to encrypt()

    Returns:
        Original plaintext bytes

    Raises:
        cryptography.exceptions.InvalidTag if the ciphertext or tag
        has been tampered with — this is the integrity check.
    """
    aesgcm = AESGCM(key)

    # Reattach the auth tag for the AESGCM API
    ciphertext_with_tag = ciphertext + auth_tag

    return aesgcm.decrypt(iv, ciphertext_with_tag, associated_data)


def encrypt_to_hex(
    plaintext: bytes,
    key: bytes,
) -> dict:
    """
    Encrypt and return all components as hex strings for JSON storage.
    Used when building the Tessera bundle.
    """
    ciphertext, iv, auth_tag = encrypt(plaintext, key)
    return {
        "ciphertext_hex": ciphertext.hex(),
        "iv_hex":         iv.hex(),
        "auth_tag_hex":   auth_tag.hex(),
    }


def decrypt_from_hex(
    ciphertext_hex: str,
    iv_hex: str,
    auth_tag_hex: str,
    key: bytes,
) -> bytes:
    """
    Decrypt from hex strings stored in a Tessera bundle.
    """
    return decrypt(
        ciphertext  = bytes.fromhex(ciphertext_hex),
        iv          = bytes.fromhex(iv_hex),
        auth_tag    = bytes.fromhex(auth_tag_hex),
        key         = key,
    )
