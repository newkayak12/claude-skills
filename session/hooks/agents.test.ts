import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

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
const MODEL_TOAST = /no model on this Agent call/

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
