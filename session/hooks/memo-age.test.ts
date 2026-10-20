import { test, expect } from 'claude-code/testing'

import { memo, memoWorld, submit, texts } from './testkit.ts'

const NOW = Date.parse('2026-10-08T09:00:00Z')
const DAY = 86_400_000
const seed = (days: number) => ({ 'memo.project:/proj': [{ text: 'old fact', ts: NOW - days * DAY }] })
const PANE = { title: 'Memo', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {} } as any
const mount = ($: any) => $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'memo', props: PANE })

for (const [days, hinted] of [[13, false], [14, true]] as const) {
  test(`${days} days old: stale hint ${hinted ? 'shown' : 'absent'} in the pane, the list keeps its wording, never injected`, async ($, on) => {
    memoWorld(on, { store: seed(days), surfaces: [] })
    const list = (await memo($, 'list')).text!
    const lines = texts(await (await mount($)).drawn())
    expect(list.includes('14d old: move to CLAUDE.md?')).toBe(hinted)
    expect(lines.includes('stale?')).toBe(hinted)
    expect(lines.some(l => l.includes('move to CLAUDE.md') || l.includes('days old'))).toBe(false)
    expect((await submit($)).context!.join('\n')).not.toMatch(/old:|CLAUDE\.md|stale/)
  })
}

test('a 21 day old note reads its age once as 21d, with the stale hint, in its own row', async ($, on) => {
  memoWorld(on, { store: seed(21) })
  const lines = texts(await (await mount($)).drawn())
  expect(lines).toContain('1')
  expect(lines).toContain('project')
  expect(lines).toContain('21d')
  expect(lines).toContain('stale?')
  expect(lines.filter(l => l.includes('21'))).toEqual(['21d'])
})

test('a note under a day old reads today', async ($, on) => {
  memoWorld(on, { store: seed(0) })
  expect(texts(await (await mount($)).drawn())).toContain('today')
})

test('the row cells are number, badge, text, age and hint, left to right', async ($, on) => {
  memoWorld(on, { store: seed(14) })
  const lines = texts(await (await mount($)).drawn())
  const at = lines.indexOf('old fact')
  expect(lines.slice(at - 2, at + 3)).toEqual(['1', 'project', 'old fact', '14d', 'stale?'])
})
