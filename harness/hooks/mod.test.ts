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
