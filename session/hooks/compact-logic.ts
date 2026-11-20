// Pure decisions of smart-compact; compact.tsx renders and acts on what these return.
import { RECAP_PROMPT } from './recap.ts'

export type CompactState = { isRunning: boolean; agentId?: string; surfaces: number }
export type CompactDecision = 'below' | 'run' | 'skipped:running' | 'skipped:agent' | 'skipped:headless'

// At or above the threshold runs; a sub-agent, a run in flight and a headless session never do.
export const shouldCompactNow = (percent: number, threshold: number, state: CompactState): CompactDecision => {
  if (state.agentId) return 'skipped:agent'
  if (state.isRunning) return 'skipped:running'
  if (state.surfaces <= 0) return 'skipped:headless'
  return percent < threshold ? 'below' : 'run'
}

export const firstLine = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).split('\n')[0]!

// smart-compact runs `/compact <COMPACT_MARK>`. Live check on 2.1.329 (2026-11-20): on an account where a
// Team-org policy hook bypasses dispatch, that compaction ran ('Compacted') but never reached this plugin's
// session.compact hook, so no trigger or instructions were seen there.
export const COMPACT_MARK = 'smart-compact handoff'

// What smart-compact's /compact carries: the mark, then the handoff sections for the engine's summarizer. Where the
// session.compact hook is bypassed, the summarizer still writes the handoff, in the one call it makes anyway.
export const HANDOFF_INSTRUCTIONS = `${COMPACT_MARK}: ${RECAP_PROMPT.replace(/\s*\n\s*/g, ' ')}`
const isOwn = (instructions?: string) => (instructions ?? '').trim().startsWith(COMPACT_MARK)

// A compaction ran when the conversation got shorter: fewer rows than before it.
export const compactionSeen = (rowsBefore?: number, rowsAfter?: number): boolean =>
  typeof rowsBefore === 'number' && typeof rowsAfter === 'number' && rowsAfter < rowsBefore

// The summary a compaction left: the first user row of the compacted conversation.
export const summaryOf = (rows: readonly { role: string; text: string }[]): string | null =>
  rows.find(r => r.role === 'user' && r.text.trim())?.text.trim() ?? null

// An engine compaction seen from the outside: context tokens fell below 60% of the last turn's.
export const tokensDropped = (last?: number, now?: number): boolean =>
  typeof last === 'number' && typeof now === 'number' && last > 0 && now < last * 0.6

// Which compactions get a handoff: the engine's auto-compact, smart-compact's own /compact (the engine sends it
// as trigger 'plugin', or as 'manual' carrying the mark) and a precompute, which the caller answers by making
// the recap ahead. A person's /compact and a subagent's compaction stay the engine's.
// A 'plugin' compaction with instructions other than the mark was raised by another plugin.
export type HandoffFor = 'auto' | 'own' | 'precompute' | null
export const handoffFor = (e: { trigger?: string; instructions?: string; agentId?: string }): HandoffFor => {
  if (e.agentId) return null
  if (e.trigger === 'auto') return 'auto'
  if (e.trigger === 'precompute') return 'precompute'
  const instructions = e.instructions?.trim()
  if (e.trigger === 'plugin') return !instructions || isOwn(instructions) ? 'own' : null
  return e.trigger === 'manual' && isOwn(instructions) ? 'own' : null
}

// What the session.compact hook saw of one compaction; nothing is a hook that never ran.
export type Observed =
  | { kind: 'handoff'; tail: number }
  | { kind: 'fallback'; reason: string }
  | { kind: 'engine' }
  | undefined
  | null

// The log outcome comes only from what the hook saw, so a compaction that ran is never logged as not run.
export const compactOutcome = (observed: Observed): string => {
  switch (observed?.kind) {
    case 'handoff':
      return `compacted:recap+${observed.tail}`
    case 'fallback':
      return `recap-failed:${observed.reason}`
    case 'engine':
      return 'compacted:engine'
    default:
      return 'unobserved'
  }
}

// A precompute is the handoff made ahead plus the conversation it covered: row count and last row.
export type KeyRow = { handle?: string; uuid?: string }
export const precomputeKey = (rows: readonly KeyRow[]): string => {
  const last = rows[rows.length - 1]
  return `${rows.length}:${last?.handle ?? last?.uuid ?? ''}`
}

// The stored handoff while the conversation is the one it covered; null once a row was added or changed.
export const reusablePrecompute = <T>(stored: { key: string; handoff: T } | null | undefined, rows: readonly KeyRow[]): T | null =>
  stored && stored.key === precomputeKey(rows) ? stored.handoff : null

export type SmartCompactArgs =
  | { kind: 'status' }
  | { kind: 'log' }
  | { kind: 'off' }
  | { kind: 'on' }
  | { kind: 'set'; value: number }
  | { kind: 'invalid' }

const THRESHOLD_MIN = 10
const THRESHOLD_MAX = 95

// /smart-compact's argument. Only a whole number from 10 to 95 (a trailing % allowed) sets; a bare command is status.
export const parseSmartCompactArgs = (args?: string): SmartCompactArgs => {
  const arg = (args ?? '').trim()
  if (!arg) return { kind: 'status' }
  if (arg === 'log' || arg === 'off' || arg === 'on') return { kind: arg }
  const m = /^(\d+)%?$/.exec(arg)
  const value = m ? Number(m[1]) : NaN
  return value >= THRESHOLD_MIN && value <= THRESHOLD_MAX ? { kind: 'set', value } : { kind: 'invalid' }
}

export const RECAP_HEADER =
  'Recap of the conversation before compaction. The messages after this one are the latest conversation, verbatim.\n\n'

// The rows a tail is cut from: SessionMessage, structurally.
export type TailRow = {
  role: 'user' | 'assistant'
  text: string
  toolUses: { tool_use_id: string; input?: unknown }[]
  toolResults?: { tool_use_id: string; text: string }[]
  handle?: string
}

// Tokens the tail may carry: a share of the window, at most 20%, half the threshold.
export const tailBudget = (window: number, threshold: number): number =>
  Math.floor((window * Math.min(20, threshold / 2)) / 100)

// chars/3 over text, tool_use input and tool_result text; a tool_use's result/text repeats toolResults.
const rowTokens = (row: TailRow): number => {
  let chars = row.text.length
  for (const u of row.toolUses) chars += (JSON.stringify(u.input) ?? '').length
  for (const r of row.toolResults ?? []) chars += r.text.length
  return Math.ceil(chars / 3)
}

// First row of the verbatim tail: newest rows within budget, with no tool_result whose tool_use is cut off.
export const tailStart = (rows: readonly TailRow[], budget: number): number => {
  let start = rows.length
  let sum = 0
  while (start > 0) {
    sum += rowTokens(rows[start - 1]!)
    if (sum > budget) break
    start--
  }
  for (let moved = true; moved; ) {
    moved = false
    const uses = new Set<string>()
    for (let i = start; i < rows.length; i++) for (const u of rows[i]!.toolUses) uses.add(u.tool_use_id)
    for (let i = rows.length - 1; i >= start; i--) {
      if ((rows[i]!.toolResults ?? []).some((r) => !uses.has(r.tool_use_id))) {
        start = i + 1
        moved = true
        break
      }
    }
  }
  return start
}
