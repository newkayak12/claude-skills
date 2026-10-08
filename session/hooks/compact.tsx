import type { On, PluginOptions } from 'claude-code'

import { corrections, fmtAgo, isFresh, lessonsKey, makeRecap, mergeLessons, RECAP_PROMPT, recapKey } from './recap.ts'
import type { Recap } from './recap.ts'
import { statusLine } from './status.ts'

// Recap the session at a set context %, then compact with that recap as the summary instructions.
// The threshold is the userConfig field, so /config shows it; /smart-compact <n> writes the same field.
// Every recap (here or /handoff) is kept per project: the next start shows it, /lessons collects its Corrections.
export const THRESHOLD_FIELD = 'smart_compact_threshold'
export const RECAP_PANE = 'recap'
const DEFAULT_THRESHOLD = 70
const MIN = 10
const MAX = 95

const thresholdOf = (options: PluginOptions) => Number(options[THRESHOLD_FIELD] ?? DEFAULT_THRESHOLD)
let isRunning = false

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

export const register = (on: On, options: PluginOptions) => {
  on('command.run', { command: 'smart-compact' }, async ($, e) => {
    const current = thresholdOf(options)
    const arg = e.args.trim().replace(/%$/, '')
    if (!arg) return { text: `recap + compact at ${current}%. Change it with /smart-compact <${MIN}-${MAX}>.` }

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
    if (!to) return { text: r.text }
    const address = /^session_|^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(to) ? { sessionId: to } : to
    const sent = await $.session.send({ to: address, text: `Handoff from another session:\n\n${r.text}` }).catch(
      (err: unknown) => ({ isDelivered: false as const, reason: String(err) }),
    )
    return { text: `${r.text}\n\n${sent.isDelivered ? `sent to ${to}` : `not sent to ${to}: ${sent.reason}`}` }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'recap' }, async $ => {
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
    const kept = ((await $.store.get(key)) as string[] | undefined) ?? []
    if (kept.length === 0) return { text: 'No lessons yet: they come from the Corrections section of each recap.' }
    const lines = kept.map((l, i) => `${i + 1}. ${l}`)
    return { text: [...lines, '', 'Worth keeping? Move it to CLAUDE.md. /lessons clear empties the list.'].join('\n') }
  }).catch(($, e, next) => next(e))

  // The pane the band's Recap button opens: the stored text, read-only.
  on('ui.render', { component: 'Pane', requestId: RECAP_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const r = await storedRecap($)
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text>{r ? r.text : 'No recap for this project in the last 7 days.'}</Text>
      </Box>
    )
  })

  // Matched on reason, so it sits beside mod.tsx's unmatched turn.complete hook.
  on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId || isRunning) return result
    if ((await $.session.surfaces()).length === 0) return result

    const percent = (await $.session.usage()).context.percent ?? 0
    const threshold = thresholdOf(options)
    if (percent < threshold) return result

    isRunning = true
    const recapThenCompact = async () => {
      $.ui.status(`smart-compact: ${percent}% ≥ ${threshold}%, recapping`)
      const recap = await recapNow($)
      if ('reason' in recap) {
        $.ui.toast(`smart-compact: recap failed (${recap.reason}), left to auto-compact`)
        return
      }
      const instructions = `Keep this recap and direction intact in the summary:\n\n${recap.text}`
      // compact rejects while a turn runs; retry until the turn has ended
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const done = await $.session.compact({ instructions })
          $.ui.toast(done.skip ? `smart-compact: skipped (${done.skip})` : 'smart-compact: recapped and compacted')
          return
        } catch {
          await $.clock.sleep(500)
        }
      }
      $.ui.toast('smart-compact: could not compact, left to auto-compact')
    }
    void recapThenCompact().catch(() => {}).finally(() => {
      $.ui.status(statusLine({}))
      isRunning = false
    })
    return result
  }).catch(($, e, next) => next(e))
}
