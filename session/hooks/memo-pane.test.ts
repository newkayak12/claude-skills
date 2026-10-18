import { test, expect } from 'claude-code/testing'

import { memo, memoWorld, submit, texts } from './testkit.ts'

const PANE = { title: 'Memo', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {} } as any
const mount = ($: any) => $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'memo', props: PANE })
const T0 = Date.parse('2026-10-08T09:00:00Z')
const SEED = { 'memo.global': [{ text: 'reply in Korean', ts: T0 }], 'memo.project:/proj': [{ text: 'use staging DB', ts: T0 }] }

test('pane text carries the injected block, line for line', async ($, on) => {
  memoWorld(on, { store: SEED })
  const block = (await submit($)).context![0]!.split('\n')
  const lines = texts(await (await mount($)).drawn())
  const at = lines.indexOf(block[0]!)
  expect(at).toBeGreaterThan(-1)
  expect(lines.slice(at, at + block.length)).toEqual(block)
})

test('an empty store shows the usage line', async ($, on) => {
  memoWorld(on)
  expect(texts(await (await mount($)).drawn()).some(l => l.startsWith('usage: /memo'))).toBe(true)
})

test('read-only: no inputs; the one Button is the dismiss [q]', async ($, on) => {
  memoWorld(on, { store: SEED })
  const json = JSON.stringify(await (await mount($)).drawn())
  expect(json).not.toMatch(/"type":"(Input|TextInput)"/)
  expect(json.match(/"type":"Button"/g)).toHaveLength(1)
  expect(json).toMatch(/"hotkey":"q"/)
})

const OPEN_PANE = [{ id: 'memo', title: 'Memo', isShown: true, isFocused: true, isPlaced: true }]
const openWorld = (on: any) => memoWorld(on, { store: SEED, panes: OPEN_PANE } as never)

test('bare /memo on an open pane closes it', async ($, on) => {
  const seen = openWorld(on)
  expect((await memo($, '')).text).toBe('Memo pane closed.')
  expect(seen.closed).toEqual(['memo'])
  expect(seen.opened).toEqual([])
})

test('/memo list on an open pane opens it again and never closes', async ($, on) => {
  const seen = openWorld(on)
  expect((await memo($, 'list')).text).toBe('Memo pane opened.')
  expect(seen.opened).toEqual(['memo'])
  expect(seen.closed).toEqual([])
})

test('the memo pane opens with closeOnEscape', async ($, on) => {
  const seen = memoWorld(on, { store: SEED })
  await memo($, '')
  expect(seen.openArgs[0]).toMatchObject({ id: 'memo', closeOnEscape: true })
})

test('[q] closes the pane through the dismiss Button', async ($, on) => {
  const seen = memoWorld(on, { store: SEED })
  const ui = await mount($)
  await ui.press({ key: 'close' })
  expect(seen.closed).toEqual(['memo'])
})

test('/memo opens the pane interactively; headless opens none and list answers', async ($, on) => {
  const seen = memoWorld(on, { store: SEED })
  await $.command.run({ command: 'memo', args: '' } as never)
  expect(seen.opened).toEqual(['memo'])
})

test('headless: no pane', async ($, on) => {
  const seen = memoWorld(on, { store: SEED, surfaces: [] })
  const r = await $.command.run({ command: 'memo', args: '' } as never)
  expect(seen.opened).toEqual([])
  expect(r.text).toContain('use staging DB')
})

test('each note shows its scope and age; the summary shows a dash before the first send and the size', async ($, on) => {
  memoWorld(on, { store: SEED })
  const lines = texts(await (await mount($)).drawn())
  expect(lines).toContain('1 · global · today')
  expect(lines).toContain('2 · project · today')
  expect(lines).toContain('sent with this conversation: — · 29/1200 chars')
})

test('after the block went out the summary shows the local send time', async ($, on) => {
  memoWorld(on, { store: SEED })
  await submit($)
  const d = new Date(T0)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const lines = texts(await (await mount($)).drawn())
  expect(lines).toContain(`sent with this conversation: ${hm} · 29/1200 chars`)
})

test('the pane holds one close hint and long note lines truncate with an ellipsis', async ($, on) => {
  memoWorld(on, { store: SEED })
  const json = JSON.stringify(await (await mount($)).drawn())
  expect(json).toMatch(/Esc, q or \/memo closes/)
  expect(json).toMatch(/"wrap":"truncate-end"/)
})
