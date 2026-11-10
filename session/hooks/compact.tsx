import { atom, update } from 'claude-code'
import type { On, PluginOptions } from 'claude-code'

import { COMPACT_MARK, firstLine, handoffFor, RECAP_HEADER, shouldCompactNow, tailBudget, tailStart } from './compact-logic.ts'
import type { HandoffFor } from './compact-logic.ts'
import { appendLog, asLog, fmtLastCheck, fmtLog, fmtStats, LOG_KEY, patchLog } from './compact-log.ts'
import type { LogEntry, LogStats, LogTokens, TokenUse } from './compact-log.ts'
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
// the board pane's tab; mod.tsx draws it
const boardTab = atom({ plugin: 'session', key: 'boardTab' } as const, 'sessions' as BoardTab)
const DEFAULT_THRESHOLD = 70
const MIN = 10
const MAX = 95

const thresholdOf = (options: PluginOptions) => Number(options[THRESHOLD_FIELD] ?? DEFAULT_THRESHOLD)

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
    return appendLog(list, { id, ts, session, percent: percent ?? null, threshold, decision, outcome })
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

function logOutcome($: any, id: string, outcome: string, tokens?: LogTokens) {
  writeLog($, async list => patchLog(list, id, outcome, tokens))
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
  try {
    const root = await $.session.root()
    const now = (await $.clock.now()) as number
    await $.store.set(recapKey(root), makeRecap(r.text, now, await $.session.id()))
    const kept = ((await $.store.get(lessonsKey(root))) as string[] | undefined) ?? []
    const fresh = corrections(r.text)
    if (fresh.length > 0) await $.store.set(lessonsKey(root), mergeLessons(kept, fresh))
  } catch {}
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

export const register = (on: On, options: PluginOptions) => {
  on('command.run', { command: 'smart-compact' }, async ($, e) => {
    const current = thresholdOf(options)
    const arg = e.args.trim().replace(/%$/, '')
    if (arg === 'log') return { text: fmtLog(await readLog($), (await $.clock.now()) as number) }
    if (!arg) {
      let context = 'context unknown'
      try {
        context = fmtContext(await readContext($), current)
      } catch {}
      const lines = [
        `recap + compact at ${current}%. Change it with /smart-compact <${MIN}-${MAX}>; /smart-compact log lists the checks.`,
        fmtLastCheck(await readLog($), (await $.clock.now()) as number),
        fmtStats(stats),
        context,
      ]
      return { text: lines.join('\n') }
    }

    const value = Number(arg)
    if (!Number.isInteger(value) || value < MIN || value > MAX) {
      return { text: `"${e.args.trim()}" is not a whole number from ${MIN} to ${MAX}; still ${current}%.` }
    }
    const set = await $.config.set({ key: `${$.plugin.name}.${THRESHOLD_FIELD}`, value })
    if (set.deny !== undefined) return { text: `not changed: ${set.deny}` }
    return { text: `recap + compact at ${value}% (was ${current}%).` }
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
    try {
      raw = (await readContext($)).percent ?? undefined
    } catch (err) {
      logDecision($, null, threshold, `usage-failed:${firstLine(err)}`)
      throw err
    }
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
    const kind = handoffFor(e)
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
    ownResult = undefined
    await $.command.run({ command: 'compact', args: COMPACT_MARK })
    // the hook set it during the await; read past the narrowing of the assignment above
    const r: { outcome: string; tokens?: LogTokens } = (ownResult as typeof ownResult) ?? { outcome: 'compact-not-run' }
    $.ui.toast(r.outcome.startsWith('compacted:recap') ? 'smart-compact: handed off and compacted' : `smart-compact: ${r.outcome}`)
    logOutcome($, id, r.outcome, r.tokens)
  }
  void run().catch(err => logOutcome($, id, `error:${firstLine(err)}`)).finally(() => {
    $.ui.status(statusLine({}))
    isRunning = false
  })
}
