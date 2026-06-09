import { useState } from 'react'
import api from '../../lib/api'
import VerificationReport from '../Verify/VerificationReport'

export default function BundleViewer({ tessera, questionnaire, onRemediate, onClose }) {
  const [verifyResult, setVerifyResult] = useState(null)
  const [loading, setLoading] = useState('')

  const verify = async () => {
    setLoading('verify')
    try {
      const { data } = await api.post(`/tesseras/${tessera.id}/verify`)
      setVerifyResult(data)
    } catch (e) {
      alert(e.response?.data?.detail || 'Verification failed.')
    } finally { setLoading('') }
  }

  const downloadTessera = () => {
    window.open(`/api/tesseras/${tessera.id}/download`, '_blank')
  }
  const downloadPdf = () => {
    window.open(`/api/export/${tessera.id}/pdf`, '_blank')
  }
  const downloadJson = () => {
    window.open(`/api/export/${tessera.id}/json`, '_blank')
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{questionnaire?.title}</h2>
          <div className="text-xs text-gray-400 font-mono mt-1">{tessera?.bundle_id || tessera?.id}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={verify} disabled={loading === 'verify'}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
            {loading === 'verify' ? 'Verifying...' : 'Verify Tessera'}
          </button>
          {questionnaire?.status !== 'closed' && (
            <button onClick={onRemediate}
              className="border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50">
              Flag for remediation
            </button>
          )}
        </div>
      </div>

      {/* Tessera metadata */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-2">
        {[
          ['Bundle ID',        tessera?.bundle_id || tessera?.id],
          ['Merkle Root',      tessera?.merkle_root],
          ['Remediation Round', tessera?.remediation_round ?? 0],
          ['Status',           tessera?.verification_status || 'unverified'],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-3 text-sm">
            <span className="text-gray-500 font-medium w-36 shrink-0">{k}</span>
            <span className="font-mono text-xs text-gray-700 break-all">{String(v)}</span>
          </div>
        ))}
      </div>

      {/* Export buttons */}
      <div className="flex gap-2">
        <button onClick={downloadTessera}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50">
          ↓ .tessera
        </button>
        <button onClick={downloadPdf}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50">
          ↓ PDF Report
        </button>
        <button onClick={downloadJson}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50">
          ↓ JSON Export
        </button>
      </div>

      {/* Verification report */}
      {verifyResult && <VerificationReport result={verifyResult} />}
    </div>
  )
}
