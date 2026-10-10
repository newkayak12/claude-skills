// The board: one row per live interactive session, written by that session, read by every session.
// The rows live in $.store, shared live across concurrent sessions (spike 2026-10-10). Pure.

export type RunState = 'running' | 'stalled' | 'blocked' | 'finished' | 'failed'
export type Cell = { state: RunState; done: number; total: number; live: boolean }
export type Runs = { harness?: Cell; graph?: Cell; teams?: Cell }

export type BoardRow = {
  sessionId: string
  root: string
  branch: string
  repo: string
  percent: number
  usd: number
  task: string
  runs: Runs
  ts: number
}

export type BoardTab = 'sessions' | 'recap' | 'lessons' | 'today'

export const BOARD_PANE = 'board'
export const ROW_PREFIX = 'board.session:'
export const rowKey = (sessionId: string) => `${ROW_PREFIX}${sessionId}`
export const ROW_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const IDLE_MS = 30 * 60 * 1000
// harness/hooks/mod.tsx and graph/hooks/mod.tsx LIVE_MS
export const LIVE_MS = 2 * 60 * 60 * 1000
export const PEER_MS = 30 * 60 * 1000
export const SEND_GAP_MS = 2 * 60 * 1000

// This session first, then the newest; rows past a day are left out (and deleted by the reader).
export function liveRows(rows: readonly BoardRow[], now: number, me: string): BoardRow[] {
  return rows
    .filter(r => now - r.ts < ROW_MAX_AGE_MS)
    .sort((a, b) => (a.sessionId === me ? -1 : b.sessionId === me ? 1 : b.ts - a.ts))
}

// Other sessions of the same repo seen in the last 30 min: who hears that main moved.
export const peersOf = (rows: readonly BoardRow[], me: BoardRow, now: number) =>
  rows.filter(r => r.sessionId !== me.sessionId && r.repo !== '' && r.repo === me.repo && now - r.ts < PEER_MS)

// Copied from graph/hooks/mod.tsx (settled, unmet, readyOf, runState = graph.mjs); copies may drift,
// so change one and diff the other. Read the same way for graph and teams broker runs.
type Node = { node_id: string; stage: string; state: string; deps: string[]; after?: string[]; final?: boolean }
type Run = { nodes?: Node[]; routing_blocked?: boolean }

const settled = (n: Node) =>
  n.state === 'done' || n.state === 'skipped' || n.state === 'unreachable' || (n.state === 'failed' && n.final === true)

function unmet(nodes: Node[], n: Node): string[] {
  const get = (id: string) => nodes.find(x => x.node_id === id)
  const data = n.deps.filter(d => get(d)?.state !== 'done')
  const order = (n.after ?? []).filter(d => {
    const dep = get(d)
    return !dep || !settled(dep)
  })
  const live =
    n.stage === 'report' && data.length === 0 && order.length === 0
      ? nodes.filter(x => x !== n && x.stage !== 'report' && (x.state === 'running' || (x.state === 'pending' && unmet(nodes, x).length === 0)))
      : []
  return [...data, ...order, ...live.map(x => x.node_id)]
}

function runState(run: Run & { nodes: Node[] }): 'running' | 'blocked' | 'complete' {
  if (run.nodes.some(n => n.stage === 'report' && n.state === 'done')) return 'complete'
  const isRunning = run.nodes.some(n => n.state === 'running')
  if (run.routing_blocked && !isRunning) return 'blocked'
  const ready = run.nodes.filter(n => n.state === 'pending' && unmet(run.nodes, n).length === 0)
  return ready.length === 0 && !isRunning ? 'blocked' : 'running'
}

// graph's pane: live = touched within 2 h and not complete; an old unfinished run reads stalled.
export function brokerCell(run: Run, mtimeMs: number, now: number): Cell | undefined {
  if (!Array.isArray(run.nodes)) return undefined
  const s = runState(run as Run & { nodes: Node[] })
  const live = s !== 'complete' && now - mtimeMs <= LIVE_MS
  const state: RunState = s === 'complete' ? 'finished' : !live ? 'stalled' : s
  return { state, done: run.nodes.filter(n => n.state === 'done').length, total: run.nodes.length, live: state === 'running' }
}

// harness/hooks/mod.tsx scanRun(): finished when 05-report.md exists, live when touched within 2 h.
export function harnessCell(r: { finished: boolean; time: number; done: number; total: number }, now: number): Cell {
  const live = !r.finished && now - r.time < LIVE_MS
  return { state: r.finished ? 'finished' : live ? 'running' : 'stalled', done: r.done, total: r.total, live }
}

// The marks of draw.tsx: ● running, ✔ finished, ✘ failed, ○ otherwise.
const MARK: Record<RunState, string> = { running: '●', finished: '✔', failed: '✘', stalled: '○', blocked: '○' }
export const cellText = (c: Cell | undefined) =>
  c === undefined ? '–' : `${MARK[c.state]} ${c.state}${c.total > 0 ? ` ${c.done}/${c.total}` : ''}`

// The command that shows a run's detail, in the session that runs it.
export const DETAIL: Record<keyof Runs, string> = { harness: '/harness-gate', graph: '/graph-live', teams: '/teams-live' }

export const shortId = (id: string) => id.replace(/^session_/, '').slice(0, 8)

export function rowText(r: BoardRow, now: number, me: string): string {
  const who = `${r.sessionId === me ? '*' : ' '} ${shortId(r.sessionId)}`
  const idle = now - r.ts > IDLE_MS ? ' (idle)' : ''
  const runs = (['harness', 'graph', 'teams'] as const).map(k => `${k} ${cellText(r.runs[k])}`).join(' · ')
  return `${who} ${r.branch || '?'} ${r.percent}% $${r.usd.toFixed(2)}${r.task ? ` ⏱ ${r.task}` : ''}${idle} | ${runs}`
}

// A Bash command that pushes to main: `git push origin main`, `… HEAD:main`, `… x:main`, or a bare push on main.
export function pushesMain(command: string, branch: string): boolean {
  for (const part of command.split(/&&|\|\||;|\n/)) {
    const words = part.trim().split(/\s+/)
    // `git push …` or `git -C <dir> push …`: git is the command, push its subcommand
    if (words[0] !== 'git') continue
    const at = words[1] === '-C' ? (words[3] === 'push' ? 3 : -1) : words[1] === 'push' ? 1 : -1
    if (at < 0) continue
    const args = words.slice(at + 1).filter(w => !w.startsWith('-'))
    if (args.some(a => a === 'main' || a.endsWith(':main') || a.endsWith(':refs/heads/main'))) return true
    if (args.length <= 1 && branch === 'main') return true
  }
  return false
}

export const mainMovedText = (sha: string, subject: string, from: string) =>
  `origin/main moved to ${sha} (pushed by session ${from}): ${subject}. Fetch before editing or bumping versions.`
