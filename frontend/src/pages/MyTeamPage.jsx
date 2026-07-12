import { useState, useEffect } from 'react'
import api from '../lib/api'
import { useToast } from '../components/Shared/Toast'
import { useModal } from '../components/Shared/Modal'
import { useAuth } from '../hooks/useAuth'

function Card({ children, className='' }) {
  return <div className={`bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl ${className}`}>{children}</div>
}

export default function MyTeamPage() {
  const toast = useToast()
  const modal = useModal()
  const { org } = useAuth()
  const [ws, setWs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name:'', email:'', is_privileged:false })
  const [showInvite, setShowInvite] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    const list = await api.get("/workspaces/my").then(r => r.data).catch(() => [])
    setWs(list[0] || null)   // a member only sees their own workspace
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const invite = async () => {
    if (!form.name.trim() || !form.email.trim()) { toast.error('Name and email are required.'); return }
    setBusy(true)
    try {
      const { data } = await api.post(`/workspaces/${ws.id}/invite`, form)
      await modal.reveal({
        title: 'Teammate invited',
        body: 'An enrollment link was emailed (view it in Mailhog at http://localhost:8025). They generate their own key in-browser. You can also copy the link:',
        value: data.enroll_url,
      })
      toast.success('Teammate invited.')
      setShowInvite(false); setForm({ name:'', email:'', is_privileged:false }); load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not invite.') }
    finally { setBusy(false) }
  }

  const togglePrivilege = async (m) => {
    try {
      await api.post(`/workspaces/${ws.id}/privilege/${m.id}`, { is_privileged: !m.is_privileged })
      toast.success(`${m.name} is ${!m.is_privileged ? 'now privileged' : 'no longer privileged'}.`)
      load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not change privilege.') }
  }

  if (loading) return <div className="text-[13px] text-gray-400 py-10 text-center">Loading…</div>
  if (!ws) return (
    <Card className="p-12 text-center">
      <p className="text-[13px] text-gray-400 mb-1">You're not part of a workspace yet.</p>
      <p className="text-[12px] text-gray-400">Ask the CA administrator to create one and add you.</p>
    </Card>
  )

  const isAuditor = ws.kind === 'auditor'
  const AV = isAuditor ? 'bg-blue-600' : 'bg-emerald-600'

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg ${AV} flex items-center justify-center text-white text-[12px] font-bold`}>{ws.name.slice(0,2).toUpperCase()}</div>
            <div>
              <div className="text-[14px] font-semibold text-gray-900 dark:text-white">{ws.name}</div>
              <div className="text-[11.5px] text-gray-400">{ws.member_count} member{ws.member_count!==1?'s':''} · {ws.kind} team</div>
            </div>
          </div>
        </div>
        {org?.is_workspace_admin && (
          <button onClick={() => setShowInvite(s => !s)}
            className="text-[12.5px] font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex-shrink-0">
            {showInvite ? 'Cancel' : '＋ Invite teammate'}
          </button>
        )}
      </div>

      {showInvite && org?.is_workspace_admin && (
        <Card className="p-5 space-y-3 border-blue-200 dark:border-blue-500/30">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1">Name</label>
              <input value={form.name} onChange={e => setForm({...form, name:e.target.value})}
                className="w-full text-[13px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"/>
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1">Email</label>
              <input value={form.email} onChange={e => setForm({...form, email:e.target.value})}
                className="w-full text-[13px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"/>
            </div>
          </div>
          {isAuditor && (
            <label className="flex items-center gap-2 text-[12px] text-gray-700 dark:text-neutral-300 cursor-pointer">
              <input type="checkbox" checked={form.is_privileged} onChange={e => setForm({...form, is_privileged:e.target.checked})} className="accent-blue-600"/>
              Privileged — can see Tessera anatomy &amp; Trust Center
            </label>
          )}
          <button onClick={invite} disabled={busy}
            className="text-[12.5px] font-semibold bg-gray-900 dark:bg-white dark:text-neutral-900 text-white px-4 py-2 rounded-lg disabled:opacity-50">
            {busy ? 'Inviting…' : 'Send enrollment link'}
          </button>
        </Card>
      )}

      <Card>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800 text-[13px] font-semibold text-gray-900 dark:text-white">Team members</div>
        <div className="divide-y divide-gray-50 dark:divide-neutral-800/50">
          {ws.members.map(m => (
            <div key={m.id} className="px-4 py-3 flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg ${AV} flex items-center justify-center text-white text-[11px] font-bold`}>{m.name.slice(0,2).toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-gray-900 dark:text-white">{m.name}</span>
                  {m.id === org?.org_id && <span className="text-[10px] text-gray-400">(you)</span>}
                  {m.is_workspace_admin && <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">admin</span>}
                  {m.role === 'auditor' && m.is_privileged && <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400">privileged</span>}
                </div>
                <div className="text-[11.5px] text-gray-400">{m.email}</div>
              </div>
              {/* Privileged workspace admins can manage privilege of auditor teammates */}
              {isAuditor && org?.is_workspace_admin && org?.is_privileged && m.role === 'auditor' && m.id !== org?.org_id && (
                <button onClick={() => togglePrivilege(m)}
                  className={`text-[11px] font-medium px-2 py-1 rounded-md border ${m.is_privileged
                    ? 'border-gray-200 dark:border-neutral-700 text-gray-500 hover:text-gray-700'
                    : 'border-blue-200 dark:border-blue-500/30 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10'}`}>
                  {m.is_privileged ? 'Revoke privilege' : 'Make privileged'}
                </button>
              )}
              {!m.is_active && <span className="text-[10.5px] font-medium px-2 py-1 rounded-md bg-gray-100 dark:bg-neutral-800 text-gray-500">pending / inactive</span>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
