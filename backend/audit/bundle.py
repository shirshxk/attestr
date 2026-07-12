"""
audit/bundle.py — Tessera assembly

Assembles the complete .tessera bundle from all cryptographic components.
The Tessera is self-contained — everything needed to verify it is inside.
No server needs to be alive to verify an old Tessera.
"""

import json
import uuid
from datetime import datetime, timezone

from crypto.merkle import build_merkle_for_answers
from crypto.signing import sign_merkle_root, extract_public_key_from_cert
from crypto.hybrid import encrypt_payload
from ca.timestamp import tsa
from audit.hmac_log import append_log


def assemble_tessera(
    questionnaire_id: str,
    answers: list,
    vendor_cert_pem: str,
    auditor_cert_pem: str,
    auditor_public_key_pem: str,
    vendor_private_key_pem: str,
    evidence_files: list = None,
    remediation_round: int = 0,
    parent_bundle_id: str = None,
    db=None,
) -> dict:
    """
    Full Tessera assembly pipeline:
      1. Build Merkle Tree from answers
      2. ECDSA sign the Merkle Root
      3. Hybrid encrypt the payload (ECDH + HKDF + AES-256-GCM)
      4. RFC 3161 timestamp
      5. Assemble the bundle

    Returns the complete .tessera dict ready for JSON serialization.
    """
    bundle_id = str(uuid.uuid4())

    # 1. Build Merkle Tree
    merkle = build_merkle_for_answers(answers)
    merkle_root = merkle["root"]

    # 2. ECDSA sign Merkle Root with vendor's private key
    ecdsa_signature = sign_merkle_root(merkle_root, vendor_private_key_pem)

    # 3. Build payload to encrypt
    payload = {
        "bundle_id":          bundle_id,
        "questionnaire_id":   questionnaire_id,
        "answers":            answers,
        "signed_at":          datetime.now(timezone.utc).isoformat(),
        "remediation_round":  remediation_round,
    }

    # 4. Hybrid encrypt for auditor
    encrypted = encrypt_payload(payload, auditor_public_key_pem)

    # 5. RFC 3161 timestamp on the Merkle Root
    root_bytes = merkle_root.encode()
    timestamp_token = tsa.stamp(root_bytes)

    # 6. Process evidence files
    processed_evidence = []
    if evidence_files:
        for ef in evidence_files:
            processed_evidence.append({
                "question_id":     ef.get("question_id"),
                "filename":        ef.get("filename"),
                "file_hash":       ef.get("file_hash"),
                "encrypted_file":  ef.get("encrypted_file", ""),
                "merkle_leaf_index": ef.get("merkle_leaf_index", 0),
            })

    # 7. Assemble the complete Tessera
    tessera = {
        "bundle_version":          "1.0",
        "bundle_id":               bundle_id,
        "questionnaire_id":        questionnaire_id,
        "remediation_round":       remediation_round,
        "parent_bundle_id":        parent_bundle_id,
        "vendor_certificate":      vendor_cert_pem,
        "vendor_public_key":       extract_public_key_from_cert(vendor_cert_pem),
        "auditor_certificate":     auditor_cert_pem,
        "ephemeral_public_key":    encrypted["ephemeral_public_key_pem"],
        "encrypted_payload":       encrypted["ciphertext_hex"],
        "aes_iv":                  encrypted["iv_hex"],
        "aes_auth_tag":            encrypted["auth_tag_hex"],
        "hkdf_salt":               encrypted["hkdf_salt_hex"],
        "merkle_root":             merkle_root,
        "merkle_tree":             merkle["tree"],
        "merkle_leaves":           merkle["leaves"],
        "merkle_answers_snapshot": answers,  
        "ecdsa_signature":         ecdsa_signature,
        "rfc3161_timestamp_token": timestamp_token,
        "evidence_files":          processed_evidence,
        "created_at":              datetime.now(timezone.utc).isoformat(),
    }

    # 8. Log the event
    if db:
        append_log(db, "tessera_assembled", target_id=bundle_id,
                   details={"questionnaire_id": questionnaire_id,
                            "remediation_round": remediation_round})

    return tessera
