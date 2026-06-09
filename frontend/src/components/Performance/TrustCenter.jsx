import BenchmarkDashboard from './BenchmarkDashboard'

function Card({ children, className='' }) {
  return <div className={`bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800 ${className}`}>{children}</div>
}

const LAYERS = [
  { n:'L1', t:'mTLS + X.509 identity', d:'Every org authenticates with a certificate, not a password. Both sides verify before data flows.' },
  { n:'L2', t:'Ephemeral ECDH (PFS)', d:'Throwaway session keys are destroyed after use, so past submissions stay unrecoverable.' },
  { n:'L3', t:'Merkle tree + ECDSA', d:'Each answer is hashed into a leaf; the vendor signs the single root. Tamper one answer and its proof path breaks.' },
  { n:'L4', t:'AES-256-GCM hybrid', d:'Answers are encrypted end-to-end. The relay never sees plaintext.' },
  { n:'L5', t:'RFC 3161 timestamp', d:'A trusted clock countersigns the root hash, so nobody can backdate a submission.' },
  { n:'L6', t:'Argon2id keystore', d:'Private keys at rest are wrapped with a memory-hard KDF (64MB/derivation), defeating GPU brute force.' },
  { n:'L7', t:'Shamir secret sharing', d:'The CA master key is split 3-of-5. No single administrator can act alone.' },
  { n:'L8', t:'HMAC audit chain', d:'Every event is chained with HMAC; editing one entry breaks all entries after it.' },
]

export default function TrustCenter() {
  return (
    <div className="space-y-6">
      {/* Eight layers */}
      <div>
        <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-1">Eight cryptographic layers</h2>
        <p className="text-[12.5px] text-gray-500 dark:text-neutral-400 mb-4">Defeating any single layer does not compromise the system — defense in depth at the cryptographic level.</p>
        <div className="grid grid-cols-4 gap-3">
          {LAYERS.map(l => (
            <Card key={l.n} className="p-4">
              <div className="mono text-[10.5px] text-blue-600 dark:text-blue-400 font-medium mb-1.5">{l.n}</div>
              <div className="text-[12.5px] font-semibold text-gray-900 dark:text-white mb-1">{l.t}</div>
              <div className="text-[11.5px] text-gray-500 dark:text-neutral-400 leading-relaxed">{l.d}</div>
            </Card>
          ))}
        </div>
      </div>

      {/* Benchmarks */}
      <div>
        <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-1">Performance benchmarks</h2>
        <p className="text-[12.5px] text-gray-500 dark:text-neutral-400 mb-4">Empirical proof behind each cryptographic design decision.</p>
        <BenchmarkDashboard />
      </div>
    </div>
  )
}
