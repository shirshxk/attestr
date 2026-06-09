import { useState, useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import api from '../lib/api'
import AppLayout from '../components/Layout/AppLayout'
import BenchmarkDashboard from '../components/Performance/BenchmarkDashboard'
import TrustCenter from '../components/Performance/TrustCenter'
import { useToast } from '../components/Shared/Toast'
import { useModal } from '../components/Shared/Modal'
import {
  IconCheck, IconX, IconArrowRight, IconClock, IconUsers, IconShield, IconKey, IconChart,
} from '../components/Layout/icons'

const ROLE_TAG = {
  auditor:  'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',
  vendor:   'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
  ca_admin: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20',
}

function Card({ children, className = '' }) {
  return <div className={`bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800 ${className}`}>{children}</div>
}

function StatCard({ value, label, Icon, accent }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">{value}</div>
          <div className="text-[11.5px] text-gray-500 dark:text-neutral-500 mt-1">{label}</div>
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent}`}>
          <Icon width={17} height={17}/>
        </div>
      </div>
    </Card>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────
function Overview() {
  const [stats, setStats] = useState(null)
  const [orgs,  setOrgs]  = useState([])
  const [pending, setPending] = useState([])
  const navigate = useNavigate()
  const toast = useToast()
  const modal = useModal()

  useEffect(() => { load() }, [])
  const load = async () => {
    const [s, o, r] = await Promise.all([
      api.get('/admin/stats').then(r => r.data).catch(() => null),
      api.get('/admin/organizations').then(r => r.data).catch(() => []),
      api.get('/vendor-requests').then(r => r.data).catch(() => []),
    ])
    setStats(s); setOrgs(o); setPending((r||[]).filter(x => x.status === 'pending'))
  }

  const issueCert = async (id) => {
    try {
      const { data } = await api.post('/admin/certificates/issue', { org_id: id })
      await modal.reveal({
        title: 'Certificate issued',
        body: 'Save this private key now — it is shown only once and never stored in plaintext.',
        value: data.private_key_pem,
      })
      toast.success('Certificate issued.')
      load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not issue certificate.') }
  }

  const revokeCert = async (org) => {
    const ok = await modal.confirm({
      title: `Revoke ${org.name}'s certificate?`,
      body: 'The certificate serial is added to the CRL. Any Tessera signed with it will fail verification, and the org cannot authenticate until re-issued.',
      confirmLabel: 'Revoke certificate',
      danger: true,
    })
    if (!ok) return
    try {
      await api.post('/admin/certificates/revoke', { org_id: org.id })
      toast.success(`${org.name}'s certificate revoked and added to the CRL.`, { title: 'Revoked' })
      load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not revoke.') }
  }

  return (
    <div className="space-y-5">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          <StatCard value={stats.total_orgs} label="Organizations" Icon={IconUsers} accent="bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400"/>
          <StatCard value={stats.auditor_count} label="Auditors" Icon={IconShield} accent="bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400"/>
          <StatCard value={stats.vendor_count} label="Vendors" Icon={IconUsers} accent="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"/>
          <StatCard value={stats.active_certs} label="Active certs" Icon={IconKey} accent="bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"/>
          <StatCard value={stats.audit_log_entries} label="Audit events" Icon={IconChart} accent="bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-neutral-300"/>
        </div>
      )}

      {/* Action item: pending requests */}
      {pending.length > 0 && (
        <Card className="p-4 border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-600 flex items-center justify-center">
                <IconClock width={18} height={18}/>
              </div>
              <div>
                <div className="text-[13.5px] font-semibold text-gray-900 dark:text-white">
                  {pending.length} vendor request{pending.length > 1 ? 's' : ''} awaiting approval
                </div>
                <div className="text-[12px] text-gray-500 dark:text-neutral-400">Auditors are waiting for you to onboard vendors.</div>
              </div>
            </div>
            <button onClick={() => navigate('/admin/requests')}
              className="flex items-center gap-1.5 text-[12.5px] font-semibold bg-amber-500 hover:bg-amber-600 text-white px-3.5 py-2 rounded-lg transition-colors">
              Review now <IconArrowRight width={15} height={15}/>
            </button>
          </div>
        </Card>
      )}

      {/* Orgs table */}
      <Card>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-gray-900 dark:text-white">Organizations</span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 dark:border-neutral-800">
              {['Name','Role','Email','Certificate',''].map(h => (
                <th key={h} className="text-left text-[11px] font-semibold text-gray-400 dark:text-neutral-500 px-4 py-2.5 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orgs.map(o => (
              <tr key={o.id} className="border-b border-gray-50 dark:border-neutral-800/50 hover:bg-gray-50 dark:hover:bg-neutral-800/50">
                <td className="px-4 py-3 text-[13px] font-medium text-gray-900 dark:text-white">{o.name}</td>
                <td className="px-4 py-3">
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${ROLE_TAG[o.role]}`}>{o.role.replace('_',' ')}</span>
                </td>
                <td className="px-4 py-3 mono text-[11.5px] text-gray-500 dark:text-neutral-400">{o.email}</td>
                <td className="px-4 py-3">
                  {o.has_cert
                    ? <span className="text-[11.5px] text-emerald-600 dark:text-emerald-400 font-medium">Active · {new Date(o.cert_expires).toLocaleDateString()}</span>
                    : <span className="text-[11.5px] text-gray-400">None</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {!o.has_cert && o.role !== 'ca_admin' && (
                    <button onClick={() => issueCert(o.id)} className="text-[11.5px] font-medium text-blue-600 hover:text-blue-700">Issue cert</button>
                  )}
                  {o.has_cert && o.role !== 'ca_admin' && (
                    <button onClick={() => revokeCert(o)} className="text-[11.5px] font-medium text-red-600 hover:text-red-700">Revoke</button>
                  )}
                </td>
              </tr>
            ))}
            {!orgs.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-[13px] text-gray-400">No organizations</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// ── Vendor Requests ─────────────────────────────────────────────────────────
function VendorRequests() {
  const toast = useToast()
  const [reqs, setReqs] = useState([])
  const [busy, setBusy] = useState('')

  useEffect(() => { load() }, [])
  const load = async () => {
    const { data } = await api.get('/vendor-requests').catch(() => ({ data: [] }))
    setReqs(data)
  }

  const act = async (id, action) => {
    setBusy(id)
    try {
      await api.post(`/vendor-requests/${id}/${action}`)
      toast.success(action === 'approve' ? 'Vendor approved and certificate issued.' : 'Request rejected.')
      await load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Action failed.') }
    finally { setBusy('') }
  }

  const STATUS = {
    pending:  'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400',
    rejected: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400',
  }

  return (
    <Card>
      <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800">
        <span className="text-[13px] font-semibold text-gray-900 dark:text-white">Vendor onboarding requests</span>
      </div>
      <div className="divide-y divide-gray-50 dark:divide-neutral-800/50">
        {reqs.map(r => (
          <div key={r.id} className="flex items-center justify-between px-4 py-3.5">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-gray-900 dark:text-white">{r.vendor_name}</span>
                <span className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded border ${STATUS[r.status]}`}>{r.status}</span>
              </div>
              <div className="text-[11.5px] text-gray-500 dark:text-neutral-400 mt-0.5 mono">{r.vendor_email}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">Requested by {r.auditor_name} · {new Date(r.created_at).toLocaleDateString()}</div>
            </div>
            {r.status === 'pending' && (
              <div className="flex gap-2">
                <button onClick={() => act(r.id, 'approve')} disabled={busy === r.id}
                  className="flex items-center gap-1.5 text-[12px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  <IconCheck width={14} height={14}/> Approve & issue cert
                </button>
                <button onClick={() => act(r.id, 'reject')} disabled={busy === r.id}
                  className="flex items-center gap-1.5 text-[12px] font-medium border border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-neutral-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50">
                  <IconX width={14} height={14}/> Reject
                </button>
              </div>
            )}
            {r.status === 'approved' && <span className="text-[11.5px] text-emerald-600 font-medium">Onboarded ✓</span>}
          </div>
        ))}
        {!reqs.length && <div className="px-4 py-12 text-center text-[13px] text-gray-400">No vendor requests yet.</div>}
      </div>
    </Card>
  )
}

// ── Audit Log ───────────────────────────────────────────────────────────────
function AuditLog() {
  const toast = useToast()
  const [log, setLog] = useState([])
  useEffect(() => { api.get('/admin/audit-log?limit=50').then(r => setLog(r.data)).catch(() => {}) }, [])
  const verify = async () => {
    const { data } = await api.post('/admin/audit-log/verify')
    toast[data.valid ? 'success' : 'error'](data.valid ? `Chain intact — ${data.total} entries verified.` : `Chain broken at entry ${data.broken_at_id}.`, { title: 'Audit log integrity' })
  }
  return (
    <Card>
      <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-gray-900 dark:text-white">HMAC audit log</span>
        <button onClick={verify} className="text-[12px] font-medium text-blue-600 hover:text-blue-700">Verify chain integrity</button>
      </div>
      <div className="divide-y divide-gray-50 dark:divide-neutral-800/50">
        {log.map(e => (
          <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0"/>
            <span className="text-[12.5px] font-medium text-gray-900 dark:text-white flex-1">{e.event_type.replace(/_/g,' ')}</span>
            <span className="text-[11px] text-gray-400">{new Date(e.created_at).toLocaleString()}</span>
            <span className="mono text-[10px] text-gray-300 dark:text-neutral-600">{e.hmac_hex.slice(0,10)}…</span>
          </div>
        ))}
        {!log.length && <div className="px-4 py-10 text-center text-[13px] text-gray-400">No events</div>}
      </div>
    </Card>
  )
}

export default function AdminDashboard() {
  const loc = useLocation()
  const titles = {
    '/admin': ['Overview', 'Trust anchor control center'],
    '/admin/requests': ['Vendor requests', 'Approve auditor onboarding requests'],
    '/admin/keys': ['Key management', 'Shamir secret sharing & rotation'],
    '/admin/log': ['Audit log', 'Tamper-evident HMAC event chain'],
    '/admin/trust': ['Trust Center', 'Architecture & cryptographic performance'],
  }
  const [title, subtitle] = titles[loc.pathname] || titles['/admin']

  return (
    <AppLayout title={title} subtitle={subtitle}>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="requests" element={<VendorRequests />} />
        <Route path="keys" element={<KeysPlaceholder />} />
        <Route path="log" element={<AuditLog />} />
        <Route path="trust" element={<TrustCenter />} />
      </Routes>
    </AppLayout>
  )
}

function KeysPlaceholder() {
  const toast = useToast()
  const [result, setResult] = useState(null)
  const split = async () => {
    try { const { data } = await api.post('/admin/keys/shamir/split', { n:5, k:3 }); setResult(data); toast.success('CA key split into 5 shares (3 required).') }
    catch (e) { toast.error(e.response?.data?.detail || 'Split failed.') }
  }
  return (
    <Card className="p-5 max-w-2xl">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[14px] font-semibold text-gray-900 dark:text-white">Shamir Secret Sharing</h3>
        <span className="text-[10.5px] font-medium px-2 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">3-of-5</span>
      </div>
      <p className="text-[12.5px] text-gray-500 dark:text-neutral-400 mb-4">Split the CA master key into 5 shares. Any 3 reconstruct it. No single custodian can act alone.</p>
      <button onClick={split} className="text-[12.5px] font-semibold bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg transition-colors">Split CA key into shares</button>
      {result && (
        <div className="mt-4 space-y-2">
          {result.shares.map((s, i) => (
            <div key={i} className="flex items-start gap-3 p-2.5 bg-gray-50 dark:bg-neutral-800 rounded-lg">
              <span className="text-[11px] font-bold text-gray-400 mt-0.5 w-14 flex-shrink-0">Share {i+1}</span>
              <code className="mono text-[10.5px] text-gray-600 dark:text-neutral-300 break-all">{s}</code>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

