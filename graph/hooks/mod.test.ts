import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const DIR = '.harness-run/broker/runs'
const HOUR = 3_600_000
const NOW = 10 * HOUR

type Spec = [id: string, state: string, extra?: Record<string, unknown>]

// a node the way graph.mjs writes it (node_id, stage, deps, after, state, attempt, subgoal_id)
function node([id, state, extra = {}]: Spec, deps: string[] = [], after: string[] = []) {
  const [stage, a, b] = id.split(':')
  const sg = stage === 'implement' || stage === 'test' || stage === 'gate' ? (a === 'goal' ? null : a) : undefined
  const attempt = Number(stage === 'implement' || stage === 'test' || stage === 'gate' ? b ?? a : a ?? 1) || 1
  return { node_id: id, stage, deps, after, state, attempt, ...(sg === undefined ? {} : { subgoal_id: sg }), ...extra }
}

// the real run file's shape (run 696f2f93): plan, setgoal, critique, implement:U1:1 done; the rest pending
const base = (over: Record<string, unknown> = {}) => ({
  run_id: '696f2f93-d3b1-43c1-9fdb-d49bbbd9bcce',
  cwd: '/proj',
  request: '[teams-task 97f05d73-860c-4538-8203-e9a0f925b366] README에 한 줄 추가하는 작은 작업\nmore',
  max_retries: 2,
  routing_blocked: false,
  spec: { goal: 'Add one line', acceptance: [], subgoals: [{ id: 'U1', title: 'Create README.md with a single line' }] },
  nodes: [
    node(['plan', 'done']),
    node(['setgoal', 'done'], ['plan']),
    node(['critique', 'done'], ['setgoal']),
    node(['implement:U1:1', 'done'], ['critique']),
    node(['test:U1:1', 'pending'], ['implement:U1:1']),
    node(['gate:U1:1', 'pending'], ['test:U1:1']),
    node(['gate:goal:1', 'pending'], ['gate:U1:1']),
    node(['report', 'pending'], [], ['gate:goal:1']),
  ],
  ...over,
})
type Run = ReturnType<typeof base>
const withNodes = (nodes: ReturnType<typeof node>[], over: Record<string, unknown> = {}) => base({ nodes, ...over })
const patch = (run: Run, id: string, state: string, extra: Record<string, unknown> = {}) =>
  base({ nodes: run.nodes.map(n => (n.node_id === id ? { ...n, state, ...extra } : n)) })

type File = { name: string; mtimeMs: number; body: string }
const file = (run: unknown, mtimeMs = NOW - 1000, name = 'a1.json'): File => ({ name, mtimeMs, body: JSON.stringify(run) })

// one run file as `broker.mjs runs --list/--show --json` prints it (the node decides; this stub only reshapes the fixture)
const rowOf = (f: File) => {
  const run = JSON.parse(f.body)
  const done = run.nodes.some((n: any) => n.stage === 'report' && n.state === 'done')
  const age = NOW - f.mtimeMs
  return {
    id8: run.run_id.slice(0, 8), state: done ? 'complete' : 'running', owner: run.owner ?? null, created_at: new Date(NOW - 2 * HOUR).toISOString(), cost_usd: null,
    running: null, run_id: run.run_id, file: `/proj/${DIR}/${f.name}`, request: run.request.split('\n')[0], max_retries: run.max_retries ?? null,
    last_change: new Date(f.mtimeMs).toISOString(), last_change_ms: f.mtimeMs, age_ms: age, open: !done && age < 12 * HOUR, stalled: !done && age >= 2 * HOUR,
    routing_blocked: run.routing_blocked === true, unavailable_vendors: {},
    subgoals: (run.spec?.subgoals ?? []).map((g: any) => ({ id: g.id, title: g.title ?? '' })),
    last_step: null, acting: run.nodes.some((n: any) => n.state === 'running'), rejects: run.nodes.filter((n: any) => n.state === 'failed').length,
    nodes: run.nodes.map((n: any) => ({
      node_id: n.node_id, stage: n.stage, subgoal_id: n.subgoal_id ?? null, state: n.state, attempt: n.attempt,
      agent: n.vendor ? `${n.vendor}·${n.model}` : null, started_at: n.started_at ?? null, finished_at: n.finished_at ?? null,
      reason: n.result?.reason ?? null, feedback: n.feedback ?? null, last_step: null,
    })),
  }
}

// The engine beneath: a Map-backed $.state, surfaces, the node readout (process.run), settings, ui.open.
function world(on: On, files: File[], opts: { language?: string; surfaces?: readonly ('terminal' | 'desktop')[] } = {}) {
  const store = new Map<string, unknown>()
  const seen = {
    opened: [] as string[], openArgs: [] as any[], closed: [] as string[], panes: [] as { id: string }[], commands: [] as string[], commandArgs: [] as any[],
    files, outcomes: [] as any[], failSet: false, runs: [] as (readonly string[])[], events: [] as unknown[],
    script: { exitCode: 0, raw: undefined as string | undefined }, listCalls: [] as (readonly string[])[], showCalls: [] as (readonly string[])[],
    list: { exitCode: 0, raw: undefined as string | undefined }, store,
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  // the readout answers --list and --show from the fixtures; failure-events.mjs answers with the events the test set
  // (its own logic is tested in graph/scripts)
  on('process.run', (_$, e) => {
    const argv = e.argv
    if (argv[2] === 'runs' && argv.includes('--list')) {
      seen.listCalls.push(argv)
      return { value: { exitCode: seen.list.exitCode, stdout: seen.list.raw ?? JSON.stringify(seen.files.map(rowOf)), stderr: '' } } as never
    }
    if (argv[2] === 'runs' && argv.includes('--show')) {
      seen.showCalls.push(argv)
      const f = seen.files.find(one => String(argv[4]).endsWith(`/${one.name}`))
      return { value: f === undefined ? { exitCode: 1, stdout: '', stderr: 'no file' } : { exitCode: 0, stdout: JSON.stringify(rowOf(f)), stderr: '' } } as never
    }
    seen.runs.push(argv)
    return { value: { exitCode: seen.script.exitCode, stdout: seen.script.raw ?? `${JSON.stringify(seen.events)}\n`, stderr: '' } } as never
  })
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['terminal'] }))
  on('command.register', (_$, e) => {
    seen.commands.push(e.name)
    seen.commandArgs.push(e)
    return { value: { command: e.name } }
  })
  on('settings.read', () => ({ value: opts.language === undefined ? {} : { language: opts.language } }) as never)
  on('state.get', (_$, e) => ({ value: { value: store.get(e.key), version: 0 } }) as never)
  on('state.set', (_$, e) => {
    if (e.plugin === 'graph' && e.key === 'outcome') {
      if (seen.failSet) throw new Error('state is down')
      seen.outcomes.push(e.value)
    }
    store.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } } as never
  })
  // the prompt area beneath the band
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return Text({ children: 'prompt' } as never) as never
  })
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)
    seen.openArgs.push(e)
    seen.panes.push({ id: e.id })
    return { value: { isPlaced: true } } as never
  })
  on('ui.panes', () => ({ value: seen.panes }) as never)
  on('ui.close', (_$, e) => {
    seen.closed.push(e.id)
    seen.panes = seen.panes.filter(p => p.id !== e.id)
    return { value: undefined } as never
  })
  return seen
}

const start = ($: Engine) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
const pane = ($: Engine, bodyColumns = 80) =>
  $.ui.mount({ plugin: 'graph', surface: 'terminal', component: 'Pane', requestId: 'graph-status', props: { title: 'Graph', isFocused: false, bodyColumns, placement: 'dock' } } as never)
type Ui = Awaited<ReturnType<typeof pane>>
const shown = async (ui: Ui) => JSON.stringify(await ui.drawn())
const band = ($: Engine, bodyColumns = 190, hasSurvey = false) =>
  $.ui.mount({ plugin: 'graph', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey, bodyColumns } } as never)
const typeKey = async (ui: Ui, text: string) => {
  await ui.input({ key: 'keys', text, kind: 'change' })
  await ui.redraw()
}

// the session start runs the first tick over the mocked readout
async function seeded($: Engine, on: On, files: File[], opts: { language?: string } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, files, opts)
  await start($)
  return { seen, clock, tick: () => clock.advance(5000) }
}

const LEAKS = ['implement:U1:1', 'test:U1:1', 'gate:U1:1', 'gate:goal', '/Users/', '/var/']

test('no surface: no command, no readout call, no timer, no band, no spinner', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, [file(patch(base(), 'test:U1:1', 'running'))], { surfaces: [] })
  await start($)
  await clock.advance(30_000)
  expect(seen.commands).toEqual([])
  expect(seen.listCalls).toEqual([])
  expect(seen.store.get('spin')).toBeUndefined()
  expect(await shown(await band($))).not.toContain('696f2f93')
})

test('the tick calls the node readout from the plugin root every 5 s, and the mod reads no run folder itself', async ($, on) => {
  const { seen, clock } = await seeded($, on, [file(base())])
  expect(seen.listCalls).toHaveLength(1)
  const argv = seen.listCalls[0]!
  expect(argv[0]).toBe('node')
  expect(argv[1]).toMatch(/\/mcp\/broker\.mjs$/)
  expect(argv.slice(2)).toEqual(['runs', '--list', '--json', '--cwd', '/proj'])
  await clock.advance(5000)
  await clock.advance(5000)
  expect(seen.listCalls).toHaveLength(3)
  expect((seen.store.get('rows') as unknown[]).length).toBe(1)
})

test('a readout that fails or prints garbage keeps the previous rows and throws nothing', async ($, on) => {
  const { seen, tick } = await seeded($, on, [file(base())])
  expect((seen.store.get('rows') as any[])[0].id8).toBe('696f2f93')
  seen.list.exitCode = 1
  await tick()
  seen.list.exitCode = 0
  seen.list.raw = 'not json'
  await tick()
  seen.list.raw = '{"not":"a list"}'
  await tick()
  expect((seen.store.get('rows') as any[])[0].id8).toBe('696f2f93')
  seen.list.raw = '[]'
  await tick()
  expect(seen.store.get('rows')).toEqual([]) // an empty list is an answer
})

const run = ($: Engine, args = '') => $.command.run({ command: 'graph-status', args, origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)

test('/graph-status opens the pane and says so; the reply has no id', async ($, on) => {
  const { seen } = await seeded($, on, [file(base())])
  const r = JSON.stringify(await run($))
  expect(seen.opened).toEqual(['graph-status'])
  expect(r).toContain('pane opened')
  expect(seen.commands).toEqual(['graph-status'])
})

// close: Esc (closeOnEscape on the open), q (the dismiss button), the command again
test('close 1/3: the pane is opened to close on Escape', async ($, on) => {
  const { seen } = await seeded($, on, [file(base())])
  await run($)
  expect(seen.openArgs[0]).toMatchObject({ id: 'graph-status', focus: true, closeOnEscape: true })
})

test('close 2/3: the q button dismisses the pane', async ($, on) => {
  const { seen } = await seeded($, on, [file(base())])
  const ui = await pane($)
  const btn = await ui.find({ key: 'close' })
  expect(btn?.props).toMatchObject({ role: 'dismiss', hotkey: 'q', label: 'q' })
  await ui.press({ key: 'close' })
  expect(seen.closed).toEqual(['graph-status'])
})

test('close 3/3: the command again closes an open pane', async ($, on) => {
  const { seen } = await seeded($, on, [file(base())])
  await run($)
  const r = JSON.stringify(await run($))
  expect(seen.closed).toEqual(['graph-status'])
  expect(seen.opened).toEqual(['graph-status'])
  expect(r).toContain('pane closed')
  await run($)
  expect(seen.opened).toEqual(['graph-status', 'graph-status'])
})

test('the old command name is gone', async ($, on) => {
  const { seen } = await seeded($, on, [file(base())])
  expect(seen.commands).not.toContain('graph-live')
})

// card 57: the pane's Input takes `[`/`]`, so typed slash text must still reach the host
test('REQ-1 (a): ] then ]/graph-status typed into the pane closes it', async ($, on) => {
  const { seen } = await seeded($, on, [file(base())])
  await run($)
  const ui = await pane($)
  await typeKey(ui, ']')
  expect(seen.closed).toEqual([])
  await ui.input({ key: 'keys', text: ']/graph-status', kind: 'submit' })
  expect(seen.closed).toEqual(['graph-status'])
  expect(seen.panes).toEqual([])
})

test('REQ-1 (b): /graph-status typed into the pane closes it; the slash text presses no key', async ($, on) => {
  const { seen } = await seeded($, on, [file(base())])
  const ui = await pane($)
  await ui.input({ key: 'keys', text: '/graph-status', kind: 'change' })
  expect(seen.closed).toEqual([]) // the q inside slash text is not the close key
  await ui.input({ key: 'keys', text: '/graph-status', kind: 'submit' })
  expect(seen.closed).toEqual(['graph-status'])
})

test('REQ-1 (c): /other x runs that command once with exactly {command, args}, not awaited; no-slash text submits nothing', async ($, on) => {
  const ran: unknown[] = []
  // a command that never answers must not hold the handler
  on('command.run', { command: 'other' }, (_$, e) => {
    ran.push(e)
    return new Promise(() => {}) as never
  })
  const { seen } = await seeded($, on, [file(base())])
  const ui = await pane($)
  await ui.input({ key: 'keys', text: '/other x', kind: 'change' })
  await ui.input({ key: 'keys', text: '/other x', kind: 'submit' })
  await ui.input({ key: 'keys', text: 'x', kind: 'submit' })
  expect(ran).toHaveLength(1)
  expect(ran[0]).toMatchObject({ command: 'other', args: 'x' })
  expect(seen.closed).toEqual([])
})

test('the pane: tabs Flow/Detail, id, request, subgoal title and the dim footer with a q button, no old close text', async ($, on) => {
  await seeded($, on, [file(base())])
  const ui = await pane($, 120)
  const text = await shown(ui)
  expect((await ui.find({ key: 'flow' }))?.props).toMatchObject({ plain: true, hotkey: '1', dimColor: false, label: '● Flow' })
  expect((await ui.find({ key: 'detail' }))?.props).toMatchObject({ plain: true, hotkey: '2', dimColor: true, label: 'Detail' })
  expect(await ui.find({ key: 'keys' })).toBeDefined() // the Input that takes [ ] and typed slash text
  expect(text).toContain('696f2f93')
  expect(text).toContain('[teams-task 97f05d73') // the readout's first line is shown as given
  expect(text).toContain('Create README.md with a single line')
  expect(text).not.toContain('close [q]')
  expect(text).not.toContain('닫기 [q]')
  for (const leak of LEAKS) expect(text).not.toContain(leak)
})

test('Detail: one line per node with its agent, feedback and failure reason', async ($, on) => {
  const retried = withNodes([
    node(['plan', 'done']),
    node(['implement:U1:1', 'done', { vendor: 'codex', model: 'gpt-5' }], ['plan']),
    node(['gate:U1:1', 'failed', { result: { stage_ok: false, reason: 'README line missing' } }], ['implement:U1:1']),
    node(['implement:U1:2', 'running', { vendor: 'claude', model: 'opus', feedback: 'Add the README line\nsecond line' }], ['plan']),
  ])
  await seeded($, on, [file(retried)])
  const ui = await pane($)
  await ui.press({ key: 'detail' })
  await ui.redraw() // the stubbed $.state does not notify readers
  const text = await shown(ui)
  expect(await ui.find({ key: 'detail' })).toBeDefined()
  expect(text).toContain('codex·gpt-5')
  expect(text).toContain('claude·opus')
  expect(text).toContain('feedback: Add the README line second line')
  expect(text).toContain('README line missing')
})

test('Korean: the tab labels are Korean', async ($, on) => {
  await seeded($, on, [file(base())], { language: 'Korean' })
  const ui = await pane($)
  expect((await ui.find({ key: 'flow' }))?.props.label).toBe('● 흐름')
  expect((await ui.find({ key: 'detail' }))?.props.label).toBe('상세')
  expect(await shown(ui)).not.toContain('Detail')
})

test('no run: the pane says there is no graph run', async ($, on) => {
  await seeded($, on, [])
  expect(await shown(await pane($))).toContain('No graph run in this folder.')
})

test('read only: the mod calls the readout and the toast script, and nothing else', async ($, on) => {
  const { seen, tick } = await seeded($, on, [file(base())])
  await tick()
  const ui = await pane($)
  await ui.press({ key: 'detail' })
  for (const argv of [...seen.listCalls, ...seen.runs]) expect(argv[0]).toBe('node')
})

// two standalone runs: `]` and `[` walk them in opening order and stop at the ends
const two = () => [file(base(), NOW - 2000, 'a1.json'), file(base({ run_id: 'cafe0000-d3b1-43c1-9fdb-d49bbbd9bcce', request: 'second run' }), NOW - 1000, 'b2.json')]
const header = async (ui: Ui) => (await shown(ui)).match(/run \d of \d/)?.[0]

test('[ and ] walk the runs as key presses and stop at the ends; prev and next are buttons', async ($, on) => {
  const { seen } = await seeded($, on, two())
  await run($)
  const ui = await pane($)
  expect(await header(ui)).toBe('run 1 of 2')
  await typeKey(ui, '[') // at the first run: nothing
  expect(await header(ui)).toBe('run 1 of 2')
  await typeKey(ui, ']')
  expect(await header(ui)).toBe('run 2 of 2')
  await typeKey(ui, ']') // at the last run: nothing
  expect(await header(ui)).toBe('run 2 of 2')
  await ui.press({ key: 'prev' })
  await ui.redraw()
  expect(await header(ui)).toBe('run 1 of 2')
  await ui.press({ key: 'next' })
  await ui.redraw()
  expect(await header(ui)).toBe('run 2 of 2')
  expect(seen.store.get('selected')).toBeDefined()
})

test('one run: no prev and next buttons', async ($, on) => {
  await seeded($, on, [file(base())])
  const ui = await pane($)
  expect(await ui.find({ key: 'prev' })).toBeUndefined()
  expect(await ui.find({ key: 'next' })).toBeUndefined()
})

// ---- the band ----
test('band: a standalone open run shows one graph row and an open button that opens the pane', async ($, on) => {
  const { seen } = await seeded($, on, [file(base())])
  const ui = await band($)
  const text = await shown(ui)
  expect(text).toContain('graph')
  expect(text).toContain('696f2f93')
  const btn = await ui.find({ key: 'open' })
  expect(btn?.props.label).toBe('open')
  await ui.press({ key: 'open' })
  expect(seen.opened).toEqual(['graph-status'])
})

test('band: hidden with no open run, with only an owned or a finished run, and while a survey shows', async ($, on) => {
  const owned = base({ owner: { task_id: 't', key: 'E-abcd1234' } })
  const done = withNodes(base().nodes.map(n => ({ ...n, state: 'done' })))
  const { seen, tick } = await seeded($, on, [file(owned, NOW - 1000, 'o.json'), file({ ...done, run_id: 'dead0000-0000-0000-0000-000000000000' }, NOW - 1000, 'd.json')])
  expect(await (await band($)).find({ key: 'open' })).toBeUndefined()
  seen.files.splice(0, 2, file(base()))
  await tick()
  expect(await (await band($)).find({ key: 'open' })).toBeDefined()
  expect(await (await band($, 190, true)).find({ key: 'open' })).toBeUndefined()
})

// ---- the spinner: a faster interval, only while a shown run acts ----
test('spinner: while a run acts and the band shows it, a frame every 800 ms', async ($, on) => {
  const { seen, clock } = await seeded($, on, [file(patch(base(), 'test:U1:1', 'running'))])
  await clock.advance(1700)
  expect(Number(seen.store.get('spin') ?? 0)).toBe(2)
})

test('spinner: absent when nothing acts', async ($, on) => {
  const { seen, clock } = await seeded($, on, [file(base())])
  await clock.advance(12_000)
  expect(seen.store.get('spin')).toBeUndefined()
})

// ---- /graph-status open <run-file> <owner-key>: the teams hand-off ----
const FILE = `/proj/${DIR}/a1.json`
const owned = () => base({ owner: { task_id: 't', key: 'E-abcd1234' } })

test('the command registers the open argument hint', async ($, on) => {
  const { seen } = await seeded($, on, [])
  expect(seen.commandArgs[0].argumentHint).toBe('[open <run-file> <owner-key>]')
})

test('open <file> <key>: the node shows that file, the pane opens on it under the key; it is not in the band', async ($, on) => {
  const { seen } = await seeded($, on, [file(owned())])
  const r = JSON.stringify(await run($, `open ${FILE} E-abcd1234`))
  expect(r).toContain('pane opened')
  expect(seen.showCalls).toHaveLength(1)
  expect(seen.showCalls[0]!.slice(2)).toEqual(['runs', '--show', FILE, '--json'])
  expect(seen.opened).toEqual(['graph-status'])
  const ui = await pane($)
  const text = await shown(ui)
  expect(text).toContain('696f2f93')
  expect(text).toContain('under E-abcd1234')
  expect(await ui.find({ key: 'next' })).toBeUndefined() // the opened run is not part of a [ ] list
  expect(await shown(await band($))).not.toContain('696f2f93')
})

test('open with a missing key or file: the usage line, nothing opens', async ($, on) => {
  const { seen } = await seeded($, on, [file(owned())])
  for (const args of ['open', `open ${FILE}`, `open ${FILE} nope`, `open ${FILE} E-abcd1234 extra`, 'bogus']) {
    const r = JSON.stringify(await run($, args))
    expect(r).toContain('usage: /graph-status open')
  }
  expect(seen.opened).toEqual([])
  expect(seen.showCalls).toEqual([])
})

test('open a file the node cannot read: one line, nothing opens', async ($, on) => {
  const { seen } = await seeded($, on, [file(owned())])
  expect(JSON.stringify(await run($, 'open /proj/missing.json E-abcd1234'))).toContain('could not read')
  expect(seen.opened).toEqual([])
})

// run events: the failed / reshaped / blocked ones come from failure-events.mjs (stubbed in world()),
// the finished run from the row. PushNotification's result is { message, pushSent?, localSent?, disabledReason? }
async function pushed(push: (e: any) => unknown, files: File[], on: On, $: Engine) {
  const seen = { pushes: [] as any[], toasts: [] as string[], toastArgs: [] as any[] }
  on('tool.call', (_$, e: any) => {
    seen.pushes.push(e)
    return push(e) as never
  })
  on('ui.toast', (_$, e: any) => {
    seen.toasts.push(e.text)
    seen.toastArgs.push(e)
    return { value: undefined } as never
  })
  const s = await seeded($, on, files)
  return { ...seen, ...s }
}
const sentOk = () => ({ result: { message: 'm', pushSent: true, localSent: true }, text: '' })
// every write moves the file's mtime, as on disk
let written = 0
const fresh = (run: unknown): File => file(run, NOW + 1000 + written++)
const rejected = () => patch(base(), 'implement:U1:1', 'failed', { result: { reason: 'nope' } })
const R = '696f2f93'
// an event the way failure-events.mjs prints it
const evt = (over: Record<string, unknown> = {}) => ({
  key: `${R}:implement:U1:1:rejected:1`,
  kind: 'rejected',
  node: 'implement:U1:1',
  attempt: 1,
  what: 'implement:U1:1',
  reason: 'nope',
  next_step: 'retry 2/3',
  severity: 'info',
  ...over,
})
const gaveUp = (over: Record<string, unknown> = {}) => evt({ key: `${R}:implement:U1:1:failed:1`, kind: 'failed', next_step: 'gave up', severity: 'failure', ...over })
// the run file changes and the script answers with `events`
async function change(w: { seen: { events: unknown[] }; tick: () => Promise<unknown> }, files: File[], run: unknown, events: unknown[]) {
  w.seen.events = events
  files[0] = fresh(run)
  await w.tick()
}

test('the mod runs failure-events.mjs from the plugin root on the row file, and computes no reason itself', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  await change(w, files, rejected(), [evt()])
  const argv = w.seen.runs.at(-1)!
  expect(argv[0]).toBe('node')
  expect(argv[1]).toMatch(/\/scripts\/failure-events\.mjs$/)
  expect(argv[2]).toBe('/proj/.harness-run/broker/runs/a1.json')
})

test('an info event (retry): a ↻ toast with the default timeout, no push; a repeat is not shown again', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  await change(w, files, rejected(), [evt()])
  await change(w, files, rejected(), [evt()])
  expect(w.toasts).toEqual([`↻ ${R} implement:U1:1 failed: nope → retry 2/3`])
  expect(w.toastArgs[0].timeoutMs).toBeUndefined()
  expect(w.pushes).toEqual([])
})

test('a spec retry (info): the same ↻ toast reads retrying as setgoal:N', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  await change(w, files, rejected(), [evt({ key: `${R}:critique:reshaped:1`, kind: 'reshaped', node: 'critique', what: 'critique', reason: 'spec is thin', next_step: 'retrying as setgoal:2' })])
  expect(w.toasts).toEqual([`↻ ${R} critique failed: spec is thin → retrying as setgoal:2`])
  expect(w.pushes).toEqual([])
})

test('gave up: a ✗ toast kept 10 s and one push with the reason and next step', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  await change(w, files, patch(base(), 'implement:U1:1', 'failed', { final: true }), [gaveUp({ reason: 'compiler crashed' })])
  expect(w.toasts).toEqual([`✗ ${R} implement:U1:1 failed: compiler crashed → gave up`])
  expect(w.toastArgs[0].timeoutMs).toBe(10000)
  expect(w.pushes.map(p => [p.tool, p.message, p.status])).toEqual([['PushNotification', `graph ${R} implement:U1:1 failed: compiler crashed → gave up`, 'proactive']])
})

test('needs you: a ⚠ toast kept 10 s and a push', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  await change(w, files, rejected(), [evt({ next_step: 'needs you', severity: 'failure' })])
  expect(w.toasts).toEqual([`⚠ ${R} implement:U1:1 failed: nope → needs you`])
  expect(w.toastArgs[0].timeoutMs).toBe(10000)
  expect(w.pushes).toHaveLength(1)
})

test('no next step: the toast leaves out the arrow and nothing is pushed', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  await change(w, files, rejected(), [evt({ next_step: null })])
  expect(w.toasts).toEqual([`↻ ${R} implement:U1:1 failed: nope`])
  expect(w.pushes).toEqual([])
})

test('the push text is cut at 200 chars', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  const what = `implement:${'U'.repeat(80)}:1`
  await change(w, files, rejected(), [gaveUp({ what, reason: 'r'.repeat(119) + '…' })])
  expect(w.pushes[0].message).toHaveLength(200)
  expect(w.pushes[0].message.startsWith(`graph ${R} ${what} failed: rrrr`)).toBe(true)
})

test('the push text keeps the whole reason and the next step when a 120-char reason fits in 200', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  const reason = 'r'.repeat(119) + '…'
  await change(w, files, rejected(), [gaveUp({ reason })])
  expect(w.pushes[0].message).toBe(`graph ${R} implement:U1:1 failed: ${reason} → gave up`)
  expect(w.pushes[0].message.length).toBeLessThanOrEqual(200)
})

test('a new attempt failing is a new event, shown once each', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  await change(w, files, rejected(), [evt()])
  await change(w, files, rejected(), [evt(), evt({ key: `${R}:implement:U1:2:rejected:2`, node: 'implement:U1:2', what: 'implement:U1:2', attempt: 2, reason: 'again', next_step: 'retry 3/3' })])
  expect(w.toasts).toEqual([`↻ ${R} implement:U1:1 failed: nope → retry 2/3`, `↻ ${R} implement:U1:2 failed: again → retry 3/3`])
})

test('the script runs once per write of the run file, not once per tick', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  await change(w, files, rejected(), [])
  const calls = w.seen.runs.length
  await w.tick()
  await w.tick()
  expect(w.seen.runs).toHaveLength(calls)
})

test('a script that fails or prints garbage is no events: no throw, no toast, and a finished run is still pushed', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  w.seen.script.exitCode = 1
  await change(w, files, rejected(), [evt()])
  w.seen.script.exitCode = 0
  w.seen.script.raw = 'not json'
  await change(w, files, rejected(), [evt()])
  w.seen.script.raw = '{"not":"an array"}'
  await change(w, files, rejected(), [evt()])
  expect(w.toasts).toEqual([])
  expect(w.pushes).toEqual([])
  w.seen.script.raw = undefined
  await change(w, files, withNodes(base().nodes.map(n => ({ ...n, state: 'done' }))), [])
  expect(w.pushes.map(p => p.message)).toEqual([`graph ${R}: complete — report (1/2)`])
})

test('a finished run pushes complete once', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  await change(w, files, withNodes(base().nodes.map(n => ({ ...n, state: 'done' }))), [])
  await w.tick()
  await w.tick()
  expect(w.pushes.map(p => p.message)).toEqual([`graph ${R}: complete — report (1/2)`])
  expect(w.toasts).toEqual([])
})

test('what a run held before the session started is not shown or pushed', async ($, on) => {
  const files = [file(rejected())]
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, files)
  seen.events = [gaveUp()]
  on('tool.call', () => sentOk() as never)
  const toasts: string[] = []
  on('ui.toast', (_$, e: any) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  await start($)
  await clock.advance(5000)
  expect(toasts).toEqual([])
})

test('a finished run not sent (user at the terminal): the same line is a toast', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(() => ({ result: { message: 'm', pushSent: false, localSent: false, disabledReason: 'user_present' }, text: '' }), files, on, $)
  await change(w, files, withNodes(base().nodes.map(n => ({ ...n, state: 'done' }))), [])
  expect(w.toasts).toEqual([`graph ${R}: complete — report (1/2)`])
})

test('a throwing push on a finished run is a toast too', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(() => {
    throw new Error('no transport')
  }, files, on, $)
  await change(w, files, withNodes(base().nodes.map(n => ({ ...n, state: 'done' }))), [])
  expect(w.toasts).toEqual([`graph ${R}: complete — report (1/2)`])
})

test('a gave up whose push throws still toasts once', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(() => {
    throw new Error('no transport')
  }, files, on, $)
  await change(w, files, rejected(), [gaveUp()])
  expect(w.toasts).toEqual([`✗ ${R} implement:U1:1 failed: nope → gave up`])
})

// the run outcome graph publishes for trophy: three labels and a time, never an id
const outcomesOf = (w: { outcomes: any[] }) => w.outcomes.map(o => o.outcome)

test('a finished run publishes pass once, with exactly system, outcome and at', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  await change(w, files, withNodes(base().nodes.map(n => ({ ...n, state: 'done' }))), [])
  await w.tick()
  expect(outcomesOf(w.seen)).toEqual(['pass'])
  expect(Object.keys(w.seen.outcomes[0]).sort()).toEqual(['at', 'outcome', 'system'])
  expect(w.seen.outcomes[0].system).toBe('graph')
})

test('retries spent publishes fail', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  await change(w, files, patch(base(), 'implement:U1:1', 'failed', { final: true }), [gaveUp()])
  expect(outcomesOf(w.seen)).toEqual(['fail'])
})

test('routing blocked publishes fail', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  await change(w, files, base({ routing_blocked: true }), [gaveUp({ key: `${R}:plan:blocked:1`, kind: 'blocked', node: 'plan', what: 'plan' })])
  expect(outcomesOf(w.seen)).toEqual(['fail'])
})

test('blocked and then failed in one run publishes fail once', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  await change(w, files, base({ routing_blocked: true }), [gaveUp({ key: `${R}:plan:blocked:1`, kind: 'blocked', node: 'plan', what: 'plan' })])
  await change(w, files, patch(base({ routing_blocked: true }), 'implement:U1:1', 'failed', { final: true }), [gaveUp()])
  expect(outcomesOf(w.seen)).toEqual(['fail'])
})

test('a node reject publishes nothing', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  await change(w, files, rejected(), [evt()])
  expect(w.toasts).toHaveLength(1)
  expect(w.seen.outcomes).toEqual([])
})

test('a run held before the session started publishes nothing', async ($, on) => {
  const w = await pushed(sentOk, [file(withNodes(base().nodes.map(n => ({ ...n, state: 'done' }))))], on, $)
  await w.tick()
  expect(w.seen.outcomes).toEqual([])
})

test('a failing state write never breaks the push', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  w.seen.failSet = true
  await change(w, files, withNodes(base().nodes.map(n => ({ ...n, state: 'done' }))), [])
  expect(w.pushes.map(p => p.message)).toEqual([`graph ${R}: complete — report (1/2)`])
})

test('a failing state write never breaks the failure toast and push', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(sentOk, files, on, $)
  w.seen.failSet = true
  await change(w, files, patch(base(), 'implement:U1:1', 'failed', { final: true }), [gaveUp()])
  expect(w.toasts).toHaveLength(1)
  expect(w.pushes).toHaveLength(1)
})
