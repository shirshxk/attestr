import { useState, useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import api, { API_BASE } from '../lib/api'
import TesseraInspector from '../components/Tessera/TesseraInspector'
import MerkleVisualizer from '../components/Verify/MerkleVisualizer'
import OfflineVerifier from './OfflineVerifier'
import AppLayout from '../components/Layout/AppLayout'
import BenchmarkDashboard from '../components/Performance/BenchmarkDashboard'
import TrustCenter from '../components/Performance/TrustCenter'
import { useToast } from '../components/Shared/Toast'
import { useModal } from '../components/Shared/Modal'
import { useAuth } from '../hooks/useAuth'
import MyTeamPage from './MyTeamPage'
import { IconArrowRight, IconPlus, IconCheck, IconClock, IconX, IconDownload, IconSend, IconShield } from '../components/Layout/icons'

const STAGES = ['pending','submitted','under_review','in_remediation','closed']
const STAGE_LABEL = { pending:'Pending', submitted:'Submitted', under_review:'Under Review', in_remediation:'Remediation', closed:'Closed' }
const STAGE_TAG = {
  pending:'bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-neutral-300',
  submitted:'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  under_review:'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  in_remediation:'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400',
  closed:'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
}
const TYPE_TAG = {
  soc2:'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  iso27001:'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400',
  custom:'bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-neutral-300',
}
const TYPE_LABEL = { soc2:'SOC 2', iso27001:'ISO 27001', custom:'Custom' }

function Card({ children, className = '', ...rest }) {
  return <div className={`bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800 ${className}`} {...rest}>{children}</div>
}

// ── Pipeline (Kanban) ────────────────────────────────────────────────────────
function Pipeline() {
  const [qs, setQs] = useState([])
  const navigate = useNavigate()
  useEffect(() => { api.get('/questionnaires').then(r => setQs(r.data)).catch(() => {}) }, [])

  const total = qs.length
  const open = qs.filter(q => q.status !== 'closed').length
  const awaiting = qs.filter(q => q.status === 'submitted' || q.status === 'under_review').length
  const closed = qs.filter(q => q.status === 'closed').length

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-3">
        {[
          { v: total, l: 'Total questionnaires' },
          { v: open, l: 'In progress' },
          { v: awaiting, l: 'Awaiting your review' },
          { v: closed, l: 'Closed' },
        ].map(s => (
          <div key={s.l} className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800 p-4">
            <div className="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">{s.v}</div>
            <div className="text-[11.5px] text-gray-500 dark:text-neutral-500 mt-1">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {STAGES.map(stage => {
          const cards = qs.filter(q => q.status === stage)
          return (
            <div key={stage} className="flex-shrink-0 w-60">
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-[12px] font-semibold text-gray-600 dark:text-neutral-300">{STAGE_LABEL[stage]}</span>
                <span className="text-[11px] mono text-gray-400 bg-gray-100 dark:bg-neutral-800 w-5 h-5 rounded flex items-center justify-center">{cards.length}</span>
              </div>
              <div className="space-y-2">
                {cards.map(q => (
                  <button key={q.id} onClick={() => navigate(`/auditor/bundle?q=${q.id}`)}
                    className="w-full text-left bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl p-3.5 hover:border-blue-300 dark:hover:border-blue-500/50 hover:shadow-sm transition-all group">
                    <div className="text-[12.5px] font-medium text-gray-900 dark:text-white mb-2 line-clamp-2 group-hover:text-blue-700 dark:group-hover:text-blue-400">{q.title}</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded ${TYPE_TAG[q.type]||TYPE_TAG.custom}`}>{TYPE_LABEL[q.type]||q.type}</span>
                      {q.vendor_name && <span className="text-[10.5px] text-gray-400">{q.vendor_name}</span>}
                    </div>
                    {q.deadline && <div className="text-[11px] text-gray-400 mt-2">Due {new Date(q.deadline).toLocaleDateString()}</div>}
                  </button>
                ))}
                {!cards.length && <div className="border border-dashed border-gray-200 dark:border-neutral-800 rounded-xl py-6 text-center text-[11.5px] text-gray-300 dark:text-neutral-600">Empty</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── New Questionnaire ────────────────────────────────────────────────────────
function NewQuestionnaire() {
  const [vendors, setVendors] = useState([])
  const [form, setForm] = useState({ template:'soc2', vendor_id:'', deadline:'', title:'' })
  const [file, setFile] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  useEffect(() => { api.get('/admin/vendors').then(r => setVendors(r.data)).catch(() => {}) }, [])

  const isCustom = form.template === 'custom'

  const submit = async (e) => {
    e.preventDefault()
    if (!form.vendor_id) { setMsg('Select a vendor.'); return }
    if (isCustom && !file) { setMsg('Upload a CSV or XLSX file.'); return }
    if (isCustom && !form.title.trim()) { setMsg('Give the questionnaire a title.'); return }
    setBusy(true); setMsg('')
    try {
      if (isCustom) {
        const fd = new FormData()
        fd.append('title', form.title)
        fd.append('vendor_id', form.vendor_id)
        if (form.deadline) fd.append('deadline', form.deadline)
        fd.append('file', file)
        const { data } = await api.post('/questionnaires/custom/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' }
        })
        setMsg(`Created: ${data.title} (${data.question_count} questions)`)
      } else {
        const { data } = await api.post('/questionnaires/from-template', {
          template_type: form.template, vendor_id: form.vendor_id, deadline: form.deadline || null,
        })
        setMsg(`Created: ${data.title}`)
      }
      setTimeout(() => navigate('/auditor'), 900)
    } catch (e) { setMsg(e.response?.data?.detail || 'Failed.') }
    finally { setBusy(false) }
  }

  return (
    <Card className="p-6 max-w-lg">
      <h3 className="text-[14px] font-semibold text-gray-900 dark:text-white mb-4">New questionnaire</h3>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1.5">Template</label>
          <div className="space-y-2">
            {[
              { v:'soc2', l:'SOC 2 Type II', d:'40+ questions · Trust Service Criteria' },
              { v:'iso27001', l:'ISO 27001 Annex A', d:'50+ questions · Information Security' },
              { v:'custom', l:'Custom upload', d:'Upload your own CSV or XLSX questionnaire' },
            ].map(t => (
              <label key={t.v} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${form.template === t.v ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10 dark:border-blue-500/40' : 'border-gray-200 dark:border-neutral-800 hover:border-gray-300'}`}>
                <input type="radio" checked={form.template === t.v} onChange={() => setForm({...form, template:t.v})} className="accent-blue-600"/>
                <div>
                  <div className="text-[12.5px] font-semibold text-gray-900 dark:text-white">{t.l}</div>
                  <div className="text-[11px] text-gray-500 dark:text-neutral-400">{t.d}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Custom upload block */}
        {isCustom && (
          <div className="rounded-lg border border-gray-200 dark:border-neutral-800 p-3.5 bg-gray-50/60 dark:bg-neutral-800/40 space-y-3">
            <div>
              <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1.5">Questionnaire title</label>
              <input value={form.title} onChange={e => setForm({...form, title:e.target.value})}
                placeholder="e.g. Vendor Security Assessment 2026"
                className="w-full text-[13px] bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"/>
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1.5">Upload file</label>
              <input type="file" accept=".csv,.xlsx,.xlsm" onChange={e => setFile(e.target.files[0])}
                className="w-full text-[12px] text-gray-600 dark:text-neutral-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-blue-600 file:text-white file:text-[12px] file:font-medium file:cursor-pointer"/>
              {file && <p className="text-[11px] text-emerald-600 mt-1.5">{file.name}</p>}
            </div>
            <div className="text-[11px] text-gray-500 dark:text-neutral-400 leading-relaxed">
              Columns: <code className="mono text-[10.5px] bg-gray-200 dark:bg-neutral-700 px-1 rounded">question_id</code>, <code className="mono text-[10.5px] bg-gray-200 dark:bg-neutral-700 px-1 rounded">question_text</code>, <code className="mono text-[10.5px] bg-gray-200 dark:bg-neutral-700 px-1 rounded">question_type</code>, <code className="mono text-[10.5px] bg-gray-200 dark:bg-neutral-700 px-1 rounded">is_required</code>.
              <div className="mt-2 flex gap-2">
                {['csv','xlsx'].map(fmt => (
                  <button key={fmt} onClick={async () => {
                    try {
                      const r = await api.get(`/questionnaires/custom/template?fmt=${fmt}`, { responseType:'blob' })
                      const url = URL.createObjectURL(new Blob([r.data]))
                      const a = document.createElement('a'); a.href = url
                      a.download = `attestr_questions_template.${fmt}`
                      document.body.appendChild(a); a.click(); a.remove()
                      URL.revokeObjectURL(url)
                    } catch { toast.error('Template download failed.') }
                  }} className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium text-[12px]">
                    <IconDownload width={12} height={12}/> {fmt.toUpperCase()} template
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div>
          <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1.5">Send to vendor</label>
          <div className="relative">
            <select value={form.vendor_id} onChange={e => setForm({...form, vendor_id:e.target.value})}
              className="w-full appearance-none text-[13px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg pl-3 pr-9 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white cursor-pointer">
              <option value="">Select vendor...</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
          {!vendors.length && (
            <p className="text-[11px] text-amber-600 mt-1.5">No vendors yet. <button type="button" onClick={() => navigate('/auditor/vendors')} className="underline font-medium">Request one →</button></p>
          )}
        </div>
        <div>
          <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1.5">Deadline <span className="text-gray-400 font-normal">(optional)</span></label>
          <input type="datetime-local" value={form.deadline} onChange={e => setForm({...form, deadline:e.target.value})}
            className="w-full text-[13px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"/>
        </div>
        {msg && <div className={`text-[12px] rounded-lg px-3 py-2 ${msg.startsWith('Created') ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-red-600 bg-red-50 border border-red-200'}`}>{msg}</div>}
        <button type="submit" disabled={busy} className="w-full bg-gray-900 dark:bg-white dark:text-neutral-900 hover:bg-gray-800 text-white text-[13px] font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50">
          {busy ? 'Creating...' : 'Create and send'}
        </button>
      </form>
    </Card>
  )
}

// ── Vendors (list + request new) ─────────────────────────────────────────────
function Vendors() {
  const [vendors, setVendors] = useState([])
  const [reqs, setReqs] = useState([])
  const [form, setForm] = useState({ vendor_name:'', vendor_email:'', note:'' })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { load(); const iv = setInterval(load, 4000); return () => clearInterval(iv) }, [])
  const load = async () => {
    const [v, r] = await Promise.all([
      api.get('/admin/vendors').then(r => r.data).catch(() => []),
      api.get('/vendor-requests/mine').then(r => r.data).catch(() => []),
    ])
    setVendors(v); setReqs(r)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.vendor_name || !form.vendor_email) { setMsg('Name and email required.'); return }
    setBusy(true); setMsg('')
    try {
      const { data } = await api.post('/vendor-requests', form)
      setMsg(data.message)
      setForm({ vendor_name:'', vendor_email:'', note:'' })
      load()
    } catch (e) { setMsg(e.response?.data?.detail || 'Failed.') }
    finally { setBusy(false) }
  }

  const STATUS = {
    pending:  { c:'bg-amber-50 text-amber-700 border-amber-200', Icon: IconClock },
    approved: { c:'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: IconCheck },
    rejected: { c:'bg-red-50 text-red-700 border-red-200', Icon: IconX },
  }

  return (
    <div className="grid grid-cols-2 gap-5">
      {/* Request form */}
      <Card className="p-5 h-fit">
        <h3 className="text-[14px] font-semibold text-gray-900 dark:text-white mb-1">Request a new vendor</h3>
        <p className="text-[12px] text-gray-500 dark:text-neutral-400 mb-4">The CA Admin will review and onboard them with a certificate.</p>
        <form onSubmit={submit} className="space-y-3.5">
          <div>
            <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1">Vendor name</label>
            <input value={form.vendor_name} onChange={e => setForm({...form, vendor_name:e.target.value})}
              placeholder="e.g. Stripe"
              className="w-full text-[13px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"/>
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1">Vendor email</label>
            <input type="email" value={form.vendor_email} onChange={e => setForm({...form, vendor_email:e.target.value})}
              placeholder="security@stripe.com"
              className="w-full text-[13px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"/>
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1">Note <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea value={form.note} onChange={e => setForm({...form, note:e.target.value})} rows={2}
              placeholder="Why you're onboarding them..."
              className="w-full text-[13px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"/>
          </div>
          {msg && <div className="text-[12px] text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">{msg}</div>}
          <button type="submit" disabled={busy} className="w-full flex items-center justify-center gap-1.5 bg-gray-900 dark:bg-white dark:text-neutral-900 hover:bg-gray-800 text-white text-[13px] font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50">
            <IconSend width={15} height={15}/> {busy ? 'Submitting...' : 'Submit request'}
          </button>
        </form>
      </Card>

      {/* Active vendors + my requests */}
      <div className="space-y-5">
        <Card>
          <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800 text-[13px] font-semibold text-gray-900 dark:text-white">Active vendors</div>
          <div className="divide-y divide-gray-50 dark:divide-neutral-800/50">
            {vendors.map(v => (
              <div key={v.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-medium text-gray-900 dark:text-white">{v.name}</div>
                  <div className="text-[11.5px] text-gray-500 dark:text-neutral-400 mono">{v.email}</div>
                </div>
                <span className="text-[11px] text-emerald-600 font-medium">Ready</span>
              </div>
            ))}
            {!vendors.length && <div className="px-4 py-8 text-center text-[12.5px] text-gray-400">No vendors yet</div>}
          </div>
        </Card>

        <Card>
          <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800 text-[13px] font-semibold text-gray-900 dark:text-white">My requests</div>
          <div className="divide-y divide-gray-50 dark:divide-neutral-800/50">
            {reqs.map(r => {
              const s = STATUS[r.status]
              return (
                <div key={r.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-medium text-gray-900 dark:text-white">{r.vendor_name}</div>
                    <div className="text-[11.5px] text-gray-500 dark:text-neutral-400 mono">{r.vendor_email}</div>
                  </div>
                  <span className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border ${s.c}`}>
                    <s.Icon width={12} height={12}/> {r.status}
                  </span>
                </div>
              )
            })}
            {!reqs.length && <div className="px-4 py-8 text-center text-[12.5px] text-gray-400">No requests yet</div>}
          </div>
        </Card>
      </div>
    </div>
  )
}

// ── Bundle Viewer ────────────────────────────────────────────────────────────
function BundleList() {
  const navigate = useNavigate()
  const [qs, setQs] = useState(null)

  useEffect(() => {
    api.get('/questionnaires').then(r => {
      // Only questionnaires that actually have a submission/Tessera
      setQs((r.data || []).filter(q => q.status && q.status !== 'pending'))
    }).catch(() => setQs([]))
  }, [])

  if (qs === null) return <Card className="p-12 text-center"><p className="text-[13px] text-gray-400">Loading…</p></Card>
  if (!qs.length) return (
    <Card className="p-12 text-center">
      <p className="text-[13px] text-gray-400 mb-1">No submitted Tesseras yet.</p>
      <p className="text-[12px] text-gray-400">Bundles appear here once a vendor signs and submits a questionnaire.</p>
    </Card>
  )

  return (
    <div className="max-w-4xl mx-auto space-y-3">
      <div className="flex items-center justify-between px-1 mb-1">
        <span className="text-[12px] font-medium text-gray-400 uppercase tracking-wide">
          {qs.length} bundle{qs.length !== 1 ? 's' : ''}
        </span>
      </div>
      {qs.map(q => {
        const dotColor = {
          submitted: 'bg-blue-500', under_review: 'bg-amber-500',
          in_remediation: 'bg-orange-500', closed: 'bg-emerald-500',
        }[q.status] || 'bg-gray-400'
        const vinitials = (q.vendor_name || '??').slice(0,2).toUpperCase()
        return (
          <Card key={q.id} className="group px-5 py-4 flex items-center gap-4 hover:border-blue-300 dark:hover:border-blue-500/40 hover:shadow-sm transition-all cursor-pointer"
            onClick={() => navigate(`/auditor/bundle?q=${q.id}`)}>
            {/* Vendor avatar */}
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-[14px] font-bold flex-shrink-0 shadow-sm">
              {vinitials}
            </div>
            {/* Title + meta */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[14px] font-semibold text-gray-900 dark:text-white truncate">{q.title}</span>
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full ${STAGE_TAG[q.status]||'bg-gray-100 text-gray-600'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`}/>
                  {(STAGE_LABEL[q.status]||q.status).replace(/_/g,' ')}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-gray-400">
                {q.vendor_name && <span className="font-medium text-gray-500 dark:text-neutral-400">{q.vendor_name}</span>}
                {q.deadline && <><span>·</span><span>due {new Date(q.deadline).toLocaleDateString()}</span></>}
              </div>
            </div>
            {/* Inspect affordance */}
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-blue-600 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
              Inspect <IconArrowRight width={15} height={15}/>
            </span>
          </Card>
        )
      })}
    </div>
  )
}

function BundleViewer() {
  const loc = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const modal = useModal()
  const { org } = useAuth()
  const canClose_priv = org?.is_privileged || ['super_admin','ca_admin','admin'].includes(org?.role)
  const [searchParams] = useSearchParams()
  const qId = searchParams.get('q')

  const [meta, setMeta] = useState(null)        // questionnaire detail
  const [tessera, setTessera] = useState(null)
  const [rounds, setRounds] = useState([])      // all Tesseras (version history)
  const [answers, setAnswers] = useState([])
  const [verify, setVerify] = useState(null)
  const [empty, setEmpty] = useState(false)
  const [flagMode, setFlagMode] = useState(false)
  const [flags, setFlags] = useState({})        // { question_id: { reasons:[], comment:'' } }
  const [busy, setBusy] = useState('')
  const [reasons, setReasons] = useState([])
  const [anatomyOpen, setAnatomyOpen] = useState(false)  // collapsible Tessera anatomy

  const loadTessera = async (tid) => {
    try {
      const t = await api.get(`/tesseras/${tid}`).then(r => r.data)
      setTessera(t); setAnswers(t?.answers || []); setVerify(null)
    } catch (e) {
      setTessera(null); setEmpty(true)
      toast.error('Could not load this Tessera.')
    }
  }

  const load = async () => {
    if (!qId) { setEmpty(true); return }
    setEmpty(false); setTessera(null)
    try {
      const q = await api.get(`/questionnaires/${qId}`).then(r => r.data).catch(() => null)
      setMeta(q)
      const ts = await api.get(`/questionnaires/${qId}/tesseras`).then(r => r.data).catch(() => [])
      if (ts.length) {
        const sorted = [...ts].sort((a,b) => (a.remediation_round||0) - (b.remediation_round||0))
        setRounds(sorted)
        await loadTessera(sorted[sorted.length-1].tessera_id)
      } else { setEmpty(true) }
    } catch (e) {
      console.error('BundleViewer load error:', e)
      toast.error('Could not load this bundle.')
      setEmpty(true)
    }
  }

  useEffect(() => { load(); api.get('/remediation/reasons').then(r => setReasons(r.data.reasons)).catch(()=>{}) }, [qId])

  const downloadTessera = async () => {
    try {
      const res = await api.get(`/tesseras/${tessera.id}/download`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `attestr_${tessera.id.slice(0,8)}.tessera`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      toast.success('Tessera downloaded.')
    } catch (e) { toast.error('Could not download the Tessera.') }
  }

  const runVerify = async () => {
    if (!tessera) return
    setBusy('verify')
    try {
      const { data } = await api.post(`/tesseras/${tessera.id}/verify`)
      setVerify(data)
      toast[data.overall_valid ? 'success' : 'error'](
        data.overall_valid ? 'All cryptographic checks passed.' : 'Verification failed — see the failing layer.',
        { title: 'Tessera verification' })
    } catch (e) { toast.error(e.response?.data?.detail || 'Verification failed.') }
    finally { setBusy('') }
  }

  const toggleFlag = (qid) => {
    setFlags(f => {
      const next = { ...f }
      if (next[qid]) delete next[qid]
      else next[qid] = { reasons: [], comment: '' }
      return next
    })
  }
  const setFlagReason = (qid, reason) => setFlags(f => {
    const cur = f[qid] || { reasons: [], comment: '' }
    const has = cur.reasons.includes(reason)
    return { ...f, [qid]: { ...cur, reasons: has ? cur.reasons.filter(r => r !== reason) : [...cur.reasons, reason] } }
  })
  const setFlagComment = (qid, comment) => setFlags(f => ({ ...f, [qid]: { ...(f[qid]||{reasons:[]}), comment } }))

  const downloadAnswerFile = async (path) => {
    try {
      const r = await api.get(path, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([r.data]))
      const a = document.createElement('a')
      a.href = url; a.download = path.split('/').pop()
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch { toast.error('Could not download file.') }
  }

  const submitFlags = async () => {
    const flagList = Object.entries(flags).map(([question_id, v]) => ({ question_id, reasons: v.reasons, comment: v.comment }))
    if (!flagList.length) { toast.error('Flag at least one answer first.'); return }
    setBusy('flag')
    try {
      await api.post('/remediation/flag', { tessera_id: tessera.id, flags: flagList })
      toast.success(`${flagList.length} answer(s) flagged. Vendor notified for remediation.`, { title: 'Remediation requested' })
      setFlagMode(false); setFlags({}); load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not send remediation request.') }
    finally { setBusy('') }
  }

  const closeQuestionnaire = async () => {
    const ok = await modal.confirm({
      title: 'Close this questionnaire?',
      body: 'This finalizes the compliance cycle. The vendor will no longer be able to submit changes.',
      confirmLabel: 'Close cycle',
    })
    if (!ok) return
    setBusy('close')
    try {
      await api.post(`/remediation/close/${qId}`)
      toast.success('Questionnaire cycle closed.', { title: 'Closed' })
      load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to close.') }
    finally { setBusy('') }
  }

  if (!qId) return <BundleList />
  if (empty) return (
    <Card className="p-12 text-center">
      <p className="text-[13px] text-gray-400 mb-3">No Tessera submitted yet for this questionnaire.</p>
      <button onClick={() => navigate('/auditor/bundle')} className="text-[12.5px] text-blue-600 hover:underline">← All bundles</button>
    </Card>
  )
  if (!tessera) return <Card className="p-12 text-center"><p className="text-[13px] text-gray-400">Loading…</p></Card>

  const status = meta?.status || tessera.verification_status
  // ALL auditors can flag answers for remediation (their core job).
  // Only privileged auditors / super-admins can close the cycle (final sign-off).
  const canFlag  = status && ['submitted', 'under_review'].includes(status)
  const canClose = status && status !== 'closed' && canClose_priv

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <button onClick={() => navigate('/auditor/bundle')} className="text-[12.5px] text-gray-500 hover:text-gray-700 dark:hover:text-neutral-300">← All bundles</button>
      {/* Header */}
      <Card className="px-5 py-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-[14px] font-bold flex-shrink-0 shadow-sm">
            {(meta?.vendor_name || tessera.vendor_name || '??').slice(0,2).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white">{meta?.title}</h2>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STAGE_TAG[status]||'bg-gray-100 text-gray-600'}`}>{(STAGE_LABEL[status]||status||'').replace(/_/g,' ')}</span>
            </div>
            <div className="flex items-center gap-2 text-[11.5px] text-gray-400">
              <span>Vendor: <span className="text-gray-600 dark:text-neutral-300 font-medium">{meta?.vendor_name || tessera.vendor_name || '—'}</span></span>
              {tessera.bundle?.bundle_id && <><span>·</span><span className="mono">{tessera.bundle.bundle_id.slice(0,18)}…</span></>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadTessera}
            className="flex items-center gap-1.5 text-[12px] font-medium border border-gray-200 dark:border-neutral-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-neutral-800 text-gray-600 dark:text-neutral-300">
            <IconDownload width={14} height={14}/> .tessera
          </button>
          <button onClick={runVerify} disabled={busy==='verify'}
            className="text-[12.5px] font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg disabled:opacity-50">
            {busy==='verify' ? 'Verifying…' : 'Verify Tessera'}
          </button>
          {canClose && (
            <button onClick={closeQuestionnaire} disabled={busy==='close'}
              className="text-[12.5px] font-semibold border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 px-3.5 py-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-500/10 disabled:opacity-50">
              Close cycle
            </button>
          )}
        </div>
      </div>
      </Card>

      {/* Version history — remediation rounds */}
      {rounds.length > 1 && (
        <Card className="px-4 py-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[12px] font-semibold text-gray-900 dark:text-white">Version history</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {rounds.map(r => {
                const active = tessera && r.tessera_id === tessera.id
                return (
                  <button key={r.tessera_id} onClick={() => loadTessera(r.tessera_id)}
                    className={`text-[11.5px] font-medium px-2.5 py-1 rounded-lg border transition-colors ${active ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800'}`}>
                    {r.remediation_round === 0 ? 'Original' : `Round ${r.remediation_round}`}
                    <span className="opacity-60 ml-1.5">{new Date(r.created_at).toLocaleDateString()}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Cryptographic verification — six checks in a 3×2 grid */}
      <Card>
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between">
          <div>
            <span className="text-[13px] font-semibold text-gray-900 dark:text-white">Cryptographic verification</span>
            <div className="text-[11px] text-gray-400 mt-0.5">Six independent checks, each provable against the bundle itself</div>
          </div>
          {verify && <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border ${verify.overall_valid ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400'}`}>{verify.overall_valid ? 'All checks passed' : 'Verification failed'}</span>}
        </div>
        <div className="p-5">
          {!verify ? (
            <div className="py-8 text-center">
              <p className="text-[12.5px] text-gray-400">Click "Verify Tessera" above to run all six cryptographic checks against this bundle.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                ['Certificate chain', verify.cert_valid, 'Vendor certificate is signed by the Attestr CA and not expired.'],
                ['Revocation (CRL)', verify.crl_valid, 'The certificate serial is not on the revocation list.'],
                ['ECDSA signature', verify.ecdsa_valid, 'The signature over the Merkle root verifies against the vendor public key.'],
                ['Merkle proofs', verify.merkle_valid, 'Every answer hash recomputes and the tree resolves to the signed root.'],
                ['RFC 3161 timestamp', verify.timestamp_valid, 'The trusted timestamp token over the root is valid.'],
                ['Bundle integrity', verify.integrity_valid, 'All required cryptographic artifacts are present in the sealed bundle.'],
              ].map(([l, ok, desc], i) => (
                <div key={l} className={`flex items-start gap-3 p-3 rounded-xl border ${ok ? 'border-emerald-100 bg-emerald-50/40 dark:border-emerald-500/20 dark:bg-emerald-500/5' : 'border-red-100 bg-red-50/40 dark:border-red-500/20 dark:bg-red-500/5'}`}
                  style={{ animation: `revealStep 0.3s ease ${i*0.09}s both` }}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'}`}>
                    {ok ? <IconCheck width={12} height={12}/> : <IconX width={12} height={12}/>}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-semibold text-gray-900 dark:text-white">{l}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${ok ? 'text-emerald-700 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-500/15' : 'text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-500/15'}`}>{ok ? 'PASS' : 'FAIL'}</span>
                    </div>
                    <div className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1 leading-snug">{desc}</div>
                  </div>
                </div>
              ))}
              <style>{`@keyframes revealStep{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`}</style>
            </div>
          )}
        </div>
      </Card>

      {/* Interactive Merkle tree — privileged viewers only, full-width row below */}
      {verify && tessera.can_see_internals && verify.merkle_details?.tree && (
        <Card>
          <div className="px-5 py-3.5 border-b border-gray-100 dark:border-neutral-800">
            <span className="text-[13px] font-semibold text-gray-900 dark:text-white">Merkle tree</span>
            <div className="text-[11px] text-gray-400 mt-0.5">Each answer hashes to a leaf; tampering turns its path to the root red</div>
          </div>
          <div className="p-5 overflow-x-auto">
            <MerkleVisualizer
              tree={verify.merkle_details.tree}
              failedIndices={verify.merkle_details.failed_indices || []}
              answers={verify.merkle_details.answers || []}
              isValid={verify.merkle_valid}
            />
          </div>
        </Card>
      )}

      {/* Tessera anatomy — privileged viewers only, collapsible (can be large) */}
      {tessera.can_see_internals ? (
        <div>
          <button onClick={() => setAnatomyOpen(o => !o)}
            className="w-full flex items-center gap-2 mb-3 mt-1 group">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              className={`text-gray-400 transition-transform ${anatomyOpen ? 'rotate-90' : ''}`}>
              <polyline points="9 6 15 12 9 18"/>
            </svg>
            <h3 className="text-[13.5px] font-semibold text-gray-900 dark:text-white">Tessera anatomy</h3>
            <span className="text-[11px] text-gray-400">— the actual values inside this sealed bundle</span>
            <span className="ml-auto text-[11px] font-medium text-blue-600 dark:text-blue-400 group-hover:underline">
              {anatomyOpen ? 'Hide' : 'Show'}
            </span>
          </button>
          {anatomyOpen && <TesseraInspector tessera={tessera}/>}
        </div>
      ) : (
        <div className="bg-gray-50 dark:bg-neutral-900/50 border border-gray-200 dark:border-neutral-800 rounded-xl p-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-neutral-800 flex items-center justify-center text-gray-400 flex-shrink-0">
            <IconShield width={18} height={18}/>
          </div>
          <div>
            <div className="text-[13px] font-semibold text-gray-900 dark:text-white">Tessera anatomy is restricted</div>
            <div className="text-[12px] text-gray-500 dark:text-neutral-400">The raw cryptographic artifacts are available to privileged auditors and admins. You can still run verification above.</div>
          </div>
        </div>
      )}

      {/* Submitted answers */}
      <Card>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-gray-900 dark:text-white">Submitted answers <span className="text-gray-400 font-normal">({answers.length})</span></span>
          {canFlag && (
            flagMode ? (
              <div className="flex gap-2">
                <button onClick={() => { setFlagMode(false); setFlags({}) }} className="text-[12px] font-medium text-gray-500 hover:text-gray-700">Cancel</button>
                <button onClick={submitFlags} disabled={busy==='flag'}
                  className="text-[12px] font-semibold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
                  {busy==='flag' ? 'Sending…' : `Request remediation (${Object.keys(flags).length})`}
                </button>
              </div>
            ) : (
              <button onClick={() => setFlagMode(true)}
                className="text-[12px] font-medium border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 px-3 py-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-500/10">
                Flag answers for remediation
              </button>
            )
          )}
        </div>
        <div className="divide-y divide-gray-50 dark:divide-neutral-800/50">
          {answers.map(a => {
            const flagged = !!flags[a.question_id]
            return (
              <div key={a.question_id} className={`px-4 py-3.5 ${flagged ? 'bg-amber-50/50 dark:bg-amber-500/5' : ''}`}>
                <div className="flex items-start gap-3">
                  {flagMode && (
                    <input type="checkbox" checked={flagged} onChange={() => toggleFlag(a.question_id)} className="mt-1 accent-amber-500"/>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="mono text-[10.5px] text-gray-400">{a.question_id}</span>
                    </div>
                    <div className="text-[13px] text-gray-700 dark:text-neutral-300 mb-1">{a.question_text}</div>
                    <div className="flex items-center gap-2">
                      {a.answer_type === 'file_attachment'
                        ? a.answer_value
                          ? <button onClick={() => downloadAnswerFile(a.answer_value)}
                              className="text-[12.5px] font-semibold text-blue-600 hover:text-blue-700 underline flex items-center gap-1">
                              <IconDownload width={13} height={13}/> {(a.display_name || a.answer_value).split('/').pop()}
                            </button>
                          : <span className="text-gray-300 italic text-[12.5px] font-normal">no file uploaded</span>
                        : <span className="text-[12.5px] font-semibold text-gray-900 dark:text-white">{a.answer_value || <span className="text-gray-300 italic font-normal">no answer</span>}</span>
                      }
                      {a.evidence_note && <span className="text-[11.5px] text-gray-400">· {a.evidence_note}</span>}
                    </div>

                    {flagged && flags[a.question_id] && (
                      <div className="mt-3 pl-1 space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          {reasons.map(r => (
                            <button key={r} onClick={() => setFlagReason(a.question_id, r)}
                              className={`text-[10.5px] px-2 py-1 rounded-md border transition-colors ${(flags[a.question_id]?.reasons||[]).includes(r) ? 'bg-amber-500 text-white border-amber-500' : 'bg-white dark:bg-neutral-800 border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-neutral-300'}`}>
                              {r}
                            </button>
                          ))}
                        </div>
                        <input value={flags[a.question_id]?.comment || ''} onChange={e => setFlagComment(a.question_id, e.target.value)}
                          placeholder="Comment for the vendor (optional)"
                          className="w-full text-[12px] bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400 text-gray-700 dark:text-neutral-300"/>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {!answers.length && <div className="px-4 py-10 text-center text-[13px] text-gray-400">No answers found for this Tessera.</div>}
        </div>
      </Card>
    </div>
  )
}

export default function AuditorDashboard() {
  const loc = useLocation()
  const titles = {
    '/auditor': ['Pipeline', 'Track every compliance cycle'],
    '/auditor/new': ['New questionnaire', 'Send SOC 2 or ISO 27001 to a vendor'],
    '/auditor/vendors': ['Vendors', 'Request and manage vendor onboarding'],
    '/auditor/bundle': ['Bundle viewer', 'Verify submitted Tesseras'],
    '/auditor/verify': ['Offline verify', 'Re-verify any .tessera file with zero server trust'],
    '/auditor/trust': ['Trust Center', 'Architecture & cryptographic performance'],
    '/auditor/team': ['My team', 'Your workspace and teammates'],
  }
  const [title, subtitle] = titles[loc.pathname] || titles['/auditor']
  const actions = loc.pathname === '/auditor' ? (
    <NewButton />
  ) : null

  return (
    <AppLayout title={title} subtitle={subtitle} actions={actions}>
      <Routes>
        <Route index element={<Pipeline />} />
        <Route path="new" element={<NewQuestionnaire />} />
        <Route path="vendors" element={<Vendors />} />
        <Route path="bundle" element={<BundleViewer />} />
        <Route path="verify" element={<OfflineVerifier embedded />} />
        <Route path="trust" element={<TrustCenter />} />
        <Route path="team" element={<MyTeamPage />} />
      </Routes>
    </AppLayout>
  )
}

function NewButton() {
  const navigate = useNavigate()
  return (
    <button onClick={() => navigate('/auditor/new')}
      className="flex items-center gap-1.5 text-[12.5px] font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-lg transition-colors">
      <IconPlus width={15} height={15}/> New questionnaire
    </button>
  )
}

