import { test, expect } from 'claude-code/testing'

import { mount, T, world } from './orphankit.ts'
import { texts } from './testkit.ts'

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
