import { test, expect } from 'claude-code/testing'

import {
  ageLabel, ageText, cutLine, facts, FOOTER_KEYS, isStale, memoHeader, memoLines, memoRows, noteAge, scopeBadge, sentLabel,
  sentText, sizeLabel, staleHint,
} from './memo-logic.ts'

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

test('ageText reads today under a day, then <n>d', () => {
  expect([0, 1, 9, 21].map(ageText)).toEqual(['today', '1d', '9d', '21d'])
})

test('staleHint: 13 days carries none, 14 and 15 carry stale?', () => {
  expect([13, 14, 15].map(d => staleHint(note('a', d), NOW))).toEqual(['', 'stale?', 'stale?'])
})

test('scopeBadge pads both scopes to one width', () => {
  expect(scopeBadge('global')).toBe('global ')
  expect(scopeBadge('project')).toBe('project')
  expect(scopeBadge('global')).toHaveLength(scopeBadge('project').length)
})

test('memoLines: global first then project, numbered as /memo rm, one line of facts each', () => {
  const lines = memoLines([note('g1', 21)], [note('p1', 0), note('p2', 13)], NOW)
  expect(lines).toEqual([
    { n: 1, badge: 'global ', text: 'g1', age: '21d', stale: 'stale?' },
    { n: 2, badge: 'project', text: 'p1', age: 'today', stale: '' },
    { n: 3, badge: 'project', text: 'p2', age: '13d', stale: '' },
  ])
})

test('memoLines leaves out the notes the caps cut', () => {
  const big = (i: number) => ({ text: String(i).repeat(280), ts: NOW })
  expect(memoLines([], [big(1), big(2), big(3), big(4), big(5)], NOW)).toHaveLength(4)
})

test('sentText: the local time once the block went out, a dash while armed even with an earlier sentAt', () => {
  const at = new Date(2026, 9, 8, 14, 2).getTime()
  expect(sentText(false, at)).toBe('14:02')
  expect(sentText(true, at)).toBe('—')
  expect(sentText(true, 0)).toBe('—')
  expect(sentText(false, 0)).toBe('—')
})

test('memoHeader: count, size over the visible notes and the send state', () => {
  const at = new Date(2026, 9, 8, 14, 2).getTime()
  expect(memoHeader([note('abc', 0)], [note('de', 1)], { armed: false, sentAt: at })).toBe('2 notes · 5/1200 chars · sent 14:02')
  expect(memoHeader([note('abc', 0)], [note('de', 1)], { armed: true, sentAt: at })).toBe('2 notes · 5/1200 chars · sent —')
  expect(memoHeader([], [note('abc', 0)], { armed: true, sentAt: 0 })).toBe('1 note · 3/1200 chars · sent —')
})

test('memoHeader counts the visible notes only', () => {
  const big = (i: number) => ({ text: String(i).repeat(280), ts: NOW })
  expect(memoHeader([], [big(1), big(2), big(3), big(4), big(5)], { armed: true, sentAt: 0 })).toBe('4 notes · 1120/1200 chars · sent —')
})

test('memoHeader sums 412 characters over both scopes', () => {
  expect(memoHeader([note('x'.repeat(200), 0)], [note('y'.repeat(212), 0)], { armed: true, sentAt: 0 })).toContain('412/1200 chars')
})

test('cutLine is +<n> not sent for the stored notes the caps left out, empty when none', () => {
  const big = (i: number) => ({ text: String(i).repeat(280), ts: NOW })
  expect(cutLine([], [big(1), big(2), big(3), big(4), big(5), big(6)])).toBe('+2 not sent')
  expect(cutLine([note('a', 0)], [note('b', 0)])).toBe('')
  expect(cutLine([], [])).toBe('')
})

test('FOOTER_KEYS are the three /memo forms', () => {
  expect(FOOTER_KEYS).toBe('/memo add <text> · /memo rm <n> · /memo clear')
})
