/**
 * MerkleVisualizer.jsx
 *
 * Renders the Merkle Tree as an interactive SVG diagram.
 * Failing nodes are highlighted in red with the broken chain traced to root.
 *
 * This is the showstopper demo moment — you can see EXACTLY which answer
 * was tampered with and watch the broken chain propagate to the root.
 */

import { useMemo } from 'react'

const NODE_W  = 120
const NODE_H  = 36
const H_GAP   = 16
const V_GAP   = 60

function shortHash(hash) {
  if (!hash) return '???'
  return hash.slice(0, 6) + '...' + hash.slice(-4)
}

/**
 * Compute x/y positions for every node in the tree.
 * tree is an array of levels: tree[0] = leaves, tree[last] = [root]
 */
function layoutTree(tree) {
  const levels   = tree.length
  const maxNodes = tree[0].length
  const totalW   = maxNodes * (NODE_W + H_GAP) - H_GAP
  const totalH   = levels * (NODE_H + V_GAP) - V_GAP

  const nodes = []
  const edges = []

  for (let lvl = 0; lvl < levels; lvl++) {
    const level    = tree[lvl]
    const count    = level.length
    const levelW   = count * (NODE_W + H_GAP) - H_GAP
    const startX   = (totalW - levelW) / 2
    // Render root at top (level 0 in display = last level in tree array)
    const displayLvl = levels - 1 - lvl
    const y        = displayLvl * (NODE_H + V_GAP)

    for (let i = 0; i < count; i++) {
      const x = startX + i * (NODE_W + H_GAP)
      nodes.push({
        id:    `${lvl}-${i}`,
        level: lvl,
        index: i,
        hash:  level[i],
        x,
        y,
        cx:    x + NODE_W / 2,
        cy:    y + NODE_H / 2,
      })
    }
  }

  // Build edges: each node connects to its parent
  for (let lvl = 0; lvl < levels - 1; lvl++) {
    const childLevel  = tree[lvl]
    const parentLevel = tree[lvl + 1]
    const paddedLen   = childLevel.length % 2 === 0
      ? childLevel.length
      : childLevel.length + 1

    for (let i = 0; i < paddedLen; i++) {
      const parentIdx  = Math.floor(i / 2)
      const childIdx   = Math.min(i, childLevel.length - 1)
      const childNode  = nodes.find(n => n.level === lvl && n.index === childIdx)
      const parentNode = nodes.find(n => n.level === lvl + 1 && n.index === parentIdx)
      if (childNode && parentNode) {
        edges.push({ from: childNode, to: parentNode, id: `${lvl}-${i}` })
      }
    }
  }

  return { nodes, edges, totalW, totalH }
}

export default function MerkleVisualizer({
  tree,           // array of hash levels from the backend
  failedIndices,  // array of leaf indices that failed verification
  answers,        // array of answer objects for labels
  isValid,        // overall verification result
}) {
  const hasTree = Array.isArray(tree) && tree.length > 0 && Array.isArray(tree[0]) && tree[0].length > 0
  const { nodes, edges, totalW, totalH } = useMemo(
    () => (hasTree ? layoutTree(tree) : { nodes: [], edges: [], totalW: 0, totalH: 0 }),
    [tree, hasTree]
  )

  // Which nodes are "tainted" (on the path from a failed leaf to root)?
  const taintedIds = useMemo(() => {
    const tainted = new Set()
    for (const failedIdx of (failedIndices || [])) {
      let lvl = 0
      let idx = failedIdx
      while (lvl < tree.length) {
        tainted.add(`${lvl}-${idx}`)
        idx = Math.floor(idx / 2)
        lvl++
      }
    }
    return tainted
  }, [failedIndices, tree])

  const isLeaf       = (node) => node.level === 0
  const isFailed     = (node) => isLeaf(node) && failedIndices?.includes(node.index)
  const isTainted    = (node) => taintedIds.has(node.id)
  const isRoot       = (node) => node.level === tree.length - 1
  const isEdgeTainted = (edge) => taintedIds.has(edge.from.id) && taintedIds.has(edge.to.id)

  const getNodeColor = (node) => {
    if (isFailed(node))  return { fill: '#fee2e2', stroke: '#ef4444', text: '#b91c1c' }
    if (isTainted(node)) return { fill: '#ffedd5', stroke: '#f97316', text: '#c2410c' }
    if (isRoot(node))    return { fill: '#dbeafe', stroke: '#2563eb', text: '#1d4ed8' }
    // Verified nodes are green. Only fall back to gray if the tree is actually invalid
    // (some leaf failed) — those non-tainted nodes stay neutral to direct the eye to red.
    if (isValid !== false) return { fill: '#bbf7d0', stroke: '#16a34a', text: '#15803d' }
    return { fill: '#f1f5f9', stroke: '#cbd5e1', text: '#475569' }
  }

  const SVG_PAD = 20
  const svgW = totalW + SVG_PAD * 2
  const svgH = totalH + SVG_PAD * 2 + 20

  if (!hasTree) {
    return (
      <div className="text-[12px] text-gray-400 py-4 text-center">
        No Merkle tree to display for this bundle.
      </div>
    )
  }

  return (
    <div className="w-full overflow-x-auto">

      {/* Status banner */}
      <div className={`mb-4 px-4 py-3 rounded-lg border text-sm font-semibold flex items-center gap-2 ${
        isValid
          ? 'bg-green-50 border-green-200 text-green-700'
          : 'bg-red-50 border-red-200 text-red-700'
      }`}>
        <span>{isValid ? '✓' : '✗'}</span>
        {isValid
          ? 'All answers verified. Merkle chain intact.'
          : `Tamper detected in ${failedIndices?.length} answer(s). Chain broken — see red nodes.`}
      </div>

      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ minWidth: svgW, maxWidth: '100%' }}
        className="font-mono"
      >
        <g transform={`translate(${SVG_PAD}, ${SVG_PAD})`}>

          {/* Edges */}
          {edges.map(edge => (
            <line
              key={edge.id}
              x1={edge.from.cx} y1={edge.from.y}
              x2={edge.to.cx}   y2={edge.to.y + NODE_H}
              stroke={isEdgeTainted(edge) ? '#f97316' : (isValid !== false ? '#4ade80' : '#e2e8f0')}
              strokeWidth={isEdgeTainted(edge) ? 2 : 1.5}
              strokeDasharray={isEdgeTainted(edge) ? '4,3' : undefined}
            />
          ))}

          {/* Nodes */}
          {nodes.map(node => {
            const color    = getNodeColor(node)
            const answer   = isLeaf(node) ? answers?.[node.index] : null
            const label    = answer
              ? `Q${node.index + 1}: ${answer.question_id}`
              : isRoot(node) ? 'Merkle Root' : ''

            return (
              <g key={node.id}>
                <rect
                  x={node.x} y={node.y}
                  width={NODE_W} height={NODE_H}
                  rx={6}
                  fill={color.fill}
                  stroke={color.stroke}
                  strokeWidth={isFailed(node) || isRoot(node) ? 2 : 1.2}
                />

                {/* Hash display */}
                <text
                  x={node.cx} y={node.y + 14}
                  textAnchor="middle"
                  fontSize={9}
                  fill={color.text}
                  fontWeight={isRoot(node) || isFailed(node) ? '600' : '400'}
                >
                  {shortHash(node.hash)}
                </text>

                {/* Label below hash */}
                {label && (
                  <text
                    x={node.cx} y={node.y + 26}
                    textAnchor="middle"
                    fontSize={8}
                    fill={color.text}
                    opacity={0.7}
                  >
                    {label}
                  </text>
                )}

                {/* Failed badge */}
                {isFailed(node) && (
                  <text
                    x={node.x + NODE_W - 4} y={node.y + 12}
                    textAnchor="end"
                    fontSize={8}
                    fill="#ef4444"
                    fontWeight="700"
                  >
                    TAMPERED
                  </text>
                )}
              </g>
            )
          })}

        </g>
      </svg>

      {/* Legend */}
      <div className="flex gap-4 mt-3 text-xs text-gray-500 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-blue-50 border border-blue-400"/>
          <span>Root</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-green-100 border border-green-500"/>
          <span>Node (valid)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-red-50 border border-red-400"/>
          <span>Tampered leaf</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-orange-50 border border-orange-400"/>
          <span>Broken chain</span>
        </div>
      </div>
    </div>
  )
}
