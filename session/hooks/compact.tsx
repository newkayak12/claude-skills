import { atom, update } from 'claude-code'
import type { On, PluginOptions } from 'claude-code'

import { compactFailed, compactRetry, firstLine, shouldCompactNow } from './compact-logic.ts'
import { appendLog, asLog, fmtLastCheck, fmtLog, fmtStats, LOG_KEY, patchLog } from './compact-log.ts'
import type { LogEntry, LogStats } from './compact-log.ts'
import { corrections, fmtAgo, isFresh, lessonsKey, makeRecap, mergeLessons, RECAP_PROMPT, recapKey } from './recap.ts'
import type { Recap } from './recap.ts'
import { statusLine } from './status.ts'
import { BOARD_OPEN } from './board.ts'
import type { BoardTab } from './board.ts'

// Recap the session at a set context %, then compact with that recap as the summary instructions.
// The threshold is the userConfig field, so /config shows it; /smart-compact <n> writes the same field.
// Every recap (here or /handoff) is kept per project: the next start shows it, /lessons collects its Corrections.
export const THRESHOLD_FIELD = 'smart_compact_threshold'
// the board pane's tab; mod.tsx draws it
const boardTab = atom({ plugin: 'session', key: 'boardTab' } as const, 'sessions' as BoardTab)
const DEFAULT_THRESHOLD = 70
const MIN = 10
const MAX = 95

const thresholdOf = (options: PluginOptions) => Number(options[THRESHOLD_FIELD] ?? DEFAULT_THRESHOLD)
let isRunning = false

// The decision log: writes run one after another on one chain, so a pending→outcome patch and the next
// turn's append cannot overwrite each other. The turn never waits on it; a failing store is only counted.
const stats: LogStats = { evaluated: 0, byDecision: {}, logWriteErrors: 0 }
let logChain: Promise<void> = Promise.resolve()
let logSeq = 0
const PROC = Date.now().toString(36)

// false from a main-thread tool call until the turn's turn.complete; compact only succeeds once it is true
let turnEnded = true

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

function logOutcome($: any, id: string, outcome: string) {
  writeLog($, async list => patchLog(list, id, outcome))
}

// One fork over the transcript; kept as the project's recap, its Corrections added to the lessons.
async function recapNow($: any): Promise<{ text: string } | { reason: string }> {
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
  return { text: r.text }
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
      const lines = [
        `recap + compact at ${current}%. Change it with /smart-compact <${MIN}-${MAX}>; /smart-compact log lists the checks.`,
        fmtLastCheck(await readLog($), (await $.clock.now()) as number),
        fmtStats(stats),
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
      raw = (await $.session.usage()).context.percent
    } catch (err) {
      logDecision($, null, threshold, `usage-failed:${firstLine(err)}`)
      throw err
    }
    const percent = raw ?? 0
    if (percent < threshold) return logDecision($, raw, threshold, 'below'), result

    startRecapThenCompact($, raw, percent, threshold)
    return result
  }).catch(($, e, next) => next(e))

}

// A module may hook an event once without a matcher, so mod.tsx's tool.call and turn.complete hooks call these.
// Mid-turn: a long turn can cross the threshold before turn.complete. Never throws, never alters the call.
export async function midTurnCheck($: any, e: { agentId?: string }, options: PluginOptions) {
  if (e.agentId) return
  turnEnded = false
  try {
    if (isRunning || (await $.session.surfaces()).length === 0) return
    const raw = (await $.session.usage()).context.percent
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

// Recap, then compact with the recap as the summary; one run at a time, off the hook that started it.
function startRecapThenCompact($: any, raw: number | null | undefined, percent: number, threshold: number) {
  isRunning = true
  const id = logDecision($, raw, threshold, 'recapping', 'pending')
  const run = async () => {
    $.ui.status(`smart-compact: ${percent}% ≥ ${threshold}%, recapping`)
    const recap = await recapNow($)
    if ('reason' in recap) {
      $.ui.toast(`smart-compact: recap failed (${recap.reason}), left to auto-compact`)
      logOutcome($, id, `recap-failed:${recap.reason}`)
      return
    }
    // the recap is the summary: compact adds only what it lacks, so the two are not carried twice
    const instructions = `The recap below is the summary; keep it intact. Do not restate what it says, and do not list past user messages or finished work. Add only what its Direction needs and it lacks (exact code, error text):\n\n${recap.text}`
    // compact rejects while a turn runs: wait for the turn to end, then a bounded number of final tries
    let lastError: unknown
    let finalTries = 0
    for (;;) {
      // the first try is at once, even mid-turn; after a rejection, wait for the turn end
      const step = lastError === undefined ? 'try' : compactRetry(turnEnded, finalTries, lastError)
      if (step === 'fail') {
        $.ui.toast('smart-compact: could not compact, left to auto-compact')
        logOutcome($, id, compactFailed(lastError))
        return
      }
      if (step === 'wait') {
        await $.clock.sleep(500)
        continue
      }
      if (turnEnded) finalTries++
      try {
        const done = await $.session.compact({ instructions })
        $.ui.toast(done.skip ? `smart-compact: skipped (${done.skip})` : 'smart-compact: recapped and compacted')
        logOutcome($, id, done.skip ? `skip:${done.skip}` : 'compacted')
        return
      } catch (err) {
        lastError = err
        await $.clock.sleep(500)
      }
    }
  }
  void run().catch(err => logOutcome($, id, `error:${firstLine(err)}`)).finally(() => {
    $.ui.status(statusLine({}))
    isRunning = false
  })
}
