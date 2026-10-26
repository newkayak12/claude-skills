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
// The band asks only once something is unlocked.
const UNLOCKED = { 'trophy.unlocked': { 'first-blood': '2026-10-06' } }
const run = ($: any, args: string) => $.command.run({ command: 'trophy-telemetry', args } as any)

test('a fresh store asks: one row, three buttons; [안 보내기] sets no and the band goes', async ($, on) => {
  const store = memoryStore(on, UNLOCKED)
  sessionAt(on)
  language(on, 'Korean')
  bottom(on)
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ key: 'send' })).toBeDefined()
  expect(await ui.find({ key: 'decline' })).toBeDefined()
  expect(await ui.find({ key: 'show' })).toBeDefined()
  expect(await ui.find({ text: /보내지 않는 것: 프롬프트 · 파일 경로 · 프로젝트\/작업 이름/ })).toBeDefined()
  await ui.press({ key: 'decline' })

  expect(store.get('trophy.consent')).toBe('no')
  expect(await ui.find({ key: 'decline' })).toBeUndefined()
})

test('by default the band asks in English with the same data listed and no Hangul', async ($, on) => {
  memoryStore(on, UNLOCKED)
  sessionAt(on)
  bottom(on)
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ text: /Send anonymous usage stats/ })).toBeDefined()
  expect(await ui.find({ text: /Never sent: prompts · file paths · project or task names/ })).toBeDefined()
  expect(await ui.find({ text: /[가-힣]/ })).toBeUndefined()
  for (const label of ['Send', "Don't send", 'Show contents']) expect(await ui.find({ label })).toBeDefined()
})

test('the consent band draws the band beneath it', async ($, on) => {
  memoryStore(on, UNLOCKED)
  sessionAt(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', (_$, e) => (e.component === 'AbovePrompt' ? { type: 'Text', children: ['engine band'] } : undefined) as any)
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ key: 'send' })).toBeDefined()
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
})

test('a start with nothing unlocked asks nothing; the first unlock brings the question', async ($, on) => {
  memoryStore(on)
  sessionAt(on)
  bottom(on)
  on('ui.toast', () => ({ value: undefined }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await ui.find({ key: 'send' })).toBeUndefined()

  await $.skill.prompt({ skill: 'think:grill', text: 'x' })

  expect(await ui.find({ key: 'send' })).toBeDefined()
})

test('nothing is asked in a non-interactive session', async ($, on) => {
  memoryStore(on)
  sessionAt(on).surfaces = []
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
  const store = memoryStore(on, UNLOCKED)
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
  ...UNLOCKED,
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
  expect(CONSENT_VERSION).toBe(3)
  expect(effectiveConsent('yes', CONSENT_VERSION)).toBe('yes')
  expect(effectiveConsent('yes', undefined)).toBe('unasked')
  expect(effectiveConsent('yes', 1)).toBe('unasked')
  expect(effectiveConsent('yes', 2)).toBe('unasked')
  expect(effectiveConsent('no', undefined)).toBe('no')
  expect(effectiveConsent('no', CONSENT_VERSION)).toBe('no')
  expect(effectiveConsent('unasked', CONSENT_VERSION)).toBe('unasked')
  expect(effectiveConsent(undefined, undefined)).toBe('unasked')
})

test('a stored v1 yes shows the band again and sends nothing', async ($, on) => {
  const f = fetching(on, { 'trophy.consent': 'yes' })
  language(on, 'Korean')
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ key: 'send' })).toBeDefined()
  expect(await ui.find({ text: /오류 코드/ })).toBeDefined()
  expect(await ui.find({ text: /OS 종류/ })).toBeDefined()
  expect(f.fetches).toHaveLength(0)
  expect(f.store.get('trophy.consent')).toBe('yes')
  expect(f.store.get('trophy.consentVersion')).toBeUndefined()
  expect((await run($, 'status')).text).toContain('unasked (이전 동의 — 재동의 필요)')
})

test('a stored v1 yes reports needs re-consent in English by default', async ($, on) => {
  fetching(on, { 'trophy.consent': 'yes' })
  await $.session.start(start)

  expect((await run($, 'status')).text).toContain('unasked (earlier yes — needs re-consent)')
})

test('answering the band writes yes and the current version', async ($, on) => {
  const f = fetching(on, { 'trophy.consent': 'yes' })
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  await ui.press({ key: 'send' })

  expect(f.store.get('trophy.consent')).toBe('yes')
  expect(f.store.get('trophy.consentVersion')).toBe(CONSENT_VERSION)
  expect(await ui.find({ key: 'send' })).toBeUndefined()
  expect((await run($, 'status')).text).toContain(`yes (v${CONSENT_VERSION})`)
})

test('a stored no is never re-asked and sends nothing', async ($, on) => {
  const f = fetching(on, { 'trophy.consent': 'no' })
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  expect(await ui.find({ key: 'send' })).toBeUndefined()
  expect(f.fetches).toHaveLength(0)
})

test('trophy-telemetry on writes the current version', async ($, on) => {
  const f = fetching(on, {})
  await $.session.start(start)

  await run($, 'on')
  expect(f.store.get('trophy.consentVersion')).toBe(CONSENT_VERSION)
  await run($, 'off')
  expect(f.store.get('trophy.consent')).toBe('no')
  expect(f.store.get('trophy.consentVersion')).toBe(CONSENT_VERSION)
})

test('a v3 yes sends', async ($, on) => {
  const f = fetching(on, { 'trophy.consent': 'yes', 'trophy.consentVersion': CONSENT_VERSION })
  await $.session.start(start)
  expect(f.fetches).toHaveLength(1)
})

test('a v2 yes reads as unasked and sends nothing', async ($, on) => {
  const f = fetching(on, { 'trophy.consent': 'yes', 'trophy.consentVersion': 2 })
  await $.session.start(start)
  expect(f.fetches).toHaveLength(0)
  expect((await run($, 'status')).text).toContain('unasked')
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
  const f = fetching(on, { 'trophy.consent': 'no', 'trophy.consentVersion': CONSENT_VERSION })
  await $.session.start(start)
  expect(f.fetches).toHaveLength(0)
})

test('the consent band stands out (double frame, every line whole) and draws its three buttons alike', async ($, on) => {
  memoryStore(on, UNLOCKED)
  sessionAt(on)
  bottom(on)
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  const frame = await ui.find({ key: 'consent' })
  expect(frame!.props.borderStyle).toBe('double')
  for (const text of [/Send anonymous usage stats/, /Sent: skill and tool names/, /Never sent/]) {
    expect((await ui.find({ text }))!.props.wrap).toBeUndefined()
  }
  for (const key of ['send', 'decline', 'show']) expect((await ui.find({ key }))!.props.variant).toBeUndefined()
})

test('the consent buttons carry hotkeys s/n/p, are drawn plain and none is primary; send sets yes', async ($, on) => {
  const store = memoryStore(on, UNLOCKED)
  sessionAt(on)
  bottom(on)
  await $.session.start(start)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })

  const buttons = await ui.findAll({ type: 'Button' })
  const by = (key: string) => buttons.find(b => b.key === key)!.props
  expect([by('send').hotkey, by('decline').hotkey, by('show').hotkey]).toEqual(['s', 'n', 'p'])
  for (const b of buttons) {
    expect(b.props.plain).toBe(true)
    expect(b.props.variant).toBeUndefined()
  }
  await ui.press({ key: 'send' })

  expect(store.get('trophy.consent')).toBe('yes')
})
