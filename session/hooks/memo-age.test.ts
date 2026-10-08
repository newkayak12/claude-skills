import { test, expect } from 'claude-code/testing'

import { memo, memoWorld, submit, texts } from './testkit.ts'

const NOW = Date.parse('2026-10-08T09:00:00Z')
const DAY = 86_400_000
const seed = (days: number) => ({ 'memo.project:/proj': [{ text: 'old fact', ts: NOW - days * DAY }] })
const PANE = { title: 'Memo', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {} } as any

for (const [days, hinted] of [[13, false], [14, true]] as const) {
  test(`${days} days old: hint ${hinted ? 'shown' : 'absent'} in list and pane, never injected`, async ($, on) => {
    memoWorld(on, { store: seed(days) })
    const list = (await memo($, 'list')).text!
    const pane = texts(await (await $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'memo', props: PANE })).drawn())
    expect(list.includes('14d old: move to CLAUDE.md?')).toBe(hinted)
    expect(pane.some(l => l.includes('14d old: move to CLAUDE.md?'))).toBe(hinted)
    expect((await submit($)).context!.join('\n')).not.toMatch(/old:|CLAUDE\.md/)
  })
}
