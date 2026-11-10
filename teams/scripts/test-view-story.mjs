// The STORY page's and the STORY report's data: `view.mjs --once --format story|story-report --task <id> --story <Pn>`
// (lib/view-story.mjs). Card 125 F2 (F2-AC-44, 45, 46, 47, 49). Every fixture is a temp task dir.
//
//   node --test teams/scripts/test-view-story.mjs
process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node } from '../mcp/graph.mjs';
import { docPaths } from '../mcp/tickets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW = join(HERE, 'view.mjs');
const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); };
const jl = (events) => events.map((e) => JSON.stringify(e)).join('\n') + '\n';
const agentCall = (id, input) => JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'Agent', input }] } });
const taskCall = (id, input) => JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'Task', input }] } });
const answer = (id) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });

const INTEGRATED_PKG = { id: 'P1', title: 'story P1', deps: [], acceptance: ['a', 'b', 'c', 'd'] };

// An L task with STORY P1: `child` nodes, `streamLines` for its driver, `accept` (node fields) when it was judged.
function fixture({ nodes, streamLines = null, accept = null, ledger = [], extra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'view-story-'));
  const tasks = join(root, 'tasks');
  const id = 'aaaaaaaa-0001';
  const dir = join(tasks, id);
  const cwd = join(root, 'proj');
  const cdir = join(root, 'wt');
  mkdirSync(cwd, { recursive: true });
  const log = join(dir, 'drivers', 'dispatch_P1_1.stream.jsonl');
  if (streamLines) write(log, streamLines.join('\n') + '\n');
  write(join(cdir, '.teams_output', 'broker', 'runs', 'c-P1.json'), JSON.stringify({
    run_id: 'c-P1', flow: 'develop', max_retries: 2, spec: { subgoals: [{ id: 'U1', title: 'unit' }, { id: 'U2', title: 'unit 2' }] }, nodes,
  }));
  const tn = [node('size', 'size', [], { state: 'done' }), node('shape', 'shape', ['size'], { state: 'done' }), node('critique', 'critique', ['shape'], { state: 'done' }),
    node('dispatch:P1:1', 'dispatch', ['critique'], { subgoal_id: 'P1', state: accept ? 'done' : 'running', child: { run_id: 'c-P1', cwd: cdir, driver: { pid: process.pid, log, restarts: [] } } }),
    node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1', state: accept ? 'done' : 'pending', ...(accept || {}) })];
  const task = { run_id: id, kind: 'task', cwd, request: 'r', created_at: Date.now(), store_path: join(dir, 'task.json'), spec: { packages: [INTEGRATED_PKG] }, nodes: tn, ...extra };
  write(join(dir, 'task.json'), JSON.stringify(task));
  write(join(dir, 'ledger.jsonl'), jl(ledger));
  return { root, tasks, id, dir, cwd, task, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const run = (f, format, story = 'P1', ...more) => {
  const r = spawnSync(process.execPath, [VIEW, '--once', '--format', format, '--tasks-dir', f.tasks, '--task', f.id, '--story', story, ...more], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const json = (f, format, story) => JSON.parse(run(f, format, story));

const CHILD = [
  node('plan', 'plan', [], { state: 'done' }), node('setgoal', 'setgoal', ['plan'], { state: 'done' }), node('critique', 'critique', ['setgoal'], { state: 'done' }),
  node('implement:U1:1', 'implement', ['critique'], { state: 'done', subgoal_id: 'U1', executor: 'claude', model: 'opus' }),
  node('test:U1:1', 'test', ['implement:U1:1'], { state: 'done', subgoal_id: 'U1', executor: 'codex', model: 'gpt' }),
  node('gate:U1:1', 'gate', ['test:U1:1'], { state: 'failed', subgoal_id: 'U1', result: { match_pct: 61, reason: 'footer not cleared' } }),
  node('implement:U1:2', 'implement', ['gate:U1:1'], { state: 'running', subgoal_id: 'U1', executor: 'claude', model: 'opus' }),
  node('test:U1:2', 'test', ['implement:U1:2'], { state: 'pending', subgoal_id: 'U1' }),
  node('gate:U1:2', 'gate', ['test:U1:2'], { state: 'pending', subgoal_id: 'U1' }),
];

test('F2-AC-48: summary phases[].decisions equals the entries --format decisions tags with that Phase (one function)', () => {
  const ledger = [
    { ts: 1, event: 'verdict', node_id: 'accept:P1:1', subgoal_id: 'P1', actor: 'claude·opus', verdict: 'reject', score: 61, reason: 'gap' },
    { ts: 2, event: 'tm_submit_human', node_id: 'critique', answer: 'ok' },
  ];
  const decisions = [{ question: 'a', chose: 'b', decided_in: 'P1' }, { question: 'c', chose: 'd', decided_in: 'qa' }, { question: 'e', chose: 'f', decided_in: 'EPIC' }];
  const f = fixture({ nodes: CHILD, ledger, extra: { decisions } });
  try {
    const r = spawnSync(process.execPath, [VIEW, '--once', '--format', 'summary', '--tasks-dir', f.tasks, '--cwd', f.cwd], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const tasks = JSON.parse(r.stdout).tasks;
    assert.equal(tasks.length, 1, 'the fixture task is listed');
    const entries = JSON.parse(run(f, 'decisions')).entries;
    assert.deepEqual(tasks[0].phases.map((p) => p.key), ['plan', 'build', 'integrate', 'qa', 'gate', 'report']);
    for (const p of tasks[0].phases) assert.equal(p.decisions, entries.filter((e) => e.phase === p.key).length, p.key);
    const by = Object.fromEntries(tasks[0].phases.map((p) => [p.key, p.decisions]));
    assert.deepEqual([by.plan, by.build, by.qa], [2, 2, 1]);
  } finally { f.cleanup(); }
});

test('F2-AC-44: the STORY payload has FLOW states, node progress, the attempt grid and the live workers', () => {
  const f = fixture({ nodes: CHILD, streamLines: [agentCall('t1', { subagent_type: 'reviewer', model: 'opus' })] });
  try {
    const p = json(f, 'story');
    assert.equal(p.story, 'P1');
    assert.equal(p.title, 'story P1');
    // FLOW of the current try (attempt 2): plan, setgoal, critique done; implement running; test and gate not started
    assert.deepEqual(p.flow, [['plan', 'done'], ['setgoal', 'done'], ['critique', 'done'], ['implement', 'running'], ['test', 'pending'], ['gate', 'pending']].map(([key, state]) => ({ key, state })));
    // this try: the three run-level nodes and attempt 2's three; total: all nine
    assert.deepEqual(p.progress, { try_done: 3, try_total: 6, total_done: 5, total_all: 9 });
    // the grid: attempt 1's gate failed with its score and reason; attempt 2 has no gate result yet
    assert.deepEqual(p.grid.stages, ['plan', 'setgoal', 'critique', 'implement', 'test', 'gate']);
    assert.equal(p.grid.attempts.length, 2);
    const g1 = p.grid.attempts[0].cells;
    assert.equal(g1.gate.state, 'failed');
    assert.equal(g1.gate.score, 61);
    assert.equal(g1.gate.reason, 'footer not cleared');
    assert.equal(g1.plan.state, 'done', 'a run-level node sits in attempt 1');
    assert.equal(p.grid.attempts[1].cells.plan, null);
    assert.equal(p.grid.attempts[1].cells.implement.state, 'running');
    // the live workers: this STORY's desk and the judge, from the floor's workers[]
    assert.deepEqual(p.workers.map((w) => w.id), ['P1', 'judge']);
    assert.equal(p.workers[0].state, 'acting');
    assert.equal('minutes' in p.workers[0], false);
  } finally { f.cleanup(); }
});

test('F2-AC-44: participants come from the driver streams (Agent and Task calls, unanswered = live), cached by mtime', () => {
  const f = fixture({ nodes: CHILD, streamLines: [
    agentCall('a1', { subagent_type: 'reviewer', model: 'opus' }), answer('a1'),
    agentCall('a2', { subagent_type: 'reviewer', model: 'opus' }),
    taskCall('a3', { description: 'x' }),
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: {} }] } }),
  ] });
  try {
    const p = json(f, 'story').participants;
    assert.equal(p.source, 'stream');
    assert.deepEqual(p.total, [{ kind: 'reviewer', model: 'opus', n: 2 }, { kind: 'agent', model: 'claude-opus-5-5', n: 1 }]);
    assert.deepEqual(p.live, [{ kind: 'agent', model: 'claude-opus-5-5', n: 1 }, { kind: 'reviewer', model: 'opus', n: 1 }]);
    // a restart's stream of the same desk joins it
    write(join(f.dir, 'drivers', 'dispatch_P1_1.restart1.stream.jsonl'), agentCall('c1', { subagent_type: 'planner', model: 'sonnet' }) + '\n');
    assert.equal(json(f, 'story').participants.total.reduce((a, r) => a + r.n, 0), 4);
  } finally { f.cleanup(); }
});

test('F2-AC-44: with no subagent call in any stream, participants fall back to the child nodes\' executor and model', () => {
  const f = fixture({ nodes: CHILD, streamLines: [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } })] });
  try {
    const p = json(f, 'story').participants;
    assert.equal(p.source, 'nodes');
    assert.deepEqual(p.total, [{ kind: 'claude', model: 'opus', n: 2 }, { kind: 'codex', model: 'gpt', n: 1 }]);
    assert.deepEqual(p.live, [{ kind: 'claude', model: 'opus', n: 1 }]);
  } finally { f.cleanup(); }
  const none = fixture({ nodes: [node('plan', 'plan', [], { state: 'pending' })] });
  try { assert.equal(json(none, 'story').participants.source, 'none'); } finally { none.cleanup(); }
});

test('F2-AC-45: the Log rows come from the ledger events that carry this STORY\'s node ids', () => {
  const T = Date.UTC(2026, 0, 1, 9, 0, 0);
  const f = fixture({ nodes: CHILD, ledger: [
    { ts: T, event: 'child_driver_spawned', node_id: 'dispatch:P1:1' },
    { ts: T + 1000, event: 'verdict', node_id: 'accept:P1:1', subgoal_id: 'P1', attempt: 1, verdict: 'reject', score: 61, reason: 'footer not cleared' },
    { ts: T + 2000, event: 'node_finish', node_id: 'size', state: 'done' },
  ] });
  try {
    const log = json(f, 'story').log;
    assert.deepEqual(log.map((r) => r.what_key), ['F2.log.criteria', 'F2.log.subgoals', 'F2.log.attemptStart', 'F2.log.attemptReject']);
    assert.deepEqual(log[0].numbers, { n: 4 });
    assert.deepEqual(log[1].numbers, { n: 2 });
    assert.deepEqual(log[3].numbers.score, 61);
    assert.equal(log[3].note, 'footer not cleared');
  } finally { f.cleanup(); }
});

test('F2-AC-46, 47: story-report is {finished, text, sections}; finished:false before the accept node, and nothing is faked', () => {
  const f = fixture({ nodes: CHILD });
  try {
    const p = json(f, 'story-report');
    assert.equal(p.finished, false);
    assert.equal(p.text, '');
    assert.deepEqual(Object.keys(p).sort(), ['finished', 'sections', 'story', 'task_id', 'text']);
    assert.ok(p.sections.every((s) => ['result', 'verdict', 'files', 'decisions', 'left', 'seeLog'].includes(s.key)));
    assert.match(run(f, 'story-report', 'P1', '--text'), /not available yet/);
  } finally { f.cleanup(); }
});

test('F2-AC-46: a finished STORY: text is the doc file as written, sections carry the data in both', () => {
  const accept = { result: { accept: true, match_pct: 91, reason: 'all criteria met', gaps: ['a gap'], scoped_out: [{ gap: 'later', belongs_to: 'P2' }] } };
  const f = fixture({ nodes: CHILD, accept, extra: { decisions: [{ question: 'cents or dollars?', chose: 'cents', decided_in: 'P1', source: 'ask' }], goal_threshold: 80 } });
  try {
    const file = docPaths(f.task).story('P1');
    write(file, '# P1 as written\n\nresult: all good\n');
    const p = json(f, 'story-report');
    assert.equal(p.finished, true);
    assert.equal(p.text, readFileSync(file, 'utf8'));
    const by = Object.fromEntries(p.sections.map((s) => [s.key, s.lines]));
    assert.deepEqual(by.verdict.slice(0, 4), ['score=91', 'threshold=80', 'attempt=1', 'max=']);
    // the same verdict as numbers, so a pane parses no key=value line (null where the engine has none)
    assert.deepEqual(p.verdict, { score: 91, threshold: 80, attempt: 1, max: null });
    assert.deepEqual(by.left, ['later (belongs to P2)', 'a gap']);
    assert.deepEqual(by.decisions, ['cents or dollars?: cents']);
    assert.deepEqual(by.seeLog.length, 2);
    assert.equal(run(f, 'story-report', 'P1', '--text'), readFileSync(file, 'utf8'));
  } finally { f.cleanup(); }
});

test('F2-AC-46: a finished STORY whose doc file is gone is rendered from the same data', () => {
  const f = fixture({ nodes: CHILD, accept: { result: { accept: true, match_pct: 91, reason: 'done' } } });
  try {
    const p = json(f, 'story-report');
    assert.equal(p.finished, true);
    assert.match(p.text, /P1/);
  } finally { f.cleanup(); }
});

test('an unknown STORY or task answers missing, as JSON and as text', () => {
  const f = fixture({ nodes: CHILD });
  try {
    assert.deepEqual(json(f, 'story', 'P9'), { task_id: f.id, story: 'P9', missing: true });
    assert.equal(run(f, 'story', 'P9', '--text'), 'no such STORY\n');
    const r = spawnSync(process.execPath, [VIEW, '--once', '--format', 'story', '--tasks-dir', f.tasks, '--task', 'nope', '--story', 'P1'], { encoding: 'utf8' });
    assert.equal(JSON.parse(r.stdout).missing, true);
    assert.equal(json(f, 'story-report', 'P9').finished, false);
  } finally { f.cleanup(); }
});

test('story: no use of metrics.drivers.stalled or taskStalled', () => {
  assert.ok(!/metrics\.drivers\.stalled|taskStalled/.test(readFileSync(join(HERE, 'lib', 'view-story.mjs'), 'utf8')));
});
