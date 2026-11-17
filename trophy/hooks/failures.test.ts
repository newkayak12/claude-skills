import { test, expect } from 'claude-code/testing'

import {
  appendEntry, copyBody, failureEvents, foldRows, outcomeFailure, ownedMcpTool, ownedSkill, rowDetail, rowMeta, rowTitle, targetOf,
} from './failures.ts'
import type { Entry } from './failures.ts'

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

test('outcomeFailure maps a harness fail or reject to a failure reason, nothing else', () => {
  expect(outcomeFailure({ system: 'harness', outcome: 'fail', at: 1 })).toBe('subgoal_failed')
  expect(outcomeFailure({ system: 'harness', outcome: 'reject', at: 1 })).toBe('goal_failed')
  expect(outcomeFailure({ system: 'harness', outcome: 'pass', at: 1 })).toBeUndefined()
  expect(outcomeFailure({ system: 'graph', outcome: 'fail', at: 1 })).toBeUndefined()
  expect(outcomeFailure({ system: 'teams', outcome: 'reject', at: 1 })).toBeUndefined()
  expect(outcomeFailure({ system: 'harness', outcome: 'partial' })).toBeUndefined()
  expect(outcomeFailure(null)).toBeUndefined()
  expect(outcomeFailure('fail')).toBeUndefined()
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

test('failureEvents aggregates counts per day, reason, plugin and skill', () => {
  const log = [
    entry({ ts: 1 }), entry({ ts: 100000 }), entry({ ts: 200000, skill: 'other' }),
    entry({ ts: 300000, day: '2026-10-02' }),
    entry({ kind: 'bug', reason: 'mcp_error', skill: undefined, tool: 'knowledge_get', plugin: 'knowledge' }),
    entry({ kind: 'report', reason: 'user_report', skill: undefined, plugin: undefined }),
    entry({ day: '2026-09-20' }),
    entry({ day: '2026-10-09' }),
  ]
  const out = failureEvents(log, '2026-09-30', '2026-10-05')
  const skill = out.filter(e => e.event === 'diag_skill_error')
  expect(skill.length).toBe(3)
  expect(skill.find(e => e.properties.skill === 'clean-code' && e.properties.day === '2026-10-01')?.properties.count).toBe(2)
  expect(out.find(e => e.event === 'diag_mcp_error')?.properties).toEqual(
    { tool: 'knowledge_get', plugin: 'knowledge', reason: 'mcp_error', count: 1, day: '2026-10-01' })
  expect(out.find(e => e.event === 'diag_user_report')?.properties).toEqual(
    { reason: 'user_report', count: 1, day: '2026-10-01' })
  expect(out.some(e => e.properties.day === '2026-09-20' || e.properties.day === '2026-10-09')).toBe(false)
})

test('failureEvents never emits outcomes, local fields or session ids', () => {
  const log = [
    entry({ kind: 'outcome', reason: 'subgoal_failed', local: { slug: 'run1', subgoal: 's1' } }),
    entry({ kind: 'outcome', reason: 'goal_failed' }),
    entry({ local: { text: 'SECRET raw error', path: '/Users/a/x' }, session: 'SESSION-ID' }),
  ]
  const out = failureEvents(log, undefined, '2026-10-05')
  expect(out.length).toBe(1)
  const json = JSON.stringify(out)
  expect(json).not.toContain('SECRET')
  expect(json).not.toContain('SESSION-ID')
  expect(json).not.toContain('/Users/a')
  expect(json).not.toContain('goal_failed')
  expect(json).not.toContain('subgoal_failed')
  expect(Object.keys(out[0]!.properties).sort()).toEqual(['count', 'day', 'plugin', 'reason', 'skill'])
})

test('failureEvents carries the plugin and Claude Code versions, and splits counts by them', () => {
  const log = [
    entry({ ts: 1, version: '1.10.3', cc: '2.1.293' }),
    entry({ ts: 100000, version: '1.10.3', cc: '2.1.293' }),
    entry({ ts: 200000, version: '1.10.4', cc: '2.1.293' }),
  ]
  const out = failureEvents(log, undefined, '2026-10-05')
  expect(out.map(e => [e.properties.plugin_version, e.properties.cc_version, e.properties.count])).toEqual([
    ['1.10.3', '2.1.293', 2],
    ['1.10.4', '2.1.293', 1],
  ])
})

test('147a: a goal_failed outcome row names the harness goal gate and the project folder', () => {
  const e = entry({ kind: 'outcome', reason: 'goal_failed', plugin: undefined, skill: undefined, local: { path: '/work/demo-app' } })
  expect(targetOf(e)).toBe('harness goal gate · demo-app')
  expect(rowTitle(e)).toBe('2026-10-01 · outcome · goal_failed · harness goal gate · demo-app')
})

test('147a: a subgoal_failed outcome row names the harness subgoal and the project folder', () => {
  const e = entry({ kind: 'outcome', reason: 'subgoal_failed', plugin: undefined, skill: undefined, local: { path: '/work/demo-app/' } })
  expect(targetOf(e)).toBe('harness subgoal · demo-app')
  expect(targetOf({ ...e, local: {} })).toBe('harness subgoal')
})

test('147a: an outcome stored before the change names its slug and subgoal', () => {
  const e = entry({ kind: 'outcome', reason: 'subgoal_failed', plugin: undefined, skill: undefined, local: { slug: 'demo-run', subgoal: 's1' } })
  expect(targetOf(e)).toBe('demo-run · s1')
  expect(targetOf({ ...e, local: { slug: 'demo-run' } })).toBe('demo-run')
})

test('147a: an outcome detail names the folder, the UTC time and .harness-run/', () => {
  const e = entry({ ts: Date.parse('2026-10-01T09:05:00Z'), kind: 'outcome', reason: 'goal_failed', local: { path: '/work/demo-app' } })
  expect(rowDetail(e)).toEqual(['09:05 UTC · .harness-run/ in /work'])
  expect(rowDetail({ ...e, local: {} })).toEqual(['09:05 UTC · .harness-run/'])
})

test('147a: the project folder appears once across the title, the meta line and the detail', () => {
  const e = entry({ ts: Date.parse('2026-10-01T09:05:00Z'), kind: 'outcome', reason: 'goal_failed', local: { path: '/work/demo-app/' } })
  for (const narrow of [false, true]) {
    const lines = [targetOf(e, !narrow), rowMeta(e, narrow), ...rowDetail(e)]
    expect(lines.join('\n').split('demo-app').length - 1).toBe(1)
  }
  expect(copyBody(e)).toContain('demo-app')
})

test('147a: a row with no detail has no detail line, and a slug already in the title is not repeated', () => {
  expect(rowDetail(entry({ local: {} }))).toEqual([])
  expect(rowDetail(entry({ local: { text: 'boom\nline2' } }))).toEqual(['boom', 'line2'])
  const old = entry({ ts: Date.parse('2026-10-01T09:05:00Z'), kind: 'outcome', reason: 'goal_failed', local: { slug: 'demo-run' } })
  expect(targetOf(old)).toBe('demo-run')
  expect(rowDetail(old)).toEqual(['09:05 UTC · .harness-run/'])
})

test('147a: rowMeta: an outcome drops the reason its title says and, narrow, carries the folder', () => {
  const e = entry({ kind: 'outcome', reason: 'goal_failed', day: '2026-11-11', local: { path: '/work/demo-app' } })
  expect(rowMeta(e)).toBe('2026-11-11')
  expect(rowMeta(e, true)).toBe('2026-11-11 · demo-app')
  expect(targetOf(e, false)).toBe('harness goal gate')
  expect(rowMeta({ ...e, local: { slug: 'demo-run' } })).toBe('goal_failed · 2026-11-11')
  expect(rowMeta(entry({ reason: 'is_error', day: '2026-11-10' }), true)).toBe('is_error · 2026-11-10')
})

test('147a: an mcp_error and a skill is_error name their target, never - or a dash', () => {
  const mcp = entry({ reason: 'mcp_error', plugin: 'teams', skill: undefined, tool: 'tm_open' })
  expect(targetOf(mcp)).toBe('teams · tm_open')
  expect(targetOf(entry({}))).toBe('develop:clean-code')
  for (const t of [targetOf(mcp), targetOf(entry({})), targetOf(entry({ kind: 'outcome', reason: 'goal_failed', local: {} }))]) {
    expect(t === '-' || t === '—').toBe(false)
  }
})

test('147a: failureEvents emits nothing for an outcome and never its local.path', () => {
  const log = [entry({ kind: 'outcome', reason: 'goal_failed', local: { path: '/work/demo-app' } })]
  expect(failureEvents(log, undefined, '2026-10-05')).toEqual([])
  expect(JSON.stringify(failureEvents([...log, entry({})], undefined, '2026-10-05'))).not.toContain('/work/demo-app')
})

const tmOpen = (n: number) => entry({
  ts: n * 1000, day: `2026-11-${String(n).padStart(2, '0')}`, reason: 'mcp_error', plugin: 'teams', skill: undefined, tool: 'tm_open',
})

test('147b: seven tm_open errors plus a goal_failed and an is_error fold into 3 rows, newest first', () => {
  const log = [
    entry({ ts: 100, day: '2026-11-01' }),
    ...[9, 9, 9, 10, 10, 11, 11].map(tmOpen),
    entry({ ts: 20000, day: '2026-11-12', kind: 'outcome', reason: 'goal_failed', local: { path: '/w/demo-app' } }),
  ]
  const rows = foldRows(log)
  expect(rows.length).toBe(3)
  expect(rows.map(r => r.entry.reason)).toEqual(['goal_failed', 'mcp_error', 'is_error'])
  expect(rows[1]).toMatchObject({ count: 7 })
  expect(rows[1]?.entry.day).toBe('2026-11-11')
  expect(rows[0]?.count).toBe(1)
})

test('147b: the same reason with a different target stays two rows', () => {
  expect(foldRows([entry({}), entry({ skill: 'sql-pro' })]).length).toBe(2)
})

test('147b: the same target with a different reason stays two rows', () => {
  expect(foldRows([entry({}), entry({ reason: 'unsuccessful' })]).length).toBe(2)
})

test('147b: the same tool name under two plugins stays two rows', () => {
  const a = entry({ reason: 'mcp_error', plugin: 'teams', skill: undefined, tool: 'tm_open' })
  expect(foldRows([a, { ...a, plugin: 'graph' }]).length).toBe(2)
})

test('147b: one group with different text and session shows the newest entry and a count', () => {
  const old = entry({ ts: 1000, day: '2026-10-01', session: 'a', local: { text: 'old' } })
  const latest = entry({ ts: 9000, day: '2026-10-09', session: 'b', local: { text: 'new' } })
  expect(foldRows([latest, old])).toEqual([{ entry: latest, count: 2 }])
  expect(foldRows([entry({ ts: 1 }), entry({ ts: 2, skill: 'x' }), entry({ ts: 3, skill: 'y' })], 2).length).toBe(2)
})

test('147b: copyBody adds count only above 1', () => {
  expect(copyBody(entry({}))).not.toContain('count:')
  expect(copyBody(entry({}), 7)).toContain('count: 7')
})
