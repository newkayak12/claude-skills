/*
 * What the graph pane shows, as plain functions over the runs the node readout returns: order, selection, keys.
 * No engine calls here; mod.tsx draws what these return.
 */
import type { GraphOwner, GraphRow } from '../types'

export const NONE = '—'

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
