import type { On, PluginOptions } from 'claude-code'

// A short task prompt with no path, code or check named: one toast, at most every 10 minutes. The prompt is never changed.
const TASK_VERB = /(만들|고쳐|고치|추가|바꿔|수정|구현|지워|삭제|\b(fix|add|make|build|change|implement|remove|refactor)\b)/i
const HAS_DETAIL = /[\/\\.`]|\d|test|테스트|확인|검증|verify|check/i
export const HINT_MAX_CHARS = 20
const GAP_MS = 10 * 60 * 1000

export const needsHint = (text: string): boolean => {
  const t = text.trim()
  return t.length > 0 && t.length <= HINT_MAX_CHARS && !t.startsWith('/') && TASK_VERB.test(t) && !HAS_DETAIL.test(t)
}

let lastAt = -Infinity

export const register = (on: On, options: PluginOptions) => {
  // Matched on the person's own typing, so it sits beside memo's unmatched prompt.submit hook.
  on('prompt.submit', { origin: { kind: 'composer' } }, async ($, e, next) => {
    if (options.prompt_hint === true && needsHint(e.text)) {
      const now = (await $.clock.now()) as number
      if (now - lastAt >= GAP_MS) {
        lastAt = now
        $.ui.toast('short task prompt: scope or a check to verify missing?')
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
