import { useState } from 'react'

// Shows the real cryptographic anatomy of a Tessera bundle.
// Every value here is pulled straight from the signed bundle — nothing synthetic.

function Field({ label, what, value, mono = true, accent = 'blue' }) {
  const [copied, setCopied] = useState(false)
  const colors = {
    blue:'text-blue-600 dark:text-blue-400',
    violet:'text-violet-600 dark:text-violet-400',
    amber:'text-amber-600 dark:text-amber-400',
    emerald:'text-emerald-600 dark:text-emerald-400',
    gray:'text-gray-500 dark:text-neutral-400',
  }
  const copy = () => {
    navigator.clipboard?.writeText(String(value))
    setCopied(true); setTimeout(() => setCopied(false), 1200)
  }
  return (
    <div className="py-3 border-b border-gray-50 dark:border-neutral-800/50 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${colors[accent]}`}>{label}</span>
        <button onClick={copy} className="text-[10.5px] text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300">{copied ? 'copied' : 'copy'}</button>
      </div>
      <div className={`${mono ? 'font-mono text-[10.5px]' : 'text-[12px]'} text-gray-600 dark:text-neutral-300 break-all leading-relaxed`}>
        {value || <span className="text-gray-300 italic">—</span>}
      </div>
      {what && <div className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 leading-snug">{what}</div>}
    </div>
  )
}

function Group({ title, subtitle, children }) {
  return (
    <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800">
        <div className="text-[13px] font-semibold text-gray-900 dark:text-white">{title}</div>
        {subtitle && <div className="text-[11px] text-gray-400 mt-0.5">{subtitle}</div>}
      </div>
      <div className="px-4 py-1">{children}</div>
    </div>
  )
}

export default function TesseraInspector({ tessera }) {
  const b = tessera?.bundle || {}
  const vendorCert = b.vendor_certificate || b.vendor_cert || ''
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Group title="Identity & timestamp" subtitle="Who signed this, and when — provable against the CA">
        <Field label="Bundle ID" what="Unique identifier for this sealed submission." value={b.bundle_id} accent="gray"/>
        <Field label="Vendor certificate" what="The signer's X.509 identity, issued by the Attestr CA." value={vendorCert ? vendorCert.slice(0,80)+'…' : ''} accent="blue"/>
        <Field label="RFC 3161 timestamp token" what="A trusted clock's countersignature over the Merkle root — proves submission time and prevents backdating." value={(b.rfc3161_timestamp_token||'').slice(0,80)+'…'} accent="amber"/>
      </Group>

      <Group title="Integrity — Merkle + ECDSA" subtitle="Binds every answer to the signer; one byte changes the root">
        <Field label="Merkle root" what="The single hash at the top of the answer tree. Changing any answer changes this value." value={tessera.merkle_root} accent="violet"/>
        <Field label="ECDSA signature" what="The vendor's secp256r1 signature over the Merkle root. Only their private key could have produced it." value={(b.ecdsa_signature||'').slice(0,80)+'…'} accent="violet"/>
        <Field label="Leaf count" what="Number of individually-hashed answers in the tree." value={(b.merkle_leaves||[]).length + ' answers'} mono={false} accent="gray"/>
      </Group>

      <Group title="Confidentiality — hybrid encryption" subtitle="End-to-end; the server never sees plaintext">
        <Field label="Ephemeral public key" what="A throwaway ECDH key for this submission only. Provides perfect forward secrecy — destroyed after use." value={(b.ephemeral_public_key||'').slice(0,80)+'…'} accent="emerald"/>
        <Field label="AES-256-GCM IV" what="Initialization vector for the symmetric encryption of the payload." value={b.aes_iv} accent="emerald"/>
        <Field label="AES-GCM auth tag" what="Authentication tag — any tampering with the ciphertext fails this check on decryption." value={b.aes_auth_tag} accent="emerald"/>
        <Field label="Encrypted payload" what="The answers, encrypted for the auditor's key. Unreadable without the auditor's private key." value={(b.encrypted_payload||'').slice(0,80)+'…'} accent="emerald"/>
      </Group>

      <Group title="Chain of custody" subtitle="Where this sits in the remediation history">
        <Field label="Remediation round" what="0 is the original submission; each remediation increments this." value={String(tessera.remediation_round ?? 0)} mono={false} accent="gray"/>
        <Field label="Parent tessera" what="Links this bundle to the one it supersedes, forming an immutable chain." value={tessera.parent_tessera_id || 'none (original submission)'} accent="gray"/>
        <Field label="Created" what="When this bundle was assembled and sealed." value={new Date(tessera.created_at).toLocaleString()} mono={false} accent="gray"/>
      </Group>
    </div>
  )
}
