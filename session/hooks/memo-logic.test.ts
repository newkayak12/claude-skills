import { test, expect } from 'claude-code/testing'

import { ageLabel, facts, isStale, memoRows, noteAge, sentLabel, sizeLabel } from './memo-logic.ts'

const NOW = Date.parse('2026-10-08T09:00:00Z')
const DAY = 86_400_000
const note = (text: string, days: number) => ({ text, ts: NOW - days * DAY })
const pad = (n: number) => String(n).padStart(2, '0')

test('noteAge counts whole days from now and never goes negative', () => {
  expect(noteAge(note('a', 0), NOW)).toBe(0)
  expect(noteAge({ text: 'a', ts: NOW - 2.9 * DAY }, NOW)).toBe(2)
  expect(noteAge({ text: 'a', ts: NOW + DAY }, NOW)).toBe(0)
})

test('isStale: 13 days is fresh, 14 days is stale', () => {
  expect(isStale(note('a', 13), NOW)).toBe(false)
  expect(isStale(note('a', 14), NOW)).toBe(true)
  expect(isStale(note('a', 30), NOW)).toBe(true)
})

test('ageLabel reads today, 1 day old, N days old', () => {
  expect([0, 1, 9].map(ageLabel)).toEqual(['today', '1 day old', '9 days old'])
})

test('sizeLabel is the characters of the notes against the 1200 cap', () => {
  expect(sizeLabel([])).toBe('0/1200 chars')
  expect(sizeLabel([note('abc', 0), note('de', 0)])).toBe('5/1200 chars')
})

test('sentLabel is a dash before the first send, absent or 0', () => {
  expect(sentLabel(0)).toBe('—')
  expect(sentLabel(undefined)).toBe('—')
})

test('sentLabel is local HH:MM, not UTC', () => {
  const at = new Date(2026, 9, 8, 14, 5).getTime()
  expect(sentLabel(at)).toBe('14:05')
  const d = new Date(NOW)
  expect(sentLabel(NOW)).toBe(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
})

test('memoRows numbers global then project and flags each note', () => {
  const rows = memoRows([note('g1', 20)], [note('p1', 2), note('p2', 14)], NOW)
  expect(rows.map(r => [r.n, r.scope, r.text, r.days, r.stale])).toEqual([
    [1, 'global', 'g1', 20, true],
    [2, 'project', 'p1', 2, false],
    [3, 'project', 'p2', 14, true],
  ])
  expect(rows[0]!.age).toBe('20 days old')
  expect(rows[0]!.hint).toBe('20d old: move to CLAUDE.md?')
  expect(rows[1]!.hint).toBe('')
  expect(rows.map(r => r.meta)).toEqual(['1 · global · 20 days old', '2 · project · 2 days old', '3 · project · 14 days old'])
})

test('memoRows leaves out the notes the caps cut, as the injected block does', () => {
  const big = (i: number) => ({ text: String(i).repeat(280), ts: NOW })
  const rows = memoRows([], [big(1), big(2), big(3), big(4), big(5)], NOW)
  expect(rows).toHaveLength(4)
})

test('facts: size counts the shown notes only and the empty case is zero', () => {
  const f = facts([note('abc', 0)], [note('de', 1)], NOW)
  expect(f.size).toBe('5/1200 chars')
  expect(f.rows).toHaveLength(2)
  expect(f.count).toBe('2/8 notes · 5/1200 chars · ~2 tok')
  expect(f.cut).toBe('')
  expect(facts([], [], NOW).size).toBe('0/1200 chars')
})

test('facts: the summary carries the sent time, or a dash before the first send, and the size', () => {
  const f = facts([note('abc', 0)], [], NOW, new Date(2026, 9, 8, 14, 2).getTime())
  expect(f.summary).toBe('sent with this conversation: 14:02 · 3/1200 chars')
  expect(facts([note('abc', 0)], [], NOW).summary).toBe('sent with this conversation: — · 3/1200 chars')
  expect(facts([note('abc', 0)], [], NOW, 0).sent).toBe('—')
})
