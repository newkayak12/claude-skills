import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CONSENT_VERSION, effectiveConsent } from './logic.ts'
import { language, memoryStore, sessionAt } from './testkit.ts'

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
  language(on, 'Korean')
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

test('by default the band asks in English with the same data listed and no Hangul', async ($, on) => {
  memoryStore(on)
  sessionAt(on)
  bottom(on)
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ text: /Send anonymous usage stats/ })).toBeDefined()
  expect(await ui.find({ text: /no prompts or paths/ })).toBeDefined()
  expect(await ui.find({ text: /[가-힣]/ })).toBeUndefined()
  for (const label of ['Send', "Don't send", 'Show contents']) expect(await ui.find({ label })).toBeDefined()
})

test('the consent band draws the band beneath it', async ($, on) => {
  memoryStore(on)
  sessionAt(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', (_$, e) => (e.component === 'AbovePrompt' ? { type: 'Text', children: ['engine band'] } : undefined) as any)
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ key: 'send' })).toBeDefined()
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
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

// One seed for every fetch case: due days, sentThrough unset, so the batch is never empty.
const SEED = {
  'trophy.installId': 'install-1',
  'trophy.uses': [{ skill: 'think:grill', plugin: 'think', day: '2026-10-06', session: 's', ts: 1 }],
}
const fetching = (on: On, consent: Record<string, unknown>) => {
  const store = memoryStore(on, { ...SEED, ...consent })
  sessionAt(on)
  const fetches: string[] = []
  on('http.fetch', (_$, e) => {
    fetches.push(String(e.init?.body))
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
  on('fs.write', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: {} } as any }))
  bottom(on)
  return { store, fetches }
}

test('effectiveConsent maps stored answer and version', () => {
  expect(CONSENT_VERSION).toBe(2)
  expect(effectiveConsent('yes', 2)).toBe('yes')
  expect(effectiveConsent('yes', undefined)).toBe('unasked')
  expect(effectiveConsent('yes', 1)).toBe('unasked')
  expect(effectiveConsent('no', undefined)).toBe('no')
  expect(effectiveConsent('no', 2)).toBe('no')
  expect(effectiveConsent('unasked', 2)).toBe('unasked')
  expect(effectiveConsent(undefined, undefined)).toBe('unasked')
})

test('a stored v1 yes shows the band again and sends nothing', async ($, on) => {
  const f = fetching(on, { 'trophy.consent': 'yes' })
  language(on, 'Korean')
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ key: 'send' })).toBeDefined()
  expect(await ui.find({ text: /오류 코드만/ })).toBeDefined()
  expect(f.fetches).toHaveLength(0)
  expect(f.store.get('trophy.consent')).toBe('yes')
  expect(f.store.get('trophy.consentVersion')).toBeUndefined()
  expect((await run($, 'status')).text).toContain('unasked (v1 yes — 재동의 필요)')
})

test('a stored v1 yes reports needs re-consent in English by default', async ($, on) => {
  fetching(on, { 'trophy.consent': 'yes' })
  await $.session.start(start)

  expect((await run($, 'status')).text).toContain('unasked (v1 yes — needs re-consent)')
})

test('answering the band writes yes and version 2', async ($, on) => {
  const f = fetching(on, { 'trophy.consent': 'yes' })
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  await ui.press({ key: 'send' })

  expect(f.store.get('trophy.consent')).toBe('yes')
  expect(f.store.get('trophy.consentVersion')).toBe(2)
  expect(await ui.find({ key: 'send' })).toBeUndefined()
  expect((await run($, 'status')).text).toContain('yes (v2)')
})

test('a stored no is never re-asked and sends nothing', async ($, on) => {
  const f = fetching(on, { 'trophy.consent': 'no' })
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ key: 'send' })).toBeUndefined()
  expect(f.fetches).toHaveLength(0)
})

test('trophy-telemetry on writes version 2', async ($, on) => {
  const f = fetching(on, {})
  await $.session.start(start)

  await run($, 'on')
  expect(f.store.get('trophy.consentVersion')).toBe(2)
  await run($, 'off')
  expect(f.store.get('trophy.consent')).toBe('no')
  expect(f.store.get('trophy.consentVersion')).toBe(2)
})

test('control: yes at version 2 on the shared seed fetches once', async ($, on) => {
  const f = fetching(on, { 'trophy.consent': 'yes', 'trophy.consentVersion': 2 })
  await $.session.start(start)
  expect(f.fetches).toHaveLength(1)
})

test('yes with no version on the shared seed fetches nothing', async ($, on) => {
  const f = fetching(on, { 'trophy.consent': 'yes' })
  await $.session.start(start)
  expect(f.fetches).toHaveLength(0)
})

test('yes at version 1 on the shared seed fetches nothing', async ($, on) => {
  const f = fetching(on, { 'trophy.consent': 'yes', 'trophy.consentVersion': 1 })
  await $.session.start(start)
  expect(f.fetches).toHaveLength(0)
})

test('no on the shared seed fetches nothing', async ($, on) => {
  const f = fetching(on, { 'trophy.consent': 'no', 'trophy.consentVersion': 2 })
  await $.session.start(start)
  expect(f.fetches).toHaveLength(0)
})
