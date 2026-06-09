"""
crypto/ecc.py — ECC keypair generation and ECDH key agreement

All operations use secp256r1 (P-256) curve via pyca/cryptography.

Why P-256 over RSA:
  - 256-bit ECC ≈ 3072-bit RSA in security strength
  - Key size: 32 bytes vs 384 bytes
  - Signing is ~6x faster
  - Verified empirically in benchmark module (Sprint 10)
"""

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


# ── Keypair generation ────────────────────────────────────────────────────────

def generate_keypair() -> tuple[str, str]:
    """
    Generate a fresh ECC keypair on secp256r1 (P-256).

    Returns:
        (private_key_pem, public_key_pem) as PEM strings
    """
    private_key = ec.generate_private_key(ec.SECP256R1())

    private_key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()

    public_key_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()

    return private_key_pem, public_key_pem


def generate_ephemeral_keypair() -> tuple[ec.EllipticCurvePrivateKey, str]:
    """
    Generate a throwaway ECDH keypair for one session.
    The private key is returned as an object (never serialized to disk).
    The public key is returned as PEM to be shared with the other party.

    After the session, the private key object should be deleted from memory.
    This is the foundation of Perfect Forward Secrecy (L2).
    """
    private_key = ec.generate_private_key(ec.SECP256R1())

    public_key_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()

    return private_key, public_key_pem


# ── ECDH key agreement ────────────────────────────────────────────────────────

def derive_shared_secret(
    our_private_key: ec.EllipticCurvePrivateKey,
    their_public_key_pem: str,
) -> bytes:
    """
    Perform ECDH key agreement to derive a raw shared secret.

    Both sides do this independently with their own private key and
    the other party's public key. They arrive at the same shared secret
    without ever transmitting it.

    Returns:
        32-byte raw shared secret (not yet suitable as an AES key — use HKDF next)
    """
    their_public_key = serialization.load_pem_public_key(
        their_public_key_pem.encode()
    )

    shared_secret = our_private_key.exchange(ec.ECDH(), their_public_key)
    return shared_secret


def derive_aes_key(
    shared_secret: bytes,
    salt: bytes | None = None,
    info: bytes = b"attestr-session-key",
) -> bytes:
    """
    Derive a 32-byte AES-256 key from the ECDH shared secret using HKDF.

    HKDF (HMAC-based Key Derivation Function) stretches and mixes the
    raw shared secret into a proper encryption key.

    Args:
        shared_secret: raw bytes from ECDH exchange
        salt:          optional random salt (use a fresh one per session)
        info:          context string binding the key to its purpose

    Returns:
        32-byte AES key ready for AES-256-GCM
    """
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        info=info,
    )
    return hkdf.derive(shared_secret)


# ── PEM loading helpers ───────────────────────────────────────────────────────

def load_private_key(pem: str) -> ec.EllipticCurvePrivateKey:
    """Load an ECC private key from PEM string."""
    return serialization.load_pem_private_key(pem.encode(), password=None)


def load_public_key(pem: str) -> ec.EllipticCurvePublicKey:
    """Load an ECC public key from PEM string."""
    return serialization.load_pem_public_key(pem.encode())


def public_key_from_private(private_key_pem: str) -> str:
    """Extract the public key PEM from a private key PEM."""
    private_key = load_private_key(private_key_pem)
    return private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
