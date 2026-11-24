// smart-compact's decision log: one entry per main-thread answer turn it checked. Pure: callers do the $ calls.
import { pushRing } from './guard-logic.ts'
import { fmtAgo } from './recap.ts'

export const LOG_KEY = 'smart-compact.log'
export const LOG_CAP = 50
export const LOG_SHOWN = 10

// input counts input + cache_read + cache_creation; every field is optional (only what the run measured).
export type TokenUse = { input: number; output: number }
export type LogTokens = { recap?: TokenUse; summarizer?: TokenUse; before?: number; after?: number }

// Which measurement arm wrote the entry: before = 0.10.0 behaviour, after = patched, off = smart-compact switched off.
export type Arm = 'before' | 'after' | 'off'
export const ARMS = ['before', 'after', 'off'] as const

// The compaction list: a ring of `below` checks evicts compactions, so these are kept apart under their own key.
export const COMPACTIONS_KEY = 'smart-compact.compactions'
export const COMPACTIONS_CAP = 200

// percent is the raw usage value: null when the session had none (shown as "null", compared as 0).
// The flat token fields are optional because the engine may not report them. Token counts are input + output.
// recapCalls/recapTokens count every recap call charged to the compaction, discarded precomputes included.
export type LogEntry = {
  id: string
  ts: number
  session: string
  percent: number | null
  threshold: number
  decision: string
  outcome: string
  arm: Arm
  tokens?: LogTokens
  tokensBefore?: number
  tokensAfter?: number
  recapCalls?: number
  recapTokens?: number
  summarizerTokens?: number
  discardedPrecomputes?: number
  project?: string
  chargedTo?: string
}

// As stored: a 0.10.0 entry has no arm. Every new write names one.
export type StoredEntry = Omit<LogEntry, 'arm'> & { arm?: Arm }
export type NewLogEntry = Omit<LogEntry, 'arm'> & { arm: Arm }

// What this process saw, stored or not: subagent and headless turns are only counted here.
export type LogStats = {
  evaluated: number
  byDecision: Record<string, number>
  logWriteErrors: number
  lastLogError?: string
}

const armOf = (a: unknown): Arm => (ARMS as readonly unknown[]).includes(a) ? (a as Arm) : 'before'

export const asLog = (v: unknown): LogEntry[] =>
  Array.isArray(v) ? v.filter(e => e && typeof e === 'object').map((e: StoredEntry) => ({ ...e, arm: armOf(e.arm) })) : []

export const appendLog = (list: readonly LogEntry[], entry: NewLogEntry): LogEntry[] => pushRing(list, entry, LOG_CAP)

// below, skipped:* and the in-flight `recapping` are checks, not compactions.
export const isCompactionOutcome = (outcome: string): boolean => /^(compacted|recap-failed|unobserved|fallback|failed)(:|$)/.test(outcome)

// A pre-write is a ring entry whose cost waits for the next compaction in its project.
export const PREWRITE_OUTCOME = 'prewritten'
export const isPrewriteOutcome = (o: string): boolean => o === PREWRITE_OUTCOME || /^prewrite-failed(:|$)/.test(o)

export type Charged = { entry: NewLogEntry; ring: LogEntry[]; charged: string[] }

// Adds the uncharged pre-writes of the entry's project to a compaction entry once; marks them chargedTo it.
export const chargePending = (ring: readonly LogEntry[], entry: NewLogEntry, reusedId?: string): Charged => {
  if (!isCompactionOutcome(entry.outcome)) return { entry, ring: [...ring], charged: [] }
  const pending = ring.filter(e => isPrewriteOutcome(e.outcome) && !e.chargedTo && e.project === entry.project)
  if (!pending.length) return { entry, ring: [...ring], charged: [] }
  const ids = new Set(pending.map(e => e.id))
  const add = (f: (e: LogEntry) => number) => pending.reduce((a, e) => a + f(e), 0)
  const discards = pending.filter(e => e.outcome === PREWRITE_OUTCOME && e.id !== reusedId).length
  return {
    entry: {
      ...entry,
      recapTokens: (entry.recapTokens ?? 0) + add(e => e.recapTokens ?? 0),
      recapCalls: (entry.recapCalls ?? 0) + add(e => e.recapCalls ?? 0),
      discardedPrecomputes: (entry.discardedPrecomputes ?? 0) + discards,
    },
    ring: ring.map(e => (ids.has(e.id) ? { ...e, chargedTo: entry.id } : e)),
    charged: pending.map(e => e.id),
  }
}

export const asCompactions =(v: unknown): LogEntry[] => asLog(v)

const capCompactions = (list: readonly LogEntry[]): LogEntry[] => (list.length > COMPACTIONS_CAP ? list.slice(list.length - COMPACTIONS_CAP) : [...list])

// Upsert by id; a check that is not a compaction leaves the list as it was.
export const recordCompaction = (list: readonly LogEntry[], entry: NewLogEntry): LogEntry[] =>
  !isCompactionOutcome(entry.outcome)
    ? [...list]
    : list.some(e => e.id === entry.id)
      ? list.map(e => (e.id === entry.id ? entry : e))
      : pushRing(list, entry, COMPACTIONS_CAP)

// Folds the ring's compactions into the list once (by id), oldest first.
export const seedCompactions = (ring: readonly LogEntry[], list: readonly LogEntry[]): LogEntry[] => {
  const have = new Set(list.map(e => e.id))
  const missing = ring.filter(e => isCompactionOutcome(e.outcome) && !have.has(e.id))
  return missing.length ? capCompactions([...list, ...missing].sort((a, b) => a.ts - b.ts)) : [...list]
}

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

// mean over the entries that have the value; n says how many did.
export type Mean = { mean: number | null; n: number }
export type ArmTotal = { compactions: number; tokensBefore: Mean; tokensAfter: Mean; modelTokens: Mean; discardedPrecomputes: number }
export type ArmTotals = Record<Arm, ArmTotal>

const meanOf = (xs: number[]): Mean => ({ mean: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length })

const sum = (u?: TokenUse) => (u ? u.input + u.output : undefined)

// Model tokens of one compaction: recap + summarizer, flat fields first, the legacy tokens field otherwise.
const modelTokensOf = (e: LogEntry): number | undefined => {
  const parts = [e.recapTokens ?? sum(e.tokens?.recap), e.summarizerTokens ?? sum(e.tokens?.summarizer)].filter((x): x is number => x !== undefined)
  return parts.length ? parts.reduce((a, b) => a + b, 0) : undefined
}

const defined = (xs: (number | undefined)[]) => xs.filter((x): x is number => x !== undefined)

// Entries are compactions (the COMPACTIONS_KEY list); every one is counted, only those with a value enter its mean.
export const armTotals = (entries: readonly LogEntry[]): ArmTotals => {
  const one = (arm: Arm): ArmTotal => {
    const es = entries.filter(e => e.arm === arm && !isPrewriteOutcome(e.outcome))
    return {
      compactions: es.length,
      tokensBefore: meanOf(defined(es.map(e => e.tokensBefore ?? e.tokens?.before))),
      tokensAfter: meanOf(defined(es.map(e => e.tokensAfter ?? e.tokens?.after))),
      modelTokens: meanOf(defined(es.map(modelTokensOf))),
      discardedPrecomputes: es.reduce((a, e) => a + (e.discardedPrecomputes ?? 0), 0),
    }
  }
  return { before: one('before'), after: one('after'), off: one('off') }
}

const na = (m: Mean) => (m.mean === null ? 'n/a' : String(Math.round(m.mean)))

export const fmtArmTotals = (t: ArmTotals): string =>
  ARMS.map(arm => {
    const a = t[arm]
    const ctx = a.tokensBefore.mean === null && a.tokensAfter.mean === null ? 'n/a' : `${na(a.tokensBefore)}→${na(a.tokensAfter)} (n ${a.tokensBefore.n}/${a.tokensAfter.n})`
    const model = a.modelTokens.mean === null ? 'n/a' : `${na(a.modelTokens)} (n ${a.modelTokens.n})`
    return `${arm}: ${a.compactions} ${a.compactions === 1 ? 'compaction' : 'compactions'} · context ${ctx} · model tokens/compaction ${model} · discarded precomputes ${a.discardedPrecomputes}`
  }).join('\n')

export const fmtStats = (s: LogStats): string => {
  const counts = Object.entries(s.byDecision).map(([d, n]) => `${d} ${n}`)
  const errors = `log write errors ${s.logWriteErrors}${s.lastLogError ? `: ${s.lastLogError}` : ''}`
  return `this process: ${s.evaluated} turns checked${counts.length ? ` (${counts.join(', ')})` : ''}; ${errors}`
}
