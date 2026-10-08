import { test, expect } from 'claude-code/testing'

import { PS } from './orphankit.ts'
import { bash, guardWorld, ran } from './testkit.ts'

const NONE = PS.split('\n').filter(l => /^\s*(1|4242|4320|9000)\s/.test(l)).join('\n')
const TURN = { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't' } as never

const world = (on: any, ps: string, surfaces?: ('terminal' | 'desktop')[]) => {
  const seen = guardWorld(on, {
    answer: 'Cancel',
    surfaces,
    proc: (argv: readonly string[]) => ran(argv[0] === 'sh' ? '4242\n' : argv[0] === 'ps' ? ps : ''),
  })
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  return seen
}

test('count 0 + 2 denials: turn end keeps the guard part', async ($, on) => {
  const seen = world(on, NONE)
  await bash($, 'rm -rf /')
  await bash($, 'rm -rf /')
  await $.turn.complete(TURN)
  expect(seen.statuses.at(-1)).toBe('guard: 2 denied')
})

test('count 2 + a new deny: both parts shown, neither erased', async ($, on) => {
  const seen = world(on, PS)
  await $.turn.complete(TURN)
  expect(seen.statuses.at(-1)).toBe('⧗ 2 claude -p child(ren) running')
  await bash($, 'rm -rf /')
  expect(seen.statuses.at(-1)).toBe('⧗ 2 claude -p child(ren) running · guard: 1 denied')
  await $.turn.complete(TURN)
  expect(seen.statuses.at(-1)).toBe('⧗ 2 claude -p child(ren) running · guard: 1 denied')
})

test('both empty: the line is cleared', async ($, on) => {
  const seen = world(on, NONE)
  await $.turn.complete(TURN)
  expect(seen.statuses).toEqual([undefined])
})

test('headless: no status', async ($, on) => {
  const seen = world(on, PS, [])
  await bash($, 'rm -rf /')
  await $.turn.complete(TURN)
  expect(seen.statuses).toEqual([])
})
