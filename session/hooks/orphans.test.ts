import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clockAt, memoryState, memoryStore, texts } from './testkit.ts'

const PANE = {
  title: 'Session', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {},
} as any

const T = 'Wed Oct  8 10:09:00 2026'
export const PS = [
  `    1     0 ${T} /sbin/launchd`,
  ` 4242     1 ${T} /usr/local/bin/claude`,
  ` 4300  4242 ${T} sh -c claude -p "job one"`,
  ` 4301  4300 ${T} /usr/local/bin/claude -p job one`,
  ` 4310  4242 ${T} /usr/local/bin/claude -p job two`,
  ` 4320  4242 ${T} node /x/server.js`,
  ` 9000     1 ${T} /usr/local/bin/claude -p unrelated`,
].join('\n')

export const world = (on: On, opts: { ps?: string; os?: string } = {}) => {
  memoryStore(on)
  const cells = memoryState(on)
  clockAt(on, Date.parse('Oct 8 2026 10:14:00'))
  const procs: string[][] = []
  const body = { ps: opts.ps ?? PS }
  on('process.run', (_$, e) => {
    procs.push([...e.argv])
    const out = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } }) as never
    if (e.argv[0] === 'sh') return out('4242\n')
    if (e.argv[0] === 'ps') return out(body.ps)
    return out('')
  })
  on('env.get', (_$, e) => ({ value: e.name === 'OS' ? opts.os : undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } as any }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  return { cells, procs, body }
}

export const mount = ($: any) =>
  $.ui.mount({ plugin: 'session', surface: 'terminal', component: 'Pane', requestId: 'session', props: PANE })

const orphansView = async ($: any) => {
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session', args: '' } as any)
  const ui = await mount($)
  await ui.press({ key: 'tab-orphans' })
  await ui.unmount()
  return texts(await (await mount($)).drawn())
}

test('Orphans lists the job once with pid, command and age, and points to /tasks', async ($, on) => {
  world(on)

  const lines = await orphansView($)

  expect(lines).toContain('claude -p children (2)')
  expect(lines).toContain('4300')
  expect(lines).toContain('4310')
  expect(lines).not.toContain('4301')
  expect(lines).not.toContain('9000')
  expect(lines.some(l => l.includes('claude -p job two'))).toBe(true)
  expect(lines).toContain('5m')
  expect(lines.some(l => l.includes('/tasks'))).toBe(true)
})

test('a garbage ps line is skipped, an empty tree reads none', async ($, on) => {
  world(on, { ps: `  1 0 ${T} /sbin/launchd\nnot a ps line\n 4242 1 ${T} claude` })

  const lines = await orphansView($)

  expect(lines).toContain('claude -p children (0)')
  expect(lines).toContain('○ none')
})

test('turn end polls ps for an interactive session', async ($, on) => {
  const { procs } = world(on)
  on('turn.complete', (_$, e) => ({ text: e.answer }))

  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: 't' } as never)

  expect(procs.some(p => p[0] === 'ps')).toBe(true)
})

test('Windows: no ps and no sh, no orphan rows, the /tasks pointer stays', async ($, on) => {
  const { procs } = world(on, { os: 'Windows_NT' })

  const lines = await orphansView($)

  expect(procs.filter(p => p[0] === 'ps' || p[0] === 'sh')).toEqual([])
  expect(lines).not.toContain('4310')
  expect(lines.some(l => l.includes('/tasks'))).toBe(true)
})
