// summarize(): the pure builder behind `view.mjs --once --format summary` (the teams-live mod).
//
//   node --test teams/scripts/test-view-summary.mjs
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './lib/view-summary.mjs';

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
