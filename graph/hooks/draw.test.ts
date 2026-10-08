import { expect, test } from 'claude-code/testing'

import { DOT, MARK, TINT, cells, connector, fmt, isKorean } from './draw'

test('MARK, DOT, TINT match teams', () => {
  expect(MARK).toEqual({ done: '✔', running: '●', pending: '○', failed: '✘' })
  expect(DOT).toEqual({ done: '●', running: '◉', pending: '○', failed: '✘' })
  expect(TINT).toEqual({ done: 'success', running: 'claude', pending: 'inactive', failed: 'error' })
})

test('cells rounds and clamps', () => {
  expect(cells(0, 0, 10)).toBe(0)
  expect(cells(2, 5, 10)).toBe(4)
  expect(cells(9, 5, 10)).toBe(10)
})

test('connector is solid once started, dotted before', () => {
  expect(connector('pending')).toBe(' ┄┄ ')
  expect(connector('done')).toBe(' ━━ ')
})

test('fmt formats a missing key to empty', () => {
  expect(fmt('{a} {b}', { a: 1 })).toBe('1 ')
  expect(fmt(undefined)).toBe('')
})

test('isKorean reads the language setting', () => {
  for (const v of ['Korean', 'ko-KR', '한국어']) expect(isKorean(v)).toBe(true)
  expect(isKorean('English')).toBe(false)
})
