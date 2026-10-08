import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

type Run = { exitCode: number; stdout: string; stderr: string }
const ok = (stdout: string): Run => ({ exitCode: 0, stdout, stderr: '' })
type Surfaces = readonly ('terminal' | 'desktop')[]
type Remote = string | null

const SKILLS_REMOTE = 'git@github.com:newkayak12/claude-skills.git'
const MARKETPLACE = JSON.stringify({ plugins: [{ name: 'think' }, { name: 'develop' }] })
const RUN = { dir: '/wt/.harness-run/mods-beta', slug: 'mods-beta', stage: 'implement', total: 2, passed: 1, failed: 0 }

// The engine beneath the plugin. Everything is stubbed: no real user config is read and no real process runs.
type World = {
  surfaces?: Surfaces
  remote?: Remote
  state?: Record<string, unknown>
  proc?: (argv: readonly string[]) => Run | Promise<Run>
  marketplace?: string | Error
  answer?: string | Error // what the person answers a $.ui.ask
}

function world(on: On, w: World = {}) {
  const cells = new Map<string, unknown>(Object.entries(w.state ?? {}))
  const seen = {
    argv: [] as (readonly string[])[],
    toasts: [] as string[],
    statuses: [] as (string | undefined)[],
    asks: [] as string[],
    tools: [] as string[],
    reads: [] as string[],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.surfaces', () => ({ value: w.surfaces ?? ['terminal'] }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.repo', () => ({ value: w.remote === undefined ? null : { root: '/repo', remote: w.remote, internal: false, name: 'claude-skills' } }) as never)
  on('state.get', (_$, e) => ({ value: { value: cells.get(e.key), version: 0 } }) as never)
  on('state.set', (_$, e) => {
    cells.set(e.key, e.value)
    return { value: { isSet: true, version: 1 } } as never
  })
  on('process.run', async (_$, e) => {
    seen.argv.push(e.argv)
    return { value: await (w.proc ?? (() => ok('[]')))(e.argv) }
  })
  on('fs.read', (_$, e) => {
    seen.reads.push(e.path)
    if (!e.path.endsWith('marketplace.json') || w.marketplace === undefined || w.marketplace instanceof Error) throw w.marketplace instanceof Error ? w.marketplace : new Error('ENOENT')
    return { value: w.marketplace } as never
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  // $.ui.ask is an AskUserQuestion tool call beneath the plugin; every other tool call succeeds.
  on('tool.call', (_$, e) => {
    seen.tools.push(e.tool)
    if (e.tool === 'AskUserQuestion') {
      const q = (e as unknown as { questions: { question: string }[] }).questions[0].question
      seen.asks.push(q)
      if (w.answer instanceof Error) throw w.answer
      return { result: { questions: [], answers: { [q]: w.answer ?? 'Run' } }, text: '' } as never
    }
    return { result: 'done', text: '' } as never
  })
  return seen
}

const start = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') => $.session.start({ cwd: '/proj', surface, isInteractive: true })
const call = ($: Engine, tool: string, args: Record<string, unknown>) => $.tool.call({ tool, ...args } as never)
const bash = ($: Engine, command: string) => call($, 'Bash', { command })
const passed = (r: unknown) => (r as { deny?: string }).deny === undefined
const denied = (r: unknown) => (r as { deny?: string }).deny ?? ''

// ---- session.start: headless, polling ----
test('headless: no poll, no toast, no status after session.start + 10 s; git push passes without ask', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const seen = world(on, { surfaces: [], remote: SKILLS_REMOTE })
  await start($)
  await clock.advance(10000)
  expect(seen.argv).toHaveLength(0)
  expect(seen.toasts).toEqual([])
  expect(seen.statuses).toEqual([])
  expect(passed(await bash($, 'git push origin main'))).toBe(true)
  expect(seen.asks).toEqual([])
})

test('terminal: poll argv is node <abs>/hooks/runs.mjs <root>; session.end stops the polls', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const seen = world(on, { remote: null })
  await start($)
  await clock.advance(5000)
  const polls = seen.argv.filter(a => a[0] === 'node')
  expect(polls.length > 0).toBe(true)
  for (const a of polls) {
    expect(a).toHaveLength(3)
    expect(a[1].startsWith('/')).toBe(true)
    expect(a[1].endsWith('/hooks/runs.mjs')).toBe(true)
    expect(a.some(x => x.includes('${'))).toBe(false)
    expect(a[2]).toBe('/proj')
  }
  await $.session.end({ reason: 'other', sessionId: 's1', resume: 'none' } as never)
  const n = seen.argv.length
  await clock.advance(20000)
  expect(seen.argv).toHaveLength(n)
})

// ---- band ----
for (const surface of ['terminal', 'desktop'] as const) {
  const band = ($: Engine, hasSurvey = false) =>
    $.ui.mount({ plugin: 'mods', surface, component: 'AbovePrompt', props: { hasSurvey, isWorking: false, maxRows: 5, bodyColumns: 80 } } as never)

  test(`${surface}: band shows one open run`, async ($, on) => {
    on('ui.render', (_$, e) => (e.component === 'AbovePrompt' ? { type: 'Text', children: ['engine band'] } : undefined) as never)
    world(on, { surfaces: [surface], state: { runs: [RUN] } })
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /mods-beta/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/2 passed/ })).toBeDefined()
  })

  test(`${surface}: band shows the open run and the engine band beneath it`, async ($, on) => {
    on('ui.render', (_$, e) => (e.component === 'AbovePrompt' ? { type: 'Text', children: ['engine band'] } : undefined) as never)
    world(on, { surfaces: [surface], state: { runs: [RUN] } })
    const ui = await band($)
    expect(await ui.find({ type: 'Text', text: /harness mods-beta: implement/ })).toBeDefined()
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
  })

  test(`${surface}: no open run yields to the engine band`, async ($, on) => {
    on('ui.render', (_$, e) => (e.component === 'AbovePrompt' ? { type: 'Text', children: ['engine band'] } : undefined) as never)
    world(on, { surfaces: [surface], state: { runs: [] } })
    const ui = await band($)
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    expect(await ui.find({ text: /harness mods-beta/ })).toBeUndefined()
  })

  test(`${surface}: a survey yields to the engine band; render runs no process`, async ($, on) => {
    on('ui.render', (_$, e) => (e.component === 'AbovePrompt' ? { type: 'Text', children: ['engine band'] } : undefined) as never)
    const seen = world(on, { surfaces: [surface], state: { runs: [RUN] } })
    const ui = await band($, true)
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    expect(await ui.find({ text: /harness mods-beta/ })).toBeUndefined()
    await ui.redraw()
    expect(seen.argv).toHaveLength(0)
  })
}

// ---- skill toast ----
const skill = ($: Engine, name: string) => call($, 'Skill', { skill: name })

test('skill toast: a plugin of this marketplace toasts and sets the status', async ($, on) => {
  const seen = world(on, { marketplace: MARKETPLACE })
  const r = await skill($, 'think:grill')
  expect(r).toEqual({ result: 'done', text: '' })
  expect(seen.toasts).toEqual(['skill: think:grill'])
  expect(seen.statuses).toEqual(['skill: think:grill'])
})

test('skill toast: a foreign plugin shows nothing', async ($, on) => {
  const seen = world(on, { marketplace: MARKETPLACE })
  await skill($, 'other:thing')
  expect(seen.toasts).toEqual([])
  expect(seen.statuses).toEqual([])
})

test('skill toast: headless shows nothing', async ($, on) => {
  const seen = world(on, { surfaces: [], marketplace: MARKETPLACE })
  await skill($, 'think:grill')
  expect(seen.toasts).toEqual([])
})

test('skill toast: an unreadable marketplace shows nothing and does not throw', async ($, on) => {
  const seen = world(on, { marketplace: new Error('ENOENT') })
  const r = await skill($, 'think:grill')
  expect(r).toEqual({ result: 'done', text: '' })
  expect(seen.toasts).toEqual([])
})

// ---- Agent model guard ----
const MODEL_TOAST = /no model on this Agent call/

test('Agent guard toast (default): no model toasts and the call passes', async ($, on) => {
  const seen = world(on)
  const r = await call($, 'Agent', { prompt: 'x', description: 'x' })
  expect(passed(r)).toBe(true)
  expect(seen.toasts).toHaveLength(1)
  expect(MODEL_TOAST.test(seen.toasts[0])).toBe(true)
})

test('Agent guard deny option: no model is denied, headless too', { options: { agent_model_guard: 'deny' } }, async ($, on) => {
  world(on, { surfaces: [] })
  const r = await call($, 'Agent', { prompt: 'x', description: 'x' })
  expect(denied(r)).toMatch(/pass model/)
})

test('Agent guard: fork passes silently', { options: { agent_model_guard: 'deny' } }, async ($, on) => {
  const seen = world(on)
  const r = await call($, 'Agent', { prompt: 'x', description: 'x', subagent_type: 'fork' })
  expect(passed(r)).toBe(true)
  expect(seen.toasts).toEqual([])
})

test('Agent guard: a given model passes silently', { options: { agent_model_guard: 'deny' } }, async ($, on) => {
  const seen = world(on)
  const r = await call($, 'Agent', { prompt: 'x', description: 'x', model: 'sonnet' })
  expect(passed(r)).toBe(true)
  expect(seen.toasts).toEqual([])
})

test('Agent guard bogus option: behaves as toast', { options: { agent_model_guard: 'bogus' } }, async ($, on) => {
  const seen = world(on)
  const r = await call($, 'Agent', { prompt: 'x', description: 'x' })
  expect(passed(r)).toBe(true)
  expect(seen.toasts).toHaveLength(1)
  expect(MODEL_TOAST.test(seen.toasts[0])).toBe(true)
})

test('Agent guard off: no model passes silently', { options: { agent_model_guard: 'off' } }, async ($, on) => {
  const seen = world(on)
  const r = await call($, 'Agent', { prompt: 'x', description: 'x' })
  expect(passed(r)).toBe(true)
  expect(seen.toasts).toEqual([])
})

// ---- .sh running-script guard ----
for (const tool of ['Edit', 'Write'] as const) {
  test(`.sh guard (${tool}): pgrep hit denies and names the pid`, async ($, on) => {
    const seen = world(on, { proc: argv => (argv[0] === 'pgrep' ? ok('4321\n') : ok('')) })
    const r = await call($, tool, { file_path: '/p/run.sh' })
    expect(denied(r)).toMatch(/4321/)
    expect(seen.argv.some(a => a[0] === 'pgrep' && a.includes('/p/run.sh'))).toBe(true)
  })
}

test('.sh guard: pgrep exit 1 passes', async ($, on) => {
  world(on, { proc: () => ({ exitCode: 1, stdout: '', stderr: '' }) })
  expect(passed(await call($, 'Edit', { file_path: '/p/run.sh' }))).toBe(true)
})

test('.sh guard: pgrep throwing passes (fail open)', async ($, on) => {
  world(on, { proc: () => { throw new Error('no pgrep') } })
  expect(passed(await call($, 'Edit', { file_path: '/p/run.sh' }))).toBe(true)
})

test('.sh guard: a non-script is not checked', async ($, on) => {
  const seen = world(on, { proc: () => ok('4321\n') })
  expect(passed(await call($, 'Write', { file_path: '/p/notes.md' }))).toBe(true)
  expect(seen.argv).toHaveLength(0)
})

// ---- worktree guard (ungated by repo) ----
test('worktree guard: --force with a dirty tree denies', async ($, on) => {
  world(on, { remote: null, proc: argv => (argv.includes('status') ? ok(' M a.ts\n') : ok('')) })
  expect(denied(await bash($, 'git worktree remove --force /wt/x'))).toMatch(/uncommitted changes/)
})

test('worktree guard: --force with a clean tree passes', async ($, on) => {
  world(on, { remote: null, proc: () => ok('') })
  expect(passed(await bash($, 'git worktree remove --force /wt/x'))).toBe(true)
})

test('worktree guard: no --force runs no status', async ($, on) => {
  const seen = world(on, { remote: null, proc: () => ok(' M a.ts\n') })
  expect(passed(await bash($, 'git worktree remove /wt/x'))).toBe(true)
  expect(seen.argv).toHaveLength(0)
})

test('worktree guard: a failing status (path gone) passes', async ($, on) => {
  world(on, { remote: null, proc: () => ({ exitCode: 128, stdout: '', stderr: 'not a repo' }) })
  expect(passed(await bash($, 'git worktree remove --force /wt/gone'))).toBe(true)
})

test('worktree guard: -C <dir> resolves a relative target against it', async ($, on) => {
  const seen = world(on, { remote: null, proc: argv => (argv.includes('status') ? ok(' M a.ts\n') : ok('')) })
  const r = await bash($, 'git -C /x worktree remove --force ../y/w')
  expect(denied(r)).toMatch(/\/y\/w/)
  expect(seen.argv.some(a => a.includes('-C') && a.includes('/y/w'))).toBe(true)
})

// ---- push / patch ask (claude-skills only) ----
test('push ask: Run passes, the question ends in ?', async ($, on) => {
  const seen = world(on, { remote: SKILLS_REMOTE, answer: 'Run' })
  expect(passed(await bash($, 'git push origin main'))).toBe(true)
  expect(seen.asks).toHaveLength(1)
  expect(seen.asks[0].endsWith('?')).toBe(true)
  expect(seen.asks[0]).toMatch(/git push origin main/)
})

test('push ask: Cancel denies', async ($, on) => {
  world(on, { remote: SKILLS_REMOTE, answer: 'Cancel' })
  expect(denied(await bash($, 'git push origin main'))).toMatch(/declined/)
})

test('push ask: free text under Other denies', async ($, on) => {
  world(on, { remote: SKILLS_REMOTE, answer: 'maybe' })
  expect(denied(await bash($, 'git push'))).toMatch(/declined/)
})

test('push ask: a dismissed ask denies, the push does not go through', async ($, on) => {
  world(on, { remote: SKILLS_REMOTE, answer: new Error('dismissed') })
  expect(denied(await bash($, 'git push origin main'))).toMatch(/declined/)
})

test('patch ask: patch-teams.mjs asks, Cancel denies', async ($, on) => {
  const seen = world(on, { remote: SKILLS_REMOTE, answer: 'Cancel' })
  expect(denied(await bash($, 'node _repo/scripts/patch-teams.mjs'))).toMatch(/declined/)
  expect(seen.asks).toHaveLength(1)
})

test('push ask: another origin asks nothing', async ($, on) => {
  const seen = world(on, { remote: 'git@github.com:someone/else.git', answer: 'Cancel' })
  expect(passed(await bash($, 'git push origin main'))).toBe(true)
  expect(seen.asks).toEqual([])
})

test('push ask: no repo asks nothing', async ($, on) => {
  const seen = world(on, { remote: null, answer: 'Cancel' })
  expect(passed(await bash($, 'git push origin main'))).toBe(true)
  expect(seen.asks).toEqual([])
})

// ---- README without KOR ----
const staged = (files: string) => (argv: readonly string[]) => (argv.includes('--cached') ? ok(files) : ok(''))

test('README/KOR: README.md staged alone toasts', async ($, on) => {
  const seen = world(on, { remote: SKILLS_REMOTE, proc: staged('x/README.md\n') })
  expect(passed(await bash($, 'git commit -m x'))).toBe(true)
  expect(seen.toasts).toEqual(['README without KOR: x/README.md'])
})

test('README/KOR: README.md with KOR.md shows nothing', async ($, on) => {
  const seen = world(on, { remote: SKILLS_REMOTE, proc: staged('x/README.md\nx/KOR.md\n') })
  await bash($, 'git commit -m x')
  expect(seen.toasts).toEqual([])
})

test('README/KOR: another origin shows nothing and reads no diff', async ($, on) => {
  const seen = world(on, { remote: 'git@github.com:someone/else.git', proc: staged('x/README.md\n') })
  await bash($, 'git commit -m x')
  expect(seen.toasts).toEqual([])
  expect(seen.argv).toHaveLength(0)
})

// ---- fetch reminder ----
test('fetch reminder: behind 3 toasts; session.start resolves before the fetch completes (F6)', async ($, on) => {
  let release: () => void = () => {}
  const gate = new Promise<void>(res => { release = res })
  const seen = world(on, {
    remote: SKILLS_REMOTE,
    proc: async argv => {
      if (argv[0] === 'git' && argv[1] === 'fetch') {
        await gate
        return ok('')
      }
      return argv[1] === 'rev-list' ? ok('3\n') : ok('[]')
    },
  })
  await start($) // would hang here if session.start waited on the fetch
  expect(seen.toasts).toEqual([])
  release()
  await Promise.resolve()
  await new Promise(res => setTimeout(res, 0))
  expect(seen.toasts).toEqual(['origin/main is 3 commit(s) ahead — pull before editing'])
  const fetch = seen.argv.find(a => a[1] === 'fetch')!
  expect(fetch).toEqual(['git', 'fetch', '-q', 'origin'])
  const rev = seen.argv.find(a => a[1] === 'rev-list')!
  expect(rev).toEqual(['git', 'rev-list', '--count', 'origin/main', '^HEAD'])
})

test('fetch reminder: behind 0 shows nothing', async ($, on) => {
  const seen = world(on, { remote: SKILLS_REMOTE, proc: argv => (argv[1] === 'rev-list' ? ok('0\n') : ok('[]')) })
  await start($)
  await new Promise(res => setTimeout(res, 0))
  expect(seen.toasts).toEqual([])
})

test('fetch reminder: another origin runs no git', async ($, on) => {
  const seen = world(on, { remote: 'git@github.com:someone/else.git' })
  await start($)
  await new Promise(res => setTimeout(res, 0))
  expect(seen.argv.some(a => a[0] === 'git')).toBe(false)
})

// ---- turn-end claude -p count (D2 form a: this session's descendants) ----
// engine pid 4242 (what `sh -c 'echo $PPID'` prints). 4300 is a wrapper shell of the child 4301 (one job);
// 4310 is a second child; 9000 is an unrelated claude -p outside this session.
const PS = [
  '    1     0 /sbin/launchd',
  '4242     1 /usr/local/bin/claude',
  '4300  4242 sh -c claude -p "job one"',
  '4301  4300 /usr/local/bin/claude -p job one',
  '4310  4242 /usr/local/bin/claude -p job two',
  '4320  4242 node /x/server.js',
  '9000     1 /usr/local/bin/claude -p unrelated',
].join('\n')

const TURN = { reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' } as never
const procFor = (ps: string) => (argv: readonly string[]) => (argv[0] === 'sh' ? ok('4242\n') : argv[0] === 'ps' ? ok(ps) : ok(''))

test('turn end: 2 descendant claude -p (wrapper shell counted once) + 1 unrelated -> status "2 ..."', async ($, on) => {
  const seen = world(on, { proc: procFor(PS) })
  await $.turn.complete(TURN)
  expect(seen.statuses).toEqual(['2 claude -p child(ren) running'])
})

test('turn end: only a wrapper shell + its child counts 1', async ($, on) => {
  const seen = world(on, { proc: procFor(PS.split('\n').filter(l => !l.startsWith('4310')).join('\n')) })
  await $.turn.complete(TURN)
  expect(seen.statuses).toEqual(['1 claude -p child(ren) running'])
})

test('turn end: 0 descendants clears the status (undefined)', async ($, on) => {
  const seen = world(on, { proc: procFor(PS.split('\n').filter(l => /^\s*(1|4242|4320|9000)\s/.test(l)).join('\n')) })
  await $.turn.complete(TURN)
  expect(seen.statuses).toEqual([undefined])
})

test('turn end: headless sets no status', async ($, on) => {
  const seen = world(on, { surfaces: [], proc: procFor(PS) })
  await $.turn.complete(TURN)
  expect(seen.statuses).toEqual([])
})
