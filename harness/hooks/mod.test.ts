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
function world(on: On, surfaces: readonly ('terminal' | 'desktop')[], files: Files) {
  const seen = { statuses: [] as (string | undefined)[], commands: [] as string[], opened: [] as string[], reads: 0 }
  const store = new Map<string, unknown>()
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
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

test('armed: gate: armed (3 patterns); a decision file that is not JSON changes nothing', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { [CONFIG]: cfg, [DECISION]: '{"ts": 1, "tool"' })
  await start($)
  expect(lastStatus(seen)).toBe('gate: armed (3 patterns)')
})

test('a partial decision (no decision field) is ignored', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { [CONFIG]: cfg, [DECISION]: JSON.stringify({ ts: NOW, tool: 'Write', target: 'a/x.md' }) })
  await start($)
  expect(lastStatus(seen)).toBe('gate: armed (3 patterns)')
})

test('deny within 10 min: denied <target> and /harness-gate', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { [CONFIG]: cfg, [DECISION]: deny(NOW - 60_000) })
  await start($)
  expect(lastStatus(seen)).toBe('gate: denied a/x.md — /harness-gate')
})

test('deny older than 10 min: back to armed', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { [CONFIG]: cfg, [DECISION]: deny(NOW - 11 * 60_000) })
  await start($)
  expect(lastStatus(seen)).toBe('gate: armed (3 patterns)')
})

test('polls every 5 s and picks up a new deny', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { [CONFIG]: cfg }
  const seen = world(on, ['terminal'], files)
  await start($)
  expect(lastStatus(seen)).toBe('gate: armed (3 patterns)')
  files[DECISION] = deny(NOW)
  await clock.advance(5000)
  expect(lastStatus(seen)).toBe('gate: denied a/x.md — /harness-gate')
})

test('read error: no throw, status unchanged', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { [CONFIG]: cfg }
  const seen = world(on, ['terminal'], files)
  await start($)
  const n = seen.statuses.length
  files[CONFIG] = new Error('EACCES')
  await clock.advance(5000)
  expect(seen.statuses).toHaveLength(n)
  files[CONFIG] = '{not json'
  await clock.advance(5000)
  expect(seen.statuses).toHaveLength(n)
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
    expect(await ui.find({ type: 'Text', text: 'Gated patterns (3): ^a/, ^b/, ^c/' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Engagement window: 3 h' })).toBeDefined()
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

// fs.list over the file map; `ages` is how long ago a file changed (ms)
function listWorld(on: On, files: Files, ages: Record<string, number> = {}) {
  on('fs.list', (_$, e) => {
    const at = e.path.indexOf('.harness-run')
    const dir = at < 0 ? '' : e.path.slice(at).replace(/\/$/, '')
    const seen = new Map<string, { name: string; kind: string; size: number; mtimeMs: number; isLink: boolean }>()
    for (const k of Object.keys(files)) {
      if (!k.startsWith(`${dir}/`)) continue
      const rest = k.slice(dir.length + 1)
      const name = rest.split('/')[0]!
      if (seen.has(name)) continue
      const isDir = rest.includes('/')
      seen.set(name, { name, kind: isDir ? 'dir' : 'file', size: 100, mtimeMs: isDir ? 0 : NOW - (ages[k] ?? 60_000), isLink: false })
    }
    return { value: [...seen.values()] } as never
  })
}
const engineBand = (on: On) =>
  on('ui.render', (_$, e) => (e.component === 'AbovePrompt' ? { type: 'Text', children: ['engine band'] } : undefined) as never)

type Ui = Awaited<ReturnType<typeof pane>>
const band = ($: Engine) =>
  $.ui.mount({ plugin: 'harness', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80 } } as never)
const shown = async (ui: Ui) => JSON.stringify(await ui.drawn())
const buttons = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.props as { label: string; hotkey?: string })
const oldAges = (files: Files, ms: number) => Object.fromEntries(Object.keys(files).map(k => [k, ms]))

async function seeded($: Engine, on: On, files: Files, opts: { language?: string; ages?: Record<string, number>; surfaces?: readonly ('terminal' | 'desktop')[] } = {}) {
  mock.clock(on, { now: NOW })
  const seen = world(on, opts.surfaces ?? ['terminal'], files)
  listWorld(on, files, opts.ages)
  on('settings.read', () => ({ value: opts.language === undefined ? {} : { language: opts.language } }) as never)
  engineBand(on)
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
  expect(await shown(await band($))).not.toContain('harness ·')
})

test('a live run draws the band beside the engine band; the Button opens the pane on Run', async ($, on) => {
  const seen = await seeded($, on, demoRun({ [CONFIG]: cfg }))
  const ui = await band($)
  const text = await shown(ui)
  for (const word of ['harness ·', 'Gating S2', '1/3', 'engine band']) expect(text).toContain(word)
  expect((await ui.find({ key: 'run' }))?.props.label).toBe('run')
  await ui.press({ key: 'run' })
  expect(seen.opened).toEqual(['harness-gate'])
})

test('a finished run draws only the engine band', async ($, on) => {
  await seeded($, on, demoRun({ [`${RUN}/05-report.md`]: '# report' }))
  const ui = await band($)
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
})

test('a stale run (all files over 2 h old) draws only the engine band', async ($, on) => {
  await seeded($, on, demoRun(), { ages: oldAges(demoRun(), 3 * 3600_000) })
  const ui = await band($)
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
})

test('subgoal files count for liveness: old top-level files, a 5 min old test file', async ($, on) => {
  const ages = oldAges(demoRun(), 3 * 3600_000)
  ages[`${RUN}/subgoals/S2/test-1.json`] = 5 * 60_000
  await seeded($, on, demoRun(), { ages })
  expect(await shown(await band($))).toContain('harness ·')
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
  expect(await shown(await band($))).not.toContain('harness ·')
})

test('korean: tab and rail labels come from the ko table, no English tab label', async ($, on) => {
  await seeded($, on, demoRun({ [CONFIG]: cfg }), { language: 'Korean' })
  const ui = await pane($, 'terminal')
  expect((await buttons(ui)).map(b => b.label)).toEqual(['● 실행', '단위', '게이트'])
  const text = await shown(ui)
  for (const word of ['계획', '비평', '구현/테스트']) expect(text).toContain(word)
  for (const word of ['Plan', 'SetGoal', 'Critique', 'Units']) expect(text).not.toContain(word)
  expect(await shown(await band($))).toContain('1/3 완료')
})

test('the run scan never touches the status line', async ($, on) => {
  const seen = await seeded($, on, demoRun())
  expect(seen.statuses).toEqual([undefined])
  expect(seen.commands).toEqual(['harness-gate'])
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
  expect(seen.statuses).toEqual([])
  const ui = await pane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Gate config .claude/harness-gate.json could not be read (invalid JSON).' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /is not in this project/ })).toBeUndefined()
  const r = await $.command.run({ command: 'harness-gate', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)
  expect(JSON.stringify(r)).toContain('"pane opened"')
  expect(JSON.stringify(r)).not.toContain('harness-gate:')
})
