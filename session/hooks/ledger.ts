// Pure ledger logic: no engine calls here.

export type Ledger = {
  files: string[]
  commits: { hash: string; subject: string }[]
  denied: { tool: string; reason: string }[]
  // tool.call timestamps (ms); 0 separates turns
  steps: number[]
}

export type Summary = { day: string; files: number; commits: number; denied: number; longestMs: number; fileList: string[] }

const STEPS_MAX = 2000
const LIST_MAX = 500

export const emptyLedger = (): Ledger => ({ files: [], commits: [], denied: [], steps: [] })

export const isEmpty = (l: Ledger) => l.files.length + l.commits.length + l.denied.length + l.steps.length === 0

export const addFile = (l: Ledger, path: string): Ledger =>
  !path || l.files.includes(path) || l.files.length >= LIST_MAX ? l : { ...l, files: [...l.files, path] }

// Only a `git commit` that exited 0: hash and subject from `[branch hash] subject`.
export const addCommit = (l: Ledger, command: string, stdout: string, ok: boolean): Ledger => {
  if (!ok || !/\bgit\s+(?:-\S+\s+)*commit\b/.test(command)) return l
  const m = /\[[^\]]*?\s([0-9a-f]{7,40})\]\s*(.*)/.exec(stdout)
  if (!m) return l
  return { ...l, commits: [...l.commits, { hash: m[1] ?? '', subject: (m[2] ?? '').trim() }].slice(-LIST_MAX) }
}

export const addDeny = (l: Ledger, tool: string, reason: string): Ledger => ({
  ...l,
  denied: [...l.denied, { tool, reason }].slice(-LIST_MAX),
})

export const addStep = (l: Ledger, at: number): Ledger => ({ ...l, steps: [...l.steps, at].slice(-STEPS_MAX) })

// A turn ends: the gap to the next turn's first call is the person's time, not a step.
export const endTurn = (l: Ledger): Ledger =>
  l.steps.length === 0 || l.steps[l.steps.length - 1] === 0 ? l : { ...l, steps: [...l.steps, 0] }

// S4 (05 Task 4) not run: this is the fallback, the longest gap between two tool.call events of one
// turn. If turn.step timing is proven, replace the timestamps with real step spans here.
export const stepSpan = (steps: number[]): number => {
  let best = 0
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1] ?? 0
    const b = steps[i] ?? 0
    if (a > 0 && b > 0) best = Math.max(best, b - a)
  }
  return best
}

// `git diff --numstat` lines `added<TAB>deleted<TAB>path` -> { path: '+a -d' }; binary files ('-') read +0 -0.
export const parseNumstat = (text: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (m) out[m[3] ?? ''] = `+${m[1] === '-' ? 0 : m[1]} -${m[2] === '-' ? 0 : m[2]}`
  }
  return out
}

// numstat paths are repo-relative, touched paths absolute: match on the tail.
export const statOf = (stats: Record<string, string>, path: string): string | undefined => {
  for (const [rel, s] of Object.entries(stats)) if (path === rel || path.endsWith(`/${rel}`)) return s
  return undefined
}

export const fmtMs =(ms: number): string => {
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

export const summarize = (l: Ledger, day: string): Summary => ({
  day,
  files: l.files.length,
  commits: l.commits.length,
  denied: l.denied.length,
  longestMs: stepSpan(l.steps),
  fileList: l.files,
})
