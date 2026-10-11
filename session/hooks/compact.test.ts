import { test, expect } from 'claude-code/testing'

import { THRESHOLD_FIELD } from './compact.tsx'
import { guardWorld } from './testkit.ts'
import { clockAt, memoryStore } from './testkit.ts'

const TURN = { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't' } as never
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

const world = (on: any, percent: number, opts: { surfaces?: 'terminal'[] } = {}) => {
  const seen = guardWorld(on, { surfaces: opts.surfaces })
  const configSets: { key: string; value: unknown }[] = []
  on('config.set', (_$: any, e: any) => {
    configSets.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  let forks = 0
  let done = (_: string) => {}
  const compacted = new Promise<string>(r => (done = r))
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 100, tokens: percent, percent }, rateLimits: [] } }) as never)
  on('model.fork', () => {
    forks++
    return { value: { isAnswered: true, text: 'GOAL: ship smart-compact', usage: USAGE } } as never
  })
  on('session.compact', (_$: any, e: any) => {
    done(e.instructions ?? '')
    return { messages: [] }
  })
  return { seen, compacted, configSets, forks: () => forks }
}

const run = ($: any, args: string) =>
  $.command.run({ command: 'smart-compact', args } as never) as Promise<{ text?: string }>

test('/smart-compact is registered at session start', async ($, on) => {
  const w = world(on, 0)
  on('classic.SessionStart', () => ({}))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
  expect(w.seen.commands).toContain('smart-compact')
})

test('at the default 70% it recaps, then compacts with the recap', async ($, on) => {
  const w = world(on, 75)
  await $.turn.complete(TURN)
  expect(await w.compacted).toContain('GOAL: ship smart-compact')
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
  const w = world(on, 45)
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
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on(
    'session.usage',
    o.usage ?? (() => ({ value: { startedAt: 0, context: { window: 100, tokens: 1, percent: o.percent ?? undefined }, rateLimits: [] } })),
  )
  on('session.id', () => ({ value: 'sess-1234abcd' }))
  on('model.fork', () => {
    forks++
    return (o.fork ?? (() => ({ value: { isAnswered: true, text: 'GOAL: ship smart-compact', usage: USAGE } })))()
  })
  on('session.compact', () => {
    compacts++
    return (o.compact ?? (() => SUMMARY))()
  })
  const log = () => (store.get(LOG) ?? []) as any[]
  return { store, clock, log, forks: () => forks, compacts: () => compacts }
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

test('at the threshold the entry goes pending, then compacted', async ($, on) => {
  const w = logWorld(on, { percent: 75 })
  await $.turn.complete(TURN)
  await until(() => w.log()[0]?.outcome === 'compacted', 'compacted')
  expect(w.log()).toHaveLength(1)
  expect(w.log()[0]).toMatchObject({ percent: 75, decision: 'recapping', outcome: 'compacted' })
  expect(w.forks()).toBe(1)
})

test('a compact the engine skips ends skip:<why>', async ($, on) => {
  const w = logWorld(on, { percent: 75, compact: () => ({ skip: 'nothing new' }) })
  await $.turn.complete(TURN)
  await until(() => w.log()[0]?.outcome?.startsWith('skip:'), 'skip')
  expect(w.log()[0].outcome).toBe('skip:nothing new')
})

test('an unanswered recap fork ends recap-failed:<reason>', async ($, on) => {
  const w = logWorld(on, { percent: 75, fork: () => ({ value: { isAnswered: false, reason: 'aborted' } }) })
  await $.turn.complete(TURN)
  await until(() => w.log()[0]?.outcome === 'recap-failed:aborted', 'recap-failed')
  expect(w.compacts()).toBe(0)
})

test('compact rejecting every attempt ends compact-failed', async ($, on) => {
  const w = logWorld(on, {
    percent: 75,
    compact: () => {
      throw new Error('turn still running')
    },
  })
  await $.turn.complete(TURN)
  for (let i = 0; i < 40 && w.log()[0]?.outcome !== 'compact-failed'; i++) await w.clock.advance(500)
  await until(() => w.log()[0]?.outcome === 'compact-failed', 'compact-failed')
  expect(w.compacts()).toBe(20)
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

test('a denying store is counted as log write errors and recap + compact still run', async ($, on) => {
  const w = logWorld(on, { percent: 75 })
  w.store.broken = true
  expect(await $.turn.complete(TURN)).toMatchObject({ text: 'ok' })
  await until(() => w.compacts() === 1, 'compact')
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
