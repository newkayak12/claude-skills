// Render check for the Achievements pane (mod.md "A UI change is done when" 2): every scenario on every surface at
// 190, 110 and 30 columns. Each test frames the drawn tree, asserts nothing is wider than its column and every tab
// label is whole, and prints the frame between `=== render-<scenario>-<surface>-<width> ===` and `=== end ===` so
// `.harness-run/card147-150/split-renders.mjs` can save the files. Writes nothing itself. Fictional data only.
import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cells, draw, frame } from './demo-frames.ts'
import { language, memoryStore, onlyShared, sessionAt, SURFACES } from './testkit.ts'

const NOW = Date.parse('2026-11-12T09:00:00Z')
const WIDTHS = [190, 110, 30] as const

const SCENARIOS = [
  { name: 'trophies-en', lang: 'English', tab: undefined },
  { name: 'trophies-ko', lang: 'Korean', tab: undefined },
  { name: 'triggers-en', lang: 'English', tab: 'tab-triggers' },
  { name: 'failures-en', lang: 'English', tab: 'tab-failures' },
] as const

const bug = (n: number) => ({
  ts: NOW - 1000 * n, day: `2026-11-${String(12 - Math.min(n, 3)).padStart(2, '0')}`, kind: 'bug', reason: 'mcp_error', plugin: 'teams', tool: 'tm_open',
  session: 's', local: {},
})
const FAILURES = [
  ...[1, 1, 2, 2, 3, 3, 3].map(bug),
  { ts: NOW - 5000, day: '2026-11-11', kind: 'outcome', reason: 'goal_failed', session: 's', local: { path: '/work/demo-app' } },
  { ts: NOW - 6000, day: '2026-11-11', kind: 'outcome', reason: 'subgoal_failed', session: 's', local: { path: '/work/demo-app' } },
  { ts: NOW - 7000, day: '2026-11-10', kind: 'bug', reason: 'is_error', plugin: 'develop', skill: 'clean-code', session: 's', local: { text: 'demo error text' } },
  { ts: NOW - 9000, day: '2026-11-02', kind: 'outcome', reason: 'goal_failed', session: 's', local: { slug: 'demo-run' } },
]
const SEED = {
  'trophy.unlocked': { 'first-blood': '2026-11-09', 'first-develop': '2026-11-09', 'first-think': '2026-11-10', 'first-write': '2026-11-10', 'first-agents': '2026-11-10' },
  'trophy.uses': [
    ['think:grill', 'think'], ['think:brainstorming', 'think'], ['develop:clean-code', 'develop'], ['develop:sql-pro', 'develop'],
    ['write:adr', 'write'], ['agents:use-codex', 'agents'],
  ].map(([skill, plugin], i) => ({ skill, plugin, day: '2026-11-10', session: 's', ts: i + 1 })),
  'trophy.triggers': { '2026-11-10': { 'think:brainstorming': { hit: 2, miss: 4, unmatched: 0 }, 'develop:clean-code': { hit: 3, miss: 1, unmatched: 1 } } },
  'trophy.failures': FAILURES,
}

const bottom = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.call', { tool: 'Skill' }, () => ({ result: 'ran' }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } as any }))
}

const walk = (node: any): any[] =>
  Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.children ?? [])] : []

for (const scenario of SCENARIOS) {
  for (const surface of SURFACES) {
    for (const width of WIDTHS) {
      test(`renders: ${scenario.name} ${surface} ${width}`, async ($, on) => {
        memoryStore(on, SEED)
        sessionAt(on, NOW)
        language(on, scenario.lang)
        bottom(on)
        await $.session.start({ cwd: '/work/demo-app', surface, isInteractive: true })
        const ui = await $.ui.mount({
          plugin: 'trophy', surface, component: 'Pane', requestId: 'trophy',
          props: { title: 'Achievements', isFocused: true, bodyColumns: width - 4, placement: 'dock', scroll: { bodyRows: 40 }, view: {} },
        } as any)
        if (scenario.tab) await ui.press({ key: scenario.tab })

        const tree: any = await ui.drawn()
        onlyShared(tree)
        const lines = frame(tree, 'Achievements', width)

        for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(width)
        // the drawn tree carries no keys: the tab Buttons are found by their labels
        const TABS = scenario.lang === 'Korean' ? ['업적', '트리거', '실패'] : ['Achievements', 'Triggers', 'Failures']
        const labels = walk(tree).filter(n => n.type === 'Button' && TABS.includes(String(n.props?.label ?? ''))).map(n => String(n.props?.label ?? ''))
        // below the frame's title line: the pane title 'Achievements' must not stand in for the first tab
        for (const label of labels) expect(lines.slice(1).some(l => l.includes(label))).toBe(true)
        expect(labels).toHaveLength(3)

        console.log([`=== render-${scenario.name}-${surface}-${width} ===`, ...lines, '=== end ==='].join('\n'))
      })
    }
  }
}

test('renders: a bordered padded Box frames with its border, inner width = width - 4', async () => {
  const box = { type: 'Box', props: { flexDirection: 'column', borderStyle: 'round', paddingX: 1 }, children: [{ type: 'Text', props: {}, children: ['x'.repeat(40)] }] }
  const lines = draw(box, 20)
  expect(lines[0]).toBe(`╭${'─'.repeat(18)}╮`)
  expect(lines[lines.length - 1]).toBe(`╰${'─'.repeat(18)}╯`)
  expect(lines.length).toBe(5)
  for (const l of lines) expect(cells(l)).toBe(20)
  expect(lines[1]).toBe(`│ ${'x'.repeat(16)} │`)
})
