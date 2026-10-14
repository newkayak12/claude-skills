/*
 * What the graph pane shows, as plain functions over a run file: who is working, the flow with its
 * attempts, the per-node detail. No engine calls here; mod.tsx draws what these return.
 */
import type { GraphNode, GraphRun } from '../types'
import type { Mark } from './draw'

export const NONE = '—'
const RANK = ['plan', 'setgoal', 'critique', 'implement', 'test', 'gate', 'report']
const SG_STAGES = ['implement', 'test', 'gate']

const sgOf = (n: GraphNode) => (typeof n.subgoal_id === 'string' && n.subgoal_id !== '' ? n.subgoal_id : null)

// vendor·model as recorded on the node; "—" when the run file holds neither
export function agentOf(n: GraphNode): string {
  const who = n.executor ?? n.vendor
  // a model id that already names its vendor (claude-sonnet-5-5) is shown alone
  const model = typeof n.model === 'string' && typeof who === 'string' && n.model.startsWith(`${who}-`) ? n.model : undefined
  const parts = model !== undefined ? [model] : [who, n.model].filter((x): x is string => typeof x === 'string' && x !== '')
  return parts.length > 0 ? parts.join('·') : NONE
}

// 45s, 3m 12s, 1h 5m; '' when unknown
export function clock(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return ''
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// how long the node ran (finished) or has been running (running); null when the file has no start
export function span(n: GraphNode, now: number): number | null {
  if (typeof n.started_at !== 'number') return null
  if (n.state === 'running') return Math.max(0, now - n.started_at)
  return typeof n.finished_at === 'number' ? Math.max(0, n.finished_at - n.started_at) : null
}

const oneLine = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

// the nodes working now, each with its agent and how long it has been at it
export function active(run: GraphRun, now: number) {
  return run.nodes
    .filter(n => n.state === 'running')
    .map(node => ({ node, agent: agentOf(node), elapsed: clock(span(node, now)) }))
}

// subgoal ids in spec order, then by first appearance
function subgoalOrder(run: GraphRun): string[] {
  const ids = (run.spec?.subgoals ?? []).map(g => g.id)
  for (const n of run.nodes) {
    const sg = sgOf(n)
    if (sg !== null && !ids.includes(sg)) ids.push(sg)
  }
  return ids
}

const rankOf = (n: GraphNode) => {
  const i = RANK.indexOf(n.stage)
  return i < 0 ? RANK.length : i
}

// flow order: plan, setgoal, critique; each subgoal's implement/test/gate; the goal gate; the report
function phaseOf(n: GraphNode) {
  if (n.stage === 'report') return 3
  if (sgOf(n) !== null) return 1
  return n.stage === 'gate' ? 2 : 0
}

export function ordered(run: GraphRun): GraphNode[] {
  const sgs = subgoalOrder(run)
  const idx = (n: GraphNode) => {
    const sg = sgOf(n)
    return sg === null ? 0 : sgs.indexOf(sg)
  }
  return run.nodes
    .map((n, i) => ({ n, i }))
    // inside a subgoal an attempt reads impl, test, gate before the next attempt; a stage's attempts follow each other
    .sort((a, b) => {
      const sub = sgOf(a.n) !== null
      const attempt = a.n.attempt - b.n.attempt
      const rank = rankOf(a.n) - rankOf(b.n)
      return phaseOf(a.n) - phaseOf(b.n) || idx(a.n) - idx(b.n) || (sub ? attempt || rank : rank || attempt) || a.i - b.i
    })
    .map(x => x.n)
}

export type FlowLine = {
  depth: number // 0 first attempt; each retry one deeper, under the reject it answers
  attempt: number
  nodes: GraphNode[] // one node, or implement/test/gate of one subgoal attempt
  state: Mark
  reason: string // why this attempt was rejected; '' when it was not
}
export type FlowGroup = { stage: string; sg: string | null; lines: FlowLine[] }

function lineState(nodes: GraphNode[]): Mark {
  if (nodes.some(n => n.state === 'failed')) return 'failed'
  if (nodes.some(n => n.state === 'running')) return 'running'
  const live = nodes.filter(n => n.state !== 'skipped' && n.state !== 'unreachable')
  if (live.length > 0 && live.every(n => n.state === 'done')) return 'done'
  return nodes.some(n => n.state === 'done') ? 'running' : 'pending'
}

// the reason a failed attempt was rejected: its own, else the feedback the retry carries
function whyRejected(nodes: GraphNode[], next: GraphNode[] | undefined): string {
  const bad = nodes.find(n => n.state === 'failed')
  if (bad === undefined) return ''
  const own = oneLine(bad.result?.reason, 200)
  if (own !== '') return own
  const carried = (next ?? []).map(n => oneLine(n.feedback, 200)).find(x => x !== '')
  return carried ?? ''
}

function chain(attempts: GraphNode[][]): FlowLine[] {
  return attempts.map((nodes, i) => ({
    depth: i,
    attempt: nodes[0]!.attempt,
    nodes,
    state: lineState(nodes),
    reason: whyRejected(nodes, attempts[i + 1]),
  }))
}

// Stages with their attempts: a rejected attempt keeps its reason and the retry sits one level under it.
// A superseded placeholder (skipped before it ran) is not an attempt.
export function flowGroups(run: GraphRun): FlowGroup[] {
  const nodes = ordered(run)
  const groups: FlowGroup[] = []
  const stageKeys = [...new Set(nodes.filter(n => sgOf(n) === null).map(n => n.stage))]
  const sgs = subgoalOrder(run)
  const single = (stage: string) => {
    const mine = nodes.filter(n => sgOf(n) === null && n.stage === stage && n.state !== 'skipped')
    return mine.length === 0 ? null : { stage, sg: null, lines: chain(mine.map(n => [n])) }
  }
  for (const stage of stageKeys.filter(s => phaseOf({ stage: s, subgoal_id: null } as GraphNode) === 0)) {
    const g = single(stage)
    if (g !== null) groups.push(g)
  }
  for (const sg of sgs) {
    const mine = nodes.filter(n => sgOf(n) === sg && SG_STAGES.includes(n.stage) && n.state !== 'skipped')
    const attempts = [...new Set(mine.map(n => n.attempt))].sort((a, b) => a - b)
    const lines = attempts.map(a => mine.filter(n => n.attempt === a))
    if (lines.length > 0) groups.push({ stage: 'implement', sg, lines: chain(lines) })
  }
  for (const stage of ['gate', 'report']) {
    const g = single(stage)
    if (g !== null) groups.push(g)
  }
  return groups
}

export type DetailRow = { node: GraphNode; agent: string; elapsed: string; feedback: string; reason: string }

// per node, every attempt that ran: agent, timing, the feedback it was handed, why it failed
export function detailRows(run: GraphRun, now: number): DetailRow[] {
  return ordered(run)
    .filter(n => n.state !== 'skipped')
    .map(node => ({
      node,
      agent: agentOf(node),
      elapsed: clock(span(node, now)),
      feedback: oneLine(node.feedback, 160),
      reason: node.state === 'failed' ? oneLine(node.result?.reason, 160) : '',
    }))
}
