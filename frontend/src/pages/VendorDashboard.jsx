import { useState, useEffect } from 'react'
import api from '../lib/api'
import AppLayout from '../components/Layout/AppLayout'
import { useToast } from '../components/Shared/Toast'
import { IconArrowRight, IconCheck, IconClock, IconDownload } from '../components/Layout/icons'
import MyTeamPage from './MyTeamPage'

const STATUS = {
  pending:        'bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-neutral-300',
  submitted:      'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  under_review:   'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  in_remediation: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400',
  closed:         'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
}
const BOOL = ['Yes','No','Partial','N/A']

function Card({ children, className='' }) {
  return <div className={`bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800 ${className}`}>{children}</div>
}

export default function VendorDashboard() {
  const onTeam = typeof window !== 'undefined' && window.location.pathname.startsWith('/vendor/team')
  const toast = useToast()
  const [qs, setQs] = useState([])
  const [view, setView] = useState('list')  // list | fill | done
  const [detail, setDetail] = useState(null)
  const [answers, setAnswers] = useState({})
  const [flags, setFlags] = useState({})       // { question_id: { reasons, comment } }
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => { load() }, [])
  const load = async () => { const { data } = await api.get('/questionnaires').catch(() => ({data:[]})); setQs(data) }

  const open = async (q) => {
    const { data } = await api.get(`/questionnaires/${q.id}`)
    const prefilled = {}
    if (data.existing_answers) {
      for (const [qid, v] of Object.entries(data.existing_answers)) {
        prefilled[qid] = { answer_value: v.answer_value, evidence_note: v.evidence_note }
      }
    }
    // If in remediation, fetch the flagged answers so we can highlight them
    let flagMap = {}
    if (q.status === 'in_remediation') {
      const ts = await api.get(`/questionnaires/${q.id}/tesseras`).then(r => r.data).catch(() => [])
      if (ts.length) {
        const fl = await api.get(`/remediation/${ts[ts.length-1].tessera_id}/flags`).then(r => r.data).catch(() => null)
        if (fl?.flags) fl.flags.forEach(f => { flagMap[f.question_id] = { reasons: f.reasons, comment: f.comment } })
      }
    }
    setDetail(data); setAnswers(prefilled); setFlags(flagMap); setResult(null); setView('fill')
  }

  const setAns = (qid, v) => setAnswers(p => ({ ...p, [qid]: { ...p[qid], answer_value: v } }))
  const setNote = (qid, v) => setAnswers(p => ({ ...p, [qid]: { ...p[qid], evidence_note: v } }))
  const payload = () => (detail?.questions||[]).map(q => ({
    question_id:q.question_id, question_text:q.question_text,
    answer_value: answers[q.question_id]?.answer_value || '',
    answer_type:q.question_type, evidence_note: answers[q.question_id]?.evidence_note || '',
  }))

  const saveDraft = async () => {
    setBusy(true)
    try { await api.post(`/questionnaires/${detail.id}/draft`, { answers: payload() }); toast.success('Draft saved.') }
    catch (e) { toast.error(e.response?.data?.detail || 'Could not save draft.') }
    finally { setBusy(false) }
  }
  const submit = async () => {
    const missing = (detail?.questions||[]).filter(q => q.is_required && !answers[q.question_id]?.answer_value)
    if (missing.length) { toast.error(`${missing.length} required question(s) still unanswered.`); return }
    setBusy(true)
    try { const { data } = await api.post(`/questionnaires/${detail.id}/submit`, { answers: payload() }); setResult(data); setView('done'); load() }
    catch (e) { toast.error(e.response?.data?.detail || 'Submission failed.', { title: 'Could not submit' }) }
    finally { setBusy(false) }
  }

  const answered = Object.keys(answers).filter(k => answers[k]?.answer_value).length
  const total = detail?.questions?.length || 0
  const pct = total ? answered/total*100 : 0

  if (onTeam) return (
    <AppLayout title="My team" subtitle="Your workspace and teammates">
      <MyTeamPage />
    </AppLayout>
  )

  return (
    <AppLayout
      title={view === 'fill' && detail ? detail.title : 'My questionnaires'}
      subtitle={view === 'fill' ? `${total} questions` : 'Compliance questionnaires assigned to you'}
    >
      {view === 'list' && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            {[
              { v: qs.length, l: 'Assigned to you' },
              { v: qs.filter(q => q.status === 'pending').length, l: 'Awaiting response' },
              { v: qs.filter(q => q.status !== 'pending').length, l: 'Submitted' },
            ].map(s => (
              <div key={s.l} className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800 p-4">
                <div className="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">{s.v}</div>
                <div className="text-[11.5px] text-gray-500 dark:text-neutral-500 mt-1">{s.l}</div>
              </div>
            ))}
          </div>
          <div className="space-y-2.5">
          {!qs.length ? (
            <Card className="p-12 text-center"><p className="text-[13px] text-gray-400">No questionnaires assigned yet.</p></Card>
          ) : qs.map(q => (
            <Card key={q.id} className="px-5 py-4 flex items-center justify-between hover:border-gray-300 dark:hover:border-neutral-700 transition-colors">
              <div>
                <div className="text-[13.5px] font-semibold text-gray-900 dark:text-white mb-1.5">{q.title}</div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{q.type}</span>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${STATUS[q.status]||STATUS.pending}`}>{q.status.replace(/_/g,' ')}</span>
                  {q.deadline && <span className="text-[11.5px] text-gray-400">Due {new Date(q.deadline).toLocaleDateString()}</span>}
                </div>
              </div>
              <button onClick={() => open(q)} className="flex items-center gap-1.5 text-[12.5px] font-semibold text-blue-600 hover:text-blue-700">
                {q.status === 'pending' ? 'Start answering' : q.status === 'in_remediation' ? 'Fix flagged answers' : q.status === 'closed' ? 'View (closed)' : 'View (sealed)'} <IconArrowRight width={15} height={15}/>
              </button>
            </Card>
          ))}
          </div>
        </div>
      )}

      {view === 'fill' && detail && (
        <div className="max-w-2xl">
          <button onClick={() => setView('list')} className="text-[12.5px] text-gray-500 hover:text-gray-700 mb-4">← Back</button>

          {detail.auditor_name && (
            <div className="text-[12px] text-gray-400 mb-3">Requested by <span className="text-gray-600 dark:text-neutral-300 font-medium">{detail.auditor_name}</span></div>
          )}

          {Object.keys(flags).length > 0 && (
            <div className="bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 rounded-xl px-4 py-3 mb-4">
              <div className="text-[12.5px] font-semibold text-orange-800 dark:text-orange-400 mb-0.5">Remediation requested</div>
              <div className="text-[12px] text-orange-700 dark:text-orange-500/80">The auditor flagged {Object.keys(flags).length} answer(s) below. Update them and re-submit.</div>
            </div>
          )}

          <Card className="px-4 py-3 mb-4 flex items-center gap-4 sticky top-16 z-30">
            <div className="flex-1 h-1.5 bg-gray-100 dark:bg-neutral-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width:`${pct}%` }}/>
            </div>
            <span className="text-[12px] text-gray-500 dark:text-neutral-400 whitespace-nowrap">{answered} / {total}</span>
            {!['closed','submitted','under_review'].includes(detail.status) ? (<>
            <button onClick={saveDraft} disabled={busy} className="text-[12px] font-medium border border-gray-200 dark:border-neutral-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-neutral-800 disabled:opacity-50">Save draft</button>
            <button onClick={submit} disabled={busy} className="text-[12.5px] font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg disabled:opacity-50">{busy ? 'Signing…' : 'Sign & submit'}</button>
            </>) : (
            <span className="text-[11.5px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 px-3 py-1.5 rounded-lg">{detail.status === 'closed' ? 'Cycle closed — read only' : 'Sealed & submitted — editable only if the auditor flags answers'}</span>
            )}
          </Card>
          <div className="space-y-3">
            {detail.questions.map(q => {
              const flag = flags[q.question_id]
              const inRemediation = detail.status === 'in_remediation'
              const isSealed = ['closed','submitted','under_review'].includes(detail.status)
              const locked = isSealed || (inRemediation && !flag)   // sealed = all locked; remediation = only flagged editable
              return (
              <Card key={q.id} className={`p-4 ${flag ? 'border-orange-300 dark:border-orange-500/40' : ''} ${locked ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="mono text-[10.5px] text-gray-400">{q.question_id}</span>
                  {locked && <span className="text-[10px] font-medium text-gray-400 flex items-center gap-1">{inRemediation ? 'locked · accepted' : 'locked · sealed'}</span>}
                </div>
                <div className="text-[13.5px] font-medium text-gray-900 dark:text-white mb-3">{q.question_text}{q.is_required && <span className="text-red-500 ml-1">*</span>}</div>
                {flag && (
                  <div className="mb-3 bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/30 rounded-lg px-3 py-2">
                    <div className="text-[11px] font-semibold text-orange-700 dark:text-orange-400 mb-1">Flagged for remediation</div>
                    {flag.reasons?.length > 0 && <div className="flex flex-wrap gap-1 mb-1">{flag.reasons.map(r => <span key={r} className="text-[10px] bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300 px-1.5 py-0.5 rounded">{r}</span>)}</div>}
                    {flag.comment && <div className="text-[11.5px] text-orange-700 dark:text-orange-500/80">{flag.comment}</div>}
                  </div>
                )}
                {q.question_type === 'boolean' && (
                  <div className="flex gap-2 mb-3">
                    {BOOL.map(o => (
                      <button key={o} disabled={locked} onClick={() => setAns(q.question_id, o)}
                        className={`px-4 py-1.5 rounded-lg text-[12.5px] font-medium border transition-colors disabled:cursor-not-allowed ${answers[q.question_id]?.answer_value === o ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-neutral-800 text-gray-600 dark:text-neutral-300 border-gray-200 dark:border-neutral-700 hover:border-gray-300'}`}>{o}</button>
                    ))}
                  </div>
                )}
                {q.question_type === 'free_text' && (
                  <textarea disabled={locked} value={answers[q.question_id]?.answer_value || ''} onChange={e => setAns(q.question_id, e.target.value)} rows={2} placeholder="Your answer..."
                    className="w-full text-[13px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2 text-gray-900 dark:text-white disabled:cursor-not-allowed"/>
                )}
                {q.question_type === 'numeric' && (
                  <input type="number" disabled={locked} value={answers[q.question_id]?.answer_value || ''} onChange={e => setAns(q.question_id, e.target.value)} placeholder="0"
                    className="w-full text-[13px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2 text-gray-900 dark:text-white disabled:cursor-not-allowed"/>
                )}
                {q.question_type === 'file_attachment' && (
                  <div className="mb-2">
                    <label className={`flex items-center gap-2 text-[12.5px] border border-dashed border-gray-300 dark:border-neutral-700 rounded-lg px-3 py-2.5 cursor-pointer hover:border-blue-400 ${locked ? 'pointer-events-none opacity-60' : ''}`}>
                      <IconDownload width={14} height={14} className="rotate-180 text-gray-400"/>
                      <span className="text-gray-500 dark:text-neutral-400 truncate max-w-xs">
                        {answers[q.question_id]?.answer_value
                          ? (answers[q.question_id]?.display_name || answers[q.question_id].answer_value)
                          : 'Choose a file to attach…'}
                      </span>
                      <input type="file" disabled={locked} className="hidden"
                        onChange={async e => {
                          const f = e.target.files[0]; if (!f) return
                          const fd = new FormData()
                          fd.append('file', f); fd.append('question_id', q.question_id)
                          try {
                            const r = await api.post(
                              `/questionnaires/${detail.id}/answers/upload`, fd,
                              { headers: { 'Content-Type': 'multipart/form-data' } }
                            )
                            setAns(q.question_id, r.data.download_path)
                            setAnswers(prev => ({ ...prev, [q.question_id]: { ...(prev[q.question_id]||{}), answer_value: r.data.download_path, display_name: r.data.filename } }))
                          } catch { toast.error('File upload failed.') }
                        }}/>
                    </label>
                    <p className="text-[10.5px] text-gray-400 mt-1">File is stored and auditors can download it from the bundle viewer.</p>
                  </div>
                )}
                <input disabled={locked} value={answers[q.question_id]?.evidence_note || ''} onChange={e => setNote(q.question_id, e.target.value)} placeholder="Evidence note (optional)"
                  className="w-full text-[12px] border border-gray-100 dark:border-neutral-800 rounded-lg px-3 py-1.5 text-gray-500 dark:text-neutral-400 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-300 bg-transparent disabled:cursor-not-allowed"/>
              </Card>
              )
            })}
          </div>
        </div>
      )}

      {view === 'done' && result && (
        <Card className="max-w-md mx-auto mt-8 p-8 text-center">
          <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-600">
            <IconCheck width={24} height={24}/>
          </div>
          <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-2">Submitted</h2>
          <p className="text-[13px] text-gray-500 dark:text-neutral-400 mb-4">Tessera assembled and delivered to the auditor.</p>
          <div className="mono text-[10.5px] text-gray-400 bg-gray-50 dark:bg-neutral-800 rounded-lg p-3 mb-4 break-all">{result.bundle_id}</div>
          <button onClick={() => setView('list')} className="text-[12.5px] text-blue-600 hover:underline">Back to questionnaires</button>
        </Card>
      )}
    </AppLayout>
  )
}
