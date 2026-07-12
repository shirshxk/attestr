import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import api from '../lib/api'
import AppLayout from '../components/Layout/AppLayout'
import BenchmarkDashboard from '../components/Performance/BenchmarkDashboard'
import TrustCenter from '../components/Performance/TrustCenter'
import { useToast } from '../components/Shared/Toast'
import { useModal } from '../components/Shared/Modal'
import { useAuth } from '../hooks/useAuth'
import WorkspacesManagement from './WorkspacesPage'
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

function Overview() {
  const [stats, setStats] = useState(null)
  const [pending, setPending] = useState([])
  const [events, setEvents] = useState([])
  const navigate = useNavigate()

  useEffect(() => { load() }, [])
  const load = async () => {
    const [s, r, log] = await Promise.all([
      api.get('/admin/stats').then(r => r.data).catch(() => null),
      api.get('/vendor-requests').then(r => r.data).catch(() => []),
      api.get('/admin/audit-log?limit=8').then(r => r.data).catch(() => []),
    ])
    setStats(s); setPending((r||[]).filter(x => x.status === 'pending')); setEvents(log||[])
  }

  const EVENT_LABEL = {
    user_created:'User created', user_updated:'User updated', enrollment_completed:'Enrollment completed',
    enrollment_resent:'Enrollment link resent', certificate_issued:'Certificate issued',
    certificate_revoked:'Certificate revoked', tessera_verified:'Tessera verified',
    questionnaire_closed:'Cycle closed', vendor_request_approved:'Vendor approved',
  }
  const fmtTime = (iso) => { try { return new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) } catch { return '' } }

  if (!stats) return <div className="text-[13px] text-gray-400 py-10 text-center">Loading…</div>

  const totalRoles = (stats.super_admin_count||0) + (stats.auditor_count||0) + (stats.vendor_count||0) || 1
  const certTotal = (stats.active_certs||0) + (stats.revoked_certs||0) || 1
  const activePct = Math.round((stats.active_certs||0)/certTotal*100)

  const roleSeg = [
    { label:'Super Admins', value:stats.super_admin_count||0, color:'bg-amber-500' },
    { label:'Auditors',     value:stats.auditor_count||0,     color:'bg-blue-500' },
    { label:'Vendors',      value:stats.vendor_count||0,      color:'bg-emerald-500' },
  ]

  return (
    <div className="space-y-5">
      {/* Top metric row */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Organizations" value={stats.total_orgs} hint={`${stats.super_admin_count||0} admin · ${stats.auditor_count||0} auditor · ${stats.vendor_count||0} vendor`} accent="text-gray-900 dark:text-white"/>
        <MetricCard label="Active certificates" value={stats.active_certs} hint={stats.revoked_certs ? `${stats.revoked_certs} revoked` : 'none revoked'} accent="text-emerald-600 dark:text-emerald-400"/>
        <MetricCard label="Tesseras sealed" value={stats.total_tesseras} hint={`across ${stats.total_questionnaires} questionnaires`} accent="text-blue-600 dark:text-blue-400"/>
        <MetricCard label="Audit events" value={stats.audit_log_entries} hint="HMAC-chained, tamper-evident" accent="text-violet-600 dark:text-violet-400"/>
      </div>

      {/* Pending action banner */}
      {pending.length > 0 && (
        <Card className="p-4 border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-600 flex items-center justify-center"><IconClock width={18} height={18}/></div>
              <div>
                <div className="text-[13.5px] font-semibold text-gray-900 dark:text-white">{pending.length} vendor request{pending.length>1?'s':''} awaiting approval</div>
                <div className="text-[12px] text-gray-500 dark:text-neutral-400">Auditors are waiting for you to onboard vendors.</div>
              </div>
            </div>
            <button onClick={() => navigate('/admin/requests')} className="flex items-center gap-1.5 text-[12.5px] font-semibold bg-amber-500 hover:bg-amber-600 text-white px-3.5 py-2 rounded-lg">Review now <IconArrowRight width={15} height={15}/></button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-3 gap-4">
        {/* CA trust anchor status */}
        <Card className="p-5 col-span-1">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 flex items-center justify-center"><IconShield width={17} height={17}/></div>
            <div className="text-[13px] font-semibold text-gray-900 dark:text-white">CA trust anchor</div>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">Operational</span>
          </div>
          <p className="text-[11.5px] text-gray-500 dark:text-neutral-400 leading-relaxed mb-4">Root key active and protected by a 3-of-5 Shamir split. Every issued certificate chains to this anchor.</p>
          <div className="space-y-2 pt-3 border-t border-gray-100 dark:border-neutral-800">
            <Row label="Active certs" value={stats.active_certs}/>
            <Row label="Revoked (CRL)" value={stats.revoked_certs}/>
            <Row label="Privileged auditors" value={stats.privileged_auditors||0}/>
          </div>
          <button onClick={() => navigate('/admin/keys')} className="mt-4 w-full text-[12px] font-semibold text-blue-600 hover:text-blue-700 border border-blue-200 dark:border-blue-500/30 rounded-lg py-2">Manage CA keys</button>
        </Card>

        {/* Role distribution + cert health */}
        <Card className="p-5 col-span-2">
          <div className="text-[13px] font-semibold text-gray-900 dark:text-white mb-4">Population & certificate health</div>

          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11.5px] font-medium text-gray-500 dark:text-neutral-400">Role distribution</span>
              <span className="text-[11.5px] text-gray-400">{totalRoles} orgs</span>
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 dark:bg-neutral-800">
              {roleSeg.map(s => <div key={s.label} className={s.color} style={{width:`${s.value/totalRoles*100}%`}} title={`${s.label}: ${s.value}`}/>)}
            </div>
            <div className="flex gap-4 mt-2.5">
              {roleSeg.map(s => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${s.color}`}></span>
                  <span className="text-[11px] text-gray-500 dark:text-neutral-400">{s.label} <span className="font-semibold text-gray-700 dark:text-neutral-200">{s.value}</span></span>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-gray-100 dark:border-neutral-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11.5px] font-medium text-gray-500 dark:text-neutral-400">Certificate health</span>
              <span className="text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">{activePct}% active</span>
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 dark:bg-neutral-800">
              <div className="bg-emerald-500" style={{width:`${activePct}%`}}/>
              <div className="bg-red-400" style={{width:`${100-activePct}%`}}/>
            </div>
            <div className="flex gap-4 mt-2.5">
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span><span className="text-[11px] text-gray-500 dark:text-neutral-400">Active <span className="font-semibold text-gray-700 dark:text-neutral-200">{stats.active_certs}</span></span></div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400"></span><span className="text-[11px] text-gray-500 dark:text-neutral-400">Revoked <span className="font-semibold text-gray-700 dark:text-neutral-200">{stats.revoked_certs}</span></span></div>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent activity feed */}
      <Card>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-gray-900 dark:text-white">Recent activity</span>
          <button onClick={() => navigate('/admin/log')} className="text-[11.5px] font-medium text-blue-600 hover:text-blue-700">View full audit log →</button>
        </div>
        <div className="divide-y divide-gray-50 dark:divide-neutral-800/50">
          {events.length === 0 && <div className="px-4 py-8 text-center text-[12.5px] text-gray-400">No activity yet.</div>}
          {events.map(e => (
            <div key={e.id} className="px-4 py-2.5 flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-gray-100 dark:bg-neutral-800 flex items-center justify-center flex-shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
              </div>
              <span className="text-[12.5px] text-gray-700 dark:text-neutral-300 flex-1">{EVENT_LABEL[e.event_type] || e.event_type.replace(/_/g,' ')}</span>
              <span className="text-[11px] text-gray-400 font-mono flex-shrink-0">{fmtTime(e.created_at)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function MetricCard({ label, value, hint, accent }) {
  return (
    <Card className="px-4 py-3.5">
      <div className={`text-[26px] font-bold tracking-tight leading-none mb-1 ${accent}`}>{value ?? '—'}</div>
      <div className="text-[12px] font-medium text-gray-700 dark:text-neutral-300">{label}</div>
      {hint && <div className="text-[10.5px] text-gray-400 mt-0.5 truncate">{hint}</div>}
    </Card>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11.5px] text-gray-500 dark:text-neutral-400">{label}</span>
      <span className="text-[12.5px] font-semibold text-gray-900 dark:text-white">{value ?? 0}</span>
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
    '/admin/users': ['User management', 'Create and manage organizations & roles'],
    '/admin/workspaces': ['Workspaces', 'Group auditors and vendors into teams'],
  }
  const [title, subtitle] = titles[loc.pathname] || titles['/admin']

  return (
    <AppLayout title={title} subtitle={subtitle}>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="workspaces" element={<WorkspacesManagement />} />
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

// ── User Management (super_admin / admin) ─────────────────────────────────────
function UserManagement() {
  const toast = useToast()
  const modal = useModal()
  const { org, refreshSession } = useAuth()
  const isSuper = org?.role === 'super_admin' || org?.role === 'ca_admin'

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name:'', email:'', role:'vendor', is_privileged:false })
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [menuOpen, setMenuOpen] = useState(null)
  const [roleEdit, setRoleEdit] = useState(null)   // { user, role } when changing a user's role

  const load = async () => {
    setLoading(true)
    const { data } = await api.get('/users').catch(() => ({ data: [] }))
    setUsers(data); setLoading(false)
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    const close = () => setMenuOpen(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const creatableRoles = isSuper ? ['super_admin','auditor','vendor'] : ['auditor','vendor']

  const create = async () => {
    if (!form.name.trim() || !form.email.trim()) { toast.error('Name and email are required.'); return }
    setBusy(true)
    try {
      const { data } = await api.post('/users', form)
      await modal.reveal({
        title: `${data.role.replace('_',' ')} created — enrollment sent`,
        body: 'An enrollment link was emailed to the user (view it in Mailhog at http://localhost:8025). They open it to generate their own private key in-browser and receive a certificate — the key never touches the server. You can also share this link directly:',
        value: data.enroll_url,
      })
      toast.success('User created. Enrollment link sent.')
      setShowCreate(false); setForm({ name:'', email:'', role:'vendor', is_privileged:false }); load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not create user.') }
    finally { setBusy(false) }
  }

  const togglePriv = async (u) => {
    try {
      await api.patch(`/users/${u.id}`, { is_privileged: !u.is_privileged })
      toast.success(`${u.name} is ${!u.is_privileged ? 'now privileged' : 'no longer privileged'}.`)
      load(); refreshSession()
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to update.') }
  }

  const toggleActive = async (u) => {
    const ok = await modal.confirm({
      title: `${u.is_active ? 'Deactivate' : 'Reactivate'} ${u.name}?`,
      body: u.is_active ? 'They will no longer be able to authenticate with Attestr.' : 'They will regain access.',
      confirmLabel: u.is_active ? 'Deactivate' : 'Reactivate', danger: u.is_active,
    })
    if (!ok) return
    try { await api.patch(`/users/${u.id}`, { is_active: !u.is_active }); toast.success('Updated.'); load(); refreshSession() }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed to update.') }
  }

  const deleteUser = async (u) => {
    const ok = await modal.confirm({
      title: `Delete ${u.name}?`,
      body: 'This permanently removes the user and their certificate. This cannot be undone.',
      confirmLabel: 'Delete', danger: true,
    })
    if (!ok) return
    try { await api.delete(`/users/${u.id}`); toast.success(`${u.name} removed.`); load() }
    catch (e) { toast.error(e.response?.data?.detail || 'Failed to delete.') }
  }

  const resendEnrollment = async (u) => {
    try {
      const { data } = await api.post(`/users/${u.id}/enrollment`)
      await modal.reveal({
        title: 'Enrollment link refreshed',
        body: 'A fresh link was emailed (view in Mailhog at http://localhost:8025). You can also copy it here:',
        value: data.enroll_url,
      })
      load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not refresh link.') }
  }

  const saveRole = async () => {
    if (!roleEdit) return
    const { user, role } = roleEdit
    if (role === user.role) { setRoleEdit(null); return }
    try {
      await api.patch(`/users/${user.id}`, { role })
      toast.success(`${user.name} is now ${role.replace('_',' ')}.`)
      setRoleEdit(null); load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not change role.') }
  }

  const ROLE_BADGE = {
    super_admin:'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20',
    admin:'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20',
    auditor:'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',
    vendor:'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
  }
  const AVATAR = {
    super_admin:'bg-amber-500', admin:'bg-orange-500', auditor:'bg-blue-600', vendor:'bg-emerald-600',
  }

  const counts = {
    all: users.length,
    admin: users.filter(u => u.role === 'super_admin' || u.role === 'ca_admin').length,
    auditor: users.filter(u => u.role === 'auditor').length,
    vendor: users.filter(u => u.role === 'vendor').length,
  }

  const filtered = users.filter(u => {
    const q = query.trim().toLowerCase()
    const matchQ = !q || u.name.toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q)
    const matchF = filter === 'all'
      || (filter === 'admin' && (u.role === 'super_admin' || u.role === 'ca_admin'))
      || (filter === u.role)
    return matchQ && matchF
  })

  const STAT = [
    { key:'all', label:'Total', value:counts.all, color:'text-gray-900 dark:text-white' },
    { key:'admin', label:'Super Admins', value:counts.admin, color:'text-amber-600 dark:text-amber-400' },
    { key:'auditor', label:'Auditors', value:counts.auditor, color:'text-blue-600 dark:text-blue-400' },
    { key:'vendor', label:'Vendors', value:counts.vendor, color:'text-emerald-600 dark:text-emerald-400' },
  ]

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <p className="text-[12.5px] text-gray-500 dark:text-neutral-400 max-w-xl leading-relaxed">
          {isSuper
            ? 'You can create any role — including other super-admins and admins — and grant auditor privileges. New users receive a secure enrollment link; their private key is generated in their own browser.'
            : 'You can onboard auditors and vendors. New users receive an enrollment link to generate their own certificate.'}
        </p>
        <button onClick={() => setShowCreate(s => !s)}
          className="flex items-center gap-1.5 text-[12.5px] font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex-shrink-0 shadow-sm">
          {showCreate ? 'Cancel' : <>＋ New user</>}
        </button>
      </div>

      {/* Stat cards — also act as filters */}
      <div className="grid grid-cols-4 gap-3">
        {STAT.map(s => (
          <button key={s.key} onClick={() => setFilter(s.key)}
            className={`text-left bg-white dark:bg-neutral-900 border rounded-xl px-4 py-3 transition-colors ${filter===s.key ? 'border-blue-400 dark:border-blue-500/50 ring-1 ring-blue-200 dark:ring-blue-500/30' : 'border-gray-200 dark:border-neutral-800 hover:border-gray-300'}`}>
            <div className={`text-[22px] font-bold tracking-tight ${s.color}`}>{s.value}</div>
            <div className="text-[11.5px] text-gray-500 dark:text-neutral-500 mt-0.5">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Create form */}
      {showCreate && (
        <Card className="p-5 space-y-3 border-blue-200 dark:border-blue-500/30">
          <div className="text-[13px] font-semibold text-gray-900 dark:text-white">Onboard a new organization</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1">Name</label>
              <input value={form.name} onChange={e => setForm({...form, name:e.target.value})} placeholder="e.g. Stripe"
                className="w-full text-[13px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"/>
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1">Email</label>
              <input value={form.email} onChange={e => setForm({...form, email:e.target.value})} placeholder="security@stripe.com"
                className="w-full text-[13px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1">Role</label>
              <div className="relative">
                <select value={form.role} onChange={e => setForm({...form, role:e.target.value, is_privileged:false})}
                  className="w-full appearance-none text-[13px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg pl-3 pr-9 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white cursor-pointer capitalize">
                  {creatableRoles.map(r => <option key={r} value={r}>{r.replace('_',' ')}</option>)}
                </select>
                <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
            </div>
            {form.role === 'auditor' && isSuper && (
              <label className="flex items-center gap-2 text-[12px] text-gray-700 dark:text-neutral-300 pb-2 cursor-pointer">
                <input type="checkbox" checked={form.is_privileged} onChange={e => setForm({...form, is_privileged:e.target.checked})} className="accent-blue-600"/>
                Privileged — can see Tessera anatomy &amp; Trust Center
              </label>
            )}
          </div>
          <button onClick={create} disabled={busy}
            className="text-[12.5px] font-semibold bg-gray-900 dark:bg-white dark:text-neutral-900 text-white px-4 py-2 rounded-lg disabled:opacity-50">
            {busy ? 'Creating…' : 'Create & send enrollment link'}
          </button>
        </Card>
      )}

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or email…"
          className="w-full text-[13px] bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg pl-9 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"/>
      </div>

      {/* User list */}
      <Card>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-gray-900 dark:text-white">
            {filter === 'all' ? 'All organizations' : filter === 'admin' ? 'Admins' : filter.charAt(0).toUpperCase()+filter.slice(1)+'s'}
            <span className="text-gray-400 font-normal"> ({filtered.length})</span>
          </span>
        </div>
        <div className="divide-y divide-gray-50 dark:divide-neutral-800/50">
          {loading && <div className="px-4 py-10 text-center text-[13px] text-gray-400">Loading…</div>}
          {!loading && filtered.map(u => {
            const isSelf = u.id === org?.org_id
            const initials = u.name.slice(0,2).toUpperCase()
            return (
              <div key={u.id} className="px-4 py-3 flex items-center gap-3 relative">
                <div className={`w-9 h-9 rounded-lg ${AVATAR[u.role]||'bg-gray-400'} flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0 ${!u.is_active ? 'opacity-50' : ''}`}>{initials}</div>
                <div className={`flex-1 min-w-0 ${!u.is_active ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{u.name}</span>
                    {isSelf && <span className="text-[10px] text-gray-400">(you)</span>}
                    <span className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded border ${ROLE_BADGE[u.role]||''} capitalize`}>{u.role.replace('_',' ')}</span>
                    {u.role === 'auditor' && u.is_privileged && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400">privileged</span>}
                  </div>
                  <div className="text-[11.5px] text-gray-400 mt-0.5">{u.email}</div>
                </div>

                {/* Status pill */}
                {!u.is_active
                  ? <span className="text-[10.5px] font-medium px-2 py-1 rounded-md bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400">Inactive</span>
                  : u.enrollment_pending
                    ? <span className="text-[10.5px] font-medium px-2 py-1 rounded-md bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">Enrollment pending</span>
                    : u.has_cert
                      ? <span className="text-[10.5px] font-medium px-2 py-1 rounded-md bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">Active</span>
                      : <span className="text-[10.5px] font-medium px-2 py-1 rounded-md bg-gray-100 dark:bg-neutral-800 text-gray-500">No certificate</span>}

                {/* Kebab menu */}
                {!isSelf && (
                  <div className="relative flex-shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === u.id ? null : u.id) }}
                      className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 flex items-center justify-center text-gray-400">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
                    </button>
                    {menuOpen === u.id && (
                      <div onClick={e => e.stopPropagation()}
                        className="dropdown-menu absolute right-0 top-9 z-50 w-52 rounded-xl shadow-xl py-1 text-[12.5px] border border-gray-200 dark:border-neutral-700">
                        {isSuper && (
                          <button onClick={() => { setMenuOpen(null); setRoleEdit({ user: u, role: u.role }) }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-neutral-800 text-gray-700 dark:text-neutral-300">
                            Change role
                          </button>
                        )}
                        {u.role === 'auditor' && isSuper && (
                          <button onClick={() => { setMenuOpen(null); togglePriv(u) }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-neutral-800 text-gray-700 dark:text-neutral-300">
                            {u.is_privileged ? 'Revoke privilege' : 'Make privileged'}
                          </button>
                        )}
                        {u.enrollment_pending && (
                          <button onClick={() => { setMenuOpen(null); resendEnrollment(u) }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-neutral-800 text-gray-700 dark:text-neutral-300">
                            Copy / resend enrollment link
                          </button>
                        )}
                        <button onClick={() => { setMenuOpen(null); toggleActive(u) }}
                          className={`w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-neutral-800 ${u.is_active ? 'text-red-600' : 'text-emerald-600'}`}>
                          {u.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                        {!u.is_active && (
                          <button onClick={() => { setMenuOpen(null); deleteUser(u) }}
                            className="w-full text-left px-3 py-2 hover:bg-red-50 dark:hover:bg-red-500/10 text-red-600 border-t border-gray-100 dark:border-neutral-800">
                            Delete user
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {!loading && !filtered.length && (
            <div className="px-4 py-12 text-center">
              <p className="text-[13px] text-gray-400 mb-1">No organizations match.</p>
              {query && <button onClick={() => { setQuery(''); setFilter('all') }} className="text-[12px] text-blue-600 hover:underline">Clear search</button>}
            </div>
          )}
        </div>
      </Card>

      {/* Change-role modal */}
      {roleEdit && (() => {
        const ROLE_OPTS = [
          { key:'super_admin', label:'Super Admin', desc:'The CA — full control, user management, CA root key & Shamir', av:'bg-amber-500' },
          { key:'auditor',     label:'Auditor',     desc:'Runs the compliance workflow & verifies bundles', av:'bg-blue-600' },
          { key:'vendor',      label:'Vendor',      desc:'Fills and signs assigned questionnaires', av:'bg-emerald-600' },
        ]
        const u = roleEdit.user
        const changed = roleEdit.role !== u.role
        return createPortal((
          <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-gray-900/50 dark:bg-black/60" onClick={() => setRoleEdit(null)}>
            <div className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl border border-gray-200 dark:border-neutral-800 shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-neutral-800">
                <div className={`w-9 h-9 rounded-lg ${({super_admin:'bg-amber-500',ca_admin:'bg-amber-500',admin:'bg-orange-500',auditor:'bg-blue-600',vendor:'bg-emerald-600'})[u.role]||'bg-gray-400'} flex items-center justify-center text-white text-[12px] font-bold flex-shrink-0`}>{u.name.slice(0,2).toUpperCase()}</div>
                <div className="min-w-0">
                  <h3 className="text-[14px] font-semibold text-gray-900 dark:text-white leading-tight">Change role</h3>
                  <p className="text-[12px] text-gray-400 truncate">{u.name} · currently {u.role.replace('_',' ')}</p>
                </div>
                <button onClick={() => setRoleEdit(null)} className="ml-auto w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 flex items-center justify-center text-gray-400 text-[15px] flex-shrink-0">×</button>
              </div>

              {/* Role options as selectable cards */}
              <div className="p-4 space-y-2 max-h-[55vh] overflow-auto">
                {ROLE_OPTS.map(opt => {
                  const active = roleEdit.role === opt.key
                  return (
                    <button key={opt.key} onClick={() => setRoleEdit({ ...roleEdit, role: opt.key })}
                      className={`w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-xl border transition-colors ${active ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-500/10 dark:border-blue-500/50' : 'border-gray-200 dark:border-neutral-800 hover:border-gray-300 dark:hover:border-neutral-700'}`}>
                      <div className={`w-8 h-8 rounded-lg ${opt.av} flex items-center justify-center text-white flex-shrink-0`}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" style={{opacity: active ? 1 : 0}}/></svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-gray-900 dark:text-white">{opt.label}{opt.key === u.role && <span className="text-[10.5px] font-normal text-gray-400"> · current</span>}</div>
                        <div className="text-[11.5px] text-gray-500 dark:text-neutral-400 leading-snug">{opt.desc}</div>
                      </div>
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${active ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-neutral-600'}`}>
                        {active && <div className="w-1.5 h-1.5 bg-white rounded-full m-auto mt-[3px]"/>}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-gray-100 dark:border-neutral-800 bg-gray-50/50 dark:bg-neutral-900/50">
                <span className="text-[11.5px] text-gray-400">{changed ? `Will change to ${roleEdit.role.replace('_',' ')}` : 'No change selected'}</span>
                <div className="flex gap-2">
                  <button onClick={() => setRoleEdit(null)} className="text-[12.5px] font-medium px-4 py-2 rounded-lg border border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800">Cancel</button>
                  <button onClick={saveRole} disabled={!changed}
                    className="text-[12.5px] font-semibold px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed">Save role</button>
                </div>
              </div>
            </div>
          </div>
        ), document.body)
      })()}
    </div>
  )
}
