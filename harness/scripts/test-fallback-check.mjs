// fallback-check regressions: 0% goal gate must not be COMPLETE; "todo list feature" is a real title.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, utimesSync, realpathSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CHECK = join(dirname(fileURLToPath(import.meta.url)), '..', 'engine', 'fallback-check.mjs');

function makeRun({ title = 'Build the thing', matchPct = 100 } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'fbc-'));
  const w = (rel, v) => {
    mkdirSync(dirname(join(d, rel)), { recursive: true });
    writeFileSync(join(d, rel), typeof v === 'string' ? v : JSON.stringify(v));
  };
  w('manifest.json', { request: 'do it', subgoals: [{ id: 's1' }] });
  w('01-plan.md', 'a plan that is long enough');
  w('02-goal-spec.json', {
    goal: 'a goal that is long enough',
    acceptance: ['a'],
    subgoals: [{ id: 's1', title }],
  });
  w('subgoals/s1/result.json', { passed: true });
  w('subgoals/s1/test-1.json', {});
  w('04-goal-gate.json', { match_pct: matchPct });
  w('05-report.md', 'a report that is long enough');
  return d;
}
const run = (d) => spawnSync('node', [CHECK, d], { encoding: 'utf8' });

test('baseline run is COMPLETE', () => {
  const r = run(makeRun());
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^COMPLETE/);
});

test('0% goal gate is not COMPLETE', () => {
  const r = run(makeRun({ matchPct: 0 }));
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /^INCOMPLETE/);
});

test('title starting with "todo" is not a placeholder', () => {
  const r = run(makeRun({ title: 'todo list feature' }));
  assert.equal(r.status, 0, r.stdout);
});

test('bare "TODO" title is still a placeholder', () => {
  const r = run(makeRun({ title: 'TODO' }));
  assert.equal(r.status, 1, r.stdout);
});

// ---- now.json, --list, --show (card 34) ----
const NOW_KEYS = ['stage', 'doing', 'round', 'last_step', 'next', 'waiting', 'cost_usd', 'at', 'since'];
const ROW_KEYS = [
  'dir', 'failed', 'failures', 'max_critique_rounds', 'now', 'passed', 'round', 'rounds',
  'severity', 'slug', 'stage', 'stalled', 'started_at', 'total', 'waiting',
];
const HOUR = 3600 * 1000;

const now = (d, obj) =>
  spawnSync('node', [CHECK, '--now', d, typeof obj === 'string' ? obj : JSON.stringify(obj)], { encoding: 'utf8' });
const readNow = (d) => JSON.parse(readFileSync(join(d, 'now.json'), 'utf8'));
const emptyDir = () => mkdtempSync(join(tmpdir(), 'fbn-'));
const full = (o = {}) => ({
  stage: 'implement', doing: 'writing math.js', round: 1, last_step: 'plan done', next: 'test',
  waiting: null, cost_usd: 0.42, ...o,
});

test('--now writes the 7 keys plus at and since', () => {
  const d = emptyDir();
  const r = now(d, full());
  assert.equal(r.status, 0, r.stderr);
  const n = readNow(d);
  assert.deepEqual(Object.keys(n).sort(), [...NOW_KEYS].sort());
  assert.equal(n.stage, 'implement');
  assert.equal(n.cost_usd, 0.42);
  assert.ok(!Number.isNaN(Date.parse(n.at)));
  assert.equal(n.since, n.at);
});

test('--now with bad JSON exits non-zero and writes nothing', () => {
  const d = emptyDir();
  const r = now(d, '{not json');
  assert.notEqual(r.status, 0);
  assert.deepEqual(readdirSync(d), []);
});

test('--now without a stage exits non-zero and writes nothing', () => {
  const d = emptyDir();
  const r = now(d, { doing: 'x' });
  assert.notEqual(r.status, 0);
  assert.deepEqual(readdirSync(d), []);
});

test('--now on a missing run dir exits 2', () => {
  const r = now(join(tmpdir(), 'fbn-does-not-exist-xyz'), full());
  assert.equal(r.status, 2);
});

test('--now leaves no temp file behind', () => {
  const d = emptyDir();
  now(d, full());
  assert.deepEqual(readdirSync(d), ['now.json']);
});

test('--now stores a missing cost_usd as null and shows it as an em dash', () => {
  const d = emptyDir();
  const { cost_usd, ...noCost } = full();
  const r = now(d, noCost);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readNow(d).cost_usd, null);
  assert.match(r.stdout, /cost —/);
});

test('--now keeps since while the stage is unchanged and resets it when the stage changes', () => {
  const d = emptyDir();
  writeFileSync(join(d, 'now.json'), JSON.stringify({ ...full(), at: '2026-01-01T00:00:00.000Z', since: '2026-01-01T00:00:00.000Z' }));
  assert.equal(now(d, full({ doing: 'second step' })).status, 0);
  const same = readNow(d);
  assert.equal(same.since, '2026-01-01T00:00:00.000Z');
  assert.notEqual(same.at, '2026-01-01T00:00:00.000Z');
  assert.equal(same.doing, 'second step');
  assert.equal(now(d, full({ stage: 'test' })).status, 0);
  const changed = readNow(d);
  assert.notEqual(changed.since, '2026-01-01T00:00:00.000Z');
  assert.equal(changed.since, changed.at);
});

test('--now ignores at and since in the input', () => {
  const d = emptyDir();
  now(d, full({ at: 'x', since: 'y' }));
  const n = readNow(d);
  assert.ok(!Number.isNaN(Date.parse(n.at)));
  assert.equal(n.since, n.at);
});

test('--now cuts last_step to 120 characters', () => {
  const d = emptyDir();
  now(d, full({ last_step: 'x'.repeat(300) }));
  assert.equal(readNow(d).last_step.length, 120);
});

test('--now accepts waiting as null or {who, what} and rejects anything else', () => {
  for (const waiting of [null, { who: 'you', what: 'approve the plan' }, { who: 'vendor', what: 'codex running' }]) {
    const d = emptyDir();
    assert.equal(now(d, full({ waiting })).status, 0);
    assert.deepEqual(readNow(d).waiting, waiting);
  }
  for (const waiting of ['approve the plan', { who: 'me', what: 'x' }, { who: 'you' }, { what: 'x' }, 3]) {
    const d = emptyDir();
    const r = now(d, full({ waiting }));
    assert.notEqual(r.status, 0, JSON.stringify(waiting));
    assert.deepEqual(readdirSync(d), [], JSON.stringify(waiting));
  }
});

// -- run fixtures for --list / --show --

function repoWithRuns(specs) {
  const root = mkdtempSync(join(tmpdir(), 'fbl-'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  const dirs = {};
  for (const [slug, o] of Object.entries(specs)) {
    const d = join(root, '.harness-run', slug);
    const w = (rel, v) => {
      mkdirSync(dirname(join(d, rel)), { recursive: true });
      writeFileSync(join(d, rel), typeof v === 'string' ? v : JSON.stringify(v));
    };
    w('manifest.json', o.manifest ?? { request: 'do it', subgoals: [{ id: 's1' }] });
    for (const [rel, v] of Object.entries(o.files ?? {})) w(rel, v);
    if (o.ageHours != null) {
      const t = new Date(Date.now() - o.ageHours * HOUR);
      for (const f of [d, join(d, 'manifest.json'), ...Object.keys(o.files ?? {}).map((k) => join(d, k))]) utimesSync(f, t, t);
    }
    dirs[slug] = d;
  }
  return { root, dirs };
}
const list = (root, ...more) => spawnSync('node', [CHECK, '--list', '--cwd', root, ...more], { encoding: 'utf8' });
const listJson = (root) => JSON.parse(list(root, '--json').stdout);

const SPEC = { goal: 'a goal that is long enough', acceptance: ['a'], subgoals: [{ id: 's1', title: 'T' }] };
// A now.json counts only while its `at` is not older than the run's newest artifact, so a fixture
// that wants it honoured stamps `at` a minute ahead of the files written in the same instant.
const freshAt = () => new Date(Date.now() + 60 * 1000).toISOString();
const NOW_FILE = { ...full({ stage: 'implement', round: 1, waiting: { who: 'you', what: 'pick a vendor' } }), at: freshAt(), since: freshAt() };
const CRIT_REJECTED = { sound: false, problems: [{ severity: 'major', text: 'acceptance is vague' }] };

test('--list prints both open runs of a 2-run fixture with stage, round and waiting', () => {
  const { root } = repoWithRuns({
    alpha: { files: { '01-plan.md': 'plan', '02-goal-spec.json': SPEC, 'now.json': NOW_FILE } },
    beta: { files: { '01-plan.md': 'plan' }, ageHours: 3 },
  });
  const r = list(root);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 2, r.stdout);
  const a = lines.find((l) => l.startsWith('alpha'));
  const b = lines.find((l) => l.startsWith('beta'));
  assert.match(a, /\timplement\t/);
  assert.doesNotMatch(a, /critique/);
  assert.match(a, /round 1/);
  assert.match(a, /waiting you: pick a vendor/);
  assert.match(a, /cost 0\.42/);
  assert.doesNotMatch(a, /stalled/);
  assert.match(b, /setgoal/);
  assert.match(b, /round —/);
  assert.match(b, /waiting —/);
  assert.match(b, /cost —/);
  assert.match(b, /stalled/);
});

test('--list skips finished, abandoned (12 h) and manifest-less runs', () => {
  const { root } = repoWithRuns({
    open: { files: { '01-plan.md': 'plan' } },
    done: { files: { '05-report.md': 'a report that is long enough' } },
    old: { files: { '01-plan.md': 'plan' }, ageHours: 13 },
  });
  mkdirSync(join(root, '.harness-run', 'nomanifest'), { recursive: true });
  mkdirSync(join(root, '.harness-run', 'broker', 'runs'), { recursive: true });
  assert.deepEqual(listJson(root).map((x) => x.slug), ['open']);
});

test('--list reads the git toplevel from a subdirectory and falls back to cwd outside a repo', () => {
  const { root } = repoWithRuns({ one: { files: { '01-plan.md': 'plan' } } });
  mkdirSync(join(root, 'sub'));
  const sub = spawnSync('node', [CHECK, '--list', '--cwd', join(root, 'sub'), '--json'], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(sub.stdout).map((x) => x.slug), ['one']);
  const plain = mkdtempSync(join(tmpdir(), 'fbp-'));
  mkdirSync(join(plain, '.harness-run', 'two'), { recursive: true });
  writeFileSync(join(plain, '.harness-run', 'two', 'manifest.json'), '{"request":"r"}');
  assert.deepEqual(listJson(plain).map((x) => x.slug), ['two']);
});

test('--list with nothing open exits 0 and says so; --json is an empty array', () => {
  const { root } = repoWithRuns({});
  const r = list(root);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no open runs/);
  assert.deepEqual(listJson(root), []);
});

test('the --json row contract pins waiting as null|{who,what} and the round and problem shapes', () => {
  const { root } = repoWithRuns({
    alpha: {
      files: {
        '01-plan.md': 'plan', '02-goal-spec.json': SPEC, 'now.json': NOW_FILE,
        '02-critique.r1.json': { sound: false, problems: [{ severity: 'major', text: 'a' }] },
        '02-critique.json': { sound: false, problems: ['Nit: b'] },
      },
    },
    beta: { files: { '01-plan.md': 'plan' } },
  });
  const rows = listJson(root);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ROW_KEYS);
    assert.ok(row.waiting === null || (Object.keys(row.waiting).sort().join() === 'what,who' && ['you', 'vendor'].includes(row.waiting.who)));
    assert.equal(typeof row.stalled, 'boolean');
    assert.ok(row.started_at === null || typeof row.started_at === 'string');
    assert.ok(Number.isInteger(row.max_critique_rounds));
    for (const rd of row.rounds) {
      assert.deepEqual(Object.keys(rd).sort(), ['file', 'problems', 'round', 'sound']);
      for (const pr of rd.problems) assert.deepEqual(Object.keys(pr).sort(), ['severity', 'text']);
    }
  }
  assert.deepEqual(rows.find((x) => x.slug === 'alpha').waiting, { who: 'you', what: 'pick a vendor' });
  assert.equal(rows.find((x) => x.slug === 'beta').waiting, null);
});

test('--list --json rows carry the pinned key set, now.json and the stalled flag', () => {
  const { root, dirs } = repoWithRuns({
    alpha: { files: { '01-plan.md': 'plan', 'now.json': NOW_FILE } },
    beta: { files: { '01-plan.md': 'plan' }, ageHours: 3 },
  });
  const rows = listJson(root);
  assert.equal(rows.length, 2);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ROW_KEYS);
  const alpha = rows.find((x) => x.slug === 'alpha');
  const beta = rows.find((x) => x.slug === 'beta');
  assert.equal(alpha.dir, realpathSync(dirs.alpha));
  assert.deepEqual(alpha.now, NOW_FILE);
  assert.deepEqual(alpha.waiting, { who: 'you', what: 'pick a vendor' });
  assert.equal(alpha.round, 1);
  assert.equal(alpha.stalled, false);
  assert.equal(beta.now, null);
  assert.equal(beta.waiting, null);
  assert.equal(beta.stalled, true);
});

test('manifest.started_at is read as-is; an older manifest reads null and is not backfilled', () => {
  const { root, dirs } = repoWithRuns({
    new: { manifest: { request: 'r', started_at: '2026-10-16T01:00:00.000Z', max_critique_rounds: 3 }, files: { '01-plan.md': 'p' } },
    old: { files: { '01-plan.md': 'p' } },
  });
  const rows = listJson(root);
  const n = rows.find((x) => x.slug === 'new');
  const o = rows.find((x) => x.slug === 'old');
  assert.equal(n.started_at, '2026-10-16T01:00:00.000Z');
  assert.equal(n.max_critique_rounds, 3);
  assert.equal(o.started_at, null);
  assert.equal(o.max_critique_rounds, 2);
  assert.ok(!('started_at' in JSON.parse(readFileSync(join(dirs.old, 'manifest.json'), 'utf8'))));
});

test('critique severity: new-format field is kept, an unknown value becomes major', () => {
  const { root } = repoWithRuns({
    r: {
      files: {
        '01-plan.md': 'p', '02-goal-spec.json': SPEC,
        '02-critique.json': {
          sound: false,
          problems: [
            { severity: 'blocker', text: 'no acceptance' },
            { severity: 'Nit', text: 'typo' },
            { severity: 'catastrophic', text: 'odd value' },
          ],
        },
      },
    },
  });
  const [row] = listJson(root);
  assert.deepEqual(row.rounds[0].problems, [
    { severity: 'blocker', text: 'no acceptance' },
    { severity: 'nit', text: 'typo' },
    { severity: 'major', text: 'odd value' },
  ]);
});

test('critique severity: an old-format string is parsed from its text prefix, else major', () => {
  const { root } = repoWithRuns({
    r: {
      files: {
        '01-plan.md': 'p', '02-goal-spec.json': SPEC,
        '02-critique.json': {
          sound: false,
          problems: ['Nit: wording', 'BLOCKER: gate is unwinnable', 'minor - naming', 'Majority of tests are missing', 'no prefix at all'],
        },
      },
    },
  });
  const [row] = listJson(root);
  assert.deepEqual(row.rounds[0].problems.map((p) => p.severity), ['nit', 'blocker', 'minor', 'major', 'major']);
  assert.equal(row.rounds[0].problems[0].text, 'Nit: wording');
});

test('a rejected critique with 3 rounds lists every round in order, newest last', () => {
  const crit = (sound, problems) => ({ sound, problems });
  const { root } = repoWithRuns({
    r: {
      manifest: { request: 'do it', max_critique_rounds: 12 },
      files: {
        '01-plan.md': 'p', '02-goal-spec.json': SPEC,
        '02-critique.r2.json': crit(false, ['Minor: second']),
        '02-critique.r1.json': crit(false, [{ severity: 'blocker', text: 'first' }]),
        '02-critique.r10.json': crit(false, ['Nit: tenth']),
        '02-critique.json': crit(false, ['Major: newest']),
      },
    },
  });
  const [row] = listJson(root);
  assert.deepEqual(row.rounds.map((x) => [x.round, x.file]), [
    [1, '02-critique.r1.json'], [2, '02-critique.r2.json'], [10, '02-critique.r10.json'], [11, '02-critique.json'],
  ]);
  assert.deepEqual(row.rounds.map((x) => x.sound), [false, false, false, false]);
  assert.deepEqual(row.rounds.map((x) => x.problems[0].severity), ['blocker', 'minor', 'nit', 'major']);
  assert.equal(row.round, 11);
  assert.equal(row.stage, 'critique');
});

test('--list text rounds fall back to the critique round count when now.json has none', () => {
  const { root } = repoWithRuns({
    r: { files: { '01-plan.md': 'p', '02-goal-spec.json': SPEC, '02-critique.r1.json': { sound: false, problems: [] }, '02-critique.json': { sound: true, problems: [] } } },
  });
  assert.match(list(root).stdout, /round 2/);
});

test('--show --json returns one run in the --list row shape', () => {
  const { root, dirs } = repoWithRuns({
    a: { files: { '01-plan.md': 'p', 'now.json': { ...NOW_FILE, stage: 'gate' }, '02-goal-spec.json': SPEC, '02-critique.json': { sound: true, problems: [] }, 'subgoals/s1/result.json': { passed: true } } },
  });
  const r = spawnSync('node', [CHECK, '--show', dirs.a, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const row = JSON.parse(r.stdout);
  assert.deepEqual(row, listJson(root)[0]);
  assert.deepEqual(Object.keys(row).sort(), ROW_KEYS);
  assert.equal(row.stage, 'gate');
  assert.deepEqual([row.passed, row.failed, row.total], [1, 0, 1]);
});

test('--show on a missing dir exits 2', () => {
  const r = spawnSync('node', [CHECK, '--show', join(tmpdir(), 'fbn-nope-xyz'), '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

// ---- stage reconciliation, severity rollup, cost and field pins (card 40, node half) ----

// Case A has no now.json: the stage comes from the files, and `critique` is right (a spec and no
// critique file yet). Case B was seen reading `critique` in the pane while the lead had already
// called --now with stage setgoal round 2: buildRow derived the stage from files only.
const stageFixture = () => repoWithRuns({
  a: { files: { '01-plan.md': 'plan', '02-goal-spec.json': SPEC } },
  b: {
    files: {
      '01-plan.md': 'plan', '02-goal-spec.json': SPEC, '02-critique.json': CRIT_REJECTED,
      'now.json': { ...full({ stage: 'setgoal', round: 2 }), at: freshAt(), since: freshAt() },
    },
  },
});

test('stale-stage fixture: --list prints both runs, and case B reads the now.json stage', () => {
  const { root } = stageFixture();
  const r = list(root);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 2, r.stdout);
  const a = lines.find((l) => l.startsWith('a\t'));
  const b = lines.find((l) => l.startsWith('b\t'));
  assert.match(a, /\tcritique\t/);
  assert.match(b, /\tsetgoal\t/);
  assert.doesNotMatch(b, /critique/);
  assert.match(b, /round 2/);
  const rows = listJson(root);
  assert.equal(rows.find((x) => x.slug === 'a').stage, 'critique');
  assert.equal(rows.find((x) => x.slug === 'b').stage, 'setgoal');
  assert.equal(rows.find((x) => x.slug === 'b').round, 2);
});

test('a now.json older than the newest artifact yields the derived stage', () => {
  const stale = new Date(Date.now() - HOUR).toISOString();
  const { root } = repoWithRuns({
    r: { files: { '01-plan.md': 'plan', '02-goal-spec.json': SPEC, 'now.json': { ...full({ stage: 'setgoal' }), at: stale, since: stale } } },
  });
  const [row] = listJson(root);
  assert.equal(row.stage, 'critique');
  assert.equal(row.now, null);
});

test('now.stage test maps to implement; an unparseable at or an unknown stage falls back to the derived stage', () => {
  const at = freshAt();
  const row = (now) => listJson(repoWithRuns({ r: { files: { '01-plan.md': 'plan', '02-goal-spec.json': SPEC, 'now.json': now } } }).root)[0];
  assert.equal(row({ ...full({ stage: 'test' }), at, since: at }).stage, 'implement');
  assert.equal(row({ ...full({ stage: 'gate' }), at: 'a', since: 'a' }).stage, 'critique');
  assert.equal(row({ ...full({ stage: 'dancing' }), at, since: at }).stage, 'critique');
  assert.equal(row({ ...full({ stage: '' }), at, since: at }).stage, 'critique');
});

test('an invalid now.json (not an object) leaves the derived stage', () => {
  const { root } = repoWithRuns({ r: { files: { '01-plan.md': 'plan', 'now.json': '{broken' } } });
  const [row] = listJson(root);
  assert.equal(row.stage, 'setgoal');
  assert.equal(row.now, null);
});

test('--show reads the same reconciled stage as --list', () => {
  const { root, dirs } = stageFixture();
  const r = spawnSync('node', [CHECK, '--show', dirs.b, '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(r.stdout).stage, 'setgoal');
  assert.deepEqual(JSON.parse(r.stdout), listJson(root).find((x) => x.slug === 'b'));
});

test('severity rollup counts blocker, major, minor and nit across every critique round', () => {
  const { root } = repoWithRuns({
    r: {
      files: {
        '01-plan.md': 'p', '02-goal-spec.json': SPEC,
        '02-critique.r1.json': { sound: false, problems: [{ severity: 'blocker', text: 'a' }, 'Nit: b', { severity: 'weird', text: 'c' }] },
        '02-critique.json': { sound: false, problems: [{ severity: 'minor', text: 'd' }, 'Blocker - e', 'Minor: f', 'no prefix'] },
      },
    },
  });
  const [row] = listJson(root);
  assert.deepEqual(row.severity, { blocker: 2, major: 2, minor: 2, nit: 1 });
  assert.deepEqual(Object.keys(row.severity), ['blocker', 'major', 'minor', 'nit']);
});

test('severity rollup is all zeros for a run with no critique, and a critique with no problems', () => {
  const { root } = repoWithRuns({
    none: { files: { '01-plan.md': 'p' } },
    empty: { files: { '01-plan.md': 'p', '02-goal-spec.json': SPEC, '02-critique.json': { sound: true, problems: [] } } },
  });
  for (const row of listJson(root)) assert.deepEqual(row.severity, { blocker: 0, major: 0, minor: 0, nit: 0 });
});

test('--list text shows cost_usd as an em dash when null or missing and as a number when set', () => {
  const at = freshAt();
  const files = (cost) => ({ '01-plan.md': 'p', 'now.json': { ...full({ stage: 'plan' }), ...cost, at, since: at } });
  const { root } = repoWithRuns({
    nul: { files: files({ cost_usd: null }) },
    missing: { files: { '01-plan.md': 'p', 'now.json': { stage: 'plan', at, since: at } } },
    num: { files: files({ cost_usd: 1.5 }) },
    nonow: { files: { '01-plan.md': 'p' } },
  });
  const lines = list(root).stdout.trim().split('\n');
  const line = (slug) => lines.find((l) => l.startsWith(`${slug}\t`));
  assert.match(line('nul'), /cost —/);
  assert.match(line('missing'), /cost —/);
  assert.match(line('nonow'), /cost —/);
  assert.match(line('num'), /cost 1\.50/);
});

test('the now.json fields reach the row unchanged: stage, doing, round, last_step, next, waiting, cost_usd', () => {
  const at = freshAt();
  const nowObj = {
    stage: 'implement', doing: 'writing math.js', round: 3, last_step: 'plan done', next: 'test',
    waiting: { who: 'vendor', what: 'codex running' }, cost_usd: 0.42, at, since: at,
  };
  const { root } = repoWithRuns({ r: { files: { '01-plan.md': 'p', 'now.json': nowObj } } });
  const [row] = listJson(root);
  assert.deepEqual(row.now, nowObj);
  assert.equal(row.round, 3);
  assert.deepEqual(row.waiting, { who: 'vendor', what: 'codex running' });
  assert.equal(row.stage, 'implement');
});

test('a rejected --now (bad JSON, bad waiting, bad cost, bad round) leaves an existing now.json untouched', () => {
  const d = emptyDir();
  assert.equal(now(d, full()).status, 0);
  const before = readFileSync(join(d, 'now.json'), 'utf8');
  for (const bad of ['{nope', full({ waiting: 'x' }), full({ cost_usd: 'a lot' }), full({ round: 1.5 }), { doing: 'x' }]) {
    assert.notEqual(now(d, bad).status, 0, JSON.stringify(bad));
  }
  assert.equal(readFileSync(join(d, 'now.json'), 'utf8'), before);
  assert.deepEqual(readdirSync(d), ['now.json']);
});

// ---- one freshness check governs every now.json field (D1) ----

// now.json counts as a whole or not at all: a stale or invalid `at` drops stage, round, waiting and
// now together, so the pane cannot show a stale "waiting on you".
const liveFiles = (nowJson, extra = {}) => ({
  '01-plan.md': 'plan', '02-goal-spec.json': SPEC, '02-critique.json': CRIT_REJECTED, 'now.json': nowJson, ...extra,
});
const showRow = (dir) => JSON.parse(spawnSync('node', [CHECK, '--show', dir, '--json'], { encoding: 'utf8' }).stdout);
const textLine = (root, slug) => list(root).stdout.trim().split('\n').find((l) => l.startsWith(`${slug}\t`));

test('a stale now.json is ignored whole: no round 7, no waiting you, no now, cost em dash (text, --json, --show)', () => {
  const stale = new Date(Date.now() - HOUR).toISOString();
  const nowObj = { ...full({ stage: 'setgoal', round: 7, waiting: { who: 'you', what: 'approve' } }), at: stale, since: stale };
  const { root, dirs } = repoWithRuns({ r: { files: liveFiles(nowObj) } });
  const line = textLine(root, 'r');
  assert.doesNotMatch(line, /round 7/);
  assert.doesNotMatch(line, /waiting you/);
  assert.match(line, /\tcritique\tround 1\twaiting —\tcost —/);
  const [row] = listJson(root);
  assert.equal(row.stage, 'critique');
  assert.equal(row.round, 1);
  assert.equal(row.waiting, null);
  assert.equal(row.now, null);
  assert.deepEqual(showRow(dirs.r), row);
});

test('a stale now.json on a run with no critique reads round null', () => {
  const stale = new Date(Date.now() - HOUR).toISOString();
  const nowObj = { ...full({ stage: 'setgoal', round: 7, waiting: { who: 'you', what: 'approve' } }), at: stale, since: stale };
  const { root } = repoWithRuns({ r: { files: { '01-plan.md': 'plan', 'now.json': nowObj } } });
  const [row] = listJson(root);
  assert.deepEqual([row.stage, row.round, row.waiting, row.now], ['setgoal', null, null, null]);
  assert.match(textLine(root, 'r'), /round —\twaiting —\tcost —/);
});

test('a missing or unparseable at, or a now.json that is not an object, is stale whole', () => {
  const at = freshAt();
  const base = full({ stage: 'setgoal', round: 7, waiting: { who: 'you', what: 'approve' } });
  const cases = [
    { ...base, since: at },
    { ...base, at: 'not a time', since: at },
    { ...base, at: null, since: at },
    [1, 2, 3],
    7,
    'text',
  ];
  for (const nowObj of cases) {
    const { root, dirs } = repoWithRuns({ r: { files: liveFiles(nowObj) } });
    const label = JSON.stringify(nowObj);
    const line = textLine(root, 'r');
    assert.doesNotMatch(line, /round 7/, label);
    assert.doesNotMatch(line, /waiting you/, label);
    assert.match(line, /cost —/, label);
    const [row] = listJson(root);
    assert.deepEqual([row.stage, row.round, row.waiting, row.now], ['critique', 1, null, null], label);
    assert.deepEqual(showRow(dirs.r), row, label);
  }
});

test('a fresh now.json keeps round, waiting, now and cost on text, --json and --show', () => {
  const at = freshAt();
  const nowObj = { ...full({ stage: 'setgoal', round: 7, waiting: { who: 'you', what: 'approve' }, cost_usd: 2.5 }), at, since: at };
  const { root, dirs } = repoWithRuns({ r: { files: liveFiles(nowObj) } });
  assert.match(textLine(root, 'r'), /\tsetgoal\tround 7\twaiting you: approve\tcost 2\.50/);
  const [row] = listJson(root);
  assert.deepEqual([row.stage, row.round, row.waiting, row.now], ['setgoal', 7, { who: 'you', what: 'approve' }, nowObj]);
  assert.deepEqual(showRow(dirs.r), row);
});

test('a fresh now.json with an unknown stage keeps its round and waiting but not its stage', () => {
  const at = freshAt();
  const nowObj = { ...full({ stage: 'dancing', round: 7, waiting: { who: 'you', what: 'approve' } }), at, since: at };
  const { root } = repoWithRuns({ r: { files: liveFiles(nowObj) } });
  const [row] = listJson(root);
  assert.deepEqual([row.stage, row.round, row.waiting], ['critique', 7, { who: 'you', what: 'approve' }]);
});

// ---- an entry that cannot be stat'ed contributes mtime 0 (D5) ----

test('a dangling symlink in the run dir and in subgoals/ leaves --list, --json and --show exit 0 with the same row', () => {
  const files = { '01-plan.md': 'plan', '02-goal-spec.json': SPEC, '02-critique.json': CRIT_REJECTED, 'subgoals/keep.txt': 'x' };
  const clean = repoWithRuns({ r: { files } });
  const linked = repoWithRuns({ r: { files } });
  symlinkSync('/nonexistent', join(linked.dirs.r, 'dangling'));
  symlinkSync('/nonexistent', join(linked.dirs.r, 'subgoals', 'dangling'));
  const text = list(linked.root);
  assert.equal(text.status, 0, text.stderr);
  assert.doesNotMatch(text.stderr, /ENOENT/);
  const json = list(linked.root, '--json');
  assert.equal(json.status, 0, json.stderr);
  const [row] = JSON.parse(json.stdout);
  const show = spawnSync('node', [CHECK, '--show', linked.dirs.r, '--json'], { encoding: 'utf8' });
  assert.equal(show.status, 0, show.stderr);
  assert.deepEqual(Object.keys(row).sort(), ROW_KEYS);
  assert.deepEqual(JSON.parse(show.stdout), row);
  const [base] = listJson(clean.root);
  assert.deepEqual([row.stage, row.round, row.severity], [base.stage, base.round, base.severity]);
});

test('a run whose only artifact is a dangling symlink still gets a row, with no ENOENT', () => {
  const { root, dirs } = repoWithRuns({ r: {} });
  symlinkSync('/nonexistent', join(dirs.r, 'dangling'));
  const r = list(root);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /ENOENT/);
  assert.equal(listJson(root)[0].stage, 'plan');
});

const NOW_STAGE_LIST = ['plan', 'setgoal', 'critique', 'implement', 'test', 'gate', 'report'];

test('--now rejects a stage the reader would ignore and writes nothing', () => {
  for (const stage of ['dancing', 'PLAN', ' plan', '', 5]) {
    const d = emptyDir();
    const r = now(d, { stage });
    assert.notEqual(r.status, 0, JSON.stringify(stage));
    assert.match(r.stderr, /^--now:/, JSON.stringify(stage));
    for (const s of NOW_STAGE_LIST) assert.ok(r.stderr.includes(s), `${JSON.stringify(stage)} names ${s}`);
    assert.deepEqual(readdirSync(d), [], `${JSON.stringify(stage)} left files`);
  }
});

test('--now accepts each of the 7 stages and writes it', () => {
  for (const stage of NOW_STAGE_LIST) {
    const d = emptyDir();
    const r = now(d, { stage });
    assert.equal(r.status, 0, `${stage}: ${r.stderr}`);
    assert.equal(readNow(d).stage, stage);
  }
});

test('--now with an unknown stage leaves an existing now.json byte-identical', () => {
  const d = emptyDir();
  assert.equal(now(d, full()).status, 0);
  const before = readFileSync(join(d, 'now.json'));
  const r = now(d, { stage: 'dancing' });
  assert.notEqual(r.status, 0);
  assert.deepEqual(readFileSync(join(d, 'now.json')), before);
  assert.deepEqual(readdirSync(d), ['now.json']);
});

test('bare RUN_DIR keeps exit 0, 1 and 2', () => {
  assert.equal(run(makeRun()).status, 0);
  assert.equal(run(makeRun({ matchPct: 0 })).status, 1);
  assert.equal(run(join(tmpdir(), 'fbn-nope-xyz')).status, 2);
  assert.equal(spawnSync('node', [CHECK], { encoding: 'utf8' }).status, 2);
});

// ---- failures[]: what failed, why, and what happens next (F1-US-3, F1-US-5) ----

const FAIL_KEYS = ['at', 'key', 'next_step', 'reason', 'severity', 'what'];
const failuresOf = (files, manifest) => {
  const { root } = repoWithRuns({ r: { files, ...(manifest ? { manifest } : {}) } });
  return listJson(root)[0].failures;
};
const GATE_NO = { pass: false, reason: 'tests are missing', gaps: ['no test for the empty list'] };

test('a row with nothing failed has failures: []', () => {
  assert.deepEqual(failuresOf({ '01-plan.md': 'p' }), []);
  assert.deepEqual(failuresOf({ 'subgoals/s1/gate-1.json': { pass: true, reason: 'ok' } }), []);
});

test('gate-<n>.json pass:false is info "retry n/(max_retries+1)" with the shape {key, at, what, reason, next_step, severity}', () => {
  const { root, dirs } = repoWithRuns({ r: { manifest: { request: 'r', max_retries: 2 }, files: { 'subgoals/s1/gate-1.json': GATE_NO, 'subgoals/s1/gate-2.json': { pass: false, reason: 'still missing' } } } });
  const f = listJson(root)[0].failures;
  assert.equal(f.length, 2);
  for (const x of f) assert.deepEqual(Object.keys(x).sort(), FAIL_KEYS);
  const one = f.find((x) => x.next_step === 'retry 1/3');
  const two = f.find((x) => x.next_step === 'retry 2/3');
  assert.ok(one && two, JSON.stringify(f));
  assert.equal(one.what, 'QualityGate s1');
  assert.equal(one.severity, 'info');
  assert.equal(one.reason, 'tests are missing; no test for the empty list');
  assert.equal(two.reason, 'still missing');
  assert.notEqual(one.key, two.key);
  assert.equal(one.at, statSync(join(dirs.r, 'subgoals', 's1', 'gate-1.json')).mtimeMs);
});

test('max_retries defaults to 2 when the manifest has none, and is read when it has', () => {
  assert.equal(failuresOf({ 'subgoals/s1/gate-1.json': GATE_NO })[0].next_step, 'retry 1/3');
  assert.equal(failuresOf({ 'subgoals/s1/gate-1.json': GATE_NO }, { request: 'r', max_retries: 4 })[0].next_step, 'retry 1/5');
});

test('a goal gate fail with no 05-report.md is info "retry n/(max_retries+1)"; n counts the 04-goal-gate*.json files, min 1', () => {
  const gate = { match_pct: 60, pass: false, reason: 'two criteria unmet', out_of_spec: ['no CLI flag'] };
  const [one] = failuresOf({ '04-goal-gate.json': gate });
  assert.deepEqual([one.what, one.next_step, one.severity], ['goal gate', 'retry 1/3', 'info']);
  assert.equal(one.reason, 'two criteria unmet; no CLI flag');
  const [two] = failuresOf({ '04-goal-gate.json': gate, '04-goal-gate.r1.json': gate });
  assert.equal(two.next_step, 'retry 2/3');
  const [low] = failuresOf({ '04-goal-gate.json': { match_pct: 89 } });
  assert.equal(low.next_step, 'retry 1/3');
  assert.deepEqual(failuresOf({ '04-goal-gate.json': { match_pct: 95 } }), []);
  assert.deepEqual(failuresOf({ '04-goal-gate.json': { match_pct: 50, pass: true } }), []);
});

test('a goal gate fail with 05-report.md present is "gave up" (--show: --list drops a reported run)', () => {
  const { dirs } = repoWithRuns({ r: { files: { '04-goal-gate.json': { match_pct: 40, reason: 'spec not met' }, '05-report.md': 'a report that is long enough' } } });
  const f = showRow(dirs.r).failures;
  assert.equal(f.length, 1);
  assert.deepEqual([f[0].what, f[0].next_step, f[0].severity, f[0].reason], ['goal gate', 'gave up', 'gave up', 'spec not met']);
});

test('now.json waiting.who "you" is "needs you" with the stage in what; a vendor wait and a stale now.json are not', () => {
  const at = freshAt();
  const mk = (waiting, nowAt = at) => ({ '01-plan.md': 'p', 'now.json': { ...full({ stage: 'implement', waiting }), at: nowAt, since: nowAt } });
  const [f] = failuresOf(mk({ who: 'you', what: 'pick a vendor' }));
  assert.deepEqual([f.what, f.reason, f.next_step, f.severity], ['implement', 'pick a vendor', 'needs you', 'needs you']);
  assert.deepEqual(Object.keys(f).sort(), FAIL_KEYS);
  assert.deepEqual(failuresOf(mk({ who: 'vendor', what: 'codex running' })), []);
  assert.deepEqual(failuresOf(mk(null)), []);
  assert.deepEqual(failuresOf(mk({ who: 'you', what: 'x' }, new Date(Date.now() - HOUR).toISOString())), []);
});

test('result.json passed:false is "gave up", with or without stalled:true', () => {
  const f = failuresOf({
    'subgoals/a/result.json': { passed: false, reason: 'retries spent' },
    'subgoals/b/result.json': { passed: false, stalled: true, reason: 'no progress between attempts' },
    'subgoals/c/result.json': { passed: true },
  });
  assert.equal(f.length, 2);
  const a = f.find((x) => x.what === 'subgoal a');
  const b = f.find((x) => x.what === 'subgoal b');
  for (const x of [a, b]) assert.deepEqual([x.next_step, x.severity], ['gave up', 'gave up']);
  assert.equal(a.reason, 'retries spent');
  assert.equal(b.reason, 'no progress between attempts');
});

test('a rejected critique is "retry n/<max_critique_rounds>" below the cap and "continuing" at it, both info', () => {
  const crit = (text) => ({ sound: false, problems: [{ severity: 'major', text }] });
  const files = { '02-critique.r1.json': crit('acceptance is vague'), '02-critique.json': crit('gate is unwinnable') };
  const f = failuresOf(files);
  assert.equal(f.length, 2);
  const r1 = f.find((x) => x.reason === 'acceptance is vague');
  const r2 = f.find((x) => x.reason === 'gate is unwinnable');
  assert.deepEqual([r1.what, r1.next_step, r1.severity], ['Critique', 'retry 1/2', 'info']);
  assert.deepEqual([r2.next_step, r2.severity], ['continuing', 'info']);
  const wide = failuresOf(files, { request: 'r', max_critique_rounds: 3 });
  assert.deepEqual(wide.map((x) => x.next_step).sort(), ['retry 1/3', 'retry 2/3']);
  assert.deepEqual(failuresOf({ '02-critique.json': { sound: true, problems: [] } }), []);
});

test('the reason keeps the old critiqueReason, gateReason and goalReason sources, joined with "; "', () => {
  const [c] = failuresOf({ '02-critique.json': { sound: false, reason: 'not buildable', blocking: ['no tests'], problems: ['Nit: wording', { text: 'vague gate' }] } });
  assert.equal(c.reason, 'not buildable; no tests; Nit: wording; vague gate');
  const [g] = failuresOf({ 'subgoals/s1/gate-1.json': { pass: false, reason: 'r', gaps: [{ gap: 'g1' }, { reason: 'g2' }, 7] } });
  assert.equal(g.reason, 'r; g1; g2');
  const [o] = failuresOf({ '04-goal-gate.json': { match_pct: 1, reason: 'r', out_of_spec: ['o1'] } });
  assert.equal(o.reason, 'r; o1');
});

test('a multi-line reason becomes one line', () => {
  const [f] = failuresOf({ 'subgoals/s1/result.json': { passed: false, reason: 'first line\n\n  second\tline \r\n third  ' } });
  assert.equal(f.reason, 'first line second line third');
});

test('a reason over 120 chars is its first 119 plus an ellipsis; exactly 120 is unchanged', () => {
  const reason = (n) => failuresOf({ 'subgoals/s1/result.json': { passed: false, reason: 'x'.repeat(n) } })[0].reason;
  const cut = reason(121);
  assert.equal(cut.length, 120);
  assert.equal(cut, `${'x'.repeat(119)}…`);
  assert.equal(reason(120), 'x'.repeat(120));
  assert.equal(reason(119), 'x'.repeat(119));
});

test('the cut is made after collapsing whitespace, not before', () => {
  const spaced = `${'ab '.repeat(40)}end`;
  const [f] = failuresOf({ 'subgoals/s1/result.json': { passed: false, reason: spaced.replace(/ /g, '\n\n   ') } });
  assert.equal(f.reason, `${spaced.slice(0, 119)}…`);
});

test('no reason in the stage file reads "no reason recorded"', () => {
  for (const files of [
    { 'subgoals/s1/result.json': { passed: false } },
    { 'subgoals/s1/result.json': { passed: false, reason: '   \n ' } },
    { 'subgoals/s1/gate-1.json': { pass: false } },
    { '04-goal-gate.json': { match_pct: 10 } },
    { '02-critique.json': { sound: false, problems: [] } },
  ]) assert.equal(failuresOf(files)[0].reason, 'no reason recorded', JSON.stringify(files));
});

test('failures are sorted oldest first and --show returns the same failures as --list', () => {
  const { root, dirs } = repoWithRuns({ r: { files: { 'subgoals/s1/gate-1.json': GATE_NO, 'subgoals/s1/result.json': { passed: false } } } });
  const t = new Date(Date.now() - 60 * 1000);
  utimesSync(join(dirs.r, 'subgoals', 's1', 'result.json'), t, t);
  const f = listJson(root)[0].failures;
  assert.deepEqual(f.map((x) => x.what), ['subgoal s1', 'QualityGate s1']);
  assert.deepEqual(showRow(dirs.r).failures, f);
});

// ---- stage at the critique cap (card 40, U1) ----
// fallback.md §2 step 4: a rejected round at the cap is past critique, so the run goes on to implement.
const SPEC_U1 = { goal: 'a goal that is long enough', acceptance: ['a'], subgoals: [{ id: 'U1', title: 'T' }] };
const REJ = (n, sev = 'major') => ({ sound: false, problems: Array.from({ length: n }, (_, i) => ({ severity: sev, text: `p${i}` })) });
const SOUND = { sound: true, problems: [] };
const capManifest = (cap) => (cap === undefined ? { request: 'do it' } : { request: 'do it', max_critique_rounds: cap });
const runC = (over = {}) => ({
  manifest: capManifest(over.cap === undefined && !('cap' in over) ? 2 : over.cap),
  files: {
    '01-plan.md': 'plan', '02-goal-spec.json': SPEC_U1,
    '02-critique.r1.json': REJ(1), '02-critique.json': REJ(1),
    'subgoals/U1/result.json': { passed: true }, '04-goal-gate.json': { match_pct: 100 },
    ...over.files,
  },
});
const stageOf = (spec) => listJson(repoWithRuns({ r: spec }).root)[0];

test('six-run fixture: --list --json reads critique, setgoal, report, gate, critique, implement', () => {
  const stale = new Date(Date.now() - HOUR).toISOString();
  const c = runC();
  const { root } = repoWithRuns({
    a: { files: { '01-plan.md': 'plan', '02-goal-spec.json': SPEC_U1 } },
    b: { files: { '01-plan.md': 'plan', '02-goal-spec.json': SPEC_U1, '02-critique.json': REJ(1), 'now.json': { ...full({ stage: 'setgoal', round: 2 }), at: freshAt(), since: freshAt() } } },
    c,
    d: { ...runC(), files: { ...runC().files, 'now.json': { ...full({ stage: 'gate' }), at: freshAt(), since: freshAt() } } },
    e: { files: { '01-plan.md': 'plan', '02-goal-spec.json': SPEC_U1, 'now.json': { ...full({ stage: 'plan' }), at: stale, since: stale } } },
    f: { files: { '01-plan.md': 'plan', '02-goal-spec.json': SPEC_U1, '02-critique.json': SOUND } },
  });
  const rows = Object.fromEntries(listJson(root).map((r) => [r.slug, r]));
  assert.deepEqual(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => rows[s].stage), ['critique', 'setgoal', 'report', 'gate', 'critique', 'implement']);
  assert.equal(rows.b.round, 2);
});

test('run c variants: gate file removed reads gate', () => {
  const c = runC();
  delete c.files['04-goal-gate.json'];
  assert.equal(stageOf(c).stage, 'gate');
});

test('run c variants: U1 unjudged reads implement', () => {
  const c = runC();
  delete c.files['subgoals/U1/result.json'];
  delete c.files['04-goal-gate.json'];
  assert.equal(stageOf(c).stage, 'implement');
});

test('run c variants: one rejected round at cap 2 stays critique', () => {
  const c = runC();
  delete c.files['02-critique.r1.json'];
  assert.equal(stageOf(c).stage, 'critique');
});

test('run c variants: two rejected rounds at cap 3 stay critique', () => {
  assert.equal(stageOf(runC({ cap: 3 })).stage, 'critique');
});

test('run c variants: an unjudged newest round stays critique even at the cap', () => {
  const row = stageOf(runC({ files: { '02-critique.json': { problems: [] } } }));
  assert.equal(row.stage, 'critique');
});

test('cap defaults to 2 when max_critique_rounds is absent, "2", 2.5 or 0', () => {
  for (const cap of [undefined, '2', 2.5, 0]) {
    const row = stageOf(runC({ cap }));
    assert.equal(row.max_critique_rounds, 2, String(cap));
    assert.equal(row.stage, 'report', `cap ${String(cap)}`);
  }
});

test('rejected-critique fixture: cap 3 stays critique with two rounds and severity rolled up; cap 2 reads implement', () => {
  const files = {
    '01-plan.md': 'plan', '02-goal-spec.json': SPEC_U1,
    '02-critique.r1.json': { sound: false, problems: [...Array.from({ length: 4 }, (_, i) => ({ severity: 'major', text: `m${i}` })), { severity: 'nit', text: 'n' }] },
    '02-critique.json': { sound: false, problems: [{ severity: 'blocker', text: 'b' }, { severity: 'minor', text: 'x' }, { severity: 'minor', text: 'y' }] },
  };
  const row = stageOf({ manifest: capManifest(3), files });
  assert.equal(row.stage, 'critique');
  assert.deepEqual(row.rounds.map((r) => [r.round, r.file, r.sound]), [[1, '02-critique.r1.json', false], [2, '02-critique.json', false]]);
  assert.deepEqual(row.rounds[0].problems.map((p) => p.severity), ['major', 'major', 'major', 'major', 'nit']);
  assert.deepEqual(row.rounds[1].problems.map((p) => p.severity), ['blocker', 'minor', 'minor']);
  assert.deepEqual(row.severity, { blocker: 1, major: 4, minor: 2, nit: 1 });
  assert.equal(stageOf({ manifest: capManifest(2), files }).stage, 'implement');
});

test('--list text with two open runs prints one tab-separated line each, newest first, stalled marked', () => {
  const { root } = repoWithRuns({
    old: { files: { '01-plan.md': 'plan' }, ageHours: 3 },
    fresh: { files: { '01-plan.md': 'plan', '02-goal-spec.json': SPEC_U1 } },
  });
  const lines = list(root).stdout.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.split('\t')[0]), ['fresh', 'old']);
  assert.equal(lines[0].split('\t')[1], 'critique');
  assert.equal(lines[1].split('\t')[1], 'setgoal');
  assert.ok(lines[1].endsWith('\tstalled'));
  assert.doesNotMatch(lines[0], /stalled/);
});
