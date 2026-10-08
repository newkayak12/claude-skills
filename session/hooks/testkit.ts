// Shared by the *.test.ts files only; the module never imports it.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

// An in-memory $.store the test can read: a test's `$` has no `store` of its own.
// `broken = true` makes every set fail, as a full or locked store would.
export const memoryStore = (on: On, initial: Record<string, unknown> = {}) => {
  const map = Object.assign(new Map<string, unknown>(Object.entries(initial)), { broken: false, getBroken: false, writes: 0 })
  on('store.get', (_$, e) => {
    if (map.getBroken) throw new Error('store is gone')
    return { value: map.get(e.key) }
  })
  on('store.set', (_$, e) => {
    if (map.broken) return { deny: 'store is broken' }
    map.writes += 1
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

type Run = { exitCode: number; stdout: string; stderr: string }
export const ran = (stdout: string, exitCode = 0): Run => ({ exitCode, stdout, stderr: '' })
type Surface = 'terminal' | 'desktop'

export type GuardWorld = {
  surfaces?: readonly Surface[]
  // an Error makes $.session.cwd() throw
  cwd?: string | Error
  root?: string
  home?: string
  // what the person answers a $.ui.ask; an Error makes the ask reject
  answer?: string | Error
  proc?: (argv: readonly string[]) => Run | Promise<Run>
  store?: Record<string, unknown>
  // a native allow beneath the guard, as bypass mode leaves it
  bypass?: boolean
}

// The engine beneath the guard: surfaces, cwd, processes, asks. Everything is counted, nothing real runs.
export const guardWorld = (on: On, w: GuardWorld = {}) => {
  const store = memoryStore(on, w.store)
  const cells = memoryState(on)
  clockAt(on)
  const seen = {
    store,
    cells,
    asks: [] as string[],
    procs: [] as (readonly string[])[],
    toasts: [] as string[],
    statuses: [] as (string | undefined)[],
    opened: [] as string[],
    commands: [] as string[],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.surfaces', () => ({ value: w.surfaces ?? ['terminal'] }))
  on('session.cwd', () => {
    if (w.cwd instanceof Error) throw w.cwd
    return { value: w.cwd ?? '/proj' }
  })
  on('session.root', () => ({ value: w.root ?? '/proj' }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? (w.home ?? '/home/me') : undefined }) as never)
  on('process.run', async (_$, e) => {
    seen.procs.push(e.argv)
    return { value: await (w.proc ?? (() => ran('')))(e.argv) } as never
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } as any }
  })
  if (w.bypass) on('tool.check', () => ({ decision: 'allow' }))
  // $.ui.ask is an AskUserQuestion call beneath the plugin; every other tool call succeeds.
  on('tool.call', (_$, e) => {
    if (e.tool === 'AskUserQuestion') {
      const q = (e as unknown as { questions: { question: string }[] }).questions[0]!.question
      seen.asks.push(q)
      if (w.answer instanceof Error) throw w.answer
      return { result: { questions: [], answers: { [q]: w.answer ?? 'Run' } }, text: '' } as never
    }
    return { result: 'done', text: '' } as never
  })
  return seen
}

export const PASSED = { result: 'done', text: '' }
