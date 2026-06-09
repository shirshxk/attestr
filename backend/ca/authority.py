"""
ca/authority.py — Mini Certificate Authority

Responsibilities:
  - Generate the CA root keypair and self-signed root certificate (once, at init)
  - Issue X.509 certificates to invited organizations
  - Revoke certificates and update the CRL
  - All crypto via pyca/cryptography — no other library

Key design decisions:
  - ECC curve: secp256r1 (P-256) for all keys — faster and smaller than RSA
  - CA root cert is self-signed and embedded in the app
  - Issued certs include the org name, role, and org_id in the Subject
  - The CA private key is stored encrypted in the keystore (Argon2id + AES-GCM)
"""

import datetime
import os
import json
from typing import Optional

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from config import settings
from ca.crl import CRLManager


class CertificateAuthority:
    """
    The mini CA. One instance lives for the lifetime of the application.
    On first startup it generates a root keypair and self-signed cert.
    On subsequent startups it loads them from the keystore.
    """

    def __init__(self):
        self._ca_private_key: Optional[ec.EllipticCurvePrivateKey] = None
        self._ca_cert: Optional[x509.Certificate] = None
        self._crl_manager = CRLManager()

    # ── Startup ───────────────────────────────────────────────────────────────

    def initialize(self) -> None:
        """
        Called once at application startup.
        Either loads existing CA root from keystore or generates a new one.
        """
        keystore_path = settings.ca_keystore_path

        if os.path.exists(keystore_path):
            self._load_from_keystore(keystore_path)
        else:
            self._generate_root(keystore_path)

    def _generate_root(self, keystore_path: str) -> None:
        """
        Generate the CA root keypair and self-signed certificate.
        Saves both to the encrypted keystore file.
        """
        # Generate CA private key on P-256 curve
        private_key = ec.generate_private_key(ec.SECP256R1())

        # Build the root certificate subject
        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, "Attestr Root CA"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Attestr"),
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        ])

        now = datetime.datetime.utcnow()

        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(private_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now)
            .not_valid_after(now + datetime.timedelta(days=3650))  # 10 years
            # Mark this as a CA certificate
            .add_extension(
                x509.BasicConstraints(ca=True, path_length=None),
                critical=True,
            )
            .add_extension(
                x509.SubjectKeyIdentifier.from_public_key(private_key.public_key()),
                critical=False,
            )
            .sign(private_key, hashes.SHA256())
        )

        self._ca_private_key = private_key
        self._ca_cert = cert

        # Persist to keystore
        self._save_to_keystore(keystore_path, private_key, cert)

    def _save_to_keystore(
        self,
        keystore_path: str,
        private_key: ec.EllipticCurvePrivateKey,
        cert: x509.Certificate,
    ) -> None:
        """
        Save the CA private key (encrypted) and cert PEM to the keystore file.
        The private key is encrypted with AES-256-GCM, key derived via Argon2id.
        Import is deferred to avoid circular imports at module level.
        """
        from keystore.store import KeystoreManager
        ks = KeystoreManager(keystore_path, settings.ca_passphrase)

        private_key_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()

        cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()

        ks.store_key("ca_private_key", private_key_pem)
        ks.store_key("ca_cert_pem", cert_pem)

        # Ensure the data directory exists
        os.makedirs(os.path.dirname(keystore_path), exist_ok=True)
        ks.save()

    def _load_from_keystore(self, keystore_path: str) -> None:
        """Load existing CA root key and cert from the encrypted keystore."""
        from keystore.store import KeystoreManager
        ks = KeystoreManager(keystore_path, settings.ca_passphrase)
        ks.load()

        private_key_pem = ks.get_key("ca_private_key").encode()
        cert_pem        = ks.get_key("ca_cert_pem").encode()

        self._ca_private_key = serialization.load_pem_private_key(
            private_key_pem, password=None
        )
        self._ca_cert = x509.load_pem_x509_certificate(cert_pem)

    # ── Certificate issuance ──────────────────────────────────────────────────

    def issue_certificate(
        self,
        org_id: str,
        org_name: str,
        org_role: str,
        email: str,
    ) -> tuple[str, str]:
        """
        Issue an X.509 certificate for an organization.

        Returns:
            (cert_pem, public_key_pem) — both as PEM strings.

        The org's private key is generated here and returned encrypted in the
        keystore payload for the org. The public key is embedded in the cert.

        Subject fields:
          CN = org_name
          O  = Attestr Platform
          OU = role (auditor | vendor)
          serialNumber = org_id   ← lets us identify the org from the cert
        """
        if not self._ca_private_key or not self._ca_cert:
            raise RuntimeError("CA not initialized. Call initialize() first.")

        # Generate a fresh ECC keypair for this organization
        org_private_key = ec.generate_private_key(ec.SECP256R1())

        subject = x509.Name([
            x509.NameAttribute(NameOID.COMMON_NAME, org_name),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Attestr Platform"),
            x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, org_role),
            x509.NameAttribute(NameOID.SERIAL_NUMBER, org_id),
            x509.NameAttribute(NameOID.EMAIL_ADDRESS, email),
        ])

        now     = datetime.datetime.utcnow()
        expires = now + datetime.timedelta(days=settings.cert_validity_days)

        cert = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(self._ca_cert.subject)
            .public_key(org_private_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now)
            .not_valid_after(expires)
            .add_extension(
                x509.BasicConstraints(ca=False, path_length=None),
                critical=True,
            )
            .add_extension(
                x509.SubjectKeyIdentifier.from_public_key(org_private_key.public_key()),
                critical=False,
            )
            .add_extension(
                x509.AuthorityKeyIdentifier.from_issuer_public_key(
                    self._ca_private_key.public_key()
                ),
                critical=False,
            )
            .sign(self._ca_private_key, hashes.SHA256())
        )

        cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()
        public_key_pem = org_private_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()
        private_key_pem = org_private_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()

        # Log the issuance
        serial_hex = format(cert.serial_number, "x")

        return cert_pem, public_key_pem, private_key_pem, serial_hex, expires

    # ── Verification ─────────────────────────────────────────────────────────

    def verify_certificate(self, cert_pem: str) -> dict:
        """
        Verify that a PEM certificate was signed by this CA and is not revoked.

        Returns a dict with:
          valid       : bool
          org_id      : str  (from serialNumber field)
          org_name    : str
          org_role    : str
          reason      : str  (if invalid)
        """
        try:
            cert = x509.load_pem_x509_certificate(cert_pem.encode())
        except Exception as e:
            return {"valid": False, "reason": f"Could not parse certificate: {e}"}

        # Verify signature against CA public key
        try:
            self._ca_cert.public_key().verify(
                cert.signature,
                cert.tbs_certificate_bytes,
                ec.ECDSA(hashes.SHA256()),
            )
        except Exception:
            return {"valid": False, "reason": "Certificate signature invalid"}

        # Check expiry
        now = datetime.datetime.utcnow()
        if now < cert.not_valid_before_utc.replace(tzinfo=None):
            return {"valid": False, "reason": "Certificate not yet valid"}
        if now > cert.not_valid_after_utc.replace(tzinfo=None):
            return {"valid": False, "reason": "Certificate expired"}

        # Check CRL
        serial_hex = format(cert.serial_number, "x")
        if self._crl_manager.is_revoked(serial_hex):
            return {"valid": False, "reason": "Certificate revoked"}

        # Extract org info from Subject
        def get_attr(oid):
            try:
                return cert.subject.get_attributes_for_oid(oid)[0].value
            except IndexError:
                return None

        return {
            "valid": True,
            "org_id":   get_attr(NameOID.SERIAL_NUMBER),
            "org_name": get_attr(NameOID.COMMON_NAME),
            "org_role": get_attr(NameOID.ORGANIZATIONAL_UNIT_NAME),
            "serial":   serial_hex,
        }

    # ── Revocation ────────────────────────────────────────────────────────────

    def revoke_certificate(self, serial_hex: str, reason: str = "unspecified") -> None:
        """Add a certificate serial to the CRL."""
        self._crl_manager.revoke(serial_hex, reason)

    # ── CA cert access ────────────────────────────────────────────────────────

    @property
    def ca_cert_pem(self) -> str:
        """Return the CA root certificate as a PEM string."""
        return self._ca_cert.public_bytes(serialization.Encoding.PEM).decode()


# ── Singleton instance ────────────────────────────────────────────────────────

ca = CertificateAuthority()
