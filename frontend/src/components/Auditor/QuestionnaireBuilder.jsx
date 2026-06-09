import { useState, useEffect } from 'react'
import api from '../../lib/api'

const TEMPLATES = [
  { value: 'soc2',     label: 'SOC 2 Type II',       desc: '40+ questions covering security, availability, confidentiality' },
  { value: 'iso27001', label: 'ISO 27001 Annex A',    desc: '50+ questions covering all Annex A control objectives' },
  { value: 'custom',   label: 'Custom questionnaire', desc: 'Build from scratch with your own questions' },
]

export default function QuestionnaireBuilder({ onCreated }) {
  const [step, setStep]         = useState(1)
  const [templateType, setType] = useState('soc2')
  const [vendors, setVendors]   = useState([])
  const [vendorId, setVendorId] = useState('')
  const [title, setTitle]       = useState('')
  const [deadline, setDeadline] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    api.get('/admin/organizations')
      .then(({ data }) => setVendors(data.filter(o => o.role === 'vendor')))
      .catch(() => {})
  }, [])

  const submit = async () => {
    if (!vendorId) { setError('Select a vendor.'); return }
    setLoading(true); setError('')
    try {
      const payload = {
        template_type: templateType,
        vendor_id:     vendorId,
        deadline:      deadline || null,
        custom_title:  title || null,
      }
      const { data } = await api.post('/questionnaires/from-template', payload)
      onCreated?.(data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to create questionnaire.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-lg">
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-gray-900">New questionnaire</h2>

        {/* Template selection */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Template</label>
          {TEMPLATES.map(t => (
            <label key={t.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              templateType === t.value ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
            }`}>
              <input type="radio" name="template" value={t.value}
                checked={templateType === t.value}
                onChange={() => setType(t.value)}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm font-medium text-gray-900">{t.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{t.desc}</div>
              </div>
            </label>
          ))}
        </div>

        {/* Vendor */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Send to vendor</label>
          <select value={vendorId} onChange={e => setVendorId(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Select vendor...</option>
            {vendors.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>

        {/* Custom title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Custom title <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Leave blank to use template title"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Deadline */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Deadline <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <button onClick={submit} disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors disabled:opacity-50">
          {loading ? 'Creating...' : 'Create and send questionnaire'}
        </button>
      </div>
    </div>
  )
}
