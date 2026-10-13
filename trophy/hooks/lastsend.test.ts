import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CONSENT_VERSION } from './logic.ts'
import { memoryStore, sessionAt } from './testkit.ts'

const DAY = 86_400_000
const TODAY = Date.parse('2026-10-07T09:00:00Z')
const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const
const BAND = { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 100 } as any

const SEED = {
  'trophy.installId': 'install-1',
  'trophy.uses': [{ skill: 'think:grill', plugin: 'think', day: '2026-10-06', session: 's', ts: 1 }],
  'trophy.unlocked': { 'first-think': '2026-10-06' },
}

const fixture = (on: On, seed: Record<string, unknown> = {}, status = 200) => {
  const store = memoryStore(on, { ...SEED, ...seed })
  const clock = sessionAt(on, TODAY)
  const fetches: string[] = []
  const answer = { status, throws: undefined as string | undefined, delay: false }
  on('http.fetch', async (_$, e) => {
    fetches.push(String(e.init?.body))
    if (answer.throws) return { deny: answer.throws }
    if (answer.delay) await new Promise(r => setTimeout(r, 20))
    return { value: { status: answer.status, ok: answer.status === 200, headers: {}, text: '{}' } }
  })
  const toasts: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as any).text ?? (e as any).message ?? JSON.stringify(e)))
    return { value: undefined }
  })
  on('fs.write', () => ({ value: undefined }))
  on('session.usage', () => ({ deny: 'no usage' }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as any)
  return { store, clock, fetches, answer, toasts }
}

const YES = { 'trophy.consent': 'yes', 'trophy.consentVersion': CONSENT_VERSION }
const run = ($: any, args: string) => $.command.run({ command: 'trophy-telemetry', args } as any)
const last = (store: Map<string, unknown>) => store.get('trophy.lastSend') as any

test('a 200 send stores lastSend ok with events and no status key', async ($, on) => {
  const f = fixture(on, YES)
  await $.session.start(START)
  expect(last(f.store).result).toBe('ok')
  expect(last(f.store).events).toBeGreaterThan(0)
  expect(last(f.store).through).toBe('2026-10-06')
  expect(last(f.store).from).toBeNull()
  expect('status' in last(f.store)).toBe(false)
})

test('a 500 leaves sentThrough alone and records http_500', async ($, on) => {
  const f = fixture(on, YES, 500)
  await $.session.start(START)
  expect(f.store.get('trophy.sentThrough')).toBeUndefined()
  expect(last(f.store).result).toBe('http_500')
})

test('a throwing fetch records error with a scrubbed message', async ($, on) => {
  const f = fixture(on, YES)
  f.answer.throws = 'offline at /Users/kim/x.ts'
  await $.session.start(START)
  expect(last(f.store).result).toBe('error')
  expect(last(f.store).error).not.toContain('/Users/')
  expect(f.store.get('trophy.sentThrough')).toBeUndefined()
})

test('an empty batch records empty with no fetch', async ($, on) => {
  const f = fixture(on, { ...YES, 'trophy.uses': [], 'trophy.unlocked': {} })
  await $.session.start(START)
  expect(f.fetches).toHaveLength(0)
  expect(last(f.store).result).toBe('empty')
  expect(last(f.store).events).toBe(0)
})

test('on after a real send the same day fetches nothing, keeps lastSend and says nothing due', async ($, on) => {
  const f = fixture(on, YES)
  await $.session.start(START)
  const before = JSON.parse(JSON.stringify(last(f.store)))
  const text = (await run($, 'on')).text
  expect(f.fetches).toHaveLength(1)
  expect(last(f.store)).toEqual(before)
  expect(text).toContain('nothing due')
  expect(text).toContain('2026-10-06')
})

test('on with days due makes one fetch, and a session start right after none', async ($, on) => {
  const f = fixture(on, { 'trophy.consent': 'no', 'trophy.consentVersion': CONSENT_VERSION })
  await $.session.start(START)
  expect(f.fetches).toHaveLength(0)
  const text = (await run($, 'on')).text
  expect(f.fetches).toHaveLength(1)
  expect(text).toContain('sent')
  await $.session.start(START)
  expect(f.fetches).toHaveLength(1)
})

test('two concurrent sends make one fetch', async ($, on) => {
  const f = fixture(on, { 'trophy.consent': 'no', 'trophy.consentVersion': CONSENT_VERSION })
  f.answer.delay = true
  await $.session.start(START)
  await Promise.all([run($, 'on'), run($, 'on')])
  expect(f.fetches).toHaveLength(1)
})

test('off never fetches', async ($, on) => {
  const f = fixture(on, YES)
  f.store.set('trophy.sentThrough', '2026-10-06')
  await $.session.start(START)
  await run($, 'off')
  await f.clock.advance(DAY)
  await $.session.start(START)
  expect(f.fetches).toHaveLength(0)
})

test('the band Send sends once and toasts one line', async ($, on) => {
  const f = fixture(on, { 'trophy.consentVersion': CONSENT_VERSION })
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await ui.press({ key: 'send' })
  expect(f.fetches).toHaveLength(1)
  expect(f.toasts.filter(t => t.includes('sent'))).toHaveLength(1)
})

test('status is one line with the answer and the last send, or none yet', async ($, on) => {
  const f = fixture(on, YES)
  f.store.set('trophy.sentThrough', '2026-10-06')
  await $.session.start(START)
  const none = (await run($, 'status')).text
  expect(none).not.toContain('\n')
  expect(none).toContain('yes')
  expect(none).toContain('last send: none yet')
})

test('status after a first send says first send; later sends show their range', async ($, on) => {
  const f = fixture(on, YES)
  await $.session.start(START)
  const first = (await run($, 'status')).text
  expect(first).not.toContain('\n')
  expect(first).toContain('first send')
  expect(first).toContain('ok')

  f.store.set('trophy.sentThrough', '2026-10-06')
  await f.clock.advance(2 * DAY)
  await $.session.start(START)
  expect(last(f.store).from).toBe('2026-10-06')
})
