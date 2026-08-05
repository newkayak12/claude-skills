#!/usr/bin/env node
// fallback-check — the objective done-signal for a Workflow-less fallback run (engine/fallback.md §7).
//
// Deterministically verifies that every stage of a fallback run actually wrote its artifact and
// that the artifact is non-degenerate. The orchestrator may only report a run as "done" once this
// prints COMPLETE. Missing/degenerate artifacts are named so the run can be resumed at that stage
// without redoing passed subgoals. This replaces the old sentinel/edit-gate: skipping a stage
// leaves its file absent, and that is detectable here rather than via a magic string in the
// transcript.
//
// Usage:   node harness/engine/fallback-check.mjs <RUN_DIR>
// Exit 0 + "COMPLETE"   → all required artifacts present and well-formed.
// Exit 1 + problem list → what is missing or degenerate (each on its own line, prefixed "- ").
// Exit 2                → usage / unreadable run directory (caller error, not a run verdict).

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RUN = process.argv[2];
if (!RUN) {
  process.stderr.write('usage: node fallback-check.mjs <RUN_DIR>\n');
  process.exit(2);
}
if (!existsSync(RUN) || !statSync(RUN).isDirectory()) {
  process.stderr.write(`run directory not found: ${RUN}\n`);
  process.exit(2);
}

const problems = [];
const p = (msg) => problems.push(msg);

const readText = (rel) => {
  try {
    return readFileSync(join(RUN, rel), 'utf8');
  } catch {
    return null;
  }
};
const readJson = (rel) => {
  const t = readText(rel);
  if (t == null) return { missing: true };
  try {
    return { value: JSON.parse(t) };
  } catch (e) {
    return { invalid: String(e && e.message) };
  }
};
const nonEmptyText = (rel, label) => {
  const t = readText(rel);
  if (t == null) p(`${label} missing (${rel})`);
  else if (t.trim().length < 10) p(`${label} degenerate — under 10 non-space chars (${rel})`);
};

// --- manifest ---
const man = readJson('manifest.json');
let subgoalIds = [];
if (man.missing) p('manifest.json missing');
else if (man.invalid) p(`manifest.json invalid JSON: ${man.invalid}`);
else {
  const m = man.value || {};
  if (!m.request || typeof m.request !== 'string') p('manifest.json: no request string');
  if (!Array.isArray(m.subgoals) || m.subgoals.length === 0) {
    p('manifest.json: subgoals[] empty — SetGoal ordering not recorded');
  } else {
    subgoalIds = m.subgoals.map((s) => (s && s.id) || s).filter(Boolean).map(String);
  }
}

// --- Plan ---
nonEmptyText('01-plan.md', 'Plan (01-plan.md)');

// --- SetGoal spec ---
const spec = readJson('02-goal-spec.json');
if (spec.missing) p('SetGoal spec missing (02-goal-spec.json)');
else if (spec.invalid) p(`02-goal-spec.json invalid JSON: ${spec.invalid}`);
else {
  const s = spec.value || {};
  if (!s.goal || typeof s.goal !== 'string' || s.goal.trim().length < 10)
    p('02-goal-spec.json: goal missing/too short');
  if (!Array.isArray(s.acceptance) || s.acceptance.length === 0)
    p('02-goal-spec.json: goal-level acceptance[] empty');
  if (!Array.isArray(s.subgoals) || s.subgoals.length === 0)
    p('02-goal-spec.json: subgoals[] empty');
  else if (subgoalIds.length === 0)
    subgoalIds = s.subgoals.map((x) => x && x.id).filter(Boolean).map(String);
  // placeholder-title guard (degenerate spec)
  const titles = (s.subgoals || []).map((x) => (x && x.title) || '');
  if (titles.some((t) => /^(tbd|todo|placeholder|title)\b/i.test(t.trim())))
    p('02-goal-spec.json: a subgoal has a placeholder title');
}

// --- per-subgoal results + test evidence ---
if (subgoalIds.length === 0) {
  p('no subgoal ids resolved — cannot verify subgoal stage');
} else {
  for (const id of subgoalIds) {
    const dir = join('subgoals', id);
    const res = readJson(join(dir, 'result.json'));
    if (res.missing) p(`subgoal ${id}: result.json missing (Implement→Test→Gate loop not closed)`);
    else if (res.invalid) p(`subgoal ${id}: result.json invalid JSON: ${res.invalid}`);
    else if (typeof (res.value || {}).passed !== 'boolean')
      p(`subgoal ${id}: result.json has no boolean "passed"`);
    // at least one test evidence file
    let hasTest = false;
    try {
      hasTest = readdirSync(join(RUN, dir)).some((f) => /^test-\d+\.json$/.test(f));
    } catch {
      /* dir missing → reported above via result.json */
    }
    if (!hasTest) p(`subgoal ${id}: no test-<n>.json evidence (independent Test never ran)`);
  }
}

// --- goal-level gate ---
const gg = readJson('04-goal-gate.json');
if (gg.missing) p('goal-level gate missing (04-goal-gate.json)');
else if (gg.invalid) p(`04-goal-gate.json invalid JSON: ${gg.invalid}`);
else if (typeof (gg.value || {}).match_pct !== 'number')
  p('04-goal-gate.json: no numeric match_pct');

// --- Report ---
nonEmptyText('05-report.md', 'Report (05-report.md)');

// --- verdict ---
if (problems.length === 0) {
  const passed = (() => {
    try {
      return JSON.parse(readText('04-goal-gate.json')).match_pct >= 90;
    } catch {
      return false;
    }
  })();
  process.stdout.write(`COMPLETE — all stage artifacts present. goal-gate ${passed ? 'PASS' : 'FAIL (<90)'}\n`);
  process.exit(0);
}
process.stdout.write('INCOMPLETE — the fallback run is missing or degenerate artifacts:\n');
for (const m of problems) process.stdout.write(`- ${m}\n`);
process.exit(1);
