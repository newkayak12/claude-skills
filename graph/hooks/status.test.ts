import { expect, test } from 'claude-code/testing'

import type { GraphRow } from '../types'
import {
  ageText, costText, cycleRun, frozenOrder, listArgv, markLooked, openingOrder,
  paneKey, paneSlash, parseOpenArg, parseRow, parseRows, pickRun, runPosition, showArgv, spinnerPlan, standalone,
} from './status'

const row = (id: string, extra: Record<string, unknown> = {}): GraphRow =>
  ({
    id8: id.slice(0, 8), state: 'running', owner: null, created_at: 'unknown', cost_usd: null, running: null, run_id: id, file: `/x/${id}.json`,
    request: 'r', max_retries: 2, last_change: '', last_change_ms: 0, age_ms: 0, open: true, stalled: false, routing_blocked: false,
    unavailable_vendors: {}, subgoals: [], last_step: null, acting: false, rejects: 0, nodes: [], ...extra,
  }) as GraphRow

test('argv: the broker readout, list and show', () => {
  expect(listArgv('/p', '/w')).toEqual(['node', '/p/mcp/broker.mjs', 'runs', '--list', '--json', '--cwd', '/w'])
  expect(showArgv('/p', '/f.json')).toEqual(['node', '/p/mcp/broker.mjs', 'runs', '--show', '/f.json', '--json'])
})

test('parseRows / parseRow: bad input is null so the last good list stays; [] is an answer', () => {
  expect(parseRows('')).toBeNull()
  expect(parseRows('not json')).toBeNull()
  expect(parseRows('{}')).toBeNull()
  expect(parseRows('[]')).toEqual([])
  const rs = parseRows(JSON.stringify([row('r1', { owner: { key: 'E-abcd1234' } }), { nope: 1 }]))!
  expect(rs.map(r => r.run_id)).toEqual(['r1'])
  expect(rs[0]!.owner).toEqual({ key: 'E-abcd1234' })
  expect(parseRow('')).toBeNull()
  expect(parseRow('[]')).toBeNull()
  const one = parseRow(JSON.stringify({ run_id: 'r2', file: '/f', owner: null, cost_usd: null, last_step: null }))!
  expect(one).toMatchObject({ run_id: 'r2', owner: null, cost_usd: null, last_step: null, created_at: 'unknown', nodes: [] })
})

test('standalone: an owned row is never in the result; a closed row is not either', () => {
  const rs = [row('a'), row('b', { owner: { task_id: 't', key: 'E-abcd1234/P2' } }), row('c', { open: false }), row('d')]
  expect(standalone(rs).map(r => r.run_id)).toEqual(['a', 'd'])
  expect(standalone(rs).some(r => r.owner !== null)).toBe(false)
})

test('openingOrder: routing_blocked first, then rejects since last looked, then the newest last_change', () => {
  const rs = [
    row('old', { last_change_ms: 1 }), row('new', { last_change_ms: 9 }),
    row('rej', { rejects: 2, last_change_ms: 0 }), row('seen', { rejects: 1, last_change_ms: 5 }),
    row('wait', { routing_blocked: true, last_change_ms: 0 }),
  ]
  expect(openingOrder(rs, { seen: 1 }).map(r => r.run_id)).toEqual(['wait', 'rej', 'new', 'seen', 'old'])
  expect(markLooked({}, rs[2]!)).toEqual({ rej: 2 })
  expect(markLooked({ rej: 2 }, rs[2]!)).toEqual({ rej: 2 })
})

test('selection: stays on the same run when a new row appears; the first open picks the opening head', () => {
  const a = row('A', { last_change_ms: 1 })
  const b = row('B', { last_change_ms: 2 })
  const first = frozenOrder([a, b], {}, null)
  expect(pickRun(first, null)?.run_id).toBe('B')
  const grown = frozenOrder([a, b, row('C', { last_change_ms: 9 })], {}, null)
  expect(pickRun(grown, 'A')?.run_id).toBe('A')
  expect(runPosition(grown, 'A')).toEqual({ k: 3, n: 3 })
  expect(frozenOrder([b, a], { A: 0 }, ['A', 'B']).map(r => r.run_id)).toEqual(['A', 'B'])
})

test('cycleRun: A -> B -> A', () => {
  const o = [row('A'), row('B')]
  const b = cycleRun(o, 'A', 1)
  expect(b).toBe('B')
  expect(cycleRun(o, b, -1)).toBe('A')
})

test('cycleRun first-run end: [ on the first run leaves it', () => {
  expect(cycleRun([row('A'), row('B')], 'A', -1)).toBe('A')
})

test('cycleRun last-run end: ] on the last run leaves it', () => {
  expect(cycleRun([row('A'), row('B')], 'B', 1)).toBe('B')
})

test('cycleRun one-run case: [ and ] change nothing', () => {
  expect(cycleRun([row('A')], 'A', 1)).toBe('A')
  expect(cycleRun([row('A')], 'A', -1)).toBe('A')
  expect(cycleRun([], null, 1)).toBeNull()
})

test('paneKey: [ ] 1 2 q; text holding / is a command being typed', () => {
  expect(paneKey(']')).toEqual({ kind: 'step', by: 1 })
  expect(paneKey('x[')).toEqual({ kind: 'step', by: -1 })
  expect(paneKey('2')).toEqual({ kind: 'tab', tab: 'detail' })
  expect(paneKey('q')).toEqual({ kind: 'close' })
  expect(paneKey('z')).toBeNull()
  expect(paneKey('')).toBeNull()
  expect(paneKey('/q')).toBeNull()
  expect(paneKey(']/graph-status')).toBeNull()
})

test('paneSlash: reads from the first /; graph-status closes, another command runs', () => {
  expect(paneSlash('/graph-status')).toEqual({ kind: 'close' })
  expect(paneSlash(']]/graph-status')).toEqual({ kind: 'close' })
  expect(paneSlash('/other x')).toEqual({ kind: 'run', command: 'other', args: 'x' })
  expect(paneSlash('[2/other x')).toEqual({ kind: 'run', command: 'other', args: 'x' })
  expect(paneSlash('abc')).toBeNull()
  expect(paneSlash(5)).toBeNull()
})

test('spinnerPlan: only while a shown run acts, not stalled, with a surface', () => {
  expect(spinnerPlan([row('A', { acting: true })], 1, true)).toEqual({ run: true })
  expect(spinnerPlan([row('A', { acting: true })], 0, true)).toEqual({ run: false })
  expect(spinnerPlan([row('A', { acting: true })], 1, false)).toEqual({ run: false })
  expect(spinnerPlan([row('A', { acting: true, stalled: true }), null], 1, true)).toEqual({ run: false })
  expect(spinnerPlan([row('A')], 1, true)).toEqual({ run: false })
})

test('parseOpenArg: file and owner key, else one usage line; empty is the toggle', () => {
  expect(parseOpenArg('open /x/.teams_output/broker/runs/r1.json E-3f9a21c0/P2')).toEqual({ file: '/x/.teams_output/broker/runs/r1.json', owner: 'E-3f9a21c0/P2' })
  expect(parseOpenArg('open /x/r1.json E-3f9a21c0')).toEqual({ file: '/x/r1.json', owner: 'E-3f9a21c0' })
  expect(parseOpenArg('')).toBeNull()
  expect(parseOpenArg(undefined)).toBeNull()
  for (const bad of ['open', 'open /x/r1.json', 'open /x/r1.json nokey', 'open /x/r1.json E-3f9a21c0/P2 extra', '/x/r1.json E-3f9a21c0']) {
    const r = parseOpenArg(bad) as { usage: string }
    expect(typeof r.usage).toBe('string')
    expect(r.usage.includes('\n')).toBe(false)
  }
})

test('costText and ageText: — when unknown', () => {
  expect(costText({ cost_usd: null })).toBe('—')
  expect(costText({ cost_usd: 3.4 })).toBe('$3.40')
  expect(ageText(null)).toBe('—')
  expect(ageText(45_000)).toBe('45s')
  expect(ageText(360_000)).toBe('6m')
  expect(ageText(4_320_000)).toBe('1h 12m')
})
