import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryStore, sessionAt } from './testkit.ts'

const MARKETPLACE = JSON.stringify({ plugins: [{ name: 'develop', source: './develop' }, { name: 'think', source: './think' }] })
const SKILLS: Record<string, string[]> = { develop: ['clean-code'], think: ['grill'] }

// The engine's own answers beneath the plugin; returns the toasts raised.
const boot = async ($: any, on: On, interactive = true) => {
  memoryStore(on)
  sessionAt(on)
  const toasts: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('/.claude-plugin/marketplace.json')) return { value: MARKETPLACE } as never
    throw new Error('ENOENT')
  })
  on('fs.list', (_$, e) => {
    const m = /\/([a-z]+)\/skills$/.exec(e.path)
    return { value: (SKILLS[m?.[1] ?? ''] ?? []).map(name => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })) } as never
  })
  on('session.version', () => ({ value: { version: '2.1.293', base: '2.1.293' } }) as never)
  on('fs.write', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'Skill' }, () => ({ result: { success: true, commandName: 'x' } }) as never)
  await $.session.start({ cwd: '/work', surface: interactive ? 'terminal' : null, isInteractive: interactive })
  return toasts
}

test('a Skill call of this marketplace raises one ◆ toast, none when the call unlocks an achievement', async ($, on) => {
  const toasts = await boot($, on)
  await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' }) // unlocks first-blood: 🏆 only
  expect(toasts.map(t => t.slice(0, 2))).toEqual(['🏆', '🏆'])
  toasts.length = 0
  await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' })
  expect(toasts).toEqual(['◆ develop:clean-code'])
})

test('a skill of another marketplace raises no toast', async ($, on) => {
  const toasts = await boot($, on)
  await $.tool.call({ tool: 'Skill', skill: 'superpowers:brainstorming' })
  expect(toasts).toEqual([])
})

test('a non-interactive session raises no toast', async ($, on) => {
  const toasts = await boot($, on, false)
  await $.tool.call({ tool: 'Skill', skill: 'develop:clean-code' })
  expect(toasts).toEqual([])
})
