import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { achievements } from '../data/achievements.ts'
import { askedOrigin } from './logic.ts'
import { language, memoryStore, onlyShared, sessionAt, SURFACES } from './testkit.ts'

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

test('by default the pane counts and labels in English', async ($, on) => {
  memoryStore(on)
  sessionAt(on, NOW)
  bottom(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'Pane', requestId: 'trophy', props: PANE })

  expect(texts(await ui.drawn()).some(l => l.includes('0 / 80 unlocked'))).toBe(true)
  await ui.press({ key: 'tab-triggers' })
  expect(texts(await ui.drawn()).some(l => l.includes('Most-missed skills'))).toBe(true)
})

for (const surface of SURFACES) {
  test(`${surface}: an empty profile draws 0 / 80 and 80 locked rows with five ???`, async ($, on) => {
    memoryStore(on)
    sessionAt(on, NOW)
    language(on, 'Korean')
    bottom(on)
    await $.session.start({ cwd: '/w', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'trophy', surface, component: 'Pane', requestId: 'trophy', props: PANE })

    onlyShared(await ui.drawn())
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
    language(on, 'Korean')
    bottom(on)
    await $.session.start({ cwd: '/w', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'trophy', surface, component: 'Pane', requestId: 'trophy', props: PANE })

    expect(texts(await ui.drawn()).some(l => l.includes('🏆 First Blood · 2026-10-06'))).toBe(true)
    await ui.press({ key: 'tab-triggers' })
    onlyShared(await ui.drawn())
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

test('the 실패 tab lists recorded failures, newest first', async ($, on) => {
  memoryStore(on, {
    'trophy.failures': [
      { ts: 1, day: '2026-10-06', kind: 'bug', reason: 'is_error', plugin: 'develop', skill: 'clean-code', session: 's', local: { text: 'boom' } },
      { ts: 2, day: '2026-10-07', kind: 'bug', reason: 'mcp_error', plugin: 'knowledge', tool: 'knowledge_get', session: 's', local: {} },
    ],
  })
  sessionAt(on, NOW)
  bottom(on)
  on('ui.open', () => ({ value: { isPlaced: true } as any }))
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'Pane', requestId: 'trophy', props: PANE })

  await ui.press({ key: 'tab-failures' })
  const lines = texts(await ui.drawn())

  const first = lines.findIndex(l => l.includes('knowledge_get'))
  const second = lines.findIndex(l => l.includes('develop:clean-code'))
  expect(first).toBeGreaterThan(-1)
  expect(second).toBeGreaterThan(first)
  expect(lines).toContain('boom')
})

test('147b: the Failures tab shows ×7 once and the last day for seven repeats', async ($, on) => {
  const e = (n: number) => ({
    ts: n, day: `2026-11-${String(8 + n).padStart(2, '0')}`, kind: 'bug', reason: 'mcp_error', plugin: 'teams', tool: 'tm_open',
    session: 's', local: {},
  })
  memoryStore(on, { 'trophy.failures': [1, 1, 2, 2, 3, 3, 3].map(e) })
  sessionAt(on, NOW)
  bottom(on)
  on('ui.open', () => ({ value: { isPlaced: true } as any }))
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'Pane', requestId: 'trophy', props: PANE })

  await ui.press({ key: 'tab-failures' })
  const lines = texts(await ui.drawn())

  expect(lines.filter(l => l.includes('×7')).length).toBe(1)
  expect(lines.filter(l => l.includes('teams · tm_open')).length).toBe(1)
  expect(lines.some(l => l.includes('2026-11-11'))).toBe(true)
})

// ---- 150b: a narrow column -------------------------------------------------------------------------------
const NARROW_PANE = { ...PANE, bodyColumns: 26 }
const walk = (node: any): any[] =>
  Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object' ? [node, ...walk(node.children ?? [])] : []

const narrow = async ($: any, on: On, lang: 'English' | 'Korean', seed: Record<string, unknown> = {}) => {
  memoryStore(on, seed)
  sessionAt(on, NOW)
  if (lang === 'Korean') language(on, 'Korean')
  bottom(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  return $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'Pane', requestId: 'trophy', props: NARROW_PANE })
}

test('150b: at 26 columns an empty profile draws 5 locked rows and one fold line', async ($, on) => {
  const ui = await narrow($, on, 'English')
  const lines = texts(await ui.drawn())

  expect(lines.filter(l => l.startsWith('🔒 ')).length).toBe(6)
  expect(lines.filter(l => l.startsWith('🏆'))).toHaveLength(0)
  expect(lines).toContain('🔒 +75 locked (5 hidden)')
})

test('150b: at 26 columns the fold line is Korean under Korean', async ($, on) => {
  const ui = await narrow($, on, 'Korean')

  expect(texts(await ui.drawn())).toContain('🔒 +75 잠김 (숨김 5)')
})

test('150b: at 26 columns an unlocked trophy is the first row, before the locked ones', async ($, on) => {
  const ui = await narrow($, on, 'English', { 'trophy.unlocked': { 'first-blood': '2026-10-06' } })
  const lines = texts(await ui.drawn())

  const won = lines.findIndex(l => l === '🏆 First Blood')
  expect(won).toBeGreaterThan(-1)
  expect(lines).toContain('2026-10-06')
  expect(lines.findIndex(l => l.startsWith('🔒 '))).toBeGreaterThan(won)
  expect(lines).toContain('🔒 +74 locked (5 hidden)')
})

test('150b: at 26 columns every tab and the close Button are present and titles truncate with …', async ($, on) => {
  const ui = await narrow($, on, 'English', { 'trophy.unlocked': { 'first-blood': '2026-10-06' } })
  const all = walk(await ui.drawn())
  const labels = all.filter(n => n.type === 'Button').map(n => n.props?.label ?? n.label)

  expect(labels).toEqual(expect.arrayContaining(['Close [q]', 'Achievements', 'Triggers', 'Failures']))
  expect(all.some(n => n.type === 'Box' && (n.props?.flexWrap ?? n.flexWrap) === 'wrap')).toBe(true)
  const rows = all.filter(n => n.type === 'Text' && /^(🏆|🔒) /.test((n.children ?? []).join('')) && !(n.children ?? []).join('').includes('+'))
  expect(rows.length).toBeGreaterThan(0)
  for (const r of rows) expect(r.props?.wrap ?? r.wrap).toBe('truncate-end')
})

test('150b: the three tabs share one Box with a columnGap, apart from the count and Close row', async ($, on) => {
  const ui = await narrow($, on, 'English')
  const all = walk(await ui.drawn())
  const label = (c: any) => String(c.props?.label ?? c.label ?? '')
  const parents = all.filter(n => n.type === 'Box' && (n.children ?? []).filter((c: any) => c.type === 'Button' && ['Achievements', 'Triggers', 'Failures'].includes(label(c))).length === 3)

  expect(parents).toHaveLength(1)
  expect(Number(parents[0].props?.columnGap)).toBeGreaterThanOrEqual(1)
  expect((parents[0].children ?? []).some((c: any) => label(c) === 'Close [q]')).toBe(false)
  const top = all.find(n => n.type === 'Box' && (n.children ?? []).some((c: any) => label(c) === 'Close [q]'))
  expect(Number(top?.props?.columnGap)).toBeGreaterThanOrEqual(1)
})

test('150b: at 26 columns the count is short, 0/80; wide it is the bar and 0 / 80; other tabs carry no count', async ($, on) => {
  const ui = await narrow($, on, 'English')
  expect(texts(await ui.drawn())).toContain('0/80')
  await ui.press({ key: 'tab-triggers' })
  expect(texts(await ui.drawn()).some(l => l.includes('0/80') || l.includes('/ 80'))).toBe(false)
})

test('150b: at 26 columns the fold line has no (0 hidden) once every hidden trophy is unlocked', async ($, on) => {
  const hidden = achievements.filter(a => a.hidden).map(a => a.id)
  const ui = await narrow($, on, 'English', { 'trophy.unlocked': Object.fromEntries(hidden.map(id => [id, '2026-10-06'])) })
  const lines = texts(await ui.drawn())

  expect(lines.some(l => l.includes('(0 hidden)'))).toBe(false)
  expect(lines.some(l => /^🔒 \+\d+ locked$/.test(l))).toBe(true)
})

// ---- 150a: the pane opens only when asked ---------------------------------------------------------------
type Shown = { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }
const shown = (id: string): Shown => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })

// The engine beneath the plugin: records opens and closes; `panes` is what $.ui.panes() lists (an open adds, a close removes).
const world150 = async ($: any, on: On, stale: string[] = [], seed: Record<string, unknown> = {}) => {
  memoryStore(on, seed)
  sessionAt(on, NOW)
  bottom(on)
  const w = { opened: [] as string[], closed: [] as string[], panes: stale.map(shown), panesThrows: false }
  on('ui.open', (_$, e) => {
    w.opened.push(e.id)
    if (!w.panes.some(p => p.id === e.id)) w.panes.push(shown(e.id))
    return { value: { isPlaced: true } as any }
  })
  on('ui.close', (_$, e) => {
    w.closed.push(e.id)
    w.panes = w.panes.filter(p => p.id !== e.id)
    return { value: undefined }
  })
  on('ui.panes', () => {
    if (w.panesThrows) throw new Error('panes down')
    return { value: w.panes as any }
  })
  on('session.attach', (_$, e) => ({ clientId: e.clientId }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('classic.UserPromptExpansion', () => ({}) as never)
  on('classic.PostToolUseFailure', () => ({}) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: 'done' }))
  on('tool.call', () => ({ result: { success: true } }) as never)
  return w
}
const START150 = { cwd: '/w', surface: 'terminal', isInteractive: true } as const
const PRES = { isFullscreen: false, columns: 30 } as any
const run150 = ($: any, origin?: { kind: string }) =>
  $.command.run({ command: 'achievements', args: '', origin, presentation: PRES } as any)

test('150a: no automatic path opens the pane (start, skill, prompt, turn, failure, unlock, attach, measure)', async ($, on) => {
  const w = await world150($, on)
  await $.session.start(START150)
  await $.skill.prompt({ skill: 'trophy:list', text: '/trophy:list' } as any)
  await $.tool.call({ tool: 'Skill', skill: 'trophy:list' } as any)
  await $.classic.UserPromptExpansion({ expansion_type: 'slash_command', command_name: 'trophy:list', command_args: '', command_source: 'plugin', prompt: '/trophy:list' } as any)
  await $.prompt.submit({ text: '/trophy:list', origin: { kind: 'composer' } } as any)
  await $.classic.PostToolUseFailure({ tool_name: 'Skill', tool_input: { skill: 'develop:clean-code' }, tool_use_id: 't1', error: 'boom' } as never)
  await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' })
  await $.turn.complete({} as any)
  await $.session.attach({ surface: 'mobile', clientId: 'mobile:default' } as any)
  await $.session.measure({ context: {}, rateLimits: [], changed: [] } as any)
  expect(w.opened).toEqual([])
})

const AUTOMATED = ['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'auto-continuation', 'channel', 'coordinator', 'observer']
for (const kind of AUTOMATED) {
  test(`150a: /achievements from the automated origin ${kind} opens nothing`, async ($, on) => {
    const w = await world150($, on)
    await $.session.start(START150)
    const out = await run150($, { kind })
    expect(w.opened).toEqual([])
    expect(out.text).toMatch(/not opened/i)
  })
}

for (const origin of [{ kind: 'composer' }, { kind: 'bridge' }, { kind: 'sdk' }, { kind: 'plugin' }, { kind: 'unclassified' }, undefined]) {
  test(`150a: /achievements from the person-backed origin ${origin?.kind ?? 'none'} opens the pane`, async ($, on) => {
    const w = await world150($, on)
    await $.session.start(START150)
    await run150($, origin)
    expect(w.opened).toEqual(['trophy'])
  })
}

test('150a: askedOrigin names every PromptOrigin kind in index.d.ts', () => {
  for (const k of [...AUTOMATED, 'projects-relay', 'observer-activity', 'slack-ping']) expect(askedOrigin({ kind: k })).toBe(false)
  for (const k of ['composer', 'bridge', 'sdk', 'plugin', 'unclassified']) expect(askedOrigin({ kind: k })).toBe(true)
  expect(askedOrigin(undefined)).toBe(true)
})

test('150a: H-resume H-attach: a pane left up that this session never asked for is closed at start and at attach', async ($, on) => {
  const w = await world150($, on, ['trophy'])
  await $.session.start(START150)
  expect(w.closed).toEqual(['trophy'])
  w.panes = [shown('trophy-batch')]
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as any)
  expect(w.closed).toEqual(['trophy', 'trophy-batch'])
})

test('150a: a pane the person asked for stays open across attach, a turn, measure and a second session.start (reload)', async ($, on) => {
  const w = await world150($, on)
  await $.session.start(START150)
  await run150($, { kind: 'composer' })
  await $.session.attach({ surface: 'mobile', clientId: 'mobile:default' } as any)
  await $.turn.complete({} as any)
  await $.session.measure({ context: {}, rateLimits: [], changed: [] } as any)
  await $.session.start(START150)
  expect(w.closed).toEqual([])
  expect(w.panes.map(p => p.id)).toEqual(['trophy'])
})

test('150a: the Telemetry preview opened by show/p stays open across attach and a turn', async ($, on) => {
  const w = await world150($, on, [], { 'trophy.installId': 'i', 'trophy.unlocked': { 'first-blood': '2026-10-06' } })
  await $.session.start(START150)
  const band = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80 } as any })
  await band.press({ key: 'show' })
  expect(w.opened).toEqual(['trophy-batch'])
  await $.session.attach({ surface: 'mobile', clientId: 'mobile:default' } as any)
  await $.turn.complete({} as any)
  expect(w.closed).toEqual([])
})

test('150a: asking for the Telemetry preview does not stop the sweep closing a stale trophy pane', async ($, on) => {
  const w = await world150($, on, [], { 'trophy.installId': 'i', 'trophy.unlocked': { 'first-blood': '2026-10-06' } })
  await $.session.start(START150)
  const band = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80 } as any })
  await band.press({ key: 'show' })
  w.panes = [shown('trophy-batch'), shown('trophy')]
  await $.session.attach({ surface: 'mobile', clientId: 'mobile:default' } as any)
  expect(w.closed).toEqual(['trophy'])
})

test('150a: /achievements while the pane is shown closes it and says so; a throwing panes() counts as not shown', async ($, on) => {
  const w = await world150($, on)
  await $.session.start(START150)
  await run150($, { kind: 'composer' })
  const out = await run150($, { kind: 'composer' })
  expect(w.closed).toEqual(['trophy'])
  expect(w.opened).toEqual(['trophy'])
  expect(out.text).toMatch(/closed/i)

  w.panes = [shown('trophy')]
  w.panesThrows = true
  await run150($, { kind: 'composer' })
  expect(w.opened).toEqual(['trophy', 'trophy'])
})

test('150a: the pane header has a q close Button that closes it', async ($, on) => {
  const w = await world150($, on)
  await $.session.start(START150)
  await run150($, { kind: 'composer' })
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'Pane', requestId: 'trophy', props: PANE })
  await ui.press({ key: 'close' })
  expect(w.closed).toEqual(['trophy'])
})

test('150a: the Failures tab Button opens through the same path and counts as asked', async ($, on) => {
  const w = await world150($, on)
  await $.session.start(START150)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'Pane', requestId: 'trophy', props: PANE })
  await ui.press({ key: 'tab-failures' })
  expect(w.opened).toEqual(['trophy'])
  await $.session.attach({ surface: 'mobile', clientId: 'mobile:default' } as any)
  expect(w.closed).toEqual([])
})
