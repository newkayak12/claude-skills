import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { scrub } from './logic.ts'
import { memoryStore, sessionAt } from './testkit.ts'

const DAY = 86_400_000
const TODAY = Date.parse('2026-10-07T09:00:00Z')
const START = { cwd: '/work/secret-proj', surface: 'terminal', isInteractive: true } as const

const SEED = {
  'trophy.installId': 'install-1',
  'trophy.uses': [
    { skill: 'think:grill', plugin: 'think', day: '2026-10-06', session: 'SECRET-SESSION', ts: 1 },
    { skill: 'think:grill', plugin: 'think', day: '2026-10-06', session: 'SECRET-SESSION', ts: 99999 },
  ],
  'trophy.triggers': { '2026-10-06': { 'think:grill': { hit: 1, miss: 2, unmatched: 0 } } },
  'trophy.unlocked': { 'first-think': '2026-10-06' },
  'trophy.errors': [{ day: '2026-10-06', message: 'failed at <path>' }],
}

const fixture = (on: On, consent: string | undefined, status = 200) => {
  const store = memoryStore(on, { ...SEED, ...(consent ? { 'trophy.consent': consent, 'trophy.consentVersion': 2 } : {}) })
  const clock = sessionAt(on, TODAY)
  const fetches: { url: string; body: string }[] = []
  const answer = { status }
  on('http.fetch', (_$, e) => {
    fetches.push({ url: e.url, body: String(e.init?.body) })
    return { value: { status: answer.status, ok: answer.status === 200, headers: {}, text: '{"status":"Ok"}' } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: { breakdown: { skills: { skillFrontmatter: [
        { name: 'grill', source: 'plugin', pluginName: 'think', tokens: 1 },
        { name: 'x', source: 'plugin', pluginName: 'superpowers', tokens: 1 },
      ] } } },
    } as any,
  }))
  return { store, clock, fetches, answer }
}

test('a no sends nothing', async ($, on) => {
  const f = fixture(on, 'no')
  await $.session.start(START)
  expect(f.fetches).toHaveLength(0)
})

test('unasked sends nothing either', async ($, on) => {
  const f = fixture(on, 'unasked')
  await $.session.start(START)
  expect(f.fetches).toHaveLength(0)
})

test('a yes sends once: the batch is skill names, counts, days and plugin names only', async ($, on) => {
  const f = fixture(on, 'yes')
  await $.session.start(START)

  expect(f.fetches).toHaveLength(1)
  expect(f.fetches[0]!.url).toBe('https://us.i.posthog.com/batch/')
  const body = JSON.parse(f.fetches[0]!.body)
  const p = (properties: object) => ({ ...properties, $process_person_profile: false })
  expect(body).toEqual({
    api_key: 'phc_r4NATbMFBZvmQYiJ8MPMJSWHprgbsTkbCddtc6aYAoUg',
    batch: [
      { event: 'skill_used', distinct_id: 'install-1', timestamp: '2026-10-06T12:00:00Z', properties: p({ skill: 'think:grill', plugin: 'think', day: '2026-10-06', count: 2 }) },
      { event: 'trigger_result', distinct_id: 'install-1', timestamp: '2026-10-06T12:00:00Z', properties: p({ skill: 'think:grill', day: '2026-10-06', hit: 1, miss: 2, unmatched: 0 }) },
      { event: 'achievement_unlocked', distinct_id: 'install-1', timestamp: '2026-10-06T12:00:00Z', properties: p({ id: 'first-think' }) },
      { event: 'plugins_installed', distinct_id: 'install-1', timestamp: '2026-10-06T12:00:00Z', properties: p({ plugin: 'think', day: '2026-10-06' }) },
      { event: '$exception', distinct_id: 'install-1', timestamp: '2026-10-06T12:00:00Z', properties: p({ $exception_message: 'failed at <path>' }) },
    ],
  })
  expect(f.store.get('trophy.sentThrough')).toBe('2026-10-06')
  expect(f.store.get('trophy.errors')).toEqual([])
})

test('the session lists its marketplace plugins once per day and they ride the next batch', async ($, on) => {
  const f = fixture(on, 'yes')
  await $.session.start(START)
  expect(f.store.get('trophy.plugins')).toEqual({ '2026-10-07': ['think'] })

  await f.clock.advance(DAY)
  await $.session.start(START)

  const events = JSON.parse(f.fetches[1]!.body).batch
  expect(events).toEqual([
    expect.objectContaining({ event: 'plugins_installed', properties: expect.objectContaining({ plugin: 'think', day: '2026-10-07' }) }),
  ])
})

test('a second start the same day sends nothing', async ($, on) => {
  const f = fixture(on, 'yes')
  await $.session.start(START)
  await $.session.start(START)
  expect(f.fetches).toHaveLength(1)
})

test('a 500 keeps everything and the next start sends the same days', async ($, on) => {
  const f = fixture(on, 'yes', 500)
  await $.session.start(START)
  expect(f.store.get('trophy.sentThrough')).toBeUndefined()
  expect((f.store.get('trophy.errors') as unknown[]).length).toBe(1)

  f.answer.status = 200
  await $.session.start(START)

  expect(f.fetches).toHaveLength(2)
  expect(JSON.parse(f.fetches[1]!.body).batch.map((e: { event: string }) => e.event)).toEqual(
    JSON.parse(f.fetches[0]!.body).batch.map((e: { event: string }) => e.event),
  )
  expect(f.store.get('trophy.sentThrough')).toBe('2026-10-06')
})

test('no prompt text, cwd, session id or absolute path reaches the body, even from an error', async ($, on) => {
  const f = fixture(on, 'yes')
  await $.session.start(START)
  f.fetches.length = 0
  f.clock.denyId = 'boom at /Users/kim/proj/x.ts:3:4 and C:\\Users\\kim\\proj\\y.ts'
  await $.skill.prompt({ skill: 'think:grill', text: 'SECRET-PROMPT-TEXT' })
  await f.clock.advance(DAY)

  await $.session.start(START)

  const raw = f.fetches[0]!.body
  expect(raw).toContain('boom at <path>')
  for (const secret of ['/Users/', 'kim', 'SECRET-PROMPT-TEXT', 'SECRET-SESSION', 'session-1', '/work/secret-proj', 'secret-proj']) {
    expect(raw).not.toContain(secret)
  }
  expect(raw).not.toMatch(/(?<![\w.])\/[\w.-]+\/[\w.-]/)
})

test('scrub drops paths and cuts at 300 characters', () => {
  expect(scrub('at /Users/kim/proj/x.ts:1')).toBe('at <path>:1')
  expect(scrub('in ~/proj/a.ts and /home/lee/b')).toBe('in <path> and <path>')
  expect(scrub('and/or stays')).toBe('and/or stays')
  expect(scrub('x'.repeat(400))).toHaveLength(300)
})
