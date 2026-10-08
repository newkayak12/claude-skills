import { test, expect } from 'claude-code/testing'

import { bash, denial, guardWorld, ran } from './testkit.ts'

const KEY = 'session.denials'
const stored = (seen: ReturnType<typeof guardWorld>) => (seen.store.get(KEY) ?? []) as any[]

test('a declined confirm stores one entry with every field', async ($, on) => {
  const seen = guardWorld(on, { answer: 'Cancel' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf /', agentId: 'ag1' } as never)
  const list = stored(seen)
  expect(list).toHaveLength(1)
  expect(list[0]).toMatchObject({ tool: 'Bash', call: 'rm -rf /', source: 'declined', agentId: 'ag1' })
  expect(typeof list[0].id).toBe('string')
  expect(typeof list[0].ts).toBe('number')
  expect(list[0].reason).toMatch(/declined/)
})

test('a guard deny stores source guard', async ($, on) => {
  const seen = guardWorld(on, { proc: argv => ran(argv.includes('status') ? ' M a.ts\n' : '') })
  await bash($, 'git worktree remove --force /wt/x')
  expect(stored(seen)).toHaveLength(1)
  expect(stored(seen)[0]).toMatchObject({ source: 'guard', tool: 'Bash' })
})

test('a native deny verdict is stored with nativeRule; the observer returns next(e) value', async ($, on) => {
  const seen = guardWorld(on)
  on('tool.check', () => ({ decision: 'deny', reason: 'rule says no', rule: 'Bash(curl:*)' }))
  const r = await $.tool.check({ tool: 'Bash', input: { command: 'curl x' } } as never)
  expect(r).toMatchObject({ decision: 'deny', reason: 'rule says no', rule: 'Bash(curl:*)' })
  expect(stored(seen)).toHaveLength(1)
  expect(stored(seen)[0]).toMatchObject({ source: 'native', nativeRule: 'Bash(curl:*)', reason: 'rule says no', tool: 'Bash' })
})

test('an allow verdict stores nothing', async ($, on) => {
  const seen = guardWorld(on)
  on('tool.check', () => ({ decision: 'allow' }))
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } } as never)
  expect(stored(seen)).toHaveLength(0)
})

test('tokens and NAME=value pairs never reach the store', async ($, on) => {
  const seen = guardWorld(on, { answer: 'Cancel' })
  await bash($, 'API_KEY=hunter2 TOKEN=ghp_abcdef1234567890 rm -rf /')
  const json = JSON.stringify([...seen.store.entries()])
  expect(json).not.toMatch(/hunter2/)
  expect(json).not.toMatch(/ghp_/)
  expect(stored(seen)).toHaveLength(1)
})

test('Write content is never stored; the call is the path', async ($, on) => {
  const seen = guardWorld(on, { answer: 'Cancel' })
  await $.tool.call({ tool: 'Write', file_path: '/proj/.env', content: 'SUPER_SECRET_VALUE' } as never)
  const json = JSON.stringify([...seen.store.entries()])
  expect(json).not.toMatch(/SUPER_SECRET_VALUE/)
  expect(stored(seen)[0]).toMatchObject({ tool: 'Write', call: '/proj/.env' })
})

test('the 201st entry evicts the oldest', async ($, on) => {
  const old = Array.from({ length: 200 }, (_, i) => ({ id: `old-${i}`, ts: i, tool: 'Bash', call: 'x', reason: 'r', source: 'guard' }))
  const seen = guardWorld(on, { answer: 'Cancel', store: { [KEY]: old } })
  await bash($, 'rm -rf /')
  const list = stored(seen)
  expect(list).toHaveLength(200)
  expect(list[0].id).toBe('old-1')
  expect(list[199].source).toBe('declined')
})

test('a reload re-hydrates the state from the store', async ($, on) => {
  const kept = [{ id: 'a', ts: 5, tool: 'Bash', call: 'rm -rf /', reason: 'r', source: 'guard' }]
  const seen = guardWorld(on, { store: { [KEY]: kept } })
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  expect((seen.cells.get('session.guard') as any).denials).toEqual(kept)
})

test('a broken store leaves the verdict unchanged', async ($, on) => {
  const seen = guardWorld(on, { answer: 'Cancel' })
  seen.store.broken = true
  expect(denial(await bash($, 'rm -rf /'))).toMatch(/declined/)
  expect(seen.store.writes).toBe(0)
})

test('headless records nothing, guard or native', async ($, on) => {
  const seen = guardWorld(on, { surfaces: [] })
  on('tool.check', () => ({ decision: 'deny', reason: 'no', rule: 'r' }))
  await bash($, 'rm -rf /')
  await $.tool.check({ tool: 'Bash', input: { command: 'x' } } as never)
  expect(seen.store.writes).toBe(0)
})

test('log_enabled=false records nothing but still denies', { options: { log_enabled: false } }, async ($, on) => {
  const seen = guardWorld(on, { answer: 'Cancel' })
  expect(denial(await bash($, 'rm -rf /'))).toMatch(/declined/)
  expect(seen.store.writes).toBe(0)
})
