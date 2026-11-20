import { test, expect } from 'claude-code/testing'

import {
  appendLog,
  armTotals,
  asCompactions,
  asLog,
  COMPACTIONS_CAP,
  fmtArmTotals,
  fmtEntry,
  fmtLog,
  isCompactionOutcome,
  LOG_CAP,
  patchLog,
  recordCompaction,
  seedCompactions,
  type LogEntry,
  type NewLogEntry,
} from './compact-log.ts'

const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  id: 'a',
  ts: 1000,
  session: 'sess-1234567890',
  percent: 55,
  threshold: 50,
  decision: 'recapping',
  outcome: 'recapping',
  arm: 'after',
  ...over,
})
const fresh = (over: Partial<NewLogEntry> = {}): NewLogEntry => entry(over)
const done = (id: string, over: Partial<LogEntry> = {}): LogEntry => entry({ id, ts: Number(id.replace(/\D/g, '')) || 1, outcome: 'compacted:recap+2', ...over })
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

test('asLog reads a 0.10.0-shaped entry (no arm, no tokens) as before and keeps after/off', () => {
  const { arm: _arm, ...legacy } = entry()
  const read = asLog([legacy, entry({ id: 'b', arm: 'after' }), entry({ id: 'c', arm: 'off' }), { ...legacy, id: 'd', arm: 'bogus' }])
  expect(read.map(e => e.arm)).toEqual(['before', 'after', 'off', 'before'])
  expect(read[0]).toEqual({ ...legacy, arm: 'before' })
  expect('tokens' in read[0]!).toBe(false)
})

test('asLog returns [] for a non-array and drops non-object elements', () => {
  expect(asLog(undefined)).toEqual([])
  expect(asLog('x')).toEqual([])
  expect(asLog([null, 3, entry()])).toEqual([entry()])
})

test('appendLog keeps the LOG_CAP ring, newest last', () => {
  let ring: LogEntry[] = []
  for (let i = 0; i < LOG_CAP + 5; i++) ring = appendLog(ring, fresh({ id: `b${i}`, decision: 'below', outcome: 'below' }))
  expect(ring.length).toBe(LOG_CAP)
  expect(ring[0]!.id).toBe('b5')
  expect(ring[LOG_CAP - 1]!.id).toBe(`b${LOG_CAP + 4}`)
})

test('isCompactionOutcome: false for below and skipped checks, true for every compaction outcome', () => {
  for (const o of ['below', 'skipped:running', 'skipped:agent', 'skipped:headless', 'recapping']) expect(isCompactionOutcome(o)).toBe(false)
  for (const o of ['compacted', 'compacted:recap+3', 'recap-failed:timeout', 'unobserved', 'fallback', 'fallback:handoff', 'failed', 'failed:x']) expect(isCompactionOutcome(o)).toBe(true)
})

test('recordCompaction ignores below and skipped entries', () => {
  const list = [done('c1')]
  expect(recordCompaction(list, fresh({ id: 'x', decision: 'below', outcome: 'below' }))).toEqual(list)
  expect(recordCompaction(list, fresh({ id: 'y', outcome: 'skipped:running' }))).toEqual(list)
  expect(recordCompaction([], fresh({ id: 'z', outcome: 'below' }))).toEqual([])
})

test('compactions survive 60 below writes that push them out of the ring', () => {
  let ring: LogEntry[] = []
  let list: LogEntry[] = []
  for (const id of ['c1', 'c2']) {
    const e = fresh({ id, outcome: 'compacted:recap+2', tokensBefore: 9000, tokensAfter: 3000 })
    ring = appendLog(ring, e)
    list = recordCompaction(list, e)
  }
  for (let i = 0; i < 60; i++) ring = appendLog(ring, fresh({ id: `b${i}`, decision: 'below', outcome: 'below' }))
  expect(ring.length).toBe(LOG_CAP)
  expect(ring.some(e => e.id === 'c1' || e.id === 'c2')).toBe(false)
  expect(list.map(e => e.id)).toEqual(['c1', 'c2'])
  expect(list.every(e => e.outcome !== 'below')).toBe(true)
})

test('the compaction list is capped at COMPACTIONS_CAP, newest kept', () => {
  expect(COMPACTIONS_CAP).toBe(200)
  let list: LogEntry[] = []
  for (let i = 1; i <= COMPACTIONS_CAP + 7; i++) list = recordCompaction(list, fresh({ id: `c${i}`, ts: i, outcome: 'compacted' }))
  expect(list.length).toBe(COMPACTIONS_CAP)
  expect(list[0]!.id).toBe('c8')
  expect(list[COMPACTIONS_CAP - 1]!.id).toBe(`c${COMPACTIONS_CAP + 7}`)
})

test('recordCompaction twice with one id updates in place and adds no duplicate', () => {
  let list = recordCompaction([], fresh({ id: 'c1', outcome: 'compacted' }))
  list = recordCompaction(list, fresh({ id: 'c2', outcome: 'compacted' }))
  list = recordCompaction(list, fresh({ id: 'c1', outcome: 'compacted:recap+2', tokensAfter: 10 }))
  expect(list.map(e => e.id)).toEqual(['c1', 'c2'])
  expect(list[0]!.outcome).toBe('compacted:recap+2')
  expect(list[0]!.tokensAfter).toBe(10)
})

test('seedCompactions folds the ring compactions in once and is idempotent', () => {
  const ring = [
    entry({ id: 'b1', ts: 1, decision: 'below', outcome: 'below' }),
    done('c2', { ts: 2, arm: 'before' }),
    done('c4', { ts: 4 }),
  ]
  const once = seedCompactions(ring, [done('c3', { ts: 3 })])
  expect(once.map(e => e.id)).toEqual(['c2', 'c3', 'c4'])
  expect(seedCompactions(ring, once)).toEqual(once)
  expect(seedCompactions(ring, seedCompactions(ring, []))).toEqual(seedCompactions(ring, []))
})

test('seedCompactions respects the cap', () => {
  const ring = Array.from({ length: 10 }, (_, i) => done(`c${i + 1}`, { ts: i + 1 }))
  const list = Array.from({ length: COMPACTIONS_CAP }, (_, i) => done(`k${i}`, { ts: 100 + i }))
  const out = seedCompactions(ring, list)
  expect(out.length).toBe(COMPACTIONS_CAP)
  expect(out[COMPACTIONS_CAP - 1]!.id).toBe(`k${COMPACTIONS_CAP - 1}`)
})

test('asCompactions reads like asLog: a missing arm is before', () => {
  const { arm: _arm, ...legacy } = done('c1')
  expect(asCompactions([legacy])).toEqual([{ ...legacy, arm: 'before' }])
  expect(asCompactions(null)).toEqual([])
})

test('armTotals counts every compaction and leaves token-less entries out of the means', () => {
  const t = armTotals([
    done('c1', { arm: 'before', tokensBefore: 100, tokensAfter: 40, recapTokens: 30, summarizerTokens: 10 }),
    done('c2', { arm: 'before', tokensBefore: 300, tokensAfter: 160, recapTokens: 50 }),
    done('c3', { arm: 'before' }),
    done('c4', { arm: 'after', tokensBefore: 200, discardedPrecomputes: 2, recapTokens: 100 }),
    done('c5', { arm: 'after', discardedPrecomputes: 1 }),
    done('c6', { arm: 'off', tokensBefore: 1000, tokensAfter: 500, summarizerTokens: 700 }),
  ])
  expect(t.before.compactions).toBe(3)
  expect(t.before.tokensBefore).toEqual({ mean: 200, n: 2 })
  expect(t.before.tokensAfter).toEqual({ mean: 100, n: 2 })
  expect(t.before.modelTokens).toEqual({ mean: 45, n: 2 })
  expect(t.before.discardedPrecomputes).toBe(0)
  expect(t.after.compactions).toBe(2)
  expect(t.after.tokensBefore).toEqual({ mean: 200, n: 1 })
  expect(t.after.tokensAfter).toEqual({ mean: null, n: 0 })
  expect(t.after.modelTokens).toEqual({ mean: 100, n: 1 })
  expect(t.after.discardedPrecomputes).toBe(3)
  expect(t.off.compactions).toBe(1)
  expect(t.off.modelTokens).toEqual({ mean: 700, n: 1 })
})

test('armTotals falls back to the legacy tokens field and gives null means for an empty arm', () => {
  const t = armTotals([
    done('c1', { arm: 'before', tokens: { recap: { input: 100, output: 20 }, summarizer: { input: 50, output: 10 }, before: 900, after: 300 } }),
  ])
  expect(t.before.tokensBefore).toEqual({ mean: 900, n: 1 })
  expect(t.before.tokensAfter).toEqual({ mean: 300, n: 1 })
  expect(t.before.modelTokens).toEqual({ mean: 180, n: 1 })
  expect(t.off).toEqual({
    compactions: 0,
    tokensBefore: { mean: null, n: 0 },
    tokensAfter: { mean: null, n: 0 },
    modelTokens: { mean: null, n: 0 },
    discardedPrecomputes: 0,
  })
})

test('fmtArmTotals prints one line per arm in order and n/a for an empty arm', () => {
  const out = fmtArmTotals(
    armTotals([
      done('c1', { arm: 'before', tokensBefore: 1000, tokensAfter: 400, recapTokens: 90 }),
      done('c2', { arm: 'after', tokensBefore: 2000, tokensAfter: 500, recapTokens: 60, discardedPrecomputes: 2 }),
    ]),
  )
  const lines = out.split('\n')
  expect(lines.length).toBe(3)
  expect(lines[0]).toMatch(/^before: 1 compaction\b/)
  expect(lines[0]).toContain('1000→400')
  expect(lines[0]).toContain('90')
  expect(lines[1]).toMatch(/^after: 1 compaction\b/)
  expect(lines[1]).toContain('discarded precomputes 2')
  expect(lines[2]).toMatch(/^off: 0 compactions\b/)
  expect(lines[2]).toContain('n/a')
  expect(lines[0]).not.toContain('n/a')
})

test('fmtArmTotals prints n/a for every arm when nothing is logged', () => {
  const lines = fmtArmTotals(armTotals([])).split('\n')
  expect(lines.map(l => l.split(':')[0])).toEqual(['before', 'after', 'off'])
  expect(lines.every(l => l.includes('n/a'))).toBe(true)
})
