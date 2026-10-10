import { test, expect } from 'claude-code/testing'

import { memo, memoWorld } from './testkit.ts'

const KEY = 'memo.project:/proj'

test('add then list shows the note with N/8 (headless text)', async ($, on) => {
  memoWorld(on, { surfaces: [] })
  expect((await memo($, 'add use staging DB')).text).toMatch(/added/)
  const list = (await memo($, 'list')).text!
  expect(list).toContain('use staging DB')
  expect(list).toContain('1/8')
})

test('interactive, /memo list opens the pane (Ink) and answers one line', async ($, on) => {
  const seen = memoWorld(on)
  await memo($, 'add use staging DB')
  expect((await memo($, 'list')).text).toBe('Memo pane opened.')
  expect(seen.opened).toEqual(['memo'])
})

test('/memo is registered at session start', async ($, on) => {
  const seen = memoWorld(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  expect(seen.commands).toContain('memo')
})

const refused = (name: string, seed: unknown[], text: string, limit: RegExp) =>
  test(name, async ($, on) => {
    const seen = memoWorld(on, { store: { [KEY]: seed } })
    const before = JSON.stringify([...seen.store])
    expect((await memo($, `add ${text}`)).text).toMatch(limit)
    expect(JSON.stringify([...seen.store])).toBe(before)
    expect(seen.store.writes).toBe(0)
  })

const note = (text: string) => ({ text, ts: 1 })
refused('a 9th note is refused', Array.from({ length: 8 }, (_, i) => note(`n${i}`)), 'ninth', /8/)
refused('a 281-char note is refused', [], 'x'.repeat(281), /280/)
refused('a note past 1200 total is refused', Array.from({ length: 5 }, () => note('y'.repeat(240))), 'z'.repeat(10), /1200/)

test('rm 1 and clear remove', async ($, on) => {
  const seen = memoWorld(on, { store: { [KEY]: [note('a'), note('b')] } })
  await memo($, 'rm 1')
  expect(seen.store.get(KEY)).toEqual([note('b')])
  await memo($, 'clear')
  expect(seen.store.get(KEY)).toEqual([])
})

test('unknown subcommand returns usage; headless still answers', async ($, on) => {
  memoWorld(on, { surfaces: [] })
  expect((await memo($, 'frobnicate')).text).toMatch(/usage: \/memo/)
  await memo($, 'add headless note')
  expect((await memo($, 'list')).text).toContain('headless note')
})
