import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryStore, sessionAt } from './testkit.ts'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 100 } as any

const bottom = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  // the engine's own empty band, drawn when the plugin passes
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as any)
}
const start = { cwd: '/w', surface: 'terminal', isInteractive: true } as const
const run = ($: any, args: string) => $.command.run({ command: 'trophy-telemetry', args } as any)

test('a fresh store asks: one row, three buttons; [안 보내기] sets no and the band goes', async ($, on) => {
  const store = memoryStore(on)
  sessionAt(on)
  bottom(on)
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ key: 'send' })).toBeDefined()
  expect(await ui.find({ key: 'decline' })).toBeDefined()
  expect(await ui.find({ key: 'show' })).toBeDefined()
  expect(await ui.find({ text: /프롬프트·경로 없음/ })).toBeDefined()
  await ui.press({ key: 'decline' })

  expect(store.get('trophy.consent')).toBe('no')
  expect(await ui.find({ key: 'decline' })).toBeUndefined()
})

test('nothing is asked in a non-interactive session', async ($, on) => {
  memoryStore(on)
  sessionAt(on)
  bottom(on)
  await $.session.start({ ...start, surface: null, isInteractive: false })
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ key: 'send' })).toBeUndefined()
})

test('/trophy-telemetry on, off and status; only these and [보내기] set yes', async ($, on) => {
  const store = memoryStore(on)
  sessionAt(on)
  bottom(on)
  await $.session.start(start)
  expect(store.get('trophy.consent')).toBeUndefined()

  expect((await run($, 'status')).text).toContain('unasked')
  expect((await run($, 'on')).text).toContain('yes')
  expect(store.get('trophy.consent')).toBe('yes')
  expect((await run($, 'off')).text).toContain('no')
  expect((await run($, 'status')).text).toContain('no')
  expect((await run($, 'maybe')).text).toMatch(/on\|off\|status/)
  expect(store.get('trophy.consent')).toBe('no')
})

test('[보내기] sets yes', async ($, on) => {
  const store = memoryStore(on)
  sessionAt(on)
  bottom(on)
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  await ui.press({ key: 'send' })

  expect(store.get('trophy.consent')).toBe('yes')
})
