import { atom, update } from 'claude-code'
import type { On, PluginOptions } from 'claude-code'

import { appendLog, asLog, fmtLastCheck, fmtLog, fmtStats, LOG_KEY, patchLog } from './compact-log.ts'
import type { LogEntry, LogStats } from './compact-log.ts'
import { corrections, fmtAgo, isFresh, lessonsKey, makeRecap, mergeLessons, RECAP_PROMPT, recapKey } from './recap.ts'
import type { Recap } from './recap.ts'
import { statusLine } from './status.ts'
import { BOARD_PANE } from './board.ts'
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

const firstLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split('\n')[0]!

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

const logOutcome = ($: any, id: string, outcome: string) => writeLog($, async list => patchLog(list, id, outcome))

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
  await $.ui.open({ id: BOARD_PANE, title: 'Board' })
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

  on('command.run', { command: 'recap' }, async $ => {
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

    isRunning = true
    const id = logDecision($, raw, threshold, 'recapping', 'pending')
    const recapThenCompact = async () => {
      $.ui.status(`smart-compact: ${percent}% ≥ ${threshold}%, recapping`)
      const recap = await recapNow($)
      if ('reason' in recap) {
        $.ui.toast(`smart-compact: recap failed (${recap.reason}), left to auto-compact`)
        logOutcome($, id, `recap-failed:${recap.reason}`)
        return
      }
      const instructions = `Keep this recap and direction intact in the summary:\n\n${recap.text}`
      // compact rejects while a turn runs; retry until the turn has ended
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const done = await $.session.compact({ instructions })
          $.ui.toast(done.skip ? `smart-compact: skipped (${done.skip})` : 'smart-compact: recapped and compacted')
          logOutcome($, id, done.skip ? `skip:${done.skip}` : 'compacted')
          return
        } catch {
          await $.clock.sleep(500)
        }
      }
      $.ui.toast('smart-compact: could not compact, left to auto-compact')
      logOutcome($, id, 'compact-failed')
    }
    void recapThenCompact().catch(err => logOutcome($, id, `error:${firstLine(err)}`)).finally(() => {
      $.ui.status(statusLine({}))
      isRunning = false
    })
    return result
  }).catch(($, e, next) => next(e))
}
