import type { On, PluginOptions } from 'claude-code'

// Recap the session at a set context %, then compact with that recap as the summary instructions.
// The threshold is the userConfig field, so /config shows it; /smart-compact <n> writes the same field.
export const THRESHOLD_FIELD = 'smart_compact_threshold'
const DEFAULT_THRESHOLD = 70
const MIN = 10
const MAX = 95

const RECAP_PROMPT = `Write a recap of this session that a fresh context can continue from. Use the session's language. Sections:
1. Goal: what the user is trying to achieve
2. Decisions: what was settled, with the reason
3. State: what is done, files touched, what is verified
4. Open: unfinished work, known problems
5. Direction: the next concrete steps
Plain text, no preamble.`

const thresholdOf = (options: PluginOptions) => Number(options[THRESHOLD_FIELD] ?? DEFAULT_THRESHOLD)
let isRunning = false

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
      const recap = await $.model.fork({ prompt: RECAP_PROMPT })
      if (!recap.isAnswered) {
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
      $.ui.status(undefined)
      isRunning = false
    })
    return result
  }).catch(($, e, next) => next(e))
}
