import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { STRINGS } from './mod'

type Run = { exitCode: number; stdout: string; stderr: string }
const ok = (stdout: string): Run => ({ exitCode: 0, stdout, stderr: '' })

// The engine beneath the plugin: surfaces, cwd, process.run, toast, status, command.register.
function world(on: On, surfaces: readonly ('terminal' | 'desktop')[], runs: (argv: readonly string[]) => Run) {
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

test('terminal: /teams-status is registered and the tick runs view.mjs from the plugin root', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const seen = world(on, ['terminal'], () => ok(''))
  await start($)
  expect(seen.commands).toEqual(['teams-status'])
  await clock.advance(3000)
  expect(seen.argv.length > 0).toBe(true)
  expect(seen.argv.every(a => a[0] === 'node' && a[1].endsWith('/scripts/view.mjs') && !a[1].startsWith('${'))).toBe(true)
  expect(seen.maxInFlight).toBe(1)
})

test('two events: two toasts, cursor advances; the same events again: no toast', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const seen = world(on, ['terminal'], argv => (isEvents(argv) ? ok(twoEvents) : ok('{"line":"","waiting":0}')))
  await start($)
  await clock.advance(3000)
  expect(seen.toasts).toEqual([E1.text, E2.text])
  await clock.advance(3000)
  expect(seen.toasts).toHaveLength(2)
  const sinces = seen.argv.filter(isEvents).map(sinceOf)
  expect(sinces).toEqual(['1000', '1800'])
})

test('status line: pinned only while someone must act, then cleared', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  let body = '{"line":"teams: E-aaaaaaaa 1/4 P1 implement","waiting":2}'
  const seen = world(on, ['terminal'], argv => (isEvents(argv) ? ok('') : ok(body)))
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  await clock.advance(3000)
  expect(seen.statuses).toEqual(['needs you: 2 waiting - open /teams-status'])
  body = '{"line":"teams: E-aaaaaaaa 1/4 P1 implement","waiting":0}'
  await clock.advance(3000)
  expect(seen.statuses[seen.statuses.length - 1]).toBeUndefined()
})

test('a non-zero exit: no throw, no toast, status unchanged', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const seen = world(on, ['terminal'], () => ({ exitCode: 1, stdout: twoEvents, stderr: 'boom' }))
  await start($)
  await clock.advance(6000)
  expect(seen.toasts).toEqual([])
  expect(seen.statuses).toEqual([])
})

// ---- tool.call: watch hook and team_status guard ----
// Engine beneath: surfaces, a tool that answers `result`, and a state store the test reads back.
function toolWorld(on: On, result: unknown, surfaces: readonly ('terminal' | 'desktop')[] = ['terminal'], isBroken = false) {
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
const SURFACES = ['terminal', 'desktop'] as const

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
const EN_UI = ['Now', 'You', 'Stages', 'Work', 'Cost', 'Summary', 'Log', 'needs you', 'more in other runs', 'running', 'stalled', 'finished']

// Engine beneath: a Map-backed $.state, process.run for view.mjs (status and summary answer the same
// fixture), ui.open and ui.status recorded.
type Data = { status?: Record<string, unknown>; tasks?: unknown[]; task?: unknown; teams?: unknown; decisions?: (card: string | null) => unknown; reports?: Record<string, unknown>; events?: unknown[]; failReport?: boolean }
function uiWorld(on: On, init: Record<string, unknown> = {}, surfaces: readonly ('terminal' | 'desktop')[] = ['terminal'], data: Data = {}) {
  const store = new Map<string, unknown>(Object.entries(init))
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
    if (format === 'teams') return { value: ok(JSON.stringify({ status: status(), tasks: data.tasks, task: data.task ?? null, teams: data.teams ?? null })) }
    return { value: ok(format === 'status' ? JSON.stringify(status()) : format === 'summary' ? JSON.stringify({ status: status(), tasks: data.tasks, task: data.task ?? null }) : '') }
  })
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)
    seen.openArgs.push(e)
    return { value: { isPlaced: true } } as never
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
// the header row: the title Text and the state/day/progress Text beside it
const headerOf = async (ui: Ui) =>
  `${(await ui.find({ type: 'Text', text: /E-3a3a3bb5/ }))?.text ?? ''} ${(await ui.find({ type: 'Text', text: /day \d+|\d+일째/ }))?.text ?? ''}`
const engineBand = (on: On) =>
  on('ui.render', (_$, e) => (e.component === 'AbovePrompt' ? { type: 'Text', children: ['engine band'] } : undefined) as never)

// The data reaches the mod the way it does live: one tick (pane open, so the summary call runs) over
// the mocked view.mjs; `data` is read at every call, so a test changes it between ticks.
async function seeded($: Engine, on: On, data: Data, surface: (typeof SURFACES)[number] = 'terminal', language?: string, init: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: 1000 })
  startWorld(on, language)
  const seen = uiWorld(on, { watch: ['abc'], ...init }, [surface], data)
  on('ui.panes', () => ({ value: [{ id: 'teams-status', title: 'Teams', isPlaced: true }] }) as never)
  engineBand(on) // the engine's own band, beneath the teams row
  await start($)
  await clock.advance(3000)
  return { seen, tick: () => clock.advance(3000) }
}

for (const surface of SURFACES) {
  test(`${surface}: Summary answers now / you / how far / going well, with no internal ids; render runs no process`, async ($, on) => {
    const { seen } = await seeded($, on, { status: stat(), task: demo() }, surface)
    const ui = await pane($, surface)
    const n = seen.argv.length
    const text = await shown(ui)
    for (const word of ['Now', 'You', '4/5', 'running', 'Build the expense tracker']) expect(text).toContain(word)
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

  test(`${surface}: Now sits on top, then the tabs: plain hotkey tabs 1-5, the selected one full strength with a dot`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo() }, surface)
    const ui = await pane($, surface)
    const tab = async (key: string) => (await ui.find({ key }))?.props
    expect(await tab('floor')).toMatchObject({ plain: true, hotkey: '1', dimColor: false, label: '● Floor 1' })
    expect(await tab('stories')).toMatchObject({ plain: true, hotkey: '2', dimColor: true, label: 'STORYs 2' })
    expect(await tab('decisions')).toMatchObject({ plain: true, hotkey: '3', dimColor: true, label: 'Decisions 3' })
    expect(await tab('log')).toMatchObject({ hotkey: '4', label: 'Log 4' })
    expect(await tab('report')).toMatchObject({ hotkey: '5', label: 'Report 5' })
    const text = await shown(ui)
    expect(text.indexOf('Now')).toBeLessThan(text.indexOf('Floor'))
    await ui.press({ key: 'decisions' })
    await ui.redraw() // the stubbed $.state does not notify readers
    expect(await tab('decisions')).toMatchObject({ dimColor: false, label: '● Decisions 3' })
    expect(await tab('floor')).toMatchObject({ dimColor: true, label: 'Floor 1' })
  })

  test(`${surface}: Floor tab: one block per team, each card with its state and what it does now; Now lists each active actor`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo({ work: [failedCard] }), teams: TEAMS }, surface)
    const ui = await pane($, surface)
    for (const head of ['Planning', 'Develop', 'QA', 'Audit']) expect(await ui.find({ type: 'Text', text: head })).toBeDefined()
    expect((await ui.find({ key: 'card:P1' }))?.props.label).toBe('● module b · IN_PROGRESS · implement codex·gpt-5 4m')
    expect((await ui.find({ key: 'card:P0' }))?.props.label).toBe('✘ module a · BLOCKED')
    expect(await ui.find({ type: 'Text', text: '  verifier rejected: tests red' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '  Develop · E-3a3a3bb5/P1 · implement · codex·gpt-5 · 4m' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '  EPIC · E-3a3a3bb5 · integrate:1 · claude·opus · 35s' })).toBeDefined()
  })

  test(`${surface}: a card pressed opens its own decision thread: earlier and later verdict with actor and reason`, async ($, on) => {
    const { seen } = await seeded($, on, { status: stat(), task: demo(), teams: TEAMS, decisions: card => (card === 'P1' ? THREAD : { card: null, entries: [] }) }, surface)
    const ui = await pane($, surface)
    await ui.press({ key: 'card:P1' })
    await ui.redraw()
    const call = seen.argv.filter(a => fmtOf(a) === 'decisions').at(-1)!
    expect(call[call.indexOf('--card') + 1]).toBe('P1')
    expect((await ui.find({ key: 'decisions' }))?.props.label).toBe('● Decisions 3')
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

  test(`${surface}: band shows the teams row and the engine band beneath it`, async ($, on) => {
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
    expect((await ui.find({ key: 'inbox' }))?.props.label).toBe('needs you 2')
    await ui.press({ key: 'board' })
    expect(seen.opened).toEqual(['teams-status'])
    expect(await shown(await pane($, surface))).toContain('2 more in other runs')
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
    await tick()
    await ui.redraw()
    const failed = await shown(ui)
    for (const word of ['✘', 'module a', 'verifier rejected: tests red']) expect(failed).toContain(word)
  })

  test(`${surface}: language korean draws no English UI word and the 현장 tab`, async ($, on) => {
    await seeded($, on, { status: stat({ waiting: 2 }), task: demo({ work: [failedCard] }), teams: TEAMS }, surface, 'korean')
    const texts = [await shown(await pane($, surface)), await shown(await band($, surface))]
    for (const text of texts) for (const word of [...EN_UI, 'Teams', 'Decisions', 'Develop', 'Audit', '"label":"close"']) expect(text).not.toContain(word)
    expect(texts[0]).toContain('● 현장 1')
    expect(texts[0]).toContain('개발')
    expect(texts[0]).toContain('Build the expense tracker')
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
  expect((await ui.find({ key: 'close' }))?.props).toMatchObject({ hotkey: 'q', role: 'dismiss', label: 'close' })
  await ui.press({ key: 'close' })
  expect(closed).toEqual(['teams-status'])
  const r = await $.command.run({ command: 'teams-status', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(closed).toEqual(['teams-status', 'teams-status'])
  expect(JSON.stringify(r)).toContain('pane closed')
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

test('pane header: title truncates; "running · day N · done/total" is its own non-truncating node', async ($, on) => {
  await seeded($, on, { status: stat(), task: demo({ title: LONG }) })
  const ui = await pane($, 'terminal')
  const title = await ui.find({ type: 'Text', text: LONG })
  const head = await ui.find({ type: 'Text', text: 'running · day 15 · 4/5' })
  expect(title).toBeDefined()
  expect(title!.props.wrap).toBe('truncate-end')
  expect(head).toBeDefined()
  expect(head!.props.wrap).toBeUndefined()
})

test('Summary stage rail: a dot per stage, the running one bold, solid rail up to it and dotted after', async ($, on) => {
  await seeded($, on, { status: stat(), task: demo() })
  const ui = await pane($, 'terminal')
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
  expect(await ui.find({ type: 'Text', text: '✔ card 0' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✔ card 5' })).toBeDefined()
  expect(await ui.find({ text: 'card 6' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '+2 more' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /card 0.*card 1/ })).toBeUndefined()
})

test('now: a card not yet started reads "Waiting to fix defect"', async ($, on) => {
  await seeded($, on, { status: stat(), task: demo({ now: { kind: 'fixnext', subject: 'b.txt', detail: null } }) })
  expect(await shown(await pane($, 'terminal'))).toContain('Waiting to fix defect: b.txt')
})

test('now: Korean "fixnext" has no English', async ($, on) => {
  await seeded($, on, { status: stat(), task: demo({ now: { kind: 'fixnext', subject: 'b.txt', detail: null } }) }, 'terminal', 'korean')
  const text = await shown(await pane($, 'terminal'))
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
    expect((await ui.find({ key: 'report' }))?.props).toMatchObject({ plain: true, hotkey: '5', label: 'Report 5' })
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
const story = (key: string, title: string, over: Record<string, unknown> = {}) => ({
  key, title, state: 'acting', doing: '', last_verdict: null, cost_usd: null, cost_estimated: false, try: null, max: null,
  live: true, elapsed_ms: null, run_file: null, owner_key: key, ...over,
})
const epicOf = (id: string, key: string, items: unknown[], over: Record<string, unknown> = {}) => ({
  ...demo({ key, title: `task ${id}` }), task_id: id, created_at: 500, live: true, age_ms: null, items, workers: [], handoffs: [], harness: null, ...over,
})
const FULL = [
  epicOf('tA', 'E-3a3a3bb5', [
    story('E-3a3a3bb5/P1', 'module b', { doing: 'editing a.ts', last_verdict: 'reject', try: 2, max: 3, elapsed_ms: 240000, cost_usd: 0.42, cost_estimated: true, run_file: '/w/runs/p1.json' }),
    story('E-3a3a3bb5/P2', 'a much longer module title for the cut', { doing: 'running tests', state: 'idle', elapsed_ms: 3720000 }),
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
    for (const part of ['module b', 'editing a.ts', 'rejected', '2/3', '4m', '~$0.42']) expect(a).toContain(part)
    expect(b).toContain('running tests')
    expect(b).toContain('1h 2m')
    expect(b).not.toContain('$')
    for (const part of ['small thing', 'reading', '35s', '$1.50', 'run-7', '▸']) expect(c).toContain(part)
    // the same column starts at the same character on every row
    expect(a.indexOf('editing a.ts')).toBe(b.indexOf('running tests'))
    expect(a.indexOf('editing a.ts')).toBe(c.indexOf('reading'))
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

  test(`${surface}: bracket keys clamp at both ends`, async ($, on) => {
    const { tick } = await seeded($, on, { status: stat(), tasks: FULL, task: demo() }, surface, undefined, { epic: 'tA' })
    const ui = await pane($, surface)
    const key = async (text: string) => {
      await ui.input({ key: 'keys', text, kind: 'change' })
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

  test(`${surface}: g opens graph-status with run file`, async ($, on) => {
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

  test(`${surface}: g without run file makes no call`, async ($, on) => {
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
