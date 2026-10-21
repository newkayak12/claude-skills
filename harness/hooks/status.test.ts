import { expect, test } from 'claude-code/testing'

import type { HarnessRow, RunInfo, RunSub } from '../types'
import { DEMO_NOW, bandLines, paneLines, plain, railLine } from './harness-draw'
import type { PaneCtx } from './harness-draw'
import {
  NONE, clock, costText, countsText, cycleRun, doingText, elapsedText, failureToast, failuresOf, flowLines, frozenOrder, hasNewReject, inStageText,
  isActing, lastStep, listArgv, markLooked, normalizeRow, openTab, openingOrder, otherRunLabel, parseRow, parseRows, pickRun, railItems, rankedProblems, reasonFor, restText,
  paneKey, roundHeading, roundText, runCount, runPosition, runState, severityOf, shownRows, showArgv, sinceLast, span, spinnerPlan, stageLabel, topFinding, youLine,
} from './status'

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

// the failures the node gives a row: {key, at, what, reason, next_step, severity}; the pane only reads them
const failure = (key: string, over: Record<string, unknown> = {}) => ({
  key, at: 5, what: 'QualityGate S1', reason: 'tests red; no case for empty input', next_step: 'retry 1/3', severity: 'info', ...over,
})
const failing = (...fs: object[]) => normalizeRow({ slug: 'r', failures: fs })!

test('normalizeRow keeps each failure as the node gave it and drops a malformed one; no list is no failures', () => {
  expect(normalizeRow({ slug: 'r' })!.failures).toEqual([])
  expect(normalizeRow({ slug: 'r', failures: 'x' })!.failures).toEqual([])
  const keep = failure('r|gate|S1|1')
  const bare = failure('r|result|S1', { next_step: null, severity: 'gave up', what: 'subgoal S1', reason: 'no reason recorded' })
  const bad = [null, 3, 'x', {}, failure(''), failure('k', { at: 'soon' }), failure('k', { severity: 'loud' }), failure('k', { what: 4 }), failure('k', { reason: null }), failure('k', { next_step: 5 })]
  expect(failuresOf(failing(keep, ...bad, bare))).toEqual([keep, bare])
})

test('parseRows and parseRow carry failures; a row built by hand has none (failuresOf is [])', () => {
  const f = failure('csv-export|critique|1', { what: 'Critique', next_step: 'retry 1/3' })
  expect(parseRows(JSON.stringify([{ slug: 'csv-export', failures: [f] }]))![0]!.failures).toEqual([f])
  expect(parseRow(JSON.stringify({ slug: 'csv-export', failures: [f] }))!.failures).toEqual([f])
  for (const bad of ['', 'not json', '[]', '{"slug":""}', undefined, 7]) expect(parseRow(bad)).toBeNull()
  expect(failuresOf({ slug: 'x' } as HarnessRow)).toEqual([])
})

test('reasonFor: the reason of the newest failure under a key, whole segments only; none is empty', () => {
  const r = failing(
    failure('r|gate|S1|1', { reason: 'one' }), failure('r|gate|S1|10', { reason: 'ten' }), failure('r|gate|S1|2', { reason: 'two' }),
    failure('r|critique|1', { reason: 'first' }), failure('r|critique|2', { reason: 'second' }), failure('r|goal|1', { reason: 'AC-2 not met' }),
  )
  const fs = failuresOf(r)
  expect(reasonFor(fs, 'r|gate|S1|1')).toBe('one')
  expect(reasonFor(fs, 'r|gate|S1|10')).toBe('ten')
  expect(reasonFor(fs, 'r|critique')).toBe('second')
  expect(reasonFor(fs, 'r|goal')).toBe('AC-2 not met')
  expect(reasonFor(fs, 'r|gate|S2|1')).toBe('')
  expect(reasonFor(fs, 'r|gate|S')).toBe('')
  expect(reasonFor([], 'r|goal')).toBe('')
})

test('failureToast: info is ↻ with the default timeout and no push; needs you is ⚠ and gave up is ✗, 10 s and a push', () => {
  const info = failureToast('r', failuresOf(failing(failure('k')))[0]!)
  expect(info).toEqual({ text: '↻ r QualityGate S1 failed: tests red; no case for empty input → retry 1/3', pushText: null })
  const you = failureToast('r', failuresOf(failing(failure('k', { what: 'setgoal', reason: 'approve the goal spec', next_step: 'needs you', severity: 'needs you' })))[0]!)
  expect(you).toEqual({ text: '⚠ r setgoal failed: approve the goal spec → needs you', pushText: '⚠ r setgoal failed: approve the goal spec → needs you', timeoutMs: 10_000 })
  const gone = failureToast('r', failuresOf(failing(failure('k', { what: 'subgoal S1', next_step: 'gave up', severity: 'gave up' })))[0]!)
  expect(gone.text.startsWith('✗ r subgoal S1 failed: ')).toBe(true)
  expect(gone.timeoutMs).toBe(10_000)
  expect(gone.pushText).toBe(gone.text)
})

test('failureToast: no next_step leaves the arrow out; the push text is cut at 200, the toast is not', () => {
  const none = failureToast('r', failuresOf(failing(failure('k', { next_step: null, severity: 'gave up', reason: 'cut off' })))[0]!)
  expect(none.text).toBe('✗ r QualityGate S1 failed: cut off')
  const huge = failureToast('r'.repeat(150), failuresOf(failing(failure('k', { reason: 'x'.repeat(120), severity: 'gave up', next_step: 'gave up' })))[0]!)
  expect(huge.pushText).toHaveLength(200)
  expect(huge.text.length).toBeGreaterThan(200)
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

/* --- the rows of `fallback-check --list --json` --- */

const T0 = DEMO_NOW
const iso = (agoMs: number) => new Date(T0 - agoMs).toISOString()
const row = (slug: string, over: Partial<HarnessRow> = {}): HarnessRow => ({
  slug, stage: 'implement', round: null, waiting: null, stalled: false, now: null, started_at: null, max_critique_rounds: 3,
  severity: { blocker: 0, major: 0, minor: 0, nit: 0 }, rounds: [], passed: 0, failed: 0, total: 0, ...over,
})
const nowJson = (over: Record<string, unknown> = {}) => ({
  stage: 'setgoal', doing: 'SetGoal is rewriting the spec', round: 2, last_step: 'edited the goal spec', next: 'critique round 2',
  waiting: null, cost_usd: 3.4, at: iso(12_000), since: iso(6 * 60_000), ...over,
})
const rejected = { round: 1, sound: false, problems: [{ severity: 'major', text: 'no download check' }, { severity: 'nit', text: 'titles' }, { severity: 'major', text: 'edits auth' }] }

// the 14 keys P1's engine emits, as the engine writes them (rounds also carry `file`)
const ENGINE_ROW = {
  slug: 'csv-export', dir: '/w/.harness-run/csv-export', stage: 'setgoal', round: 2, waiting: null, stalled: false,
  now: nowJson(), started_at: iso(72 * 60_000), max_critique_rounds: 3,
  severity: { blocker: 0, major: 2, minor: 0, nit: 1 }, rounds: [{ ...rejected, file: '02-critique.r1.json' }], passed: 0, failed: 0, total: 3,
}

test('parseRows: the engine row keys land in the row; empty, invalid and non-list output is null, [] is a real answer', () => {
  const rows = parseRows(JSON.stringify([ENGINE_ROW]))!
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    slug: 'csv-export', stage: 'setgoal', round: 2, waiting: null, stalled: false, started_at: iso(72 * 60_000), max_critique_rounds: 3,
    severity: { blocker: 0, major: 2, minor: 0, nit: 1 }, passed: 0, failed: 0, total: 3,
    now: { stage: 'setgoal', doing: 'SetGoal is rewriting the spec', round: 2, last_step: 'edited the goal spec', next: 'critique round 2', waiting: null, cost_usd: 3.4 },
  })
  expect(rows[0]!.rounds).toEqual([{ round: 1, sound: false, problems: rejected.problems }])
  expect(rows[0]).not.toHaveProperty('dir')
  for (const bad of ['', '   ', 'not json', '{"slug":"x"}', '"x"', 'null', undefined, 7]) expect(parseRows(bad)).toBeNull()
  expect(parseRows('[]')).toEqual([])
})

test('normalizeRow is tolerant: a missing or malformed field takes a default and nothing throws', () => {
  for (const junk of [null, undefined, 3, 'x', [], {}, { slug: '' }, { slug: 4 }]) expect(normalizeRow(junk)).toBeNull()
  const r = normalizeRow({
    slug: 's', stage: 'bogus', round: 'two', waiting: { who: 'nobody', what: 1 }, stalled: 'yes', now: 'x', started_at: 5,
    max_critique_rounds: 0, severity: 'high', rounds: [null, { round: 'a', sound: 'yes', problems: [{ severity: 'Blocker', text: 'a\nb' }, { severity: 'wild', text: 'c' }, 'd', null] }],
    passed: -1, failed: 1.5, total: 'many',
  })!
  expect(r).toEqual({
    slug: 's', stage: 'plan', round: null, waiting: null, stalled: false, now: null, started_at: null, max_critique_rounds: 2,
    severity: { blocker: 1, major: 3, minor: 0, nit: 0 },
    rounds: [
      { round: 1, sound: null, problems: [] },
      { round: 2, sound: null, problems: [{ severity: 'blocker', text: 'a b' }, { severity: 'major', text: 'c' }, { severity: 'major', text: 'd' }, { severity: 'major', text: '' }] },
    ],
    passed: 0, failed: 0, total: 0, failures: [],
  })
  // waiting falls back to now.waiting; a numeric cost is the only cost
  const w = normalizeRow({ slug: 's', now: { stage: 'plan', waiting: { who: 'you', what: 'ok?' }, cost_usd: '3' } })!
  expect(w.waiting).toEqual({ who: 'you', what: 'ok?' })
  expect(w.now!.cost_usd).toBeNull()
})

test('opening order: waiting on you, else a reject since you last looked, else the most recently changed', () => {
  const recent = row('recent')
  const older = row('older')
  const waiting = row('waiting', { waiting: { who: 'you', what: 'approve' } })
  const vendor = row('vendor', { waiting: { who: 'vendor', what: 'capacity' } })
  const rej = row('rej', { rounds: [{ round: 1, sound: false, problems: [] }] })
  expect(openingOrder([recent, older], {}).map(r => r.slug)).toEqual(['recent', 'older'])
  expect(openingOrder([recent, rej, older], {}).map(r => r.slug)).toEqual(['rej', 'recent', 'older'])
  expect(openingOrder([recent, rej, waiting], {}).map(r => r.slug)).toEqual(['waiting', 'rej', 'recent'])
  expect(openingOrder([recent, vendor], {}).map(r => r.slug)).toEqual(['recent', 'vendor']) // a vendor wait is not you
  // looked at: the reject no longer counts; a failed subgoal is a reject too
  expect(openingOrder([recent, rej], { rej: 1 }).map(r => r.slug)).toEqual(['recent', 'rej'])
  const failed = row('failed', { failed: 1 })
  expect(hasNewReject(failed, {})).toBe(true)
  expect(hasNewReject(failed, markLooked({}, failed))).toBe(false)
  expect(markLooked({ a: 1 }, null)).toEqual({ a: 1 })
})

test('frozen order: the same slugs after looked changes; recomputed when a run closes or opens', () => {
  const tidy = row('tidy')
  const csv = row('csv', { rounds: [{ round: 1, sound: false, problems: [] }] })
  const fix = row('fix', { waiting: { who: 'you', what: 'approve' } })
  const slugs = (rs: HarnessRow[]) => rs.map(r => r.slug)
  const first = frozenOrder([tidy, csv, fix], {}, null)
  expect(slugs(first)).toEqual(['fix', 'csv', 'tidy'])
  // csv's reject is looked at: openingOrder alone would now put tidy before csv
  const looked = markLooked({}, csv)
  expect(slugs(openingOrder([tidy, csv, fix], looked))).toEqual(['fix', 'tidy', 'csv'])
  expect(slugs(frozenOrder([tidy, csv, fix], looked, slugs(first)))).toEqual(['fix', 'csv', 'tidy'])
  // a refreshed list in another order or with changed rows does not move them either
  expect(slugs(frozenOrder([fix, tidy, csv], looked, slugs(first)))).toEqual(['fix', 'csv', 'tidy'])
  const fixed = frozenOrder([tidy, csv, { ...fix, waiting: null }], looked, slugs(first))
  expect(fixed[0]!.waiting).toBeNull()
  // a run closes: ordered again
  expect(slugs(frozenOrder([tidy, csv], looked, slugs(first)))).toEqual(['tidy', 'csv'])
  // a run opens: ordered again, the new waiting one first
  const extra = row('extra', { waiting: { who: 'you', what: 'ok' } })
  expect(slugs(frozenOrder([tidy, csv, fix, extra], looked, slugs(first)))).toEqual(['fix', 'extra', 'tidy', 'csv'])
  // one closes and another opens at once: same count, different set
  expect(slugs(frozenOrder([tidy, csv, extra], looked, slugs(first)))).toEqual(['extra', 'tidy', 'csv'])
  expect(frozenOrder([], {}, [])).toEqual([])
})

test('[ and ]: run k of n, wrap, the tab label; one run changes nothing', () => {
  const a = row('alpha')
  const b = row('beta', { stage: 'implement', passed: 2, total: 4 })
  const ordered = openingOrder([a, b], {})
  expect(runCount(runPosition(ordered, null))).toBe('run 1 of 2')
  expect(runCount(runPosition(ordered, null), true)).toBe('1/2')
  const next = cycleRun(ordered, null, 1)
  expect(next).toBe('beta')
  expect(runCount(runPosition(ordered, next))).toBe('run 2 of 2')
  expect(cycleRun(ordered, next, 1)).toBe('alpha') // wraps
  expect(runCount(runPosition(ordered, cycleRun(ordered, next, -1)))).toBe('run 1 of 2')
  expect(cycleRun(ordered, null, -1)).toBe('beta')
  expect(otherRunLabel(ordered, null)).toBe('other run: beta · Implement 2/4')
  expect(otherRunLabel(ordered, 'beta')).toBe('other run: alpha · Implement')
  expect(otherRunLabel([a, b, row('gamma')], null)).toBe('other run: beta · Implement 2/4 (+1)')
  expect(otherRunLabel([row('s', { stalled: true })].concat(b), null)).toBe('other run: beta · Implement 2/4')
  expect(stageLabel(row('s', { stalled: true }))).toBe('Implement · stalled')
  // one run: no change, no label
  expect(cycleRun([a], 'alpha', 1)).toBe('alpha')
  expect(cycleRun([a], null, -1)).toBeNull()
  expect(cycleRun([], null, 1)).toBeNull()
  expect(otherRunLabel([a], null)).toBeNull()
  expect(runPosition([], null)).toEqual({ k: 0, n: 0 })
})

test('selection is by slug: kept across a refresh that reorders, falls back to opening order when the run closes', () => {
  const a = row('alpha')
  const b = row('beta')
  expect(pickRun(openingOrder([a, b], {}), 'beta')!.slug).toBe('beta')
  // a refresh: beta now waits on you and opens first, yet the selection stays beta
  const b2 = row('beta', { waiting: { who: 'you', what: 'x' } })
  const refreshed = openingOrder([a, b2], {})
  expect(refreshed[0]!.slug).toBe('beta')
  expect(pickRun(refreshed, 'alpha')!.slug).toBe('alpha')
  expect(runCount(runPosition(refreshed, 'alpha'))).toBe('run 2 of 2')
  // alpha closes: opening order decides
  expect(pickRun(openingOrder([b2], {}), 'alpha')!.slug).toBe('beta')
  expect(pickRun([], 'alpha')).toBeNull()
  expect(pickRun(openingOrder([a, b], {}), null)!.slug).toBe('alpha')
})

test('a failed read keeps the last good list; the first failure gives an empty one', () => {
  const load = (last: HarnessRow[], out: unknown) => parseRows(out) ?? last
  const good = load([], JSON.stringify([ENGINE_ROW]))
  expect(good).toHaveLength(1)
  for (const bad of ['', 'Error: spawn', '{"oops":1}', undefined]) expect(load(good, bad)).toBe(good)
  expect(load([], 'boom')).toEqual([])
  expect(load(good, '[]')).toEqual([]) // a real empty answer clears the list
})

test('spinnerPlan: only while a displayed run acts, something is shown and a surface exists', () => {
  const acting = row('a', { now: normalizeRow({ slug: 'x', now: nowJson() })!.now })
  const table: [string, HarnessRow | null, number, boolean, boolean][] = [
    ['acting, shown, surface', acting, 1, true, true],
    ['no now.json (idle)', row('a'), 1, true, false],
    ['waiting on you', { ...acting, waiting: { who: 'you', what: 'x' } }, 1, true, false],
    ['waiting on a vendor', { ...acting, waiting: { who: 'vendor', what: 'x' } }, 1, true, false],
    ['stalled', { ...acting, stalled: true }, 1, true, false],
    ['no surface', acting, 0, true, false],
    ['nothing shown', acting, 2, false, false],
    ['no run', null, 1, true, false],
  ]
  for (const [name, r, surfaces, shown, run] of table) expect([name, spinnerPlan([r], surfaces, shown).run]).toEqual([name, run])
  expect(spinnerPlan([], 1, true).run).toBe(false)
  expect(spinnerPlan([row('idle'), acting], 1, true).run).toBe(true)
  expect(isActing(acting)).toBe(true)
})

test('times, cost and the Now / last step / You sentences', () => {
  const r = normalizeRow({ ...ENGINE_ROW, now: nowJson() })!
  expect(span(45_000)).toBe('45s')
  expect(span(6 * 60_000 + 20_000)).toBe('6m')
  expect(span(72 * 60_000)).toBe('1h 12m')
  expect(span(null)).toBe('')
  expect(doingText(r)).toBe('SetGoal is rewriting the spec')
  expect(roundText(r)).toBe('round 2 of 3')
  expect(roundText(r, true)).toBe('round 2/3')
  expect(inStageText(r, T0)).toBe('6m in this stage')
  expect(elapsedText(r, T0)).toBe('1h 12m')
  expect(lastStep(r, T0)).toEqual({ text: 'edited the goal spec', age: '12s ago' })
  expect(costText(r)).toBe('$3.40')
  expect(runState(r)).toBe('running')
  // nothing recorded: stage sentence, no round, no times, last step and cost are —
  const bare = row('b', { stage: 'critique' })
  expect(doingText(bare)).toBe('Critique is judging the spec')
  expect([roundText(bare), inStageText(bare, T0), elapsedText(bare, T0)]).toEqual(['', '', ''])
  expect(lastStep(bare, T0)).toEqual({ text: NONE, age: '' })
  expect(costText(bare)).toBe('—')
  expect(costText(row('c', { now: { ...r.now!, cost_usd: null } }))).toBe('—')
  expect(lastStep(row('l', { now: { ...r.now!, last_step: 'x'.repeat(300) } }), T0).text).toHaveLength(120)
  // You: next, or waiting.what
  expect(youLine(r)).toEqual({ you: false, text: 'nothing needed · next: critique round 2' })
  expect(youLine(bare)).toEqual({ you: false, text: 'nothing needed' })
  expect(youLine(row('w', { waiting: { who: 'you', what: 'approve the spec' } }))).toEqual({ you: true, text: 'approve the spec' })
  expect(youLine(row('v', { waiting: { who: 'vendor', what: 'capacity' }, now: { ...r.now!, next: null } }))).toEqual({ you: false, text: 'nothing needed · waiting on a vendor: capacity' })
  expect(runState(row('w', { waiting: { who: 'you', what: 'x' } }))).toBe('waiting on you')
  expect(runState(row('s', { stalled: true }))).toBe('stalled')
})

test('the rail repeats a loop and counts subgoals', () => {
  const rail = (r: HarnessRow, compact = false) => plain(railLine(railItems(r), compact))
  // critique rejected, SetGoal rewriting
  expect(rail(row('r', { stage: 'setgoal', total: 3, rounds: [rejected as never] }))).toBe(
    '✔ Plan ━━ ✔ SetGoal ━━ ✘ Critique ━━ ● SetGoal again ┄┄ ○ Critique ┄┄ ○ Subgoals 0/3 ┄┄ ○ Goal gate ┄┄ ○ Report',
  )
  expect(rail(row('r', { stage: 'setgoal', total: 3, rounds: [rejected as never] }), true)).toBe(
    '✔ Plan ━ ✔ SetGoal ━ ✘ Critique ━ ● SetGoal ┄ ○ Critique ┄ ○ Subgoals 0/3 ┄ ○ Gate ┄ ○ Report',
  )
  // the rewrite is done, the second critique is running
  expect(rail(row('r', { stage: 'critique', total: 3, rounds: [rejected as never] }))).toBe(
    '✔ Plan ━━ ✔ SetGoal ━━ ✘ Critique ━━ ✔ SetGoal again ━━ ● Critique ┄┄ ○ Subgoals 0/3 ┄┄ ○ Goal gate ┄┄ ○ Report',
  )
  // accepted on round 2, two of three subgoals passed
  const sound = { round: 2, sound: true, problems: [] }
  expect(rail(row('r', { stage: 'implement', total: 3, passed: 2, rounds: [rejected as never, sound] }))).toBe(
    '✔ Plan ━━ ✔ SetGoal ━━ ✘ Critique ━━ ✔ SetGoal again ━━ ✔ Critique ━━ ● Subgoals 2/3 ┄┄ ○ Goal gate ┄┄ ○ Report',
  )
  // a first run, no critique file yet: Plan running; and one past the gate with a failed subgoal
  expect(rail(row('r', { stage: 'plan' }))).toBe('● Plan ┄┄ ○ SetGoal ┄┄ ○ Critique ┄┄ ○ Subgoals ┄┄ ○ Goal gate ┄┄ ○ Report')
  expect(rail(row('r', { stage: 'gate', total: 2, passed: 1, failed: 1, rounds: [{ round: 1, sound: true, problems: [] }] }))).toBe(
    '✔ Plan ━━ ✔ SetGoal ━━ ✔ Critique ━━ ✘ Subgoals 1/2 ━━ ● Goal gate ┄┄ ○ Report',
  )
})

test('findings: the latest round heading, its top problems by severity, the rest, and the rollup', () => {
  const r = normalizeRow({ ...ENGINE_ROW, rounds: [rejected, { round: 2, sound: false, problems: [{ severity: 'nit', text: 'n' }, { severity: 'blocker', text: 'b' }] }] })!
  expect(countsText({ blocker: 0, major: 4, minor: 0, nit: 1 })).toBe('4 major, 1 nit')
  expect(countsText({ blocker: 0, major: 0, minor: 0, nit: 0 })).toBe('no findings')
  expect(roundHeading(null)).toBeNull()
  expect(roundHeading(r.rounds[0]!)).toBe('Critique round 1 · rejected · 2 major, 1 nit')
  expect(roundHeading(r.rounds[0]!, true)).toBe('Critique r1 · rejected · 2 major, 1 nit')
  expect(roundHeading({ round: 3, sound: true, problems: [] })).toBe('Critique round 3 · sound · no findings')
  expect(rankedProblems(r.rounds[1]!).map(p => [p.n, p.severity])).toEqual([[2, 'blocker'], [1, 'nit']])
  expect(restText(r.rounds[0]!, 2)).toBe('1 nit')
  expect(restText(r.rounds[0]!, 3)).toBe('')
  expect(topFinding(r)).toBe('b')
  expect(topFinding(row('n'))).toBeNull()
  expect(severityOf([{ severity: 'major', text: '' }, { severity: 'nit', text: '' }])).toEqual({ blocker: 0, major: 1, minor: 0, nit: 1 })
})

/* --- the pane and band for a fixture run: the lines the tsx renders --- */

const ctx = (over: Partial<PaneCtx> = {}): PaneCtx => ({ width: 186, nowMs: T0, tick: 0, pos: { k: 1, n: 1 }, other: null, tab: 'now', ...over })

test('pane: the Now line, the last step line, the You line, the rail and the findings of a fixture run', () => {
  const r = normalizeRow({ ...ENGINE_ROW, rounds: [{ round: 1, sound: false, problems: [...Array(4).fill({ severity: 'major', text: 'no download check' }), { severity: 'nit', text: 'titles' }] }] })!
  const lines = paneLines(r, ctx()).map(plain)
  const at = (needle: string) => lines.find(l => l.includes(needle))!
  expect(lines[0]).toMatch(/^csv-export +running · 1h 12m · \$3\.40 · run 1 of 1 · q close$/)
  expect(at('Now')).toMatch(/^✎ Now {3}SetGoal is rewriting the spec +round 2 of 3 · 6m in this stage$/)
  expect(at('last step:')).toMatch(/^ {8}last step: edited the goal spec +12s ago$/)
  expect(at('You')).toMatch(/^ {2}You {3}nothing needed · next: critique round 2$/)
  expect(at('Plan')).toMatch(/^✔ Plan ━━ ✔ SetGoal ━━ ✘ Critique ━━ ● SetGoal again ┄┄ ○ Critique ┄┄ ○ Subgoals 0\/3 ┄┄ ○ Goal gate ┄┄ ○ Report +subgoals 0\/3 ─+$/)
  expect(at('Critique round')).toBe('Critique round 1 · rejected · 4 major, 1 nit')
  expect(at('+')).toContain('+2 major, 1 nit · Findings (3)')
  expect(lines[lines.length - 1]).toMatch(/^● Now \(1\) {3}Flow \(2\) {3}Findings \(3\) {3}Gate rules \(4\)/)
  // waiting on you: the You line leads with ⚑ and the question; the Now glyph is idle
  const w = { ...r, waiting: { who: 'you' as const, what: 'approve the spec' }, now: { ...r.now!, waiting: { who: 'you' as const, what: 'approve the spec' } } }
  const wl = paneLines(w, ctx()).map(plain)
  expect(wl.find(l => l.includes('You'))).toBe(`⚑ You   approve the spec${' '.repeat(186 - 22)}`.trimEnd())
  expect(wl.find(l => l.includes(' Now '))!.startsWith('◌ Now')).toBe(true)
  // the Findings tab reads the node rollup
  expect(paneLines(r, ctx({ tab: 'findings' })).map(plain)[8]).toBe('All rounds · 2 major, 1 nit')
  // a pipeline run with no now.json: the stage sentence and — for what is not recorded
  const bare = paneLines(row('plain', { stage: 'plan' }), ctx()).map(plain)
  expect(bare.some(l => l.startsWith('◌ Now   Plan is drafting the approach'))).toBe(true)
  expect(bare.some(l => l.trimEnd().endsWith('last step: —'))).toBe(true)
})

test('band: three rows, +N for the others, harness rows only', () => {
  const lead = normalizeRow({ ...ENGINE_ROW })!
  const other = row('other')
  const rows = bandLines([lead, other], { width: 190, nowMs: T0, tick: 0 }).map(plain)
  expect(rows).toHaveLength(3)
  expect(rows[0]).toMatch(/^✎ harness csv-export · SetGoal is rewriting the spec · round 2 of 3 · 6m +\+1 run$/)
  expect(rows[1]).toMatch(/^ {10}✔ Plan .* ○ Subgoals 0\/3 .* ○ Report +subgoals 0\/3$/)
  expect(rows[2]).toBe('          $3.40 · 1h 12m · top finding: no download check')
  expect(bandLines([lead], { width: 190, nowMs: T0, tick: 0 }).map(plain)[0]).not.toContain('+')
  expect(bandLines([], { width: 190, nowMs: T0, tick: 0 })).toEqual([])
  // no cost: —; no finding: the elapsed time stays
  expect(plain(bandLines([row('b', { started_at: iso(5 * 60_000) })], { width: 190, nowMs: T0, tick: 0 })[2]!)).toBe('          — · 5m')
})

test('showArgv: node runs the engine from the plugin root on one run directory', () => {
  expect(showArgv('/p/harness', '/w/.harness-run/r')).toEqual(['node', '/p/harness/engine/fallback-check.mjs', '--show', '/w/.harness-run/r', '--json'])
})

test('listArgv: node runs the engine from the plugin root for this folder', () => {
  expect(listArgv('/p/harness', '/w')).toEqual(['node', '/p/harness/engine/fallback-check.mjs', '--list', '--json', '--cwd', '/w'])
})

test('shownRows: the band leads with the first run; the pane adds its own while open; none open, none shown', () => {
  const a = row('a')
  const b = row('b')
  expect(shownRows([], null, true)).toEqual([])
  expect(shownRows([a, b], null, false)).toEqual([a])
  expect(shownRows([a, b], null, true)).toEqual([a])
  expect(shownRows([a, b], 'b', true)).toEqual([a, b])
  expect(shownRows([a, b], 'gone', true)).toEqual([a])
})

test('openTab: Now when a run is open, the gate rules when none is', () => {
  expect(openTab(true)).toBe('now')
  expect(openTab(false)).toBe('rules')
})

test('paneKey: ] is step +1, [ is step -1, 1-4 pick a tab, q closes; the last character is the key; anything else is no key', () => {
  expect([paneKey(']'), paneKey('[')]).toEqual([{ kind: 'step', by: 1 }, { kind: 'step', by: -1 }])
  expect([paneKey('1'), paneKey('2'), paneKey('3'), paneKey('4')]).toEqual([
    { kind: 'tab', tab: 'now' }, { kind: 'tab', tab: 'flow' }, { kind: 'tab', tab: 'findings' }, { kind: 'tab', tab: 'rules' },
  ])
  expect(paneKey('q')).toEqual({ kind: 'close' })
  // a field that still holds earlier text: the last character is the one just typed
  expect(paneKey('[]')).toEqual({ kind: 'step', by: 1 })
  expect(paneKey('x[')).toEqual({ kind: 'step', by: -1 })
  expect(paneKey('[x')).toBeNull()
  for (const bad of ['', 'p', 'n', 'x', '5', 'Q', null, undefined, 3, {}, [']']]) expect(paneKey(bad)).toBeNull()
})
