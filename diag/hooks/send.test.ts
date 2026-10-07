import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryStore, sessionAt } from './testkit.ts'
import { batchBody, buildBatch } from './logic.ts'

const NOW = Date.parse('2026-10-07T09:00:00Z')
const DAY = 86_400_000
const URL = 'https://us.i.posthog.com/batch/'
const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const
const PANE = {
  title: 'Diag', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {},
} as any

const entry = (day: string, o: object = {}) => ({
  ts: Date.parse(`${day}T08:00:00Z`), day, kind: 'bug', reason: 'is_error', plugin: 'develop',
  skill: 'clean-code', session: 'session-1', local: { text: 'raw' }, ...o,
})
// The one seed every consent case shares: due days, today (not due), no sentThrough.
const LOG = [
  entry('2026-10-05'),
  entry('2026-10-06', { reason: 'mcp_error', skill: undefined, tool: 'knowledge_get', plugin: 'knowledge' }),
  entry('2026-10-06', { kind: 'report', reason: 'user_report', skill: undefined, plugin: undefined, local: { note: 'n' } }),
  entry('2026-10-07'),
]
const SEED = { 'diag.installId': 'iid-1', 'diag.log': LOG }

type Trophy = { consent?: string; consentVersion?: number }
type Fetch = { url: string; body: string }
const OK = () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } })

// Plays the engine beneath diag and trophy: their atoms, the network, the clock. No real network.
const world = (on: On, trophy: Trophy, store: Record<string, unknown>) => {
  const mem = memoryStore(on, store)
  const clock = sessionAt(on, NOW)
  const mine = new Map<string, unknown>()
  on('state.get', (_$, e) => ({
    value: { value: e.plugin === 'trophy' ? (trophy as any)[e.key] : mine.get(e.key), version: 1 },
  }) as never)
  on('state.set', (_$, e) => {
    mine.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } } as never
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('turn.complete', () => ({ text: 'done' }))
  const fetches: Fetch[] = []
  const net = { reply: OK as () => any }
  on('http.fetch', (_$, e) => {
    fetches.push({ url: String(e.url), body: String(e.init?.body) })
    return net.reply()
  })
  return { mem, fetches, net, clock, mine }
}
const start = { cwd: '/w', surface: 'terminal' as const, isInteractive: true }

const CASES: [string, Trophy, number][] = [
  ['control: yes at version 2 on the shared seed posts one batch of diag events up to yesterday', { consent: 'yes', consentVersion: 2 }, 1],
  ['trophy absent on the shared seed fetches nothing', {}, 0],
  ['unasked on the shared seed fetches nothing', { consent: 'unasked', consentVersion: 2 }, 0],
  ['no on the shared seed fetches nothing', { consent: 'no', consentVersion: 2 }, 0],
  ['v1 yes on the shared seed fetches nothing', { consent: 'yes', consentVersion: 1 }, 0],
]
for (const [name, trophy, count] of CASES) {
  test(name, async ($, on) => {
    const { mem, fetches } = world(on, trophy, SEED)
    await $.session.start(start)
    await $.turn.complete(TURN)

    expect(fetches).toHaveLength(count)
    if (count === 0) {
      expect(mem.get('diag.sentThrough')).toBeUndefined()
      return
    }
    const body = JSON.parse(fetches[0].body)
    expect(fetches[0].url).toBe(URL)
    expect(body.batch.map((b: any) => b.event).sort()).toEqual(['diag_mcp_error', 'diag_skill_error', 'diag_user_report'])
    expect(body.batch.every((b: any) => b.distinct_id === 'iid-1' && b.properties.$process_person_profile === false)).toBe(true)
    expect(body.batch.map((b: any) => b.timestamp).sort()).toEqual(['2026-10-05T12:00:00Z', '2026-10-06T12:00:00Z', '2026-10-06T12:00:00Z'])
    expect(fetches[0].body).not.toContain('2026-10-07')
    expect(mem.get('diag.sentThrough')).toBe('2026-10-06')
  })
}

test('non-interactive session with carried-over active=true sends nothing', async ($, on) => {
  const { fetches, mine } = world(on, { consent: 'yes', consentVersion: 2 }, SEED)
  mine.set('active', true)
  await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
  await $.turn.complete(TURN)
  expect(fetches).toHaveLength(0)
})

test('sends once per session, on the first main-loop turn only', async ($, on) => {
  const { fetches } = world(on, { consent: 'yes', consentVersion: 2 }, SEED)
  await $.session.start(start)
  await $.turn.complete({ ...TURN, agentId: 'sub' } as never)
  expect(fetches).toHaveLength(0)
  await $.turn.complete(TURN)
  await $.turn.complete(TURN)
  expect(fetches).toHaveLength(1)
})

test('sentThrough advances only on 2xx', async ($, on) => {
  const { mem, fetches, net } = world(on, { consent: 'yes', consentVersion: 2 }, SEED)
  const snapshot = () => JSON.stringify([...mem])

  net.reply = () => ({ value: { status: 500, ok: false, headers: {}, text: '' } })
  await $.session.start(start)
  const before = snapshot()
  await expect($.turn.complete(TURN)).resolves.toEqual({ text: 'done' })
  expect(fetches).toHaveLength(1)
  expect(snapshot()).toBe(before)

  net.reply = () => ({ deny: 'offline' })
  await $.session.start(start)
  await expect($.turn.complete(TURN)).resolves.toEqual({ text: 'done' })
  expect(fetches).toHaveLength(2)
  expect(snapshot()).toBe(before)

  net.reply = OK
  await $.session.start(start)
  await $.turn.complete(TURN)
  expect(fetches).toHaveLength(3)
  expect(mem.get('diag.sentThrough')).toBe('2026-10-06')
})

test('pane preview equals the POSTed body for the same store, installId created before the first render', async ($, on) => {
  const { fetches } = world(on, { consent: 'yes', consentVersion: 2 }, { 'diag.log': LOG })
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'diag', surface: 'terminal', component: 'Pane', requestId: 'diag', props: PANE })
  const shown = JSON.stringify(await ui.drawn())
  await $.turn.complete(TURN)

  expect(fetches).toHaveLength(1)
  const id = JSON.parse(fetches[0].body).batch[0].distinct_id
  expect(id).not.toBe('')
  const preview = batchBody(buildBatch(LOG as any, undefined, '2026-10-06'), id)
  expect(fetches[0].body).toBe(preview)
  expect(shown).toContain(JSON.stringify(preview).slice(1, -1))
})

const MARKETPLACE = JSON.stringify({ plugins: [{ name: 'develop', source: './develop' }, { name: 'knowledge', source: './knowledge' }] })

test('end-to-end batch from real hooks carries no sentinel, path, slug, note, session or harness outcome', async ($, on) => {
  const { fetches, clock, mem } = world(on, { consent: 'yes', consentVersion: 2 }, {})
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('/.claude-plugin/marketplace.json')) return { value: MARKETPLACE } as never
    if (e.path.endsWith('/knowledge/.mcp.json')) return { value: JSON.stringify({ mcpServers: { 'knowledge-local': {} } }) } as never
    throw new Error('ENOENT')
  })
  on('fs.list', (_$, e) => ({
    value: (e.path.endsWith('/develop/skills') ? ['clean-code'] : []).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })),
  }) as never)
  on('classic.PostToolUseFailure', () => ({}))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('tool.call', { tool: 'Skill' }, () => ({
    result: { success: false, commandName: 'x', status: 'forked', agentId: 'a1', result: 'MODEL-RAW-SENTINEL' },
  }) as never)
  on('tool.call', { tool: 'Write' }, () => ({ result: { type: 'create' } }) as never)
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: 'x\nCOMPLETE slug-sentinel goal-gate FAIL (<90)\n', stderr: '' },
  }) as never)

  await $.session.start(start)
  await $.classic.PostToolUseFailure({
    tool_name: 'Skill', tool_input: { skill: 'develop:clean-code' }, tool_use_id: 't1', error: 'ERR-RAW-SENTINEL',
  } as never)
  await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' })
  await $.classic.PostToolUseFailure({
    tool_name: 'mcp__plugin_knowledge_knowledge-local__knowledge_get', tool_input: {}, tool_use_id: 't2',
    error: 'MCP-RAW-SENTINEL', mcp_server: { name: 'knowledge-local', source: 'plugin' },
  } as never)
  await $.tool.call({
    tool: 'Write', file_path: '/Users/kimsecret/.harness-run/slug-sentinel/subgoals/a/result.json', content: '{"passed":false}',
  })
  await $.tool.call({ tool: 'Bash', command: 'node .harness/fallback-check.mjs slug-sentinel' })
  await $.command.run({ command: 'diag', args: 'bug NOTE-RAW-SENTINEL src/secret-file.ts secret.ts' })

  await clock.advance(DAY) // what was recorded today is due tomorrow
  await $.turn.complete(TURN)

  expect(fetches).toHaveLength(1)
  const body = fetches[0].body
  const events = JSON.parse(body).batch.map((b: any) => b.event)
  for (const ev of ['diag_skill_error', 'diag_mcp_error', 'diag_user_report']) expect(events).toContain(ev)
  for (const bad of [
    'ERR-RAW-SENTINEL', 'MODEL-RAW-SENTINEL', 'MCP-RAW-SENTINEL', 'NOTE-RAW-SENTINEL', 'kimsecret', 'slug-sentinel',
    'src/secret-file.ts', 'secret.ts', '/Users/', 'session-1', 'harness', 'goal', 'subgoal',
  ]) expect(body).not.toContain(bad)
})
