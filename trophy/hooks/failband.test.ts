import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryStore, sessionAt } from './testkit.ts'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 80 } as any

const texts = (node: any): string[] =>
  Array.isArray(node)
    ? node.flatMap(texts)
    : node?.type === 'Text'
      ? [(node.children ?? []).join('')]
      : node?.children
        ? texts(node.children)
        : []

const boot = async ($: any, on: On) => {
  memoryStore(on, { 'trophy.consent': 'no', 'trophy.consentVersion': 2 })
  sessionAt(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return Box({}) as never
  })
  on('ui.open',() => ({ value: { isPlaced: true } as any }))
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('/.claude-plugin/marketplace.json')) {
      return { value: JSON.stringify({ plugins: [{ name: 'develop', source: './develop' }] }) } as never
    }
    throw new Error('ENOENT')
  })
  on('fs.list', () => ({ value: [{ name: 'clean-code', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }) as never)
  on('classic.PostToolUseFailure', () => ({}))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  return () => $.ui.mount({ plugin: 'trophy', surface: 'terminal', component: 'AbovePrompt', props: BAND })
}

const fail = () => ({
  tool_name: 'Skill', tool_input: { skill: 'develop:clean-code' }, tool_use_id: 't1', error: 'boom',
}) as never

test('band is absent until an owned failure, then shows the count and last title', async ($, on) => {
  const mount = await boot($, on)
  expect(texts(await (await mount()).drawn())).toEqual([])

  await $.classic.PostToolUseFailure(fail())
  const lines = texts(await (await mount()).drawn())

  expect(lines).toContain('✘ 1')
  expect(lines.some(l => l.includes('develop:clean-code'))).toBe(true)
})

test('/trophy-bug does not raise the badge', async ($, on) => {
  const mount = await boot($, on)
  await $.command.run({ command: 'trophy-bug', args: 'it broke' } as any)
  expect(texts(await (await mount()).drawn())).toEqual([])
})

test('the 보기 button opens the failures tab and clears the badge', async ($, on) => {
  const mount = await boot($, on)
  await $.classic.PostToolUseFailure(fail())
  const ui = await mount()

  await ui.press({ key: 'see' })

  expect(texts(await (await mount()).drawn())).toEqual([])
})
