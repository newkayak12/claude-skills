import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

type Run = { exitCode: number; stdout: string; stderr: string }
const ok = (stdout: string): Run => ({ exitCode: 0, stdout, stderr: '' })

// The engine beneath the plugin: surfaces, cwd, process.run, toast, status, command.register.
function world(on: On, surfaces: readonly ('terminal' | 'desktop')[], runs: (argv: readonly string[]) => Run) {
  const seen = { argv: [] as (readonly string[])[], toasts: [] as string[], statuses: [] as (string | undefined)[], commands: [] as string[], inFlight: 0, maxInFlight: 0 }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.cwd', () => ({ value: '/proj' }))
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

test('terminal: /teams-live is registered and the tick runs view.mjs from the plugin root', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const seen = world(on, ['terminal'], () => ok(''))
  await start($)
  expect(seen.commands).toEqual(['teams-live'])
  await clock.advance(3000)
  expect(seen.argv.length > 0).toBe(true)
  expect(seen.argv.every(a => a[0] === 'node' && a[1].endsWith('/scripts/view.mjs') && !a[1].startsWith('${'))).toBe(true)
  expect(seen.maxInFlight).toBe(1)
})

test('two events: two toasts, cursor advances; the same events again: no toast', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const seen = world(on, ['terminal'], argv => (isEvents(argv) ? ok(twoEvents) : ok('{"line":"","waiting":0}')))
  await start($)
  await clock.advance(3000)
  expect(seen.toasts).toEqual([E1.text, E2.text])
  await clock.advance(3000)
  expect(seen.toasts).toHaveLength(2)
  const sinces = seen.argv.filter(isEvents).map(sinceOf)
  expect(sinces).toEqual(['1000', '1800'])
})

test('status line: text shown, then an empty status clears it', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  let body = '{"line":"teams: E-aaaaaaaa 1/4 P1 implement","waiting":2}'
  const seen = world(on, ['terminal'], argv => (isEvents(argv) ? ok('') : ok(body)))
  await start($)
  await clock.advance(3000)
  expect(seen.statuses).toEqual(['teams: E-aaaaaaaa 1/4 P1 implement'])
  body = '{"line":"","waiting":0}'
  await clock.advance(3000)
  expect(seen.statuses[seen.statuses.length - 1]).toBeUndefined()
})

test('a non-zero exit: no throw, no toast, status unchanged', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const seen = world(on, ['terminal'], () => ({ exitCode: 1, stdout: twoEvents, stderr: 'boom' }))
  await start($)
  await clock.advance(6000)
  expect(seen.toasts).toEqual([])
  expect(seen.statuses).toEqual([])
})

// ---- tool.call: watch hook and team_status guard ----
// Engine beneath: surfaces, a tool that answers `result`, and a state store the test reads back.
function toolWorld(on: On, result: unknown, surfaces: readonly ('terminal' | 'desktop')[] = ['terminal'], isBroken = false) {
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
