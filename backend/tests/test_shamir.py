"""
tests/test_shamir.py — Shamir's Secret Sharing tests
"""

import pytest
from keystore.shamir import split_secret, combine_shares, split_ca_key, reconstruct_ca_key


SECRET = b"this is the CA master private key bytes for testing purposes only!!"


def test_split_and_reconstruct_exact_threshold():
    """Exactly k shares reconstruct the secret perfectly."""
    shares = split_secret(SECRET, n=5, k=3)
    assert len(shares) == 5

    result = combine_shares(shares[:3])
    assert result == SECRET


def test_split_and_reconstruct_all_shares():
    """All n shares also reconstruct correctly."""
    shares = split_secret(SECRET, n=5, k=3)
    result = combine_shares(shares)
    assert result == SECRET


def test_different_share_subsets_reconstruct():
    """Any k shares (not just first k) reconstruct the secret."""
    shares = split_secret(SECRET, n=5, k=3)
    assert combine_shares([shares[0], shares[2], shares[4]]) == SECRET
    assert combine_shares([shares[1], shares[3], shares[4]]) == SECRET


def test_insufficient_shares_wrong_result():
    """Fewer than k shares must NOT reconstruct the secret."""
    shares = split_secret(SECRET, n=5, k=3)
    result = combine_shares(shares[:2])
    assert result != SECRET


def test_pem_roundtrip():
    """Split and reconstruct a PEM string end to end."""
    pem = "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49fake==\n-----END PRIVATE KEY-----\n"
    shares = split_ca_key(pem, n=5, k=3)
    assert len(shares) == 5
    reconstructed = reconstruct_ca_key(shares[:3])
    assert reconstructed == pem


def test_zero_information_leakage():
    """k-1 shares must not equal the secret."""
    shares = split_secret(SECRET, n=5, k=3)
    result = combine_shares(shares[:2])
    assert result != SECRET
