import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import api from '../lib/api'

export default function RegisterPage() {
  const [params]   = useSearchParams()
  const navigate   = useNavigate()
  const [token,    setToken]   = useState(params.get('token') || '')
  const [orgName,  setOrgName] = useState('')
  const [error,    setError]   = useState('')
  const [success,  setSuccess] = useState(null)
  const [loading,  setLoading] = useState(false)

  const handleRegister = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/admin/register', {
        invite_token: token.trim(),
        org_name:     orgName.trim(),
      })
      setSuccess(data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Attestr</h1>
          <p className="text-sm text-gray-500 mt-2">Accept your invitation</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
          {success ? (
            <div className="text-center space-y-4">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                </svg>
              </div>
              <h2 className="text-base font-semibold text-gray-900">Organization registered</h2>
              <p className="text-sm text-gray-500">
                <span className="font-medium text-gray-700">{success.org_name}</span> has been registered as{' '}
                <span className="font-medium text-gray-700">{success.role}</span>.
              </p>
              <p className="text-sm text-gray-500">
                The CA Admin will issue your certificate. You'll receive it by email.
              </p>
              <button
                onClick={() => navigate('/login')}
                className="mt-2 text-sm text-blue-600 hover:underline font-medium"
              >
                Back to login
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-base font-semibold text-gray-900 mb-6">
                Complete registration
              </h2>
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Invite token
                  </label>
                  <input
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Paste your invite token"
                    className="w-full font-mono text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Organization name
                  </label>
                  <input
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g. Grammarly"
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                {error && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? 'Registering...' : 'Complete registration'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
