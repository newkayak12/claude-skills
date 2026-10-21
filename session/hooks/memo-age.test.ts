import { test, expect } from 'claude-code/testing'

import { memo, memoWorld, submit, texts } from './testkit.ts'

const NOW = Date.parse('2026-10-08T09:00:00Z')
const DAY = 86_400_000
const seed = (days: number) => ({ 'memo.project:/proj': [{ text: 'old fact', ts: NOW - days * DAY }] })
const PANE = { title: 'Memo', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {} } as any
const mount = ($: any) => $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'memo', props: PANE })

const findAge = (n: any, age: string): any =>
  Array.isArray(n)
    ? n.map(c => findAge(c, age)).find(Boolean)
    : !n || typeof n !== 'object'
      ? undefined
      : n.type === 'Text' && (n.children ?? []).join('').trim() === age
        ? n
        : findAge(n.children, age)

for (const [days, hinted] of [[13, false], [14, true]] as const) {
  test(`${days} days old: list ${hinted ? 'carries' : 'lacks'} its hint, the pane tells stale by colour, never injected`, async ($, on) => {
    memoWorld(on, { store: seed(days), surfaces: [] })
    const list = (await memo($, 'list')).text!
    const tree = await (await mount($)).drawn()
    const lines = texts(tree)
    const age = findAge(tree, `${days}d`).props
    expect(list.includes('14d old: move to CLAUDE.md?')).toBe(hinted)
    expect(lines.some(l => l.includes('stale?'))).toBe(false)
    if (hinted) {
      expect(age.color).toBe('warning')
      expect(age.dimColor).toBeFalsy()
    } else {
      expect(age.dimColor).toBe(true)
      expect(age.color).toBeUndefined()
    }
    expect(lines.some(l => l.includes('move to CLAUDE.md') || l.includes('days old'))).toBe(false)
    expect((await submit($)).context!.join('\n')).not.toMatch(/old:|CLAUDE\.md|stale/)
  })
}

test('a 21 day old note reads its age once as 21d, in its own row, no stale word', async ($, on) => {
  memoWorld(on, { store: seed(21) })
  const lines = texts(await (await mount($)).drawn())
  expect(lines).toContain('1')
  expect(lines).toContain('project')
  expect(lines.some(l => l.includes('stale?'))).toBe(false)
  expect(lines.filter(l => l.includes('21'))).toEqual(['  21d'])
})

test('a note under a day old reads today', async ($, on) => {
  memoWorld(on, { store: seed(0) })
  expect(texts(await (await mount($)).drawn())).toContain('today')
})

test('the row cells are number, badge, text and age, left to right', async ($, on) => {
  memoWorld(on, { store: seed(14) })
  const lines = texts(await (await mount($)).drawn())
  const at = lines.indexOf('old fact')
  expect(lines.slice(at - 2, at + 2)).toEqual(['1', 'project', 'old fact', '  14d'])
})
