#!/usr/bin/env node
// card 129 U3: the engine writes the QA report from the execute result when the driver did not.
//   node --test teams/scripts/test-qa-report.mjs
process.env.TEAMS_RUNS_DIR ??= 'off';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRun, expandSubgoals, getNode, normalizeSpec } from '../mcp/graph.mjs';
import { finishNode } from '../mcp/broker-independence.mjs';
import { qaReportPaths, renderQaReport, writeQaReport } from '../mcp/qa-report.mjs';
import { classifyFailure } from '../mcp/failure-kind.mjs';

const REPORT = 'test/qa/priority.md';
const DEFECTS = [
  { title: 'priority jumps the queue', severity: 'high', evidence: 'saw it', repro: { command: 'node repro-one.js', observed: 'late', expected: 'early' } },
  { title: 'ties reorder', evidence: 'flaky', repro: { command: 'node repro-two.js', observed: 'b,a', expected: 'a,b' } },
];
const RESULT = { stage_ok: true, verified: false, checks: ['case 1 -> ok', 'case 2 -> failed'], defects: DEFECTS, evidence: 'ran 2 cases' };

function scratch(fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'qa-report-'));
  try { return fn(cwd); } finally { rmSync(cwd, { recursive: true, force: true }); }
}

function qaRun(cwd, files = [REPORT], kind = 'qa') {
  const run = createRun({ cwd, request: 'r', flow: 'qa', vendor: 'self' });
  for (const id of ['plan', 'setgoal', 'critique']) { getNode(run, id).state = 'done'; getNode(run, id).result = { stage_ok: true }; }
  run.spec = normalizeSpec(run, { goal: 'g', acceptance: ['a'], subgoals: [{ id: 'Q1', kind, title: 'QA the priority mode', acceptance: ['covers ordering'], files, deps: [] }] });
  expandSubgoals(run, run.spec.subgoals);
  return run;
}

const put = (cwd, rel, text) => { mkdirSync(dirname(join(cwd, rel)), { recursive: true }); writeFileSync(join(cwd, rel), text); };
const exec = (run) => getNode(run, 'execute:Q1:1');

test('card129 U3.1 absent report is written with both defects and repro commands', () => scratch((cwd) => {
  const run = qaRun(cwd);
  const p = writeQaReport(run, exec(run), RESULT);
  assert.equal(p, join(cwd, REPORT));
  const text = readFileSync(p, 'utf8');
  for (const s of ['# QA report — Q1 QA the priority mode', '## Cases', 'case 2 -> failed', '## Defects', 'priority jumps the queue', 'ties reorder', 'node repro-one.js', 'node repro-two.js', '(high)', '## Evidence', 'ran 2 cases']) assert.ok(text.includes(s), s);
  assert.match(renderQaReport({ id: 'Q1', title: 't' }, { checks: [], defects: [] }), /## Defects\nnone/);
}));

test('card129 U3.2 a report the driver wrote is left byte-equal', () => scratch((cwd) => {
  const run = qaRun(cwd);
  put(cwd, REPORT, 'cases v1');
  finishNode(run, getNode(run, 'cases:Q1:1'), { stage_ok: true, changed_files: [REPORT] }, 'self');
  put(cwd, REPORT, 'the driver wrote its own results');
  assert.equal(writeQaReport(run, exec(run), RESULT), null);
  assert.equal(readFileSync(join(cwd, REPORT), 'utf8'), 'the driver wrote its own results');
  // no cases baseline at all: an existing file is never touched either
  const run2 = qaRun(cwd);
  assert.equal(writeQaReport(run2, exec(run2), RESULT), null);
  assert.equal(readFileSync(join(cwd, REPORT), 'utf8'), 'the driver wrote its own results');
}));

test('card129 U3.3 a non-qa subgoal writes nothing', () => scratch((cwd) => {
  const run = qaRun(cwd, [REPORT], 'subgoal');
  assert.deepEqual(qaReportPaths(run, 'Q1'), []);
  assert.equal(writeQaReport(run, { stage: 'execute', subgoal_id: 'Q1', attempt: 1 }, RESULT), null);
  assert.equal(existsSync(join(cwd, REPORT)), false);
}));

test('card129 U3.4 real chain: cases writes the file, execute is denied its write, finishNode appends the results', () => scratch((cwd) => {
  const run = qaRun(cwd);
  const CASES = '# case set\n- case 1\n- case 2\n';
  put(cwd, REPORT, CASES); // what the cases node wrote at the report path
  finishNode(run, getNode(run, 'cases:Q1:1'), { stage_ok: true, changed_files: [REPORT] }, 'self');
  const denied = { ...RESULT, changed_files: [], permission_denials: [{ tool_name: 'Write', tool_input: { file_path: join(cwd, REPORT) } }] };
  const n = exec(run);
  finishNode(run, n, denied, 'self');
  assert.equal(n.state, 'done');
  assert.deepEqual(n.result.engine_written, [join(cwd, REPORT)]);
  assert.deepEqual(n.result.changed_files, [REPORT], 'relative to the worktree');
  const text = readFileSync(join(cwd, REPORT), 'utf8');
  assert.ok(text.startsWith(CASES), 'the case set survives');
  assert.ok(text.includes('priority jumps the queue') && text.includes('node repro-two.js'));
  // from the empty-disk start too (cases never wrote): the file is created
  const run2 = qaRun(cwd, ['test/qa/other.md']);
  finishNode(run2, getNode(run2, 'cases:Q1:1'), { stage_ok: true }, 'self');
  finishNode(run2, exec(run2), RESULT, 'self');
  assert.ok(existsSync(join(cwd, 'test/qa/other.md')));
}));

test('card129 U3.4b the driver rewrote the report during execute: finishNode leaves it alone', () => scratch((cwd) => {
  const run = qaRun(cwd);
  put(cwd, REPORT, 'cases');
  finishNode(run, getNode(run, 'cases:Q1:1'), { stage_ok: true }, 'self');
  put(cwd, REPORT, 'cases + the driver results');
  const n = exec(run);
  finishNode(run, n, RESULT, 'self');
  assert.equal(n.result.engine_written, undefined);
  assert.equal(readFileSync(join(cwd, REPORT), 'utf8'), 'cases + the driver results');
}));

test('card129 U3.5 the denied write to the engine-written path is not an environment failure', () => scratch((cwd) => {
  const run = qaRun(cwd);
  const [path] = qaReportPaths(run, 'Q1');
  assert.equal(path, join(cwd, REPORT));
  const result = { ...RESULT, permission_denials: [{ tool_name: 'Write', tool_input: { file_path: path } }] };
  assert.notEqual(classifyFailure({}, {}, result, { engineWrittenPath: path }), 'environment');
  assert.equal(classifyFailure({}, {}, result), 'environment');
}));

test('card129 U3.6 paths outside run.cwd are dropped and nothing is written there', () => scratch((cwd) => {
  const outside = join(cwd, '..', `escape-${process.pid}.md`);
  const run = qaRun(cwd, ['../escape.md', outside]);
  assert.deepEqual(qaReportPaths(run, 'Q1'), []);
  assert.equal(writeQaReport(run, exec(run), RESULT), null);
  assert.equal(existsSync(join(cwd, '..', 'escape.md')), false);
  assert.equal(existsSync(outside), false);
}));
