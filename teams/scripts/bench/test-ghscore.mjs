// node --test teams/scripts/bench/test-ghscore.mjs
// Fixed in-file fake data only: no model, no network, no docker. Judge and hidden check are injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_EFFECT, median, medianPass, compareBool, compareCost, compareMedians,
  summarizeAxis, anonymize, scoreAll, formatReport,
} from './ghscore.mjs';

const entry = (problem, outcome, diff) => ({ problem, outcome, diff });

// ---------- medians ----------
test('medianPass: 2 of 3 passing runs pass, 1 of 3 fails, no scored run is null', () => {
  assert.equal(medianPass([true, true, false]), true);
  assert.equal(medianPass([true, false, false]), false);
  assert.equal(medianPass([false, false, false]), false);
  assert.equal(medianPass([]), null);
});

test('median: odd count picks the middle, even count averages, non-finite values are dropped', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([5, NaN, 1, Infinity, 3]), 3);
  assert.equal(median([]), null);
});

// ---------- W/T/L, margin, minimum effect ----------
test('summarizeAxis counts wins, ties and losses', () => {
  const s = summarizeAxis(1, [
    entry('p1', 'win', 1), entry('p2', 'win', 1), entry('p3', 'tie', 0),
    entry('p4', 'loss', -1), entry('p5', 'tie', 0), entry('p6', 'win', 1),
  ]);
  assert.equal(s.wins, 3);
  assert.equal(s.ties, 2);
  assert.equal(s.losses, 1);
  assert.equal(s.problems, 6);
  assert.equal(s.margin, 2);
});

test('axes 1-6: margin 0 is below the minimum effect and names no winner', () => {
  const s = summarizeAxis(2, [entry('p1', 'win', 1), entry('p2', 'loss', -1), entry('p3', 'tie', 0)]);
  assert.equal(s.margin, 0);
  assert.equal(s.floor, 1);
  assert.equal(s.belowMinimumEffect, true);
});

test('axes 1-6: margin 1 clears the minimum effect and names a winner', () => {
  const s = summarizeAxis(2, [entry('p1', 'win', 1), entry('p2', 'tie', 0), entry('p3', 'tie', 0)]);
  assert.equal(s.margin, 1);
  assert.equal(s.belowMinimumEffect, false);
  const neg = summarizeAxis(2, [entry('p1', 'loss', -1), entry('p2', 'tie', 0)]);
  assert.equal(neg.margin, -1);
  assert.equal(neg.belowMinimumEffect, false);
});

test('axes 7-8: summed field margin under 1 is below the minimum effect, 1 is not', () => {
  const zero = summarizeAxis(7, [entry('p1', 'win', 2), entry('p2', 'loss', -2), entry('p3', 'tie', 0)]);
  assert.equal(zero.margin, 0);
  assert.equal(zero.floor, 1);
  assert.equal(zero.belowMinimumEffect, true);
  const one = summarizeAxis(8, [entry('p1', 'win', 2), entry('p2', 'loss', -1), entry('p3', 'tie', 0)]);
  assert.equal(one.margin, 1);
  assert.equal(one.belowMinimumEffect, false);
});

test('axes 7-8: a per-problem field difference is a count compare, not a pass compare', () => {
  assert.deepEqual(compareMedians(7, 3, 1), { outcome: 'win', diff: 2 });
  assert.deepEqual(compareMedians(8, 1, 4), { outcome: 'loss', diff: -3 });
  assert.deepEqual(compareMedians(8, 2, 2), { outcome: 'tie', diff: 0 });
  assert.deepEqual(compareBool(true, false), { outcome: 'win', diff: 1 });
});

// ---------- axis 9 ----------
test('axis 9: a 19% cost difference is a tie', () => {
  assert.equal(compareCost({ cost: 81, wall: 100 }, { cost: 100, wall: 100 }).outcome, 'tie');
  assert.equal(compareCost({ cost: 119, wall: 100 }, { cost: 100, wall: 100 }).outcome, 'tie');
});

test('axis 9: a 21% cost difference is a win (lower) or a loss (higher)', () => {
  assert.equal(compareCost({ cost: 79, wall: 100 }, { cost: 100, wall: 100 }).outcome, 'win');
  assert.equal(compareCost({ cost: 121, wall: 100 }, { cost: 100, wall: 100 }).outcome, 'loss');
});

test('axis 9: a cost win offset by a wall-time loss is a tie, and so is the mirror', () => {
  assert.equal(compareCost({ cost: 70, wall: 130 }, { cost: 100, wall: 100 }).outcome, 'tie');
  assert.equal(compareCost({ cost: 130, wall: 70 }, { cost: 100, wall: 100 }).outcome, 'tie');
  // wall time inside the margin does not offset
  assert.equal(compareCost({ cost: 70, wall: 110 }, { cost: 100, wall: 100 }).outcome, 'win');
});

// ---------- anonymization ----------
test('anonymize: blind runs carry only A/B and no arm name, reveal restores the mapping', () => {
  const runs = [
    { problem: 'p1', arm: 'alpha', run: 1, workspace: '/w/1' },
    { problem: 'p1', arm: 'beta', run: 1, workspace: '/w/2' },
    { problem: 'p1', arm: 'alpha', run: 2, workspace: '/w/3' },
  ];
  const { blind, reveal } = anonymize('p1', runs, 7);
  assert.equal(blind.length, 3);
  for (const b of blind) assert.equal('arm' in b, false);
  assert.deepEqual(blind.map((b) => b.label).sort(), ['A', 'A', 'B']);
  assert.equal(/alpha|beta/.test(JSON.stringify(blind)), false);
  const map = reveal();
  assert.deepEqual(Object.keys(map).sort(), ['A', 'B']);
  assert.deepEqual(Object.values(map).sort(), ['alpha', 'beta']);
  // both alpha runs share one label, and it is the label the map gives alpha
  const alphaLabels = new Set(blind.filter((b) => b.workspace !== '/w/2').map((b) => b.label));
  assert.deepEqual([...alphaLabels], [map.A === 'alpha' ? 'A' : 'B']);
});

test('anonymize: same seed gives the same mapping, and some seed flips it', () => {
  const runs = [{ problem: 'p1', arm: 'alpha' }, { problem: 'p1', arm: 'beta' }];
  assert.deepEqual(anonymize('p1', runs, 3).reveal(), anonymize('p1', runs, 3).reveal());
  const firsts = new Set();
  for (let seed = 1; seed <= 20; seed++) firsts.add(anonymize('p1', runs, seed).reveal().A);
  assert.deepEqual([...firsts].sort(), ['alpha', 'beta']);
});

test('anonymize: anything but two arms throws', () => {
  assert.throws(() => anonymize('p1', [{ problem: 'p1', arm: 'alpha' }]), /exactly 2 arms/);
});

// ---------- scoreAll end to end on fake data ----------
const caseRow = (id, axis, slug) => ({ id, axis, slug, request: `requests/${id}.md`, fixture: '', check: `hidden/${id}/check.mjs`, status: 'ready' });
const nowhere = '/nonexistent-bench-dir';

test('scoreAll axis 1: median pass of 3 runs per arm, W/T/L oriented to the first arm, any seed', async () => {
  const cases = [caseRow('v1', 1, 'verified'), caseRow('v2', 1, 'verified'), caseRow('v3', 1, 'verified')];
  // pass table per workspace: alpha passes v1 (3/3), v2 (2/3); beta passes v1 (1/3), v2 (2/3), v3 (3/3)
  const pass = {
    'v1/alpha': [true, true, true], 'v1/beta': [true, false, false],
    'v2/alpha': [true, true, false], 'v2/beta': [false, true, true],
    'v3/alpha': [false, false, true], 'v3/beta': [true, true, true],
  };
  const runs = [];
  for (const id of ['v1', 'v2', 'v3']) {
    for (const arm of ['alpha', 'beta']) {
      for (let i = 0; i < 3; i++) runs.push({ problem: id, arm, run: i + 1, workspace: `/ws/${id}/${arm}/${i}` });
    }
  }
  const check = (_path, ws) => {
    const [, id, arm, i] = ws.split('/').slice(1);
    return pass[`${id}/${arm}`][Number(i)];
  };
  for (const seed of [1, 2, 3, 4, 5]) {
    const res = await scoreAll({ cases, runs, check, seed, bench: nowhere });
    assert.equal(res.focus, 'alpha');
    assert.equal(res.other, 'beta');
    const row = res.rows[0];
    assert.equal(row.axis, 1);
    assert.equal(row.wins, 1);   // v1: pass vs fail
    assert.equal(row.ties, 1);   // v2: pass vs pass
    assert.equal(row.losses, 1); // v3: fail vs pass
    assert.equal(row.margin, 0);
    assert.equal(row.belowMinimumEffect, true);
    assert.equal(row.unscored, 0);
  }
});

test('scoreAll axes 7-8: numeric median per arm, summed margin, judge sees labels and no arm name', async () => {
  const cases = [caseRow('f1', 7, 'progress'), caseRow('f2', 7, 'progress')];
  const counts = { 'f1/alpha': [4, 4, 1], 'f1/beta': [2, 2, 3], 'f2/alpha': [1, 1, 1], 'f2/beta': [2, 3, 2] };
  const runs = [];
  for (const id of ['f1', 'f2']) {
    for (const arm of ['alpha', 'beta']) {
      for (let i = 0; i < 3; i++) runs.push({ problem: id, arm, run: i + 1, workspace: `/ws/${id}/${arm}/${i}` });
    }
  }
  const seen = [];
  const judge = async ({ label, workspace, prompt }) => {
    seen.push({ label, prompt });
    const [id, arm, i] = workspace.split('/').slice(2);
    return { count: counts[`${id}/${arm}`][Number(i)] };
  };
  const res = await scoreAll({ cases, runs, judge, seed: 4, bench: nowhere });
  // medians: f1 alpha 4 vs beta 2 -> +2 ; f2 alpha 1 vs beta 2 -> -1
  const row = res.rows[0];
  assert.equal(row.wins, 1);
  assert.equal(row.losses, 1);
  assert.equal(row.margin, 1);
  assert.equal(row.min, -1);
  assert.equal(row.max, 2);
  assert.equal(row.median, 0.5);
  assert.equal(row.belowMinimumEffect, false);
  assert.equal(seen.length, 12);
  for (const s of seen) {
    assert.ok(s.label === 'A' || s.label === 'B');
    assert.equal(/alpha|beta/.test(s.prompt), false);
  }
});

test('scoreAll axis 9: relative cost orientation holds whichever arm is labelled A, a small gap ties', async () => {
  const cases = [caseRow('c1', 9, 'cost'), caseRow('c2', 9, 'cost')];
  const mk = (problem, arm, tokens) => ({ problem, arm, run: 1, workspace: '/ws', tokens, usd: 0, wall: 100 });
  const runs = [
    mk('c1', 'alpha', 100), mk('c1', 'beta', 200), // alpha cheaper by 50%
    mk('c2', 'alpha', 95), mk('c2', 'beta', 100),  // 5% cheaper: tie from either side
  ];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const res = await scoreAll({ cases, runs, seed, bench: nowhere });
    const row = res.rows[0];
    assert.equal(row.wins, 1);
    assert.equal(row.ties, 1);
    assert.equal(row.losses, 0);
    const c1 = row.entries.find((e) => e.problem === 'c1');
    assert.equal(c1.outcome, 'win');
    assert.equal(c1.unit, 'tokens');
    assert.equal(c1.diff, -0.5);
  }
});

test('scoreAll axis 9: a gap that straddles the minimum effect gives one outcome for every seed (no label dependence)', async () => {
  const cases = [caseRow('c1', 9, 'cost')];
  const mk = (arm, tokens) => ({ problem: 'c1', arm, run: 1, workspace: '/ws', tokens, usd: 0, wall: 100 });
  // alpha is 18% under beta, which is 22% over alpha measured the other way round
  const runs = [mk('alpha', 82), mk('beta', 100)];
  const seen = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const e = (await scoreAll({ cases, runs, seed, bench: nowhere })).rows[0].entries[0];
    seen.add(`${e.outcome}/${e.diff}`);
  }
  assert.equal(seen.size, 1);
  assert.deepEqual([...seen], ['tie/-0.18']);
});

// ---------- runs file, record, no-data rows ----------
test('recordRun sums result events; readRuns reads json and jsonl; noDataLines names the axes without rows', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { recordRun, readRuns, noDataLines } = await import('./ghscore.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ghscore-'));
  try {
    const stream = join(dir, 's.jsonl');
    writeFileSync(stream, [
      '{"type":"system"}', 'not json',
      '{"type":"result","total_cost_usd":0.5,"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100}}',
      '{"type":"result","total_cost_usd":0.25,"usage":{"input_tokens":1,"output_tokens":1}}',
    ].join('\n'));
    const rec = recordRun({ problem: 'p', arm: 'a', run: 'r', workspace: '/w', stream, wall: '42' });
    assert.deepEqual(rec, { problem: 'p', arm: 'a', run: 'r', workspace: '/w', tokens: 117, usd: 0.75, wall: 42 });
    assert.equal(recordRun({ problem: 'p', arm: 'a', run: 'r', workspace: '/w', stream: join(dir, 'none'), wall: 'x' }).tokens, undefined);
    writeFileSync(join(dir, 'r.jsonl'), `${JSON.stringify(rec)}\n\n${JSON.stringify(rec)}\n`);
    writeFileSync(join(dir, 'r.json'), JSON.stringify([rec, rec]));
    assert.equal(readRuns(join(dir, 'r.jsonl')).length, 2);
    assert.equal(readRuns(join(dir, 'r.json')).length, 2);
    assert.deepEqual(noDataLines({ rows: [{ axis: 2, problems: 1 }, { axis: 5, problems: 0 }] }).map((l) => l.split(' ')[0]), ['1', '3', '4', '5', '6', '7', '8', '9']);
  } finally { rmSync(dir, { recursive: true }); }
});

// ---------- report ----------
const reportRes = () => ({
  focus: 'alpha', other: 'beta', arms: ['alpha', 'beta'], seed: 1, min: MIN_EFFECT,
  rows: [
    { ...summarizeAxis(1, [entry('p1', 'win', 1), entry('p2', 'win', 1), entry('p3', 'loss', -1)]), slug: 'verified', unscored: 0 },
    { ...summarizeAxis(2, [entry('p1', 'win', 1), entry('p2', 'loss', -1)]), slug: 'planted', unscored: 0 },
    { ...summarizeAxis(9, [entry('p1', 'win', -0.5), entry('p2', 'win', -0.4), entry('p3', 'tie', -0.1)]), slug: 'cost', unscored: 0 },
  ],
});

test('formatReport: one row per axis, no total and no overall score', () => {
  const res = reportRes();
  const text = formatReport(res);
  assert.equal(text.split('\n').filter((l) => /^\d+ \|/.test(l)).length, 3);
  assert.equal(/total|overall/i.test(text), false);
  assert.equal(/total|overall/i.test(Object.keys(res).join(' ')), false);
  assert.equal(/total|overall/i.test(Object.keys(res.rows[0]).join(' ')), false);
});

test('formatReport: each row gives W/T/L and min/median/max, axis 9 as percentages', () => {
  const lines = formatReport(reportRes()).split('\n');
  assert.equal(lines.find((l) => l.startsWith('1 |')), '1 | verified | 2/0/1 | -1/1/1 | alpha ahead');
  assert.equal(lines.find((l) => l.startsWith('2 |')), '2 | planted | 1/0/1 | -1/0/1 | below minimum effect');
  assert.equal(lines.find((l) => l.startsWith('9 |')), '9 | cost | 2/1/0 | -50%/-40%/-10% | alpha ahead');
});

test('minimum effect: values are 1 problem, 1 field, 20%, and the report states them', () => {
  assert.equal(MIN_EFFECT.passAxesProblems, 1);
  assert.equal(MIN_EFFECT.fieldAxesFields, 1);
  assert.equal(MIN_EFFECT.costFraction, 0.2);
  assert.equal(Object.isFrozen(MIN_EFFECT), true);
  const line = formatReport(reportRes()).split('\n')[1];
  assert.equal(line, 'minimum effect used: axes 1-6 < 1 problem (wins-losses); axes 7-8 < 1 field (summed); axis 9 < 20% (per-problem median, wall-time margin the same)');
});
