// /task: one running task per session store, a log of finished ones. Pure: callers do the $ calls.

export type Task = { name: string; start: number }
export type Done = { name: string; ms: number; day: string }

export const TASK_KEY = 'task.current'
export const TASK_LOG_KEY = 'task.log'
export const LOG_MAX = 200

export type TaskCmd = { op: 'show' } | { op: 'done' } | { op: 'log' } | { op: 'start'; name: string }

export function parseTask(args: string): TaskCmd {
  const a = args.trim()
  if (!a) return { op: 'show' }
  if (a === 'done' || a === 'stop') return { op: 'done' }
  if (a === 'log') return { op: 'log' }
  return { op: 'start', name: a.slice(0, 60) }
}

export const fmtDur = (ms: number): string => {
  const m = Math.max(0, Math.floor(ms / 60000))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

export const dayOf = (ts: number): string => new Date(ts).toISOString().slice(0, 10)

export const taskStatus = (t: Task | undefined, now: number): string => (t ? `⏱ ${t.name} ${fmtDur(now - t.start)}` : '')

export const appendLog = (log: readonly Done[], d: Done): Done[] => [...log, d].slice(-LOG_MAX)

// Today's finished tasks summed by name, longest first, then the total.
export function todayLines(log: readonly Done[], day: string): string[] {
  const sums = new Map<string, number>()
  for (const d of log) if (d.day === day) sums.set(d.name, (sums.get(d.name) ?? 0) + d.ms)
  if (sums.size === 0) return []
  const rows = [...sums].sort((a, b) => b[1] - a[1]).map(([n, ms]) => `${fmtDur(ms).padStart(6)}  ${n}`)
  const total = [...sums.values()].reduce((a, b) => a + b, 0)
  return [...rows, `${fmtDur(total).padStart(6)}  total`]
}
