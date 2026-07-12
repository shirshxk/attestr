import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { errMessage } from '../lib/api'
import Logo from '../components/Shared/Logo'

const DEMO_ORGS = [
  { name:'ca_admin',  label:'CA Admin',  role:'Trust anchor', dot:'bg-amber-500'   },
  { name:'Elastic',   label:'Elastic',   role:'Auditor',      dot:'bg-blue-500'    },
  { name:'Airtable',  label:'Airtable',  role:'Auditor',      dot:'bg-blue-500'    },
  { name:'Grammarly', label:'Grammarly', role:'Vendor',       dot:'bg-emerald-500' },
  { name:'Plaid',     label:'Plaid',     role:'Vendor',       dot:'bg-emerald-500' },
]

function HalftoneCanvas() {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let t = 0, raf
    // Merkle node layout (normalized) — root top, leaves bottom, one tampered (red)
    const nodes = [
      { x:0.5, y:0.16, lvl:0, bad:false },
      { x:0.32, y:0.4, lvl:1, bad:false }, { x:0.68, y:0.4, lvl:1, bad:false },
      { x:0.2, y:0.64, lvl:2, bad:false }, { x:0.41, y:0.64, lvl:2, bad:false },
      { x:0.59, y:0.64, lvl:2, bad:false }, { x:0.8, y:0.64, lvl:2, bad:false },
      { x:0.13,y:0.86, lvl:3, bad:false }, { x:0.27,y:0.86, lvl:3, bad:false },
      { x:0.41,y:0.86, lvl:3, bad:false }, { x:0.55,y:0.86, lvl:3, bad:true  },
      { x:0.69,y:0.86, lvl:3, bad:false }, { x:0.83,y:0.86, lvl:3, bad:false },
    ]
    function draw() {
      const W = canvas.width = canvas.offsetWidth
      const H = canvas.height = canvas.offsetHeight
      ctx.clearRect(0,0,W,H)
      const G = 16, cols = Math.ceil(W/G)+1, rows = Math.ceil(H/G)+1
      const dark = document.documentElement.classList.contains('dark')
      for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
        const px=c*G, py=r*G
        let md=1e9, nr=null
        for (const n of nodes){ const d=Math.hypot(px-n.x*W, py-n.y*H); if(d<md){md=d;nr=n} }
        const inf = Math.max(0, 1-md/(G*4.2))
        const pulse = nr&&nr.lvl===0 ? Math.abs(Math.sin(t*1.2))*0.22 : 0
        const rad = (inf+pulse)*G*0.4
        if (rad < 0.8) continue
        let R=37,Gc=99,B=235
        if (nr&&nr.bad){ R=239;Gc=68;B=68 } else if (nr&&nr.lvl===0){ R=29;Gc=78;B=216 }
        const base = dark ? 0.18 : 0.12
        const a = base + inf*0.5 + (nr&&nr.bad?Math.abs(Math.sin(t*2.4))*0.18:0)
        ctx.beginPath(); ctx.arc(px,py,rad,0,Math.PI*2)
        ctx.fillStyle = `rgba(${R},${Gc},${B},${Math.min(a,0.7)})`; ctx.fill()
      }
      t += 0.02; raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} className="absolute inset-0 w-full h-full"/>
}

export default function LoginPage() {
  const { login, quickLogin } = useAuth()
  const navigate = useNavigate()
  const [certPem, setCertPem] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [demoLoading, setDemoLoading] = useState('')

  const redirect = (role) =>
    navigate(['ca_admin','super_admin','admin'].includes(role) ? '/admin' : role === 'auditor' ? '/auditor' : '/vendor')

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!certPem.trim()) { setError('Paste your certificate PEM, or use a demo org below.'); return }
    setError(''); setLoading(true)
    try { const s = await login(certPem.trim()); redirect(s.role) }
    catch (err) { setError(errMessage(err, 'Certificate verification failed.')) }
    finally { setLoading(false) }
  }
  const handleQuick = async (name) => {
    setDemoLoading(name); setError('')
    try { const s = await quickLogin(name); redirect(s.role) }
    catch (err) { setError(errMessage(err, 'Demo login failed. Restart backend to auto-seed.')) }
    finally { setDemoLoading('') }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white dark:bg-neutral-950">
      {/* LEFT — form. Scrolls instead of clipping when zoomed. */}
      <div className="flex items-start lg:items-center justify-center px-6 py-10 overflow-y-auto min-h-screen">
        <div className="w-full max-w-[380px] my-auto">
          {/* Logo */}
          <div className="flex items-center mb-10">
            <Logo className="h-10" />
          </div>

          <p className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 tracking-widest uppercase mb-3">
            Certificate Authentication
          </p>
          <h1 className="text-[26px] font-semibold text-gray-900 dark:text-white mb-2 tracking-tight leading-none">Sign in</h1>
          <p className="text-[13.5px] text-gray-500 dark:text-neutral-400 mb-6 leading-relaxed">
            No passwords. Your X.509 certificate is your identity.
          </p>

          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[11.5px] font-medium text-gray-600 dark:text-neutral-400">Certificate PEM</label>
                <label className="text-[11px] font-medium text-blue-600 hover:text-blue-700 cursor-pointer">
                  Upload .pem
                  <input type="file" accept=".pem,.crt,.cer,.txt" className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''            // reset so re-picking the same file fires again
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = () => {
                        const text = String(reader.result || '').trim()
                        if (text.includes('PRIVATE KEY')) {
                          setError('That looks like your private key. Upload your certificate (.pem) instead — the one beginning with “BEGIN CERTIFICATE”.')
                          return
                        }
                        if (!text.includes('BEGIN CERTIFICATE')) {
                          setError("That file doesn't look like a certificate PEM.")
                          return
                        }
                        setError(''); setCertPem(text)
                      }
                      reader.onerror = () => setError('Could not read that file. Try again or paste the PEM.')
                      reader.readAsText(file)
                    }}/>
                </label>
              </div>
              <textarea
                value={certPem} onChange={e => setCertPem(e.target.value)} rows={4}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const file = e.dataTransfer.files?.[0]; if (!file) return
                  const reader = new FileReader()
                  reader.onload = () => {
                    const text = String(reader.result || '').trim()
                    if (text.includes('PRIVATE KEY')) { setError('That looks like your private key. Upload your certificate instead.'); return }
                    setError(''); setCertPem(text)
                  }
                  reader.readAsText(file)
                }}
                placeholder={"Paste, upload, or drag your certificate .pem here\n-----BEGIN CERTIFICATE-----\nMIICKD...\n-----END CERTIFICATE-----"}
                className="w-full font-mono text-[11px] bg-gray-50 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-700 dark:text-neutral-300 leading-relaxed placeholder-gray-300 dark:placeholder-neutral-600"/>
              <p className="text-[11px] text-gray-400 dark:text-neutral-500 mt-1.5">🔒 Private key never leaves your device</p>
            </div>
            {error && <div className="text-[12px] text-red-600 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2.5">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full bg-gray-900 dark:bg-white dark:text-neutral-900 hover:bg-gray-800 dark:hover:bg-neutral-200 text-white text-[13px] font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50">
              {loading ? 'Verifying…' : 'Verify and sign in'}
            </button>
          </form>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-gray-100 dark:bg-neutral-800"/>
            <span className="text-[11px] text-gray-400 dark:text-neutral-500 whitespace-nowrap">or sign in as demo org</span>
            <div className="flex-1 h-px bg-gray-100 dark:bg-neutral-800"/>
          </div>

          {/* CA Admin — full width (it's the trust anchor) */}
          <button onClick={() => handleQuick('ca_admin')} disabled={!!demoLoading}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 mb-2 rounded-lg border border-gray-200 dark:border-neutral-800 hover:border-amber-300 dark:hover:border-amber-500/40 hover:bg-gray-50 dark:hover:bg-neutral-900 transition-all text-left disabled:opacity-40">
            <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"/>
            <span className="text-[12.5px] font-medium text-gray-900 dark:text-white flex-1">CA Admin</span>
            <span className="text-[11px] text-gray-400 dark:text-neutral-500">Trust anchor</span>
          </button>

          {/* Auditors + Vendors as a 2×2 grid */}
          <div className="grid grid-cols-2 gap-2">
            {DEMO_ORGS.filter(o => o.name !== 'ca_admin').map(o => (
              <button key={o.name} onClick={() => handleQuick(o.name)} disabled={!!demoLoading}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-neutral-800 hover:border-blue-300 dark:hover:border-blue-500/40 hover:bg-gray-50 dark:hover:bg-neutral-900 transition-all text-left disabled:opacity-40">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${o.dot}`}/>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium text-gray-900 dark:text-white truncate">{o.label}</div>
                  <div className="text-[10.5px] text-gray-400 dark:text-neutral-500">{o.role}</div>
                </div>
              </button>
            ))}
          </div>

          <p className="text-[11px] text-gray-300 dark:text-neutral-700 mt-7">© 2026 Attestr</p>
        </div>
      </div>

      {/* RIGHT — visual, hidden below lg */}
      <div className="relative hidden lg:flex flex-col items-center justify-center px-12 py-10 bg-gray-50 dark:bg-neutral-900 border-l border-gray-100 dark:border-neutral-800 overflow-hidden">
        <HalftoneCanvas />
        <div className="relative z-10 w-full max-w-[380px]">
          <h2 className="text-[22px] font-semibold text-gray-900 dark:text-white mb-7 leading-snug tracking-tight">
            Compliance verified<br/>by mathematics.<br/>
            <span className="text-blue-600 dark:text-blue-400">Not faith.</span>
          </h2>
          <div className="space-y-3">
            {[
              { icon:'⚷', t:'Private key stays on device', d:'Authentication proves possession through a cryptographic challenge — the key is never transmitted.' },
              { icon:'✓', t:'Identity verified by the CA', d:'X.509 certificates issued by the Attestr CA. Every connection verifies before data flows.' },
              { icon:'◈', t:'Cannot be phished', d:'Certificate auth is structurally immune to phishing. Nothing to steal from a fake form.' },
            ].map(f => (
              <div key={f.t} className="flex gap-3 bg-white/80 dark:bg-neutral-800/80 backdrop-blur rounded-xl border border-gray-200/70 dark:border-neutral-700/70 p-3.5">
                <div className="w-7 h-7 bg-blue-50 dark:bg-blue-500/15 border border-blue-100 dark:border-blue-500/20 rounded-lg flex items-center justify-center text-[13px] text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5">{f.icon}</div>
                <div>
                  <div className="text-[12.5px] font-semibold text-gray-900 dark:text-white mb-0.5">{f.t}</div>
                  <div className="text-[11.5px] text-gray-500 dark:text-neutral-400 leading-relaxed">{f.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
