import { test, expect } from 'claude-code/testing'

import { memoWorld, submit } from './testkit.ts'

const KEY = 'memo.project:/proj'
const NOTE = { text: 'use staging DB', ts: Date.parse('2026-10-07T09:00:00Z') }
const BLOCK = 'User pinned notes, authoritative, set by the user\n[project] use staging DB'

test('empty store: the prompt passes unchanged', async ($, on) => {
  memoWorld(on)
  const r = await submit($)
  expect(r.text).toBe('hi')
  expect(r.context).toBeUndefined()
})

test('a note is added to context once per conversation', async ($, on) => {
  memoWorld(on, { store: { [KEY]: [NOTE] } })
  expect((await submit($)).context).toEqual([BLOCK])
  expect((await submit($)).context).toBeUndefined()
})

for (const source of ['compact', 'clear'] as const) {
  test(`SessionStart ${source} re-arms the block`, async ($, on) => {
    memoWorld(on, { store: { [KEY]: [NOTE] } })
    await submit($)
    if (source === 'compact') await $.classic.SessionStart({ source: 'compact' })
    else await $.classic.SessionStart({ source: 'clear' })
    expect((await submit($)).context).toEqual([BLOCK])
  })
}

test('SessionStart resume does not re-arm', async ($, on) => {
  memoWorld(on, { store: { [KEY]: [NOTE] } })
  await submit($)
  await $.classic.SessionStart({ source: 'resume' })
  expect((await submit($)).context).toBeUndefined()
})

test('a /memo write re-arms and says it applies from the next prompt', async ($, on) => {
  memoWorld(on, { store: { [KEY]: [NOTE] } })
  await submit($)
  const r = await $.command.run({ command: 'memo', args: 'add second' } as never)
  expect(r.text).toMatch(/next prompt/)
  expect((await submit($)).context![0]).toContain('[project] second')
})

test('a corrupt or unreadable store leaves the input unchanged', async ($, on) => {
  const seen = memoWorld(on, { store: { [KEY]: 'garbage' } })
  expect((await submit($)).context).toBeUndefined()
  seen.store.getBroken = true
  const r = await submit($)
  expect(r.text).toBe('hi')
  expect(r.context).toBeUndefined()
})
