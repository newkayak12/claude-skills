// Shared by the *.test.ts files only; the module never imports it.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

// An in-memory $.store the test can read: a test's `$` has no `store` of its own.
// `broken = true` makes every set fail, as a full or locked store would.
export const memoryStore = (on: On, initial: Record<string, unknown> = {}) => {
  const map = Object.assign(new Map<string, unknown>(Object.entries(initial)), { broken: false })
  on('store.get', (_$, e) => ({ value: map.get(e.key) }))
  on('store.set', (_$, e) => {
    if (map.broken) return { deny: 'store is broken' }
    map.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    map.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...map.keys()] }))
  return map
}

// Session id and clock, which every recording hook reads. Set `.denyId` to make the id lookup fail.
export const sessionAt = (on: On, now = Date.parse('2026-10-07T09:00:00Z'), id = 'session-1') => {
  const clock = mock.clock(on, { now })
  const session = { denyId: undefined as string | undefined, advance: clock.advance, now: clock.now }
  on('session.id', () => (session.denyId === undefined ? { value: id } : { deny: session.denyId }))
  return session
}
