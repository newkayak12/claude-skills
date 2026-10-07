import { test, expect } from 'claude-code/testing'

import { memoryStore } from './testkit.ts'

const start = (isInteractive: boolean) => ({
  cwd: '/work',
  surface: isInteractive ? ('terminal' as const) : null,
  isInteractive,
})

test('non-interactive start registers nothing and stores nothing', async ($, on) => {
  const store = memoryStore(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })

  await $.session.start(start(false))

  expect(registered).toEqual([])
  expect([...store.keys()]).toEqual([])
})

test('interactive start registers diag and sets an installId once', async ($, on) => {
  const store = memoryStore(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })

  await $.session.start(start(true))
  const id = store.get('diag.installId')
  await $.session.start(start(true))

  expect(registered).toEqual(['diag', 'diag'])
  expect(String(id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  expect(store.get('diag.installId')).toBe(id)
})
