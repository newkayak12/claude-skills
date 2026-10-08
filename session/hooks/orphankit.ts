// Shared by the orphan and kill tests only; the module never imports it.
import type { On } from 'claude-code'

import { clockAt, memoryState, memoryStore } from './testkit.ts'

const PANE = {
  title: 'Session', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {},
} as any

export const T = 'Wed Oct  8 10:09:00 2026'
// engine 4242. 4300 is a wrapper shell of the child 4301 (one job); 4310 is a second job;
// 9000 is a claude -p outside this session; 4320 is not claude -p.
export const PS = [
  `    1     0 ${T} /sbin/launchd`,
  ` 4242     1 ${T} /usr/local/bin/claude`,
  ` 4300  4242 ${T} sh -c claude -p "job one"`,
  ` 4301  4300 ${T} /usr/local/bin/claude -p job one`,
  ` 4310  4242 ${T} /usr/local/bin/claude -p job two`,
  ` 4320  4242 ${T} node /x/server.js`,
  ` 9000     1 ${T} /usr/local/bin/claude -p unrelated`,
].join('\n')

// Every process call is answered from memory and recorded in `procs`: no real signal is ever sent.
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
