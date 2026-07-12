import { useState, useEffect } from 'react'
import api from '../lib/api'
import { useToast } from '../components/Shared/Toast'
import { useModal } from '../components/Shared/Modal'

function Card({ children, className='' }) {
  return <div className={`bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl ${className}`}>{children}</div>
}

const KIND_BADGE = {
  auditor:'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400',
  vendor:'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400',
}
const AVATAR = { auditor:'bg-blue-600', vendor:'bg-emerald-600' }

export default function WorkspacesManagement() {
  const toast = useToast()
  const modal = useModal()
  const [workspaces, setWorkspaces] = useState([])
  const [unassigned, setUnassigned] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name:'', kind:'auditor' })
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(null)

  const load = async () => {
    setLoading(true)
    const [ws, users] = await Promise.all([
      api.get('/workspaces').then(r => r.data).catch(() => []),
      api.get('/users').then(r => r.data).catch(() => []),
    ])
    setWorkspaces(ws)
    // orgs that could be assigned: auditors/vendors not already in a workspace
    setUnassigned(users.filter(u => (u.role === 'auditor' || u.role === 'vendor')))
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const create = async () => {
    if (!form.name.trim()) { toast.error('Give the workspace a name.'); return }
    setBusy(true)
    try {
      await api.post('/workspaces', form)
      toast.success('Workspace created.')
      setShowCreate(false); setForm({ name:'', kind:'auditor' }); load()
    } catch (e) { toast.error(e.response?.data?.detail || 'Could not create workspace.') }
    finally { setBusy(false) }
  }

  const assign = async (wsId, orgId) => {
    try { await api.post(`/workspaces/${wsId}/assign/${orgId}`); toast.success('Member assigned.'); load() }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not assign.') }
  }
  const makeAdmin = async (wsId, orgId, name) => {
    try { await api.post(`/workspaces/${wsId}/admin/${orgId}`); toast.success(`${name} is now the workspace admin.`); load() }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not set admin.') }
  }

  if (loading) return <div className="text-[13px] text-gray-400 py-10 text-center">Loading…</div>

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-[12.5px] text-gray-500 dark:text-neutral-400 max-w-xl leading-relaxed">
          Group auditors into teams (firms). Vendors are assigned to auditor workspaces — they don't have their own workspace. Teammates can view each other's work; designate one member as workspace admin so they can invite teammates.
        </p>
        <button onClick={() => setShowCreate(s => !s)}
          className="text-[12.5px] font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex-shrink-0">
          {showCreate ? 'Cancel' : '＋ New workspace'}
        </button>
      </div>

      {showCreate && (
        <Card className="p-5 space-y-3 border-blue-200 dark:border-blue-500/30">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400 mb-1">Workspace name</label>
              <input value={form.name} onChange={e => setForm({...form, name:e.target.value})} placeholder="e.g. Deloitte Audit"
                className="w-full text-[13px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"/>
              <p className="text-[11px] text-gray-400 mt-1.5">Auditor team. Vendors are assigned to it separately.</p>
            </div>
          </div>
          <button onClick={create} disabled={busy}
            className="text-[12.5px] font-semibold bg-gray-900 dark:bg-white dark:text-neutral-900 text-white px-4 py-2 rounded-lg disabled:opacity-50">
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
        </Card>
      )}

      {workspaces.length === 0 && (
        <Card className="p-12 text-center">
          <p className="text-[13px] text-gray-400 mb-1">No workspaces yet.</p>
          <p className="text-[12px] text-gray-400">Create one to group auditors or vendors into a team.</p>
        </Card>
      )}

      <div className="space-y-3">
        {workspaces.map(ws => {
          // Auditor members with same kind; plus vendors can be assigned to auditor workspaces
          const candidates = unassigned.filter(u => u.role === ws.kind && !ws.members.some(m => m.id === u.id))
          const vendorCandidates = ws.kind === 'auditor'
            ? unassigned.filter(u => u.role === 'vendor' && !(ws.vendors||[]).some(v => v.id === u.id))
            : []
          const isOpen = expanded === ws.id
          return (
            <Card key={ws.id} className="overflow-hidden">
              <div className="px-5 py-4 flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(isOpen ? null : ws.id)}>
                <div className={`w-9 h-9 rounded-lg ${AVATAR[ws.kind]} flex items-center justify-center text-white text-[12px] font-bold`}>{ws.name.slice(0,2).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-gray-900 dark:text-white">{ws.name}</span>
                    <span className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded border ${KIND_BADGE[ws.kind]}`}>{ws.kind} firm</span>
                  </div>
                  <div className="text-[11.5px] text-gray-400 mt-0.5">{ws.member_count} auditor{ws.member_count!==1?'s':''}{ws.vendor_count ? ` · ${ws.vendor_count} vendor${ws.vendor_count!==1?'s':''}` : ''}</div>
                </div>
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen?'rotate-180':''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
              </div>

              {isOpen && (
                <div className="border-t border-gray-100 dark:border-neutral-800 px-5 py-4 space-y-3">
                  {/* Members */}
                  <div>
                    <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Members</div>
                    {ws.members.length === 0 && <p className="text-[12px] text-gray-400">No members yet — assign some below.</p>}
                    <div className="space-y-1.5">
                      {ws.members.filter(m => m.role === 'auditor' || m.role === 'super_admin').map(m => (
                        <div key={m.id} className="flex items-center gap-2.5 py-1">
                          <div className={`w-7 h-7 rounded-lg ${AVATAR[ws.kind]} flex items-center justify-center text-white text-[10px] font-bold`}>{m.name.slice(0,2).toUpperCase()}</div>
                          <div className="flex-1 min-w-0">
                            <span className="text-[12.5px] font-medium text-gray-900 dark:text-white">{m.name}</span>
                            {m.is_workspace_admin && <span className="ml-2 text-[10px] font-medium text-amber-600 dark:text-amber-400">workspace admin</span>}
                            {m.role === 'auditor' && m.is_privileged && <span className="ml-1.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">privileged</span>}
                          </div>
                          {!m.is_workspace_admin && (
                            <button onClick={() => makeAdmin(ws.id, m.id, m.name)} className="text-[11px] font-medium text-blue-600 hover:text-blue-700">Make admin</button>
                          )}
                        </div>
                      ))}
                    </div>

                  {/* Assigned vendors — read-only, no admin role */}
                  {(ws.vendors||[]).length > 0 && (
                    <div className="pt-2 border-t border-gray-50 dark:border-neutral-800/50">
                      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Assigned vendors</div>
                      <div className="space-y-1.5">
                        {ws.vendors.map(v => (
                          <div key={v.id} className="flex items-center gap-2.5 py-1">
                            <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center text-white text-[10px] font-bold">{v.name.slice(0,2).toUpperCase()}</div>
                            <span className="text-[12.5px] font-medium text-gray-900 dark:text-white flex-1">{v.name}</span>
                            <span className="text-[10px] text-gray-400">vendor</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  </div>

                  {/* Assign existing */}
                  {candidates.length > 0 && (
                    <div className="pt-2 border-t border-gray-50 dark:border-neutral-800/50">
                      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Add existing auditors</div>
                      <div className="flex flex-wrap gap-2">
                        {candidates.map(c => (
                          <button key={c.id} onClick={() => assign(ws.id, c.id)}
                            className="text-[11.5px] font-medium border border-gray-200 dark:border-neutral-700 rounded-lg px-2.5 py-1.5 hover:border-blue-300 hover:text-blue-600 dark:hover:border-blue-500/40">
                            + {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {vendorCandidates.length > 0 && (
                    <div className="pt-2 border-t border-gray-50 dark:border-neutral-800/50">
                      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Assign vendors to this workspace</div>
                      <p className="text-[11px] text-gray-400 mb-2">Vendors assigned here are only visible to this auditor team.</p>
                      <div className="flex flex-wrap gap-2">
                        {vendorCandidates.map(c => (
                          <button key={c.id} onClick={() => assign(ws.id, c.id)}
                            className="text-[11.5px] font-medium border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 rounded-lg px-2.5 py-1.5 hover:border-emerald-400">
                            + {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
