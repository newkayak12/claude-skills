import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryStore, sessionAt } from './testkit.ts'

const START = { cwd: '/w', surface: 'terminal', isInteractive: true } as const
const PROMPT = { wait: false, origin: { kind: 'composer' } } as any
const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

const bottom = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: 'done' }))
  on('tool.call', { tool: 'Skill' }, () => ({ result: 'ran' }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.usage', () => ({ deny: 'no usage' }))
}

test('with a broken store every hook still returns what the chain below returned', async ($, on) => {
  const store = memoryStore(on)
  sessionAt(on)
  bottom(on)
  on('fs.write', () => ({ deny: 'read-only' }))
  await $.session.start(START)
  store.broken = true

  expect(await $.skill.prompt({ skill: 'think:grill', text: 'a' })).toEqual({ text: 'a' })
  expect(await $.prompt.submit({ text: 'b', ...PROMPT })).toEqual({ text: 'b' })
  expect(await $.turn.complete(TURN)).toEqual({ text: 'done' })
  expect(await $.tool.call({ tool: 'Skill', skill: 'think:grill' })).toEqual({ result: 'ran' })
  expect(await $.session.start(START)).toEqual({ cwd: '/w' })
})

test('a thrown fetch does not break session start', async ($, on) => {
  memoryStore(on, { 'trophy.consent': 'yes', 'trophy.installId': 'i', 'trophy.uses': [{ skill: 'think:grill', plugin: 'think', day: '2026-10-01', session: 's', ts: 1 }] })
  sessionAt(on)
  bottom(on)
  on('http.fetch', () => ({ deny: 'offline' }))
  on('fs.write', () => ({ value: undefined }))

  expect(await $.session.start(START)).toEqual({ cwd: '/w' })
})

test('a non-interactive session never fetches, writes a profile or stores', async ($, on) => {
  const store = memoryStore(on, { 'trophy.consent': 'yes', 'trophy.installId': 'i' })
  sessionAt(on)
  bottom(on)
  const calls: string[] = []
  on('http.fetch', () => {
    calls.push('fetch')
    return { value: { status: 200, ok: true, headers: {}, text: '' } }
  })
  on('fs.write', () => {
    calls.push('write')
    return { value: undefined }
  })
  const before = JSON.stringify([...store])

  await $.session.start({ ...START, surface: null, isInteractive: false })
  await $.skill.prompt({ skill: 'think:grill', text: 'x' })
  await $.prompt.submit({ text: 'x', ...PROMPT })
  await $.turn.complete(TURN)

  expect(calls).toEqual([])
  expect(JSON.stringify([...store])).toBe(before)
})
