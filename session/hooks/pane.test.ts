import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clockAt, memoryState, memoryStore, texts } from './testkit.ts'

const PANE = {
  title: 'Session', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { bodyRows: 20 }, view: {},
} as any

const LEDGER = {
  files: ['/w/src/a.ts', '/w/src/b.ts'],
  commits: [{ hash: 'abc1234', subject: 'feat: add a' }],
  denied: [{ tool: 'Bash', reason: 'rm blocked' }],
  steps: [1000, 373000],
}

const NUMSTAT = '12\t3\tsrc/a.ts\n-\t-\tsrc/b.ts\n'

const world = (on: On, seed: Record<string, unknown> = { 'session.ledger': LEDGER }, git: 'ok' | 'none' = 'ok') => {
  memoryStore(on)
  const cells = memoryState(on)
  for (const [k, v] of Object.entries(seed)) cells.set(k, v)
  clockAt(on)
  const procs: string[][] = []
  on('process.run', (_$, e) => {
    procs.push([...e.argv])
    if (e.argv[0] === 'git' && git === 'ok') return { value: { exitCode: 0, stdout: NUMSTAT, stderr: '' } } as never
    if (e.argv[0] === 'git') return { value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } } as never
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } as any }
  })
  return { cells, procs, opened }
}

const mount = ($: any, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'session', surface, component: 'Pane', requestId: 'session', props: PANE })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: Retro shows files with stats, commit, denied and longest gap`, async ($, on) => {
    const { procs } = world(on)
    await $.session.start({ cwd: '/w', surface, isInteractive: true })
    await $.command.run({ command: 'session', args: '' } as any)

    const lines = texts(await (await mount($, surface)).drawn())

    expect(lines).toContain('files (2)')
    expect(lines.some(l => l.includes('src/a.ts') && l.includes('+12 -3'))).toBe(true)
    expect(lines.some(l => l.includes('src/b.ts') && l.includes('+0 -0'))).toBe(true)
    expect(lines.some(l => l.includes('abc1234') && l.includes('feat: add a'))).toBe(true)
    expect(lines.some(l => l.includes('Bash') && l.includes('rm blocked'))).toBe(true)
    expect(lines.some(l => l.includes('longest gap') && l.includes('6m12s'))).toBe(true)
    expect(procs.some(p => p[0] === 'git' && p.includes('--numstat'))).toBe(true)
  })

  test(`${surface}: pressing the Orphans tab flips tab`, async ($, on) => {
    const { cells } = world(on)
    await $.session.start({ cwd: '/w', surface, isInteractive: true })
    const ui = await mount($, surface)
    await ui.drawn()

    await ui.press({ key: 'tab-orphans' })

    expect(cells.get('session.tab')).toBe('orphans')
  })

  test(`${surface}: no git means no stats text and no throw`, async ($, on) => {
    world(on, { 'session.ledger': LEDGER }, 'none')
    await $.session.start({ cwd: '/w', surface, isInteractive: true })
    await $.command.run({ command: 'session', args: '' } as any)

    const lines = texts(await (await mount($, surface)).drawn())

    expect(lines.some(l => l.includes('src/a.ts'))).toBe(true)
    expect(lines.some(l => /\+\d+ -\d+/.test(l))).toBe(false)
  })

  test(`${surface}: drawing runs no process`, async ($, on) => {
    const { procs } = world(on)
    await $.session.start({ cwd: '/w', surface, isInteractive: true })
    procs.length = 0

    await (await mount($, surface)).drawn()

    expect(procs).toHaveLength(0)
  })
}

test('/session opens the pane', async ($, on) => {
  const { opened } = world(on)
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  const out = await $.command.run({ command: 'session', args: '' } as any)

  expect(opened).toEqual(['session'])
  expect(out.text).toMatch(/pane/i)
})
