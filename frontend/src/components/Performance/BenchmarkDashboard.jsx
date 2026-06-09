import { useState, useEffect } from 'react'
import api from '../../lib/api'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

function Card({ children, className = '' }) {
  return <div className={`bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800 ${className}`}>{children}</div>
}

const BLUE = '#2563eb', SLATE = '#94a3b8', GREEN = '#059669', VIOLET = '#7c3aed', AMBER = '#d97706'

export default function BenchmarkDashboard() {
  const [data, setData] = useState(null)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { load() }, [])
  const load = async () => {
    try { const { data } = await api.get('/performance/results'); setData(data?.message ? null : data) }
    catch { setData(null) }
  }

  const run = async () => {
    setRunning(true); setErr('')
    try {
      await api.post('/performance/run')
      setTimeout(async () => { await load(); setRunning(false) }, 62000)
    } catch (e) { setErr('Failed to start benchmark.'); setRunning(false) }
  }

  if (!data) return (
    <Card className="p-8 text-center max-w-md">
      <p className="text-[13px] text-gray-500 dark:text-neutral-400 mb-3">
        {running ? 'Running benchmarks — this takes ~60 seconds...' : 'No benchmark results yet.'}
      </p>
      {err && <p className="text-[12px] text-red-600 mb-3">{err}</p>}
      <button onClick={run} disabled={running}
        className="text-[12.5px] font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50">
        {running ? 'Running...' : 'Run benchmarks'}
      </button>
    </Card>
  )

  const ecc = data.ecc_vs_rsa
  const arg = data.argon2_vs_pbkdf2
  const merk = data.merkle_scaling || []
  const hyb = data.hybrid_vs_naive
  const pfs = data.pfs_overhead

  // Derived verdict numbers
  const keygenFaster = ecc ? Math.round(ecc.rsa.keygen_ms / ecc.ecc.keygen_ms) : 0
  const signFaster   = ecc ? Math.round(ecc.rsa.sign_ms / ecc.ecc.sign_ms) : 0
  const keySmaller   = ecc ? (ecc.rsa.key_size_bytes / ecc.ecc.key_size_bytes).toFixed(1) : 0
  const argFaster    = arg ? (arg.pbkdf2.avg_ms / arg.argon2id.avg_ms).toFixed(1) : 0
  const argMem       = arg ? Math.round(arg.argon2id.memory_kb / arg.pbkdf2.memory_kb) : 0

  const eccData = ecc ? [
    { op:'Key gen', ECC: ecc.ecc.keygen_ms, RSA: ecc.rsa.keygen_ms },
    { op:'Sign',    ECC: ecc.ecc.sign_ms,   RSA: ecc.rsa.sign_ms },
    { op:'Verify',  ECC: ecc.ecc.verify_ms, RSA: ecc.rsa.verify_ms },
  ] : []

  const argData = arg ? [
    { name:'Argon2id', ms: arg.argon2id.avg_ms },
    { name:'PBKDF2',   ms: arg.pbkdf2.avg_ms },
  ] : []

  return (
    <div className="space-y-5">
      {/* Verdict cards */}
      <div className="grid grid-cols-4 gap-3">
        <VerdictCard value={`${signFaster}×`} label="ECC signs faster than RSA" accent="text-blue-600" />
        <VerdictCard value={`${keySmaller}×`} label="Smaller ECC key size" accent="text-violet-600" />
        <VerdictCard value={`${argMem.toLocaleString()}×`} label="More memory to crack Argon2id" accent="text-emerald-600" />
        <VerdictCard value={`${(merk[merk.length-1]?.build_ms ?? 0).toFixed(2)}ms`} label="Merkle build for 100 answers" accent="text-amber-600" />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11.5px] text-gray-400">Generated {new Date(data.generated_at).toLocaleString()}</p>
        <button onClick={run} disabled={running}
          className="text-[12px] font-medium border border-gray-200 dark:border-neutral-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-50">
          {running ? 'Running...' : 'Re-run benchmarks'}
        </button>
      </div>

      {/* ECC vs RSA */}
      {ecc && (
        <Card className="p-5">
          <h3 className="text-[13.5px] font-semibold text-gray-900 dark:text-white mb-0.5">ECC P-256 vs RSA-2048 — operation time</h3>
          <p className="text-[12px] text-gray-500 dark:text-neutral-400 mb-4">Lower is better. RSA key generation is dramatically slower; ECC keys are also far smaller ({ecc.ecc.key_size_bytes}B vs {ecc.rsa.key_size_bytes}B).</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={eccData} barGap={6}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false}/>
              <XAxis dataKey="op" tick={{ fontSize: 12, fill:'#6b7280' }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fontSize: 11, fill:'#9ca3af' }} axisLine={false} tickLine={false} unit="ms"/>
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border:'1px solid #e5e7eb' }} formatter={v => `${v} ms`}/>
              <Bar dataKey="ECC" fill={BLUE} radius={[4,4,0,0]} maxBarSize={48}/>
              <Bar dataKey="RSA" fill={SLATE} radius={[4,4,0,0]} maxBarSize={48}/>
            </BarChart>
          </ResponsiveContainer>
          <Takeaway>ECC generates keys ~{keygenFaster}× faster and signs ~{signFaster}× faster than RSA, with keys {keySmaller}× smaller. RSA verifies marginally faster, but every other operation favors ECC decisively.</Takeaway>
        </Card>
      )}

      {/* Argon2id vs PBKDF2 */}
      {arg && (
        <Card className="p-5">
          <h3 className="text-[13.5px] font-semibold text-gray-900 dark:text-white mb-0.5">Argon2id vs PBKDF2 — key derivation</h3>
          <p className="text-[12px] text-gray-500 dark:text-neutral-400 mb-4">Argon2id deliberately requires {(arg.argon2id.memory_kb/1024).toFixed(0)}MB of memory per attempt vs PBKDF2's ~{arg.pbkdf2.memory_kb}KB, crippling GPU brute-force.</p>
          <div className="grid grid-cols-2 gap-5">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={argData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false}/>
                <XAxis dataKey="name" tick={{ fontSize: 12, fill:'#6b7280' }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fontSize: 11, fill:'#9ca3af' }} axisLine={false} tickLine={false} unit="ms"/>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={v => `${v} ms`}/>
                <Bar dataKey="ms" radius={[4,4,0,0]} maxBarSize={60}>
                  <Cell fill={GREEN}/><Cell fill={SLATE}/>
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="flex flex-col justify-center gap-3">
              <MemoryStat label="Argon2id memory cost" value={`${(arg.argon2id.memory_kb/1024).toFixed(0)} MB`} pct={100} color="bg-emerald-500"/>
              <MemoryStat label="PBKDF2 memory cost" value={`~${arg.pbkdf2.memory_kb} KB`} pct={2} color="bg-slate-400"/>
            </div>
          </div>
          <Takeaway>A GPU with 8GB VRAM can run only ~125 Argon2id attempts in parallel because each needs {(arg.argon2id.memory_kb/1024).toFixed(0)}MB, versus millions per second for PBKDF2. That's the entire point of a memory-hard KDF.</Takeaway>
        </Card>
      )}

      {/* Merkle scaling */}
      {merk.length > 0 && (
        <Card className="p-5">
          <h3 className="text-[13.5px] font-semibold text-gray-900 dark:text-white mb-0.5">Merkle tree scaling</h3>
          <p className="text-[12px] text-gray-500 dark:text-neutral-400 mb-4">Build and proof-verification time as the number of answers grows. Tree depth grows logarithmically.</p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={merk}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false}/>
              <XAxis dataKey="answer_count" tick={{ fontSize: 11, fill:'#6b7280' }} axisLine={false} tickLine={false} label={{ value:'answers', position:'insideBottom', offset:-2, fontSize:11, fill:'#9ca3af' }}/>
              <YAxis tick={{ fontSize: 11, fill:'#9ca3af' }} axisLine={false} tickLine={false} unit="ms"/>
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={v => `${v} ms`}/>
              <Line type="monotone" dataKey="build_ms" name="Build" stroke={BLUE} strokeWidth={2.5} dot={{ r:3 }}/>
              <Line type="monotone" dataKey="proof_ms" name="Proof verify" stroke={VIOLET} strokeWidth={2.5} dot={{ r:3 }}/>
            </LineChart>
          </ResponsiveContainer>
          <Takeaway>Even at 100 answers the entire tree builds in well under a millisecond, and verifying any single answer's proof is effectively instant. Per-answer tamper detection adds no meaningful overhead.</Takeaway>
        </Card>
      )}

      {/* Hybrid + PFS */}
      <div className="grid grid-cols-2 gap-3">
        {hyb && (
          <Card className="p-5">
            <h3 className="text-[13.5px] font-semibold text-gray-900 dark:text-white mb-1">Hybrid encryption</h3>
            <div className="text-2xl font-semibold text-gray-900 dark:text-white mb-1">{hyb.hybrid_avg_ms} ms</div>
            <p className="text-[12px] text-gray-500 dark:text-neutral-400">to encrypt a {hyb.payload_size_bytes}-byte payload. Pure asymmetric encryption can't handle payloads beyond ~32 bytes — hybrid AES+ECC is the only practical option.</p>
          </Card>
        )}
        {pfs && (
          <Card className="p-5">
            <h3 className="text-[13.5px] font-semibold text-gray-900 dark:text-white mb-1">Forward secrecy overhead</h3>
            <div className="text-2xl font-semibold text-gray-900 dark:text-white mb-1">{pfs.pfs_avg_ms} ms</div>
            <p className="text-[12px] text-gray-500 dark:text-neutral-400">per session for ephemeral ECDH + HKDF. That tiny cost makes every past session permanently unrecoverable if a long-term key is later stolen.</p>
          </Card>
        )}
      </div>
    </div>
  )
}

function VerdictCard({ value, label, accent }) {
  return (
    <div className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800 p-4">
      <div className={`text-2xl font-semibold tracking-tight ${accent}`}>{value}</div>
      <div className="text-[11.5px] text-gray-500 dark:text-neutral-400 mt-1 leading-snug">{label}</div>
    </div>
  )
}

function Takeaway({ children }) {
  return (
    <div className="mt-4 flex gap-2.5 bg-blue-50/60 dark:bg-blue-500/5 border border-blue-100 dark:border-blue-500/15 rounded-lg px-3.5 py-2.5">
      <span className="text-blue-600 text-[13px] font-bold flex-shrink-0">→</span>
      <p className="text-[12px] text-gray-600 dark:text-neutral-300 leading-relaxed">{children}</p>
    </div>
  )
}

function MemoryStat({ label, value, pct, color }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11.5px] text-gray-600 dark:text-neutral-400">{label}</span>
        <span className="text-[11.5px] font-semibold text-gray-900 dark:text-white">{value}</span>
      </div>
      <div className="h-2 bg-gray-100 dark:bg-neutral-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.max(pct, 3)}%` }}/>
      </div>
    </div>
  )
}
