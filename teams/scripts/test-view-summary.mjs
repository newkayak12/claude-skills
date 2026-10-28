// summarize(): the pure builder behind `view.mjs --once --format summary` (the teams-status mod).
//
//   node --test teams/scripts/test-view-summary.mjs
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarize, metrics } from './lib/view-summary.mjs';
import { stageOfNode, STAGE_KEYS } from './lib/view-stages.mjs';
import { dashboardModel } from './lib/view-dashboard.mjs';

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const ms = (id, state, extra = {}) => ({ node_id: id, stage: id.split(':')[0], state, ...extra });
const card = (id, title, state, extra = {}) => ({
  id, title, phase: null, reporter: null, origin: null,
  dispatch: ms(`dispatch:${id}:1`, state), accept: state === 'done' ? ms(`accept:${id}:1`, 'done') : null,
  child: null, ...extra,
});

// Mirrors the demo task: QA-less, audit filed defect D1.
function demo(over = {}) {
  return {
    task_id: 'E-3a3a3bb5-f4b7', ticket: { key: 'E-3a3a3bb5', title: 'Build the expense tracker' },
    request: 'Build the expense tracker', state: 'running', elapsed_ms: 14.2 * 86400000,
    cost: { usd: 0, turns: 0 },
    manager_stages: [
      ms('size', 'done'), ms('shape', 'done'), ms('critique', 'done'), ms('integrate:1', 'done'),
      ms('integrate:2', 'pending'), ms('gate:goal:1', 'pending'), ms('report', 'pending'),
    ],
    packages: [
      card('PLAN', 'Plan (PRD)', 'done', { phase: 'planning' }),
      card('P1', 'module a', 'done'),
      card('P2', 'module b', 'done'),
      card('D1', 'US-2 -> b.txt was never wired', 'pending', { reporter: 'audit', origin: 'planning-audit' }),
    ],
    qa: null,
    audit: { id: 'AUDIT', rounds: [{ ...card('AUDIT:1', 'Planning audit', 'done'), id: 'AUDIT:1', state: 'done' }] },
    s_run: null, events: [],
    ...over,
  };
}

const FORBIDDEN = ['verdict', 'match_pct', 'dispatch:', 'accept:', 'gate:goal', 'integrate:', '/Users/', '/var/', '/tmp/'];
const clean = (m) => {
  const s = JSON.stringify(summarize(m, { now: NOW }));
  for (const t of FORBIDDEN) assert.ok(!s.includes(t), `leaked ${t}: ${s}`);
};

test('demo model: counts, stages, now, you', () => {
  const s = summarize(demo(), { now: NOW });
  assert.equal(s.key, 'E-3a3a3bb5');
  assert.equal(s.title, 'Build the expense tracker');
  assert.equal(s.state, 'running');
  assert.equal(s.day, 15);
  assert.equal(s.done, 4);
  assert.equal(s.total, 5);
  assert.deepEqual(s.stages.map((x) => `${x.key}:${x.state}`),
    ['plan:done', 'build:done', 'integrate:done', 'qa:running', 'gate:pending', 'report:pending']);
  assert.equal(s.now.kind, 'fixnext'); // the defect is still pending: next, not being fixed
  assert.equal(s.now.subject, 'US-2 -> b.txt was never wired');
  assert.equal(s.you.count, 0);
  const d1 = s.work.find((w) => w.id === 'D1');
  assert.deepEqual([d1.kind, d1.state, d1.filed_by, d1.reason], ['defect', 'pending', 'audit', null]);
  clean(demo());
});

test('slug is top-level and comes from the ticket; null when absent', () => {
  const slugged = demo({ ticket: { key: 'E-3a3a3bb5', slug: 'expense-tracker', title: 'Build the expense tracker' } });
  assert.equal(summarize(slugged, { now: NOW }).slug, 'expense-tracker');
  assert.equal(summarize(demo(), { now: NOW }).slug, null);
});

test('stalled keeps its state', () => {
  assert.equal(summarize(demo({ state: 'stalled' }), { now: NOW }).state, 'stalled');
  clean(demo({ state: 'stalled' }));
});

test('complete: every stage done, now done, done === total', () => {
  const m = demo({ state: 'complete' });
  m.manager_stages.forEach((n) => { n.state = 'done'; });
  m.packages[3] = card('D1', 'defect', 'done', { reporter: 'audit', origin: 'planning-audit' });
  const s = summarize(m, { now: NOW });
  assert.equal(s.state, 'complete');
  assert.ok(s.stages.every((x) => x.state === 'done'));
  assert.equal(s.now.kind, 'done');
  assert.equal(s.done, s.total);
  clean(m);
});

test('failed package: card failed with a reason, its stage failed, others reason null', () => {
  const m = demo();
  m.packages[2] = card('P2', 'module b', 'failed', { dispatch: ms('dispatch:P2:1', 'failed', { reason: 'tests did not pass in /Users/x/wt' }) });
  const s = summarize(m, { now: NOW });
  const w = s.work.find((x) => x.title === 'module b');
  assert.equal(w.state, 'failed');
  assert.ok(w.reason && w.reason.length > 0);
  assert.ok(!w.reason.includes('/Users/'));
  assert.ok(s.work.filter((x) => x !== w).every((x) => x.reason === null));
  assert.equal(s.stages.find((x) => x.key === 'build').state, 'failed');
  clean(m);
});

test('waiting_human node: you.count 1, now answer', () => {
  const m = demo();
  m.packages[3] = card('D1', 'defect D1', 'pending', { child: { nodes: [ms('qa:1', 'waiting_human')] } });
  const s = summarize(m, { now: NOW });
  assert.equal(s.you.count, 1);
  assert.equal(s.you.items.length, 1);
  assert.equal(s.now.kind, 'answer');
  clean(m);
});

test('s_run with no packages does not throw and still has stages', () => {
  const m = demo({ packages: [], audit: null, manager_stages: [], s_run: { nodes: [ms('plan', 'done'), ms('implement:1', 'running'), ms('gate:goal', 'pending'), ms('report', 'pending')] } });
  const s = summarize(m, { now: NOW });
  assert.ok(s.stages.length > 0);
  assert.equal(s.stages.find((x) => x.key === 'build').state, 'running');
  clean(m);
});

test('log: HH:MM local, newest 20 of 30, no ids', () => {
  const t0 = Date.UTC(2026, 9, 7, 11, 2);
  const events = Array.from({ length: 30 }, (_, i) => ({ ts: t0 + i * 60000, event: 'node_finish', node_id: 'accept:P1:1', state: 'done' }));
  const m = demo({ events });
  const s = summarize(m, { now: NOW });
  assert.equal(s.log.length, 20);
  assert.ok(s.log.every((l) => /^\d{2}:\d{2}$/.test(l.time)));
  assert.equal(s.log[0].time, '11:12');
  assert.deepEqual([s.log[0].kind, s.log[0].subject], ['passed', 'module a']);
  clean(m);
});

test('failed package with null or path-only reason still gets a non-empty reason', () => {
  for (const reason of [null, '/Users/x/wt']) {
    const m = demo();
    m.packages[2] = card('P2', 'module b', 'failed', { dispatch: ms('dispatch:P2:1', 'failed', { reason }) });
    const w = summarize(m, { now: NOW }).work.find((x) => x.title === 'module b');
    assert.equal(w.state, 'failed');
    assert.equal(typeof w.reason, 'string');
    assert.ok(w.reason.length > 0, `empty reason for ${JSON.stringify(reason)}`);
    assert.ok(!w.reason.includes('/Users/'));
    clean(m);
  }
});

test('running: first non-done stage is promoted to the single current stage', () => {
  const m = demo();
  m.manager_stages = [ms('size', 'done'), ms('integrate:1', 'done'), ms('gate:goal:1', 'pending'), ms('report', 'pending')];
  m.packages = [card('PLAN', 'Plan (PRD)', 'done', { phase: 'planning' }), card('P1', 'module a', 'done')];
  m.audit = null;
  const s = summarize(m, { now: NOW });
  const running = s.stages.filter((x) => x.state === 'running');
  assert.equal(running.length, 1);
  assert.equal(running[0].key, s.stages.find((x) => x.state !== 'done').key);
  assert.equal(running[0].key, 'qa');
  clean(m);
});

test('now: a pending defect is next; a running defect is being fixed', () => {
  assert.equal(summarize(demo(), { now: NOW }).now.kind, 'fixnext');
  const m = demo();
  m.packages[3] = card('D1', 'US-2 -> b.txt was never wired', 'running', { reporter: 'audit', origin: 'planning-audit' });
  assert.equal(summarize(m, { now: NOW }).now.kind, 'fix');
});

test('work is in run order: plan, build cards, then defects', () => {
  const m = demo();
  m.packages = [m.packages[3], m.packages[1], m.packages[0], m.packages[2]]; // D1, P1, PLAN, P2
  assert.deepEqual(summarize(m, { now: NOW }).work.map((w) => w.kind), ['plan', 'package', 'package', 'audit', 'defect']);
  assert.deepEqual(summarize(m, { now: NOW }).work.map((w) => w.title).slice(0, 3), ['Plan (PRD)', 'module a', 'module b']);
});

// ---------- a size-S task on the development harness: stages come from model.harness ----------

// What collectTask() puts on a harness_run task: its own stage model (view-collect.mjs), beside the
// frozen size/shape/critique graph a size-S task still carries.
function harnessModel(states = {}, over = {}) {
  return demo({
    state: 'running', packages: [], audit: null, qa: null,
    manager_stages: [ms('size', 'done'), ms('shape', 'skipped'), ms('critique', 'skipped')],
    harness: { slug: 'req', moving: false, driver: { alive: true }, stages: STAGE_KEYS.map((key) => ({ key, state: states[key] || 'pending' })) },
    ...over,
  });
}
const barOf = (s) => s.stages.map((x) => `${x.key}:${x.state}`);

test('harness: stagesOf draws from model.harness - 01-plan.md filled plan, the frozen skipped shape/critique nodes do not hold it back', () => {
  const s = summarize(harnessModel({ plan: 'done' }), { now: NOW });
  assert.deepEqual(barOf(s), ['plan:done', 'build:running', 'integrate:pending', 'qa:pending', 'gate:pending', 'report:pending']);
  clean(harnessModel({ plan: 'done' }));
});

test('harness: the moving flag does not fill a stage - a fresh stream with no stage file leaves nothing done', () => {
  const m = harnessModel({}, { harness: { slug: 'req', moving: true, driver: { alive: true }, stages: STAGE_KEYS.map((key) => ({ key, state: 'pending' })) } });
  const s = summarize(m, { now: NOW });
  assert.ok(s.stages.every((x) => x.state !== 'done'), barOf(s).join(' '));
});

test('harness: a done gate backfills the stages the run never wrote a file for; a failed gate reads failed; complete fills all', () => {
  assert.deepEqual(barOf(summarize(harnessModel({ plan: 'done', gate: 'done' }), { now: NOW })),
    ['plan:done', 'build:done', 'integrate:done', 'qa:done', 'gate:done', 'report:running']);
  assert.equal(summarize(harnessModel({ plan: 'done', gate: 'failed', report: 'done' }, { state: 'partial' }), { now: NOW }).stages.find((x) => x.key === 'gate').state, 'failed');
  assert.ok(summarize(harnessModel({ plan: 'done' }, { state: 'complete' }), { now: NOW }).stages.every((x) => x.state === 'done'));
});

test('harness: skipped areas and areas-critique nodes never read blocked or failed, on the frozen graph or in the harness model', () => {
  const m = harnessModel({ plan: 'done' });
  m.manager_stages.push(ms('areas', 'skipped'), ms('areas-critique', 'skipped'));
  assert.ok(!barOf(summarize(m, { now: NOW })).some((x) => x.endsWith(':failed')));
  const plain = demo();
  plain.manager_stages.push(ms('areas', 'skipped'), ms('areas-critique', 'skipped'));
  assert.ok(!barOf(summarize(plain, { now: NOW })).some((x) => x.endsWith(':failed')));
});

// ---------- a retried manager node leaves its first attempt 'skipped': not work, so it holds nothing back ----------

test('plain: skipped first attempts of shape and critique do not hold Plan at running once Build starts', () => {
  const m = demo({
    state: 'running', packages: [card('P1', 'module a', 'running')], audit: null,
    manager_stages: [ms('size', 'done'), ms('shape', 'skipped'), ms('critique', 'skipped'), ms('shape:2', 'done'), ms('critique:2', 'done')],
  });
  const s = summarize(m, { now: NOW });
  assert.deepEqual(barOf(s), ['plan:done', 'build:running', 'integrate:pending', 'qa:pending', 'gate:pending', 'report:pending']);
  const dash = dashboardModel(s, { now: NOW }); // the Home bar counts the same stages: 1 of 6, not 0 of 6
  assert.equal(dash.tiles.find((t) => t.key === 'progress').sub, '1/6 stages');
  assert.equal(dash.pct, 17);
  clean(m);
});

test('plain: a stage with only skipped attempts and no later stage moved reads pending, not done', () => {
  const m = demo({
    state: 'pending', packages: [], audit: null,
    manager_stages: [ms('shape', 'skipped'), ms('critique', 'skipped')],
  });
  assert.deepEqual(barOf(summarize(m, { now: NOW })), ['plan:pending', 'build:pending', 'integrate:pending', 'qa:pending', 'gate:pending', 'report:pending']);
});

test('stageOfNode lives once, in view-stages.mjs: view-summary.mjs and view-collect.mjs import it', () => {
  assert.deepEqual(['size', 'implement:U1:1', 'integrate:1', 'integrate:2', 'gate:goal:1', 'report', 'areas'].map(stageOfNode),
    ['plan', 'build', 'integrate', 'qa', 'gate', 'report', null]);
  for (const f of ['view-summary.mjs', 'view-collect.mjs']) {
    const src = readFileSync(new URL(`./lib/${f}`, import.meta.url), 'utf8');
    assert.ok(!/function stageOfNode/.test(src), `${f} defines its own stageOfNode`);
    assert.match(src, /from '\.\/view-stages\.mjs'/);
  }
});

// ---- metrics(): the run's numbers, from a model with telemetry (collect fills it; fixtures here) ----

const MIN = 60000;
function withTelemetry(telemetry, over = {}) {
  return demo({
    packages: [
      card('P1', 'module a', 'done', { ticket_key: 'E-3a3a3bb5/P1', attempt: 1 }),
      {
        ...card('P2', 'module b', 'failed', { ticket_key: 'E-3a3a3bb5/P2', attempt: 5 }),
        dispatch: ms('dispatch:P2:3', 'failed'), accept: ms('accept:P2:3', 'failed', { scoped_out: [{ gap: 'export path not exercised', belongs_to: 'P3' }] }),
      },
      { ...card('P3', 'module c', 'pending', { ticket_key: 'E-3a3a3bb5/P3', attempt: 1 }), dispatch: ms('dispatch:P3:1', 'pending'), accept: null },
    ],
    audit: null,
    telemetry: { goal_threshold: 90, max_attempts: 3, stall_minutes: 20, budget_usd: null, spent_usd: 0, ...telemetry },
    ...over,
  });
}
const story = (m, id) => m.stories.find((s) => s.id === id);

test('metrics: attempt n of max, capped at max_retries + 1; a never-run STORY is 0 with no judge', () => {
  const x = metrics(withTelemetry({}), { now: NOW });
  assert.equal(x.max_attempts, 3);
  assert.equal(story(x, 'P1').attempt, 1);
  assert.equal(story(x, 'P2').attempt, 3, 'attempt 5 is capped at 3');
  assert.equal(story(x, 'P3').attempt, 0, 'a pending dispatch has not begun its attempt');
  assert.equal(story(x, 'P3').judge, null);
  assert.ok(!JSON.stringify(x).match(/NaN|undefined/));
});

test('metrics: the last judge score against the threshold, and its reason without node ids or paths', () => {
  const x = metrics(withTelemetry({ judge: { P2: { score: 85, reason: 'accept:P2:3 failed in /tmp/x/y: the footer is not cleared', attempt: 3 } } }), { now: NOW });
  assert.deepEqual(story(x, 'P2').judge, { score: 85, threshold: 90, reason: 'failed in the footer is not cleared', gap: null });
  assert.equal(x.threshold, 90);
});

test('metrics: a repackaged story counts its attempt from the new shape and its old verdict is stale', () => {
  const repackaged = {
    ...card('P2', 'module b', 'running', { ticket_key: 'E-3a3a3bb5/P2', attempt: 4, round_first_attempt: 4 }),
    dispatch: ms('dispatch:P2:4', 'running', { started_at: NOW - MIN }), accept: ms('accept:P2:4', 'pending'),
  };
  const m = withTelemetry({ judge: { P2: { score: 60, reason: 'old shape', attempt: 3, verdict: 'reject' } } });
  m.packages[1] = repackaged;
  const p2 = story(metrics(m, { now: NOW }), 'P2');
  assert.equal(p2.attempt, 1, 'dispatch :4 after a 3-attempt shape is attempt 1');
  assert.equal(p2.state, 'running');
  assert.equal(p2.judge, null, 'a verdict before round_first_attempt is stale');
  // a verdict of the current shape still shows
  m.telemetry.judge.P2.attempt = 4;
  assert.equal(story(metrics(m, { now: NOW }), 'P2').judge.score, 60);
});

test('metrics: a reject at or above the threshold carries the deciding gap, scrubbed; below it gap is null', () => {
  const m = withTelemetry({ judge: { P2: { score: 90, reason: 'close', attempt: 3, verdict: 'reject' } } });
  m.packages[1].accept.gaps = ['accept:P2:3 export at /tmp/x/y is not cleared', 'second gap'];
  assert.equal(story(metrics(m, { now: NOW }), 'P2').judge.gap, 'export at is not cleared');
  m.telemetry.judge.P2.score = 85;
  assert.equal(story(metrics(m, { now: NOW }), 'P2').judge.gap, null);
});

test('metrics: cost and wall time per STORY and per stage, with retry spend apart from cost_usd', () => {
  const spend = [
    { story: 'P2', attempt: 1, stage: null, cost_usd: 1, duration_ms: 1000 },
    { story: 'P2', attempt: 2, stage: null, cost_usd: 2, duration_ms: 3000 },
    { story: 'P2', attempt: 2, stage: 'gate', cost_usd: 0.5, duration_ms: 500 },
    { story: null, attempt: 1, stage: 'plan', cost_usd: 0.25, duration_ms: 250 },
  ];
  const x = metrics(withTelemetry({ spend, spent_usd: 3.75 }), { now: NOW });
  const p2 = story(x, 'P2');
  assert.equal(p2.cost_usd, 1);
  assert.equal(p2.retry_cost_usd, 2.5);
  assert.equal(p2.wall_ms, 4500);
  const at = (rows, stage) => rows.find((r) => r.stage === stage);
  assert.deepEqual(at(p2.stages, 'build'), { stage: 'build', cost_usd: 1, retry_cost_usd: 2, wall_ms: 4000 });
  assert.deepEqual(at(p2.stages, 'gate'), { stage: 'gate', cost_usd: 0, retry_cost_usd: 0.5, wall_ms: 500 });
  assert.equal(at(p2.stages, 'plan'), undefined);
  assert.deepEqual(at(x.stages, 'build'), { stage: 'build', cost_usd: 1, retry_cost_usd: 2, wall_ms: 4000 });
  assert.deepEqual(at(x.stages, 'plan'), { stage: 'plan', cost_usd: 0.25, retry_cost_usd: 0, wall_ms: 250 }, 'a manager judge counts to the task, not to a STORY');
  assert.equal(story(x, 'P1').cost_usd, 0);
});

test('metrics: the budget when the task sets one, null when it does not', () => {
  const set = metrics(withTelemetry({ budget_usd: 10, spent_usd: 2.5 }), { now: NOW });
  assert.deepEqual(set.budget, { limit_usd: 10, spent_usd: 2.5 });
  const unset = metrics(withTelemetry({ spent_usd: 2.5 }), { now: NOW });
  assert.equal(unset.budget, null);
});

test('metrics: a stalled driver is one alive with no progress for stall_minutes; stall_minutes 0 turns it off', () => {
  const drivers = [{ story: 'P2', progress_at: NOW - 25 * MIN }, { story: 'P1', progress_at: NOW - 5 * MIN }, { story: null, progress_at: null }];
  const x = metrics(withTelemetry({ drivers }), { now: NOW });
  assert.deepEqual(x.drivers.stalled, [{ id: 'P2', minutes: 25 }]);
  assert.deepEqual(metrics(withTelemetry({ drivers, stall_minutes: 0 }), { now: NOW }).drivers.stalled, []);
});

test('metrics: live drivers against the cap, null when unknown', () => {
  const d = (live) => { const { stalled, ...rest } = metrics(withTelemetry({ live }), { now: NOW }).drivers; return rest; };
  assert.deepEqual(d({ live: 3, cap: 4 }), { live: 3, cap: 4 });
  assert.deepEqual(d({ live: 2, cap: null }), { live: 2, cap: null });
  assert.deepEqual(d(undefined), { live: null, cap: null });
});

test('metrics: tool denials are manager judges plus worker nodes', () => {
  assert.deepEqual(metrics(withTelemetry({ denials: { judges: 2, workers: 1 } }), { now: NOW }).denials, 3);
  assert.equal(metrics(withTelemetry({}), { now: NOW }).denials, 0);
});

test('metrics: out-of-retries STORYs, including one that never ran', () => {
  const x = metrics(withTelemetry({ out_of_retries: ['P2', 'P3'] }), { now: NOW });
  assert.deepEqual(x.out_of_retries, ['P2', 'P3']);
  assert.equal(story(x, 'P2').out_of_retries, true);
  assert.equal(story(x, 'P3').out_of_retries, true);
  assert.equal(story(x, 'P1').out_of_retries, false);
});

test('metrics: defects filed (unique ids) against defects dropped, with the drop reason', () => {
  const x = metrics(withTelemetry({ defects: { filed: ['D1', 'D2', 'D2'], dropped: [{ id: 'D9', title: 'no repro given', reason: 'no repro' }] } }), { now: NOW });
  assert.equal(x.defects.filed, 2);
  assert.equal(x.defects.dropped, 1);
  assert.deepEqual(x.defects.dropped_items, [{ id: 'D9', title: 'no repro given', reason: 'no repro' }]);
  assert.deepEqual(metrics(withTelemetry({}), { now: NOW }).defects, { filed: 0, dropped: 0, dropped_items: [] });
});

test('metrics: scoped_out gaps (the only out-of-scope record, so partial) per STORY and in all', () => {
  const x = metrics(withTelemetry({}), { now: NOW });
  assert.deepEqual(story(x, 'P2').scoped_out, [{ gap: 'export path not exercised', belongs_to: 'P3' }]);
  assert.deepEqual(x.scoped_out, [{ story: 'P2', gap: 'export path not exercised', belongs_to: 'P3' }]);
  assert.deepEqual(story(x, 'P1').scoped_out, []);
});

test('summarize() carries metrics, a model with no telemetry gives empty numbers, and neither touches the fs', () => {
  const s = summarize(withTelemetry({ budget_usd: 4, spent_usd: 1 }), { now: NOW });
  assert.deepEqual(s.metrics.budget, { limit_usd: 4, spent_usd: 1 });
  const bare = summarize(demo(), { now: NOW }).metrics;
  assert.equal(bare.budget, null);
  assert.equal(bare.max_attempts, null);
  assert.deepEqual(bare.drivers.stalled, []);
  clean(withTelemetry({ judge: { P2: { score: 85, reason: 'accept:P2:3 said no', attempt: 3 } } }));
  const src = readFileSync(new URL('./lib/view-summary.mjs', import.meta.url), 'utf8');
  assert.ok(!/node:fs|node:child_process/.test(src));
});
