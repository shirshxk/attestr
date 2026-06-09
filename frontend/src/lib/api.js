import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: API_BASE,
})

export { API_BASE }

// Token resolution: prefer per-tab sessionStorage so multiple roles can be
// open in different tabs simultaneously without clobbering each other.
// Falls back to localStorage for backwards compatibility.
export function getToken() {
  return sessionStorage.getItem('attestr_token') || localStorage.getItem('attestr_token')
}

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      sessionStorage.removeItem('attestr_session')
      sessionStorage.removeItem('attestr_token')
      localStorage.removeItem('attestr_session')
      localStorage.removeItem('attestr_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
