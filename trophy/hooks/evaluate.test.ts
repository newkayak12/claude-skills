import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { achievements } from '../data/achievements.ts'
import { evaluate } from './logic.ts'
import type { Use } from './logic.ts'
import { language, memoryStore, sessionAt } from './testkit.ts'

const DAY = 86_400_000
const T0 = Date.parse('2026-10-01T09:00:00Z')
const use = (skill: string, session = 's1', ts = T0): Use => ({
  skill,
  plugin: skill.split(':')[0]!,
  day: new Date(ts).toISOString().slice(0, 10),
  session,
  ts,
})
const ids = (uses: Use[], unlocked: Record<string, string> = {}) => evaluate(uses, achievements, unlocked)
const manySkills = (n: number, plugin = 'develop') => Array.from({ length: n }, (_, i) => use(`${plugin}:s${i}`))

test('first_use: met by a skill of the plugin, unmet otherwise', () => {
  expect(ids([use('think:grill')])).toContain('first-think')
  expect(ids([use('think:grill')])).not.toContain('first-write')
})

test('collect: distinct skills, optionally within a plugin', () => {
  expect(ids(manySkills(10))).toContain('collector-10')
  expect(ids(manySkills(9))).not.toContain('collector-10')
  expect(ids(manySkills(10, 'think'))).toContain('thinker')
  expect(ids(manySkills(10))).not.toContain('thinker')
  expect(ids([...manySkills(9), use('develop:s0', 's2')])).not.toContain('collector-10')
})

test('combo: in order within one session, gaps allowed', () => {
  const cycle = ['think:brainstorming', 'write:plans', 'harness:harness']
  expect(ids([use(cycle[0]!, 'a', T0), use('think:grill', 'a', T0 + 1), use(cycle[1]!, 'a', T0 + 2), use(cycle[2]!, 'a', T0 + 3)])).toContain('full-cycle')
  expect(ids([use(cycle[0]!, 'a', T0), use(cycle[1]!, 'a', T0 + 2), use(cycle[2]!, 'b', T0 + 3)])).not.toContain('full-cycle')
  expect(ids([use(cycle[2]!, 'a', T0), use(cycle[1]!, 'a', T0 + 1), use(cycle[0]!, 'a', T0 + 2)])).not.toContain('full-cycle')
})

test('streak: 7 consecutive days, not 7 days with a gap', () => {
  const days = (offsets: number[]) => offsets.map(d => use('think:grill', `s${d}`, T0 + d * DAY))
  expect(ids(days([0, 1, 2, 3, 4, 5, 6]))).toContain('streak-7')
  expect(ids(days([0, 1, 2, 3, 4, 5, 7]))).not.toContain('streak-7')
})

test('repeat: counts uses of one skill', () => {
  const bag = (n: number) => Array.from({ length: n }, (_, i) => use('think:devils-advocate', `s${i}`))
  expect(ids(bag(3))).toContain('punching-bag')
  expect(ids(bag(2))).not.toContain('punching-bag')
})

test('an unlocked id is never returned again', () => {
  const log = [use('think:grill')]
  expect(ids(log, { 'first-blood': '2026-10-01', 'first-think': '2026-10-01' })).toEqual([])
})

const bottom = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
}

test('each new unlock stores its date and raises one toast; none the second time', async ($, on) => {
  const store = memoryStore(on)
  sessionAt(on)
  bottom(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  await $.skill.prompt({ skill: 'think:grill', text: 'x' })
  await $.skill.prompt({ skill: 'think:grill', text: 'x' })

  expect(toasts).toHaveLength(2)
  expect(toasts[0]).toMatch(/^🏆 /)
  expect(Object.keys(store.get('trophy.unlocked') as object).sort()).toEqual(['first-blood', 'first-think'])
})

test('an unlock draws a celebration card above the prompt that the timer clears', async ($, on) => {
  memoryStore(on)
  const clock = sessionAt(on)
  language(on, 'Korean')
  bottom(on)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as any)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'trophy',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80 } as any,
  })
  expect(await ui.find({ text: /업적 해금/ })).toBeUndefined()

  await $.skill.prompt({ skill: 'think:grill', text: 'x' })

  expect(await ui.find({ text: /업적 해금/ })).toBeDefined()
  expect(await ui.find({ text: /생각의 시작/ })).toBeDefined()
  await clock.advance(8001)
  expect(await ui.find({ text: /업적 해금/ })).toBeUndefined()
})

test('by default the celebration card is in English', async ($, on) => {
  memoryStore(on)
  sessionAt(on)
  bottom(on)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as any)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'trophy',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80 } as any,
  })

  await $.skill.prompt({ skill: 'think:grill', text: 'x' })

  expect(await ui.find({ text: /Achievement unlocked/ })).toBeDefined()
  expect(await ui.find({ text: /Thinking Cap On/ })).toBeDefined()
  expect(await ui.find({ text: /업적 해금/ })).toBeUndefined()
})
