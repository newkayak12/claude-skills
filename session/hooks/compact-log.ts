// smart-compact's decision log: one entry per main-thread answer turn it checked. Pure: callers do the $ calls.
import { pushRing } from './guard-logic.ts'
import { fmtAgo } from './recap.ts'

export const LOG_KEY = 'smart-compact.log'
export const LOG_CAP = 50
export const LOG_SHOWN = 10

// percent is the raw usage value: null when the session had none (shown as "null", compared as 0).
export type LogEntry = {
  id: string
  ts: number
  session: string
  percent: number | null
  threshold: number
  decision: string
  outcome: string
}

// What this process saw, stored or not: subagent and headless turns are only counted here.
export type LogStats = {
  evaluated: number
  byDecision: Record<string, number>
  logWriteErrors: number
  lastLogError?: string
}

export const asLog = (v: unknown): LogEntry[] => (Array.isArray(v) ? (v as LogEntry[]) : [])

export const appendLog = (list: readonly LogEntry[], entry: LogEntry): LogEntry[] => pushRing(list, entry, LOG_CAP)

export const patchLog = (list: readonly LogEntry[], id: string, outcome: string): LogEntry[] =>
  list.map(e => (e.id === id ? { ...e, outcome } : e))

const pct = (p: number | null) => (p === null ? 'null' : `${p}%`)

export const fmtEntry = (e: LogEntry, now: number): string =>
  `${fmtAgo(now - e.ts)}: ${pct(e.percent)} vs ${e.threshold}% → ${e.decision === e.outcome ? e.outcome : `${e.decision} → ${e.outcome}`}`

export const fmtLastCheck = (list: readonly LogEntry[], now: number): string => {
  const last = list[list.length - 1]
  return last ? `last check ${fmtEntry(last, now)}` : 'no check logged yet'
}

export const fmtLog = (list: readonly LogEntry[], now: number): string =>
  list.length === 0
    ? 'no check logged yet'
    : list
        .slice(-LOG_SHOWN)
        .reverse()
        .map(e => `${fmtEntry(e, now)} (session ${e.session.slice(0, 8)})`)
        .join('\n')

export const fmtStats = (s: LogStats): string => {
  const counts = Object.entries(s.byDecision).map(([d, n]) => `${d} ${n}`)
  const errors = `log write errors ${s.logWriteErrors}${s.lastLogError ? `: ${s.lastLogError}` : ''}`
  return `this process: ${s.evaluated} turns checked${counts.length ? ` (${counts.join(', ')})` : ''}; ${errors}`
}
