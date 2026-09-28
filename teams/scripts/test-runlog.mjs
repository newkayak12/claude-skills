// mcp/runlog.mjs: every teams task keeps a record at daemon_done, bench or not - the task dir
// lives wherever HARNESS_TASKS_DIR says, not under the project, and TEAMS_RUNS_DIR=off turns it off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harvestTask } from '../mcp/runlog.mjs';

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'runlog-proj-'));
  const tasks = mkdtempSync(join(tmpdir(), 'runlog-tasks-'));
  const td = join(tasks, 'abcdef12-0000-0000-0000-000000000000');
  mkdirSync(join(td, 'drivers'), { recursive: true });
  writeFileSync(join(td, 'task.json'), JSON.stringify({ run_id: 'abcdef12', cwd, size: 'L', spec: { packages: [{ id: 'P1' }] }, nodes: [
    { node_id: 'integrate:1', stage: 'integrate', state: 'failed', result: { verified: false, gaps: ['cli cannot import report'] } }] }));
  writeFileSync(join(td, 'ledger.jsonl'), `${JSON.stringify({ ts: Date.now(), event: 'tm_open' })}\n${JSON.stringify({ ts: Date.now(), event: 'daemon_done', state: 'blocked' })}\n`);
  mkdirSync(join(cwd, '.teams_output', 'team', 'E-abcdef12'), { recursive: true });
  writeFileSync(join(cwd, '.teams_output', 'team', 'E-abcdef12', '80-report.md'), '# report\n');
  return { cwd, tasks, td };
}

test('a task outside any bench keeps its record under <project>-<task id>, docs included', () => {
  const { cwd, tasks, td } = fixture();
  const root = mkdtempSync(join(tmpdir(), 'runlog-root-'));
  try {
    const r = harvestTask({ taskDir: td, cwd, root });
    assert.match(r.summary.label, /^runlog-proj-.*-abcdef12$/);
    assert.equal(r.summary.source, 'run');
    assert.equal(r.summary.state, 'blocked');
    assert.deepEqual(r.summary.failures.map((f) => f.kind), ['integrate-refused']);
    assert.ok(existsSync(join(r.out, 'docs', '80-report.md')));
    assert.match(readFileSync(join(root, 'index.jsonl'), 'utf8'), /abcdef12/);
  } finally { for (const d of [cwd, tasks, root]) rmSync(d, { recursive: true, force: true }); }
});

test('TEAMS_RUNS_DIR=off keeps nothing', () => {
  const { cwd, tasks, td } = fixture();
  const prev = process.env.TEAMS_RUNS_DIR;
  process.env.TEAMS_RUNS_DIR = 'off';
  try { assert.equal(harvestTask({ taskDir: td, cwd }), null); }
  finally { if (prev === undefined) delete process.env.TEAMS_RUNS_DIR; else process.env.TEAMS_RUNS_DIR = prev; for (const d of [cwd, tasks]) rmSync(d, { recursive: true, force: true }); }
});

test('slack-list: a goal gate that accepted with spec drift is recorded, though nothing failed', () => {
  const { cwd, tasks, td } = fixture();
  const root = mkdtempSync(join(tmpdir(), 'runlog-root-'));
  try {
    const runs = join(cwd, '.teams_output', 'broker', 'runs');
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, 'r.json'), JSON.stringify({ run_id: 'r', nodes: [{ node_id: 'gate:goal:2', stage: 'gate', state: 'done', result: { accept: true, spec_drift: ['labelled links lose their URL'] } }] }));
    const r = harvestTask({ taskDir: td, cwd, root });
    const d = r.summary.failures.find((f) => f.kind === 'drift-accepted');
    assert.ok(d && /URL/.test(d.message));
  } finally { for (const x of [cwd, tasks, root]) rmSync(x, { recursive: true, force: true }); }
});

// portfolio-refresh-80ec931a (2026-09-28, teams 0.34.0): archive summary.json read cost_by_kind
// summing to $19.77 against a cost_usd of $28.26 - the $8.49 gap was every child graph run's own
// node adapter session (review/gate/plan/... under broker/<run_id>/<node>/<attempt>/events.jsonl),
// which collectTaskCosts already folds into cost_usd (nodes_usd) but the byKind loop here read
// only costs.streams (driver sessions), never costs.node_streams. Fixture shaped like that run:
// a package driver + a judge driver (bucketed today) plus a child run's own review/gate node
// sessions (not bucketed before this fix).
test('cost_by_kind buckets node adapter sessions too, so it sums to cost_usd (portfolio-refresh-80ec931a gap)', () => {
  const { cwd, tasks, td } = fixture();
  const root = mkdtempSync(join(tmpdir(), 'runlog-root-'));
  const wt = mkdtempSync(join(tmpdir(), 'runlog-wt-'));
  try {
    writeFileSync(join(td, 'drivers', 'dispatch_P1_1.stream.jsonl'), `${JSON.stringify({ type: 'result', total_cost_usd: 2, num_turns: 4 })}\n`);
    writeFileSync(join(td, 'drivers', 'judge_accept_P1_1.stream.jsonl'), `${JSON.stringify({ type: 'result', total_cost_usd: 0.5, num_turns: 1 })}\n`);
    for (const [nodeDir, cost] of [['review_U1_1', 1.2], ['gate_U1_1', 0.3]]) {
      const d = join(wt, '.teams_output', 'broker', 'child-1', nodeDir, 'att-1');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'events.jsonl'), `${JSON.stringify({ type: 'result', total_cost_usd: cost, num_turns: 1 })}\n`);
    }
    const task = JSON.parse(readFileSync(join(td, 'task.json'), 'utf8'));
    task.nodes.push({ node_id: 'dispatch:P1:1', stage: 'dispatch', subgoal_id: 'P1', state: 'done', child: { cwd: wt, run_id: 'child-1' } });
    writeFileSync(join(td, 'task.json'), JSON.stringify(task));

    const r = harvestTask({ taskDir: td, cwd, root });
    assert.equal(r.summary.cost_usd, 4.0);
    assert.deepEqual(r.summary.cost_by_kind, { dispatch_package: 2, judge_accept: 0.5, node_review: 1.2, node_gate: 0.3 });
    const bucketed = Object.values(r.summary.cost_by_kind).reduce((a, v) => a + v, 0);
    assert.equal(+bucketed.toFixed(4), r.summary.cost_usd, 'cost_by_kind must sum to the same total cost_usd reports');
  } finally { for (const x of [cwd, tasks, root, wt]) rmSync(x, { recursive: true, force: true }); }
});

// Same run: budget_usd 25, budget_stopped fired at spend $25.18 (the in-flight QA:2 child was
// already running and enforceBudget never kills a running dispatch), then the goal gate got
// rewired and the report ran to close the task - both mandatory closing stages - landing at
// cost_usd $28.26. That $3.08 post-stop spend is by design (closeStoppedToReport), but until now
// was invisible outside diffing cost_usd against ledger.jsonl's budget_stopped.spend by hand.
test('a budget-stopped task surfaces post_stop_usd: what the in-flight package plus goal-gate/report spent after the stop', () => {
  const { cwd, tasks, td } = fixture();
  const root = mkdtempSync(join(tmpdir(), 'runlog-root-'));
  try {
    writeFileSync(join(td, 'drivers', 'dispatch_QA_2.stream.jsonl'), `${JSON.stringify({ type: 'result', total_cost_usd: 25.1771, num_turns: 10 })}\n`);
    writeFileSync(join(td, 'drivers', 'judge_gate_goal_1.stream.jsonl'), `${JSON.stringify({ type: 'result', total_cost_usd: 2.3939, num_turns: 2 })}\n`);
    writeFileSync(join(td, 'drivers', 'judge_report.stream.jsonl'), `${JSON.stringify({ type: 'result', total_cost_usd: 0.69, num_turns: 1 })}\n`);
    const task = JSON.parse(readFileSync(join(td, 'task.json'), 'utf8'));
    task.team = { opts: { budget_usd: 25 } };
    task.budget_stopped = { at: Date.now(), spend: 25.1771, elapsed_minutes: 56, budget_usd: 25, timebox_minutes: null, skipped_packages: [] };
    writeFileSync(join(td, 'task.json'), JSON.stringify(task));

    const r = harvestTask({ taskDir: td, cwd, root });
    assert.equal(r.summary.cost_usd, 28.261);
    assert.equal(r.summary.budget.stopped, true);
    assert.equal(r.summary.budget.post_stop_usd, 3.0839, 'cost_usd minus the spend already recorded at budget_stopped');
  } finally { for (const x of [cwd, tasks, root]) rmSync(x, { recursive: true, force: true }); }
});

test('an unstopped task carries no post_stop_usd', () => {
  const { cwd, tasks, td } = fixture();
  const root = mkdtempSync(join(tmpdir(), 'runlog-root-'));
  try {
    const task = JSON.parse(readFileSync(join(td, 'task.json'), 'utf8'));
    task.team = { opts: { budget_usd: 25 } };
    writeFileSync(join(td, 'task.json'), JSON.stringify(task));
    const r = harvestTask({ taskDir: td, cwd, root });
    assert.equal(r.summary.budget.stopped, false);
    assert.equal('post_stop_usd' in r.summary.budget, false);
  } finally { for (const x of [cwd, tasks, root]) rmSync(x, { recursive: true, force: true }); }
});
