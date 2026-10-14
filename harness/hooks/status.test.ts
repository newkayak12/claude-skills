import { expect, test } from 'claude-code/testing'

import type { RunInfo, RunSub } from '../types'
import { clock, critiqueReason, flowLines, gateReason, goalReason, sinceLast } from './status'

const sub = (id: string, state: RunSub['state'], gates: RunSub['gates'] = []): RunSub => ({ id, title: '', state, reason: '', tries: gates.length, gates, stalled: false })
const info = (over: Partial<RunInfo> = {}): RunInfo => ({
  slug: 's', title: 't', live: true, finished: false,
  stages: [
    { key: 'plan', state: 'done' }, { key: 'setgoal', state: 'done' }, { key: 'critique', state: 'done' },
    { key: 'implement', state: 'running' }, { key: 'gate', state: 'pending' }, { key: 'report', state: 'pending' },
  ],
  subs: [], done: 0, total: 0, now: { kind: 'stage', stage: 'implement' }, match: null, pass: null,
  critique: { sound: true, reason: '' }, goalReason: '', lastMs: 0, ...over,
})

test('critiqueReason joins reason, blocking and problems (strings or objects), one line', () => {
  expect(critiqueReason(undefined)).toBe('')
  expect(critiqueReason({ sound: true })).toBe('')
  expect(critiqueReason({ sound: false, reason: 'not testable', blocking: ['no plan'], problems: [{ text: 'AC-2 vague' }, 'S3\nbig'] }))
    .toBe('not testable; no plan; AC-2 vague; S3 big')
  expect(critiqueReason({ problems: 'one string' })).toBe('one string')
})

test('gateReason and goalReason', () => {
  expect(gateReason({ pass: false, reason: 'tests red', gaps: ['a', { gap: 'b' }] })).toBe('tests red; a; b')
  expect(gateReason({ pass: true })).toBe('')
  expect(goalReason({ match_pct: 60, reason: 'AC-2 missing', out_of_spec: ['extra file'] })).toBe('AC-2 missing; extra file')
  expect(gateReason({ reason: 'x'.repeat(500) })).toHaveLength(240)
})

test('clock and sinceLast: a finished run has no elapsed', () => {
  expect(clock(61_000)).toBe('1m 1s')
  expect(clock(null)).toBe('')
  expect(sinceLast(info({ lastMs: 1000 }), 31_000)).toBe('30s')
  expect(sinceLast(info({ lastMs: 1000, finished: true }), 31_000)).toBe('')
  expect(sinceLast(info({ lastMs: 0 }), 31_000)).toBe('')
})

test('flowLines: stages in order; implement opens into subgoals with gate verdicts, a retry one deeper', () => {
  const r = info({
    subs: [
      sub('S1', 'done', [{ n: 1, pass: true, reason: '' }]),
      sub('S2', 'running', [{ n: 1, pass: false, reason: 'tests red' }, { n: 2, pass: false, reason: 'still red' }, { n: 3, pass: true, reason: '' }]),
    ],
  })
  const lines = flowLines(r)
  expect(lines.map(l => [l.kind, l.stage ?? (l.kind === 'attempt' ? l.n : l.id), l.depth, l.state, l.reason])).toEqual([
    ['stage', 'plan', 0, 'done', ''],
    ['stage', 'setgoal', 0, 'done', ''],
    ['stage', 'critique', 0, 'done', ''],
    ['sub', 'S1', 0, 'done', ''],
    ['attempt', 1, 0, 'done', ''],
    ['sub', 'S2', 0, 'running', ''],
    ['attempt', 1, 0, 'failed', 'tests red'],
    ['attempt', 2, 1, 'failed', 'still red'],
    ['attempt', 3, 2, 'done', ''],
    ['stage', 'gate', 0, 'pending', ''],
    ['stage', 'report', 0, 'pending', ''],
  ])
})

test('flowLines: a failed critique and a failed goal gate carry their reasons', () => {
  const r = info({
    stages: [
      { key: 'plan', state: 'done' }, { key: 'setgoal', state: 'done' }, { key: 'critique', state: 'failed' },
      { key: 'implement', state: 'pending' }, { key: 'gate', state: 'failed' }, { key: 'report', state: 'pending' },
    ],
    critique: { sound: false, reason: 'no test plan' }, goalReason: 'AC-2 not met',
  })
  const lines = flowLines(r)
  expect(lines.find(l => l.stage === 'critique')).toMatchObject({ state: 'failed', reason: 'no test plan' })
  expect(lines.find(l => l.stage === 'gate')).toMatchObject({ state: 'failed', reason: 'AC-2 not met' })
  // no subgoals yet: the implement stage stays as one line
  expect(lines.find(l => l.stage === 'implement')).toMatchObject({ kind: 'stage', state: 'pending' })
})

test('flowLines: a passed critique or gate shows no reason even if the file holds text', () => {
  const r = info({ critique: { sound: true, reason: 'fine' }, goalReason: 'ok' })
  expect(flowLines(r).every(l => l.reason === '')).toBe(true)
})
