# Attestr Threat Model

## What Attestr Protects Against

| # | Attack | Defeated By |
|---|--------|-------------|
| 1 | MITM on questionnaire transmission | mTLS mutual cert auth + ephemeral ECDH encryption |
| 2 | Passive traffic recording for future decryption | PFS via ephemeral ECDH — session keys destroyed after each session |
| 3 | Vendor tampering with answers after signing | ECDSA over Merkle Root — any change invalidates the signature |
| 4 | Tampering with one specific answer | Merkle Tree — each answer's proof path is independent, UI shows exact failing node |
| 5 | Vendor denying they submitted specific answers | ECDSA non-repudiation — signature is mathematically bound to their private key |
| 6 | Swapping an evidence file attachment post-signing | Evidence file SHA-256 hash is a Merkle leaf — swapping breaks the root |
| 7 | Fabricating the submission timestamp | RFC 3161 cryptographic timestamp from independent TSA |
| 8 | Brute-forcing a stolen keystore file | Argon2id memory-hard KDF — GPU/ASIC attacks computationally infeasible |
| 9 | Single admin compromising the CA master key | Shamir Secret Sharing — requires threshold of custodians |
| 10 | Silently editing platform audit logs | HMAC chain — any modification breaks all subsequent entries |
| 11 | Impersonating an organization | X.509 certificates — cannot forge without CA private key |
| 12 | Intercepting draft answers on relay server | Client-side draft encryption — relay never sees plaintext |
| 13 | Unauthorized organization self-registering | Invite-only registration — CA Admin controls all access |

## What Attestr Does Not Protect Against

- A vendor who knowingly lies in their answers (Attestr proves what they said, not whether it's true)
- Compromise of the vendor's private key before signing
- Physical coercion of all Shamir share custodians simultaneously

## Defense in Depth

Attestr uses 8 independent cryptographic layers. Defeating any single layer does not compromise the system:

- Bypassing mTLS → ECDSA signature still proves vendor identity
- Stealing the relay server → only encrypted blobs, no plaintext
- Compromising the CA → Shamir requires threshold quorum
- Stealing a keystore → Argon2id makes brute force infeasible
- Tampering with answers → Merkle proof fails, detected immediately
- Backdating submission → RFC 3161 timestamp cannot be forged
