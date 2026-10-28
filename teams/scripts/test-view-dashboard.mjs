import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardModel, dashboardSvg, dashboardAlt, dashboardText, lanesOf, fit } from './lib/view-dashboard.mjs';

const task = (over = {}) => ({
  key: 'E-4a1c9e02', title: 'Checkout: refund flow', state: 'running', done: 1, total: 3,
  now: { kind: 'build', subject: 'Refund API' },
  you: { count: 1, cards: [{ who: 'P2', title: 'Receipt copy', question: 'Brand or plain?' }] },
  stages: [{ key: 'plan', state: 'done' }, { key: 'build', state: 'running' }, { key: 'integrate', state: 'pending' }],
  work: [
    { title: 'PRD', kind: 'plan', state: 'done' },
    { title: 'Refund API', kind: 'package', state: 'running' },
    { title: 'Receipt copy', kind: 'package', state: 'running' },
    { title: 'Webhooks', kind: 'package', state: 'failed', reason: 'timeout' },
  ],
  cost: { usd: 1.5, turns: 20 },
  log: [{ time: '10:00', kind: 'dispatched', subject: 'Refund API' }, { time: '10:05', kind: 'failed', subject: 'Webhooks' }],
  ...over,
});

test('model: percent of done stages, numbered stages, packages only from build cards', () => {
  const m = dashboardModel(task());
  assert.equal(m.pct, 33);
  assert.deepEqual(m.stages.map((s) => [s.n, s.label, s.state]), [[1, 'Plan', 'done'], [2, 'Build', 'running'], [3, 'Integrate', 'pending']]);
  assert.deepEqual(m.packages.map((p) => p.title), ['Refund API', 'Receipt copy', 'Webhooks']);
  assert.equal(m.now, 'Build · Refund API');
});

test('lanes: a waiting card is in Needs you, a failed one stays in progress marked failed', () => {
  const lanes = Object.fromEntries(lanesOf(task()).map((l) => [l.key, l]));
  assert.deepEqual(lanes.you.cards.map((c) => c.title), ['Receipt copy']);
  assert.deepEqual(lanes.running.cards.map((c) => [c.title, c.failed]), [['Refund API', false], ['Webhooks', true]]);
  assert.equal(lanes.done.count, 1);
});

test('tiles: Needs you is an alert only while something waits', () => {
  assert.equal(dashboardModel(task()).tiles.find((t) => t.key === 'waiting').alert, true);
  assert.equal(dashboardModel(task({ you: { count: 0, cards: [] } })).tiles.find((t) => t.key === 'waiting').alert, false);
});

test('activity: newest first, at most six', () => {
  const log = Array.from({ length: 9 }, (_, i) => ({ time: `10:0${i}`, kind: 'dispatched', subject: `c${i}` }));
  const m = dashboardModel(task({ log }));
  assert.equal(m.activity.length, 6);
  assert.equal(m.activity[0].subject, 'c8');
});

test('svg: one document, escaped text, every stage label drawn, within the element limit', () => {
  const svg = dashboardSvg(dashboardModel(task({ title: 'a <b> & "c"' })));
  assert.match(svg, /^<svg [^>]*viewBox="0 0 720 \d+"/);
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(svg.includes('a &lt;b&gt; &amp; &quot;c&quot;'));
  for (const l of ['Plan', 'Build', 'Integrate', 'Refund API']) assert.ok(svg.includes(`>${l}<`), l);
  assert.ok(svg.length < 131072);
});

test('null task: no model, no svg', () => {
  assert.equal(dashboardModel(null), null);
  assert.equal(dashboardSvg(null), '');
  assert.equal(dashboardAlt(null), 'no task');
});

test('fit: cuts with an ellipsis, wide glyphs count wider', () => {
  assert.equal(fit('short', 200, 12), 'short');
  assert.ok(fit('x'.repeat(100), 70, 12).endsWith('…'));
  assert.ok(fit('가'.repeat(20), 60, 12).length < fit('a'.repeat(20), 60, 12).length);
});

test('text: key and title first, bar and percent, stages in order, waiting and lanes, nothing for no task', () => {
  const t = dashboardText(dashboardModel(task(), { now: 0 }));
  const lines = t.trimEnd().split('\n');
  assert.equal(lines[0], 'E-4a1c9e02  Checkout: refund flow');
  assert.match(lines[1], /^RUNNING  ▰{3}▱{7} 33%$/);
  assert.ok(t.includes('✔ Plan → ◉ Build → ○ Integrate'));
  assert.ok(t.includes('⚑ Receipt copy — Brand or plain?'));
  assert.ok(t.includes('Needs you 1: Receipt copy'));
  assert.ok(t.includes('In progress 2: Refund API · ✘ Webhooks'));
  assert.ok(lines.length <= 20);
  assert.equal(dashboardText(null), '');
});

test('stopped EPIC: the stage it stopped in reads failed, no now line', () => {
  const m = dashboardModel(task({ state: 'cancelled', now: { kind: 'idle', subject: null } }), { now: 0 });
  assert.deepEqual(m.stages.map((s) => s.state), ['done', 'failed', 'pending']);
  assert.equal(m.now, '');
});

// ---- the run's numbers: the text board and the SVG print the same ones --------------------------------
const numbers = () => ({
  max_attempts: 3, threshold: 90,
  budget: { limit_usd: 10, spent_usd: 4.21 },
  drivers: { live: 3, cap: 4, stalled: [{ id: 'P2', minutes: 25 }] },
  stories: [
    { id: 'P2', attempt: 3, max_attempts: 3, judge: { score: 85, threshold: 90, reason: 'All code and test acceptance for P2 is met and verified by a fresh run of every check' }, cost_usd: 1.27, retry_cost_usd: 2.35, wall_ms: 1521000, out_of_retries: true },
    { id: 'P3', attempt: 0, max_attempts: 3, judge: null, cost_usd: 0, retry_cost_usd: 0, wall_ms: 0, out_of_retries: true },
  ],
  denials: 2, out_of_retries: ['P2', 'P3'], defects: { filed: 5, dropped: 1, dropped_items: [] },
  scoped_out: [{ story: 'P2', gap: 'export path', belongs_to: 'P3' }],
});

test('metrics: the model carries the task-level numbers and each STORY', () => {
  const m = dashboardModel(task({ metrics: numbers() }), { now: 0 });
  assert.deepEqual(m.run, {
    budget: { limit_usd: 10, spent_usd: 4.21 }, drivers: { live: 3, cap: 4, stalled: [{ id: 'P2', minutes: 25 }] },
    denials: 2, out_of_retries: ['P2', 'P3'], defects: { filed: 5, dropped: 1 }, scoped_out: 1,
  });
  assert.deepEqual(m.stories.map((s) => [s.id, s.attempt, s.max_attempts]), [['P2', 3, 3], ['P3', 0, 3]]);
});

test('metrics: dashboardText prints every number, one STORY per line, the reason ends in an ellipsis', () => {
  const lines = dashboardText(dashboardModel(task({ metrics: numbers() }), { now: 0 })).split('\n');
  const all = lines.join('\n');
  for (const s of ['Budget $4.21 of $10.00', 'Drivers 3/4 live', 'Stalled P2 25m', 'Denials 2', 'Defects filed 5 · dropped 1', 'Out of retries P2, P3', 'Scoped out 1']) assert.ok(all.includes(s), s);
  const p2 = lines.filter((l) => l.startsWith('P2  ·'));
  assert.equal(p2.length, 1);
  assert.match(p2[0], /attempt 3\/3/);
  assert.match(p2[0], /judge 85 vs 90 — All code and test acceptance .*…/);
  assert.match(p2[0], /cost \$1\.27 \+ retry \$2\.35/);
  assert.match(p2[0], /wall 25m21s/);
  assert.match(p2[0], /out of retries/);
  const p3 = lines.find((l) => l.startsWith('P3  ·'));
  assert.equal(p3, 'P3  ·  attempt 0/3  ·  out of retries', 'a never-run STORY prints no judge, cost or wall');
  assert.ok(!all.match(/NaN|undefined|null/));
});

test('metrics: the SVG shows the same numbers', () => {
  const svg = dashboardSvg(dashboardModel(task({ metrics: numbers() }), { now: 0 }));
  for (const s of ['Budget $4.21 of $10.00', 'Drivers 3/4 live', 'Stalled P2 25m', 'Denials 2', 'Defects filed 5 · dropped 1', 'attempt 3/3', 'judge 85 vs 90', 'cost $1.27 + retry $2.35', 'wall 25m21s', 'attempt 0/3']) assert.ok(svg.includes(s), s);
  assert.ok(svg.length < 131072);
  assert.ok(!svg.match(/NaN|undefined/));
});

test('metrics: absent data prints nothing misleading', () => {
  const bare = { ...numbers(), budget: null, drivers: { live: null, cap: null, stalled: [] }, stories: [{ id: 'P1', attempt: 1, max_attempts: null, judge: { score: null, threshold: null, reason: null }, cost_usd: 0, retry_cost_usd: 0, wall_ms: 0, out_of_retries: false }], out_of_retries: [], scoped_out: [], denials: 0, defects: { filed: 0, dropped: 0 } };
  const t = dashboardText(dashboardModel(task({ metrics: bare }), { now: 0 }));
  assert.ok(!t.match(/NaN|undefined|null|Budget|Drivers|Stalled|Out of retries|Scoped out/));
  assert.ok(t.includes('P1  ·  attempt 1\n'));
  assert.ok(t.includes('Denials 0  ·  Defects filed 0 · dropped 0'));
  assert.ok(!dashboardSvg(dashboardModel(task({ metrics: bare }), { now: 0 })).match(/NaN|undefined/));
  // a task with no metrics at all prints none of it
  const none = dashboardText(dashboardModel(task(), { now: 0 }));
  assert.ok(!none.match(/Denials|Budget|attempt/));
});
