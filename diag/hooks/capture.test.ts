import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryStore, sessionAt } from './testkit.ts'

const MARKETPLACE = JSON.stringify({
  plugins: [
    { name: 'develop', source: './develop' },
    { name: 'knowledge', source: './knowledge' },
  ],
})
const SKILLS: Record<string, string[]> = { develop: ['clean-code', 'bug-diagnoser'], knowledge: [] }
const SERVERS: Record<string, string[]> = { knowledge: ['knowledge-local'] }
const SECRET = 'SECRET-free-text'
const GOOD = '/Users/a/proj/.harness-run/run1/subgoals/s4/result.json'

const start = (isInteractive: boolean) => ({
  cwd: '/work',
  surface: isInteractive ? ('terminal' as const) : null,
  isInteractive,
})

type World = { skill?: unknown; bash?: unknown; write?: unknown }

// The engine's own answers beneath the plugin; `w` picks what the tools answer.
const bottom = (on: On, w: World = {}) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('/.claude-plugin/marketplace.json')) return { value: MARKETPLACE } as never
    const m = /\/([a-z]+)\/\.mcp\.json$/.exec(e.path)
    if (m && SERVERS[m[1]!]) return { value: JSON.stringify({ mcpServers: { [SERVERS[m[1]!]![0]!]: {} } }) } as never
    throw new Error('ENOENT')
  })
  on('fs.list', (_$, e) => {
    const m = /\/([a-z]+)\/skills$/.exec(e.path)
    return { value: (SKILLS[m?.[1] ?? ''] ?? []).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) } as never
  })
  on('classic.PostToolUseFailure', () => ({}))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('tool.call', { tool: 'Skill' }, () => (w.skill ?? { result: { success: true, commandName: 'x' } }) as never)
  on('tool.call', { tool: 'Write' }, () => (w.write ?? { result: { type: 'create' } }) as never)
  on('tool.call', { tool: 'Bash' }, () => (w.bash ?? { result: { stdout: '', stderr: '' } }) as never)
}

type Logged = { reason: string; kind: string; plugin?: string; skill?: string; tool?: string; local: Record<string, string> }
const log = (store: Map<string, unknown>) => (store.get('diag.log') ?? []) as Logged[]

const boot = async ($: any, on: On, interactive = true, w: World = {}) => {
  const store = memoryStore(on)
  sessionAt(on)
  bottom(on, w)
  await $.session.start(start(interactive))
  return store
}

const fail = (o: object) => ({
  tool_name: 'Skill', tool_input: { skill: 'develop:clean-code' }, tool_use_id: 't1', error: 'boom', ...o,
}) as never

test('S1a owned skill failure is recorded once', async ($, on) => {
  const store = await boot($, on)
  await $.classic.PostToolUseFailure(fail({}))
  await $.classic.PostToolUseFailure(fail({}))
  expect(log(store).map(e => [e.kind, e.reason, e.plugin, e.skill, e.local])).toEqual([
    ['bug', 'is_error', 'develop', 'clean-code', { text: 'boom' }],
  ])
})

test('S1b unsuccessful and forked unsuccessful skill are recorded', async ($, on) => {
  const w: World = { skill: { result: { success: false, commandName: 'develop:clean-code' } } }
  const store = await boot($, on, true, w)
  await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' })
  w.skill = { result: { success: false, commandName: 'x', status: 'forked', agentId: 'a1', result: 'forked failed' } }
  await $.tool.call({ tool: 'Skill', skill: 'develop:bug-diagnoser' })
  expect(log(store).map(e => [e.kind, e.reason, e.skill, e.local.text])).toEqual([
    ['bug', 'unsuccessful', 'clean-code', undefined],
    ['bug', 'forked_unsuccessful', 'bug-diagnoser', 'forked failed'],
  ])
})

test('S5 owned mcp failure is recorded with raw text only under local', async ($, on) => {
  const store = await boot($, on)
  await $.classic.PostToolUseFailure(fail({
    tool_name: 'mcp__plugin_knowledge_knowledge-local__knowledge_get',
    tool_input: { q: SECRET },
    error: 'mcp down ' + SECRET,
    mcp_server: { name: 'knowledge-local', source: 'plugin' },
  }))
  const e = log(store)[0]!
  expect([e.kind, e.reason, e.plugin, e.tool]).toEqual(['bug', 'mcp_error', 'knowledge', 'knowledge_get'])
  expect(e.local.text).toBe('mcp down ' + SECRET)
  expect(JSON.stringify({ ...e, local: undefined })).not.toContain(SECRET)
})

test('S2a failing subgoal result.json is recorded as local outcome', async ($, on) => {
  const store = await boot($, on)
  await $.tool.call({ tool: 'Write', file_path: GOOD, content: '{"passed":false}' })
  await $.tool.call({ tool: 'Write', file_path: '/tmp/x/.harness-run/run1/subgoals/s4/result.json', content: '{"passed":false}' })
  await $.tool.call({ tool: 'Write', file_path: GOOD.replace('s4', 's5'), content: '{"passed":true}' })
  expect(log(store).map(e => [e.kind, e.reason, e.local])).toEqual([
    ['outcome', 'subgoal_failed', { slug: 'run1', subgoal: 's4', path: GOOD }],
  ])
})

test('S2b goal-gate FAIL from fallback-check is recorded as local outcome', async ($, on) => {
  const w: World = { bash: { result: { stdout: 'x\nCOMPLETE run1 goal-gate FAIL\n', stderr: '' } } }
  const store = await boot($, on, true, w)
  await $.tool.call({ tool: 'Bash', command: 'node .harness/fallback-check.mjs run1' })
  await $.tool.call({ tool: 'Bash', command: 'echo COMPLETE run1 goal-gate FAIL' })
  expect(log(store).map(e => [e.kind, e.reason, e.local])).toEqual([['outcome', 'goal_failed', { slug: 'run1' }]])
})

test('S4 diag bug records the note under local with the last skill', async ($, on) => {
  const store = await boot($, on)
  const usage = await $.command.run({ command: 'diag', args: 'bug' } as never)
  expect((usage as { text: string }).text).toMatch(/^usage: \/diag bug <note>/)
  expect(log(store)).toEqual([])
  await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' })
  await $.command.run({ command: 'diag', args: 'bug it hangs ' + SECRET } as never)
  const e = log(store)[0]!
  expect([e.kind, e.reason, e.plugin, e.skill, e.local.note]).toEqual(['report', 'user_report', 'develop', 'clean-code', 'it hangs ' + SECRET])
  expect(JSON.stringify({ ...e, local: undefined })).not.toContain(SECRET)
})

test('typed /plugin:free text never becomes the last skill or any sent field', async ($, on) => {
  const store = await boot($, on)
  await $.prompt.submit({ text: `/develop:${SECRET} please`, wait: false, origin: { kind: 'composer' } } as never)
  await $.command.run({ command: 'diag', args: 'bug n1' } as never)
  await $.prompt.submit({ text: '/develop:clean-code', wait: false, origin: { kind: 'composer' } } as never)
  await $.command.run({ command: 'diag', args: 'bug n2' } as never)
  const [a, b] = log(store) as [Logged, Logged]
  expect([a.skill, a.plugin]).toEqual([undefined, undefined])
  expect([b.skill, b.plugin]).toEqual(['clean-code', 'develop'])
  expect(JSON.stringify(log(store).map(e => ({ ...e, local: undefined })))).not.toContain(SECRET)
})

test('interrupted call records nothing', async ($, on) => {
  const store = await boot($, on)
  await $.classic.PostToolUseFailure(fail({ is_interrupt: true, error: 'The user doesn\'t want to proceed' }))
  await $.classic.PostToolUseFailure(fail({
    tool_name: 'mcp__plugin_knowledge_knowledge-local__knowledge_get',
    is_interrupt: true,
    mcp_server: { name: 'knowledge-local', source: 'plugin' },
  }))
  expect(log(store)).toEqual([])
})

test('non-owned, foreign, successful and denied calls record nothing', async ($, on) => {
  const w: World = {}
  const store = await boot($, on, true, w)
  await $.classic.PostToolUseFailure(fail({ tool_input: { skill: 'clean-code' } }))
  await $.classic.PostToolUseFailure(fail({ tool_input: { skill: 'superpowers:brainstorming' } }))
  await $.classic.PostToolUseFailure(fail({ tool_input: { skill: `develop:${SECRET}` } }))
  await $.classic.PostToolUseFailure(fail({
    tool_name: 'mcp__plugin_knowledge_knowledge-local__knowledge_get',
    mcp_server: { name: 'knowledge-local', source: 'user' },
  }))
  await $.classic.PostToolUseFailure(fail({
    tool_name: 'mcp__plugin_teams_other__x',
    mcp_server: { name: 'other', source: 'plugin' },
  }))
  await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' }) // success
  w.skill = { result: { success: false, commandName: 'x' } }
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:brainstorming' }) // foreign
  await $.tool.call({ tool: 'Skill', skill: 'clean-code' }) // bare
  w.skill = { deny: 'no' }
  await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' }) // denied
  w.write = { deny: 'no' }
  await $.tool.call({ tool: 'Write', file_path: GOOD, content: '{"passed":false}' })
  expect(log(store)).toEqual([])
})

test('non-interactive session records nothing', async ($, on) => {
  const w: World = { skill: { result: { success: false, commandName: 'x' } } }
  const store = await boot($, on, false, w)
  await $.classic.PostToolUseFailure(fail({}))
  await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' })
  await $.tool.call({ tool: 'Write', file_path: GOOD, content: '{"passed":false}' })
  expect([...store.keys()]).toEqual([])
})

// The engine copies a result across its own boundary, so identity cannot be observed from `$`;
// a deep-frozen answer makes any mutation or replacement by the hook throw or show as a diff.
const frozen = <T extends object>(v: T): T => {
  for (const k of Object.values(v)) if (k && typeof k === 'object') frozen(k)
  return Object.freeze(v)
}

test('result is returned unchanged by reference', async ($, on) => {
  const failed = frozen({ result: { success: false, commandName: 'x' } })
  const store = await boot($, on, true, { skill: failed })
  const out = await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' })
  expect(log(store).length).toBe(1)
  expect(out).toEqual(failed)
  const back = await $.classic.PostToolUseFailure(fail({}))
  expect(back).toEqual({})
})

test('a throwing store does not change the result', async ($, on) => {
  const failed = frozen({ result: { success: false, commandName: 'x' } })
  const store = await boot($, on, true, { skill: failed })
  store.broken = true
  const out = await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' })
  expect(out).toEqual(failed)
  await $.classic.PostToolUseFailure(fail({}))
})
