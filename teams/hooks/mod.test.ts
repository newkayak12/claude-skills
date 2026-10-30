import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { frame, draw, cells } from './demo-frames.ts'
import { STRINGS } from './mod'
import { askBandShown, carriesInput, paneKey, paneSlash, statusAnswer } from './pane'
import { clipText, columnWidths, footerPlan, padText, tabRowPlan, width } from './teams-draw'

const SURFACES = ['terminal', 'desktop', 'mobile', 'vscode'] as const
type Surface = (typeof SURFACES)[number]
type Run = { exitCode: number; stdout: string; stderr: string }
const ok = (stdout: string): Run => ({ exitCode: 0, stdout, stderr: '' })

// The engine beneath the plugin: surfaces, cwd, process.run, toast, status, command.register.
function world(on: On, surfaces: readonly Surface[], runs: (argv: readonly string[]) => Run) {
  const seen = { argv: [] as (readonly string[])[], toasts: [] as string[], toastEvents: [] as { text: string; timeoutMs?: number }[], statuses: [] as (string | undefined)[], commands: [] as string[], inFlight: 0, maxInFlight: 0 }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('command.register', (_$, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('process.run', async (_$, e) => {
    seen.argv.push(e.argv)
    seen.inFlight += 1
    seen.maxInFlight = Math.max(seen.maxInFlight, seen.inFlight)
    await Promise.resolve()
    seen.inFlight -= 1
    return { value: runs(e.argv) }
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    seen.toastEvents.push(e as { text: string; timeoutMs?: number })
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  return seen
}

const isEvents = (argv: readonly string[]) => argv.includes('events')
const start = ($: Engine) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
const sinceOf = (argv: readonly string[]) => argv[argv.indexOf('--since') + 1]

const E1 = { ts: 1500, task_id: 'E-aaaaaaaa1', kind: 'waiting_human', text: 'E-aaaaaaaa needs you: n1' }
const E2 = { ts: 1800, task_id: 'E-aaaaaaaa1', kind: 'daemon_done', text: 'E-aaaaaaaa finished: done' }
const twoEvents = [E1, E2].map(o => JSON.stringify(o)).join('\n') + '\n'

test('no surface: no timer, no command', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const seen = world(on, [], () => ok(''))
  await start($)
  await clock.advance(10000)
  expect(seen.argv).toHaveLength(0)
  expect(seen.commands).toEqual([])
})

for (const surface of SURFACES) {
  test(`${surface}: /teams-status is registered and the tick runs view.mjs from the plugin root`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const seen = world(on, [surface], () => ok(''))
    await start($)
    expect(seen.commands).toEqual(['teams-status'])
    await clock.advance(3000)
    expect(seen.argv.length > 0).toBe(true)
    expect(seen.argv.every(a => a[0] === 'node' && a[1].endsWith('/scripts/view.mjs') && !a[1].startsWith('${'))).toBe(true)
    expect(seen.maxInFlight).toBe(1)
  })

  test(`${surface}: two events: two toasts, cursor advances; the same events again: no toast`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const seen = world(on, [surface], argv => (isEvents(argv) ? ok(twoEvents) : ok('{"line":"","waiting":0}')))
    await start($)
    await clock.advance(3000)
    expect(seen.toasts).toEqual([E1.text, E2.text])
    await clock.advance(3000)
    expect(seen.toasts).toHaveLength(2)
    const sinces = seen.argv.filter(isEvents).map(sinceOf)
    expect(sinces).toEqual(['1000', '1800'])
  })

  test(`${surface}: status line: pinned only while someone must act, then cleared`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    let body = '{"line":"teams: E-aaaaaaaa 1/4 P1 implement","waiting":2}'
    const seen = world(on, [surface], argv => (isEvents(argv) ? ok('') : ok(body)))
    on('ui.panes', () => ({ value: [] }) as never)
    await start($)
    await clock.advance(3000)
    expect(seen.statuses).toEqual(['needs you: 2 waiting - open /teams-status'])
    body = '{"line":"teams: E-aaaaaaaa 1/4 P1 implement","waiting":0}'
    await clock.advance(3000)
    expect(seen.statuses[seen.statuses.length - 1]).toBeUndefined()
  })

  test(`${surface}: a non-zero exit: no throw, no toast, status unchanged`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const seen = world(on, [surface], () => ({ exitCode: 1, stdout: twoEvents, stderr: 'boom' }))
    await start($)
    await clock.advance(6000)
    expect(seen.toasts).toEqual([])
    expect(seen.statuses).toEqual([])
  })
}

// ---- tool.call: watch hook and team_status guard ----
// Engine beneath: surfaces, a tool that answers `result`, and a state store the test reads back.
function toolWorld(on: On, result: unknown, surfaces: readonly Surface[] = ['terminal'], isBroken = false) {
  const store = new Map<string, unknown>()
  on('session.surfaces', () => ({ value: surfaces }))
  on('tool.call', () => ({ result, text: '' }) as never)
  on('state.get', (_$, e) => ({ value: { value: store.get(e.key), version: 0 } }) as never)
  on('state.set', (_$, e) => {
    if (isBroken) throw new Error('boom')
    store.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } } as never
  })
  return { watched: () => (store.get('watch') as string[] | undefined) ?? [] }
}
const call = ($: Engine, tool: string, args: Record<string, unknown>) => $.tool.call({ tool, ...args } as never)

test('tm_run result with task_id adds it to watch; result unchanged', async ($, on) => {
  const result = { content: [{ type: 'text', text: 'x' }], structuredContent: { task_id: 'abc' } }
  const w = toolWorld(on, result)
  const r = await call($, 'mcp__teams__tm_run', {})
  expect(r).toEqual({ result, text: '' })
  expect(w.watched()).toContain('abc')
})

test('task_id read from JSON in content[0].text', async ($, on) => {
  const result = { content: [{ type: 'text', text: '{"task_id":"zed"}' }] }
  const w = toolWorld(on, result)
  await call($, 'mcp__teams__tm_open', {})
  expect(w.watched()).toContain('zed')
})

test('no task_id: watch unchanged', async ($, on) => {
  const result = { content: [{ type: 'text', text: 'hello' }] }
  const w = toolWorld(on, result)
  const r = await call($, 'mcp__teams__tm_run', {})
  expect(r).toEqual({ result, text: '' })
  expect(w.watched()).toEqual([])
})

test('headless: watch hook leaves watch alone', async ($, on) => {
  const w = toolWorld(on, { structuredContent: { task_id: 'abc' } }, [])
  await call($, 'mcp__teams__tm_run', {})
  expect(w.watched()).toEqual([])
})

test('throwing watch: the result is still returned', async ($, on) => {
  const result = { structuredContent: { task_id: 'abc' } }
  toolWorld(on, result, ['terminal'], true)
  const r = await call($, 'mcp__teams__tm_run', {})
  expect(r).toEqual({ result, text: '' })
})

const DENY = 'team_status full:true dumps every node; pass node_id or read detail_path (teams:orchestrate NEVER rule)'

test('team_status full:true is denied, with and without a surface', async ($, on) => {
  toolWorld(on, { ok: 1 }, [])
  const r = await call($, 'mcp__teams__team_status', { full: true })
  expect(r).toEqual({ deny: DENY })
})

test('team_status full:true with node_id, and {} pass', async ($, on) => {
  toolWorld(on, { ok: 1 })
  const a = await call($, 'mcp__teams__team_status', { full: true, node_id: 'x' })
  expect((a as { deny?: string }).deny).toBeUndefined()
  const b = await call($, 'mcp__teams__team_status', {})
  expect((b as { deny?: string }).deny).toBeUndefined()
})

// ---- pane and band ----

const stage = (key: string, state: string) => ({ key, state })
const card = (title: string, kind: string, state: string, over: Record<string, unknown> = {}) =>
  ({ title, kind, id: kind === 'defect' ? 'D1' : null, state, filed_by: null, reason: null, ...over })

// the demo task: 4 of 5 done, a QA-filed defect waiting to be fixed
const demo = (over: Record<string, unknown> = {}) => ({
  key: 'E-3a3a3bb5',
  title: 'Build the expense tracker',
  state: 'running',
  day: 15,
  done: 4,
  total: 5,
  now: { kind: 'fix', subject: 'b.txt not wired to the exported path', detail: 'filed by audit' },
  you: { count: 0, items: [] as string[] },
  stages: [stage('plan', 'done'), stage('build', 'done'), stage('integrate', 'done'), stage('qa', 'running'), stage('gate', 'pending'), stage('report', 'pending')],
  work: [
    card('module a', 'package', 'done'),
    card('module b', 'package', 'done'),
    card('b.txt not wired to the exported path', 'defect', 'pending', { filed_by: 'audit' }),
  ],
  cost: { usd: 0, turns: 0 },
  log: [{ time: '11:02', kind: 'passed', subject: 'module b' }, { time: '11:40', kind: 'filed', subject: 'defect D1' }],
  ...over,
})
const failedCard = card('module a', 'package', 'failed', { reason: 'verifier rejected: tests red' })
// `--format teams` rows (view-status.mjs teamsView) and one card's decision thread (decisionsView)
const row = (id: string, title: string, state: string, mark: string, now: unknown = null) => ({ id, key: `E-3a3a3bb5/${id}`, title, state, mark, now })
const TEAMS = {
  now: [
    { team: 'develop', key: 'E-3a3a3bb5/P1', node: 'implement', agent: 'codex·gpt-5', elapsed_ms: 240000 },
    { team: 'epic', key: 'E-3a3a3bb5', node: 'integrate:1', agent: 'claude·opus', elapsed_ms: 35000 },
  ],
  teams: [
    { team: 'planning', cards: [row('PLAN-F1', 'plan feature 1', 'DONE', 'done')] },
    { team: 'develop', cards: [row('P0', 'module a', 'BLOCKED', 'failed'), row('P1', 'module b', 'IN_PROGRESS', 'running', { node: 'implement', agent: 'codex·gpt-5', elapsed_ms: 240000 })] },
    { team: 'qa', cards: [row('QA-F1', 'QA feature 1', 'READY', 'pending')] },
    { team: 'audit', cards: [row('AUDIT', 'Planning audit', 'READY', 'pending')] },
  ],
}
const THREAD = {
  card: 'P1',
  entries: [
    { ts: 1, time: '10:00', card: 'P1', node: 'accept:P1:1', kind: 'verdict', actor: 'claude·opus', verdict: 'judge_failed', score: null, reason: 'reply was not JSON' },
    { ts: 2, time: '10:05', card: 'P1', node: 'accept:P1:1', kind: 'verdict', actor: 'claude·sonnet', verdict: 'reject', score: 70, reason: 'AC 3 missing', gaps: ['AC 3 untested'] },
    { ts: 3, time: '10:06', card: 'P1', node: 'critique', kind: 'answer', actor: 'human', text: 'reject: overlap' },
  ],
}
const fmtOf = (argv: readonly string[]) => argv[argv.indexOf('--format') + 1]
const stat = (over: Record<string, unknown> = {}) => ({ line: 'teams: E-3a3a3bb5 12/17 ', waiting: 0, latest: '3a3a3bb5-f4b7', ...over })

const LEAKS = ['verdict=', 'match=', '/Users/', '/var/', 'dispatch:', 'gate:goal', 'accept:']
const EN_UI = ['Now', 'You', 'Stages', 'Work', 'Cost', 'Summary', 'Log', 'needs you', 'question for you', 'questions for you', 'more in other runs', 'running', 'stalled', 'finished']

// Engine beneath: a Map-backed $.state, process.run for view.mjs (status and summary answer the same
// fixture), ui.open and ui.status recorded.
type Data = { status?: Record<string, unknown>; tasks?: unknown[]; task?: unknown; teams?: unknown; dash?: unknown; decisions?: (card: string | null) => unknown; reports?: Record<string, unknown>; events?: unknown[]; failReport?: boolean; isUnplaced?: boolean; plain?: Run }
function uiWorld(on: On, init: Record<string, unknown> = {}, surfaces: readonly Surface[] = ['terminal'], data: Data = {}) {
  // the pane opens on the Dashboard; the older tests read the Floor and say so here unless they pick a tab
  const store = new Map<string, unknown>(Object.entries({ view: 'floor', ...init }))
  const seen = { store, argv: [] as (readonly string[])[], opened: [] as string[], openArgs: [] as unknown[], statuses: [] as (string | undefined)[] }
  const status = () => data.status ?? { line: '', waiting: 0 }
  on('session.surfaces', () => ({ value: surfaces }))
  on('state.get', (_$, e) => ({ value: { value: store.get(e.key), version: 0 } }) as never)
  on('state.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } } as never
  })
  on('process.run', (_$, e) => {
    seen.argv.push(e.argv)
    const format = e.argv[e.argv.indexOf('--format') + 1]
    // `view.mjs --once` with no --format: the EPIC index the command answers with off the terminal
    if (!e.argv.includes('--format') || e.argv.includes('board')) return { value: data.plain ?? ok('') }
    if (format === 'report' && data.failReport) return { value: { exitCode: 1, stdout: '', stderr: 'boom' } }
    if (format === 'events') {
      const since = Number(e.argv[e.argv.indexOf('--since') + 1])
      return { value: ok((data.events ?? []).filter(o => (o as { ts: number }).ts > since).map(o => JSON.stringify(o) + '\n').join('')) }
    }
    if (format === 'report') return { value: ok(JSON.stringify((data.reports ?? {})[e.argv[e.argv.indexOf('--task') + 1]!] ?? null)) }
    if (format === 'decisions') {
      const card = e.argv.includes('--card') ? e.argv[e.argv.indexOf('--card') + 1]! : null
      return { value: ok(JSON.stringify(data.decisions?.(card) ?? { card, entries: [] })) }
    }
    if (format === 'teams') return { value: ok(JSON.stringify({ status: status(), tasks: data.tasks, task: data.task ?? null, teams: data.teams ?? null, dash: data.dash ?? null })) }
    return { value: ok(format === 'status' ? JSON.stringify(status()) : format === 'summary' ? JSON.stringify({ status: status(), tasks: data.tasks, task: data.task ?? null }) : '') }
  })
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)
    seen.openArgs.push(e)
    return { value: data.isUnplaced ? { isPlaced: false, reason: 'no-surface' } : { isPlaced: true } } as never
  })
  on('ui.status', (_$, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  return seen
}
// what session.start needs besides uiWorld; `language` answers $.settings.read()
function startWorld(on: On, language?: string) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('settings.read', () => ({ value: language === undefined ? {} : { language } }) as never)
}
const pane = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'teams', surface, component: 'Pane', requestId: 'teams-status', props: { title: 'Teams', isFocused: false, bodyColumns: 80, placement: 'dock' } } as never)
const band = ($: Engine, surface: (typeof SURFACES)[number], hasSurvey = false) =>
  $.ui.mount({ plugin: 'teams', surface, component: 'AbovePrompt', props: { hasSurvey, isWorking: false, maxRows: 5, bodyColumns: 80 } } as never)
type Ui = Awaited<ReturnType<typeof pane>>
const shown = async (ui: Ui) => JSON.stringify(await ui.drawn())
const labels = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label))
// the header row of a task the EPIC list does not carry: its state and progress Text
const headerOf = async (ui: Ui) => String((await ui.find({ type: 'Text', text: /· \d+\/\d+$/ }))?.text ?? '')
const engineBand = (on: On) =>
  on('ui.render', (_$, e) => (e.component === 'AbovePrompt' ? { type: 'Text', children: ['engine band'] } : undefined) as never)

// The data reaches the mod the way it does live: one tick (pane open, so the summary call runs) over
// the mocked view.mjs; `data` is read at every call, so a test changes it between ticks.
async function seeded($: Engine, on: On, data: Data, surface: (typeof SURFACES)[number] = 'terminal', language?: string, init: Record<string, unknown> = {}, bare = false) {
  const clock = mock.clock(on, { now: 1000 })
  startWorld(on, language)
  const seen = uiWorld(on, { watch: ['abc'], ...init }, [surface], data)
  on('ui.panes', () => ({ value: [{ id: 'teams-status', title: 'Teams', isPlaced: true }] }) as never)
  // the engine's own band, beneath the teams row; the demo frames get an empty one so no stub text is drawn
  if (bare) on('ui.render', (_$, e) => (e.component === 'AbovePrompt' ? { type: 'Box', children: [] } : undefined) as never)
  else engineBand(on)
  await start($)
  await clock.advance(3000)
  return { seen, tick: () => clock.advance(3000), clock }
}
const seededClock = ($: Engine, on: On, data: Data, surface: (typeof SURFACES)[number]) => seeded($, on, data, surface, undefined, { epic: 'tA' })

for (const surface of SURFACES) {
  test(`${surface}: Summary answers how far / going well, with no internal ids; render runs no process`, async ($, on) => {
    const { seen } = await seeded($, on, { status: stat(), task: demo() }, surface)
    const ui = await pane($, surface)
    const n = seen.argv.length
    const text = await shown(ui)
    for (const word of ['4/5', 'running', 'Build the expense tracker']) expect(text).toContain(word)
    for (const word of ['Now', 'You', 'day ']) expect(text).not.toContain(word)
    for (const leak of LEAKS) expect(text).not.toContain(leak)
    await ui.redraw()
    expect(seen.argv).toHaveLength(n)
  })

  test(`${surface}: session start alone opens no pane`, async ($, on) => {
    const seen = uiWorld(on, {}, [surface])
    startWorld(on)
    await start($)
    expect(seen.opened).toEqual([])
  })

  test(`${surface}: no Button label in the pane or the band holds a bracket`, async ($, on) => {
    await seeded($, on, { status: stat({ waiting: 1 }), task: demo() }, surface)
    const all = [...(await labels(await pane($, surface))), ...(await labels(await band($, surface)))]
    expect(all.length >= 5).toBe(true)
    expect(all.filter(l => l.includes('[') || l.includes(']'))).toEqual([])
  })

  test(`${surface}: the title sits on top, then the tabs: plain tabs, the selected one full strength with a dot (1-5 are Input keys, no Button hotkey)`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo() }, surface)
    const ui = await pane($, surface)
    const tab = async (key: string) => (await ui.find({ key }))?.props
    expect(await tab('floor')).toMatchObject({ plain: true, dimColor: false, label: '● Floor' })
    expect(await tab('stories')).toMatchObject({ plain: true, dimColor: true, label: 'STORYs' })
    expect(await tab('decisions')).toMatchObject({ plain: true, dimColor: true, label: 'Decisions' })
    expect(await tab('log')).toMatchObject({ label: 'Log' })
    expect(await tab('report')).toMatchObject({ label: 'Report' })
    for (const key of ['floor', 'stories', 'decisions', 'log', 'report']) expect((await tab(key))?.hotkey).toBeUndefined()
    const text = await shown(ui)
    expect(text.indexOf('Build the expense tracker')).toBeLessThan(text.indexOf('Floor'))
    await ui.press({ key: 'decisions' })
    await ui.redraw() // the stubbed $.state does not notify readers
    expect(await tab('decisions')).toMatchObject({ dimColor: false, label: '● Decisions' })
    expect(await tab('floor')).toMatchObject({ dimColor: true, label: 'Floor' })
  })

  // (the per-actor Now lines of `teams.now` left the pane with the Now block: the worker rows and the band say who acts)
  test(`${surface}: Decisions tab: one block per team, each card with its state and what it does now; the Floor has none`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo({ work: [failedCard] }), teams: TEAMS }, surface)
    const ui = await pane($, surface)
    expect(await ui.find({ key: 'card:P1' })).toBeUndefined()
    await ui.press({ key: 'decisions' })
    await ui.redraw()
    for (const head of ['Planning', 'Develop', 'QA', 'Audit']) expect(await ui.find({ type: 'Text', text: head })).toBeDefined()
    expect((await ui.find({ key: 'card:P1' }))?.props.label).toBe('● module b · IN_PROGRESS · implement codex·gpt-5 4m')
    expect((await ui.find({ key: 'card:P0' }))?.props.label).toBe('✘ module a · BLOCKED')
    expect(await ui.find({ type: 'Text', text: '  verifier rejected: tests red' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /E-3a3a3bb5\/P1 · implement/ })).toBeUndefined()
  })

  test(`${surface}: a card pressed opens its own decision thread: earlier and later verdict with actor and reason`, async ($, on) => {
    const { seen } = await seeded($, on, { status: stat(), task: demo(), teams: TEAMS, decisions: card => (card === 'P1' ? THREAD : { card: null, entries: [] }) }, surface)
    const ui = await pane($, surface)
    await ui.press({ key: 'decisions' })
    await ui.redraw()
    await ui.press({ key: 'card:P1' })
    await ui.redraw()
    const call = seen.argv.filter(a => fmtOf(a) === 'decisions').at(-1)!
    expect(call.slice(2)).toEqual(['--once', '--format', 'decisions', '--task', 'abc', '--cwd', '/proj', '--card', 'P1'])
    expect((await ui.find({ key: 'decisions' }))?.props.label).toBe('● Decisions')
    expect(await ui.find({ type: 'Text', text: 'Card P1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '10:00 claude·opus · could not judge · accept:P1:1 — reply was not JSON' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '10:05 claude·sonnet · rejected 70% · accept:P1:1 — AC 3 missing' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '      gaps: AC 3 untested' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '10:06 human · answered · critique — reject: overlap' })).toBeDefined()
    await ui.press({ key: 'all' })
    const last = seen.argv.filter(a => fmtOf(a) === 'decisions').at(-1)!
    expect(last.includes('--card')).toBe(false)
  })

  test(`${surface}: a failed card shows its reason once; Log tab has time and sentence`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo({ work: [failedCard, card('module b', 'package', 'done')] }) }, surface)
    const ui = await pane($, surface)
    await ui.press({ key: 'decisions' })
    await ui.redraw()
    const work = await shown(ui)
    expect(work).toContain('module a')
    expect(work).toContain('module b')
    expect(work.split('verifier rejected: tests red').length - 1).toBe(1)
    await ui.press({ key: 'log' })
    await ui.redraw()
    const log = await shown(ui)
    expect(log).toContain('11:02 module b passed')
    expect(log).toContain('11:40')
  })

  test(`${surface}: no watched task and no cwd task draws the no-run text (regression guard)`, async ($, on) => {
    const seen = uiWorld(on)
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: 'No teams run in this session.' })).toBeDefined()
    expect(seen.argv).toHaveLength(0)
  })

  test(`${surface}: the no-run view closes on q where an Input is carried; no keys Input on mobile`, async ($, on) => {
    const closed: string[] = []
    on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
    uiWorld(on)
    const ui = await pane($, surface)
    expect((await ui.find({ key: 'close' })) !== undefined).toBe(true)
    if (!carriesInput(surface)) {
      expect(await ui.find({ key: 'keys' })).toBeUndefined()
      return
    }
    expect((await ui.find({ key: 'keys' }))?.props.autoFocus).toBe(true)
    await ui.input({ key: 'keys', text: 'j', kind: 'change' } as never)
    await ui.redraw()
    expect(closed).toEqual([])
    await ui.input({ key: 'keys', text: 'q', kind: 'change' } as never)
    await ui.redraw()
    expect(closed).toEqual(['teams-status'])
  })

  // the host keeps what a person typed in an Input until the hook draws another value: a handled key must draw the empty one
  test(`${surface}: the no-run Input holds a typed /command and is empty after a handled key; q still closes`, async ($, on) => {
    if (!carriesInput(surface)) return
    const closed: string[] = []
    on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
    uiWorld(on, {}, [surface])
    const ui = await pane($, surface)
    const typed = async (text: string) => {
      await ui.input({ key: 'keys', text, kind: 'change' } as never)
      await ui.redraw()
      return (await ui.find({ key: 'keys' }))?.props.value
    }
    expect(await typed('/x')).toBe('/x') // text holding `/` is no key: held
    expect(await typed('/xq')).toBe('/xq')
    expect(closed).toEqual([])
    expect(await typed('j')).toBe('') // a handled key that does nothing here
    expect(await typed('1')).toBe('')
    expect(closed).toEqual([])
    expect(await typed('q')).toBe('')
    expect(closed).toEqual(['teams-status'])
  })

  test(`${surface}: the footer Input holds a typed /command; every handled key leaves it empty again; Enter on /teams-status closes`, async ($, on) => {
    if (!carriesInput(surface)) return
    const closed: string[] = []
    on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
    await seeded($, on, { status: stat(), task: demo(), teams: TEAMS }, surface)
    const ui = await pane($, surface)
    const typed = async (text: string, kind: 'change' | 'submit' = 'change') => {
      await ui.input({ key: 'keys', text, kind } as never)
      await ui.redraw()
      return (await ui.find({ key: 'keys' }))?.props.value
    }
    // a slash command being typed is held: no key fires, the text stays in the Input
    expect(await typed('/teams-status')).toBe('/teams-status')
    expect(await typed('/xq')).toBe('/xq') // `/x` then q: paneKey is null on a `/`, so q is held
    expect(closed).toEqual([])
    // digits 1, 2, 0 (0 is no tab) then j, k, [, ] and g with no run file: the buffer is cleared every time, whole
    for (const key of ['1', '2', '0', 'j', 'k', '[', ']', 'g', 'x1']) {
      expect(await typed(key)).toBe('')
      expect(closed).toEqual([])
    }
    expect(await typed('/teams-status')).toBe('/teams-status')
    expect(await typed('/teams-status', 'submit')).toBe('')
    expect(closed).toEqual(['teams-status'])
    expect(await typed('q')).toBe('')
    expect(closed).toEqual(['teams-status', 'teams-status'])
  })

  for (const why of ['no status yet', 'a survey']) {
    test(`${surface}: band yields with ${why} (regression guard)`, async ($, on) => {
      if (why === 'a survey') await seeded($, on, { status: stat(), task: demo() }, surface)
      else {
        engineBand(on)
        uiWorld(on)
      }
      const ui = await band($, surface, why === 'a survey')
      expect(await ui.find({ text: 'engine band' })).toBeDefined()
      expect(await ui.find({ type: 'Button' })).toBeUndefined()
    })
  }

  test(`${surface}: band shows the teams row and the engine-supplied band beneath it`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo() }, surface)
    const ui = await band($, surface)
    const text = await shown(ui)
    expect(text).toContain('4/5')
    expect(text).toContain('Build the expense tracker')
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
  })

  for (const [why, data] of [
    ['a line but no task summary', { status: stat(), task: null }],
    ['a finished task', { status: stat({ line: 'teams: E-x 5/5 ' }), task: demo({ state: 'complete' }) }],
    ['a stalled task', { status: stat(), task: demo({ state: 'stalled' }) }],
  ] as const) {
    test(`${surface}: band draws no teams row with ${why}`, async ($, on) => {
      await seeded($, on, data, surface)
      const ui = await band($, surface)
      expect(await ui.find({ text: 'engine band' })).toBeDefined()
      expect(await ui.find({ type: 'Button' })).toBeUndefined()
    })
  }

  test(`${surface}: band draws nothing with no latest task, nothing waiting and an empty line (regression guard)`, async ($, on) => {
    await seeded($, on, { status: { line: '', waiting: 0, latest: null }, task: null }, surface)
    const ui = await band($, surface)
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
  })

  test(`${surface}: needs-you count comes from status.waiting: band Button and the pane's other-runs line`, async ($, on) => {
    const { seen } = await seeded($, on, { status: stat({ waiting: 2 }), task: demo() }, surface)
    const ui = await band($, surface)
    expect((await ui.find({ key: 'inbox' }))?.props.label).toBe('2 questions for you')
    expect(await ui.find({ key: 'board' })).toBeUndefined()
    await ui.press({ key: 'inbox' })
    expect(seen.opened).toEqual(['teams-status'])
    expect(await shown(await pane($, surface))).toContain('2 more in other runs')
  })

  test(`${surface}: band says one question for you in the singular and the ko label carries the count`, async ($, on) => {
    await seeded($, on, { status: stat({ waiting: 1 }), task: demo() }, surface)
    expect((await (await band($, surface)).find({ key: 'inbox' }))?.props.label).toBe('1 question for you')
  })

  test(`${surface}: korean band label counts the questions`, async ($, on) => {
    await seeded($, on, { status: stat({ waiting: 3 }), task: demo() }, surface, 'korean')
    expect((await (await band($, surface)).find({ key: 'inbox' }))?.props.label).toBe('질문 3건')
  })

  test(`${surface}: band shows no inbox Button when nothing waits (regression guard)`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo() }, surface)
    const ui = await band($, surface)
    expect(await ui.find({ key: 'board' })).toBeDefined()
    expect(await ui.find({ key: 'inbox' })).toBeUndefined()
  })

  test(`${surface}: running, stalled and finished tasks read differently on the first screen; a failed card shows its reason`, async ($, on) => {
    const data: { status: Record<string, unknown>; task: unknown } = { status: stat(), task: demo() }
    const { tick } = await seeded($, on, data, surface)
    const ui = await pane($, surface)
    const headers: string[] = []
    for (const state of ['running', 'stalled', 'complete']) {
      data.task = demo({ state })
      await tick()
      await ui.redraw()
      headers.push(await headerOf(ui))
    }
    expect(headers[1]).toContain('stalled')
    expect(headers[1]).not.toContain('running')
    expect(headers[2]).toContain('finished')
    expect(headers[2]).not.toContain('running')
    expect(new Set(headers).size).toBe(3)
    data.task = demo({ work: [failedCard, card('module b', 'package', 'done')] })
    await ui.press({ key: 'decisions' })
    await tick()
    await ui.redraw()
    const failed = await shown(ui)
    for (const word of ['✘', 'module a', 'verifier rejected: tests red']) expect(failed).toContain(word)
  })

  test(`${surface}: language korean draws no English UI word and the 현장 tab`, async ($, on) => {
    await seeded($, on, { status: stat({ waiting: 2 }), task: demo({ work: [failedCard] }), teams: TEAMS }, surface, 'korean')
    const ui = await pane($, surface)
    const floor = await shown(ui)
    await ui.press({ key: 'decisions' })
    await ui.redraw()
    const texts = [floor, await shown(ui), await shown(await band($, surface))]
    for (const text of texts) for (const word of [...EN_UI, 'Teams', 'Decisions', 'Develop', 'Audit', '"label":"close"', 'q close']) expect(text).not.toContain(word)
    expect(texts[0]).toContain('● 현장')
    expect(texts[1]).toContain('개발')
    expect(texts[0]).toContain('Build the expense tracker')
    expect(texts[0]).toContain('q 닫기')
  })
}

for (const language of ['English', undefined]) {
  test(`language ${language ?? 'unset'}: the pane shows Floor`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo() }, 'terminal', language)
    const text = await shown(await pane($, 'terminal'))
    expect(text).toContain('Floor')
    expect(text).not.toContain('결정')
  })
}

// ---- closing: Escape, q, and the command again ----
test('the pane opens focused and closes on Escape (from the command and the band)', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  startWorld(on)
  const seen = uiWorld(on, { watch: ['abc'] }, ['terminal'], { status: stat(), task: demo() })
  on('ui.panes', () => ({ value: [] }) as never)
  engineBand(on)
  await start($)
  await clock.advance(3000) // learns status.latest
  await clock.advance(3000) // the summary the band draws
  await $.command.run({ command: 'teams-status', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  await (await band($, 'terminal')).press({ key: 'board' })
  expect(seen.openArgs).toHaveLength(2)
  for (const args of seen.openArgs) expect(args).toMatchObject({ id: 'teams-status', focus: true, closeOnEscape: true })
})

test('q closes the pane; /teams-status on an open pane closes it', async ($, on) => {
  const closed: string[] = []
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
  await seeded($, on, { status: stat(), task: demo() })
  const ui = await pane($, 'terminal')
  expect((await ui.find({ key: 'close' }))?.props).toMatchObject({ role: 'dismiss', label: 'q close', plain: true, dimColor: true })
  // said once, as the footer's last item; the key hint does not say it again
  expect((await shown(ui)).split('"label":"q close"').length - 1).toBe(1)
  expect((await shown(ui)).replace('"key":"close"', '').split('close').length - 1).toBe(1)
  expect((await ui.findAll({ type: 'Button' })).at(-1)?.props.key).toBe('close')
  for (const lang of ['en', 'ko'] as const) expect(STRINGS[lang].keysHint).not.toMatch(/q close|q 닫기/)
  await ui.press({ key: 'close' })
  expect(closed).toEqual(['teams-status'])
  const r = await $.command.run({ command: 'teams-status', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(closed).toEqual(['teams-status', 'teams-status'])
  expect(JSON.stringify(r)).toContain('pane closed')
})

// the pane's Input is focused on open: q and the digits reach it as text, so they are read there, not as Button hotkeys
test('with the Input focused: q closes; digits 1-5 pick the tabs; /teams-status submitted closes; /other runs that command', async ($, on) => {
  const closed: string[] = []
  const ran: unknown[] = []
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
  on('command.run', (_$, e) => { ran.push(e); return { value: { text: '' } } as never })
  await seeded($, on, { status: stat(), task: demo(), teams: TEAMS }, 'terminal')
  const ui = await pane($, 'terminal')
  const typed = async (text: string, kind: 'change' | 'submit' = 'change') => {
    await ui.input({ key: 'keys', text, kind } as never)
    await ui.redraw()
  }
  expect((await ui.find({ key: 'keys' }))?.props.autoFocus).toBe(true)
  // digits: each picks its tab (the selected one carries the dot)
  for (const [digit, label] of [['2', '● STORYs'], ['3', '● Decisions'], ['4', '● Log'], ['5', '● Report'], ['1', '● Floor']] as const) {
    await typed(digit)
    expect(await labels(ui)).toContain(label)
  }
  expect(closed).toEqual([])
  // a slash command being typed holds every key: `/teams-status` ends in `s`, `/x q` ends in q
  await typed('/teams-status')
  await typed('/help q')
  expect(closed).toEqual([])
  await typed('/teams-status', 'submit')
  expect(closed).toEqual(['teams-status'])
  await typed('/help me', 'submit')
  expect(ran).toHaveLength(1)
  expect(ran[0]).toMatchObject({ command: 'help', args: 'me' })
  await typed('x', 'submit') // not a command: nothing
  expect(closed).toEqual(['teams-status'])
  await typed('q')
  expect(closed).toEqual(['teams-status', 'teams-status'])
})

test('paneKey and paneSlash: q closes, digits pick tabs, a `/` holds the keys, the command starts at the first `/`', () => {
  expect(paneKey('q')).toEqual({ kind: 'close' })
  expect(paneKey('][2')).toEqual({ kind: 'tab', tab: 'stories' })
  expect(paneKey('5')).toEqual({ kind: 'tab', tab: 'report' })
  expect(paneKey('6')).toBeNull()
  expect(paneKey('/teams-status')).toBeNull()
  expect(paneKey('/help q')).toBeNull()
  expect(paneKey('')).toBeNull()
  expect(paneKey(undefined)).toBeNull()
  expect(paneSlash('/teams-status')).toEqual({ kind: 'close' })
  expect(paneSlash('][2q/teams-status ')).toEqual({ kind: 'close' })
  expect(paneSlash('/help me now')).toEqual({ kind: 'run', command: 'help', args: 'me now' })
  expect(paneSlash('jk')).toBeNull()
  expect(paneSlash('/')).toBeNull()
  expect(paneSlash(3)).toBeNull()
})

test('tabRowPlan: the cost text goes first, then the gap, then the longest label is cut with …; footerPlan: close stays whole', () => {
  const tabs = ['● Floor', 'STORYs', 'Decisions', 'Log', 'Report']
  const total = (p: { labels: string[]; gap: number }) => p.labels.reduce((n, l) => n + [...l].length, 0) + p.gap * 4
  const cost = '$1.92 · 14 turns'
  expect(tabRowPlan(tabs, cost, 80)).toEqual({ labels: tabs, gap: 2, cost })
  const noCost = tabRowPlan(tabs, cost, 42)
  expect(noCost).toEqual({ labels: tabs, gap: 2, cost: null })
  const tight = tabRowPlan(tabs, cost, 34)
  expect(tight.cost).toBeNull()
  expect(total(tight)).toBeLessThanOrEqual(34)
  expect(tight.labels.some(l => l.endsWith('…'))).toBe(true)
  const hint = '[ ] EPIC · j k row · 0-5 tabs'
  expect(footerPlan({ steps: 0, open: '', close: 'q close', hint }, 80).hint).toBe(hint)
  const cut = footerPlan({ steps: 2, open: '', close: 'q close', hint }, 42).hint
  expect(cut.endsWith('…')).toBe(true)
  expect([...cut].length + 10 + 4 + 7 + 4).toBeLessThanOrEqual(42) // hint + Input chrome + prev/next + close + two gaps of 2
  expect(footerPlan({ steps: 2, open: 'g open run', close: 'q close', hint }, 30).hint).toBe('')
})

test('language korean: stalled pane header and the waiting status line have no English UI word', async ($, on) => {
  const { seen } = await seeded($, on, { status: stat({ waiting: 2 }), task: demo({ state: 'stalled' }) }, 'terminal', '한국어')
  const header = await headerOf(await pane($, 'terminal'))
  expect(header).toContain('멈춤')
  for (const word of EN_UI) expect(header).not.toContain(word)
  const line = seen.statuses[seen.statuses.length - 1] ?? ''
  expect(line).toContain('확인 필요')
  for (const word of EN_UI) expect(line).not.toContain(word)
})

test('status line: waiting 0 clears it', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  startWorld(on)
  const seen = uiWorld(on, {}, ['terminal'], { status: stat({ waiting: 0 }), task: demo() })
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  await clock.advance(3000)
  expect(seen.statuses.length > 0).toBe(true)
  expect(seen.statuses[seen.statuses.length - 1]).toBeUndefined()
})

test('status line: waiting 2 pins a text that does not start with teams', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  startWorld(on)
  const seen = uiWorld(on, {}, ['terminal'], { status: stat({ waiting: 2 }), task: demo() })
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  await clock.advance(3000)
  const text = seen.statuses[seen.statuses.length - 1]
  expect(text === undefined).toBe(false)
  expect(text!.startsWith('teams')).toBe(false)
  expect(text!.includes('teams:')).toBe(false)
  expect(text!.includes('2')).toBe(true)
})

test('status line: an ask band is shown, so the waiting segment is dropped (no word said twice)', async ($, on) => {
  const { seen } = await seeded($, on, { status: stat({ waiting: 1, asks: [ASK] }), task: demo() })
  expect(seen.statuses.length > 0).toBe(true)
  expect(seen.statuses[seen.statuses.length - 1]).toBeUndefined()
  expect(await shown(await band($, 'terminal'))).toContain('asks you')
})

test('status line: waiting 2 and no asks still pins the line', async ($, on) => {
  const { seen } = await seeded($, on, { status: stat({ waiting: 2, asks: [] }), task: demo() })
  const text = seen.statuses[seen.statuses.length - 1]
  expect(text === undefined).toBe(false)
  expect(text!.includes('2')).toBe(true)
})

test('status line: asks but an ended card with a held report replaces the band, so the line stays pinned', async ($, on) => {
  const data = { status: stat({ waiting: 1, asks: [ASK] }), task: demo(), events: [END('tee')], reports: { tee: T_PAYLOAD() } }
  const { seen, tick } = await seeded($, on, data)
  await tick()
  expect(seen.store.get('ended')).toEqual({ tee: 'card' })
  const text = seen.statuses[seen.statuses.length - 1]
  expect(text === undefined).toBe(false)
  expect(text!.includes('1')).toBe(true)
})

test('askBandShown: true only with at least one ask and no card', () => {
  expect(askBandShown(undefined, false)).toBe(false)
  expect(askBandShown([], false)).toBe(false)
  expect(askBandShown([ASK], false)).toBe(true)
  expect(askBandShown([ASK], true)).toBe(false)
})

// ---- tick cost: events + exactly one data call ----
async function tickWorld($: Engine, on: On, init: Record<string, unknown>, isOpen: boolean, data: { status?: Record<string, unknown>; task?: unknown } = { status: stat(), task: demo() }) {
  const clock = mock.clock(on, { now: 1000 })
  startWorld(on)
  const seen = uiWorld(on, init, ['terminal'], data)
  on('ui.panes', () => ({ value: isOpen ? [{ id: 'teams-status', title: 'Teams', isPlaced: true }] : [] }) as never)
  await start($)
  const ticks: (readonly string[])[][] = []
  const tick = async () => {
    const n = seen.argv.length
    await clock.advance(3000)
    ticks.push(seen.argv.slice(n).filter(a => !isEvents(a)))
  }
  return { seen, tick, ticks }
}
const formatOf = (argv: readonly string[]) => argv[argv.indexOf('--format') + 1]

test('tick: pane closed and no task in this cwd: exactly one call, --format status (regression guard)', async ($, on) => {
  const w = await tickWorld($, on, {}, false, { status: { line: '', waiting: 0, latest: null }, task: null })
  await w.tick()
  await w.tick()
  for (const calls of w.ticks) {
    expect(calls).toHaveLength(1)
    expect(formatOf(calls[0]!)).toBe('status')
  }
})

test('tick: pane closed and a task is known: one --format summary call without --task', async ($, on) => {
  const w = await tickWorld($, on, {}, false)
  await w.tick() // learns status.latest
  await w.tick()
  expect(w.ticks[1]).toHaveLength(1)
  expect(formatOf(w.ticks[1]![0]!)).toBe('summary')
  expect(w.ticks[1]![0]!.includes('--task')).toBe(false)
})

test('tick: pane open: one --format teams call with --task paneTask; no --view, no status call', async ($, on) => {
  const w = await tickWorld($, on, { watch: ['abc'] }, true)
  await w.tick()
  await w.tick()
  for (const calls of w.ticks) {
    expect(calls).toHaveLength(1)
    expect(formatOf(calls[0]!)).toBe('teams')
    expect(calls[0]![calls[0]!.indexOf('--task') + 1]).toBe('abc')
  }
  expect(w.seen.argv.some(a => a.includes('--view'))).toBe(false)
})

test('tick: Decisions tab open: one more call, --format decisions for the pane task and picked card', async ($, on) => {
  const w = await tickWorld($, on, { watch: ['abc'], view: 'decisions', selected: 'P1' }, true)
  await w.tick()
  expect(w.ticks[0]!.map(formatOf)).toEqual(['teams', 'decisions'])
  const d = w.ticks[0]![1]!
  expect([d[d.indexOf('--task') + 1], d[d.indexOf('--card') + 1]]).toEqual(['abc', 'P1'])
})

test('tick: pane open falls back to status.latest once known', async ($, on) => {
  const w = await tickWorld($, on, {}, true)
  await w.tick()
  await w.tick()
  const last = w.ticks[1]![0]!
  expect(last[last.indexOf('--task') + 1]).toBe('3a3a3bb5-f4b7')
})

test('tick stores the summary the pane then draws without running a process', async ($, on) => {
  // (the pane is drawn from the tick's data; a render adds no process call)
  const w = await tickWorld($, on, { watch: ['abc'] }, true)
  await w.tick()
  const n = w.seen.argv.length
  const ui = await pane($, 'terminal')
  expect(await shown(ui)).toContain('4/5')
  await ui.redraw()
  expect(w.seen.argv).toHaveLength(n)
})

test('/teams-status answers and opens the pane; session start alone opens nothing', async ($, on) => {
  const seen = uiWorld(on)
  startWorld(on)
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  expect(seen.opened).toEqual([])
  const r = await $.command.run({ command: 'teams-status', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(seen.opened).toEqual(['teams-status'])
  expect(JSON.stringify(r)).toContain('pane opened')
})

// ---- /teams-status off the terminal: the answer carries the view.mjs text ----
const INDEX = 'tasks under /w/tasks:\n  E-3a3a3bb5  expense-tracker  IN_PROGRESS\n'
const runStatus = ($: Engine) => $.command.run({ command: 'teams-status', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
const textOf = (r: unknown) => String((r as { text?: string }).text)

test('/teams-status: ui.open not placed: answers with the view.mjs text, run with the cwd', async ($, on) => {
  const seen = uiWorld(on, {}, ['terminal'], { isUnplaced: true, plain: ok(INDEX) })
  startWorld(on)
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  expect(textOf(await runStatus($))).toBe(INDEX)
  const plain = seen.argv.find(a => a.includes('board'))!
  expect(plain.slice(0, 1)).toEqual(['node'])
  expect(plain[1]).toMatch(/\/scripts\/view\.mjs$/)
  expect(plain.slice(2)).toEqual(['--once', '--format', 'board', '--cwd', '/proj'])
})

test('/teams-status: a desktop session (pane placed): answers with the view.mjs text', async ($, on) => {
  uiWorld(on, {}, ['terminal', 'desktop'], { plain: ok(INDEX) })
  startWorld(on)
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  expect(textOf(await runStatus($))).toBe(INDEX)
})

test('/teams-status: a terminal-only session with the pane placed answers with the view.mjs text', async ($, on) => {
  const seen = uiWorld(on, {}, ['terminal'], { plain: ok(INDEX) })
  startWorld(on)
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  expect(textOf(await runStatus($))).toBe(INDEX)
  expect(seen.opened).toEqual(['teams-status'])
  expect(seen.argv.filter(a => a.includes('board'))).toHaveLength(1)
})

test('/teams-status: an empty roster answers with the view.mjs text', async ($, on) => {
  uiWorld(on, {}, [], { plain: ok(INDEX) })
  startWorld(on)
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  expect(textOf(await runStatus($))).toBe(INDEX)
})

for (const [why, plain] of [['fails', { exitCode: 1, stdout: INDEX, stderr: 'boom' }], ['prints nothing', ok('  \n')]] as const) {
  test(`/teams-status: off the terminal, a view.mjs that ${why} falls back to pane opened`, async ($, on) => {
    uiWorld(on, {}, ['terminal', 'mobile'], { plain })
    startWorld(on)
    on('ui.panes', () => ({ value: [] }) as never)
    await start($)
    expect(textOf(await runStatus($))).toBe('pane opened')
  })
}

test('/teams-status: off the terminal, the second run still closes the pane', async ($, on) => {
  const closed: string[] = []
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
  const seen = uiWorld(on, {}, ['terminal', 'mobile'], { plain: ok(INDEX) })
  startWorld(on)
  on('ui.panes', () => ({ value: seen.opened.length > 0 ? [{ id: 'teams-status', title: 'Teams', isPlaced: true }] : [] }) as never)
  await start($)
  expect(textOf(await runStatus($))).toBe(INDEX)
  expect(closed).toEqual([])
  expect(textOf(await runStatus($))).toBe('pane closed')
  expect(closed).toEqual(['teams-status'])
  expect(seen.opened).toEqual(['teams-status'])
})

test('pane.ts: carriesInput and the status answer', () => {
  expect(SURFACES.filter(carriesInput)).toEqual(['terminal', 'desktop', 'vscode'])
  expect(statusAnswer({ exitCode: 0, stdout: 'x\n' }, 'opened')).toBe('x\n')
  expect(statusAnswer({ exitCode: 2, stdout: 'x' }, 'opened')).toBe('opened')
  expect(statusAnswer({ exitCode: 0, stdout: ' ' }, 'opened')).toBe('opened')
  expect(statusAnswer(null, 'opened')).toBe('opened')
})

// the footer's Input takes the keys; mobile draws none and keeps every Button
for (const surface of SURFACES) {
  test(`${surface}: footer Input ${surface === 'mobile' ? 'is absent and every Button stays' : 'is drawn beside the Buttons'}`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: FULL, task: demo() }, surface, undefined, { epic: 'tA' })
    const ui = await pane($, surface)
    expect((await ui.find({ key: 'keys' })) !== undefined).toBe(surface !== 'mobile')
    expect((await ui.findAll({ type: 'Input' })).length).toBe(surface === 'mobile' ? 0 : 1)
    const keys = (await ui.findAll({ type: 'Button' })).map(b => String(b.props.key))
    for (const k of ['floor', 'stories', 'decisions', 'log', 'report', 'prev', 'next', 'close']) expect(keys).toContain(k)
  })
}

// ---- pane fallback: the newest running task of this cwd ----
test('pane fallback: empty watch shows the cwd task from the status', async ($, on) => {
  const w = await tickWorld($, on, {}, true)
  await w.tick()
  expect(await shown(await pane($, 'terminal'))).toContain('Build the expense tracker')
})

test('pane fallback: a task id with no summary yet draws Loading (regression guard)', async ($, on) => {
  uiWorld(on, { watch: ['abc'], status: stat() })
  expect(await shown(await pane($, 'terminal'))).toContain('Loading...')
})

// ---- layout: what shrinks and what never gets cut ----
const LONG = 'x'.repeat(200)

test('band: a 200-char title truncates; progress and the board button are separate, non-truncating nodes', async ($, on) => {
  await seeded($, on, { status: stat(), task: demo({ title: LONG }) })
  const ui = await band($, 'terminal')
  const title = await ui.find({ type: 'Text', text: LONG })
  const progress = await ui.find({ type: 'Text', text: '4/5' })
  expect(title).toBeDefined()
  expect(progress).toBeDefined()
  expect(title!.props.wrap).toBe('truncate-end')
  expect(progress!.props.wrap).toBeUndefined()
  expect(String(progress!.text)).not.toContain('xxx')
  expect(String(title!.text)).not.toContain('4/5')
  expect(await labels(ui)).toContain('board')
})

test('pane header (a task the EPIC list lacks): title truncates; "running · done/total" is its own non-truncating node', async ($, on) => {
  await seeded($, on, { status: stat(), task: demo({ title: LONG }) })
  const ui = await pane($, 'terminal')
  const title = await ui.find({ type: 'Text', text: LONG })
  const head = await ui.find({ type: 'Text', text: 'running · 4/5' })
  expect(title).toBeDefined()
  expect(title!.props.wrap).toBe('truncate-end')
  expect(head).toBeDefined()
  expect(head!.props.wrap).toBeUndefined()
})

test('Summary stage rail: a dot per stage, the running one bold, solid rail up to it and dotted after', async ($, on) => {
  await seeded($, on, { status: stat(), task: demo() })
  const ui = await pane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: '● Plan' })).toBeUndefined() // the Floor has no rail
  await ui.press({ key: 'stories' })
  await ui.redraw()
  const text = await shown(ui)
  expect(await ui.find({ type: 'Text', text: '● Plan' })).toBeDefined()
  const running = (await ui.findAll({ type: 'Text', text: /^◉ / }))
  expect(running).toHaveLength(1)
  expect(running[0]!.props.bold).toBe(true)
  expect(text).toContain(' ━━ ')
  expect(text).toContain(' ┄┄ ')
  expect(text.lastIndexOf(' ━━ ')).toBeLessThan(text.indexOf(' ┄┄ '))
})

test('Summary Work: one Text per card, capped with "+N more"', async ($, on) => {
  const many = Array.from({ length: 8 }, (_, i) => card(`card ${i}`, 'package', 'done'))
  await seeded($, on, { status: stat(), task: demo({ work: many }) })
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'decisions' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: '✔ card 0' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✔ card 5' })).toBeDefined()
  expect(await ui.find({ text: 'card 6' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '+2 more' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /card 0.*card 1/ })).toBeUndefined()
})

// (the Now sentence left the pane; the band says it)
test('now: a card not yet started reads "Waiting to fix defect"', async ($, on) => {
  await seeded($, on, { status: stat(), task: demo({ now: { kind: 'fixnext', subject: 'b.txt', detail: null } }) })
  expect(await shown(await band($, 'terminal'))).toContain('Waiting to fix defect: b.txt')
})

test('now: Korean "fixnext" has no English', async ($, on) => {
  await seeded($, on, { status: stat(), task: demo({ now: { kind: 'fixnext', subject: 'b.txt', detail: null } }) }, 'terminal', 'korean')
  const text = await shown(await band($, 'terminal'))
  expect(text).toContain('결함 수정 대기')
  expect(text).not.toContain('Waiting')
})

test('/teams-status: Korean reply and description have no English, no teams prefix, no status-line claim', async ($, on) => {
  uiWorld(on)
  on('ui.panes', () => ({ value: [] }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('settings.read', () => ({ value: { language: 'korean' } }) as never)
  let description = ''
  on('command.register', (_$, e) => {
    description = String((e as unknown as { description?: string }).description)
    return { value: { command: e.name } }
  })
  await start($)
  const r = JSON.stringify(await $.command.run({ command: 'teams-status', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never))
  expect(r.replace(/"text"/, "")).not.toMatch(/[A-Za-z]{4}/)
  expect(description).not.toMatch(/[A-Za-z]{4}/)
})

test('/teams-status: English reply has no teams prefix and no status-line claim', async ($, on) => {
  const seen = uiWorld(on)
  startWorld(on)
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  const r = JSON.stringify(await $.command.run({ command: 'teams-status', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never))
  expect(seen.opened).toEqual(['teams-status'])
  expect(r).not.toContain('teams-status')
  expect(r).not.toContain('status line')
})

// ---- Report tab ----
const REPORT_TEXT = '# Report\n\nAll packages shipped.\n'
const payload = (over: Record<string, unknown> = {}) => ({
  task_id: 'abc', verdict: 'finished', failed: 2,
  needs: { items: ['module b: tests red', 'module c: never dispatched', 'D1 b.txt never wired'], more: 2 },
  path: '/proj/.teams_output/team/E-abc/80-report.md',
  report: { text: REPORT_TEXT, truncated: false, more_lines: 0, mtime: 5 },
  retro: null,
  ...over,
})
const reportArgv = (seen: { argv: (readonly string[])[] }) => seen.argv.filter(a => a.includes('report'))
const taskOf = (argv: readonly string[]) => argv[argv.indexOf('--task') + 1]

for (const surface of SURFACES) {
  test(`${surface}: pressing Report fetches once and draws the report verbatim; a second tick keeps it`, async ($, on) => {
    const { seen, tick } = await seeded($, on, { status: stat(), task: demo(), reports: { abc: payload() } }, surface)
    expect(reportArgv(seen)).toHaveLength(0)
    const ui = await pane($, surface)
    expect((await ui.find({ key: 'report' }))?.props).toMatchObject({ plain: true, label: 'Report' })
    await ui.press({ key: 'report' })
    await ui.redraw()
    expect(reportArgv(seen)).toHaveLength(1)
    expect(reportArgv(seen)[0]!.join(' ')).toContain('--format report --task abc')
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe(REPORT_TEXT)
    await tick()
    await ui.redraw()
    expect(reportArgv(seen).length).toBe(2)
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe(REPORT_TEXT)
  })

  test(`${surface}: with the Report tab closed no report call is made`, async ($, on) => {
    const { seen, tick } = await seeded($, on, { status: stat(), task: demo(), reports: { abc: payload() } }, surface)
    await tick()
    await tick()
    expect(reportArgv(seen)).toHaveLength(0)
  })

  test(`${surface}: report null draws the missing line with the path`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo(), reports: { abc: payload({ report: null }) } }, surface)
    const ui = await pane($, surface)
    await ui.press({ key: 'report' })
    await ui.redraw()
    expect(await shown(ui)).toContain('No report yet: /proj/.teams_output/team/E-abc/80-report.md')
  })

  test(`${surface}: a >20k report draws the path then the truncated notice before the text`, async ($, on) => {
    const big = { text: 'line\n'.repeat(3900), truncated: true, more_lines: 1234, mtime: 5 }
    await seeded($, on, { status: stat(), task: demo(), reports: { abc: payload({ report: big }) } }, surface)
    const ui = await pane($, surface)
    await ui.press({ key: 'report' })
    await ui.redraw()
    const text = await shown(ui)
    const path = text.indexOf('80-report.md')
    const notice = text.indexOf('1234 more lines')
    const body = text.indexOf('line\\nline')
    expect(path > 0 && notice > path && body > notice).toBe(true)
    expect(big.text.length <= 20000).toBe(true)
  })
}

test('Report tab: Korean tab label and missing line', async ($, on) => {
  await seeded($, on, { status: stat(), task: demo(), reports: { abc: payload({ report: null }) } }, 'terminal', 'korean')
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'report' })
  await ui.redraw()
  const text = await shown(ui)
  expect(text).toContain('보고서')
  expect(text).toContain('아직 보고서가 없습니다')
})

// ---- end-of-run card ----
const END = (task_id: string, ts = 1500) => ({ ts, task_id, kind: 'daemon_done', text: `${task_id} finished: done` })
const T_PAYLOAD = (over: Record<string, unknown> = {}) => payload({ task_id: 'tee', path: '/proj/.teams_output/team/E-tee/80-report.md', report: { text: '# T report\n', truncated: false, more_lines: 0, mtime: 7 }, ...over })
const BLOCKED = (over: Record<string, unknown> = {}) => T_PAYLOAD({ verdict: 'blocked', failed: 1, needs: { items: ['tm_retry P1', 'decide the split'], more: 0 }, ...over })
const find = async (ui: Ui, key: string) => ui.find({ key })

for (const surface of SURFACES) {
  test(`${surface}: daemon_done: one report call for T, a card, the toast kept; [report] follows T through the open tab`, async ($, on) => {
    const data = { status: stat(), task: demo(), events: [END('tee')], reports: { abc: payload({ path: '/proj/E-abc/80-report.md', report: { text: 'U report', truncated: false, more_lines: 0, mtime: 1 } }), tee: T_PAYLOAD() } }
    const { seen, tick } = await seeded($, on, data, surface)
    expect(reportArgv(seen).map(taskOf)).toEqual(['tee'])
    expect(seen.store.get('cardReport')).toMatchObject({ task_id: 'tee' })
    expect(seen.store.get('ended')).toEqual({ tee: 'card' })
    const b = await band($, surface)
    const text = await shown(b)
    for (const word of ['finished', 'failed 2', 'module b: tests red', 'module c: never dispatched', 'D1 b.txt never wired', '+2 more']) expect(text).toContain(word)
    expect(await labels(b)).toEqual(['report', '×'])
    expect(await b.find({ text: 'engine band' })).toBeDefined()
    await b.press({ key: 'report' })
    expect(seen.opened).toEqual(['teams-status'])
    expect(seen.store.get('view')).toBe('report')
    expect(seen.store.get('watch')).toEqual(['abc', 'tee'])
    expect(seen.store.get('ended')).toEqual({ tee: 'seen' })
    expect(await find(await band($, surface), 'report')).toBeUndefined()
    await tick()
    await tick()
    const argvs = reportArgv(seen)
    expect(argvs.length).toBe(3)
    expect(argvs.map(taskOf)).toEqual(['tee', 'tee', 'tee'])
    const ui = await pane($, surface)
    const drawn = await shown(ui)
    expect(drawn).toContain('E-tee/80-report.md')
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('# T report\n')
    expect(drawn).not.toContain('U report')
  })

  test(`${surface}: no card and the pane on U: the Report tab by key fetches U`, async ($, on) => {
    const { seen } = await seeded($, on, { status: stat(), task: demo(), reports: { abc: payload({ report: null }) } }, surface)
    const ui = await pane($, surface)
    await ui.press({ key: 'report' })
    await ui.redraw()
    expect(reportArgv(seen).map(taskOf)).toEqual(['abc'])
    expect(await shown(ui)).toContain('No report yet: /proj/.teams_output/team/E-abc/80-report.md')
  })

  test(`${surface}: blocked wording and items; dismiss removes the card with no open`, async ($, on) => {
    const { seen } = await seeded($, on, { status: stat(), task: demo(), events: [END('tee')], reports: { tee: BLOCKED() } }, surface)
    const b = await band($, surface)
    const text = await shown(b)
    for (const word of ['blocked', 'failed 1', 'tm_retry P1', 'decide the split']) expect(text).toContain(word)
    expect(text).not.toContain('+0')
    await b.press({ key: 'dismiss' })
    expect(seen.opened).toEqual([])
    expect(seen.store.get('ended')).toEqual({ tee: 'dismissed' })
    expect(await find(await band($, surface), 'dismiss')).toBeUndefined()
    expect(seen.statuses.every(x => x === undefined)).toBe(true)
  })

  test(`${surface}: blocked and no report yet: card without a button, refetched until the file exists`, async ($, on) => {
    const data = { status: stat(), task: demo(), events: [END('tee')], reports: { tee: BLOCKED({ report: null }) } as Record<string, unknown> }
    const { seen, tick } = await seeded($, on, data, surface)
    expect(await labels(await band($, surface))).toEqual(['×'])
    await tick()
    expect(reportArgv(seen).map(taskOf)).toEqual(['tee', 'tee'])
    data.reports.tee = BLOCKED()
    await tick()
    expect(await labels(await band($, surface))).toEqual(['report', '×'])
    await tick()
    expect(reportArgv(seen)).toHaveLength(3) // the file is there: no more calls
  })

  test(`${surface}: a failing report call leaves the card as it was`, async ($, on) => {
    const data = { status: stat(), task: demo(), events: [END('tee')], reports: { tee: BLOCKED({ report: null }) }, failReport: false }
    const { tick } = await seeded($, on, data, surface)
    data.failReport = true
    await tick()
    const b = await band($, surface)
    expect(await shown(b)).toContain('blocked')
    expect(await labels(b)).toEqual(['×'])
  })

  test(`${surface}: a task that ended before session.start gets no card and no report call`, async ($, on) => {
    const { seen } = await seeded($, on, { status: stat(), task: demo(), events: [END('tee', 900)], reports: { tee: T_PAYLOAD() } }, surface)
    expect(seen.store.get('ended')).toBeUndefined()
    expect(reportArgv(seen)).toHaveLength(0)
    expect(await find(await band($, surface), 'dismiss')).toBeUndefined()
  })

  test(`${surface}: opening the Report tab on T by key marks the card seen`, async ($, on) => {
    const { seen } = await seeded($, on, { status: stat(), task: demo(), events: [END('abc')], reports: { abc: T_PAYLOAD({ task_id: 'abc' }) } }, surface)
    expect(seen.store.get('ended')).toEqual({ abc: 'card' })
    const ui = await pane($, surface)
    await ui.press({ key: 'report' })
    expect(seen.store.get('ended')).toEqual({ abc: 'seen' })
    expect(await find(await band($, surface), 'dismiss')).toBeUndefined()
  })

  test(`${surface}: language korean draws the card in Korean`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo(), events: [END('tee')], reports: { tee: T_PAYLOAD() } }, surface, 'korean')
    const b = await band($, surface)
    const text = await shown(b)
    for (const word of ['끝남', '실패 2', '+2건 더']) expect(text).toContain(word)
    expect(await labels(b)).toEqual(['보고서', '×'])
    for (const word of ['finished', 'failed', 'more']) expect(text).not.toContain(word)
  })

  test(`${surface}: a 30k report opened from the card: path, then the truncated notice, then the text`, async ($, on) => {
    const big = { text: 'line\n'.repeat(3900), truncated: true, more_lines: 900, mtime: 5 }
    const { seen } = await seeded($, on, { status: stat(), task: demo(), events: [END('tee')], reports: { tee: T_PAYLOAD({ report: big }) } }, surface)
    await (await band($, surface)).press({ key: 'report' })
    const ui = await pane($, surface)
    const kids = (await ui.drawn()) as unknown as { children?: unknown[] }
    const text = JSON.stringify(kids)
    const path = text.indexOf('E-tee/80-report.md')
    const notice = text.indexOf('900 more lines')
    const body = text.indexOf('line\\nline')
    expect(path > 0 && notice > path && body > notice).toBe(true)
    expect(seen.store.get('view')).toBe('report')
  })
}

for (const surface of SURFACES) {
  test(`${surface}: Report tab open on U, T ends: T's card shows and stays; the tab keeps drawing U`, async ($, on) => {
    const reports = { abc: payload({ report: { text: 'U report', truncated: false, more_lines: 0, mtime: 1 } }), tee: T_PAYLOAD() }
    const { seen, tick } = await seeded($, on, { status: stat(), task: demo(), events: [END('tee')], reports }, surface, undefined, { view: 'report' })
    await tick()
    await tick()
    const b = await band($, surface)
    expect(await shown(b)).toContain('finished')
    expect(await labels(b)).toEqual(['report', '×'])
    expect(seen.store.get('ended')).toEqual({ tee: 'card' })
    const ui = await pane($, surface)
    expect(await shown(ui)).toContain('E-abc/80-report.md')
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('U report')
    expect(await shown(ui)).not.toContain('E-tee')
  })
}

// push on a reject, a person who must act, and the end of a run (design 2026-10-12-mod-run-push)
function pushWorld(on: On, push: (e: any) => unknown, events: string) {
  const pushes: any[] = []
  const seen = world(on, ['terminal'], argv => (isEvents(argv) ? ok(events) : ok('{"line":"","waiting":0}')))
  // a Map-backed $.state; the run outcome writes (for trophy) are kept apart
  const store = new Map<string, unknown>()
  const outcomes: any[] = []
  const flags = { failSet: false }
  on('state.get', (_$, e) => ({ value: { value: store.get(e.key), version: 0 } }) as never)
  on('state.set', (_$, e) => {
    if (e.plugin === 'teams' && e.key === 'outcome') {
      if (flags.failSet) throw new Error('state is down')
      outcomes.push(e.value)
    }
    store.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } } as never
  })
  on('tool.call', (_$, e: any) => {
    pushes.push(e)
    return push(e) as never
  })
  return { pushes, seen, outcomes, flags }
}
const sentOk = () => ({ result: { pushSent: true, localSent: false }, text: '' })
const evLines = (...o: object[]) => o.map(x => JSON.stringify(x)).join('\n') + '\n'
const R1 = { ts: 1500, task_id: 'E-aaaaaaaa1', kind: 'node_finish', text: 'E-aaaaaaaa P1-gate failed' }
const R3 = { ts: 1700, task_id: 'E-aaaaaaaa1', kind: 'node_finish', text: 'E-aaaaaaaa gate:P1:2 failed (attempt 2)', package: 'P1', attempt: 2 }
const R2 = { ts: 1600, task_id: 'E-aaaaaaaa1', kind: 'upstream_fix_rounds_exhausted', text: 'E-aaaaaaaa P1: fix rounds used up' }

test('push: reject, needs-you and run-ended each push once with the task, kind and what', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { pushes, seen } = pushWorld(on, sentOk, evLines(R1, R2, E1, E2))
  await start($)
  await clock.advance(3000)
  await clock.advance(3000)
  expect(pushes.map(p => [p.tool, p.status])).toEqual(Array(4).fill(['PushNotification', 'proactive']))
  expect(pushes.map(p => p.message)).toEqual([
    'teams E-aaaaaaaa: rejected — P1-gate failed',
    'teams E-aaaaaaaa: rejected — P1: fix rounds used up',
    'teams E-aaaaaaaa: needs you — needs you: n1',
    'teams E-aaaaaaaa: run ended — finished: done',
  ])
  expect(seen.toasts).toHaveLength(4)
})

test('push: a retried package reject carries its attempt, and each attempt pushes once', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { pushes } = pushWorld(on, sentOk, evLines(R1, R3))
  await start($)
  await clock.advance(3000)
  await clock.advance(3000)
  expect(pushes.map(p => p.message)).toEqual([
    'teams E-aaaaaaaa: rejected — P1-gate failed',
    'teams E-aaaaaaaa: rejected — gate:P1:2 failed (attempt 2)',
  ])
})

test('push: an event before the session start is not pushed', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { pushes, seen } = pushWorld(on, sentOk, evLines({ ...R1, ts: 900 }))
  await start($)
  await clock.advance(3000)
  expect(pushes).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('push: a silent kind is not pushed; a seen event is not pushed twice', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { pushes } = pushWorld(on, sentOk, evLines({ ts: 1500, task_id: 'E-aaaaaaaa1', kind: 'child_driver_capacity', text: 'E-aaaaaaaa paused: provider limit' }, R1))
  await start($)
  await clock.advance(3000)
  await clock.advance(3000)
  await clock.advance(3000)
  expect(pushes.map(p => p.message)).toEqual(['teams E-aaaaaaaa: rejected — P1-gate failed'])
})

test('push not sent: the event toast already shows it, once', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { pushes, seen } = pushWorld(on, () => ({ result: { pushSent: false, localSent: false }, text: '' }), evLines(R1))
  await start($)
  await clock.advance(3000)
  expect(pushes).toHaveLength(1)
  expect(seen.toasts).toEqual([R1.text])
})

test('push throws: no throw, the event toast shows, the next event still pushes', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { pushes, seen } = pushWorld(on, () => { throw new Error('no transport') }, evLines(R1, R2))
  await start($)
  await clock.advance(3000)
  expect(pushes).toHaveLength(2)
  expect(seen.toasts).toEqual([R1.text, R2.text])
})

// the run outcome teams publishes for trophy: mapped from the daemon_done state field, never from the text
const done = (state: string | undefined, ts = 1500, task = 'E-aaaaaaaa1') => ({ ts, task_id: task, kind: 'daemon_done', text: `E-aaaaaaaa finished: ${state}`, ...(state === undefined ? {} : { state }) })
const exhausted = { ts: 1500, task_id: 'E-aaaaaaaa1', kind: 'daemon_exhausted', text: 'E-aaaaaaaa stopped: daemon restarts used up' }

test('outcome: daemon_done complete publishes pass, partial reject, blocked fail', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { outcomes } = pushWorld(on, sentOk, evLines(done('complete', 1500, 'E-t1'), done('partial', 1600, 'E-t2'), done('blocked', 1700, 'E-t3')))
  await start($)
  await clock.advance(3000)
  expect(outcomes.map(o => o.outcome)).toEqual(['pass', 'reject', 'fail'])
  for (const o of outcomes) {
    expect(Object.keys(o).sort()).toEqual(['at', 'outcome', 'system'])
    expect(o.system).toBe('teams')
  }
})

test('outcome: daemon_exhausted publishes fail', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { outcomes } = pushWorld(on, sentOk, evLines(exhausted))
  await start($)
  await clock.advance(3000)
  expect(outcomes.map(o => o.outcome)).toEqual(['fail'])
})

test('outcome: an unknown state, a missing state and a non-run event publish nothing', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { outcomes } = pushWorld(on, sentOk, evLines(done('unfinished', 1500, 'E-t1'), done(undefined, 1600, 'E-t2'), R1, E1))
  await start($)
  await clock.advance(3000)
  expect(outcomes).toEqual([])
})

test('outcome: a repeated event publishes once', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { outcomes } = pushWorld(on, sentOk, evLines(done('complete')))
  await start($)
  await clock.advance(3000)
  await clock.advance(3000)
  await clock.advance(3000)
  expect(outcomes).toHaveLength(1)
})

test('outcome: an event before the session start publishes nothing', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { outcomes } = pushWorld(on, sentOk, evLines(done('complete', 900)))
  await start($)
  await clock.advance(3000)
  expect(outcomes).toEqual([])
})

test('outcome: a failing state write never breaks the push', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { pushes, outcomes, flags } = pushWorld(on, sentOk, evLines(done('complete')))
  flags.failSet = true
  await start($)
  await clock.advance(3000)
  expect(outcomes).toEqual([])
  expect(pushes.map(p => p.message)).toEqual(['teams E-aaaaaaaa: run ended — finished: complete'])
})

// a failed node_finish carries run, node, reason, next_step and severity; the mod renders them, never the text
const FAIL = (o: object = {}) => ({
  ts: 1500, task_id: 'E-aaaaaaaa1', kind: 'node_finish', text: 'E-aaaaaaaa critique:2 failed (attempt 2): shape too wide → retrying as shape:3',
  run: 'E-aaaaaaaa', node: 'critique:2', attempt: 2, reason: 'shape too wide', next_step: 'retrying as shape:3', severity: 'info', ...o,
})
const GAVE_UP = FAIL({ ts: 1600, node: 'accept:P1:3', reason: 'gap: no test', next_step: 'gave up', severity: 'failure' })
const NEEDS_YOU = FAIL({ ts: 1700, node: 'plan:1', reason: 'which db?', next_step: 'needs you', severity: 'failure' })

test('failure line, info: a ↻ toast with the default timeout, and no push', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { pushes, seen } = pushWorld(on, sentOk, evLines(FAIL()))
  await start($)
  await clock.advance(3000)
  expect(seen.toasts).toEqual(['↻ E-aaaaaaaa critique:2 failed: shape too wide → retrying as shape:3'])
  expect(seen.toastEvents[0].timeoutMs).toBeUndefined()
  expect(pushes).toEqual([])
})

test('failure line, gave up and needs you: ✗ and ⚠ toasts with a 10 s timeout, each pushed once with reason and next step', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { pushes, seen } = pushWorld(on, sentOk, evLines(GAVE_UP, NEEDS_YOU))
  await start($)
  await clock.advance(3000)
  await clock.advance(3000)
  expect(seen.toasts).toEqual(['✗ E-aaaaaaaa accept:P1:3 failed: gap: no test → gave up', '⚠ E-aaaaaaaa plan:1 failed: which db? → needs you'])
  expect(seen.toastEvents.map(t => t.timeoutMs)).toEqual([10000, 10000])
  expect(pushes.map(p => p.message)).toEqual([
    'teams E-aaaaaaaa: rejected — accept:P1:3 failed: gap: no test → gave up',
    'teams E-aaaaaaaa: rejected — plan:1 failed: which db? → needs you',
  ])
})

test('failure line, no next step: a ↻ toast without the arrow, no push', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { pushes, seen } = pushWorld(on, sentOk, evLines(FAIL({ next_step: null })))
  await start($)
  await clock.advance(3000)
  expect(seen.toasts).toEqual(['↻ E-aaaaaaaa critique:2 failed: shape too wide'])
  expect(pushes).toEqual([])
})

test('failure line: the push is cut at 200 characters, ending in …', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { pushes } = pushWorld(on, sentOk, evLines({ ...GAVE_UP, reason: 'x'.repeat(120) + ' ' + 'y'.repeat(100) }))
  await start($)
  await clock.advance(3000)
  expect(pushes).toHaveLength(1)
  expect(pushes[0].message).toHaveLength(200)
  expect(pushes[0].message.endsWith('…')).toBe(true)
})

test('failure line, ko: the word failed is Korean in the toast and the push', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  on('settings.read', () => ({ value: { language: 'korean' } }) as never)
  const { pushes, seen } = pushWorld(on, sentOk, evLines(GAVE_UP))
  await start($)
  await clock.advance(3000)
  expect(seen.toasts).toEqual(['✗ E-aaaaaaaa accept:P1:3 ' + STRINGS.ko.nodeFailed + ': gap: no test → gave up'])
  expect(pushes[0].message).toContain(STRINGS.ko.nodeFailed)
})

test('a line with severity but no run, node or reason toasts its text as before, and no tick throws', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const torn = { ts: 1500, task_id: 'E-aaaaaaaa1', kind: 'node_finish', text: 'E-aaaaaaaa n1 failed', severity: 'failure', next_step: 7, reason: {} }
  const { seen } = pushWorld(on, sentOk, evLines(torn) + '{"ts":16')
  await start($)
  await clock.advance(3000)
  expect(seen.toasts).toEqual(['E-aaaaaaaa n1 failed'])
  expect(seen.toastEvents[0].timeoutMs).toBeUndefined()
})

// ---- F4: listed EPICs, the STORYs tab, [ ] and g, the flag ----
// MARKS-BEGIN mirror of markOf (teams/scripts/lib/view-floor.mjs); teams/scripts/test-view-floor.mjs checks it
const MARKS: Record<string, { icon: string; word: string | null }> = {"acting":{"icon":"●","word":null},"you":{"icon":"⚑","word":null},"idle":{"icon":"◌","word":"idle"},"done":{"icon":"✔","word":"done"},"stalled":{"icon":"⊘","word":"stalled"},"failed":{"icon":"✘","word":"failed"}}
// MARKS-END
const markOf = (state: string, doing: string) => { const m = MARKS[state]!; return { icon: m.icon, word: m.word ?? doing, word_key: m.word === null ? '' : state } }
const story = (key: string, title: string, over: Record<string, unknown> = {}) => {
  const base = { state: 'acting', doing: '', ...over } as { state: string; doing: string }
  return {
    key, title, last_verdict: null, cost_usd: null, cost_estimated: false, try: null, max: null,
    live: true, elapsed_ms: null, run_file: null, owner_key: key, ...over, ...markOf(base.state, base.doing),
    // a STORY item's status is one fixed word for every state (view-floor.mjs itemMarkOf); `doing` stays a field
    word_key: base.state, word: base.state === 'acting' ? 'working' : base.state === 'you' ? 'needs you' : base.state,
  }
}
const epicOf = (id: string, key: string, items: unknown[], over: Record<string, unknown> = {}) => ({
  ...demo({ key, title: `task ${id}` }), task_id: id, slug: null, created_at: 500, live: true, age_ms: null, items, workers: [], handoffs: [], harness: null, ...over,
})
const FULL = [
  epicOf('tA', 'E-3a3a3bb5', [
    story('E-3a3a3bb5/P1', 'module b', { doing: 'editing a.ts', last_verdict: 'reject', try: 2, max: 3, elapsed_ms: 240000, cost_usd: 0.42, cost_estimated: true, run_file: '/w/runs/p1.json' }),
    story('E-3a3a3bb5/P2', 'a much longer module title for the cut', { state: 'idle', elapsed_ms: 3720000 }),
  ]),
  epicOf('tB', 'E-bbbbbbbb', [
    story('E-bbbbbbbb', 'small thing', { doing: 'reading', elapsed_ms: 35000, cost_usd: 1.5, owner_key: 'E-bbbbbbbb' }),
  ], { harness: { slug: 'run-7', moving: true }, stages: [stage('plan', 'done'), stage('build', 'running')] }),
  epicOf('tC', 'E-cccccccc', [], { live: false, age_ms: 7200000, state: 'stalled' }),
]
const textsOf = async (ui: Ui, re: RegExp) => (await ui.findAll({ type: 'Text', text: re })).map(t => String(t.text))
// a line of the EPIC list, the picked one, and a STORY row, as the whole line (the outer Text, not its pieces)
const EPIC_LINE = /^[▸ ] +[●◌⚑⊘] +E-[0-9a-f]{8} /
const PICKED = /^▸ +[●◌⚑⊘] +E-[0-9a-f]{8} /
const rowTexts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => String(t.text)).filter(t => /^[▸ ] +[●◌⚑⊘✔✘]  \S/.test(t) && !EPIC_LINE.test(t))
const wide = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'teams', surface, component: 'Pane', requestId: 'teams-status', props: { title: 'Teams', isFocused: false, bodyColumns: 140, placement: 'dock' } } as never)

for (const surface of SURFACES) {
  test(`${surface}: story rows aligned`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: FULL, task: demo() }, surface, undefined, { epic: 'tA' })
    const ui = await wide($, surface)
    await ui.press({ key: 'stories' })
    await ui.redraw()
    const rows = await rowTexts(ui)
    expect(rows).toHaveLength(3)
    const [a, b, c] = rows as [string, string, string]
    // every fact on its row, `~` kept, a missing cost blank
    for (const part of ['module b', 'rejected', '2/3', '4m', '~$0.42']) expect(a).toContain(part)
    // one status word per row: the verdict wins over what the item is doing
    expect(a).not.toContain('editing a.ts')
    expect(b).toContain('idle')
    expect(b).toContain('1h 2m')
    expect(b).not.toContain('$')
    for (const part of ['small thing', 'working', '35s', '$1.50', 'run-7', '▸']) expect(c).toContain(part)
    expect(c).not.toContain('reading')
    // the same column starts at the same character on every row
    expect(a.indexOf('rejected')).toBe(b.indexOf('idle'))
    expect(a.indexOf('rejected')).toBe(c.indexOf('working'))
    expect(a.indexOf('4m')).toBe(b.indexOf('1h 2m'))
    expect(a.indexOf('4m')).toBe(c.indexOf('35s'))
    // the icon leads each row
    expect(a).toContain('●')
    expect(b).toContain('◌')
  })

  test(`${surface}: story rows end in … when the pane is narrow`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: FULL, task: demo() }, surface, undefined, { epic: 'tA' })
    const ui = await $.ui.mount({ plugin: 'teams', surface, component: 'Pane', requestId: 'teams-status', props: { title: 'Teams', isFocused: false, bodyColumns: 50, placement: 'dock' } } as never)
    await ui.press({ key: 'stories' })
    await ui.redraw()
    expect((await rowTexts(ui)).some(r => r.includes('…'))).toBe(true)
  })

  test(`${surface}: the header lists every EPIC, the picked one marked, stalled last and dim with its age`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: FULL, task: demo() }, surface, undefined, { epic: 'tA' })
    const ui = await pane($, surface)
    const lines = await textsOf(ui, EPIC_LINE)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('▸')
    expect(lines[1]).not.toContain('▸')
    expect(lines[2]).toContain('2h 0m')
    expect(lines[2]).toContain('⊘')
    expect(lines[0]).toContain('E-3a3a3bb5')
    expect(lines[1]).toContain('E-bbbbbbbb')
    expect(lines[2]).toContain('E-cccccccc')
  })

  test(`${surface}: the EPIC row is the title: key, title, state, done/total and age once, no header row, no day, no key in the tab row`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: FULL, task: demo() }, surface, undefined, { epic: 'tA' })
    const ui = await pane($, surface)
    const picked = (await textsOf(ui, PICKED))[0]!
    for (const part of ['E-3a3a3bb5', 'task tA', 'running', '4/5', '3s']) expect(picked).toContain(part)
    const text = await shown(ui)
    expect(text.match(/E-3a3a3bb5(?!\/)/g)).toHaveLength(1)
    expect(text).not.toContain('Build the expense tracker')
    expect(text).not.toMatch(/day \d/)
    expect(await ui.find({ type: 'Text', text: '$0.00 · 0 turns' })).toBeDefined()
    // the row has no slug column
    expect(picked).toMatch(/^▸ +● +E-3a3a3bb5 {2}task tA {2}/)
  })

  // the slug is not a pane column; the title takes the width and gives way first, at 190 and 110 columns
  for (const cols of [190, 110]) {
    test(`${surface}: the EPIC row has no slug and cuts the title first at ${cols}`, async ($, on) => {
      const long = 'Migrate every legacy report exporter to the new streaming writer and keep each output file identical across all supported locales'
      const tasks = [
        epicOf('tA', 'E-3a3a3bb5', [], { title: long, slug: 'report-exporters' }),
        epicOf('tB', 'E-bbbbbbbb', [], { title: 'short', slug: 'quick-fix' }),
        epicOf('tC', 'E-cccccccc', [], { title: 'older', slug: null }),
      ]
      await seeded($, on, { status: stat(), tasks, task: demo() }, surface, undefined, { epic: 'tA' })
      const ui = await $.ui.mount({ plugin: 'teams', surface, component: 'Pane', requestId: 'teams-status', props: { title: 'Teams', isFocused: false, bodyColumns: cols - 4, placement: 'dock' } } as never)
      const lines = await textsOf(ui, EPIC_LINE)
      expect(lines).toHaveLength(3)
      const [a, b, c] = lines as [string, string, string]
      expect(a).toMatch(/E-3a3a3bb5 {2}Migrate/)
      for (const l of lines) expect(l).not.toMatch(/report-exporters|quick-fix/)
      if (cols === 110) {
        expect(a).toContain('…')
        expect(a).not.toContain('identical across all supported locales')
      } else expect(a).toContain('identical across all supported locales')
      expect(b).toMatch(/E-bbbbbbbb {2}short/)
      // columns align across rows: every title starts at one offset, rows keep to the pane width
      expect(new Set([a.indexOf('Migrate'), b.indexOf('short'), c.indexOf('older')]).size).toBe(1)
      for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(cols - 4)
    })
  }

  test(`${surface}: bracket keys clamp at both ends`, async ($, on) => {
    const { tick } = await seeded($, on, { status: stat(), tasks: FULL, task: demo() }, surface, undefined, { epic: 'tA' })
    const ui = await pane($, surface)
    // no Input on mobile: the prev and next Buttons step there
    const key = async (text: string) => {
      if (carriesInput(surface)) await ui.input({ key: 'keys', text, kind: 'change' })
      else await ui.press({ key: text === ']' ? 'next' : 'prev' })
      await tick()
      await ui.redraw()
    }
    const picked = async () => (await textsOf(ui, PICKED))[0] ?? ''
    expect(await picked()).toContain('E-3a3a3bb5')
    await key('[') // first: stays on the first
    expect(await picked()).toContain('E-3a3a3bb5')
    await key(']')
    expect(await picked()).toContain('E-bbbbbbbb')
    await key(']')
    expect(await picked()).toContain('E-cccccccc')
    await key(']') // last: stays on the last
    expect(await picked()).toContain('E-cccccccc')
    await key('[')
    expect(await picked()).toContain('E-bbbbbbbb')
    // the prev and next Buttons do the same
    await ui.press({ key: 'next' })
    await ui.redraw()
    expect(await picked()).toContain('E-cccccccc')
    await ui.press({ key: 'prev' })
    await ui.redraw()
    expect(await picked()).toContain('E-bbbbbbbb')
  })

  test(`${surface}: selection falls back to nearest`, async ($, on) => {
    const data: Data = { status: stat(), tasks: FULL, task: demo() }
    const { tick } = await seeded($, on, data, surface, undefined, { epic: 'tB' })
    const ui = await pane($, surface)
    expect((await textsOf(ui, PICKED))[0]).toContain('E-bbbbbbbb')
    // the picked task leaves the list: the pane stays open and the selection moves to the nearest listed task
    data.tasks = [FULL[0]!, FULL[2]!]
    await tick()
    await ui.redraw()
    expect((await textsOf(ui, PICKED))[0]).toContain('E-cccccccc')
    // the last one leaves too: the nearest left is the first
    data.tasks = [FULL[0]!]
    await tick()
    await ui.redraw()
    expect((await textsOf(ui, PICKED))[0]).toContain('E-3a3a3bb5')
  })

  // `g` is an Input key: only on the surfaces that carry an Input
  if (carriesInput(surface)) test(`${surface}: g opens graph-status with run file`, async ($, on) => {
    const calls: { command: string; args: string }[] = []
    on('command.run', (_$, e) => {
      calls.push({ command: e.command, args: e.args })
      return { text: '' }
    })
    await seeded($, on, { status: stat(), tasks: FULL, task: demo() }, surface, undefined, { epic: 'tA' })
    const ui = await pane($, surface)
    await ui.press({ key: 'stories' })
    await ui.redraw()
    await ui.input({ key: 'keys', text: 'g', kind: 'change' })
    expect(calls.map(c => `${c.command} ${c.args}`)).toEqual(['graph-status open /w/runs/p1.json E-3a3a3bb5/P1'])
  })

  if (carriesInput(surface)) test(`${surface}: g without run file makes no call`, async ($, on) => {
    const calls: unknown[] = []
    on('command.run', (_$, e) => {
      calls.push(e)
      return { text: '' }
    })
    await seeded($, on, { status: stat(), tasks: FULL, task: demo() }, surface, undefined, { epic: 'tA' })
    const ui = await pane($, surface)
    await ui.press({ key: 'stories' })
    await ui.redraw()
    await ui.input({ key: 'keys', text: 'j', kind: 'change' }) // the second row has no run file
    await ui.redraw()
    expect((await ui.find({ type: 'Text', text: 'g open run' }))?.props.dimColor).toBe(true)
    await ui.input({ key: 'keys', text: 'g', kind: 'change' })
    expect(calls).toEqual([])
  })

  test(`${surface}: band leads with flag when waiting`, async ($, on) => {
    await seeded($, on, { status: stat({ waiting: 1, latest: null }), task: null }, surface)
    const ui = await band($, surface)
    const first = await ui.find({ type: 'Text' })
    expect(first?.text).toBe('⚑')
    expect(first?.props.color).toBe('warning')
  })

  test(`${surface}: band has no flag when nothing waits`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo() }, surface)
    expect(await shown(await band($, surface))).not.toContain('⚑')
  })

  test(`${surface}: waiting card shows question, writes nothing`, async ($, on) => {
    const { seen } = await seeded($, on, { status: stat({ waiting: 1 }), tasks: FULL, task: demo({ you: { count: 1, items: ['module b'], cards: [{ key: 'E-3a3a3bb5/P1', title: 'module b', question: 'keep the old API?' }] } }) }, surface, undefined, { epic: 'tA' })
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: /module b — keep the old API\?/ })).toBeDefined()
    // the mod only reads: no tm_submit, no write, only view.mjs runs
    expect(seen.argv.every(a => a[1]?.endsWith('/scripts/view.mjs'))).toBe(true)
  })
}

// ---- F4: the Floor: worker lines, hand-off feed, the 800 ms clock ----
const wk = (id: string, state: string, doing = '') => ({ id, state, doing, ...markOf(state, doing) })
const ho = (time: string, from: string, what: string, to: string) => ({ time, from, what, to })
const WORKERS = [wk('PLAN', 'done'), wk('P1', 'acting', 'editing a.ts'), wk('P2', 'idle'), wk('P3', 'you', 'asks a question'), wk('JUDGE', 'stalled')]
const floorOf = (workers: unknown[], handoffs: unknown[] = []) => [epicOf('tA', 'E-3a3a3bb5', [], { workers, handoffs })]
const WROW = /^[●◌⚑✔⊘]  ?[⠀-⣿]? ?\S/
const workerTexts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => String(t.text)).filter(t => /^[●◌⚑✔⊘] +(?:[⠀-⣿] +)?(?:PLAN|P\d|JUDGE)( |$)/.test(t))
const feedTexts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => String(t.text)).filter(t => /^\d\d:\d\d .*→/.test(t))
const frameOf = (store: Map<string, unknown>) => Number(store.get('frame') ?? 0)

for (const surface of SURFACES) {
  test(`${surface}: floor one line per worker`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: floorOf(WORKERS), task: demo() }, surface, undefined, { epic: 'tA' })
    const lines = await workerTexts(await wide($, surface))
    expect(lines).toHaveLength(5)
    for (const [i, id] of ['PLAN', 'P1', 'P2', 'P3', 'JUDGE'].entries()) expect(lines[i]).toContain(id)
    expect(lines[1]).toContain('editing a.ts')
    // the id starts at the same character on every line
    expect(new Set(lines.map(l => l.indexOf(/PLAN|P\d|JUDGE/.exec(l)![0]))).size).toBe(1)
  })

  test(`${surface}: floor idle worker says idle, dim, in the column of the other doing texts; a done one says done`, async ($, on) => {
    const workers = [wk('PLAN', 'done'), wk('P1', 'acting', 'editing a.ts'), wk('P2', 'idle'), wk('P3', 'you', 'asks a question'), wk('JUDGE', 'idle')]
    await seeded($, on, { status: stat(), tasks: floorOf(workers), task: demo() }, surface, undefined, { epic: 'tA' })
    const ui = await wide($, surface)
    const [plan, p1, p2, p3, judge] = await workerTexts(ui) as [string, string, string, string, string]
    for (const idle of [p2, judge]) {
      expect(idle.trimEnd().endsWith('idle')).toBe(true)
      expect(idle.indexOf('idle')).toBe(p1.indexOf('editing a.ts'))
      expect(idle.indexOf('idle')).toBe(p3.indexOf('asks a question'))
    }
    expect(plan.trimEnd().endsWith('done')).toBe(true)
    expect((await ui.findAll({ type: 'Text', text: /^idle\s*$/ })).map(t => t.props.dimColor)).toEqual([true, true])
  })

  test(`${surface}: floor idle word in Korean`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: floorOf([wk('P2', 'idle')]), task: demo() }, surface, 'korean', { epic: 'tA' })
    expect((await workerTexts(await wide($, surface)))[0]!.trimEnd().endsWith('유휴')).toBe(true)
  })

  test(`${surface}: the Floor holds worker and hand-off rows only; the rail is on STORYs, the cards on Decisions`, async ($, on) => {
    const you = { count: 1, items: ['module b'], cards: [{ key: 'E-3a3a3bb5/P1', title: 'module b', question: 'keep the old API?' }] }
    await seeded($, on, { status: stat({ waiting: 1 }), tasks: floorOf(WORKERS, [ho('10:01', 'PLAN', 'the plan', 'P1')]), task: demo({ you }), teams: TEAMS }, surface, undefined, { epic: 'tA' })
    const ui = await wide($, surface)
    for (const absent of [/^▶/, /^⚑ You/, /^[●◉] (Plan|Build)/, /━/, /^Planning$/, /^Develop$/]) expect(await ui.find({ type: 'Text', text: absent })).toBeUndefined()
    expect(await ui.find({ key: 'card:P1' })).toBeUndefined()
    expect(await workerTexts(ui)).toHaveLength(5)
    expect(await feedTexts(ui)).toHaveLength(1)
    await ui.press({ key: 'stories' })
    await ui.redraw()
    expect(await ui.find({ type: 'Text', text: '● Plan' })).toBeDefined()
    await ui.press({ key: 'decisions' })
    await ui.redraw()
    expect(await ui.find({ key: 'card:P1' })).toBeDefined()
  })

  test(`${surface}: floor distinct icon per state`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: floorOf(WORKERS), task: demo() }, surface, undefined, { epic: 'tA' })
    const ui = await wide($, surface)
    const icons = (await workerTexts(ui)).map(l => l[0])
    expect(icons).toEqual(['✔', '●', '◌', '⚑', '⊘'])
    expect(new Set(icons).size).toBe(5)
    const text = await shown(ui)
    for (const face of ['😀', '(^', '☺', '^_^', '•_•']) expect(text).not.toContain(face)
  })

  test(`${surface}: spinner advances only while acting`, async ($, on) => {
    const data = { status: stat(), tasks: floorOf(WORKERS), task: demo() }
    const { seen, clock } = await seededClock($, on, data, surface)
    const ui = await wide($, surface)
    await clock.advance(800)
    const a = frameOf(seen.store)
    expect(a).toBeGreaterThan(0)
    await clock.advance(800)
    expect(frameOf(seen.store)).toBe(a + 1)
    await ui.redraw()
    expect((await workerTexts(ui))[1]).toMatch(/^● +[⠀-⣿] +P1/)
    expect((await workerTexts(ui))[2]).not.toMatch(/[⠀-⣿]/)
    // nobody acts: the next tick leaves the clock to cancel itself
    data.tasks = floorOf([wk('P1', 'idle'), wk('P2', 'done')])
    await clock.advance(3000)
    await clock.advance(800)
    const b = frameOf(seen.store)
    await clock.advance(5000)
    expect(frameOf(seen.store)).toBe(b)
  })

  test(`${surface}: hand-off feed at most 5 aligned rows`, async ($, on) => {
    const feed = [
      ho('10:01', 'PLAN', 'the plan', 'P1'), ho('10:02', 'P1', 'a diff', 'JUDGE'), ho('10:03', 'JUDGE', 'a verdict', 'P1'),
      ho('10:04', 'P2', 'tests', 'JUDGE'), ho('10:05', 'PLAN', 'a rewrite', 'P3'), ho('10:06', 'P3', 'an answer', 'PLAN'), ho('10:07', 'P1', 'more', 'JUDGE'),
    ]
    await seeded($, on, { status: stat(), tasks: floorOf(WORKERS, feed), task: demo() }, surface, undefined, { epic: 'tA' })
    const rows = await feedTexts(await wide($, surface))
    expect(rows).toHaveLength(5)
    expect(rows[0]).toMatch(/^10:01 +PLAN +the plan +→ P1/)
    expect(new Set(rows.map(r => r.indexOf('→'))).size).toBe(1)
    expect(new Set(rows.map(r => r.indexOf(/PLAN|P\d|JUDGE/.exec(r)![0]))).size).toBe(1)
  })

  test(`${surface}: hand-off feed empty when none recorded`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: floorOf(WORKERS), task: demo() }, surface, undefined, { epic: 'tA' })
    expect(await feedTexts(await wide($, surface))).toEqual([])
  })
}

test('no spinner clock without surface or acting worker', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const seen = uiWorld(on, {}, [], { status: stat(), tasks: floorOf(WORKERS), task: demo() })
  startWorld(on)
  await start($)
  await clock.advance(10000)
  expect(seen.argv).toHaveLength(0)
  expect(frameOf(seen.store)).toBe(0)
})

test('no spinner clock without surface or acting worker: pane open, nobody acts', async ($, on) => {
  const { seen, clock } = await seededClock($, on, { status: stat(), tasks: floorOf([wk('P1', 'idle')]), task: demo() }, 'terminal')
  await clock.advance(5000)
  expect(frameOf(seen.store)).toBe(0)
})

// ---- F4: demo fixtures at 190 and 110 columns (minimal, full, parallel, narrow), fictional data ----
// Set SHOW to true to make the last test fail with every frame as its message (the runner prints nothing).
const SHOW = false
const WIDTHS = [190, 110] as const
const shownFrames: string[] = []
const LONGT = 'Migrate every legacy report exporter to the new streaming writer and keep each output file byte for byte identical across all supported locales, then retire the old exporters, their fixtures and every flag that still points at them'
const LONGD = 'translating the sample strings into twelve languages and re-running the full comparison suite twice, once per engine, before diffing the results line by line'
const wkd = (id: string, state: string, doing = '') => ({ id, state, doing, ...markOf(state, doing) })
// what an EPIC's Now line, card list and cost say; each differs from the STORY titles and the You line, and the cost is the STORYs' sum
const body = (usd: number, turns: number) => ({
  now: { kind: 'build', subject: 'the parser and the writer', detail: '' },
  work: [card('parser package', 'package', 'done'), card('writer package', 'package', 'pending')],
  cost: { usd, turns },
})
const DEMO: Record<string, { tasks: unknown[]; you?: unknown }> = {
  minimal: {
    tasks: [epicOf('tS', 'E-aaaaaaaa', [story('E-aaaaaaaa', 'rename the config key', { doing: 'editing config.ts', elapsed_ms: 35000, cost_usd: 0.12 })], {
      ...body(0.12, 3), harness: { slug: 'run-1', moving: true }, stages: [stage('plan', 'done'), stage('build', 'running')], workers: [wkd('PLAN', 'done'), wkd('BUILD', 'acting', 'editing config.ts')],
    })],
  },
  full: {
    tasks: [
      epicOf('tA', 'E-3a3a3bb5', [
        story('E-3a3a3bb5/P1', 'parser module', { doing: 'editing parser.ts', last_verdict: 'reject', try: 2, max: 3, elapsed_ms: 240000, cost_usd: 0.42, cost_estimated: true, run_file: '/w/runs/p1.json' }),
        story('E-3a3a3bb5/P2', 'report writer', { state: 'idle', elapsed_ms: 3720000, cost_usd: 1.5 }),
        story('E-3a3a3bb5/P3', 'cache layer', { doing: 'asks a question', state: 'you', elapsed_ms: 600000 }),
      ], {
        workers: [wkd('PLAN', 'done'), wkd('P1', 'acting', 'editing parser.ts'), wkd('P2', 'idle'), wkd('P3', 'you', 'asks a question'), wkd('JUDGE', 'idle')],
        handoffs: [ho('10:01', 'PLAN', 'the plan', 'P1'), ho('10:02', 'P1', 'a diff', 'JUDGE'), ho('10:03', 'JUDGE', 'a verdict', 'P1'), ho('10:04', 'P2', 'test results', 'JUDGE'), ho('10:05', 'P3', 'a question', 'you')],
        ...body(1.92, 14), slug: 'expense-tracker',
        you: { count: 1, items: ['one open question'], cards: [{ key: 'E-3a3a3bb5/P3', title: 'cache layer', question: 'keep the old cache key format?' }] },
      }),
      epicOf('tC', 'E-cccccccc', [story('E-cccccccc/P1', 'old import job', { state: 'stalled', live: false })], { live: false, age_ms: 7200000, state: 'stalled' }),
    ],
  },
  parallel: {
    tasks: [
      epicOf('tA', 'E-3a3a3bb5', [story('E-3a3a3bb5/P1', 'parser module', { doing: 'editing parser.ts', elapsed_ms: 240000, cost_usd: 0.42 })], { ...body(0.42, 6), workers: [wkd('PLAN', 'done'), wkd('P1', 'acting', 'editing parser.ts')] }),
      epicOf('tB', 'E-bbbbbbbb', [story('E-bbbbbbbb/P1', 'report writer', { doing: 'reading', elapsed_ms: 35000, cost_usd: 1.5 })], { ...body(1.5, 8), workers: [wkd('PLAN', 'done'), wkd('P1', 'acting', 'reading')] }),
    ],
  },
  narrow: {
    tasks: [epicOf('tN', 'E-dddddddd', [
      story('E-dddddddd/P1', LONGT, { doing: LONGD, last_verdict: 'reject', try: 2, max: 3, elapsed_ms: 240000, cost_usd: 0.42, cost_estimated: true }),
      story('E-dddddddd/P2', 'short title', { doing: 'reading', elapsed_ms: 35000, cost_usd: 1.5 }),
    ], { ...body(1.92, 14), title: LONGT, slug: 'exporter-rewrite', workers: [wkd('PLAN', 'done'), wkd('P1', 'acting', LONGD)], handoffs: [ho('10:01', 'PLAN', LONGD, 'P1')] })],
  },
}
const STOP = new Set(['the', 'and', 'for', 'then', 'with', 'its', 'each', 'one', 'per', 'all', 'any', 'not', 'you'])
const bodyOf = (lines: string[]) => lines.filter(l => l.startsWith('│')).map(l => l.slice(2, -2).trimEnd())

for (const variant of Object.keys(DEMO)) {
  for (const cols of WIDTHS) {
    test(`demo renders at 190 and 110: ${variant} at ${cols}`, async ($, on) => {
      const d = DEMO[variant]!
      const first = d.tasks[0] as { task_id: string }
      await seeded($, on, { status: stat({ waiting: variant === 'full' ? 1 : 0 }), tasks: d.tasks, task: first }, 'terminal', undefined, { epic: first.task_id }, true)
      const ui = await $.ui.mount({ plugin: 'teams', surface: 'terminal', component: 'Pane', requestId: 'teams-status', props: { title: 'Teams', isFocused: false, bodyColumns: cols - 4, placement: 'dock' } } as never)
      const rendered: Record<string, string[]> = {}
      rendered.floor = frame((await ui.drawn()) as any, 'Teams', cols)
      await ui.press({ key: 'stories' })
      await ui.redraw()
      rendered.stories = frame((await ui.drawn()) as any, 'Teams', cols)
      const bandUi = await $.ui.mount({ plugin: 'teams', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: cols } } as never)
      rendered.band = draw((await bandUi.drawn()) as any, cols)
      for (const [name, lines] of Object.entries(rendered)) {
        shownFrames.push(`### ${variant} · ${cols} · ${name}`, ...lines)
        const body = name === 'band' ? lines : bodyOf(lines)
        expect(body.length).toBeGreaterThan(0)
        for (const l of lines) {
          expect(cells(l)).toBeLessThanOrEqual(cols)
          expect(l).not.toContain('\uFFFD')
          expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(l)).toBe(false)
        }
        // no orphan …: none doubled, none alone in its cell (a line start or after a column gap)
        for (const l of body) {
          expect(l).not.toContain('……')
          expect(/(^|\s\s)…/.test(l)).toBe(false)
        }
        if (name === 'band') {
          for (const l of lines) for (const gone of ['engine band', 'board needs you']) expect(l).not.toContain(gone)
          continue
        }
        // a STORY row's icon and word agree: a still or ended state never carries a working word
        if (name === 'stories') {
          const PAIRS6: Record<string, string | null> = { '●': null, '⚑': null, '◌': 'idle', '✔': 'done', '⊘': 'stalled', '✘': 'failed' }
          const prows = body.filter(l => /^[▸ ] +\S  \S/.test(l) && !/^[▸ ] +\S +E-[0-9a-f]{8} /.test(l))
          for (const l of prows) {
            const icon = l.trim().replace(/^▸\s*/, '')[0]!
            const word = l.trim().replace(/^▸\s*/, '').split(/\s{2,}/)[2]
            expect(Object.keys(PAIRS6)).toContain(icon)
            if (PAIRS6[icon] === null) expect(['idle', 'done', 'stalled', 'failed']).not.toContain(word)
            else expect(word).toBe(PAIRS6[icon])
            // one status word per row: no second state (whole or cut, e.g. 'fai…') in any other cell
            const rest = l.trim().replace(/^▸\s*/, '').split(/\s{2,}/).filter((_, i) => i !== 2).join('  ')
            expect(/\b(rejected|accepted|failed|stalled|idle|done|fai…|sta…)(?=\s|$)/.test(rest)).toBe(false)
          }
          if (variant === 'full') for (const i of ['●', '◌', '⚑', '⊘']) expect(prows.map(l => l.trim().replace(/^▸\s*/, '')[0])).toContain(i)
          if (variant === 'full') expect(body.some(l => /◌.*idle/.test(l)) && body.some(l => /⊘.*stalled/.test(l))).toBe(true)
        }
        // `close` is said once, by the footer
        expect(body.filter(l => l.includes('close'))).toEqual([body[body.length - 1]])
        // the tab row is one line: all five labels sit on the same line
        const tabRows = body.filter(l => /Floor/.test(l) && /STORYs/.test(l) && /Decisions/.test(l) && /Log/.test(l) && /Report/.test(l))
        expect(tabRows).toHaveLength(1)
        expect(body.filter(l => /Decisions/.test(l))).toHaveLength(1)
        // columns start at one offset on every row
        const at = (rows: string[], re: RegExp) => new Set(rows.map(r => (re.exec(r) as RegExpExecArray).index))
        const wrows = body.filter(l => /^[●◌⚑✔⊘] +(?:[⠀-⣿] +)?(?:PLAN|BUILD|P\d|JUDGE)( |$)/.test(l))
        if (name === 'floor') expect(at(wrows, /PLAN|BUILD|P\d|JUDGE/).size).toBeLessThanOrEqual(1)
        const hrows = body.filter(l => /^\d\d:\d\d .*→/.test(l))
        if (hrows.length > 0) expect(at(hrows, /→/).size).toBe(1)
        const srows = body.filter(l => /^[▸ ] +[●◌⚑✔✘⊘]  \S/.test(l) && !EPIC_LINE.test(l))
        if (name === 'stories') {
          expect(srows.length).toBeGreaterThan(0)
          if (srows.length > 1) expect(at(srows, /[●◌⚑✔✘⊘]  /).size).toBe(1)
        }
      }
      // the narrow variant has long text: some line ends in …; the others have none that is not asked for
      if (variant === 'narrow') {
        expect(bodyOf(rendered.floor!).some(l => l.includes('…'))).toBe(true)
        expect(bodyOf(rendered.stories!).some(l => l.includes('…'))).toBe(true)
      }
      if (variant === 'full') {
        expect(rendered.band![0]).toContain('⚑')
        expect(rendered.band![0]).toContain('1 question for you')
      }
      // the title block shares no word with the Floor body, and the Floor body is worker and hand-off rows only
      const fb = bodyOf(rendered.floor!)
      const tabAt = fb.findIndex(l => /Floor/.test(l) && /STORYs/.test(l) && /Decisions/.test(l) && /Log/.test(l) && /Report/.test(l))
      const floorBody = fb.slice(tabAt + 1, -1)
      const wordsOf = (lines: string[]) => new Set(
        lines.flatMap(l => l.match(/\p{L}[\p{L}\p{N}.\-\/]*/gu) ?? []).map(w => w.toLowerCase().replace(/[.\-\/]+$/, '')).filter(w => w.length >= 3 && !STOP.has(w)),
      )
      const header = wordsOf(fb.slice(0, tabAt))
      expect([...wordsOf(floorBody)].filter(w => header.has(w))).toEqual([])
      for (const l of floorBody.filter(l => l.trim() !== '')) expect(l).toMatch(/^[●◌⚑✔⊘✘] +(?:[⠀-⣿] +)?\S|^\d\d:\d\d /)
    })
  }
}

// the side pane the host really gives: bodyColumns 78 (190-column terminal) and 46 (110): one tab row with all five
// names, the footer keeps `close` once, and anything cut ends in …
for (const bodyColumns of [78, 46]) {
  for (const variant of ['full', 'narrow']) {
    test(`side pane at ${bodyColumns} body columns: ${variant}: one tab row with five names, footer closes once, no line wider`, async ($, on) => {
      const d = DEMO[variant]!
      const first = d.tasks[0] as { task_id: string }
      await seeded($, on, { status: stat(), tasks: d.tasks, task: first }, 'terminal', undefined, { epic: first.task_id }, true)
      const ui = await $.ui.mount({ plugin: 'teams', surface: 'terminal', component: 'Pane', requestId: 'teams-status', props: { title: 'Teams', isFocused: false, bodyColumns, placement: 'dock' } } as never)
      for (const tab of ['floor', 'stories']) {
        if (tab === 'stories') {
          await ui.press({ key: 'stories' })
          await ui.redraw()
        }
        const lines = frame((await ui.drawn()) as any, 'Teams', bodyColumns + 4)
        const body = bodyOf(lines)
        for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(bodyColumns + 4)
        const tabRows = body.filter(l => /Floor/.test(l) && /STORYs/.test(l) && /Decisions/.test(l) && /Log/.test(l) && /Report/.test(l))
        expect(tabRows).toHaveLength(1)
        expect(body.filter(l => /Decisions/.test(l))).toHaveLength(1)
        const foot = body[body.length - 1]!
        expect(body.filter(l => l.includes('close'))).toEqual([foot])
        expect(foot.endsWith('q close')).toBe(true)
        expect(foot).not.toContain('q: q')
        if (bodyColumns === 46) {
          expect(tabRows[0]).not.toContain('turns') // the cost text gave way
          if (variant === 'full' && tab === 'floor') expect(foot).toContain('…') // several EPICs: prev/next take room, the key hint is cut and says so
        }
        for (const l of body) {
          expect(l).not.toContain('……')
          expect(/(^|\s\s)…/.test(l)).toBe(false)
        }
      }
    })
  }
}

// ---- widths by display cells: Korean and English rows in one pane ----
test('width counts display cells: Hangul 2, ASCII 1, marks and joiners 0', () => {
  expect(width('메모')).toBe(4)
  expect(width('abc')).toBe(3)
  expect(width('a메b')).toBe(4)
  expect(width('')).toBe(0)
  expect(width('é')).toBe(1)
  expect(padText('메모', 6)).toBe('메모  ')
  expect(padText('abc', 6)).toBe('abc   ')
  expect(padText('메모 앱', 3)).toBe('메모 앱')
})

test('clipText cuts by display cells, ends in …, never splits a glyph', () => {
  const ko = '메모 앱에 태그 검색 추가'
  for (let w = 1; w <= width(ko); w++) {
    const out = clipText(ko, w)
    expect(width(out)).toBeLessThanOrEqual(w)
    if (w < width(ko)) expect(out.endsWith('…')).toBe(true)
    expect(out).not.toContain('�')
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false)
    // what stays is a whole-glyph prefix of the original
    expect(ko.startsWith(out.slice(0, -1).trimEnd())).toBe(true)
  }
  expect(clipText(ko, 6)).toBe('메모…')
  expect(clipText(ko, 5)).toBe('메모…')
  expect(clipText(ko, 0)).toBe('')
  expect(clipText(ko, -3)).toBe('')
  expect(clipText('abc', 0)).toBe('')
  expect(clipText('abc', 3)).toBe('abc')
  expect(clipText(ko, width(ko))).toBe(ko)
})

test('columnWidths: no drop list keeps the old widths; a drop list sheds age first, then count, and never leaves a width-1 column', () => {
  const row = ['▸', '●', 'E-3a3a3bb5', 'Add CSV export to the reports page', 'running', '4/5', '3s']
  // no drop list: the title gives way down to its floor, as before
  expect(columnWidths([row], 50, 2, [3])).toEqual([1, 1, 10, 14, 7, 3, 2])
  expect(columnWidths([row], 40, 2, [3])).toEqual([1, 1, 10, 4, 7, 3, 2])
  expect(columnWidths([row], 100, 2, [3])).toEqual([1, 1, 10, 34, 7, 3, 2])
  // with [6, 5] and a title floor of 12: the age goes first, the count only when the title would still be under 12
  expect(columnWidths([row], 100, 2, [3], 4, [6, 5], 12)).toEqual([1, 1, 10, 34, 7, 3, 2])
  expect(columnWidths([row], 44, 2, [3], 4, [6, 5], 12)).toEqual([1, 1, 10, 12, 7, 3, 0])
  expect(columnWidths([row], 40, 2, [3], 4, [6, 5], 12)).toEqual([1, 1, 10, 13, 7, 0, 0])
  // a column cut to one cell would be a bare …: it becomes 0
  expect(columnWidths([['ab', 'abcdefgh']], 4, 1, [1], 1)).toEqual([2, 0])
  for (const total of [20, 24, 30, 36, 40, 44, 50]) {
    // columns 0 and 1 are one cell by nature; every other column is 0 or at least 2
    for (const w of columnWidths([row], total, 2, [3], 4, [6, 5], 12).slice(2)) expect(w).not.toBe(1)
  }
})

// one Korean-title task and one English-title task listed together; pane width 78 and 46 is the frame() cols argument
// (body = cols - 4, so inner 74 and 42; the pane is given bodyColumns = cols)
const KO_TITLE = '메모 앱에 태그 검색 추가'
const EN_TITLE = 'Add CSV export to the reports page'
for (const cols of [78, 46]) {
  const bodyColumns = cols
  test(`mixed Korean and English EPIC rows at pane width ${cols}: same column offsets, no line wider, the title keeps room, no lone …`, async ($, on) => {
    const tasks = [
      epicOf('tA', 'E-3a3a3bb5', [], { title: KO_TITLE }),
      epicOf('tB', 'E-bbbbbbbb', [], { title: EN_TITLE }),
    ]
    await seeded($, on, { status: stat(), tasks, task: demo() }, 'terminal', undefined, { epic: 'tA' }, true)
    const ui = await $.ui.mount({ plugin: 'teams', surface: 'terminal', component: 'Pane', requestId: 'teams-status', props: { title: 'Teams', isFocused: false, bodyColumns, placement: 'dock' } } as never)
    const lines = frame((await ui.drawn()) as any, 'Teams', cols)
    // (b) no line of the frame is wider than the pane
    for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(cols)
    const rows = lines.filter(l => /E-[0-9a-f]{8} /.test(l))
    expect(rows).toHaveLength(2)
    const [ko, en] = rows as [string, string]
    // (a) the state word starts at the same display-cell offset on both rows
    expect(ko).toContain('running')
    expect(en).toContain('running')
    expect(cells(ko.slice(0, ko.indexOf('running')))).toBe(cells(en.slice(0, en.indexOf('running'))))
    // the title starts at one offset too
    expect(cells(ko.slice(0, ko.indexOf('메')))).toBe(cells(en.slice(0, en.indexOf('Add'))))
    // no lone … column on any line
    for (const l of lines) expect(/\s…(\s|│|$)/.test(l)).toBe(false)
    if (cols === 46) {
      // (c) the state word stays; the count and the age are dropped; the title keeps 12 cells before any …
      for (const r of rows) {
        expect(r).toContain('running')
        expect(r).not.toMatch(/\d\/\d/)
        expect(r).not.toMatch(/\d+[smh]\b/)
      }
      for (const [r, first] of [[ko, '메'], [en, 'Add']] as const) {
        const title = r.slice(r.indexOf(first), r.indexOf('running')).trimEnd()
        const at = title.indexOf('…')
        expect(cells(at >= 0 ? title.slice(0, at) : title)).toBeGreaterThanOrEqual(12)
      }
    } else {
      // (d) wide enough: the count and the age are still there
      for (const r of rows) {
        expect(r).toMatch(/\d\/\d/)
        expect(r).toMatch(/\d+[smh]\b/)
      }
    }
  })
}

test('190 columns: the tab row keeps the cost text, fits the pane and ends in the right border', async ($, on) => {
  const d = DEMO.full!
  const first = d.tasks[0] as { task_id: string }
  await seeded($, on, { status: stat(), tasks: d.tasks, task: first }, 'terminal', undefined, { epic: first.task_id }, true)
  const ui = await $.ui.mount({ plugin: 'teams', surface: 'terminal', component: 'Pane', requestId: 'teams-status', props: { title: 'Teams', isFocused: false, bodyColumns: 190, placement: 'dock' } } as never)
  const lines = frame((await ui.drawn()) as any, 'Teams', 190)
  const tabRows = lines.filter(l => l.includes('Floor') && /turns/.test(l))
  expect(tabRows).toHaveLength(1)
  expect(cells(tabRows[0]!)).toBeLessThanOrEqual(190)
  expect(tabRows[0]!.endsWith('│')).toBe(true)
  for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(190)
})

test('demo frames', () => {
  // the runner indents an error message, so the frames go to stdout as they are (headings start at column 0), then the test fails
  if (SHOW) {
    console.log(`\n${shownFrames.join('\n')}\n`)
    throw new Error('SHOW is on: frames printed above')
  }
})

// ---- card 49B: asks addressed to this session ----
const ASK = { task_id: 'aaaaaaaa-0001', key: 'E-aaaaaaaa/P2', who: 'P2', question: 'Keep the legacy PDF route?', since: 1000, via: 'send' }
const ASK2 = { ...ASK, key: 'E-aaaaaaaa/P3', who: 'P3', question: 'Drop the cache?' }
const sessionId = (on: On, id = 'me') => on('session.id', () => ({ value: id }) as never)
const allTexts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => String(t.text))

for (const surface of SURFACES) {
  test(`${surface}: band one ask shows who and question, then the inbox Button`, async ($, on) => {
    await seeded($, on, { status: stat({ waiting: 1, asks: [ASK] }), task: demo() }, surface)
    const ui = await band($, surface)
    const q = await ui.find({ type: 'Text', text: 'P2 asks you: Keep the legacy PDF route?' })
    expect(q?.props.color).toBe('warning')
    expect(q?.props.wrap).toBe('truncate-end')
    expect(await labels(ui)).toContain('1 question for you')
    expect((await allTexts(ui)).some(t => /^\+\d/.test(t))).toBe(false)
  })

  test(`${surface}: band two asks shows +1`, async ($, on) => {
    await seeded($, on, { status: stat({ waiting: 2, asks: [ASK, ASK2] }), task: demo() }, surface)
    const ui = await band($, surface)
    expect(await ui.find({ type: 'Text', text: 'P2 asks you: Keep the legacy PDF route?' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '+1' })).toBeDefined()
    expect(await labels(ui)).toContain('2 questions for you')
    // +1 sits in the same row Box as the question (a fragment lets the host break the line)
    type N = { type?: string; props?: Record<string, unknown>; children?: unknown }
    const kids = (n: N): N[] => (Array.isArray(n.children) ? (n.children as N[]) : n.children ? [n.children as N] : []).filter(c => typeof c === 'object' && c !== null)
    const has = (n: N, t: string): boolean => (n.props?.children === t || n.children === t || (Array.isArray(n.children) && n.children.includes(t))) || kids(n).some(c => has(c, t))
    const rows: N[] = []
    const walk = (n: N) => { if (has(n, '+1') && has(n, 'P2 asks you: Keep the legacy PDF route?')) rows.push(n); kids(n).forEach(walk) }
    walk(await ui.drawn() as N)
    const row = rows.at(-1)
    expect(row?.type).toBe('Box')
    expect(row?.props?.flexDirection).toBe('row')
  })

  test(`${surface}: band asks [] with one waiting is today's band`, async ($, on) => {
    await seeded($, on, { status: stat({ waiting: 1, asks: [] }), task: demo() }, surface)
    const ui = await band($, surface)
    expect((await allTexts(ui))[0]).toBe('⚑')
    expect((await shown(ui))).not.toContain('asks you')
    expect(await labels(ui)).toContain('1 question for you')
  })

  test(`${surface}: band ask from another repo (waiting 0, no task) still shows the ask row`, async ($, on) => {
    await seeded($, on, { status: stat({ waiting: 0, latest: null, asks: [ASK] }), task: null }, surface)
    const ui = await band($, surface)
    expect(await ui.find({ type: 'Text', text: 'P2 asks you: Keep the legacy PDF route?' })).toBeDefined()
    expect((await allTexts(ui))[0]).toBe('⚑')
    expect(await labels(ui)).toContain('1 question for you')
  })

  test(`${surface}: band ko label exact`, async ($, on) => {
    await seeded($, on, { status: stat({ waiting: 1, asks: [ASK] }), task: demo() }, surface, 'ko')
    expect(await (await band($, surface)).find({ type: 'Text', text: 'P2님이 묻습니다: Keep the legacy PDF route?' })).toBeDefined()
  })

  test(`${surface}: Floor line for an addressed card, none for an unaddressed waiting card`, async ($, on) => {
    const you = { count: 2, items: ['a', 'b'], cards: [{ key: ASK.key, title: 'a', question: ASK.question, who: 'P2', since: 1000 }, { key: 'E-aaaaaaaa/P4', title: 'b', question: 'other?', who: 'P4', since: 1000 }] }
    await seeded($, on, { status: stat({ waiting: 2, asks: [ASK] }), tasks: floorOf(WORKERS), task: demo({ you }), teams: TEAMS }, surface, undefined, { epic: 'tA' })
    const ui = await wide($, surface)
    const lines = (await allTexts(ui)).filter(t => t.includes('→ you') && t.includes('Keep'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^⚑ P2 → you {2}Keep the legacy PDF route\?/)
    expect((await ui.findAll({ type: 'Text', text: /^⚑ P2 → you/ })).some(t => t.props.color === 'warning')).toBe(true)
    expect((await allTexts(ui)).filter(t => t.includes('P4 → you'))).toEqual([])
  })
}

test('tick: data call carries --session me, events call does not; no surfaces = no tick', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  startWorld(on)
  sessionId(on)
  const seen = uiWorld(on, {}, ['terminal'])
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  await clock.advance(3000)
  const data = seen.argv.filter(a => !isEvents(a))
  expect(data).toHaveLength(1)
  expect(data[0]![data[0]!.indexOf('--session') + 1]).toBe('me')
  expect(seen.argv.filter(isEvents).every(a => !a.includes('--session'))).toBe(true)
})

test('tick: no surfaces, no tick even with a session id', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  sessionId(on)
  const seen = world(on, [], () => ok(''))
  await start($)
  await clock.advance(6000)
  expect(seen.argv).toHaveLength(0)
})

// receiver: ask-message.mjs runs, the mod only transports
test('receiver: a teams ask is consumed and the data refreshed once; other text passes through', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  startWorld(on)
  sessionId(on)
  const store = new Map<string, unknown>()
  const seen = { argv: [] as (readonly string[])[] }
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('state.get', (_$, e) => ({ value: { value: store.get(e.key), version: 0 } }) as never)
  on('state.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } } as never
  })
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.status', () => ({ value: undefined }))
  on('session.receive', (_$, e) => ({ text: e.text }))
  const stdin: (string | undefined)[] = []
  let isAsk = true
  on('process.run', (_$, e) => {
    if (e.argv.includes('--received')) {
      stdin.push(e.init?.stdin)
      return { value: ok(isAsk ? 'E-aaaaaaaa/P2\n' : '') }
    }
    seen.argv.push(e.argv)
    return { value: ok('{"line":"","waiting":0}') }
  })
  await start($)
  await clock.advance(3000)
  const dataCalls = () => seen.argv.filter(a => !isEvents(a)).length
  const n = dataCalls()
  const input = { origin: { kind: 'peer' as const }, text: '[teams ask] P2 asks you: q', isVerified: true }
  const r = await $.session.receive(input as never)
  expect(r).toEqual({ consumed: 'teams ask' })
  expect(stdin[0]).toBe(input.text)
  expect(dataCalls()).toBe(n + 1)
  isAsk = false
  const other = await $.session.receive({ ...input, text: 'hello' } as never)
  expect(other).toEqual({ text: 'hello' })
  expect(dataCalls()).toBe(n + 1)
})

// the Home tab draws node's dashboard: node's SVG where the surface has Svg, the same model in Ink on the terminal
const DASH = {
  model: {
    key: 'E-3a3a3bb5', title: 'Build the expense tracker', state: 'running', pct: 33, now: 'Build · Receipts upload',
    stages: [{ n: 1, key: 'plan', label: 'Plan', state: 'done' }, { n: 2, key: 'build', label: 'Build', state: 'running' }, { n: 3, key: 'integrate', label: 'Integrate', state: 'pending' }],
    packages: [{ title: 'Receipts upload', state: 'running' }],
    lanes: [{ key: 'running', label: 'In progress', count: 1, cards: [{ title: 'Receipts upload', kind: 'package', failed: false, reason: null }], more: 0 }],
    tiles: [{ key: 'progress', label: 'Progress', value: '33%', sub: '1/3 stages' }, { key: 'cost', label: 'Cost', value: '$1.20', sub: '30 turns' }],
    activity: [{ time: '10:02', kind: 'dispatched', subject: 'Receipts upload' }],
    waiting: [], at: 0,
  },
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
  alt: 'E-3a3a3bb5 Build the expense tracker: running, 33%',
}
for (const surface of SURFACES) {
  test(`${surface}: Home draws ${surface === 'terminal' ? 'the Ink dashboard, no Svg' : "node's Svg"}`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo(), dash: DASH }, surface, undefined, { view: 'dash' })
    const ui = await pane($, surface)
    const svg = await ui.find({ type: 'Svg' })
    if (surface === 'terminal') {
      expect(svg).toBeUndefined()
      const text = await shown(ui)
      const rows = frame((await ui.drawn()) as any, 'Teams', 84)
      for (const l of rows) expect(cells(l)).toBeLessThanOrEqual(84)
      for (const word of ['33%', '2 Build', 'PROGRESS', 'Receipts upload', 'In progress', 'dispatched']) expect(text).toContain(word)
    } else {
      expect(svg?.props.source).toBe(DASH.svg)
      expect(svg?.props.alt).toBe(DASH.alt)
    }
  })
}

test('the pane opens on Home; 0 picks it, 1 the Floor', async () => {
  expect(paneKey('0')).toEqual({ kind: 'tab', tab: 'dash' })
  expect(paneKey('1')).toEqual({ kind: 'tab', tab: 'floor' })
})

// ---- U3: the run's numbers on Home and the STORYs tab, at 190 and 110 columns (fictional data) ----
const REASON = 'All code and test acceptance for the parser is met and verified by the final run of the whole suite across every supported locale'
const numbers = (over: Record<string, unknown> = {}) => ({
  attempt: 3, max_attempts: 3, judge: { score: 85, threshold: 90, reason: REASON }, cost_usd: 1.27, retry_cost_usd: 2.35, wall_ms: 1521000, out_of_retries: true, ...over,
})
const NEVER = numbers({ attempt: 0, judge: null, cost_usd: 0, retry_cost_usd: 0, wall_ms: 0 })
const RUN = {
  budget: { limit_usd: 5, spent_usd: 3.62 }, drivers: { live: 2, cap: 4, stalled: [{ id: 'P2', minutes: 25 }] },
  denials: 1, out_of_retries: ['P2', 'P3'], defects: { filed: 2, dropped: 1 }, scoped_out: 1,
}
const NUMBERED = [
  epicOf('tA', 'E-3a3a3bb5', [
    story('E-3a3a3bb5/P2', 'report writer', { state: 'failed', last_verdict: 'reject', metrics: numbers() }),
    story('E-3a3a3bb5/P3', 'cache layer', { state: 'idle', metrics: NEVER }),
    story('E-3a3a3bb5/P4', 'parser module', { doing: 'editing parser.ts', metrics: numbers({ attempt: 1, judge: { score: 94, threshold: 90, reason: 'sound' }, retry_cost_usd: 0, cost_usd: 0.42, wall_ms: 240000, out_of_retries: false }) }),
  ]),
]
const longRun = { ...RUN, out_of_retries: Array.from({ length: 60 }, (_, i) => `QA-F${i}`) }
const inPane = async ($: Engine, cols: number, tab?: string) => {
  const ui = await $.ui.mount({ plugin: 'teams', surface: 'terminal', component: 'Pane', requestId: 'teams-status', props: { title: 'Teams', isFocused: false, bodyColumns: cols - 4, placement: 'dock' } } as never)
  if (tab !== undefined) {
    await ui.press({ key: tab })
    await ui.redraw()
  }
  return bodyOf(frame((await ui.drawn()) as any, 'Teams', cols))
}
// no line wider than the pane, no cut glyph, no `…` alone in a cell or doubled, nothing undefined
const sound = (lines: string[], cols: number) => {
  for (const l of lines) {
    expect(cells(l)).toBeLessThanOrEqual(cols - 4)
    expect(l).not.toContain('�')
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(l)).toBe(false)
    expect(l).not.toContain('……')
    expect(/(^|\s\s)…/.test(l)).toBe(false)
    for (const bad of ['NaN', 'undefined', 'null']) expect(l).not.toContain(bad)
  }
}

for (const cols of WIDTHS) {
  test(`Home shows the run's numbers at ${cols} columns`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: NUMBERED, task: demo(), dash: { ...DASH, model: { ...DASH.model, run: RUN } } }, 'terminal', undefined, { epic: 'tA', view: 'dash' }, true)
    const lines = await inPane($, cols)
    sound(lines, cols)
    const text = lines.join('\n')
    for (const part of ['Budget', '$3.62 of $5.00', '2/4 live', 'Stalled', 'P2 25m', 'Denials', 'Defects', '2 filed · 1 dropped', 'Out of retries', 'P2, P3', 'Scoped out']) expect(text).toContain(part)
    // label · value, one per line: the values start at one column (the longest label is 14 wide, then a 2-cell gap)
    const rows = lines.filter(l => /^(Budget|Drivers|Stalled|Denials|Defects|Out of retries|Scoped out) /.test(l))
    expect(rows).toHaveLength(7)
    for (const l of rows) {
      expect(l.slice(14, 16)).toBe('  ')
      expect(l[16]).not.toBe(' ')
    }
  })
  test(`Home cuts a long list with … at ${cols} columns`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: NUMBERED, task: demo(), dash: { ...DASH, model: { ...DASH.model, run: longRun } } }, 'terminal', undefined, { epic: 'tA', view: 'dash' }, true)
    const lines = await inPane($, cols)
    sound(lines, cols)
    const cut = lines.find(l => l.startsWith('Out of retries'))!
    expect(cut.endsWith('…')).toBe(true)
  })
  test(`STORYs shows attempt, judge, cost with retry, wall, one line each at ${cols} columns`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: NUMBERED, task: demo() }, 'terminal', undefined, { epic: 'tA' }, true)
    const lines = await inPane($, cols, 'stories')
    sound(lines, cols)
    const rows = lines.filter(l => /^[▸ ] +[●◌⚑✔✘⊘]  \S/.test(l) && !EPIC_LINE.test(l))
    expect(rows).toHaveLength(3)
    const [p2, p3, p4] = rows as [string, string, string]
    for (const part of ['report writer', '3/3', 'judge 85 vs 90', '$1.27', '+$2.35', '25m']) expect(p2).toContain(part)
    // the reason is the line under its row, not on it
    expect(p2).not.toContain('All code')
    expect(lines[lines.indexOf(p2) + 1]).toContain('All code')
    expect(p3).toContain('0/3')
    expect(p3).not.toContain('judge')
    for (const part of ['1/3', 'judge 94 vs 90', '$0.42', '4m']) expect(p4).toContain(part)
    expect(p4).not.toContain('+$')
    // the long reason is cut with …, never run on
    if (cols === 110) expect(lines[lines.indexOf(p2) + 1]!.trimEnd().endsWith('…')).toBe(true)
    // icons first: ✘ for the failed STORY, columns at one offset on every row
    expect(p2.replace(/^▸ */, '').trimStart()[0]).toBe('✘')
    const judgeAt = rows.map(l => l.indexOf('judge')).filter(i => i >= 0)
    expect(new Set(judgeAt).size).toBe(1)
  })
}

// ---- U2: a STORY is two lines — the numbers, then the reason or the judge's gap — at 86, 110 and 190 columns ----
const TWO = [
  epicOf('tA', 'E-3a3a3bb5', [
    story('E-3a3a3bb5/P2', 'report writer with a deliberately long title', { state: 'failed', last_verdict: 'reject', metrics: numbers({ judge: { score: 85, threshold: 90, reason: REASON, gap: null } }) }),
    story('E-3a3a3bb5/P3', 'cache layer', { doing: 'editing cache.ts', metrics: numbers({ attempt: 1, judge: { score: 93, threshold: 90, reason: 'sound', gap: 'the retry path has no test' }, retry_cost_usd: 0, out_of_retries: false }) }),
    story('E-3a3a3bb5/P4', 'parser', { state: 'idle', metrics: NEVER }),
  ]),
]
for (const cols of [86, 110, 190]) {
  test(`STORY rows are two lines with the title cut only at its end at ${cols} columns`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: TWO, task: demo() }, 'terminal', undefined, { epic: 'tA' }, true)
    const lines = await inPane($, cols, 'stories')
    sound(lines, cols)
    for (const l of lines) expect(l).not.toContain('->')
    const at = (re: RegExp) => lines.findIndex(l => re.test(l) && !EPIC_LINE.test(l))
    const p2 = at(/^[▸ ] +✘  report/)
    const p3 = at(/^[▸ ] +●  cache/)
    expect(p2).toBeGreaterThanOrEqual(0)
    expect(p3).toBeGreaterThan(p2)
    // the title: whole while room is free (never a stub), else a long prefix and a single … at its end
    const title = lines[p2]!.replace(/^[▸ ] +✘  /, '').split(/ {2,}/)[0]!
    expect(title.startsWith('report writer')).toBe(true)
    expect(title.indexOf('…') === -1 || title.indexOf('…') === title.length - 1).toBe(true)
    if (cols >= 190) expect(title).toBe('report writer with a deliberately long title')
    // line 2: the reason on its own line, indented under the title, clipped with … only at its end
    const note = lines[p2 + 1]!
    expect(note.startsWith('    ')).toBe(true)
    expect(note.trim().startsWith('All code and test acceptance')).toBe(true)
    expect(lines[p2]).not.toContain('All code')
    if (cols < 190) expect(note.trimEnd().endsWith('…')).toBe(true)
    // the judge's gap replaces the reason
    expect(lines[p3 + 1]!.trim().startsWith('own gap: the retry path has no test')).toBe(true)
    expect(lines.join('\n')).not.toContain('sound')
  })
  test(`STORY rows keep a long title and show one status word at ${cols} columns`, async ($, on) => {
    const T40 = 'importer for the quarterly ledger export' // 40 characters
    expect(T40).toHaveLength(40)
    const tasks = [epicOf('tA', 'E-3a3a3bb5', [
      story('E-3a3a3bb5/P2', T40, { state: 'failed', last_verdict: 'reject', metrics: numbers() }),
      story('E-3a3a3bb5/P3', 'cache layer', { state: 'done', last_verdict: 'accept', metrics: numbers({ attempt: 1, judge: { score: 94, threshold: 90, reason: 'sound' }, retry_cost_usd: 0, out_of_retries: false }) }),
      story('E-3a3a3bb5/P4', 'parser', { state: 'idle', metrics: NEVER }),
    ])]
    await seeded($, on, { status: stat(), tasks, task: demo() }, 'terminal', undefined, { epic: 'tA' }, true)
    const lines = await inPane($, cols, 'stories')
    sound(lines, cols)
    const rows = lines.filter(l => /^[▸ ] +[●◌⚑✔✘⊘]  \S/.test(l) && !EPIC_LINE.test(l))
    expect(rows).toHaveLength(3)
    // title: whole at 190; at least 30 characters before … at 110, 24 at 86 (rows at 86 may drop retry or wall; the title is kept)
    const title = rows[0]!.replace(/^[▸ ] +✘  /, '').split(/ {2,}/)[0]!
    const visible = title.replace(/…$/, '')
    expect(T40.startsWith(visible)).toBe(true)
    if (cols >= 190) expect(title).toBe(T40)
    if (cols === 110) expect(visible.length).toBeGreaterThanOrEqual(30)
    if (cols === 86) expect(visible.length).toBeGreaterThanOrEqual(24)
    // exactly one status word per row, and no cut second state beside it
    const STATE = /\b(rejected|accepted|failed|stalled|idle|done|reject|accept|fai|sta|rej|acc)(…)?(?=\s|$)/g
    const words = rows.map(l => l.replace(/^[▸ ] +[●◌⚑✔✘⊘]  /, '').split(/ {2,}/).slice(1).join('  ').match(STATE) ?? [])
    expect(words[0]).toEqual(['rejected'])
    expect(words[1]).toEqual(['accepted'])
    expect(words[2]).toEqual(['idle'])
  })
  for (const surface of SURFACES) {
    test(`${surface}: two-line STORY rows mount at ${cols} columns`, async ($, on) => {
      await seeded($, on, { status: stat(), tasks: TWO, task: demo() }, surface, undefined, { epic: 'tA', view: 'stories' }, true)
      const ui = await $.ui.mount({ plugin: 'teams', surface, component: 'Pane', requestId: 'teams-status', props: { title: 'Teams', isFocused: false, bodyColumns: cols - 4, placement: 'dock' } } as never)
      const text = (await ui.findAll({ type: 'Text' })).map(t => String(t.text)).join('\n')
      expect(text).toContain('report writer')
      expect(text).not.toContain('->')
    })
  }
}

// ---- card94: one fixed status word per STORY row, no '->', the title and the reason get the room ----
// the widths the host gives: pane frame 86 = bodyColumns 82, and the side pane of a 190- and a 110-column screen = 78 and 46
const T40 = 'Retry queue drains stale jobs on restart' // 40 characters
const R120 = 'The tenant cap is skipped when two workers claim one job at the same moment, so a burst of claims can exceed the limit.'
const DOING = '-> Bash node --test teams/scripts/test-view-summary.mjs teams/scripts/test-view-floor.mjs teams/scripts/test-view.mjs'
const CARD94 = [
  epicOf('tA', 'E-3a3a3bb5', [
    story('E-3a3a3bb5/P2', T40, { doing: DOING, metrics: numbers({ attempt: 2, judge: null, retry_cost_usd: 0, out_of_retries: false }) }),
    story('E-3a3a3bb5/P3', 'Billing export batches by tenant', { state: 'failed', last_verdict: 'reject', metrics: numbers({ attempt: 1, judge: { score: 70, threshold: 90, reason: R120, gap: null }, retry_cost_usd: 0, out_of_retries: false }) }),
    story('E-3a3a3bb5/P4', 'Webhook signer rotates keys nightly', { state: 'failed', last_verdict: 'reject', metrics: numbers({ attempt: 1, judge: { score: 93, threshold: 90, reason: 'sound', gap: R120 }, retry_cost_usd: 0, out_of_retries: false }) }),
  ]),
]
for (const surface of SURFACES) {
  for (const bodyColumns of [82, 78, 46]) {
    test(`card94 ${surface} at ${bodyColumns} body columns: STORY rows have one status word, no '->', the title and the reason keep their room`, async ($, on) => {
      await seeded($, on, { status: stat(), tasks: CARD94, task: demo() }, surface, undefined, { epic: 'tA', view: 'stories' }, true)
      const ui = await $.ui.mount({ plugin: 'teams', surface, component: 'Pane', requestId: 'teams-status', props: { title: 'Teams', isFocused: false, bodyColumns, placement: 'dock' } } as never)
      const all = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
      if (surface === 'terminal') sound(bodyOf(frame((await ui.drawn()) as any, 'Teams', bodyColumns + 4)), bodyColumns + 4)
      for (const l of all) {
        expect(l).not.toContain('->')
        expect(cells(l)).toBeLessThanOrEqual(bodyColumns - 4)
      }
      const rows = all.filter(l => /^[▸ ] +[●◌⚑✔✘⊘]  \S/.test(l) && !EPIC_LINE.test(l))
      expect(rows).toHaveLength(3)
      const parts = rows.map(l => l.replace(/^[▸ ] +[●◌⚑✔✘⊘]  /, '').split(/ {2,}/))
      // the title shows its first words
      const title = parts[0]![0]!.replace(/…$/, '')
      expect(T40.startsWith(title)).toBe(true)
      expect(cells(title)).toBeGreaterThanOrEqual(bodyColumns === 46 ? 16 : 24)
      expect(title).toContain(bodyColumns === 46 ? 'Retry queue' : 'Retry queue drains')
      // one fixed word per row: the acting row says working, the rejected rows rejected, nothing else beside it
      expect(parts[0]![1]).toBe('working')
      expect(parts[1]![1]).toBe('rejected')
      expect(parts[2]![1]).toBe('rejected')
      // the 120-char reason (the gap of the 93 vs 90 row) is the line under its row: >= 40 cells, ends in …
      const notes = [/^\s+The tenant cap/, /^\s+own gap: The tenant cap/].map(re => all.find(l => re.test(l))!)
      for (const note of notes) {
        expect(note).toBeDefined()
        expect(cells(note.trim())).toBeGreaterThanOrEqual(40)
        expect(note.trimEnd().endsWith('…')).toBe(true)
      }
      const note1 = notes[0]!
      if (bodyColumns === 46) expect(note1.startsWith('  ') && !note1.startsWith('   ')).toBe(true)
      else expect(rows[2]).toContain('judge 93 vs 90')
    })
  }
}

// ---- card 105: a task in a linked worktree of this repo is marked ⑂ <worktree>; the mod only renders the field ----
const WT = [epicOf('tW', 'E-wwwwwwww', [], { title: 'in a worktree', worktree: 'wt' }), epicOf('tM', 'E-mmmmmmmm', [], { title: 'own checkout', worktree: null })]
for (const surface of SURFACES) {
  test(`${surface}: pane EPIC row shows ⑂ wt for a worktree task, none for null`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: WT, task: WT[0] }, surface, undefined, { watch: [] })
    const ui = await wide($, surface)
    const text = await shown(ui)
    expect(text).toContain('⑂ wt · in a worktree')
    expect(text).toContain('own checkout')
    expect(text.split('⑂').length).toBe(2)
  })
  test(`${surface}: band shows ⑂ wt for a worktree task; null shows no ⑂`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo({ worktree: 'wt' }) }, surface)
    expect(await shown(await band($, surface))).toContain('teams · ⑂ wt · ')
  })
  test(`${surface}: band with a long title keeps ⑂ <worktree> before the title`, async ($, on) => {
    const long = 'Migrate every legacy report exporter to the new streaming writer and keep each output file identical across all supported locales'
    await seeded($, on, { status: stat(), task: demo({ worktree: 'feature-worktree', title: long }) }, surface)
    expect(await shown(await band($, surface))).toContain('teams · ⑂ feature-worktree · Migrate')
  })
  test(`${surface}: band with worktree null shows no ⑂`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo({ worktree: null }) }, surface)
    expect(await shown(await band($, surface))).not.toContain('⑂')
  })
  // the title cell (⑂ worktree · title) is cut from its end at 110 columns: the title tail goes, the ⑂ mark stays, the row keeps its cells
  test(`${surface}: a long title with a worktree is cut to … at 110 columns, the ⑂ mark stays`, async ($, on) => {
    const long = 'Migrate every legacy report exporter to the new streaming writer and keep each output file identical across all supported locales'
    const tasks = [
      epicOf('tW', 'E-aaaaaaaa', [], { title: long, worktree: 'feature-worktree' }),
      epicOf('tS', 'E-bbbbbbbb', [], { title: 'short', worktree: null }),
    ]
    await seeded($, on, { status: stat(), tasks, task: tasks[0] }, surface, undefined, { epic: 'tW' })
    const ui = await $.ui.mount({ plugin: 'teams', surface, component: 'Pane', requestId: 'teams-status', props: { title: 'Teams', isFocused: false, bodyColumns: 106, placement: 'dock' } } as never)
    const lines = await textsOf(ui, EPIC_LINE)
    expect(lines).toHaveLength(2)
    const [w, s] = lines as [string, string]
    expect(w).toContain('…')
    expect(w).toContain('⑂ feature-worktree · Migrate')
    expect(w).not.toContain('all supported locales')
    expect(w).toMatch(/\d+\/\d+/)
    expect(s).toMatch(/\d+\/\d+/)
    expect(w.indexOf('⑂')).toBe(s.indexOf('short'))
    for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(106)
  })
}
