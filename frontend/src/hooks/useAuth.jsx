import { createContext, useContext, useState, useEffect } from 'react'
import api from '../lib/api'

const AuthContext = createContext(null)

// Session is stored per-tab in sessionStorage so an auditor and a vendor
// can be open in two tabs at once. We also mirror to localStorage so a
// fresh tab inherits the most recent login.
function readSession() {
  const s = sessionStorage.getItem('attestr_session') || localStorage.getItem('attestr_session')
  if (!s) return null
  try { return JSON.parse(s) } catch { return null }
}

export function AuthProvider({ children }) {
  const [org,     setOrg]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const s = readSession()
    if (s) {
      setOrg(s)
      // ensure this tab has its own copy
      sessionStorage.setItem('attestr_session', JSON.stringify(s))
      if (s.token) sessionStorage.setItem('attestr_token', s.token)
    }
    setLoading(false)
  }, [])

  const login = async (certPem) => {
    const { data } = await api.post('/admin/login', { cert_pem: certPem })
    return saveSession(data)
  }

  const quickLogin = async (name) => {
    const { data } = await api.post('/demo/quick-login', { name })
    return saveSession(data)
  }

  const saveSession = (data) => {
    const session = {
      token:    data.access_token,
      org_id:   data.org_id,
      org_name: data.org_name,
      role:     data.role,
    }
    const str = JSON.stringify(session)
    // per-tab (authoritative for this tab)
    sessionStorage.setItem('attestr_session', str)
    sessionStorage.setItem('attestr_token', data.access_token)
    // mirror for new tabs
    localStorage.setItem('attestr_session', str)
    localStorage.setItem('attestr_token', data.access_token)
    setOrg(session)
    return session
  }

  const logout = () => {
    sessionStorage.removeItem('attestr_session')
    sessionStorage.removeItem('attestr_token')
    localStorage.removeItem('attestr_session')
    localStorage.removeItem('attestr_token')
    setOrg(null)
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider value={{ org, login, quickLogin, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
