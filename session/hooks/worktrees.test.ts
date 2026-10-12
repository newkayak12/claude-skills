import { test, expect } from 'claude-code/testing'

import { isInUse, parseWorktrees, wtReason } from './board.ts'
import type { WtRow } from './board.ts'
import { guardWorld, ran, texts } from './testkit.ts'

const NOW = Date.parse('2026-10-08T09:00:00Z')
const DAY = 86400
const PANE = { title: 'Board', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { bodyRows: 40 }, view: {} } as any
const settle = () => new Promise(res => (globalThis as any).setTimeout(res, 20))

const PORCELAIN = [
  'worktree /repo\nHEAD m1\nbranch refs/heads/main',
  'worktree /wt/a\nHEAD a1\nbranch refs/heads/feat-a',
  'worktree /wt/b\nHEAD b1\nbranch refs/heads/feat-b',
  'worktree /wt/c\nHEAD c1\nbranch refs/heads/feat-c',
  'worktree /wt/d\nHEAD d1\nbranch refs/heads/feat-d',
  'worktree /wt/e\nHEAD e1\ndetached',
].join('\n\n') + '\n'

const base = (): WtRow => ({ path: '/wt/a', head: 'a1', branch: 'feat-a', isMain: false, exists: true, uncommitted: 0, merged: true, lastCommitMs: NOW, inUse: false })

// pure pieces
test('porcelain: path, head, branch or detached', () => {
  expect(parseWorktrees(PORCELAIN).map(w => [w.path, w.head, w.branch])).toEqual([
    ['/repo', 'm1', 'main'], ['/wt/a', 'a1', 'feat-a'], ['/wt/b', 'b1', 'feat-b'], ['/wt/c', 'c1', 'feat-c'], ['/wt/d', 'd1', 'feat-d'], ['/wt/e', 'e1', ''],
  ])
})

test('in use: the worktree itself or a folder inside it, not a sibling prefix', () => {
  expect(isInUse('/wt/a', ['/wt/a'])).toBe(true)
  expect(isInUse('/wt/a', ['/wt/a/sub'])).toBe(true)
  expect(isInUse('/wt/a', ['/wt/ab', '/repo'])).toBe(false)
})

test('reason: empty only when every condition holds', () => {
  expect(wtReason(base())).toBe('')
  expect(wtReason({ ...base(), isMain: true })).toBe('main')
  expect(wtReason({ ...base(), exists: false })).toBe('missing')
  expect(wtReason({ ...base(), merged: false })).toBe('unmerged')
  expect(wtReason({ ...base(), uncommitted: 3 })).toBe('3 changes')
  expect(wtReason({ ...base(), uncommitted: 1 })).toBe('1 change')
  expect(wtReason({ ...base(), inUse: true })).toBe('in use')
  expect(wtReason({ ...base(), uncommitted: -1 })).toBe('unreadable')
})

// through the engine
type W = { answer?: string; harness?: string[]; mainHarness?: string[]; failCp?: boolean; failRemove?: boolean; failBranch?: boolean }

const setup = async ($: any, on: any, w: W = {}) => {
  const merged = new Set(['m1', 'a1', 'c1', 'd1', 'e1'])
  const dirty: Record<string, string> = { '/wt/c': ' M x\n?? y\n' }
  const missing = new Set(['/wt/e'])
  const seen = guardWorld(on, {
    answer: w.answer ?? 'Clean',
    store: { 'board.session:other': { sessionId: 'other', root: '/wt/d/sub', branch: 'feat-d', repo: '/repo/.git', percent: 1, usd: 0, task: '', runs: {}, ts: NOW } },
    proc: argv => {
      const a = argv.join(' ')
      if (a === 'git worktree list --porcelain') return ran(PORCELAIN)
      if (argv[0] === 'test') return ran('', missing.has(argv[2]!) ? 1 : 0)
      if (argv[0] === 'git' && argv[1] === '-C' && argv[3] === 'status') return ran(dirty[argv[2]!] ?? '')
      if (argv[0] === 'git' && argv[1] === '-C' && argv[3] === 'log') return ran(`${NOW / 1000 - 3 * DAY}\n`)
      if (a.startsWith('git merge-base --is-ancestor')) return ran('', merged.has(argv[3]!) ? 0 : 1)
      if (argv[0] === 'cp' && w.failCp) return ran('', 1)
      if (a.includes('worktree remove') && w.failRemove) return ran('', 1)
      if (a.includes('branch -d') && w.failBranch) return ran('', 1)
      return ran('')
    },
  })
  const lists: Record<string, string[]> = { '/wt/a/.harness-run': w.harness ?? [], '/repo/.harness-run': w.mainHarness ?? [] }
  on('fs.list', (_$: any, e: any) => ({ value: (lists[String(e.path)] ?? []).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: NOW })) }) as never)
  on('session.id', () => ({ value: 'me' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'board', args: 'worktrees' } as never)
  const ui = await $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'board', props: PANE })
  const lines = async () => texts(await ui.drawn())
  return { seen, ui, lines }
}
const mutating = (procs: readonly (readonly string[])[]) =>
  procs.filter(p => ['cp', 'mkdir'].includes(p[0]!) || (p[0] === 'git' && (p.includes('remove') || p.includes('-d')))).map(p => p.join(' '))

test('rows show path facts and why a row cannot be cleaned', async ($, on) => {
  const { lines } = await setup($, on)
  const all = await lines()
  const l = all.join('\n')
  expect(l).toContain('worktrees (6)')
  expect(l).toContain('feat-a · 0 changes · merged · 3d ago')
  expect(l).toContain('feat-b · 0 changes · unmerged')
  expect(l).toContain('feat-c · 2 changes · merged')
  expect(l).toContain('feat-d · 0 changes · merged · 3d ago · in use')
  expect(l).toContain('(detached e1)')
  for (const why of ['main', 'unmerged', '2 changes', 'in use', 'missing']) expect(all).toContain(why)
})

test('Clean is offered only on the eligible row', async ($, on) => {
  const { ui, seen } = await setup($, on)
  for (const p of ['/repo', '/wt/b', '/wt/c', '/wt/d', '/wt/e']) await expect(ui.press({ key: `clean-${p}` })).rejects.toBeDefined()
  await ui.press({ key: 'clean-/wt/a' })
  await settle()
  expect(seen.asks).toHaveLength(1)
})

test('clean: copies .harness-run before git worktree remove, then branch -d; no --force, no -D', async ($, on) => {
  const { ui, seen } = await setup($, on, { harness: ['run1', 'run2'] })
  await ui.press({ key: 'clean-/wt/a' })
  await settle()
  expect(mutating(seen.procs)).toEqual([
    'mkdir -p /repo/.harness-run',
    'cp -R /wt/a/.harness-run/run1 /repo/.harness-run/run1',
    'cp -R /wt/a/.harness-run/run2 /repo/.harness-run/run2',
    'git -C /repo worktree remove /wt/a',
    'git -C /repo branch -d feat-a',
  ])
  const all = seen.procs.map(p => p.join(' ')).join('\n')
  expect(all).not.toMatch(/--force|-f\b|-D\b/)
  expect(seen.toasts.at(-1)).toBe('copied 2 .harness-run · worktree removed · branch feat-a deleted')
})

test('clean without .harness-run just removes', async ($, on) => {
  const { ui, seen } = await setup($, on)
  await ui.press({ key: 'clean-/wt/a' })
  await settle()
  expect(mutating(seen.procs)).toEqual(['git -C /repo worktree remove /wt/a', 'git -C /repo branch -d feat-a'])
})

test('a name already in main stops before anything is copied or removed', async ($, on) => {
  const { ui, seen } = await setup($, on, { harness: ['run1', 'run2'], mainHarness: ['run2'] })
  await ui.press({ key: 'clean-/wt/a' })
  await settle()
  expect(mutating(seen.procs)).toEqual([])
  expect(seen.toasts.at(-1)).toMatch(/run2 already exists in main/)
})

test('a failed copy stops before worktree remove', async ($, on) => {
  const { ui, seen } = await setup($, on, { harness: ['run1'], failCp: true })
  await ui.press({ key: 'clean-/wt/a' })
  await settle()
  expect(mutating(seen.procs).some(p => p.includes('remove'))).toBe(false)
  expect(seen.toasts.at(-1)).toMatch(/copying .*run1 failed/)
})

test('a refused branch -d is reported; the worktree stays removed', async ($, on) => {
  const { ui, seen } = await setup($, on, { failBranch: true })
  await ui.press({ key: 'clean-/wt/a' })
  await settle()
  expect(seen.toasts.at(-1)).toBe('worktree removed · branch feat-a kept (-d refused)')
})

test('a refused worktree remove skips branch -d', async ($, on) => {
  const { ui, seen } = await setup($, on, { failRemove: true })
  await ui.press({ key: 'clean-/wt/a' })
  await settle()
  expect(mutating(seen.procs).some(p => p.includes('-d'))).toBe(false)
  expect(seen.toasts.at(-1)).toMatch(/remove refused/)
})

test('Cancel does nothing', async ($, on) => {
  const { ui, seen } = await setup($, on, { answer: 'Cancel', harness: ['run1'] })
  await ui.press({ key: 'clean-/wt/a' })
  await settle()
  expect(seen.asks).toHaveLength(1)
  expect(mutating(seen.procs)).toEqual([])
  expect(seen.toasts).toEqual([])
})
