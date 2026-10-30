// The repo rule behind the pane, band and events (lib/view-repo.mjs, mirroring the push hold in
// .claude/hooks/repo-rules.mjs): a session sees the tasks of its repo's main checkout and every linked
// worktree. Every fixture is a scratch git repo and tasks root; nothing outside tmpdir is read.
//
//   node --test teams/scripts/test-view-repo.mjs
process.env.TEAMS_RUNS_DIR ??= 'off';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { node } from '../mcp/graph.mjs';
import { gitFacts, repoMatcher } from './lib/view-repo.mjs';

const VIEW = join(dirname(fileURLToPath(import.meta.url)), 'view.mjs');
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'ignore' });

let root, main, wt, other, gone, plain;
before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'view-repo-')));
  main = join(root, 'main'); wt = join(root, 'feature-wt'); other = join(root, 'other'); gone = join(root, 'gone'); plain = join(root, 'plain');
  for (const d of [main, other, gone, plain]) mkdirSync(d);
  for (const d of [main, other, gone]) { git(d, 'init', '-q'); git(d, 'commit', '-q', '--allow-empty', '-m', 'i'); }
  git(main, 'worktree', 'add', '-q', wt);
  rmSync(gone, { recursive: true, force: true });
});
after(() => rmSync(root, { recursive: true, force: true }));

// a runner that counts its calls and delegates to real git
const counting = () => {
  const run = (dir, args) => { run.calls.push(dir); return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); };
  run.calls = [];
  return run;
};

test('gitFacts: common dir and top level, realpath-ed; null outside a repo; one call per dir', () => {
  const run = counting();
  const a = gitFacts(main, run);
  const b = gitFacts(wt, run);
  assert.equal(a.top, main);
  assert.equal(b.top, wt);
  assert.equal(a.common, b.common, 'one common dir for main and its worktree');
  assert.notEqual(a.common, gitFacts(other, run).common);
  assert.equal(gitFacts(plain, run), null);
  assert.equal(gitFacts(gone, run), null);
  gitFacts(main, run); gitFacts(plain, run);
  assert.equal(run.calls.length, 5, 'a repeat dir (even a null one) is not asked again');
});

test('repoMatcher: no session cwd matches everything, unmarked', () => {
  assert.deepEqual(repoMatcher(undefined)(other), { match: true, worktree: null });
});

test('repoMatcher: same directory matches with no git call; a symlinked path is the same directory', () => {
  const run = counting();
  const m = repoMatcher(main, { run });
  assert.deepEqual(m(main), { match: true, worktree: null });
  assert.deepEqual(m(join(main, '..', 'main')), { match: true, worktree: null });
  assert.equal(run.calls.length, 0);
});

test('repoMatcher: a linked worktree matches both ways, marked with its own basename', () => {
  assert.deepEqual(repoMatcher(main)(wt), { match: true, worktree: 'feature-wt' });
  assert.deepEqual(repoMatcher(wt)(main), { match: true, worktree: 'main' });
});

test('repoMatcher: another repo does not match', () => {
  assert.deepEqual(repoMatcher(main)(other), { match: false, worktree: null });
});

test('repoMatcher: a task cwd that is gone or not a repo falls back to exact path, so it does not match', () => {
  const m = repoMatcher(main);
  assert.equal(m(gone).match, false);
  assert.equal(m(plain).match, false);
  assert.equal(m('').match, false);
});

test('repoMatcher: a session cwd that is not a repo matches only itself', () => {
  const m = repoMatcher(plain);
  assert.deepEqual(m(plain), { match: true, worktree: null });
  assert.equal(m(main).match, false);
});

test('memo: N tasks over K distinct cwds ask git at most K+1 times; none when all equal the session cwd', () => {
  const run = counting();
  const m = repoMatcher(main, { run });
  const cwds = [wt, wt, other, other, other, gone, plain, wt];
  for (const c of cwds) m(c);
  assert.ok(run.calls.length <= 4 + 1, `calls: ${run.calls.length}`);
  const none = counting();
  const same = repoMatcher(main, { run: none });
  for (let i = 0; i < 6; i++) same(main);
  assert.equal(none.calls.length, 0);
});

// ---------- view.mjs --once ----------
let tasks;
const ID = { main: 'E-aaaaaaaa1111', wt: 'E-bbbbbbbb2222', other: 'E-cccccccc3333', gone: 'E-dddddddd4444' };
before(() => {
  tasks = join(root, 'tasks');
  const mk = (id, cwd, created) => {
    mkdirSync(join(tasks, id), { recursive: true });
    writeFileSync(join(tasks, id, 'task.json'), JSON.stringify({
      run_id: id, kind: 'task', cwd, request: `request ${id}`, created_at: Date.now() - created, store_path: join(tasks, id, 'task.json'),
      nodes: [node('size', 'size', [], { state: 'done' }), node('shape', 'shape', ['size'], { state: 'running' })],
      daemon: { pid: process.pid },
    }));
    writeFileSync(join(tasks, id, 'ledger.jsonl'), JSON.stringify({ ts: 5, event: 'daemon_exhausted', task_id: id }) + '\n');
  };
  mk(ID.main, main, 4000); mk(ID.wt, wt, 3000); mk(ID.other, other, 2000); mk(ID.gone, gone, 1000);
});

const once = (format, cwd) => {
  const r = spawnSync(process.execPath, [VIEW, '--once', '--format', format, '--tasks-dir', tasks, '--cwd', cwd], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const ids = (rows) => rows.map((t) => t.task_id).sort();

test('--format summary and teams: the worktree task is listed with its mark, the main task with null, others absent', () => {
  for (const format of ['summary', 'teams']) {
    const o = JSON.parse(once(format, main));
    assert.deepEqual(ids(o.tasks), [ID.main, ID.wt].sort(), format);
    assert.equal(o.tasks.find((t) => t.task_id === ID.wt).worktree, 'feature-wt');
    assert.equal(o.tasks.find((t) => t.task_id === ID.main).worktree, null);
  }
  const t = JSON.parse(once('teams', main));
  assert.equal(t.status.latest, ID.wt, 'the newest running task of the repo is the pane task');
  assert.equal(t.task.worktree, 'feature-wt');
});

test('the reverse: a session in the worktree sees the main-checkout task marked with the main basename', () => {
  const o = JSON.parse(once('summary', wt));
  assert.equal(o.tasks.find((t) => t.task_id === ID.main).worktree, 'main');
  assert.equal(o.tasks.find((t) => t.task_id === ID.wt).worktree, null);
});

test('--format status: the line names the worktree task with @<worktree>', () => {
  const line = JSON.parse(once('status', main)).line;
  assert.match(line, /E-bbbbbbbb \d+\/\d+ \S* ?@feature-wt/);
  assert.ok(line.includes('E-aaaaaaaa') && !line.includes('E-cccccccc') && !line.includes('E-dddddddd'));
  assert.ok(!/E-aaaaaaaa[^·]*@/.test(line), 'the main task is unmarked');
});

test('--format board: names the pane task of the repo, not the other repo', () => {
  const text = once('board', main);
  assert.ok(text.includes('bbbbbbbb') || text.includes('request'), text);
  assert.ok(!text.includes('cccccccc'));
});

test('--format events: the worktree task events are included, the other repo and the deleted dir are not', () => {
  const evs = once('events', main).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(evs.map((e) => e.task_id).sort(), [ID.main, ID.wt].sort());
});
