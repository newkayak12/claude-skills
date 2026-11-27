import { atom, update } from 'claude-code'
import type { On, PluginOptions } from 'claude-code'

import {
  compactionSeen, firstLine, HANDOFF_INSTRUCTIONS, handoffFor, handoffFresh, parseSmartCompactArgs, PREWRITE_MARGIN, precomputeKey,
  prewriteAllowed, RECAP_HEADER, shouldCompactNow, summaryOf, tailBudget, tailStart, tokensDropped,
} from './compact-logic.ts'
import type { HandoffFor } from './compact-logic.ts'
import {
  appendLog, armTotals, asCompactions, asLog, chargePending, COMPACTIONS_KEY, fmtArmTotals, fmtLastCheck, fmtLog, fmtStats, LOG_KEY,
  PREWRITE_OUTCOME, recordCompaction, seedCompactions,
} from './compact-log.ts'
import type { Arm, LogEntry, LogStats, LogTokens, TokenUse } from './compact-log.ts'
import { corrections, fmtAgo, isFresh, lessonsKey, makeRecap, mergeLessons, RECAP_PROMPT, recapKey } from './recap.ts'
import type { Recap } from './recap.ts'
import { fmtContext, statusLinePercent } from '../scripts/context-logic.mjs'
import { handoffBridgePath, makeBridgeRecord } from '../scripts/precompact-logic.mjs'
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

// One pre-write per compaction epoch of a session (arm key `${sessionId}#${compactionEpoch}`): the key is added before
// the fork and never removed, so a failure is not retried in the epoch. The epoch moves wherever a compaction is seen.
const attempted = new Set<string>()
let compactionEpoch = 0
let prewriting = false

// The decision log: writes run one after another on one chain, so a pending→outcome patch and the next
// turn's append cannot overwrite each other. The turn never waits on it; a failing store is only counted.
const stats: LogStats = { evaluated: 0, byDecision: {}, logWriteErrors: 0 }
let logChain: Promise<void> = Promise.resolve()
let logSeq = 0
const PROC = Date.now().toString(36)

// false from a main-thread tool call until the turn's turn.complete; /compact waits until it is true
let turnEnded = true

// What the session.compact hook made of smart-compact's own /compact; the runner logs it.
let ownResult: { outcome: string; tokens?: LogTokens; reusedId?: string } | undefined

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
function logDecision($: any, percent: number | null | undefined, threshold: number, decision: string, outcome = decision, extra: Partial<LogEntry> = {}) {
  count(decision)
  const id = `${PROC}-${++logSeq}`
  writeLog($, async list => {
    const ts = (await $.clock.now()) as number
    let session = 'unknown'
    try {
      session = String(await $.session.id())
    } catch {}
    let project: string | undefined
    try {
      project = String(await $.session.root())
    } catch {}
    return appendLog(list, { id, ts, session, percent: percent ?? null, threshold, decision, outcome, arm: armNow(), ...(project ? { project } : {}), ...extra })
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

// Patches the ring entry; a compaction is also kept in the compaction list the per-arm totals read. Every compaction
// takes on the cost of the pre-writes pending in its project here; reusedId is the pre-write it used, not a discard.
function logOutcome($: any, id: string, outcome: string, tokens?: LogTokens, extra: Partial<LogEntry> = {}, reusedId?: string) {
  writeLog($, async list => {
    const patched = list.map(e => (e.id === id ? { ...e, outcome, ...(tokens ? { tokens } : {}), ...extra } : e))
    const found = patched.find(e => e.id === id)
    if (!found) return patched
    const charged = chargePending(patched, found, reusedId)
    await $.store.set(COMPACTIONS_KEY, recordCompaction(asCompactions(await $.store.get(COMPACTIONS_KEY)), charged.entry))
    return charged.ring.map(e => (e.id === id ? charged.entry : e))
  })
}

async function readCompactions($: any) {
  try {
    return seedCompactions(await readLog($), asCompactions(await $.store.get(COMPACTIONS_KEY)))
  } catch {
    return []
  }
}

// The handoff kept for this project; its Corrections join the lessons. A pre-write also keeps the conversation key it
// covered and its ring entry id; a recap stored without them still reads.
async function keepRecap($: any, text: string, meta: { key?: string; sessionId?: string; prewriteId?: string } = {}) {
  try {
    const root = await $.session.root()
    const now = (await $.clock.now()) as number
    const recap = makeRecap(text, now, meta.sessionId ?? (await $.session.id()))
    await $.store.set(recapKey(root), { ...recap, ...(meta.key ? { key: meta.key } : {}), ...(meta.prewriteId ? { prewriteId: meta.prewriteId } : {}) })
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
async function settle($: any, kind: HandoffFor, threshold: number, outcome: string, tokens?: LogTokens, reusedId?: string) {
  if (!outcome.startsWith('skip:')) compactionEpoch++
  if (kind === 'own') {
    ownResult = { outcome, tokens, reusedId }
    return
  }
  // the hook saw this one: the next turn end is not an unreported compaction
  lastTokens = undefined
  let percent: number | null = null
  try {
    percent = (await readContext($)).percent ?? null
  } catch {}
  logOutcome($, logDecision($, percent, threshold, 'auto-compact', 'pending'), outcome, tokens, {}, reusedId)
}

// One fork over the transcript; kept as the project's recap, its Corrections added to the lessons.
async function recapNow($: any): Promise<{ text: string; usage?: Usage } | { reason: string }> {
  const r = await $.model.fork({ prompt: RECAP_PROMPT })
  if (!r.isAnswered) return { reason: String(r.reason) }
  await keepRecap($, r.text)
  return { text: r.text, usage: r.usage }
}

type StoredRecap = Recap & { key?: string; prewriteId?: string }

async function storedRecap($: any): Promise<StoredRecap | undefined> {
  try {
    const r = (await $.store.get(recapKey(await $.session.root()))) as StoredRecap | undefined
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

// The bridge file the PreCompact command hook reads. Written only when HOME, the session id and the last row's uuid are
// there and that uuid is found on a line of the session's transcript (lineCount is that line's 1-based number);
// anything unproven writes nothing. Returns why: written, no-home, no-session, no-uuid, transcript-unreadable,
// uuid-not-found or write-failed. Never throws.
async function writeBridge($: any, key: string, text: string, sessionId: string, lastUuid: string | undefined): Promise<string> {
  let step = 'no-home'
  try {
    const home = (await $.env.get('HOME')) as string | undefined
    if (!home) return 'no-home'
    if (!sessionId) return 'no-session'
    if (typeof lastUuid !== 'string' || !lastUuid) return 'no-uuid'
    step = 'transcript-unreadable'
    const root = String(await $.session.root())
    // the session's own transcript path; the guessed project-dir path only where info has none
    let path = ''
    try {
      const given = (await $.session.info())?.transcriptPath
      if (typeof given === 'string') path = given
    } catch {}
    if (!path) path = `${home}/.claude/projects/${root.replace(/[^A-Za-z0-9]/g, '-')}/${sessionId}.jsonl`
    const lines = String(await $.fs.read(path)).split('\n')
    let at = -1
    for (let i = lines.length - 1; i >= 0 && at < 0; i--) {
      try {
        if (JSON.parse(lines[i]!)?.uuid === lastUuid) at = i
      } catch {}
    }
    if (at < 0) return 'uuid-not-found'
    step = 'write-failed'
    const ts = (await $.clock.now()) as number
    await $.fs.write(handoffBridgePath(home, root), JSON.stringify(makeBridgeRecord({ key, sessionId, ts, text, lastUuid, lineCount: at + 1 })))
    return 'written'
  } catch {
    return step
  }
}

// One fork over the conversation as it stands, ahead of the threshold. Success: ring entry `prewritten`, the recap kept
// with its key, the bridge written if proven. Failure: `prewrite-failed:<reason>`. Never throws.
async function prewriteNow($: any, raw: number | null, threshold: number, key: string, lastUuid: string | undefined) {
  prewriting = true
  try {
    const r = await $.model.fork({ prompt: RECAP_PROMPT })
    if (!r.isAnswered) {
      logDecision($, raw, threshold, 'prewrite', `prewrite-failed:${String(r.reason)}`, { recapCalls: 1, recapTokens: 0, discardedPrecomputes: 0 })
      return
    }
    const used = tokenUse(r.usage)
    const id = logDecision($, raw, threshold, 'prewrite', PREWRITE_OUTCOME, {
      recapCalls: 1,
      recapTokens: used ? used.input + used.output : 0,
      discardedPrecomputes: 0,
    })
    let sessionId = ''
    try {
      sessionId = String(await $.session.id())
    } catch {}
    await keepRecap($, r.text, { key, sessionId: sessionId || undefined, prewriteId: id })
    const bridge = await writeBridge($, key, r.text, sessionId, lastUuid)
    // a plain patch of the ring entry, not logOutcome: the charge and the compaction counts are untouched
    writeLog($, async list => list.map(e => (e.id === id ? { ...e, bridge } : e)))
  } catch (err) {
    logDecision($, raw, threshold, 'prewrite', `prewrite-failed:${firstLine(err)}`, { recapCalls: 1, recapTokens: 0, discardedPrecomputes: 0 })
  } finally {
    prewriting = false
  }
}

// At each main-loop turn end: fills in the after-tokens of the last compaction, and logs a compaction no hook
// reported (the engine's, where the session.compact hook is bypassed) from the drop in context tokens.
function noteTurnTokens($: any, percent: number | undefined, threshold: number, tokens: number | undefined) {
  if (pendingAfter && tokens !== undefined) {
    const p = pendingAfter
    pendingAfter = undefined
    // an unobserved one that dropped the context did compact: the guided path, its summary kept now
    const seen = p.outcome === 'unobserved' && tokensDropped(p.tokensBefore, tokens)
    if (seen) compactionEpoch++
    logOutcome($, p.id, seen ? 'compacted:guided' : p.outcome, undefined, { tokensAfter: tokens })
    if (seen) void keepGuidedRecap($)
  } else if (tokensDropped(lastTokens, tokens)) {
    compactionEpoch++
    const id = logDecision($, percent ?? null, threshold, 'auto-compact', 'pending')
    logOutcome($, id, 'compacted:engine', undefined, { tokensBefore: lastTokens, tokensAfter: tokens, recapCalls: 0 })
    // the engine's summary is what the model sees now; unreadable, the stored pre-written handoff stays
    if (enabledOf(liveOptions)) void keepGuidedRecap($)
  }
  lastTokens = tokens
}

// Near the threshold, once per conversation key, off the turn. Fails closed: rows that cannot be read mean no fork.
async function startPrewrite($: any, e: { agentId?: string }, raw: number, threshold: number) {
  try {
    const rows = (await $.session.messages()) as { handle?: string; uuid?: string }[]
    const key = precomputeKey(rows)
    // armed per compaction epoch of the session, not per key (the key changes every turn)
    const arm = `${String(await $.session.id())}#${compactionEpoch}`
    const allowed = prewriteAllowed({
      enabled: enabledOf(liveOptions),
      agentId: e.agentId,
      surfaces: (await $.session.surfaces()).length,
      inFlight: isRunning || prewriting,
      percent: raw,
      threshold,
      key: arm,
      attempted,
    })
    if (!rows.length || !allowed) return
    attempted.add(arm)
    // uuid is on a read that names `last` or `after` only, so the newest row's comes from its own read
    let lastUuid: string | undefined
    try {
      const newest = (await $.session.messages({ last: 1 })) as { uuid?: string }[] | { deny?: unknown }
      const uuid = Array.isArray(newest) ? newest[newest.length - 1]?.uuid : undefined
      if (typeof uuid === 'string' && uuid) lastUuid = uuid
    } catch {}
    void prewriteNow($, raw, threshold, key, lastUuid)
  } catch {}
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
    if (percent < threshold) {
      logDecision($, raw, threshold, 'below')
      if (raw !== undefined && raw >= threshold - PREWRITE_MARGIN) await startPrewrite($, e, raw, threshold)
      return result
    }

    startRecapThenCompact($, raw, percent, threshold)
    return result
  }).catch(($, e, next) => next(e))

  // Auto-compact and smart-compact's own /compact: a handoff made now, over the rows being compacted, then the
  // handoff and the newest rows verbatim stand in for the summarizer, one model call. It is made here, not before
  // the compact, so no row arrives between the two. A person's /compact and a subagent's go on to the engine, as
  // does a handoff that cannot be made; our mark never reaches the summarizer as instructions.
  on('session.compact', async ($, e, next) => {
    const found = handoffFor(e)
    // off, the engine compacts alone: an auto-compact is logged in the off arm, nothing else is touched
    const kind = enabledOf(options) ? found : found === 'auto' ? found : null
    const rows = e.messages ?? []
    if (!kind || !rows.length) return next(e)
    const engine = async (outcome: string) => {
      const done = await next(kind === 'own' ? { ...e, instructions: undefined } : e)
      const tokens = done.skip ? undefined : logTokens(undefined, done as { usage?: Usage; tokensBefore?: number; tokensAfter?: number })
      await settle($, kind, thresholdOf(options), done.skip ? `skip:${done.skip}` : outcome, tokens)
      return done
    }
    if (!enabledOf(options)) return engine('compacted')
    const window = (await $.session.usage()).context?.window
    if (!window) return engine('compacted')
    const tailOf = () => rows.slice(tailStart(rows, tailBudget(window, thresholdOf(options))))
    // a fresh stored handoff stands in for the fork
    const stored = await storedRecap($)
    if (stored && typeof stored.key === 'string' && handoffFresh(stored as { key: string }, rows)) {
      const tail = tailOf()
      await settle($, kind, thresholdOf(options), `compacted:handoff+${tail.length}`, undefined, stored.prewriteId)
      return { messages: [{ role: 'user' as const, text: RECAP_HEADER + stored.text, toolUses: [] }, ...tail] }
    }
    const recap = await recapNow($)
    if ('reason' in recap) return engine(`recap-failed:${recap.reason}`)
    const tail = tailOf()
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
        compactionEpoch++
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
    logOutcome($, id, outcome, own?.tokens, extra, own?.reusedId)
  }
  void run().catch(err => logOutcome($, id, `error:${firstLine(err)}`)).finally(() => {
    $.ui.status(statusLine({}))
    isRunning = false
  })
}
