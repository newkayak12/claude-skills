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
  test(`a shorter conversation (${source}) re-arms the block`, async ($, on) => {
    const seen = memoWorld(on, { store: { [KEY]: [NOTE] } })
    seen.rows = 40
    await submit($)
    seen.rows = source === 'compact' ? 3 : 0
    expect((await submit($)).context).toEqual([BLOCK])
    seen.rows = 4
    expect((await submit($)).context).toBeUndefined()
  })
}

test('a conversation that did not shrink (resume) does not re-arm', async ($, on) => {
  const seen = memoWorld(on, { store: { [KEY]: [NOTE] } })
  seen.rows = 10
  await submit($)
  seen.rows = 12
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

const SENT_NOW = Date.parse('2026-10-08T09:00:00Z')
const cell = (seen: ReturnType<typeof memoWorld>) => seen.cells.get('session.memo') as { armed: boolean; sentAt?: number; rows?: number } | undefined

test('sentAt is unset before the first send and set from the clock at injection', async ($, on) => {
  const seen = memoWorld(on, { store: { [KEY]: [NOTE] } })
  expect(cell(seen)?.sentAt ?? 0).toBe(0)
  await submit($)
  expect(cell(seen)).toEqual({ armed: false, sentAt: SENT_NOW, rows: 0 })
})

test('a prompt with no block to send leaves sentAt unset', async ($, on) => {
  const seen = memoWorld(on)
  await submit($)
  expect(cell(seen)?.sentAt ?? 0).toBe(0)
})

test('toggling armed and saving a note keep sentAt', async ($, on) => {
  const seen = memoWorld(on, { store: { [KEY]: [NOTE] } })
  await submit($)
  await $.command.run({ command: 'memo', args: 'add second' } as never)
  expect(cell(seen)).toEqual({ armed: true, sentAt: SENT_NOW, rows: 0 })
  await submit($)
  await $.command.run({ command: 'memo', args: 'rm 1' } as never)
  expect(cell(seen)?.sentAt).toBe(SENT_NOW)
})
