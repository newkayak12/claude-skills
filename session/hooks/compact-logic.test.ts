import { test, expect } from 'claude-code/testing'

import {
  COMPACT_MARK,
  compactOutcome,
  firstLine,
  FRESH_TAIL_ROWS,
  handoffFor,
  handoffFresh,
  PREWRITE_MARGIN,
  prewriteAllowed,
  type PrewriteInput,
  parseSmartCompactArgs,
  precomputeKey,
  reusablePrecompute,
  shouldCompactNow,
  tailBudget,
  tailStart,
  type KeyRow,
  type TailRow,
} from './compact-logic.ts'

const idle = { isRunning: false, surfaces: 1 }

test('shouldCompactNow: at the threshold runs, below does not', () => {
  expect(shouldCompactNow(60, 60, idle)).toBe('run')
  expect(shouldCompactNow(85, 60, idle)).toBe('run')
  expect(shouldCompactNow(59, 60, idle)).toBe('below')
})

test('shouldCompactNow: running, agent and headless skip before the percent is read', () => {
  expect(shouldCompactNow(90, 60, { ...idle, isRunning: true })).toBe('skipped:running')
  expect(shouldCompactNow(90, 60, { ...idle, agentId: 'a1' })).toBe('skipped:agent')
  expect(shouldCompactNow(90, 60, { ...idle, surfaces: 0 })).toBe('skipped:headless')
})

test('firstLine keeps the first line of an error or string', () => {
  expect(firstLine(new Error('busy\nstack'))).toBe('busy')
  expect(firstLine('plain\nmore')).toBe('plain')
})

test('handoffFor: auto-compact and our own /compact get a handoff; a person’s /compact and a subagent do not', () => {
  expect(handoffFor({ trigger: 'auto' })).toBe('auto')
  expect(handoffFor({ trigger: 'manual', instructions: COMPACT_MARK })).toBe('own')
  expect(handoffFor({ trigger: 'manual', instructions: ` ${COMPACT_MARK}\n` })).toBe('own')
  expect(handoffFor({ trigger: 'manual', instructions: 'keep the code' })).toBe(null)
  expect(handoffFor({ trigger: 'manual' })).toBe(null)
  expect(handoffFor({ trigger: 'auto', agentId: 'a1' })).toBe(null)
})

test('handoffFor: a plugin-raised compaction is ours, with the mark or none; another plugin’s instructions are not', () => {
  expect(handoffFor({ trigger: 'plugin', instructions: COMPACT_MARK })).toBe('own')
  expect(handoffFor({ trigger: 'plugin', instructions: ` ${COMPACT_MARK}\n` })).toBe('own')
  expect(handoffFor({ trigger: 'plugin' })).toBe('own')
  expect(handoffFor({ trigger: 'plugin', instructions: '  ' })).toBe('own')
  expect(handoffFor({ trigger: 'plugin', instructions: 'keep the code' })).toBe(null)
  expect(handoffFor({ trigger: 'plugin', instructions: COMPACT_MARK, agentId: 'a1' })).toBe(null)
})

test('handoffFor: a precompute trigger is marked so the caller makes the recap ahead; a subagent’s is not', () => {
  expect(handoffFor({ trigger: 'precompute' })).toBe('precompute')
  expect(handoffFor({ trigger: 'precompute', instructions: COMPACT_MARK })).toBe('precompute')
  expect(handoffFor({ trigger: 'precompute', agentId: 'a1' })).toBe(null)
  expect(handoffFor({ trigger: 'manual', instructions: COMPACT_MARK, agentId: 'a1' })).toBe(null)
  expect(handoffFor({})).toBe(null)
  expect(handoffFor({ trigger: 'other' })).toBe(null)
})

test('compactOutcome: what the hook saw is the outcome; nothing seen is unobserved, never compact-not-run', () => {
  expect(compactOutcome(undefined)).toBe('unobserved')
  expect(compactOutcome(null)).toBe('unobserved')
  expect(compactOutcome({ kind: 'handoff', tail: 4 })).toBe('compacted:recap+4')
  expect(compactOutcome({ kind: 'fallback', reason: 'busy' })).toBe('recap-failed:busy')
  expect(compactOutcome({ kind: 'engine' })).toBe('compacted:engine')
  const seen = [undefined, { kind: 'handoff' as const, tail: 0 }, { kind: 'fallback' as const, reason: '' }, { kind: 'engine' as const }]
  for (const s of seen) expect(compactOutcome(s)).not.toBe('compact-not-run')
  expect(new Set(seen.map(compactOutcome)).size).toBe(seen.length)
})

const row = (handle?: string, uuid?: string): KeyRow => ({ handle, uuid })

test('precomputeKey: row count and the last row’s handle, else its uuid, else nothing', () => {
  expect(precomputeKey([row('h1'), row('h2')])).toBe('2:h2')
  expect(precomputeKey([row(undefined, 'u1')])).toBe('1:u1')
  expect(precomputeKey([row('h1', 'u1')])).toBe('1:h1')
  expect(precomputeKey([row()])).toBe('1:')
  expect(precomputeKey([])).toBe('0:')
})

test('reusablePrecompute: the stored handoff while the key matches; stale after a new row or a changed last handle', () => {
  const rows = [row('h1'), row('h2')]
  const stored = { key: precomputeKey(rows), handoff: 'recap text' }
  expect(reusablePrecompute(stored, rows)).toBe('recap text')
  expect(reusablePrecompute(stored, [...rows, row('h3')])).toBe(null)
  expect(reusablePrecompute(stored, [row('h1'), row('h9')])).toBe(null)
  expect(reusablePrecompute(stored, rows.slice(0, 1))).toBe(null)
  expect(reusablePrecompute(undefined, rows)).toBe(null)
  expect(reusablePrecompute(null, rows)).toBe(null)
})

test('parseSmartCompactArgs: a bare command is status, never set', () => {
  for (const bare of ['', '  ', ' \n\t', undefined]) expect(parseSmartCompactArgs(bare)).toEqual({ kind: 'status' })
})

test('parseSmartCompactArgs: words and a whole number from 10 to 95, with an optional %', () => {
  expect(parseSmartCompactArgs('log')).toEqual({ kind: 'log' })
  expect(parseSmartCompactArgs('off')).toEqual({ kind: 'off' })
  expect(parseSmartCompactArgs('on')).toEqual({ kind: 'on' })
  expect(parseSmartCompactArgs(' on ')).toEqual({ kind: 'on' })
  expect(parseSmartCompactArgs('60')).toEqual({ kind: 'set', value: 60 })
  expect(parseSmartCompactArgs('60%')).toEqual({ kind: 'set', value: 60 })
  expect(parseSmartCompactArgs(' 30 ')).toEqual({ kind: 'set', value: 30 })
  expect(parseSmartCompactArgs('10')).toEqual({ kind: 'set', value: 10 })
  expect(parseSmartCompactArgs('95%')).toEqual({ kind: 'set', value: 95 })
})

test('parseSmartCompactArgs: out of range, fractions and anything else are invalid', () => {
  for (const bad of ['5', '9', '96', '0', '-30', '60.5', '6.5', '0x20', '6e1', '%', '60%%', 'abc', 'off now', 'ON', '1 0'])
    expect(parseSmartCompactArgs(bad)).toEqual({ kind: 'invalid' })
})

const say = (role: 'user' | 'assistant', chars: number): TailRow => ({ role, text: 'x'.repeat(chars), toolUses: [] })
const call = (id: string, chars = 0): TailRow => ({
  role: 'assistant',
  text: 'x'.repeat(chars),
  toolUses: [{ tool_use_id: id, input: {} }],
})
const back = (id: string, chars = 0): TailRow => ({
  role: 'user',
  text: '',
  toolUses: [],
  toolResults: [{ tool_use_id: id, text: 'r'.repeat(chars) }],
})

test('tailBudget is half the threshold as a percent of the window, capped at 20%', () => {
  expect(tailBudget(100000, 10)).toBe(5000)
  expect(tailBudget(100000, 90)).toBe(20000)
  expect(tailBudget(100001, 7)).toBe(3500)
})

test('tailStart within budget takes the newest rows that fit, counting chars/3', () => {
  const rows = [say('user', 30), say('assistant', 30), say('user', 30), say('assistant', 30)]
  expect(tailStart(rows, 20)).toBe(2)
  expect(tailStart(rows, 40)).toBe(0)
  expect(tailStart(rows, 19)).toBe(3)
})

test('tailStart counts tool_use input and tool_result text, not a tool_use result or text', () => {
  const use: TailRow = {
    role: 'assistant',
    text: '',
    toolUses: [{ tool_use_id: 'a', input: { k: 'x'.repeat(28) }, result: 'y'.repeat(900), text: 'y'.repeat(900) } as never],
  }
  // input {"k":"xxxx…"} is 34 chars = 12 tokens; result and text add nothing
  expect(tailStart([use], 12)).toBe(0)
  expect(tailStart([use], 11)).toBe(1)
  expect(tailStart([say('user', 3), back('a', 60)], 20)).toBe(2)
})

test('tailStart orphan tool_result moves the start past its row', () => {
  const rows = [say('user', 3), call('a'), back('a', 30), say('assistant', 3)]
  // 1 + 10 tokens fit, the call (1 more) does not: back('a') has lost its tool_use
  expect(tailStart(rows, 11)).toBe(3)
  // with the tool_use inside the tail the pair stays
  expect(tailStart(rows, 12)).toBe(1)
  expect(tailStart(rows, 100)).toBe(0)
})

test('tailStart parallel tool_use rows: a result for a cut-off sibling moves the start past both', () => {
  const rows = [call('x'), call('y'), back('x'), back('y'), say('assistant', 3)]
  expect(tailStart(rows, 100)).toBe(0)
  // starts at call y: back x is orphaned, so the start passes it and then back y
  expect(tailStart(rows, 1)).toBe(4)
  const six = [say('user', 3), call('x'), call('y'), back('x'), back('y')]
  expect(tailStart(six, 0)).toBe(5)
})

test('tailStart over budget on the last row alone gives an empty tail', () => {
  const rows = [say('user', 3), say('assistant', 300)]
  expect(tailStart(rows, 50)).toBe(2)
  expect(tailStart([], 50)).toBe(0)
})

const pw = (o: Partial<PrewriteInput> = {}): PrewriteInput => ({
  enabled: true,
  surfaces: 1,
  inFlight: false,
  percent: 45,
  threshold: 50,
  key: '10:a',
  attempted: new Set<string>(),
  ...o,
})

test('prewrite constants', () => {
  expect(PREWRITE_MARGIN).toBe(5)
  expect(FRESH_TAIL_ROWS).toBe(4)
})

test('prewriteAllowed: boundary threshold-5 runs, threshold-6 does not', () => {
  expect(prewriteAllowed(pw({ percent: 45 }))).toBe(true)
  expect(prewriteAllowed(pw({ percent: 44 }))).toBe(false)
  expect(prewriteAllowed(pw({ percent: 80 }))).toBe(true)
})

test('prewriteAllowed: every false branch', () => {
  expect(prewriteAllowed(pw({ enabled: false }))).toBe(false)
  expect(prewriteAllowed(pw({ agentId: 'sub-1' }))).toBe(false)
  expect(prewriteAllowed(pw({ surfaces: 0 }))).toBe(false)
  expect(prewriteAllowed(pw({ inFlight: true }))).toBe(false)
  expect(prewriteAllowed(pw({ percent: null }))).toBe(false)
  expect(prewriteAllowed(pw({ attempted: new Set(['10:a']) }))).toBe(false)
  expect(prewriteAllowed(pw({ attempted: ['10:a'] }))).toBe(false)
  expect(prewriteAllowed(pw({ attempted: ['9:a'] }))).toBe(true)
})

const krows = (n: number): KeyRow[] => Array.from({ length: n }, (_, i) => ({ handle: `h${i}` }))

test('handoffFresh: equal, 1 and 3 newer rows are fresh; 4 newer is stale', () => {
  const stored = { key: precomputeKey(krows(10)) }
  expect(handoffFresh(stored, krows(10))).toBe(true)
  expect(handoffFresh(stored, krows(11))).toBe(true)
  expect(handoffFresh(stored, krows(13))).toBe(true)
  expect(handoffFresh(stored, krows(14))).toBe(false)
})

test('handoffFresh: changed row, fewer rows, missing or bad key are stale', () => {
  const stored = { key: precomputeKey(krows(10)) }
  const changed = krows(11)
  changed[9] = { handle: 'other' }
  expect(handoffFresh(stored, changed)).toBe(false)
  expect(handoffFresh(stored, krows(9))).toBe(false)
  expect(handoffFresh(null, krows(10))).toBe(false)
  expect(handoffFresh(undefined, krows(10))).toBe(false)
  expect(handoffFresh({ key: 'garbage' }, krows(10))).toBe(false)
  expect(handoffFresh({ key: '0:' }, krows(10))).toBe(false)
})

test('handoffFresh: rows with only a uuid', () => {
  const rows: KeyRow[] = [{ uuid: 'u1' }, { uuid: 'u2' }, { uuid: 'u3' }]
  expect(handoffFresh({ key: precomputeKey(rows.slice(0, 2)) }, rows)).toBe(true)
  expect(handoffFresh({ key: '2:zzz' }, rows)).toBe(false)
})
