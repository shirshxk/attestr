import { createContext, useContext, useState, useCallback } from 'react'

const ToastContext = createContext(null)

let idCounter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const remove = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id))
  }, [])

  const push = useCallback((message, type = 'info', opts = {}) => {
    const id = ++idCounter
    setToasts(t => [...t, { id, message, type, title: opts.title }])
    if (!opts.sticky) setTimeout(() => remove(id), opts.duration || 4200)
    return id
  }, [remove])

  const toast = {
    success: (m, o) => push(m, 'success', o),
    error:   (m, o) => push(m, 'error', o),
    info:    (m, o) => push(m, 'info', o),
    remove,
  }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2.5 w-[360px] max-w-[calc(100vw-2.5rem)]">
        {toasts.map(t => <ToastCard key={t.id} {...t} onClose={() => remove(t.id)} />)}
      </div>
    </ToastContext.Provider>
  )
}

const STYLES = {
  success: { icon:'✓', iconBg:'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' },
  error:   { icon:'!', iconBg:'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400' },
  info:    { icon:'i', iconBg:'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400' },
}

function ToastCard({ message, type, title, onClose }) {
  const s = STYLES[type] || STYLES.info
  return (
    <div className="flex gap-3 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-xl shadow-md px-4 py-3 animate-[slideIn_0.18s_ease-out]">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 mt-0.5 ${s.iconBg}`}>{s.icon}</div>
      <div className="flex-1 min-w-0">
        {title && <div className="text-[12.5px] font-semibold text-gray-900 dark:text-white mb-0.5">{title}</div>}
        <div className="text-[12.5px] text-gray-600 dark:text-neutral-300 leading-snug break-words">{message}</div>
      </div>
      <button onClick={onClose} className="text-gray-300 hover:text-gray-500 dark:text-neutral-600 dark:hover:text-neutral-400 text-[14px] leading-none flex-shrink-0">×</button>
      <style>{`@keyframes slideIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) return { success(){}, error(){}, info(){}, remove(){} }
  return ctx
}
