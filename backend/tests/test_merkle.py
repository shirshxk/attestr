"""
tests/test_merkle.py — Merkle Tree tests

These tests verify the core tamper-detection guarantee:
  Any change to any answer — even one character — must fail verification.
"""

import pytest
from crypto.merkle import (
    hash_leaf, build_tree, get_root,
    generate_proof, verify_proof,
    build_merkle_for_answers, verify_all_answers,
)

# Sample answers matching the Attestr Answer Schema
ANSWERS = [
    {"question_id": "cc6.1", "question_text": "Do you enforce MFA?",
     "answer_value": "Yes", "answer_type": "boolean",
     "evidence_note": "Via Okta", "answered_at": "2026-06-01T10:00:00Z"},
    {"question_id": "cc6.2", "question_text": "Do you encrypt data at rest?",
     "answer_value": "Yes", "answer_type": "boolean",
     "evidence_note": "AES-256", "answered_at": "2026-06-01T10:01:00Z"},
    {"question_id": "cc6.3", "question_text": "Patch cadence?",
     "answer_value": "Monthly", "answer_type": "free_text",
     "evidence_note": "", "answered_at": "2026-06-01T10:02:00Z"},
    {"question_id": "cc6.4", "question_text": "Do you have a WAF?",
     "answer_value": "No", "answer_type": "boolean",
     "evidence_note": "", "answered_at": "2026-06-01T10:03:00Z"},
]


def test_leaf_hash_deterministic():
    """Same answer always produces the same hash."""
    h1 = hash_leaf(ANSWERS[0])
    h2 = hash_leaf(ANSWERS[0])
    assert h1 == h2


def test_leaf_hash_sensitive_to_change():
    """Changing even one character changes the hash completely."""
    original = hash_leaf(ANSWERS[0])
    modified = ANSWERS[0].copy()
    modified["answer_value"] = "No"  # changed from "Yes" to "No"
    changed = hash_leaf(modified)
    assert original != changed


def test_build_tree_and_root():
    """Tree builds correctly and returns a consistent root."""
    result = build_merkle_for_answers(ANSWERS)
    assert result["root"] is not None
    assert len(result["root"]) == 64  # SHA-256 hex = 64 chars
    assert len(result["leaves"]) == len(ANSWERS)


def test_proof_verification():
    """Every answer's proof path verifies against the root."""
    result = build_merkle_for_answers(ANSWERS)
    root   = result["root"]
    leaves = result["leaves"]
    tree   = result["tree"]

    for i, leaf in enumerate(leaves):
        proof = generate_proof(tree, i)
        assert verify_proof(leaf, proof, root), f"Proof failed for answer {i}"


def test_tamper_detection_single_answer():
    """
    THE CORE TEST: Tampering with one answer must fail verification.
    This is the showstopper demo moment.
    """
    result = build_merkle_for_answers(ANSWERS)
    root   = result["root"]
    tree   = result["tree"]

    # Tamper with answer index 2 (change "Monthly" to "Weekly")
    tampered_answers = [a.copy() for a in ANSWERS]
    tampered_answers[2]["answer_value"] = "Weekly"

    verification = verify_all_answers(tampered_answers, tree, root)

    assert verification["valid"] is False
    assert 2 in verification["failed_indices"]
    # Other answers should still pass
    assert 0 not in verification["failed_indices"]
    assert 1 not in verification["failed_indices"]
    assert 3 not in verification["failed_indices"]


def test_tamper_detection_all_pass():
    """Untampered answers all verify successfully."""
    result = build_merkle_for_answers(ANSWERS)
    verification = verify_all_answers(ANSWERS, result["tree"], result["root"])
    assert verification["valid"] is True
    assert verification["failed_indices"] == []


def test_root_changes_when_any_answer_changes():
    """Any change to any answer must change the Merkle Root."""
    original_root = build_merkle_for_answers(ANSWERS)["root"]

    for i in range(len(ANSWERS)):
        modified = [a.copy() for a in ANSWERS]
        modified[i]["answer_value"] = "TAMPERED"
        new_root = build_merkle_for_answers(modified)["root"]
        assert original_root != new_root, f"Root unchanged when answer {i} was tampered"


def test_single_answer():
    """Tree works correctly with just one answer."""
    single = [ANSWERS[0]]
    result = build_merkle_for_answers(single)
    assert result["root"] == result["leaves"][0]


def test_odd_number_of_answers():
    """Tree handles odd number of answers (last leaf is duplicated)."""
    three_answers = ANSWERS[:3]
    result = build_merkle_for_answers(three_answers)
    assert result["root"] is not None
    # Verify all proofs still work
    for i, leaf in enumerate(result["leaves"]):
        proof = generate_proof(result["tree"], i)
        assert verify_proof(leaf, proof, result["root"])
