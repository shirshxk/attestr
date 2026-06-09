import { useState, useEffect } from 'react'
import Sidebar from './Sidebar'
import NotificationBell from '../Shared/NotificationBell'

export default function AppLayout({ title, subtitle, actions, children }) {
  const [marginLeft, setMarginLeft] = useState(
    () => localStorage.getItem('attestr-sidebar') === 'collapsed' ? 64 : 232
  )

  // Watch sidebar width changes
  useEffect(() => {
    const check = () => {
      setMarginLeft(localStorage.getItem('attestr-sidebar') === 'collapsed' ? 64 : 232)
    }
    const iv = setInterval(check, 150)
    return () => clearInterval(iv)
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-neutral-950">
      <Sidebar />
      <div className="transition-all duration-200" style={{ marginLeft }}>
        {/* Topbar */}
        <header className="h-14 bg-white dark:bg-neutral-900 border-b border-gray-200 dark:border-neutral-800 flex items-center justify-between px-6 sticky top-0 z-40">
          <div>
            <h1 className="text-[15px] font-semibold text-gray-900 dark:text-white tracking-tight leading-tight">{title}</h1>
            {subtitle && <p className="text-[11.5px] text-gray-400 dark:text-neutral-500 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2.5">
            {actions}
            <NotificationBell />
          </div>
        </header>
        {/* Content */}
        <main className="p-6 max-w-[1120px] mx-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
