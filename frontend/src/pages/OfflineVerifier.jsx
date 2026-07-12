import Logo from '../components/Shared/Logo'
import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconArrowRight, IconCheck, IconX } from '../components/Layout/icons'

// ── Crypto helpers (browser-native SubtleCrypto), matching the backend exactly ──
// Backend: leaf  = SHA256( JSON.stringify(answer, sortedKeys, no-spaces) )
//          pair  = SHA256( leftHex + rightHex )  (UTF-8 string concat)
//          odd level duplicates its last node.

// ── SHA-256: use native Web Crypto on secure contexts, fall back to pure JS otherwise ──
// (Browsers only expose crypto.subtle on HTTPS or localhost — not on bare IP addresses.)

// Minimal, correct pure-JS SHA-256 (operates on a UTF-8 string, returns hex).
function sha256JS(ascii) {
  function rightRotate(v, a) { return (v >>> a) | (v << (32 - a)) }
  const mathPow = Math.pow
  const maxWord = mathPow(2, 32)
  let result = ''
  const words = []
  const asciiBitLength = ascii.length * 8

  let hash = sha256JS.h = sha256JS.h || []
  const k = sha256JS.k = sha256JS.k || []
  let primeCounter = k.length

  const isComposite = {}
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0
    }
  }
  hash = hash.slice(0, 8)

  ascii += '\x80'
  while (ascii.length % 64 - 56) ascii += '\x00'
  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i)
    if (j >> 8) return ''  // ascii only — caller pre-encodes UTF-8
    words[i >> 2] |= j << ((3 - i) % 4) * 8
  }
  words[words.length] = (asciiBitLength / maxWord) | 0
  words[words.length] = asciiBitLength

  for (let j = 0; j < words.length;) {
    const w = words.slice(j, j += 16)
    const oldHash = hash.slice(0)
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2]
      const a = hash[0], e = hash[4]
      const temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ (~e & hash[6]))
        + k[i]
        + (w[i] = i < 16 ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0)
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]))
      hash = [(temp1 + temp2) | 0].concat(hash)
      hash[4] = (hash[4] + temp1) | 0
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255
      result += ((b < 16) ? 0 : '') + b.toString(16)
    }
  }
  return result
}

// UTF-8 encode a string into a binary (latin1) string for sha256JS
function utf8Binary(str) {
  return unescape(encodeURIComponent(str))
}

async function sha256Hex(str) {
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
  }
  // Fallback for insecure contexts (bare IP, http)
  return sha256JS(utf8Binary(str))
}

// Canonical JSON with sorted keys, no spaces — mirrors Python json.dumps(sort_keys=True, separators=(',',':'))
// Python defaults to ensure_ascii=True, so non-ASCII chars are \uXXXX-escaped; we match that here.
function escapeAscii(s) {
  return s.replace(/[\u0080-\uffff]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
}
function canonical(obj) {
  if (obj === null || typeof obj !== 'object') return escapeAscii(JSON.stringify(obj))
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']'
  const keys = Object.keys(obj).sort()
  return '{' + keys.map(k => escapeAscii(JSON.stringify(k)) + ':' + canonical(obj[k])).join(',') + '}'
}

async function hashLeaf(answer) { return sha256Hex(canonical(answer)) }

// ── Client-side ECDSA (P-256) verification of the signed Merkle root ─────────
// The bundle embeds vendor_public_key (SPKI PEM) and a DER-encoded ECDSA
// signature over the UTF-8 bytes of the merkle_root hex string.
// Web Crypto needs: SPKI bytes for the key, and the signature as raw r||s.

function pemToBytes(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}

// Convert a DER ECDSA signature (SEQUENCE of two INTEGERs) to raw r||s (64 bytes for P-256)
function derToRaw(der) {
  let i = 0
  if (der[i++] !== 0x30) throw new Error('Bad DER: no sequence')
  if (der[i] & 0x80) i += (der[i] & 0x7f) + 1; else i++  // skip seq length
  const readInt = () => {
    if (der[i++] !== 0x02) throw new Error('Bad DER: no integer')
    let len = der[i++]
    if (len & 0x80) { const n = len & 0x7f; len = 0; for (let j = 0; j < n; j++) len = (len << 8) | der[i++] }
    let v = der.slice(i, i + len); i += len
    while (v.length > 32 && v[0] === 0) v = v.slice(1)   // strip leading zero pad
    if (v.length > 32) throw new Error('Integer too long for P-256')
    const out = new Uint8Array(32); out.set(v, 32 - v.length)
    return out
  }
  const r = readInt(), s = readInt()
  const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32)
  return raw
}

// Returns true/false, or null if ECDSA can't run here (no Web Crypto, missing fields)
async function verifyEcdsa(bundle) {
  try {
    if (!(typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.verify)) return null
    const pubPem = bundle.vendor_public_key
    const sigHex = bundle.ecdsa_signature
    const root   = bundle.merkle_root
    if (!pubPem || !sigHex || !root) return null
    const key = await crypto.subtle.importKey(
      'spki', pemToBytes(pubPem),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false, ['verify'],
    )
    const raw = derToRaw(hexToBytes(sigHex))
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key, raw, new TextEncoder().encode(root),
    )
  } catch (e) {
    console.warn('ECDSA verify error:', e)
    return null
  }
}

async function buildTree(leaves) {
  const levels = [leaves.slice()]
  let cur = leaves.slice()
  while (cur.length > 1) {
    if (cur.length % 2 === 1) cur.push(cur[cur.length - 1])
    const next = []
    for (let i = 0; i < cur.length; i += 2) next.push(await sha256Hex(cur[i] + cur[i + 1]))
    levels.push(next)
    cur = next
  }
  return levels
}

export default function OfflineVerifier({ embedded = false }) {
  const navigate = useNavigate()
  const fileRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [bundle, setBundle] = useState(null)
  const [filename, setFilename] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleFile = async (file) => {
    setError(''); setResult(null); setBundle(null)
    if (!file) return
    setFilename(file.name)
    try {
      const text = await file.text()
      const b = JSON.parse(text)
      setBundle(b)
      await verify(b)
    } catch (e) {
      setError('Could not parse this file. A .tessera is a JSON bundle exported from Attestr.')
    }
  }

  const verify = async (b) => {
    setBusy(true)
    try {
      const snapshot = b.merkle_answers_snapshot
      const signedRoot = b.merkle_root
      const embeddedLeaves = b.merkle_leaves || []

      if (!snapshot || !signedRoot) {
        setResult({ ok: false, reason: 'Bundle is missing the answer snapshot or signed root — cannot verify offline.' })
        return
      }

      // 1. Recompute each leaf from the answers in the file
      const recomputedLeaves = []
      for (const a of snapshot) recomputedLeaves.push(await hashLeaf(a))

      // 2. Compare against the embedded leaves, flag any per-answer mismatch
      const tampered = []
      recomputedLeaves.forEach((h, i) => {
        if (embeddedLeaves[i] && embeddedLeaves[i] !== h) tampered.push(i)
      })

      // 3. Rebuild the tree from our recomputed leaves and compare to the signed root
      const levels = await buildTree(recomputedLeaves)
      const computedRoot = levels[levels.length - 1][0]
      const rootMatches = computedRoot === signedRoot

      // 4. Authenticity: verify the vendor's ECDSA signature over the signed root,
      //    entirely in the browser (null = couldn't run, e.g. no Web Crypto)
      const ecdsaOk = await verifyEcdsa(b)

      setResult({
        ok: rootMatches && tampered.length === 0 && ecdsaOk !== false,
        computedRoot,
        signedRoot,
        rootMatches,
        ecdsaOk,
        tampered,
        leafCount: recomputedLeaves.length,
        snapshot,
        recomputedLeaves,
        hasSignature: !!b.ecdsa_signature,
        hasTimestamp: !!b.rfc3161_timestamp_token,
        hasCert: !!(b.vendor_certificate || b.vendor_cert),
      })
    } catch (e) {
      setError('Verification error: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const reset = () => { setBundle(null); setResult(null); setError(''); setFilename('') }

  const inner = (
      <div className={embedded ? '' : 'max-w-3xl mx-auto px-6 py-10'}>
        <div className="inline-flex items-center gap-2 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-full px-3 py-1 text-[11.5px] font-medium text-emerald-700 dark:text-emerald-400 mb-5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"/> Zero server trust — verification runs entirely in your browser
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">Verify a Tessera offline</h1>
        <p className="text-[14px] text-gray-500 dark:text-neutral-400 leading-relaxed mb-7 max-w-xl">
          Drop a <span className="font-mono text-[12.5px]">.tessera</span> file below. Your browser recomputes the Merkle tree from the answers inside the file and checks it against the signed root — no network call, no Attestr server. If a single answer was altered, the root won't match.
        </p>

        {!bundle && (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-14 text-center cursor-pointer transition-colors ${dragOver ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10' : 'border-gray-300 dark:border-neutral-700 hover:border-gray-400 dark:hover:border-neutral-600'}`}>
            <div className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-neutral-800 flex items-center justify-center mx-auto mb-4 text-gray-400 text-xl">↓</div>
            <div className="text-[14px] font-medium mb-1">Drop your .tessera file here</div>
            <div className="text-[12.5px] text-gray-400">or click to browse</div>
            <input ref={fileRef} type="file" accept=".tessera,.json,application/json" className="hidden"
              onChange={e => handleFile(e.target.files[0])}/>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl px-4 py-3 text-[13px] text-red-700 dark:text-red-400">{error}</div>
        )}

        {bundle && result && (
          <div className="space-y-4">
            {/* Verdict banner */}
            <div className={`rounded-2xl border p-6 ${result.ok ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' : 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-full flex items-center justify-center ${result.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
                  {result.ok ? <IconCheck width={22} height={22}/> : <IconX width={22} height={22}/>}
                </div>
                <div>
                  <div className={`text-[16px] font-bold ${result.ok ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-800 dark:text-red-300'}`}>
                    {result.ok ? 'Integrity verified' : 'Integrity check failed'}
                  </div>
                  <div className={`text-[12.5px] ${result.ok ? 'text-emerald-700 dark:text-emerald-400/80' : 'text-red-700 dark:text-red-400/80'}`}>
                    {result.ok
                      ? `All ${result.leafCount} answers hash to the signed Merkle root. Nothing was altered.`
                      : result.reason || `Answer ${result.tampered.map(i => i+1).join(', ')} was modified after signing — the recomputed root does not match.`}
                  </div>
                </div>
              </div>
            </div>

            {/* Root comparison */}
            <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl p-4">
              <div className="text-[12px] font-semibold text-gray-900 dark:text-white mb-3">Merkle root comparison</div>
              <div className="space-y-2.5">
                <div>
                  <div className="text-[10.5px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Signed root (from file)</div>
                  <div className="font-mono text-[10.5px] text-gray-600 dark:text-neutral-300 break-all">{result.signedRoot}</div>
                </div>
                <div>
                  <div className="text-[10.5px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Recomputed root (in your browser)</div>
                  <div className={`font-mono text-[10.5px] break-all ${result.rootMatches ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{result.computedRoot}</div>
                </div>
                <div className={`text-[11.5px] font-medium ${result.rootMatches ? 'text-emerald-600' : 'text-red-600'}`}>
                  {result.rootMatches ? '✓ Roots match exactly' : '✗ Roots differ — the data does not match the signature'}
                </div>
                {result.ecdsaOk !== null && (
                  <div className="pt-2 border-t border-gray-100 dark:border-neutral-800">
                    <div className="text-[10.5px] font-semibold text-gray-400 uppercase tracking-wide mb-1">ECDSA signature (verified in your browser)</div>
                    <div className={`text-[11.5px] font-medium ${result.ecdsaOk ? 'text-emerald-600' : 'text-red-600'}`}>
                      {result.ecdsaOk
                        ? '✓ Signature verifies against the vendor public key — this root was signed by the key holder'
                        : '✗ Signature does NOT verify — the root or signature was altered, or signed by a different key'}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Per-answer leaves */}
            <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800 text-[12px] font-semibold text-gray-900 dark:text-white">Per-answer leaf hashes ({result.leafCount})</div>
              <div className="divide-y divide-gray-50 dark:divide-neutral-800/50 max-h-80 overflow-auto">
                {result.snapshot.map((a, i) => {
                  const bad = result.tampered.includes(i)
                  return (
                    <div key={i} className={`px-4 py-2.5 ${bad ? 'bg-red-50 dark:bg-red-500/10' : ''}`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-mono text-[10.5px] text-gray-400">{a.question_id || `answer ${i+1}`}</span>
                        <span className={`text-[10px] font-semibold ${bad ? 'text-red-600' : 'text-emerald-600 dark:text-emerald-400'}`}>{bad ? 'TAMPERED' : 'OK'}</span>
                      </div>
                      <div className="font-mono text-[10px] text-gray-500 dark:text-neutral-500 break-all">{result.recomputedLeaves[i]}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* What this does and doesn't prove — honesty */}
            <div className="bg-gray-50 dark:bg-neutral-900/50 border border-gray-200 dark:border-neutral-800 rounded-xl p-4 text-[11.5px] text-gray-500 dark:text-neutral-400 leading-relaxed">
              This offline check proves <span className="font-medium text-gray-700 dark:text-neutral-300">integrity</span> (the answers match the signed Merkle root){result.ecdsaOk ? <> and <span className="font-medium text-gray-700 dark:text-neutral-300">authenticity</span> (the ECDSA signature verifies against the vendor's public key)</> : null} — all with no server. {result.ecdsaOk === null && 'The ECDSA check needs native Web Crypto (HTTPS or localhost) and was skipped here. '}The bundle also carries the vendor certificate{result.hasCert ? ' ✓' : ''} and an RFC 3161 timestamp{result.hasTimestamp ? ' ✓' : ''}; certificate-chain validation against the CA and timestamp validation run in the auditor dashboard.
            </div>

            <button onClick={reset} className="text-[12.5px] font-medium text-blue-600 hover:text-blue-700">Verify another file →</button>
          </div>
        )}

        {busy && <div className="text-[13px] text-gray-400 mt-4">Recomputing hashes…</div>}
      </div>
  )

  if (embedded) return inner

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-neutral-950 text-gray-900 dark:text-white">
      <header className="h-14 flex items-center justify-between px-6 lg:px-12 border-b border-gray-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-950/80 backdrop-blur">
        <button onClick={() => navigate('/')} className="flex items-center gap-2">
          <Logo className="h-7" />
        </button>
        <span className="text-[12px] text-gray-400">Offline verifier</span>
      </header>
      {inner}
    </div>
  )
}
