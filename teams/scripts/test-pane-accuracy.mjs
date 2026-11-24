#!/usr/bin/env node
// Does the teams pane's data say what tm_status says? One fictional L task (2 packages, one re-judged,
// an opus and a sonnet driver, a judge) is written to a temp dir; toolStatus({task_id}) (tm_status) and
// the `--format teams` path (onceOutput, what the pane mounts on) read it at one fixed now.
//
// What is compared, and against what:
//   from tm_status itself  EPIC cost (cost.usd, to cents), turns (cost.turns), state, counts by state,
//                          per-package attempts (nodes[] whose node_id starts 'dispatch:<pkg>:'),
//                          the running phase (nodes[] in state 'running', through view-stages.mjs).
//   tm_status carries NO model and NO elapsed, so these come from the fixture's own ground truth:
//                          each worker's model = the model its stream's system init line names (the fixture
//                          wrote it), per-STORY elapsed = the fixed now minus the fixture's dispatch start.
// A drift check pins the committed fixture module (fixtures/pane-accuracy.mjs: { teams, status, now }, what
// teams/hooks/mod.test.ts mounts the pane on): `node teams/scripts/test-pane-accuracy.mjs --write` rebuilds it.
//
//   node --test teams/scripts/test-pane-accuracy.mjs
process.env.TZ = 'UTC';
process.env.TEAMS_RUNS_DIR ??= 'off';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { node } from '../mcp/graph.mjs';
import { toolStatus } from '../mcp/taskmanager-handlers.mjs';
import { onceOutput } from './lib/view-once.mjs';
import { participantsOf } from './lib/view-story.mjs';
import { stageOfNode, STAGE_KEYS } from './lib/view-stages.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'pane-accuracy.mjs');
const TASK_ID = 'c0ffee00-0179-4a00-8000-000000000179';
const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const MIN = 60 * 1000;

const OPUS = 'claude-opus-4-1';
const SONNET = 'claude-sonnet-4-5';
const line = (o) => JSON.stringify(o);
const init = (model) => line({ type: 'system', subtype: 'init', model, session_id: 'abcdef12' });
const asst = (id, model, blocks) => line({ type: 'assistant', message: { id, model, content: blocks, usage: { input_tokens: 1200, output_tokens: 300 } } });
const use = (name, input, id) => ({ type: 'tool_use', id, name, input });
const answered = (id) => line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });

// Everything below is written under `root` and read at NOW: file times are set, never taken from the clock.
function write(root, rel, text, agoMs = 0) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  utimesSync(p, (NOW - agoMs) / 1000, (NOW - agoMs) / 1000);
  return p;
}

function writeTask(root) {
  const tasks = join(root, 'tasks');
  const dir = join(tasks, TASK_ID);
  const cwd = join(root, 'proj');
  mkdirSync(cwd, { recursive: true });
  const stream = (name, lines, agoMs) => write(root, `tasks/${TASK_ID}/drivers/${name}.stream.jsonl`, lines.join('\n') + '\n', agoMs);
  // P1: attempt 1 (opus, finished, exact cost), attempt 2 (opus, working: a test run, two subagent calls)
  const p1a1 = stream('dispatch_P1_1', [init(OPUS), asst('a1', OPUS, [{ type: 'text', text: 'start' }]), line({ type: 'result', subtype: 'success', total_cost_usd: 2.5, num_turns: 12 })], 25 * MIN);
  const p1a2 = stream('dispatch_P1_2', [
    init(OPUS),
    asst('b1', OPUS, [use('Agent', { subagent_type: 'reviewer', prompt: 'review' }, 'ag1')]),
    asst('b2', OPUS, [use('Agent', { subagent_type: 'helper', model: 'sonnet', prompt: 'help' }, 'ag2')]),
    answered('ag2'),
    asst('b3', OPUS, [use('Bash', { command: 'cd /work/teams && claude plugin test .' }, 'bx1')]),
  ], 5000);
  // P2: a sonnet driver inside an engine call
  const p2 = stream('dispatch_P2_1', [
    init(SONNET),
    asst('c1', SONNET, [use('mcp__teams__team_run', {}, 'tr1')]),
    line({ type: 'tool_progress', tool_name: 'mcp__teams__team_run', tool_use_id: 'tr1', elapsed_time_seconds: 90 }),
  ], 8000);
  stream('judge_P1_1', [init(SONNET), asst('j1', SONNET, [use('Read', { file_path: '/work/teams/a.mjs' }, 'jr1')])], 30000);

  const childRun = (pkg, nodes) => write(root, `wt-${pkg}/.teams_output/broker/runs/c-${pkg}.json`, JSON.stringify({
    run_id: `c-${pkg}`, flow: 'develop', max_retries: 2, spec: { subgoals: [{ id: 'U1', title: 'unit' }] }, nodes,
  }), 5000);
  childRun('P1', [
    node('implement:U1:1', 'implement', [], { state: 'done', subgoal_id: 'U1', started_at: NOW - 24 * MIN, finished_at: NOW - 21 * MIN }),
    node('gate:U1:1', 'gate', ['implement:U1:1'], { state: 'failed', subgoal_id: 'U1', started_at: NOW - 21 * MIN, finished_at: NOW - 20 * MIN, result: { match_pct: 61, reason: 'footer not cleared' } }),
    node('implement:U1:2', 'implement', ['gate:U1:1'], { state: 'running', subgoal_id: 'U1', started_at: NOW - 3 * MIN }),
    node('gate:U1:2', 'gate', ['implement:U1:2'], { state: 'pending', subgoal_id: 'U1' }),
  ]);
  childRun('P2', [node('implement:U1:1', 'implement', [], { state: 'running', subgoal_id: 'U1', started_at: NOW - 7 * MIN })]);

  const child = (pkg, log) => ({ run_id: `c-${pkg}`, cwd: join(root, `wt-${pkg}`), driver: { log, restarts: [] } });
  const nodes = [
    node('size', 'size', [], { state: 'done', started_at: NOW - 40 * MIN, finished_at: NOW - 39 * MIN }),
    node('shape', 'shape', ['size'], { state: 'done', started_at: NOW - 39 * MIN, finished_at: NOW - 35 * MIN }),
    node('critique', 'critique', ['shape'], { state: 'done', started_at: NOW - 35 * MIN, finished_at: NOW - 30 * MIN }),
    node('dispatch:P1:1', 'dispatch', ['critique'], { state: 'done', subgoal_id: 'P1', started_at: NOW - 30 * MIN, finished_at: NOW - 20 * MIN, child: child('P1', p1a1) }),
    node('accept:P1:1', 'accept', ['dispatch:P1:1'], { state: 'failed', subgoal_id: 'P1', started_at: NOW - 20 * MIN, finished_at: NOW - 19 * MIN, result: { accept: false, match_pct: 61, reason: 'footer not cleared' } }),
    node('dispatch:P1:2', 'dispatch', ['accept:P1:1'], { state: 'running', subgoal_id: 'P1', started_at: NOW - 6 * MIN, child: child('P1', p1a2) }),
    node('accept:P1:2', 'accept', ['dispatch:P1:2'], { state: 'pending', subgoal_id: 'P1' }),
    node('dispatch:P2:1', 'dispatch', ['critique'], { state: 'running', subgoal_id: 'P2', started_at: NOW - 8 * MIN, child: child('P2', p2) }),
    node('accept:P2:1', 'accept', ['dispatch:P2:1'], { state: 'pending', subgoal_id: 'P2' }),
  ];
  const packages = [{ id: 'P1', title: 'Ledger export', deps: [] }, { id: 'P2', title: 'Report page', deps: [] }];
  write(root, `tasks/${TASK_ID}/task.json`, JSON.stringify({
    run_id: TASK_ID, kind: 'task', cwd, request: 'Add a ledger export and a report page', size: 'L', created_at: NOW - 41 * MIN,
    store_path: join(dir, 'task.json'), spec: { packages }, nodes,
  }), 5000);
  const ev = (ts, o) => line({ ts: NOW - ts * MIN, task_id: TASK_ID, ...o });
  const reject = (ts, reason) => ev(ts, { event: 'verdict', node_id: 'accept:P1:1', stage: 'accept', subgoal_id: 'P1', actor: 'claude·opus', verdict: 'reject', score: 61, reason });
  write(root, `tasks/${TASK_ID}/ledger.jsonl`, [
    ev(30, { event: 'node_finish', node_id: 'critique', stage: 'critique', state: 'done' }),
    reject(19.5, 'footer not cleared'),
    ev(19, { event: 'daemon_retry_opened', package_id: 'P1', attempt: 2, reason: 'footer not cleared', failed_node: 'accept:P1:1' }),
    reject(18, 'footer still not cleared'),
    reject(17, 'footer cleared on one surface only'),
    ev(8, { event: 'asked', key: `E-c0ffee00/P2`, question: 'Which export format?' }),
  ].join('\n') + '\n', 10000);
  return { tasks, cwd, dir };
}

// Fixed words for the temp locations, so the fixture reads the same on every machine.
const tokenize = (value, root) => JSON.parse(JSON.stringify(value).split(root).join('<root>'));

// Builds the task under a temp dir and reads it through both paths at NOW; { teams, status, truth }.
function build() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pane-accuracy-')));
  const was = { dir: process.env.HARNESS_TASKS_DIR, now: Date.now };
  try {
    const { tasks, cwd } = writeTask(root);
    process.env.HARNESS_TASKS_DIR = tasks;
    // the --format teams path reads the clock itself (view-once, view-collect): pin it for both reads
    Date.now = () => NOW;
    const { wiki, ...status } = toolStatus({ task_id: TASK_ID });
    const once = (args) => JSON.parse(onceOutput({ task: TASK_ID, ...args }, tasks, null, undefined));
    const teams = once({ format: 'teams', cwd });
    // the pages the pane opens from it: the decisions timeline and each STORY's page
    const decisions = once({ format: 'decisions' });
    const story = { P1: once({ format: 'story', story: 'P1' }), P2: once({ format: 'story', story: 'P2' }) };
    const participants = Object.fromEntries(['P1', 'P2'].map((id) => [id, participantsOf(join(tasks, TASK_ID), id, [], { live: true })]));
    return {
      teams: tokenize(teams, root), status: tokenize(status, root), decisions: tokenize(decisions, root), story: tokenize(story, root),
      // what the fixture itself wrote: the model of each stream's init line, each dispatch's start, the Agent calls
      truth: { models: { P1: OPUS, P2: SONNET, judge: SONNET }, started_at: { P1: NOW - 6 * MIN, P2: NOW - 8 * MIN }, participants },
    };
  } finally {
    Date.now = was.now;
    if (was.dir === undefined) delete process.env.HARNESS_TASKS_DIR; else process.env.HARNESS_TASKS_DIR = was.dir;
    rmSync(root, { recursive: true, force: true });
  }
}

const fixtureSource = ({ teams, status, decisions, story }) => `// Generated by \`node teams/scripts/test-pane-accuracy.mjs --write\`; do not edit.
// A fictional L task (two packages, one re-judged, an opus and a sonnet driver) as the pane mounts on it:
// \`teams\` is \`view.mjs --once --format teams\`, \`status\` is tm_status, \`now\` is the clock both were read at;
// \`decisions\` is \`--format decisions\` and \`story\` is \`--format story\` per STORY (the pages the pane opens from it).
// Temp locations are written as <root>.
export const now = ${NOW};
export const teams = ${JSON.stringify(teams, null, 2)};
export const status = ${JSON.stringify(status, null, 2)};
export const decisions = ${JSON.stringify(decisions, null, 2)};
export const story = ${JSON.stringify(story, null, 2)};
`;

const fresh = build();
if (process.argv.includes('--write')) {
  writeFileSync(FIXTURE, fixtureSource(fresh));
  console.log(`wrote ${FIXTURE}`);
}
const fixture = await import(pathToFileURL(FIXTURE).href).catch(() => null);

test('the committed fixture equals a fresh build (run with --write to regenerate)', () => {
  assert.ok(fixture, 'fixtures/pane-accuracy.mjs is missing: node teams/scripts/test-pane-accuracy.mjs --write');
  assert.equal(fixture.now, NOW);
  assert.deepEqual(fixture.teams, fresh.teams);
  assert.deepEqual(fixture.status, fresh.status);
  assert.deepEqual(fixture.decisions, fresh.decisions);
  assert.deepEqual(fixture.story, fresh.story);
  assert.equal(fixtureSource(fresh), fixtureSource(fixture), 'the module text is what a build writes');
});

// ---------- the pane's figures equal tm_status ----------
const { teams, status, truth } = fresh;
const entry = teams.tasks.find((t) => t.task_id === TASK_ID);
const sum = (o) => Object.values(o).reduce((a, n) => a + (Number(n) || 0), 0);
// a STORY's dispatch and accept nodes are Build's; every other node its own stage (view-stages.mjs)
const phaseOf = (id) => stageOfNode(id) || (/^(dispatch|accept):/.test(id) ? 'build' : null);

test('the fixture task is listed, running, and its payload is the one the pane mounts on', () => {
  assert.ok(entry, 'the task is in tasks[]');
  assert.equal(teams.task.key, entry.key);
  assert.equal(entry.state, status.state);
  assert.equal(teams.task.state, status.state);
});

test('EPIC cost (to cents) and turns equal tm_status, on the summary row and the task header', () => {
  const cents = (n) => n.toFixed(2);
  assert.equal(cents(entry.cost.usd), cents(status.cost.usd));
  assert.equal(cents(teams.task.cost.usd), cents(status.cost.usd));
  assert.equal(entry.cost.turns, status.cost.turns);
  assert.equal(teams.task.cost.turns, status.cost.turns);
  for (const i of entry.items) assert.equal(cents(i.cost_usd), cents(status.package_costs.find((p) => p.id === i.key).cost_usd), `${i.key} cost`);
});

test('the status line counts equal tm_status counts by state (done of all nodes)', () => {
  const [, done, total] = teams.status.line.match(/(\d+)\/(\d+)/);
  assert.equal(Number(done), status.counts.done);
  assert.equal(Number(total), sum(status.counts));
  assert.equal(status.nodes.filter((n) => n.state === 'running').length, status.counts.running);
  assert.equal(status.nodes.filter((n) => n.state === 'pending').length, status.counts.pending);
});

test('per-package attempts (try) and STORY done/total equal tm_status', () => {
  for (const id of status.packages) {
    const attempts = status.nodes.filter((n) => n.node_id.startsWith(`dispatch:${id}:`)).length;
    assert.equal(entry.items.find((i) => i.key === id).try, attempts, `${id} attempts`);
  }
  const accepted = status.packages.filter((id) => status.nodes.some((n) => n.node_id.startsWith(`accept:${id}:`) && n.state === 'done'));
  assert.deepEqual([entry.done, entry.total], [accepted.length, status.packages.length]);
});

test('the running phase equals the phase of tm_status\'s running nodes', () => {
  const fromStatus = [...new Set(status.nodes.filter((n) => n.state === 'running').map((n) => phaseOf(n.node_id)))];
  const fromPane = entry.stages.filter((s) => s.state === 'running').map((s) => s.key);
  assert.deepEqual(fromPane, fromStatus);
  assert.ok(fromPane.every((k) => STAGE_KEYS.includes(k)));
});

// tm_status carries no model and no elapsed: these are checked against what the fixture wrote.
test('each worker\'s model is the model its stream\'s init line names; the judge too', () => {
  const by = Object.fromEntries(entry.workers.map((w) => [w.id, w]));
  for (const [id, model] of Object.entries(truth.models)) assert.equal(by[id].model, model, id);
  assert.notEqual(by.P1.model, by.P2.model, 'an opus and a sonnet desk are not read alike');
});

test('per-STORY elapsed is the fixed now minus the fixture\'s dispatch start', () => {
  for (const [id, at] of Object.entries(truth.started_at)) assert.equal(entry.items.find((i) => i.key === id).elapsed_ms, NOW - at, id);
});

test('a subagent call with no model input carries no model (it does not inherit its driver\'s)', () => {
  const p1 = truth.participants.P1;
  assert.equal(p1.source, 'stream');
  assert.deepEqual(p1.total.map((a) => [a.kind, a.model]).sort(), [['helper', 'sonnet'], ['reviewer', null]]);
  assert.deepEqual(p1.live.map((a) => [a.kind, a.model]), [['reviewer', null]], 'the answered call is not live');
  assert.equal(entry.workers.find((w) => w.id === 'P1').subagents, p1.live.reduce((n, a) => n + a.n, 0));
  assert.deepEqual(fresh.story.P1.participants.total.map((a) => a.model).sort(), ['sonnet', null].sort());
});

test('the workers say what they do in words: an activity key per worker, never a raw tool name, stage key or tool_progress', () => {
  const by = Object.fromEntries(entry.workers.map((w) => [w.id, w]));
  assert.deepEqual([by.P1.doing_key, by.P1.doing_vars], ['actTesting', { suite: 'teams suite' }]);
  assert.equal(by.P2.doing_key, 'actEngine');
  assert.equal(by.judge.doing_key, 'actJudging');
  const bad = new Set([...STAGE_KEYS, 'Bash', 'Edit', 'Write', 'Read', 'Grep', 'Glob', 'Agent', 'Task']);
  const seen = [];
  const walk = (o) => {
    if (o && typeof o === 'object') {
      if (o.doing_vars) for (const v of Object.values(o.doing_vars)) { assert.doesNotMatch(String(v), /tool_progress|mcp__/); assert.ok(!bad.has(String(v)), String(v)); seen.push(v); }
      for (const k in o) walk(o[k]);
    }
  };
  walk(teams);
  assert.ok(seen.length >= 3);
});

test('Handed over has no verdict; Decisions shows the three identical judgements once with times 3 and the newest reason', () => {
  const handed = Object.values(entry.phase_handoffs).flat();
  assert.ok(handed.every((h) => h.what_key !== 'handVerdict'), 'no verdict row in a Phase hand-off');
  assert.deepEqual(entry.phase_handoffs.build.map((h) => h.reason), ['Which export format?']);
  const verdicts = fresh.decisions.entries.filter((e) => e.kind === 'verdict');
  assert.equal(verdicts.length, 1);
  assert.deepEqual([verdicts[0].times, verdicts[0].reason], [3, 'footer cleared on one surface only']);
  assert.equal(fresh.decisions.entries.filter((e) => e.kind === 'retry').length, 1, 'the retry between them stays');
  assert.equal(entry.phases.find((p) => p.key === 'build').decisions, fresh.decisions.entries.filter((e) => e.phase === 'build').length, 'FLOOR\'s count is the collapsed list\'s');
});
