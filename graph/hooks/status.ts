/*
 * What the graph pane shows, as plain functions over a run file: who is working, the flow with its
 * attempts, the per-node detail. No engine calls here; mod.tsx draws what these return.
 */
import type { GraphNode, GraphOwner, GraphRow, GraphRun } from '../types'
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

/* --- what the mod reads and shows: the runs of `broker.mjs runs --list/--show --json` --- */

// The one reader of the run files is the node CLI (it works with no mod, compat-claude); the mod runs it.
export const listArgv = (pluginRoot: string, cwd: string): string[] => ['node', `${pluginRoot}/mcp/broker.mjs`, 'runs', '--list', '--json', '--cwd', cwd]
export const showArgv = (pluginRoot: string, file: string): string[] => ['node', `${pluginRoot}/mcp/broker.mjs`, 'runs', '--show', file, '--json']

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function normalizeRow(v: unknown): GraphRow | null {
  if (!isObj(v) || typeof v.run_id !== 'string' || v.run_id === '' || typeof v.file !== 'string') return null
  const owner = isObj(v.owner) && typeof v.owner.key === 'string' ? (v.owner as GraphOwner) : null
  const running = isObj(v.running) && typeof v.running.node_id === 'string' ? { node_id: v.running.node_id, last_step: str(v.running.last_step) } : null
  const nodes = (Array.isArray(v.nodes) ? v.nodes : []).filter(isObj).map(n => ({
    node_id: String(n.node_id ?? ''),
    stage: String(n.stage ?? ''),
    subgoal_id: str(n.subgoal_id),
    state: String(n.state ?? ''),
    attempt: num(n.attempt),
    agent: str(n.agent),
    started_at: num(n.started_at),
    finished_at: num(n.finished_at),
    reason: str(n.reason),
    feedback: str(n.feedback),
    last_step: str(n.last_step),
  }))
  const subgoals = (Array.isArray(v.subgoals) ? v.subgoals : []).filter(isObj).map(s => ({ id: String(s.id ?? ''), title: String(s.title ?? '') }))
  return {
    id8: str(v.id8) ?? v.run_id.slice(0, 8),
    state: str(v.state) ?? '',
    owner,
    created_at: str(v.created_at) ?? 'unknown',
    cost_usd: num(v.cost_usd),
    running,
    run_id: v.run_id,
    file: v.file,
    request: str(v.request) ?? '',
    max_retries: num(v.max_retries),
    last_change: str(v.last_change) ?? '',
    last_change_ms: num(v.last_change_ms) ?? 0,
    age_ms: num(v.age_ms) ?? 0,
    open: v.open === true,
    stalled: v.stalled === true,
    routing_blocked: v.routing_blocked === true,
    unavailable_vendors: isObj(v.unavailable_vendors) ? v.unavailable_vendors : {},
    subgoals,
    last_step: str(v.last_step),
    acting: v.acting === true,
    rejects: num(v.rejects) ?? 0,
    nodes,
  }
}

// The --list --json output. Empty, invalid or not a list is null: the caller keeps its last good list.
// `[]` is a real answer (no open runs).
export function parseRows(text: unknown): GraphRow[] | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!Array.isArray(v)) return null
  return v.map(normalizeRow).filter((r): r is GraphRow => r !== null)
}

// The `runs --show <file> --json` output: one row. Anything else is null.
export function parseRow(text: unknown): GraphRow | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  try {
    return normalizeRow(JSON.parse(text))
  } catch {
    return null
  }
}

// The runs the band and the [ ] list hold: open, and not opened by a task (an owned run is that task's, never listed here).
export const standalone = (rows: readonly GraphRow[]): GraphRow[] => rows.filter(r => r.open && r.owner === null)

export const hasNewReject = (r: GraphRow, looked: Record<string, number>) => r.rejects > (looked[r.run_id] ?? 0)
export const markLooked = (looked: Record<string, number>, r: GraphRow | null): Record<string, number> =>
  r === null || looked[r.run_id] === r.rejects ? looked : { ...looked, [r.run_id]: r.rejects }

// Waits on you (routing_blocked) first, then a reject since you last looked, then the most recent last change.
export function openingOrder(rows: readonly GraphRow[], looked: Record<string, number>): GraphRow[] {
  const rank = (r: GraphRow) => (r.routing_blocked ? 0 : hasNewReject(r, looked) ? 1 : 2)
  return rows.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || b.r.last_change_ms - a.r.last_change_ms || a.i - b.i).map(x => x.r)
}

// openingOrder, kept: `frozen` is the run_id order of the last call. While the rows are the same set, that order stands,
// so a look or a changed row never moves a run under `[` / `]`; a run that opens or closes orders again.
export function frozenOrder(rows: readonly GraphRow[], looked: Record<string, number>, frozen: readonly string[] | null): GraphRow[] {
  const byId = new Map(rows.map(r => [r.run_id, r]))
  const same = frozen !== null && frozen.length === rows.length && byId.size === rows.length && frozen.every(id => byId.has(id))
  return same ? frozen.map(id => byId.get(id)!) : openingOrder(rows, looked)
}

// The run shown: the selected run while it is listed, else the first in opening order.
export const pickRun = (ordered: readonly GraphRow[], selected: string | null): GraphRow | null =>
  ordered.find(r => r.run_id === selected) ?? ordered[0] ?? null

export function runPosition(ordered: readonly GraphRow[], selected: string | null): { k: number; n: number } {
  const at = ordered.findIndex(r => r.run_id === pickRun(ordered, selected)?.run_id)
  return { k: at < 0 ? 0 : at + 1, n: ordered.length }
}

// `[` and `]`: the run_id a step lands on, stopping at the first and the last run; with fewer than two runs, nothing changes.
export function cycleRun(ordered: readonly GraphRow[], selected: string | null, step: 1 | -1): string | null {
  if (ordered.length < 2) return selected
  const at = Math.max(0, ordered.findIndex(r => r.run_id === pickRun(ordered, selected)?.run_id))
  return ordered[Math.min(ordered.length - 1, Math.max(0, at + step))]!.run_id
}

export type PaneKey = { kind: 'step'; by: 1 | -1 } | { kind: 'tab'; tab: 'flow' | 'detail' } | { kind: 'close' } | null
const KEY_TABS: Record<string, 'flow' | 'detail'> = { '1': 'flow', '2': 'detail' }

// The last character typed into the pane's Input. Text holding a `/` is a slash command being typed
// (`/graph-status`, `/help q`): held, no key fires until submit.
export function paneKey(text: unknown): PaneKey {
  if (typeof text !== 'string' || text === '' || text.includes('/')) return null
  const k = [...text].pop()!
  if (k === ']') return { kind: 'step', by: 1 }
  if (k === '[') return { kind: 'step', by: -1 }
  if (k === 'q') return { kind: 'close' }
  const tab = KEY_TABS[k]
  return tab === undefined ? null : { kind: 'tab', tab }
}

// A slash command typed into the pane's Input and submitted. The Input's buffer may start with earlier key presses
// (`][2q/help`), so the command starts at the first `/`. `/graph-status` closes the pane (the command again toggles);
// `/name args` runs that command; anything else is dropped.
export type PaneSlash = { kind: 'close' } | { kind: 'run'; command: string; args: string } | null

export function paneSlash(text: unknown): PaneSlash {
  if (typeof text !== 'string') return null
  const at = text.indexOf('/')
  if (at < 0) return null
  const m = /^\/([^\s/]+)\s*(.*)$/.exec(text.slice(at).trim())
  if (m === null) return null
  return m[1] === 'graph-status' ? { kind: 'close' } : { kind: 'run', command: m[1]!, args: m[2]! }
}

// The faster interval runs only while a displayed run acts, a pane or band is shown, and a surface exists.
export const spinnerPlan = (rows: readonly (GraphRow | null)[], surfaces: number, shown: boolean): { run: boolean } => ({
  run: surfaces > 0 && shown && rows.some(r => r !== null && r.acting && !r.stalled),
})

// `/graph-status open <run-file> <owner-key>`: null = no argument (the plain toggle); {file, owner} = open that run
// under that task; {usage} = one line, nothing opens.
export const OPEN_USAGE = 'usage: /graph-status open <run-file> <owner-key: E-xxxxxxxx or E-xxxxxxxx/Pn>'
export function parseOpenArg(args: unknown): { file: string; owner: string } | { usage: string } | null {
  const t = typeof args === 'string' ? args.trim() : ''
  if (t === '') return null
  const [verb, file, owner, ...extra] = t.split(/\s+/)
  if (verb !== 'open' || file === undefined || owner === undefined || extra.length > 0 || !/^E-\w+(\/P\d+)?$/.test(owner)) return { usage: OPEN_USAGE }
  return { file, owner }
}

// `$3.40`, or `—` when the run file records no cost
export const costText = (r: Pick<GraphRow, 'cost_usd'>) => (r.cost_usd !== null ? `$${r.cost_usd.toFixed(2)}` : NONE)

// 45s, 6m, 1h 12m; — when unknown
export const ageText = (ms: number | null): string => {
  if (ms === null || !Number.isFinite(ms)) return NONE
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}
