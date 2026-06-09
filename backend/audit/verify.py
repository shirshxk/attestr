"""
audit/verify.py — Full offline Tessera verification

Verifies a .tessera bundle without any server dependency.
All proof material is embedded inside the bundle itself.

Verification steps:
  1. Parse and validate bundle structure
  2. Verify vendor X.509 certificate (chain + expiry)
  3. Check certificate against CRL
  4. Verify ECDSA signature over Merkle Root
  5. Verify each individual answer's Merkle proof path
  6. Verify RFC 3161 timestamp token
"""

import json
from crypto.signing import verify_ecdsa_signature, extract_public_key_from_cert
from crypto.merkle import verify_all_answers
from ca.authority import ca
from ca.timestamp import tsa


def verify_tessera(bundle: dict, answers: list = None) -> dict:
    """
    Verify a complete Tessera bundle.

    Args:
        bundle:  the .tessera dict
        answers: decrypted answers list (required for Merkle verification)
                 If not provided, Merkle verification is skipped.

    Returns:
        {
            "overall_valid":   bool,
            "cert_valid":      bool,
            "crl_valid":       bool,
            "ecdsa_valid":     bool,
            "merkle_valid":    bool,
            "timestamp_valid": bool,
            "merkle_details":  dict,
            "cert_detail":     str,
            "timestamp_detail": str,
            "bundle_id":       str,
        }
    """
    result = {
        "overall_valid":    False,
        "cert_valid":       False,
        "crl_valid":        False,
        "ecdsa_valid":      False,
        "merkle_valid":     False,
        "timestamp_valid":  False,
        "merkle_details":   None,
        "cert_detail":      "",
        "timestamp_detail": "",
        "bundle_id":        bundle.get("bundle_id"),
    }

    # 1. Verify vendor certificate
    vendor_cert_pem = bundle.get("vendor_certificate")
    if not vendor_cert_pem:
        result["cert_detail"] = "No vendor certificate in bundle"
        return result

    cert_check = ca.verify_certificate(vendor_cert_pem)
    result["cert_valid"] = cert_check["valid"]
    result["cert_detail"] = cert_check.get("reason", "Certificate valid")

    if cert_check["valid"]:
        result["crl_valid"] = True  # CRL is checked inside verify_certificate

    # 2. Verify ECDSA signature
    vendor_public_key_pem = extract_public_key_from_cert(vendor_cert_pem)
    merkle_root   = bundle.get("merkle_root", "")
    ecdsa_sig     = bundle.get("ecdsa_signature", "")

    sig_check = verify_ecdsa_signature(merkle_root, ecdsa_sig, vendor_public_key_pem)
    result["ecdsa_valid"] = sig_check["valid"]

    # 3. Verify Merkle proofs (if answers provided)
    if answers is not None:
        merkle_tree = bundle.get("merkle_tree", [])
        if merkle_tree:
            merkle_check = verify_all_answers(answers, merkle_tree, merkle_root)
            result["merkle_valid"]   = merkle_check["valid"]
            result["merkle_details"] = {
                "tree":           merkle_tree,
                "results":        merkle_check["results"],
                "failed_indices": merkle_check["failed_indices"],
                "answers":        answers,
            }
        else:
            result["merkle_details"] = {"error": "No Merkle tree in bundle"}
    else:
        result["merkle_valid"] = True  # skip if no answers provided

    # 4. Verify RFC 3161 timestamp
    timestamp_token = bundle.get("rfc3161_timestamp_token")
    if timestamp_token:
        import hashlib
        expected_hash = hashlib.sha256(merkle_root.encode()).hexdigest()
        ca_cert_pem   = bundle.get("auditor_certificate", ca.ca_cert_pem)

        # Use CA public key for TSA verification
        from cryptography import x509
        from cryptography.hazmat.primitives import serialization
        ca_cert  = x509.load_pem_x509_certificate(ca.ca_cert_pem.encode())
        ca_pub   = ca_cert.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()

        ts_check = tsa.verify(timestamp_token, ca_pub, expected_hash)
        result["timestamp_valid"]  = ts_check["valid"]
        result["timestamp_detail"] = ts_check.get("timestamp", ts_check.get("reason", ""))
    else:
        result["timestamp_valid"]  = False
        result["timestamp_detail"] = "No timestamp token in bundle"

    # Overall
    result["overall_valid"] = all([
        result["cert_valid"],
        result["crl_valid"],
        result["ecdsa_valid"],
        result["merkle_valid"],
        result["timestamp_valid"],
    ])

    return result
