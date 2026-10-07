import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { memoryStore, sessionAt } from './testkit.ts'

const SKILL = 'think:brainstorming'

// The engine's own answers beneath the plugin, so each event has a bottom.
const bottom = (on: On) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('skill.prompt', (_$, e) => ({ text: e.text }))
  on('tool.call', { tool: 'Skill' }, () => ({ result: 'ran' }))
  on('classic.UserPromptExpansion', () => ({}))
}
const start = (isInteractive: boolean) => ({
  cwd: '/work',
  surface: isInteractive ? ('terminal' as const) : null,
  isInteractive,
})
const PROMPT = { wait: false, origin: { kind: 'composer' } } as any
const uses = (store: Map<string, unknown>) => (store.get('trophy.uses') ?? []) as { skill: string; plugin: string }[]

test('a skill.prompt of this marketplace is stored and the text passes through', async ($, on) => {
  const store = memoryStore(on)
  const clock = sessionAt(on)
  bottom(on)
  await $.session.start(start(true))

  const out = await $.skill.prompt({ skill: SKILL, text: 'the prompt' })

  expect(out).toEqual({ text: 'the prompt' })
  expect(uses(store).map(u => [u.skill, u.plugin])).toEqual([[SKILL, 'think']])
})

test('a skill of another marketplace is not stored', async ($, on) => {
  const store = memoryStore(on)
  const clock = sessionAt(on)
  bottom(on)
  await $.session.start(start(true))

  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: 'x' })

  expect(uses(store)).toEqual([])
})

test('an idle (non-interactive) session stores nothing', async ($, on) => {
  const store = memoryStore(on)
  const clock = sessionAt(on)
  bottom(on)
  await $.session.start(start(false))

  await $.skill.prompt({ skill: SKILL, text: 'x' })

  expect(uses(store)).toEqual([])
})

test('a bare name maps to the plugin-prefixed skill through the index', async ($, on) => {
  const store = memoryStore(on)
  const clock = sessionAt(on)
  bottom(on)
  await $.session.start(start(true))

  await $.skill.prompt({ skill: 'brainstorming', text: 'x' })

  expect(uses(store).map(u => u.skill)).toEqual([SKILL])
})

test('the Skill tool and the typed command record too, once per use', async ($, on) => {
  const store = memoryStore(on)
  const clock = sessionAt(on)
  bottom(on)
  await $.session.start(start(true))

  await $.tool.call({ tool: 'Skill', skill: SKILL })
  await clock.advance(1000)
  await $.skill.prompt({ skill: SKILL, text: 'x' })
  await $.classic.UserPromptExpansion({
    expansion_type: 'slash_command',
    command_name: 'think:grill',
    command_args: '',
    prompt: '/think:grill',
  })

  expect(uses(store).map(u => u.skill)).toEqual([SKILL, 'think:grill'])
})

// Under a team organization skill.prompt and UserPromptExpansion are skipped for user-tier hooks
// (debug: "bypassed by cc-plugin-sec-default (tier user)"); prompt.submit is the one that still runs.
test('a typed /command is recorded from prompt.submit alone, raw or expanded', async ($, on) => {
  const store = memoryStore(on)
  sessionAt(on)
  bottom(on)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await $.session.start(start(true))

  await $.prompt.submit({ text: '/think:grill my plan', ...PROMPT })
  await $.prompt.submit({ text: '<command-message>trophy:list</command-message>\n<command-name>/trophy:list</command-name>', ...PROMPT })
  await $.prompt.submit({ text: '/exit', ...PROMPT })
  await $.prompt.submit({ text: 'path /think:grill in prose', ...PROMPT })

  expect(uses(store).map(u => u.skill)).toEqual(['think:grill', 'trophy:list'])
})

test('a throwing store still returns the prompt text', async ($, on) => {
  const store = memoryStore(on)
  const clock = sessionAt(on)
  bottom(on)
  await $.session.start(start(true))
  store.broken = true

  const out = await $.skill.prompt({ skill: SKILL, text: 'the prompt' })

  expect(out).toEqual({ text: 'the prompt' })
  expect(uses(store)).toEqual([])
})
