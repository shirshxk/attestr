"""
keystore/shamir.py — Shamir's Secret Sharing (SSS)

Splits the CA master private key into N shares using Shamir's Secret Sharing.
Any K shares can reconstruct the secret. Any K-1 shares reveal zero information.

Implementation:
  - Polynomial arithmetic over GF(256) (Galois Field with 256 elements)
  - Each share is a (x, y) pair where y = P(x) for a random polynomial P
  - The secret is P(0) — the constant term of the polynomial
  - Reconstruction uses Lagrange interpolation

Why this matters:
  Without SSS, the CA private key is a single point of failure.
  With 3-of-5 SSS, an attacker needs to compromise 3 separate custodians.
  Even the CA Admin alone cannot forge certificates unilaterally.

Default scheme: 3-of-5 (need any 3 of 5 shares to reconstruct)
"""

import os
import secrets
import base64
from typing import List, Tuple


# ── GF(256) arithmetic ────────────────────────────────────────────────────────
# Using the irreducible polynomial x^8 + x^4 + x^3 + x + 1 (AES's field)

GF256_EXP = [0] * 512
GF256_LOG = [0] * 256

def _init_gf256():
    """
    Pre-compute exponential and logarithm tables for GF(256).

    Uses generator 3 (x+1). NOTE: 2 is NOT a generator of GF(256) under the
    AES polynomial 0x11b — its multiplicative order is only 51, which would
    leave most log-table entries unset and silently corrupt all field
    multiplication. 3 is a primitive element (order 255) and walks the whole
    field, so every nonzero element gets a correct logarithm.
    """
    x = 1
    for i in range(255):
        GF256_EXP[i] = x
        GF256_LOG[x] = i
        # multiply x by the generator 3 = (x + 1): (x << 1) ^ x
        x = (x << 1) ^ x
        if x & 0x100:
            x ^= 0x11b  # reduce modulo the irreducible polynomial
    for i in range(255, 512):
        GF256_EXP[i] = GF256_EXP[i - 255]

_init_gf256()


def _gf_mul(a: int, b: int) -> int:
    """Multiply two elements in GF(256)."""
    if a == 0 or b == 0:
        return 0
    return GF256_EXP[(GF256_LOG[a] + GF256_LOG[b]) % 255]


def _gf_div(a: int, b: int) -> int:
    """Divide two elements in GF(256)."""
    if b == 0:
        raise ZeroDivisionError("Division by zero in GF(256)")
    if a == 0:
        return 0
    return GF256_EXP[(GF256_LOG[a] - GF256_LOG[b] + 255) % 255]


def _gf_pow(a: int, b: int) -> int:
    """Raise a to the power b in GF(256)."""
    return GF256_EXP[(GF256_LOG[a] * b) % 255]


# ── Polynomial evaluation ─────────────────────────────────────────────────────

def _eval_polynomial(coefficients: List[int], x: int) -> int:
    """
    Evaluate a polynomial at x in GF(256).
    coefficients[0] is the secret (constant term).
    """
    result = 0
    for coeff in reversed(coefficients):
        result = _gf_mul(result, x) ^ coeff
    return result


# ── Split and combine ─────────────────────────────────────────────────────────

def split_secret(secret_bytes: bytes, n: int = 5, k: int = 3) -> List[Tuple[int, bytes]]:
    """
    Split a secret into N shares where any K can reconstruct it.

    Args:
        secret_bytes: the secret to split (e.g. CA private key bytes)
        n:            total number of shares to generate
        k:            minimum shares needed to reconstruct

    Returns:
        List of (x, y_bytes) tuples — one per share
        x is the share index (1..n), y_bytes is the share data

    Security property:
        Any k-1 shares reveal mathematically zero information about the secret.
    """
    if k > n:
        raise ValueError("Threshold k cannot exceed total shares n")
    if k < 2:
        raise ValueError("Threshold must be at least 2")

    shares = [[] for _ in range(n)]

    # Process each byte of the secret independently
    for byte in secret_bytes:
        # Generate k-1 random coefficients; secret is coefficient[0]
        coefficients = [byte] + [secrets.randbelow(256) for _ in range(k - 1)]

        # Evaluate the polynomial at x = 1, 2, ..., n
        for i in range(n):
            shares[i].append(_eval_polynomial(coefficients, i + 1))

    return [(i + 1, bytes(share)) for i, share in enumerate(shares)]


def combine_shares(shares: List[Tuple[int, bytes]]) -> bytes:
    """
    Reconstruct the secret from K or more shares using Lagrange interpolation.

    Args:
        shares: list of (x, y_bytes) tuples (at least k of them)

    Returns:
        Reconstructed secret bytes
    """
    if not shares:
        raise ValueError("No shares provided")

    secret_length = len(shares[0][1])
    secret = []

    for byte_idx in range(secret_length):
        # Extract the y value for this byte position from each share
        points = [(x, share[byte_idx]) for x, share in shares]

        # Lagrange interpolation to find P(0)
        secret_byte = 0
        for i, (xi, yi) in enumerate(points):
            numerator   = 1
            denominator = 1
            for j, (xj, _) in enumerate(points):
                if i != j:
                    numerator   = _gf_mul(numerator, xj)
                    denominator = _gf_mul(denominator, xi ^ xj)
            lagrange = _gf_mul(yi, _gf_div(numerator, denominator))
            secret_byte ^= lagrange

        secret.append(secret_byte)

    return bytes(secret)


# ── Encode/decode shares for storage ─────────────────────────────────────────

def encode_share(x: int, y_bytes: bytes) -> str:
    """Encode a share as a base64 string for safe storage/transport."""
    payload = bytes([x]) + y_bytes
    return base64.b64encode(payload).decode()


def decode_share(encoded: str) -> Tuple[int, bytes]:
    """Decode a base64 share back into (x, y_bytes)."""
    payload = base64.b64decode(encoded.encode())
    return payload[0], payload[1:]


# ── High-level API ────────────────────────────────────────────────────────────

def split_ca_key(private_key_pem: str, n: int = 5, k: int = 3) -> List[str]:
    """
    Split the CA private key PEM into N encoded shares.

    Returns:
        List of N base64-encoded share strings.
        Distribute one to each custodian. Store none together.
    """
    secret_bytes = private_key_pem.encode()
    raw_shares   = split_secret(secret_bytes, n=n, k=k)
    return [encode_share(x, y) for x, y in raw_shares]


def reconstruct_ca_key(encoded_shares: List[str]) -> str:
    """
    Reconstruct the CA private key from K or more encoded shares.

    Args:
        encoded_shares: list of base64 share strings from custodians

    Returns:
        Original private key PEM string
    """
    shares = [decode_share(s) for s in encoded_shares]
    secret_bytes = combine_shares(shares)
    return secret_bytes.decode()
