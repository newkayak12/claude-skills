// F3 contract (card 125): `view.mjs --once` changes only by addition, and the pane judges nothing.
//  - fixtures/view-once-keys.json holds the key sets (nested, arrays collapsed to "[]") of every --once format
//    and the text lines of the two text formats, taken on a deterministic synthetic task before F3 changed any
//    behaviour. The live output must keep every one of them: keys and lines may be added, never removed or renamed.
//  - view-once-golden.json (test-view-once-perf.mjs) may change only by additions or by the values of state, pct
//    and cost.usd; checked against the base commit when git has it.
//  - teams/hooks/{mod.tsx,pane.ts,teams-draw.tsx} never read an mtime or a pid: the engine's state says stalled.
//
//   node --test teams/scripts/test-view-f3-contract.mjs
//   F3_KEYS_DUMP=<file> node teams/scripts/test-view-f3-contract.mjs   (write the live key sets to <file>)
process.env.TEAMS_RUNS_DIR ??= 'off';
process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node } from '../mcp/graph.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VIEW = join(HERE, 'view.mjs');
const KEYS = join(HERE, 'fixtures', 'view-once-keys.json');
const GOLDEN = join(HERE, 'fixtures', 'view-once-golden.json');
const BASE_COMMIT = '2c76a7f0';
const DEAD_PID = 2 ** 22 + 991;
const HOUR = 3600 * 1000;

// ---- key sets -------------------------------------------------------------------------------------------

// value -> trie: an object maps each key to its trie, an array maps "[]" to the merge of its elements, a leaf is 0.
function mergeTrie(a, b) {
  if (a === 0 && b === 0) return 0;
  const out = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) out[k] = mergeTrie(a && a[k] !== undefined ? a[k] : 0, b && b[k] !== undefined ? b[k] : 0);
  return out;
}
function trieOf(v) {
  if (Array.isArray(v)) return { '[]': v.reduce((acc, e) => mergeTrie(acc, trieOf(e)), 0) };
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, trieOf(v[k])]));
  return 0;
}
const triePaths = (t, prefix = '') => (t && typeof t === 'object'
  ? Object.keys(t).flatMap((k) => [`${prefix}${k}`, ...triePaths(t[k], `${prefix}${k}.`)])
  : []);

// The additions-only rule on key sets: every old path is still there.
const missingPaths = (oldTrie, curTrie) => {
  const have = new Set(triePaths(curTrie));
  return triePaths(oldTrie).filter((p) => !have.has(p));
};

// The additions-only rule on two parsed documents (a golden): flatten both to leaf paths; every old path still
// exists and every old leaf keeps its value, except a leaf whose last key is one of `changeable`.
function flatten(v, prefix = '', out = new Map()) {
  if (Array.isArray(v) && v.length) v.forEach((e, i) => flatten(e, `${prefix}${prefix ? '.' : ''}${i}`, out));
  else if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) Object.keys(v).forEach((k) => flatten(v[k], `${prefix}${prefix ? '.' : ''}${k}`, out));
  else out.set(prefix, v);
  return out;
}
function additionsViolations(base, cur, changeable = ['state', 'pct', 'usd']) {
  const b = flatten(base), c = flatten(cur);
  const bad = [];
  for (const [path, val] of b) {
    const kind = (x) => (Array.isArray(x) || (x && typeof x === 'object') ? 'empty' : 'leaf');
    // a base path is kept when cur has it, or cur holds deeper paths under it (an empty container filled in)
    const kept = c.has(path) || [...c.keys()].some((p) => p.startsWith(`${path}.`));
    if (!kept) { bad.push(`removed: ${path}`); continue; }
    if (kind(val) === 'empty' || !c.has(path)) continue;
    if (changeable.includes(path.split('.').pop())) continue;
    if (JSON.stringify(c.get(path)) !== JSON.stringify(val)) bad.push(`changed: ${path}`);
  }
  return bad;
}

// ---- the synthetic task ----------------------------------------------------------------------------------

// One STORY at work with a dead recorded driver whose stream and the ledger are 2 h old: collected as stalled
// whatever F3 does to the verdict. A budget_stopped event and a result-bearing stream give the cost keys.
function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'view-f3-contract-')));
  const cwd = join(root, 'proj');
  const tasks = join(root, 'tasks');
  const id = 'E-aaaaaaaa1111';
  const dir = join(tasks, id);
  mkdirSync(join(dir, 'drivers'), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const t0 = Date.now() - 2 * HOUR;
  const log = join(dir, 'drivers', 'P1.stream.jsonl');
  const child = { run_id: 'child-1', cwd: join(root, 'wt'), driver: { pid: DEAD_PID, log, restarts: [] } };
  const nodes = [
    node('size', 'size', [], { state: 'done' }),
    node('shape', 'shape', ['size'], { state: 'done' }),
    node('critique', 'critique', ['shape'], { state: 'done' }),
    node('dispatch:P1:1', 'dispatch', ['critique'], { state: 'running', subgoal_id: 'P1', child }),
    node('accept:P1:1', 'accept', ['dispatch:P1:1'], { subgoal_id: 'P1' }),
    node('integrate:1', 'integrate', ['accept:P1:1']),
    node('report', 'report', ['integrate:1']),
  ];
  writeFileSync(join(dir, 'task.json'), JSON.stringify({
    run_id: id, kind: 'task', cwd, request: 'build the thing', created_at: t0, store_path: join(dir, 'task.json'), budget_usd: 5,
    spec: { packages: [{ id: 'P1', title: 'one', deps: [] }] }, nodes,
  }));
  writeFileSync(log, `${JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-4', usage: { input_tokens: 10, output_tokens: 5 } } })}\n${JSON.stringify({ type: 'result', total_cost_usd: 0.5, num_turns: 2 })}\n`);
  writeFileSync(join(dir, 'ledger.jsonl'), [{ ts: t0, event: 'node_start', node_id: 'dispatch:P1:1' }, { ts: t0 + 1, event: 'budget_stopped', spend: 0.4 }].map((e) => JSON.stringify(e)).join('\n') + '\n');
  for (const p of [log, join(dir, 'ledger.jsonl'), join(dir, 'task.json')]) utimesSync(p, t0 / 1000, t0 / 1000);
  // A second, finished task with a fresh ledger: the only one whose events the events format reads.
  const done = join(tasks, 'E-bbbbbbbb2222');
  mkdirSync(done, { recursive: true });
  writeFileSync(join(done, 'task.json'), JSON.stringify({
    run_id: 'E-bbbbbbbb2222', kind: 'task', cwd, request: 'finished thing', created_at: Date.now() - 60000, store_path: join(done, 'task.json'),
    nodes: [node('size', 'size', [], { state: 'done' }), node('report', 'report', [], { state: 'done' })],
  }));
  writeFileSync(join(done, 'ledger.jsonl'), [{ ts: Date.now() - 2000, event: 'node_finish', node_id: 'report' }, { ts: Date.now() - 1000, event: 'daemon_done' }].map((e) => JSON.stringify(e)).join('\n') + '\n');
  return { root, cwd, tasks, id, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const run = (w, ...args) => {
  const r = spawnSync(process.execPath, [VIEW, '--once', '--tasks-dir', w.tasks, '--cwd', w.cwd, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

// Wall-clock and path values blanked so a text line is the same on every run; the three values F3 may correct
// (state, pct, cost) are blanked too.
const mask = (s, w) => s.split(w.root).join('<ROOT>')
  .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<TS>').replace(/elapsed=\S+/g, 'elapsed=<E>')
  .replace(/\d+%/g, '<P>%').replace(/[▰▱]+/g, '<BAR>').replace(/\$\d+(\.\d+)?/g, '$<N>').replace(/state=\w+/g, 'state=<S>');
const linesOf = (s, w) => mask(s, w).split('\n').filter((l) => l.trim() !== '');

const JSON_FORMATS = {
  status: (w) => ['--format', 'status'],
  summary: (w) => ['--format', 'summary', '--task', w.id],
  teams: (w) => ['--format', 'teams', '--task', w.id],
  decisions: (w) => ['--format', 'decisions', '--task', w.id],
  report: (w) => ['--format', 'report', '--task', w.id],
  events: (w) => ['--format', 'events', '--since', '0'],
};
const TEXT_FORMATS = {
  board: (w) => ['--format', 'board', '--task', w.id],
  text: (w) => ['--task', w.id],     // the default text view
};

// The live key sets, in the shape of view-once-keys.json. `teams` is stored as what `summary` lacks, because it
// carries summary whole.
function live(w) {
  const json = {};
  for (const [k, args] of Object.entries(JSON_FORMATS)) {
    const out = run(w, ...args(w)).trim();
    json[k] = out ? trieOf(JSON.parse(out.split('\n')[0])) : {};
  }
  const text = {};
  for (const [k, args] of Object.entries(TEXT_FORMATS)) text[k] = linesOf(run(w, ...args(w)), w);
  return { json, text };
}
const withoutSummary = (teams, summary) => {
  const have = new Set(triePaths(summary));
  const strip = (t, prefix) => (t && typeof t === 'object'
    ? Object.fromEntries(Object.keys(t).filter((k) => !have.has(`${prefix}${k}`) || (t[k] && typeof t[k] === 'object')).map((k) => [k, strip(t[k], `${prefix}${k}.`)])
      .filter(([, v]) => !(v && typeof v === 'object' && Object.keys(v).length === 0)))
    : t);
  return strip(teams, '');
};

if (process.env.F3_KEYS_DUMP) {
  const w = world();
  try {
    const l = live(w);
    const json = { ...l.json, teams_extra: withoutSummary(l.json.teams, l.json.summary) };
    delete json.teams;
    writeFileSync(process.env.F3_KEYS_DUMP, JSON.stringify({ json, text: l.text }, null, 1));
    console.log(`key sets written to ${process.env.F3_KEYS_DUMP}`);
  } finally { w.cleanup(); }
  process.exit(0);
}

const golden = () => JSON.parse(readFileSync(KEYS, 'utf8'));
const goldenTeams = (g) => mergeTrie(g.json.summary, g.json.teams_extra);

test('the key-set golden is small and names every format', () => {
  assert.ok(readFileSync(KEYS).length < 5120, 'view-once-keys.json under 5 KB');
  const g = golden();
  assert.deepEqual(Object.keys(g.json).sort(), ['decisions', 'events', 'report', 'status', 'summary', 'teams_extra']);
  assert.deepEqual(Object.keys(g.text).sort(), ['board', 'text']);
  assert.ok(triePaths(g.json.summary).length > 20, 'the summary snapshot is not empty');
});

test('every JSON format keeps all its old keys (additions only)', () => {
  const w = world();
  try {
    const g = golden();
    const cur = live(w).json;
    const old = { ...g.json, teams: goldenTeams(g) };
    delete old.teams_extra;
    for (const k of Object.keys(JSON_FORMATS)) assert.deepEqual(missingPaths(old[k], cur[k]), [], `format ${k}: keys removed or renamed`);
  } finally { w.cleanup(); }
});

test('both text formats keep all their old lines (additions only)', () => {
  const w = world();
  try {
    const g = golden();
    const cur = live(w).text;
    for (const k of Object.keys(TEXT_FORMATS)) {
      const have = new Set(cur[k]);
      assert.deepEqual(g.text[k].filter((l) => !have.has(l)), [], `format ${k}: lines dropped or reworded`);
    }
  } finally { w.cleanup(); }
});

test('the additions-only rule: red on a removed key, a renamed key, an unrelated value; green on additions and state/pct/usd', () => {
  const base = { a: { state: 'running', pct: 17, usd: 1, keep: 'x', list: [{ id: 1 }] } };
  assert.deepEqual(additionsViolations(base, { a: { state: 'stalled', pct: 23, usd: 2, keep: 'x', list: [{ id: 1, minutes: 3 }, { id: 2 }], progress: { key: 'build' } } }), []);
  assert.deepEqual(additionsViolations(base, { a: { state: 'running', pct: 17, usd: 1, list: [{ id: 1 }] } }), ['removed: a.keep']);
  assert.deepEqual(additionsViolations(base, { a: { state: 'running', pct: 17, usd: 1, kept: 'x', list: [{ id: 1 }] } }), ['removed: a.keep']);
  assert.deepEqual(additionsViolations(base, { a: { state: 'running', pct: 17, usd: 1, keep: 'y', list: [{ id: 1 }] } }), ['changed: a.keep']);
  assert.deepEqual(missingPaths({ a: { b: 0 } }, { a: { c: 0 } }), ['a.b']);
  assert.deepEqual(missingPaths({ a: { b: 0 } }, { a: { b: 0, c: 0 }, d: 0 }), []);
});

// A golden string is a JSON document or a text view; leaves of a JSON one are compared by path, text by masked line.
function parsedLeaves(doc, w) {
  const out = {};
  for (const [group, formats] of Object.entries(doc)) {
    out[group] = {};
    for (const [fmt, s] of Object.entries(formats)) {
      try { out[group][fmt] = JSON.parse(s.split('\n')[0]); if (s.trim().split('\n').length > 1) throw new Error('lines'); } catch { out[group][fmt] = { lines: linesOf(s, w || { root: '\0' }) }; }
    }
  }
  return out;
}

test('view-once-golden.json differs from the base commit only by additions or by state, pct and usd values', (t) => {
  const git = spawnSync('git', ['show', `${BASE_COMMIT}:teams/scripts/fixtures/view-once-golden.json`], { cwd: HERE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (git.status !== 0) { t.skip(`no ${BASE_COMMIT} in this checkout; the key-set golden carries the rule`); return; }
  const base = parsedLeaves(JSON.parse(git.stdout));
  const cur = parsedLeaves(JSON.parse(readFileSync(GOLDEN, 'utf8')));
  const bad = [];
  for (const group of Object.keys(base)) {
    for (const fmt of Object.keys(base[group])) {
      const b = base[group][fmt], c = cur[group] && cur[group][fmt];
      if (!c) { bad.push(`removed: ${group}.${fmt}`); continue; }
      if (b.lines) {
        const have = new Set(c.lines || []);
        for (const l of b.lines) if (!have.has(l)) bad.push(`line dropped in ${group}.${fmt}: ${l}`);
      } else bad.push(...additionsViolations(b, c).map((v) => `${group}.${fmt} ${v}`));
    }
  }
  assert.deepEqual(bad, []);
});

// ---- the pane judges nothing (F3-AC-3) -------------------------------------------------------------------

test('teams/hooks mod.tsx, pane.ts and teams-draw.tsx read no mtime and no pid', () => {
  const hooks = join(HERE, '..', 'hooks');
  for (const f of ['mod.tsx', 'pane.ts', 'teams-draw.tsx']) {
    assert.ok(existsSync(join(hooks, f)), `${f} exists`);
    const src = readFileSync(join(hooks, f), 'utf8');
    assert.doesNotMatch(src, /statSync|mtime|process\.kill|\bpid\b/, `${f}: the pane renders the engine's state, it does not judge`);
  }
});

// ---- string keys F3 owns (F3-AC-35..37) --------------------------------------------------------------------

test('the engine emits exactly the F3-US-9 keys and the table has en and ko for each; no English label from the engine', async () => {
  const { F3_KEYS, progressWordKey, stageWordKey, summarize } = await import('./lib/view-summary.mjs');
  const table = ['progBuild', 'progQa', 'progSg', 'sgStagePlan', 'sgStageSetgoal', 'sgStageCritique', 'sgStageImplement', 'sgStageTest', 'sgStageGate', 'sgStageReport', 'estMark', 'afterStop', 'stalledMinutes'];
  assert.deepEqual([...F3_KEYS].sort(), [...table].sort());
  // the engine's progress key and stage_key map onto the table's keys
  assert.deepEqual(['build', 'qa', 'sg'].map(progressWordKey), ['progBuild', 'progQa', 'progSg']);
  const stages = ['plan', 'setgoal', 'critique', 'implement', 'test', 'gate', 'report'];
  assert.deepEqual(stages.map(stageWordKey), ['sgStagePlan', 'sgStageSetgoal', 'sgStageCritique', 'sgStageImplement', 'sgStageTest', 'sgStageGate', 'sgStageReport']);
  const emitted = new Set(['build', 'qa', 'sg'].map(progressWordKey).concat(stages.map(stageWordKey), ['estMark', 'afterStop', 'stalledMinutes']));
  assert.deepEqual([...emitted].sort(), [...table].sort());
  // a progress payload carries the raw key, stage_key and numbers only, never a rendered label
  for (const stage of stages) {
    const p = summarize({ harness: { sg: { k: 2, n: 5, stage_key: stage } } }).progress;
    assert.deepEqual(p, { key: 'sg', k: 2, n: 5, stage_key: stage });
    assert.equal(stageWordKey(p.stage_key), `sgStage${stage[0].toUpperCase()}${stage.slice(1)}`);
    assert.ok(Object.values(p).every((v) => typeof v === 'number' || /^[a-z]+$/.test(v)), 'only numbers and lower-case keys');
  }
  // the table: every key has a non-empty en and ko value
  const src = readFileSync(join(HERE, '..', 'hooks', 'mod.tsx'), 'utf8');
  const enBlock = src.slice(src.indexOf('const en = {'), src.indexOf('export const STRINGS'));
  const koBlock = src.slice(src.indexOf('  ko: {', src.indexOf('export const STRINGS')));
  for (const k of table) {
    for (const [lang, block] of [['en', enBlock], ['ko', koBlock]]) {
      const m = block.match(new RegExp(`[\\s,{]${k}: '([^']+)'`));
      assert.ok(m && m[1].length > 0, `${lang}.${k} is a non-empty string`);
    }
  }
});

test('real run: view.mjs --once on a synthetic tasks dir shows progress, workers[].minutes and cost.estimated', () => {
  const w = world();
  try {
    const dir = join(w.tasks, w.id);
    const log = join(dir, 'drivers', 'P1.stream.jsonl');
    const t0 = Date.now() - 2 * HOUR;
    // a stream with no result: its cost is estimated (opus is in the rate table); the ledger has no budget_stopped
    writeFileSync(log, `${JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: { output_tokens: 1000 } } })}\n`);
    writeFileSync(join(dir, 'ledger.jsonl'), `${JSON.stringify({ ts: t0, event: 'node_start', node_id: 'dispatch:P1:1' })}\n`);
    for (const p of [log, join(dir, 'ledger.jsonl')]) utimesSync(p, t0 / 1000, t0 / 1000);
    const summary = JSON.parse(run(w, '--format', 'summary', '--task', w.id).trim().split('\n')[0]).tasks[0];
    assert.ok(summary.progress &&summary.progress.key === 'build' && summary.progress.total === 1, JSON.stringify(summary.progress));
    assert.equal(summary.cost.estimated, true);
    const floor = JSON.parse(run(w, '--format', 'teams', '--task', w.id).trim().split('\n')[0]);
    assert.match(JSON.stringify(floor), /"minutes":\d+/, 'a stalled worker carries minutes');
  } finally { w.cleanup(); }
});
