// Shared by the *.test.ts files only; the module never imports it.
import type { On } from 'claude-code'
import { expect, mock } from 'claude-code/testing'

// Every surface a pane, band or toast draws on (mod.md rule 8).
export type Surface = 'terminal' | 'desktop' | 'mobile' | 'vscode'
export const SURFACES = ['terminal', 'desktop', 'mobile', 'vscode'] as const satisfies readonly Surface[]

const SHARED = new Set(['Box', 'Text', 'Button', 'Link', 'Code', 'Markdown'])
// Fails if a drawn tree holds a node type the four surfaces do not all carry.
export const onlyShared = (tree: any) => {
  const types = new Set<string>()
  const walk = (n: any): void => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (n === null || typeof n !== 'object') return
    if (typeof n.type === 'string') types.add(n.type)
    walk(n.children)
  }
  walk(tree)
  expect([...types].filter(t => !SHARED.has(t))).toEqual([])
}

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

// Claude Code's `language` setting, as `$.settings.read()` returns it.
export const language = (on: On, value: string) => on('settings.read', () => ({ value: { language: value } }))

// Session id, clock and attached surfaces, which every recording hook reads. Set `.denyId` to make the id lookup fail,
// `.surfaces = []` for a headless run (rule 2: the module starts nothing without a surface).
export const sessionAt = (on: On, now = Date.parse('2026-10-07T09:00:00Z'), id = 'session-1') => {
  const clock = mock.clock(on, { now })
  const session = {
    denyId: undefined as string | undefined,
    surfaces: ['terminal'] as Surface[],
    advance: clock.advance,
    now: clock.now,
  }
  on('session.id', () => (session.denyId === undefined ? { value: id } : { deny: session.denyId }))
  on('session.surfaces', () => ({ value: session.surfaces }) as never)
  return session
}
