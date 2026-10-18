import { test, expect } from 'claude-code/testing'

import { memo, memoWorld, submit, texts } from './testkit.ts'

const NOW = Date.parse('2026-10-08T09:00:00Z')
const DAY = 86_400_000
const seed = (days: number) => ({ 'memo.project:/proj': [{ text: 'old fact', ts: NOW - days * DAY }] })
const PANE = { title: 'Memo', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {} } as any

for (const [days, hinted] of [[13, false], [14, true]] as const) {
  test(`${days} days old: hint ${hinted ? 'shown' : 'absent'} in list and pane, never injected`, async ($, on) => {
    memoWorld(on, { store: seed(days), surfaces: [] })
    const list = (await memo($, 'list')).text!
    const pane = texts(await (await $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'memo', props: PANE })).drawn())
    expect(list.includes('14d old: move to CLAUDE.md?')).toBe(hinted)
    expect(pane.some(l => l.includes('14d old: move to CLAUDE.md?'))).toBe(hinted)
    expect((await submit($)).context!.join('\n')).not.toMatch(/old:|CLAUDE\.md/)
  })
}

test('a 14 day old note reads its age and the stale hint in its own row', async ($, on) => {
  memoWorld(on, { store: seed(14), surfaces: [] })
  const lines = texts(await (await $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'memo', props: PANE })).drawn())
  expect(lines).toContain('1 · project · 14 days old')
  expect(lines).toContain('14d old: move to CLAUDE.md?')
})

test('a 13 day old note has its age row and no hint', async ($, on) => {
  memoWorld(on, { store: seed(13), surfaces: [] })
  const lines = texts(await (await $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'memo', props: PANE })).drawn())
  expect(lines).toContain('1 · project · 13 days old')
  expect(lines.some(l => l.includes('move to CLAUDE.md'))).toBe(false)
})
