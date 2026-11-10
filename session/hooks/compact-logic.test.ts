import { test, expect } from 'claude-code/testing'

import { COMPACT_MARK, firstLine, handoffFor, shouldCompactNow, tailBudget, tailStart, type TailRow } from './compact-logic.ts'

const idle = { isRunning: false, surfaces: 1 }

test('shouldCompactNow: at the threshold runs, below does not', () => {
  expect(shouldCompactNow(60, 60, idle)).toBe('run')
  expect(shouldCompactNow(85, 60, idle)).toBe('run')
  expect(shouldCompactNow(59, 60, idle)).toBe('below')
})

test('shouldCompactNow: running, agent and headless skip before the percent is read', () => {
  expect(shouldCompactNow(90, 60, { ...idle, isRunning: true })).toBe('skipped:running')
  expect(shouldCompactNow(90, 60, { ...idle, agentId: 'a1' })).toBe('skipped:agent')
  expect(shouldCompactNow(90, 60, { ...idle, surfaces: 0 })).toBe('skipped:headless')
})

test('firstLine keeps the first line of an error or string', () => {
  expect(firstLine(new Error('busy\nstack'))).toBe('busy')
  expect(firstLine('plain\nmore')).toBe('plain')
})

test('handoffFor: auto-compact and our own /compact get a handoff; a person’s /compact and a subagent do not', () => {
  expect(handoffFor({ trigger: 'auto' })).toBe('auto')
  expect(handoffFor({ trigger: 'manual', instructions: COMPACT_MARK })).toBe('own')
  expect(handoffFor({ trigger: 'manual', instructions: ` ${COMPACT_MARK}\n` })).toBe('own')
  expect(handoffFor({ trigger: 'manual', instructions: 'keep the code' })).toBe(null)
  expect(handoffFor({ trigger: 'manual' })).toBe(null)
  expect(handoffFor({ trigger: 'plugin', instructions: COMPACT_MARK })).toBe(null)
  expect(handoffFor({ trigger: 'precompute' })).toBe(null)
  expect(handoffFor({ trigger: 'auto', agentId: 'a1' })).toBe(null)
})

const say = (role: 'user' | 'assistant', chars: number): TailRow => ({ role, text: 'x'.repeat(chars), toolUses: [] })
const call = (id: string, chars = 0): TailRow => ({
  role: 'assistant',
  text: 'x'.repeat(chars),
  toolUses: [{ tool_use_id: id, input: {} }],
})
const back = (id: string, chars = 0): TailRow => ({
  role: 'user',
  text: '',
  toolUses: [],
  toolResults: [{ tool_use_id: id, text: 'r'.repeat(chars) }],
})

test('tailBudget is half the threshold as a percent of the window, capped at 20%', () => {
  expect(tailBudget(100000, 10)).toBe(5000)
  expect(tailBudget(100000, 90)).toBe(20000)
  expect(tailBudget(100001, 7)).toBe(3500)
})

test('tailStart within budget takes the newest rows that fit, counting chars/3', () => {
  const rows = [say('user', 30), say('assistant', 30), say('user', 30), say('assistant', 30)]
  expect(tailStart(rows, 20)).toBe(2)
  expect(tailStart(rows, 40)).toBe(0)
  expect(tailStart(rows, 19)).toBe(3)
})

test('tailStart counts tool_use input and tool_result text, not a tool_use result or text', () => {
  const use: TailRow = {
    role: 'assistant',
    text: '',
    toolUses: [{ tool_use_id: 'a', input: { k: 'x'.repeat(28) }, result: 'y'.repeat(900), text: 'y'.repeat(900) } as never],
  }
  // input {"k":"xxxx…"} is 34 chars = 12 tokens; result and text add nothing
  expect(tailStart([use], 12)).toBe(0)
  expect(tailStart([use], 11)).toBe(1)
  expect(tailStart([say('user', 3), back('a', 60)], 20)).toBe(2)
})

test('tailStart orphan tool_result moves the start past its row', () => {
  const rows = [say('user', 3), call('a'), back('a', 30), say('assistant', 3)]
  // 1 + 10 tokens fit, the call (1 more) does not: back('a') has lost its tool_use
  expect(tailStart(rows, 11)).toBe(3)
  // with the tool_use inside the tail the pair stays
  expect(tailStart(rows, 12)).toBe(1)
  expect(tailStart(rows, 100)).toBe(0)
})

test('tailStart parallel tool_use rows: a result for a cut-off sibling moves the start past both', () => {
  const rows = [call('x'), call('y'), back('x'), back('y'), say('assistant', 3)]
  expect(tailStart(rows, 100)).toBe(0)
  // starts at call y: back x is orphaned, so the start passes it and then back y
  expect(tailStart(rows, 1)).toBe(4)
  const six = [say('user', 3), call('x'), call('y'), back('x'), back('y')]
  expect(tailStart(six, 0)).toBe(5)
})

test('tailStart over budget on the last row alone gives an empty tail', () => {
  const rows = [say('user', 3), say('assistant', 300)]
  expect(tailStart(rows, 50)).toBe(2)
  expect(tailStart([], 50)).toBe(0)
})
