import { test, expect } from 'claude-code/testing'

import { compactFailed, compactRetry, FINAL_TRIES, firstLine, shouldCompactNow } from './compact-logic.ts'

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

test('firstLine and compactFailed keep the first line of an error or string', () => {
  expect(firstLine(new Error('busy\nstack'))).toBe('busy')
  expect(firstLine('plain\nmore')).toBe('plain')
  expect(compactFailed(new Error('turn running\nat x'))).toBe('compact-failed:turn running')
})

test('compactRetry waits for the turn end, then tries a bounded number of times', () => {
  expect(compactRetry(false, 0, new Error('busy'))).toBe('wait')
  expect(compactRetry(false, 99, new Error('busy'))).toBe('wait')
  expect(compactRetry(true, 0)).toBe('try')
  expect(compactRetry(true, FINAL_TRIES - 1, new Error('busy'))).toBe('try')
  expect(compactRetry(true, FINAL_TRIES, new Error('busy'))).toBe('fail')
})
