import { test, expect } from 'claude-code/testing'

import { addMcp, buildBatch, ownedMcpByName } from './logic.ts'
import type { BatchStore } from './logic.ts'

const SERVERS = {
  graph: ['graph-engineering'],
  teams: ['teams-engineering', 'task-manager'],
  knowledge: ['knowledge-local'],
}

test('addMcp counts ok and error per plugin|tool per day', () => {
  let c = addMcp({}, '2026-10-12', 'graph', 'graph_status', 'ok')
  c = addMcp(c, '2026-10-12', 'graph', 'graph_status', 'ok')
  c = addMcp(c, '2026-10-12', 'graph', 'graph_status', 'error')
  c = addMcp(c, '2026-10-13', 'teams', 'tm_open', 'ok')
  expect(c).toEqual({
    '2026-10-12': { 'graph|graph_status': { ok: 2, error: 1 } },
    '2026-10-13': { 'teams|tm_open': { ok: 1, error: 0 } },
  })
})

test('ownedMcpByName matches by name prefix only', () => {
  expect(ownedMcpByName('mcp__plugin_graph_graph-engineering__graph_status', SERVERS)).toEqual({
    plugin: 'graph', server: 'graph-engineering', tool: 'graph_status',
  })
  expect(ownedMcpByName('mcp__plugin_teams_task-manager__tm_open', SERVERS)).toEqual({
    plugin: 'teams', server: 'task-manager', tool: 'tm_open',
  })
  expect(ownedMcpByName('mcp__plugin_other_srv__x', SERVERS)).toBeUndefined()
  expect(ownedMcpByName('mcp__github__list_issues', SERVERS)).toBeUndefined()
  expect(ownedMcpByName('mcp__plugin_graph_nope__graph_status', SERVERS)).toBeUndefined()
  expect(ownedMcpByName(undefined, SERVERS)).toBeUndefined()
})

test('mcp_tool_result carries the plugin version of the day and exactly its keys', () => {
  const store: BatchStore = {
    installId: 'i', uses: [], triggers: {}, unlocked: {}, errors: [], plugins: {}, failures: [],
    versions: { '2026-10-10': { graph: '1.2.3' } },
    mcpCalls: {
      '2026-10-12': { 'graph|graph_status': { ok: 2, error: 1 }, 'knowledge|knowledge_status': { ok: 1, error: 0 } },
    },
  }
  const events = buildBatch(store, '2026-10-12').batch.filter(e => e.event === 'mcp_tool_result')
  expect(events.map(e => e.properties)).toEqual([
    { day: '2026-10-12', plugin: 'graph', tool: 'graph_status', ok: 2, error: 1, plugin_version: '1.2.3', $process_person_profile: false },
    { day: '2026-10-12', plugin: 'knowledge', tool: 'knowledge_status', ok: 1, error: 0, $process_person_profile: false },
  ])
})
