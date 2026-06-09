"""
ca/timestamp.py — RFC 3161 Timestamp Authority (simulated)

The TSA receives the SHA-256 hash of a payload, countersigns it
with the current time using the CA's private key, and returns a
verifiable timestamp token.

Format of the timestamp token (JSON, then base64-encoded for transport):
  {
    "version":       1,
    "hash_hex":      "<SHA-256 of the data being timestamped>",
    "hash_algorithm":"SHA-256",
    "timestamp":     "<ISO 8601 UTC>",
    "tsa_name":      "Attestr TSA",
    "serial":        "<random int>",
    "signature":     "<ECDSA signature over canonical_bytes>",
  }

canonical_bytes = SHA-256(version + hash_hex + timestamp + serial)

Verification:
  1. Decode the token
  2. Recompute canonical_bytes
  3. Verify ECDSA signature against CA public key
  4. Check that hash_hex matches SHA-256 of the payload you provide

This satisfies the academic requirement for RFC 3161-style timestamping
without requiring a live external TSA during the demo.
"""

import base64
import hashlib
import json
import os
import secrets
from datetime import datetime, timezone

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec


class TimestampAuthority:
    """
    Internal TSA backed by the CA signing key.
    One instance reuses the CA's ECC private key loaded at startup.
    """

    def __init__(self):
        self._private_key: ec.EllipticCurvePrivateKey | None = None

    def set_signing_key(self, private_key: ec.EllipticCurvePrivateKey) -> None:
        """Inject the CA private key after the CA initializes."""
        self._private_key = private_key

    def stamp(self, data_bytes: bytes) -> str:
        """
        Create a timestamp token for the given data.

        Args:
            data_bytes: the raw bytes to be timestamped (e.g. signed payload)

        Returns:
            base64-encoded JSON timestamp token string
        """
        if not self._private_key:
            raise RuntimeError("TSA signing key not set.")

        # Hash the payload
        hash_hex = hashlib.sha256(data_bytes).hexdigest()
        timestamp = datetime.now(timezone.utc).isoformat()
        serial    = secrets.randbelow(2**64)

        # Build the canonical bytes that get signed
        canonical = f"1|{hash_hex}|SHA-256|{timestamp}|{serial}".encode()
        canonical_hash = hashlib.sha256(canonical).digest()

        # Sign with CA ECC key
        from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
        signature_bytes = self._private_key.sign(canonical_hash, ec.ECDSA(hashes.SHA256()))
        signature_hex = signature_bytes.hex()

        token = {
            "version":        1,
            "hash_hex":       hash_hex,
            "hash_algorithm": "SHA-256",
            "timestamp":      timestamp,
            "tsa_name":       "Attestr TSA",
            "serial":         serial,
            "signature":      signature_hex,
        }

        token_json = json.dumps(token, separators=(",", ":"))
        return base64.b64encode(token_json.encode()).decode()

    def verify(self, token_b64: str, public_key_pem: str, expected_hash_hex: str) -> dict:
        """
        Verify a timestamp token.

        Args:
            token_b64:          the base64 token returned by stamp()
            public_key_pem:     CA public key PEM for signature verification
            expected_hash_hex:  SHA-256 hex of the payload you expect was stamped

        Returns:
            {"valid": bool, "timestamp": str, "reason": str}
        """
        try:
            token_json = base64.b64decode(token_b64).decode()
            token      = json.loads(token_json)
        except Exception as e:
            return {"valid": False, "reason": f"Could not decode token: {e}"}

        # Check the hash matches what we expect
        if token["hash_hex"] != expected_hash_hex:
            return {"valid": False, "reason": "Hash mismatch — payload does not match token"}

        # Rebuild canonical bytes and verify signature
        canonical = (
            f"1|{token['hash_hex']}|SHA-256|{token['timestamp']}|{token['serial']}"
        ).encode()
        canonical_hash = hashlib.sha256(canonical).digest()

        try:
            pub_key = serialization.load_pem_public_key(public_key_pem.encode())
            signature_bytes = bytes.fromhex(token["signature"])
            pub_key.verify(signature_bytes, canonical_hash, ec.ECDSA(hashes.SHA256()))
        except Exception as e:
            return {"valid": False, "reason": f"Signature verification failed: {e}"}

        return {
            "valid":     True,
            "timestamp": token["timestamp"],
            "tsa_name":  token["tsa_name"],
            "serial":    token["serial"],
        }


# ── Singleton instance ────────────────────────────────────────────────────────

tsa = TimestampAuthority()
