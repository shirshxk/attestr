import { useState } from 'react'
import api from '../../lib/api'

export default function KeyManager({ orgs, onRefresh }) {
  const [shamirResult, setShamirResult] = useState(null)
  const [reconstructShares, setReconstructShares] = useState('')
  const [reconstructResult, setReconstructResult] = useState(null)
  const [rotateResult, setRotateResult] = useState(null)
  const [selectedOrg, setSelectedOrg] = useState('')
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')

  const splitCaKey = async () => {
    setError('')
    setLoading('split')
    try {
      const { data } = await api.post('/admin/keys/shamir/split', { n: 5, k: 3 })
      setShamirResult(data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to split key.')
    } finally {
      setLoading('')
    }
  }

  const reconstructCaKey = async () => {
    setError('')
    setLoading('reconstruct')
    try {
      const shares = reconstructShares.split('\n').map(s => s.trim()).filter(Boolean)
      const { data } = await api.post('/admin/keys/shamir/reconstruct', { shares })
      setReconstructResult(data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Reconstruction failed.')
    } finally {
      setLoading('')
    }
  }

  const rotateKey = async () => {
    if (!selectedOrg) return
    setError('')
    setLoading('rotate')
    try {
      // Rotate key for selected org — call as that org would
      const { data } = await api.post('/keys/rotate')
      setRotateResult(data)
      onRefresh()
    } catch (e) {
      setError(e.response?.data?.detail || 'Key rotation failed.')
    } finally {
      setLoading('')
    }
  }

  return (
    <div className="space-y-6">

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Shamir split */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Shamir's Secret Sharing
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Split the CA master key into 5 shares. Any 3 can reconstruct it.
              No single custodian can act alone.
            </p>
          </div>
          <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
            L7
          </span>
        </div>

        <div className="flex items-center gap-3 mb-2">
          <div className="flex gap-2">
            {[1,2,3,4,5].map(n => (
              <div key={n} className="w-8 h-8 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-xs font-semibold text-gray-500">
                {n}
              </div>
            ))}
          </div>
          <span className="text-xs text-gray-400">5 shares — need any 3</span>
        </div>

        <button
          onClick={splitCaKey}
          disabled={loading === 'split'}
          className="mt-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {loading === 'split' ? 'Splitting...' : 'Split CA key into shares'}
        </button>

        {shamirResult && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold text-gray-600">
              {shamirResult.message}
            </p>
            {shamirResult.shares.map((share, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <span className="text-xs font-bold text-gray-400 mt-0.5 w-16 shrink-0">
                  Share {i + 1}
                </span>
                <code className="text-xs font-mono text-gray-700 break-all leading-relaxed">
                  {share}
                </code>
              </div>
            ))}
            <p className="text-xs text-amber-600 font-medium mt-2">
              ⚠ Distribute one share to each custodian. Never store all together.
            </p>
          </div>
        )}
      </div>

      {/* Shamir reconstruct */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Reconstruct CA key
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Emergency use only. Paste 3 or more shares, one per line.
            </p>
          </div>
          <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full">
            Emergency
          </span>
        </div>

        <textarea
          value={reconstructShares}
          onChange={e => setReconstructShares(e.target.value)}
          rows={4}
          placeholder="Paste shares here, one per line..."
          className="w-full font-mono text-xs border border-gray-300 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={reconstructCaKey}
          disabled={loading === 'reconstruct' || !reconstructShares.trim()}
          className="mt-3 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          {loading === 'reconstruct' ? 'Reconstructing...' : 'Reconstruct key'}
        </button>

        {reconstructResult && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-xs font-semibold text-green-800 mb-2">Key reconstructed successfully</p>
            <code className="text-xs font-mono text-gray-700 break-all block">
              {reconstructResult.private_key_pem}
            </code>
          </div>
        )}
      </div>

      {/* Key rotation info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Key rotation</h3>
            <p className="text-xs text-gray-500 mt-1">
              Each org can rotate their own ECC keypair. Old certs are revoked,
              new cert is issued. Old Tesseras remain verifiable.
            </p>
          </div>
          <span className="text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
            L6
          </span>
        </div>
        <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-500 font-mono">
            POST /keys/rotate — authenticated orgs can rotate their own key
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Old private keys are marked deprecated in the keystore, not deleted.
            Tesseras signed with old keys remain independently verifiable because
            the certificate is embedded inside the bundle at signing time.
          </p>
        </div>
      </div>

    </div>
  )
}
