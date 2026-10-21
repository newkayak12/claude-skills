// demo-frames.ts shrinks() decides which cells of a row give way. flexShrink={0} pins a cell, as in Ink.
// row() cuts shrinking cells from the last index backwards, so a pinned cell placed LAST is the one the old
// `flexShrink !== undefined` condition would have cut first. Each pinned case puts the shrinking cell before it.
import { test, expect } from 'claude-code/testing'

import { draw, fit } from './demo-frames.ts'

const COLS = 12
const LONG = 'bbbbbbbbbb'
const WHOLE = 'AAAAAA'
const text = (s: string, props: Record<string, any> = {}) => ({ type: 'Text', props, children: [s] })
const row = (...cells: any[]) => ({ type: 'Box', props: { gap: 1 }, children: cells })
// 10 + 1 + 6 = 17 columns of content in 12: the row is 5 over, so one cell has to give way.
const pinnedLast = (pinned: any) => draw(row(text(LONG, { flexShrink: 1 }), pinned), COLS)

test('fit keeps a string that fits and ends a longer one in an ellipsis of exactly the width', () => {
  expect(fit('abc', 3)).toBe('abc')
  expect(fit('abcd', 3)).toBe('ab…')
  expect(fit('abcd', 0)).toBe('…')
})

test('flexShrink={0} pins the cell: its text stays whole and the shrinking cell before it is cut', () => {
  expect(pinnedLast(text(WHOLE, { flexShrink: 0 }))).toEqual(['bbbb… AAAAAA'])
})

test('a cell with no flexShrink is pinned the same way', () => {
  expect(pinnedLast(text(WHOLE))).toEqual(['bbbb… AAAAAA'])
})

test('a flexShrink that is not a number (NaN, "abc") pins the cell', () => {
  expect(pinnedLast(text(WHOLE, { flexShrink: NaN }))).toEqual(['bbbb… AAAAAA'])
  expect(pinnedLast(text(WHOLE, { flexShrink: 'abc' }))).toEqual(['bbbb… AAAAAA'])
})

test('flexShrink={1} shrinks: the last shrinking cell is cut and a pinned cell before it stays whole', () => {
  expect(draw(row(text(WHOLE, { flexShrink: 0 }), text(LONG, { flexShrink: 1 })), COLS)).toEqual(['AAAAAA bbbb…'])
})

test('wrap="truncate-end" shrinks: the text is cut and a pinned cell before it stays whole', () => {
  expect(draw(row(text(WHOLE, { flexShrink: 0 }), text(LONG, { wrap: 'truncate-end' })), COLS)).toEqual(['AAAAAA bbbb…'])
})

test('a row that fits is drawn whole whatever the flexShrink values', () => {
  expect(draw(row(text('ab', { flexShrink: 0 }), text('cd', { flexShrink: 1 })), COLS)).toEqual(['ab cd'])
})

// Known behaviour, not a goal: shrinks() recurses with `.some(shrinks)`, so a flexShrink={0} Box that holds a
// shrinking child still reports as shrinking. Ink would keep the Box at its width; the fixture cuts it. This pins
// what the code does today (flagged by the D5 critique); change it only together with demo-frames.ts.
test('known behaviour: a flexShrink={0} Box holding a wrap="truncate-end" Text still shrinks', () => {
  const box = { type: 'Box', props: { flexShrink: 0 }, children: [text(WHOLE, { wrap: 'truncate-end' })] }
  expect(draw(row(text(LONG, { flexShrink: 1 }), box), COLS)).toEqual(['bbbbbbbbbb …'])
})

test('known behaviour: a flexShrink={0} Box holding a flexShrink>0 Text still shrinks', () => {
  const box = { type: 'Box', props: { flexShrink: 0 }, children: [text(WHOLE, { flexShrink: 1 })] }
  expect(draw(row(text(LONG, { flexShrink: 1 }), box), COLS)).toEqual(['bbbbbbbbbb …'])
})
