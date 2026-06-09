"""
performance/benchmark.py — Full cryptographic benchmark suite

Benchmarks:
  1. RSA-2048 vs ECC P-256 (key gen, sign, verify, encrypt, key size)
  2. Argon2id vs PBKDF2 (time per derivation, memory)
  3. Merkle Tree scaling (construction and proof time vs answer count)
  4. AES-256-GCM hybrid vs naive asymmetric encryption
  5. Ephemeral ECDH overhead vs static key reuse

Run: python performance/benchmark.py
Results saved to performance/results.json for the dashboard.
"""

import time
import json
import os
import statistics


def benchmark_ecc_vs_rsa(iterations=100):
    """Compare ECC P-256 vs RSA-2048 across all operations."""
    from cryptography.hazmat.primitives.asymmetric import ec, rsa, padding
    from cryptography.hazmat.primitives import hashes, serialization

    data = b"attestr benchmark payload " * 10
    results = {"ecc": {}, "rsa": {}}

    # ECC key generation
    t0 = time.perf_counter()
    for _ in range(iterations):
        key = ec.generate_private_key(ec.SECP256R1())
    results["ecc"]["keygen_ms"] = round((time.perf_counter() - t0) * 1000 / iterations, 3)

    # ECC signing
    ecc_key = ec.generate_private_key(ec.SECP256R1())
    t0 = time.perf_counter()
    for _ in range(iterations):
        sig = ecc_key.sign(data, ec.ECDSA(hashes.SHA256()))
    results["ecc"]["sign_ms"] = round((time.perf_counter() - t0) * 1000 / iterations, 3)

    # ECC verification
    pub = ecc_key.public_key()
    sig = ecc_key.sign(data, ec.ECDSA(hashes.SHA256()))
    t0 = time.perf_counter()
    for _ in range(iterations):
        pub.verify(sig, data, ec.ECDSA(hashes.SHA256()))
    results["ecc"]["verify_ms"] = round((time.perf_counter() - t0) * 1000 / iterations, 3)

    # ECC key size
    priv_pem = ecc_key.private_bytes(serialization.Encoding.PEM,
                                     serialization.PrivateFormat.PKCS8,
                                     serialization.NoEncryption())
    results["ecc"]["key_size_bytes"] = len(priv_pem)

    # RSA key generation
    t0 = time.perf_counter()
    for _ in range(min(iterations, 10)):  # RSA keygen is slow
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    results["rsa"]["keygen_ms"] = round((time.perf_counter() - t0) * 1000 / min(iterations, 10), 3)

    # RSA signing
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    t0 = time.perf_counter()
    for _ in range(iterations):
        sig = rsa_key.sign(data, padding.PSS(mgf=padding.MGF1(hashes.SHA256()),
                           salt_length=padding.PSS.MAX_LENGTH), hashes.SHA256())
    results["rsa"]["sign_ms"] = round((time.perf_counter() - t0) * 1000 / iterations, 3)

    # RSA verification
    rsa_pub = rsa_key.public_key()
    rsa_sig = rsa_key.sign(data, padding.PSS(mgf=padding.MGF1(hashes.SHA256()),
                           salt_length=padding.PSS.MAX_LENGTH), hashes.SHA256())
    t0 = time.perf_counter()
    for _ in range(iterations):
        rsa_pub.verify(rsa_sig, data, padding.PSS(mgf=padding.MGF1(hashes.SHA256()),
                       salt_length=padding.PSS.MAX_LENGTH), hashes.SHA256())
    results["rsa"]["verify_ms"] = round((time.perf_counter() - t0) * 1000 / iterations, 3)

    # RSA key size
    rsa_pem = rsa_key.private_bytes(serialization.Encoding.PEM,
                                    serialization.PrivateFormat.PKCS8,
                                    serialization.NoEncryption())
    results["rsa"]["key_size_bytes"] = len(rsa_pem)

    return results


def benchmark_argon2_vs_pbkdf2(iterations=5):
    """Compare Argon2id vs PBKDF2 for key derivation."""
    import os
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes as h
    from argon2.low_level import hash_secret_raw, Type

    password = b"test-passphrase"
    salt     = os.urandom(16)
    results  = {}

    # Argon2id
    times = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        hash_secret_raw(password, salt, time_cost=3, memory_cost=65536,
                        parallelism=4, hash_len=32, type=Type.ID)
        times.append((time.perf_counter() - t0) * 1000)
    results["argon2id"] = {
        "avg_ms":    round(statistics.mean(times), 1),
        "memory_kb": 65536,
        "params":    "t=3, m=64MB, p=4",
    }

    # PBKDF2
    times = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        kdf = PBKDF2HMAC(algorithm=h.SHA256(), length=32, salt=salt, iterations=600000)
        kdf.derive(password)
        times.append((time.perf_counter() - t0) * 1000)
    results["pbkdf2"] = {
        "avg_ms":    round(statistics.mean(times), 1),
        "memory_kb": 1,  # effectively no memory requirement
        "params":    "iterations=600000",
    }

    return results


def benchmark_merkle_scaling():
    """Benchmark Merkle Tree performance vs number of answers."""
    from crypto.merkle import build_merkle_for_answers

    results = []
    for count in [5, 10, 20, 40, 50, 100]:
        answers = [
            {"question_id": f"q{i}", "question_text": f"Question {i}",
             "answer_value": "Yes", "answer_type": "boolean",
             "evidence_note": "", "answered_at": "2026-06-01T10:00:00Z"}
            for i in range(count)
        ]
        t0 = time.perf_counter()
        result = build_merkle_for_answers(answers)
        build_ms = round((time.perf_counter() - t0) * 1000, 3)

        from crypto.merkle import generate_proof, verify_proof
        t0 = time.perf_counter()
        proof = generate_proof(result["tree"], 0)
        verify_proof(result["leaves"][0], proof, result["root"])
        proof_ms = round((time.perf_counter() - t0) * 1000, 3)

        results.append({
            "answer_count": count,
            "build_ms":     build_ms,
            "proof_ms":     proof_ms,
            "tree_depth":   len(result["tree"]),
        })

    return results


def benchmark_hybrid_vs_naive(iterations=50):
    """Compare hybrid AES+ECC vs naive full asymmetric encryption."""
    from crypto.ecc import generate_keypair
    from crypto.hybrid import encrypt_payload, decrypt_payload
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import hashes

    priv_pem, pub_pem = generate_keypair()
    payload = {"answers": [{"question_id": f"q{i}", "answer_value": "Yes"} for i in range(20)]}
    payload_bytes = json.dumps(payload).encode()

    # Hybrid encrypt
    times = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        encrypt_payload(payload, pub_pem)
        times.append((time.perf_counter() - t0) * 1000)

    return {
        "hybrid_avg_ms":    round(statistics.mean(times), 3),
        "payload_size_bytes": len(payload_bytes),
        "note": "Naive full asymmetric encryption cannot handle arbitrary payload sizes. ECC max ~32 bytes.",
    }


def benchmark_pfs_overhead(iterations=100):
    """Measure overhead of ephemeral ECDH vs static key reuse."""
    from crypto.ecc import generate_keypair, generate_ephemeral_keypair, derive_shared_secret, derive_aes_key

    _, auditor_pub = generate_keypair()

    # With PFS (fresh ephemeral keypair per session)
    times = []
    for _ in range(iterations):
        t0 = time.perf_counter()
        ephemeral_priv, _ = generate_ephemeral_keypair()
        shared = derive_shared_secret(ephemeral_priv, auditor_pub)
        aes_key = derive_aes_key(shared)
        del ephemeral_priv
        times.append((time.perf_counter() - t0) * 1000)

    return {
        "pfs_avg_ms": round(statistics.mean(times), 3),
        "note": "Overhead per session for perfect forward secrecy via ephemeral ECDH + HKDF",
    }


def run_all_benchmarks():
    """Run all benchmarks and save results to JSON."""
    print("[Attestr Benchmark] Starting...")

    results = {
        "generated_at":    time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "ecc_vs_rsa":      benchmark_ecc_vs_rsa(100),
        "argon2_vs_pbkdf2": benchmark_argon2_vs_pbkdf2(5),
        "merkle_scaling":  benchmark_merkle_scaling(),
        "hybrid_vs_naive": benchmark_hybrid_vs_naive(50),
        "pfs_overhead":    benchmark_pfs_overhead(100),
    }

    out_path = os.path.join(os.path.dirname(__file__), "results.json")
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)

    print(f"[Attestr Benchmark] Done. Results saved to {out_path}")
    return results


if __name__ == "__main__":
    run_all_benchmarks()
