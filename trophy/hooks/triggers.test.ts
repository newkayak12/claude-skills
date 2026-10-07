import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryStore, sessionAt } from './testkit.ts'

const bottom = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', () => ({ value: undefined }))
}
const PROMPT = { wait: false, origin: { kind: 'composer' } } as any
const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

const run = async ($: any, store: Map<string, unknown>, text: string, fired: string[]) => {
  const out = await $.prompt.submit({ text, ...PROMPT })
  for (const skill of fired) await $.skill.prompt({ skill, text: 'x' })
  await $.turn.complete(TURN)
  return { out, counts: store.get('trophy.triggers') as Record<string, Record<string, Record<string, number>>> }
}
const DAY = '2026-10-07'

test('a matched prompt whose skill fired is a hit', async ($, on) => {
  const store = memoryStore(on)
  sessionAt(on)
  bottom(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  const { counts } = await run($, store, '이거 설계해줘 기능 설계해줘', ['think:brainstorming'])

  expect(counts[DAY]!['think:brainstorming']).toEqual({ hit: 1, miss: 0, unmatched: 0 })
})

test('a matched prompt with nothing fired is a miss, and the text reaches next unchanged', async ($, on) => {
  const store = memoryStore(on)
  sessionAt(on)
  bottom(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  const { out, counts } = await run($, store, '이거 설계해줘 기능 설계해줘', [])

  expect(out).toEqual({ text: '이거 설계해줘 기능 설계해줘' })
  expect(counts[DAY]!['think:brainstorming']).toEqual({ hit: 0, miss: 1, unmatched: 0 })
})

test('a fired skill the prompt did not match is unmatched', async ($, on) => {
  const store = memoryStore(on)
  sessionAt(on)
  bottom(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  const { counts } = await run($, store, 'hello there', ['develop:bug-diagnoser'])

  expect(counts[DAY]!['develop:bug-diagnoser']).toEqual({ hit: 0, miss: 0, unmatched: 1 })
})

test('a typed /command records no trigger result', async ($, on) => {
  const store = memoryStore(on)
  sessionAt(on)
  bottom(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  const { counts } = await run($, store, '/think:grill', ['think:grill'])

  expect(counts).toBeUndefined()
})
