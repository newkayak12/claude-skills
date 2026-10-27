// node --test teams/scripts/bench/test-drive-gh.mjs
// drive.sh, resume.sh and lib/workspace.sh run as real copies in a temp dir beside a stub
// bench.sh and score.mjs, with a stub claude on PATH: no model, no network, no real bench. The
// real bench.sh runs once too (TEAMS_RUNS_DIR=off, stub claude) to show it names the same
// workspace. until-reset.mjs is linked, not copied: it imports run.mjs two directories up.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BENCH = dirname(fileURLToPath(import.meta.url));
const LIMIT = "You've hit your session limit · resets 3am (UTC)";
const hash10 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);

let T;      // realpath of the temp dir
let H;      // the copied scripts dir: <T>/repo/teams/scripts/bench
let BIN;    // stub claude lives here
let seq = 0;

before(() => {
  T = realpathSync(mkdtempSync(join(tmpdir(), 'drive-gh-')));
  H = join(T, 'repo', 'teams', 'scripts', 'bench');
  BIN = join(T, 'bin');
  mkdirSync(join(H, 'lib'), { recursive: true });
  mkdirSync(join(H, 'requests'), { recursive: true });
  mkdirSync(BIN);
  for (const f of ['drive.sh', 'resume.sh']) copyFileSync(join(BENCH, f), join(H, f));
  copyFileSync(join(BENCH, 'lib', 'workspace.sh'), join(H, 'lib', 'workspace.sh'));
  symlinkSync(join(BENCH, 'lib', 'until-reset.mjs'), join(H, 'lib', 'until-reset.mjs'));
  writeFileSync(join(H, 'cases.tsv'),
    'id\taxis\tslug\trequest\tfixture\tcheck\tstatus\n' +
    'gh-stub-1\t1\tstub\trequests/gh-stub-1.txt\tfixtures/empty\thidden/gh-stub-1/check.mjs\tpending\n' +
    'gh-verified-1\t1\tverified\trequests/gh-verified-1.txt\tfixtures/empty\thidden/gh-verified-1/check.mjs\tpending\n');
  writeFileSync(join(H, 'requests', 'gh-stub-1.txt'), 'stub request');
  writeFileSync(join(H, 'requests', 'gh-verified-1.txt'), 'stub request');
  writeFileSync(join(H, 'requests', 'code.txt'), 'stub code request');

  // Stub bench.sh: makes the workspace the test says it should be and writes the stream the
  // scenario asks for. It computes nothing itself, so drive.sh has to look in the right place.
  writeFileSync(join(H, 'bench.sh'), [
    '#!/usr/bin/env bash',
    'echo "$@" >> "$STUB_LOG/bench.args"',
    'mkdir -p "$STUB_WS"',
    'printf \'{"type":"result","result":"%s"}\\n\' "$STUB_RESULT" > "$STUB_WS.stream.jsonl"',
    '[ -z "${STUB_AGE:-}" ] || touch -d "$STUB_AGE days ago" "$STUB_WS.stream.jsonl"',
    '',
  ].join('\n'));
  // Stub score.mjs: records the workspace drive.sh / resume.sh scored.
  writeFileSync(join(H, 'score.mjs'),
    "import { appendFileSync } from 'node:fs';\n" +
    "appendFileSync(process.env.STUB_LOG + '/score.args', process.argv.slice(2).join(' ') + '\\n');\n" +
    "console.log('stub score');\n");
  writeFileSync(join(BIN, 'claude'), [
    '#!/usr/bin/env bash',
    'pwd -P >> "$STUB_LOG/claude.cwd"',
    'printf \'{"type":"result","result":"resumed and finished"}\\n\'',
    '',
  ].join('\n'));
  chmodSync(join(BIN, 'claude'), 0o755);
  chmodSync(join(H, 'bench.sh'), 0o755);
});

after(() => { if (T) rmSync(T, { recursive: true, force: true }); });

const lines = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : []);

// One drive.sh job under a fresh OUT and log dir.
function drive(arm, c, label, { result, age } = {}) {
  const n = ++seq;
  const out = join(T, `out${n}`);
  const log = join(T, `log${n}`);
  mkdirSync(out); mkdirSync(log);
  const ws = c.startsWith('gh-') ? `${out}/${c}-${hash10(`${arm}-${label}`)}` : `${out}/${c}-${arm}-${label}`;
  const r = spawnSync('bash', [join(H, 'drive.sh'), `${arm} ${c} ${label}`], {
    encoding: 'utf8', timeout: 60000,
    env: {
      ...process.env, PATH: `${BIN}:${process.env.PATH}`, GRAPH_BENCH_OUT: out, GRAPH_BENCH_AUDIT: '0',
      STUB_LOG: log, STUB_WS: ws, STUB_RESULT: result ?? 'all done', ...(age ? { STUB_AGE: String(age) } : {}),
    },
  });
  return {
    ws, out, log, r, all: `${r.stdout}${r.stderr}`,
    bench: lines(join(log, 'bench.args')), score: lines(join(log, 'score.args')), cwd: lines(join(log, 'claude.cwd')),
  };
}

const bash = (script) => spawnSync('bash', ['-c', script], { encoding: 'utf8' }).stdout;

test('helper: gh-* case is the opaque hash of arm-label, any other case stays readable', () => {
  const ws = (...a) => bash(`. '${BENCH}/lib/workspace.sh'; bench_ws ${a.join(' ')}`).trim();
  assert.equal(ws('/o', 'code', 'stable', 'L1'), '/o/code-stable-L1');
  assert.equal(ws('/o', 'gh-verified-1', 'stable', 'L1'), `/o/gh-verified-1-${hash10('stable-L1')}`);
  assert.doesNotMatch(ws('/o', 'gh-verified-1', 'stable', 'L1'), /stable|L1/);
});

test('drive.sh: a gh-* job that ends normally is read at the hashed workspace and is not resumed', () => {
  const d = drive('stable', 'gh-stub-1', 'L1');
  assert.equal(d.r.status, 0, d.all);
  assert.match(d.all, /done stable gh-stub-1 L1/);
  assert.deepEqual(d.bench, ['stable gh-stub-1 L1']);
  assert.deepEqual(d.cwd, [], 'claude must not run: nothing to resume');
  assert.equal(d.score.length, 1);
  assert.ok(d.score[0].startsWith(`gh-stub-1 ${d.ws} `), `scored ${d.score[0]}`);
  assert.doesNotMatch(d.all, /No such file/);
  assert.doesNotMatch(d.all, /resume\.sh/);
});

test('drive.sh: a gh-* job that hit a usage limit is resumed by resume.sh in the hashed workspace', () => {
  const d = drive('stable', 'gh-stub-1', 'L1', { result: LIMIT, age: 2 });
  assert.equal(d.r.status, 0, d.all);
  assert.match(d.all, /reset time already passed, resuming/);
  assert.match(d.all, /resume 1 of stable gh-stub-1 L1/);
  assert.doesNotMatch(d.all, /No such file/);
  assert.doesNotMatch(d.all, /resume started no session/);
  assert.deepEqual(d.cwd, [d.ws], 'resume.sh ran claude in the workspace bench.sh created');
  assert.ok(existsSync(`${d.ws}.stream.resume1.jsonl`));
  assert.match(readFileSync(`${d.ws}.start.txt`, 'utf8'), /resume 1 stable\/gh-stub-1 -> /);
  assert.ok(d.score.every((s) => s.startsWith(`gh-stub-1 ${d.ws} `)), `scored ${d.score}`);
  assert.equal(d.score.length, 2); // resume.sh scores, then drive.sh once the session ended
});

test('drive.sh: a case that is not gh-* keeps <case>-<arm>-<label>', () => {
  const d = drive('stable', 'code', 'L1');
  assert.equal(d.r.status, 0, d.all);
  assert.equal(d.ws, `${d.out}/code-stable-L1`);
  assert.ok(d.score[0].startsWith(`code ${d.ws} `), `scored ${d.score[0]}`);
  assert.doesNotMatch(d.all, /No such file/);
});

test('drive.sh: resume of a non gh-* workspace works through the same arguments', () => {
  const d = drive('stable', 'code', 'L1', { result: LIMIT, age: 2 });
  assert.equal(d.r.status, 0, d.all);
  assert.deepEqual(d.cwd, [d.ws]);
  assert.doesNotMatch(d.all, /No such file/);
});

test('resume.sh: the old one-argument form still resumes a non gh-* workspace', () => {
  const log = join(T, 'log-old'); mkdirSync(log);
  const ws = join(T, 'out-old', 'code-stable-L1');
  mkdirSync(ws, { recursive: true });
  writeFileSync(`${ws}.stream.jsonl`, '{"type":"result","result":"x"}\n');
  const r = spawnSync('bash', [join(H, 'resume.sh'), ws], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, STUB_LOG: log },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lines(join(log, 'claude.cwd')), [ws]);
});

test('bench.sh: the real script seeds a gh-* run in the same workspace drive.sh and resume.sh use', () => {
  const out = join(T, 'out-bench');
  const log = join(T, 'log-bench'); mkdirSync(log);
  const env = {
    ...process.env, PATH: `${BIN}:${process.env.PATH}`, GRAPH_BENCH_OUT: out, TEAMS_RUNS_DIR: 'off', STUB_LOG: log,
  };
  const r = spawnSync('bash', [join(BENCH, 'bench.sh'), 'stable', 'gh-verified-1', 'L1'], { encoding: 'utf8', timeout: 60000, env });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const ws = `${out}/gh-verified-1-${hash10('stable-L1')}`;
  assert.ok(existsSync(join(ws, '.git')), `bench.sh seeded ${ws}`);
  assert.deepEqual(lines(join(log, 'claude.cwd')), [ws]);
  assert.ok(existsSync(`${ws}.stream.jsonl`));

  // resume.sh, given the same case, arm and label, enters that directory too.
  const rr = spawnSync('bash', [join(H, 'resume.sh'), 'gh-verified-1', 'stable', 'L1', '2'], {
    encoding: 'utf8', timeout: 60000, env,
  });
  assert.equal(rr.status, 0, `${rr.stdout}${rr.stderr}`);
  assert.deepEqual(lines(join(log, 'claude.cwd')), [ws, ws], 'bench.sh, then resume.sh, ran claude in the one workspace');
  assert.ok(existsSync(`${ws}.stream.resume2.jsonl`));
  assert.doesNotMatch(`${rr.stdout}${rr.stderr}`, /No such file/);
});
