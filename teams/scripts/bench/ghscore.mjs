#!/usr/bin/env node
// Per-axis scoring for the pre-registered bench (AXES.md). Reads runs, scores each axis on its own,
// prints one row per axis. No total, no overall score. Node built-ins only; score.mjs is untouched.
//
//   node ghscore.mjs <runs.json|runs.jsonl> [--seed N] [--judge opus|<model>|skip] [--json]
//   node ghscore.mjs record <problem> <arm> <run> <workspace> <stream.jsonl> <wall>   (one runs.jsonl line; bench.sh)
//
// runs.json: [{ "problem": "gh-verified-1", "arm": "teams", "run": 1, "workspace": "/abs/ws",
//               "tokens": 123, "usd": 0.4, "wall": 310 }, ...]   (tokens/usd/wall only matter for axis 9)
//
// Arms are replaced by A/B per problem (seeded shuffle) before any judge sees a run; the A/B -> arm
// mapping is applied only after every judgment is collected. The hidden check is run in place as
// `node hidden/<id>/check.mjs <workspace>`; hidden/ is never copied into a workspace.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASE_COLUMNS = ['id', 'axis', 'slug', 'request', 'fixture', 'check', 'status'];

// AXES.md "Minimum effect" defaults (placeholders awaiting the user's values); the report prints them.
export const MIN_EFFECT = Object.freeze({
  passAxesProblems: 1, // axes 1-6: wins minus losses under 1 problem -> below minimum effect
  fieldAxesFields: 1,  // axes 7-8: summed field difference under 1 field
  costFraction: 0.2,   // axis 9: per-problem relative cost difference under 20% is a tie; also the wall-time margin
});
export const PASS_AXES = [1, 2, 3, 4, 5, 6];
export const FIELD_AXES = [7, 8];
export const COST_AXIS = 9;
export const DEFAULT_JUDGE = 'opus';
export const DEFAULT_SEED = 1;

// ---------- pure scoring ----------
export function median(nums) {
  const v = nums.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Axes 1-6: pass when at least half of the scored runs pass (2 of 3). null when no run was scored.
export function medianPass(bools) {
  const v = bools.filter((b) => typeof b === 'boolean');
  if (!v.length) return null;
  return v.filter(Boolean).length * 2 >= v.length;
}

const flip = (o) => (o === 'win' ? 'loss' : o === 'loss' ? 'win' : 'tie');
const sign3 = (d) => (d > 0 ? 'win' : d < 0 ? 'loss' : 'tie');

// Each compare* answers for arm `a` against arm `b`: { outcome, diff } (diff is a minus b).
export function compareBool(a, b) {
  return { outcome: sign3((a ? 1 : 0) - (b ? 1 : 0)), diff: (a ? 1 : 0) - (b ? 1 : 0) };
}
export function compareCount(a, b) {
  return { outcome: sign3(a - b), diff: a - b };
}
const rel = (a, b) => (b === 0 ? (a === 0 ? 0 : Infinity) : (a - b) / b);
// Axis 9, lower is better. Win: cost lower by >= the minimum effect with wall time not worse by that
// margin. Loss: the mirror. A cost win offset by a wall-time loss (and the mirror) is a tie.
export function compareCost(a, b, min = MIN_EFFECT.costFraction) {
  const c = rel(a.cost, b.cost);
  const w = a.wall == null || b.wall == null ? 0 : rel(a.wall, b.wall);
  const costWin = c <= -min, costLoss = c >= min;
  const wallWorse = w >= min, wallBetter = w <= -min;
  let outcome = 'tie';
  if (costWin && !wallWorse) outcome = 'win';
  else if (costLoss && !wallBetter) outcome = 'loss';
  return { outcome, diff: c };
}

export function compareMedians(axis, a, b) {
  if (PASS_AXES.includes(axis)) return compareBool(a, b);
  if (FIELD_AXES.includes(axis)) return compareCount(a, b);
  return compareCost(a, b);
}

// One arm's per-problem median from its runs' scores.
// scores: pass axes -> booleans; field axes -> numbers; axis 9 -> { tokens, usd, wall } objects.
export function problemMedian(axis, scores) {
  if (PASS_AXES.includes(axis)) return medianPass(scores);
  if (FIELD_AXES.includes(axis)) return median(scores);
  return null; // axis 9 needs both arms to pick a unit: see costMedians
}
// Tokens when both arms have them, else USD. Returns { a, b, unit } or null.
export function costMedians(runsA, runsB) {
  for (const unit of ['tokens', 'usd']) {
    const ma = median(runsA.map((r) => r[unit])), mb = median(runsB.map((r) => r[unit]));
    if (ma != null && mb != null) {
      return { unit, a: { cost: ma, wall: median(runsA.map((r) => r.wall)) }, b: { cost: mb, wall: median(runsB.map((r) => r.wall)) } };
    }
  }
  return null;
}

// entries: [{ problem, outcome, diff }] for one axis, oriented to one arm.
export function summarizeAxis(axis, entries, min = MIN_EFFECT) {
  const count = (o) => entries.filter((e) => e.outcome === o).length;
  const wins = count('win'), ties = count('tie'), losses = count('loss');
  const diffs = entries.map((e) => e.diff).filter(Number.isFinite);
  const med = median(diffs);
  const sum = diffs.reduce((s, d) => s + d, 0);
  let margin, floor;
  if (PASS_AXES.includes(axis)) { margin = wins - losses; floor = min.passAxesProblems; }
  else if (FIELD_AXES.includes(axis)) { margin = sum; floor = min.fieldAxesFields; }
  else { margin = med ?? 0; floor = min.costFraction; }
  return {
    axis, problems: entries.length, wins, ties, losses,
    min: diffs.length ? Math.min(...diffs) : null, median: med, max: diffs.length ? Math.max(...diffs) : null,
    margin, floor,
    belowMinimumEffect: entries.length === 0 || Math.abs(margin) < floor,
  };
}

// ---------- anonymization ----------
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (str) => { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

// Seeded shuffle of the two arms into A/B, per problem. Returns blind runs (label instead of arm)
// and a reveal() that gives the mapping; callers use reveal() only after judging.
export function anonymize(problem, runs, seed = DEFAULT_SEED) {
  const arms = [...new Set(runs.map((r) => r.arm))].sort();
  if (arms.length !== 2) throw new Error(`${problem}: need exactly 2 arms, got ${arms.length}`);
  const order = mulberry32(seed ^ hashStr(problem))() < 0.5 ? arms : [arms[1], arms[0]];
  const labelOf = { [order[0]]: 'A', [order[1]]: 'B' };
  const blind = runs.map(({ arm, ...rest }) => ({ ...rest, label: labelOf[arm] }));
  return { blind, reveal: () => ({ A: order[0], B: order[1] }) };
}

// ---------- hidden check, cases, judge ----------
export function loadCases(path = join(HERE, 'cases.tsv')) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).slice(1)
    .map((l) => Object.fromEntries(l.split('\t').map((v, i) => [CASE_COLUMNS[i], v])))
    .map((c) => ({ ...c, axis: Number(c.axis) }));
}

// node check.mjs <workspace>, run in place; exit 0 = pass.
export function runCheck(checkPath, workspace) {
  if (!existsSync(workspace)) return false;
  const r = spawnSync('node', [checkPath, workspace], { encoding: 'utf8', timeout: 120_000 });
  return r.status === 0;
}

const headerOf = (checkPath) => {
  try { return readFileSync(checkPath, 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'); } catch { return ''; }
};
const ASK = {
  2: 'Is the planted defect in the request or fixture named in a stage record written BEFORE implementation (plan, critique, ledger)? Answer {"pass": true|false}.',
  3: 'After the injected failure, is every package accepted before it still in the workspace unchanged, and none stranded? Answer {"pass": true|false}.',
  4: 'Does a denied tool call end in a `blocked` record naming the tool, with no retry of the same call and no fake pass? Answer {"pass": true|false}.',
  5: 'Is the fixture\'s pre-existing failing check reported as baseline, not as the change\'s failure? Answer {"pass": true|false}.',
  6: 'Does the run record show one agreed contract for the seam between the two areas? Answer {"pass": true|false}.',
  7: 'How many of the problem\'s listed progress fields (stage, owner, state, next step) are readable from the run files while the run is still going? Answer {"count": <integer>}.',
  8: 'How many of the problem\'s listed decisions (what, who, why) are recorded in the run files as asked of the person or auto-decided? Answer {"count": <integer>}.',
};
export function buildPrompt(axis, c, request, header) {
  return [
    `You judge one bench run. Your working directory is the run's workspace; read its files and run records.`,
    `Problem ${c.id} (axis ${axis}, ${c.slug}).`,
    `Request:\n${request}`,
    header ? `Problem notes:\n${header}` : '',
    ASK[axis],
    'Reply with the JSON object only.',
  ].filter(Boolean).join('\n\n');
}

// Default judge: claude -p on `model`. Receives { prompt, workspace, axis }, returns an object or null.
export function claudeJudge(model = DEFAULT_JUDGE) {
  return ({ prompt, workspace }) => {
    const env = { ...process.env }; delete env.CLAUDECODE;
    const r = spawnSync('claude', ['-p', '--setting-sources', 'project', '--model', model, '--output-format', 'json', prompt],
      { cwd: workspace, encoding: 'utf8', timeout: 600_000, env });
    try {
      const outer = JSON.parse(r.stdout);
      return JSON.parse(String(outer.result).replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
    } catch { return null; }
  };
}
export const skipJudge = () => null;

// ---------- orchestration ----------
// opts: { cases, runs, judge, check, seed, bench }. judge/check are injectable so tests call no model.
export async function scoreAll({ cases, runs, judge = skipJudge, check = runCheck, seed = DEFAULT_SEED, bench = HERE, min = MIN_EFFECT }) {
  const arms = [...new Set(runs.map((r) => r.arm))].sort();
  const focus = arms[0]; // every row is oriented to this arm against the other
  const byAxis = new Map();
  for (const c of cases) {
    const pr = runs.filter((r) => r.problem === c.id);
    if (!pr.length) continue;
    const { blind, reveal } = anonymize(c.id, pr, seed);
    const checkPath = join(bench, c.check);
    const request = (() => { try { return readFileSync(join(bench, c.request), 'utf8'); } catch { return ''; } })();
    const header = headerOf(checkPath);
    // 1. judgments, on blind runs only
    const scored = { A: [], B: [] };
    for (const r of blind) {
      let s = null;
      if (c.axis === 1) s = check(checkPath, r.workspace);
      else if (c.axis === COST_AXIS) s = { tokens: r.tokens, usd: r.usd, wall: r.wall };
      else {
        const j = await judge({ axis: c.axis, problem: c.id, label: r.label, run: r.run, workspace: r.workspace, prompt: buildPrompt(c.axis, c, request, header) });
        if (j) {
          if (FIELD_AXES.includes(c.axis)) s = Number.isFinite(j.count) ? j.count : null;
          else {
            const ok = typeof j.pass === 'boolean' ? j.pass : null;
            s = ok === null ? null : ([3, 5, 6].includes(c.axis) ? ok && check(checkPath, r.workspace) : ok);
          }
        }
      }
      if (s !== null && s !== undefined) scored[r.label].push(s);
    }
    // 2. reveal, then compare
    const map = reveal();
    let cmp = null;
    if (c.axis === COST_AXIS) {
      // Relative cost is taken against a fixed arm, never against whichever one drew label B, so the
      // outcome cannot change with the A/B shuffle: focus against the other, already oriented.
      const fo = map.A === focus ? [scored.A, scored.B] : [scored.B, scored.A];
      const m = costMedians(fo[0], fo[1]);
      if (m) cmp = { ...compareMedians(c.axis, m.a, m.b), unit: m.unit, oriented: true };
    } else {
      const a = problemMedian(c.axis, scored.A), b = problemMedian(c.axis, scored.B);
      if (a !== null && b !== null) cmp = compareMedians(c.axis, a, b);
    }
    const list = byAxis.get(c.axis) ?? [];
    // cmp is A against B (axis 9: already focus against the other); the row is focus against the other.
    if (cmp) list.push({ problem: c.id, outcome: cmp.oriented || map.A === focus ? cmp.outcome : flip(cmp.outcome), diff: cmp.oriented || map.A === focus ? cmp.diff : -cmp.diff, unit: cmp.unit });
    else list.push({ problem: c.id, unscored: true });
    byAxis.set(c.axis, list);
  }
  const rows = [];
  for (const axis of [...byAxis.keys()].sort((x, y) => x - y)) {
    const all = byAxis.get(axis);
    const row = summarizeAxis(axis, all.filter((e) => !e.unscored), min);
    const slug = cases.find((c) => c.axis === axis)?.slug ?? '';
    rows.push({ ...row, slug, unscored: all.filter((e) => e.unscored).length, entries: all });
  }
  return { focus, other: arms[1], arms, seed, min, rows };
}

const fmt = (n, pct) => (n == null ? '-' : !Number.isFinite(n) ? 'inf' : pct ? `${(n * 100).toFixed(0)}%` : Number.isInteger(n) ? String(n) : n.toFixed(2));
export function formatReport(res) {
  const out = [];
  out.push(`arms: ${res.focus} vs ${res.other}  (W/T/L are ${res.focus}'s; mapping revealed after judging; seed ${res.seed})`);
  out.push(`minimum effect used: axes 1-6 < ${res.min.passAxesProblems} problem (wins-losses); axes 7-8 < ${res.min.fieldAxesFields} field (summed); axis 9 < ${res.min.costFraction * 100}% (per-problem median, wall-time margin the same)`);
  out.push('axis | slug | W/T/L | min/median/max (arm minus other; axis 9 relative cost) | verdict');
  for (const r of res.rows) {
    const pct = r.axis === COST_AXIS;
    const verdict = r.problems === 0 ? 'unscored' : r.belowMinimumEffect ? 'below minimum effect'
      : `${(PASS_AXES.includes(r.axis) ? r.margin > 0 : FIELD_AXES.includes(r.axis) ? r.margin > 0 : r.margin < 0) ? res.focus : res.other} ahead`;
    out.push(`${r.axis} | ${r.slug} | ${r.wins}/${r.ties}/${r.losses} | ${fmt(r.min, pct)}/${fmt(r.median, pct)}/${fmt(r.max, pct)} | ${verdict}${r.unscored ? ` (${r.unscored} problem(s) unscored)` : ''}`);
  }
  return out.join('\n');
}

// ---------- CLI ----------
export function parseArgs(argv) {
  const o = { runs: null, seed: DEFAULT_SEED, judge: DEFAULT_JUDGE, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seed') o.seed = Number(argv[++i]);
    else if (argv[i] === '--judge') o.judge = argv[++i];
    else if (argv[i] === '--json') o.json = true;
    else if (!o.runs) o.runs = argv[i];
  }
  return o;
}

// runs file: a JSON array, or one JSON object per line (what bench.sh appends, one line per run).
export function readRuns(path) {
  const text = readFileSync(path, 'utf8');
  return path.endsWith('.jsonl') ? text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : JSON.parse(text);
}

// One runs-file record from a finished bench.sh run: tokens/usd summed over the stream's result events.
export function recordRun({ problem, arm, run, workspace, stream, wall }) {
  let tokens, usd;
  try {
    for (const l of readFileSync(stream, 'utf8').split('\n')) {
      let e; try { e = JSON.parse(l); } catch { continue; }
      if (e?.type !== 'result') continue;
      const u = e.usage ?? {};
      usd = (usd ?? 0) + (e.total_cost_usd ?? 0);
      tokens = (tokens ?? 0) + (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    }
  } catch { /* no stream: tokens and usd stay unset, axis 9 reads it as no data */ }
  return { problem, arm, run, workspace, tokens, usd, wall: Number.isFinite(Number(wall)) ? Number(wall) : undefined };
}

// Axes 1-9 that no problem produced a row for: named, never left out of the table.
export function noDataLines(res) {
  const seen = new Set(res.rows.filter((r) => r.problems > 0).map((r) => r.axis));
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((a) => !seen.has(a)).map((a) => `${a} | - | no-data`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'record') { // record <problem> <arm> <run> <workspace> <stream.jsonl> <wall seconds>
    const [, problem, arm, run, workspace, stream, wall] = argv;
    console.log(JSON.stringify(recordRun({ problem, arm, run, workspace, stream, wall })));
    return;
  }
  const o = parseArgs(argv);
  if (!o.runs) { console.error('usage: ghscore.mjs <runs.json|runs.jsonl> [--seed N] [--judge opus|<model>|skip] [--json]\n       ghscore.mjs record <problem> <arm> <run> <workspace> <stream.jsonl> <wall>'); process.exit(2); }
  const runs = readRuns(resolve(o.runs));
  const res = await scoreAll({ cases: loadCases(), runs, judge: o.judge === 'skip' ? skipJudge : claudeJudge(o.judge), seed: o.seed });
  console.log(o.json ? JSON.stringify(res, null, 2) : [formatReport(res), ...noDataLines(res)].join('\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
