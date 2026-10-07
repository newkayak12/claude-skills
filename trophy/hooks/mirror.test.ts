import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryStore, sessionAt } from './testkit.ts'

const bottom = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
}

test('one unlock writes profile.json with that id and no uses', async ($, on) => {
  memoryStore(on)
  sessionAt(on)
  mock.env(on, { HOME: '/home/kim' })
  bottom(on)
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_$, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  await $.skill.prompt({ skill: 'think:grill', text: 'x' })

  const profile = writes.at(-1)!
  expect(profile.path).toBe('/home/kim/.claude/trophy/profile.json')
  const body = JSON.parse(profile.text)
  expect(Object.keys(body.unlocked)).toContain('first-think')
  expect(body.progress['collector-10']).toEqual([1, 10])
  expect(Object.keys(body)).not.toContain('uses')
  expect(profile.text).not.toContain('session-1')
})

test('a failing profile write does not break the prompt', async ($, on) => {
  memoryStore(on)
  sessionAt(on)
  mock.env(on, { HOME: '/home/kim' })
  bottom(on)
  on('fs.write', () => ({ deny: 'read-only' }))
  await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

  expect(await $.skill.prompt({ skill: 'think:grill', text: 'x' })).toEqual({ text: 'x' })
})
