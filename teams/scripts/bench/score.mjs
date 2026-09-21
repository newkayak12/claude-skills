#!/usr/bin/env node
// Score one bench workspace: what the arm left behind, plus what the session cost.
//
//   node score.mjs <case> <workspace> [stream.jsonl]
//     case  code | docs | code-flat | docs-flat   (see bench.sh)
//
// The tree that is judged is the integrated one when the arm produced a task
// (<ws>/.harness-tasks/*/worktrees/integration*), else the workspace itself. Static criteria
// look at files; executed criteria run `node --test` and, for code, the CLI on a sample.
// The docs cases have one LLM-judged criterion (`accuracy`: haiku reads the source and the
// reference docs); GRAPH_BENCH_JUDGE=0 skips it. Writes <ws>.score.json and prints one row.
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync, mkdtempSync, statSync, realpathSync } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CHECK_ALLOW, splitCheck, claimedExit, impliesFailure, hasPlaceholder, isContentShowCmd, splitSlashCmd, fencedBlocksByLang, neededInputTokens, parseRequirements, requirementCovered, majorityVote } from './lib/claims.mjs';
import { collectDriverCosts } from './lib/drivercost.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

const [CASE, WS_ARG, STREAM] = process.argv.slice(2);
if (!CASE || !WS_ARG) { console.error('usage: score.mjs <code|docs|code-flat|docs-flat|seam|seam-flat|goal-*> <workspace> [stream.jsonl]'); process.exit(2); }
const WS = resolve(WS_ARG);
const GOAL = CASE.startsWith('goal-');
const SEAM = CASE === 'seam' || CASE === 'seam-flat';
const KIND = /code/.test(CASE) ? 'code' : 'docs';
const MONO = !CASE.endsWith('-flat');

const env = { ...process.env }; delete env.CLAUDECODE;
const sh = (cmd, args, cwd, input, timeoutMs = 300_000) => {
  const r = spawnSync(cmd, args, { cwd, input, encoding: 'utf8', timeout: timeoutMs, env });
  return { code: r.status ?? -1, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', signal: r.signal || null, error: r.error || null };
};
// A check/README-example claim is a shell one-liner, not an argv array: run it through a shell.
const shCmd = (cmdline, cwd, timeoutMs = 60_000) => {
  const r = spawnSync('/bin/sh', ['-c', cmdline], { cwd, encoding: 'utf8', timeout: timeoutMs, env });
  return { code: r.status ?? -1, out: (r.stdout || '') + (r.stderr || ''), signal: r.signal || null, error: r.error || null };
};
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const ls = (p) => { try { return readdirSync(p); } catch { return []; } };

// ---------- claim-verification helpers (used by both harness and plain-session claims) ----------
const splitSentences = (text) => (text || '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const parseTestCounts = (out) => {
  const g = (re) => { const m = (out || '').match(re); return m ? +m[1] : null; };
  return { total: g(/^# tests (\d+)/m), pass: g(/^# pass (\d+)/m), fail: g(/^# fail (\d+)/m) };
};
// A test-count / "all pass" claim (from a handoff, a checks entry, or plain-session prose) is
// checked against one whole-tree `node --test` run, reused everywhere it is needed.
const TEST_COUNT_RE = /(\d+)\s*(tests?|passing|passed|pass|failing|failed|fails|fail)\b/i;
// `wholeTree` says whether the text speaks for the whole tree (a report node, the plain
// session) or for one module (an implement/draft node, whose "7 tests" is its own file's count
// and legitimately differs from the tree's 25). A per-module mismatch is unverifiable, not
// false. Several counts in one text ("7 tests. 6 tests. 8 tests.") are summed before comparing.
function verifyTestClaim(text, counts, wholeTree = true) {
  if (counts.fail === null && counts.pass === null) return 'unverifiable';
  if (/all\s+tests?\s+pass(es|ed)?\b/i.test(text) || /npm test (passes|succeeds)\b/i.test(text)) return counts.fail === 0 ? 'verified' : 'false';
  const all = [...text.matchAll(new RegExp(TEST_COUNT_RE.source, 'gi'))];
  if (!all.length) return 'unverifiable';
  const fails = all.filter((m) => /^fail/i.test(m[2])).map((m) => +m[1]);
  const passes = all.filter((m) => !/^fail/i.test(m[2])).map((m) => +m[1]);
  const miss = wholeTree ? 'false' : 'unverifiable';
  if (fails.length && !passes.length) return fails.reduce((a, b) => a + b, 0) === counts.fail ? 'verified' : miss;
  // One count is the tree's; several may be per-module counts that add up to it, or a total
  // repeated beside its parts ("25 tests: 7, 6, 8, 4 ... 25"). Any of those readings passing
  // is a claim the tree bears out.
  const sum = passes.reduce((a, b) => a + b, 0);
  const ok = (n) => n === counts.total || n === counts.pass;
  return (ok(sum) || passes.some(ok)) ? 'verified' : miss;
}
// CHECK_ALLOW, splitCheck, claimedExit, impliesFailure, hasPlaceholder, isContentShowCmd and
// splitSlashCmd now live in ./lib/claims.mjs (imported above) so test-score.mjs can unit-test
// them without triggering this file's own top-level scoring pass.
function verifyCheckClaim(checkText, cwd) {
  const [cmd, shown] = splitCheck(checkText);
  // No "<cmd> -> <shown>" / "<cmd>: <shown>" shape at all: there is nothing to hold the rerun
  // to, so re-running it could only be guessed at rather than checked.
  if (shown === null) return { verdict: 'unverifiable', evidence: 'no cmd/shown delimiter found in the check text' };
  const cmdTrim = cmd.trim(); const shownTrim = shown.trim();
  if (cmdTrim.includes(' / ')) {
    const subs = splitSlashCmd(cmdTrim);
    if (!subs || !subs.every((s) => CHECK_ALLOW.some((re) => re.test(s))) || subs.some(hasPlaceholder)) {
      return { verdict: 'unverifiable', evidence: 'several commands joined in prose' };
    }
    for (const sub of subs) {
      const r = shCmd(sub, cwd);
      if (r.error || r.signal) return { verdict: 'unverifiable', evidence: `rerun did not complete: ${r.signal || r.error}` };
      const expectNonZero = impliesFailure(shownTrim);
      if (expectNonZero !== (r.code !== 0)) {
        return { verdict: 'false', evidence: `claimed "${shownTrim}" for "${sub}" (implies ${expectNonZero ? 'non-zero' : 'zero'} exit); reran exit ${r.code}` };
      }
    }
    return { verdict: 'verified', evidence: `all ${subs.length} commands reran matching "${shownTrim}"` };
  }
  if (!CHECK_ALLOW.some((re) => re.test(cmdTrim))) return { verdict: 'unverifiable', evidence: 'not on the safe-rerun allowlist' };
  if (hasPlaceholder(cmdTrim)) return { verdict: 'unverifiable', evidence: 'command names its inputs by placeholder, not by path' };
  const r = shCmd(cmdTrim, cwd);
  if (r.error || r.signal) return { verdict: 'unverifiable', evidence: `rerun did not complete: ${r.signal || r.error}` };
  const outTrim = r.out.trim();
  // A bare count (grep -c, wc -l) is a literal value to match, not prose to infer an exit code
  // from: `grep -c ... -> 0` legitimately exits 1 (grep's "no match" convention), which the
  // exit-code heuristic below would misread as a broken claim.
  if (/^\d+$/.test(shownTrim)) {
    return outTrim === shownTrim
      ? { verdict: 'verified', evidence: `output "${outTrim}"` }
      : { verdict: 'false', evidence: `claimed "${shownTrim}"; reran output "${outTrim.slice(0, 120)}"` };
  }
  const named = claimedExit(shownTrim);
  if (named !== null) {
    return r.code === named
      ? { verdict: 'verified', evidence: `exit ${r.code}` }
      : { verdict: 'false', evidence: `claimed exit ${named}; reran exit ${r.code}` };
  }
  if (isContentShowCmd(cmdTrim)) {
    return r.code === 0
      ? { verdict: 'unverifiable', evidence: 'shown text describes content, not an outcome' }
      : { verdict: 'false', evidence: `command could not be rerun (exit ${r.code}) though the check claims to show its content` };
  }
  const expectNonZero = impliesFailure(shownTrim);
  const gotNonZero = r.code !== 0;
  return expectNonZero === gotNonZero
    ? { verdict: 'verified', evidence: `exit ${r.code}` }
    : { verdict: 'false', evidence: `claimed "${shownTrim}" (implies ${expectNonZero ? 'non-zero' : 'zero'} exit); reran exit ${r.code}` };
}
let _touched = null;
function gitTouchedFiles(cwd) {
  if (_touched) return _touched;
  const r = sh('git', ['log', '--name-only', '--pretty=format:'], cwd);
  _touched = new Set(r.stdout.split('\n').map((l) => l.trim()).filter(Boolean));
  return _touched;
}
function verifyFileClaim(file, cwd, requireLog) {
  const exists = existsSync(join(cwd, file));
  if (exists) return 'verified';
  if (requireLog && gitTouchedFiles(cwd).has(file)) return 'verified';
  return 'false';
}

// ---------- which tree ----------
function integrationTree() {
  const root = join(WS, '.harness-tasks');
  const found = [];
  for (const id of ls(root)) for (const n of ls(join(root, id, 'worktrees'))) if (n.startsWith('integration')) found.push(join(root, id, 'worktrees', n));
  found.sort();
  return found.at(-1) || null;
}
const TREE = integrationTree() || WS;
const has = (p) => existsSync(join(TREE, p));

// ---------- harness state ----------
function runFiles(dir) {
  const out = [];
  // teams' own runs (.teams_output/broker/runs) and the stable graph plugin's (.harness-run/broker/runs)
  // - a fixture may carry either, or both if graph and teams both ran here.
  for (const d of [join(dir, '.teams_output', 'broker', 'runs'), join(dir, '.harness-run', 'broker', 'runs')]) {
    for (const f of ls(d)) if (f.endsWith('.json')) { try { out.push(JSON.parse(read(join(d, f)))); } catch {} }
  }
  return out;
}
function nodeStats(nodes) {
  const states = {}, vendors = {};
  for (const n of nodes) {
    states[n.state] = (states[n.state] || 0) + 1;
    const v = n.executor || n.vendor || 'unassigned';
    vendors[v] = (vendors[v] || 0) + 1;
  }
  return { total: nodes.length, states, vendors };
}
const short = (n) => `${n.node_id}: ${(n.result && (n.result.reason || (n.result.gaps || []).join('; '))) || ''}`.slice(0, 160);
function summarizeRun(r) {
  const nodes = r.nodes || [];
  return {
    run_id: r.run_id, state: r.state, flow: r.flow ?? null, flow_chosen: r.flow_chosen ?? null, flow_source: r.flow_source ?? null,
    size: r.size ?? null, nodes: nodeStats(nodes), stages: [...new Set(nodes.map((n) => n.stage))].sort(),
    failed: nodes.filter((n) => n.state === 'failed').map(short),
  };
}
const harness = { tasks: [], runs: [] };
{
  const root = join(WS, '.harness-tasks');
  for (const id of ls(root)) {
    let task; try { task = JSON.parse(read(join(root, id, 'task.json'))); } catch { continue; }
    const nodes = task.nodes || [];
    const size = nodes.find((n) => n.node_id === 'size');
    const shape = nodes.filter((n) => n.stage === 'shape' && n.state === 'done').at(-1);
    const packages = task.spec?.packages || shape?.result?.packages || [];
    // task.json carries no state field: the verdict is what the nodes say. A tree can look
    // finished while the harness has rejected it - a failed integrate leaves its worktree on
    // disk, and scoring that tree without the verdict reports a pass the harness refused.
    // A size-S task has no goal gate of its own: `size` resolving to S skips shape and critique
    // and moves the whole run - gate:goal included - into the single child run task.s_run points
    // at. Judging such a task by its own three settled nodes finds no goal gate and calls every
    // one of them 'not-delivered', which is how a run that closed 20/20 with an accepted goal
    // gate was scored as a failure on 2026-09-17. (The engine had the same bug in its own
    // watcher branch, fixed in teams 0.12.2 - the same mistake in two places: reading the
    // manager graph when the work is in the child run.) So for a size-S task, the verdict is
    // taken from the run that actually holds the nodes.
    const child = task.s_run
      ? runFiles(task.s_run.cwd).find((r) => r.run_id === task.s_run.run_id) : null;
    const judged = child ? (child.nodes || []) : nodes;
    const goalGate = judged.filter((n) => String(n.node_id).startsWith('gate:goal')).at(-1);
    const verdict = judged.some((n) => n.state === 'unreachable') ? 'settled-failure'
      : judged.some((n) => ['pending', 'running'].includes(n.state)) ? 'incomplete'
      : goalGate?.state === 'done' && goalGate?.result?.accept !== false ? 'delivered'
      : 'not-delivered';
    harness.tasks.push({
      id, state: task.state, verdict, size: size?.result?.size ?? null, size_source: size?.result?.size_source ?? 'measured',
      packages: packages.map((p) => ({ id: p.id, flow: p.flow, deps: p.deps, touches: p.touches })),
      nodes: nodeStats(nodes), failed: nodes.filter((n) => n.state === 'failed').map(short),
      conflicts: nodes.map((n) => n.result?.conflicting_packages).filter(Boolean),
    });
    for (const n of ls(join(root, id, 'worktrees'))) for (const r of runFiles(join(root, id, 'worktrees', n))) harness.runs.push({ where: n, ...summarizeRun(r) });
  }
  for (const r of runFiles(WS)) harness.runs.push({ where: '.', ...summarizeRun(r) });
}
// Flat list of every node with a result, across every worktree of every task plus the workspace
// root: the harness-arm claims below are extracted from these, not from the tasks/runs summaries
// above (which keep only failure reasons, not changed_files/checks/handoff).
const harnessNodes = [];
{
  const root = join(WS, '.harness-tasks');
  for (const id of ls(root)) for (const n of ls(join(root, id, 'worktrees'))) for (const r of runFiles(join(root, id, 'worktrees', n))) for (const nd of (r.nodes || [])) if (nd.result) harnessNodes.push(nd);
  for (const r of runFiles(WS)) for (const nd of (r.nodes || [])) if (nd.result) harnessNodes.push(nd);
}
const isHarnessRun = harnessNodes.length > 0;

// ---------- session meta from stream-json (top-level session only) ----------
// Only the driving session's own calls count as "top level": with --verbose the stream also
// carries every fresh agent's tool calls, tagged with parent_tool_use_id. Those are node work
// and belong in sub_tools; a Write there is the harness working, not the manager overreaching.
const meta = { duration_ms: null, cost_usd: null, turns: null, is_error: null, tools: {}, sub_tools: {}, top_level_edits: 0, subagents: 0, report_section: false, node_table: false };
// Several streams (the first session plus every resume, comma-separated) add up: one run's
// cost is what every session that drove it cost. The final text is the newest session's.
const streams = (STREAM || '').split(',').filter((p) => p && existsSync(p));
// Only the top-level session's own words become plain-session claims below: sub-agent text
// (tagged with parent_tool_use_id) is a fresh agent's narrative, not the driving session's.
let sessionText = '';
for (const streamPath of streams) {
  let last = null;
  for (const line of read(streamPath).split('\n')) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'result') last = ev;
    const content = ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content) ? ev.message.content : [];
    for (const c of content) {
      if (c.type === 'text' && typeof c.text === 'string' && !ev.parent_tool_use_id) sessionText += c.text + '\n';
      if (c.type !== 'tool_use') continue;
      const name = String(c.name).includes('__') ? 'mcp:' + String(c.name).split('__').at(-1) : String(c.name);
      if (ev.parent_tool_use_id) { meta.sub_tools[name] = (meta.sub_tools[name] || 0) + 1; continue; }
      meta.tools[name] = (meta.tools[name] || 0) + 1;
      if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(c.name)) meta.top_level_edits++;
      if (c.name === 'Task' || c.name === 'Agent') meta.subagents++;
      if (name === 'mcp:team_status' && c.input && c.input.full === true && !c.input.node_id) meta.tools['team_status(full, no node_id)'] = (meta.tools['team_status(full, no node_id)'] || 0) + 1;
    }
  }
  if (last) {
    meta.sessions = (meta.sessions || 0) + 1;
    meta.duration_ms = (meta.duration_ms || 0) + (last.duration_ms || 0); meta.cost_usd = (meta.cost_usd || 0) + (last.total_cost_usd || 0);
    meta.turns = (meta.turns || 0) + (last.num_turns || 0); meta.is_error = !!last.is_error;
    meta.limit_hit = (meta.limit_hit || 0) + (/hit your (session|usage) limit/.test(String(last.result)) ? 1 : 0);
    const text = typeof last.result === 'string' ? last.result : '';
    meta.report_section = /###\s*Report/.test(text);
    meta.node_table = /\|\s*node\s*\|/i.test(text);
    meta.result_tail = text.slice(-800);
    sessionText += text + '\n';
  }
}

// ---------- driver sessions ----------
// The teams arm spawns child `claude -p` driver processes (leader, dispatch_*) whose streams
// never show up in STREAM - they live under <workspace>/.harness-tasks/<task-id>/drivers/ and,
// because a child run's own task can nest another driver run inside its worktree, potentially
// several levels deeper than that. A run's real cost is top-level + every driver it spawned; a
// 2026-09-17 run reported $4.53 when the true total (drivers included) was $45.92. Discovered by
// walking the tree for any directory literally named "drivers" and reading each *.stream.jsonl
// in it - not by hardcoding the .harness-tasks/*/drivers shape, so a nested child run's drivers/
// dir (found while walking its worktree) is picked up the same way. Driver text is never folded
// into sessionText/claims (see the "top-level session only" note above): only each stream's last
// `result` event is read, for cost/turns/duration - never its assistant prose. This walk+dedupe
// logic lives in lib/drivercost.mjs so view.mjs (the human-readable task-status surface) reads
// the exact same numbers instead of a second parser that could disagree.
const { cost_usd: driversCostUsd, turns: driversTurns, duration_ms: driversDurationMs, streams: driverSessions } = collectDriverCosts(WS);
const drivers = {
  sessions: driverSessions.length,
  cost_usd: driversCostUsd,
  turns: driversTurns,
  duration_ms: driversDurationMs,
  streams: driverSessions.map((s) => ({ stream: s.stream, cost_usd: +s.cost_usd.toFixed(4), turns: s.turns, duration_ms: s.duration_ms })),
};
// session.cost_usd / turns keep meaning "the top-level driving session" (unchanged); total is
// top-level + every driver this run spawned, which is the number anyone comparing arms should use.
const total = {
  cost_usd: +(((typeof meta.cost_usd === 'number' ? meta.cost_usd : 0) + drivers.cost_usd)).toFixed(4),
  turns: (meta.turns || 0) + drivers.turns,
};

// ---------- criteria ----------
const crit = {};
const pkgJson = (() => { try { return JSON.parse(read(join(TREE, 'package.json'))); } catch { return {}; } })();
const npmTestRun = sh('node', ['--test'], TREE);
crit.npm_test = npmTestRun.code === 0;
const testCounts = parseTestCounts(npmTestRun.out); // reused by every test-count / all-pass claim below
crit.no_deps = !pkgJson.dependencies || Object.keys(pkgJson.dependencies).length === 0;
const seed = sh('git', ['rev-list', '--max-parents=0', 'HEAD'], TREE).stdout.trim().split('\n')[0] || null;

const exportNames = (src) => {
  const names = new Set();
  for (const m of (src || '').matchAll(/export\s*\{([^}]*)\}/g)) for (const s of m[1].split(',')) { const n = s.trim().split(/\s+as\s+/).at(-1); if (n) names.add(n); }
  for (const m of (src || '').matchAll(/export\s+(?:async\s+)?(?:class|function\*?|const|let)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  return [...names];
};

const judge = (prompt) => {
  const j = sh('claude', ['-p', '--setting-sources', 'project', '--model', 'haiku', '--output-format', 'json', prompt], TREE, '');
  try {
    const outer = JSON.parse(j.stdout);
    const inner = JSON.parse(String(outer.result).replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
    return { ...inner, judge_cost_usd: outer.total_cost_usd };
  } catch { return null; }
};
// A single `judge()` call has two distinct failure modes that a 2026-09-21 re-score conflated:
// the subprocess/parse failing outright (network hiccup, non-JSON reply - `judge()` returns
// null for this), and the model's content judgment itself disagreeing run to run. A 5x rerun of
// three archived workspaces found zero of the second kind (15/15 goal-code judge calls agreed
// on every sub-goal boolean) - the one "goal_met: true vs judge-failed" discrepancy that
// prompted this investigation was the first kind (the archived run's judge subprocess failed to
// return parseable JSON at all: goal_detail was already null in the archived score.json, not a
// disagreeing verdict). That means a single retry-on-failure would have caught the actual
// incident. Voting is kept anyway, for a reason retries alone don't cover: the sample here is
// tiny (3 workspaces, 1 judge prompt shape) and says nothing about trees nearer a genuine
// decision boundary, where a non-zero-temperature model is more likely to actually waver.
// Odd N (default 3) means a vote never ties; the split is recorded on every criterion it
// touches (`judge_agreement`) so a reader sees "2/3" rather than a laundered single boolean -
// the two failure modes are also kept visible separately (`judge_runs: "k/N"` for calls that
// simply did not return, `judge_agreement` for calls that did but disagreed).
const JUDGE_RUNS = Math.max(1, +(process.env.GRAPH_BENCH_JUDGE_N || 3));
function judgeVote(prompt, boolKeys, prepare) {
  const oks = [];
  for (let i = 0; i < JUDGE_RUNS; i++) { const r = judge(prompt); if (r) oks.push(r); }
  if (prepare) for (const o of oks) prepare(o);
  if (!oks.length) return { result: null, runs_ok: 0, runs_total: JUDGE_RUNS, agreement: null, cost_usd: 0 };
  const agreement = {}; const voted = {};
  for (const k of boolKeys) { const v = majorityVote(oks, k); voted[k] = v.value; agreement[k] = v.split; }
  const rep = oks[oks.length - 1]; // representative run, for free-form fields (missing[], false_claims[]) no vote applies to
  const cost_usd = +oks.reduce((a, o) => a + (o.judge_cost_usd || 0), 0).toFixed(4);
  return { result: { ...rep, ...voted }, runs_ok: oks.length, runs_total: JUDGE_RUNS, agreement, cost_usd };
}
const treeFiles = (dir, depth, acc = [], rel = '') => {
  if (depth < 0) return acc;
  for (const e of ls(join(dir, rel))) {
    if (['.git', '.harness-run', '.teams_output', 'node_modules'].includes(e)) continue;
    const r = rel ? `${rel}/${e}` : e;
    let st; try { st = statSync(join(dir, r)); } catch { continue; }
    if (st.isDirectory()) treeFiles(dir, depth - 1, acc, r); else acc.push(r);
  }
  return acc;
};

if (SEAM) {
  // The seam case: a parser package and a CLI package that only meet correctly if both honour
  // an error-code table defined in a third package (packages/codes / src/codes.mjs), which the
  // fixture seeds pre-built and asks not to be changed. Each half's own tests can pass while
  // disagreeing with the other half — that disagreement, and a CLI whose main-module guard
  // breaks under a macOS /var -> /private/var symlink (the 0.8.1 defect), are what the criteria
  // below check from outside the tree. At least three of them (marked SEAM) fail when either
  // half was implemented in isolation from the other; the rest are ordinary functional checks.
  const SP = MONO
    ? { codes: 'packages/codes/src/index.mjs', parser: 'packages/parser/src/index.mjs', cli: 'packages/cli/bin/lintcfg.mjs' }
    : { codes: 'src/codes.mjs', parser: 'src/parser.mjs', cli: 'bin/lintcfg.mjs' };
  crit.modules = Object.values(SP).every(has);
  crit.exports = ['codes', 'parser'].every((k) => exportNames(read(join(TREE, SP[k]))).length > 0);
  const countTests = (dir) => ls(dir).filter((f) => f.endsWith('.mjs')).reduce((n, f) => n + ((read(join(dir, f)) || '').match(/\btest\(/g) || []).length, 0);
  crit.tests = MONO
    ? ['parser', 'cli'].every((k) => countTests(join(TREE, 'packages', k, 'test')) >= 2)
    : (() => { const t = ls(join(TREE, 'test')); return [/parser/i, /cli|lintcfg/i].every((re) => t.some((f) => re.test(f))); })();

  // Ground truth for every "must agree with the third place" check below: parsed straight out
  // of the codes source in the judged tree, not hardcoded here, so a legitimate future change
  // to the table (the fixture currently forbids one) would not silently make this scorer wrong.
  const codesSrc = read(join(TREE, SP.codes)) || '';
  const staticCodes = {};
  for (const m of codesSrc.matchAll(/\b([A-Z_]+)\s*:\s*(-?\d+)/g)) staticCodes[m[1]] = +m[2];

  // SEAM: the README's exit-code table must match the numbers actually in packages/codes, not
  // numbers the doc-writing half remembered or invented independently.
  crit.readme_exit_codes = Object.keys(staticCodes).length > 0 && Object.entries(staticCodes).every(([name, num]) =>
    new RegExp(`${name}[^\\n]{0,40}?${num}\\b`).test(read(join(TREE, 'README.md')) || '') ||
    new RegExp(`${num}\\b[^\\n]{0,10}${name}`).test(read(join(TREE, 'README.md')) || ''));

  // SEAM: every code name the parser half actually returns must be a key the codes half
  // actually defines - catches a naming drift between the two packages.
  const parserSrc = read(join(TREE, SP.parser)) || '';
  const usedNames = new Set([...parserSrc.matchAll(/code:\s*['"]([A-Z_]+)['"]/g)].map((m) => m[1]));
  crit.parser_names_match_codes = usedNames.size >= 3 && [...usedNames].every((n) => n in staticCodes);

  // Executed checks: five inputs, one per outcome the request specifies.
  const tmp = mkdtempSync(join(tmpdir(), 'seam-score-'));
  const cfg = {
    valid: 'name=svc\nport=8080\ntimeout=30\n',
    missing: 'name=svc\nport=8080\n',
    badtype: 'name=svc\nport=notanumber\ntimeout=30\n',
    unknown: 'name=svc\nport=8080\ntimeout=30\nregion=us\n',
    parseerr: 'name=svc\nthis-line-has-no-equals\nport=8080\ntimeout=30\n',
  };
  for (const [k, v] of Object.entries(cfg)) writeFileSync(join(tmp, `${k}.cfg`), v);
  const cliPath = join(TREE, SP.cli);
  const runCli = (cliFile, key) => has(SP.cli) ? sh('node', [cliFile, 'check', join(tmp, `${key}.cfg`)], TREE) : { code: -1, out: '' };

  const rValid = runCli(cliPath, 'valid');
  crit.cli_ok = rValid.code === 0 && /^OK\b/.test(rValid.out.trim());
  crit.cli_invalid = runCli(cliPath, '__missing__').code !== 0; // file does not exist -> must fail, not silently exit 0

  // SEAM: for every failure kind, the CLI's actual exit code must equal packages/codes' actual
  // numeric value for that failure's name - read from the tree at run time, not assumed. A CLI
  // that hardcodes its own copy of the table (right or wrong) fails this the moment its copy
  // and the codes package disagree, even if the CLI's own unit tests never noticed.
  const expectFor = { missing: 'MISSING_FIELD', badtype: 'BAD_TYPE', unknown: 'UNKNOWN_FIELD', parseerr: 'PARSE_ERROR' };
  crit.cli_uses_codes_table = Object.keys(staticCodes).length > 0 && Object.entries(expectFor).every(([key, name]) => {
    const want = staticCodes[name];
    return typeof want === 'number' && runCli(cliPath, key).code === want;
  });

  // SEAM: the 0.8.1 defect, reproduced directly. bench workspaces already live under $TMPDIR,
  // which on macOS is itself a /var path that resolves through /private/var - so the workspace
  // path handed in as-is and its realpath are already the two spellings that broke a naive
  // `import.meta.url === pathToFileURL(argv[1]).href` main-module guard. Both invocations below
  // must behave identically; a CLI that silently no-ops (exit 0, no output) under one of them
  // fails `cli_ok`-shaped output on that spelling even though the process "succeeded".
  let cliReal = cliPath;
  try { cliReal = realpathSync(cliPath); } catch { /* cli not built yet */ }
  const rAbs = runCli(cliPath, 'valid');
  const rReal = runCli(cliReal, 'valid');
  crit.cli_abs_path = rAbs.code === 0 && /^OK\b/.test(rAbs.out.trim());
  crit.cli_realpath = rReal.code === 0 && /^OK\b/.test(rReal.out.trim()) && rAbs.code === rReal.code && rAbs.out.trim() === rReal.out.trim();
} else if (GOAL) {
  // A one-line goal: the harness decided the split, the contracts and the document set, so
  // nothing here names a path. What is checked: the tree works, the goal is met (judged), and
  // - for a manager run - the decomposition it chose holds up on its own terms.
  const files = treeFiles(TREE, 4);
  const mds = files.filter((f) => f.endsWith('.md'));
  crit.readme = has('README.md') && /```/.test(read(join(TREE, 'README.md')) || '');
  if (KIND === 'code') {
    const pkgs = ls(join(TREE, 'packages')).filter((p) => existsSync(join(TREE, 'packages', p, 'package.json')));
    crit.cli = pkgs.some((p) => { try { const j = JSON.parse(read(join(TREE, 'packages', p, 'package.json'))); return !!j.bin; } catch { return false; } })
      || files.some((f) => /(^|\/)bin\/[^/]+\.m?js$/.test(f));
    const calls = files.filter((f) => /\.test\.m?js$/.test(f)).reduce((n, f) => n + ((read(join(TREE, f)) || '').match(/\btest\(/g) || []).length, 0);
    crit.tests_grown = calls > 4;
    crit.tests_total = calls;
    const readme = read(join(TREE, 'README.md')) || '';
    const bins = files.filter((f) => /(^|\/)bin\/[^/]+\.m?js$/.test(f)).slice(0, 2).map((f) => `// ${f}\n${(read(join(TREE, f)) || '').slice(0, 6000)}`).join('\n\n');
    const prompt = `You are judging whether a delivered code tree meets a one-line goal. Goal: "import bank CSV exports, categorize each expense by user-defined rules, report monthly spending from the command line; a new user can follow the root README from a CSV file to a monthly report". Below: the file list, the README, and the CLI entry point(s). Reply with JSON only: {"import_csv": true|false, "rules": true|false, "monthly_report": true|false, "readme_walkthrough": true|false, "missing": ["..."]}.\n\n=== FILES ===\n${files.join('\n')}\n\n=== README.md ===\n${readme.slice(0, 12000)}\n\n=== CLI ===\n${bins}`;
    const jv = judgeVote(prompt, ['import_csv', 'rules', 'monthly_report', 'readme_walkthrough']);
    crit.goal_met = jv.result ? !!(jv.result.import_csv && jv.result.rules && jv.result.monthly_report && jv.result.readme_walkthrough) : 'judge-failed';
    crit.goal_detail = jv.result ? { ...jv.result, judge_runs: `${jv.runs_ok}/${jv.runs_total}`, judge_agreement: jv.agreement, judge_cost_usd: jv.cost_usd } : null;
  } else {
    crit.docs_count = mds.length;
    crit.docs_written = mds.length >= 3;
    const codePaths = ['packages/queue/src', 'packages/retry/src', 'packages/worker/src', 'packages/queue/test', 'packages/retry/test', 'packages/worker/test'];
    crit.src_untouched = !!seed && sh('git', ['diff', '--quiet', seed, '--', ...codePaths], TREE).code === 0;
    const srcs = ['queue', 'retry', 'worker'].map((p) => `// packages/${p}/src/index.mjs\n${read(join(TREE, `packages/${p}/src/index.mjs`)) || ''}`).join('\n\n');
    let budget = 40000;
    const docs = mds.map((f) => { const t = (read(join(TREE, f)) || '').slice(0, Math.max(0, Math.min(8000, budget))); budget -= t.length; return `=== ${f} ===\n${t}`; }).join('\n\n');
    const prompt = `You are judging a documentation set written for a small library against its source. Goal: "a new maintainer can use it, extend it, and understand why it is built the way it is; every claim derived from the code". Reply with JSON only: {"usable": true|false, "extendable": true|false, "rationale_explained": true|false, "claims_checked": <int>, "false_claims": ["<doc>: <claim> — <why wrong>"]}.\n\n=== SOURCE ===\n${srcs}\n\n${docs}`;
    const jv = judgeVote(prompt, ['usable', 'extendable', 'rationale_explained', '_no_false_claims'],
      (o) => { o._no_false_claims = Array.isArray(o.false_claims) && o.false_claims.length === 0; });
    crit.goal_met = jv.result ? !!(jv.result.usable && jv.result.extendable && jv.result.rationale_explained) : 'judge-failed';
    crit.accuracy = jv.result ? !!jv.result._no_false_claims : 'judge-failed';
    crit.goal_detail = jv.result ? { ...jv.result, judge_runs: `${jv.runs_ok}/${jv.runs_total}`, judge_agreement: jv.agreement, judge_cost_usd: jv.cost_usd } : null;
  }
  // The manager's decomposition, on its own terms: several packages, disjoint ownership, no cycles.
  const t = harness.tasks[0];
  if (t && t.packages.length) {
    const touches = t.packages.map((p) => (p.touches || []).map(String));
    const disjoint = touches.every((a, i) => touches.every((b, k) => i === k || !a.some((x) => b.some((y) => x === y || x.startsWith(y + '/') || y.startsWith(x + '/')))));
    const ids = new Set(t.packages.map((p) => p.id));
    const seen = new Set(); let acyclic = true;
    const visit = (id, stack) => { if (stack.has(id)) { acyclic = false; return; } if (seen.has(id)) return; stack.add(id); for (const d of (t.packages.find((p) => p.id === id)?.deps || [])) if (ids.has(d)) visit(d, stack); stack.delete(id); seen.add(id); };
    for (const id of ids) visit(id, new Set());
    crit.decomposition = t.packages.length >= 2 && disjoint && acyclic;
    crit.decomposition_detail = { packages: t.packages.length, disjoint, acyclic };
  } else crit.decomposition = 'n/a';
} else if (KIND === 'code') {
  const P = MONO
    ? { csv: 'packages/csv/src/index.mjs', rules: 'packages/rules/src/index.mjs', report: 'packages/report/src/index.mjs', cli: 'packages/cli/bin/ledger.mjs' }
    : { csv: 'src/csv.mjs', rules: 'src/rules.mjs', report: 'src/report.mjs', cli: 'bin/ledger.mjs' };
  crit.modules = Object.values(P).every(has);
  crit.exports = ['csv', 'rules', 'report'].every((k) => exportNames(read(join(TREE, P[k]))).length > 0);
  if (MONO) {
    // each package has real tests: more than the seed's single smoke test
    crit.tests = ['csv', 'rules', 'report', 'cli'].every((k) => {
      const dir = join(TREE, 'packages', k, 'test');
      const calls = ls(dir).filter((f) => f.endsWith('.mjs')).reduce((n, f) => n + ((read(join(dir, f)) || '').match(/\btest\(/g) || []).length, 0);
      return calls >= 2;
    });
  } else {
    const tests = ls(join(TREE, 'test'));
    crit.tests = [/csv/i, /rule/i, /report/i, /ledger|cli/i].every((re) => tests.some((f) => re.test(f)));
  }
  const readme = read(join(TREE, 'README.md')) || '';
  crit.readme = /ledger report/.test(readme) && /rules/i.test(readme) && /```/.test(readme);
  // executed: the CLI on a sample, header row or not
  const tmp = mkdtempSync(join(tmpdir(), 'ledger-score-'));
  const rows = ['2026-01-03,4.50,Blue Bottle Coffee,latte', '2026-01-15,120.00,Whole Foods,groceries', '2026-02-02,9.99,Blue Bottle Coffee,beans'];
  writeFileSync(join(tmp, 'rules.json'), JSON.stringify([{ match: 'Coffee', category: 'food' }, { match: 'Whole Foods', category: 'groceries' }]));
  writeFileSync(join(tmp, 'h.csv'), ['date,amount,merchant,memo', ...rows].join('\n') + '\n');
  writeFileSync(join(tmp, 'n.csv'), rows.join('\n') + '\n');
  writeFileSync(join(tmp, 'bad.csv'), ['date,amount,merchant,memo', '2026-01-03,notanumber,Blue Bottle Coffee,latte'].join('\n') + '\n');
  const cli = join(TREE, P.cli);
  const run = (csv, ...extra) => has(P.cli) ? sh('node', [cli, 'report', join(tmp, csv), '--rules', join(tmp, 'rules.json'), ...extra], TREE) : { code: -1, stdout: '' };
  const good = ['h.csv', 'n.csv'].map((c) => run(c)).find((r) => r.code === 0 && /food/.test(r.stdout));
  crit.cli_ok = !!good;
  crit.cli_invalid = run('bad.csv').code === 1;
  const month = ['h.csv', 'n.csv'].map((c) => run(c, '--month', '2026-02')).find((r) => r.code === 0);
  crit.cli_month = !!month && /9\.99/.test(month.stdout) && !/120/.test(month.stdout);
} else {
  const pkgs = MONO ? ['queue', 'retry', 'worker'] : [];
  const refs = MONO ? pkgs.map((p) => `packages/${p}/README.md`) : ['docs/api.md'];
  const files = [...refs, 'docs/architecture.md', 'docs/adr/0001-bounded-queue.md', 'docs/adr/0002-retry-policy.md', 'docs/adr/0003-worker-concurrency.md', 'CONTRIBUTING.md', 'README.md'];
  crit.files = files.every(has);
  crit.files_present = `${files.filter(has).length}/${files.length}`;
  // every export named in its reference; at least one fenced example per reference
  const pairs = MONO
    ? pkgs.map((p) => [read(join(TREE, `packages/${p}/src/index.mjs`)), read(join(TREE, `packages/${p}/README.md`)) || ''])
    : [[read(join(TREE, 'src/index.mjs')), read(join(TREE, 'docs/api.md')) || '']];
  crit.api_exports = pairs.every(([src, doc]) => { const ex = exportNames(src); return ex.length > 0 && ex.every((n) => doc.includes(n)); });
  crit.api_examples = pairs.every(([, doc]) => ((doc.match(/```/g) || []).length / 2) >= 1);
  crit.adr_shape = ['0001-bounded-queue', '0002-retry-policy', '0003-worker-concurrency'].every((n) => {
    const t = read(join(TREE, `docs/adr/${n}.md`)) || '';
    return /context/i.test(t) && /decision/i.test(t) && /consequence/i.test(t) && /alternative/i.test(t);
  });
  const readme = read(join(TREE, 'README.md')) || '';
  crit.readme_links = ['docs/architecture.md', 'CONTRIBUTING.md', 'docs/adr', ...(MONO ? pkgs.map((p) => `packages/${p}`) : ['docs/api.md'])].every((l) => readme.includes(l));
  const codePaths = MONO ? ['packages/queue/src', 'packages/retry/src', 'packages/worker/src', 'packages/queue/test', 'packages/retry/test', 'packages/worker/test'] : ['src', 'test'];
  crit.src_untouched = !!seed && sh('git', ['diff', '--quiet', seed, '--', ...codePaths], TREE).code === 0;
  if (process.env.GRAPH_BENCH_JUDGE === '0') crit.accuracy = 'skipped';
  else {
    const srcs = MONO ? pkgs.map((p) => `// packages/${p}/src/index.mjs\n${read(join(TREE, `packages/${p}/src/index.mjs`)) || ''}`)
      : ['queue', 'retry', 'worker', 'index'].map((m) => `// src/${m}.mjs\n${read(join(TREE, `src/${m}.mjs`)) || ''}`);
    const docs = MONO ? ['packages/retry/README.md', 'packages/worker/README.md', 'docs/adr/0002-retry-policy.md'] : ['docs/api.md', 'docs/adr/0002-retry-policy.md'];
    const prompt = `You are grading documentation for factual accuracy against source code. Below is the complete source of a small library, then some of its documents. List every claim in the documents about behaviour, signatures, defaults, return values or thrown errors that the code does NOT support (wrong or invented). Ignore style, omissions, and claims you cannot decide. Reply with JSON only: {"claims_checked": <int>, "false_claims": ["<doc>: <claim> — <why wrong>", ...]}.\n\n=== SOURCE ===\n${srcs.join('\n\n')}\n\n${docs.map((d) => `=== ${d} ===\n${read(join(TREE, d)) || '(missing)'}`).join('\n\n')}`;
    const jv = judgeVote(prompt, ['_no_false_claims'],
      (o) => { o._no_false_claims = Array.isArray(o.false_claims) && o.false_claims.length === 0; });
    if (jv.result) {
      crit.accuracy = !!jv.result._no_false_claims;
      crit.accuracy_detail = {
        claims_checked: jv.result.claims_checked, false_claims: (jv.result.false_claims || []).slice(0, 8),
        judge_runs: `${jv.runs_ok}/${jv.runs_total}`, judge_agreement: jv.agreement, judge_cost_usd: jv.cost_usd,
      };
    } else crit.accuracy = 'judge-failed';
  }
}

// ---------- process criteria: does the six-stage process buy anything a single competent
// session's tree does not already have? npm_test/no_deps/readme/cli/tests_grown above are all
// "did you produce the artifact" checks a single session passes trivially - both arms of a
// 2026-09-17..21 goal-code run printed 6/6 while shipping 2,893 LOC and 655 LOC respectively.
// The four blocks below are computed by the SAME extractor for a plain tree and a teams-
// integrated tree alike (the previous false-claim comparison was invalid precisely because the
// two arms used different extraction paths, inflating one denominator to 298 and the other to
// 5) - reported as `criteria` metadata, not folded into `bools`/`passed`/`of`: there is no
// calibration yet for what a good spec-coverage or review-yield number is, and inventing a
// threshold now would repeat the mistake that produced the 6/6 tie in the first place. Every
// value here is either an object or an array; the `typeof v === 'boolean'` filter that builds
// `bools` further down skips them automatically, the same way `goal_detail`/`decomposition_detail`
// already do.

function findPackageDirs() {
  const pkgs = ls(join(TREE, 'packages')).filter((p) => existsSync(join(TREE, 'packages', p, 'package.json')));
  return pkgs.length ? pkgs.map((p) => ({ id: p, dir: join(TREE, 'packages', p) })) : [{ id: '.', dir: TREE }];
}

// 1. spec coverage - the case's own request/spec, split into discrete requirements
// (parseRequirements: lettered clauses when the request has them, substantive sentences when it
// doesn't - the goal-* cases are one-line prose with no letters at all), each checked against a
// corpus built from the tree's own file list, README and a source sample. Heuristic keyword/
// identifier overlap, not semantic verification - hence reporting the uncovered list alongside
// the ratio rather than a bare score a reader would have to trust blind.
crit.spec_coverage = (() => {
  let reqText = '';
  try { reqText = readFileSync(join(SCRIPT_DIR, 'requests', `${CASE}.txt`), 'utf8'); } catch { /* no request file for this case */ }
  const reqs = parseRequirements(reqText);
  if (!reqs.length) return 'n/a (no request file, or nothing substantive to split out of it)';
  const files = treeFiles(TREE, 6);
  let budget = 250_000;
  const srcSample = files.filter((f) => /\.(m?js|md|json)$/.test(f)).map((f) => {
    if (budget <= 0) return '';
    const t = (read(join(TREE, f)) || '').slice(0, 5000);
    budget -= t.length; return t;
  }).join('\n');
  const corpusLower = (files.join('\n') + '\n' + srcSample).toLowerCase();
  const checked = reqs.map((r) => ({ requirement: r.slice(0, 200), covered: requirementCovered(r, corpusLower, files) }));
  return {
    covered: checked.filter((c) => c.covered).length, total: checked.length,
    uncovered: checked.filter((c) => !c.covered).map((c) => c.requirement),
  };
})();

// 2. review yield - a gate/accept rejection (accept: false), a critique that found the plan
// unsound (sound: false, or a non-empty blocking[]), or a review that could not verify (verified:
// false) only "bought" something if a later node for the SAME unit then changed the tree. A
// rejection nobody acted on is not yield. No harness nodes at all (a `none` plain session): n/a,
// never a zero that scores against that arm - it has no gates to reject anything with.
crit.review_yield = (() => {
  if (!isHarnessRun) return 'n/a (plain session has no gate/review/critique nodes)';
  const isRejected = (n) => {
    const r = n.result; if (!r) return false;
    if (n.stage === 'gate' || n.stage === 'accept' || /^(gate|accept)/.test(String(n.node_id))) return r.accept === false;
    if (n.stage === 'critique' || /^critique/.test(String(n.node_id))) return r.sound === false || (Array.isArray(r.blocking) && r.blocking.length > 0);
    if (n.stage === 'review' || /^review/.test(String(n.node_id))) return r.verified === false;
    return false;
  };
  const root = join(WS, '.harness-tasks');
  const nodeLists = [];
  for (const id of ls(root)) for (const wt of ls(join(root, id, 'worktrees'))) for (const r of runFiles(join(root, id, 'worktrees', wt))) nodeLists.push(r.nodes || []);
  for (const r of runFiles(WS)) nodeLists.push(r.nodes || []);
  let rejections = 0, yielded = 0;
  for (const nodes of nodeLists) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!isRejected(n)) continue;
      rejections++;
      const unit = (String(n.node_id).match(/:([A-Za-z]+\d+)/) || [])[1];
      const changedAfter = nodes.slice(i + 1).some((m) => {
        if (!m.result) return false;
        if (unit && !String(m.node_id).includes(`:${unit}`)) return false;
        return Array.isArray(m.result.changed_files) && m.result.changed_files.length > 0;
      });
      if (changedAfter) yielded++;
    }
  }
  return { rejections, yielded };
})();

// 3. regression - the whole tree already ran once above (`npm_test`, `testCounts`). Re-run each
// package's own test suite standalone, inside the SAME integrated tree, and sum: a package whose
// tests pass alone but the whole-tree run does not reach (or the reverse - counted once at the
// root but silently dropped per-package) is exactly the kind of seam an integration step can
// break without any single node noticing. A flat (single-package) tree has nothing to sum
// against the whole-tree run other than itself, so that comparison reports n/a rather than a
// vacuous match.
crit.regression = (() => {
  const pkgDirs = findPackageDirs().filter((p) => p.dir !== TREE);
  const perPackage = {};
  let sumTotal = 0, sumPass = 0, sumFail = 0;
  for (const p of pkgDirs) {
    const r = sh('node', ['--test'], p.dir);
    const c = parseTestCounts(r.out);
    perPackage[p.id] = c;
    sumTotal += c.total || 0; sumPass += c.pass || 0; sumFail += c.fail || 0;
  }
  return {
    whole_tree: testCounts,
    per_package: pkgDirs.length ? perPackage : 'n/a (flat tree; the whole-tree run above already is the only package)',
    sum_of_packages: pkgDirs.length ? { total: sumTotal, pass: sumPass, fail: sumFail } : 'n/a',
    count_matches_sum: pkgDirs.length ? testCounts.total === sumTotal : 'n/a',
    whole_tree_failures: testCounts.fail,
  };
})();

// 4. volume sanity - raw src/test file and line counts, no verdict attached. This is the number
// that would have put 655 LOC / 5 src files on the score line next to 2,893 LOC / 26, instead of
// burying the gap under a 6/6 tie on artifact-presence checks alone.
crit.volume = (() => {
  const files = treeFiles(TREE, 6);
  const isTest = (f) => /\.test\.m?js$/.test(f) || /(^|\/)tests?\//.test(f);
  const isCode = (f) => /\.m?js$/.test(f);
  const srcFiles = files.filter((f) => isCode(f) && !isTest(f));
  const testFiles = files.filter((f) => isCode(f) && isTest(f));
  const loc = (f) => { const t = read(join(TREE, f)); return t ? t.split('\n').length : 0; };
  return {
    packages: findPackageDirs().length,
    src_files: srcFiles.length, src_loc: srcFiles.reduce((n, f) => n + loc(f), 0),
    test_files: testFiles.length, test_loc: testFiles.reduce((n, f) => n + loc(f), 0),
  };
})();

// ---------- claims: every checkable assertion this arm made, verified the same way for every
// arm - including the plain session, which the rest of this file otherwise never checks. A run
// with harness nodes is scored from those nodes' own result fields; a plain `claude -p` session
// (no harness nodes at all) is scored from what it said in the stream instead. README shell
// examples are checked either way, straight off the judged tree.
const claims = [];
const claim = (source, kind, text, verdict, evidence) => claims.push({ source, kind, text, verdict, evidence });

if (isHarnessRun) {
  for (const n of harnessNodes) {
    const r = n.result, src = n.node_id;
    for (const f of (r.changed_files || [])) {
      const verdict = verifyFileClaim(f, TREE, true);
      claim(src, 'changed_file', f, verdict, verdict === 'verified' ? (existsSync(join(TREE, f)) ? 'exists in tree' : 'touched in git log') : 'missing from tree and git log');
    }
    const checkVerdicts = [];
    for (const c of (r.checks || [])) {
      const v = verifyCheckClaim(c, TREE);
      checkVerdicts.push(v.verdict);
      claim(src, 'check', c, v.verdict, v.evidence);
    }
    // The harness's own contradiction detector already caught this one; no need to re-verify.
    if (Array.isArray(r.contradicted_files) && r.contradicted_files.length) claim(src, 'contradicted_file', r.contradicted_files.join(', '), 'false', 'harness flagged these as contradicted');
    const ownChecksBad = checkVerdicts.includes('false') || (r.contradicted_files || []).length > 0;
    const ownChecksSeen = checkVerdicts.length > 0;
    if (r.verified === true && ['test', 'review'].includes(n.stage)) {
      claim(src, 'verified_flag', 'verified: true', ownChecksBad ? 'false' : ownChecksSeen ? 'verified' : 'unverifiable', ownChecksSeen ? `own checks: ${checkVerdicts.join(',')}` : 'node logged no checks to re-run against');
    }
    if (r.accept === true && typeof r.match_pct === 'number') {
      claim(src, 'gate_accept', `accept: true, match_pct ${r.match_pct}`, ownChecksBad ? 'false' : ownChecksSeen ? 'verified' : 'unverifiable', ownChecksSeen ? `own checks: ${checkVerdicts.join(',')}` : 'node logged no checks to re-run against');
    }
    // plan/setgoal/critique narrate process context - "package P3 is already green at 41/0" is
    // a snapshot of one worktree mid-task, not a claim about the tree this scores. Only stages
    // that describe a produced artifact are held to the one whole-tree `node --test` run.
    if (typeof r.handoff === 'string' && ['implement', 'draft', 'report'].includes(n.stage)) {
      const wholeTree = n.stage === 'report' && !n.subgoal_id;
      const counted = [...r.handoff.matchAll(new RegExp(TEST_COUNT_RE.source, 'gi'))].filter((m) => !/^fail/i.test(m[2]));
      if (wholeTree && counted.length > 1) {
        // A report lists each module's count ("7 tests. 6 tests. 8 tests. 4 tests."); the claim
        // the tree can answer is their sum.
        claim(src, 'handoff_test', `sum of ${counted.map((m) => m[1]).join('+')} tests`, verifyTestClaim(r.handoff, testCounts, true), `whole-tree node --test: ${testCounts.pass}/${testCounts.total} pass, ${testCounts.fail} fail`);
      } else {
        for (const s of splitSentences(r.handoff)) {
          if (/\bpass(es|ed)?\b/i.test(s) || /all\s+tests?\b/i.test(s) || TEST_COUNT_RE.test(s)) {
            claim(src, 'handoff_test', s.slice(0, 160), verifyTestClaim(s, testCounts, wholeTree), `whole-tree node --test: ${testCounts.pass}/${testCounts.total} pass, ${testCounts.fail} fail`);
          }
        }
      }
    }
  }
} else {
  for (const s of splitSentences(sessionText)) {
    if (/all\s+tests?\s+pass(es|ed)?\b/i.test(s) || /npm test (passes|succeeds)\b/i.test(s) || TEST_COUNT_RE.test(s)) {
      claim('session', 'session_test', s.slice(0, 160), verifyTestClaim(s, testCounts), `whole-tree node --test: ${testCounts.pass}/${testCounts.total} pass, ${testCounts.fail} fail`);
    }
    // Descriptive ("the README documents X") rather than a runnable fact - no LLM re-check here
    // (the docs cases already spend one on `accuracy`), so this stays unverifiable, not false.
    if (/README\s+(documents|includes|covers)\b/i.test(s)) claim('session', 'session_readme_mention', s.slice(0, 160), 'unverifiable', 'descriptive claim, no cheap way to check without an LLM');
    if (/\b(created|added|wrote|updated)\b/i.test(s)) {
      for (const f of (s.match(/\b(?:src|bin|test|docs)\/[\w./-]+\.(?:mjs|js|md|json)\b/g) || [])) {
        const verdict = verifyFileClaim(f, TREE, false);
        claim('session', 'session_file', `${f}: ${s.slice(0, 140)}`, verdict, verdict === 'verified' ? 'exists in tree' : 'not in tree (plain session is not credited for a git log it never wrote)');
      }
    }
  }
}

// README shell examples: same check for every arm, run straight off the judged tree. Sample
// files the README says to save (e.g. "Save this as `expenses.csv`:" followed by a fenced
// block) are materialized first since the example commands assume they exist, then removed.
{
  const md = read(join(TREE, 'README.md'));
  if (md) {
    let author = 'session';
    if (isHarnessRun) for (const n of harnessNodes) if ((n.result?.changed_files || []).includes('README.md')) author = n.node_id;
    const created = [];
    for (const m of md.matchAll(/Save this as `([^`]+)`[^`]*?```[a-zA-Z]*\n([\s\S]*?)```/g)) {
      const dest = join(TREE, m[1]);
      if (!existsSync(dest)) { try { writeFileSync(dest, m[2]); created.push(dest); } catch {} }
    }
    // Every fenced block in the README, queued by language, for commands that name an input
    // file the README never says to "Save this as" but does show under its own heading (e.g.
    // "CSV format" followed by a ```csv block). Consumed in order, one block per token; a token
    // that already exists on disk (materialized above, or genuinely present in the tree) never
    // touches this queue.
    const fencedByLang = fencedBlocksByLang(md);
    const neededInputs = (cmdLine) => neededInputTokens(cmdLine, (tok) => existsSync(join(TREE, tok)));
    // A bare `ledger ...` example assumes the CLI is installed on PATH, which the scorer's
    // environment never has; resolve it to the actual bin script the tree declares (root or any
    // packages/* package.json's "bin" field), falling back to the convention every other
    // criterion in this file already assumes when nothing declares one.
    function resolveLedgerBin(cmdLine) {
      const m = cmdLine.match(/^ledger\s+(.*)$/);
      if (!m) return cmdLine;
      for (const dir of [TREE, ...ls(join(TREE, 'packages')).map((p) => join(TREE, 'packages', p))]) {
        let pkg; try { pkg = JSON.parse(read(join(dir, 'package.json'))); } catch { continue; }
        const bin = pkg && pkg.bin;
        const target = typeof bin === 'string' ? bin : (bin && (bin.ledger || Object.values(bin)[0]));
        if (target && existsSync(join(dir, target))) return `node ${join(dir, target).slice(TREE.length + 1)} ${m[1]}`.trim();
      }
      return `node bin/ledger.mjs ${m[1]}`.trim();
    }
    try {
      for (const m of md.matchAll(/```(?:bash|sh|shell)?\n([\s\S]*?)```/g)) {
        for (const line of m[1].split('\n')) {
          let cmd = line.trim();
          if (!/^(node\s+bin\/|ledger\s+)/.test(cmd)) continue;
          if (hasPlaceholder(cmd)) { claim(author, 'readme_example', cmd, 'unverifiable', 'command names its inputs by placeholder, not by path'); continue; }
          if (/^ledger\s+/.test(cmd)) cmd = resolveLedgerBin(cmd);
          const needed = neededInputs(cmd);
          if (needed.some((n) => !fencedByLang[n.lang] || !fencedByLang[n.lang].length)) {
            claim(author, 'readme_example', cmd, 'unverifiable', 'README example names an input it never shows');
            continue;
          }
          for (const n of needed) {
            const dest = join(TREE, n.token);
            try { writeFileSync(dest, fencedByLang[n.lang].shift()); created.push(dest); } catch {}
          }
          const r = shCmd(cmd, TREE);
          const verdict = r.error || r.signal ? 'unverifiable' : r.code === 0 ? 'verified' : 'false';
          claim(author, 'readme_example', cmd, verdict, r.error || r.signal ? `did not complete: ${r.signal || r.error}` : `exit ${r.code}`);
        }
      }
    } finally {
      for (const f of created) { try { unlinkSync(f); } catch {} }
    }
  }
}
const claimsVerified = claims.filter((c) => c.verdict === 'verified').length;
const claimsFalse = claims.filter((c) => c.verdict === 'false').length;
const claimsUnverifiable = claims.filter((c) => c.verdict === 'unverifiable').length;

// Wall time comes from the runner's start/exit stamps: a session's own duration_ms turned out
// not to cover the time its sub-agents ran (a 2h23m resume reported 1.9 minutes).
{
  const stamps = (read(`${WS}.start.txt`) || '').split('\n');
  let start = null, wall = 0;
  for (const line of stamps) {
    const m = line.match(/^(\S+) (resume \d+ exit|resume \d+|start|exit) ?/);
    if (!m) continue;
    const t = Date.parse(m[1]);
    if (/^(start|resume \d+)$/.test(m[2].trim())) start = t;
    else if (start) { wall += t - start; start = null; }
  }
  if (wall) meta.wall_ms = wall;
}

// ---------- judge criteria: report these alongside the rubric line, never folded into
// passed/of - they measure the harness's own judging behaviour (did a gate reject anything, did
// it run checks before accepting, did anything get repaired, what did the run cost), not what
// the tree contains. A `none` session has no harness nodes at all, so these come back 0/n-a
// rather than skewing the rubric that the fixture criteria above already cover.
const isJudgeNode = (n) => /^gate|^accept|^critique|^review/.test(n.node_id) || ['gate', 'accept', 'critique', 'review'].includes(n.stage);
const judgeNodes = harnessNodes.filter(isJudgeNode);
const gateRejections = harnessNodes.filter((n) => n.result && (n.result.accept === false || n.result.stage_ok === false)).length;
const judgesWithChecks = judgeNodes.filter((n) => (Array.isArray(n.result?.checks) && n.result.checks.length) || (Array.isArray(n.result?.attacks) && n.result.attacks.length)).length;
// "repairs": nodes on an explicit repair stage/id, plus packages opened under a repackage
// generation (R<n>) - the two shapes a seam fix can currently take (see README: repackage is
// the repair path a seam defect needs; tm_retry alone resends work to a worktree that cannot see
// the seam).
const repairNodes = harnessNodes.filter((n) => /^repair/i.test(n.node_id) || n.stage === 'repair').length;
const repairPackages = harness.tasks.reduce((n, t) => n + t.packages.filter((p) => /^R\d+/i.test(String(p.id))).length, 0);

// seam_detected: did any gate/critique/review/report node's own words - or, for a plain session
// with no harness nodes, the driving session's own prose - mention the cross-cutting constraint
// this case's criteria check. Per-case keyword lists; a case with none defined reports 'n/a'
// rather than a manufactured false.
const SEAM_KEYWORDS = {
  seam: ['exit code', 'exit-code', 'exitcode', 'exit_codes', 'error code', 'error-code', 'codes table', 'packages/codes', 'shared table', 'seam'],
  'seam-flat': ['exit code', 'exit-code', 'exitcode', 'exit_codes', 'error code', 'error-code', 'codes table', 'codes.mjs', 'shared table', 'seam'],
};
const seamKeywords = SEAM_KEYWORDS[CASE] || [];
const nodeText = (n) => [n.result?.reason, n.result?.handoff, ...(n.result?.checks || []), ...(n.result?.attacks || []), ...(n.result?.gaps || []), ...(n.result?.problems || [])].filter((x) => typeof x === 'string').join(' \n ');
const judgeLikeText = harnessNodes.filter((n) => /^gate|^critique|^report/.test(n.node_id) || ['gate', 'critique', 'report'].includes(n.stage)).map(nodeText).join(' \n ').toLowerCase();
const seamHay = judgeLikeText + ' \n ' + sessionText.toLowerCase();
const seamDetected = seamKeywords.some((kw) => seamHay.includes(kw));

const judgeStats = {
  seam_detected: seamKeywords.length ? seamDetected : 'n/a',
  gate_rejections: gateRejections,
  judges_with_checks: `${judgesWithChecks}/${judgeNodes.length}`,
  repairs: repairNodes + repairPackages,
  cost_usd: typeof meta.cost_usd === 'number' ? +meta.cost_usd.toFixed(2) : null,
  turns: meta.turns ?? null,
  minutes: meta.wall_ms ? Math.round(meta.wall_ms / 60000) : (meta.duration_ms ? Math.round(meta.duration_ms / 60000) : null),
};

// `decomposition` is metadata about how the manager split the work, not a scored criterion - a
// task that decomposes cleanly but misses the goal must not borrow a passing point from the
// split. `goal_met` (and any other judge-backed criterion whose judge call failed) must count
// identically for both arms: a 'judge-failed' value is graded as not-passed, not dropped from
// the denominator - dropping it is what let the teams arm's `decomposition` stand in as its
// sixth criterion while its real sixth (`goal_met: 'judge-failed'`) went uncounted.
const bools = Object.entries(crit)
  .filter(([k]) => k !== 'decomposition')
  .map(([k, v]) => [k, v === 'judge-failed' ? false : v])
  .filter(([, v]) => typeof v === 'boolean');
const score = {
  case: CASE, workspace: WS, tree: TREE === WS ? '.' : TREE.slice(WS.length + 1), passed: bools.filter(([, v]) => v).length, of: bools.length,
  criteria: crit, session: meta, drivers, total, harness, judge: judgeStats,
  claims: { total: claims.length, verified: claimsVerified, false: claimsFalse, unverifiable: claimsUnverifiable, items: claims },
};
writeFileSync(`${WS}.score.json`, JSON.stringify(score, null, 2));
const fails = bools.filter(([, v]) => !v).map(([k]) => (crit[k] === 'judge-failed' ? `${k}(judge-failed)` : k)).join(',') || '-';
const t = harness.tasks[0];
console.log(`${basename(WS)} | ${score.passed}/${score.of} | fail: ${fails} | ${meta.wall_ms ? Math.round(meta.wall_ms / 60000) + 'min' : meta.duration_ms ? Math.round(meta.duration_ms / 60000) + 'min(api)' : '?'} | TOTAL=$${total.cost_usd.toFixed(2)} (session=$${typeof meta.cost_usd === 'number' ? meta.cost_usd.toFixed(2) : '?'} +drivers[${drivers.sessions}]=$${drivers.cost_usd.toFixed(2)}) | false ${claimsFalse}/${claims.length} | turns total=${total.turns} (session ${meta.turns ?? '?'}+drivers ${drivers.turns}) | task ${t?.verdict ?? t?.state ?? '-'} size ${t?.size ?? '-'} pkgs ${t?.packages?.length ?? '-'} | runs ${harness.runs.length} | top-level edits ${meta.top_level_edits} | tree ${score.tree}`);
console.log(`  judge: seam_detected=${judgeStats.seam_detected} gate_rejections=${judgeStats.gate_rejections} judges_with_checks=${judgeStats.judges_with_checks} repairs=${judgeStats.repairs} cost=$${judgeStats.cost_usd ?? '?'} turns=${judgeStats.turns ?? '?'} minutes=${judgeStats.minutes ?? '?'}`);
console.log(`JUDGE: ${JSON.stringify(judgeStats)}`);
