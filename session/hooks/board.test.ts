import { test, expect } from 'claude-code/testing'

import { brokerCell, cellText, harnessCell, liveRows, peersOf, pushesMain, rowKey, LIVE_MS } from './board.ts'
import type { BoardRow } from './board.ts'
import { bash, guardWorld, ran, texts } from './testkit.ts'

const NOW = Date.parse('2026-10-08T09:00:00Z')
const TURN = { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't' } as never
const PANE = { title: 'Board', isFocused: true, bodyColumns: 100, placement: 'inline', scroll: { bodyRows: 40 }, view: {} } as any
const REPO = '/repo/.git'

const row = (id: string, over: Partial<BoardRow> = {}): BoardRow => ({
  sessionId: id, root: `/w/${id}`, branch: 'feat', repo: REPO, percent: 10, usd: 0.5, task: '', runs: {}, ts: NOW, ...over,
})

const node = (node_id: string, stage: string, state: string, deps: string[] = []) => ({ node_id, stage, state, deps })

// pure pieces
test('rows: this session first, then newest; past a day dropped', () => {
  const rows = [row('a', { ts: NOW - 5000 }), row('me', { ts: NOW - 9000 }), row('b', { ts: NOW - 1000 }), row('old', { ts: NOW - 25 * 3600e3 })]
  expect(liveRows(rows, NOW, 'me').map(r => r.sessionId)).toEqual(['me', 'b', 'a'])
})

test('peers: same repo, seen in 30 min, never itself', () => {
  const me = row('me')
  const rows = [me, row('a'), row('other', { repo: '/x/.git' }), row('stale', { ts: NOW - 31 * 60e3 }), row('norepo', { repo: '' })]
  expect(peersOf(rows, me, NOW).map(r => r.sessionId)).toEqual(['a'])
})

test('pushes to main in every spelling; not to a feature branch', () => {
  expect(pushesMain('git push origin main', 'feat')).toBe(true)
  expect(pushesMain('git push origin HEAD:main', 'feat')).toBe(true)
  expect(pushesMain('git add . && git commit -m x && git push -u origin feat:main', 'feat')).toBe(true)
  expect(pushesMain('git push', 'main')).toBe(true)
  expect(pushesMain('git push', 'feat')).toBe(false)
  expect(pushesMain('git push origin feat', 'feat')).toBe(false)
  expect(pushesMain('git push origin v1.0.2', 'main')).toBe(false)
  expect(pushesMain('echo git push origin main', 'feat')).toBe(false)
})

test('broker runs read as graph reads them', () => {
  const running = { nodes: [node('p', 'plan', 'done'), node('i', 'implement', 'running', ['p']), node('r', 'report', 'pending', ['i'])] }
  expect(brokerCell(running, NOW, NOW)).toEqual({ state: 'running', done: 1, total: 3, live: true })
  expect(brokerCell(running, NOW - LIVE_MS - 1, NOW)!.state).toBe('stalled')
  const blocked = { nodes: [node('p', 'plan', 'failed'), node('r', 'report', 'pending', ['p'])] }
  expect(brokerCell(blocked, NOW, NOW)!.state).toBe('blocked')
  const done = { nodes: [node('p', 'plan', 'done'), node('r', 'report', 'done', ['p'])] }
  expect(cellText(brokerCell(done, NOW, NOW))).toBe('✔ finished 2/2')
  expect(brokerCell({}, NOW, NOW)).toBeUndefined()
  expect(cellText(undefined)).toBe('–')
})

test('harness runs: finished, running within 2 h, stalled after', () => {
  expect(harnessCell({ finished: true, time: NOW, done: 2, total: 2 }, NOW).state).toBe('finished')
  expect(harnessCell({ finished: false, time: NOW, done: 1, total: 3 }, NOW)).toEqual({ state: 'running', done: 1, total: 3, live: true })
  expect(harnessCell({ finished: false, time: NOW - LIVE_MS, done: 1, total: 3 }, NOW).state).toBe('stalled')
})

// through the engine
const git = (branch = 'feat') => (argv: readonly string[]) => {
  if (argv.includes('--abbrev-ref')) return ran(`${branch}\n`)
  if (argv.includes('--git-common-dir')) return ran(`${REPO}\n`)
  if (argv.includes('--short')) return ran('abc1234\n')
  if (argv.includes('--format=%s')) return ran('session 0.4.0: board\n')
  return ran('')
}

const files: Record<string, { name: string; kind: string; size: number; mtimeMs: number }[]> = {
  '.harness-run/broker/runs': [{ name: 'aa-11.json', kind: 'file', size: 10, mtimeMs: NOW }],
}
const reads: Record<string, string> = {
  '.harness-run/broker/runs/aa-11.json': JSON.stringify({ nodes: [node('p', 'plan', 'done'), node('i', 'implement', 'running', ['p'])] }),
}

const world = (on: any, w: { surfaces?: 'terminal'[]; store?: Record<string, unknown>; branch?: string } = {}) => {
  const seen = guardWorld(on, { surfaces: w.surfaces, store: w.store, proc: git(w.branch) })
  const sends: { to: unknown; text: string }[] = []
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('session.id', () => ({ value: 'me' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 100, tokens: 0, percent: 42.4 }, rateLimits: [], cost: { usd: 1.5 } } }) as never)
  // paths may arrive resolved against the cwd: matched on their end
  const at = <T,>(m: Record<string, T>, path: string) => Object.entries(m).find(([k]) => String(path).endsWith(k))?.[1]
  on('fs.list', (_$: any, e: any) => ({ value: at(files, e.path) ?? [] }) as never)
  on('fs.read', (_$: any, e: any) => {
    const v = at(reads, e.path)
    if (v === undefined) throw new Error('ENOENT')
    return { value: v } as never
  })
  on('session.send', (_$: any, e: any) => {
    sends.push({ to: e.to, text: e.text })
    return { isDelivered: true } as never
  })
  return { seen, sends }
}

test('turn end writes this session row: branch, repo, %, cost, graph run', async ($, on) => {
  const { seen } = world(on)
  await $.turn.complete(TURN)
  expect(seen.store.get(rowKey('me'))).toMatchObject({
    sessionId: 'me', branch: 'feat', repo: REPO, percent: 42, usd: 1.5, runs: { graph: { state: 'running', done: 1, total: 2, live: true } },
  })
})

test('headless writes no row; /board answers text', async ($, on) => {
  const { seen } = world(on, { surfaces: [], store: { [rowKey('a')]: row('a') } })
  await $.turn.complete(TURN)
  expect(seen.store.get(rowKey('me'))).toBeUndefined()
  const r = (await $.command.run({ command: 'board', args: '' } as never)) as { text: string }
  expect(r.text).toContain('feat')
  expect(r.text).toContain('graph –')
})

test('/board opens the pane; it shows every session with its runs', async ($, on) => {
  const { seen } = world(on, { store: { [rowKey('a')]: row('a', { branch: 'other-branch', runs: { teams: { state: 'finished', done: 3, total: 3, live: false } } }) } })
  expect(((await $.command.run({ command: 'board', args: '' } as never)) as { text: string }).text).toBe('Board opened.')
  expect(seen.opened).toEqual(['board'])
  const lines = texts(await (await $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'board', props: PANE })).drawn())
  expect(lines).toContain('● this')
  expect(lines).toContain('other-branch')
  expect(lines).toContain('graph ● running 1/2')
  expect(lines).toContain('teams ✔ finished 3/3')
  expect(lines.some(l => l.includes('/graph-live'))).toBe(true)
})

test('a push to main tells the other sessions of this repo once', async ($, on) => {
  const { seen, sends } = world(on, {
    store: { [rowKey('a')]: row('a'), [rowKey('far')]: row('far', { repo: '/x/.git' }) },
  })
  await bash($, 'git push origin main')
  await bash($, 'git push origin main')
  expect(sends).toHaveLength(1)
  expect(sends[0]!.to).toBe('a')
  expect(sends[0]!.text).toContain('origin/main moved to abc1234')
  expect(seen.toasts.some(t => /told 1 of 1/.test(t))).toBe(true)
})

test('a push to a feature branch, or headless, tells no one', async ($, on) => {
  const { sends } = world(on, { store: { [rowKey('a')]: row('a') } })
  await bash($, 'git push origin feat')
  expect(sends).toHaveLength(0)
})

test('headless push to main sends nothing', async ($, on) => {
  const { sends } = world(on, { surfaces: [], store: { [rowKey('a')]: row('a') } })
  await bash($, 'git push origin main')
  expect(sends).toHaveLength(0)
})
