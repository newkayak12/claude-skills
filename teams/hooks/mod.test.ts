import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { frame, draw, cells } from './demo-frames.ts'
import { STRINGS, SUBJECT_KEY } from './mod'
import { ALLOW, hangulIn, latinOutside } from './lang-allow'
import { STORY_LOG_KEYS } from '../scripts/lib/view-events.mjs'
import { askBandShown, carriesInput, f2Key, HOME, levelOf, nextFlag, PAGE_KEYS, pageEsc, pageKey, pageStep, paneSlash, reconcileEpic, selectedOf, startNav, statusAnswer } from './pane'
import type { Page, PageName, PageNav, RowRef, StepCtx } from './pane'
import { NOW_KINDS } from '../scripts/lib/view-summary.mjs'
import { KEYS_CHROME, SPINNER, clipText, columnWidths, crumbFit, footerPlan, handoffCells, homeRows, padText, plain, rowLine, storyReportLines, width, workerCells } from './teams-draw'

const SURFACES = ['terminal', 'desktop', 'mobile', 'vscode'] as const
type Surface = (typeof SURFACES)[number]
type Run = { exitCode: number; stdout: string; stderr: string }
const ok = (stdout: string): Run => ({ exitCode: 0, stdout, stderr: '' })

// the files fs.exists reports as present; a test changes it and puts the default back
const DEFAULT_MARKERS = ['/proj/.claude/team.json']
let markers = new Set(DEFAULT_MARKERS)
// armed by the HARNESS_TASKS_DIR read, so the next session.cwd read (the one inside viewOnce) throws once
const cwdFails = { armed: false }

// The engine beneath the plugin: surfaces, cwd, process.run, toast, status, command.register.
function world(on: On, surfaces: readonly Surface[], runs: (argv: readonly string[]) => Run, cwd = '/proj') {
  const seen = { argv: [] as (readonly string[])[], toasts: [] as string[], toastEvents: [] as { text: string; timeoutMs?: number }[], statuses: [] as (string | undefined)[], commands: [] as string[], inFlight: 0, maxInFlight: 0 }
  on('fs.exists', (_$, e) => ({ value: markers.has(e.path) }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.cwd', () => {
    if (cwdFails.armed) {
      cwdFails.armed = false
      throw new Error('cwd gone')
    }
    return { value: cwd }
  })
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

// the no-spawn gate: a folder that does not use teams never runs view.mjs
async function gated(on: On, files: string[], watched: string[] = []) {
  markers = new Set(files)
  const clock = mock.clock(on, { now: 1000 })
  const seen = world(on, ['terminal'], () => ok(''))
  on('ui.panes', () => ({ value: [] }) as never)
  if (watched.length > 0) on('state.get', (_$, e) => ({ value: { value: e.key === 'watch' ? watched : undefined, version: 0 } }) as never)
  return { clock, seen }
}

test('gate: no marker, pane closed, nothing watched: no spawn', async ($, on) => {
  try {
    const { clock, seen } = await gated(on, [])
    await start($)
    await clock.advance(15000)
    expect(seen.argv).toHaveLength(0)
  } finally {
    markers = new Set(DEFAULT_MARKERS)
  }
})

test('gate: .claude/team.json in cwd runs the poll', async ($, on) => {
  const { clock, seen } = await gated(on, ['/proj/.claude/team.json'])
  await start($)
  await clock.advance(3000)
  expect(seen.argv.some(isEvents)).toBe(true)
})

for (const parent of ['/.claude/team.json', '/.harness-run', '/proj/.teams_output']) {
  test(`gate: a marker at ${parent} runs the poll`, async ($, on) => {
    try {
      const { clock, seen } = await gated(on, [parent])
      await start($)
      await clock.advance(3000)
      expect(seen.argv.some(isEvents)).toBe(true)
    } finally {
      markers = new Set(DEFAULT_MARKERS)
    }
  })
}

test('gate: a watched EPIC runs the poll without a marker', async ($, on) => {
  try {
    const { clock, seen } = await gated(on, [], ['abc'])
    await start($)
    await clock.advance(3000)
    expect(seen.argv.some(isEvents)).toBe(true)
  } finally {
    markers = new Set(DEFAULT_MARKERS)
  }
})

test('gate: a marker added later is seen after the 30 s cache window, not within it', async ($, on) => {
  try {
    const { clock, seen } = await gated(on, [])
    await start($)
    await clock.advance(3000)
    markers = new Set(['/proj/.claude/team.json'])
    await clock.advance(15000)
    expect(seen.argv).toHaveLength(0)
    await clock.advance(15000)
    expect(seen.argv.some(isEvents)).toBe(true)
  } finally {
    markers = new Set(DEFAULT_MARKERS)
  }
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

test('the poll does not overlap: a slow view.mjs holds the next ticks off until it returns', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  const calls: (readonly string[])[] = []
  let release: () => void = () => {}
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  on('process.run', async (_$, e) => {
    calls.push(e.argv)
    await held
    return { value: ok('') }
  })
  await start($)
  await clock.advance(30000)
  expect(calls).toHaveLength(1)
  release()
  await clock.advance(3000)
  expect(calls.length > 1).toBe(true)
})

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
// The words a person or the engine wrote (fixture data): shown as written in both languages, so the Korean scan skips them.
// Longest first: 'module b: tests red' must go before 'module b'.
const LANG_DATA = [
  'Build the expense tracker', 'b.txt not wired to the exported path', 'verifier rejected: tests red', 'module b: tests red', 'module c: never dispatched',
  'D1 b.txt never wired', 'keep the old cache key format?', 'one open question', 'asks a question', 'editing parser.ts', 'editing a.ts', 'reading',
  'module a', 'module b', 'module c', 'cache layer', 'parser module', 'report writer', 'Receipts upload', 'plan feature 1', 'QA feature 1', 'Planning audit',
  'All packages shipped.', 'reject: overlap', 'AC 3 missing', 'AC 3 untested', 'reply was not JSON', 'accept:P1:1', 'codex·gpt-5', 'claude·opus', 'claude·sonnet',
  'task tA', 'small thing', 'rename the config key', 'old import job',
].sort((a, b) => b.length - a.length)
// what a person reads of a drawn tree: Text strings, a Button's label, an Input's placeholder, Markdown and Code text; never an Svg's source or alt
const visible = (tree: unknown): string => {
  const out: string[] = []
  const walk = (n: any): void => {
    if (n === null || n === undefined || n === false) return
    if (typeof n === 'string' || typeof n === 'number') return void out.push(String(n))
    if (Array.isArray(n)) return void n.forEach(walk)
    if (n.type === 'Svg') return
    if (n.type === 'Button') out.push(String(n.props?.label ?? ''))
    else if (n.type === 'Input') out.push(String(n.props?.placeholder ?? ''))
    else if (n.type === 'Markdown' || n.type === 'Code') out.push(String(n.props?.text ?? n.props?.source ?? ''))
    else if (n.type === 'Link') out.push(String(n.props?.label ?? n.props?.text ?? ''))
    walk(n.children)
  }
  walk(tree)
  return out.join('\n')
}

// Engine beneath: a Map-backed $.state, process.run for view.mjs (status and summary answer the same
// fixture), ui.open and ui.status recorded.
type Data = { status?: Record<string, unknown>; tasks?: unknown[]; task?: unknown; teams?: unknown; dash?: unknown; decisions?: (card: string | null) => unknown; stories?: Record<string, unknown>; storyReports?: Record<string, unknown>; reports?: Record<string, unknown>; events?: unknown[]; failReport?: boolean; isUnplaced?: boolean; surfacesThrow?: boolean; plain?: Run; answer?: (argv: readonly string[]) => Run }
function uiWorld(on: On, init: Record<string, unknown> = {}, surfaces: readonly Surface[] = ['terminal'], data: Data = {}) {
  const store = new Map<string, unknown>(Object.entries(init))
  const seen = { store, argv: [] as (readonly string[])[], opened: [] as string[], openArgs: [] as unknown[], statuses: [] as (string | undefined)[] }
  const status = () => data.status ?? { line: '', waiting: 0 }
  on('session.surfaces', () => {
    if (data.surfacesThrow) throw new Error('surfaces')
    return { value: surfaces }
  })
  on('state.get', (_$, e) => ({ value: { value: store.get(e.key), version: 0 } }) as never)
  on('state.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } } as never
  })
  on('process.run', (_$, e) => {
    seen.argv.push(e.argv)
    // the answer CLI (scripts/answer.mjs): the fixture's answer, else a refusal
    if (String(e.argv[1]).endsWith('/scripts/answer.mjs')) return { value: data.answer?.(e.argv) ?? ok(JSON.stringify({ ok: false, reason: 'no ask card waiting' })) }
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
    // a STORY's payload and report by its Pn (--story), `{ missing: true }` for one the fixture does not hold
    if (format === 'story' || format === 'story-report') {
      const pn = e.argv[e.argv.indexOf('--story') + 1]!
      return { value: ok(JSON.stringify((format === 'story' ? data.stories : data.storyReports)?.[pn] ?? { story: pn, missing: true })) }
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
  on('fs.exists', (_$, e) => ({ value: markers.has(e.path) }) as never)
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
  test(`${surface}: session start alone opens no pane`, async ($, on) => {
    const seen = uiWorld(on, {}, [surface])
    startWorld(on)
    await start($)
    expect(seen.opened).toEqual([])
  })

  test(`${surface}: no Button label in the pane or the band holds a bracket`, async ($, on) => {
    await seeded($, on, { status: stat({ waiting: 1 }), task: demo() }, surface)
    const all = [...(await labels(await pane($, surface))), ...(await labels(await band($, surface)))]
    expect(all.length >= 2).toBe(true)
    expect(all.filter(l => l.includes('[') || l.includes(']'))).toEqual([])
  })

  test(`${surface}: no watched task and no cwd task draws the no-run text (regression guard)`, async ($, on) => {
    const seen = uiWorld(on)
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: 'No teams run in this session.' })).toBeDefined()
    expect(seen.argv).toHaveLength(0)
  })

  test(`${surface}: the no-run view closes on q where an Input is carried; the close Button and no keys Input on mobile`, async ($, on) => {
    const closed: string[] = []
    on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
    uiWorld(on)
    const ui = await pane($, surface)
    if (!carriesInput(surface)) {
      expect(await ui.find({ key: 'keys' })).toBeUndefined()
      expect((await ui.find({ key: 'close' }))?.props).toMatchObject({ role: 'dismiss', label: 'close' })
      await ui.press({ key: 'close' })
      expect(closed).toEqual(['teams-status'])
      return
    }
    expect(await ui.find({ key: 'close' })).toBeUndefined()
    expect((await ui.find({ key: 'keys' }))?.props.autoFocus).toBe(true)
    await ui.input({ key: 'keys', text: 'w', kind: 'change' } as never)
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
    expect(await typed('w')).toBe('') // a handled key that does nothing here
    expect(await typed('a')).toBe('')
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
    expect(await typed('/xq')).toBe('/xq') // `/x` then q: pageKey is null on a `/`, so q is held
    expect(closed).toEqual([])
    // w s d a n l: the buffer is cleared every time, whole (0-5, [ ], j k and g are no key: the text stays)
    for (const key of ['w', 's', 'd', 'a', 'n', 'l', 'xw']) {
      expect(await typed(key)).toBe('')
      expect(closed).toEqual([])
    }
    for (const key of ['0', '5', '[', ']', 'j', 'k', 'g']) expect(await typed(key)).toBe(key)
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

test('the band [board] opens the pane on HOME, wherever it was left', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  startWorld(on)
  const seen = uiWorld(on, { watch: ['abc'], page: { name: 'FLOOR', epic: 'tA', story: null, phase: null }, pageFrom: null }, ['terminal'], { status: stat(), task: demo() })
  on('ui.panes', () => ({ value: [] }) as never)
  engineBand(on)
  await start($)
  await clock.advance(3000)
  await clock.advance(3000)
  await (await band($, 'terminal')).press({ key: 'board' })
  expect(seen.opened).toEqual(['teams-status'])
  expect(seen.store.get('page')).toEqual({ name: 'HOME', epic: null, story: null, phase: null })
})

test('q closes the pane; /teams-status on an open pane closes it', async ($, on) => {
  const closed: string[] = []
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
  await seeded($, on, { status: stat(), task: demo() })
  const ui = await pane($, 'terminal')
  // the Input carries q (its footer says so); the close Button is the mobile one
  expect(await ui.find({ key: 'close' })).toBeUndefined()
  expect(String((await ui.find({ key: 'keys' }))?.props.placeholder ?? '')).toContain('w s move')
  await ui.input({ key: 'keys', text: 'q', kind: 'change' } as never)
  expect(closed).toEqual(['teams-status'])
  const mobile = await pane($, 'mobile')
  await mobile.press({ key: 'close' })
  expect(closed).toEqual(['teams-status', 'teams-status'])
  const r = await $.command.run({ command: 'teams-status', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(closed).toEqual(['teams-status', 'teams-status', 'teams-status'])
  expect(JSON.stringify(r)).toContain('pane closed')
})

// the pane's Input is focused on open: q and the letters reach it as text, so they are read there, not as Button hotkeys
test('with the Input focused: q closes; the old digit keys do nothing; /teams-status submitted closes; /other runs that command', async ($, on) => {
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
  // the six tabs are gone: digits, brackets, j k and g reach nothing
  for (const key of ['0', '1', '2', '3', '4', '5', '[', ']', 'j', 'k', 'g']) {
    await typed(key)
    expect(await labels(ui)).toEqual(['l EN'])
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
  await typed('x', 'submit') // not a command: Enter opens the selected row, and there is none
  expect(closed).toEqual(['teams-status'])
  await typed('q')
  expect(closed).toEqual(['teams-status', 'teams-status'])
})

test('pageKey and paneSlash: q closes, the old tab keys are none, a `/` holds the keys, the command starts at the first `/`', () => {
  expect(pageKey('q')).toEqual({ kind: 'close' })
  expect(pageKey('][2')).toBeNull()
  expect(pageKey('5')).toBeNull()
  expect(pageKey('/teams-status')).toBeNull()
  expect(pageKey('/help q')).toBeNull()
  expect(pageKey('')).toBeNull()
  expect(pageKey(undefined)).toBeNull()
  expect(paneSlash('/teams-status')).toEqual({ kind: 'close' })
  expect(paneSlash('][2q/teams-status ')).toEqual({ kind: 'close' })
  expect(paneSlash('/help me now')).toEqual({ kind: 'run', command: 'help', args: 'me now' })
  expect(paneSlash('jk')).toBeNull()
  expect(paneSlash('/')).toBeNull()
  expect(paneSlash(3)).toBeNull()
})

// ---- F2 page stack: pane.ts helpers (F2-AC-7..19) ----
const nav0 = () => startNav()
const ctxOf = (o: Partial<StepCtx> = {}): StepCtx => ({ ids: [], row: null, flags: [], maxScroll: 0, ...o })
const at = (name: PageName, epic: string | null = 'E1', story: string | null = null, phase: number | null = null): Page => ({ name, epic, story, phase })
const on = (page: Page, o: Partial<PageNav> = {}): PageNav => ({ ...nav0(), page, ...o })
const ENDED: RowRef = { type: 'epic', epic: 'E2', ended: true, unfolded: false }

test('F2 keys: pageKey maps w s d Enter a n q l, ignores the old keys, holds on `/`, is silent while answering', () => {
  expect(pageKey('w')).toEqual({ kind: 'move', by: -1 })
  expect(pageKey('s')).toEqual({ kind: 'move', by: 1 })
  expect(pageKey('d')).toEqual({ kind: 'open' })
  expect(pageKey('\r')).toEqual({ kind: 'open' })
  expect(pageKey('a')).toEqual({ kind: 'back' })
  expect(pageKey('n')).toEqual({ kind: 'nextFlag' })
  expect(pageKey('q')).toEqual({ kind: 'close' })
  expect(pageKey('l')).toEqual({ kind: 'lang' })
  for (const old of ['0', '1', '5', '[', ']', 'j', 'k', 'g']) expect(pageKey(old)).toBeNull()
  expect(pageKey('/w')).toBeNull()
  expect(pageKey(undefined)).toBeNull()
  expect(pageKey('')).toBeNull()
  for (const c of ['q', 'w', 'a', 's', 'd', 'n', 'l']) expect(pageKey(c, { answering: true })).toBeNull()
})

test('F2 keys: each char of PAGE_KEYS serves one kind, and Enter is open', () => {
  const kinds = Object.entries(PAGE_KEYS).filter(([c]) => c !== '\r' && c !== '\n').map(([, v]) => v.kind)
  expect(new Set(kinds).size).toBe(kinds.length - 1) // w and s both move
  expect(PAGE_KEYS['\n']).toEqual({ kind: 'open' })
})

test('F2 keys: f2Key maps a dotted engine key to the table key and leaves other text alone', () => {
  expect(f2Key('F2.log.attemptStart')).toBe('f2LogAttemptStart')
  expect(f2Key('F2.phase.name.qa')).toBe('f2PhaseNameQa')
  expect(f2Key('nextShape')).toBe('nextShape')
  for (const k of STORY_LOG_KEYS) expect(f2Key(k) in STRINGS.en ? 1 : `no table key for ${k}`).toBe(1)
})

test('F2 move: w and s step the selected row and stop at both ends (no wrap)', () => {
  const ids = ['a', 'b', 'c']
  let nav = on(HOME, { sel: { [levelOf(HOME)]: 'a' } })
  nav = pageStep(nav, { kind: 'move', by: 1 }, ctxOf({ ids })).nav
  expect(nav.sel[levelOf(HOME)]).toBe('b')
  nav = pageStep(nav, { kind: 'move', by: 1 }, ctxOf({ ids })).nav
  nav = pageStep(nav, { kind: 'move', by: 1 }, ctxOf({ ids })).nav
  expect(nav.sel[levelOf(HOME)]).toBe('c')
  nav = pageStep(nav, { kind: 'move', by: -1 }, ctxOf({ ids })).nav
  nav = pageStep(nav, { kind: 'move', by: -1 }, ctxOf({ ids })).nav
  nav = pageStep(nav, { kind: 'move', by: -1 }, ctxOf({ ids })).nav
  expect(nav.sel[levelOf(HOME)]).toBe('a')
})

test('F2 move: with nothing selected the first press selects the first row; an empty list selects nothing', () => {
  expect(pageStep(nav0(), { kind: 'move', by: 1 }, ctxOf({ ids: ['a', 'b'] })).nav.sel[levelOf(HOME)]).toBe('b')
  expect(pageStep(nav0(), { kind: 'move', by: 1 }, ctxOf()).nav.sel).toEqual({})
})

test('F2 move: on Log, Report and Phase detail w and s scroll, clamped to 0..maxScroll', () => {
  for (const name of ['LOG', 'STORY_REPORT', 'EPIC_REPORT', 'PHASE'] as const) {
    const page = at(name, 'E1', 'P1', 2)
    let nav = on(page)
    const level = levelOf(page)
    nav = pageStep(nav, { kind: 'move', by: -1 }, ctxOf({ maxScroll: 2 })).nav
    expect(nav.scroll[level] ?? 0).toBe(0)
    for (let i = 0; i < 5; i += 1) nav = pageStep(nav, { kind: 'move', by: 1 }, ctxOf({ maxScroll: 2 })).nav
    expect(nav.scroll[level]).toBe(2)
    nav = pageStep(nav, { kind: 'move', by: -1 }, ctxOf({ maxScroll: 2 })).nav
    expect(nav.scroll[level]).toBe(1)
    expect(Object.keys(nav.sel)).toEqual([]) // no row moved
  }
})

test('F2 open: HOME rows open FLOOR (EPIC), STORY detail (STORY), answer mode (ask flag), STORY or FLOOR (other flag)', () => {
  const go = (row: RowRef) => pageStep(nav0(), { kind: 'open' }, ctxOf({ row })).nav
  expect(go({ type: 'epic', epic: 'E1', ended: false, unfolded: false }).page).toEqual(at('FLOOR'))
  expect(go({ type: 'epic', epic: 'E2', ended: true, unfolded: true }).page).toEqual(at('FLOOR', 'E2'))
  expect(go({ type: 'story', epic: 'E1', story: 'P2' }).page).toEqual(at('STORY', 'E1', 'P2'))
  expect(go({ type: 'flag', epic: 'E1', story: 'P2', ask: true }).page).toEqual(at('ANSWER', 'E1', 'P2'))
  expect(go({ type: 'flag', epic: 'E1', story: 'P2', ask: false }).page).toEqual(at('STORY', 'E1', 'P2'))
  expect(go({ type: 'flag', epic: 'E1', story: null, ask: false }).page).toEqual(at('FLOOR'))
})

test('F2 open: FLOOR opens Phase detail, and Phase 6 opens the EPIC report', () => {
  const nav = on(at('FLOOR'))
  expect(pageStep(nav, { kind: 'open' }, ctxOf({ row: { type: 'phase', epic: 'E1', phase: 2 } })).nav.page).toEqual(at('PHASE', 'E1', null, 2))
  expect(pageStep(nav, { kind: 'open' }, ctxOf({ row: { type: 'phase', epic: 'E1', phase: 6 } })).nav.page).toEqual(at('EPIC_REPORT'))
})

test('F2 open: on STORY detail the Log, Report and answer rows open their pages, any other row and no row open nothing', () => {
  const nav = on(at('STORY', 'E1', 'P1'))
  const row = (r: 'log' | 'report' | 'answer' | 'other'): RowRef => ({ type: 'storyRow', epic: 'E1', story: 'P1', row: r })
  expect(pageStep(nav, { kind: 'open' }, ctxOf({ row: row('log') })).nav.page).toEqual(at('LOG', 'E1', 'P1'))
  expect(pageStep(nav, { kind: 'open' }, ctxOf({ row: row('report') })).nav.page).toEqual(at('STORY_REPORT', 'E1', 'P1'))
  expect(pageStep(nav, { kind: 'open' }, ctxOf({ row: row('answer') })).nav.page).toEqual(at('ANSWER', 'E1', 'P1'))
  expect(pageStep(nav, { kind: 'open' }, ctxOf({ row: row('other') })).nav).toBe(nav)
  expect(pageStep(nav, { kind: 'open' }, ctxOf({ row: null })).nav).toBe(nav)
  const leaf = on(at('LOG', 'E1', 'P1'))
  expect(pageStep(leaf, { kind: 'open' }, ctxOf({ row: null })).nav).toBe(leaf)
})

test('F2 open: d on a folded ended EPIC unfolds it, on an unfolded one it opens FLOOR', () => {
  const nav = pageStep(nav0(), { kind: 'open' }, ctxOf({ row: ENDED })).nav
  expect(nav.page).toEqual(HOME)
  expect(nav.unfolded).toEqual({ E2: true })
  expect(pageStep(nav, { kind: 'open' }, ctxOf({ row: { ...ENDED, unfolded: true } })).nav.page).toEqual(at('FLOOR', 'E2'))
})

test('F2 back: a goes to the page each level came from (FLOOR, STORY -> HOME; Phase, EPIC report -> FLOOR; Log, Report -> STORY)', () => {
  const back = (p: Page) => pageStep(on(p), { kind: 'back' }, ctxOf()).nav.page
  expect(back(at('FLOOR'))).toEqual(HOME)
  expect(back(at('STORY', 'E1', 'P1'))).toEqual(HOME)
  expect(back(at('PHASE', 'E1', null, 2))).toEqual(at('FLOOR'))
  expect(back(at('EPIC_REPORT'))).toEqual(at('FLOOR'))
  expect(back(at('LOG', 'E1', 'P1'))).toEqual(at('STORY', 'E1', 'P1'))
  expect(back(at('STORY_REPORT', 'E1', 'P1'))).toEqual(at('STORY', 'E1', 'P1'))
})

test('F2 back: answer mode returns to the page it was opened from, by a and by Esc, and Esc keeps the pane open', () => {
  for (const from of [at('STORY', 'E1', 'P1'), HOME]) {
    const row: RowRef = { type: 'flag', epic: 'E1', story: 'P1', ask: true }
    const opened = pageStep(on(from), { kind: 'open' }, ctxOf({ row })).nav
    expect(opened.page.name).toBe('ANSWER')
    const esc = pageEsc(opened)
    expect(esc.closed).toBe(false)
    expect(esc.nav.page).toEqual(from)
    expect(pageStep(opened, { kind: 'back' }, ctxOf()).nav.page).toEqual(from)
    expect(pageEsc(esc.nav).closed).toBe(true) // Esc again, on the page itself, closes
  }
})

test('F2 back: a on HOME folds an unfolded ended EPIC and is a no-op otherwise (nothing hinted, nothing closed)', () => {
  const open = on(HOME, { unfolded: { E2: true } })
  const folded = pageStep(open, { kind: 'back' }, ctxOf({ row: { ...ENDED, unfolded: true } }))
  expect(folded.nav.unfolded).toEqual({})
  expect(pageStep(open, { kind: 'back' }, ctxOf({ row: { type: 'story', epic: 'E2', story: 'P1' } })).nav.unfolded).toEqual({})
  for (const row of [null, { type: 'epic', epic: 'E1', ended: false, unfolded: false } as RowRef, { type: 'flag', epic: 'E1', story: null, ask: false } as RowRef]) {
    const r = pageStep(open, { kind: 'back' }, ctxOf({ row }))
    expect([r.nav, r.closed, r.hint]).toEqual([open, false, null])
  }
  expect(pageStep(on(HOME), { kind: 'back' }, ctxOf({ row: ENDED })).nav.page).toEqual(HOME)
})

test('F2 next flag: n visits the flag rows in list order across EPICs, wraps, and lands on HOME with the row selected', () => {
  const flags = ['flag:E1:P1', 'flag:E2:P3', 'flag:E2:P4']
  let nav = on(at('PHASE', 'E1', null, 2))
  const seen: (string | undefined)[] = []
  for (let i = 0; i < 4; i += 1) {
    nav = pageStep(nav, { kind: 'nextFlag' }, ctxOf({ flags })).nav
    expect(nav.page).toEqual(HOME)
    seen.push(nav.sel[levelOf(HOME)])
  }
  expect(seen).toEqual(['flag:E1:P1', 'flag:E2:P3', 'flag:E2:P4', 'flag:E1:P1'])
  expect(nextFlag(['x'], 'x')).toBe('x') // one flag, already on it: stays
})

test('F2 next flag: none listed moves nothing and says so', () => {
  const nav = on(at('FLOOR'))
  const r = pageStep(nav, { kind: 'nextFlag' }, ctxOf())
  expect([r.nav, r.hint, r.closed]).toEqual([nav, 'noFlag', false])
  expect(nextFlag([], null)).toBeNull()
})

test('F2 close: q closes from every page; l changes nothing the stack holds', () => {
  for (const name of ['HOME', 'FLOOR', 'PHASE', 'STORY', 'LOG', 'STORY_REPORT', 'EPIC_REPORT'] as const) {
    expect(pageStep(on(at(name)), { kind: 'close' }, ctxOf()).closed).toBe(true)
  }
  const nav = on(at('FLOOR'))
  expect(pageStep(nav, { kind: 'lang' }, ctxOf())).toEqual({ nav, closed: false, hint: null })
  expect(pageEsc(on(at('LOG', 'E1', 'P1'))).closed).toBe(true)
})

test('F2 slash: a `/` in the Input holds every page key until Enter, paneSlash still reads the command', () => {
  for (const t of ['/d', '/q', 'w/', '/teams-status n']) expect(pageKey(t)).toBeNull()
  expect(paneSlash('s/teams-status')).toEqual({ kind: 'close' })
})

test('F2 memory: back to a level shows the row selected when it was left, kept by id not index', () => {
  let nav = on(HOME)
  const ids = ['E1', 'E1/P1', 'E1/P2']
  nav = pageStep(nav, { kind: 'move', by: 1 }, ctxOf({ ids })).nav
  expect(selectedOf(nav, ids)).toBe('E1/P1')
  nav = pageStep(nav, { kind: 'open' }, ctxOf({ ids, row: { type: 'story', epic: 'E1', story: 'P1' } })).nav
  expect(nav.page.name).toBe('STORY')
  nav = pageStep(nav, { kind: 'back' }, ctxOf()).nav
  expect(nav.page).toEqual(HOME)
  // HOME redraws with a row inserted above: the same id, not the same index
  const next = ['E0', ...ids]
  expect(selectedOf(nav, next, ids)).toBe('E1/P1')
  // each level keeps its own: STORY detail's selection is separate from HOME's
  expect(Object.keys(nav.sel)).toEqual([levelOf(HOME)])
})

test('F2 memory: a selected row that leaves the list falls to the nearest listed row, never outside it, nothing when empty', () => {
  const nav = on(HOME, { sel: { [levelOf(HOME)]: 'b' } })
  expect(selectedOf(nav, ['a', 'c'], ['a', 'b', 'c'])).toBe('c')
  expect(selectedOf(nav, ['a'], ['a', 'b', 'c'])).toBe('a')
  expect(selectedOf(nav, ['x', 'y'], ['a', 'b', 'c'])).toBe('x')
  expect(selectedOf(on(HOME), ['x'])).toBe('x')
  expect(selectedOf(nav, [], ['a', 'b'])).toBeNull()
  expect(pageStep(nav, { kind: 'open' }, ctxOf({ ids: [], row: null })).nav).toBe(nav) // empty list: open does nothing
})

test('F2 memory: an EPIC that leaves the listing sends the pane to HOME with HOME\'s remembered row', () => {
  const nav = on(at('PHASE', 'E1', null, 3), { sel: { [levelOf(HOME)]: 'E1' }, from: at('FLOOR') })
  const gone = reconcileEpic(nav, ['E2'])
  expect(gone.page).toEqual(HOME)
  expect(gone.sel[levelOf(HOME)]).toBe('E1')
  expect(reconcileEpic(nav, ['E1', 'E2'])).toBe(nav)
  const home = on(HOME)
  expect(reconcileEpic(home, [])).toBe(home)
})

test('F2 fold: the unfolded set is a plain record by EPIC id, so $.state keeps it across a closed pane', () => {
  const nav = pageStep(nav0(), { kind: 'open' }, ctxOf({ row: ENDED })).nav
  const again = startNav(JSON.parse(JSON.stringify(nav.unfolded)))
  expect(again.unfolded).toEqual({ E2: true })
  expect(pageStep(again, { kind: 'back' }, ctxOf({ row: { ...ENDED, unfolded: true } })).nav.unfolded).toEqual({})
})

// ---- F4 lang: `l` and the footer Button switch every surface between English and Korean ----
// the engine beneath for session.start: the setting is read from `setting()` each time, so a test changes it between starts
function langStart(on: On, setting: () => unknown, commands: string[] = []) {
  on('fs.exists', (_$, e) => ({ value: markers.has(e.path) }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('command.register', (_$, e) => {
    commands.push(`${e.name}: ${(e as { description?: string }).description}`)
    return { value: { command: e.name } }
  })
  on('settings.read', () => ({ value: setting() }) as never)
}
// a seeded pane world whose command.register is recorded, so a re-registration is seen
async function langPane($: Engine, on: On, data: Data, surfaces: readonly Surface[] = ['terminal'], init: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: 1000 })
  const commands: string[] = []
  langStart(on, () => ({}), commands)
  const seen = uiWorld(on, { watch: ['abc'], ...init }, surfaces, data)
  on('ui.panes', () => ({ value: [{ id: 'teams-status', title: 'Teams', isPlaced: true }] }) as never)
  on('ui.close', () => ({ value: undefined }))
  engineBand(on)
  await start($)
  await clock.advance(3000)
  return { seen, commands, tick: () => clock.advance(3000) }
}
const typeKey = async (ui: Ui, text: string) => {
  await ui.input({ key: 'keys', text, kind: 'change' } as never)
  await ui.redraw()
}

test('F4 lang: pageKey(l) is the lang key', () => {
  expect(pageKey('l')).toEqual({ kind: 'lang' })
  expect(pageKey('wl')).toEqual({ kind: 'lang' })
})

test('F4 lang: text holding a / and answer mode are no key', () => {
  expect(pageKey('/teams-status l')).toBeNull()
  expect(pageKey('l', { answering: true })).toBeNull()
  expect(pageKey('q', { answering: true })).toBeNull()
  expect(pageKey('q', { answering: false })).toEqual({ kind: 'close' })
})

test('F4 lang: PAGE_KEYS gives l to lang alone and each char one kind, matching pageKey', () => {
  expect(PAGE_KEYS['l']).toEqual({ kind: 'lang' })
  expect(Object.entries(PAGE_KEYS).filter(([, v]) => v.kind === 'lang').map(([c]) => c)).toEqual(['l'])
  for (const [c, v] of Object.entries(PAGE_KEYS)) {
    expect([...c]).toHaveLength(1)
    expect(pageKey(c)).toEqual(v)
  }
  expect(Object.keys(PAGE_KEYS).sort()).toEqual(['\n', '\r', 'a', 'd', 'l', 'n', 'q', 's', 'w'])
})

test('F4 lang: the setting ko, korean, 한국어 and KO choose Korean; en, ja, unset and a throw choose English', async ($, on) => {
  let setting: string | undefined
  mock.clock(on, { now: 1000 })
  langStart(on, () => {
    if (setting === 'throw') throw new Error('settings gone')
    return setting === undefined ? {} : { language: setting }
  })
  const seen = uiWorld(on, {}, ['terminal'], {})
  for (const [value, want] of [['ko', 'ko'], ['korean', 'ko'], ['한국어', 'ko'], ['KO', 'ko'], ['en', 'en'], ['ja', 'en'], [undefined, 'en'], ['throw', 'en']] as const) {
    setting = value
    await start($)
    expect([value, seen.store.get('lang')]).toEqual([value, want])
  }
})

test('F4 lang: the choice survives a pane close and reopen', async ($, on) => {
  const { seen } = await langPane($, on, { status: stat(), task: demo() })
  const first = await pane($, 'terminal')
  await typeKey(first, 'l')
  expect(await labels(first)).toContain('l KR')
  await first.unmount()
  const again = await pane($, 'terminal')
  expect(await labels(again)).toContain('l KR')
  expect(seen.store.get('langChosen')).toBe(true)
})

test('F4 lang: a second session.start with another setting keeps the chosen language', async ($, on) => {
  let setting: unknown = { language: 'ko' }
  const clock = mock.clock(on, { now: 1000 })
  void clock
  langStart(on, () => setting)
  const seen = uiWorld(on, {}, ['terminal'], { status: stat(), task: demo() })
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  expect(seen.store.get('lang')).toBe('ko')
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'lang' }) // ko -> en, chosen
  expect(seen.store.get('lang')).toBe('en')
  setting = { language: 'ko' }
  await start($)
  expect(seen.store.get('lang')).toBe('en')
  setting = { language: 'en' }
  await ui.redraw()
  await ui.press({ key: 'lang' }) // en -> ko
  await start($)
  expect(seen.store.get('lang')).toBe('ko')
})

test('F4 lang: two surfaces mounted: a toggle on the terminal shows on the mobile redraw', async ($, on) => {
  await langPane($, on, { status: stat(), task: demo() }, ['terminal', 'mobile'])
  const term = await pane($, 'terminal')
  const phone = await pane($, 'mobile')
  expect(await labels(phone)).toContain('EN')
  await typeKey(term, 'l')
  await phone.redraw()
  expect(await labels(phone)).toContain('KR')
  expect(await labels(phone)).toContain(STRINGS.ko.f2BtnOpen)
  expect(await labels(term)).toContain('l KR')
})

test('F4 lang: the mobile Button KR flips, bare label, no Input', async ($, on) => {
  const { seen } = await langPane($, on, { status: stat(), task: demo() }, ['mobile'])
  const ui = await pane($, 'mobile')
  expect(await ui.find({ key: 'keys' })).toBeUndefined()
  expect((await ui.find({ key: 'lang' }))?.props).toMatchObject({ plain: true, dimColor: true, label: 'EN' })
  await ui.press({ key: 'lang' })
  await ui.redraw()
  expect((await ui.find({ key: 'lang' }))?.props.label).toBe('KR')
  expect(seen.store.get('lang')).toBe('ko')
  await ui.press({ key: 'lang' })
  await ui.redraw()
  expect((await ui.find({ key: 'lang' }))?.props.label).toBe('EN')
  // after close, on every surface, as the last two footer Buttons
  expect((await ui.findAll({ type: 'Button' })).slice(-2).map(b => b.props.key)).toEqual(['close', 'lang'])
})

test('F4 lang: the toggle changes lang, langChosen and typed in state and runs no process', async ($, on) => {
  const { seen } = await langPane($, on, { status: stat(), task: demo() })
  const ui = await pane($, 'terminal')
  const before = new Map(seen.store)
  const calls = seen.argv.length
  await typeKey(ui, 'l')
  const changed = [...seen.store.keys()].filter(k => JSON.stringify(seen.store.get(k)) !== JSON.stringify(before.get(k))).sort()
  expect(changed).toEqual(['lang', 'langChosen', 'typed'])
  expect(seen.store.get('typed')).toBe('')
  expect(seen.argv).toHaveLength(calls)
})

test('F4 lang: the command is registered again with the Korean description', async ($, on) => {
  const { commands } = await langPane($, on, { status: stat(), task: demo() })
  expect(commands).toEqual([`teams-status: ${STRINGS.en.cmdDesc}`])
  await typeKey(await pane($, 'terminal'), 'l')
  expect(commands).toEqual([`teams-status: ${STRINGS.en.cmdDesc}`, `teams-status: ${STRINGS.ko.cmdDesc}`])
})

test('F4 lang: after a toggle the status line, the push and both command replies speak the new language', async ($, on) => {
  // status line and the closing reply (the pane is listed as open)
  const { seen, tick } = await langPane($, on, { status: stat({ waiting: 2 }), task: demo() })
  expect(seen.statuses.at(-1)).toBe(STRINGS.en.statusWaiting.replace('{n}', '2'))
  await typeKey(await pane($, 'terminal'), 'l')
  await tick()
  expect(seen.statuses.at(-1)).toBe(STRINGS.ko.statusWaiting.replace('{n}', '2'))
  const closed = await $.command.run({ command: 'teams-status', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(JSON.stringify(closed)).toContain(STRINGS.ko.paneClosed)
})

test('F4 lang: after a toggle the opened reply speaks the new language', async ($, on) => {
  mock.clock(on, { now: 1000 })
  langStart(on, () => ({}))
  uiWorld(on, {}, ['terminal'], { status: stat(), task: demo() })
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  const r = (): Promise<unknown> => $.command.run({ command: 'teams-status', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(JSON.stringify(await r())).toContain(STRINGS.en.paneOpened)
  await typeKey(await pane($, 'terminal'), 'l')
  expect(JSON.stringify(await r())).toContain(STRINGS.ko.paneOpened)
})

test('F4 lang: after a toggle the push speaks the new language', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { pushes } = pushWorld(on, sentOk, evLines(E1))
  await start($)
  await typeKey(await pane($, 'terminal'), 'l') // the empty view's Input takes `l` too
  await clock.advance(3000)
  await clock.advance(3000)
  expect(pushes).toHaveLength(1)
  // the kind word is the table's; the event's own text after the dash is engine text (U4 keys it)
  expect(pushes[0].message.startsWith(`teams E-aaaaaaaa: ${STRINGS.ko.pushNeedsYou} —`)).toBe(true)
})

test('F4 lang: footerPlan returns the marker whole at 42, 110 and 190 columns', () => {
  for (const [inner, steps, open] of [[42 - 4, 2, 'g open run'], [110 - 4, 2, ''], [190 - 4, 2, 'g open run'], [42 - 4, 0, '']] as const) {
    for (const marker of ['l EN', 'l KR', 'EN']) {
      const plan = footerPlan({ steps, open, close: 'q close', hint: '[ ] EPIC · j k row · 0-5 tabs', marker }, inner)
      expect(plan.marker).toBe(marker)
      // the marker's room is reserved: hint + Input chrome + prev/next + open + close + marker + a gap after each fit the line
      const fixed = [steps > 0 ? steps + 2 * (steps - 1) : 0, width(open), 7, width(marker)].filter(n => n > 0)
      if (plan.hint !== '') expect(width(plan.hint) + 10 + fixed.reduce((n, w) => n + w, 0) + 2 * fixed.length).toBeLessThanOrEqual(inner)
    }
  }
  expect(footerPlan({ steps: 2, open: '', close: 'q close', hint: '[ ] EPIC · j k row · 0-5 tabs', marker: 'l EN' }, 190 - 4).hint).toBe('[ ] EPIC · j k row · 0-5 tabs')
  expect(footerPlan({ steps: 2, open: '', close: 'q close', hint: '[ ] EPIC · j k row · 0-5 tabs', marker: 'l EN' }, 42 - 4).hint).toBe('[ ] EP…')
})

test('footerPlan: the key hint keeps what the marker and close leave, cut with … and dropped under 6 columns', () => {
  const hint = STRINGS.en.f2FootHome
  const marker = 'l EN'
  expect(footerPlan({ steps: 0, open: '', close: '', hint, marker }, 100).hint).toBe(hint)
  const cut = footerPlan({ steps: 2, open: '', close: 'q close', hint, marker }, 42).hint
  expect(cut).toBe('q close')
  expect(width(cut) + 10 + 4 + 7 + 4 + 4 + 2).toBeLessThanOrEqual(42) // hint + Input chrome + prev/next + close + marker + gaps
  expect(footerPlan({ steps: 2, open: 'g open run', close: 'q close', hint, marker }, 30).hint).toBe('')
})

test('pane helpers: real page footers drop detail first and keep a/q segments whole', () => {
  for (const lang of ['en', 'ko'] as const) for (const inner of [46, 60, 106]) {
    for (const hint of [STRINGS[lang].f2FootHome, STRINGS[lang].f2FootFloor, STRINGS[lang].f2FootStory, STRINGS[lang].f2FootScroll]) {
      const result = footerPlan({ steps: 0, open: '', close: '', hint, marker: 'l EN' }, inner, 0) // the call the pane makes
      expect(width(result.hint)).toBeLessThanOrEqual(inner)
      if (inner <= 60) expect(result.hint).not.toMatch(/EPIC → Floor · STORY → detail|에픽 → FLOOR · STORY → 상세/)
      if (hint.includes('d ⏎ open')) expect(result.hint).toContain('d ⏎ open')
      if (hint.includes('d ⏎ 열기')) expect(result.hint).toContain('d ⏎ 열기')
      for (const segment of hint.split(' · ').filter(s => /(^|\s)[aq](?:\s|$)/.test(s))) expect(result.hint).toContain(segment)
    }
  }
})

test('pane helpers: detail is stripped before any whole segment is dropped (inner 60)', () => {
  const plan = (hint: string) => footerPlan({ steps: 0, open: '', close: '', hint, marker: 'l EN' }, 60, 0).hint
  expect(plan(STRINGS.en.f2FootHome)).toBe('w s move · d ⏎ open · n next ⚑ · q close')
  expect(plan(STRINGS.ko.f2FootHome)).toBe('w s 이동 · d ⏎ 열기 · n 다음 ⚑ · q 닫기')
})

test('pane helpers: non-answer footer fits beside the Input bare ⏎ (chrome 2) with a back / q close whole', () => {
  const lang = { en: ['a back', 'q close'], ko: ['a 뒤로', 'q 닫기'] } as const
  for (const l of ['en', 'ko'] as const) for (const inner of [106, 60, 46]) {
    for (const hint of [STRINGS[l].f2FootHome, STRINGS[l].f2FootFloor, STRINGS[l].f2FootStory, STRINGS[l].f2FootScroll]) {
      const result = footerPlan({ steps: 0, open: '', close: '', hint, marker: 'l EN' }, inner, KEYS_CHROME)
      expect(width(result.hint) + 2 + 2 + width('l EN')).toBeLessThanOrEqual(inner)
      for (const key of lang[l]) if (hint.includes(key)) expect(result.hint).toContain(key)
    }
  }
})

test('pane helpers: ANSWER footer with zero chrome keeps its first segment', () => {
  for (const lang of ['en', 'ko'] as const) {
    const hint = STRINGS[lang].f2FootAnswer
    const result = footerPlan({ steps: 0, open: '', close: '', hint, marker: 'l EN' }, 46, 0)
    expect(result.hint.startsWith(hint.split(' · ')[0]!)).toBe(true)
    expect(width(result.hint)).toBeLessThanOrEqual(46)
  }
})

test('pane helpers: crumbFit shortens EPIC, keeps the last crumb, and floors tiny room at one glyph plus ellipsis', () => {
  expect(crumbFit(['A very long EPIC', '1 Plan'], 46)).toEqual(['A very long EPIC', '1 Plan'])
  expect(crumbFit(['A very long EPIC title', '1 Plan'], 12)).toEqual(['A…', '1 Plan'])
  expect(crumbFit(['큰 에픽 제목', 'STORY', '1 계획'], 20).at(-1)).toBe('1 계획')
  expect(crumbFit(['ABCDEFG'], 3).at(0)).toMatch(/^..…$/)
  expect(width(crumbFit(['Epic', '1 Plan'], 8)[0])).toBeGreaterThanOrEqual(2)
  expect(crumbFit(['Epicccc', 'STORY', '1 Plan'], 16).at(-1)).toBe('1 Plan')
  expect(crumbFit(['Epicccc', '1 Plan'], 9)).toEqual(['E…', '1 P…'])
})

test('pane helpers: crumbFit floor is one whole glyph plus ellipsis by width (Hangul 2 cols)', () => {
  const korean = crumbFit(['큰 에픽 제목', 'STORY', '1 계획'], 10)
  expect(korean[0]).toBe('큰…')
  expect(crumbFit(['큰 에픽 제목', '1 계획'], 6)[0]).toBe('큰…')
  expect(crumbFit(['큰 에픽 제목', '중간 제목 길게', '1 계획'], 12)[1]).toMatch(/^중…/)
})

test('pane helpers: crumbFit below the room its floors need keeps the floors and may exceed room', () => {
  const tiny = crumbFit(['Epicccc', 'STORY', '1 Plan'], 9)
  expect(tiny.slice(0, 2)).toEqual(['E…', 'S…'])
  expect(width(tiny.join(' › '))).toBeGreaterThan(9)
})

test('pane helpers: homeRows removes only the size-S EPIC item and keeps L STORY rows', () => {
  const base = { task_id: 'E1', key: 'E1', title: 'Epic', state: 'acting', items: [{ key: 'E1', title: 'Epic' }, { key: 'P1', title: 'Story' }], stages: [], progress: { done: 0, total: 1 }, done: 0, total: 1, cost: { usd: 0 }, elapsed_ms: 0, you: { cards: [] }, workers: [], metrics: {} }
  const opts = { now: 0, compact: false, unfolded: {}, say: ((k: string) => k) as never, fixed: (() => '') as never, verdict: (() => '') as never, reportReady: () => false } as never
  expect(homeRows([base as never], opts).body.filter(r => r.ref.type === 'story')).toHaveLength(1)
  const large = { ...base, items: [{ key: 'P1', title: 'Story' }, { key: 'P2', title: 'Story 2' }] }
  expect(homeRows([large as never], opts).body.filter(r => r.ref.type === 'story')).toHaveLength(2)
})

test('pane helpers: pageEsc reports dropped drafts only in ANSWER', () => {
  const answer = on(at('ANSWER', 'E1', 'P1'))
  expect(pageEsc(answer, true).hint).toBe('draftDropped')
  expect(pageEsc(answer, false).hint).toBeNull()
  expect(pageEsc(on(at('STORY', 'E1', 'P1')), true)).toEqual({ nav: on(at('STORY', 'E1', 'P1')), closed: true, hint: null })
})

test('pane helpers: storyReportLines includes test verdict pass/fail and omits absent', () => {
  const say = ((key: string) => key) as never
  const report = { finished: true, verdict: { score: 1, threshold: 1, attempt: 1, max: 1, tests: 'fail' }, sections: [{ key: 'verdict', lines: ['x'] }] }
  expect(JSON.stringify(storyReportLines(report as never, say, 106))).toContain('f2ReportTestsFail')
  expect(JSON.stringify(storyReportLines({ ...report, verdict: { ...report.verdict, tests: undefined } } as never, say, 106))).not.toContain('f2ReportTests')
  const koSay = ((key: string) => key === 'f2ReportTestsPass' ? '테스트 통과' : key) as never
  expect(JSON.stringify(storyReportLines({ ...report, verdict: { ...report.verdict, tests: 'pass' } } as never, koSay, 106))).toContain('테스트 통과')
})

test('language korean: the waiting status line has no English UI word', async ($, on) => {
  const { seen } = await seeded($, on, { status: stat({ waiting: 2 }), task: demo({ state: 'stalled' }) }, 'terminal', '한국어')
  const line = seen.statuses[seen.statuses.length - 1] ?? ''
  expect(line).toContain('확인 필요')
  expect(latinOutside(line, [...LANG_DATA, '/teams-status'])).toEqual([]) // the command name is a literal, not a word
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
async function tickWorld($: Engine, on: On, init: Record<string, unknown>, isOpen: boolean, data: Data = { status: stat(), task: demo() }) {
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

test('tick: pane open falls back to status.latest once known', async ($, on) => {
  const w = await tickWorld($, on, {}, true)
  await w.tick()
  await w.tick()
  const last = w.ticks[1]![0]!
  expect(last[last.indexOf('--task') + 1]).toBe('3a3a3bb5-f4b7')
})

test('tick stores the summary the pane then draws without running a process', async ($, on) => {
  // (the pane is drawn from the tick's data; a render adds no process call)
  const w = await tickWorld($, on, { watch: ['abc'] }, true, { status: stat(), task: demo(), tasks: P_TASKS() })
  await w.tick()
  const n = w.seen.argv.length
  const ui = await pane($, 'terminal')
  expect(await shown(ui)).toContain('Cancel payment API')
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

test('/teams-status: a desktop session (pane placed): answers with one line, no board', async ($, on) => {
  uiWorld(on, {}, ['terminal', 'desktop'], { plain: ok(INDEX) })
  startWorld(on)
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  const text = textOf(await runStatus($))
  expect(text).toBe('pane opened')
  expect(text).not.toContain('E-3a3a3bb5')
})

test('/teams-status: a terminal-only session with the pane placed answers with one line, no board', async ($, on) => {
  const seen = uiWorld(on, {}, ['terminal'], { plain: ok(INDEX) })
  startWorld(on)
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  const text = textOf(await runStatus($))
  expect(text).toBe('pane opened')
  expect(text).not.toContain('E-3a3a3bb5')
  expect(seen.opened).toEqual(['teams-status'])
})

// the answer by surface: a pane surface gets the one line, mobile the board
for (const surface of SURFACES) {
  test(`/teams-status answer on ${surface}`, async ($, on) => {
    const seen = uiWorld(on, {}, [surface], { plain: ok(INDEX) })
    startWorld(on)
    on('ui.panes', () => ({ value: [] }) as never)
    await start($)
    expect(textOf(await runStatus($))).toBe(carriesInput(surface) ? 'pane opened' : INDEX)
    expect(seen.opened).toEqual(['teams-status'])
  })
}

test('/teams-status answer headless', async ($, on) => {
  const seen = uiWorld(on, {}, [], { plain: ok(INDEX) })
  startWorld(on)
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  expect(textOf(await runStatus($))).toBe(INDEX)
  expect(seen.opened).toEqual(['teams-status'])
})

for (const [name, surfaces, want] of [
  ['a pane-surface pair', ['desktop', 'vscode'], 'pane opened'],
  ['a pane surface beside mobile', ['terminal', 'mobile'], INDEX],
  ['an unknown surface name', ['watch'], INDEX],
] as const) {
  test(`/teams-status answer: ${name}`, async ($, on) => {
    uiWorld(on, {}, surfaces as never, { plain: ok(INDEX) })
    startWorld(on)
    on('ui.panes', () => ({ value: [] }) as never)
    await start($)
    expect(textOf(await runStatus($))).toBe(want)
  })
}

for (const [why, plain] of [['fails', { exitCode: 1, stdout: INDEX, stderr: 'boom' }], ['prints nothing', ok('  \n')]] as const) {
  test(`/teams-status answer: on a pane surface a view.mjs that ${why} still answers pane opened`, async ($, on) => {
    const seen = uiWorld(on, {}, ['terminal'], { plain })
    startWorld(on)
    on('ui.panes', () => ({ value: [] }) as never)
    await start($)
    expect(textOf(await runStatus($))).toBe('pane opened')
    expect(seen.opened).toEqual(['teams-status'])
  })
}

test('/teams-status answer: surfaces() throwing keeps the board text and the pane open', async ($, on) => {
  const data: Data = { plain: ok(INDEX) }
  const seen = uiWorld(on, {}, ['terminal'], data)
  startWorld(on)
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  data.surfacesThrow = true
  expect(textOf(await runStatus($))).toBe(INDEX)
  expect(seen.opened).toEqual(['teams-status'])
})

test('/teams-status answer: the second run on a pane surface closes with one line, no board', async ($, on) => {
  const closed: string[] = []
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
  const seen = uiWorld(on, {}, ['terminal'], { plain: ok(INDEX) })
  startWorld(on)
  on('ui.panes', () => ({ value: seen.opened.length > 0 ? [{ id: 'teams-status', title: 'Teams', isPlaced: true }] : [] }) as never)
  await start($)
  expect(textOf(await runStatus($))).toBe('pane opened')
  const text = textOf(await runStatus($))
  expect(text).toBe('pane closed')
  expect(text).not.toContain('E-3a3a3bb5')
  expect(closed).toEqual(['teams-status'])
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
  expect(statusAnswer({ exitCode: 0, stdout: 'x\n' }, 'opened', ['mobile'], true)).toBe('x\n')
  expect(statusAnswer({ exitCode: 2, stdout: 'x' }, 'opened', ['mobile'], true)).toBe('opened')
  expect(statusAnswer({ exitCode: 0, stdout: ' ' }, 'opened', ['mobile'], true)).toBe('opened')
  expect(statusAnswer(null, 'opened', ['mobile'], true)).toBe('opened')
  const runs = [{ exitCode: 0, stdout: 'x\n' }, { exitCode: 2, stdout: 'x' }, { exitCode: 0, stdout: ' ' }, null]
  const board = (run: (typeof runs)[number]) => (run !== null && run.exitCode === 0 && run.stdout.trim() !== '' ? run.stdout : 'opened')
  for (const run of runs) {
    for (const set of [['terminal'], ['desktop'], ['vscode'], ['terminal', 'desktop'], ['desktop', 'vscode'], ['terminal', 'vscode']]) {
      expect(statusAnswer(run, 'opened', set, true)).toBe('opened')
      expect(statusAnswer(run, 'opened', set, false)).toBe(board(run))
    }
    for (const set of [['mobile'], ['terminal', 'mobile'], ['watch'], ['terminal', 'watch'], []]) {
      expect(statusAnswer(run, 'opened', set, true)).toBe(board(run))
    }
    for (const bad of [undefined, null, 'terminal', 7]) {
      expect(statusAnswer(run, 'opened', bad as never, true)).toBe(board(run))
    }
  }
})

// the footer's Input takes the keys; mobile draws none and keeps every Button
for (const surface of SURFACES) {
  test(`${surface}: footer Input ${surface === 'mobile' ? 'is absent and every Button stays' : 'is drawn beside the Buttons'}`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: FULL, task: demo() }, surface, undefined, { epic: 'tA' })
    const ui = await pane($, surface)
    expect((await ui.find({ key: 'keys' })) !== undefined).toBe(surface !== 'mobile')
    expect((await ui.findAll({ type: 'Input' })).length).toBe(surface === 'mobile' ? 0 : 1)
    const keys = (await ui.findAll({ type: 'Button' })).map(b => String(b.props.key))
    expect(keys).toEqual(surface === 'mobile' ? ['up', 'down', 'open', 'back', 'flag', 'close', 'lang'] : ['lang'])
  })
}

// ---- pane fallback: the newest running task of this cwd ----
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
  test(`${surface}: with no EPIC page open no report call is made on a tick`, async ($, on) => {
    const { seen, tick } = await seeded($, on, { status: stat(), task: demo(), reports: { abc: payload() } }, surface)
    await tick()
    await tick()
    expect(reportArgv(seen)).toHaveLength(0)
  })
}

// ---- end-of-run card ----
const END = (task_id: string, ts = 1500) => ({ ts, task_id, kind: 'daemon_done', text: `${task_id} finished: done` })
const T_PAYLOAD = (over: Record<string, unknown> = {}) => payload({ task_id: 'tee', path: '/proj/.teams_output/team/E-tee/80-report.md', report: { text: '# T report\n', truncated: false, more_lines: 0, mtime: 7 }, ...over })
const BLOCKED = (over: Record<string, unknown> = {}) => T_PAYLOAD({ verdict: 'blocked', failed: 1, needs: { items: ['tm_retry P1', 'decide the split'], more: 0 }, ...over })
const find = async (ui: Ui, key: string) => ui.find({ key })

for (const surface of SURFACES) {
  test(`${surface}: daemon_done: one report call for T, a card, the toast kept; [report] opens FLOOR of T with Phase 6 selected`, async ($, on) => {
    const data = { status: stat(), task: demo(), events: [END('tee')], reports: { abc: payload({ path: '/proj/E-abc/80-report.md', report: { text: 'U report', truncated: false, more_lines: 0, mtime: 1 } }), tee: T_PAYLOAD() } }
    const { seen } = await seeded($, on, data, surface)
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
    expect(seen.store.get('page')).toEqual({ name: 'FLOOR', epic: 'tee', story: null, phase: null })
    expect(seen.store.get('pageSel')).toEqual({ 'FLOOR:tee::': 'p:6' })
    expect(seen.store.get('epic')).toBe('tee')
    expect(seen.store.get('watch')).toEqual(['abc', 'tee'])
    expect(seen.store.get('ended')).toEqual({ tee: 'seen' })
    expect(await find(await band($, surface), 'report')).toBeUndefined()
    expect(reportArgv(seen).map(taskOf)).toEqual(['tee'])
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

  test(`${surface}: language korean draws the card in Korean`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo(), events: [END('tee')], reports: { tee: T_PAYLOAD() } }, surface, 'korean')
    const b = await band($, surface)
    const text = await shown(b)
    for (const word of ['끝남', '실패 2', '+2건 더']) expect(text).toContain(word)
    expect(await labels(b)).toEqual(['보고서', '×'])
    for (const word of ['finished', 'failed', 'more']) expect(text).not.toContain(word)
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

// F4 words: the engine's words arrive as keys; the mod looks them up, and a key it does not know is drawn as received
const KO_ON = (on: Parameters<typeof pushWorld>[0]) => on('settings.read', () => ({ value: { language: 'korean' } }) as never)

test('F4 words: a Korean nextNeedsYou failure toast reads Korean with ⚠', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  KO_ON(on)
  const { pushes, seen } = pushWorld(on, sentOk, evLines({ ...NEEDS_YOU, next_key: 'nextNeedsYou', next_vars: {}, reason: 'which db?' }))
  await start($)
  await clock.advance(3000)
  expect(seen.toasts).toEqual([`⚠ E-aaaaaaaa plan:1 ${STRINGS.ko.nodeFailed}: which db? → ${STRINGS.ko.nextNeedsYou}`])
  expect(pushes[0].message).toContain(STRINGS.ko.nextNeedsYou)
})

test('F4 words: an event with an unknown kind toasts one.text', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  KO_ON(on)
  const odd = { ts: 1500, task_id: 'E-aaaaaaaa1', kind: 'something_new', text: 'E-aaaaaaaa did something new', run: 'E-aaaaaaaa', node: 'n1' }
  const { seen } = pushWorld(on, sentOk, evLines(odd))
  await start($)
  await clock.advance(3000)
  expect(seen.toasts).toEqual([odd.text])
})

test('F4 words: an unknown next_key draws the key and does not throw', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const { seen } = pushWorld(on, sentOk, evLines(FAIL({ severity: 'failure', next_step: 'later', next_key: 'nextFromTheFuture', next_vars: {} })))
  await start($)
  await clock.advance(3000)
  expect(seen.toasts).toEqual(['✗ E-aaaaaaaa critique:2 failed: shape too wide → nextFromTheFuture'])
})

test('F4 words: waiting_human and daemon_done build their sentence from the fields, in Korean', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  KO_ON(on)
  const wait = { ts: 1500, task_id: 'E-aaaaaaaa1', kind: 'waiting_human', text: 'E-aaaaaaaa needs you: plan:1', run: 'E-aaaaaaaa', node: 'plan:1' }
  const fin = { ts: 1600, task_id: 'E-aaaaaaaa1', kind: 'daemon_done', text: 'E-aaaaaaaa finished: complete', run: 'E-aaaaaaaa', state: 'complete' }
  const { seen } = pushWorld(on, sentOk, evLines(wait, fin))
  await start($)
  await clock.advance(3000)
  expect(seen.toasts).toEqual([
    STRINGS.ko.evWaiting.replace('{run}', 'E-aaaaaaaa').replace('{node}', 'plan:1'),
    STRINGS.ko.evDone.replace('{run}', 'E-aaaaaaaa').replace('{state}', STRINGS.ko.doneComplete),
  ])
})

for (const [lang, on0] of [['en', false], ['ko', true]] as const) {
  test(`F4 words: paused, daemon restarts and fix rounds keep their meaning with run on the event (${lang})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    if (on0) KO_ON(on)
    const run = 'E-aaaaaaaa'
    const pause = { ts: 1500, task_id: 'E-aaaaaaaa1', kind: 'child_driver_capacity', text: `${run} paused: provider limit`, run }
    const dead = { ts: 1600, task_id: 'E-aaaaaaaa1', kind: 'daemon_exhausted', text: `${run} stopped: daemon restarts used up`, run }
    const fix = { ts: 1700, task_id: 'E-aaaaaaaa1', kind: 'upstream_fix_rounds_exhausted', text: `${run} P1: fix rounds used up`, run, package: 'P1' }
    const { seen } = pushWorld(on, sentOk, evLines(pause, dead, fix))
    await start($)
    await clock.advance(3000)
    const S = STRINGS[lang]
    expect(seen.toasts).toEqual(on0
      ? [S.evPaused.replace('{run}', run), S.evExhausted.replace('{run}', run), S.evFixRounds.replace('{run}', run).replace('{pkg}', 'P1')]
      : [pause.text, dead.text, fix.text])
    if (on0) expect(seen.toasts).toEqual([`${run} 일시 중지: 제공자 한도`, `${run} 중단: 데몬 재시작 소진`, `${run} P1: 수정 라운드 소진`])
  })
}

test('F4 words: a failure with a reason_key draws the key in the table, an unknown reason_key draws as received', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  KO_ON(on)
  const { seen } = pushWorld(on, sentOk, evLines(FAIL({ reason: 'no reason recorded', reason_key: 'reasonNone', next_step: null }), FAIL({ ts: 1600, reason: 'x', reason_key: 'reasonFromTheFuture', next_step: null })))
  await start($)
  await clock.advance(3000)
  await clock.advance(3000)
  expect(seen.toasts).toEqual([
    `↻ E-aaaaaaaa critique:2 ${STRINGS.ko.nodeFailed}: ${STRINGS.ko.reasonNone}`,
    `↻ E-aaaaaaaa critique:2 ${STRINGS.ko.nodeFailed}: reasonFromTheFuture`,
  ])
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
    key, title, state: base.state, doing: base.doing, last_verdict: null, cost_usd: null, cost_estimated: false, try: null, max: null,
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
}

// ---- F4: the Floor: worker lines, hand-off feed, the 800 ms clock ----
const wk = (id: string, state: string, doing = '') => ({ id, state, doing, ...markOf(state, doing) })
const ho = (time: string, from: string, what: string, to: string) => ({ time, from, what, to })
const WORKERS = [wk('PLAN', 'done'), wk('P1', 'acting', 'editing a.ts'), wk('P2', 'idle'), wk('P3', 'you', 'asks a question'), wk('JUDGE', 'stalled')]
const floorOf = (workers: unknown[], handoffs: unknown[] = []) => [epicOf('tA', 'E-3a3a3bb5', [], { workers, handoffs })]
const frameOf = (store: Map<string, unknown>) => Number(store.get('frame') ?? 0)

for (const surface of SURFACES) {
  test(`${surface}: the spinner clock advances only while a worker acts`, async ($, on) => {
    const data = { status: stat(), tasks: floorOf(WORKERS), task: demo() }
    const { seen, clock } = await seededClock($, on, data, surface)
    await clock.advance(800)
    const a = frameOf(seen.store)
    expect(a).toBeGreaterThan(0)
    await clock.advance(800)
    expect(frameOf(seen.store)).toBe(a + 1)
    // nobody acts: the next tick leaves the clock to cancel itself
    data.tasks = floorOf([wk('P1', 'idle'), wk('P2', 'done')])
    await clock.advance(3000)
    await clock.advance(800)
    const b = frameOf(seen.store)
    await clock.advance(5000)
    expect(frameOf(seen.store)).toBe(b)
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

const WIDTHS = [190, 110] as const
const bodyOf = (lines: string[]) => lines.filter(l => l.startsWith('│')).map(l => l.slice(2, -2).trimEnd())

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

// ---- F2 pages: fixtures (the REASON and the sound() check serve the page tests below) ----
const REASON = 'All code and test acceptance for the parser is met and verified by the final run of the whole suite across every supported locale'
// no line wider than the pane, no cut glyph, no `…` alone in a cell or doubled, nothing undefined
const sound = (lines: string[], cols: number) => {
  for (const l of lines) {
    expect(width(l)).toBeLessThanOrEqual(cols - 4)
    expect(l).not.toContain('�')
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(l)).toBe(false)
    expect(l).not.toContain('……')
    expect(/(^|\s\s)…/.test(l)).toBe(false)
    for (const bad of ['NaN', 'undefined', 'null']) expect(l).not.toContain(bad)
  }
}

// ---- card 105: a task in a linked worktree of this repo is marked ⑂ <worktree>; the mod only renders the field ----
const WT = [epicOf('tW', 'E-wwwwwwww', [], { title: 'in a worktree', worktree: 'wt' }), epicOf('tM', 'E-mmmmmmmm', [], { title: 'own checkout', worktree: null })]
for (const surface of SURFACES) {
  test(`${surface}: HOME EPIC row shows ⑂ wt for a worktree task, none for null`, async ($, on) => {
    await seeded($, on, { status: stat(), tasks: WT, task: WT[0] }, surface, undefined, { watch: [] })
    const ui = await wide($, surface)
    const text = await shown(ui)
    expect(text).toContain('⑂ wt · in a worktree')
    expect(text).toContain('own checkout')
    expect(text.split('⑂').length).toBe(2)
  })
  test(`${surface}: band shows ⑂ wt for a worktree task; null shows no ⑂`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo({ worktree: 'wt' }) }, surface)
    const b = await shown(await band($, surface))
    expect(b).toContain('teams · ⑂ wt · ')
    expect(b).toMatch(/teams · ⑂ wt · .+ — \S/)
  })
  test(`${surface}: band with a long title keeps ⑂ <worktree> before the title`, async ($, on) => {
    const long = 'Migrate every legacy report exporter to the new streaming writer and keep each output file identical across all supported locales'
    await seeded($, on, { status: stat(), task: demo({ worktree: 'feature-worktree', title: long }) }, surface)
    expect(await shown(await band($, surface))).toContain('teams · ⑂ feature-worktree · Migrate')
  })
  test(`${surface}: band with worktree null shows no ⑂`, async ($, on) => {
    await seeded($, on, { status: stat(), task: demo({ worktree: null }) }, surface)
    const b = await shown(await band($, surface))
    expect(b).not.toContain('⑂')
    expect(b).toMatch(/teams · .+ — \S/)
  })
}

// ---- the view server: data calls go to its Unix socket first, `--once` is the fallback ----
// A clock far from the others: the 30 s start throttle is a module-level timestamp shared by the file.
const SERVE_CLOCK = 5_000_000_000
const isServeStart = (argv: readonly string[]) => argv[0] === 'sh'

function socketWorld(on: On, answer: () => { status: number; text: string } | 'fail', opts: { now?: number; tasks?: string; sockPath?: string; cwd?: string; cwdThrowsInView?: boolean } = {}) {
  const clock = mock.clock(on, { now: opts.now ?? SERVE_CLOCK })
  // the no-spawn gate looks for team.json under the session cwd
  markers = new Set(opts.cwd !== undefined ? [...DEFAULT_MARKERS, `${opts.cwd}/.claude/team.json`] : DEFAULT_MARKERS)
  cwdFails.armed = false
  const seen = world(on, ['terminal'], argv => ok(argv.includes('--sock-path') ? (opts.sockPath ?? '') : ''), opts.cwd)
  on('ui.panes', () => ({ value: [] }) as never)
  on('env.get', (_$, e) => {
    if (opts.cwdThrowsInView && e.name === 'HARNESS_TASKS_DIR') cwdFails.armed = true
    return { value: e.name === 'HARNESS_TASKS_DIR' ? (opts.tasks ?? '/w/tasks/') : e.name === 'HOME' ? '/home/u' : undefined } as never
  })
  const urls: string[] = []
  const sockets: string[] = []
  on('http.fetch', (_$, e) => {
    urls.push(String(e.url))
    sockets.push(String((e as { init?: { socketPath?: string } }).init?.socketPath ?? ''))
    const a = answer()
    if (a === 'fail') return { deny: 'no socket' } as never
    return { value: { status: a.status, ok: a.status === 200, headers: {}, text: a.text } } as never
  })
  return { clock, seen, urls, sockets }
}

test('view server: the socket is the tasks root\'s .state.sock, no version in it', async ($, on) => {
  const { clock, sockets } = socketWorld(on, () => ({ status: 200, text: '' }))
  await start($)
  await clock.advance(3000)
  expect(sockets.length > 0).toBe(true)
  expect(sockets.every(s => s === '/w/tasks/.state.sock')).toBe(true)
})

test('view server: without HARNESS_TASKS_DIR the socket is under ~/.harness/tasks', async ($, on) => {
  const { clock, sockets } = socketWorld(on, () => ({ status: 200, text: '' }), { tasks: '' })
  await start($)
  await clock.advance(3000)
  expect(sockets.length > 0).toBe(true)
  expect(sockets.every(s => s === '/home/u/.harness/tasks/.state.sock')).toBe(true)
})

test('view server: a root whose socket path is over 103 bytes uses the --sock-path answer, asked once', async ($, on) => {
  const tasks = `/w/${'d'.repeat(110)}`
  const { clock, seen, sockets } = socketWorld(on, () => ({ status: 200, text: '' }), { tasks, sockPath: '/tmp/teams-state-abc.sock\n' })
  await start($)
  await clock.advance(9000)
  expect(sockets.length > 1).toBe(true)
  expect(sockets.every(s => s === '/tmp/teams-state-abc.sock')).toBe(true)
  expect(seen.argv.filter(a => a.includes('--sock-path'))).toHaveLength(1)
})

test('view server: a relative HARNESS_TASKS_DIR resolves against the session cwd', async ($, on) => {
  const { clock, seen, sockets } = socketWorld(on, () => 'fail', { tasks: 'rel/tasks', cwd: '/w/proj' })
  await start($)
  await clock.advance(3000)
  expect(sockets.length > 0).toBe(true)
  expect(sockets.every(s => s === '/w/proj/rel/tasks/.state.sock')).toBe(true)
  expect(seen.argv.filter(isServeStart)[0]).toContain('/w/proj/rel/tasks')
})

test('view server: a relative HARNESS_TASKS_DIR over 103 bytes asks --sock-path with the resolved dir', async ($, on) => {
  const cwd = `/w/${'d'.repeat(110)}`
  const { clock, seen } = socketWorld(on, () => ({ status: 200, text: '' }), { tasks: 'rel', cwd, sockPath: '/tmp/teams-state-abc.sock\n' })
  await start($)
  await clock.advance(3000)
  const ask = seen.argv.find(a => a.includes('--sock-path'))!
  expect(ask[ask.indexOf('--tasks-dir') + 1]).toBe(`${cwd}/rel`)
})

test('view server: a relative HARNESS_TASKS_DIR with a cwd that throws inside viewOnce fails open', async ($, on) => {
  const { clock, seen, sockets } = socketWorld(on, () => 'fail', { tasks: 'rel/tasks', cwd: '/w/proj', cwdThrowsInView: true })
  await start($)
  await clock.advance(3000)
  expect(sockets.length > 0).toBe(true)
  expect(sockets.every(s => s === 'rel/tasks/.state.sock')).toBe(true)
  expect(seen.argv.filter(isServeStart)).toHaveLength(1)
})

// an empty cwd: today's dial and fallback
test('view server: a relative HARNESS_TASKS_DIR with no session cwd fails open', async ($, on) => {
  const { clock, seen, sockets } = socketWorld(on, () => 'fail', { tasks: 'rel/tasks', cwd: '' })
  await start($)
  await clock.advance(3000)
  expect(sockets.length > 0).toBe(true)
  expect(sockets.every(s => s === 'rel/tasks/.state.sock')).toBe(true)
  expect(seen.argv.some(a => a.includes('--once'))).toBe(true)
  expect(seen.argv.filter(isServeStart)).toHaveLength(1)
})

test('view server: ./ and ../ in a relative HARNESS_TASKS_DIR are normalized', async ($, on) => {
  const { clock, sockets } = socketWorld(on, () => ({ status: 200, text: '' }), { tasks: './a/../tasks/', cwd: '/w/proj' })
  await start($)
  await clock.advance(3000)
  expect(sockets.length > 0).toBe(true)
  expect(sockets.every(s => s === '/w/proj/tasks/.state.sock')).toBe(true)
})

test('view server: with the socket answering 200 a tick spawns no data process', async ($, on) => {
  const { clock, seen, urls } = socketWorld(on, () => ({ status: 200, text: '' }))
  await start($)
  await clock.advance(9000)
  expect(urls.length > 0).toBe(true)
  expect(urls.every(u => u.includes('format=') && new URL(u).searchParams.get('proto') === '1')).toBe(true)
  expect(seen.argv.filter(a => !isServeStart(a))).toHaveLength(0)
  expect(seen.argv.filter(isServeStart)).toHaveLength(0)
})

test('view server: a 409 answers with --once and starts no server over 9 s', async ($, on) => {
  const { clock, seen, urls } = socketWorld(on, () => ({ status: 409, text: '{"error":"proto"}' }), { now: SERVE_CLOCK + 1e9 })
  await start($)
  await clock.advance(9000)
  expect(urls.length > 0).toBe(true)
  expect(seen.argv.some(a => a.includes('--once') && isEvents(a))).toBe(true)
  expect(seen.argv.filter(isServeStart)).toHaveLength(0)
})

test('view server: with fetch failing the tick falls back to --once and starts the server once per 30 s', async ($, on) => {
  const { clock, seen } = socketWorld(on, () => 'fail')
  await start($)
  await clock.advance(3000)
  expect(seen.argv.some(a => a.includes('--once') && isEvents(a))).toBe(true)
  expect(seen.argv.filter(isServeStart)).toHaveLength(1)
  expect(seen.argv.filter(isServeStart)[0]?.join(' ')).toContain('mcp/stateserver.mjs')
  expect(seen.argv.filter(isServeStart)[0]?.join(' ')).toContain('--tasks-dir')
  await clock.advance(15000)
  expect(seen.argv.filter(a => a.includes('--once')).length > 1).toBe(true)
  expect(seen.argv.filter(isServeStart)).toHaveLength(1)
})

// ---- F2 pages: HOME and FLOOR on the keys w s d a n q, English then Korean, on every surface (fictional data) ----
// The words a person or the engine wrote in the data (titles, ids, prose) stay as written in both languages: F4_DATA names them.
// Everything else a page says comes from the table.
const judgeOf = (verdict: string, score: number, attempt: number, reason: string | null = null) => ({ score, threshold: 80, reason, gap: null, verdict, attempt })
const numsOf = (attempt: number, judge: unknown) => ({ attempt, max_attempts: 3, judge, cost_usd: 0.4, retry_cost_usd: 0, wall_ms: 0, out_of_retries: false })
const NOW0 = 4000 // the mock clock after one tick
const ago = (min: number) => NOW0 - min * 60000
const P_STAGES = [stage('plan', 'done'), stage('build', 'running'), stage('integrate', 'pending'), stage('qa', 'pending'), stage('gate', 'pending'), stage('report', 'pending')]
const NO_PHASE = { workers: 0, acting: 0, you: 0, stalled: 0, idle: 0, done: 0 }
const P_PHASES = [
  { key: 'plan', ...NO_PHASE, workers: 3, done: 3, decisions: 3 }, { key: 'build', ...NO_PHASE, workers: 4, acting: 2, you: 1, stalled: 1, decisions: 1 },
  { key: 'integrate', ...NO_PHASE }, { key: 'qa', ...NO_PHASE }, { key: 'gate', ...NO_PHASE }, { key: 'report', ...NO_PHASE },
]
const P_METRICS = {
  drivers: { live: 5, cap: 8, load: 3.1 }, out_of_retries: [] as string[],
  stories: [
    { id: 'S1', progress: { done: 6, total: 6 }, agents: null }, { id: 'S2', progress: { done: 3, total: 6 }, agents: 3 },
    { id: 'S3', progress: { done: 2, total: 6 }, agents: 2 }, { id: 'S4', progress: null, agents: null },
  ],
  stages: [{ stage: 'plan', cost_usd: 0.4, retry_cost_usd: 0, wall_ms: 300000 }, { stage: 'build', cost_usd: 1.81, retry_cost_usd: 0.26, wall_ms: 840000 }],
}
const P_ASK = { key: 'E-3f9a2c11/S2', title: 'refund idempotency key', question: 'How many retries on refund failure?', who: 'S2', since: ago(9), stage: 'ask' }
const P_STORIES = () => [
  story('S1', 'cancel reason enum', { state: 'done', last_verdict: 'accept', try: 1, max: 3, elapsed_ms: 240000, metrics: numsOf(1, judgeOf('accept', 91, 1)) }),
  story('S2', 'refund idempotency key', { state: 'you', try: 2, max: 3, elapsed_ms: 660000, metrics: numsOf(2, judgeOf('reject', 61, 1, REASON)) }),
  story('S3', 'PG cancel webhook', { doing: 'testing', try: 1, max: 3, elapsed_ms: 360000 }),
  story('S4', 'cancel webhook receipt', { state: 'idle', elapsed_ms: null }),
]
const P_TASKS = (over: Record<string, unknown> = {}) => [
  epicOf('tA', 'E-3f9a2c11', P_STORIES(), {
    title: 'Cancel payment API', done: 1, total: 4, created_at: ago(22), cost: { usd: 2.47, turns: 40 }, stages: P_STAGES, phases: P_PHASES, metrics: P_METRICS,
    progress: { key: 'build', done: 3, total: 6 },
    you: { count: 1, items: ['refund idempotency key'], cards: [P_ASK] },
    workers: [{ ...wk('S3', 'stalled'), minutes: 23, phase: 'build' }, { ...wk('S1', 'done'), phase: 'build' }, { ...wk('S2', 'acting', 'editing parser.ts'), phase: 'build', node: 'implement', role: 'implementer', elapsed_ms: 660000 }, { ...wk('PLAN', 'done'), phase: 'plan' }],
    phase_handoffs: {
      build: [
        { time: '14:03', from: 'judge', what: 'verdict reject', what_key: 'handVerdict', what_vars: { v: 'reject' }, to: 'S2', story: 'S2', score: 61, reason: 'AC 3 missing', to_role: 'implementer' },
        { time: '13:58', from: 'S1', what: 'integrated 1', what_key: 'handIntegrated', what_vars: { n: 1 }, to: 'judge' },
        { time: '13:52', from: 'TeamLeader', what: '', to: 'you', to_key: 'partyYou', story: 'S2', reason: 'How many retries on refund failure?' },
        { time: '13:40', from: 'judge', what: 'verdict accept', what_key: 'handVerdict', what_vars: { v: 'accept' }, to: 'S1', story: 'S1', score: 91, to_role: 'integrate' },
      ],
    },
    ...over,
  }),
  epicOf('tB', 'E-71c2a0f4', [], { title: 'Alert batch retry policy', done: 0, total: 0, created_at: ago(9), cost: { usd: 0.31, turns: 5 }, stages: [stage('plan', 'running'), ...P_STAGES.slice(1).map(g => stage(g.key, 'pending'))] }),
  epicOf('tC', 'E-91c0b3d7', [], { title: 'Log cleanup cron', state: 'complete', live: false, age_ms: 7200000, done: 5, total: 5, cost: { usd: 3.34, turns: 80 } }),
]
const P_DATA = [
  ...LANG_DATA, 'Cancel payment API', 'cancel reason enum', 'refund idempotency key', 'PG cancel webhook', 'cancel webhook receipt', 'Alert batch retry policy', 'Log cleanup cron',
  'How many retries on refund failure?', 'S1', 'S2', 'S3', 'S4', 'E-3f9a2c11', 'E-71c2a0f4', 'E-91c0b3d7', REASON,
  // the Phase, STORY, Log, Report and thread fixtures below: words a person, a model or the engine's flow name wrote
  'duplicate request double refund test missing', 'POST cancel endpoint adds the reason enum', 'cancel_reason.py', 'cancel_api.py', 'enum or free text: enum',
  'multi-language reason text (belongs to S4)', 'AC 3 missing', 'develop', 'refund ledger', 'audit trail', 'a note a person wrote',
].sort((a, b) => b.length - a.length)
const F4_DATA = P_DATA
// a title or reason cut to the column ends in … : its kept head is still the data's own text
const F4_CUTS = [...new Set([...F4_DATA, '"How many retries on refund failure?"'].flatMap(d => Array.from({ length: Math.max(1, d.length - 3) }, (_, i) => d.slice(0, i + 4))))].sort((a, b) => b.length - a.length)
const P_FIXTURE = (over: Partial<Data> = {}): Data => ({ status: stat({ waiting: 1 }), tasks: P_TASKS(), task: demo(), ...over })
const F4_FIXTURE: Data = P_FIXTURE()
const HOME_PAGE = { name: 'HOME', epic: null, story: null, phase: null }
const FLOOR_PAGE = { name: 'FLOOR', epic: 'tA', story: null, phase: null }
const atCols = (ui$: Engine, surface: Surface, cols: number) =>
  ui$.ui.mount({ plugin: 'teams', surface, component: 'Pane', requestId: 'teams-status', props: { title: 'Teams', isFocused: false, bodyColumns: cols - 4, placement: 'dock' } } as never)
const linesAt = async (ui: Ui, cols: number) => bodyOf(frame((await ui.drawn()) as any, 'Teams', cols))
const homeLines = async ($: Engine, on: On, cols: number, data: Data = P_FIXTURE(), surface: Surface = 'terminal', language?: string, init: Record<string, unknown> = {}) => {
  await seeded($, on, data, surface, language, { epic: 'tA', ...init }, true)
  const ui = await atCols($, surface, cols)
  return { ui, lines: await linesAt(ui, cols) }
}
const pressKey = async (ui: Ui, text: string) => {
  await ui.input({ key: 'keys', text, kind: 'change' } as never)
  await ui.redraw()
}

test('HOME at 190: header, flag section, EPIC rows with the Phase rail, STORY rows with score, reason, bar and agents', async ($, on) => {
  const { lines } = await homeLines($, on, 190)
  sound(lines, 190)
  const text = lines.join('\n')
  // header: EPIC count, machine-wide drivers and load on the left, total spend and elapsed on the right
  expect(lines[0]).toMatch(/^teams {2}EPIC 3 · drivers 5\/8 · load 3\.1\/8 \(machine-wide\) +\$6\.12 · 22m$/)
  // the flag section: an ask, and a driver F3 says is stopped; each row ends in the key that jumps to the next one
  expect(text).toContain('⚑ Waiting for you 2')
  const ask = lines.find(l => l.includes('"How many retries on refund failure?"'))!
  expect(ask).toMatch(/⚑ +Cancel payment API › S2 +"How many retries on refund failure\?" +9m waiting +n$/)
  const stalled = lines.find(l => l.includes('no output for 23m (driver stopped?)'))!
  expect(stalled).toMatch(/⏸ +Cancel payment API › S3 +no output for 23m \(driver stopped\?\) +n$/)
  // the running EPIC rows are open with their STORY rows; the rail keeps Integ and Rep
  const epic = lines.find(l => l.includes('E-3f9a2c11  '))!
  for (const part of ['▾', 'Cancel payment API', '✔Plan', '●Build', '○Integ', '○QA', '○Gate', '○Rep', 'Build 3/6', 'STORY 1/4', '22m', '$2.47']) expect(epic).toContain(part)
  expect(text).toContain('E-71c2a0f4')
  expect(text).toContain('○Rep')
  const s1 = lines.find(l => /✔ +S1 /.test(l))!
  for (const part of ['cancel reason enum', 'accepted', 'try 1/3', '██████', '91/80', '4m']) expect(s1).toContain(part)
  const s2 = lines.find(l => /⚑ +S2 /.test(l))!
  for (const part of ['refund idempotency key', 'try 2/3', 'last 61/80', 'All code and test acceptance', '3 ag', '11m']) expect(s2).toContain(part)
  expect(s2).not.toContain('rejected') // the old verdict is not this row's status: the attempt is a retry
  const s3 = lines.find(l => /⏸ +S3 /.test(l))!
  expect(s3).toContain('⏸ 23m')
  expect(s3).toContain('2 ag')
  const s4 = lines.find(l => /◌ +S4 /.test(l))!
  expect(s4).toContain('idle')
  expect(s4).not.toMatch(/ag|█/)
  // the ended EPIC is one folded row below the running ones
  const ended = lines.find(l => l.includes('E-91c0b3d7'))!
  for (const part of ['▸', 'Log cleanup cron', 'ended 2h 0m ago · STORY 5/5', '$3.34']) expect(ended).toContain(part)
  expect(lines.indexOf(ended)).toBeGreaterThan(lines.indexOf(s4))
  // F4's marker closes the footer; the page's key line is the Input's hint
  expect(lines.at(-1)).toMatch(/l EN$/)
  expect(lines.at(-1)).toContain('w s move · d ⏎ open')
})

test('HOME places F3 values only when present: Build n/m, estimated mark, spend after a stop; and ⏸ only with minutes', async ($, on) => {
  const without = P_TASKS({ progress: undefined, cost: { usd: 2.47, turns: 40 }, workers: [{ ...wk('S3', 'stalled') }, wk('S1', 'done')], you: { count: 0, items: [], cards: [] } })
  const a = await homeLines($, on, 190, P_FIXTURE({ tasks: without }))
  const textA = a.lines.join('\n')
  expect(textA).not.toMatch(/Build \d|QA \d|SG\d|~\$|after stop|⏸|no output/)
  expect(textA).not.toContain('⚑ Waiting for you')
  expect(textA).toContain('$2.47')
})

test('HOME with F3 values: estimated cost mark, spend after a stop, QA n/m and SGk stage', async ($, on) => {
  const tasks = P_TASKS({ cost: { usd: 2.47, turns: 40, estimated: true, post_stop_usd: 0.12 }, progress: { key: 'sg', k: 2, n: 5, stage_key: 'implement' } })
  const data = P_FIXTURE({ tasks })
  const { tick } = await seeded($, on, data, 'terminal', undefined, { epic: 'tA' })
  const ui = await atCols($, 'terminal', 190)
  const epic = (await linesAt(ui, 190)).find(l => l.includes('E-3f9a2c11  '))!
  expect(epic).toContain('SG2 Implement · 2/5')
  expect(epic).toContain('~$2.47 after stop $0.12')
  data.tasks = P_TASKS({ progress: { key: 'qa', done: 1, total: 4 } })
  await tick()
  await ui.redraw()
  expect((await linesAt(ui, 190)).join('\n')).toContain('QA 1/4')
})

test('HOME STORY rows drop the mini bar, then the agents, then the reason as the pane narrows; the title shrinks first and nothing is wider than the pane', async ($, on) => {
  const long = 'Retry queue drains stale jobs on restart and keeps every claim idempotent across both regions'
  const tasks = P_TASKS()
  ;(tasks[0] as { items: { title: string }[] }).items[1]!.title = long
  await seeded($, on, P_FIXTURE({ tasks }), 'terminal', undefined, { epic: 'tA' }, true)
  const kept: Record<number, [boolean, boolean, boolean]> = {}
  for (const cols of [190, 150, 130, 110, 100, 95, 90, 85, 82, 70, 60, 50]) {
    const ui = await atCols($, 'terminal', cols)
    const lines = await linesAt(ui, cols)
    sound(lines, cols)
    const s2 = lines.find(l => /⚑ +S2 /.test(l))!
    expect(s2).toContain('last 61/80') // the score stays whenever the reason goes
    expect(s2).toContain(cols >= 82 ? 'Retry queue' : 'Ret') // the title keeps room until only the status and the score are left, then ends in …
    kept[cols] = [s2.includes('█') || s2.includes('░'), / 3 ag/.test(s2), s2.includes('All code')]
    // a column that is still drawn means every column dropped after it is drawn too: bar goes first, then agents, then reason
    const [bar, ag, reason] = kept[cols]!
    expect([cols, !bar || ag]).toEqual([cols, true])
    expect([cols, !ag || reason]).toEqual([cols, true])
    await ui.unmount()
  }
  expect(kept[190]).toEqual([true, true, true])
  expect(kept[50]).toEqual([false, false, false])
})

test('HOME at 110: the drivers part of the header goes first', async ($, on) => {
  const { lines } = await homeLines($, on, 70)
  expect(lines[0]).toMatch(/^teams {2}EPIC 3 +\$6\.12 · 22m$/)
  expect(lines[0]).not.toContain('drivers')
})

test('HOME ended EPIC: d unfolds, a folds, the fold state is kept per EPIC in $.state across a closed pane', async ($, on) => {
  const tasks = P_TASKS()
  ;(tasks[2] as { items: unknown[] }).items = [story('S9', 'wrap up the cron', { state: 'done', last_verdict: 'accept', metrics: numsOf(1, judgeOf('accept', 90, 1)) })]
  const { seen } = await seeded($, on, P_FIXTURE({ tasks }), 'terminal', undefined, { epic: 'tA', pageSel: { 'HOME:::': 'e:tC' } })
  const ui = await atCols($, 'terminal', 190)
  expect((await linesAt(ui, 190)).join('\n')).not.toContain('wrap up the cron')
  expect(String((await ui.find({ key: 'keys' }))?.props.placeholder)).toContain('d unfold')
  await pressKey(ui, 'd')
  expect(seen.store.get('unfolded')).toEqual({ tC: true })
  expect((await linesAt(ui, 190)).join('\n')).toContain('wrap up the cron')
  expect(String((await ui.find({ key: 'keys' }))?.props.placeholder)).toContain('a fold')
  await ui.unmount()
  const again = await atCols($, 'terminal', 190)
  expect((await linesAt(again, 190)).join('\n')).toContain('wrap up the cron') // still unfolded after a reopen
  await pressKey(again, 'a')
  expect(seen.store.get('unfolded')).toEqual({})
  expect((await linesAt(again, 190)).join('\n')).not.toContain('wrap up the cron')
  // a on a running EPIC row or with nothing unfolded: nothing happens
  await pressKey(again, 'a')
  expect(seen.store.get('page') ?? HOME_PAGE).toEqual(HOME_PAGE) // never written: HOME is the default
})

test('keys from HOME: d opens FLOOR, s and d reach Phase detail, Phase 6 opens the EPIC report, a goes back keeping each level\'s row', async ($, on) => {
  const { seen } = await seeded($, on, P_FIXTURE(), 'terminal', undefined, { epic: 'tA', pageSel: { 'HOME:::': 'e:tA' } })
  const ui = await atCols($, 'terminal', 190)
  await pressKey(ui, 'd') // the EPIC row
  expect(seen.store.get('page')).toEqual(FLOOR_PAGE)
  expect(await linesAt(ui, 190)).toEqual(expect.arrayContaining([expect.stringContaining('Cancel payment API › FLOOR')]))
  await pressKey(ui, 's')
  await pressKey(ui, 'd')
  expect(seen.store.get('page')).toEqual({ name: 'PHASE', epic: 'tA', story: null, phase: 2 })
  expect((await linesAt(ui, 190))[0]).toContain('Cancel payment API › FLOOR › 2 Build')
  await pressKey(ui, 'a')
  expect(seen.store.get('page')).toEqual(FLOOR_PAGE)
  expect((await linesAt(ui, 190)).find(l => l.includes('2 Build'))).toMatch(/▸/) // row 2 is still the selected one
  for (const k of ['s', 's', 's', 's']) await pressKey(ui, k)
  await pressKey(ui, 's') // the last row: no wrap
  expect((await linesAt(ui, 190)).find(l => l.includes('6 Report'))).toMatch(/▸/)
  await pressKey(ui, 'd')
  expect(seen.store.get('page')).toEqual({ name: 'EPIC_REPORT', epic: 'tA', story: null, phase: null })
  expect((await linesAt(ui, 190))[0]).toContain('Cancel payment API › FLOOR › 6 Report')
  await pressKey(ui, 'a')
  await pressKey(ui, 'a')
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
  expect((await linesAt(ui, 190)).find(l => l.includes('E-3f9a2c11  '))).toMatch(/▸/)
})

test('keys: a STORY row opens STORY detail and a returns; d with no row opens nothing; w stops at the first row', async ($, on) => {
  const { seen } = await seeded($, on, P_FIXTURE(), 'terminal', undefined, { epic: 'tA', pageSel: { 'HOME:::': 's:tA:S3' } })
  const ui = await atCols($, 'terminal', 190)
  await pressKey(ui, 'd')
  expect(seen.store.get('page')).toEqual({ name: 'STORY', epic: 'tA', story: 'S3', phase: null })
  expect((await linesAt(ui, 190))[0]).toContain('Cancel payment API › S3 PG cancel webhook')
  await pressKey(ui, 'a')
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
  for (let i = 0; i < 12; i++) await pressKey(ui, 'w')
  expect((await linesAt(ui, 190)).find(l => /▸/.test(l))).toContain('⚑')
})

test('keys: n jumps to the next flag from any page and wraps', async ($, on) => {
  const { seen } = await seeded($, on, P_FIXTURE(), 'terminal', undefined, { epic: 'tA', page: FLOOR_PAGE })
  const ui = await atCols($, 'terminal', 190)
  await pressKey(ui, 'n')
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
  expect(seen.store.get('pageSel')).toMatchObject({ 'HOME:::': 'f:tA:ask:E-3f9a2c11/S2' })
  await pressKey(ui, 'n')
  expect(seen.store.get('pageSel')).toMatchObject({ 'HOME:::': 'f:tA:stall:S3' })
  await pressKey(ui, 'n')
  expect(seen.store.get('pageSel')).toMatchObject({ 'HOME:::': 'f:tA:ask:E-3f9a2c11/S2' })
})

test('keys: n with no flag listed says so and moves nothing; the next key clears the hint', async ($, on) => {
  const data = P_FIXTURE({ tasks: P_TASKS({ workers: [], you: { count: 0, items: [], cards: [] } }) })
  const none = await seeded($, on, data, 'terminal', undefined, { epic: 'tA' })
  const two = await atCols($, 'terminal', 190)
  await pressKey(two, 'n')
  expect(none.seen.store.get('flagHint')).toBe(true)
  expect(await shown(two)).toContain(STRINGS.en.f2HintNoFlag)
  expect(none.seen.store.get('page') ?? HOME_PAGE).toEqual(HOME_PAGE)
  await pressKey(two, 'w')
  expect(none.seen.store.get('flagHint')).toBe(false)
})

test('Enter on an ask flag opens answer mode, Enter on another flag opens its STORY; q closes; old keys do nothing', async ($, on) => {
  const closed: string[] = []
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
  const { seen } = await seeded($, on, P_FIXTURE(), 'terminal', undefined, { epic: 'tA', pageSel: { 'HOME:::': 'f:tA:ask:E-3f9a2c11/S2' } })
  const ui = await atCols($, 'terminal', 190)
  await ui.input({ key: 'keys', text: '', kind: 'submit' } as never)
  expect(seen.store.get('page')).toEqual({ name: 'ANSWER', epic: 'tA', story: 'S2', phase: null })
  expect(seen.store.get('pageFrom')).toEqual(HOME_PAGE)
  // `a` is text while answering: an empty Enter cancels and goes back to the page ANSWER was opened from
  await ui.redraw()
  await ui.input({ key: 'answer', text: '', kind: 'submit' } as never)
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
  await ui.redraw()
  await pressKey(ui, 'n')
  await ui.input({ key: 'keys', text: '', kind: 'submit' } as never)
  expect(seen.store.get('page')).toEqual({ name: 'STORY', epic: 'tA', story: 'S3', phase: null })
  for (const k of ['0', '1', '5', '[', ']', 'j', 'k', 'g']) await pressKey(ui, k)
  expect(seen.store.get('page')).toEqual({ name: 'STORY', epic: 'tA', story: 'S3', phase: null })
  await pressKey(ui, 'q')
  expect(closed).toEqual(['teams-status'])
})

test('a page of an EPIC that left the listing returns to HOME with HOME\'s remembered row, on the next tick and on a redraw', async ($, on) => {
  const data = P_FIXTURE()
  const { seen, tick } = await seeded($, on, data, 'terminal', undefined, { epic: 'tA', page: FLOOR_PAGE, pageSel: { 'HOME:::': 'e:tB' } })
  const ui = await atCols($, 'terminal', 190)
  expect((await linesAt(ui, 190))[0]).toContain('FLOOR')
  data.tasks = P_TASKS().slice(1)
  await tick()
  await ui.redraw()
  expect((await linesAt(ui, 190))[0]).toMatch(/^teams/)
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
  expect((await linesAt(ui, 190)).find(l => /▸/.test(l))).toContain('E-71c2a0f4')
})

test('the selected row that leaves the list falls to the nearest listed row, and nothing is selected on an empty list', async ($, on) => {
  const data = P_FIXTURE()
  const { seen, tick } = await seeded($, on, data, 'terminal', undefined, { epic: 'tA', pageSel: { 'HOME:::': 's:tA:S4' } })
  const ui = await atCols($, 'terminal', 190)
  expect((await linesAt(ui, 190)).find(l => /▸/.test(l))).toContain('S4')
  data.tasks = P_TASKS({ items: P_STORIES().slice(0, 3) })
  await tick()
  await ui.redraw()
  // S4 sat last in its EPIC: its neighbours are S3 above and the next EPIC below, and the tie goes to the row below (fallbackSelection)
  expect((await linesAt(ui, 190)).find(l => /▸/.test(l))).toContain('E-71c2a0f4')
  expect(seen.store.get('pageSel')).toMatchObject({ 'HOME:::': 'e:tB' })
})

test('FLOOR: six Phase rows with mark, number, name, elapsed, cost, who works, decisions, flag and stall counts; header on the right; Phase 6 hint', async ($, on) => {
  const { lines } = await homeLines($, on, 190, P_FIXTURE(), 'terminal', undefined, { page: FLOOR_PAGE })
  sound(lines, 190)
  expect(lines[0]).toMatch(/^Cancel payment API › FLOOR +Phase 2\/6 Build · 22m · \$2\.47$/)
  const rows = lines.filter(l => /^[▸ ] ?[✔●○✘]  ?\d /.test(l.replace(/^ +/, '')) || /[✔●○] +\d (Plan|Build|Integrate|QA|Gate|Report)/.test(l))
  expect(rows).toHaveLength(6)
  const [plan, build, integrate, , , report] = rows as [string, string, string, string, string, string]
  for (const part of ['✔', '1 Plan', '5m', '$0.40', 'decisions 3']) expect(plan).toContain(part)
  for (const part of ['●', '2 Build', '14m', '$2.07', '2 working', 'decisions 1', '⚑ 1', '⏸ 1']) expect(build).toContain(part)
  expect(integrate).toMatch(/○ +3 Integrate +–/)
  expect(report).toContain('6 Report')
  expect(report).toContain('EPIC report opens here')
  expect(lines.at(-1)).toContain('w s move · d ⏎ Phase detail')
})

test('FLOOR draws no count or cost the engine did not send', async ($, on) => {
  const { lines } = await homeLines($, on, 190, P_FIXTURE({ tasks: P_TASKS({ phases: undefined, metrics: { drivers: { live: 1, cap: 2 } } }) }), 'terminal', undefined, { page: FLOOR_PAGE })
  const text = lines.join('\n')
  expect(text).not.toMatch(/decisions|working|⚑ \d|⏸ \d|\$0\.|\$1\./)
})

for (const lang of [undefined, 'korean'] as const) {
  for (const page of [HOME_PAGE, FLOOR_PAGE]) {
    for (const cols of [190, 110]) {
      test(`${page.name} in ${lang ?? 'English'} at ${cols} columns: only table words, nothing wider than the pane, no cut glyph`, async ($, on) => {
        const { lines, ui } = await homeLines($, on, cols, P_FIXTURE(), 'terminal', lang, { page })
        sound(lines, cols)
        const text = visible(await ui.drawn())
        if (lang === undefined) expect(hangulIn(text, F4_DATA)).toEqual([])
        else {
          expect(latinOutside(text, F4_CUTS)).toEqual([])
          expect(hangulIn(text, F4_DATA).length > 0).toBe(true)
        }
        F2_SHOTS.push({ name: `demo-${page.name.toLowerCase()}${lang === undefined ? 'en' : 'ko'}-${cols}`, lines })
      })
    }
  }
}
const F2_SHOTS: { name: string; lines: string[] }[] = []

// ---- HOME's EPIC rows on every surface (restored from the tab-era pane tests, re-expressed on homeRows) ----
// one running EPIC, one waiting on a person, one whose driver F3 reports stopped (workers[] stalled with minutes, no heartbeat), one ended
const H_LONG = 'Migrate every legacy report exporter to the new streaming writer and keep each output identical'
const H_TASKS = (over: Record<string, unknown> = {}) => [
  epicOf('tA', 'E-aaaaaaaa', [story('S1', 'parse the header', { state: 'idle' })], { title: 'Alpha parser', slug: 'alpha-slug', done: 1, total: 3, ...over }),
  epicOf('tB', 'E-bbbbbbbb', [], { title: 'Beta exporter', slug: 'beta-slug', state: 'waiting_human', done: 2, total: 3 }),
  epicOf('tC', 'E-cccccccc', [], { title: 'Gamma sync', slug: null, live: false, age_ms: 7200000, workers: [{ ...wk('S9', 'stalled'), minutes: 23 }], done: 0, total: 2 }),
  epicOf('tD', 'E-dddddddd', [], { title: 'Delta cleanup', slug: 'delta-slug', state: 'complete', live: false, age_ms: 3600000, done: 2, total: 2 }),
]
// the EPIC row of a title: it carries the open or fold glyph and is neither a flag row (›, ⚑ section) nor a STORY row
const epicLine = (lines: string[], title: string) => lines.find(l => l.includes(title) && /[▾▸]/.test(l.replace(/^▸/, ' ')) && !l.includes('›'))
const compactOf = (surface: Surface) => surface === 'mobile'

for (const surface of SURFACES) {
  test(`${surface}: HOME lists every EPIC, the picked one marked, the stalled one last of the running and dim with its age`, async ($, on) => {
    const { ui, lines } = await homeLines($, on, 190, P_FIXTURE({ tasks: H_TASKS() }), surface, undefined, { pageSel: { 'HOME:::': 'e:tB' } })
    sound(lines, 190)
    const titles = ['Alpha parser', 'Beta exporter', 'Gamma sync', 'Delta cleanup']
    const rows = titles.map(t => epicLine(lines, t))
    expect(rows.every(r => r !== undefined)).toBe(true)
    // order: running, waiting, stalled, then the ended one folded below them
    const at = rows.map(r => lines.indexOf(r!))
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    // the picked row carries ▸ at the line start; no other row does
    expect(lines.filter(l => l.startsWith('▸')).map(l => l.includes('Beta exporter'))).toEqual([true])
    // the stalled row: its age, the ⏸ icon in the inactive colour, the age dim
    expect(rows[2]).toContain('2h 0m')
    expect(rows[2]).toContain('⏸')
    expect((await ui.findAll({ type: 'Text', text: /^⏸\s*$/ })).map(t => t.props.color)).toContain('inactive')
    expect((await ui.findAll({ type: 'Text', text: /^2h 0m\s*$/ })).map(t => t.props.dimColor)).toEqual([true])
    if (!compactOf(surface)) for (const [i, key] of ['E-aaaaaaaa', 'E-bbbbbbbb', 'E-cccccccc', 'E-dddddddd'].entries()) expect(rows[i]).toContain(key)
  })

  test(`${surface}: running, stalled, waiting and finished EPICs read differently on HOME; a failed STORY shows its reason once`, async ($, on) => {
    const failed = story('S5', 'verify the receipt', { state: 'failed', metrics: numsOf(3, judgeOf('reject', 40, 3, 'verifier rejected: tests red')) })
    const tasks = H_TASKS({ items: [story('S1', 'parse the header', { state: 'idle' }), story('S2', 'write the rows', { doing: 'editing a.ts' }), failed] })
    const { lines } = await homeLines($, on, 190, P_FIXTURE({ tasks }), surface)
    sound(lines, 190)
    const iconOf = (title: string) => /[●⏸✔⚑◌✘]/.exec(epicLine(lines, title)!)![0]
    const epicIcons = ['Alpha parser', 'Beta exporter', 'Gamma sync', 'Delta cleanup'].map(iconOf)
    expect(epicIcons).toEqual(['●', '⚑', '⏸', '✔'])
    expect(new Set(epicIcons).size).toBe(4)
    const storyIcons = ['parse the header', 'write the rows', 'verify the receipt'].map(t => /[●⏸✔⚑◌✘]/.exec(lines.find(l => l.includes(t))!)![0])
    expect(storyIcons).toEqual(['◌', '●', '✘'])
    const text = lines.join('\n')
    expect(text.split('verifier rejected: tests red')).toHaveLength(2) // the reason, once
    expect(lines.find(l => l.includes('verify the receipt'))).toContain('verifier rejected: tests red')
  })

  // the slug is not a HOME column; the title takes the width and gives way first, at 190 and 110 columns
  for (const cols of [190, 110]) {
    test(`${surface}: the EPIC row has no slug and cuts the title first at ${cols}`, async ($, on) => {
      const tasks = H_TASKS({ title: H_LONG, slug: 'report-exporters' })
      const { ui, lines } = await homeLines($, on, cols, P_FIXTURE({ tasks }), surface)
      sound(lines, cols)
      const rows = ['Migrate', 'Beta exporter', 'Gamma sync', 'Delta cleanup'].map(t => epicLine(lines, t)!)
      for (const l of lines) expect(l).not.toMatch(/report-exporters|alpha-slug|beta-slug|delta-slug/)
      const [a, b, c] = rows as [string, string, string, string]
      if (cols === 110) {
        expect(a).toContain('…')
        expect(a).not.toContain('keep each output identical')
      } else {
        expect(a).toContain('keep each output identical')
        expect(a).not.toContain('…')
      }
      // columns align across the running rows: every title starts at one offset
      expect(new Set([width(a.slice(0, a.indexOf('Migrate'))), width(b.slice(0, b.indexOf('Beta'))), width(c.slice(0, c.indexOf('Gamma')))]).size).toBe(1)
      // the title gives way first: everything after it (rail or phase word, STORY count, age, cost) keeps the width it has at 190
      await ui.unmount()
      const full = epicLine(await linesAt(await atCols($, surface, 190), 190), 'Migrate')!
      const tail = (l: string) => l.slice(l.search(/✔Plan|\bBuild\b/)).trimEnd()
      expect(tail(a)).toBe(tail(full))
      if (!compactOf(surface)) for (const part of ['E-aaaaaaaa', '✔Plan', '●QA', 'STORY 1/3', '3s']) expect(a).toContain(part)
    })
  }

  // the title cell (⑂ worktree · title) is cut from its end at 110 columns: the title tail goes, the ⑂ mark and the worktree stay, the row keeps its cells
  test(`${surface}: a long title with a worktree is cut to … at 110 columns, the ⑂ mark stays`, async ($, on) => {
    const tasks = [
      epicOf('tW', 'E-aaaaaaaa', [], { title: H_LONG, worktree: 'feature-worktree', done: 1, total: 3 }),
      epicOf('tS', 'E-bbbbbbbb', [], { title: 'short', worktree: null, done: 2, total: 3 }),
    ]
    const { lines } = await homeLines($, on, 110, P_FIXTURE({ tasks }), surface)
    sound(lines, 110)
    const w = epicLine(lines, '⑂')!
    const s = epicLine(lines, 'short')!
    expect(w).toContain('⑂ feature-worktree · Migrate')
    expect(w).toContain('…')
    expect(w).not.toContain('keep each output identical')
    expect(w.indexOf('…')).toBeGreaterThan(w.indexOf('feature-worktree')) // the cut is in the title, after the mark and the worktree name
    if (!compactOf(surface)) {
      expect(w).toContain('STORY 1/3')
      expect(s).toContain('STORY 2/3')
    }
    expect(width(w.slice(0, w.indexOf('⑂')))).toBe(width(s.slice(0, s.indexOf('short'))))
    expect(s).not.toContain('⑂')
  })
}

// mixed Korean and English titles: one Korean-title EPIC and one English-title EPIC listed together at pane width 78 and 46
const KO_TITLE = '메모 앱에 태그 검색 추가'
const EN_TITLE = 'Add CSV export to the reports page'
for (const cols of [78, 46]) {
  test(`HOME: mixed Korean and English EPIC rows at pane width ${cols}: same column offsets, no line wider, the title keeps room, no lone …`, async ($, on) => {
    const tasks = [epicOf('tA', 'E-3a3a3bb5', [], { title: KO_TITLE, done: 1, total: 3 }), epicOf('tB', 'E-bbbbbbbb', [], { title: EN_TITLE, done: 2, total: 3 })]
    const { lines } = await homeLines($, on, cols, P_FIXTURE({ tasks: tasks, status: stat() }), 'terminal', undefined, {}) // header, no flags
    for (const l of lines) expect(width(l)).toBeLessThanOrEqual(cols - 4)
    const ko = epicLine(lines, '메')!
    const en = epicLine(lines, 'Add')!
    expect([ko, en].every(r => r !== undefined)).toBe(true)
    // the title starts at one display-cell offset, and so does the Phase rail or whatever column follows it
    expect(width(ko.slice(0, ko.indexOf('메')))).toBe(width(en.slice(0, en.indexOf('Add'))))
    const next = (r: string) => r.search(/●Build|✔Plan|\d+[smh]\b/)
    expect(width(ko.slice(0, next(ko)))).toBe(width(en.slice(0, next(en))))
    for (const l of lines) expect(/\s…(\s|$)/.test(l)).toBe(false)
    // the title keeps 12 cells before any …
    for (const [r, first] of [[ko, '메'], [en, 'Add']] as const) {
      const from = r.slice(r.indexOf(first))
      const end = from.search(/ {2}(?:●|✔|○|\d)/)
      const title = (end >= 0 ? from.slice(0, end) : from).trimEnd()
      const cut = title.indexOf('…')
      expect(width(cut >= 0 ? title.slice(0, cut) : title)).toBeGreaterThanOrEqual(12)
    }
  })
}

test('the Korean HOME flags, folded row and header use the Korean table', async ($, on) => {
  const { lines } = await homeLines($, on, 190, P_FIXTURE(), 'terminal', 'korean')
  const text = lines.join('\n')
  for (const part of ['나를 기다림 2', '9m 대기', '응답 없음 23m (드라이버 멈춤?)', '끝남 2h 0m 전 · STORY 5/5', 'drivers 5/8 · load 3.1/8 (머신 전체)', '직전 61/80', '⏸ 23분']) expect(text).toContain(part)
  expect(lines.at(-1)).toContain('w s 이동')
  expect(lines.at(-1)).toMatch(/l KR$/)
})

// ---- F2 pages: Phase detail (with the decisions thread), STORY detail, Log, STORY Report and the EPIC report ----
const FLOW = ['plan', 'setgoal', 'critique', 'implement', 'test', 'gate']
const dn = (state: string, extra: Record<string, unknown> = {}) => ({ state, ...extra })
const S2_PAYLOAD = {
  task_id: 'tA', story: 'S2', key: 'E-3f9a2c11/S2', title: 'refund idempotency key', state: 'running', attempt: 2,
  flow: [dn('done'), dn('done'), dn('done'), dn('running'), dn('pending'), dn('pending')].map((f, i) => ({ key: FLOW[i], ...f })),
  progress: { try_done: 4, try_total: 6, total_done: 10, total_all: 18 },
  grid: {
    stages: FLOW,
    attempts: [
      { attempt: 1, cells: { plan: dn('done'), setgoal: dn('done'), critique: dn('done'), implement: dn('done'), test: dn('done'), gate: dn('failed', { score: 61, threshold: 80, reason: 'duplicate request double refund test missing' }) } },
      { attempt: 2, cells: { plan: dn('done'), setgoal: dn('done'), critique: dn('done'), implement: dn('running'), test: null, gate: null } },
    ],
  },
  participants: { source: 'stream', total: [{ kind: 'implementer', model: 'sonnet', n: 1 }, { kind: 'critic', model: 'opus', n: 1 }], live: [{ kind: 'implementer', model: 'sonnet', n: 1 }] },
  workers: [wk('S2', 'acting', 'editing parser.ts'), wk('judge', 'idle')],
  log: [
    { ts: ago(40), time: '13:37', node: 'plan', state: 'done', what_key: 'F2.log.subgoals', numbers: { n: 2 }, note: null },
    { ts: ago(39), time: '13:40', node: 'setgoal', state: 'done', what_key: 'F2.log.criteria', numbers: { n: 5 }, note: null },
    { ts: ago(30), time: '13:51', node: 'implement', state: 'done', what_key: 'F2.log.attemptCommits', numbers: { n: 1, c: 3 }, note: null },
    { ts: ago(20), time: '14:03', node: 'gate', state: 'failed', what_key: 'F2.log.attemptReject', numbers: { n: 1, score: 61, threshold: 80 }, note: 'duplicate request double refund test missing' },
    { ts: ago(10), time: '14:05', node: 'ask', state: 'waiting', what_key: 'F2.log.asked', numbers: { question: 'How many retries on refund failure?' }, note: null },
    { ts: ago(0.2), time: '14:12', node: 'implement', state: 'running', what_key: 'F2.log.attemptStart', numbers: { n: 2 }, note: null },
  ],
}
const S1_REPORT = {
  task_id: 'tA', story: 'S1', finished: true, text: '# S1\n', verdict: { score: 91, threshold: 80, attempt: 1, max: 3, tests: 'pass' },
  sections: [
    { key: 'result', lines: ['POST cancel endpoint adds the reason enum'] },
    { key: 'verdict', lines: ['score=91', 'threshold=80', 'attempt=1', 'max=3', 'tests=pass'] },
    { key: 'files', lines: ['cancel_reason.py', 'cancel_api.py'] },
    { key: 'decisions', lines: ['enum or free text: enum'] },
    { key: 'left', lines: ['multi-language reason text (belongs to S4)'] },
    { key: 'seeLog', lines: ['tm_log E-3f9a2c11/S1', 'tm_retry E-3f9a2c11/S1'] },
  ],
}
const S2_REPORT = { task_id: 'tA', story: 'S2', finished: false, text: '', sections: [{ key: 'seeLog', lines: ['tm_log E-3f9a2c11/S2', 'tm_retry E-3f9a2c11/S2'] }] }
// the Plan thread: a proposal, a judge's verdict, a person's answer and a re-split, with the engine's key beside each English word
const dec = (over: Record<string, unknown>) => ({ ts: 1, time: '10:00', card: null, node: null, kind: 'decision', phase: 'plan', ...over })
const PLAN_THREAD = {
  card: null,
  entries: [
    dec({ time: '09:58', node: 'size', kind: 'proposal', actor: 'claude·opus', text: 'size S · develop', text_key: 'proposalSizeFlow', text_vars: { size: 'S', flow: 'develop' } }),
    dec({ time: '10:05', node: 'critique', kind: 'verdict', actor: 'claude·sonnet', verdict: 'reject', score: 70, reason: 'AC 3 missing', gaps: ['AC 3 untested'] }),
    dec({ time: '10:06', node: 'critique', kind: 'answer', actor: 'human', actor_key: 'actorHuman', text: 'reject: overlap' }),
    dec({ time: '10:09', kind: 'resplit', reason: 'resplit → areas:3', reason_key: 'resplitAreas', reason_vars: { n: 3 } }),
    dec({ time: '10:11', kind: 'resplit', reason: 'replan S2, S3', reason_key: 'replanIds', reason_vars: { ids: 'S2, S3' } }),
    dec({ time: '10:14', card: 'S2', node: 'accept:S2:1', phase: 'build', kind: 'verdict', actor: 'claude·sonnet', verdict: 'reject', score: 61, reason: 'AC 3 missing' }),
  ],
}
const PAGES_FIXTURE = (over: Partial<Data> = {}): Data => P_FIXTURE({
  stories: { S2: S2_PAYLOAD }, storyReports: { S1: S1_REPORT, S2: S2_REPORT }, decisions: () => PLAN_THREAD, ...over,
})
const PHASE_BUILD = { name: 'PHASE', epic: 'tA', story: null, phase: 2 }
const PHASE_PLAN = { name: 'PHASE', epic: 'tA', story: null, phase: 1 }
const STORY_S2 = { name: 'STORY', epic: 'tA', story: 'S2', phase: null }
const LOG_S2 = { name: 'LOG', epic: 'tA', story: 'S2', phase: null }
const REPORT_S1 = { name: 'STORY_REPORT', epic: 'tA', story: 'S1', phase: null }
const REPORT_S2 = { name: 'STORY_REPORT', epic: 'tA', story: 'S2', phase: null }
const NEEDS_PAYLOAD = payload({
  task_id: 'tA', verdict: 'blocked', failed: 1, needs: {
    items: ['refund ledger: never dispatched', 'audit trail: state: pending', 'a note a person wrote'], more: 0,
    entries: [
      { text: 'refund ledger: never dispatched', name: 'refund ledger', reason: 'never dispatched', reason_key: 'reasonNeverDispatched', reason_vars: {} },
      { text: 'audit trail: state: pending', name: 'audit trail', reason: 'state: pending', reason_key: 'reasonState', reason_vars: { state: 'pending' } },
      { text: 'a note a person wrote' },
    ],
  },
  path: '/proj/.teams_output/team/E-tA/80-report.md', report: { text: REPORT_TEXT, truncated: false, more_lines: 0, mtime: 7 },
  retro: { next_backlog: { unaccepted_packages: [
    { id: 'P1', title: 'refund ledger', reason: 'never dispatched', reason_key: 'reasonNeverDispatched', reason_vars: {} },
    { id: 'P2', title: 'audit trail', reason: 'state: pending', reason_key: 'reasonState', reason_vars: { state: 'pending' } },
  ] } },
})
const EPIC_REPORT = { name: 'EPIC_REPORT', epic: 'tA', story: null, phase: null }
const REPORT_FIXTURE = (): Data => PAGES_FIXTURE({ reports: { tA: NEEDS_PAYLOAD } })
const at$ = (lines: string[], part: string) => lines.findIndex(l => l.includes(part))

test('PHASE: Running, Handed over and Decisions in that order; the workers, the hand-offs and the thread of this Phase only', async ($, on) => {
  const { lines } = await homeLines($, on, 190, PAGES_FIXTURE({ decisions: () => ({ card: null, entries: [...PLAN_THREAD.entries] }) }), 'terminal', undefined, { page: PHASE_BUILD })
  sound(lines, 190)
  const [running, handed, decisions] = [at$(lines, 'Running'), at$(lines, 'Handed over'), at$(lines, 'Decisions (this Phase)')]
  expect(running > 0 && handed > running && decisions > handed).toBe(true)
  expect(lines[0]).toMatch(/^Cancel payment API › FLOOR › 2 Build +14m · \$2\.07$/)
  const mine = lines.slice(running + 1, handed).join('\n')
  expect(mine).toMatch(/⏸ +S3 +⏸ 23m/)
  // STORY · node · role · what · elapsed, all from the engine's worker
  expect(mine).toMatch(/● +\S+ +S2 +implement +implementer +editing parser\.ts +11m/)
  expect(mine).not.toMatch(/S1|PLAN/) // a finished worker, and one of another Phase
  const feed = lines.slice(handed + 1, decisions)
  // time · STORY · who · what, score, reason · where it goes
  expect(feed[0]).toMatch(/14:03 +S2 +judge +reject 61 "AC 3 missing" +→ implementer/)
  expect(feed[1]).toMatch(/13:58 +S1 +integrated 1 +→ judge/)
  expect(feed[2]).toMatch(/13:52 +S2 +TeamLeader +"How many retries on refund failure\?" +→ you/)
  expect(feed[3]).toMatch(/13:40 +S1 +judge +accept 91 +→ integrate/)
  // only the Build thread: the STORY's own verdict; the Plan entries are not here
  const thread = lines.slice(decisions + 1).join('\n')
  expect(thread).toContain('accept:S2:1')
  expect(thread).not.toMatch(/proposed|answered|re-split/)
  expect(lines.at(-1)).toContain('w s scroll')
  expect(lines.some(l => /Decisions$/.test(l.trim()) && !l.includes('(this Phase)'))).toBe(false) // Decisions is a section, not a page
})

test('PHASE: ⏸ with minutes only from the engine; a stalled worker without them draws no ⏸; the Phase count and spend only when sent', async ($, on) => {
  // the engine counts a stalled worker only with its minutes, so a worker without them is no ⏸ in the Phase count either
  const bare = P_TASKS({ workers: [{ ...wk('S3', 'stalled'), phase: 'build' }, { ...wk('S2', 'acting', 'editing parser.ts'), phase: 'build' }], phases: P_PHASES.map(p => ({ ...p, stalled: 0 })), metrics: { drivers: { live: 1, cap: 2 } } })
  const { lines } = await homeLines($, on, 190, PAGES_FIXTURE({ tasks: bare }), 'terminal', undefined, { page: PHASE_BUILD })
  const text = lines.join('\n')
  expect(text).not.toContain('⏸')
  expect(text).toContain('S3')
  expect(lines[0]).toMatch(/^Cancel payment API › FLOOR › 2 Build *$/)
})

test('PHASE: the engine tags each decision with its Phase; a task.decisions entry (no node, phase qa) is on the QA page and not on Plan', async ($, on) => {
  const qa = dec({ time: null, kind: 'decision', actor: 'claude·opus', text: 'coverage floor: 80', phase: 'qa' })
  const fixture = () => PAGES_FIXTURE({ decisions: () => ({ card: null, entries: [...PLAN_THREAD.entries, qa] }) })
  const onQa = await homeLines($, on, 190, fixture(), 'terminal', undefined, { page: { name: 'PHASE', epic: 'tA', story: null, phase: 4 } })
  expect(onQa.lines.slice(at$(onQa.lines, 'Decisions (this Phase)') + 1).join('\n')).toContain('coverage floor: 80')
  expect(onQa.lines.join('\n')).not.toContain('accept:S2:1') // a Build entry stays off the QA page
})

test('PHASE: a task.decisions entry tagged qa is not on the Plan page', async ($, on) => {
  const qa = dec({ time: null, kind: 'decision', actor: 'claude·opus', text: 'coverage floor: 80', phase: 'qa' })
  const onPlan = await homeLines($, on, 190, PAGES_FIXTURE({ decisions: () => ({ card: null, entries: [...PLAN_THREAD.entries, qa] }) }), 'terminal', undefined, { page: PHASE_PLAN })
  expect(onPlan.lines.join('\n')).not.toContain('coverage floor: 80')
  expect(onPlan.lines.join('\n')).toContain('size S · develop')
})

test('PHASE: the Phase\'s own counts (working, needs you, stalled, decisions) are drawn from phases[] when present', async ($, on) => {
  const withCounts = await homeLines($, on, 190, PAGES_FIXTURE(), 'terminal', undefined, { page: PHASE_BUILD })
  expect(withCounts.lines[2]).toMatch(/^ +2 working · ⚑ 1 · ⏸ 1 · decisions 1$/)
})

test('PHASE: with no phases[] from the engine no count is drawn for the Phase', async ($, on) => {
  const bare = await homeLines($, on, 190, PAGES_FIXTURE({ tasks: P_TASKS({ phases: undefined }) }), 'terminal', undefined, { page: PHASE_BUILD })
  expect(bare.lines.join('\n')).not.toMatch(/decisions \d|working · /)
  expect(bare.lines[2]).toContain('Running')
})

test('PHASE: the thread is drawn through keys; w and s scroll it, stopping at both ends', async ($, on) => {
  const many = { card: null, entries: Array.from({ length: 24 }, (_, i) => dec({ time: `10:${String(i).padStart(2, '0')}`, card: 'S2', node: 'accept:S2:1', phase: 'build', kind: 'verdict', actor: 'claude·sonnet', verdict: 'reject', score: 50 + i, reason: 'AC 3 missing' })) }
  const { seen } = await seeded($, on, PAGES_FIXTURE({ decisions: () => many }), 'terminal', undefined, { epic: 'tA', page: PHASE_BUILD }, true)
  const ui = await atCols($, 'terminal', 190)
  const first = await linesAt(ui, 190)
  expect(first.join('\n')).toContain('▼ ')
  expect(first.join('\n')).not.toContain('▲ ')
  await pressKey(ui, 's')
  expect(seen.store.get('pageScroll')).toEqual({ 'PHASE:tA::2': 1 })
  expect((await linesAt(ui, 190)).join('\n')).toContain('▲ 1')
  for (let i = 0; i < 60; i++) await pressKey(ui, 's')
  const end = await linesAt(ui, 190)
  expect(end.join('\n')).not.toContain('▼ ')
  expect(end.join('\n')).toContain('10:23')
  const stop = (seen.store.get('pageScroll') as Record<string, number>)['PHASE:tA::2']!
  await pressKey(ui, 's')
  expect((seen.store.get('pageScroll') as Record<string, number>)['PHASE:tA::2']).toBe(stop)
  for (let i = 0; i < 80; i++) await pressKey(ui, 'w')
  expect((seen.store.get('pageScroll') as Record<string, number>)['PHASE:tA::2']).toBe(0)
})

test('STORY: FLOW, progress, participants, the attempt grid with the rejected judge and its reason, the ask, the Log and Report rows', async ($, on) => {
  const { lines } = await homeLines($, on, 190, PAGES_FIXTURE(), 'terminal', undefined, { page: STORY_S2 })
  sound(lines, 190)
  expect(lines[0]).toMatch(/^Cancel payment API › S2 refund idempotency key +implement · try 2\/3 · \$0\.40 · 11m$/)
  const text = lines.join('\n')
  expect(lines.find(l => l.startsWith('FLOW'))).toMatch(/^FLOW +✔plan ━ ✔setgoal ━ ✔critique ━ ●implement ┄ ○test ┄ ○gate$/)
  expect(text).toMatch(/Progress +████████░░░░ +this try 4\/6 nodes · total 10\/18 \(based on 2 tries\)/)
  expect(text).toMatch(/Participants +subagent: 2 total · 1 live/)
  expect(text).toContain('implementer ×1 sonnet  critic ×1 opus')
  const grid = lines.filter(l => /^\d\/3 /.test(l.trim()))
  expect(grid).toHaveLength(2)
  expect(grid[0]).toMatch(/1\/3 +✔ +✔ +✔ +✔ +✔ +✘ 61\/80 +"duplicate request double refund test missing"/)
  expect(grid[1]).toMatch(/2\/3 +✔ +✔ +✔ +●/)
  expect(lines.some(l => l.trim() === 'Now')).toBe(true)
  expect(lines.find(l => /^● +\S+ +S2 /.test(l.trim()))).toContain('editing parser.ts')
  expect(lines.find(l => l.includes('⚑ S2 → you'))).toMatch(/▸ +⚑ S2 → you +"How many retries on refund failure\?" +9m waiting +⏎ answer/)
  expect(text).toMatch(/Log 6 · last 12s ago/)
  expect(text).toContain('Report: appears after the gate passes')
  expect(lines.at(-1)).toContain('w s move · d ⏎ open')
})

test('STORY: d on the Log row opens Log, d on the Report row opens the STORY Report, a returns to the row; Enter on the ask opens answer mode', async ($, on) => {
  const { seen } = await seeded($, on, PAGES_FIXTURE(), 'terminal', undefined, { epic: 'tA', page: STORY_S2 }, true)
  const ui = await atCols($, 'terminal', 190)
  expect((await linesAt(ui, 190)).find(l => l.includes('⚑ S2 → you'))).toContain('▸') // the ask leads and is selected first
  await pressKey(ui, 's')
  await pressKey(ui, 'd')
  expect(seen.store.get('page')).toEqual(LOG_S2)
  expect((await linesAt(ui, 190))[0]).toContain('Cancel payment API › S2 refund idempotency key › Log')
  await pressKey(ui, 'a')
  expect(seen.store.get('page')).toEqual(STORY_S2)
  expect((await linesAt(ui, 190)).find(l => l.includes('Log 6'))).toContain('▸')
  await pressKey(ui, 's')
  await pressKey(ui, 'd')
  expect(seen.store.get('page')).toEqual(REPORT_S2)
  await pressKey(ui, 'a')
  await pressKey(ui, 'w')
  await pressKey(ui, 'w')
  await pressKey(ui, 'd')
  expect(seen.store.get('page')).toEqual({ name: 'ANSWER', epic: 'tA', story: 'S2', phase: null })
})

test('LOG: time · node · what · note, newest first, the entry count in the header, no f filter, w and s scroll', async ($, on) => {
  const { lines } = await homeLines($, on, 190, PAGES_FIXTURE(), 'terminal', undefined, { page: LOG_S2 })
  sound(lines, 190)
  expect(lines[0]).toMatch(/^Cancel payment API › S2 refund idempotency key › Log +6 entries$/)
  const rows = lines.filter(l => /^\d\d:\d\d /.test(l))
  expect(rows).toHaveLength(6)
  expect(rows[0]).toMatch(/^14:12 +● implement +attempt 2 started *$/)
  expect(rows[1]).toMatch(/^14:05 +⚑ ask +TeamLeader → me "How many retries on refund failure\?" *$/)
  expect(rows[2]).toMatch(/^14:03 +✘ gate +attempt 1 reject 61\/80 +"duplicate request double refund test missing"$/)
  expect(rows[3]).toMatch(/^13:51 +✔ implement +attempt 1 commits 3 *$/)
  expect(rows[5]).toMatch(/^13:37 +✔ plan +2 subgoals *$/)
  expect(new Set(rows.map(r => r.indexOf(/implement|ask|gate|plan|setgoal/.exec(r)![0]))).size).toBe(1) // one node column
  expect(lines.join('\n')).not.toMatch(/ f |filter|failures/i)
  expect(lines.at(-1)).toContain('w s scroll · a back')
})

test('STORY Report before the gate reads "Not available yet" and draws no section', async ($, on) => {
  const before = await homeLines($, on, 190, PAGES_FIXTURE(), 'terminal', undefined, { page: REPORT_S2 })
  expect(before.lines.join('\n')).toContain('Not available yet: appears after the gate passes')
  expect(before.lines.join('\n')).not.toMatch(/Result|Judge|tm_retry/)
})

test('STORY Report: sections from the keys, ending in tm_log and tm_retry as text, no retry or cancel Button', async ($, on) => {
  const { lines, ui } = await homeLines($, on, 190, PAGES_FIXTURE(), 'terminal', undefined, { page: REPORT_S1 })
  sound(lines, 190)
  expect(lines[0]).toMatch(/^Cancel payment API › S1 cancel reason enum › Report +accepted 91\/80 · 4m$/)
  const rows = lines.filter(l => /^(Result|Judge|Files changed|Decisions|Left over|Look again) /.test(l))
  expect(rows).toHaveLength(6)
  expect(rows[0]).toMatch(/^Result +POST cancel endpoint adds the reason enum$/)
  expect(rows[1]).toMatch(/^Judge +judge 91 \/ threshold 80 · attempt 1\/3 · tests pass$/)
  expect(rows[2]).toMatch(/^Files changed +cancel_reason\.py · cancel_api\.py$/)
  expect(rows[5]).toMatch(/^Look again +tm_log E-3f9a2c11\/S1 · tm_retry E-3f9a2c11\/S1$/)
  expect((await labels(ui)).filter(l => /retry|cancel/i.test(l))).toEqual([])
  expect(lines.at(-1)).toContain('w s scroll · a back')
})

test('EPIC report: FLOOR Phase 6 opens it; it draws the report, the path and the needs; a returns to FLOOR; no placeholder is left', async ($, on) => {
  const { seen } = await seeded($, on, REPORT_FIXTURE(), 'terminal', undefined, { epic: 'tA', page: FLOOR_PAGE, pageSel: { 'FLOOR:tA::': 'p:6' } }, true)
  const ui = await atCols($, 'terminal', 190)
  await pressKey(ui, 'd')
  expect(seen.store.get('page')).toEqual(EPIC_REPORT)
  const text = visible(await ui.drawn())
  expect(text).toContain('/proj/.teams_output/team/E-tA/80-report.md')
  expect(text).toContain('All packages shipped.')
  expect(text).toContain('⚑ refund ledger: never dispatched')
  expect(text).toContain('⚑ audit trail: state: pending')
  expect(text).toContain('⚑ a note a person wrote')
  expect(text).not.toContain('Loading')
  expect((await linesAt(ui, 190))[0]).toContain('Cancel payment API › FLOOR › 6 Report')
  await pressKey(ui, 'a')
  expect(seen.store.get('page')).toEqual(FLOOR_PAGE)
})

// F4_CUTS without the heads that are also the start of an allow-listed word (`accept` cut out of `accepted` leaves `ed`)
const PAGE_CUTS = F4_CUTS.filter(c => !ALLOW.some(w => w.length > c.length && w.startsWith(c)))
const PAGE_DATA = [NEEDS_PAYLOAD.path, ...PAGE_CUTS]
const PAGE_CASES = [
  ['phase', PHASE_BUILD], ['phase', PHASE_PLAN], ['story', STORY_S2], ['log', LOG_S2], ['storyreport', REPORT_S1],
] as const
for (const lang of [undefined, 'korean'] as const) {
  for (const [tag, page] of PAGE_CASES) {
    for (const cols of [190, 110]) {
      test(`${page.name}${page.phase === 1 ? ' (Plan)' : ''} in ${lang ?? 'English'} at ${cols} columns: only table words, nothing wider than the pane, no cut glyph`, async ($, on) => {
        const { lines, ui } = await homeLines($, on, cols, PAGES_FIXTURE(), 'terminal', lang, { page })
        sound(lines, cols)
        const text = visible(await ui.drawn())
        if (lang === undefined) expect(hangulIn(text, F4_DATA)).toEqual([])
        else {
          expect(latinOutside(text, PAGE_DATA)).toEqual([])
          expect(hangulIn(text, F4_DATA).length > 0).toBe(true)
        }
        if (page.phase !== 1) F2_SHOTS.push({ name: `demo-${tag}${lang === undefined ? 'en' : 'ko'}-${cols}`, lines })
      })
    }
  }
  for (const cols of [190, 110]) {
    test(`EPIC report in ${lang ?? 'English'} at ${cols} columns: the needs drawn through their keys, only table words, nothing wider than the pane`, async ($, on) => {
      const { lines, ui } = await homeLines($, on, cols, REPORT_FIXTURE(), 'terminal', lang, { page: EPIC_REPORT })
      sound(lines, cols)
      const text = visible(await ui.drawn())
      if (lang === undefined) expect(hangulIn(text, F4_DATA)).toEqual([])
      else {
        expect(latinOutside(text, PAGE_DATA)).toEqual([])
        expect(text).toContain('⚑ refund ledger: 시작된 적 없음')
        expect(text).toContain('⚑ audit trail: 상태: 대기')
        expect(text).not.toMatch(/never dispatched|state: /)
      }
      F2_SHOTS.push({ name: `demo-epicreport${lang === undefined ? 'en' : 'ko'}-${cols}`, lines })
    })
  }
}

// F4 gap 1-3: the decisions thread, now in Phase detail, draws the person as a key and the engine's own reasons through keys; the
// Korean render of a thread with a proposal, a verdict, an answer and both kinds of re-split holds nothing outside the allow-list
test('PHASE thread in Korean: verdict, answer (actor human), proposal "size S · develop", resplit and replan, nothing outside the allow-list', async ($, on) => {
  const { lines, ui } = await homeLines($, on, 190, PAGES_FIXTURE(), 'terminal', 'korean', { page: PHASE_PLAN })
  sound(lines, 190)
  const text = visible(await ui.drawn())
  const thread = lines.slice(at$(lines, '결정 (이 Phase)') + 1, -1) // up to the footer line
  expect(thread).toHaveLength(6) // five entries and the verdict's one gap line; the STORY's own verdict belongs to Build
  expect(thread[0]).toMatch(/09:58 +claude·opus +제안 +size +규모 S · develop$/)
  expect(thread[1]).toMatch(/10:05 +claude·sonnet +반려 70% +critique +AC 3 missing$/)
  expect(thread[2]).toContain('누락: AC 3 untested')
  expect(thread[3]).toMatch(/10:06 +사람 +답변 +critique +reject: overlap$/)
  expect(thread[4]).toMatch(/10:09 +— +재분할 +재분할 → 영역:3$/)
  expect(thread[5]).toMatch(/10:11 +— +재분할 +재계획 S2, S3$/)
  expect(text).not.toMatch(/\bhuman\b|\bsize S\b|resplit|replan|re-split/)
  expect(latinOutside(text, PAGE_DATA)).toEqual([])
})

test('PHASE thread in English keeps the engine words: the person as human, size S · develop, resplit, replan', async ($, on) => {
  const { lines } = await homeLines($, on, 190, PAGES_FIXTURE(), 'terminal', undefined, { page: PHASE_PLAN })
  const text = lines.join('\n')
  for (const part of ['human', 'size S · develop', 'resplit → areas:3', 'replan S2, S3']) expect(text).toContain(part)
})

for (const surface of SURFACES) {
  for (const page of [HOME_PAGE, FLOOR_PAGE, { name: 'PHASE', epic: 'tA', story: null, phase: 2 }, { name: 'STORY', epic: 'tA', story: 'S3', phase: null }, { name: 'LOG', epic: 'tA', story: 'S3', phase: null },
    { name: 'STORY_REPORT', epic: 'tA', story: 'S3', phase: null }, { name: 'EPIC_REPORT', epic: 'tA', story: null, phase: null }]) {
    test(`${surface}: ${page.name} mounts with Box, Text and Button only (Input behind the surface check), a breadcrumb or header on line 1`, async ($, on) => {
      await seeded($, on, P_FIXTURE(), surface, undefined, { epic: 'tA', page })
      const ui = await pane($, surface)
      const tree = JSON.stringify(await ui.drawn())
      for (const bad of ['"type":"Select"', '"type":"Client"', '"type":"Svg"', '"type":"Raster"', '"type":"Image"']) expect(tree).not.toContain(bad)
      expect((await ui.findAll({ type: 'Input' })).length).toBe(carriesInput(surface) ? 1 : 0)
      const text = visible(await ui.drawn())
      expect(text).toContain(page.name === 'HOME' ? 'teams' : 'Cancel payment API')
      // F4's language Button stays on every page
      expect(await labels(ui)).toContain(carriesInput(surface) ? 'l EN' : 'EN')
      // the footer: the F2 line on an Input surface, the six actions as Buttons on mobile
      if (carriesInput(surface)) expect(String((await ui.find({ key: 'keys' }))?.props.placeholder)).toMatch(/^w s /)
      else expect((await labels(ui)).filter(l => l !== 'EN')).toEqual([STRINGS.en.f2BtnUp, STRINGS.en.f2BtnDown, STRINGS.en.f2BtnOpen, STRINGS.en.f2BtnBack, STRINGS.en.f2BtnFlag, STRINGS.en.f2BtnClose])
    })
  }
}

test('mobile: the Buttons act on the selected row, no Input is mounted, HOME is spend and elapsed only, ⚑ with none draws the hint', async ($, on) => {
  const closed: string[] = []
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
  const { seen } = await seeded($, on, P_FIXTURE(), 'mobile', undefined, { epic: 'tA', pageSel: { 'HOME:::': 'e:tA' } })
  const ui = await pane($, 'mobile')
  const text = visible(await ui.drawn())
  expect(text).toContain('$6.12 · 22m')
  expect(text).not.toContain('drivers')
  expect(text.replace(/\n/g, '')).toMatch(/⚑ 2 +Cancel payment API › S2/) // the section is one row of segments, each its own Text
  expect(text).not.toMatch(/○Integ|█| ag\b/) // no Phase rail, no mini bar, no agents on mobile
  expect(await ui.find({ key: 'keys' })).toBeUndefined()
  await ui.press({ key: 'down' })
  await ui.redraw()
  expect(seen.store.get('pageSel')).toMatchObject({ 'HOME:::': 's:tA:S1' })
  await ui.press({ key: 'up' })
  await ui.redraw() // the harness redraws on request: a Button acts on the row of the last draw
  await ui.press({ key: 'open' }) // the EPIC row
  expect(seen.store.get('page')).toEqual(FLOOR_PAGE)
  await ui.redraw()
  await ui.press({ key: 'back' })
  expect(seen.store.get('page') ?? HOME_PAGE).toEqual(HOME_PAGE)
  await ui.redraw()
  await ui.press({ key: 'flag' })
  expect(seen.store.get('pageSel')).toMatchObject({ 'HOME:::': 'f:tA:ask:E-3f9a2c11/S2' })
  await ui.press({ key: 'close' })
  expect(closed).toEqual(['teams-status'])
})

test('mobile: ⚑ with no flag acts as n with none', async ($, on) => {
  const { seen } = await seeded($, on, P_FIXTURE({ tasks: P_TASKS({ workers: [], you: { count: 0, items: [], cards: [] } }) }), 'mobile', undefined, { epic: 'tA' })
  const ui = await pane($, 'mobile')
  await ui.press({ key: 'flag' })
  await ui.redraw()
  expect(seen.store.get('flagHint')).toBe(true)
  expect(visible(await ui.drawn())).toContain(STRINGS.en.f2HintNoFlag)
})

// ---- answer mode (F2-AC-25, 27..30, 32; 12, 13; 31, 33) ----
const ANSWER_PAGE = { name: 'ANSWER', epic: 'tA', story: 'S2', phase: null }
const ASK_QUESTION = 'How many retries on refund failure?'
const ASK_KEY = 'E-3f9a2c11/S2:ask1'
const askCardOf = (questions: { question: string; options: string[] }[]) =>
  ({ key: ASK_KEY, node_id: 'ask:S2', title: 'refund idempotency key', story_key: 'E-3f9a2c11/S2', ask_id: 'a1', since: ago(9), questions })
const FREE = [{ question: ASK_QUESTION, options: [] as string[] }]
// the answer CLI as the fixture: `--card` lists the ask, `--answer` records its argv and answers with `reply`
function answerData(questions = FREE, reply: (decisions: { question: string; chose: string }[]) => Run | object = () => ({ ok: true, key: ASK_KEY, node_id: 'ask:S2', state: 'done' })) {
  const sent: { key: string; task: string; decisions: { question: string; chose: string }[] }[] = []
  const data = PAGES_FIXTURE({
    answer: argv => {
      if (argv.includes('--card')) return ok(JSON.stringify({ ok: true, task_id: 'tA', cards: [askCardOf(questions)] }))
      const decisions = JSON.parse(argv[argv.indexOf('--decisions') + 1]!)
      sent.push({ key: argv[argv.indexOf('--key') + 1]!, task: argv[argv.indexOf('--task') + 1]!, decisions })
      const r = reply(decisions)
      return 'exitCode' in r ? (r as Run) : ok(JSON.stringify(r))
    },
  })
  return { data, sent }
}
const answerSeed = async ($: Engine, on: On, data: Data, surface: Surface = 'terminal', language?: string) => {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  const world = await seeded($, on, data, surface, language, { epic: 'tA', page: ANSWER_PAGE, pageFrom: HOME_PAGE }, true)
  return { ...world, toasts, ui: await atCols($, surface, 190) }
}
const typeAnswer = async (ui: Ui, text: string, kind: 'change' | 'submit' = 'submit') => {
  await ui.input({ key: 'answer', text, kind } as never)
  await ui.redraw()
}

test('ANSWER: breadcrumb, how long it waits, who asks, the question, a context line, the prompt and the answer-mode footer; one Input', async ($, on) => {
  const { ui } = await answerSeed($, on, answerData().data)
  const lines = await linesAt(ui, 190)
  sound(lines, 190)
  expect(lines[0]).toMatch(/^Cancel payment API › S2 refund idempotency key › Answer the question +⚑ 9m waiting$/)
  expect(lines.find(l => l.startsWith('S2 → you'))).toBeDefined()
  expect(lines).toContain(`"${ASK_QUESTION}"`)
  expect(lines.find(l => l.startsWith('Context'))).toMatch(/^Context +refund idempotency key$/)
  expect(lines.find(l => l.startsWith('Answer ›'))).toBeDefined()
  expect(lines.at(-1)).toMatch(/^Input mode: letters go in as typed · empty ⏎ cancel  l EN$/)
  expect((await ui.findAll({ type: 'Input' })).map(i => i.props.autoFocus === true)).toEqual([true])
  expect(await ui.find({ key: 'keys' })).toBeUndefined()
})

test('ANSWER: a long question wraps inside the pane at 110 columns', async ($, on) => {
  const long = 'Should the refund retry use the same idempotency key as the first attempt, or a fresh one per attempt, and how long should it keep retrying before it files a defect?'
  const data = answerData([{ question: long, options: [] }]).data
  await seeded($, on, data, 'terminal', undefined, { epic: 'tA', page: ANSWER_PAGE, pageFrom: HOME_PAGE }, true)
  const ui = await atCols($, 'terminal', 110)
  const lines = await linesAt(ui, 110)
  sound(lines, 110)
  expect(lines.join(' ').replace(/\s+/g, ' ')).toContain(long)
})

test('ANSWER: Enter sends the typed text once through answer.mjs under the plugin root, shows the toast, returns to the page it was opened from', async ($, on) => {
  const { data, sent } = answerData()
  const { seen, ui, toasts } = await answerSeed($, on, data)
  const calls = seen.argv.filter(a => String(a[1]).endsWith('/scripts/answer.mjs'))
  expect(calls).toHaveLength(1) // the card lookup, once for the page
  expect(calls[0]).toEqual(['node', expect.stringMatching(/\/scripts\/answer\.mjs$/), '--card', '--task', 'tA', '--story', 'S2'])
  await typeAnswer(ui, '  3 retries, then a manual queue ')
  expect(sent).toEqual([{ key: ASK_KEY, task: 'tA', decisions: [{ question: ASK_QUESTION, chose: '3 retries, then a manual queue' }] }])
  expect(toasts).toContain(STRINGS.en.f2AnswerAccepted)
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
  expect(seen.store.get('typed')).toBe('')
  // the pane was opened without closeOnEscape while answering and with it again after
  const flags = seen.openArgs.map(a => (a as { closeOnEscape?: boolean }).closeOnEscape === true)
  expect(flags.slice(-2)).toEqual([false, true])
})

test('ANSWER: a refusal shows the engine reason and keeps the page and the typed text; the next Enter can still send', async ($, on) => {
  let refuse = true
  const { data, sent } = answerData(FREE, () => (refuse ? { ok: false, reason: 'decisions: chose must not be empty' } : { ok: true, key: ASK_KEY }))
  const { seen, ui, toasts } = await answerSeed($, on, data)
  await typeAnswer(ui, 'later')
  expect(seen.store.get('page')).toEqual(ANSWER_PAGE)
  expect(seen.store.get('typed')).toBe('later')
  expect((await linesAt(ui, 190)).find(l => l.startsWith('Not accepted'))).toBe('Not accepted: decisions: chose must not be empty')
  expect(toasts).toEqual([])
  refuse = false
  await typeAnswer(ui, 'later')
  expect(sent).toHaveLength(2)
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
})

for (const [why, run] of [['exits non-zero', { exitCode: 1, stdout: '', stderr: 'node: cannot find answer.mjs' }], ['prints no JSON', ok('')]] as [string, Run][]) {
  test(`ANSWER: an answer tool that ${why} shows the failure line, keeps the draft, and the pane stays usable`, async ($, on) => {
    let broken = true
    const { data, sent } = answerData(FREE, () => (broken ? run : { ok: true, key: ASK_KEY }))
    const { seen, ui } = await answerSeed($, on, data)
    await typeAnswer(ui, 'three')
    const line = (await linesAt(ui, 190)).find(l => l.startsWith('Could not run the answer tool'))
    expect(line).toBeDefined()
    expect(seen.store.get('page')).toEqual(ANSWER_PAGE)
    expect(seen.store.get('typed')).toBe('three')
    await typeAnswer(ui, 'q', 'change') // still typing, still no key
    expect(seen.store.get('page')).toEqual(ANSWER_PAGE)
    broken = false
    await typeAnswer(ui, 'three')
    expect(sent).toHaveLength(2)
    expect(seen.store.get('page')).toEqual(HOME_PAGE)
  })
}

test('ANSWER: a card lookup that fails shows the failure line; empty Enter still leaves', async ($, on) => {
  const { data } = answerData()
  data.answer = () => ({ exitCode: 1, stdout: '', stderr: 'no tool' })
  const { seen, ui } = await answerSeed($, on, data)
  expect((await linesAt(ui, 190)).find(l => l.startsWith('Could not run the answer tool'))).toBe('Could not run the answer tool: no tool')
  await typeAnswer(ui, 'x') // nothing to send to: nothing happens
  expect(seen.store.get('page')).toEqual(ANSWER_PAGE)
  await typeAnswer(ui, '')
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
})

test('ANSWER: several questions are asked one at a time and sent once after the last, one decisions entry each', async ($, on) => {
  const qs = [{ question: 'How many retries?', options: [] }, { question: 'Which queue?', options: [] }, { question: 'Page the owner?', options: [] }]
  const { data, sent } = answerData(qs)
  const { seen, ui } = await answerSeed($, on, data)
  expect(seen.store.get('page')).toEqual(ANSWER_PAGE)
  expect(visible(await ui.drawn())).toContain('"How many retries?"')
  expect(visible(await ui.drawn())).toContain('1/3')
  await typeAnswer(ui, '3')
  expect(sent).toEqual([])
  expect(visible(await ui.drawn())).toContain('"Which queue?"')
  expect(visible(await ui.drawn())).toContain('2/3')
  expect(seen.store.get('typed')).toBe('')
  await typeAnswer(ui, 'manual')
  expect(sent).toEqual([])
  await typeAnswer(ui, 'no')
  expect(sent).toEqual([{ key: ASK_KEY, task: 'tA', decisions: [{ question: 'How many retries?', chose: '3' }, { question: 'Which queue?', chose: 'manual' }, { question: 'Page the owner?', chose: 'no' }] }])
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
})

test('ANSWER: q w a s d n l are text, the language key is inert, `/` holds, and the language Button still works', async ($, on) => {
  const closed: string[] = []
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
  const { seen, ui } = await answerSeed($, on, answerData().data)
  for (const text of ['q', 'w', 'a', 's', 'd', 'n', 'l', 'qwasdnl', '/teams-status']) {
    await typeAnswer(ui, text, 'change')
    expect(seen.store.get('page')).toEqual(ANSWER_PAGE)
    expect(seen.store.get('typed')).toBe(text)
  }
  expect(seen.store.get('lang') ?? 'en').toBe('en')
  expect(seen.store.get('pageSel') ?? {}).toEqual({})
  expect(closed).toEqual([])
  await ui.press({ key: 'lang' })
  expect(seen.store.get('lang')).toBe('ko')
})

test('ANSWER: empty or blank Enter cancels the draft and returns; the pane stays open and closeOnEscape is back', async ($, on) => {
  const closed: string[] = []
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } })
  const { seen, ui } = await answerSeed($, on, answerData().data)
  await typeAnswer(ui, '   ')
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
  expect(closed).toEqual([])
  expect((seen.openArgs.at(-1) as { closeOnEscape?: boolean }).closeOnEscape).toBe(true)
  expect(visible(await ui.drawn())).not.toContain('Input mode')
})

test('ANSWER: a pane that the host closed on ANSWER opens again on the page it came from, the draft lost, closeOnEscape back', async ($, on) => {
  mock.clock(on, { now: 1000 })
  startWorld(on)
  const seen = uiWorld(on, { watch: ['abc'], epic: 'tA', page: ANSWER_PAGE, pageFrom: HOME_PAGE }, ['terminal'], answerData().data)
  on('ui.panes', () => ({ value: [] }) as never)
  await start($)
  expect(seen.store.get('page')).toEqual(ANSWER_PAGE) // no pane is open: ui.panes() holds none
  await $.command.run({ command: 'teams-status' } as never)
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
  expect((seen.openArgs.at(-1) as { closeOnEscape?: boolean }).closeOnEscape).toBe(true)
})

for (const surface of SURFACES) {
  test(`${surface}: ANSWER mounts with Box, Text and Button only (Input behind the surface check); no Select, Client, Svg, Raster or Image`, async ($, on) => {
    const { ui } = await answerSeed($, on, answerData().data, surface)
    const tree = JSON.stringify(await ui.drawn())
    for (const bad of ['"type":"Select"', '"type":"Client"', '"type":"Svg"', '"type":"Raster"', '"type":"Image"']) expect(tree).not.toContain(bad)
    expect((await ui.findAll({ type: 'Input' })).length).toBe(carriesInput(surface) ? 1 : 0)
    const text = visible(await ui.drawn())
    expect(text).toContain('Cancel payment API')
    expect(text).toContain(ASK_QUESTION)
    expect(await labels(ui)).toContain(carriesInput(surface) ? 'l EN' : 'EN')
    if (!carriesInput(surface)) {
      expect((await labels(ui)).filter(l => l !== 'EN')).toEqual([STRINGS.en.f2BtnUp, STRINGS.en.f2BtnDown, STRINGS.en.f2BtnOpen, STRINGS.en.f2BtnBack, STRINGS.en.f2BtnFlag, STRINGS.en.f2BtnClose])
      expect(text).toContain(STRINGS.en.f2AnswerDesktopOnly)
    }
  })
}

test('mobile ANSWER: an ask with options shows one Button per option and a tap submits it through answer.mjs; no Input', async ($, on) => {
  const opts = ['2 retries', '3 retries', '5 retries']
  const { data, sent } = answerData([{ question: ASK_QUESTION, options: opts }])
  const { seen, ui } = await answerSeed($, on, data, 'mobile')
  expect(await ui.find({ key: 'answer' })).toBeUndefined()
  expect(await labels(ui)).toEqual([...opts, STRINGS.en.f2BtnUp, STRINGS.en.f2BtnDown, STRINGS.en.f2BtnOpen, STRINGS.en.f2BtnBack, STRINGS.en.f2BtnFlag, STRINGS.en.f2BtnClose, 'EN'])
  expect(visible(await ui.drawn())).not.toContain(STRINGS.en.f2AnswerDesktopOnly)
  await ui.press({ key: 'o1' })
  expect(sent).toEqual([{ key: ASK_KEY, task: 'tA', decisions: [{ question: ASK_QUESTION, chose: '3 retries' }] }])
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
})

test('mobile ANSWER: the back Button returns to the page it was opened from and drops the draft', async ($, on) => {
  const { seen, ui } = await answerSeed($, on, answerData().data, 'mobile')
  await ui.press({ key: 'back' })
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
  expect((seen.openArgs.at(-1) as { closeOnEscape?: boolean }).closeOnEscape).toBe(true)
})

for (const cols of [190, 110]) {
  for (const language of [undefined, 'korean'] as const) {
    test(`ANSWER in ${language ?? 'English'} at ${cols} columns: only table words, nothing wider than the pane`, async ($, on) => {
      await seeded($, on, answerData([{ question: ASK_QUESTION, options: [] }]).data, 'terminal', language, { epic: 'tA', page: ANSWER_PAGE, pageFrom: HOME_PAGE }, true)
      const ui = await atCols($, 'terminal', cols)
      const lines = await linesAt(ui, cols)
      sound(lines, cols)
      const text = visible(await ui.drawn())
      if (language === undefined) expect(hangulIn(text, F4_DATA)).toEqual([])
      else {
        expect(latinOutside(text, PAGE_DATA)).toEqual([])
        expect(text).toContain(STRINGS.ko.f2AnswerTitle)
        expect(text).toContain(STRINGS.ko.f2AnswerContext)
        expect(lines.at(-1)).toContain(STRINGS.ko.f2FootAnswer.slice(0, 12))
        expect(lines.at(-1)).toMatch(/l KR$/)
      }
      F2_SHOTS.push({ name: `demo-answer${language === undefined ? 'en' : 'ko'}-${cols}`, lines })
    })
  }
}

// AC-23: a toast already shown is not redrawn when the language changes; the next one is in the new language
test('F4 lang: a toast shown before the toggle stays; the next toast is in the new language', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const fail = (o: object) => FAIL({ reason: 'gap', next_key: 'nextNeedsYou', next_vars: {}, next_step: 'needs you', severity: 'failure', ...o })
  const data: Data = { ...F4_FIXTURE, events: [fail({ ts: 1600, node: 'accept:P1:3' })] }
  const { tick } = await seeded($, on, data, 'terminal', undefined, { epic: 'tA' })
  const en = `⚠ E-aaaaaaaa accept:P1:3 ${STRINGS.en.nodeFailed}: gap → ${STRINGS.en.nextNeedsYou}`
  expect(toasts).toEqual([en])
  const ui = await pane($, 'terminal')
  await typeKey(ui, 'l')
  await tick()
  expect(toasts).toEqual([en])
  data.events = [...data.events!, fail({ ts: 4500, node: 'plan:1' })]
  await tick()
  expect(toasts).toEqual([en, `⚠ E-aaaaaaaa plan:1 ${STRINGS.ko.nodeFailed}: gap → ${STRINGS.ko.nextNeedsYou}`])
})

// AC-25: the toggle writes lang and langChosen and nothing else in $.state
test('F4 lang: the toggle touches only lang and langChosen in $.state', async ($, on) => {
  const { seen } = await seeded($, on, F4_FIXTURE, 'terminal', undefined, { epic: 'tA' })
  const ui = await pane($, 'terminal')
  const before = new Map(seen.store)
  await ui.press({ key: 'lang' })
  const changed = [...new Set([...before.keys(), ...seen.store.keys()])].filter(k => JSON.stringify(before.get(k)) !== JSON.stringify(seen.store.get(k))).sort()
  expect(changed).toEqual(['lang', 'langChosen'])
  expect(seen.store.get('lang')).toBe('ko')
})

// ---- the band sentence and the language frames (restored from F4 dash now / page band / page empty) ----
// the band says what the task is on now, for every now.kind the engine emits: English draws the kind's word, Korean has no Latin outside the data
for (const kind of NOW_KINDS) {
  for (const language of [undefined, 'korean']) {
    test(`F4 band now: ${kind} ${language ?? 'english'}`, async ($, on) => {
      await seeded($, on, { status: stat(), task: demo({ now: { kind, subject: 'module b', detail: '' } }) }, 'terminal', language)
      const text = visible(await (await band($, 'terminal')).drawn())
      const word = (STRINGS[language === undefined ? 'en' : 'ko'] as Record<string, string>)[`now${kind[0]!.toUpperCase()}${kind.slice(1)}`]
      expect([kind, word !== undefined, text.includes(`${word}: module b`)]).toEqual([kind, true, true])
      if (language === undefined) expect([kind, hangulIn(text, LANG_DATA)]).toEqual([kind, []])
      else expect([kind, latinOutside(text, [...LANG_DATA, 'engine band']), hangulIn(text, LANG_DATA).length > 0]).toEqual([kind, [], true])
    })
  }
}

// the band in English and Korean (by `l` on the pane, and by the setting), on every surface at 190 and 110, no stray language
for (const surface of SURFACES) {
  test(`F4 band: ${surface} in English, Korean by l and Korean by the setting, at 190 and 110 columns`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    let setting: Record<string, unknown> = {}
    langStart(on, () => setting)
    uiWorld(on, { watch: ['abc'], epic: 'tA' }, [surface], F4_FIXTURE)
    on('ui.panes', () => ({ value: [{ id: 'teams-status', title: 'Teams', isPlaced: true }] }) as never)
    on('ui.close', () => ({ value: undefined }))
    engineBand(on)
    await start($)
    await clock.advance(3000)
    const holder = await pane($, surface)
    const bandAt = (cols: number) => $.ui.mount({ plugin: 'teams', surface, component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: cols } } as never)
    const read = async (lang: 'en' | 'ko') => {
      const out: Record<number, string> = {}
      for (const cols of [190, 110]) {
        const ui = await bandAt(cols)
        const drawn = (await ui.drawn()) as never
        const text = visible(drawn)
        out[cols] = text
        if (lang === 'en') expect([cols, hangulIn(text, F4_DATA)]).toEqual([cols, []])
        else {
          expect([cols, latinOutside(text, [...F4_DATA, 'engine band'])]).toEqual([cols, []])
          expect(hangulIn(text, F4_DATA).length > 0).toBe(true)
        }
        // one question waits (F4_FIXTURE): the inbox Button takes the board Button's place, in the language drawn
        expect(await labels(ui)).toContain((lang === 'en' ? STRINGS.en.inboxOne : STRINGS.ko.inboxOne).replace('{n}', '1'))
        sound(draw(drawn, cols), cols + 4)
        await ui.unmount()
      }
      expect(await labels(holder)).toContain(carriesInput(surface) ? (lang === 'en' ? 'l EN' : 'l KR') : lang === 'en' ? 'EN' : 'KR')
      return out
    }
    const en = await read('en')
    if (carriesInput(surface)) await typeKey(holder, 'l')
    else await holder.press({ key: 'lang' })
    await holder.redraw()
    const ko = await read('ko')
    const nums = (t: string) => (t.match(/\d+/g) ?? []).sort().join(',')
    for (const cols of [190, 110]) expect([cols, nums(ko[cols]!)]).toEqual([cols, nums(en[cols]!)])
  })
}

// the no-run pane, English and Korean, on every surface: only the table's words, the language marker, the close key
for (const surface of SURFACES) {
  for (const language of [undefined, 'korean']) {
    test(`F4 empty: ${surface} no-run pane in ${language ?? 'English'} has no stray language`, async ($, on) => {
      langStart(on, () => (language === undefined ? {} : { language }))
      uiWorld(on, {}, [surface], { status: { line: '', waiting: 0 } })
      on('ui.panes', () => ({ value: [{ id: 'teams-status', title: 'Teams', isPlaced: true }] }) as never)
      on('ui.close', () => ({ value: undefined }))
      engineBand(on)
      await start($)
      const ui = await pane($, surface)
      const text = visible(await ui.drawn())
      expect(text).toContain(language === undefined ? STRINGS.en.noRun : STRINGS.ko.noRun)
      if (language === undefined) expect(hangulIn(text)).toEqual([])
      else {
        expect(latinOutside(text)).toEqual([])
        expect(hangulIn(text).length > 0).toBe(true)
      }
      expect(await labels(ui)).toContain(carriesInput(surface) ? (language === undefined ? 'l EN' : 'l KR') : language === undefined ? 'EN' : 'KR')
      if (!carriesInput(surface)) expect((await ui.find({ key: 'close' }))?.props).toMatchObject({ role: 'dismiss' })
    })
  }
}

// ---- workerCells and handoffCells: the helpers the PHASE page draws (s5); their cases from the tab-era Floor tests ----
const rowsOf = (rows: readonly { cells: string[]; tints: unknown[] }[], gap = 2) => {
  const widths = columnWidths(rows.map(r => r.cells), 200, gap, [], 4)
  return rows.map(r => plain(rowLine(r.cells, widths, gap, r.tints as never)))
}
const WCELLS = [wk('PLAN', 'done'), wk('P1', 'acting', 'editing a.ts'), wk('P2', 'idle'), wk('P3', 'you', 'asks a question'), wk('JUDGE', 'stalled')] as never
const wordOf = (key: string) => (STRINGS.en as Record<string, string>)[`word${key[0]!.toUpperCase()}${key.slice(1)}`] ?? key

test('workerCells: one line per worker, the id starting at one offset', () => {
  const cells = workerCells(WCELLS, 0, wordOf)
  expect(cells).toHaveLength(5)
  const lines = rowsOf(cells)
  for (const [i, id] of ['PLAN', 'P1', 'P2', 'P3', 'JUDGE'].entries()) expect(lines[i]).toContain(id)
  expect(lines[1]).toContain('editing a.ts')
  expect(new Set(lines.map(l => l.indexOf(/PLAN|P\d|JUDGE/.exec(l)![0]))).size).toBe(1)
})

test('workerCells: a distinct icon per state, no faces', () => {
  const cells = workerCells(WCELLS, 0, wordOf)
  const icons = cells.map(c => c.cells[0])
  expect(icons).toEqual(['✔', '●', '◌', '⚑', '⏸'])
  expect(new Set(icons).size).toBe(5)
  expect(JSON.stringify(cells)).not.toMatch(/😀|\(\^|☺|\^_\^|•_•/)
})

test('workerCells: an idle worker says idle, dim, in the column of the other doing texts; a done one says done', () => {
  const workers = [wk('PLAN', 'done'), wk('P1', 'acting', 'editing a.ts'), wk('P2', 'idle'), wk('P3', 'you', 'asks a question'), wk('JUDGE', 'idle')] as never
  const cells = workerCells(workers, 0, wordOf)
  const [plan, p1, p2, p3, judge] = rowsOf(cells) as [string, string, string, string, string]
  for (const idle of [p2, judge]) {
    expect(idle.trimEnd().endsWith('idle')).toBe(true)
    expect(idle.indexOf('idle')).toBe(p1.indexOf('editing a.ts'))
    expect(idle.indexOf('idle')).toBe(p3.indexOf('asks a question'))
  }
  expect(plan.trimEnd().endsWith('done')).toBe(true)
  for (const i of [2, 4]) expect(cells[i]!.tints[3]).toBe('dim')
})

test('workerCells: the idle word in Korean; the spinner only on an acting worker', () => {
  const ko = (key: string) => (STRINGS.ko as Record<string, string>)[`word${key[0]!.toUpperCase()}${key.slice(1)}`] ?? key
  expect(rowsOf(workerCells([wk('P2', 'idle')] as never, 0, ko))[0]!.trimEnd().endsWith('유휴')).toBe(true)
  const cells = workerCells(WCELLS, 3, wordOf)
  expect(cells.map(c => c.cells[1] !== '')).toEqual([false, true, false, false, false])
  expect(cells[1]!.cells[1]).toBe(SPINNER[3])
})

const HAND = [
  { time: '10:01', from: 'PLAN', what: 'the plan', to: 'P1' }, { time: '10:02', from: 'P1', what: 'a diff', to: 'JUDGE' }, { time: '10:03', from: 'JUDGE', what: 'a verdict', to: 'P1' },
  { time: '10:04', from: 'P2', what: 'tests', to: 'JUDGE' }, { time: '10:05', from: 'PLAN', what: 'a rewrite', to: 'P3' }, { time: '10:06', from: 'P3', what: 'an answer', to: 'PLAN' },
  { time: '10:07', from: 'P1', what: 'more', to: 'JUDGE' },
] as never

test('handoffCells: at most 5 aligned rows', () => {
  const rows = handoffCells(HAND)
  expect(rows).toHaveLength(5)
  const widths = columnWidths(rows, 200, 2, [], 4)
  const lines = rows.map(r => plain(rowLine(r, widths, 2)))
  expect(lines[0]).toMatch(/^10:01 +PLAN +the plan +→ P1/)
  expect(new Set(lines.map(r => r.indexOf('→'))).size).toBe(1)
  expect(new Set(lines.map(r => r.indexOf(/PLAN|P\d|JUDGE/.exec(r)![0]))).size).toBe(1)
})

test('handoffCells: empty when none recorded; an engine word comes by its key, the raw text when it has none', () => {
  expect(handoffCells([])).toEqual([])
  const keyed = [{ time: '10:03', from: 'judge', what: 'verdict reject', what_key: 'handVerdict', what_vars: { v: 'reject' }, to: 'P1' }] as never
  expect(handoffCells(keyed)[0]).toEqual(['10:03', 'judge', 'verdict reject', '→ P1'])
  expect(handoffCells(keyed, (key, vars) => `${key}:${JSON.stringify(vars)}`)[0]![2]).toBe('handVerdict:{"v":"reject"}')
})

// ---- EPIC report states (restored from the Report tab tests of 65d4eaa8, now on the EPIC_REPORT page) ----
const REPORT_PATH = NEEDS_PAYLOAD.path
const reportOf = (over: Record<string, unknown>) => payload({ task_id: 'tA', path: REPORT_PATH, ...over })
const BIG = { text: 'line\n'.repeat(3900), truncated: true, more_lines: 1234, mtime: 5 }
for (const surface of SURFACES) {
  for (const language of [undefined, 'korean'] as const) {
    const ko = language === 'korean'
    test(`EPIC report ${surface} in ${ko ? 'Korean' : 'English'}: report null draws the missing line with the path`, async ($, on) => {
      await seeded($, on, PAGES_FIXTURE({ reports: { tA: reportOf({ report: null }) } }), surface, language, { epic: 'tA', page: EPIC_REPORT }, true)
      const text = visible(await (await atCols($, surface, 190)).drawn())
      expect(text).toContain(`${ko ? '아직 보고서가 없습니다' : 'No report yet'}: ${REPORT_PATH}`)
      if (ko) expect(text).not.toContain('No report yet')
    })

    test(`EPIC report ${surface} in ${ko ? 'Korean' : 'English'}: a report over 20k draws the path, then the truncated notice, then the text`, async ($, on) => {
      await seeded($, on, PAGES_FIXTURE({ reports: { tA: reportOf({ report: BIG }) } }), surface, language, { epic: 'tA', page: EPIC_REPORT }, true)
      const text = await shown(await atCols($, surface, 190))
      const path = text.indexOf('80-report.md')
      const notice = text.indexOf(ko ? '파일에 1234줄 더 있습니다' : 'Shortened: 1234 more lines in the file.')
      const body = text.indexOf('line\\nline')
      expect(path > 0 && notice > path && body > notice).toBe(true)
      if (ko) expect(text).not.toContain('Shortened')
    })
  }

  test(`EPIC report ${surface}: page open on U, T ends: T's card shows and stays; the page keeps drawing U`, async ($, on) => {
    const reports = { tA: reportOf({ report: { text: 'U report', truncated: false, more_lines: 0, mtime: 1 } }), tee: T_PAYLOAD() }
    const { seen, tick } = await seeded($, on, PAGES_FIXTURE({ events: [END('tee')], reports }), surface, undefined, { epic: 'tA', page: EPIC_REPORT })
    await tick()
    await tick()
    const b = await band($, surface)
    expect(await shown(b)).toContain('finished')
    expect(await labels(b)).toEqual(['report', '×'])
    expect(seen.store.get('ended')).toEqual({ tee: 'card' })
    const ui = await atCols($, surface, 190)
    expect(await shown(ui)).toContain('E-tA/80-report.md')
    expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('U report')
    expect(await shown(ui)).not.toContain('E-tee')
  })
}

// ---- F4 page language invariants (restored from the f4Page loop): every page on every surface ----
const LANG_PAGES = [HOME_PAGE, FLOOR_PAGE, PHASE_BUILD, STORY_S2, LOG_S2, { name: 'STORY_REPORT', epic: 'tA', story: 'S1', phase: null }, EPIC_REPORT] as const
const digitsOf = (text: string) => (text.match(/\d+/g) ?? []).sort().join(',')
for (const surface of SURFACES) {
  for (const page of LANG_PAGES) {
    test(`${page.name} on ${surface}: l goes Korean and back to the first English render; Korean by l equals Korean by the setting; same numbers; only table words`, async ($, on) => {
      const clock = mock.clock(on, { now: 1000 })
      const setting = { value: undefined as string | undefined }
      langStart(on, () => (setting.value === undefined ? {} : { language: setting.value }))
      const seen = uiWorld(on, { watch: ['abc'], epic: 'tA', page }, [surface], REPORT_FIXTURE())
      on('ui.panes', () => ({ value: [{ id: 'teams-status', title: 'Teams', isPlaced: true }] }) as never)
      on('ui.close', () => ({ value: undefined }))
      on('ui.render', (_$, e) => (e.component === 'AbovePrompt' ? { type: 'Box', children: [] } : undefined) as never)
      await start($)
      await clock.advance(3000)
      const ui = await atCols($, surface, 190)
      const read = async () => ({ text: visible(await ui.drawn()), buttons: await labels(ui) })
      const flip = async () => {
        if (carriesInput(surface)) await pressKey(ui, 'l')
        else {
          await ui.press({ key: 'lang' })
          await ui.redraw()
        }
      }
      const en = await read()
      expect(hangulIn(en.text, F4_DATA)).toEqual([])
      await flip()
      const koByKey = await read()
      expect(latinOutside(koByKey.text, PAGE_DATA)).toEqual([])
      expect(hangulIn(koByKey.text, F4_DATA).length > 0).toBe(true)
      expect(latinOutside(koByKey.buttons.join(' '), PAGE_DATA)).toEqual([])
      if (!carriesInput(surface)) expect(hangulIn(koByKey.buttons.join(' ')).length > 0).toBe(true) // the mobile Buttons are Korean too
      expect(digitsOf(koByKey.text)).toBe(digitsOf(en.text))
      await flip()
      expect((await read()).text).toBe(en.text) // back to English by l: the first render exactly
      await flip()
      seen.store.set('langChosen', false)
      setting.value = 'korean'
      await start($)
      await ui.redraw()
      expect((await read()).text).toBe(koByKey.text) // Korean by the setting equals Korean by l
    })
  }
}

// ---- card 125 page wiring: footer submit label, size-S pages, breadcrumb tail, closing reply, draft dropped, report verdict ----
const SIZE_S_ID = 'E-5e5e5e5e'
const sizeS = (stageKey: 'plan' | 'build') => epicOf('tS', SIZE_S_ID, [story(SIZE_S_ID, 'small thing', { owner_key: SIZE_S_ID, doing: 'planning' })], {
  title: 'Quick fix', size: 'S', harness: { slug: 'run-7', moving: true },
  stages: [stage('plan', stageKey === 'plan' ? 'running' : 'done'), stage('build', stageKey === 'build' ? 'running' : 'pending'), ...P_STAGES.slice(2).map(g => stage(g.key, 'pending'))],
  phases: [{ key: 'plan', ...NO_PHASE, workers: 1, acting: stageKey === 'plan' ? 1 : 0 }, { key: 'build', ...NO_PHASE, workers: stageKey === 'build' ? 1 : 0, acting: stageKey === 'build' ? 1 : 0 }, ...P_PHASES.slice(2)],
  workers: [{ ...wk('S', 'acting', 'planning'), phase: stageKey }],
})
const sizeSData = (stageKey: 'plan' | 'build' = 'plan') => PAGES_FIXTURE({ tasks: [sizeS(stageKey)] })
const SIZE_S_FLOOR = { name: 'FLOOR', epic: 'tS', story: null, phase: null }
const SIZE_S_PLAN = { name: 'PHASE', epic: 'tS', story: null, phase: 1 }

for (const [lang, t] of [[undefined, STRINGS.en], ['korean', STRINGS.ko]] as const) {
  for (const page of [HOME_PAGE, FLOOR_PAGE, STORY_S2, PHASE_BUILD, LOG_S2, REPORT_S1]) {
    test(`footer: the keys Input draws no submit label on ${page.name}${lang === undefined ? '' : ' (Korean)'}`, async ($, on) => {
      const { ui } = await homeLines($, on, 190, PAGES_FIXTURE(), 'terminal', lang, { page })
      expect((await ui.find({ key: 'keys' }))?.props.submitLabel).toBe('')
    })
  }

  test(`footer: the answer Input's submit label is the table word${lang === undefined ? '' : ' (Korean)'}`, async ($, on) => {
    const { ui } = await answerSeed($, on, answerData().data, 'terminal', lang)
    expect((await ui.find({ key: 'answer' }))?.props.submitLabel).toBe(t.f2AnswerSubmit)
    expect(t.f2AnswerSubmit).toBe(lang === undefined ? 'send' : '보내기')
  })

  test(`STORY report: the Judge row ends with the tests verdict${lang === undefined ? '' : ' (Korean)'}`, async ($, on) => {
    const { lines } = await homeLines($, on, 190, PAGES_FIXTURE(), 'terminal', lang, { page: REPORT_S1 })
    const judge = lines.find(l => l.includes('judge 91'))
    expect(judge).toBeDefined()
    expect(judge!.endsWith(lang === undefined ? 'tests pass' : '테스트 통과')).toBe(true)
  })

  test(`/teams-status on an open pane answers closed and never opened; on a closed pane it answers opened${lang === undefined ? '' : ' (Korean)'}`, async ($, on) => {
    mock.clock(on, { now: 1000 })
    langStart(on, () => (lang === undefined ? {} : { language: lang }))
    uiWorld(on, {}, ['terminal'], { status: stat(), task: demo() })
    let panes = [{ id: 'teams-status', title: 'Teams', isPlaced: true }]
    on('ui.panes', () => ({ value: panes }) as never)
    on('ui.close', () => { panes = []; return { value: undefined } })
    await start($)
    const closing = JSON.stringify(await runStatus($))
    expect(closing).toContain(t.paneClosed)
    expect(closing).not.toContain(STRINGS.en.paneOpened)
    expect(closing).not.toContain(STRINGS.ko.paneOpened)
    const opening = JSON.stringify(await runStatus($))
    expect(opening).toContain(t.paneOpened)
  })
}

test('size S in Plan: FLOOR counts 1 working on Plan and none on Build', async ($, on) => {
  const { lines } = await homeLines($, on, 190, sizeSData('plan'), 'terminal', undefined, { epic: 'tS', page: SIZE_S_FLOOR })
  const plan = lines.find(l => /1 Plan/.test(l))!
  const build = lines.find(l => /2 Build/.test(l))!
  expect(plan).toContain('1 working')
  expect(build).not.toContain('working')
})

test('size S in Plan: Phase 1 Running lists the S driver, not a dash', async ($, on) => {
  const { lines } = await homeLines($, on, 190, sizeSData('plan'), 'terminal', undefined, { epic: 'tS', page: SIZE_S_PLAN })
  const running = at$(lines, 'Running')
  const handed = at$(lines, 'Handed over')
  const mine = lines.slice(running + 1, handed).join('\n')
  expect(mine).toMatch(/● +\S* *S\b/)
  expect(mine.trim()).not.toBe('–')
})

test('HOME names a size-S EPIC key once', async ($, on) => {
  const { lines } = await homeLines($, on, 190, sizeSData('plan'), 'terminal', undefined, { epic: 'tS', page: HOME_PAGE })
  expect(lines.filter(l => l.includes(SIZE_S_ID))).toHaveLength(1)
})

for (const lang of [undefined, 'korean'] as const) {
  test(`Phase detail at 110 columns with a long EPIC title keeps its tail and shortens the head${lang === undefined ? '' : ' (Korean)'}`, async ($, on) => {
    const long = 'Cancel payment API with a very long title that cannot fit the line beside the crumbs of this page at all'
    const { lines } = await homeLines($, on, 110, PAGES_FIXTURE({ tasks: P_TASKS({ title: long }) }), 'terminal', lang, { page: PHASE_PLAN })
    expect(lines[0]).toMatch(/^Cancel payment API.*… › FLOOR › 1 Plan( {2}.*)?$/)
  })
}

for (const lang of [undefined, 'korean'] as const) {
  for (const cols of [190, 110]) {
    const tag = lang === undefined ? 'en' : 'ko'
    const shots: [string, Data, Record<string, unknown>][] = [
      ['homesizes', sizeSData('plan'), { epic: 'tS', page: HOME_PAGE }],
      ['floorsizes', sizeSData('plan'), { epic: 'tS', page: SIZE_S_FLOOR }],
      ['phasesizes', sizeSData('plan'), { epic: 'tS', page: SIZE_S_PLAN }],
      ['phaselong', PAGES_FIXTURE({ tasks: P_TASKS({ title: 'Cancel payment API with a very long title that cannot fit the line beside the crumbs of this page at all' }) }), { page: PHASE_PLAN }],
      ['draftdropped', PAGES_FIXTURE(), { page: HOME_PAGE, draftHint: true }],
    ]
    for (const [name, data, init] of shots) {
      test(`demo shot ${name} in ${lang ?? 'English'} at ${cols} columns`, async ($, on) => {
        const { lines } = await homeLines($, on, cols, data, 'terminal', lang, init)
        sound(lines, cols)
        F2_SHOTS.push({ name: `demo-${name}${tag}-${cols}`, lines })
      })
    }
  }
}

// The testing engine cannot raise a person's `ui.close`, so the drops are reached through the other two paths into leaveAnswer: an empty
// Enter after answered questions, and the pane opened again after the host closed it on ANSWER with text still typed.
async function hostClosedAnswer($: Engine, on: On, language?: string) {
  const clock = mock.clock(on, { now: 1000 })
  startWorld(on, language)
  const seen = uiWorld(on, { watch: ['abc'], epic: 'tA', page: ANSWER_PAGE, pageFrom: HOME_PAGE }, ['terminal'], answerData().data)
  let panes = [{ id: 'teams-status', title: 'Teams', isPlaced: true }]
  on('ui.panes', () => ({ value: panes }) as never)
  on('ui.render', (_$, e) => (e.component === 'AbovePrompt' ? { type: 'Box', children: [] } : undefined) as never)
  await start($)
  await clock.advance(3000)
  const ui = await atCols($, 'terminal', 190)
  return { seen, ui, hostClose: () => { panes = [] }, reopen: () => $.command.run({ command: 'teams-status' } as never) }
}
for (const [lang, t] of [[undefined, STRINGS.en], ['korean', STRINGS.ko]] as const) {
  test(`ANSWER closed by the host with text typed: reopening says the draft was dropped and shows an empty field${lang === undefined ? '' : ' (Korean)'}`, async ($, on) => {
    const { seen, ui, hostClose, reopen } = await hostClosedAnswer($, on, lang)
    await typeAnswer(ui, 'half an answer', 'change')
    expect(seen.store.get('typed')).toBe('half an answer')
    hostClose()
    await reopen()
    expect(seen.store.get('page')).toEqual(HOME_PAGE)
    expect(seen.store.get('typed')).toBe('')
    expect(seen.store.get('draftHint')).toBe(true)
    await ui.redraw()
    expect(visible(await ui.drawn())).toContain(t.f2HintDraftDropped)
    // the same ⚑ opens answer mode again: nothing of the draft is left
    seen.store.set('page', ANSWER_PAGE)
    seen.store.set('pageFrom', HOME_PAGE)
    await ui.redraw()
    expect((await ui.find({ key: 'answer' }))?.props.value).toBe('')
  })

  test(`ANSWER empty Enter after an answered question says the draft was dropped${lang === undefined ? '' : ' (Korean)'}`, async ($, on) => {
    const qs = [{ question: 'How many retries?', options: [] }, { question: 'Which queue?', options: [] }]
    const { seen, ui } = await answerSeed($, on, answerData(qs).data, 'terminal', lang)
    await typeAnswer(ui, '3')
    await typeAnswer(ui, '   ')
    expect(seen.store.get('page')).toEqual(HOME_PAGE)
    expect(seen.store.get('draftHint')).toBe(true)
    expect(visible(await ui.drawn())).toContain(t.f2HintDraftDropped)
  })
}

test('ANSWER empty Enter with nothing typed and nothing answered says nothing about a draft', async ($, on) => {
  const { seen, ui } = await answerSeed($, on, answerData().data)
  await typeAnswer(ui, '   ')
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
  expect(visible(await ui.drawn())).not.toContain(STRINGS.en.f2HintDraftDropped)
  expect(seen.store.get('draftHint') ?? false).toBe(false)
})

test('ANSWER accepted submit leaves no draft-dropped hint', async ($, on) => {
  const { seen, ui } = await answerSeed($, on, answerData().data)
  await typeAnswer(ui, '3 retries')
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
  expect(seen.store.get('draftHint') ?? false).toBe(false)
  expect(visible(await ui.drawn())).not.toContain(STRINGS.en.f2HintDraftDropped)
})

test('ANSWER: the pane reopened after a host close with no draft and nothing typed shows no draft-dropped hint', async ($, on) => {
  mock.clock(on, { now: 1000 })
  startWorld(on)
  const seen = uiWorld(on, { watch: ['abc'], epic: 'tA', page: ANSWER_PAGE, pageFrom: HOME_PAGE }, ['terminal'], answerData().data)
  on('ui.panes', () => ({ value: [] }) as never)
  await start($) // no draft exists: it is null while the page is still ANSWER
  await $.command.run({ command: 'teams-status' } as never)
  expect(seen.store.get('page')).toEqual(HOME_PAGE)
  expect(seen.store.get('draftHint') ?? false).toBe(false)
})

test('ANSWER: the draft-dropped hint clears on the next key', async ($, on) => {
  const { seen, ui, hostClose, reopen } = await hostClosedAnswer($, on)
  await typeAnswer(ui, 'half', 'change')
  hostClose()
  await reopen()
  expect(seen.store.get('draftHint')).toBe(true)
  await ui.redraw()
  await typeKey(ui, 'w')
  expect(seen.store.get('draftHint')).toBe(false)
})

// ---- the band's engine subject words (restored from F4 subjects): drawn through the table, never as the engine's English in Korean ----
for (const [subject, key] of Object.entries(SUBJECT_KEY)) {
  for (const language of [undefined, 'korean'] as const) {
    test(`F4 subjects: the band draws the engine subject "${subject}" ${language ?? 'in English'}${language === undefined ? '' : ' by subjectWord'}`, async ($, on) => {
      await seeded($, on, { status: stat(), task: demo({ now: { kind: 'answer', subject, detail: '' } }) }, 'terminal', language)
      const text = visible(await (await band($, 'terminal')).drawn())
      const t = STRINGS[language === undefined ? 'en' : 'ko'] as Record<string, string>
      expect(text).toContain(`${t.nowAnswer}: ${t[key]}`)
      if (language === 'korean') {
        if (t[key] !== subject) expect(text).not.toContain(subject)
        expect(latinOutside(text, [...LANG_DATA, 'engine band'])).toEqual([])
      }
    })
  }
}

test('F2 demo renders', () => {
  // the page tests above collect the renders; each block is split into tmp/card125/renders by graph/scripts/split-demo.mjs
  const last = new Map(F2_SHOTS.map(s => [s.name, s.lines]))
  expect(last.size).toBe(52)
  for (const [name, lines] of last) console.log(`=== ${name} ===\n${lines.join('\n')}\n=== end ===`)
})
