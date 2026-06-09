import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './hooks/useAuth'
import { ToastProvider } from './components/Shared/Toast'
import { ModalProvider } from './components/Shared/Modal'
import './index.css'

// Apply saved theme before first paint
if (localStorage.getItem('attestr-theme') === 'dark') {
  document.documentElement.classList.add('dark')
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ModalProvider>
            <App />
          </ModalProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
