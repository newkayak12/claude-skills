import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

type Run = { exitCode: number; stdout: string; stderr: string }
const ok = (stdout: string): Run => ({ exitCode: 0, stdout, stderr: '' })

// The engine beneath the plugin: surfaces, cwd, process.run, toast, status, command.register.
function world(on: On, surfaces: readonly ('terminal' | 'desktop')[], runs: (argv: readonly string[]) => Run) {
  const seen = { argv: [] as (readonly string[])[], toasts: [] as string[], statuses: [] as (string | undefined)[], commands: [] as string[], inFlight: 0, maxInFlight: 0 }
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

test('terminal: /teams-live is registered and the tick runs view.mjs from the plugin root', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const seen = world(on, ['terminal'], () => ok(''))
  await start($)
  expect(seen.commands).toEqual(['teams-live'])
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
  expect(seen.statuses).toEqual(['needs you: 2 waiting - open /teams-live'])
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
const stat = (over: Record<string, unknown> = {}) => ({ line: 'teams: E-3a3a3bb5 12/17 ', waiting: 0, latest: '3a3a3bb5-f4b7', ...over })

const LEAKS = ['verdict=', 'match=', '/Users/', '/var/', 'dispatch:', 'gate:goal', 'accept:']
const EN_UI = ['Now', 'You', 'Stages', 'Work', 'Cost', 'Summary', 'Log', 'needs you', 'more in other runs', 'running', 'stalled', 'finished']

// Engine beneath: a Map-backed $.state, process.run for view.mjs (status and summary answer the same
// fixture), ui.open and ui.status recorded.
function uiWorld(on: On, init: Record<string, unknown> = {}, surfaces: readonly ('terminal' | 'desktop')[] = ['terminal'], data: { status?: Record<string, unknown>; task?: unknown; reports?: Record<string, unknown>; events?: unknown[]; failReport?: boolean } = {}) {
  const store = new Map<string, unknown>(Object.entries(init))
  const seen = { store, argv: [] as (readonly string[])[], opened: [] as string[], statuses: [] as (string | undefined)[] }
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
    return { value: ok(format === 'status' ? JSON.stringify(status()) : format === 'summary' ? JSON.stringify({ status: status(), task: data.task ?? null }) : '') }
  })
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)
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
  $.ui.mount({ plugin: 'teams', surface, component: 'Pane', requestId: 'teams-live', props: { title: 'Teams', isFocused: false, bodyColumns: 80, placement: 'dock' } } as never)
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
async function seeded($: Engine, on: On, data: { status?: Record<string, unknown>; task?: unknown; reports?: Record<string, unknown>; events?: unknown[]; failReport?: boolean }, surface: (typeof SURFACES)[number] = 'terminal', language?: string, init: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: 1000 })
  startWorld(on, language)
  const seen = uiWorld(on, { watch: ['abc'], ...init }, [surface], data)
  on('ui.panes', () => ({ value: [{ id: 'teams-live', title: 'Teams', isPlaced: true }] }) as never)
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

  test(`${surface}: tabs sit above the body as plain hotkey tabs; the selected one is full strength with a dot`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo() }, surface)
    const ui = await pane($, surface)
    const tab = async (key: string) => (await ui.find({ key }))?.props
    expect(await tab('summary')).toMatchObject({ plain: true, hotkey: '1', dimColor: false, label: '● Summary' })
    expect(await tab('work')).toMatchObject({ plain: true, hotkey: '2', dimColor: true, label: 'Work' })
    const text = await shown(ui)
    expect(text.indexOf('Summary')).toBeLessThan(text.indexOf('Now'))
    await ui.press({ key: 'work' })
    await ui.redraw() // the stubbed $.state does not notify readers
    expect(await tab('work')).toMatchObject({ dimColor: false, label: '● Work' })
    expect(await tab('summary')).toMatchObject({ dimColor: true, label: 'Summary' })
  })

  test(`${surface}: Work tab is a board: To do / Doing / Done columns with counts, a failed card under To do`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo({ work: [failedCard, card('module b', 'package', 'done'), card('module c', 'package', 'done')] }) }, surface)
    const ui = await pane($, surface)
    await ui.press({ key: 'work' })
    await ui.redraw()
    for (const head of ['To do 1', 'Doing 0', 'Done 2']) expect(await ui.find({ type: 'Text', text: head })).toBeDefined()
  })

  test(`${surface}: Work tab has a line per card and a reason only under a failed one; Log tab has time and sentence`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo({ work: [failedCard, card('module b', 'package', 'done')] }) }, surface)
    const ui = await pane($, surface)
    expect(await ui.find({ key: 'work' })).toBeDefined()
    await ui.press({ key: 'work' })
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
    expect(seen.opened).toEqual(['teams-live'])
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

  test(`${surface}: language korean draws no English UI word and the 요약 tab`, async ($, on) => {
    await seeded($, on, { status: stat({ waiting: 2 }), task: demo({ work: [failedCard] }) }, surface, 'korean')
    const texts = [await shown(await pane($, surface)), await shown(await band($, surface))]
    for (const text of texts) for (const word of EN_UI) expect(text).not.toContain(word)
    expect(texts[0]).toContain('요약')
    expect(texts[0]).toContain('Build the expense tracker')
  })
}

for (const language of ['English', undefined]) {
  test(`language ${language ?? 'unset'}: the pane shows Summary`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo() }, 'terminal', language)
    const text = await shown(await pane($, 'terminal'))
    expect(text).toContain('Summary')
    expect(text).not.toContain('요약')
  })
}

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
  on('ui.panes', () => ({ value: isOpen ? [{ id: 'teams-live', title: 'Teams', isPlaced: true }] : [] }) as never)
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

test('tick: pane open: one --format summary call with --task paneTask; no --view, no status call', async ($, on) => {
  const w = await tickWorld($, on, { watch: ['abc'] }, true)
  await w.tick()
  await w.tick()
  for (const calls of w.ticks) {
    expect(calls).toHaveLength(1)
    expect(formatOf(calls[0]!)).toBe('summary')
    expect(calls[0]![calls[0]!.indexOf('--task') + 1]).toBe('abc')
  }
  expect(w.seen.argv.some(a => a.includes('--view'))).toBe(false)
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

test('/teams-live answers and opens the pane; session start alone opens nothing', async ($, on) => {
  const seen = uiWorld(on)
  startWorld(on)
  await start($)
  expect(seen.opened).toEqual([])
  const r = await $.command.run({ command: 'teams-live', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(seen.opened).toEqual(['teams-live'])
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

test('/teams-live: Korean reply and description have no English, no teams prefix, no status-line claim', async ($, on) => {
  uiWorld(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('settings.read', () => ({ value: { language: 'korean' } }) as never)
  let description = ''
  on('command.register', (_$, e) => {
    description = String((e as unknown as { description?: string }).description)
    return { value: { command: e.name } }
  })
  await start($)
  const r = JSON.stringify(await $.command.run({ command: 'teams-live', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never))
  expect(r.replace(/"text"/, "")).not.toMatch(/[A-Za-z]{4}/)
  expect(description).not.toMatch(/[A-Za-z]{4}/)
})

test('/teams-live: English reply has no teams prefix and no status-line claim', async ($, on) => {
  const seen = uiWorld(on)
  startWorld(on)
  await start($)
  const r = JSON.stringify(await $.command.run({ command: 'teams-live', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never))
  expect(seen.opened).toEqual(['teams-live'])
  expect(r).not.toContain('teams-live')
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
    expect((await ui.find({ key: 'report' }))?.props).toMatchObject({ plain: true, hotkey: '4', label: 'Report' })
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
    expect(seen.store.get('report')).toMatchObject({ task_id: 'tee' })
    expect(seen.store.get('ended')).toEqual({ tee: 'card' })
    const b = await band($, surface)
    const text = await shown(b)
    for (const word of ['finished', 'failed 2', 'module b: tests red', 'module c: never dispatched', 'D1 b.txt never wired', '+2 more']) expect(text).toContain(word)
    expect(await labels(b)).toEqual(['report', '×'])
    expect(await b.find({ text: 'engine band' })).toBeDefined()
    await b.press({ key: 'report' })
    expect(seen.opened).toEqual(['teams-live'])
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
