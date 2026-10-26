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
