import { test, expect } from 'claude-code/testing'

import { corrections, fmtAgo, isFresh, lessonsKey, mergeLessons, recapKey, LESSONS_MAX } from './recap.ts'
import { costText } from './status.ts'
import { dayOf, parseTask, TASK_KEY, TASK_LOG_KEY, todayLines } from './timer.ts'
import { needsHint } from './hint.ts'
import { guardWorld } from './testkit.ts'

const NOW = Date.parse('2026-10-08T09:00:00Z')
const TURN = { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't' } as never
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const RECAP = `1. Goal: ship\n6. Corrections:\n- verify before saying done\n- reply in Korean\n`

const cmd = ($: any, command: string, args = '') =>
  $.command.run({ command, args } as never) as Promise<{ text?: string }>

const world = (on: any, w: { store?: Record<string, unknown>; percent?: number; cost?: number; surfaces?: 'terminal'[] } = {}) => {
  const seen = guardWorld(on, { store: w.store, surfaces: w.surfaces })
  const sends: { to: unknown; text: string }[] = []
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 100, tokens: 0, percent: w.percent ?? 0 }, rateLimits: [{ kind: '5h', percentUsed: 42 }], cost: { usd: w.cost ?? 1.234 } },
  }) as never)
  on('model.fork', () => ({ value: { isAnswered: true, text: RECAP, usage: USAGE } }) as never)
  on('session.send', (_$: any, e: any) => {
    sends.push({ to: e.to, text: e.text })
    return { isDelivered: true } as never
  })
  return { seen, sends }
}

// pure pieces
test('corrections reads the 6th section and drops "none"', () => {
  expect(corrections(RECAP)).toEqual(['verify before saying done', 'reply in Korean'])
  expect(corrections('6. Corrections:\n- none\n')).toEqual([])
  expect(corrections('no such section')).toEqual([])
})

test('lessons merge drops duplicates and keeps the newest 20', () => {
  expect(mergeLessons(['a'], ['a', 'b'])).toEqual(['a', 'b'])
  const many = Array.from({ length: 25 }, (_, i) => `l${i}`)
  expect(mergeLessons([], many)).toHaveLength(LESSONS_MAX)
  expect(mergeLessons([], many).at(-1)).toBe('l24')
})

test('a recap is fresh for 7 days', () => {
  expect(isFresh({ text: 'x', ts: NOW - 6 * 864e5, sessionId: 's' }, NOW)).toBe(true)
  expect(isFresh({ text: 'x', ts: NOW - 8 * 864e5, sessionId: 's' }, NOW)).toBe(false)
  expect(fmtAgo(90 * 60000)).toBe('1h ago')
})

test('cost text shows usd and the highest rate limit', () => {
  expect(costText(1.234, [{ kind: '5h', percentUsed: 42 }, { kind: '7d', percentUsed: 10 }])).toBe('$1.23 · 5h 42%')
  expect(costText(undefined, [])).toBe('')
})

test('task commands parse; today sums by name', () => {
  expect(parseTask('')).toEqual({ op: 'show' })
  expect(parseTask('done')).toEqual({ op: 'done' })
  expect(parseTask('write docs')).toEqual({ op: 'start', name: 'write docs' })
  const day = dayOf(NOW)
  expect(todayLines([{ name: 'a', ms: 600000, day }, { name: 'a', ms: 600000, day }, { name: 'b', ms: 60000, day: '2020-01-01' }], day)).toEqual(['   20m  a', '   20m  total'])
})

test('prompt hint fires only on short task prompts without detail', () => {
  expect(needsHint('고쳐줘')).toBe(true)
  expect(needsHint('fix it')).toBe(true)
  expect(needsHint('끝?')).toBe(false)
  expect(needsHint('src/a.ts 고쳐줘')).toBe(false)
  expect(needsHint('테스트 추가하고 확인까지 해줘')).toBe(false)
  expect(needsHint('/smart-compact 30')).toBe(false)
})

// E7 + E2 + E5 through the engine
test('/handoff keeps the recap and its corrections; /recap prints it (headless text)', async ($, on) => {
  const w = world(on, { surfaces: [] })
  expect((await cmd($, 'handoff')).text).toContain('Goal: ship')
  expect((w.seen.store.get(recapKey('/proj')) as { text: string }).text).toBe(RECAP)
  expect(w.seen.store.get(lessonsKey('/proj'))).toEqual(['verify before saying done', 'reply in Korean'])
  expect((await cmd($, 'recap')).text).toContain('Goal: ship')
  expect((await cmd($, 'lessons')).text).toContain('1. verify before saying done')
  await cmd($, 'lessons', 'clear')
  expect(w.seen.store.get(lessonsKey('/proj'))).toBeUndefined()
})

test('interactive, /handoff /recap /lessons /task log open board tabs and answer one line', async ($, on) => {
  const w = world(on)
  const one = async (command: string, args = '') => {
    const t = (await cmd($, command, args)).text ?? ''
    expect(t.split('\n')).toHaveLength(1)
    return t
  }
  expect(await one('handoff')).toContain('Recap kept')
  expect(await one('recap')).toContain('board')
  expect(await one('lessons')).toContain('board')
  expect(await one('task', 'log')).toContain('board')
  expect(w.seen.opened).toEqual(['board', 'board', 'board', 'board'])
  expect((w.seen.store.get(recapKey('/proj')) as { text: string }).text).toBe(RECAP)
})

test('/handoff <name> sends the recap to that session', async ($, on) => {
  const w = world(on)
  expect((await cmd($, 'handoff', 'other')).text).toContain('sent to other')
  expect(w.sends).toHaveLength(1)
  expect(w.sends[0]!.to).toBe('other')
  expect(w.sends[0]!.text).toContain('Goal: ship')
})

test('smart-compact keeps its recap too', async ($, on) => {
  const w = world(on, { percent: 90 })
  let done = () => {}
  const compacted = new Promise<void>(r => (done = r))
  on('session.compact', () => {
    done()
    return { messages: [] }
  })
  await $.turn.complete(TURN)
  await compacted
  expect((w.seen.store.get(recapKey('/proj')) as { text: string }).text).toBe(RECAP)
})

test('/recap with nothing stored says how to make one', async ($, on) => {
  world(on, { surfaces: [] })
  expect((await cmd($, 'recap')).text).toMatch(/\/handoff/)
})

// E1
test('turn end puts cost and rate limit in the status line', async ($, on) => {
  const w = world(on)
  await $.turn.complete(TURN)
  expect(w.seen.statuses.at(-1)).toContain('$1.23 · 5h 42%')
})

test('the cost budget toasts once', { options: { cost_budget_usd: 1 } }, async ($, on) => {
  const w = world(on, { cost: 2 })
  await $.turn.complete(TURN)
  await $.turn.complete(TURN)
  expect(w.seen.toasts.filter(t => /budget/.test(t))).toHaveLength(1)
})

// E6
test('/task starts, shows, finishes and logs today', async ($, on) => {
  const w = world(on)
  expect((await cmd($, 'task', 'write docs')).text).toContain('started: write docs')
  expect(w.seen.store.get(TASK_KEY)).toMatchObject({ name: 'write docs' })
  expect(w.seen.statuses.at(-1)).toContain('⏱ write docs 0m')
  expect((await cmd($, 'task', 'done')).text).toContain('done: write docs')
  expect(w.seen.store.get(TASK_KEY)).toBeUndefined()
  expect(w.seen.store.get(TASK_LOG_KEY)).toHaveLength(1)
  expect((await cmd($, 'task', 'log')).text).toBe('Today opened on the board.')
})

// E8
const typed = (text: string) => ({ text, origin: { kind: 'composer' }, wait: false }) as never
test('prompt hint is off by default', async ($, on) => {
  const w = world(on)
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  await $.prompt.submit(typed('고쳐줘'))
  expect(w.seen.toasts).toEqual([])
})

test('prompt hint on: one toast, prompt unchanged, rate-limited', { options: { prompt_hint: true } }, async ($, on) => {
  const w = world(on)
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  const r = (await $.prompt.submit(typed('고쳐줘'))) as unknown as { text: string }
  await $.prompt.submit(typed('fix it'))
  expect(r.text).toBe('고쳐줘')
  expect(w.seen.toasts.filter(t => /short task prompt/.test(t))).toHaveLength(1)
})
