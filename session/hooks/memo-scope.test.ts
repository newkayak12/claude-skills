import { test, expect } from 'claude-code/testing'

import { memo, memoWorld, submit } from './testkit.ts'

const n = (text: string) => ({ text, ts: 1 })

test('a project note is absent under another root; a global one is in both', async ($, on) => {
  memoWorld(on, { root: '/b', store: { 'memo.project:/a': [n('only A')], 'memo.global': [n('everywhere')] } })
  const ctx = (await submit($)).context![0]!
  expect(ctx).toContain('[global] everywhere')
  expect(ctx).not.toContain('only A')
})

test('order is global then project, and --global writes the global key', async ($, on) => {
  const seen = memoWorld(on, { store: { 'memo.project:/proj': [n('p1')] } })
  await memo($, 'add --global g1')
  expect(seen.store.get('memo.global')).toEqual([expect.objectContaining({ text: 'g1' })])
  const lines = (await submit($)).context![0]!.split('\n')
  expect(lines.slice(1)).toEqual(['[global] g1', '[project] p1'])
})

test('the combined cap refuses a project add when global holds 8', async ($, on) => {
  const seen = memoWorld(on, { store: { 'memo.global': Array.from({ length: 8 }, (_, i) => n(`g${i}`)) } })
  expect((await memo($, 'add one more')).text).toMatch(/8/)
  expect(seen.store.has('memo.project:/proj')).toBe(false)
})

test('an over-cap store renders whole notes only and list says truncated', async ($, on) => {
  memoWorld(on, { store: { 'memo.global': Array.from({ length: 10 }, (_, i) => n(`g${i}`)) } })
  const lines = (await submit($)).context![0]!.split('\n')
  expect(lines).toHaveLength(1 + 8)
  const list = (await memo($, 'list')).text!
  expect(list).toContain('truncated')
  expect(list).not.toContain('g8')
})
