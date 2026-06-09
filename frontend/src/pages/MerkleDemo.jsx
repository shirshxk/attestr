import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../components/Shared/Toast'
import api from '../lib/api'

const SAMPLE = [
  { question_id:'cc6.1', question_text:'Do you enforce MFA on all privileged accounts?', answer_value:'Yes', answer_type:'boolean', evidence_note:'Via Okta', answered_at:'2026-06-01T10:00:00Z' },
  { question_id:'cc6.2', question_text:'Is data encrypted at rest?', answer_value:'Yes', answer_type:'boolean', evidence_note:'AES-256', answered_at:'2026-06-01T10:01:00Z' },
  { question_id:'cc6.3', question_text:'What is your patch cadence?', answer_value:'Monthly', answer_type:'free_text', evidence_note:'', answered_at:'2026-06-01T10:02:00Z' },
  { question_id:'cc6.4', question_text:'Do you have a WAF deployed?', answer_value:'Yes', answer_type:'boolean', evidence_note:'Cloudflare', answered_at:'2026-06-01T10:03:00Z' },
  { question_id:'cc6.5', question_text:'Do you conduct annual pen tests?', answer_value:'Yes', answer_type:'boolean', evidence_note:'HackerOne', answered_at:'2026-06-01T10:04:00Z' },
  { question_id:'cc6.6', question_text:'Is access logging enabled?', answer_value:'Yes', answer_type:'boolean', evidence_note:'Datadog', answered_at:'2026-06-01T10:05:00Z' },
]

function short(h){ return h ? h.slice(0,6)+'…'+h.slice(-4) : '—' }

// Tree SVG built from backend tree levels
function TreeView({ tree, failed }) {
  if (!tree || !tree.length) return null
  const levels = tree.length
  const NW=104, NH=30, VGAP=64
  const maxNodes = tree[0].length
  const totalW = maxNodes*(NW+14)-14
  const tainted = new Set()
  ;(failed||[]).forEach(idx => { let l=0,i=idx; while(l<levels){ tainted.add(l+'-'+i); i=Math.floor(i/2); l++ } })

  const nodes=[], edges=[]
  for(let lvl=0; lvl<levels; lvl++){
    const level=tree[lvl], count=level.length
    const lw=count*(NW+14)-14, sx=(totalW-lw)/2
    const dispLvl=levels-1-lvl, y=dispLvl*(NH+VGAP)
    for(let i=0;i<count;i++){
      const x=sx+i*(NW+14)
      nodes.push({id:lvl+'-'+i,lvl,i,hash:level[i],x,y,cx:x+NW/2,cy:y+NH/2})
    }
  }
  for(let lvl=0;lvl<levels-1;lvl++){
    const childLen=tree[lvl].length
    const padded = childLen%2===0?childLen:childLen+1
    for(let i=0;i<padded;i++){
      const ci=Math.min(i,childLen-1), pi=Math.floor(i/2)
      const c=nodes.find(n=>n.lvl===lvl&&n.i===ci), p=nodes.find(n=>n.lvl===lvl+1&&n.i===pi)
      if(c&&p) edges.push({c,p,bad:tainted.has(c.id)&&tainted.has(p.id)})
    }
  }
  const isLeaf=n=>n.lvl===0, isRoot=n=>n.lvl===levels-1
  const isFail=n=>isLeaf(n)&&(failed||[]).includes(n.i)
  const svgH=levels*(NH+VGAP)-VGAP+10

  return (
    <svg viewBox={`-10 -5 ${totalW+20} ${svgH+10}`} style={{maxWidth:'100%'}} className="mono">
      {edges.map((e,k)=>(
        <line key={k} x1={e.c.cx} y1={e.c.y} x2={e.p.cx} y2={e.p.y+NH}
          stroke={e.bad?'#ef4444':'#d1d5db'} strokeWidth={e.bad?2:1.4} strokeDasharray={e.bad?'4,3':''}/>
      ))}
      {nodes.map(n=>{
        const fail=isFail(n), taint=tainted.has(n.id)&&!fail, root=isRoot(n)
        const fill=fail?'#fef2f2':taint?'#fff7ed':root?'#eff6ff':'#f8fafc'
        const stroke=fail?'#ef4444':taint?'#f97316':root?'#2563eb':'#cbd5e1'
        const txt=fail?'#dc2626':taint?'#ea580c':root?'#1d4ed8':'#64748b'
        return (
          <g key={n.id}>
            <rect x={n.x} y={n.y} width={NW} height={NH} rx={6} fill={fill} stroke={stroke} strokeWidth={fail||root?2:1.2}/>
            <text x={n.cx} y={n.y+13} textAnchor="middle" fontSize="8.5" fill={txt} fontWeight={root||fail?'600':'400'}>{short(n.hash)}</text>
            <text x={n.cx} y={n.y+24} textAnchor="middle" fontSize="8" fill={txt} opacity="0.7">
              {root?'ROOT':isLeaf(n)?`A${n.i+1}`:''}
            </text>
            {fail && <text x={n.x+NW-3} y={n.y+11} textAnchor="end" fontSize="7.5" fill="#ef4444" fontWeight="700">✗</text>}
          </g>
        )
      })}
    </svg>
  )
}

export default function MerkleDemo() {
  const [answers, setAnswers] = useState(SAMPLE)
  const [merkle, setMerkle] = useState(null)
  const [verify, setVerify] = useState(null)
  const [tampered, setTampered] = useState(null)
  const [loading, setLoading] = useState('')
  const navigate = useNavigate()
  const toast = useToast()

  const build = async () => {
    setLoading('build'); setVerify(null); setTampered(null)
    try { const { data } = await api.post('/demo/merkle/build', { answers }); setMerkle(data) }
    catch (e) { toast.error(e.response?.data?.detail || e.message, { title: 'Build failed' }) }
    finally { setLoading('') }
  }
  const tamper = (idx) => {
    setAnswers(answers.map((a,i)=> i===idx?{...a, answer_value:a.answer_value+' [TAMPERED]'}:a))
    setTampered(idx); setVerify(null)
  }
  const runVerify = async () => {
    if (!merkle) return
    setLoading('verify')
    try { const { data } = await api.post('/demo/merkle/verify', { answers, tree: merkle.tree, merkle_root: merkle.root }); setVerify(data) }
    catch (e) { toast.error(e.response?.data?.detail || e.message, { title: 'Verify failed' }) }
    finally { setLoading('') }
  }
  const reset = () => { setAnswers(SAMPLE); setMerkle(null); setVerify(null); setTampered(null) }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-neutral-950">
      {/* Top bar */}
      <header className="h-14 bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-neutral-800 flex items-center justify-between px-6">
        <button onClick={() => navigate('/')} className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center"><span className="text-white text-[13px] font-bold">A</span></div>
          <span className="text-[14px] font-semibold text-gray-900 dark:text-white">Attestr</span>
        </button>
        <span className="text-[12px] text-gray-400">Merkle tamper demo</span>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white tracking-tight mb-1">Merkle Tree tamper demo</h1>
        <p className="text-[13px] text-gray-500 dark:text-neutral-400 mb-6">Build a tree from real answers, tamper with one, then verify to watch the exact leaf turn red and the broken chain propagate to the root.</p>

        {/* Step 1 */}
        <div className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800 p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[13.5px] font-semibold text-gray-900 dark:text-white">Step 1 — Build the Merkle tree</div>
              <div className="text-[12px] text-gray-500 dark:text-neutral-400 mt-0.5">Each answer is SHA-256 hashed into a leaf; pairs hash up to the root.</div>
            </div>
            <button onClick={build} disabled={loading==='build'}
              className="text-[12.5px] font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50">
              {loading==='build'?'Building…':'Build tree'}
            </button>
          </div>
          <div className="space-y-1.5">
            {answers.map((a,i)=>(
              <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg border text-[12.5px] ${i===tampered?'bg-red-50 border-red-200 dark:bg-red-500/10 dark:border-red-500/30':'bg-gray-50 dark:bg-neutral-800/60 border-gray-100 dark:border-neutral-800'}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="mono text-[10.5px] text-gray-400 w-12 flex-shrink-0">{a.question_id}</span>
                  <span className="text-gray-700 dark:text-neutral-300 truncate">{a.question_text}</span>
                  <span className={`font-semibold flex-shrink-0 ${i===tampered?'text-red-600':'text-gray-900 dark:text-white'}`}>{a.answer_value}</span>
                </div>
                {merkle && i!==tampered && (
                  <button onClick={()=>tamper(i)} className="text-[11px] text-red-500 hover:text-red-700 font-medium border border-red-200 dark:border-red-500/30 px-2 py-0.5 rounded flex-shrink-0 ml-2">Tamper</button>
                )}
                {i===tampered && <span className="text-[10.5px] font-bold text-red-600 bg-red-100 dark:bg-red-500/20 px-2 py-0.5 rounded flex-shrink-0 ml-2">TAMPERED</span>}
              </div>
            ))}
          </div>
          {merkle && (
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 rounded-lg">
              <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 mb-1">Merkle Root (ECDSA-signed)</div>
              <code className="mono text-[11px] text-blue-700 dark:text-blue-300 break-all">{merkle.root}</code>
            </div>
          )}
        </div>

        {/* Step 2 hint */}
        {merkle && tampered===null && (
          <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl px-4 py-3 mb-4">
            <div className="text-[12.5px] font-semibold text-amber-800 dark:text-amber-400">Step 2 — Tamper with an answer</div>
            <div className="text-[12px] text-amber-700 dark:text-amber-500/80 mt-0.5">Click "Tamper" on any row above to simulate an attacker editing one answer after signing.</div>
          </div>
        )}

        {/* Step 3 */}
        {tampered!==null && (
          <div className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800 p-5 mb-4 flex items-center justify-between">
            <div>
              <div className="text-[13.5px] font-semibold text-gray-900 dark:text-white">Step 3 — Verify</div>
              <div className="text-[12px] text-gray-500 dark:text-neutral-400 mt-0.5">Recompute each leaf's proof path against the signed root.</div>
            </div>
            <div className="flex gap-2">
              <button onClick={reset} className="text-[12px] font-medium border border-gray-200 dark:border-neutral-700 px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-neutral-800">Reset</button>
              <button onClick={runVerify} disabled={loading==='verify'} className="text-[12.5px] font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg disabled:opacity-50">{loading==='verify'?'Verifying…':'Verify now'}</button>
            </div>
          </div>
        )}

        {/* Result */}
        {verify && merkle && (
          <div className="bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800 p-5">
            <div className={`mb-4 px-4 py-2.5 rounded-lg border text-[13px] font-semibold flex items-center gap-2 ${verify.valid?'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400':'bg-red-50 border-red-200 text-red-700 dark:bg-red-500/10 dark:text-red-400'}`}>
              <span>{verify.valid?'✓':'✗'}</span>
              {verify.valid?'All answers verified. Merkle chain intact.':`Tamper detected in answer ${(verify.failed_indices||[]).map(i=>i+1).join(', ')}. Chain broken — see red nodes.`}
            </div>
            <div className="overflow-x-auto">
              <TreeView tree={merkle.tree} failed={verify.failed_indices}/>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
