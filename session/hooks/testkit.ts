// Shared by the *.test.ts files only; the module never imports it.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

// An in-memory $.store the test can read: a test's `$` has no `store` of its own.
// `broken = true` makes every set fail, as a full or locked store would.
export const memoryStore = (on: On, initial: Record<string, unknown> = {}) => {
  const map = Object.assign(new Map<string, unknown>(Object.entries(initial)), { broken: false, getBroken: false })
  on('store.get', (_$, e) => {
    if (map.getBroken) throw new Error('store is gone')
    return { value: map.get(e.key) }
  })
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

// An in-memory $.state: atoms read and write through it. Keys are `<plugin>.<key>`.
export const memoryState = (on: On) => {
  const cells = new Map<string, unknown>()
  let version = 0
  on('state.get', (_$, e) => ({ value: { value: cells.get(`${e.plugin}.${e.key}`), version } }) as never)
  on('state.set', (_$, e) => {
    cells.set(`${e.plugin}.${e.key}`, e.value)
    version += 1
    return { value: { isSet: true, version } } as never
  })
  return cells
}

// The text of every Text in a drawn tree, in order.
export const texts = (node: any): string[] =>
  Array.isArray(node)
    ? node.flatMap(texts)
    : node?.type === 'Text'
      ? [(node.children ?? []).join('')]
      : node?.children
        ? texts(node.children)
        : []

// Clock for the hooks that read $.clock.now().
export const clockAt = (on: On, now = Date.parse('2026-10-08T09:00:00Z')) => mock.clock(on, { now })
