import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../lib/api'

const AuthContext = createContext(null)

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
      sessionStorage.setItem('attestr_session', JSON.stringify(s))
      if (s.token) sessionStorage.setItem('attestr_token', s.token)
    }
    setLoading(false)
  }, [])

  // Refresh session from server without re-login — picks up role/workspace changes.
  const refreshSession = useCallback(async () => {
    try {
      const { data } = await api.get('/users/me')
      setOrg(prev => {
        if (!prev) return prev
        const updated = { ...prev, ...data }
        const str = JSON.stringify(updated)
        sessionStorage.setItem('attestr_session', str)
        localStorage.setItem('attestr_session', str)
        return updated
      })
    } catch { /* token expired or not logged in — ignore */ }
  }, [])

  // Auto-refresh when tab regains focus (so an admin change reflects immediately).
  useEffect(() => {
    const onFocus = () => { if (org) refreshSession() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [org, refreshSession])

  const saveSession = (data) => {
    const session = {
      token:              data.access_token,
      org_id:             data.org_id,
      org_name:           data.org_name,
      role:               data.role,
      is_privileged:      data.is_privileged      || false,
      workspace_id:       data.workspace_id        || null,
      is_workspace_admin: data.is_workspace_admin  || false,
    }
    const str = JSON.stringify(session)
    sessionStorage.setItem('attestr_session', str)
    sessionStorage.setItem('attestr_token', data.access_token)
    localStorage.setItem('attestr_session', str)
    localStorage.setItem('attestr_token', data.access_token)
    setOrg(session)
    return session
  }

  const login = async (certPem) => {
    const { data } = await api.post('/admin/login', { cert_pem: certPem })
    return saveSession(data)
  }
  const quickLogin = async (name) => {
    const { data } = await api.post('/demo/quick-login', { name })
    return saveSession(data)
  }
  const logout = () => {
    sessionStorage.removeItem('attestr_session'); sessionStorage.removeItem('attestr_token')
    localStorage.removeItem('attestr_session');   localStorage.removeItem('attestr_token')
    setOrg(null)
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider value={{ org, login, quickLogin, logout, loading, refreshSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() { return useContext(AuthContext) }
