import { test, expect } from 'claude-code/testing'

import { THRESHOLD_FIELD } from './compact.tsx'
import { COMPACT_MARK, RECAP_HEADER } from './compact-logic.ts'
import { guardWorld } from './testkit.ts'
import { clockAt, memoryStore } from './testkit.ts'

const TURN = { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't' } as never
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

const row = (handle: string, role: 'user' | 'assistant', text: string, extra: object = {}) => ({ handle, role, text, toolUses: [], ...extra })
// two short rows: under any budget here, both stay as the tail
const SMALL = [row('h1', 'user', 'q'), row('h2', 'assistant', 'a')]

// The engine beneath the plugin: smart-compact's `/compact <mark>` comes back as a session.compact the engine
// raises (trigger manual), carrying the transcript with the handles the engine stamps. The plugin's hook is
// above this test's `$`, so the call runs it.
const engineCompact = (on: any, $: any, rows: () => readonly unknown[], seen: { args: string[] }) =>
  on('command.run', { command: 'compact' }, async (_$: any, e: any) => {
    seen.args.push(e.args)
    return { value: await $.session.compact({ trigger: 'manual', instructions: e.args, messages: rows() } as never) } as never
  })

const world = (on: any, percent: number, opts: { surfaces?: 'terminal'[]; $?: any } = {}) => {
  const seen = guardWorld(on, { surfaces: opts.surfaces })
  const configSets: { key: string; value: unknown }[] = []
  on('config.set', (_$: any, e: any) => {
    configSets.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  let forks = 0
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 100, tokens: percent, percent }, rateLimits: [] } }) as never)
  on('model.fork', () => {
    forks++
    return { value: { isAnswered: true, text: 'GOAL: ship smart-compact', usage: USAGE } } as never
  })
  on('session.compact', () => ({ messages: [] }))
  let done = (_: any) => {}
  const compacted = new Promise<any>(r => (done = r))
  const args = { args: [] as string[] }
  if (opts.$) {
    on('command.run', { command: 'compact' }, async (_$: any, e: any) => {
      args.args.push(e.args)
      done(await opts.$.session.compact({ trigger: 'manual', instructions: e.args, messages: SMALL } as never))
      return { value: undefined } as never
    })
  }
  return { seen, compacted, configSets, forks: () => forks, args }
}

const run = ($: any, args: string) =>
  $.command.run({ command: 'smart-compact', args } as never) as Promise<{ text?: string }>

test('/smart-compact is registered at session start', async ($, on) => {
  const w = world(on, 0)
  on('classic.SessionStart', () => ({}))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  expect(w.seen.commands).toContain('smart-compact')
})

test('at the default 70% it runs /compact with its mark; the handoff and the newest rows replace the conversation', async ($, on) => {
  const w = world(on, 75, { $ })
  await $.turn.complete(TURN)
  const done = await w.compacted
  expect(w.args.args).toEqual([COMPACT_MARK])
  expect(done.messages[0]).toEqual({ role: 'user', text: RECAP_HEADER + 'GOAL: ship smart-compact', toolUses: [] })
  expect(done.messages.slice(1)).toEqual(SMALL)
  expect(w.forks()).toBe(1)
})

test('below the threshold nothing runs', async ($, on) => {
  const w = world(on, 50)
  await $.turn.complete(TURN)
  expect(w.forks()).toBe(0)
})

test('a subagent turn and a headless session never trigger it', async ($, on) => {
  const w = world(on, 90, { surfaces: [] })
  await $.turn.complete(TURN)
  await $.turn.complete({ ...(TURN as object), agentId: 'a1' } as never)
  expect(w.forks()).toBe(0)
})

test('/smart-compact <n> writes the /config field', async ($, on) => {
  const w = world(on, 0)
  expect((await run($, '40%')).text).toContain('40% (was 70%)')
  expect(w.configSets).toEqual([{ key: `session.${THRESHOLD_FIELD}`, value: 40 }])
})

test('the /config value is the threshold', { options: { [THRESHOLD_FIELD]: 40 } }, async ($, on) => {
  const w = world(on, 45, { $ })
  await $.turn.complete(TURN)
  await w.compacted
  expect(w.forks()).toBe(1)
})

test('/smart-compact refuses out of range and shows the kept value', { options: { [THRESHOLD_FIELD]: 80 } }, async ($, on) => {
  const w = world(on, 0)
  expect((await run($, '200')).text).toContain('still 80%')
  expect((await run($, '')).text).toContain('at 80%')
  expect(w.configSets).toEqual([])
})

// ── decision log (session 0.3.1) ──
// One stored entry per main-thread answer turn checked; subagent/headless turns are only counted in this process.
// The log is written off the turn, so a test polls the store until the entry it expects is there.
const LOG = 'smart-compact.log'
const SUMMARY = { messages: [{ role: 'user', text: 'summary', toolUses: [] }] }

type LogOpts = {
  percent?: number | null
  surfaces?: 'terminal'[]
  store?: Record<string, unknown>
  usage?: () => unknown
  fork?: () => unknown
  compact?: () => unknown
  // with `$`, /compact comes back as the engine's session.compact over `rows` (default: none)
  $?: any
  rows?: readonly unknown[]
}
const logWorld = (on: any, o: LogOpts = {}) => {
  const store = memoryStore(on, o.store)
  const clock = clockAt(on)
  on('session.surfaces', () => ({ value: o.surfaces ?? ['terminal'] }))
  on('session.root', () => ({ value: '/proj' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  let forks = 0
  let compacts = 0
  let reached: any
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on(
    'session.usage',
    o.usage ?? (() => ({ value: { startedAt: 0, context: { window: o.percent == null ? 0 : 100, tokens: o.percent ?? 0, percent: o.percent ?? undefined }, rateLimits: [] } })),
  )
  on('session.id', () => ({ value: 'sess-1234abcd' }))
  on('model.fork', () => {
    forks++
    return (o.fork ?? (() => ({ value: { isAnswered: true, text: 'GOAL: ship smart-compact', usage: USAGE } })))()
  })
  // reaching this hook is the engine's own summarizer running
  on('session.compact', (_$: any, e: any) => {
    compacts++
    reached = e
    return (o.compact ?? (() => SUMMARY))()
  })
  const seen = { args: [] as string[] }
  if (o.$) engineCompact(on, o.$, () => o.rows ?? [], seen)
  const log = () => (store.get(LOG) ?? []) as any[]
  return { store, clock, log, forks: () => forks, compacts: () => compacts, reached: () => reached, commands: () => seen.args.length }
}

const until = async (cond: () => boolean, label: string) => {
  for (let i = 0; i < 400; i++) {
    if (cond()) return
    await new Promise(r => setTimeout(r, 2))
  }
  throw new Error(`timed out waiting for ${label}`)
}

test('a turn below the threshold logs one below entry with the raw percent', async ($, on) => {
  const w = logWorld(on, { percent: 12 })
  await $.turn.complete(TURN)
  await until(() => w.log().length === 1, 'entry')
  expect(w.log()[0]).toMatchObject({ percent: 12, threshold: 70, decision: 'below', outcome: 'below', session: 'sess-1234abcd' })
  expect(typeof w.log()[0].ts).toBe('number')
})

test('the threshold fires on the status-line percent, not usage().context.percent', async ($, on) => {
  const w = logWorld(on, { $, rows: SMALL, usage: () => ({ value: { startedAt: 0, context: { window: 200, tokens: 150, percent: 15 }, rateLimits: [] } }) })
  await $.turn.complete(TURN)
  await until(() => w.log().some(l => l.outcome === 'compacted:recap+2'), 'compacted')
  expect(w.log()[0]).toMatchObject({ percent: 75, threshold: 70, decision: 'recapping' })
})

test('below the threshold on the status-line percent it does not fire, whatever usage().context.percent says', async ($, on) => {
  const w = logWorld(on, { usage: () => ({ value: { startedAt: 0, context: { window: 200, tokens: 100, percent: 95 }, rateLimits: [] } }) })
  await $.turn.complete(TURN)
  await until(() => w.log().length === 1, 'entry')
  expect(w.log()[0]).toMatchObject({ percent: 50, decision: 'below' })
  expect(w.forks()).toBe(0)
})

test('/smart-compact with no argument carries the percent, the threshold and the tokens', async ($, on) => {
  logWorld(on, { usage: () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 57877, percent: 3 }, rateLimits: [] } }) })
  const text = (await run($, '')).text!
  expect(text).toContain('context 29% (57,877 tokens of 200,000) · threshold 70%')
})

test('a null percent is logged as null, decided as below', async ($, on) => {
  const w = logWorld(on, { percent: null })
  await $.turn.complete(TURN)
  await until(() => w.log().length === 1, 'entry')
  expect(w.log()[0]).toMatchObject({ percent: null, decision: 'below' })
  expect(w.forks()).toBe(0)
})

test('subagent and headless turns write no log entry but are counted on /smart-compact', async ($, on) => {
  const w = logWorld(on, { percent: 90, surfaces: [] })
  await $.turn.complete(TURN)
  await $.turn.complete({ ...(TURN as object), agentId: 'a1' } as never)
  await new Promise(r => setTimeout(r, 20))
  expect(w.store.has(LOG)).toBe(false)
  expect(w.store.writes).toBe(0)
  const text = (await run($, '')).text!
  expect(text).toContain('2 turns checked (skipped:headless 1, skipped:agent 1)')
})

test('usage() throwing logs usage-failed and the hook behaves as before', async ($, on) => {
  const w = logWorld(on, {
    usage: () => {
      throw new Error('no usage')
    },
  })
  await $.turn.complete(TURN).catch(() => {})
  await until(() => w.log().length === 1, 'entry')
  expect(w.log()[0].decision).toMatch(/^usage-failed:[^\n]+$/)
  expect(w.log()[0].percent).toBe(null)
  expect(w.forks()).toBe(0)
})

test('at the threshold the entry goes pending, then compacted:recap+<tail>', async ($, on) => {
  const w = logWorld(on, { percent: 75, $, rows: SMALL })
  await $.turn.complete(TURN)
  await until(() => w.log()[0]?.outcome === 'compacted:recap+2', 'compacted:recap+2')
  expect(w.log()).toHaveLength(1)
  expect(w.log()[0]).toMatchObject({ percent: 75, decision: 'recapping' })
  expect(w.forks()).toBe(1)
  expect(w.compacts()).toBe(0)
})

const UNANSWERED = () => ({ value: { isAnswered: false, reason: 'aborted' } })

test('a compact the engine skips ends skip:<why>', async ($, on) => {
  const w = logWorld(on, { percent: 75, $, rows: SMALL, fork: UNANSWERED, compact: () => ({ skip: 'nothing new' }) })
  await $.turn.complete(TURN)
  await until(() => w.log()[0]?.outcome?.startsWith('skip:'), 'skip')
  expect(w.log()[0].outcome).toBe('skip:nothing new')
})

test('an unanswered handoff fork ends recap-failed:<reason>, and the engine compacts instead', async ($, on) => {
  const w = logWorld(on, { percent: 75, $, rows: SMALL, fork: UNANSWERED })
  await $.turn.complete(TURN)
  await until(() => w.log()[0]?.outcome === 'recap-failed:aborted', 'recap-failed')
  expect(w.compacts()).toBe(1)
  expect(w.reached().instructions).toBeUndefined()
})

test('a /compact that throws ends error:<first line>', async ($, on) => {
  const w = logWorld(on, { percent: 75 })
  on('command.run', { command: 'compact' }, () => {
    throw new Error('compact refused\nsecond line')
  })
  await $.turn.complete(TURN)
  await until(() => w.log()[0]?.outcome?.startsWith('error:'), 'error')
  expect(w.log()[0].outcome).toMatch(/^error:[^\n]+$/)
})

test('a /compact no hook reported on ends compact-not-run', async ($, on) => {
  const w = logWorld(on, { percent: 75 })
  on('command.run', { command: 'compact' }, () => ({ value: undefined }) as never)
  await $.turn.complete(TURN)
  await until(() => w.log()[0]?.outcome === 'compact-not-run', 'compact-not-run')
})

const TOOL = { tool: 'Read', file_path: '/x' } as never

const advanceUntil = async (w: { clock: { advance: (ms: number) => Promise<unknown> } }, cond: () => boolean, label: string) => {
  for (let i = 0; i < 20 && !cond(); i++) {
    await w.clock.advance(500)
    await new Promise(r => setTimeout(r, 2))
  }
  await until(cond, label)
}

test('a turn crossing the threshold mid-way hands off and compacts once, after the turn ends', async ($, on) => {
  let calls = 0
  const w = logWorld(on, {
    $,
    rows: SMALL,
    usage: () => ({ value: { startedAt: 0, context: { window: 100, tokens: ++calls === 2 ? 80 : 10, percent: 1 }, rateLimits: [] } }),
  })
  on('tool.call', () => ({ result: 'done', text: '' }) as never)
  await $.tool.call(TOOL)
  expect(w.forks()).toBe(0)
  await $.tool.call(TOOL)
  await $.turn.complete(TURN)
  await advanceUntil(w, () => w.log().some(l => l.outcome === 'compacted:recap+2'), 'compacted')
  await new Promise(r => setTimeout(r, 20))
  expect(w.commands()).toBe(1)
  expect(w.forks()).toBe(1)
})

test('mid-turn the /compact waits for the turn to end', async ($, on) => {
  const w = logWorld(on, { percent: 90, $, rows: SMALL })
  on('tool.call', () => ({ result: 'done', text: '' }) as never)
  await $.tool.call(TOOL)
  await until(() => w.log().length === 1, 'pending entry')
  for (let i = 0; i < 24; i++) {
    await w.clock.advance(500)
    await new Promise(r => setTimeout(r, 2))
  }
  expect(w.commands()).toBe(0)
  expect(w.log()[0].outcome).toBe('pending')
  await $.turn.complete(TURN)
  await advanceUntil(w, () => w.log()[0]?.outcome === 'compacted:recap+2', 'compacted at turn end')
  expect(w.commands()).toBe(1)
})

test('the log keeps the newest 50', async ($, on) => {
  const old = Array.from({ length: 50 }, (_, i) => ({ id: `o${i}`, ts: 0, session: 's', percent: 1, threshold: 70, decision: 'below', outcome: 'below' }))
  const w = logWorld(on, { percent: 5, store: { [LOG]: old } })
  await $.turn.complete(TURN)
  await until(() => w.log()[49]?.percent === 5, 'new entry')
  expect(w.log()).toHaveLength(50)
  expect(w.log()[0].id).toBe('o1')
})

test('/smart-compact log lists entries newest first; /smart-compact shows the last check', async ($, on) => {
  const w = logWorld(on, { percent: 20 })
  await $.turn.complete(TURN)
  await until(() => w.log().length === 1, 'entry')
  w.store.set(LOG, [...w.log(), { ...w.log()[0], id: 'x', percent: 33, decision: 'recapping', outcome: 'compacted' }])
  const log = (await run($, 'log')).text!.split('\n')
  expect(log).toHaveLength(2)
  expect(log[0]).toBe('0m ago: 33% vs 70% → recapping → compacted (session sess-123)')
  expect(log[1]).toBe('0m ago: 20% vs 70% → below (session sess-123)')
  const status = (await run($, '')).text!.split('\n')
  expect(status[0]).toContain('at 70%')
  expect(status[1]).toBe('last check 0m ago: 33% vs 70% → recapping → compacted')
  expect(status[2]).toBe('this process: 1 turns checked (below 1); log write errors 0')
})

test('/smart-compact log with nothing logged says so', async ($, on) => {
  logWorld(on)
  expect((await run($, 'log')).text).toBe('no check logged yet')
  expect((await run($, '')).text).toContain('\nno check logged yet\n')
})

test('a denying store is counted as log write errors and the handoff + compact still run', async ($, on) => {
  const w = logWorld(on, { percent: 75, $, rows: SMALL })
  w.store.broken = true
  expect(await $.turn.complete(TURN)).toMatchObject({ text: 'ok' })
  await until(() => w.commands() === 1, 'compact')
  await new Promise(r => setTimeout(r, 20))
  expect(w.forks()).toBe(1)
  expect(w.store.has(LOG)).toBe(false)
  expect((await run($, '')).text).toMatch(/1 turns checked \(recapping 1\); log write errors [1-9]\d*: .*store is broken/)
})

test('a throwing store read is counted and never throws out of the hook', async ($, on) => {
  const w = logWorld(on, { percent: 12 })
  w.store.getBroken = true
  expect(await $.turn.complete(TURN)).toMatchObject({ text: 'ok' })
  await new Promise(r => setTimeout(r, 20))
  w.store.getBroken = false
  expect((await run($, '')).text).toMatch(/1 turns checked \(below 1\); log write errors 1: /)
})

// ── the session.compact hook: a handoff over the rows being compacted, then the newest rows verbatim ──
const BIG = 'x'.repeat(900)
const ROWS = [row('h1', 'user', BIG), row('h2', 'assistant', BIG), row('h3', 'user', 'next question'), row('h4', 'assistant', 'the answer')]
const WINDOW_1000 = () => ({ value: { startedAt: 0, context: { window: 1000, tokens: 10, percent: 1 }, rateLimits: [] } })
const FORK_USAGE = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 3, cache_read_input_tokens: 7 }
const answered = () => ({ value: { isAnswered: true, text: 'GOAL: ship', usage: FORK_USAGE } })
const compactWith = ($: any, input: object) => $.session.compact(input as never) as Promise<any>

test('auto-compact: the handoff and the newest rows stand in for the summarizer, the tail keeps its handles', async ($, on) => {
  const w = logWorld(on, { usage: WINDOW_1000, fork: answered })
  const done = await compactWith($, { trigger: 'auto', messages: ROWS })
  expect(w.compacts()).toBe(0)
  expect(w.forks()).toBe(1)
  expect(done.messages).toHaveLength(3)
  expect(done.messages[0]).toEqual({ role: 'user', text: RECAP_HEADER + 'GOAL: ship', toolUses: [] })
  expect(done.messages.slice(1).map((m: any) => m.handle)).toEqual(['h3', 'h4'])
  await until(() => w.log()[0]?.outcome === 'compacted:recap+2', 'auto entry')
  expect(w.log()[0]).toMatchObject({ decision: 'auto-compact', tokens: { recap: { input: 20, output: 5 } } })
})

// Budget is 200 tokens (window 1000, threshold 70 -> 20%). The rows from the end: h4 2, h3 150 (152 fits),
// h2 60 (212 does not): the budget cut lands between the tool_use row h2 and its tool_result row h3.
const PAIR = [
  row('h1', 'user', 'go'),
  row('h2', 'assistant', 'x'.repeat(180), { toolUses: [{ tool_use_id: 't1', tool: 'Read', input: {} }] }),
  row('h3', 'user', '', { toolResults: [{ tool_use_id: 't1', text: 'y'.repeat(450), isError: false }] }),
  row('h4', 'assistant', 'done'),
]

test('a tool_result is never left without its tool_use', async ($, on) => {
  const w = logWorld(on, { usage: WINDOW_1000, fork: answered })
  const done = await compactWith($, { trigger: 'auto', messages: PAIR })
  expect(w.compacts()).toBe(0)
  expect(done.messages.map((m: any) => m.handle)).toEqual([undefined, 'h4'])
})

test('our own /compact gets the handoff too', async ($, on) => {
  const w = logWorld(on, { usage: WINDOW_1000, fork: answered })
  const done = await compactWith($, { trigger: 'manual', instructions: COMPACT_MARK, messages: ROWS })
  expect(w.compacts()).toBe(0)
  expect(done.messages[0].text).toBe(RECAP_HEADER + 'GOAL: ship')
})

const theEngines: [string, object][] = [
  ['a person’s /compact', { trigger: 'manual', instructions: 'keep the code', messages: ROWS }],
  ['a bare /compact', { trigger: 'manual', messages: ROWS }],
  ['a subagent’s auto-compact', { trigger: 'auto', agentId: 'a1', messages: ROWS }],
  ['a plugin’s $.session.compact', { trigger: 'plugin', instructions: COMPACT_MARK, messages: ROWS }],
  ['a precompute', { trigger: 'precompute', messages: ROWS }],
]
for (const [why, input] of theEngines) {
  test(`${why} goes on to the engine untouched, no handoff`, async ($, on) => {
    const w = logWorld(on, { usage: WINDOW_1000, fork: answered })
    expect(await compactWith($, input)).toEqual(SUMMARY)
    expect(w.compacts()).toBe(1)
    expect(w.forks()).toBe(0)
    expect(w.reached().instructions).toBe((input as { instructions?: string }).instructions)
  })
}

test('our /compact with no context window goes to the engine without the mark as instructions', async ($, on) => {
  const w = logWorld(on, { percent: null, fork: answered })
  expect(await compactWith($, { trigger: 'manual', instructions: COMPACT_MARK, messages: ROWS })).toEqual(SUMMARY)
  expect(w.forks()).toBe(0)
  expect(w.reached().instructions).toBeUndefined()
})

test('auto-compact with no context window goes to the engine, logged compacted', async ($, on) => {
  const w = logWorld(on, { percent: null, fork: answered })
  expect(await compactWith($, { trigger: 'auto', messages: ROWS })).toEqual(SUMMARY)
  expect(w.forks()).toBe(0)
  await until(() => w.log()[0]?.outcome === 'compacted', 'auto entry')
  expect(w.log()[0].decision).toBe('auto-compact')
})

test('auto-compact whose handoff fails goes to the engine, logged recap-failed', async ($, on) => {
  const w = logWorld(on, { usage: WINDOW_1000, fork: () => ({ value: { isAnswered: false, reason: 'too long' } }) })
  expect(await compactWith($, { trigger: 'auto', messages: ROWS })).toEqual(SUMMARY)
  expect(w.compacts()).toBe(1)
  await until(() => w.log()[0]?.outcome === 'recap-failed:too long', 'auto entry')
})

test('a failing usage() fails open to the engine', async ($, on) => {
  const w = logWorld(on, {
    fork: answered,
    usage: () => {
      throw new Error('no usage')
    },
  })
  expect(await compactWith($, { trigger: 'auto', messages: ROWS })).toEqual(SUMMARY)
  expect(w.compacts()).toBe(1)
})

test('flow: the hook answers smart-compact’s /compact, the log says compacted:recap+2 with the fork tokens', async ($, on) => {
  const w = logWorld(on, {
    $,
    rows: ROWS,
    fork: answered,
    usage: () => ({ value: { startedAt: 0, context: { window: 1000, tokens: 750, percent: 75 }, rateLimits: [] } }),
  })
  await $.turn.complete(TURN)
  await until(() => w.log()[0]?.outcome === 'compacted:recap+2', 'compacted:recap+2')
  expect(w.log()[0].tokens).toEqual({ recap: { input: 20, output: 5 } })
  expect(w.forks()).toBe(1)
  expect(w.compacts()).toBe(0)
})

test('flow: a failed handoff leaves the engine to summarize, the log has its tokens', async ($, on) => {
  const w = logWorld(on, {
    percent: 75,
    $,
    rows: SMALL,
    fork: UNANSWERED,
    compact: () => ({ ...SUMMARY, usage: { input_tokens: 100, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 60 }, tokensBefore: 90000, tokensAfter: 4000 }),
  })
  await $.turn.complete(TURN)
  await until(() => w.log()[0]?.outcome === 'recap-failed:aborted', 'recap-failed')
  await until(() => w.log()[0]?.tokens !== undefined, 'tokens')
  expect(w.log()[0].tokens).toEqual({ summarizer: { input: 160, output: 40 }, before: 90000, after: 4000 })
})
