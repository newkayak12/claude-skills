import { test, expect } from 'claude-code/testing'

import { fmtEntry, fmtLog, patchLog, type LogEntry } from './compact-log.ts'

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  id: 'a',
  ts: 1000,
  session: 'sess-1234567890',
  percent: 55,
  threshold: 50,
  decision: 'recapping',
  outcome: 'recapping',
  ...over,
})
const now = 61000

test('patchLog without tokens keeps the stored shape: outcome only, no tokens key', () => {
  const [a, b] = patchLog([entry(), entry({ id: 'b' })], 'a', 'compacted')
  expect(a).toEqual({ ...entry(), outcome: 'compacted' })
  expect('tokens' in a!).toBe(false)
  expect(b).toEqual(entry({ id: 'b' }))
})

test('patchLog with tokens stores them on the matching entry only', () => {
  const tokens = { recap: { input: 1200, output: 300 }, before: 5000, after: 2000 }
  const [a, b] = patchLog([entry(), entry({ id: 'b' })], 'a', 'compacted:recap+2', tokens)
  expect(a!.outcome).toBe('compacted:recap+2')
  expect(a!.tokens).toEqual(tokens)
  expect('tokens' in b!).toBe(false)
})

test('fmtEntry without tokens is unchanged', () => {
  expect(fmtEntry(entry({ outcome: 'compacted' }), now)).toMatch(/: 55% vs 50% → recapping → compacted$/)
  expect(fmtEntry(entry({ decision: 'below', outcome: 'below' }), now)).toMatch(/: 55% vs 50% → below$/)
})

test('fmtEntry with tokens appends the suffix after the outcome', () => {
  const plain = fmtEntry(entry({ outcome: 'compacted' }), now)
  const full = fmtEntry(
    entry({ outcome: 'compacted', tokens: { recap: { input: 1200, output: 300 }, summarizer: { input: 800, output: 200 }, before: 5000, after: 2000 } }),
    now,
  )
  expect(full).toBe(`${plain} · tokens recap 1200 in/300 out, summarizer 800 in/200 out, context 5000→2000`)
})

test('fmtEntry with partial tokens shows only what is present', () => {
  const plain = fmtEntry(entry({ outcome: 'compacted:recap+2' }), now)
  expect(fmtEntry(entry({ outcome: 'compacted:recap+2', tokens: { recap: { input: 10, output: 3 } } }), now)).toBe(`${plain} · tokens recap 10 in/3 out`)
  expect(fmtEntry(entry({ outcome: 'compacted:recap+2', tokens: { before: 900 } }), now)).toBe(`${plain} · tokens before 900`)
  expect(fmtEntry(entry({ outcome: 'compacted:recap+2', tokens: {} }), now)).toBe(plain)
})

test('fmtLog lines carry the token suffix before the session tag', () => {
  const out = fmtLog([entry({ outcome: 'compacted', tokens: { recap: { input: 1, output: 2 } } })], now)
  expect(out).toMatch(/ · tokens recap 1 in\/2 out \(session sess-123\)$/)
})
