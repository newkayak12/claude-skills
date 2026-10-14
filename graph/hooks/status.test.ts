import { expect, test } from 'claude-code/testing'

import type { GraphNode, GraphRun } from '../types'
import { active, agentOf, clock, detailRows, flowGroups, ordered, span } from './status'

const n = (id: string, state: string, extra: Record<string, unknown> = {}): GraphNode => {
  const [stage, a, b] = id.split(':')
  const isSg = stage === 'implement' || stage === 'test' || stage === 'gate'
  const attempt = Number(isSg ? b ?? a : a ?? 1) || 1
  return { node_id: id, stage: stage!, deps: [], state, attempt, subgoal_id: isSg ? (a === 'goal' ? null : a!) : undefined, ...extra } as GraphNode
}
const run = (nodes: GraphNode[]): GraphRun => ({ run_id: 'r', request: 'x', spec: { subgoals: [{ id: 'U1' }, { id: 'U2' }] }, nodes })

test('agentOf: executor·model, vendor when no executor, — when nothing recorded', () => {
  expect(agentOf(n('plan', 'done', { executor: 'claude', vendor: 'self', model: 'opus' }))).toBe('claude·opus')
  expect(agentOf(n('plan', 'done', { vendor: 'codex' }))).toBe('codex')
  expect(agentOf(n('plan', 'done', { vendor: null, model: null }))).toBe('—')
})

test('clock and span', () => {
  expect(clock(null)).toBe('')
  expect(clock(45_000)).toBe('45s')
  expect(clock(192_000)).toBe('3m 12s')
  expect(clock(3_900_000)).toBe('1h 5m')
  expect(span(n('plan', 'running', { started_at: 1000 }), 6000)).toBe(5000)
  expect(span(n('plan', 'done', { started_at: 1000, finished_at: 4000 }), 99999)).toBe(3000)
  expect(span(n('plan', 'done'), 99999)).toBeNull()
  expect(span(n('plan', 'done', { started_at: 1000 }), 99999)).toBeNull()
})

test('active: only running nodes, with agent and elapsed', () => {
  const r = run([n('plan', 'done'), n('implement:U1:1', 'running', { executor: 'codex', model: 'gpt-5', started_at: 0 })])
  expect(active(r, 61_000).map(a => [a.node.node_id, a.agent, a.elapsed])).toEqual([['implement:U1:1', 'codex·gpt-5', '1m 1s']])
})

test('ordered: plan, subgoals in spec order with impl/test/gate, goal gate, report; retries after their first attempt', () => {
  const r = run([
    n('report', 'pending'), n('gate:goal:1', 'pending'), n('gate:U2:1', 'pending'), n('implement:U2:1', 'done'),
    n('implement:U1:2', 'running'), n('gate:U1:1', 'failed'), n('implement:U1:1', 'done'), n('plan', 'done'),
  ])
  expect(ordered(r).map(x => x.node_id)).toEqual([
    'plan', 'implement:U1:1', 'gate:U1:1', 'implement:U1:2', 'implement:U2:1', 'gate:U2:1', 'gate:goal:1', 'report',
  ])
})

test('flowGroups: a subgoal reject keeps its reason, the retry is one level deeper', () => {
  const r = run([
    n('plan', 'done'),
    n('implement:U1:1', 'done'), n('test:U1:1', 'done'), n('gate:U1:1', 'failed', { result: { stage_ok: false, reason: 'tests red' } }),
    n('implement:U1:2', 'done', { feedback: 'fix it' }), n('test:U1:2', 'done'), n('gate:U1:2', 'done'),
  ])
  const g = flowGroups(r)
  expect(g.map(x => [x.stage, x.sg])).toEqual([['plan', null], ['implement', 'U1']])
  const u1 = g[1]!.lines
  expect(u1.map(l => [l.depth, l.attempt, l.state, l.reason])).toEqual([[0, 1, 'failed', 'tests red'], [1, 2, 'done', '']])
  expect(u1[0]!.nodes.map(x => x.stage)).toEqual(['implement', 'test', 'gate'])
})

test('flowGroups: a reject without its own reason shows the feedback the retry carries', () => {
  const r = run([
    n('implement:U1:1', 'done'), n('gate:U1:1', 'failed'),
    n('implement:U1:2', 'running', { feedback: '  missing\n  header ' }),
  ])
  expect(flowGroups(r)[0]!.lines[0]!.reason).toBe('missing header')
})

test('flowGroups: a spec retry chains setgoal attempts; skipped placeholders are no attempt', () => {
  const r = run([
    n('plan', 'done'),
    n('setgoal', 'failed', { result: { stage_ok: false, reason: 'no acceptance' } }),
    n('setgoal:2', 'running'),
    n('implement:U1:1', 'skipped', { result: { stage_ok: false, reason: 'superseded by spec attempt 2' } }),
  ])
  const g = flowGroups(r)
  expect(g.map(x => x.stage)).toEqual(['plan', 'setgoal'])
  expect(g[1]!.lines.map(l => [l.depth, l.attempt, l.state, l.reason])).toEqual([[0, 1, 'failed', 'no acceptance'], [1, 2, 'running', '']])
})

test('flowGroups: goal gate retries chain under the failed one; report last', () => {
  const r = run([
    n('gate:goal:1', 'failed', { result: { stage_ok: false, reason: 'match 60%' } }),
    n('gate:goal:2', 'done'),
    n('report', 'pending'),
  ])
  const g = flowGroups(r)
  expect(g.map(x => x.stage)).toEqual(['gate', 'report'])
  expect(g[0]!.lines.map(l => [l.depth, l.reason])).toEqual([[0, 'match 60%'], [1, '']])
})

test('detailRows: skipped absent; agent, elapsed, one-line feedback, failure reason only on failed nodes', () => {
  const r = run([
    n('implement:U1:1', 'failed', { executor: 'codex', model: 'gpt-5', started_at: 0, finished_at: 5000, result: { reason: 'boom' } }),
    n('implement:U1:2', 'running', { feedback: 'a\nb' }),
    n('implement:U1:3', 'skipped'),
    n('plan', 'done', { result: { reason: 'ignored' } }),
  ])
  const rows = detailRows(r, 10_000)
  expect(rows.map(x => x.node.node_id)).toEqual(['plan', 'implement:U1:1', 'implement:U1:2'])
  expect(rows[1]).toMatchObject({ agent: 'codex·gpt-5', elapsed: '5s', reason: 'boom', feedback: '' })
  expect(rows[2]).toMatchObject({ agent: '—', elapsed: '', feedback: 'a b', reason: '' })
  expect(rows[0]!.reason).toBe('')
})
