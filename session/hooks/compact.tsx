import { atom, update } from 'claude-code'
import type { On, PluginOptions } from 'claude-code'

import {
  compactionSeen, firstLine, HANDOFF_INSTRUCTIONS, handoffFor, parseSmartCompactArgs, RECAP_HEADER, shouldCompactNow, summaryOf,
  tailBudget, tailStart, tokensDropped,
} from './compact-logic.ts'
import type { HandoffFor } from './compact-logic.ts'
import {
  appendLog, armTotals, asCompactions, asLog, COMPACTIONS_KEY, fmtArmTotals, fmtLastCheck, fmtLog, fmtStats, LOG_KEY, recordCompaction,
  seedCompactions,
} from './compact-log.ts'
import type { Arm, LogEntry, LogStats, LogTokens, TokenUse } from './compact-log.ts'
import { corrections, fmtAgo, isFresh, lessonsKey, makeRecap, mergeLessons, RECAP_PROMPT, recapKey } from './recap.ts'
import type { Recap } from './recap.ts'
import { fmtContext, statusLinePercent } from '../scripts/context-logic.mjs'
import { statusLine } from './status.ts'
import { BOARD_OPEN } from './board.ts'
import type { BoardTab } from './board.ts'

// At a set context % (and at the engine's own auto-compact), a handoff made over the rows being compacted and
// the newest rows verbatim replace the conversation. The threshold is the userConfig field, so /config shows it;
// /smart-compact <n> writes the same field.
// Every recap (here or /handoff) is kept per project: the next start shows it, /lessons collects its Corrections.
export const THRESHOLD_FIELD = 'smart_compact_threshold'
// false: smart-compact never compacts; engine compactions are still logged, as the 'off' arm.
export const ENABLED_FIELD = 'smart_compact_enabled'
// the board pane's tab; mod.tsx draws it
const boardTab = atom({ plugin: 'session', key: 'boardTab' } as const, 'sessions' as BoardTab)
const DEFAULT_THRESHOLD = 70
const MIN = 10
const MAX = 95

const thresholdOf = (options: PluginOptions) => Number(options[THRESHOLD_FIELD] ?? DEFAULT_THRESHOLD)
const enabledOf = (options: PluginOptions) => options[ENABLED_FIELD] !== false
// the options register was given; read live, so /config and /smart-compact on|off take effect from the next turn
let liveOptions: PluginOptions = {}
const armNow = (): Arm => (enabledOf(liveOptions) ? 'after' : 'off')

// Context tokens at the last main-loop turn end, to see an engine compaction no hook reported (tokensDropped).
let lastTokens: number | undefined
// A compaction logged before its after-tokens were known: the next turn end fills them in.
let pendingAfter: { id: string; outcome: string; tokensBefore?: number } | undefined

// The context the status line shows (window and tokens through context-logic.mjs), not usage().context.percent.
async function readContext($: any) {
  const c = (await $.session.usage()).context
  return statusLinePercent({ context_window_size: c?.window, total_input_tokens: c?.tokens })
}
let isRunning = false

// The decision log: writes run one after another on one chain, so a pending→outcome patch and the next
// turn's append cannot overwrite each other. The turn never waits on it; a failing store is only counted.
const stats: LogStats = { evaluated: 0, byDecision: {}, logWriteErrors: 0 }
let logChain: Promise<void> = Promise.resolve()
let logSeq = 0
const PROC = Date.now().toString(36)

// false from a main-thread tool call until the turn's turn.complete; /compact waits until it is true
let turnEnded = true

// What the session.compact hook made of smart-compact's own /compact; the runner logs it.
let ownResult: { outcome: string; tokens?: LogTokens } | undefined

const count = (decision: string) => {
  const kind = decision.split(':').slice(0, decision.startsWith('skipped:') ? 2 : 1).join(':')
  stats.byDecision[kind] = (stats.byDecision[kind] ?? 0) + 1
}

function writeLog($: any, change: (list: LogEntry[]) => Promise<LogEntry[]>) {
  logChain = logChain.then(async () => {
    try {
      const r: any = await $.store.set(LOG_KEY, await change(asLog(await $.store.get(LOG_KEY))))
      if (r && typeof r === 'object' && 'deny' in r) throw new Error(String(r.deny))
    } catch (err) {
      stats.logWriteErrors++
      stats.lastLogError = firstLine(err)
    }
  })
}

// One stored entry; returns its id so the recapping entry's outcome can be patched in later.
function logDecision($: any, percent: number | null | undefined, threshold: number, decision: string, outcome = decision) {
  count(decision)
  const id = `${PROC}-${++logSeq}`
  writeLog($, async list => {
    const ts = (await $.clock.now()) as number
    let session = 'unknown'
    try {
      session = String(await $.session.id())
    } catch {}
    return appendLog(list, { id, ts, session, percent: percent ?? null, threshold, decision, outcome, arm: armNow() })
  })
  return id
}

const readLog = async ($: any) => {
  try {
    return asLog(await $.store.get(LOG_KEY))
  } catch {
    return []
  }
}

// Patches the ring entry; a compaction is also kept in the compaction list the per-arm totals read.
function logOutcome($: any, id: string, outcome: string, tokens?: LogTokens, extra: Partial<LogEntry> = {}) {
  writeLog($, async list => {
    const patched = list.map(e => (e.id === id ? { ...e, outcome, ...(tokens ? { tokens } : {}), ...extra } : e))
    const entry = patched.find(e => e.id === id)
    if (entry) await $.store.set(COMPACTIONS_KEY, recordCompaction(asCompactions(await $.store.get(COMPACTIONS_KEY)), entry))
    return patched
  })
}

async function readCompactions($: any) {
  try {
    return seedCompactions(await readLog($), asCompactions(await $.store.get(COMPACTIONS_KEY)))
  } catch {
    return []
  }
}

// The handoff kept for this project; its Corrections join the lessons.
async function keepRecap($: any, text: string) {
  try {
    const root = await $.session.root()
    const now = (await $.clock.now()) as number
    await $.store.set(recapKey(root), makeRecap(text, now, await $.session.id()))
    const kept = ((await $.store.get(lessonsKey(root))) as string[] | undefined) ?? []
    const fresh = corrections(text)
    if (fresh.length > 0) await $.store.set(lessonsKey(root), mergeLessons(kept, fresh))
  } catch {}
}

// The conversation as the model is sent it (as: 'api'): after a compaction it opens on the summary.
async function apiRows($: any): Promise<{ role: string; text: string }[] | undefined> {
  try {
    const rows = (await $.session.messages({ as: 'api' })) as { role: string; text?: string; content?: unknown }[]
    return rows.map(r => ({ role: r.role, text: typeof r.text === 'string' ? r.text : apiText(r.content) }))
  } catch {
    return undefined
  }
}

function apiText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((b: any) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).filter(Boolean).join('\n')
}

// A model's usage as the log shows it: input counts input + cache_read + cache_creation. A bad field reads as 0.
type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const tokenUse = (u?: Usage): TokenUse | undefined =>
  u && typeof u === 'object'
    ? { input: num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens), output: num(u.output_tokens) }
    : undefined

// Only the counts that exist; an empty object is no tokens.
function logTokens(recap?: Usage, done?: { usage?: Usage; tokensBefore?: number; tokensAfter?: number }): LogTokens | undefined {
  const t: LogTokens = {}
  const r = tokenUse(recap)
  if (r) t.recap = r
  const s = tokenUse(done?.usage)
  if (s) t.summarizer = s
  if (typeof done?.tokensBefore === 'number') t.before = done.tokensBefore
  if (typeof done?.tokensAfter === 'number') t.after = done.tokensAfter
  return Object.keys(t).length ? t : undefined
}

// smart-compact's own result goes to its runner; an auto-compact gets a log entry of its own.
async function settle($: any, kind: HandoffFor, threshold: number, outcome: string, tokens?: LogTokens) {
  if (kind === 'own') {
    ownResult = { outcome, tokens }
    return
  }
  // the hook saw this one: the next turn end is not an unreported compaction
  lastTokens = undefined
  let percent: number | null = null
  try {
    percent = (await readContext($)).percent ?? null
  } catch {}
  logOutcome($, logDecision($, percent, threshold, 'auto-compact', 'pending'), outcome, tokens)
}

// One fork over the transcript; kept as the project's recap, its Corrections added to the lessons.
async function recapNow($: any): Promise<{ text: string; usage?: Usage } | { reason: string }> {
  const r = await $.model.fork({ prompt: RECAP_PROMPT })
  if (!r.isAnswered) return { reason: String(r.reason) }
  await keepRecap($, r.text)
  return { text: r.text, usage: r.usage }
}

async function storedRecap($: any): Promise<Recap | undefined> {
  try {
    const r = (await $.store.get(recapKey(await $.session.root()))) as Recap | undefined
    return isFresh(r, (await $.clock.now()) as number) ? r : undefined
  } catch {
    return undefined
  }
}

// Interactive, these views are tabs of the board (Ink); headless, their text is the answer.
async function onBoard($: any, to: BoardTab): Promise<boolean> {
  if ((await $.session.surfaces()).length === 0) return false
  await update($, boardTab, () => to)
  await $.ui.open(BOARD_OPEN)
  return true
}

async function keepGuidedRecap($: any) {
  const text = summaryOf((await apiRows($)) ?? [])
  if (text) await keepRecap($, text)
}

// At each main-loop turn end: fills in the after-tokens of the last compaction, and logs a compaction no hook
// reported (the engine's, where the session.compact hook is bypassed) from the drop in context tokens.
function noteTurnTokens($: any, percent: number | undefined, threshold: number, tokens: number | undefined) {
  if (pendingAfter && tokens !== undefined) {
    const p = pendingAfter
    pendingAfter = undefined
    // an unobserved one that dropped the context did compact: the guided path, its summary kept now
    const seen = p.outcome === 'unobserved' && tokensDropped(p.tokensBefore, tokens)
    logOutcome($, p.id, seen ? 'compacted:guided' : p.outcome, undefined, { tokensAfter: tokens })
    if (seen) void keepGuidedRecap($)
  } else if (tokensDropped(lastTokens, tokens)) {
    const id = logDecision($, percent ?? null, threshold, 'auto-compact', 'pending')
    logOutcome($, id, 'compacted:engine', undefined, { tokensBefore: lastTokens, tokensAfter: tokens, recapCalls: 0 })
  }
  lastTokens = tokens
}

export const register = (on: On, options: PluginOptions) => {
  liveOptions = options
  on('command.run', { command: 'smart-compact' }, async ($, e) => {
    const current = thresholdOf(options)
    const parsed = parseSmartCompactArgs(e.args)
    const now = (await $.clock.now()) as number
    const totals = async () => fmtArmTotals(armTotals(await readCompactions($)))
    if (parsed.kind === 'log') return { text: [fmtLog(await readLog($), now), '', await totals()].join('\n') }
    if (parsed.kind === 'status') {
      let context = 'context unknown'
      try {
        context = fmtContext(await readContext($), current)
      } catch {}
      const head = enabledOf(options)
        ? `handoff + compact at ${current}%. /smart-compact <${MIN}-${MAX}> sets it, off stops it, log lists the checks.`
        : `off: the engine compacts alone (logged as the off arm). /smart-compact on turns it back on at ${current}%.`
      return { text: [head, fmtLastCheck(await readLog($), now), fmtStats(stats), context, await totals()].join('\n') }
    }
    if (parsed.kind === 'off' || parsed.kind === 'on') {
      const set = await $.config.set({ key: `${$.plugin.name}.${ENABLED_FIELD}`, value: parsed.kind === 'on' })
      if (set.deny !== undefined) return { text: `not changed: ${set.deny}` }
      return { text: parsed.kind === 'on' ? `on: handoff + compact at ${current}%.` : 'off: the engine compacts alone; its compactions are still logged.' }
    }
    if (parsed.kind === 'invalid') {
      return { text: `"${e.args.trim()}" is not a whole number from ${MIN} to ${MAX}, log, on or off; still ${current}%.` }
    }
    const set = await $.config.set({ key: `${$.plugin.name}.${THRESHOLD_FIELD}`, value: parsed.value })
    if (set.deny !== undefined) return { text: `not changed: ${set.deny}` }
    return { text: `handoff + compact at ${parsed.value}% (was ${current}%).` }
  }).catch(($, e, next) => next(e))

  // /handoff [to]: a recap now, kept for the next start; with a session name or id, sent there too.
  on('command.run', { command: 'handoff' }, async ($, e) => {
    const r = await recapNow($)
    if ('reason' in r) return { text: `no recap: ${r.reason}` }
    const to = e.args.trim()
    let note = ''
    if (to) {
      const address = /^session_|^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(to) ? { sessionId: to } : to
      const sent = await $.session.send({ to: address, text: `Handoff from another session:\n\n${r.text}` }).catch(
        (err: unknown) => ({ isDelivered: false as const, reason: String(err) }),
      )
      note = sent.isDelivered ? `sent to ${to}` : `not sent to ${to}: ${sent.reason.split('\n')[0]}`
    }
    if (await onBoard($, 'recap')) return { text: ['Recap kept, on the board', note].filter(Boolean).join('; ') + '.' }
    return { text: note ? `${r.text}\n\n${note}` : r.text }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'last-recap' }, async $ => {
    if (await onBoard($, 'recap')) return { text: 'Recap opened on the board.' }
    const r = await storedRecap($)
    if (!r) return { text: 'No recap for this project in the last 7 days. /handoff makes one now.' }
    return { text: `Recap from ${fmtAgo(((await $.clock.now()) as number) - r.ts)}:\n\n${r.text}` }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'lessons' }, async ($, e) => {
    const key = lessonsKey(await $.session.root())
    if (e.args.trim() === 'clear') {
      await $.store.delete(key)
      return { text: 'Lessons cleared for this project.' }
    }
    if (await onBoard($, 'lessons')) return { text: 'Lessons opened on the board.' }
    const kept = ((await $.store.get(key)) as string[] | undefined) ?? []
    if (kept.length === 0) return { text: 'No lessons yet: they come from the Corrections section of each recap.' }
    const lines = kept.map((l, i) => `${i + 1}. ${l}`)
    return { text: [...lines, '', 'Worth keeping? Move it to CLAUDE.md. /lessons clear empties the list.'].join('\n') }
  }).catch(($, e, next) => next(e))

  // Matched on reason, so it sits beside mod.tsx's unmatched turn.complete hook.
  on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
    if (!e.agentId) turnEnded = true
    const result = await next(e)
    stats.evaluated++
    const threshold = thresholdOf(options)
    if (e.agentId) return count('skipped:agent'), result
    if (isRunning) return logDecision($, null, threshold, 'skipped:running'), result
    if ((await $.session.surfaces()).length === 0) return count('skipped:headless'), result

    let raw: number | undefined
    let tokens: number | undefined
    try {
      const ctx = await readContext($)
      raw = ctx.percent ?? undefined
      tokens = ctx.tokens
    } catch (err) {
      logDecision($, null, threshold, `usage-failed:${firstLine(err)}`)
      throw err
    }
    noteTurnTokens($, raw, threshold, tokens)
    if (!enabledOf(options)) return count('skipped:off'), result
    const percent = raw ?? 0
    if (percent < threshold) return logDecision($, raw, threshold, 'below'), result

    startRecapThenCompact($, raw, percent, threshold)
    return result
  }).catch(($, e, next) => next(e))

  // Auto-compact and smart-compact's own /compact: a handoff made now, over the rows being compacted, then the
  // handoff and the newest rows verbatim stand in for the summarizer, one model call. It is made here, not before
  // the compact, so no row arrives between the two. A person's /compact and a subagent's go on to the engine, as
  // does a handoff that cannot be made; our mark never reaches the summarizer as instructions.
  on('session.compact', async ($, e, next) => {
    const found = handoffFor(e)
    // a precompute keeps the engine's own; off, the engine compacts alone
    const kind = found === 'precompute' || !enabledOf(options) ? null : found
    const rows = e.messages ?? []
    if (!kind || !rows.length) return next(e)
    const engine = async (outcome: string) => {
      const done = await next(kind === 'own' ? { ...e, instructions: undefined } : e)
      const tokens = done.skip ? undefined : logTokens(undefined, done as { usage?: Usage; tokensBefore?: number; tokensAfter?: number })
      await settle($, kind, thresholdOf(options), done.skip ? `skip:${done.skip}` : outcome, tokens)
      return done
    }
    const window = (await $.session.usage()).context?.window
    if (!window) return engine('compacted')
    const recap = await recapNow($)
    if ('reason' in recap) return engine(`recap-failed:${recap.reason}`)
    const tail = rows.slice(tailStart(rows, tailBudget(window, thresholdOf(options))))
    await settle($, kind, thresholdOf(options), `compacted:recap+${tail.length}`, logTokens(recap.usage))
    return { messages: [{ role: 'user' as const, text: RECAP_HEADER + recap.text, toolUses: [] }, ...tail] }
  }).catch(($, e, next) => next(e))
}

// A module may hook an event once without a matcher, so mod.tsx's tool.call and turn.complete hooks call these.
// Mid-turn: a long turn can cross the threshold before turn.complete. Never throws, never alters the call.
export async function midTurnCheck($: any, e: { agentId?: string }, options: PluginOptions) {
  if (e.agentId) return
  turnEnded = false
  try {
    if (isRunning || (await $.session.surfaces()).length === 0) return
    const raw = (await readContext($)).percent ?? undefined
    const threshold = thresholdOf(options)
    const percent = raw ?? 0
    if (shouldCompactNow(percent, threshold, { isRunning, surfaces: 1 }) === 'run') startRecapThenCompact($, raw, percent, threshold)
  } catch (err) {
    // every tool call would write a log entry; only the count (shown by /smart-compact) is kept
    count(`usage-failed:${firstLine(err)}`)
  }
}

// Any turn end, whatever its reason, releases a compact that waits for the turn to finish.
export const turnEnd = (e: { agentId?: string }) => {
  if (!e.agentId) turnEnded = true
}

// /compact with our mark; the session.compact hook above makes the handoff and the compaction. A /compact raised
// by the engine reaches this module's hooks, where $.session.compact from here would skip them. One run at a
// time, off the hook that started it.
function startRecapThenCompact($: any, raw: number | null | undefined, percent: number, threshold: number) {
  isRunning = true
  const id = logDecision($, raw, threshold, 'recapping', 'pending')
  const run = async () => {
    $.ui.status(`smart-compact: ${percent}% ≥ ${threshold}%, handing off`)
    // no compaction under a running turn: mid-turn, wait for it to end
    while (!turnEnded) await $.clock.sleep(500)
    let tokensBefore: number | undefined
    try {
      tokensBefore = (await readContext($)).tokens
    } catch {}
    const rowsBefore = (await apiRows($))?.length
    ownResult = undefined
    // The handoff sections ride along as instructions: where the session.compact hook is bypassed (a policy
    // plugin that runs first), the engine's summarizer writes the handoff in its one call.
    await $.command.run({ command: 'compact', args: HANDOFF_INSTRUCTIONS })
    // the hook set it during the await; read past the narrowing of the assignment above
    const own = ownResult as typeof ownResult
    let outcome: string
    let extra: Partial<LogEntry>
    if (own) {
      outcome = own.outcome
      extra = { tokensBefore: own.tokens?.before ?? tokensBefore, tokensAfter: own.tokens?.after, recapCalls: outcome.startsWith('compacted:recap') ? 1 : 0 }
    } else {
      const after = await apiRows($)
      if (compactionSeen(rowsBefore, after?.length)) {
        outcome = 'compacted:guided'
        const text = summaryOf(after ?? [])
        if (text) await keepRecap($, text)
        extra = { tokensBefore, recapCalls: 0 }
      } else {
        // not seen yet: the next turn end decides it from the drop in context tokens
        outcome = 'unobserved'
        extra = { tokensBefore, recapCalls: 0 }
      }
    }
    // the context after a compaction shows at the next turn end; until then this one waits for it
    lastTokens = undefined
    pendingAfter = extra.tokensAfter === undefined ? { id, outcome, tokensBefore } : undefined
    $.ui.toast(outcome.startsWith('compacted') ? 'smart-compact: handed off and compacted' : `smart-compact: ${outcome}`)
    logOutcome($, id, outcome, own?.tokens, extra)
  }
  void run().catch(err => logOutcome($, id, `error:${firstLine(err)}`)).finally(() => {
    $.ui.status(statusLine({}))
    isRunning = false
  })
}
