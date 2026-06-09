"""
keystore/argon2_kdf.py — Argon2id key derivation

Why Argon2id over PBKDF2:
  PBKDF2 is purely CPU-bound — a modern GPU can run millions of
  guesses per second against a stolen keystore file.

  Argon2id (winner of the Password Hashing Competition, 2015) requires
  a large block of RAM per attempt. With 64MB memory cost, a single
  guess needs 64MB of RAM. A GPU with 8GB VRAM can only run ~125 attempts
  in parallel instead of millions. ASIC attacks are similarly crippled.

  Parameters used:
    memory_cost  = 65536 KB (64 MB)
    time_cost    = 3 iterations
    parallelism  = 4 threads
    hash_length  = 32 bytes (AES-256 key)

Note on pyca/cryptography:
  pyca/cryptography does not expose Argon2id natively (it exposes Scrypt).
  We use the argon2-cffi library which is the standard Python binding for
  the reference Argon2 C implementation. This is the correct tool for the job.
  Install: pip install argon2-cffi (added to requirements.txt)
"""

import os
from argon2.low_level import hash_secret_raw, Type


def derive_key_argon2id(
    passphrase: str | bytes,
    salt: bytes,
    memory_cost: int = 65536,   # 64 MB
    time_cost: int = 3,
    parallelism: int = 4,
    key_length: int = 32,
) -> bytes:
    """
    Derive a key from a passphrase using Argon2id.

    Args:
        passphrase:   the user's passphrase
        salt:         random 16-byte salt (store alongside the ciphertext)
        memory_cost:  KB of RAM required per attempt (default 64MB)
        time_cost:    number of iterations
        parallelism:  number of parallel threads
        key_length:   output key length in bytes (32 = AES-256)

    Returns:
        key_length bytes suitable for AES-256-GCM
    """
    if isinstance(passphrase, str):
        passphrase = passphrase.encode()

    return hash_secret_raw(
        secret=passphrase,
        salt=salt,
        time_cost=time_cost,
        memory_cost=memory_cost,
        parallelism=parallelism,
        hash_len=key_length,
        type=Type.ID,   # Argon2id (hybrid of Argon2i + Argon2d)
    )


def generate_salt() -> bytes:
    """Generate a cryptographically random 16-byte salt."""
    return os.urandom(16)
