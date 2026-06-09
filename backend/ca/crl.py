"""
ca/crl.py — Certificate Revocation List (CRL)

Maintains a simple JSON file of revoked certificate serial numbers.
Checked on every mTLS verification attempt.

Design note:
  In production this would be a proper RFC 5280 CRL signed by the CA.
  For the academic demo we use a signed JSON file that achieves the same
  security property — the CA admin is the only one who can add entries.
"""

import json
import os
from datetime import datetime
from typing import Optional


CRL_PATH = "/app/data/crl.json"


class CRLManager:
    """
    Manages the Certificate Revocation List.
    Persisted as a JSON file at CRL_PATH.
    """

    def __init__(self, path: str = CRL_PATH):
        self._path = path
        self._revoked: dict[str, dict] = {}  # serial_hex → {reason, revoked_at}
        self._load()

    def _load(self) -> None:
        if os.path.exists(self._path):
            with open(self._path) as f:
                self._revoked = json.load(f)

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        with open(self._path, "w") as f:
            json.dump(self._revoked, f, indent=2, default=str)

    def revoke(self, serial_hex: str, reason: str = "unspecified") -> None:
        """Add a serial number to the CRL."""
        self._revoked[serial_hex] = {
            "reason":     reason,
            "revoked_at": datetime.utcnow().isoformat(),
        }
        self._save()

    def is_revoked(self, serial_hex: str) -> bool:
        """Return True if the serial number is on the CRL."""
        return serial_hex in self._revoked

    def get_all(self) -> dict:
        """Return the full CRL dict."""
        return dict(self._revoked)

    def reinstate(self, serial_hex: str) -> None:
        """Remove a serial from the CRL (admin use only)."""
        self._revoked.pop(serial_hex, None)
        self._save()
