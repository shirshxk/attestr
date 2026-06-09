import { createContext, useContext, useState, useCallback } from 'react'

const ModalContext = createContext(null)

export function ModalProvider({ children }) {
  const [modal, setModal] = useState(null)

  const close = useCallback(() => setModal(null), [])

  const confirm = useCallback((opts) => new Promise(resolve => {
    setModal({
      kind: 'confirm',
      title: opts.title || 'Are you sure?',
      body: opts.body || '',
      confirmLabel: opts.confirmLabel || 'Confirm',
      danger: opts.danger || false,
      onConfirm: () => { setModal(null); resolve(true) },
      onCancel:  () => { setModal(null); resolve(false) },
    })
  }), [])

  const reveal = useCallback((opts) => new Promise(resolve => {
    setModal({
      kind: 'reveal',
      title: opts.title || 'Sensitive value',
      body: opts.body || '',
      value: opts.value || '',
      onClose: () => { setModal(null); resolve(true) },
    })
  }), [])

  return (
    <ModalContext.Provider value={{ confirm, reveal, close }}>
      {children}
      {modal && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={modal.kind === 'confirm' ? modal.onCancel : modal.onClose}>
          <div className="w-full max-w-md bg-white dark:bg-neutral-900 rounded-2xl border border-gray-200 dark:border-neutral-800 shadow-2xl p-6"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-2">{modal.title}</h3>
            {modal.body && <p className="text-[13px] text-gray-500 dark:text-neutral-400 leading-relaxed mb-4">{modal.body}</p>}

            {modal.kind === 'reveal' && (
              <div className="mb-4">
                <div className="font-mono text-[10.5px] bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg p-3 max-h-48 overflow-auto break-all text-gray-700 dark:text-neutral-300 whitespace-pre-wrap">{modal.value}</div>
                <button onClick={() => navigator.clipboard?.writeText(modal.value)}
                  className="mt-2 text-[11.5px] font-medium text-blue-600 hover:text-blue-700">Copy to clipboard</button>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-2">
              {modal.kind === 'confirm' && (
                <>
                  <button onClick={modal.onCancel}
                    className="text-[12.5px] font-medium px-4 py-2 rounded-lg border border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors">Cancel</button>
                  <button onClick={modal.onConfirm}
                    className={`text-[12.5px] font-semibold px-4 py-2 rounded-lg text-white transition-colors ${modal.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>{modal.confirmLabel}</button>
                </>
              )}
              {modal.kind === 'reveal' && (
                <button onClick={modal.onClose}
                  className="text-[12.5px] font-semibold px-4 py-2 rounded-lg bg-gray-900 dark:bg-white dark:text-neutral-900 text-white hover:bg-gray-800 transition-colors">Done</button>
              )}
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  )
}

export function useModal() {
  const ctx = useContext(ModalContext)
  if (!ctx) return { confirm: async () => window.confirm('Confirm?'), reveal: async () => {}, close(){} }
  return ctx
}
