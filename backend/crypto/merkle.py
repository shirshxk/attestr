"""
crypto/merkle.py — Merkle Tree construction and proof generation

A Merkle Tree is a binary tree where:
  - Each LEAF is the SHA-256 hash of one answer
  - Each INTERNAL NODE is the SHA-256 hash of its two children concatenated
  - The ROOT is a single hash that represents the entire answer set

Why this matters for Attestr:
  - DocuSign signs the whole document as one blob → you know SOMETHING changed
  - Attestr signs the Merkle Root → you can prove WHICH SPECIFIC ANSWER changed
  - Each answer has an independent proof path that can be verified without
    revealing any other answers (selective disclosure)

This implementation is ~80 lines of pure Python, fully explainable to a panel.
No external libraries — just hashlib.
"""

import hashlib
import json
from typing import Any


# ── Core hashing ──────────────────────────────────────────────────────────────

def sha256(data: bytes) -> str:
    """Return the SHA-256 hex digest of bytes."""
    return hashlib.sha256(data).hexdigest()


def hash_leaf(answer: dict) -> str:
    """
    Hash a single answer dict into a Merkle leaf.

    The answer is JSON-serialized with sorted keys to ensure
    byte-for-byte consistency regardless of key insertion order.
    Any change to any field produces a completely different hash.
    """
    canonical = json.dumps(answer, sort_keys=True, separators=(',', ':')).encode()
    return sha256(canonical)


def hash_pair(left: str, right: str) -> str:
    """
    Hash two child nodes into their parent.
    Concatenate hex strings then hash.
    """
    combined = (left + right).encode()
    return sha256(combined)


# ── Tree construction ─────────────────────────────────────────────────────────

def build_tree(leaves: list[str]) -> list[list[str]]:
    """
    Build a Merkle Tree from a list of leaf hashes.

    Returns a list of levels, from leaves (level 0) up to root (last level).
    Each level is a list of hex hash strings.

    If the number of nodes at any level is odd, the last node is duplicated
    to make it even (standard Merkle Tree convention).

    Example with 4 leaves [A, B, C, D]:
      Level 0 (leaves): [H(A), H(B), H(C), H(D)]
      Level 1:          [H(H(A)+H(B)), H(H(C)+H(D))]
      Level 2 (root):   [H(level1[0]+level1[1])]
    """
    if not leaves:
        raise ValueError("Cannot build Merkle Tree with no leaves")

    levels = [leaves[:]]  # start with a copy of leaves

    current_level = leaves[:]
    while len(current_level) > 1:
        next_level = []
        # Pad to even length if needed
        if len(current_level) % 2 == 1:
            current_level.append(current_level[-1])
        # Hash pairs
        for i in range(0, len(current_level), 2):
            parent = hash_pair(current_level[i], current_level[i + 1])
            next_level.append(parent)
        levels.append(next_level)
        current_level = next_level

    return levels


def get_root(levels: list[list[str]]) -> str:
    """Return the Merkle Root (top of the tree)."""
    return levels[-1][0]


# ── Proof generation ──────────────────────────────────────────────────────────

def generate_proof(levels: list[list[str]], leaf_index: int) -> list[dict]:
    """
    Generate a Merkle proof for the leaf at leaf_index.

    A proof is the list of sibling hashes needed to recompute the root
    from this one leaf. The verifier doesn't need any other answers.

    Returns a list of {"hash": str, "position": "left"|"right"} dicts.
    "position" tells the verifier which side the sibling is on.
    """
    proof = []
    index = leaf_index

    for level in levels[:-1]:  # all levels except the root
        # Pad level if odd
        padded = level[:]
        if len(padded) % 2 == 1:
            padded.append(padded[-1])

        # Is our node on the left or right of its pair?
        if index % 2 == 0:
            # We are on the left — sibling is on the right
            sibling_index = index + 1
            sibling_pos   = "right"
        else:
            # We are on the right — sibling is on the left
            sibling_index = index - 1
            sibling_pos   = "left"

        proof.append({
            "hash":     padded[sibling_index],
            "position": sibling_pos,
        })
        index = index // 2  # move up to parent level

    return proof


def verify_proof(
    leaf_hash: str,
    proof: list[dict],
    expected_root: str,
) -> bool:
    """
    Verify a Merkle proof for a single leaf.

    Starting from the leaf hash, apply each sibling in the proof
    to recompute the path up to the root. If the computed root
    matches expected_root, the leaf is valid and untampered.

    Args:
        leaf_hash:     SHA-256 hash of the answer being verified
        proof:         list of sibling hashes from generate_proof()
        expected_root: the Merkle Root from the signed Tessera

    Returns:
        True if the leaf is part of the tree with expected_root
    """
    current = leaf_hash

    for step in proof:
        if step["position"] == "right":
            current = hash_pair(current, step["hash"])
        else:
            current = hash_pair(step["hash"], current)

    return current == expected_root


# ── Full verification with tamper detection ───────────────────────────────────

def verify_all_answers(
    answers: list[dict],
    stored_tree: list[list[str]],
    merkle_root: str,
) -> dict:
    """
    Verify every answer in a submission against the stored Merkle Tree.

    Returns:
        {
            "valid": bool,
            "results": [
                {
                    "index":       int,
                    "question_id": str,
                    "valid":       bool,
                    "computed_hash": str,
                    "stored_hash":   str,
                }
            ],
            "failed_indices": [int]  — which answers failed
        }

    Any answer whose hash doesn't match its stored leaf is flagged.
    This is what drives the red-node visualization in the frontend.
    """
    results = []
    failed  = []

    leaves = stored_tree[0]  # leaf level

    for i, answer in enumerate(answers):
        computed_hash = hash_leaf(answer)
        stored_hash   = leaves[i] if i < len(leaves) else None

        # Verify using proof path
        proof = generate_proof(stored_tree, i)
        proof_valid = verify_proof(computed_hash, proof, merkle_root)

        is_valid = (computed_hash == stored_hash) and proof_valid

        results.append({
            "index":         i,
            "question_id":   answer.get("question_id", str(i)),
            "valid":         is_valid,
            "computed_hash": computed_hash,
            "stored_hash":   stored_hash,
        })

        if not is_valid:
            failed.append(i)

    return {
        "valid":          len(failed) == 0,
        "results":        results,
        "failed_indices": failed,
        "merkle_root":    merkle_root,
    }


# ── High-level API ────────────────────────────────────────────────────────────

def build_merkle_for_answers(answers: list[dict]) -> dict:
    """
    Hash all answers, build the Merkle Tree, and return everything needed
    for signing and bundle assembly.

    Returns:
        {
            "leaves":      [sha256 hex per answer],
            "tree":        [[level0 hashes], [level1 hashes], ..., [root]],
            "root":        str  (the Merkle Root to be ECDSA-signed),
            "proofs":      [{proof path per answer}],
        }
    """
    leaves = [hash_leaf(answer) for answer in answers]
    tree   = build_tree(leaves)
    root   = get_root(tree)
    proofs = [generate_proof(tree, i) for i in range(len(answers))]

    return {
        "leaves": leaves,
        "tree":   tree,
        "root":   root,
        "proofs": proofs,
    }
