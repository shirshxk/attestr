"""
export/json_export.py — JSON export for GRC tool integration (Vanta, Drata, ServiceNow)
"""

import json
from datetime import datetime, timezone


def export_to_json(bundle: dict, answers: list, verification_result: dict,
                   auditor_name: str, vendor_name: str) -> str:
    """Export compliance data as structured JSON for GRC tool integration."""
    return json.dumps({
        "attestr_export_version": "1.0",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "bundle_id": bundle.get("bundle_id"),
        "remediation_round": bundle.get("remediation_round", 0),
        "auditor": auditor_name,
        "vendor": vendor_name,
        "verification": {
            "overall_valid":   verification_result.get("overall_valid"),
            "cert_valid":      verification_result.get("cert_valid"),
            "ecdsa_valid":     verification_result.get("ecdsa_valid"),
            "merkle_valid":    verification_result.get("merkle_valid"),
            "timestamp_valid": verification_result.get("timestamp_valid"),
            "timestamp":       verification_result.get("timestamp_detail"),
        },
        "answers": answers,
        "merkle_root": bundle.get("merkle_root"),
        "ecdsa_signature": bundle.get("ecdsa_signature"),
    }, indent=2)
