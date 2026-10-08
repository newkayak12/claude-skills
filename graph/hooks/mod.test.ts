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
  const seen = { reads: [] as string[], lists: [] as string[], opened: [] as string[], commands: [] as string[], files, writes: 0 }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
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
    store.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } } as never
  })
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } } as never
  })
  return seen
}

const start = ($: Engine) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
const pane = ($: Engine) =>
  $.ui.mount({ plugin: 'graph', surface: 'terminal', component: 'Pane', requestId: 'graph-live', props: { title: 'Graph', isFocused: false, bodyColumns: 80, placement: 'dock' } } as never)
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

test('/graph-live opens the pane and says so; the reply has no id', async ($, on) => {
  const { seen } = await seeded($, on, [file(base())])
  const r = JSON.stringify(await $.command.run({ command: 'graph-live', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never))
  expect(seen.opened).toEqual(['graph-live'])
  expect(r).toContain('pane opened')
})

test('Flow: tabs, rail, Next line, subgoal title and the 0/1 bar over the run file', async ($, on) => {
  const { seen } = await seeded($, on, [file(base())])
  expect(seen.lists).toHaveLength(1)
  expect(seen.lists[0]!.endsWith(`/${DIR}`) || seen.lists[0] === DIR).toBe(true)
  const ui = await pane($)
  const text = await shown(ui)
  expect((await ui.find({ key: 'flow' }))?.props).toMatchObject({ plain: true, hotkey: '1', dimColor: false, label: '● Flow' })
  expect((await ui.find({ key: 'nodes' }))?.props).toMatchObject({ plain: true, hotkey: '2', dimColor: true, label: 'Nodes' })
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

test('Nodes: a To do / Doing / Done board, labelled by person-words, skipped attempts absent', async ($, on) => {
  const run = patch(base(), 'test:U1:1', 'running')
  run.nodes.push(node(['implement:U1:0', 'skipped'], ['critique']))
  await seeded($, on, [file(run)])
  const ui = await pane($)
  await ui.press({ key: 'nodes' })
  await ui.redraw() // the stubbed $.state does not notify readers
  expect((await ui.find({ key: 'nodes' }))?.props).toMatchObject({ dimColor: false, label: '● Nodes' })
  const text = await shown(ui)
  expect(text).toContain('To do 3')
  expect(text).toContain('Doing 1')
  expect(text).toContain('Done 4')
  expect(text).toContain('U1 test #1')
  expect(text).toContain('Report')
  expect(text).not.toContain('implement:U1:0')
  expect(text).not.toContain('U1 impl #0')
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
  expect((await ui.find({ key: 'nodes' }))?.props.label).toBe('노드')
  const text = await shown(ui)
  for (const one of ['계획', '목표 설정', '비평', '구현', '목표 관문', '보고', '다음 · U1 테스트']) expect(text).toContain(one)
  for (const one of ['Flow', 'Nodes', 'Next', 'Plan', 'Report', 'Build']) expect(text).not.toContain(one)
})

test('read only: no fs.write is ever called', async ($, on) => {
  const { seen, tick } = await seeded($, on, [file(base())])
  await tick()
  const ui = await pane($)
  await ui.press({ key: 'nodes' })
  expect(seen.writes).toBe(0)
})
