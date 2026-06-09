import { useState, useEffect } from 'react'
import api from '../../lib/api'

const STAGES = ['pending', 'submitted', 'under_review', 'in_remediation', 'closed']
const STAGE_LABELS = {
  pending:        'Pending',
  submitted:      'Submitted',
  under_review:   'Under Review',
  in_remediation: 'In Remediation',
  closed:         'Closed',
}
const STAGE_COLORS = {
  pending:        'bg-gray-100 text-gray-600',
  submitted:      'bg-blue-50 text-blue-700',
  under_review:   'bg-amber-50 text-amber-700',
  in_remediation: 'bg-orange-50 text-orange-700',
  closed:         'bg-green-50 text-green-700',
}

export default function KanbanBoard({ onSelectQuestionnaire }) {
  const [questionnaires, setQuestionnaires] = useState([])

  useEffect(() => {
    api.get('/questionnaires').then(({ data }) => setQuestionnaires(data)).catch(() => {})
  }, [])

  const byStage = STAGES.reduce((acc, s) => {
    acc[s] = questionnaires.filter(q => q.status === s)
    return acc
  }, {})

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {STAGES.map(stage => (
        <div key={stage} className="flex-shrink-0 w-56">
          <div className="flex items-center justify-between mb-3">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STAGE_COLORS[stage]}`}>
              {STAGE_LABELS[stage]}
            </span>
            <span className="text-xs text-gray-400 font-medium">{byStage[stage].length}</span>
          </div>
          <div className="space-y-2.5">
            {byStage[stage].map(q => (
              <button
                key={q.id}
                onClick={() => onSelectQuestionnaire?.(q)}
                className="w-full text-left bg-white rounded-xl border border-gray-200 p-3.5 hover:border-blue-300 hover:shadow-sm transition-all group"
              >
                <div className="text-sm font-medium text-gray-900 line-clamp-2 group-hover:text-blue-700">
                  {q.title}
                </div>
                <div className="text-xs text-gray-400 mt-2">
                  {q.type.toUpperCase()}
                </div>
                {q.deadline && (
                  <div className="text-xs text-gray-400 mt-1">
                    Due {new Date(q.deadline).toLocaleDateString()}
                  </div>
                )}
              </button>
            ))}
            {byStage[stage].length === 0 && (
              <div className="text-xs text-gray-300 text-center py-6 border border-dashed border-gray-200 rounded-xl">
                Empty
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
