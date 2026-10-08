import { test, expect } from 'claude-code/testing'

import { THRESHOLD_FIELD } from './compact.ts'
import { guardWorld } from './testkit.ts'

const TURN = { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't' } as never
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

const world = (on: any, percent: number, opts: { surfaces?: 'terminal'[] } = {}) => {
  const seen = guardWorld(on, { surfaces: opts.surfaces })
  const configSets: { key: string; value: unknown }[] = []
  on('config.set', (_$: any, e: any) => {
    configSets.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  let forks = 0
  let done = (_: string) => {}
  const compacted = new Promise<string>(r => (done = r))
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 100, tokens: percent, percent }, rateLimits: [] } }) as never)
  on('model.fork', () => {
    forks++
    return { value: { isAnswered: true, text: 'GOAL: ship smart-compact', usage: USAGE } } as never
  })
  on('session.compact', (_$: any, e: any) => {
    done(e.instructions ?? '')
    return { messages: [] }
  })
  return { seen, compacted, configSets, forks: () => forks }
}

const run = ($: any, args: string) =>
  $.command.run({ command: 'smart-compact', args } as never) as Promise<{ text?: string }>

test('/smart-compact is registered at session start', async ($, on) => {
  const w = world(on, 0)
  on('classic.SessionStart', () => ({}))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  expect(w.seen.commands).toContain('smart-compact')
})

test('at the default 70% it recaps, then compacts with the recap', async ($, on) => {
  const w = world(on, 75)
  await $.turn.complete(TURN)
  expect(await w.compacted).toContain('GOAL: ship smart-compact')
  expect(w.forks()).toBe(1)
})

test('below the threshold nothing runs', async ($, on) => {
  const w = world(on, 50)
  await $.turn.complete(TURN)
  expect(w.forks()).toBe(0)
})

test('a subagent turn and a headless session never trigger it', async ($, on) => {
  const w = world(on, 90, { surfaces: [] })
  await $.turn.complete(TURN)
  await $.turn.complete({ ...(TURN as object), agentId: 'a1' } as never)
  expect(w.forks()).toBe(0)
})

test('/smart-compact <n> writes the /config field', async ($, on) => {
  const w = world(on, 0)
  expect((await run($, '40%')).text).toContain('40% (was 70%)')
  expect(w.configSets).toEqual([{ key: `session.${THRESHOLD_FIELD}`, value: 40 }])
})

test('the /config value is the threshold', { options: { [THRESHOLD_FIELD]: 40 } }, async ($, on) => {
  const w = world(on, 45)
  await $.turn.complete(TURN)
  await w.compacted
  expect(w.forks()).toBe(1)
})

test('/smart-compact refuses out of range and shows the kept value', { options: { [THRESHOLD_FIELD]: 80 } }, async ($, on) => {
  const w = world(on, 0)
  expect((await run($, '200')).text).toContain('still 80%')
  expect((await run($, '')).text).toContain('at 80%')
  expect(w.configSets).toEqual([])
})
