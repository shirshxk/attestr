"""
api/auth.py — mTLS certificate-based authentication

In a production mTLS setup the TLS layer would extract the client cert
and pass it as a header. For this demo, the client sends their certificate
PEM in the X-Client-Cert header and a short-lived JWT session token.

Flow:
  1. Client presents X.509 cert PEM in header
  2. CA verifies the cert (signature, expiry, CRL)
  3. Org is identified from the cert's serialNumber field (= org_id)
  4. A JWT session token is issued (valid 8 hours)
  5. Subsequent requests carry only the JWT

FastAPI dependencies:
  - require_auth       → any authenticated org
  - require_auditor    → must be role=auditor
  - require_vendor     → must be role=vendor
  - require_ca_admin   → must be role=ca_admin
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from ca.authority import ca
from config import settings
from models.database import get_db, Organization

bearer_scheme = HTTPBearer(auto_error=False)


# ── JWT helpers ───────────────────────────────────────────────────────────────

def create_session_token(org_id: str, org_role: str) -> str:
    """Issue a short-lived JWT session token after cert verification."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub":  org_id,
        "role": org_role,
        "exp":  expire,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token.",
        )


# ── Certificate login endpoint helper ────────────────────────────────────────

def login_with_certificate(cert_pem: str, db: Session) -> dict:
    """
    Validate a client certificate and return a session token.
    Called from the /auth/login endpoint.
    """
    result = ca.verify_certificate(cert_pem)
    if not result["valid"]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Certificate verification failed: {result['reason']}",
        )

    org = db.query(Organization).filter(Organization.id == result["org_id"]).first()
    if not org or not org.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Organization not found or inactive.",
        )

    token = create_session_token(org.id, org.role)
    return {
        "access_token": token,
        "token_type":   "bearer",
        "org_id":       org.id,
        "org_name":     org.name,
        "role":         org.role,
    }


# ── FastAPI dependencies ──────────────────────────────────────────────────────

def _get_current_org(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Organization:
    """Base dependency — extract org from JWT token."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    payload = _decode_token(credentials.credentials)
    org_id  = payload.get("sub")

    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org or not org.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Organization not found or inactive.",
        )
    return org


def require_auth(org: Organization = Depends(_get_current_org)) -> Organization:
    """Any authenticated organization."""
    return org


def require_auditor(org: Organization = Depends(_get_current_org)) -> Organization:
    """Must be an auditor organization."""
    if org.role != "auditor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Auditor access required.",
        )
    return org


def require_vendor(org: Organization = Depends(_get_current_org)) -> Organization:
    """Must be a vendor organization."""
    if org.role != "vendor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Vendor access required.",
        )
    return org


def require_ca_admin(org: Organization = Depends(_get_current_org)) -> Organization:
    """Must be the CA Admin."""
    if org.role != "ca_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CA Admin access required.",
        )
    return org
