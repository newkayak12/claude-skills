// Every pane, band and toast of the session mod on terminal, desktop, mobile and vscode (mod.md rule 8): the tree holds only
// Box, Text, Button, Link, Code, Markdown; headless (surfaces: []) opens and toasts nothing.
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { rowKey } from './board.ts'
import { lessonsKey, recapKey } from './recap.ts'
import { bash, guardWorld, onlyShared, ran, SURFACES, texts } from './testkit.ts'
import type { GuardWorld, Surface } from './testkit.ts'

const NOW = Date.parse('2026-10-08T09:00:00Z')
const TURN = { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't' } as never
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const settle = () => new Promise(res => (globalThis as any).setTimeout(res, 30))

const PANE = (title: string) =>
  ({ title, isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 30 }, view: {} }) as any
const BAND = { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80 } as any
const mountPane = ($: any, surface: Surface, requestId: string, title: string) =>
  $.ui.mount({ plugin: 'session', surface, component: 'Pane', requestId, props: PANE(title) })
const mountBand = ($: any, surface: Surface) => $.ui.mount({ plugin: 'session', surface, component: 'AbovePrompt', props: BAND })
const start = ($: any, surface: Surface) => $.session.start({ cwd: '/w', surface, isInteractive: true })
const run = ($: Engine, command: string, args = '') => $.command.run({ command, args } as never) as Promise<{ text?: string }>

const REPO = '/repo/.git'
const LEDGER = { files: ['/w/a.ts'], commits: [{ hash: 'abc1234', subject: 'feat: a' }], denied: [{ tool: 'Bash', reason: 'rm blocked' }], steps: [1000, 373000] }
const LAST = { day: '2026-10-07', files: 4, commits: 2, denied: 1, longestMs: 372000, fileList: ['/w/a.ts', '/w/b.ts'] }
const ORPHAN = { pid: 4301, ppid: 4300, start: 'Wed Oct  8 10:09:00 2026', cmd: 'claude -p job one' }
const DENIALS = [
  { id: 'a', ts: 1000, tool: 'Bash', call: 'git push -f origin main', reason: 'why a', source: 'guard', rule: 'force-push-protected' },
  { id: 'b', ts: 2000, tool: 'Bash', call: 'curl http://x', reason: 'why b', source: 'native' },
  { id: 'c', ts: 3000, tool: 'Bash', call: 'git reset --hard', reason: 'why c', source: 'declined' },
]
const RECAP = { text: '1. Goal: ship\n6. Corrections:\n- verify before saying done', ts: NOW - 3600e3, sessionId: 'other' }
const peer = { sessionId: 'a', root: '/w/a', branch: 'feat', repo: REPO, percent: 10, usd: 0.5, task: '', runs: {}, ts: NOW }
const LISTING = [
  { type: 'proc', pid: 531542, ppid: 1, start: 'x', cmd: 'node /p/teams/mcp/daemon.mjs --task 99931019', age: '26d13h', kind: 'daemon', task: '99931019', state: 'finished', reapable: true },
  { type: 'worktree', path: '/r/.claude/worktrees/w', branch: 'worktree-agent-b', head: 'h', task: 't', merged: true, dirty: false, removable: true, state: 'removable', reason: 'merged into main' },
]
const PORCELAIN = 'worktree /repo\nHEAD m1\nbranch refs/heads/main\n\nworktree /wt/a\nHEAD a1\nbranch refs/heads/feat-a\n'

type W = GuardWorld & { percent?: number; cost?: number; agents?: { id: string; description: string; status: string }[]; panes?: unknown[] }

// guardWorld, plus what a turn end, a recap, a reap and a board read beneath the plugin.
const world = (on: any, w: W = {}) => {
  const seen = guardWorld(on, {
    ...w,
    proc: w.proc ?? (argv => {
      const a = argv.join(' ')
      if (a.includes('reap.mjs')) return ran(argv.includes('--list') ? JSON.stringify(LISTING) : 'stopped: pid 531542 node daemon\n')
      if (a === 'git worktree list --porcelain') return ran(PORCELAIN)
      if (argv.includes('--abbrev-ref')) return ran('feat\n')
      if (argv.includes('--git-common-dir')) return ran(`${REPO}\n`)
      if (argv.includes('--short')) return ran('abc1234\n')
      if (argv.includes('--format=%s')) return ran('session: surfaces\n')
      if (argv[0] === 'git' && argv[1] === '-C' && argv[3] === 'status') return ran('')
      if (argv[0] === 'git' && argv[1] === '-C' && argv[3] === 'log') return ran(`${NOW / 1000 - 3 * 86400}\n`)
      if (a.startsWith('git merge-base --is-ancestor')) return ran('', 0)
      if (argv[0] === 'test') return ran('', 0)
      if (argv[0] === 'ps') return ran('')
      return ran('')
    }),
    answer: w.answer ?? 'Run',
  } as never)
  let done = (_: string) => {}
  const compacted = new Promise<string>(r => (done = r))
  const sends: string[] = []
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('prompt.submit', (_$: any, e: any) => ({ text: e.text }))
  on('session.id', () => ({ value: 'me' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 100, tokens: w.percent ?? 0, percent: w.percent ?? 0 }, rateLimits: [], cost: { usd: w.cost ?? 0.5 } },
  }) as never)
  on('model.fork', () => ({ value: { isAnswered: true, text: '1. Goal: ship\n6. Corrections:\n- none', usage: USAGE } }) as never)
  on('session.compact', (_$: any, e: any) => {
    done(e.instructions ?? '')
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] }
  })
  on('session.send', (_$: any, e: any) => {
    sends.push(e.text)
    return { isDelivered: true } as never
  })
  on('agent.list', () => ({ value: (w.agents ?? []).map(a => ({ type: 'general-purpose', ...a })) }) as never)
  on('fs.list', () => ({ value: [] }) as never)
  on('ui.render', ($: any, e: any) => {
    const { Box } = $.ui.resolve(e)
    return Box({}) as never
  })
  return { seen, compacted, sends }
}

// ---- panes, on every surface ----
for (const surface of SURFACES) {
  const here = (w: W = {}) => world(guardOn, { ...w, surfaces: [surface] })
  let guardOn: any

  const pane = (name: string, requestId: string, title: string, w: W, before: ($: Engine, seen: ReturnType<typeof world>['seen']) => Promise<void>, expectLine: string) =>
    test(`${surface}: ${name}`, async ($, on) => {
      guardOn = on
      const { seen } = here(w)
      await start($, surface)
      await before($, seen)
      const tree = await (await mountPane($, surface, requestId, title)).drawn()
      onlyShared(tree)
      expect(texts(tree).join('\n')).toContain(expectLine)
    })

  pane('session pane, Retro tab', 'session', 'Session', {}, async (_$, seen) => { seen.cells.set('session.ledger', LEDGER) }, 'files (1)')
  pane('session pane, Retro tab with only the last session', 'session', 'Session', {}, async (_$, seen) => { seen.cells.set('session.last', LAST) }, 'last session  2026-10-07')
  pane('session pane, Orphans tab', 'session', 'Session', {}, async (_$, seen) => {
    seen.cells.set('session.tab', 'orphans')
    seen.cells.set('session.orphans', [ORPHAN])
  }, 'claude -p children (1)')
  pane('session pane, Orphans tab empty', 'session', 'Session', {}, async (_$, seen) => { seen.cells.set('session.tab', 'orphans') }, 'claude -p children (0)')
  pane('memo pane', 'memo', 'Memo', { store: { 'memo.global': [{ text: 'reply in Korean', ts: NOW }] } }, async $ => { await run($, 'memo') }, 'reply in Korean')
  pane('memo pane, no notes', 'memo', 'Memo', {}, async $ => { await run($, 'memo') }, 'no notes')
  pane('guard pane', 'guard-denials', 'Denied calls', { store: { 'session.denials': DENIALS } }, async () => {}, 'git reset --hard')
  pane('guard pane, empty', 'guard-denials', 'Denied calls', {}, async () => {}, 'no denials')
  pane('board, Sessions tab', 'board', 'Board', { store: { [rowKey('a')]: peer } }, async $ => { await run($, 'board') }, 'sessions (')
  pane('board, Recap tab (compact, /handoff and /last-recap land here)', 'board', 'Board', { store: { [recapKey('/proj')]: RECAP } }, async $ => { await run($, 'last-recap') }, 'Goal: ship')
  pane('board, Recap tab with no recap', 'board', 'Board', {}, async $ => { await run($, 'last-recap') }, 'no recap for this project')
  pane('board, Lessons tab', 'board', 'Board', { store: { [lessonsKey('/proj')]: ['verify before saying done'] } }, async $ => { await run($, 'lessons') }, 'verify before saying done')
  pane('board, Today tab', 'board', 'Board', {}, async $ => { await run($, 'task', 'log') }, 'finished today')
  pane('board, Worktrees tab', 'board', 'Board', {}, async $ => { await run($, 'board', 'worktrees') }, 'worktrees (')
  pane('reap-list pane', 'reap-list', 'Reap list', {}, async $ => { await run($, 'reap-list') }, 'daemon.mjs')
  pane(
    'reap-result pane',
    'reap-result',
    'Reap',
    { answer: 'Reap', agents: [{ id: 'a1', description: 'build thing', status: 'running' }] },
    async $ => { await run($, 'reap') },
    'stopped: build thing',
  )

  // ---- bands ----
  test(`${surface}: start band, retro and recap rows`, { options: { start_band: 'both' } }, async ($, on) => {
    guardOn = on
    here({ store: { 'session.last': LAST, [recapKey('/proj')]: RECAP } })
    await start($, surface)
    const tree = await (await mountBand($, surface)).drawn()
    onlyShared(tree)
    const lines = texts(tree)
    expect(lines.some(l => l.includes('last session: 4 files, 2 commits, 1 denied'))).toBe(true)
    expect(lines.some(l => l.includes('last recap of this project'))).toBe(true)
  })

  // ---- toasts: interactive, each draws on this surface ----
  test(`${surface}: toast, guard deny`, async ($, on) => {
    guardOn = on
    const { seen } = here({ answer: 'Cancel' })
    await start($, surface)
    await bash($, 'rm -rf /')
    expect(seen.toasts.filter(t => t.startsWith('guard:'))).toHaveLength(1)
  })

  test(`${surface}: toast, agent without a model`, async ($, on) => {
    guardOn = on
    const { seen } = here()
    await start($, surface)
    await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'x' } as never)
    expect(seen.toasts.filter(t => /no model: "x"/.test(t))).toHaveLength(1)
  })

  test(`${surface}: toast, memo refusal`, async ($, on) => {
    guardOn = on
    const { seen } = here()
    await start($, surface)
    await run($, 'memo', `add ${'x'.repeat(281)}`)
    expect(seen.toasts.filter(t => t.startsWith('memo:'))).toHaveLength(1)
  })

  test(`${surface}: toast, smart-compact`, async ($, on) => {
    guardOn = on
    const { seen, compacted } = here({ percent: 75 })
    await start($, surface)
    await $.turn.complete(TURN)
    await compacted
    await settle()
    expect(seen.toasts).toContain('smart-compact: recapped and compacted')
  })

  test(`${surface}: toast, cost budget`, { options: { cost_budget_usd: 1 } }, async ($, on) => {
    guardOn = on
    const { seen } = here({ cost: 2 })
    await start($, surface)
    await $.turn.complete(TURN)
    expect(seen.toasts.filter(t => /budget/.test(t))).toHaveLength(1)
  })

  test(`${surface}: toast, short task prompt`, { options: { prompt_hint: true } }, async ($, on) => {
    guardOn = on
    const { seen } = here()
    await start($, surface)
    await $.prompt.submit({ text: '고쳐줘', origin: { kind: 'composer' }, wait: false } as never)
    expect(seen.toasts.filter(t => /short task prompt/.test(t))).toHaveLength(1)
  })

  test(`${surface}: toast, reap`, async ($, on) => {
    guardOn = on
    const { seen } = here({ answer: 'Reap', agents: [{ id: 'a1', description: 'build thing', status: 'running' }] })
    await start($, surface)
    await run($, 'reap')
    expect(seen.toasts.filter(t => t.startsWith('⧗ reap:'))).toHaveLength(1)
  })

  test(`${surface}: toast, main moved`, async ($, on) => {
    guardOn = on
    const { seen, sends } = here({ store: { [rowKey('a')]: peer } })
    await start($, surface)
    await bash($, 'git push origin main')
    expect(sends).toHaveLength(1)
    expect(seen.toasts.filter(t => t.startsWith('main moved:'))).toHaveLength(1)
  })

  test(`${surface}: toast, stop a claude -p child`, async ($, on) => {
    guardOn = on
    const { seen } = here()
    await start($, surface)
    seen.cells.set('session.tab', 'orphans')
    seen.cells.set('session.orphans', [ORPHAN])
    const ui = await mountPane($, surface, 'session', 'Session')
    await ui.drawn()
    await ui.press({ key: 'stop-4301' })
    await settle()
    expect(seen.toasts.filter(t => t.startsWith('not stopped:'))).toHaveLength(1)
  })

  test(`${surface}: toast, clean a worktree`, async ($, on) => {
    guardOn = on
    const { seen } = here({ answer: 'Clean' })
    await start($, surface)
    await run($, 'board', 'worktrees')
    const ui = await mountPane($, surface, 'board', 'Board')
    await ui.drawn()
    await ui.press({ key: 'clean-/wt/a' })
    await settle()
    expect(seen.toasts).toHaveLength(1)
  })
}

// ---- headless: surfaces [] opens nothing and toasts nothing ----
test('headless: no ui.open and no toast from any command, guard, hint, budget, push or compact', {
  options: { cost_budget_usd: 1, prompt_hint: true },
}, async ($, on) => {
  const { seen, sends } = world(on, {
    surfaces: [], percent: 90, cost: 2, store: { [rowKey('a')]: peer }, answer: 'Cancel',
    agents: [{ id: 'a1', description: 'build thing', status: 'running' }],
  })
  for (const [command, args] of [
    ['session', ''], ['session', 'retro'], ['session-denials', ''], ['memo', ''], ['memo', 'list'], ['memo', `add ${'x'.repeat(281)}`],
    ['board', ''], ['board', 'worktrees'], ['task', 'log'], ['reap', ''], ['reap-list', ''], ['last-recap', ''], ['lessons', ''], ['handoff', ''],
    ['smart-compact', ''],
  ] as const) {
    const out = await run($, command, args)
    expect(typeof out.text, `${command} ${args} answers in text`).toBe('string')
  }
  await bash($, 'rm -rf /')
  await bash($, 'git push origin main')
  await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'x' } as never)
  await $.prompt.submit({ text: '고쳐줘', origin: { kind: 'composer' }, wait: false } as never)
  await $.turn.complete(TURN)
  await settle()
  expect(seen.opened).toEqual([])
  expect(seen.toasts).toEqual([])
  expect(sends).toEqual([])
})
