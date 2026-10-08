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
  expect(await ui.find({ type: 'Text', text: 'Last decision: deny (Write a/x.md, 0 min ago)' })).toBeDefined()
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
    expect(await ui.find({ type: 'Text', text: 'Last decision: deny (Write a/x.md, 2 min ago)' })).toBeDefined()
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

// ---- run view: Run / Units / Gate tabs and the band ----
const RUN = '.harness-run/demo'
const specJson = JSON.stringify({ goal: 'Build demo', subgoals: [{ id: 'S1', title: 'first' }, { id: 'S2', title: 'second' }, { id: 'S3', title: 'third' }] })
const manifestJson = JSON.stringify({ request: 'Build demo\nmore lines', subgoals: [{ id: 'S1', order: 1 }, { id: 'S2', order: 2 }, { id: 'S3', order: 3 }] })
// S1 passed, S2 implemented and tested (not gated yet), S3 untouched
const demoRun = (over: Files = {}): Files => ({
  [`${RUN}/manifest.json`]: manifestJson,
  [`${RUN}/01-plan.md`]: '# plan',
  [`${RUN}/02-goal-spec.json`]: specJson,
  [`${RUN}/02-critique.json`]: JSON.stringify({ sound: true, problems: [] }),
  [`${RUN}/subgoals/S1/impl-1.md`]: 'x',
  [`${RUN}/subgoals/S1/result.json`]: JSON.stringify({ id: 'S1', passed: true, attempts: 1 }),
  [`${RUN}/subgoals/S2/impl-1.md`]: 'x',
  [`${RUN}/subgoals/S2/test-1.json`]: JSON.stringify({ verified: true }),
  ...over,
})

// the directory table of `world` from the file map; `ages` is how long ago a file changed (ms)
function dirsOf(files: Files, ages: Record<string, number> = {}): Dirs {
  const dirs: Dirs = {}
  for (const k of Object.keys(files)) {
    if (!k.startsWith('.harness-run/')) continue
    const parts = k.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      const name = parts[i]!
      const entries = (dirs[dir] ??= [])
      if (entries.some(e => e[0] === name)) continue
      entries.push([name, i < parts.length - 1 ? 'dir' : 'file', i < parts.length - 1 ? 0 : NOW - (ages[k] ?? 60_000)])
    }
  }
  return dirs
}

type Ui = Awaited<ReturnType<typeof pane>>
const shown = async (ui: Ui) => JSON.stringify(await ui.drawn())
const buttons = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.props as { label: string; hotkey?: string })
const oldAges = (files: Files, ms: number) => Object.fromEntries(Object.keys(files).map(k => [k, ms]))

async function seeded($: Engine, on: On, files: Files, opts: { language?: string; ages?: Record<string, number>; surfaces?: readonly ('terminal' | 'desktop')[] } = {}) {
  mock.clock(on, { now: NOW })
  const seen = world(on, opts.surfaces ?? ['terminal'], files, dirsOf(files, opts.ages))
  on('settings.read', () => ({ value: opts.language === undefined ? {} : { language: opts.language } }) as never)
  await start($)
  return seen
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: Run tab: tabs with hotkeys, rail, Now, a line per subgoal and the 1/3 bar`, async ($, on) => {
    await seeded($, on, demoRun(), { surfaces: [surface] })
    const ui = await pane($, surface)
    expect(await buttons(ui)).toMatchObject([
      { label: '● Run', hotkey: '1' },
      { label: 'Units', hotkey: '2' },
      { label: 'Gate', hotkey: '3' },
    ])
    for (const word of ['● Plan', '● SetGoal', '● Critique', '◉ Implement/Test', '○ Gate', '○ Report']) {
      expect(await ui.find({ type: 'Text', text: word })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: /Now.*Gating S2/ })).toBeDefined()
    const text = await shown(ui)
    expect(text).toContain('Build demo')
    for (const mark of ['"✔"', '"●"', '"○"', ' S1 first', ' S2 second', ' S3 third']) expect(text).toContain(mark)
    expect(text.indexOf(' S1 first')).toBeLessThan(text.indexOf(' S2 second'))
    expect(text.indexOf(' S2 second')).toBeLessThan(text.indexOf(' S3 third'))
    expect(await ui.find({ type: 'Text', text: /1\/3/ })).toBeDefined()
  })
}

test('goal gate result shows the percentage bar', async ($, on) => {
  await seeded($, on, demoRun({ [`${RUN}/04-goal-gate.json`]: JSON.stringify({ match_pct: 92, pass: true }) }))
  expect(await (await pane($, 'terminal')).find({ type: 'Text', text: /92%/ })).toBeDefined()
})

test('a failed subgoal sits under To do on Units with its gate reason', async ($, on) => {
  await seeded($, on, demoRun({
    [`${RUN}/subgoals/S2/gate-1.json`]: JSON.stringify({ pass: false, reason: 'tests red' }),
    [`${RUN}/subgoals/S2/result.json`]: JSON.stringify({ id: 'S2', passed: false, attempts: 1 }),
  }))
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'units' })
  await ui.redraw() // the stubbed $.state does not notify readers
  const text = await shown(ui)
  for (const word of ['To do 2', 'Doing 0', 'Done 1', '✘', 'tests red']) expect(text).toContain(word)
  expect(text.indexOf('To do')).toBeLessThan(text.indexOf('tests red'))
})

test('hotkey 3 (the Gate tab) shows the gate texts', async ($, on) => {
  await seeded($, on, demoRun({ [CONFIG]: cfg }))
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'gate' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'Gated patterns (3): ^a/, ^b/, ^c/' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Engagement window: 3 h' })).toBeDefined()
})

test('no run folder: the Gate tab by default, the no-run sentence on Run', async ($, on) => {
  await seeded($, on, { [CONFIG]: cfg })
  const ui = await pane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Gated patterns (3): ^a/, ^b/, ^c/' })).toBeDefined()
  await ui.press({ key: 'run' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'No harness run in this folder.' })).toBeDefined()
})

test("graph's broker dir is not a harness run", async ($, on) => {
  await seeded($, on, { '.harness-run/broker/runs/x.json': '{}', [CONFIG]: cfg })
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'run' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'No harness run in this folder.' })).toBeDefined()
})

test('subgoal files count for liveness: old top-level files, a 5 min old test file', async ($, on) => {
  const ages = oldAges(demoRun(), 3 * 3600_000)
  ages[`${RUN}/subgoals/S2/test-1.json`] = 5 * 60_000
  await seeded($, on, demoRun(), { ages })
  expect(await shown(await pane($, 'terminal'))).toContain('running')
})

test('an old unfinished run does not outrank a run finished 10 min ago', async ($, on) => {
  const old = '.harness-run/old'
  const files = demoRun({
    [`${old}/manifest.json`]: JSON.stringify({ request: 'Old work', subgoals: [{ id: 'S1', order: 1 }] }),
    [`${old}/01-plan.md`]: '# plan',
    [`${RUN}/05-report.md`]: '# report',
  })
  const ages = Object.fromEntries(Object.keys(files).map(k => [k, k.startsWith(old) ? 3 * 24 * 3600_000 : 10 * 60_000]))
  await seeded($, on, files, { ages })
  const text = await shown(await pane($, 'terminal'))
  expect(text).toContain('Build demo')
  expect(text).not.toContain('Old work')
})

test('korean: tab and rail labels come from the ko table, no English tab label', async ($, on) => {
  await seeded($, on, demoRun({ [CONFIG]: cfg }), { language: 'Korean' })
  const ui = await pane($, 'terminal')
  expect((await buttons(ui)).map(b => b.label)).toEqual(['● 실행', '단위', '게이트'])
  const text = await shown(ui)
  for (const word of ['계획', '비평', '구현/테스트']) expect(text).toContain(word)
  for (const word of ['Plan', 'SetGoal', 'Critique', 'Units']) expect(text).not.toContain(word)
})

test('/harness-gate opens the pane on the Gate tab even when a run exists', async ($, on) => {
  const seen = await seeded($, on, demoRun({ [CONFIG]: cfg }))
  await $.command.run({ command: 'harness-gate', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(seen.opened).toEqual(['harness-gate'])
  const ui = await pane($, 'terminal')
  expect(await buttons(ui)).toMatchObject([{ label: 'Run' }, { label: 'Units' }, { label: '● Gate' }])
  expect(await ui.find({ type: 'Text', text: 'Gated patterns (3): ^a/, ^b/, ^c/' })).toBeDefined()
})

test('an invalid gate config says it could not be read, not that it is missing; the reply is just the opened text', async ($, on) => {
  const seen = await seeded($, on, { [CONFIG]: '{not json' })
  const ui = await pane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Gate config .claude/harness-gate.json could not be read (invalid JSON).' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /is not in this project/ })).toBeUndefined()
  const r = await $.command.run({ command: 'harness-gate', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(JSON.stringify(r)).toContain('"pane opened"')
  expect(JSON.stringify(r)).not.toContain('harness-gate:')
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
