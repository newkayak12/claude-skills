import { test, expect } from 'claude-code/testing'

import { appendEntry, buildBatch, goalFailed, harnessResult, ownedMcpTool, ownedSkill } from './logic.ts'
import type { Entry } from './logic.ts'

const entry = (o: Partial<Entry>): Entry => ({
  ts: 1000, day: '2026-10-01', kind: 'bug', reason: 'is_error', plugin: 'develop', skill: 'clean-code',
  session: 's1', local: {}, ...o,
})

test('ownedSkill rejects bare, foreign and free-text names', () => {
  const skills = { develop: ['clean-code', 'sql-pro'], trophy: ['list'] }
  expect(ownedSkill('develop:clean-code', skills)).toEqual({ plugin: 'develop', skill: 'clean-code' })
  expect(ownedSkill('clean-code', skills)).toBeUndefined()
  expect(ownedSkill('superpowers:brainstorming', skills)).toBeUndefined()
  expect(ownedSkill('develop:', skills)).toBeUndefined()
  expect(ownedSkill(undefined, skills)).toBeUndefined()
  // typed free text after a real plugin prefix never becomes a skill name
  expect(ownedSkill('develop:my secret password', skills)).toBeUndefined()
  expect(ownedSkill('develop:clean-code extra', skills)).toBeUndefined()
  expect(ownedSkill('trophy:clean-code', skills)).toBeUndefined()
  expect(ownedSkill('constructor:x', skills)).toBeUndefined()
})

test('ownedMcpTool rejects a foreign marketplace server', () => {
  const servers = { knowledge: ['knowledge-local'], think: ['think-tool'] }
  const plugin = { source: 'plugin' }
  expect(ownedMcpTool('mcp__plugin_knowledge_knowledge-local__knowledge_get', plugin, servers))
    .toEqual({ plugin: 'knowledge', server: 'knowledge-local', tool: 'knowledge_get' })
  expect(ownedMcpTool('mcp__plugin_teams_x__y', plugin, servers)).toBeUndefined()
  const hyphen = { 'context-mode': ['context-mode'] }
  expect(ownedMcpTool('mcp__plugin_context-mode_context-mode__ctx_search', plugin, hyphen))
    .toEqual({ plugin: 'context-mode', server: 'context-mode', tool: 'ctx_search' })
  expect(ownedMcpTool('mcp__plugin_context_mode_context_mode__ctx_search', plugin, hyphen))
    .toEqual({ plugin: 'context-mode', server: 'context-mode', tool: 'ctx_search' })
  expect(ownedMcpTool('mcp__plugin_knowledge_other__y', plugin, servers)).toBeUndefined()
  expect(ownedMcpTool('mcp__plugin_knowledge_knowledge-local__knowledge_get', { source: 'user' }, servers)).toBeUndefined()
  expect(ownedMcpTool('mcp__plugin_knowledge_knowledge-local__knowledge_get', undefined, servers)).toBeUndefined()
})

test('harnessResult ignores tmp paths', () => {
  const fail = '{"passed":false}'
  const p = '/Users/a/proj/.harness-run/run1/subgoals/s3/result.json'
  expect(harnessResult(p, fail)).toEqual({ slug: 'run1', subgoal: 's3', passed: false })
  expect(harnessResult(p, '{"passed":true}')).toBeUndefined()
  expect(harnessResult(p, 'not json')).toBeUndefined()
  expect(harnessResult('/Users/a/proj/.harness-run/run1/subgoals/s3/impl-1.md', fail)).toBeUndefined()
  for (const tmp of [
    '/tmp/x', '/private/tmp/x', '/var/folders/ab/cd/T/x', '/Users/a/scratch',
  ]) {
    expect(harnessResult(tmp + '/.harness-run/r/subgoals/s1/result.json', fail, ['/Users/a/scratch'])).toBeUndefined()
  }
})

test('goalFailed matches COMPLETE goal-gate FAIL only', () => {
  expect(goalFailed('x\nCOMPLETE run1 goal-gate FAIL\n')).toBe(true)
  expect(goalFailed('INCOMPLETE run1 goal-gate FAIL')).toBe(false)
  expect(goalFailed('COMPLETE run1 goal-gate PASS')).toBe(false)
})

test('appendEntry dedupes within 5 s and keeps 500', () => {
  let log: Entry[] = []
  log = appendEntry(log, entry({ ts: 1000 }))
  log = appendEntry(log, entry({ ts: 5000 }))
  expect(log.length).toBe(1)
  log = appendEntry(log, entry({ ts: 7000 }))
  expect(log.length).toBe(2)
  log = appendEntry(log, entry({ ts: 7000, skill: 'other' }))
  log = appendEntry(log, entry({ ts: 7000, session: 's2' }))
  expect(log.length).toBe(4)

  let big: Entry[] = []
  for (let i = 0; i < 520; i++) big = appendEntry(big, entry({ ts: i * 10000 }))
  expect(big.length).toBe(500)
  expect(big[0]!.ts).toBe(20 * 10000)
})

test('buildBatch aggregates counts per day, reason, plugin and skill', () => {
  const log = [
    entry({ ts: 1 }), entry({ ts: 100000 }), entry({ ts: 200000, skill: 'other' }),
    entry({ ts: 300000, day: '2026-10-02' }),
    entry({ kind: 'bug', reason: 'mcp_error', skill: undefined, tool: 'knowledge_get', plugin: 'knowledge' }),
    entry({ kind: 'report', reason: 'user_report', skill: undefined, plugin: undefined }),
    entry({ day: '2026-09-20' }),
    entry({ day: '2026-10-09' }),
  ]
  const out = buildBatch(log, '2026-09-30', '2026-10-05')
  const skill = out.filter(e => e.event === 'diag_skill_error')
  expect(skill.length).toBe(3)
  expect(skill.find(e => e.properties.skill === 'clean-code' && e.properties.day === '2026-10-01')?.properties.count).toBe(2)
  expect(out.find(e => e.event === 'diag_mcp_error')?.properties).toEqual(
    { tool: 'knowledge_get', plugin: 'knowledge', reason: 'mcp_error', count: 1, day: '2026-10-01' })
  expect(out.find(e => e.event === 'diag_user_report')?.properties).toEqual(
    { reason: 'user_report', count: 1, day: '2026-10-01' })
  expect(out.some(e => e.properties.day === '2026-09-20' || e.properties.day === '2026-10-09')).toBe(false)
})

test('buildBatch never emits outcomes, local fields or session ids', () => {
  const log = [
    entry({ kind: 'outcome', reason: 'subgoal_failed', local: { slug: 'run1', subgoal: 's1' } }),
    entry({ kind: 'outcome', reason: 'goal_failed' }),
    entry({ local: { text: 'SECRET raw error', path: '/Users/a/x' }, session: 'SESSION-ID' }),
  ]
  const out = buildBatch(log, undefined, '2026-10-05')
  expect(out.length).toBe(1)
  const json = JSON.stringify(out)
  expect(json).not.toContain('SECRET')
  expect(json).not.toContain('SESSION-ID')
  expect(json).not.toContain('/Users/a')
  expect(json).not.toContain('goal_failed')
  expect(json).not.toContain('subgoal_failed')
  expect(Object.keys(out[0]!.properties).sort()).toEqual(['count', 'day', 'plugin', 'reason', 'skill'])
})
