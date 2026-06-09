"""
crypto/hybrid.py — Hybrid encryption pipeline

Combines asymmetric ECC with symmetric AES-256-GCM.

Why hybrid and not pure asymmetric?
  ECC can only encrypt small payloads (size of the key).
  AES-256-GCM handles arbitrary payload sizes efficiently.
  The hybrid approach uses ECC to securely exchange an AES key,
  then AES to encrypt the actual data.

Full flow (Vendor → Auditor):

  1. Vendor generates a throwaway ECDH keypair (ephemeral)
  2. Vendor performs ECDH with Auditor's long-term public key
     → shared secret (never transmitted)
  3. HKDF stretches the shared secret into a 32-byte AES key
  4. AES-256-GCM encrypts the signed questionnaire payload
  5. Vendor destroys the ephemeral private key
  6. Bundle contains: ephemeral public key + ciphertext + IV + auth tag

  Auditor decrypts:
  1. Auditor performs ECDH with their private key + vendor's ephemeral public key
     → same shared secret
  2. HKDF derives the same AES key
  3. AES-256-GCM decrypts and verifies integrity

Perfect Forward Secrecy:
  The ephemeral private key is destroyed after encryption.
  Even if the Auditor's long-term private key is stolen years later,
  past sessions cannot be decrypted — the ephemeral key is gone forever.
"""

import json
import os

from crypto.ecc import (
    generate_ephemeral_keypair,
    derive_shared_secret,
    derive_aes_key,
    load_private_key,
    load_public_key,
)
from crypto.encryption import encrypt_to_hex, decrypt_from_hex


def encrypt_payload(
    payload: dict | bytes,
    recipient_public_key_pem: str,
    salt: bytes | None = None,
) -> dict:
    """
    Encrypt a payload for a specific recipient using hybrid encryption.

    Args:
        payload:                  dict (will be JSON-serialized) or raw bytes
        recipient_public_key_pem: auditor's long-term ECC public key
        salt:                     optional HKDF salt (random bytes)

    Returns:
        {
            "ephemeral_public_key_pem": str,  ← include in Tessera bundle
            "ciphertext_hex":           str,
            "iv_hex":                   str,
            "auth_tag_hex":             str,
            "hkdf_salt_hex":            str,
        }

    The recipient uses their private key + ephemeral_public_key to derive
    the same AES key and decrypt.
    """
    # 1. Generate throwaway ECDH keypair
    ephemeral_private_key, ephemeral_public_key_pem = generate_ephemeral_keypair()

    # 2. ECDH key agreement
    shared_secret = derive_shared_secret(ephemeral_private_key, recipient_public_key_pem)

    # 3. HKDF → AES key
    if salt is None:
        salt = os.urandom(32)
    aes_key = derive_aes_key(shared_secret, salt=salt)

    # 4. Serialize payload
    if isinstance(payload, dict):
        plaintext = json.dumps(payload, separators=(',', ':')).encode()
    else:
        plaintext = payload

    # 5. AES-256-GCM encrypt
    encrypted = encrypt_to_hex(plaintext, aes_key)

    # 6. Destroy ephemeral private key (Python GC will handle it,
    #    but we explicitly delete the reference)
    del ephemeral_private_key
    del shared_secret
    del aes_key

    return {
        "ephemeral_public_key_pem": ephemeral_public_key_pem,
        "hkdf_salt_hex":            salt.hex(),
        **encrypted,
    }


def decrypt_payload(
    ephemeral_public_key_pem: str,
    ciphertext_hex: str,
    iv_hex: str,
    auth_tag_hex: str,
    hkdf_salt_hex: str,
    recipient_private_key_pem: str,
) -> dict | bytes:
    """
    Decrypt a hybrid-encrypted payload.

    Args:
        ephemeral_public_key_pem:  from the Tessera bundle
        ciphertext_hex:            from the Tessera bundle
        iv_hex:                    from the Tessera bundle
        auth_tag_hex:              from the Tessera bundle
        hkdf_salt_hex:             from the Tessera bundle
        recipient_private_key_pem: auditor's long-term private key

    Returns:
        Decrypted payload as a dict (if JSON) or raw bytes
    """
    # 1. Load recipient's private key
    recipient_private_key = load_private_key(recipient_private_key_pem)

    # 2. ECDH with the vendor's ephemeral public key
    shared_secret = derive_shared_secret(
        recipient_private_key, ephemeral_public_key_pem
    )

    # 3. Derive the same AES key via HKDF
    salt    = bytes.fromhex(hkdf_salt_hex)
    aes_key = derive_aes_key(shared_secret, salt=salt)

    # 4. AES-256-GCM decrypt (raises InvalidTag if tampered)
    plaintext = decrypt_from_hex(ciphertext_hex, iv_hex, auth_tag_hex, aes_key)

    # 5. Clean up
    del recipient_private_key
    del shared_secret
    del aes_key

    # Try to parse as JSON
    try:
        return json.loads(plaintext.decode())
    except Exception:
        return plaintext


def encrypt_draft(
    draft_answers: dict,
    vendor_public_key_pem: str,
) -> dict:
    """
    Encrypt a draft (auto-save) using the vendor's own public key.
    Only the vendor can decrypt their own draft with their private key.
    The relay server stores this blob and never sees the plaintext.

    This is called client-side in the browser (mirrored here for server-side drafts).
    """
    return encrypt_payload(draft_answers, vendor_public_key_pem)


def decrypt_draft(
    encrypted_draft: dict,
    vendor_private_key_pem: str,
) -> dict:
    """Decrypt a vendor's own draft using their private key."""
    return decrypt_payload(
        ephemeral_public_key_pem  = encrypted_draft["ephemeral_public_key_pem"],
        ciphertext_hex            = encrypted_draft["ciphertext_hex"],
        iv_hex                    = encrypted_draft["iv_hex"],
        auth_tag_hex              = encrypted_draft["auth_tag_hex"],
        hkdf_salt_hex             = encrypted_draft["hkdf_salt_hex"],
        recipient_private_key_pem = vendor_private_key_pem,
    )
