import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryStore, sessionAt } from './testkit.ts'

const NOW = Date.parse('2026-10-07T09:00:00Z')
const PANE = {
  title: 'Achievements',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { bodyRows: 20 },
  view: {},
} as any

// One string per Text element (its children joined), in document order.
const texts = (node: any): string[] =>
  Array.isArray(node)
    ? node.flatMap(texts)
    : node?.type === 'Text'
      ? [(node.children ?? []).join('')]
      : node?.children
        ? texts(node.children)
        : []

const bottom = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: an empty profile draws 0 / 80 and 80 locked rows with five ???`, async ($, on) => {
    memoryStore(on)
    sessionAt(on, NOW)
    bottom(on)
    const ui = await $.ui.mount({ plugin: 'trophy', surface, component: 'Pane', requestId: 'trophy', props: PANE })

    const lines = texts(await ui.drawn())

    expect(lines.some(l => l.includes('0 / 80 해금'))).toBe(true)
    expect(lines.filter(l => l.startsWith('🔒'))).toHaveLength(80)
    expect(lines.filter(l => l === '🔒 ???')).toHaveLength(5)
  })

  test(`${surface}: an unlocked trophy shows its date; [트리거] draws the three lists`, async ($, on) => {
    memoryStore(on, {
      'trophy.unlocked': { 'first-blood': '2026-10-06' },
      'trophy.triggers': { '2026-10-06': { 'think:brainstorming': { hit: 2, miss: 4, unmatched: 0 } } },
    })
    sessionAt(on, NOW)
    bottom(on)
    const ui = await $.ui.mount({ plugin: 'trophy', surface, component: 'Pane', requestId: 'trophy', props: PANE })

    expect(texts(await ui.drawn()).some(l => l.includes('🏆 First Blood · 2026-10-06'))).toBe(true)
    await ui.press({ key: 'tab-triggers' })
    const lines = texts(await ui.drawn())

    expect(lines.some(l => l.includes('think:brainstorming') && l.includes('2'))).toBe(true)
    expect(lines.some(l => l.includes('가장 많이 놓친'))).toBe(true)
    expect(lines.some(l => l.includes('한 번도'))).toBe(true)
  })
}

test('only the /achievements command opens the pane', async ($, on) => {
  memoryStore(on)
  sessionAt(on, NOW)
  bottom(on)
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } as any }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.skill.prompt({ skill: 'think:grill', text: 'x' })
  expect(opened).toEqual([])

  const out = await $.command.run({ command: 'achievements' } as any)

  expect(opened).toEqual(['trophy'])
  expect(out.text).toMatch(/pane/i)
})

test('a locked achievement draws a ▰▱ bar with have/need; an unlocked one does not', async ($, on) => {
  memoryStore(on, { 'trophy.unlocked': { 'first-blood': '2026-10-06' } })
  sessionAt(on, NOW)
  bottom(on)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'Pane', requestId: 'trophy', props: PANE })

  const lines = texts(await ui.drawn())

  expect(lines.some(l => /^▰*▱+ \d+\/\d+$/.test(l))).toBe(true)
  expect(lines.some(l => l === '🏆 First Blood · 2026-10-06')).toBe(true)
})
