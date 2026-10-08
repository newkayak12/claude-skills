import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const CONFIG = '.claude/harness-gate.json'
const DECISION = '.claude/.harness-last-decision.json'
const NOW = 1_000_000_000
const cfg = JSON.stringify({ patterns: ['^a/', '^b/', '^c/'], window_hours: 3 })
const deny = (ts: number) => JSON.stringify({ ts, tool: 'Write', target: 'a/x.md', decision: 'deny', reason: 'gated' })

type Files = Record<string, string | Error>

// the engine resolves a relative path against the working directory
const key = (files: Files, path: string) => Object.keys(files).find(k => path.endsWith(`/${k}`))

// The engine beneath: surfaces, fs.exists/read over a file map, status, command.register, $.state, ui.open.
// dirs: a directory path suffix to its entries ([name, kind, mtimeMs]); no git, so the cwd is the one tree
type Dirs = Record<string, [string, 'dir' | 'file', number?][]>
function world(on: On, surfaces: readonly ('terminal' | 'desktop')[], files: Files, dirs: Dirs = {}) {
  const seen = { statuses: [] as (string | undefined)[], commands: [] as string[], opened: [] as string[], reads: 0 }
  const store = new Map<string, unknown>()
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }) as never)
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a repo' } }) as never)
  on('fs.list', (_$, e) => {
    const k = Object.keys(dirs).find(d => e.path.endsWith(`/${d}`))
    if (k === undefined) throw new Error('ENOENT')
    return { value: dirs[k].map(([name, kind, mtimeMs]) => ({ name, kind, size: 0, mtimeMs: mtimeMs ?? NOW, isLink: false })) } as never
  })
  on('session.surfaces', () => ({ value: surfaces }))
  on('command.register', (_$, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('fs.exists', (_$, e) => ({ value: key(files, e.path) !== undefined }) as never)
  on('fs.read', (_$, e) => {
    seen.reads += 1
    const f = files[key(files, e.path) ?? '']
    if (f instanceof Error) throw f
    return { value: f } as never
  })
  on('ui.status', (_$, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  on('state.get', (_$, e) => ({ value: { value: store.get(e.key), version: 0 } }) as never)
  on('state.set', (_$, e) => {
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
    return { value: { isPlaced: true } } as never
  })
  return seen
}

const start = ($: Engine) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
const lastStatus = (seen: { statuses: (string | undefined)[] }) => seen.statuses[seen.statuses.length - 1]

test('surfaces []: no timer, no status, /harness-gate not registered', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, [], { [CONFIG]: cfg })
  await start($)
  await clock.advance(20000)
  expect(seen.reads).toBe(0)
  expect(seen.statuses).toEqual([])
  expect(seen.commands).toEqual([])
})

test('no config: status is undefined', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], {})
  await start($)
  expect(seen.statuses).toEqual([undefined])
  expect(seen.commands).toEqual(['harness-gate'])
})

const STALE = NOW - 13 * 60 * 60 * 1000
const spec = JSON.stringify({ subgoals: [{ id: 's1' }, { id: 's2' }] })
const sound = JSON.stringify({ sound: true })
const runFiles: Files = {
  'b/02-goal-spec.json': spec, 'b/02-critique.json': sound, 'b/subgoals/s1/result.json': JSON.stringify({ passed: true }),
  'c/02-goal-spec.json': spec, 'c/02-critique.json': sound,
  'c/subgoals/s1/result.json': JSON.stringify({ passed: true }), 'c/subgoals/s2/result.json': JSON.stringify({ passed: false }),
  'g1.json': JSON.stringify({ nodes: [{ stage: 'plan', state: 'done' }, { stage: 'implement', state: 'running' }, { stage: 'report', state: 'pending' }] }),
  'g2.json': JSON.stringify({ nodes: [{ stage: 'implement', state: 'done' }, { stage: 'report', state: 'done' }] }),
}
const planned: Dirs[string] = [['manifest.json', 'file'], ['01-plan.md', 'file'], ['02-goal-spec.json', 'file'], ['02-critique.json', 'file']]
const runDirs: Dirs = {
  '.harness-run': [['a', 'dir'], ['b', 'dir'], ['c', 'dir'], ['old', 'dir'], ['done', 'dir'], ['broker', 'dir'], ['note.md', 'file']],
  '.harness-run/a': [['manifest.json', 'file']],
  '.harness-run/b': planned,
  '.harness-run/c': planned,
  '.harness-run/old': [['manifest.json', 'file', STALE]],
  '.harness-run/done': [['manifest.json', 'file'], ['05-report.md', 'file']],
  '.harness-run/broker/runs': [['g1.json', 'file'], ['g2.json', 'file'], ['g3.json', 'file', STALE]],
}

test('open runs per stage: fallback and graph; stale, reported and finished runs left out', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { ...runFiles }, runDirs)
  await start($)
  expect(lastStatus(seen)).toBe('Plan(1) / Implement(1) / Gate(1) · graph Implement(1)')
})

test('graph runs alone', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { ...runFiles }, { '.harness-run': [['broker', 'dir']], '.harness-run/broker/runs': [['g1.json', 'file']] })
  await start($)
  expect(lastStatus(seen)).toBe('graph Implement(1)')
})

test('a gate decision no longer reaches the status line', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { [CONFIG]: cfg, [DECISION]: deny(NOW - 60_000) })
  await start($)
  expect(seen.statuses).toEqual([undefined])
})

test('polls every 5 s and picks up a new run', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const dirs: Dirs = {}
  const seen = world(on, ['terminal'], { [CONFIG]: cfg }, dirs)
  await start($)
  expect(lastStatus(seen)).toBe(undefined)
  dirs['.harness-run'] = [['a', 'dir']]
  dirs['.harness-run/a'] = [['manifest.json', 'file']]
  await clock.advance(5000)
  expect(lastStatus(seen)).toBe('Plan(1)')
})

for (const [name, text] of [
  ['not JSON', '{"ts": 1, "tool"'],
  ['partial (no decision field)', JSON.stringify({ ts: NOW, tool: 'Write', target: 'a/x.md' })],
] as const) {
  test(`a decision file that is ${name} is no decision`, async ($, on) => {
    mock.clock(on, { now: NOW })
    world(on, ['terminal'], { [CONFIG]: cfg, [DECISION]: text })
    await start($)
    const ui = await pane($, 'terminal')
    expect(await ui.find({ type: 'Text', text: 'No gated call decided yet.' })).toBeDefined()
  })
}

test('read error: no throw, the gate state stays', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { [CONFIG]: cfg, [DECISION]: deny(NOW) }
  world(on, ['terminal'], files)
  await start($)
  files[CONFIG] = new Error('EACCES')
  await clock.advance(5000)
  files[CONFIG] = '{not json'
  await clock.advance(5000)
  const ui = await pane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: '✘ deny' })).toBeDefined()
})

const pane = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'harness', surface, component: 'Pane', requestId: 'harness-gate', props: { title: 'Harness gate', isFocused: false, bodyColumns: 80, placement: 'dock' } } as never)

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: pane with no config says so`, async ($, on) => {
    world(on, [surface], {})
    mock.clock(on, { now: NOW })
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: 'No gate configured: .claude/harness-gate.json is not in this project.' })).toBeDefined()
  })

  test(`${surface}: pane armed with no decision lists patterns, window and the engage text`, async ($, on) => {
    mock.clock(on, { now: NOW })
    world(on, [surface], { [CONFIG]: cfg })
    await start($)
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: 'Gated patterns (3):' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '3 h' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'No gated call decided yet.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'A mention in text does not engage it.' })).toBeDefined()
  })

  test(`${surface}: pane with a recent deny shows tool, target, reason, age`, async ($, on) => {
    mock.clock(on, { now: NOW })
    world(on, [surface], { [CONFIG]: cfg, [DECISION]: deny(NOW - 120_000) })
    await start($)
    const ui = await pane($, surface)
    expect(await ui.find({ type: 'Text', text: '✘ deny' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Reason: gated' })).toBeDefined()
  })
}

test('/harness-gate answers and opens the pane; session start alone opens nothing', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { [CONFIG]: cfg })
  await start($)
  expect(seen.opened).toEqual([])
  const r = await $.command.run({ command: 'harness-gate', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(seen.opened).toEqual(['harness-gate'])
  expect(JSON.stringify(r)).toContain('pane opened')
})

const band = ($: Engine, on: On, hasSurvey = false) => {
  return $.ui.mount({ plugin: 'harness', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey } } as never)
}

test('band: hidden with no open runs', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, ['terminal'], {})
  await start($)
  const ui = await band($, on)
  expect(await ui.find({ type: 'Text', text: 'harness' })).toBeUndefined()
})

test('band: hidden while a survey shows', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, ['terminal'], { ...runFiles }, runDirs)
  await start($)
  const ui = await band($, on, true)
  expect(await ui.find({ type: 'Text', text: 'Implement 1' })).toBeUndefined()
})

test('band: chips with counts, harness row then graph row, Test only for harness', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, ['terminal'], { ...runFiles }, runDirs)
  await start($)
  const ui = await band($, on)
  expect(await ui.find({ type: 'Text', text: 'Plan 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Gate 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Implement 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Critique' })).toBeDefined()
})

test('band: hover card lists the run slug, bar and failed count', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, ['terminal'], { ...runFiles }, runDirs)
  await start($)
  const ui = await band($, on)
  expect(await ui.find({ type: 'Text', text: 'c' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 failed' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '▰▰▰▰▰' })).toBeDefined()
})

test('band: a graph run is named by its request first line, else its run id', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Files = {
    ...runFiles,
    'g4.json': JSON.stringify({ request: 'Ship the wiki memory\nwith details', nodes: [{ stage: 'plan', state: 'running' }] }),
  }
  world(on, ['terminal'], files, { '.harness-run': [['broker', 'dir']], '.harness-run/broker/runs': [['g1.json', 'file'], ['g4.json', 'file']] })
  await start($)
  const ui = await band($, on)
  expect(await ui.find({ type: 'Text', text: 'Ship the wiki memory' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'g1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'graph · Plan' })).toBeDefined()
})
