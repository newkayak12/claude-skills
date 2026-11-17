import { test, expect } from 'claude-code/testing'

import { addOutcome, outcomeOf } from './logic.ts'
import { recordOutcome } from './mod'

const SYSTEMS = ['graph', 'teams', 'harness'] as const
const OUTCOMES = ['pass', 'reject', 'fail'] as const

test('outcomeOf accepts each system x outcome', () => {
  for (const system of SYSTEMS) {
    for (const outcome of OUTCOMES) {
      expect(outcomeOf({ system, outcome, at: 1 }, system)).toEqual({ system, outcome })
    }
  }
})

test('outcomeOf rejects a system mismatch, an unknown outcome and a non-object', () => {
  expect(outcomeOf({ system: 'teams', outcome: 'pass', at: 1 }, 'graph')).toBeUndefined()
  expect(outcomeOf({ system: 'graph', outcome: 'partial', at: 1 }, 'graph')).toBeUndefined()
  expect(outcomeOf({ system: 'graph', outcome: 7 }, 'graph')).toBeUndefined()
  expect(outcomeOf(null, 'graph')).toBeUndefined()
  expect(outcomeOf('pass', 'graph')).toBeUndefined()
  expect(outcomeOf(undefined, 'graph')).toBeUndefined()
  expect(outcomeOf([], 'graph')).toBeUndefined()
})

test('a value with extra id keys yields only system and outcome', () => {
  const r = outcomeOf({ system: 'harness', outcome: 'fail', at: 5, run_id: 'secret-1', slug: 'x' }, 'harness')
  expect(r).toEqual({ system: 'harness', outcome: 'fail' })
  expect(Object.keys(r!)).toEqual(['system', 'outcome'])
})

test('addOutcome adds one per system|outcome per day', () => {
  let o = addOutcome({}, '2026-10-13', 'graph', 'pass')
  o = addOutcome(o, '2026-10-13', 'graph', 'pass')
  o = addOutcome(o, '2026-10-13', 'teams', 'reject')
  expect(o).toEqual({ '2026-10-13': { 'graph|pass': 2, 'teams|reject': 1 } })
})

test('147a: recordOutcome stores a failed harness outcome with the session folder, nothing for pass or graph', async () => {
  const store = new Map<string, unknown>()
  const $ = {
    session: { cwd: async () => '/w', id: async () => 's1' },
    clock: { now: async () => Date.parse('2026-10-13T09:00:00Z') },
    state: {
      get: async (a: { key: string }) => ({ value: store.get('state.' + a.key), version: 0 }),
      set: async (a: { key: string }, v: unknown) => (store.set('state.' + a.key, v), { isSet: true, version: 1 }),
    },
    store: { get: async (k: string) => store.get(k), set: async (k: string, v: unknown) => void store.set(k, v) },
  }
  for (const v of [
    { system: 'harness', outcome: 'reject', at: 1 },
    { system: 'harness', outcome: 'fail', at: 2 },
    { system: 'harness', outcome: 'pass', at: 3 },
    { system: 'graph', outcome: 'fail', at: 4 },
  ]) await recordOutcome($ as any, v)
  const log = store.get('trophy.failures') as any[]
  expect(log.map(e => [e.kind, e.reason, e.local])).toEqual([
    ['outcome', 'goal_failed', { path: '/w' }],
    ['outcome', 'subgoal_failed', { path: '/w' }],
  ])
})
