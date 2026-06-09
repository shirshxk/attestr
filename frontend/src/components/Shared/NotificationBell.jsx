import { useState, useEffect, useRef } from 'react'
import api from '../../lib/api'
import { IconBell } from '../Layout/icons'

export default function NotificationBell() {
  const [count,  setCount]  = useState(0)
  const [open,   setOpen]   = useState(false)
  const [notifs, setNotifs] = useState([])
  const ref = useRef(null)

  useEffect(() => {
    fetchCount()
    const iv = setInterval(fetchCount, 30000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const fetchCount = async () => {
    try { const { data } = await api.get('/notifications/unread-count'); setCount(data.count) } catch {}
  }

  const toggle = async () => {
    if (open) { setOpen(false); return }
    setOpen(true)
    try {
      const { data } = await api.get('/notifications')
      setNotifs(data)
      await api.post('/notifications/mark-read')
      setCount(0)
    } catch {}
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle}
        className="relative w-9 h-9 rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 flex items-center justify-center text-gray-500 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors">
        <IconBell width={17} height={17}/>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-blue-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 bg-white dark:bg-neutral-900 rounded-xl border border-gray-200 dark:border-neutral-800 shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-neutral-800">
            <span className="text-[13px] font-semibold text-gray-900 dark:text-white">Notifications</span>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {!notifs.length
              ? <div className="px-4 py-8 text-center text-[12.5px] text-gray-400">No notifications yet</div>
              : notifs.map(n => (
                <div key={n.id} className="px-4 py-3 border-b border-gray-50 dark:border-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-800 last:border-0">
                  <div className="text-[12.5px] font-medium text-gray-900 dark:text-white">{n.title}</div>
                  <div className="text-[11.5px] text-gray-500 dark:text-neutral-400 mt-0.5">{n.body}</div>
                  <div className="text-[10.5px] text-gray-400 mt-1">{new Date(n.created_at).toLocaleString()}</div>
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}
