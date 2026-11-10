// smart-compact's decision log: one entry per main-thread answer turn it checked. Pure: callers do the $ calls.
import { pushRing } from './guard-logic.ts'
import { fmtAgo } from './recap.ts'

export const LOG_KEY = 'smart-compact.log'
export const LOG_CAP = 50
export const LOG_SHOWN = 10

// input counts input + cache_read + cache_creation; every field is optional (only what the run measured).
export type TokenUse = { input: number; output: number }
export type LogTokens = { recap?: TokenUse; summarizer?: TokenUse; before?: number; after?: number }

// percent is the raw usage value: null when the session had none (shown as "null", compared as 0).
export type LogEntry = {
  id: string
  ts: number
  session: string
  percent: number | null
  threshold: number
  decision: string
  outcome: string
  tokens?: LogTokens
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

export const patchLog = (list: readonly LogEntry[], id: string, outcome: string, tokens?: LogTokens): LogEntry[] =>
  list.map(e => (e.id === id ? { ...e, outcome, ...(tokens ? { tokens } : {}) } : e))

const pct = (p: number | null) => (p === null ? 'null' : `${p}%`)

const use = (label: string, u?: TokenUse) => (u ? [`${label} ${u.input} in/${u.output} out`] : [])

const fmtTokens = (t: LogTokens): string => {
  const ctx = t.before !== undefined && t.after !== undefined ? [`context ${t.before}→${t.after}`] : []
  const lone = ctx.length ? [] : [...(t.before !== undefined ? [`before ${t.before}`] : []), ...(t.after !== undefined ? [`after ${t.after}`] : [])]
  const parts = [...use('recap', t.recap), ...use('summarizer', t.summarizer), ...ctx, ...lone]
  return parts.length ? ` · tokens ${parts.join(', ')}` : ''
}

export const fmtEntry = (e: LogEntry, now: number): string =>
  `${fmtAgo(now - e.ts)}: ${pct(e.percent)} vs ${e.threshold}% → ${e.decision === e.outcome ? e.outcome : `${e.decision} → ${e.outcome}`}${e.tokens ? fmtTokens(e.tokens) : ''}`

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
