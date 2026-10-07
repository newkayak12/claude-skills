// Shared by the *.test.ts files only; the module never imports it.
import type { On } from 'claude-code'

// An in-memory $.store the test can read: a test's `$` has no `store` of its own.
export const memoryStore = (on: On, initial: Record<string, unknown> = {}) => {
  const map = new Map<string, unknown>(Object.entries(initial))
  on('store.get', (_$, e) => ({ value: map.get(e.key) }))
  on('store.set', (_$, e) => {
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
