import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { frame } from './demo-frames.ts'
import { PS, world } from './orphankit.ts'
import { texts } from './testkit.ts'

type Agent = { id: string; description: string; status: string; parentId?: string }

// orphankit's process table, plus the agents, asks, TaskStop, toasts and status line beneath the plugin.
const setup = (on: any, w: { agents?: Agent[]; answer?: string | Error; surfaces?: string[]; ps?: string; stop?: (id: string) => unknown } = {}) => {
  const k = world(on, { surfaces: w.surfaces, ps: w.ps })
  const seen = { toasts: [] as string[], statuses: [] as (string | undefined)[], asks: [] as string[], stops: [] as string[] }
  on('agent.list', () => ({ value: (w.agents ?? []).map(a => ({ type: 'general-purpose', ...a })) }) as never)
  on('ui.toast', (_$: any, e: any) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$: any, e: any) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  on('turn.complete', (_$: any, e: any) => ({ text: e.answer }))
  on('session.usage', () => ({ value: undefined }) as never)
  on('tool.call', (_$: any, e: any) => {
    if (e.tool === 'AskUserQuestion') {
      const q = e.questions[0].question as string
      seen.asks.push(q)
      if (w.answer instanceof Error) throw w.answer
      return { result: { questions: [], answers: { [q]: w.answer ?? 'Reap' } }, text: '' } as never
    }
    if (e.tool === 'TaskStop') {
      seen.stops.push(e.task_id)
      return (w.stop ? w.stop(e.task_id) : { result: { message: 'stopped', task_id: e.task_id, task_type: 'local_agent' }, text: '' }) as never
    }
    return { result: 'done', text: '' } as never
  })
  return { ...k, ...seen }
}

const TURN = { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as never
const AGENTS: Agent[] = [
  { id: 'a1', description: 'build thing', status: 'running' },
  { id: 'a2', description: 'idle mate', status: 'idle' },
  { id: 'a3', description: 'waits', status: 'waiting' },
  { id: 'a4', description: 'queued', status: 'pending' },
  { id: 'a5', description: 'done', status: 'completed' },
  { id: 'a6', description: 'broke', status: 'failed' },
  { id: 'a7', description: 'gone', status: 'killed' },
]
const NO_HEADLESS = PS.split('\n').filter(l => !/claude -p/.test(l)).join('\n')
const reap = ($: Engine) => $.command.run({ command: 'reap', args: '' } as never) as Promise<{ text?: string }>
const paneText = async ($: Engine) =>
  texts(await (await ($ as any).ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'reap-result', props: { title: 'Reap', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {} } })).drawn()).join('\n')
const kills = (procs: string[][]) => procs.filter(p => p[0] === 'kill')
const model = ($: Engine, args: Record<string, unknown> = {}) => $.tool.call({ tool: 'Agent', prompt: 'x', description: 'x', ...args } as never)
const denied = (r: unknown) => (r as { deny?: string }).deny

// ---- Agent model guard ----
const MODEL_TOAST = /no model: "x" inherits the parent model/

test('Agent guard toast (default): no model toasts and the call passes', async ($, on) => {
  const w = setup(on)
  expect(denied(await model($))).toBeUndefined()
  expect(w.toasts).toHaveLength(1)
  expect(MODEL_TOAST.test(w.toasts[0]!)).toBe(true)
})

test('Agent guard deny option: no model is denied, headless too', { options: { agent_model_guard: 'deny' } }, async ($, on) => {
  setup(on, { surfaces: [] })
  expect(denied(await model($))).toMatch(/pass model/)
})

test('Agent guard: fork and a given model pass silently', { options: { agent_model_guard: 'deny' } }, async ($, on) => {
  const w = setup(on)
  expect(denied(await model($, { subagent_type: 'fork' }))).toBeUndefined()
  expect(denied(await model($, { model: 'sonnet' }))).toBeUndefined()
  expect(w.toasts).toEqual([])
})

test('Agent guard bogus option: behaves as toast', { options: { agent_model_guard: 'bogus' } }, async ($, on) => {
  const w = setup(on)
  expect(denied(await model($))).toBeUndefined()
  expect(MODEL_TOAST.test(w.toasts[0]!)).toBe(true)
})

test('Agent guard off: no model passes silently', { options: { agent_model_guard: 'off' } }, async ($, on) => {
  const w = setup(on)
  expect(denied(await model($))).toBeUndefined()
  expect(w.toasts).toEqual([])
})

// ---- unfinished-agent count in the status line ----
test('turn end: 2 alive agents -> "⧗ 2 agent(s) · /reap", nothing stopped', async ($, on) => {
  const w = setup(on, { agents: AGENTS.slice(0, 2).concat(AGENTS.slice(4)), ps: NO_HEADLESS })
  await $.turn.complete(TURN)
  expect(w.statuses.at(-1)).toBe('⧗ 2 agent(s) · /reap')
  expect(w.stops).toEqual([])
  expect(kills(w.procs)).toEqual([])
})

test('turn end: 0 alive agents leaves no agents part', async ($, on) => {
  const w = setup(on, { agents: AGENTS.slice(4), ps: NO_HEADLESS })
  await $.turn.complete(TURN)
  expect(w.statuses.at(-1)).toBeUndefined()
})

test('turn end: agents and claude -p children share the line', async ($, on) => {
  const w = setup(on, { agents: AGENTS.slice(0, 1) })
  await $.turn.complete(TURN)
  expect(w.statuses.at(-1)).toBe('⧗ 1 agent(s) · /reap · ⧗ 2 claude -p child(ren) running')
})

test('turn end: headless sets no status', async ($, on) => {
  const w = setup(on, { surfaces: [], agents: AGENTS })
  await $.turn.complete(TURN)
  expect(w.statuses).toEqual([])
})

// ---- /reap ----
test('reap: stops only pending/running/waiting/idle agents, in list order, after Reap', async ($, on) => {
  const w = setup(on, { agents: AGENTS, ps: NO_HEADLESS })
  const r = await reap($)
  expect(w.stops).toEqual(['a1', 'a2', 'a3', 'a4'])
  expect(w.asks[0]).toMatch(/agent: build thing \(running\)/)
  expect(r.text).toBe('reap: 4 stopped, 0 failed')
  const drawn = await paneText($)
  expect(drawn).toMatch(/stopped: build thing/)
  expect(drawn).not.toMatch(/done|broke|gone/)
  expect(w.toasts).toEqual(['⧗ reap: 4 done, 0 failed'])
  expect(kills(w.procs)).toEqual([])
})

test('reap: kills the claude -p jobs below this engine, never a wrapper shell or an unrelated one', async ($, on) => {
  const w = setup(on)
  const r = await reap($)
  expect(kills(w.procs)).toEqual([['kill', '-TERM', '4301', '4310']])
  expect(r.text).toBe('reap: 1 stopped, 0 failed')
  expect(await paneText($)).toMatch(/killed: claude -p 4301 4310/)
})

test('reap: an installed build (.../claude/versions/<v>) counts as this session\'s engine', async ($, on) => {
  const w = setup(on, { ps: PS.replace('/usr/local/bin/claude\n', '/Users/u/.local/share/claude/versions/2.1.292\n') })
  const r = await reap($)
  expect(kills(w.procs)).toEqual([['kill', '-TERM', '4301', '4310']])
  expect(r.text ?? '').not.toMatch(/engine pid unknown/)
})

test('reap: the status line is refreshed after reaping', async ($, on) => {
  const w = setup(on, { agents: AGENTS.slice(0, 1), ps: NO_HEADLESS })
  await reap($)
  expect(w.statuses.at(-1)).toBe('⧗ 1 agent(s) · /reap')
})

test('reap: an engine row that is not claude kills nothing', async ($, on) => {
  const w = setup(on, { ps: PS.replace('/usr/local/bin/claude\n', '/bin/zsh\n') })
  const r = await reap($)
  expect(kills(w.procs)).toEqual([])
  expect(r.text).toMatch(/engine pid unknown/)
})

test('reap: an engine row missing from ps kills nothing and says so', async ($, on) => {
  const w = setup(on, { agents: AGENTS.slice(0, 1), ps: PS.split('\n').filter(l => !/^\s*4242\s/.test(l)).join('\n') })
  const r = await reap($)
  expect(kills(w.procs)).toEqual([])
  expect(w.stops).toEqual(['a1'])
  expect(await paneText($)).toMatch(/engine pid unknown/)
})

for (const [name, answer] of [['Cancel', 'Cancel'], ['a dismissed ask', new Error('dismissed')]] as const) {
  test(`reap: ${name} stops and kills nothing`, async ($, on) => {
    const w = setup(on, { agents: AGENTS, answer })
    const r = await reap($)
    expect(w.stops).toEqual([])
    expect(kills(w.procs)).toEqual([])
    expect(r.text).toMatch(/cancelled/)
  })
}

test('reap: nothing alive asks nothing and says nothing to reap', async ($, on) => {
  const w = setup(on, { agents: AGENTS.slice(4), ps: NO_HEADLESS })
  const r = await reap($)
  expect(w.asks).toEqual([])
  expect(r.text).toMatch(/nothing to reap/)
})

test('reap: a child of a stopped parent is not stopped again', async ($, on) => {
  const w = setup(on, { agents: [{ id: 'p', description: 'parent', status: 'running' }, { id: 'c', description: 'child', status: 'running', parentId: 'p' }], ps: NO_HEADLESS })
  await reap($)
  expect(w.stops).toEqual(['p'])
})

test('reap: one failing TaskStop (throw or deny) is reported; the others still stop', async ($, on) => {
  const w = setup(on, {
    agents: AGENTS.slice(0, 3),
    ps: NO_HEADLESS,
    stop: id => {
      if (id === 'a1') throw new Error('no such task')
      if (id === 'a2') return { deny: 'not allowed' }
      return { result: { message: 'ok', task_id: id, task_type: 'local_agent' }, text: '' }
    },
  })
  const r = await reap($)
  expect(w.stops).toEqual(['a1', 'a2', 'a3'])
  expect(r.text).toBe('reap: 1 stopped, 2 failed')
  expect(w.toasts).toEqual(['⧗ reap: 1 done, 2 failed'])
})

test('reap: headless asks, stops and kills nothing', async ($, on) => {
  const w = setup(on, { surfaces: [], agents: AGENTS })
  const r = await reap($)
  expect(w.asks).toEqual([])
  expect(w.stops).toEqual([])
  expect(kills(w.procs)).toEqual([])
  expect(r.text).toMatch(/interactive sessions only/)
})

// ---- /reap-list ----
const LIST_ITEMS = [
  { type: 'proc', pid: 2758835, ppid: 1, start: 'x', cmd: 'claude -p --output-format stream-json ' + 'x'.repeat(300), age: '10m', kind: 'driver', task: 'f979caf8-1', state: 'live', reapable: false },
  { type: 'proc', pid: 531542, ppid: 1, start: 'x', cmd: 'node /p/teams/mcp/daemon.mjs --task 99931019', age: '26d13h', kind: 'daemon', task: '99931019', state: 'finished', reapable: true },
  { type: 'proc', pid: 77, ppid: 1, start: 'x', cmd: 'node other.js', age: '1m', kind: 'other', task: null, state: 'other', reapable: false },
  { type: 'worktree', path: '/r/.claude/worktrees/' + 'w'.repeat(120), branch: 'worktree-agent-' + 'b'.repeat(40), head: 'h', task: 't', merged: true, dirty: false, removable: true, state: 'removable', reason: 'merged into main' },
  { type: 'worktree', path: '/r', branch: 'main', head: 'h', task: null, merged: false, dirty: false, removable: false, state: 'keep', reason: 'main checkout' },
]
const CLEAN = LIST_ITEMS.map(i => (i.type === 'proc' ? { ...i, state: i.state === 'finished' ? 'live' : i.state, reapable: false } : { ...i, removable: false, state: 'keep' }))
const LIST_PANE = (cols = 110) => ({ title: 'Reap list', isFocused: true, bodyColumns: cols, placement: 'inline', scroll: { bodyRows: 30 }, view: {} }) as any
const mountList = ($: any, cols = 110) =>
  $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'reap-list', props: LIST_PANE(cols) })
const settle = () => new Promise(r => setTimeout(r, 20))

type ListWorld = {
  surfaces?: string[]
  panes?: { id: string }[]
  listing?: unknown
  listExit?: number
  listThrows?: boolean
  reapOut?: string
  reapExit?: number
  answer?: string | Error
}
const listWorld = (on: any, w: ListWorld = {}) => {
  const seen = {
    cli: [] as string[][], toasts: [] as string[], asks: [] as string[], opened: [] as Record<string, unknown>[], closed: [] as string[],
    listing: w.listing ?? LIST_ITEMS,
  }
  on('session.surfaces', () => ({ value: w.surfaces ?? ['terminal'] }))
  on('ui.panes', () => ({ value: (w.panes ?? []) as any }))
  on('ui.open', (_$: any, e: any) => {
    seen.opened.push({ ...e })
    return { value: { isPlaced: true } as any }
  })
  on('ui.close', (_$: any, e: any) => {
    seen.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.toast', (_$: any, e: any) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  const cells = new Map<string, unknown>()
  on('state.get', (_$: any, e: any) => ({ value: { value: cells.get(`${e.plugin}.${e.key}`), version: 0 } }) as never)
  on('state.set', (_$: any, e: any) => {
    cells.set(`${e.plugin}.${e.key}`, e.value)
    return { value: { isSet: true, version: 1 } } as never
  })
  on('process.run', (_$: any, e: any) => {
    seen.cli.push([...e.argv])
    if (e.argv[0] === 'ps' || e.argv[0] === 'kill') throw new Error('the pane must not touch processes itself')
    if (w.listThrows) return { deny: 'spawn failed' } as never
    const out = (stdout: string, exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr } }) as never
    if (e.argv.includes('--list')) return out(typeof seen.listing === 'string' ? seen.listing : JSON.stringify(seen.listing), w.listExit ?? 0, w.listExit ? 'boom' : '')
    if (e.argv.includes('--reap')) return out(w.reapOut ?? 'stopped: pid 531542 node daemon\nremoved: /r/wt\n', w.reapExit ?? 0)
    return out('')
  })
  on('tool.call', (_$: any, e: any) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'done', text: '' } as never
    const q = e.questions[0].question as string
    seen.asks.push(q)
    if (w.answer instanceof Error) throw w.answer
    return { result: { questions: [], answers: { [q]: w.answer ?? 'Reap' } }, text: '' } as never
  })
  return seen
}
const list = ($: Engine) => $.command.run({ command: 'reap-list', args: '' } as never) as Promise<{ text?: string }>
const reapCalls = (cli: string[][]) => cli.filter(a => a.includes('--reap'))

test('reap-list: opens one pane with Esc closing, filled from reap.mjs --list --json run at the plugin root', async ($, on) => {
  const w = listWorld(on)
  expect((await list($)).text).toBe('Reap list opened.')
  expect(w.opened).toHaveLength(1)
  expect(w.opened[0]).toMatchObject({ id: 'reap-list', focus: true, closeOnEscape: true })
  expect(w.cli).toHaveLength(1)
  expect(w.cli[0]![0]).toBe('node')
  expect(w.cli[0]![1]).toMatch(/\/scripts\/reap\.mjs$/)
  expect(w.cli[0]!.slice(2)).toEqual(['--list', '--json'])
})

test('reap-list: the command again on an open pane closes it and runs nothing', async ($, on) => {
  const w = listWorld(on, { panes: [{ id: 'reap-list' }] })
  expect((await list($)).text).toBe('Reap list closed.')
  expect(w.closed).toEqual(['reap-list'])
  expect(w.opened).toEqual([])
  expect(w.cli).toEqual([])
})

test('reap-list: q closes the pane through the dismiss Button', async ($, on) => {
  const w = listWorld(on)
  await list($)
  const ui = await mountList($)
  await ui.press({ key: 'close' })
  expect(w.closed).toEqual(['reap-list'])
})

test('reap-list render: icon first, columns aligned, one item per line, one dim footer', async ($, on) => {
  listWorld(on)
  await list($)
  const tree: any = await (await mountList($)).drawn()
  const lines = texts(tree)
  expect(lines).toContain('Processes 3')
  expect(lines).toContain('Worktrees 2')
  expect(lines).toContain('✓')
  expect(lines).toContain('●')
  // pid column is right-aligned to the widest pid
  expect(lines).toContain('     77')
  expect(lines).toContain('2758835')
  // age and kind columns are padded to a common width
  expect(lines).toContain('1m    ')
  expect(lines).toContain('26d13h')
  const json = JSON.stringify(tree)
  expect(json).toMatch(/"label":"Reap 2"/)
  expect(json).toMatch(/"hotkey":"q"/)
  expect(lines.slice(-2)).toEqual(['Esc ·', '· /reap-list closes'])
  expect(json.match(/"label":"q"/g)).toHaveLength(1)
})

for (const cols of [110, 190]) {
  test(`reap-list render: long command, branch and path end in an ellipsis at ${cols} columns, one row each`, async ($, on) => {
    listWorld(on)
    await list($)
    const tree = await (await mountList($, cols)).drawn()
    const rows = frame(tree as any, 'Reap list', cols)
    for (const r of rows) expect(Array.from(r).length).toBeLessThanOrEqual(cols)
    expect(rows.filter(r => r.includes('claude -p --output-format'))).toHaveLength(1)
    expect(rows.filter(r => r.includes('…')).length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(tree)).toMatch(/"wrap":"truncate-end"/)
  })
}

test('reap-list: Reap asks once with the marked items, then runs --reap, lists again and toasts the counts', async ($, on) => {
  const w = listWorld(on, { answer: 'Reap' })
  await list($)
  const ui = await mountList($)
  await ui.press({ key: 'reap' })
  await settle()
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]).toMatch(/stop pid 531542/)
  expect(w.asks[0]).toMatch(/remove worktree: \/r\/\.claude\/worktrees\//)
  expect(w.asks[0]).not.toMatch(/2758835|pid 77/)
  expect(reapCalls(w.cli)).toHaveLength(1)
  expect(reapCalls(w.cli)[0]!.slice(2)).toEqual(['--reap'])
  // list (open), list (before the ask), reap, list (after)
  expect(w.cli.map(a => a[2])).toEqual(['--list', '--list', '--reap', '--list'])
  expect(w.toasts).toEqual(['⧗ reap-list: 2 done, 0 failed'])
})

for (const [name, answer] of [['Cancel', 'Cancel'], ['a dismissed ask', new Error('dismissed')]] as const) {
  test(`reap-list: ${name} stops and removes nothing`, async ($, on) => {
    const w = listWorld(on, { answer })
    await list($)
    const ui = await mountList($)
    await ui.press({ key: 'reap' })
    await settle()
    expect(w.asks).toHaveLength(1)
    expect(reapCalls(w.cli)).toEqual([])
    expect(w.toasts).toEqual([])
  })
}

test('reap-list: a failing --reap run is counted from its output', async ($, on) => {
  const w = listWorld(on, { reapOut: 'stopped: pid 1 x\nfailed: remove /r/wt (busy)\nskipped: pid 2 (gone)\n', reapExit: 1 })
  await list($)
  await (await mountList($)).press({ key: 'reap' })
  await settle()
  expect(w.toasts).toEqual(['⧗ reap-list: 1 done, 1 failed, 1 skipped'])
})

test('reap-list: nothing marked shows no Reap button and the CLI is never asked to reap', async ($, on) => {
  const w = listWorld(on, { listing: CLEAN })
  await list($)
  const tree: any = await (await mountList($)).drawn()
  expect(texts(tree)).toContain('nothing to reap')
  expect(JSON.stringify(tree)).not.toMatch(/"label":"Reap/)
  expect(w.asks).toEqual([])
  expect(reapCalls(w.cli)).toEqual([])
})

test('reap-list: headless opens no pane, runs nothing and answers in text', async ($, on) => {
  const w = listWorld(on, { surfaces: [] })
  const r = await list($)
  expect(r.text).toMatch(/interactive sessions only/)
  expect(w.opened).toEqual([])
  expect(w.cli).toEqual([])
})

test('reap-list: process.run throwing fails open, the pane opens with the reason and nothing is reaped', async ($, on) => {
  const w = listWorld(on, { listThrows: true })
  expect((await list($)).text).toBe('Reap list opened.')
  const lines = texts(await (await mountList($)).drawn())
  expect(lines.some(l => l.includes('could not run') && l.includes('spawn failed'))).toBe(true)
  expect(reapCalls(w.cli)).toEqual([])
})

test('reap-list: a non-zero or garbled listing keeps the pane up with the reason', async ($, on) => {
  const bad = listWorld(on, { listExit: 3 })
  await list($)
  expect(texts(await (await mountList($)).drawn()).some(l => l.includes('exit 3'))).toBe(true)
  expect(bad.opened).toHaveLength(1)
})

test('reap-list: a garbled listing is an error line, not a crash', async ($, on) => {
  listWorld(on, { listing: 'not json' })
  await list($)
  expect(texts(await (await mountList($)).drawn()).some(l => l.includes('reap.mjs --list failed'))).toBe(true)
})

test('reap-list: --reap failing to run toasts and leaves the list as it was', async ($, on) => {
  const w = listWorld(on, { reapExit: 2, reapOut: '' })
  await list($)
  await (await mountList($)).press({ key: 'reap' })
  await settle()
  expect(w.toasts).toEqual(['reap-list: reap.mjs failed (exit 2); nothing changed'])
})

test('reap: /reap keeps its own pane and never runs reap.mjs', async ($, on) => {
  const w = setup(on, { agents: AGENTS.slice(0, 1), ps: NO_HEADLESS })
  await reap($)
  expect(w.procs.some(p => p.some(a => String(a).includes('reap.mjs')))).toBe(false)
  expect(await paneText($)).toMatch(/stopped: build thing/)
})
