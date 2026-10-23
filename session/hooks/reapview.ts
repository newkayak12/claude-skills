// What the /reap-list pane draws, as pure helpers. Nothing here decides what may be stopped or removed:
// reap.mjs does, and the flags below (reapable, removable) are its answer, read as given.

export type ProcItem = {
  type: 'proc'; pid: number; age: string; kind: string; task: string | null; state: string; cmd: string; reapable: boolean
}
export type TreeItem = {
  type: 'worktree'; path: string; branch: string | null; task: string | null; state: string; reason: string; removable: boolean
}
export type Item = ProcItem | TreeItem

export type Tone = 'success' | 'claude' | 'warning' | 'dim'
export type ViewRow = { key: string; icon: string; tone: Tone; cells: string[]; tail: string }

export const PANE = 'reap-list'
export const FOOTER_LEAD = 'Esc ·'
export const FOOTER_TAIL = '· /reap-list closes'
export const BRANCH_MAX = 24
export const REASON_MAX = 26

// `reap.mjs --list --json` output; undefined when it is not a JSON array.
export function parseListing(stdout: string): Item[] | undefined {
  let raw: unknown
  try {
    raw = JSON.parse(String(stdout))
  } catch {
    return undefined
  }
  if (!Array.isArray(raw)) return undefined
  return raw.filter((x): x is Item => !!x && typeof x === 'object' && ((x as Item).type === 'proc' || (x as Item).type === 'worktree'))
}

// What the CLI marked for stopping or removal.
export const reapCount = (items: readonly Item[]): number =>
  items.filter(i => (i.type === 'proc' ? i.reapable && i.state === 'finished' : i.removable && i.state === 'removable')).length

export const cut = (s: string, n: number): string => (Array.from(s).length > n ? `${Array.from(s).slice(0, n - 1).join('')}…` : s)

const procTone = (i: ProcItem): Tone => (i.state === 'finished' ? 'success' : i.state === 'live' ? 'claude' : 'dim')
const procIcon = (i: ProcItem) => (i.state === 'finished' ? '✓' : i.state === 'live' ? '●' : '·')
const treeTone = (i: TreeItem): Tone => (i.state === 'removable' ? 'success' : 'dim')
const treeIcon = (i: TreeItem) => (i.state === 'removable' ? '✓' : '·')

const widths = (cols: string[][]): number[] => (cols[0] ?? []).map((_, c) => Math.max(0, ...cols.map(r => Array.from(r[c] ?? '').length)))
const pad = (row: string[], w: number[], right: Set<number> = new Set()) =>
  row.map((s, c) => (right.has(c) ? s.padStart(w[c] ?? 0) : s.padEnd(w[c] ?? 0)))

// Rows of the process section: icon, then pid age kind state task as aligned cells; the command is the tail.
export function procRows(items: readonly Item[]): ViewRow[] {
  const ps = items.filter((i): i is ProcItem => i.type === 'proc')
  const raw = ps.map(i => [String(i.pid), i.age, i.kind, i.state, (i.task ?? '-').slice(0, 8)])
  const w = widths(raw)
  return ps.map((i, n) => ({ key: `p-${i.pid}`, icon: procIcon(i), tone: procTone(i), cells: pad(raw[n]!, w, new Set([0])), tail: i.cmd }))
}

// Rows of the worktree section: icon, then state branch reason as aligned cells; the path is the tail.
export function treeRows(items: readonly Item[]): ViewRow[] {
  const ts = items.filter((i): i is TreeItem => i.type === 'worktree')
  const raw = ts.map(i => [i.state, cut(i.branch ?? '(detached)', BRANCH_MAX), cut(i.reason, REASON_MAX)])
  const w = widths(raw)
  return ts.map((i, n) => ({ key: `w-${i.path}`, icon: treeIcon(i), tone: treeTone(i), cells: pad(raw[n]!, w), tail: i.path }))
}

export const procHead = (items: readonly Item[]): string => `Processes ${items.filter(i => i.type === 'proc').length}`
export const treeHead = (items: readonly Item[]): string => `Worktrees ${items.filter(i => i.type === 'worktree').length}`

// The ask before reaping: one line per thing the CLI marked.
export function confirmText(items: readonly Item[]): string {
  const lines = items.flatMap(i => {
    if (i.type === 'proc') return i.reapable && i.state === 'finished' ? [`stop pid ${i.pid}: ${cut(i.cmd, 80)}`] : []
    return i.removable && i.state === 'removable' ? [`remove worktree: ${i.path}`] : []
  })
  return `Reap these?\n${lines.join('\n')}`
}

export type Outcome = { done: number; failed: number; skipped: number }

// Counts from the lines `reap.mjs --reap` printed.
export function parseOutcome(stdout: string): Outcome {
  const o = { done: 0, failed: 0, skipped: 0 }
  for (const l of String(stdout).split('\n')) {
    if (/^(stopped|removed):/.test(l)) o.done++
    else if (l.startsWith('failed:')) o.failed++
    else if (l.startsWith('skipped:')) o.skipped++
  }
  return o
}

export const toastText = (o: Outcome): string => `⧗ reap-list: ${o.done} done, ${o.failed} failed${o.skipped ? `, ${o.skipped} skipped` : ''}`
