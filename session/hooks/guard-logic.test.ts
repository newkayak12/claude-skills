import { test, expect } from 'claude-code/testing'

import { stopHeader, stopRows } from './guard-logic.ts'
import type { Denial } from './guard-logic.ts'

const D = (id: string, ts: number, source: Denial['source'], extra: Partial<Denial> = {}): Denial => ({
  id, ts, tool: 'Bash', call: `call ${id}`, reason: `why ${id}`, source, ...extra,
})
const pad = (n: number) => String(n).padStart(2, '0')

test('stopRows lists the ring newest first', () => {
  const rows = stopRows([D('a', 1000, 'guard'), D('b', 2000, 'native'), D('c', 3000, 'declined')])
  expect(rows.map(r => r.id)).toEqual(['c', 'b', 'a'])
})

test('stopRows: a guard stop carries its rule id and source', () => {
  const [r] = stopRows([D('a', 1000, 'guard', { rule: 'hard-reset' })])
  expect(r).toMatchObject({ rule: 'hard-reset', source: 'guard', sourceLabel: 'guard' })
})

test('stopRows: declined and native keep their source label; no rule reads as a dash', () => {
  const [n, d] = stopRows([D('a', 1000, 'declined', { rule: 'recursive-delete' }), D('b', 2000, 'native')])
  expect(n).toMatchObject({ source: 'native', sourceLabel: 'native', rule: '—' })
  expect(d).toMatchObject({ source: 'declined', sourceLabel: 'declined', rule: 'recursive-delete' })
})

test('stopRows: a native stop shows the native permission rule when it has no guard rule', () => {
  const [r] = stopRows([D('a', 1000, 'native', { nativeRule: 'Bash(curl:*)' })])
  expect(r!.rule).toBe('Bash(curl:*)')
})

test('stopRows: time is local HH:MM, not UTC', () => {
  const at = new Date(2026, 9, 8, 14, 5).getTime()
  expect(stopRows([D('a', at, 'guard')])[0]!.time).toBe('14:05')
  const ts = Date.parse('2026-10-08T09:00:00Z')
  const d = new Date(ts)
  expect(stopRows([D('a', ts, 'guard')])[0]!.time).toBe(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
})

test('stopRows: an empty ring has no rows', () => {
  expect(stopRows([])).toEqual([])
})

test('stopHeader: mode and stopped count, the count being the ring length', () => {
  expect(stopHeader('confirm', [D('a', 1, 'guard'), D('b', 2, 'guard')])).toEqual({ mode: 'confirm', stopped: 2 })
  expect(stopHeader('off', [])).toEqual({ mode: 'off', stopped: 0 })
})
