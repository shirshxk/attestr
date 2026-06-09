"""
keystore/rotation.py — Key rotation workflow

When an org rotates their key:
  1. Generate a new ECC keypair
  2. Store the new key as active in the keystore
  3. Mark the old key as deprecated (not deleted — old Tesseras still need it)
  4. Issue a new certificate for the new public key
  5. Record the rotation in the audit log

Old keys are kept with is_active=False so that old Tessera bundles
(which embedded the old certificate) can still be verified.
"""

from datetime import datetime
from sqlalchemy.orm import Session

from crypto.ecc import generate_keypair
from keystore.store import KeystoreManager
from config import settings


def rotate_org_key(
    org_id: str,
    org_name: str,
    org_role: str,
    org_email: str,
    db: Session,
) -> dict:
    """
    Rotate the ECC keypair for an organization.

    Steps:
      1. Generate new keypair
      2. Store in keystore (old key automatically marked deprecated)
      3. Issue new X.509 certificate
      4. Update certificate record in DB
      5. Log the rotation event

    Returns:
        dict with new cert_pem, public_key_pem, private_key_pem
    """
    from ca.authority import ca
    from models.database import Certificate
    from audit.hmac_log import append_log

    # 1. Generate new keypair
    private_key_pem, public_key_pem = generate_keypair()

    # 2. Store in keystore under org-specific key name
    ks_path = settings.ca_keystore_path.replace("ca_keystore", f"org_{org_id}_keystore")
    ks = KeystoreManager(ks_path, settings.ca_passphrase)
    try:
        ks.load()
    except FileNotFoundError:
        pass

    key_name = f"ecc_key_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
    ks.store_key(key_name, private_key_pem)
    ks.store_key("current_key_name", key_name)
    ks.save()

    # 3. Issue new certificate
    cert_pem, pub_pem, priv_pem, serial, expires = ca.issue_certificate(
        org_id=org_id,
        org_name=org_name,
        org_role=org_role,
        email=org_email,
    )

    # 4. Revoke old cert and store new one
    old_cert = (
        db.query(Certificate)
        .filter(Certificate.org_id == org_id, Certificate.is_revoked == False)  # noqa
        .first()
    )
    if old_cert:
        ca.revoke_certificate(old_cert.serial_number, reason="key_rotation")
        old_cert.is_revoked = True
        old_cert.revoked_at = datetime.utcnow()
        old_cert.revocation_reason = "key_rotation"

    new_cert = Certificate(
        org_id=org_id,
        serial_number=serial,
        cert_pem=cert_pem,
        public_key_pem=pub_pem,
        expires_at=expires,
    )
    db.add(new_cert)

    # 5. Log the rotation
    append_log(db, "key_rotated", actor_id=org_id, target_id=org_id,
               details={"new_serial": serial, "expires_at": expires.isoformat()})

    db.commit()

    return {
        "cert_pem":        cert_pem,
        "public_key_pem":  pub_pem,
        "private_key_pem": priv_pem,
        "serial":          serial,
        "expires_at":      expires.isoformat(),
        "message":         "Key rotated. Store new private key securely — shown once only.",
    }
