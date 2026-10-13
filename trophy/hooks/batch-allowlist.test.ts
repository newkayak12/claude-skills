import { test, expect } from 'claude-code/testing'

import { buildBatch, EVENT_KEYS } from './logic.ts'
import type { BatchStore } from './logic.ts'

const DAY = '2026-10-12'

const store = (): BatchStore => ({
  installId: 'install-1',
  uses: [
    { skill: 'think:grill', plugin: 'think', day: DAY, session: 'SECRET-SESSION', ts: 1, cwd: '/Users/x/proj' } as any,
  ],
  triggers: { [DAY]: { 'think:grill': { hit: 1, miss: 2, unmatched: 0, leak: 9 } as any } },
  unlocked: { 'first-think': DAY },
  errors: [{ day: DAY, message: 'failed at <path>' }],
  plugins: { [DAY]: ['think'] },
  failures: [
    { ts: 1, day: DAY, kind: 'bug', reason: 'is_error', plugin: 'develop', skill: 'clean-code', version: '1.0', cc: '2.1.1', session: 'SECRET-SESSION', local: { text: 'x', path: '/Users/x/proj' } },
    { ts: 2, day: DAY, kind: 'bug', reason: 'mcp_error', plugin: 'graph', tool: 'graph_status', session: 's', local: {} },
    { ts: 3, day: DAY, kind: 'report', reason: 'user_report', plugin: 'think', skill: 'grill', session: 's', local: { note: 'n' } },
  ],
  versions: { [DAY]: { think: '1.0.0' } },
  activity: { [DAY]: { '2.1.296|darwin': 2 } },
  mcpCalls: { [DAY]: { 'graph|graph_status': { ok: 1, error: 1, extra: 3 } as any } },
  outcomes: {
    [DAY]: { 'graph|pass': 2, 'teams|reject': 1, 'harness|fail': 1, 'teams|pass|secret-task-123': 4, 'bogus|pass': 1, 'graph|weird': 1 },
  },
})

test('every event has exactly its EVENT_KEYS', () => {
  const { batch } = buildBatch(store(), DAY)
  const names = new Set(batch.map(e => e.event))
  for (const n of ['skill_used', 'trigger_result', 'achievement_unlocked', 'plugins_installed', 'daily_active', 'mcp_tool_result', 'run_outcome', 'diag_skill_error', 'diag_mcp_error', 'diag_user_report', '$exception']) {
    expect(names.has(n)).toBe(true)
  }
  for (const e of batch) {
    const spec = EVENT_KEYS[e.event]!
    expect(spec).toBeDefined()
    const keys = Object.keys(e.properties)
    expect(keys).toContain('$process_person_profile')
    for (const k of spec.required) expect(keys).toContain(k)
    for (const k of keys) expect([...spec.required, ...spec.optional, '$process_person_profile']).toContain(k)
  }
})

test('seeded stray fields and secrets never appear', () => {
  const raw = JSON.stringify(buildBatch(store(), DAY))
  for (const secret of ['cwd', 'leak', 'SECRET-SESSION', 'secret-task-123', '/Users/x', 'extra']) {
    expect(raw).not.toContain(secret)
  }
  const outcomes = buildBatch(store(), DAY).batch.filter(e => e.event === 'run_outcome').map(e => e.properties)
  expect(outcomes.length).toBe(3)
  for (const p of outcomes) {
    expect(['graph', 'teams', 'harness']).toContain(p.system)
    expect(['pass', 'reject', 'fail']).toContain(p.outcome)
  }
})

test('a fixture without the optional stores gives the old events only', () => {
  const old: BatchStore = { installId: 'i', uses: [], triggers: {}, unlocked: { a: DAY }, errors: [], plugins: {}, failures: [] }
  expect(buildBatch(old, DAY).batch.map(e => e.event)).toEqual(['achievement_unlocked'])
})

test('daily_active carries day, cc_version, os, sessions', () => {
  const e = buildBatch(store(), DAY).batch.find(e => e.event === 'daily_active')!
  expect(e.properties).toEqual({ day: DAY, cc_version: '2.1.296', os: 'darwin', sessions: 2, $process_person_profile: false })
})
