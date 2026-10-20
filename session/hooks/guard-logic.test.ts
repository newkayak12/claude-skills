import { test, expect } from 'claude-code/testing'

import { RULE_CAP, TOOL_CAP, copyReveal, sourceMark, stopCells, stopColumns, stopHeader, stopHeaderText, stopRows } from './guard-logic.ts'
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

test('sourceMark: guard is a red ✘, declined a dim ○, native a warning ●, each with its word', () => {
  expect(sourceMark('guard')).toEqual({ mark: '✘', tone: 'error', word: 'guard' })
  expect(sourceMark('declined')).toEqual({ mark: '○', tone: 'dim', word: 'declined' })
  expect(sourceMark('native')).toEqual({ mark: '●', tone: 'warning', word: 'native' })
})

test('sourceMark: the three marks differ without colour and the three tones differ without words', () => {
  const all = (['guard', 'declined', 'native'] as const).map(sourceMark)
  expect(new Set(all.map(s => s.mark)).size).toBe(3)
  expect(new Set(all.map(s => s.tone)).size).toBe(3)
  expect(all.every(s => ['●', '✔', '✘', '○'].includes(s.mark))).toBe(true)
})

test('sourceMark: an unknown source is a dash with no mark and does not throw', () => {
  expect(sourceMark('mystery')).toEqual({ mark: '', tone: 'dim', word: '—' })
  expect(() => sourceMark(undefined as never)).not.toThrow()
})

const rowOf = (id: string, extra: Partial<Denial> = {}) => stopRows([D(id, 1000, 'guard', extra)])[0]!

test('stopColumns: tool and rule are as wide as the widest value, source is as wide as `declined`', () => {
  const rows = stopRows([D('a', 1, 'guard', { tool: 'Write', rule: 'secret-write' }), D('b', 2, 'native', { tool: 'Bash' })])
  expect(stopColumns(rows)).toEqual({ tool: 5, rule: 12, source: 8 })
})

test('stopColumns: a value past the cap is capped, an empty ring has width 0', () => {
  const long = rowOf('a', { tool: 'mcp__a_very_long_server__a_very_long_tool', rule: 'r'.repeat(60) })
  expect(stopColumns([long])).toEqual({ tool: TOOL_CAP, rule: RULE_CAP, source: 8 })
  expect(stopColumns([])).toEqual({ tool: 0, rule: 0, source: 8 })
})

test('stopCells: time, tool, what, rule and source come out as the strings the pane places', () => {
  const at = new Date(2026, 9, 8, 14, 5).getTime()
  const rows = stopRows([D('a', at, 'guard', { tool: 'Write', call: '/p/.env', rule: 'secret-write' }), D('b', at, 'declined', { rule: 'hard-reset' })])
  const w = stopColumns(rows)
  const [b, a] = rows.map(r => stopCells(r, w))
  expect(a).toMatchObject({ id: 'a', time: '14:05', tool: 'Write', what: '/p/.env', rule: 'secret-write', source: { mark: '✘', tone: 'error', word: 'guard' } })
  expect(b).toMatchObject({ id: 'b', tool: 'Bash ', what: 'call b', rule: 'hard-reset  ', source: { mark: '○', tone: 'dim', word: 'declined' } })
})

test('stopCells: the source text is padded to `declined` so the next column aligns', () => {
  const w = stopColumns([])
  const texts = (['guard', 'declined', 'native', 'other'] as const).map(s => stopCells(rowOf('a', { source: s as never }), w).source.text)
  expect(texts).toEqual(['✘ guard   ', '○ declined', '● native  ', '—         '])
  expect(new Set(texts.map(t => t.length)).size).toBe(1)
})

test('stopCells: a rule is the guard id, else the native rule, else a dash; never the /permissions rule', () => {
  const w = { tool: 4, rule: 12, source: 8 }
  expect(stopCells(rowOf('a', { rule: 'hard-reset' }), w).rule.trim()).toBe('hard-reset')
  expect(stopCells(rowOf('a', { source: 'native', nativeRule: 'Bash(curl:*)' }), w).rule.trim()).toBe('Bash(curl:*)')
  expect(stopCells(rowOf('a'), w).rule.trim()).toBe('—')
  expect(stopCells(rowOf('a', { call: 'git reset --hard' }), w).rule).not.toContain('Bash(git reset:*)')
})

test('stopCells: tool and rule past their width are cut with an ellipsis; what is left whole', () => {
  const r = rowOf('a', { tool: 'ToolNameTooLong', rule: 'a-rule-that-is-too-long', call: 'x'.repeat(300) })
  const c = stopCells(r, { tool: 6, rule: 10, source: 8 })
  expect(c.tool).toBe('ToolN…')
  expect(c.rule).toBe('a-rule-th…')
  expect(c.what).toBe('x'.repeat(300))
})

test('stopHeaderText: the mode and the count once, no title and no "this session"', () => {
  expect(stopHeaderText(stopHeader('confirm', [D('a', 1, 'guard'), D('b', 2, 'guard'), D('c', 3, 'guard')]))).toBe('confirm mode · 3 stopped')
  expect(stopHeaderText({ mode: 'deny', stopped: 0 })).toBe('deny mode · 0 stopped')
})

test('copyReveal: the /permissions rule and where to add it', () => {
  expect(copyReveal({ tool: 'Bash', call: 'git reset --hard' })).toBe('Bash(git reset:*)  (add it via /permissions)')
  expect(copyReveal({ tool: 'Write', call: '/p/.env' })).toBe('Write(/p/.env)  (add it via /permissions)')
})
