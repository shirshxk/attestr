import { useState, useEffect, useRef } from 'react'
import api from '../../lib/api'

const BOOLEAN_OPTIONS = ['Yes', 'No', 'Partial', 'N/A']

export default function QuestionnaireForm({ questionnaire, onSubmitted }) {
  const [answers, setAnswers]   = useState({})
  const [saving, setSaving]     = useState(false)
  const [submitting, setSubmit] = useState(false)
  const [error, setError]       = useState('')
  const [saved, setSaved]       = useState(false)
  const saveTimer = useRef(null)

  const questions = questionnaire?.questions || []

  // Auto-save draft every 30 seconds
  useEffect(() => {
    if (Object.keys(answers).length === 0) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(saveDraft, 30000)
    return () => clearTimeout(saveTimer.current)
  }, [answers])

  const setAnswer = (questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
    setSaved(false)
  }

  const saveDraft = async () => {
    setSaving(true)
    try {
      const payload = buildAnswerPayload()
      await api.post(`/questionnaires/${questionnaire.id}/draft`, { answers: payload })
      setSaved(true)
    } catch {} finally { setSaving(false) }
  }

  const buildAnswerPayload = () => {
    return questions.map(q => ({
      question_id:   q.question_id,
      question_text: q.question_text,
      answer_value:  answers[q.question_id] || '',
      answer_type:   q.question_type,
      evidence_note: answers[`note_${q.question_id}`] || '',
    }))
  }

  const submit = async () => {
    const unanswered = questions.filter(q => q.is_required && !answers[q.question_id])
    if (unanswered.length > 0) {
      setError(`Please answer all required questions. ${unanswered.length} remaining.`)
      return
    }
    setSubmit(true); setError('')
    try {
      const { data } = await api.post(`/questionnaires/${questionnaire.id}/submit`, {
        answers: buildAnswerPayload()
      })
      onSubmitted?.(data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Submission failed.')
    } finally { setSubmit(false) }
  }

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            {Object.keys(answers).filter(k => !k.startsWith('note_')).length} / {questions.length} answered
          </span>
          <div className="flex items-center gap-3">
            {saved && <span className="text-xs text-green-600">Draft saved</span>}
            {saving && <span className="text-xs text-gray-400">Saving...</span>}
            <button onClick={saveDraft} className="text-xs text-blue-600 hover:underline">
              Save draft
            </button>
          </div>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div
            className="bg-blue-600 h-1.5 rounded-full transition-all"
            style={{ width: `${(Object.keys(answers).filter(k => !k.startsWith('note_')).length / Math.max(questions.length, 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* Questions */}
      {questions.map((q, i) => (
        <div key={q.id} className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-start gap-3 mb-3">
            <span className="text-xs font-mono text-gray-400 mt-1 w-12 shrink-0">{q.question_id}</span>
            <div className="flex-1">
              <span className="text-sm font-medium text-gray-900">{q.question_text}</span>
              {q.is_required && <span className="text-red-500 ml-1 text-xs">*</span>}
            </div>
          </div>

          {/* Answer input based on type */}
          {q.question_type === 'boolean' && (
            <div className="flex gap-2 ml-15 pl-15">
              {BOOLEAN_OPTIONS.map(opt => (
                <button key={opt}
                  onClick={() => setAnswer(q.question_id, opt)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    answers[q.question_id] === opt
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                  }`}>
                  {opt}
                </button>
              ))}
            </div>
          )}

          {q.question_type === 'free_text' && (
            <textarea
              value={answers[q.question_id] || ''}
              onChange={e => setAnswer(q.question_id, e.target.value)}
              rows={3}
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Your answer..."
            />
          )}

          {q.question_type === 'numeric' && (
            <input type="number"
              value={answers[q.question_id] || ''}
              onChange={e => setAnswer(q.question_id, e.target.value)}
              className="w-32 text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}

          {/* Evidence note */}
          {q.question_type !== 'file_attachment' && (
            <div className="mt-2.5">
              <input
                value={answers[`note_${q.question_id}`] || ''}
                onChange={e => setAnswer(`note_${q.question_id}`, e.target.value)}
                placeholder="Evidence note (optional)"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-500"
              />
            </div>
          )}
        </div>
      ))}

      {/* Submit */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex gap-3">
        <button onClick={saveDraft} disabled={saving}
          className="flex-1 border border-gray-300 text-gray-700 font-semibold text-sm py-2.5 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save draft'}
        </button>
        <button onClick={submit} disabled={submitting}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm py-2.5 rounded-lg disabled:opacity-50">
          {submitting ? 'Signing and submitting...' : 'Sign and submit'}
        </button>
      </div>

      <p className="text-xs text-gray-400 text-center">
        Submitting signs your answers with your ECC private key and encrypts the payload.
        The relay server never sees plaintext.
      </p>
    </div>
  )
}
