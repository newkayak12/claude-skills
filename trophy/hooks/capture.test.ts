import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { countOutcome } from './mod'
import { memoryStore, sessionAt } from './testkit.ts'

const MARKETPLACE = JSON.stringify({
  plugins: [
    { name: 'graph', source: './graph', version: '1.2.3' },
    { name: 'knowledge', source: './knowledge', version: '0.4.0' },
  ],
})
const SERVERS: Record<string, string> = { graph: 'graph-engineering', knowledge: 'knowledge-local' }
const START = { cwd: '/w', surface: 'terminal', isInteractive: true } as const
const DAY = 86_400_000
const GRAPH_STATUS = 'mcp__plugin_graph_graph-engineering__graph_status'
const KNOWLEDGE_STATUS = 'mcp__plugin_knowledge_knowledge-local__knowledge_status'
const OTHER = 'mcp__plugin_superpowers_x__y'
const PROMPT = { wait: false, origin: { kind: 'composer' } } as any

type World = { throws?: boolean; mcp?: unknown; home?: string; userprofile?: string; emit?: { plugin: string; value: unknown }; wrote?: unknown }
const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

const bottom = (on: On, w: World = {}) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('/.claude-plugin/marketplace.json')) return { value: MARKETPLACE } as never
    const m = /\/([a-z]+)\/\.mcp\.json$/.exec(e.path)
    if (m && SERVERS[m[1]!]) return { value: JSON.stringify({ mcpServers: { [SERVERS[m[1]!]!]: {} } }) } as never
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [] }) as never)
  on('fs.write', () => ({ value: undefined }))
  on('session.version', () => ({ value: { version: '2.1.296', base: '2.1.296' } }) as never)
  on('session.usage', () => ({ deny: 'no usage' }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? w.home : e.name === 'USERPROFILE' ? w.userprofile : undefined }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', (_$, e) => {
    if (w.throws) throw new Error('interrupted')
    return (e.tool === 'Skill' ? { result: { success: true } } : (w.mcp ?? { ref: 1, result: '{}', text: '{}' })) as never
  })
  // a producer's write, raised from a hook beneath trophy so it crosses trophy's state.set chain
  // a producer's outcome, handed to trophy's counter from a hook beneath it (a test cannot raise another plugin's state.set)
  on('turn.complete', async $ => {
    if (w.emit) await countOutcome($ as any, w.emit.plugin as any, w.emit.value)
    return { text: 'done' }
  })
}

const boot = async ($: any, on: On, w: World = { home: '/Users/a' }, interactive = true) => {
  const store = memoryStore(on)
  const clock = sessionAt(on, Date.parse('2026-10-13T09:00:00Z'))
  current = w
  bottom(on, w)
  await $.session.start({ ...START, isInteractive: interactive, surface: interactive ? 'terminal' : null })
  return { store, clock, w }
}

const mcp = (store: Map<string, unknown>) => store.get('trophy.mcpCalls') as any
const out = (store: Map<string, unknown>) => store.get('trophy.outcomes') as any

test('an interactive start writes versions[day] and one session, with the OS label', async ($, on) => {
  const { store } = await boot($, on)
  expect(store.get('trophy.versions')).toEqual({ '2026-10-13': { graph: '1.2.3', knowledge: '0.4.0' } })
  expect(store.get('trophy.activity')).toEqual({ '2026-10-13': { '2.1.296|darwin': 1 } })
})

test('a prompt on a later day marks that day active with 0 sessions, once', async ($, on) => {
  const { store, clock } = await boot($, on)
  await $.prompt.submit({ text: 'a', ...PROMPT })
  expect(store.get('trophy.activity')).toEqual({ '2026-10-13': { '2.1.296|darwin': 1 } })
  await clock.advance(DAY)
  await $.prompt.submit({ text: 'b', ...PROMPT })
  await $.prompt.submit({ text: 'c', ...PROMPT })
  expect(store.get('trophy.activity')).toEqual({
    '2026-10-13': { '2.1.296|darwin': 1 },
    '2026-10-14': { '2.1.296|darwin': 0 },
  })
})

test('a non-interactive session records nothing', async ($, on) => {
  const { store } = await boot($, on, { home: '/Users/a' }, false)
  await $.tool.call({ tool: GRAPH_STATUS } as any)
  expect([...store.keys()].filter(k => /versions|activity|mcpCalls|outcomes/.test(k))).toEqual([])
})

test('an owned MCP call counts ok without isError and error with it; the result is returned unchanged', async ($, on) => {
  const { store, w } = await boot($, on)
  const ok = { ref: 1, result: '{"a":1}', text: '{"a":1}' }
  w.mcp = ok
  expect(await $.tool.call({ tool: GRAPH_STATUS } as any)).toEqual(ok)
  const bad = { ref: 2, result: 'Error: x', text: 'x', isError: true }
  w.mcp = bad
  expect(await $.tool.call({ tool: GRAPH_STATUS } as any)).toEqual(bad)
  w.mcp = ok
  await $.tool.call({ tool: KNOWLEDGE_STATUS } as any)
  expect(mcp(store)).toEqual({
    '2026-10-13': {
      'graph|graph_status': { ok: 1, error: 1 },
      'knowledge|knowledge_status': { ok: 1, error: 0 },
    },
  })
})

test('an un-owned or non-plugin MCP tool records nothing', async ($, on) => {
  const { store } = await boot($, on)
  await $.tool.call({ tool: OTHER } as any)
  await $.tool.call({ tool: 'mcp__github__list' } as any)
  expect(mcp(store)).toBeUndefined()
})

test('a throw from next counts nothing and propagates', async ($, on) => {
  const { store, w } = await boot($, on)
  w.throws = true
  await $.tool.call({ tool: GRAPH_STATUS } as any).catch(() => {})
  expect(mcp(store)).toBeUndefined()
})

test('a broken store never changes an MCP result', async ($, on) => {
  const { store, w } = await boot($, on)
  const ok = { ref: 1, result: '{}', text: '{}' }
  w.mcp = ok
  store.broken = true
  expect(await $.tool.call({ tool: GRAPH_STATUS } as any)).toEqual(ok)
})

let current: World = {}
const setOutcome = async ($: any, plugin: string, value: unknown) => {
  current.emit = { plugin, value }
  await $.turn.complete(TURN)
  return current.wrote
}

test('a mismatched system, a bad outcome or a non-object reaches no count; producers absent leaves outcomes empty', async ($, on) => {
  const { store } = await boot($, on)
  expect(out(store)).toBeUndefined()
  await setOutcome($, 'graph', { system: 'teams', outcome: 'pass', at: 1 })
  await setOutcome($, 'graph', { system: 'graph', outcome: 'partial', at: 1 })
  await setOutcome($, 'graph', 'pass')
  expect(out(store)).toBeUndefined()
})
