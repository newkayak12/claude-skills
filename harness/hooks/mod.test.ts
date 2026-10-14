import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { barCells } from './mod'

const CONFIG = '.claude/harness-gate.json'
const DECISION = '.claude/.harness-last-decision.json'
const NOW = 1_000_000_000
const cfg = JSON.stringify({ patterns: ['^a/', '^b/', '^c/'], window_hours: 3 })
const deny = (ts: number) => JSON.stringify({ ts, tool: 'Write', target: 'a/x.md', decision: 'deny', reason: 'gated' })

type Files = Record<string, string | Error>

// the engine resolves a relative path against the working directory
// (the longest matching key wins: the project's .claude/hooks/x and the plugin's hooks/x both end in hooks/x)
const key = (files: Files, path: string) =>
  Object.keys(files).filter(k => path.endsWith(`/${k}`)).sort((a, b) => b.length - a.length)[0]

// The engine beneath: surfaces, fs.exists/read over a file map, status, command.register, $.state, ui.open.
// dirs: a directory path suffix to its entries ([name, kind, mtimeMs]); top: git's top-level for the
// cwd (none: not a repo, so the cwd is the one tree)
type Dirs = Record<string, [string, 'dir' | 'file', number?][]>
function world(on: On, surfaces: readonly ('terminal' | 'desktop')[], files: Files, dirs: Dirs = {}, top?: string) {
  const seen = { statuses: [] as (string | undefined)[], commands: [] as string[], opened: [] as string[], openArgs: [] as any[], closed: [] as string[], panes: [] as { id: string }[], reads: 0, toasts: [] as string[], argv: [] as string[][], listed: [] as string[], outcomes: [] as any[], failSet: false }
  const store = new Map<string, unknown>()
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }) as never)
  on('process.run', (_$, e) => {
    seen.argv.push(e.argv)
    return { value: top !== undefined && e.argv.includes('--show-toplevel')
      ? { exitCode: 0, stdout: `${top}\n`, stderr: '' }
      : { exitCode: 128, stdout: '', stderr: 'not a repo' } } as never
  })
  on('fs.list', (_$, e) => {
    seen.listed.push(e.path)
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
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('ui.status', (_$, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  on('state.get', (_$, e) => ({ value: { value: store.get(e.key), version: 0 } }) as never)
  on('state.set', (_$, e) => {
    if (e.plugin === 'harness' && e.key === 'outcome') {
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
const lastStatus = (seen: { statuses: (string | undefined)[] }) => seen.statuses[seen.statuses.length - 1]

test('surfaces []: no timer, no status, /harness-status not registered', async ($, on) => {
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
  expect(seen.commands).toEqual(['harness-status'])
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

test('band bar: 1 of 4 passed fills 3 of 10 cells', () => {
  expect(barCells({ slug: 'x', stage: 'implement', passed: 1, failed: 0, total: 4 })).toEqual({ ok: 3, bad: 0, rest: 7 })
  expect(barCells({ slug: 'x', stage: 'implement', passed: 1, failed: 1, total: 4 })).toEqual({ ok: 3, bad: 3, rest: 4 })
})

test("in a repo: only this worktree's runs, never other worktrees", async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { ...runFiles }, { '.harness-run': [['a', 'dir']], '.harness-run/a': [['manifest.json', 'file']] }, '/wt/mine')
  await start($)
  expect(lastStatus(seen)).toBe('Plan(1)')
  expect(seen.argv.some(a => a.includes('worktree'))).toBe(false)
  expect(seen.listed.includes('/wt/mine/.harness-run')).toBe(true)
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

test('toast: first poll and old denies are silent; a newer deny toasts once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { [CONFIG]: cfg, [DECISION]: deny(NOW - 1000) }
  const seen = world(on, ['terminal'], files)
  await start($)
  await clock.advance(5000)
  expect(seen.toasts).toEqual([])
  files[DECISION] = deny(NOW + 1000)
  await clock.advance(5000)
  expect(seen.toasts).toEqual(["⛔ goal gate blocked Write: a/x.md — finish the harness run, don't script around it"])
  await clock.advance(5000)
  expect(seen.toasts.length).toBe(1)
})

test('toast: with teams installed too, one toast names the conflict and the route', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { [CONFIG]: cfg, '.claude/teams-dispatch.json': '{}', [DECISION]: deny(NOW - 1000) }
  const seen = world(on, ['terminal'], files)
  await start($)
  await clock.advance(5000)
  files[DECISION] = deny(NOW + 1000)
  await clock.advance(5000)
  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toContain('harness and teams gates')
  expect(seen.toasts[0]).toContain('teams:orchestrate')
})

const GATE = '.claude/hooks/goal-gate.mjs'
const STALE_TOAST = '⚠ project goal gate is out of date — run harness:update'

test('stale gate: the project copy differs from the plugin\'s, one toast at session start', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { [CONFIG]: cfg, [GATE]: 'old', 'hooks/goal-gate.mjs': 'new' })
  await start($)
  await clock.advance(20000)
  expect(seen.toasts).toEqual([STALE_TOAST])
})

test('stale gate: identical or absent project copy gives no toast', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const same = world(on, ['terminal'], { [CONFIG]: cfg, [GATE]: 'same', 'hooks/goal-gate.mjs': 'same' })
  await start($)
  await clock.advance(20000)
  expect(same.toasts).toEqual([])
})

test('stale gate: no project copy gives no toast', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { [CONFIG]: cfg, 'hooks/goal-gate.mjs': 'new' })
  await start($)
  await clock.advance(20000)
  expect(seen.toasts).toEqual([])
})

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
  $.ui.mount({ plugin: 'harness', surface, component: 'Pane', requestId: 'harness-status', props: { title: 'Harness', isFocused: false, bodyColumns: 80, placement: 'dock' } } as never)

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

const cmd = ($: Engine) => $.command.run({ command: 'harness-status', args: '', origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)

test('/harness-status answers and opens the pane; session start alone opens nothing', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { [CONFIG]: cfg })
  await start($)
  expect(seen.opened).toEqual([])
  const r = await cmd($)
  expect(seen.opened).toEqual(['harness-status'])
  expect(JSON.stringify(r)).toContain('pane opened')
})

// close: Esc (closeOnEscape on the open), q (the dismiss button), the command again
test('close 1/3: the pane is opened to close on Escape', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { [CONFIG]: cfg })
  await start($)
  await cmd($)
  expect(seen.openArgs[0]).toMatchObject({ id: 'harness-status', focus: true, closeOnEscape: true })
})

test('close 2/3: the q button dismisses the pane', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { [CONFIG]: cfg })
  await start($)
  const ui = await pane($, 'terminal')
  expect((await ui.find({ key: 'close' }))?.props).toMatchObject({ role: 'dismiss', hotkey: 'q' })
  await ui.press({ key: 'close' })
  expect(seen.closed).toEqual(['harness-status'])
})

test('close 3/3: the command again closes an open pane, a third time opens it', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { [CONFIG]: cfg })
  await start($)
  await cmd($)
  const r = JSON.stringify(await cmd($))
  expect(seen.closed).toEqual(['harness-status'])
  expect(r).toContain('pane closed')
  await cmd($)
  expect(seen.opened).toEqual(['harness-status', 'harness-status'])
})

test('the old command name is gone', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { [CONFIG]: cfg })
  await start($)
  expect(seen.commands).not.toContain('harness-gate')
})

// ---- run view: Flow / Detail tabs and the band ----
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
// the tabs; the close button (hotkey q) is tested apart
const buttons = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.props as { label: string; hotkey?: string }).filter(b => b.hotkey !== 'q')
const oldAges = (files: Files, ms: number) => Object.fromEntries(Object.keys(files).map(k => [k, ms]))

async function seeded($: Engine, on: On, files: Files, opts: { language?: string; ages?: Record<string, number>; surfaces?: readonly ('terminal' | 'desktop')[] } = {}) {
  mock.clock(on, { now: NOW })
  const seen = world(on, opts.surfaces ?? ['terminal'], files, dirsOf(files, opts.ages))
  on('settings.read', () => ({ value: opts.language === undefined ? {} : { language: opts.language } }) as never)
  await start($)
  return seen
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: Flow tab: tabs with hotkeys, rail, Now with no agent, a line per subgoal and the 1/3 bar`, async ($, on) => {
    await seeded($, on, demoRun(), { surfaces: [surface] })
    const ui = await pane($, surface)
    expect(await buttons(ui)).toMatchObject([
      { label: '● Flow', hotkey: '1' },
      { label: 'Detail', hotkey: '2' },
    ])
    for (const word of ['● Plan', '● SetGoal', '● Critique', '◉ Implement/Test', '○ Gate', '○ Report']) {
      expect(await ui.find({ type: 'Text', text: word })).toBeDefined()
    }
    // no vendor is recorded: the agent reads —; elapsed is the time since the run's newest file changed
    expect(await ui.find({ type: 'Text', text: '▶ Now · Gating S2: second · — · 1m 0s' })).toBeDefined()
    const text = await shown(ui)
    expect(text).toContain('Build demo')
    for (const mark of ['"✔"', '"●"', '"○"', ' S1 first', ' S2 second', ' S3 third']) expect(text).toContain(mark)
    expect(text.indexOf(' S1 first')).toBeLessThan(text.indexOf(' S2 second'))
    expect(text.indexOf(' S2 second')).toBeLessThan(text.indexOf(' S3 third'))
    expect(await ui.find({ type: 'Text', text: /1\/3/ })).toBeDefined()
  })
}

test('narrow pane: tab labels stay Flow / Detail, the tab row does not shrink, the slug is on the title line', async ($, on) => {
  await seeded($, on, demoRun())
  const ui = await $.ui.mount({ plugin: 'harness', surface: 'terminal', component: 'Pane', requestId: 'harness-status', props: { title: 'Harness', isFocused: false, bodyColumns: 40, placement: 'dock' } } as never)
  expect((await buttons(ui)).map(b => b.label)).toEqual(['● Flow', 'Detail'])
  const text = await shown(ui)
  // tabs sit in a flexShrink 0 box, followed by the close button in its own box
  expect(text).toContain('{"type":"Box","props":{"flexShrink":0},"children":[{"type":"Box","props":{"columnGap":3}')
  expect(text).toContain('{"type":"Text","props":{"dimColor":true,"wrap":"truncate-end"},"children":["demo"]}')
  // the slug is not in the tab row any more
  expect(text.indexOf('"demo"')).toBeLessThan(text.indexOf('"key":"flow"'))
})

test('goal gate result shows the percentage bar', async ($, on) => {
  await seeded($, on, demoRun({ [`${RUN}/04-goal-gate.json`]: JSON.stringify({ match_pct: 92, pass: true }) }))
  expect(await (await pane($, 'terminal')).find({ type: 'Text', text: /92%/ })).toBeDefined()
})

// S2 rejected twice by its gate, passed on the third try; S1 passed first time
const retriedRun = (over: Files = {}) => demoRun({
  [`${RUN}/subgoals/S2/gate-1.json`]: JSON.stringify({ pass: false, reason: 'tests red', gaps: ['no case for empty input'] }),
  [`${RUN}/subgoals/S2/gate-2.json`]: JSON.stringify({ pass: false, reason: 'still red' }),
  [`${RUN}/subgoals/S2/gate-3.json`]: JSON.stringify({ pass: true, reason: 'ok' }),
  [`${RUN}/subgoals/S2/result.json`]: JSON.stringify({ id: 'S2', passed: true, attempts: 3 }),
  ...over,
})

test('Flow: a rejected gate attempt shows its reason and the retry nested under it', async ($, on) => {
  await seeded($, on, retriedRun())
  const text = await shown(await pane($, 'terminal'))
  const at = (s: string) => text.indexOf(s)
  expect(at(' attempt 1')).toBeLessThan(at('↳ tests red; no case for empty input'))
  expect(at('↳ tests red; no case for empty input')).toBeLessThan(at(' attempt 2'))
  expect(at(' attempt 2')).toBeLessThan(at('↳ still red'))
  expect(at('↳ still red')).toBeLessThan(at(' attempt 3'))
  expect(text).not.toContain('↳ ok')
})

test('Flow: a rejected critique keeps its reason, a rejected goal gate too', async ($, on) => {
  await seeded($, on, demoRun({
    [`${RUN}/02-critique.json`]: JSON.stringify({ sound: false, problems: ['AC-2 has no check', 'S3 too big'], blocking: ['no test plan'] }),
  }))
  let text = await shown(await pane($, 'terminal'))
  expect(text).toContain('↳ no test plan; AC-2 has no check; S3 too big')
  expect(text).toContain('"✘"')
})

test('Flow: a failing goal gate shows its reason', async ($, on) => {
  await seeded($, on, retriedRun({ [`${RUN}/04-goal-gate.json`]: JSON.stringify({ match_pct: 70, pass: false, reason: 'AC-2 not met' }) }))
  expect(await shown(await pane($, 'terminal'))).toContain('↳ AC-2 not met')
})

test('Detail: per subgoal the result and every gate verdict; the gate rules folded under it', async ($, on) => {
  await seeded($, on, retriedRun({ [CONFIG]: cfg }))
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'detail' })
  await ui.redraw() // the stubbed $.state does not notify readers
  const text = await shown(ui)
  for (const word of ['passed · 3 tries', 'gate 1: rejected — tests red; no case for empty input', 'gate 2: rejected — still red', 'gate 3: passed', 'Gate rules']) {
    expect(text).toContain(word)
  }
  expect(text).not.toContain('To do')
  expect(await ui.find({ type: 'Text', text: 'Gated patterns (3): ^a/, ^b/, ^c/' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Engagement window: 3 h' })).toBeDefined()
})

test('Detail: a failed subgoal with a stalled retry says so', async ($, on) => {
  await seeded($, on, demoRun({
    [`${RUN}/subgoals/S2/gate-1.json`]: JSON.stringify({ pass: false, reason: 'tests red' }),
    [`${RUN}/subgoals/S2/result.json`]: JSON.stringify({ id: 'S2', passed: false, attempts: 1, stalled: true }),
  }))
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'detail' })
  await ui.redraw()
  const text = await shown(ui)
  for (const word of ['failed · 1 tries', 'stalled: the retry changed nothing', 'gate 1: rejected — tests red']) expect(text).toContain(word)
})

test('no run folder: the Detail tab by default (gate rules), the no-run sentence on Flow', async ($, on) => {
  await seeded($, on, { [CONFIG]: cfg })
  const ui = await pane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Gated patterns (3): ^a/, ^b/, ^c/' })).toBeDefined()
  await ui.press({ key: 'flow' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'No harness run in this folder.' })).toBeDefined()
})

test("graph's broker dir is not a harness run", async ($, on) => {
  await seeded($, on, { '.harness-run/broker/runs/x.json': '{}', [CONFIG]: cfg })
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'flow' })
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
  expect((await buttons(ui)).map(b => b.label)).toEqual(['● 흐름', '상세'])
  const text = await shown(ui)
  for (const word of ['계획', '비평', '구현/테스트', '닫기 [q]']) expect(text).toContain(word)
  for (const word of ['Plan', 'SetGoal', 'Critique', 'Detail', 'close [']) expect(text).not.toContain(word)
  await ui.press({ key: 'detail' })
  await ui.redraw()
  const detail = await shown(ui)
  for (const word of ['아직 판정 전', '게이트 규칙']) expect(detail).toContain(word)
  for (const word of ['not judged', 'Gate rules', 'passed']) expect(detail).not.toContain(word)
})

test('/harness-status opens the pane on the Detail tab even when a run exists', async ($, on) => {
  const seen = await seeded($, on, demoRun({ [CONFIG]: cfg }))
  await cmd($)
  expect(seen.opened).toEqual(['harness-status'])
  const ui = await pane($, 'terminal')
  expect(await buttons(ui)).toMatchObject([{ label: 'Flow' }, { label: '● Detail' }])
  expect(await ui.find({ type: 'Text', text: 'Gated patterns (3): ^a/, ^b/, ^c/' })).toBeDefined()
})

test('an invalid gate config says it could not be read, not that it is missing; the reply is just the opened text', async ($, on) => {
  const seen = await seeded($, on, { [CONFIG]: '{not json' })
  const ui = await pane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Gate config .claude/harness-gate.json could not be read (invalid JSON).' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /is not in this project/ })).toBeUndefined()
  const r = await cmd($)
  expect(JSON.stringify(r)).toContain('"pane opened"')
  expect(JSON.stringify(r)).not.toContain('harness-status:')
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

// gate deny push: PushNotification's result is { message, pushSent?, localSent?, disabledReason? }
const pushWorld = (on: On, files: Files, push: (e: any) => unknown) => {
  const pushes = [] as any[]
  const w = world(on, ['terminal'], files)
  on('tool.call', (_$, e: any) => {
    pushes.push(e)
    return push(e) as never
  })
  return { pushes, toasts: w.toasts, w }
}
const sent = () => ({ result: { message: 'm', pushSent: true, localSent: true }, text: '' })
const LINE = "⛔ goal gate blocked Write: a/x.md — finish the harness run, don't script around it"

test('a deny newer than the session start is pushed once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { [CONFIG]: cfg }
  const seen = pushWorld(on, files, sent)
  await start($)
  files[DECISION] = deny(NOW + 1000)
  await clock.advance(5000)
  await clock.advance(5000)
  expect(seen.pushes.map(p => [p.tool, p.message, p.status])).toEqual([['PushNotification', LINE, 'proactive']])
  expect(seen.toasts).toEqual([])
})

test('a deny from before the session start is not pushed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const seen = pushWorld(on, { [CONFIG]: cfg, [DECISION]: deny(NOW - 60_000) }, sent)
  await start($)
  await clock.advance(5000)
  expect(seen.pushes).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('the same path within 10 minutes is not pushed again; after 10 it is', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { [CONFIG]: cfg }
  const seen = pushWorld(on, files, sent)
  await start($)
  files[DECISION] = deny(NOW + 1000)
  await clock.advance(5000)
  files[DECISION] = deny(NOW + 60_000)
  await clock.advance(60_000)
  expect(seen.pushes.length).toBe(1)
  await clock.advance(11 * 60_000)
  files[DECISION] = deny(NOW + 11 * 60_000 + 65_000)
  await clock.advance(5000)
  expect(seen.pushes.length).toBe(2)
})

test('not sent (user at the terminal): the same line is a toast', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { [CONFIG]: cfg }
  const seen = pushWorld(on, files, () => ({ result: { message: 'm', pushSent: false, localSent: false, disabledReason: 'user_present' }, text: '' }))
  await start($)
  files[DECISION] = deny(NOW + 1000)
  await clock.advance(5000)
  expect(seen.toasts).toEqual([LINE])
})

test('push throws: toast, no crash, the tick keeps running', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { [CONFIG]: cfg }
  const seen = pushWorld(on, files, () => {
    throw new Error('no tool')
  })
  await start($)
  files[DECISION] = deny(NOW + 1000)
  await clock.advance(5000)
  expect(seen.toasts).toEqual([LINE])
  await clock.advance(5000)
  expect(seen.w.statuses.length).toBeGreaterThan(1)
})

// run events: reject / failed / complete, read from run files written after the session started
const NEW = NOW + 1000
const gj = (o: object) => JSON.stringify(o)
const runWorld = (on: On, files: Files, dirs: Dirs, push: (e: any) => unknown = sent) => {
  const pushes = [] as any[]
  const w = world(on, ['terminal'], files, dirs)
  on('tool.call', (_$, e: any) => {
    pushes.push(e)
    return push(e) as never
  })
  return { pushes, toasts: w.toasts, statuses: w.statuses, outcomes: w.outcomes, w }
}
const msgs = (s: { pushes: any[] }) => s.pushes.map(p => p.message)
const R = '.harness-run/r'
type Ents = [string, 'dir' | 'file', number?][]
const OLD_MF: Ents = [['manifest.json', 'file', NOW - 5000]]
const rdirs = (run: Ents = OLD_MF, extra: Dirs = {}): Dirs => ({ '.harness-run': [['r', 'dir']], [R]: run, ...extra })

test('critique sound:false pushes a reject once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { 'r/manifest.json': gj({ max_retries: 2 }), 'r/02-critique.json': gj({ sound: false }) }
  const dirs = rdirs()
  const seen = runWorld(on, files, dirs)
  await start($)
  dirs[R] = [...OLD_MF, ['02-critique.json', 'file', NEW]]
  await clock.advance(5000)
  await clock.advance(5000)
  expect(msgs(seen)).toEqual(['harness r: rejected — Critique (1/2)'])
})

test('a failing subgoal gate pushes a reject with attempt/max; a pass does not', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = {
    'r/manifest.json': gj({ max_retries: 3 }),
    'r/subgoals/s1/gate-1.json': gj({ pass: false }),
    'r/subgoals/s1/gate-2.json': gj({ pass: true }),
  }
  const dirs = rdirs(OLD_MF, { [`${R}/subgoals`]: [['s1', 'dir']], [`${R}/subgoals/s1`]: [['gate-1.json', 'file', NEW], ['gate-2.json', 'file', NEW]] })
  const seen = runWorld(on, files, dirs)
  await start($)
  await clock.advance(5000)
  expect(msgs(seen)).toEqual(['harness r: rejected — QualityGate s1 (1/3)'])
})

test('retries spent pushes failed; a goal gate under 90 is a reject, then failed once reported', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = {
    'r/manifest.json': gj({}),
    'r/subgoals/s1/result.json': gj({ passed: false, attempts: 2 }),
    'r/04-goal-gate.json': gj({ match_pct: 70, pass: false, reason: 'x' }),
  }
  const dirs = rdirs([...OLD_MF, ['04-goal-gate.json', 'file', NEW]], { [`${R}/subgoals`]: [['s1', 'dir']], [`${R}/subgoals/s1`]: [['result.json', 'file', NEW]] })
  const seen = runWorld(on, files, dirs)
  await start($)
  await clock.advance(5000)
  expect(msgs(seen)).toEqual(['harness r: failed — subgoal s1 (2/2)', 'harness r: rejected — goal gate (1/2)'])
  dirs[R] = [...dirs[R], ['05-report.md', 'file', NEW + 5000]]
  await clock.advance(5000)
  expect(msgs(seen).slice(2)).toEqual(['harness r: failed — goal gate (1/2)'])
})

test('a run with a report and no failure pushes complete once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { 'r/manifest.json': gj({}), 'r/04-goal-gate.json': gj({ match_pct: 95, pass: true }), 'r/subgoals/s1/result.json': gj({ passed: true, attempts: 1 }) }
  const dirs = rdirs([...OLD_MF, ['04-goal-gate.json', 'file', NEW], ['05-report.md', 'file', NEW]], { [`${R}/subgoals`]: [['s1', 'dir']], [`${R}/subgoals/s1`]: [['result.json', 'file', NEW]] })
  const seen = runWorld(on, files, dirs)
  await start($)
  await clock.advance(5000)
  await clock.advance(5000)
  expect(msgs(seen)).toEqual(['harness r: complete — Report (1/1)'])
})

test('a finished graph run is left to the graph mod: no harness push', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { 'g2.json': gj({ request: 'ship it', nodes: [{ stage: 'report', state: 'done' }] }) }
  const dirs: Dirs = { '.harness-run': [['broker', 'dir']], ['.harness-run/' + 'broker/runs']: [['g2.json', 'file', NEW]] }
  const seen = runWorld(on, files, dirs)
  await start($)
  await clock.advance(5000)
  expect(msgs(seen)).toEqual([])
})

test('run events from before the session started are not pushed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { 'r/manifest.json': gj({}), 'r/02-critique.json': gj({ sound: false }), 'r/05-report.md': 'x' }
  const old = NOW - 60_000
  const seen = runWorld(on, files, rdirs([['manifest.json', 'file', old], ['02-critique.json', 'file', old], ['05-report.md', 'file', old]]))
  await start($)
  await clock.advance(5000)
  expect(seen.pushes).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('run event not sent: toast; push throws: toast and the tick keeps running', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { 'r/manifest.json': gj({}), 'r/02-critique.json': gj({ sound: false }) }
  const dirs = rdirs([...OLD_MF, ['02-critique.json', 'file', NEW]])
  let n = 0
  const seen = runWorld(on, files, dirs, () => {
    if (n++ === 0) return { result: { message: 'm', pushSent: false, localSent: false, disabledReason: 'user_present' }, text: '' }
    throw new Error('no tool')
  })
  await start($)
  expect(seen.toasts).toEqual(['harness r: rejected — Critique (1/2)'])
  dirs[R] = [...OLD_MF, ['02-critique.json', 'file', NEW + 9000]]
  await clock.advance(5000)
  expect(seen.toasts.slice(1)).toEqual(['harness r: rejected — Critique (2/2)'])
})

// the run outcome harness publishes for trophy: carried by the event, never parsed from the message
const labels = (s: { outcomes: any[] }) => s.outcomes.map(o => o.outcome)
const reported = (extra: Ents = [], dirs: Dirs = {}) => rdirs([...OLD_MF, ['05-report.md', 'file', NEW], ...extra], dirs)

test('outcome: Report complete publishes pass, with exactly system, outcome and at', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { 'r/manifest.json': gj({}), 'r/04-goal-gate.json': gj({ match_pct: 95, pass: true }) }
  const seen = runWorld(on, files, reported([['04-goal-gate.json', 'file', NEW]]))
  await start($)
  await clock.advance(5000)
  await clock.advance(5000)
  expect(labels(seen)).toEqual(['pass'])
  expect(Object.keys(seen.outcomes[0]).sort()).toEqual(['at', 'outcome', 'system'])
  expect(seen.outcomes[0].system).toBe('harness')
})

test('outcome: a goal gate that failed after the report publishes reject', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { 'r/manifest.json': gj({}), 'r/04-goal-gate.json': gj({ match_pct: 70, pass: false }) }
  const seen = runWorld(on, files, reported([['04-goal-gate.json', 'file', NEW]]))
  await start($)
  await clock.advance(5000)
  expect(labels(seen)).toEqual(['reject'])
})

test('outcome: a goal gate under 90 before the report is only a rejected attempt: no outcome', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { 'r/manifest.json': gj({}), 'r/04-goal-gate.json': gj({ match_pct: 70, pass: false }) }
  const seen = runWorld(on, files, rdirs([...OLD_MF, ['04-goal-gate.json', 'file', NEW]]))
  await start($)
  await clock.advance(5000)
  expect(msgs(seen)).toEqual(['harness r: rejected — goal gate (1/2)'])
  expect(seen.outcomes).toEqual([])
})

test('outcome: retries spent publishes fail; two failed subgoals publish fail once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = {
    'r/manifest.json': gj({}),
    'r/subgoals/s1/result.json': gj({ passed: false, attempts: 2 }),
    'r/subgoals/s2/result.json': gj({ passed: false, attempts: 2 }),
  }
  const dirs = rdirs(OLD_MF, {
    [`${R}/subgoals`]: [['s1', 'dir'], ['s2', 'dir']],
    [`${R}/subgoals/s1`]: [['result.json', 'file', NEW]],
    [`${R}/subgoals/s2`]: [['result.json', 'file', NEW]],
  })
  const seen = runWorld(on, files, dirs)
  await start($)
  await clock.advance(5000)
  await clock.advance(5000)
  expect(msgs(seen)).toEqual(['harness r: failed — subgoal s1 (2/2)', 'harness r: failed — subgoal s2 (2/2)'])
  expect(labels(seen)).toEqual(['fail'])
})

test('outcome: a critique or subgoal gate rejection publishes nothing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = {
    'r/manifest.json': gj({ max_retries: 3 }),
    'r/02-critique.json': gj({ sound: false }),
    'r/subgoals/s1/gate-1.json': gj({ pass: false }),
  }
  const dirs = rdirs([...OLD_MF, ['02-critique.json', 'file', NEW]], { [`${R}/subgoals`]: [['s1', 'dir']], [`${R}/subgoals/s1`]: [['gate-1.json', 'file', NEW]] })
  const seen = runWorld(on, files, dirs)
  await start($)
  await clock.advance(5000)
  expect(seen.pushes).toHaveLength(2)
  expect(seen.outcomes).toEqual([])
})

test('outcome: a run finished before the session started and a graph run publish nothing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const old = NOW - 60_000
  const files: Files = { 'r/manifest.json': gj({}), 'r/05-report.md': 'x', 'g2.json': gj({ request: 'ship it', nodes: [{ stage: 'report', state: 'done' }] }) }
  const dirs: Dirs = { '.harness-run': [['r', 'dir'], ['broker', 'dir']], [R]: [['manifest.json', 'file', old], ['05-report.md', 'file', old]], '.harness-run/broker/runs': [['g2.json', 'file', NEW]] }
  const seen = runWorld(on, files, dirs)
  await start($)
  await clock.advance(5000)
  expect(seen.outcomes).toEqual([])
})

test('outcome: a failing state write never breaks the push', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const files: Files = { 'r/manifest.json': gj({}), 'r/04-goal-gate.json': gj({ match_pct: 95, pass: true }) }
  const seen = runWorld(on, files, reported([['04-goal-gate.json', 'file', NEW]]))
  seen.w.failSet = true
  await start($)
  await clock.advance(5000)
  expect(msgs(seen)).toEqual(['harness r: complete — Report (1/1)'])
  expect(seen.outcomes).toEqual([])
})
