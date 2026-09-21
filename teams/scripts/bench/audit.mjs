#!/usr/bin/env node
// Post-hoc adversarial defect audit: what score.mjs's fixed criteria checklist cannot see.
// A single independent auditor, blind to which arm produced the tree, is asked to break it by
// running it - not by reading it - against the ORIGINAL request text. This is the number that
// actually measures an adversarial-verification flow's worth: defects that survived into the
// deliverable, not a criteria checklist plain `claude -p` and teams already tie on.
//
//   node audit.mjs <case> <workspace>
//
// Locates the deliverable tree exactly like score.mjs (via lib/tree.mjs, shared - never
// forked), copies it to a scratch dir stripped of harness/git bookkeeping, and runs one
// `claude -p` auditor over the copy with the request text and nothing about provenance.
// Writes <workspace>.audit.json and prints one summary line.
//
// GRAPH_BENCH_NO_JUDGE=1 or GRAPH_BENCH_NO_AUDIT=1 skips the claude call entirely (offline/CI):
// writes {"audit": "skipped"} and exits 0.
// GRAPH_BENCH_AUDIT_MODEL overrides the model (default: sonnet).
import { existsSync, readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveTree } from './lib/tree.mjs';
import { buildAuditPrompt } from './lib/audit-prompt.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const [CASE, WS_ARG] = process.argv.slice(2);
if (!CASE || !WS_ARG) { console.error('usage: audit.mjs <case> <workspace>'); process.exit(2); }
const WS = resolve(WS_ARG);
const LABEL = basename(WS);

const NO_AUDIT = process.env.GRAPH_BENCH_NO_JUDGE === '1' || process.env.GRAPH_BENCH_NO_AUDIT === '1';
const MODEL = process.env.GRAPH_BENCH_AUDIT_MODEL || 'sonnet';
const AUDIT_TIMEOUT_MS = 15 * 60 * 1000;

function writeResult(obj) {
  writeFileSync(`${WS}.audit.json`, JSON.stringify(obj, null, 2));
  return obj;
}

if (NO_AUDIT) {
  writeResult({ case: CASE, workspace: WS, audit: 'skipped' });
  console.log(`${LABEL} | audit: skipped`);
  process.exit(0);
}

// ---------- locate + copy the tree (same helper score.mjs uses; never forked) ----------
const TREE = resolveTree(WS);
if (!existsSync(TREE)) {
  writeResult({ case: CASE, workspace: WS, tree: TREE, audit_failed: `tree not found: ${TREE}` });
  console.log(`${LABEL} | audit_failed: tree not found: ${TREE}`);
  process.exit(0);
}

const STRIP = new Set(['.git', '.teams_output', '.harness-run', '.harness-tasks', 'node_modules']);
const scratch = mkdtempSync(join(tmpdir(), 'bench-audit-'));
const copyDir = join(scratch, 'tree');
try {
  cpSync(TREE, copyDir, {
    recursive: true,
    filter: (src) => {
      const name = basename(src);
      // Anything under the tree named `.harness*` (not only the literal `.harness-tasks`/
      // `.harness-run` dirs above) is bench/harness bookkeeping the auditor should not see or
      // be able to use as a hint about provenance.
      if (name.startsWith('.harness')) return false;
      return !STRIP.has(name);
    },
  });
} catch (err) {
  writeResult({ case: CASE, workspace: WS, tree: TREE, audit_failed: `copy failed: ${err.message}` });
  console.log(`${LABEL} | audit_failed: copy failed: ${err.message}`);
  rmSync(scratch, { recursive: true, force: true });
  process.exit(0);
}

// ---------- the original request, blind to which arm produced the tree ----------
const requestPath = join(SCRIPT_DIR, 'requests', `${CASE}.txt`);
const requestText = existsSync(requestPath) ? readFileSync(requestPath, 'utf8') : null;
if (!requestText) {
  writeResult({ case: CASE, workspace: WS, tree: TREE, audit_failed: `request text not found: ${requestPath}` });
  console.log(`${LABEL} | audit_failed: request text not found: ${requestPath}`);
  rmSync(scratch, { recursive: true, force: true });
  process.exit(0);
}
const prompt = buildAuditPrompt(requestText);

// ---------- run the auditor ----------
const env = { ...process.env }; delete env.CLAUDECODE;
const r = spawnSync('claude', [
  '-p', prompt,
  '--output-format', 'json',
  '--model', MODEL,
  '--dangerously-skip-permissions',
  '--setting-sources', 'project',
], { cwd: copyDir, encoding: 'utf8', timeout: AUDIT_TIMEOUT_MS, env });

rmSync(scratch, { recursive: true, force: true });

if (r.error || r.signal || r.status === null) {
  const reason = r.error ? r.error.message : r.signal ? `killed (${r.signal}, likely timeout)` : 'no exit status';
  writeResult({ case: CASE, workspace: WS, tree: TREE, model: MODEL, audit_failed: reason });
  console.log(`${LABEL} | audit_failed: ${reason}`);
  process.exit(0);
}

let outer, inner, cost_usd = null, duration_ms = null;
try {
  outer = JSON.parse(r.stdout);
  cost_usd = typeof outer.total_cost_usd === 'number' ? outer.total_cost_usd : null;
  duration_ms = typeof outer.duration_ms === 'number' ? outer.duration_ms : null;
  // The claude CLI's --output-format json wraps the model's answer as a string in `result`,
  // which may itself carry leading/trailing prose around the JSON object - same tolerant
  // extraction score.mjs's judge() uses, so the two never disagree on how to unwrap it.
  inner = JSON.parse(String(outer.result).replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
} catch (err) {
  writeResult({ case: CASE, workspace: WS, tree: TREE, model: MODEL, audit_failed: `parse failure: ${err.message}`, cost_usd, duration_ms });
  console.log(`${LABEL} | audit_failed: parse failure: ${err.message}`);
  process.exit(0);
}

// ---------- validate shape ----------
const defects = Array.isArray(inner.defects) ? inner.defects.filter((d) => d && typeof d === 'object') : [];
const validSeverities = new Set(['blocking', 'major', 'minor']);
const cleanDefects = defects.map((d, i) => ({
  id: typeof d.id === 'string' ? d.id : `D${i + 1}`,
  severity: validSeverities.has(d.severity) ? d.severity : 'minor',
  rule: typeof d.rule === 'string' ? d.rule : '',
  repro: typeof d.repro === 'string' ? d.repro : '',
  observed: typeof d.observed === 'string' ? d.observed : '',
  expected: typeof d.expected === 'string' ? d.expected : '',
}));
const defects_by_severity = { blocking: 0, major: 0, minor: 0 };
for (const d of cleanDefects) defects_by_severity[d.severity]++;
const checks_run = Array.isArray(inner.checks_run) ? inner.checks_run.filter((c) => typeof c === 'string') : [];
const tests = {
  pass: Number.isFinite(inner.tests?.pass) ? inner.tests.pass : null,
  fail: Number.isFinite(inner.tests?.fail) ? inner.tests.fail : null,
};
const notes = typeof inner.notes === 'string' ? inner.notes.slice(0, 300) : '';

const result = writeResult({
  case: CASE,
  workspace: WS,
  tree: TREE,
  model: MODEL,
  defects: cleanDefects,
  defects_by_severity,
  checks_run,
  tests,
  notes,
  cost_usd,
  duration_ms,
});

const min = duration_ms ? Math.round(duration_ms / 60000) : '?';
const cost = cost_usd != null ? cost_usd.toFixed(2) : '?';
console.log(`${LABEL} | defects=${cleanDefects.length} (blocking=${defects_by_severity.blocking} major=${defects_by_severity.major} minor=${defects_by_severity.minor}) | checks=${checks_run.length} | tests ${tests.pass ?? '?'}/${tests.fail ?? '?'} | audit $${cost} ${min}m`);
