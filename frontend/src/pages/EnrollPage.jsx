import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import api from '../lib/api'
import Logo from '../components/Shared/Logo'

// ── PKCS#10 CSR generation in the browser (ECDSA P-256) ──────────────────────
// Web Crypto generates keys and signs, but does not build CSRs. We hand-encode
// the ASN.1 DER. Verified to round-trip against Python's `cryptography`
// (proof-of-possession signature validates, CA signs it successfully).

function derLen(n) {
  if (n < 0x80) return [n]
  const bytes = []; let v = n
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8 }
  return [0x80 | bytes.length, ...bytes]
}
const derTLV = (tag, content) => [tag, ...derLen(content.length), ...content]
const seq = (...parts) => derTLV(0x30, [].concat(...parts))
const setOf = (...parts) => derTLV(0x31, [].concat(...parts))
function oid(str) {
  const parts = str.split('.').map(Number)
  const body = [40 * parts[0] + parts[1]]
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i]; const stack = [v & 0x7f]; v >>= 7
    while (v > 0) { stack.unshift((v & 0x7f) | 0x80); v >>= 7 }
    body.push(...stack)
  }
  return derTLV(0x06, body)
}
const utf8String = (s) => derTLV(0x0c, [...new TextEncoder().encode(s)])
const bitString = (bytes) => derTLV(0x03, [0x00, ...bytes])
const subjectName = (cn) => seq(setOf(seq(oid('2.5.4.3'), utf8String(cn))))

function rawSigToDer(raw) {
  const trim = (b) => { while (b.length > 1 && b[0] === 0) b.shift(); if (b[0] & 0x80) b.unshift(0x00); return b }
  const R = trim([...raw.slice(0, 32)]), S = trim([...raw.slice(32, 64)])
  return seq(derTLV(0x02, R), derTLV(0x02, S))
}
function toPem(der, label) {
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n')
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`
}

async function generateCsr(cn) {
  if (!(window.crypto && window.crypto.subtle)) {
    throw new Error('Web Crypto is unavailable. Open this page over HTTPS or http://localhost (not a bare IP).')
  }
  const keyPair = await window.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
  )
  const spki = new Uint8Array(await window.crypto.subtle.exportKey('spki', keyPair.publicKey))
  const version = derTLV(0x02, [0x00])
  const cri = seq(version, subjectName(cn), [...spki], derTLV(0xa0, []))
  const sig = new Uint8Array(await window.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, new Uint8Array(cri)
  ))
  const csr = seq(cri, seq(oid('1.2.840.10045.4.3.2')), bitString(rawSigToDer(sig)))
  const pkcs8 = new Uint8Array(await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
  return { csrPem: toPem(csr, 'CERTIFICATE REQUEST'), privateKeyPem: toPem(pkcs8, 'PRIVATE KEY') }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/x-pem-file' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

export default function EnrollPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token')

  const [stage, setStage] = useState('loading')  // loading | invalid | ready | generating | done
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [keyPem, setKeyPem] = useState('')
  const [certPem, setCertPem] = useState('')
  const [savedKey, setSavedKey] = useState(false)
  const slug = (info?.org_name || 'user').replace(/\s+/g, '_').toLowerCase()

  useEffect(() => {
    if (!token) { setStage('invalid'); setError('No enrollment token in the link.'); return }
    api.get(`/users/enroll/${token}`)
      .then(r => { setInfo(r.data); setStage('ready') })
      .catch(e => { setStage('invalid'); setError(e.response?.data?.detail || 'This enrollment link is invalid or expired.') })
  }, [token])

  const enroll = async () => {
    setStage('generating'); setError('')
    try {
      const { csrPem, privateKeyPem } = await generateCsr(info.org_name)
      setKeyPem(privateKeyPem)
      const { data } = await api.post('/users/enroll/complete', { token, csr_pem: csrPem })
      setCertPem(data.certificate_pem)
      downloadText(`attestr_${slug}_private_key.pem`, privateKeyPem)
      setSavedKey(true)
      setStage('done')
    } catch (e) {
      setStage('ready')
      setError(e.response?.data?.detail || e.message || 'Enrollment failed.')
    }
  }

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-neutral-950 text-gray-900 dark:text-white flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-8">
          <Logo className="h-10" />
        </div>

        {stage === 'loading' && <p className="text-[13px] text-gray-400">Checking your enrollment link…</p>}

        {stage === 'invalid' && (
          <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-2xl p-7">
            <h1 className="text-[18px] font-semibold mb-2">Enrollment link problem</h1>
            <p className="text-[13px] text-gray-500 dark:text-neutral-400 mb-5">{error}</p>
            <button onClick={() => navigate('/login')} className="text-[13px] font-semibold bg-gray-900 dark:bg-white dark:text-neutral-900 text-white px-5 py-2.5 rounded-lg">Go to sign in</button>
          </div>
        )}

        {(stage === 'ready' || stage === 'generating') && info && (
          <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-2xl p-7">
            <p className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 tracking-widest uppercase mb-3">Certificate enrollment</p>
            <h1 className="text-[22px] font-semibold tracking-tight mb-2">Welcome, {info.org_name}</h1>
            <p className="text-[13.5px] text-gray-500 dark:text-neutral-400 leading-relaxed mb-5">
              You're enrolling as <span className="font-medium text-gray-700 dark:text-neutral-200">{info.role.replace('_',' ')}</span>. When you continue, your browser generates a private key <span className="font-medium text-gray-700 dark:text-neutral-200">that never leaves this device</span> and requests a certificate from the Attestr CA. The CA only ever sees your public key.
            </p>
            <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-xl p-3.5 mb-5 text-[12px] text-blue-800 dark:text-blue-300 leading-relaxed">
              🔒 Your private key downloads as a <span className="font-mono">.pem</span> file. Keep it safe — it's how you sign in, and it can't be recovered if lost.
            </div>
            {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2.5 mb-4">{error}</div>}
            <button onClick={enroll} disabled={stage === 'generating'}
              className="w-full bg-gray-900 dark:bg-white dark:text-neutral-900 text-white text-[13px] font-semibold py-3 rounded-xl disabled:opacity-50">
              {stage === 'generating' ? 'Generating your key & certificate…' : 'Generate my key & enroll'}
            </button>
          </div>
        )}

        {stage === 'done' && (
          <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-2xl p-7">
            <div className="w-11 h-11 rounded-full bg-emerald-500 text-white flex items-center justify-center mb-4 text-xl">✓</div>
            <h1 className="text-[20px] font-semibold tracking-tight mb-2">You're enrolled</h1>
            <p className="text-[13.5px] text-gray-500 dark:text-neutral-400 leading-relaxed mb-5">
              Your certificate has been issued. Your private key was downloaded to this device — store it somewhere safe. Sign in with your certificate below.
            </p>
            <div className="space-y-3 mb-5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Your certificate</span>
                  <button onClick={() => downloadText(`attestr_${slug}_certificate.pem`, certPem)}
                    className="text-[11px] font-medium text-blue-600 hover:text-blue-700">Download .pem</button>
                </div>
                <div className="font-mono text-[10px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg p-3 max-h-32 overflow-auto break-all text-gray-600 dark:text-neutral-300 whitespace-pre-wrap">{certPem}</div>
              </div>
              <button onClick={() => downloadText(`attestr_${slug}_private_key.pem`, keyPem)}
                className="text-[12px] font-medium text-blue-600 hover:text-blue-700">Re-download private key</button>
            </div>
            <button onClick={() => navigate('/login')} className="w-full bg-gray-900 dark:bg-white dark:text-neutral-900 text-white text-[13px] font-semibold py-3 rounded-xl">Go to sign in</button>
          </div>
        )}
      </div>
    </div>
  )
}
