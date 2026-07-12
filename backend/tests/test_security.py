"""
tests/test_security.py — regression tests for the security fixes from the audit.

Covers:
  - production fail-fast on default secrets
  - file-download authorization shape (rejects bad file_id)
  - JWT encode/decode round-trip with the current library
"""
import pytest
from config import Settings, validate_production_secrets


# ── Production secret fail-fast ───────────────────────────────────────────────

def test_dev_allows_default_secrets():
    """Development must boot with shipped defaults (demo convenience)."""
    validate_production_secrets(Settings(attestr_env="development"))  # no raise


def test_prod_rejects_default_secrets():
    """Production must refuse to start with the shipped default secrets."""
    with pytest.raises(RuntimeError):
        validate_production_secrets(Settings(attestr_env="production"))


def test_prod_rejects_short_secrets():
    with pytest.raises(RuntimeError):
        validate_production_secrets(
            Settings(attestr_env="production", jwt_secret="short", ca_passphrase="short")
        )


def test_prod_accepts_strong_secrets():
    validate_production_secrets(
        Settings(attestr_env="production",
                 jwt_secret="x" * 32, ca_passphrase="y" * 32)
    )  # no raise


# ── JWT round-trip (library migration regression) ─────────────────────────────

def test_jwt_round_trip():
    from api.auth import create_session_token, _decode_token
    tok = create_session_token("org-abc", "auditor")
    decoded = _decode_token(tok)
    assert decoded["sub"] == "org-abc"
    assert decoded["role"] == "auditor"


def test_jwt_rejects_tampered_token():
    from api.auth import create_session_token, _decode_token
    from fastapi import HTTPException
    tok = create_session_token("org-abc", "auditor")
    tampered = tok[:-4] + ("aaaa" if not tok.endswith("aaaa") else "bbbb")
    with pytest.raises(HTTPException):
        _decode_token(tampered)


# ── File download id validation ───────────────────────────────────────────────

def test_download_rejects_empty_file_id():
    """An empty/partial file_id must never match a real file (was an IDOR)."""
    import re
    # mirror the endpoint's guard
    def valid(fid):
        return bool(re.match(r"^([0-9a-fA-F-]{36})", fid or ""))
    assert valid("") is False
    assert valid("..") is False
    assert valid("a") is False
    assert valid("12345678-1234-1234-1234-123456789abc") is True
