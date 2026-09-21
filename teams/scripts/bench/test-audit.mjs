// Unit tests for audit.mjs: the post-hoc adversarial defect audit. audit.mjs itself cannot be
// imported directly (running it drives a whole audit pass as a top-level side effect, same
// reason score.mjs is tested by spawning it - see test-score.mjs's header), so these spawn the
// script as a subprocess against tiny fixture workspaces, with a stubbed `claude` on PATH
// standing in for the real CLI (see stubClaudePath below, same technique test-score.mjs uses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTree, integrationTree } from './lib/tree.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function runAudit(caseName, ws, extraEnv = {}) {
  const r = spawnSync('node', [join(HERE, 'audit.mjs'), caseName, ws],
    { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...extraEnv } });
  return { out: (r.stdout || '') + (r.stderr || ''), status: r.status };
}

// A fake `claude -p ... --output-format json <prompt>` that ignores its input and always
// returns the same audit response, in a fresh directory prepended to PATH - same technique
// test-score.mjs's stubClaudePath uses for judge()-backed criteria.
function stubClaudePath(responseJson, { asPlainText = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'claude-audit-stub-'));
  const script = join(dir, 'claude');
  const resultField = asPlainText ? responseJson : JSON.stringify(responseJson);
  const outer = JSON.stringify({ result: resultField, total_cost_usd: 0.02, duration_ms: 12345 });
  writeFileSync(script, `#!/bin/sh\ncat <<'STUBEOF'\n${outer}\nSTUBEOF\n`);
  chmodSync(script, 0o755);
  return dir;
}

function flatWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), 'audit-flat-'));
  writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'x', type: 'module' }));
  writeFileSync(join(ws, 'stream.jsonl'), '');
  return ws;
}

function betaWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), 'audit-beta-'));
  const integ = join(ws, '.harness-tasks', 'task1', 'worktrees', 'integration');
  mkdirSync(integ, { recursive: true });
  writeFileSync(join(integ, 'package.json'), JSON.stringify({ name: 'x', type: 'module' }));
  writeFileSync(join(integ, 'README.md'), '# built in the integration worktree\n');
  // A sibling per-package worktree, to prove the finder does not just grab the first dir under
  // worktrees/ - it must pick the one whose name starts with "integration".
  mkdirSync(join(ws, '.harness-tasks', 'task1', 'worktrees', 'P1'), { recursive: true });
  writeFileSync(join(ws, 'package.json'), JSON.stringify({ name: 'outer-stub' })); // not the deliverable
  return ws;
}

// ---------- lib/tree.mjs: the shared tree-finder, unit-tested directly ----------

test('resolveTree: a flat plain workspace (no .harness-tasks) resolves to the workspace itself', () => {
  const ws = flatWorkspace();
  try {
    assert.equal(integrationTree(ws), null);
    assert.equal(resolveTree(ws), ws);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('resolveTree: a beta workspace resolves to .harness-tasks/<id>/worktrees/integration, not a sibling per-package worktree', () => {
  const ws = betaWorkspace();
  try {
    const expected = join(ws, '.harness-tasks', 'task1', 'worktrees', 'integration');
    assert.equal(integrationTree(ws), expected);
    assert.equal(resolveTree(ws), expected);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

// ---------- audit.mjs end-to-end, against the stub ----------

test('audit.mjs: GRAPH_BENCH_NO_JUDGE=1 skips the claude call and writes {audit: "skipped"}', () => {
  const ws = flatWorkspace();
  try {
    const { out, status } = runAudit('seam-silent', ws, { GRAPH_BENCH_NO_JUDGE: '1' });
    assert.equal(status, 0);
    assert.match(out, /audit: skipped/);
    const audit = JSON.parse(readFileSync(`${ws}.audit.json`, 'utf8'));
    assert.equal(audit.audit, 'skipped');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('audit.mjs: GRAPH_BENCH_NO_AUDIT=1 also skips (alias)', () => {
  const ws = flatWorkspace();
  try {
    const { out, status } = runAudit('seam-silent', ws, { GRAPH_BENCH_NO_AUDIT: '1' });
    assert.equal(status, 0);
    assert.match(out, /audit: skipped/);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('audit.mjs: a valid JSON response from the auditor is parsed into audit.json with counted severities', () => {
  const ws = flatWorkspace();
  const stub = stubClaudePath({
    defects: [
      { id: 'D1', severity: 'blocking', rule: 'exit code must be 2 on PARSE_ERROR', repro: 'lintcfg check bad.cfg', observed: 'exit 1', expected: 'exit 2' },
      { id: 'D2', severity: 'minor', rule: 'README documents every exit code', repro: 'grep BAD_TYPE README.md', observed: 'no match', expected: 'a match' },
    ],
    checks_run: ['node --test -> 5 pass, 0 fail', 'lintcfg check bad.cfg -> exit 1'],
    tests: { pass: 5, fail: 0 },
    notes: 'core behavior mostly correct',
  });
  try {
    const { out, status } = runAudit('seam-silent', ws, { PATH: `${stub}:${process.env.PATH}` });
    assert.equal(status, 0);
    assert.match(out, /defects=2 \(blocking=1 major=0 minor=1\)/);
    assert.match(out, /checks=2/);
    assert.match(out, /tests 5\/0/);
    const audit = JSON.parse(readFileSync(`${ws}.audit.json`, 'utf8'));
    assert.equal(audit.case, 'seam-silent');
    assert.equal(audit.defects.length, 2);
    assert.deepEqual(audit.defects_by_severity, { blocking: 1, major: 0, minor: 1 });
    assert.equal(audit.checks_run.length, 2);
    assert.equal(audit.tests.pass, 5);
    assert.equal(audit.tests.fail, 0);
    assert.equal(audit.model, 'sonnet');
    assert.equal(typeof audit.cost_usd, 'number');
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(stub, { recursive: true, force: true }); }
});

test('audit.mjs: an unknown severity is coerced to minor rather than dropped or crashing', () => {
  const ws = flatWorkspace();
  const stub = stubClaudePath({
    defects: [{ id: 'D1', severity: 'catastrophic', rule: 'r', repro: 'x', observed: 'y', expected: 'z' }],
    checks_run: [], tests: { pass: 1, fail: 0 }, notes: '',
  });
  try {
    runAudit('seam-silent', ws, { PATH: `${stub}:${process.env.PATH}` });
    const audit = JSON.parse(readFileSync(`${ws}.audit.json`, 'utf8'));
    assert.equal(audit.defects[0].severity, 'minor');
    assert.equal(audit.defects_by_severity.minor, 1);
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(stub, { recursive: true, force: true }); }
});

test('audit.mjs: a malformed (non-JSON) result writes audit_failed and exits 0', () => {
  const ws = flatWorkspace();
  const stub = stubClaudePath('this is not json at all, just prose from a confused model', { asPlainText: true });
  try {
    const { out, status } = runAudit('seam-silent', ws, { PATH: `${stub}:${process.env.PATH}` });
    assert.equal(status, 0);
    assert.match(out, /audit_failed/);
    const audit = JSON.parse(readFileSync(`${ws}.audit.json`, 'utf8'));
    assert.ok(audit.audit_failed);
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(stub, { recursive: true, force: true }); }
});

test('audit.mjs: a missing request file for the case writes audit_failed and exits 0', () => {
  const ws = flatWorkspace();
  try {
    const { out, status } = runAudit('no-such-case-xyz', ws, {});
    assert.equal(status, 0);
    assert.match(out, /audit_failed: request text not found/);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('audit.mjs: locates the integration worktree for a beta-arm workspace, not the outer workspace root', () => {
  const ws = betaWorkspace();
  const stub = stubClaudePath({ defects: [], checks_run: ['node --test -> 0 pass'], tests: { pass: 0, fail: 0 }, notes: '' });
  try {
    runAudit('seam-silent', ws, { PATH: `${stub}:${process.env.PATH}` });
    const audit = JSON.parse(readFileSync(`${ws}.audit.json`, 'utf8'));
    assert.equal(audit.tree, join(ws, '.harness-tasks', 'task1', 'worktrees', 'integration'));
  } finally { rmSync(ws, { recursive: true, force: true }); rmSync(stub, { recursive: true, force: true }); }
});
