/**
 * VerificationReport.jsx
 *
 * Full verification results panel shown to the Auditor after
 * verifying a Tessera bundle.
 *
 * Shows:
 *   - Overall pass/fail status
 *   - Each verification layer result (cert chain, CRL, ECDSA, Merkle, RFC 3161)
 *   - Merkle Tree visualizer with tampered nodes highlighted
 *   - Per-answer verification table
 */

import MerkleVisualizer from './MerkleVisualizer'

const CHECK = '✓'
const CROSS = '✗'

function LayerRow({ label, layerTag, valid, detail }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
      <span className={`text-sm font-bold mt-0.5 w-4 shrink-0 ${
        valid ? 'text-green-600' : 'text-red-500'
      }`}>
        {valid ? CHECK : CROSS}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">{label}</span>
          <span className="text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">
            {layerTag}
          </span>
        </div>
        {detail && (
          <p className="text-xs text-gray-500 mt-0.5">{detail}</p>
        )}
      </div>
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
        valid
          ? 'bg-green-50 text-green-700 border border-green-200'
          : 'bg-red-50 text-red-700 border border-red-200'
      }`}>
        {valid ? 'PASS' : 'FAIL'}
      </span>
    </div>
  )
}

export default function VerificationReport({ result }) {
  if (!result) return null

  const {
    overall_valid,
    cert_valid,
    crl_valid,
    ecdsa_valid,
    merkle_valid,
    timestamp_valid,
    merkle_details,
    timestamp_detail,
    cert_detail,
    bundle_id,
    org_name,
    submitted_at,
  } = result

  const allLayers = [
    {
      label:    'Certificate chain verified',
      layerTag: 'L1',
      valid:    cert_valid,
      detail:   cert_detail || 'X.509 certificate signed by Attestr CA and not expired',
    },
    {
      label:    'Certificate not revoked (CRL)',
      layerTag: 'L1',
      valid:    crl_valid,
      detail:   'Serial number not present in Certificate Revocation List',
    },
    {
      label:    'ECDSA signature verified',
      layerTag: 'L3',
      valid:    ecdsa_valid,
      detail:   'Vendor signature over Merkle Root is valid — answers not tampered at document level',
    },
    {
      label:    'Merkle proof verified',
      layerTag: 'L3',
      valid:    merkle_valid,
      detail:   merkle_details?.failed_indices?.length > 0
        ? `${merkle_details.failed_indices.length} answer(s) failed — see tree below`
        : 'All individual answer proof paths verified',
    },
    {
      label:    'RFC 3161 timestamp verified',
      layerTag: 'L5',
      valid:    timestamp_valid,
      detail:   timestamp_detail || 'TSA countersignature verifies submission time',
    },
  ]

  return (
    <div className="space-y-6">

      {/* Overall status */}
      <div className={`rounded-xl border p-5 ${
        overall_valid
          ? 'bg-green-50 border-green-200'
          : 'bg-red-50 border-red-200'
      }`}>
        <div className="flex items-center gap-3">
          <span className={`text-2xl font-bold ${
            overall_valid ? 'text-green-600' : 'text-red-500'
          }`}>
            {overall_valid ? CHECK : CROSS}
          </span>
          <div>
            <div className={`text-base font-bold ${
              overall_valid ? 'text-green-800' : 'text-red-800'
            }`}>
              {overall_valid ? 'Tessera verified — all layers passed' : 'Verification failed — tampering detected'}
            </div>
            <div className="text-sm text-gray-600 mt-0.5">
              {org_name && <span className="font-medium">{org_name}</span>}
              {submitted_at && <span className="ml-2 text-gray-400">· {new Date(submitted_at).toLocaleString()}</span>}
              {bundle_id && <span className="ml-2 font-mono text-xs text-gray-400">{bundle_id}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Layer by layer */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          Verification layers
        </h3>
        {allLayers.map((layer, i) => (
          <LayerRow key={i} {...layer} />
        ))}
      </div>

      {/* Merkle Tree visualizer */}
      {merkle_details?.tree && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">
            Merkle Tree
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            Each leaf is a SHA-256 hash of one answer.
            {!merkle_valid && ' Red nodes show exactly which answer was tampered with.'}
          </p>
          <MerkleVisualizer
            tree={merkle_details.tree}
            failedIndices={merkle_details.failed_indices || []}
            answers={merkle_details.answers}
            isValid={merkle_valid}
          />
        </div>
      )}

      {/* Per-answer table */}
      {merkle_details?.results && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Answer verification</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-2">#</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-2">Question</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-2">Hash</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-5 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {merkle_details.results.map((r) => (
                <tr key={r.index} className={`border-b border-gray-50 ${!r.valid ? 'bg-red-50' : ''}`}>
                  <td className="px-5 py-2.5 text-gray-400 font-mono text-xs">{r.index + 1}</td>
                  <td className="px-5 py-2.5 font-mono text-xs text-gray-600">{r.question_id}</td>
                  <td className="px-5 py-2.5 font-mono text-xs text-gray-400">
                    {r.computed_hash?.slice(0, 12)}...
                  </td>
                  <td className="px-5 py-2.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      r.valid
                        ? 'bg-green-50 text-green-700 border border-green-200'
                        : 'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                      {r.valid ? 'Valid' : 'TAMPERED'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}
