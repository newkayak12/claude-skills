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
//
// Readouts (exit 0, or 2 on a caller error; never a run verdict):
//   --now <RUN_DIR> '<json>'            write RUN_DIR/now.json
//   --list [--cwd DIR] [--json]         open runs of this worktree
//   --show <RUN_DIR> --json             one run, same row shape as --list
//
// Shared contract (the harness mod and codex read these shapes; change them only together):
// - now.json = {stage, doing, round, last_step, next, waiting, cost_usd, at, since}. The input
//   needs a non-empty string stage; every other key defaults to null. waiting is null or
//   {who:'you'|'vendor', what:string}, and any other value is rejected (only 'you' means the run
//   waits on a person). last_step is cut to 120 chars. cost_usd is a number or null, shown as
//   '—' when null. at is stamped on every call; since is kept while stage is unchanged and reset
//   when it changes. at/since in the input are ignored. Written to a temp file, then renamed;
//   a rejected input writes nothing.
// - Open run: a manifest, no 05-report.md, newest file (run dir and subgoals/) under 12 h; 2-12 h
//   is stalled. Root is the git toplevel of --cwd, else --cwd. .harness-run/broker is not a run.
// - Row = {slug, dir, stage, round, waiting, stalled, now, started_at, max_critique_rounds,
//   severity, rounds, passed, failed, total}. stage = now.stage when now.json is a valid object
//   with a known stage and an `at` not older than the newest artifact of the run (now.json
//   excluded), with now.stage 'test' read as implement; otherwise it is derived from the files
//   (plan, setgoal, critique, implement, gate, report). round = now.round, else the number of
//   critique rounds, else null. waiting = now.waiting or null. now = parsed now.json or null.
//   started_at = manifest.started_at or null (never backfilled). max_critique_rounds =
//   manifest.max_critique_rounds, default 2. severity = {blocker, major, minor, nit}, always all
//   four counts, over the problems of every critique round in rounds[].
// - rounds[] = [{round, file, sound, problems:[{severity, text}]}], oldest first. 02-critique.json
//   is the newest; 02-critique.r<n>.json are older and get round n; the newest gets one more
//   than the highest n. severity is one of blocker|major|minor|nit: a severity field is kept
//   (case-insensitive), a bare string or a problem without one is read from its text prefix
//   ('Nit:', 'Blocker -'), and anything unrecognised is major.

import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const SEVERITIES = ['blocker', 'major', 'minor', 'nit'];
const STALLED_MS = 2 * 3600 * 1000;
const OPEN_MS = 12 * 3600 * 1000;
const LAST_STEP_MAX = 120;

const fail2 = (msg) => {
  process.stderr.write(`${msg}\n`);
  process.exit(2);
};
const readJsonFile = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};
const isDir = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};
const fmtCost = (c) => (typeof c === 'number' ? c.toFixed(2) : '—');

function cmdNow(runDir, raw) {
  if (!runDir || raw === undefined) fail2("usage: node fallback-check.mjs --now <RUN_DIR> '<json>'");
  if (!isDir(runDir)) fail2(`run directory not found: ${runDir}`);
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    fail2(`--now: not JSON: ${e && e.message}`);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail2('--now: expected a JSON object');
  if (typeof input.stage !== 'string' || !input.stage.trim()) fail2('--now: stage must be a non-empty string');
  const w = input.waiting ?? null;
  if (w !== null && !(typeof w === 'object' && !Array.isArray(w) && ['you', 'vendor'].includes(w.who) && typeof w.what === 'string'))
    fail2("--now: waiting must be null or {who:'you'|'vendor', what:string}");
  if (input.cost_usd != null && typeof input.cost_usd !== 'number') fail2('--now: cost_usd must be a number or null');
  if (input.round != null && !Number.isInteger(input.round)) fail2('--now: round must be an integer or null');
  const str = (v) => (v == null ? null : String(v));
  const at = new Date().toISOString();
  const prev = readJsonFile(join(runDir, 'now.json'));
  const out = {
    stage: input.stage,
    doing: str(input.doing),
    round: input.round ?? null,
    last_step: input.last_step == null ? null : String(input.last_step).slice(0, LAST_STEP_MAX),
    next: str(input.next),
    waiting: w === null ? null : { who: w.who, what: w.what },
    cost_usd: input.cost_usd ?? null,
    at,
    since: prev && prev.stage === input.stage && typeof prev.since === 'string' ? prev.since : at,
  };
  const target = join(runDir, 'now.json');
  const tmp = `${target}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(out)}\n`);
    renameSync(tmp, target);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* no temp file was written */
    }
    fail2(`--now: cannot write ${target}: ${e && e.message}`);
  }
  process.stdout.write(`now: ${out.stage} · ${out.doing ?? '—'} · round ${out.round ?? '—'} · cost ${fmtCost(out.cost_usd)}\n`);
  process.exit(0);
}

const severityOf = (value, text) => {
  if (typeof value === 'string' && SEVERITIES.includes(value.trim().toLowerCase())) return value.trim().toLowerCase();
  if (typeof value !== 'string') {
    const m = /^\s*\[?(blocker|major|minor|nit)\s*[:\]\-—–)]/i.exec(text);
    if (m) return m[1].toLowerCase();
  }
  return 'major';
};
const normalizeProblem = (p) => {
  if (p && typeof p === 'object') {
    const text = String(p.text ?? p.problem ?? p.description ?? p.reason ?? '');
    return { severity: severityOf(p.severity, text), text };
  }
  const text = String(p ?? '');
  return { severity: severityOf(undefined, text), text };
};

const critiqueRounds = (dir, names) => {
  const older = names
    .map((f) => ({ f, m: /^02-critique\.r(\d+)\.json$/.exec(f) }))
    .filter((x) => x.m)
    .map((x) => ({ file: x.f, round: Number(x.m[1]) }))
    .sort((a, b) => a.round - b.round);
  const files = [...older];
  if (names.includes('02-critique.json')) files.push({ file: '02-critique.json', round: (older.length ? older[older.length - 1].round : 0) + 1 });
  return files.map(({ file, round }) => {
    const c = readJsonFile(join(dir, file));
    return {
      round,
      file,
      sound: typeof c?.sound === 'boolean' ? c.sound : null,
      problems: Array.isArray(c?.problems) ? c.problems.map(normalizeProblem) : [],
    };
  });
};

// now.json names the stage only while it is at least as new as the run's newest artifact (now.json
// itself excluded); an artifact written after the call means the run has moved on, so the files win.
const NOW_STAGES = ['plan', 'setgoal', 'critique', 'implement', 'test', 'gate', 'report'];
const reconcileStage = (nowJson, derived, artifactMs) => {
  if (!nowJson || typeof nowJson !== 'object' || Array.isArray(nowJson)) return derived;
  if (typeof nowJson.stage !== 'string' || !NOW_STAGES.includes(nowJson.stage)) return derived;
  const at = Date.parse(nowJson.at);
  if (Number.isNaN(at) || at < artifactMs) return derived;
  return nowJson.stage === 'test' ? 'implement' : nowJson.stage;
};

function buildRow(dir, nowMs) {
  const names = readdirSync(dir);
  const has = (n) => names.includes(n);
  const subs = (() => {
    try {
      return readdirSync(join(dir, 'subgoals'));
    } catch {
      return [];
    }
  })();
  const mtimes = [
    ...names.map((n) => statSync(join(dir, n)).mtimeMs),
    ...subs.map((n) => statSync(join(dir, 'subgoals', n)).mtimeMs),
  ];
  const age = nowMs - Math.max(0, ...mtimes);
  const manifest = readJsonFile(join(dir, 'manifest.json'));
  const spec = readJsonFile(join(dir, '02-goal-spec.json'));
  const rounds = critiqueRounds(dir, names);
  const newest = rounds.length ? rounds[rounds.length - 1] : null;
  const ids = (Array.isArray(spec?.subgoals) ? spec.subgoals : []).map((s) => String(s && s.id));
  let passed = 0;
  let failed = 0;
  for (const id of ids) {
    const r = readJsonFile(join(dir, 'subgoals', id, 'result.json'));
    if (r?.passed === true) passed++;
    else if (r?.passed === false) failed++;
  }
  const derived = !has('01-plan.md') ? 'plan'
    : !spec ? 'setgoal'
    : newest?.file !== '02-critique.json' || newest.sound !== true ? 'critique'
    : passed + failed < ids.length ? 'implement'
    : !has('04-goal-gate.json') ? 'gate'
    : 'report';
  const nowJson = readJsonFile(join(dir, 'now.json'));
  const artifactMs = Math.max(
    0,
    ...names.filter((n) => n !== 'now.json' && !n.startsWith('now.json.tmp-')).map((n) => statSync(join(dir, n)).mtimeMs),
    ...subs.map((n) => statSync(join(dir, 'subgoals', n)).mtimeMs),
  );
  const severity = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const rd of rounds) for (const pr of rd.problems) severity[pr.severity]++;
  const cap = manifest?.max_critique_rounds;
  return {
    slug: basename(dir),
    dir,
    stage: reconcileStage(nowJson, derived, artifactMs),
    round: Number.isInteger(nowJson?.round) ? nowJson.round : rounds.length ? newest.round : null,
    waiting: nowJson?.waiting ?? null,
    stalled: age > STALLED_MS && age <= OPEN_MS,
    now: nowJson,
    started_at: typeof manifest?.started_at === 'string' ? manifest.started_at : null,
    max_critique_rounds: Number.isInteger(cap) && cap >= 1 ? cap : 2,
    severity,
    rounds,
    passed,
    failed,
    total: ids.length,
    _age: age,
  };
}
const publicRow = ({ _age, ...row }) => row;

function cmdList(args) {
  let cwd = process.cwd();
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd' && args[i + 1]) cwd = args[++i];
    else if (args[i] === '--json') json = true;
    else fail2('usage: node fallback-check.mjs --list [--cwd DIR] [--json]');
  }
  cwd = resolve(cwd);
  if (!isDir(cwd)) fail2(`directory not found: ${cwd}`);
  const top = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const root = top.status === 0 && top.stdout.trim() ? top.stdout.trim() : cwd;
  const base = join(root, '.harness-run');
  const nowMs = Date.now();
  const rows = [];
  let slugs = [];
  try {
    slugs = readdirSync(base);
  } catch {
    /* no runs here */
  }
  for (const slug of slugs) {
    const dir = join(base, slug);
    if (slug === 'broker' || !isDir(dir) || !existsSync(join(dir, 'manifest.json')) || existsSync(join(dir, '05-report.md'))) continue;
    const row = buildRow(dir, nowMs);
    if (row._age <= OPEN_MS) rows.push(row);
  }
  rows.sort((a, b) => a._age - b._age || a.slug.localeCompare(b.slug));
  if (json) process.stdout.write(`${JSON.stringify(rows.map(publicRow), null, 2)}\n`);
  else if (rows.length === 0) process.stdout.write('no open runs\n');
  else
    for (const r of rows) {
      const w = r.waiting ? `${r.waiting.who}: ${r.waiting.what}` : '—';
      process.stdout.write(
        `${r.slug}\t${r.stage}\tround ${r.round ?? '—'}\twaiting ${w}\tcost ${fmtCost(r.now?.cost_usd)}${r.stalled ? '\tstalled' : ''}\n`,
      );
    }
  process.exit(0);
}

function cmdShow(args) {
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir || !args.includes('--json')) fail2('usage: node fallback-check.mjs --show <RUN_DIR> --json');
  if (!isDir(dir)) fail2(`run directory not found: ${dir}`);
  process.stdout.write(`${JSON.stringify(publicRow(buildRow(realpathSync(dir), Date.now())), null, 2)}\n`);
  process.exit(0);
}

if (process.argv[2] === '--now') cmdNow(process.argv[3], process.argv[4]);
if (process.argv[2] === '--list') cmdList(process.argv.slice(3));
if (process.argv[2] === '--show') cmdShow(process.argv.slice(3));

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
  if (titles.some((t) => /^(tbd|todo|placeholder|title)\W*$/i.test(t.trim())))
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
else if (gg.value.match_pct <= 0) p('04-goal-gate.json: match_pct is 0 — no criteria met');

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
