import { test, expect } from 'claude-code/testing'

import { frame } from './demo-frames.ts'
import { FOOTER_KEYS, FOOTER_LEAD, FOOTER_TAIL, HEADER } from './memo-logic.ts'
import { memo, memoWorld, submit, texts } from './testkit.ts'

const PANE = { title: 'Memo', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {} } as any
const mount = ($: any) => $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'memo', props: PANE })
const findText = (n: any, text: string): any =>
  Array.isArray(n)
    ? n.map(c => findText(c, text)).find(Boolean)
    : !n || typeof n !== 'object'
      ? undefined
      : n.type === 'Text' && (n.children ?? []).join('') === text
        ? n
        : findText(n.children, text)
const T0 = Date.parse('2026-10-08T09:00:00Z')
const SEED = { 'memo.global': [{ text: 'reply in Korean', ts: T0 }], 'memo.project:/proj': [{ text: 'use staging DB', ts: T0 }] }

test('one row per note in /memo list order, numbered as /memo rm; the model block header is not drawn', async ($, on) => {
  memoWorld(on, { store: SEED, surfaces: [] })
  expect((await memo($, 'list')).text).toMatch(/^1\. \[global\] reply in Korean\n2\. \[project\] use staging DB/)
  const lines = texts(await (await mount($)).drawn())
  expect(lines.slice(lines.indexOf('reply in Korean') - 2, lines.indexOf('use staging DB') + 2)).toEqual([
    '1', 'global ', 'reply in Korean', 'today', '2', 'project', 'use staging DB', 'today',
  ])
  expect(lines.some(l => l.includes(HEADER))).toBe(false)
  expect(JSON.stringify(lines)).not.toMatch(/usage:|close \[q\]|days old/)
})

test('an empty store shows one plain no notes line and the footer, no usage line', async ($, on) => {
  memoWorld(on)
  const tree = await (await mount($)).drawn()
  const lines = texts(tree)
  expect(lines).toContain('no notes')
  expect(lines.some(l => l.startsWith('usage:'))).toBe(false)
  expect(lines).toContain(FOOTER_LEAD)
  const empty = findText(tree, 'no notes')
  expect(empty).toBeDefined()
  expect(empty.props?.dimColor).toBeFalsy()
})

test('read-only: no inputs; the one Button is the dismiss q inside the footer', async ($, on) => {
  memoWorld(on, { store: SEED })
  const json = JSON.stringify(await (await mount($)).drawn())
  expect(json).not.toMatch(/"type":"(Input|TextInput)"/)
  expect(json.match(/"type":"Button"/g)).toHaveLength(1)
  expect(json).toMatch(/"hotkey":"q"/)
  expect(json).toMatch(/"label":"q"/)
  expect(json).not.toMatch(/"label":"[^"]*\[/)
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

test('q closes the pane through the dismiss Button', async ($, on) => {
  const seen = memoWorld(on, { store: SEED })
  const ui = await mount($)
  await ui.press({ key: 'q' })
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

const words = (s: string[]) => s.join(' ').replace(/\/memo (add|rm|clear)/g, '').replace(/\/memo/g, '').match(/[A-Za-z]{2,}/g) ?? []

test('the header shows count, size and a dash before the first send; no word is said twice with the footer', async ($, on) => {
  memoWorld(on, { store: SEED })
  const lines = texts(await (await mount($)).drawn())
  const header = '2 notes · 29/1200 chars · sent —'
  expect(lines).toContain(header)
  const said = words([header, FOOTER_LEAD, 'q', FOOTER_TAIL].map(w => w.replace(/<[a-z]+>/g, '')))
  expect(said.filter(w => w === 'chars')).toHaveLength(1)
  expect(new Set(said).size).toBe(said.length)
})

test('after the block went out the header shows the local send time', async ($, on) => {
  memoWorld(on, { store: SEED })
  await submit($)
  const d = new Date(T0)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const lines = texts(await (await mount($)).drawn())
  expect(lines).toContain(`2 notes · 29/1200 chars · sent ${hm}`)
})

test('the footer is one dim line of keys and the ways to close', async ($, on) => {
  memoWorld(on, { store: SEED })
  const tree: any = await (await mount($)).drawn()
  expect(FOOTER_LEAD).toBe(`${FOOTER_KEYS} · Esc,`)
  expect(findText(tree, FOOTER_LEAD).props?.dimColor).toBe(true)
  expect(findText(tree, FOOTER_TAIL).props?.dimColor).toBe(true)
  expect(JSON.stringify(tree).match(/"type":"Button"/g)).toHaveLength(1)
})

test('a long note ends in an ellipsis at 110 columns with its age and stale hint whole, on one row', async ($, on) => {
  const LONG = 'Keep every migration reversible and say so in the pull request title and body. '.repeat(3).slice(0, 280)
  memoWorld(on, { store: { 'memo.global': [{ text: LONG, ts: T0 - 21 * 86_400_000 }] } })
  const props = { ...PANE, bodyColumns: 110 }
  const tree = await (await $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'memo', props })).drawn()
  const rows = frame(tree as any, 'Memo', 110).filter(l => l.includes('Keep every'))
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatch(/… 21d stale\? │$/)
  expect(Array.from(rows[0]!).length).toBeLessThanOrEqual(110)
  expect(JSON.stringify(tree)).toMatch(/"wrap":"truncate-end"/)
})

test('the cut shows one warning line with the count of stored notes not sent', async ($, on) => {
  const big = (i: number) => ({ text: String(i).repeat(280), ts: T0 })
  memoWorld(on, { store: { 'memo.project:/proj': [big(1), big(2), big(3), big(4), big(5), big(6)] } })
  const lines = texts(await (await mount($)).drawn())
  expect(lines).toContain('+2 not sent')
  expect(lines.some(l => l.includes('truncated:'))).toBe(false)
  expect(lines.some(l => l.startsWith('4 notes · 1120/1200 chars'))).toBe(true)
})
