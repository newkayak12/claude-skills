import { test, expect } from 'claude-code/testing'

import { memoryState, memoryStore } from './testkit.ts'

const start = (isInteractive: boolean) => ({
  cwd: '/work',
  surface: isInteractive ? ('terminal' as const) : null,
  isInteractive,
})

const boot = (on: any) => {
  memoryStore(on)
  const cells = memoryState(on)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  const registered: string[] = []
  on('command.register', (_$: any, e: any) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  return { registered, cells }
}

test('non-interactive start registers no command', async ($, on) => {
  const { registered } = boot(on)

  await $.session.start(start(false))

  expect(registered).toEqual([])
})

test('interactive start registers /session and sets defaults', async ($, on) => {
  const { registered, cells } = boot(on)

  await $.session.start(start(true))

  expect(registered).toEqual(['memo', 'session-denials', 'smart-compact', 'session'])
  expect(cells.get('session.tab')).toBe('retro')
  expect(cells.get('session.band')).toBe(false)
})

test('a second start keeps what the first left', async ($, on) => {
  const { cells } = boot(on)
  await $.session.start(start(true))
  cells.set('session.tab', 'orphans')

  await $.session.start(start(true))

  expect(cells.get('session.tab')).toBe('orphans')
})
