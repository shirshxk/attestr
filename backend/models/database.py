"""
models/database.py — all SQLAlchemy ORM models for Attestr.

Tables:
  - organizations    one row per org (auditor, vendor, ca_admin)
  - invitations      pending invitations issued by CA Admin
  - certificates     X.509 certs issued to each org
  - questionnaires   questionnaire definitions
  - questions        individual questions inside a questionnaire
  - submissions      a vendor's response to a questionnaire
  - answers          individual answer per question inside a submission
  - tesseras         completed sealed bundles
  - remediation_requests  flagged answers needing a new round
  - notifications    in-app notification entries
  - audit_log        HMAC-chained platform event log
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, ForeignKey,
    Integer, LargeBinary, String, Text, create_engine
)
from sqlalchemy.orm import DeclarativeBase, relationship, sessionmaker

from config import settings

# ── Engine + session factory ──────────────────────────────────────────────────

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},  # needed for SQLite
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """FastAPI dependency — yields a DB session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Base class ────────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


def new_uuid() -> str:
    return str(uuid.uuid4())


# ── Organizations ─────────────────────────────────────────────────────────────

class Workspace(Base):
    """
    A team/firm grouping for auditors or vendors. Members of the same workspace
    can view each other's work (owned-but-visible). Created by a super-admin,
    managed by a workspace admin who can invite teammates.
    """
    __tablename__ = "workspaces"

    id          = Column(String, primary_key=True, default=new_uuid)
    name        = Column(String(255), nullable=False)
    kind        = Column(Enum("auditor", "vendor", name="workspace_kind"), nullable=False)
    created_by  = Column(String, nullable=True)     # super-admin org_id
    created_at  = Column(DateTime, default=datetime.utcnow)


class Organization(Base):
    __tablename__ = "organizations"

    id            = Column(String, primary_key=True, default=new_uuid)
    name          = Column(String(255), nullable=False)
    # Roles: super_admin (the CA, top authority) > admin (manager) > auditor > vendor.
    # 'ca_admin' is kept as a legacy alias and migrated to 'super_admin' at startup.
    role          = Column(Enum("super_admin", "admin", "ca_admin", "auditor", "vendor", name="org_role"), nullable=False)
    # Only meaningful for auditors: a privileged auditor can see Tessera anatomy
    # and the Trust Center (same view tier as admins).
    is_privileged = Column(Boolean, default=False)
    email         = Column(String(255), unique=True, nullable=False)
    is_active     = Column(Boolean, default=True)
    created_by    = Column(String, nullable=True)   # org_id of the elevated user who created this org
    # Workspace membership: auditors/vendors can belong to a shared team. Teammates
    # see each other's work (owned-but-visible). Null = not in a workspace.
    workspace_id        = Column(String, ForeignKey("workspaces.id"), nullable=True)
    is_workspace_admin  = Column(Boolean, default=False)   # can invite teammates into their workspace
    created_at    = Column(DateTime, default=datetime.utcnow)

    # Relationships
    certificates  = relationship("Certificate", back_populates="organization")
    invitations   = relationship("Invitation", back_populates="invited_org",
                                 foreign_keys="Invitation.invited_org_id")


# ── Invitations ───────────────────────────────────────────────────────────────

class Invitation(Base):
    __tablename__ = "invitations"

    id              = Column(String, primary_key=True, default=new_uuid)
    token           = Column(String(512), unique=True, nullable=False)   # secure random token
    email           = Column(String(255), nullable=False)
    intended_role   = Column(Enum("auditor", "vendor", name="inv_role"), nullable=False)
    org_name        = Column(String(255), nullable=False)
    invited_by_id   = Column(String, ForeignKey("organizations.id"), nullable=False)
    invited_org_id  = Column(String, ForeignKey("organizations.id"), nullable=True)
    is_used         = Column(Boolean, default=False)
    expires_at      = Column(DateTime, nullable=False)
    created_at      = Column(DateTime, default=datetime.utcnow)

    invited_by  = relationship("Organization", foreign_keys=[invited_by_id])
    invited_org = relationship("Organization", foreign_keys=[invited_org_id],
                               back_populates="invitations")


# ── Certificates ──────────────────────────────────────────────────────────────

class Certificate(Base):
    __tablename__ = "certificates"

    id                = Column(String, primary_key=True, default=new_uuid)
    org_id            = Column(String, ForeignKey("organizations.id"), nullable=False)
    serial_number     = Column(String(64), unique=True, nullable=False)
    cert_pem          = Column(Text, nullable=False)           # full X.509 PEM
    public_key_pem    = Column(Text, nullable=False)
    issued_at         = Column(DateTime, default=datetime.utcnow)
    expires_at        = Column(DateTime, nullable=False)
    is_revoked        = Column(Boolean, default=False)
    revoked_at        = Column(DateTime, nullable=True)
    revocation_reason = Column(String(255), nullable=True)

    organization = relationship("Organization", back_populates="certificates")



# ── Vendor ↔ Auditor-workspace assignment ─────────────────────────────────────
# A vendor can be assigned to one or more auditor workspaces (many-to-many).
# Auditors only see vendors assigned to their workspace; vendors see all their
# questionnaires regardless of which workspace assigned them.

class VendorWorkspaceAccess(Base):
    __tablename__ = "vendor_workspace_access"

    id           = Column(String, primary_key=True, default=new_uuid)
    vendor_id    = Column(String, ForeignKey("organizations.id"), nullable=False)
    workspace_id = Column(String, ForeignKey("workspaces.id"), nullable=False)
    created_at   = Column(DateTime, default=datetime.utcnow)


# ── Enrollment (CSR-based, key never leaves the user's device) ────────────────

class Enrollment(Base):
    """
    A pending certificate enrollment. The CA admin creates the org + an
    enrollment token; the user later opens the enrollment link, generates a
    keypair in their browser, and submits a CSR. No private key is ever stored
    or transmitted to the server.
    """
    __tablename__ = "enrollments"

    id           = Column(String, primary_key=True, default=new_uuid)
    org_id       = Column(String, ForeignKey("organizations.id"), nullable=False)
    token        = Column(String(128), unique=True, nullable=False)
    status       = Column(String(20), default="pending")   # pending | completed | expired
    created_by   = Column(String, nullable=True)            # admin org_id who created it
    created_at   = Column(DateTime, default=datetime.utcnow)
    expires_at   = Column(DateTime, nullable=False)
    completed_at = Column(DateTime, nullable=True)


# ── Questionnaires ────────────────────────────────────────────────────────────

class Questionnaire(Base):
    __tablename__ = "questionnaires"

    id            = Column(String, primary_key=True, default=new_uuid)
    title         = Column(String(512), nullable=False)
    type          = Column(Enum("soc2", "iso27001", "custom", name="q_type"), nullable=False)
    template_json = Column(Text, nullable=True)    # original template snapshot
    auditor_id    = Column(String, ForeignKey("organizations.id"), nullable=False)
    vendor_id     = Column(String, ForeignKey("organizations.id"), nullable=False)
    status        = Column(
        Enum("pending", "submitted", "under_review", "in_remediation", "closed",
             name="q_status"),
        default="pending"
    )
    deadline      = Column(DateTime, nullable=True)
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    questions     = relationship("Question", back_populates="questionnaire")
    submissions   = relationship("Submission", back_populates="questionnaire")
    auditor       = relationship("Organization", foreign_keys=[auditor_id])
    vendor        = relationship("Organization", foreign_keys=[vendor_id])


class Question(Base):
    __tablename__ = "questions"

    id               = Column(String, primary_key=True, default=new_uuid)
    questionnaire_id = Column(String, ForeignKey("questionnaires.id"), nullable=False)
    question_id      = Column(String(64), nullable=False)   # e.g. "cc6.1"
    question_text    = Column(Text, nullable=False)
    question_type    = Column(
        Enum("boolean", "multiple_choice", "free_text", "numeric", "file_attachment",
             name="q_item_type"),
        nullable=False
    )
    options_json     = Column(Text, nullable=True)   # JSON array for multiple choice
    is_required      = Column(Boolean, default=True)
    order_index      = Column(Integer, nullable=False)

    questionnaire = relationship("Questionnaire", back_populates="questions")


# ── Submissions + Answers ─────────────────────────────────────────────────────

class Submission(Base):
    __tablename__ = "submissions"

    id               = Column(String, primary_key=True, default=new_uuid)
    questionnaire_id = Column(String, ForeignKey("questionnaires.id"), nullable=False)
    vendor_id        = Column(String, ForeignKey("organizations.id"), nullable=False)
    round_number     = Column(Integer, default=0)
    is_draft         = Column(Boolean, default=True)
    encrypted_draft  = Column(LargeBinary, nullable=True)   # client-side encrypted blob
    submitted_at     = Column(DateTime, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)

    questionnaire = relationship("Questionnaire", back_populates="submissions")
    vendor        = relationship("Organization", foreign_keys=[vendor_id])
    answers       = relationship("Answer", back_populates="submission")
    tessera       = relationship("Tessera", back_populates="submission", uselist=False)


class Answer(Base):
    __tablename__ = "answers"

    id               = Column(String, primary_key=True, default=new_uuid)
    submission_id    = Column(String, ForeignKey("submissions.id"), nullable=False)
    question_id      = Column(String(64), nullable=False)
    question_text    = Column(Text, nullable=False)
    answer_value     = Column(Text, nullable=False)
    answer_type      = Column(String(64), nullable=False)
    evidence_note    = Column(Text, nullable=True)
    answered_at      = Column(DateTime, default=datetime.utcnow)
    answered_at_iso  = Column(String(64), nullable=True)   # exact ISO string hashed into the Merkle leaf
    merkle_leaf_hash = Column(String(64), nullable=True)   # SHA-256 hex

    submission = relationship("Submission", back_populates="answers")


# ── Tessera (sealed bundle) ───────────────────────────────────────────────────

class Tessera(Base):
    __tablename__ = "tesseras"

    id                  = Column(String, primary_key=True, default=new_uuid)
    submission_id       = Column(String, ForeignKey("submissions.id"), nullable=False, unique=True)
    bundle_json         = Column(Text, nullable=False)    # full .tessera JSON
    merkle_root         = Column(String(64), nullable=False)
    ecdsa_signature     = Column(Text, nullable=False)
    rfc3161_token       = Column(Text, nullable=True)
    remediation_round   = Column(Integer, default=0)
    parent_tessera_id   = Column(String, nullable=True)
    verification_status = Column(
        Enum("unverified", "verified", "tampered", name="t_status"),
        default="unverified"
    )
    created_at          = Column(DateTime, default=datetime.utcnow)

    submission = relationship("Submission", back_populates="tessera")


# ── Remediation Requests ──────────────────────────────────────────────────────

class RemediationRequest(Base):
    __tablename__ = "remediation_requests"

    id            = Column(String, primary_key=True, default=new_uuid)
    tessera_id    = Column(String, ForeignKey("tesseras.id"), nullable=False)
    auditor_id    = Column(String, ForeignKey("organizations.id"), nullable=False)
    flags_json    = Column(Text, nullable=False)     # JSON: [{question_id, reasons, comment}]
    signed_request = Column(Text, nullable=True)     # ECDSA-signed request document
    created_at    = Column(DateTime, default=datetime.utcnow)

    tessera = relationship("Tessera")
    auditor = relationship("Organization", foreign_keys=[auditor_id])


# ── Notifications ─────────────────────────────────────────────────────────────

class Notification(Base):
    __tablename__ = "notifications"

    id         = Column(String, primary_key=True, default=new_uuid)
    org_id     = Column(String, ForeignKey("organizations.id"), nullable=False)
    title      = Column(String(255), nullable=False)
    body       = Column(Text, nullable=False)
    is_read    = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    organization = relationship("Organization")


# ── HMAC Audit Log ────────────────────────────────────────────────────────────

class AuditLogEntry(Base):
    __tablename__ = "audit_log"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    event_type   = Column(String(128), nullable=False)   # e.g. "cert_issued"
    actor_id     = Column(String, nullable=True)          # org_id who triggered it
    target_id    = Column(String, nullable=True)          # affected resource id
    details_json = Column(Text, nullable=True)            # arbitrary event metadata
    hmac_hex     = Column(String(64), nullable=False)     # HMAC of this entry + prev HMAC
    created_at   = Column(DateTime, default=datetime.utcnow)


# ── Vendor Requests (auditor → CA Admin approval flow) ───────────────────────

class VendorRequest(Base):
    __tablename__ = "vendor_requests"

    id            = Column(String, primary_key=True, default=new_uuid)
    auditor_id    = Column(String, ForeignKey("organizations.id"), nullable=False)
    vendor_name   = Column(String(255), nullable=False)
    vendor_email  = Column(String(255), nullable=False)
    status        = Column(
        Enum("pending", "approved", "rejected", name="vr_status"),
        default="pending"
    )
    note          = Column(Text, nullable=True)            # optional auditor note
    created_vendor_id = Column(String, nullable=True)      # set once approved
    reviewed_by_id    = Column(String, nullable=True)      # ca_admin who actioned
    created_at    = Column(DateTime, default=datetime.utcnow)
    reviewed_at   = Column(DateTime, nullable=True)

    auditor = relationship("Organization", foreign_keys=[auditor_id])


# ── Create all tables ─────────────────────────────────────────────────────────

def init_db():
    """Call once at startup to create all tables."""
    Base.metadata.create_all(bind=engine)
