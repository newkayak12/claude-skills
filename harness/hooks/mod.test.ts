import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DEMO_NOW, DEMO_SCENARIOS, bandLines, demoRows, plain, renderDemo } from './harness-draw'
import { register } from './mod'
import { openingOrder } from './status'

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
// `fallback-check --list --json`, as the test sets it: what it prints, its exit code, or that it throws (a timeout)
type Listing = { stdout: string; exitCode: number; throws: boolean; calls: string[][] }
function world(on: On, surfaces: readonly ('terminal' | 'desktop')[], files: Files, dirs: Dirs = {}, top?: string) {
  const listing: Listing = { stdout: '[]', exitCode: 0, throws: false, calls: [] }
  const seen = { statuses: [] as (string | undefined)[], commands: [] as string[], opened: [] as string[], openArgs: [] as any[], closed: [] as string[], panes: [] as { id: string }[], reads: 0, toasts: [] as string[], argv: [] as string[][], listed: [] as string[], outcomes: [] as any[], failSet: false, listing, store: new Map<string, unknown>(), commandArgs: [] as any[] }
  const store = seen.store
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }) as never)
  on('process.run', (_$, e) => {
    if (e.argv.includes('--list')) {
      listing.calls.push(e.argv)
      if (listing.throws) throw new Error('timed out')
      return { value: { exitCode: listing.exitCode, stdout: listing.stdout, stderr: '' } } as never
    }
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
    seen.commandArgs.push(e)
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

// one row as `fallback-check --list --json` prints it
const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString()
const nowJson = (o: object = {}) => ({
  stage: 'implement', doing: 'Subgoal s2 is being built', round: null, last_step: 'ran the tests', next: 'its gate judges s2', waiting: null,
  cost_usd: null, at: iso(12_000), since: iso(6 * 60_000), ...o,
})
const rowJson = (slug: string, o: object = {}) => ({
  slug, dir: `/proj/.harness-run/${slug}`, stage: 'implement', round: null, waiting: null, stalled: false, now: null, started_at: null,
  max_critique_rounds: 3, severity: { blocker: 0, major: 0, minor: 0, nit: 0 }, rounds: [], passed: 0, failed: 0, total: 0, ...o,
})
const acting = (slug: string, o: object = {}) => rowJson(slug, { now: nowJson(), ...o })
const youWait = { who: 'you', what: 'approve the goal spec' }
const waiting = (slug: string) => rowJson(slug, { stage: 'setgoal', waiting: youWait, now: nowJson({ stage: 'setgoal', doing: 'SetGoal waits for approval', waiting: youWait }) })
const list = (rows: object[]) => JSON.stringify(rows)

const start = ($: Engine) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
const lastStatus = (seen: { statuses: (string | undefined)[] }) => seen.statuses[seen.statuses.length - 1]

test('surfaces []: no timer, no status, /harness-status not registered', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, [], { [CONFIG]: cfg })
  seen.listing.stdout = list([acting('a')])
  await start($)
  await clock.advance(20000)
  expect(seen.reads).toBe(0)
  expect(seen.statuses).toEqual([])
  expect(seen.commands).toEqual([])
  // no list read, no spinner frame, no band
  expect(seen.listing.calls).toEqual([])
  expect(seen.store.get('tick')).toBeUndefined()
  expect(seen.store.get('rows')).toBeUndefined()
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

const pane = ($: Engine, surface: 'terminal' | 'desktop', bodyColumns = 80) =>
  $.ui.mount({ plugin: 'harness', surface, component: 'Pane', requestId: 'harness-status', props: { title: 'Harness', isFocused: false, bodyColumns, placement: 'dock' } } as never)

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: pane with no config says so`, async ($, on) => {
    mock.clock(on, { now: NOW })
    world(on, [surface], {})
    await start($)
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
// the four tabs (hotkeys 1-4); the close button (q) and the run keys (the card's [ and ] are p and n) are tested apart
const buttons = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.props as { label: string; hotkey?: string }).filter(b => /^[1-4]$/.test(b.hotkey ?? ''))

// The test's drawing, read as a person reads it: a `Text` whose children are `Text` segments is one line.
type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const flat = (n: unknown): string => (typeof n === 'string' ? n : (((n as Node).children ?? []) as unknown[]).map(flat).join(''))
const linesOf = (tree: unknown): string[] => {
  const out: string[] = []
  const walk = (n: unknown) => {
    if (typeof n === 'string' || n === null || typeof n !== 'object') return
    const node = n as Node
    if (node.type === 'Text') out.push(flat(node))
    else (node.children ?? []).forEach(walk)
  }
  walk(tree)
  return out
}
const textOf = async (ui: Ui) => linesOf(await ui.drawn()).join('\n')

// rows: what `fallback-check --list --json` prints; the default is one open run, `demo`, whose files are `files`
async function seeded($: Engine, on: On, files: Files, opts: { language?: string; surfaces?: readonly ('terminal' | 'desktop')[]; rows?: object[] } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const seen = Object.assign(world(on, opts.surfaces ?? ['terminal'], files, dirsOf(files)), { clock })
  seen.listing.stdout = list(opts.rows ?? [acting('demo', { passed: 1, total: 3 })])
  on('settings.read', () => ({ value: opts.language === undefined ? {} : { language: opts.language } }) as never)
  await start($)
  return seen
}

const csvRounds = [{
  round: 1, file: '02-critique.r1.json', sound: false,
  problems: [
    { severity: 'major', text: '"export button" has no check that a file downloads' },
    { severity: 'major', text: 'the large-report subgoal edits the auth middleware' },
    { severity: 'nit', text: 'subgoal titles mix verbs and nouns' },
    { severity: 'major', text: 'no subgoal covers an empty report' },
    { severity: 'major', text: 'the goal spec names no column order' },
  ],
}]
const csv = (o: object = {}) => rowJson('demo', {
  stage: 'setgoal', round: 2, started_at: iso(72 * 60_000), total: 3, rounds: csvRounds, severity: { blocker: 0, major: 4, minor: 0, nit: 1 },
  now: nowJson({
    stage: 'setgoal', round: 2, cost_usd: 3.4, doing: 'SetGoal is rewriting the spec after critique round 1 rejected it',
    last_step: 'edited the goal spec — split "export button" into two subgoals', next: 'critique round 2 judges the new spec',
  }),
  ...o,
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: Now tab: tabs 1-4, Now with doing, round n of max and time in stage, last step with age, You, the rail with its loop`, async ($, on) => {
    await seeded($, on, demoRun(), { surfaces: [surface], rows: [csv()] })
    const ui = await pane($, surface, 194)
    expect(await buttons(ui)).toMatchObject([
      { label: '● Now', hotkey: '1' },
      { label: 'Flow', hotkey: '2' },
      { label: 'Findings', hotkey: '3' },
      { label: 'Gate rules', hotkey: '4' },
    ])
    const text = await textOf(ui)
    expect(text).toContain('SetGoal is rewriting the spec after critique round 1 rejected it')
    expect(text).toContain('round 2 of 3 · 6m in this stage')
    expect(text).toContain('last step: edited the goal spec — split "export button" into two subgoals')
    expect(text).toContain('12s ago')
    expect(text).toContain('nothing needed · next: critique round 2 judges the new spec')
    expect(text).toContain('✔ Plan ━━ ✔ SetGoal ━━ ✘ Critique ━━ ● SetGoal again ┄┄ ○ Critique ┄┄ ○ Subgoals 0/3 ┄┄ ○ Goal gate ┄┄ ○ Report')
    expect(text).toContain('running · 1h 12m · $3.40')
    // the latest round, by severity
    expect(text).toContain('Critique round 1 · rejected · 4 major, 1 nit')
    expect(text).toMatch(/major\s+"export button" has no check/)
  })
}

test('You line: waiting.what with ⚑ when the run waits on you', async ($, on) => {
  await seeded($, on, {}, { rows: [waiting('demo')] })
  const text = await textOf(await pane($, 'terminal', 194))
  expect(text).toContain('⚑ You   approve the goal spec')
  expect(text).not.toContain('nothing needed')
  expect(text).toContain('waiting on you')
  expect(text).toContain('◌ Now')
})

test('Now line: a spinner glyph while the run acts, ◌ when it does not', async ($, on) => {
  await seeded($, on, {}, { rows: [acting('demo')] })
  expect(await textOf(await pane($, 'terminal', 194))).toMatch(/[✎⌕▸] Now   Subgoal s2 is being built/)
})

test('Findings tab: the node rollup over every round', async ($, on) => {
  await seeded($, on, {}, { rows: [csv()] })
  const ui = await pane($, 'terminal', 194)
  await ui.press({ key: 'findings' })
  await ui.redraw() // the stubbed $.state does not notify readers
  const text = await textOf(ui)
  expect(text).toContain('All rounds · 4 major, 1 nit')
  expect(text).toContain('Critique round 1 · rejected · 4 major, 1 nit')
  expect((await buttons(ui))[2]).toMatchObject({ label: '● Findings' })
})

test('narrow pane: the tab row stays one row of Buttons with the short labels, nothing wraps past the width', async ($, on) => {
  await seeded($, on, demoRun(), { rows: [csv()] })
  const ui = await pane($, 'terminal', 44)
  expect((await buttons(ui)).map(b => b.label)).toEqual(['● Now', 'Flow', 'Findings', 'Rules'])
  expect(await shown(ui)).toContain('{"type":"Box","props":{"flexShrink":0},"children":[{"type":"Box","props":{"columnGap":3}')
  // every line the drawing makes is cut to the inside of the frame (44 less border and padding)
  for (const l of linesOf(await ui.drawn())) expect([l, Array.from(l).length <= 40]).toEqual([l, true])
})

test('Flow tab: a line per subgoal from the run files, and the 1/3 bar', async ($, on) => {
  await seeded($, on, demoRun(), { rows: [acting('demo', { total: 3, passed: 1 })] })
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'flow' })
  await ui.redraw()
  const text = await shown(ui)
  for (const mark of ['"✔"', '"●"', '"○"', ' S1 first', ' S2 second', ' S3 third']) expect(text).toContain(mark)
  expect(text.indexOf(' S1 first')).toBeLessThan(text.indexOf(' S2 second'))
  expect(text.indexOf(' S2 second')).toBeLessThan(text.indexOf(' S3 third'))
  expect(await ui.find({ type: 'Text', text: /1\/3/ })).toBeDefined()
})

test('Flow tab: the run the pane shows decides whose files it reads', async ($, on) => {
  const other = '.harness-run/other'
  const files = demoRun({ [`${other}/manifest.json`]: manifestJson, [`${other}/01-plan.md`]: '# plan', [`${other}/02-goal-spec.json`]: JSON.stringify({ subgoals: [{ id: 'X1', title: 'only here' }] }) })
  await seeded($, on, files, { rows: [acting('demo'), acting('other')] })
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'next' })
  await ui.press({ key: 'flow' })
  await ui.redraw()
  const text = await shown(ui)
  expect(text).toContain('only here')
  expect(text).not.toContain(' S1 first')
})

test('goal gate result shows the percentage bar', async ($, on) => {
  await seeded($, on, demoRun({ [`${RUN}/04-goal-gate.json`]: JSON.stringify({ match_pct: 92, pass: true }) }))
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'flow' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /92%/ })).toBeDefined()
})

// S2 rejected twice by its gate, passed on the third try; S1 passed first time
const retriedRun = (over: Files = {}) => demoRun({
  [`${RUN}/subgoals/S2/gate-1.json`]: JSON.stringify({ pass: false, reason: 'tests red', gaps: ['no case for empty input'] }),
  [`${RUN}/subgoals/S2/gate-2.json`]: JSON.stringify({ pass: false, reason: 'still red' }),
  [`${RUN}/subgoals/S2/gate-3.json`]: JSON.stringify({ pass: true, reason: 'ok' }),
  [`${RUN}/subgoals/S2/result.json`]: JSON.stringify({ id: 'S2', passed: true, attempts: 3 }),
  ...over,
})

// the Flow tab (2) or the Gate rules tab (4) of the pane, drawn
const tabbed = async ($: Engine, tab: 'flow' | 'rules') => {
  const ui = await pane($, 'terminal')
  await ui.press({ key: tab })
  await ui.redraw()
  return ui
}

test('Flow: a rejected gate attempt shows its reason and the retry nested under it', async ($, on) => {
  await seeded($, on, retriedRun())
  const text = await shown(await tabbed($, 'flow'))
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
  const text = await shown(await tabbed($, 'flow'))
  expect(text).toContain('↳ no test plan; AC-2 has no check; S3 too big')
  expect(text).toContain('"✘"')
})

test('Flow: a failing goal gate shows its reason', async ($, on) => {
  await seeded($, on, retriedRun({ [`${RUN}/04-goal-gate.json`]: JSON.stringify({ match_pct: 70, pass: false, reason: 'AC-2 not met' }) }))
  expect(await shown(await tabbed($, 'flow'))).toContain('↳ AC-2 not met')
})

test('Gate rules: per subgoal the result and every gate verdict; the gate rules folded under it', async ($, on) => {
  await seeded($, on, retriedRun({ [CONFIG]: cfg }))
  const ui = await tabbed($, 'rules') // the stubbed $.state does not notify readers: tabbed redraws
  const text = await shown(ui)
  for (const word of ['passed · 3 tries', 'gate 1: rejected — tests red; no case for empty input', 'gate 2: rejected — still red', 'gate 3: passed', 'Gate rules']) {
    expect(text).toContain(word)
  }
  expect(text).not.toContain('To do')
  expect(await ui.find({ type: 'Text', text: 'Gated patterns (3): ^a/, ^b/, ^c/' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Engagement window: 3 h' })).toBeDefined()
})

test('Gate rules: a failed subgoal with a stalled retry says so', async ($, on) => {
  await seeded($, on, demoRun({
    [`${RUN}/subgoals/S2/gate-1.json`]: JSON.stringify({ pass: false, reason: 'tests red' }),
    [`${RUN}/subgoals/S2/result.json`]: JSON.stringify({ id: 'S2', passed: false, attempts: 1, stalled: true }),
  }))
  const text = await shown(await tabbed($, 'rules'))
  for (const word of ['failed · 1 tries', 'stalled: the retry changed nothing', 'gate 1: rejected — tests red']) expect(text).toContain(word)
})

test('no open run: the Gate rules tab by default, the no-run sentence on Flow', async ($, on) => {
  await seeded($, on, { [CONFIG]: cfg }, { rows: [] })
  const ui = await pane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Gated patterns (3): ^a/, ^b/, ^c/' })).toBeDefined()
  await ui.press({ key: 'flow' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'No harness run in this folder.' })).toBeDefined()
})

test("graph's broker dir is not a harness run", async ($, on) => {
  await seeded($, on, { '.harness-run/broker/runs/x.json': '{}', [CONFIG]: cfg }, { rows: [] })
  const ui = await pane($, 'terminal')
  await ui.press({ key: 'flow' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'No harness run in this folder.' })).toBeDefined()
})

test('a stalled run says stalled, a run that waits on you says so; the node decides which runs are open', async ($, on) => {
  await seeded($, on, {}, { rows: [rowJson('old', { stalled: true, now: nowJson() }), acting('b')] })
  expect(await textOf(await pane($, 'terminal', 194))).toContain('stalled')
})

test('korean: the tabs, the close key and the Flow and Gate rules text come from the ko table', async ($, on) => {
  await seeded($, on, demoRun({ [CONFIG]: cfg }), { language: 'Korean' })
  const ui = await pane($, 'terminal', 194)
  expect((await buttons(ui)).map(b => b.label)).toEqual(['● 지금', '흐름', '발견', '게이트 규칙'])
  expect(await shown(ui)).toContain('닫기 [q]')
  expect(await shown(ui)).not.toContain('close [')
  await ui.press({ key: 'flow' })
  await ui.redraw()
  const flow = await shown(ui)
  for (const word of ['계획', '비평', '게이트']) expect(flow).toContain(word)
  await ui.press({ key: 'rules' })
  await ui.redraw()
  const rules = await shown(ui)
  for (const word of ['아직 판정 전', '게이트 규칙']) expect(rules).toContain(word)
  for (const word of ['not judged', 'Gate rules', 'passed']) expect(rules).not.toContain(word)
})

test('/harness-status opens the pane on Now when a run is open, on the gate rules when none is', async ($, on) => {
  const seen = await seeded($, on, demoRun({ [CONFIG]: cfg }))
  await cmd($)
  expect(seen.opened).toEqual(['harness-status'])
  const ui = await pane($, 'terminal')
  expect(await buttons(ui)).toMatchObject([{ label: '● Now' }, { label: 'Flow' }, { label: 'Findings' }, { label: 'Gate rules' }])
  seen.listing.stdout = list([])
  await seen.clock.advance(5000)
  await ui.press({ key: 'rules' })
  await cmd($) // closes
  await cmd($) // opens again: no run, so the gate rules
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: 'Gated patterns (3): ^a/, ^b/, ^c/' })).toBeDefined()
})

test('an invalid gate config says it could not be read, not that it is missing; the reply is just the opened text', async ($, on) => {
  const seen = await seeded($, on, { [CONFIG]: '{not json' }, { rows: [] })
  const ui = await pane($, 'terminal')
  expect(await ui.find({ type: 'Text', text: 'Gate config .claude/harness-gate.json could not be read (invalid JSON).' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /is not in this project/ })).toBeUndefined()
  const r = await cmd($)
  expect(JSON.stringify(r)).toContain('"pane opened"')
  expect(JSON.stringify(r)).not.toContain('harness-status:')
})

const band = ($: Engine, on: On, hasSurvey = false, bodyColumns = 190) => {
  return $.ui.mount({ plugin: 'harness', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey, bodyColumns } } as never)
}

test('band: hidden with no open runs', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, ['terminal'], {})
  await start($)
  const ui = await band($, on)
  expect(await ui.find({ type: 'Text', text: 'harness' })).toBeUndefined()
})

test('band: hidden while a survey shows', async ($, on) => {
  await seeded($, on, {}, { rows: [acting('a')] })
  const ui = await band($, on, true)
  expect(await ui.find({ type: 'Text', text: 'harness' })).toBeUndefined()
})

test('band: three rows (doing and ⚑ / rail with subgoals n/m / cost and the latest finding), +N for the other runs', async ($, on) => {
  await seeded($, on, {}, { rows: [csv(), acting('other')] })
  const rows = linesOf(await (await band($, on)).drawn()).slice(0, 3)
  expect(rows).toHaveLength(3)
  expect(rows[0]).toMatch(/^[✎⌕▸] harness demo · SetGoal is rewriting the spec after critique round 1 rejected it · round 2 of 3 · 6m/)
  expect(rows[0]!.trimEnd().endsWith('+1 run')).toBe(true)
  expect(rows[1]).toContain('✔ Plan ━━ ✔ SetGoal ━━ ✘ Critique ━━ ● SetGoal again')
  expect(rows[1]).toContain('subgoals 0/3')
  expect(rows[2]).toContain('$3.40')
  expect(rows[2]).toContain('top finding: "export button" has no check')
})

test('band: a run that waits on you leads with ⚑, and cost reads — when now.json carries none', async ($, on) => {
  await seeded($, on, {}, { rows: [acting('a'), waiting('w')] })
  const rows = linesOf(await (await band($, on)).drawn()).slice(0, 3)
  expect(rows[0]).toMatch(/^⚑ harness w · .*asks you: approve the goal spec/)
  expect(rows[2]!.trimStart().startsWith('—')).toBe(true)
})

test('band: with graph runs under .harness-run/broker/runs there is no graph row', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], { ...runFiles }, runDirs)
  seen.listing.stdout = list([acting('a')])
  await start($)
  const text = linesOf(await (await band($, on)).drawn())
  expect(lastStatus(seen)).toContain('graph Implement(1)') // the status line still counts them
  expect(text.slice(0, 3)).toHaveLength(3)
  expect(text.some(l => /graph/i.test(l))).toBe(false)
})

test('band at 110: low-priority segments drop first; the run name and ⚑ only truncate with …', async ($, on) => {
  const long = 'a-very-long-run-name-that-would-not-fit-with-its-doing-sentence'
  const ask = { who: 'you', what: 'approve the goal spec before critique round two starts and the large report subgoal begins building' }
  await seeded($, on, {}, { rows: [rowJson(long, { waiting: ask, stage: 'setgoal', now: nowJson({ waiting: ask, round: 2 }) }), acting('b')] })
  const rows = linesOf(await (await band($, on, false, 110)).drawn()).slice(0, 3)
  for (const l of rows) expect([l, Array.from(l).length <= 110]).toEqual([l, true])
  expect(rows[0]).toContain('⚑')
  expect(rows[0]).toContain('a-very-long-run-name')
  expect(rows[0]).not.toContain('round 2')
  expect(rows[0]).toContain('…')
  expect(rows[0]).toContain('+1')
})

// ---- the run list: read through node, kept when a read fails ----
const doing = (slug: string, text: string, o: object = {}) => acting(slug, { now: nowJson({ doing: text }), ...o })

test('the list is read by node through $.plugin.root, for this folder; an answer shows the run, a failure swallowed', async ($, on) => {
  const seen = await seeded($, on, {}, { rows: [acting('a')] })
  const argv = seen.listing.calls[0]!
  expect(argv[0]).toBe('node')
  expect(argv[1]!.endsWith('/engine/fallback-check.mjs')).toBe(true)
  expect(argv.slice(2)).toEqual(['--list', '--json', '--cwd', '/proj'])
})

test('the last good list stays when --list --json exits non-zero, times out, or prints something that is not a list', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], {})
  seen.listing.stdout = list([doing('a', 'doing A')])
  await start($)
  const ui = await pane($, 'terminal', 194)
  const shownNow = async () => {
    await ui.redraw()
    return (await textOf(ui)).includes('doing A')
  }
  expect(await shownNow()).toBe(true)
  for (const bad of [{ exitCode: 1, stdout: list([]) }, { exitCode: 0, stdout: 'not json' }, { exitCode: 0, stdout: '' }, { exitCode: 0, stdout: '{"slug":"a"}' }]) {
    seen.listing.exitCode = bad.exitCode
    seen.listing.stdout = bad.stdout
    await clock.advance(5000)
    expect(await shownNow()).toBe(true)
  }
  seen.listing.exitCode = 0
  seen.listing.throws = true
  await clock.advance(5000)
  expect(await shownNow()).toBe(true)
  // a real answer, even an empty list, replaces it
  seen.listing.throws = false
  seen.listing.stdout = list([])
  await clock.advance(5000)
  expect(await shownNow()).toBe(false)
})

test('a first load that fails gives an empty list: no band, no throw', async ($, on) => {
  mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], {})
  seen.listing.throws = true
  await start($)
  expect(linesOf(await (await band($, on)).drawn()).some(l => l.includes('harness'))).toBe(false)
})

// ---- [ and ]: the run the pane shows ----
const header = async (ui: Ui) => (await textOf(ui)).split('\n')[0]!

// A Button hotkey is one digit or lowercase letter (the engine refuses [ and ]), so the pane's autoFocus Input takes the
// literal keys: the pane never needs a click first. The header names [ ] because they work.
const typeKey = async (ui: Ui, text: string) => {
  await ui.input({ key: 'keys', text, kind: 'change' })
  await ui.redraw()
}
test('[ and ] switch between two open runs as key presses: run 2 of 2 after ], run 1 of 2 after [, the other run named in the tab row', async ($, on) => {
  const seen = await seeded($, on, {}, { rows: [doing('a', 'doing A', { stage: 'implement', passed: 1, total: 3 }), doing('b', 'doing B', { stage: 'critique' })] })
  const ui = await pane($, 'terminal', 194)
  expect(await header(ui)).toContain('run 1 of 2 ◀ [ ] ▶')
  // the key catcher is the pane's focus start (no click first) and no Client region is needed
  expect((await ui.find({ key: 'keys' }))?.props).toMatchObject({ autoFocus: true, value: '' })
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  // no Button claims a key the engine refuses, and none claims one the header does not name
  for (const b of await ui.findAll({ type: 'Button' })) expect(/^[0-9a-z]$/.test((b.props as { hotkey?: string }).hotkey ?? '0')).toBe(true)
  expect((await ui.find({ key: 'prev' }))?.props).not.toHaveProperty('hotkey')
  let text = await textOf(ui)
  expect(text).toContain('doing A')
  expect(text).toContain('other run: b · Critique')
  await typeKey(ui, ']')
  text = await textOf(ui)
  expect(await header(ui)).toContain('run 2 of 2')
  expect(text).toContain('doing B')
  expect(text).toContain('other run: a · Implement 1/3')
  expect(seen.store.get('selected')).toBe('b')
  await typeKey(ui, '[')
  expect(await header(ui)).toContain('run 1 of 2')
  expect(seen.store.get('selected')).toBe('a')
  // the field keeps what was typed until the pane is drawn again: the last character is the key
  await typeKey(ui, '[]')
  expect(await header(ui)).toContain('run 2 of 2')
  // any other key changes nothing
  await typeKey(ui, 'x')
  expect(await header(ui)).toContain('run 2 of 2')
  // the pointer: prev / next Buttons
  await ui.press({ key: 'prev' })
  await ui.redraw()
  expect(await header(ui)).toContain('run 1 of 2')
  await ui.press({ key: 'next' })
  await ui.redraw()
  expect(await header(ui)).toContain('run 2 of 2')
})

// With the Input holding the focus ring it takes every printable key, so it carries the pane's other keys too.
test('the key catcher also takes 1-4 (tabs) and q (close), the keys its focus would otherwise swallow', async ($, on) => {
  const seen = await seeded($, on, {}, { rows: [doing('a', 'doing A'), doing('b', 'doing B')] })
  const ui = await pane($, 'terminal', 194)
  await typeKey(ui, '3')
  expect(seen.store.get('paneTab')).toBe('findings')
  await typeKey(ui, '1')
  expect(seen.store.get('paneTab')).toBe('now')
  await typeKey(ui, 'q')
  expect(seen.closed).toEqual(['harness-status'])
})

test('with one run [ and ] change nothing', async ($, on) => {
  const seen = await seeded($, on, {}, { rows: [doing('a', 'doing A')] })
  const ui = await pane($, 'terminal', 194)
  expect(await ui.find({ key: 'next' })).toBeUndefined()
  expect(await header(ui)).not.toContain('◀')
  expect(await header(ui)).toContain('run 1 of 1')
  expect(await textOf(ui)).not.toContain('other run')
  expect(seen.store.get('selected')).toBeUndefined()
})

test('the selection is kept by slug across refresh and reopen, and falls back to opening order when that run closes', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], {})
  seen.listing.stdout = list([doing('a', 'doing A'), doing('b', 'doing B')])
  await start($)
  await cmd($)
  const ui = await pane($, 'terminal', 194)
  await ui.press({ key: 'next' })
  // the order changes under it; the run shown does not
  seen.listing.stdout = list([doing('b', 'doing B'), doing('a', 'doing A'), doing('c', 'doing C')])
  await clock.advance(5000)
  await ui.redraw()
  expect(await textOf(ui)).toContain('doing B')
  // closed and opened again: still b
  await cmd($)
  await cmd($)
  await ui.redraw()
  expect(await textOf(ui)).toContain('doing B')
  expect(await header(ui)).toContain('run 1 of 3')
  // b is finished: the list no longer holds it, and opening order decides
  seen.listing.stdout = list([doing('a', 'doing A'), doing('c', 'doing C')])
  await clock.advance(5000)
  await ui.redraw()
  const text = await textOf(ui)
  expect(text).toContain('doing A')
  expect(text).not.toContain('doing B')
})

test('opening order: the run waiting on you, else one with a reject since you last looked, else the most recently changed', async ($, on) => {
  const rejected = doing('r', 'doing R', { rounds: [{ round: 1, sound: false, file: 'x', problems: [{ severity: 'major', text: 'no check' }] }] })
  await seeded($, on, {}, { rows: [doing('a', 'doing A'), rejected, waiting('w')] })
  expect(await textOf(await pane($, 'terminal', 194))).toContain('SetGoal waits for approval')
})

test('opening order without one waiting: the reject comes first, and marking it seen does not move the pane off it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], {})
  const rejected = doing('r', 'doing R', { rounds: [{ round: 1, sound: false, file: 'x', problems: [{ severity: 'major', text: 'no check' }] }] })
  seen.listing.stdout = list([doing('a', 'doing A'), rejected])
  await start($)
  await cmd($) // opens on r and marks its reject as seen
  const ui = await pane($, 'terminal', 194)
  expect(await textOf(ui)).toContain('doing R')
  await clock.advance(5000)
  await ui.redraw()
  expect(await textOf(ui)).toContain('doing R')
  expect(seen.store.get('selected')).toBe('r')
  expect(seen.store.get('looked')).toEqual({ r: 1 })
})

test('opening order without a reject: the most recently changed run (the first of the list)', async ($, on) => {
  const seen = await seeded($, on, {}, { rows: [doing('newest', 'doing newest'), doing('older', 'doing older')] })
  await cmd($)
  expect(await textOf(await pane($, 'terminal', 194))).toContain('doing newest')
  expect(seen.store.get('selected')).toBe('newest')
})

// ---- the spinner: a faster interval, only while a shown run acts ----
const frames = (seen: { store: Map<string, unknown> }) => Number(seen.store.get('tick') ?? 0)

test('spinner: while a run acts and the band shows it, a frame every 800 ms (faster than the 5 s tick)', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], {})
  seen.listing.stdout = list([acting('a')])
  await start($)
  await clock.advance(1700)
  expect(frames(seen)).toBe(2)
  await clock.advance(3300)
  expect(frames(seen)).toBeGreaterThanOrEqual(6)
})

for (const [name, row] of [
  ['idle (no now.json)', rowJson('a')],
  ['waiting on you', waiting('a')],
  ['waiting on a vendor', rowJson('a', { waiting: { who: 'vendor', what: 'the model' }, now: nowJson({ waiting: { who: 'vendor', what: 'the model' } }) })],
  ['stalled', acting('a', { stalled: true })],
] as const) {
  test(`spinner: static when the run is ${name}`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const seen = world(on, ['terminal'], {})
    seen.listing.stdout = list([row])
    await start($)
    await clock.advance(12_000)
    expect(frames(seen)).toBe(0)
  })
}

test('spinner: ends when the run starts waiting, and when no run is open', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], {})
  seen.listing.stdout = list([acting('a')])
  await start($)
  await clock.advance(5000)
  expect(frames(seen)).toBeGreaterThan(0)
  seen.listing.stdout = list([waiting('a')])
  await clock.advance(5000) // the refresh sees it; the interval is cancelled by the next frame at the latest
  const at = frames(seen)
  await clock.advance(10_000)
  expect(frames(seen)).toBe(at)
  seen.listing.stdout = list([acting('a')])
  await clock.advance(5000) // the refresh that sees it starts the interval at the end of this step
  await clock.advance(2000)
  expect(frames(seen)).toBeGreaterThan(at)
  const again = frames(seen)
  seen.listing.stdout = list([])
  await clock.advance(5000)
  const none = frames(seen)
  await clock.advance(10_000)
  expect(frames(seen)).toBe(none)
  expect(none).toBeGreaterThanOrEqual(again)
})

// ---- the demo: fixtures, no live run ----
const demoCmd = ($: Engine, args: string) => $.command.run({ command: 'harness-status', args, origin: { kind: 'user' }, presentation: { isFullscreen: false, columns: 80 } } as never)

test('the command registers a demo argument hint', async ($, on) => {
  const seen = await seeded($, on, {}, { rows: [] })
  expect(seen.commandArgs[0].argumentHint).toContain('demo')
})

for (const scenario of DEMO_SCENARIOS) {
  test(`demo ${scenario}: the pane and the band draw the fixture with no call to fallback-check`, async ($, on) => {
    const seen = await seeded($, on, {}, { rows: [] })
    const calls = seen.listing.calls.length
    const r = await demoCmd($, `demo ${scenario}`)
    expect(JSON.stringify(r)).toContain(`demo: ${scenario}`)
    expect(JSON.stringify(r)).not.toContain('\\n')
    expect(seen.opened).toEqual(['harness-status'])
    const ordered = openingOrder(demoRows(scenario), {})
    // the pane's header and Now line are the fixture's
    const text = await textOf(await pane($, 'terminal', 194))
    expect(text).toContain(ordered[0]!.slug)
    // the band's rows are what the pure function draws for the fixture at this width
    const want = bandLines(ordered, { width: 190, nowMs: DEMO_NOW, tick: 0 }).map(plain)
    expect(linesOf(await (await band($, on)).drawn()).slice(0, 3)).toEqual(want)
    expect(seen.listing.calls.length).toBe(calls)
  })
}

test('demo with no name steps through minimal, full, parallel, narrow; off leaves it and reads the live runs again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, ['terminal'], {})
  seen.listing.stdout = list([doing('live', 'doing live')])
  await start($)
  const calls = seen.listing.calls.length
  const names: string[] = []
  for (let i = 0; i < 5; i++) names.push(JSON.stringify(await demoCmd($, 'demo')).match(/demo: (\w+)/)![1]!)
  expect(names).toEqual(['minimal', 'full', 'parallel', 'narrow', 'minimal'])
  await clock.advance(5000)
  expect(seen.listing.calls.length).toBe(calls) // the demo reads no list
  expect(seen.closed).toEqual([]) // demo does not toggle the pane
  expect(JSON.stringify(await demoCmd($, 'demo off'))).toContain('demo off')
  expect(seen.listing.calls.length).toBeGreaterThan(calls)
  expect(await textOf(await pane($, 'terminal', 194))).toContain('doing live')
})

test('the demo text at 190 and 110 columns is what renderDemo returns, line by line within the width', () => {
  for (const s of DEMO_SCENARIOS) {
    for (const w of [190, 110]) {
      for (const l of renderDemo(s, w).split('\n')) expect([s, w, Array.from(l).length <= w]).toEqual([s, w, true])
    }
  }
})

// ---- no surface, no guard without its catch ----
test('no tool.call guard is registered here; the count of guards equals the count of their catch (0 = 0)', () => {
  const seen: string[] = []
  register(((event: string) => {
    seen.push(event)
  }) as never, undefined as never)
  expect(seen.filter(e => e === 'tool.call')).toHaveLength(0)
  expect(seen).toContain('session.start')
})

test('with no surface no band, pane, toast, timer or spinner starts, and the command is not there', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const seen = world(on, [], {})
  seen.listing.stdout = list([acting('a')])
  await start($)
  await clock.advance(30_000)
  expect(seen.listing.calls).toEqual([])
  expect(seen.toasts).toEqual([])
  expect(seen.opened).toEqual([])
  expect(frames(seen)).toBe(0)
  expect(seen.commands).toEqual([])
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
