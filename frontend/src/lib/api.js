import axios from 'axios'

// When colleagues access via LAN IP, their browser's `window.location.hostname`
// IS the server's LAN IP — so we use it dynamically instead of hardcoding localhost.
// VITE_API_URL can still override this (e.g. for production).
function getApiBase() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
  // Use the same host the frontend was loaded from, port 8000
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  return `http://${host}:8000`
}

const API_BASE = getApiBase()

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use(config => {
  const token = sessionStorage.getItem('attestr_token') || localStorage.getItem('attestr_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    return Promise.reject(err)
  }
)

// Safely extract a human-readable message from any axios error.
// FastAPI 422 returns `detail` as an array of objects — this always returns a string.
export function errMessage(err, fallback = 'Something went wrong.') {
  const d = err?.response?.data?.detail
  if (!d) return err?.message || fallback
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map(e => e?.msg || JSON.stringify(e)).join('; ')
  if (typeof d === 'object') return d.msg || JSON.stringify(d)
  return String(d)
}

export { API_BASE }
export default api
