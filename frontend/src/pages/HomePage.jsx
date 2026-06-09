import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { IconSun, IconMoon, IconArrowRight } from '../components/Layout/icons'

function HalftoneHero() {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); let t = 0, raf
    const nodes = [
      { x:0.5, y:0.12, lvl:0, bad:false },
      { x:0.32,y:0.37, lvl:1, bad:false }, { x:0.68,y:0.37, lvl:1, bad:false },
      { x:0.2, y:0.62, lvl:2, bad:false }, { x:0.41,y:0.62, lvl:2, bad:false },
      { x:0.59,y:0.62, lvl:2, bad:false }, { x:0.8, y:0.62, lvl:2, bad:false },
      { x:0.13,y:0.86, lvl:3, bad:false }, { x:0.27,y:0.86, lvl:3, bad:false },
      { x:0.41,y:0.86, lvl:3, bad:false }, { x:0.55,y:0.86, lvl:3, bad:true },
      { x:0.69,y:0.86, lvl:3, bad:false }, { x:0.83,y:0.86, lvl:3, bad:false },
    ]
    function draw() {
      const W = canvas.width = canvas.offsetWidth
      const H = canvas.height = canvas.offsetHeight
      ctx.clearRect(0,0,W,H)
      const dark = document.documentElement.classList.contains('dark')
      const G = 15, cols = Math.ceil(W/G)+1, rows = Math.ceil(H/G)+1
      for (let r=0;r<rows;r++) for (let c=0;c<cols;c++){
        const px=c*G, py=r*G
        let md=1e9, nr=null
        for (const n of nodes){ const d=Math.hypot(px-n.x*W,py-n.y*H); if(d<md){md=d;nr=n} }
        const inf = Math.max(0,1-md/(G*4.2))
        const pulse = nr&&nr.lvl===0 ? Math.abs(Math.sin(t*1.1))*0.22 : 0
        const rad = (inf+pulse)*G*0.4
        if (rad<0.8) continue
        let R=37,Gc=99,B=235
        if (nr&&nr.bad){R=239;Gc=68;B=68} else if(nr&&nr.lvl===0){R=29;Gc=78;B=216}
        const base = dark?0.18:0.1
        const a = base + inf*0.5 + (nr&&nr.bad?Math.abs(Math.sin(t*2.4))*0.18:0)
        ctx.beginPath(); ctx.arc(px,py,rad,0,Math.PI*2)
        ctx.fillStyle=`rgba(${R},${Gc},${B},${Math.min(a,0.68)})`; ctx.fill()
      }
      t+=0.02; raf=requestAnimationFrame(draw)
    }
    draw(); return ()=>cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} className="absolute inset-0 w-full h-full"/>
}

const LAYERS = [
  { n:'01', t:'Certificate identity', d:'Every org authenticates with an X.509 certificate and mTLS. No passwords exist anywhere.' },
  { n:'02', t:'Per-answer Merkle signing', d:'Each answer is hashed into a Merkle leaf; the vendor signs the single root. Tamper one answer and its proof path breaks.' },
  { n:'03', t:'End-to-end encryption', d:'Answers are hybrid-encrypted with ephemeral ECDH and AES-256-GCM. The relay never sees plaintext.' },
  { n:'04', t:'Trusted timestamp', d:'An RFC 3161 token countersigns the root hash so no submission can be backdated.' },
]

export default function HomePage() {
  const { org } = useAuth()
  const navigate = useNavigate()
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  const toggleTheme = () => {
    const next = !dark; setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('attestr-theme', next ? 'dark' : 'light')
  }

  const goDash = () => {
    if (!org) return navigate('/login')
    navigate(org.role === 'ca_admin' ? '/admin' : org.role === 'auditor' ? '/auditor' : '/vendor')
  }

  return (
    <div className="min-h-screen bg-[#fafaf8] dark:bg-neutral-950 text-gray-900 dark:text-white">
      {/* NAV */}
      <nav className="fixed top-0 inset-x-0 z-50 h-14 flex items-center justify-between px-6 lg:px-12 bg-[#fafaf8]/90 dark:bg-neutral-950/90 backdrop-blur border-b border-gray-200 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center"><span className="text-white text-[13px] font-bold">A</span></div>
          <span className="text-[15px] font-semibold">Attestr</span>
        </div>
        <div className="hidden md:flex items-center gap-1">
          <a href="#how" className="text-[13.5px] text-gray-600 dark:text-neutral-400 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800">How it works</a>
          <a href="#tessera" className="text-[13.5px] text-gray-600 dark:text-neutral-400 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800">The Tessera</a>
          <button onClick={() => navigate('/demo/merkle')} className="text-[13.5px] text-gray-600 dark:text-neutral-400 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800">Live demo</button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleTheme} className="w-9 h-9 rounded-lg border border-gray-200 dark:border-neutral-700 flex items-center justify-center text-gray-500 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800">
            {dark ? <IconSun width={16} height={16}/> : <IconMoon width={16} height={16}/>}
          </button>
          {org
            ? <button onClick={goDash} className="text-[13px] font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-1.5">Go to dashboard <IconArrowRight width={14} height={14}/></button>
            : <button onClick={() => navigate('/login')} className="text-[13px] font-semibold bg-gray-900 dark:bg-white dark:text-neutral-900 text-white px-4 py-2 rounded-lg">Sign in</button>}
        </div>
      </nav>

      {/* HERO */}
      <section className="max-w-[1240px] mx-auto px-6 lg:px-12 pt-32 pb-20 grid lg:grid-cols-2 gap-16 items-center">
        <div>
          <div className="inline-flex items-center gap-2 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-full pl-2 pr-3.5 py-1.5 text-[12px] font-medium text-gray-600 dark:text-neutral-400 mb-7">
            <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] flex items-center justify-center">✦</span>
            Zero-trust third-party risk management
          </div>
          <h1 className="text-[clamp(40px,5vw,64px)] font-bold leading-[1.05] tracking-[-2px] mb-6">
            Stop trusting<br/>spreadsheets.<br/><span className="text-blue-600 dark:text-blue-500">Trust math.</span>
          </h1>
          <p className="text-[16px] font-light text-gray-600 dark:text-neutral-400 leading-relaxed max-w-md mb-9">
            Attestr replaces email-based compliance questionnaires with cryptographically signed, end-to-end encrypted, and permanently verifiable audit bundles.
          </p>
          <div className="flex items-center gap-3">
            <button onClick={() => org ? goDash() : navigate('/login')}
              className="text-[14px] font-semibold bg-gray-900 dark:bg-white dark:text-neutral-900 text-white px-7 py-3 rounded-xl hover:opacity-90 transition-opacity">
              {org ? 'Go to dashboard' : 'Get started'}
            </button>
            <button onClick={() => navigate('/demo/merkle')} className="text-[14px] text-gray-600 dark:text-neutral-300 border border-gray-200 dark:border-neutral-700 px-6 py-3 rounded-xl hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors">
              Try live demo →
            </button>
          </div>
          <div className="flex gap-8 mt-14 pt-7 border-t border-gray-200 dark:border-neutral-800">
            {[['8','Cryptographic layers'],['0','Plaintext on server'],['∞','Verifiable forever']].map(([n,l]) => (
              <div key={l}><div className="text-[22px] font-bold tracking-tight">{n}</div><div className="text-[11.5px] text-gray-500 dark:text-neutral-500 mt-0.5">{l}</div></div>
            ))}
          </div>
        </div>
        <div className="relative h-[440px] hidden lg:block"><HalftoneHero/></div>
      </section>

      {/* HOW */}
      <section id="how" className="border-t border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40">
        <div className="max-w-[1240px] mx-auto px-6 lg:px-12 py-20">
          <div className="text-center max-w-xl mx-auto mb-14">
            <div className="text-[11px] font-mono font-medium tracking-[2px] uppercase text-blue-600 dark:text-blue-400 mb-3">How it works</div>
            <h2 className="text-[clamp(26px,3vw,38px)] font-bold tracking-[-1px] leading-tight">From questionnaire to cryptographic proof</h2>
          </div>
          <div className="grid md:grid-cols-4 gap-5">
            {LAYERS.map(l => (
              <div key={l.n} className="bg-[#fafaf8] dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-2xl p-5">
                <div className="font-mono text-[11px] text-blue-600 dark:text-blue-400 mb-3">{l.n}</div>
                <div className="text-[14px] font-semibold mb-1.5">{l.t}</div>
                <div className="text-[12.5px] text-gray-500 dark:text-neutral-400 leading-relaxed">{l.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TESSERA */}
      <section id="tessera" className="max-w-[1240px] mx-auto px-6 lg:px-12 py-20 grid lg:grid-cols-2 gap-14 items-center">
        <div>
          <div className="text-[11px] font-mono font-medium tracking-[2px] uppercase text-blue-600 dark:text-blue-400 mb-3">The Tessera</div>
          <h2 className="text-[clamp(26px,3vw,38px)] font-bold tracking-[-1px] leading-tight mb-4">A sealed file that proves everything. Forever.</h2>
          <p className="text-[15px] font-light text-gray-600 dark:text-neutral-400 leading-relaxed mb-4">
            Named after the Roman authentication token — a broken clay seal that proved a trusted relationship with no third party. Every Attestr submission becomes a <span className="font-mono text-[13px] text-gray-900 dark:text-white">.tessera</span> bundle: self-contained, independently verifiable, valid forever — even if Attestr disappears.
          </p>
        </div>
        <div className="bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-3 border-b border-gray-100 dark:border-neutral-800">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400"/><div className="w-2.5 h-2.5 rounded-full bg-amber-400"/><div className="w-2.5 h-2.5 rounded-full bg-emerald-400"/>
            <span className="ml-2 font-mono text-[11px] text-gray-400">grammarly_elastic_r0.tessera</span>
          </div>
          <div className="p-4 space-y-2 font-mono text-[10.5px]">
            {[['vendor_cert','-----BEGIN CERTIFICATE----- MIIC…'],['ephemeral_pubkey','-----BEGIN PUBLIC KEY----- MFkw…'],['encrypted_payload','8f3a2c9d1e7b…'],['merkle_root','a3f8c1d9e2b7044…'],['ecdsa_signature','3045022100d4e8f…'],['rfc3161_token','eyJ2ZXJzaW9u…']].map(([k,v]) => (
              <div key={k} className="flex gap-3"><span className="text-blue-600 dark:text-blue-400 w-36 flex-shrink-0">{k}</span><span className="text-gray-400 truncate">{v}</span></div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-[1240px] mx-auto px-6 lg:px-12 pb-24">
        <div className="bg-gray-900 dark:bg-neutral-900 dark:border dark:border-neutral-800 rounded-3xl px-10 lg:px-16 py-16 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
          <h2 className="text-[clamp(24px,3vw,36px)] font-bold text-white tracking-[-1px] leading-tight max-w-md">
            We don't ask you to trust Attestr.<br/><span className="text-blue-400">We give you the math.</span>
          </h2>
          <div className="flex gap-3 flex-shrink-0">
            <button onClick={() => org ? goDash() : navigate('/login')} className="text-[14px] font-semibold bg-white text-gray-900 px-7 py-3 rounded-xl hover:opacity-90">{org ? 'Go to dashboard' : 'Sign in'}</button>
            <button onClick={() => navigate('/demo/merkle')} className="text-[14px] text-white/70 border border-white/20 px-6 py-3 rounded-xl hover:text-white hover:border-white/50">Try tamper demo</button>
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-200 dark:border-neutral-800">
        <div className="max-w-[1240px] mx-auto px-6 lg:px-12 py-8 flex items-center justify-between">
          <div className="flex items-center gap-2"><div className="w-5 h-5 bg-blue-600 rounded flex items-center justify-center"><span className="text-white text-[10px] font-bold">A</span></div><span className="text-[13px] font-semibold">Attestr</span></div>
          <div className="text-[11.5px] text-gray-400 font-mono">secp256r1 · AES-256-GCM · Argon2id · RFC 3161</div>
        </div>
      </footer>
    </div>
  )
}
