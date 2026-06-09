"""
crypto/signing.py — ECDSA digital signatures

ECDSA (Elliptic Curve Digital Signature Algorithm) with SHA-256.

What it proves:
  - The vendor with this specific private key signed this specific Merkle Root
  - Nobody else could have produced the same signature
  - The signature cannot be transferred to a different document
  - This is cryptographic non-repudiation — the vendor cannot later deny it

What gets signed:
  The Merkle Root — a single 32-byte hash that represents every answer.
  Signing the root means signing all answers simultaneously,
  because any change to any answer changes the root.

Key: vendor's ECC P-256 private key (from their keystore)
"""

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes, serialization


def sign_merkle_root(
    merkle_root_hex: str,
    private_key_pem: str,
) -> str:
    """
    Sign the Merkle Root with the vendor's ECC private key.

    Args:
        merkle_root_hex: hex string of the Merkle Root (output of build_merkle_for_answers)
        private_key_pem: vendor's ECC private key in PEM format

    Returns:
        ECDSA signature as a hex string (DER-encoded)

    The signature binds:
      - This exact set of answers (via the Merkle Root)
      - This exact vendor identity (via their private key)
      - At this exact point in time (combined with RFC 3161 timestamp)
    """
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode(), password=None
    )

    # Sign the raw bytes of the Merkle Root hex string
    root_bytes = merkle_root_hex.encode()
    signature  = private_key.sign(root_bytes, ec.ECDSA(hashes.SHA256()))

    return signature.hex()


def verify_ecdsa_signature(
    merkle_root_hex: str,
    signature_hex: str,
    public_key_pem: str,
) -> dict:
    """
    Verify an ECDSA signature over a Merkle Root.

    Args:
        merkle_root_hex: the Merkle Root from the Tessera bundle
        signature_hex:   the ECDSA signature from the Tessera bundle
        public_key_pem:  the vendor's public key (from their embedded certificate)

    Returns:
        {"valid": bool, "reason": str}

    If valid=True: this vendor definitely signed this exact set of answers.
    If valid=False: either the answers were tampered with, or the wrong key was used.
    """
    try:
        public_key = serialization.load_pem_public_key(public_key_pem.encode())
        signature  = bytes.fromhex(signature_hex)
        root_bytes = merkle_root_hex.encode()

        public_key.verify(signature, root_bytes, ec.ECDSA(hashes.SHA256()))

        return {"valid": True, "reason": "Signature verified successfully"}

    except Exception as e:
        return {"valid": False, "reason": f"Signature verification failed: {str(e)}"}


def extract_public_key_from_cert(cert_pem: str) -> str:
    """
    Extract the public key PEM from an X.509 certificate PEM.
    Used during verification to get the vendor's public key
    from the certificate embedded in the Tessera.
    """
    from cryptography import x509

    cert       = x509.load_pem_x509_certificate(cert_pem.encode())
    public_key = cert.public_key()

    return public_key.public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
