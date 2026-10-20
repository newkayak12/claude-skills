import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const DIR = '.harness-run/broker/runs'
const HOUR = 3_600_000
const NOW = 10 * HOUR
const MiB = 1024 * 1024

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

type File = { name: string; mtimeMs: number; body: string; size?: number; kind?: string }
const file = (run: unknown, mtimeMs = NOW - 1000, name = 'a1.json'): File => ({ name, mtimeMs, body: JSON.stringify(run) })

// The engine beneath: a Map-backed $.state, surfaces, a runs folder (fs.list / fs.read), settings, ui.open.
function world(on: On, files: File[], opts: { language?: string; surfaces?: readonly ('terminal' | 'desktop')[] } = {}) {
  const store = new Map<string, unknown>()
  const seen = { reads: [] as string[], lists: [] as string[], opened: [] as string[], openArgs: [] as any[], closed: [] as string[], panes: [] as { id: string }[], commands: [] as string[], files, writes: 0, outcomes: [] as any[], failSet: false, runs: [] as (readonly string[])[], events: [] as unknown[], script: { exitCode: 0, raw: undefined as string | undefined } }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  // failure-events.mjs, stubbed: it answers with the events the test set (its own logic is tested in graph/scripts)
  on('process.run', (_$, e) => {
    seen.runs.push(e.argv)
    return { value: { exitCode: seen.script.exitCode, stdout: seen.script.raw ?? `${JSON.stringify(seen.events)}\n`, stderr: '' } } as never
  })
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['terminal'] }))
  on('command.register', (_$, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('settings.read', () => ({ value: opts.language === undefined ? {} : { language: opts.language } }) as never)
  on('fs.list', (_$, e) => {
    seen.lists.push(String(e.path))
    return { value: seen.files.map(f => ({ name: f.name, kind: f.kind ?? 'file', size: f.size ?? f.body.length, mtimeMs: f.mtimeMs, isLink: false })) } as never
  })
  on('fs.read', (_$, e) => {
    seen.reads.push(String(e.path))
    const f = seen.files.find(one => String(e.path).endsWith(`/${one.name}`))
    if (f === undefined) throw new Error('ENOENT')
    return { value: f.body } as never
  })
  on('fs.write', () => {
    seen.writes += 1
    return { value: undefined } as never
  })
  on('state.get', (_$, e) => ({ value: { value: store.get(e.key), version: 0 } }) as never)
  on('state.set', (_$, e) => {
    if (e.plugin === 'graph' && e.key === 'outcome') {
      if (seen.failSet) throw new Error('state is down')
      seen.outcomes.push(e.value)
    }
    store.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } } as never
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
const pane = ($: Engine) =>
  $.ui.mount({ plugin: 'graph', surface: 'terminal', component: 'Pane', requestId: 'graph-status', props: { title: 'Graph', isFocused: false, bodyColumns: 80, placement: 'dock' } } as never)
type Ui = Awaited<ReturnType<typeof pane>>
const shown = async (ui: Ui) => JSON.stringify(await ui.drawn())

// the session start runs the first tick over the mocked folder
async function seeded($: Engine, on: On, files: File[], opts: { language?: string } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, files, opts)
  await start($)
  return { seen, tick: () => clock.advance(3000) }
}

const LEAKS = ['implement:U1:1', 'test:U1:1', 'gate:U1:1', 'gate:goal', '/Users/', '/var/']

test('no surface: no command and no folder read', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, [file(base())], { surfaces: [] })
  await start($)
  expect(seen.commands).toEqual([])
  expect(seen.lists).toEqual([])
})

const run = ($: Engine) => $.command.run({ command: 'graph-status', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)

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
  expect(btn?.props).toMatchObject({ role: 'dismiss', hotkey: 'q' })
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

test('Flow: tabs, rail, Next line, subgoal title and the 0/1 bar over the run file', async ($, on) => {
  const { seen } = await seeded($, on, [file(base())])
  expect(seen.lists).toHaveLength(1)
  expect(seen.lists[0]!.endsWith(`/${DIR}`) || seen.lists[0] === DIR).toBe(true)
  const ui = await pane($)
  const text = await shown(ui)
  expect((await ui.find({ key: 'flow' }))?.props).toMatchObject({ plain: true, hotkey: '1', dimColor: false, label: '● Flow' })
  expect((await ui.find({ key: 'detail' }))?.props).toMatchObject({ plain: true, hotkey: '2', dimColor: true, label: 'Detail' })
  for (const one of ['● Plan', '● SetGoal', '● Critique', '◉ Build', '○ Goal gate', '○ Report']) {
    expect(await ui.find({ type: 'Text', text: one })).toBeDefined()
  }
  expect(text).toContain(' ━━ ')
  expect(text).toContain(' ┄┄ ')
  expect(text).toContain('Next · U1 test (attempt 1)')
  expect(text).not.toContain('Now ·')
  expect(text).toContain('Create README.md with a single line')
  expect(text).toContain('0/1 gates')
  expect(text).toContain('README에 한 줄 추가하는 작은 작업')
  expect(text).toContain('696f2f93')
  expect(text).not.toContain('teams-task')
  for (const leak of LEAKS) expect(text).not.toContain(leak)
})

test('Flow: a running node reads Now, not Next', async ($, on) => {
  await seeded($, on, [file(patch(base(), 'test:U1:1', 'running'))])
  const text = await shown(await pane($))
  expect(text).toContain('Now · U1 test (attempt 1)')
  expect(text).not.toContain('Next ·')
})

test('Flow: a failed gate with nothing ready is Blocked, in a warning Text with the reason', async ($, on) => {
  const run = patch(patch(base(), 'test:U1:1', 'done'), 'gate:U1:1', 'failed', { result: { stage_ok: false, reason: 'tests red' } })
  await seeded($, on, [file(run)])
  const ui = await pane($)
  const blocked = await ui.find({ type: 'Text', text: /Blocked/ })
  expect(blocked?.props.color).toBe('warning')
  expect(blocked?.text).toContain('U1 gate')
  expect(blocked?.text).toContain('tests red')
  expect(await shown(ui)).toContain('blocked')
})

test('Flow: a finished run shows the finished word, the goal gate %', async ($, on) => {
  let run: Run = patch(patch(patch(base(), 'test:U1:1', 'done'), 'gate:U1:1', 'done'), 'report', 'done')
  run = patch(run, 'gate:goal:1', 'done', { result: { stage_ok: true, match_pct: 92 } })
  await seeded($, on, [file(run)])
  const text = await shown(await pane($))
  expect(text).toContain('finished')
  expect(text).toContain('goal gate 92%')
  expect(text).toContain('1/1 gates')
  expect(text).toContain('All done')
})

test('Ready mirrors the engine: U2 test is Next, not the report; a node waiting on a missing node is never Next', async ($, on) => {
  const run = withNodes(
    [
      node(['plan', 'done']),
      node(['setgoal', 'done'], ['plan']),
      node(['critique', 'done'], ['setgoal']),
      node(['implement:U1:1', 'done'], ['critique']),
      node(['test:U1:1', 'done'], ['implement:U1:1']),
      node(['gate:U1:1', 'failed', { final: true, result: { stage_ok: false, reason: 'x' } }], ['test:U1:1']),
      node(['implement:U2:1', 'done'], ['critique']),
      node(['test:U2:1', 'pending'], ['implement:U2:1']),
      node(['gate:U2:1', 'pending'], ['test:U2:1']),
      node(['gate:goal:1', 'unreachable'], ['gate:U1:1', 'gate:U2:1']),
      node(['report', 'pending'], [], ['gate:goal:1']),
      node(['test:U3:1', 'pending'], ['implement:U2:1'], ['nowhere']),
    ],
    { spec: { subgoals: [{ id: 'U1', title: 'one' }, { id: 'U2', title: 'two' }, { id: 'U3', title: 'three' }] } },
  )
  await seeded($, on, [file(run)])
  const text = await shown(await pane($))
  expect(text).toContain('Next · U2 test (attempt 1)')
  expect(text).not.toContain('Next · Report')
  expect(text).not.toContain('Next · U3')
})

const T0 = NOW - 200_000
// a retried run: attempt 1 rejected at the gate with a reason, attempt 2 carries the feedback and is running
const retried = () =>
  withNodes([
    node(['plan', 'done']),
    node(['setgoal', 'done'], ['plan']),
    node(['critique', 'done'], ['setgoal']),
    node(['implement:U1:1', 'done', { vendor: 'codex', executor: 'codex', model: 'gpt-5', started_at: T0, finished_at: T0 + 60_000 }], ['critique']),
    node(['test:U1:1', 'done'], ['implement:U1:1']),
    node(['gate:U1:1', 'failed', { result: { stage_ok: false, reason: 'README line missing' } }], ['test:U1:1']),
    node(['implement:U1:2', 'running', { vendor: 'claude', executor: 'claude', model: 'opus', started_at: NOW - 125_000, feedback: 'Add the README line\nsecond line' }], ['critique']),
    node(['test:U1:2', 'pending'], ['implement:U1:2']),
    node(['gate:U1:2', 'pending'], ['test:U1:2']),
    node(['gate:goal:1', 'pending'], ['gate:U1:2']),
    node(['report', 'pending'], [], ['gate:goal:1']),
  ])

test('Now: the running node with its vendor·model and elapsed time', async ($, on) => {
  await seeded($, on, [file(retried())])
  const text = await shown(await pane($))
  expect(text).toContain('Now · U1 impl (attempt 2) · claude·opus · 2m 5s')
})

test('narrow pane: tab labels stay Flow / Detail, the tab row does not shrink, the run id is on the title line', async ($, on) => {
  await seeded($, on, [file(base())])
  const ui = await $.ui.mount({ plugin: 'graph', surface: 'terminal', component: 'Pane', requestId: 'graph-status', props: { title: 'Graph', isFocused: false, bodyColumns: 40, placement: 'dock' } } as never)
  expect((await ui.find({ key: 'flow' }))?.props.label).toBe('● Flow')
  expect((await ui.find({ key: 'detail' }))?.props.label).toBe('Detail')
  const text = await shown(ui)
  expect(text).toContain('{"type":"Box","props":{"flexShrink":0},"children":[{"type":"Box","props":{"columnGap":3}')
  expect(text).toContain('{"type":"Text","props":{"dimColor":true,"wrap":"truncate-end"},"children":["696f2f93"]}')
  expect(text.indexOf('696f2f93')).toBeLessThan(text.indexOf('"key":"flow"'))
})

test('Now: no vendor recorded reads —', async ($, on) => {
  await seeded($, on, [file(patch(base(), 'test:U1:1', 'running'))])
  expect(await shown(await pane($))).toContain('Now · U1 test (attempt 1) · —')
})

test('Flow: a rejected attempt shows its reason and the retry nested under it', async ($, on) => {
  await seeded($, on, [file(retried())])
  const text = await shown(await pane($))
  expect(text).toContain('↳ README line missing')
  expect(text.indexOf('(attempt 1)')).toBeLessThan(text.indexOf('↳ README line missing'))
  expect(text.indexOf('↳ README line missing')).toBeLessThan(text.lastIndexOf('(attempt 2)')) // the first one is the Now line
  expect(text).toContain('"marginLeft":2')
  expect(text).toContain('"marginLeft":4')
})

test('Detail: per node agent, timing, feedback carried and the failure reason; no board', async ($, on) => {
  await seeded($, on, [file(retried())])
  const ui = await pane($)
  await ui.press({ key: 'detail' })
  await ui.redraw() // the stubbed $.state does not notify readers
  expect((await ui.find({ key: 'detail' }))?.props).toMatchObject({ dimColor: false, label: '● Detail' })
  const text = await shown(ui)
  expect(text).toContain('U1 impl (attempt 1)  codex·gpt-5  1m 0s')
  expect(text).toContain('U1 impl (attempt 2)  claude·opus  2m 5s')
  expect(text).toContain('feedback: Add the README line second line')
  expect(text).toContain('README line missing')
  expect(text).not.toContain('To do')
  for (const leak of LEAKS) expect(text).not.toContain(leak)
})

test('Flow: a skipped (superseded) attempt is not drawn on the flow lines', async ($, on) => {
  const run = base()
  run.nodes.unshift(node(['implement:U1:0', 'failed'], ['critique']) as never)
  run.nodes[0] = { ...run.nodes[0]!, state: 'skipped' }
  await seeded($, on, [file(run)])
  const text = await shown(await pane($))
  expect(text).not.toContain('✘')
})

test('the newest *.json wins; a tmp sibling and a non-JSON file are ignored', async ($, on) => {
  const old = base({ request: 'old run' })
  const fresh = base({ request: 'fresh run' })
  const decoy = base({ request: 'tmp decoy' })
  const { seen } = await seeded($, on, [
    file(old, NOW - 5000, 'aaaa.json'),
    file(fresh, NOW - 3000, 'bbbb.json'),
    file(decoy, NOW - 100, 'cccc.json.123.deadbeef.tmp'),
    file(decoy, NOW - 50, 'notes.txt'),
  ])
  const text = await shown(await pane($))
  expect(text).toContain('fresh run')
  expect(text).not.toContain('tmp decoy')
  expect(seen.reads).toHaveLength(1)
})

test('a file that fails to parse keeps the last good view', async ($, on) => {
  const files = [file(base({ request: 'good run' }), NOW - 4000, 'aaaa.json')]
  const { seen, tick } = await seeded($, on, files)
  seen.files.splice(0, 1, { name: 'aaaa.json', mtimeMs: NOW - 100, body: '{"run_id": "x", "nodes": [' })
  await tick()
  expect(seen.reads).toHaveLength(2)
  const text = await shown(await pane($))
  expect(text).toContain('good run')
})

test('no run folder: the pane says there is no graph run', async ($, on) => {
  await seeded($, on, [])
  expect(await shown(await pane($))).toContain('No graph run in this folder.')
})

test('size guard: a 5 MiB entry shows the too-large line and is never read', async ($, on) => {
  const big: File = { name: 'a1.json', mtimeMs: NOW - 10, body: '{}', size: 5 * MiB }
  const { seen } = await seeded($, on, [big])
  expect(await shown(await pane($))).toContain('too large')
  expect(seen.reads).toEqual([])
})

test('Korean: tabs, rail and sentences are Korean, no English tab label', async ($, on) => {
  await seeded($, on, [file(base())], { language: 'Korean' })
  const ui = await pane($)
  expect((await ui.find({ key: 'flow' }))?.props.label).toBe('● 흐름')
  expect((await ui.find({ key: 'detail' }))?.props.label).toBe('상세')
  const text = await shown(ui)
  for (const one of ['계획', '목표 설정', '비평', '구현', '목표 관문', '보고', '다음 · U1 테스트']) expect(text).toContain(one)
  for (const one of ['Flow', 'Detail', 'Next', 'Plan', 'Report', 'Build']) expect(text).not.toContain(one)
})

test('read only: no fs.write is ever called', async ($, on) => {
  const { seen, tick } = await seeded($, on, [file(base())])
  await tick()
  const ui = await pane($)
  await ui.press({ key: 'detail' })
  expect(seen.writes).toBe(0)
})

// run events: the failed / reshaped / blocked ones come from failure-events.mjs (stubbed in world()),
// the finished run from the run file. PushNotification's result is { message, pushSent?, localSent?, disabledReason? }
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

test('the mod runs failure-events.mjs from the plugin root on the run file, and computes no reason itself', async ($, on) => {
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
  files[0] = fresh(withNodes(base().nodes.map(n => ({ ...n, state: 'done' }))))
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
  await clock.advance(3000)
  expect(toasts).toEqual([])
})

test('a finished run not sent (user at the terminal): the same line is a toast', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(() => ({ result: { message: 'm', pushSent: false, localSent: false, disabledReason: 'user_present' }, text: '' }), files, on, $)
  files[0] = fresh(withNodes(base().nodes.map(n => ({ ...n, state: 'done' }))))
  await w.tick()
  expect(w.toasts).toEqual([`graph ${R}: complete — report (1/2)`])
})

test('a throwing push on a finished run is a toast too', async ($, on) => {
  const files = [file(base())]
  const w = await pushed(() => {
    throw new Error('no transport')
  }, files, on, $)
  files[0] = fresh(withNodes(base().nodes.map(n => ({ ...n, state: 'done' }))))
  await w.tick()
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
  files[0] = fresh(withNodes(base().nodes.map(n => ({ ...n, state: 'done' }))))
  await w.tick()
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
  files[0] = fresh(withNodes(base().nodes.map(n => ({ ...n, state: 'done' }))))
  await w.tick()
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
