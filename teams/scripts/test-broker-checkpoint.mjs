#!/usr/bin/env node
// broker-checkpoint.mjs: the worktree cross-check, the checkpoint/rollback pair and the
// verify-mode snapshot/restore guard, run against real throwaway git repos through the module's
// own exports.
//
//   node --test teams/scripts/test-broker-checkpoint.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyRollback,
  attributionBase,
  crossCheck,
  gitChanged,
  isWikiClaim,
  recordCheckpoint,
  verifyRestore,
  verifySnapshot,
} from '../mcp/broker-checkpoint.mjs';
import { brokerDir } from '../mcp/broker-vendors.mjs';

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

// A repo with one committed file, a.txt. `fn(dir)` may be async.
async function repo(fn) {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'broker-checkpoint-')));
  try {
    git(d, 'init', '-q');
    writeFileSync(join(d, 'a.txt'), 'one\n');
    git(d, 'add', 'a.txt');
    git(d, 'commit', '-q', '-m', 'init');
    return await fn(d);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}
async function plain(fn) {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'broker-checkpoint-plain-')));
  try { return await fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
}

test('gitChanged lists modified and untracked paths verbatim (spaces, non-ASCII), skips .teams_wiki, and is null outside git', async () => {
  await plain((d) => assert.equal(gitChanged(d), null));
  await repo((d) => {
    assert.deepEqual(gitChanged(d), []);
    writeFileSync(join(d, 'a.txt'), 'two\n');
    writeFileSync(join(d, 'with space.txt'), 'x');
    writeFileSync(join(d, '한글.txt'), 'x');
    mkdirSync(join(d, '.teams_wiki'));
    writeFileSync(join(d, '.teams_wiki', 'note.md'), 'x');
    assert.deepEqual(gitChanged(d).sort(), ['a.txt', 'with space.txt', '한글.txt'].sort());
  });
});

test('gitChanged reports a rename by its new path only', async () => {
  await repo((d) => {
    git(d, 'mv', 'a.txt', 'b.txt');
    assert.deepEqual(gitChanged(d), ['b.txt']);
  });
});

test('isWikiClaim matches a wiki page whether absolute, relative or followed by a note', () => {
  assert.equal(isWikiClaim('.teams_wiki/x.md'), true);
  assert.equal(isWikiClaim('/repo/.teams_wiki/x.md (new)'), true);
  assert.equal(isWikiClaim('src/teams_wiki.md'), false);
});

test('recordCheckpoint stamps head and a stash of dirty state once; no git leaves the node unstamped', async () => {
  await plain((d) => {
    const n = {};
    assert.equal(recordCheckpoint({ cwd: d }, n), false);
    assert.equal(n.checkpoint, undefined);
  });
  await repo((d) => {
    const head = git(d, 'rev-parse', 'HEAD');
    const clean = {};
    assert.equal(recordCheckpoint({ cwd: d }, clean), true);
    assert.equal(clean.checkpoint.head, head);
    assert.equal(clean.checkpoint.stash, null, 'a clean tree has nothing to snapshot beyond HEAD');
    assert.equal(recordCheckpoint({ cwd: d }, clean), false, 'idempotent once set');

    writeFileSync(join(d, 'a.txt'), 'dirty\n');
    const dirty = {};
    assert.equal(recordCheckpoint({ cwd: d }, dirty), true);
    assert.match(dirty.checkpoint.stash, /^[0-9a-f]{40}$/);
    assert.equal(readFileSync(join(d, 'a.txt'), 'utf8'), 'dirty\n', 'git stash create must not touch the working tree');
  });
});

test('applyRollback resets tracked edits and removes untracked files, then records rollback_applied', async () => {
  await repo((d) => {
    const run = { cwd: d, run_id: 'r1' };
    const head = git(d, 'rev-parse', 'HEAD');
    writeFileSync(join(d, 'a.txt'), 'edited\n');
    writeFileSync(join(d, 'new.txt'), 'x');
    const out = applyRollback(run, { node_id: 'implement:U1:1', checkpoint: { head } }, 'U1');
    assert.equal(out.applied, true);
    assert.equal(readFileSync(join(d, 'a.txt'), 'utf8'), 'one\n');
    assert.equal(existsSync(join(d, 'new.txt')), false);
    const events = readFileSync(join(brokerDir(d), 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(events.at(-1).event, 'rollback_applied');
    assert.equal(events.at(-1).checkpoint, head);
  });
});

test('applyRollback passes through nothing-to-do inputs and reports a reset that fails', async () => {
  assert.equal(applyRollback({ cwd: '/x' }, null, 'U1'), null);
  const skipped = { skipped: true, reason: 'why' };
  assert.equal(applyRollback({ cwd: '/x' }, skipped, 'U1'), skipped);
  const noCheckpoint = { node_id: 'n' };
  assert.equal(applyRollback({ cwd: '/x' }, noCheckpoint, 'U1'), noCheckpoint);
  await repo((d) => {
    const out = applyRollback({ cwd: d, run_id: 'r1' }, { node_id: 'n', checkpoint: { head: 'deadbeef' } }, 'U1');
    assert.equal(out.skipped, true);
    assert.match(out.reason, /git reset --hard deadbeef failed/);
    const events = readFileSync(join(brokerDir(d), 'ledger.jsonl'), 'utf8');
    assert.match(events, /rollback_failed/);
  });
});

test('attributionBase prefers the checkpoint before the subgoal\'s FIRST author attempt, else the node\'s own, else null', () => {
  const run = {
    spec: { subgoals: [{ id: 'U1' }] },
    nodes: [
      { node_id: 'implement:U1:1', stage: 'implement', subgoal_id: 'U1', attempt: 1, checkpoint: { head: 'first' } },
      { node_id: 'implement:U1:2', stage: 'implement', subgoal_id: 'U1', attempt: 2, checkpoint: { head: 'second' } },
      { node_id: 'test:U1:2', stage: 'test', subgoal_id: 'U1', attempt: 2 },
    ],
  };
  assert.equal(attributionBase(run, run.nodes[1]), 'first');
  assert.equal(attributionBase(run, run.nodes[2]), 'first', 'a judging node is attributed from the same base');
  assert.equal(attributionBase({ spec: { subgoals: [] }, nodes: [] }, { subgoal_id: null, checkpoint: { head: 'own' } }), 'own');
  assert.equal(attributionBase({ spec: { subgoals: [] }, nodes: [] }, { subgoal_id: null }), null);
});

test('crossCheck: outside git there is nothing to attribute', async () => {
  await plain((d) => assert.deepEqual(crossCheck(d, ['a.txt'], true, 'subgoal'),
    { changed_files_verified: null, change_attribution: 'no-git', contradicted_files: [] }));
});

test('crossCheck isolated: a claim the tree shows is verified, one it does not is contradicted', async () => {
  await repo((d) => {
    writeFileSync(join(d, 'a.txt'), 'two\n');
    const ok = crossCheck(d, ['a.txt'], true, 'subgoal');
    assert.equal(ok.changed_files_verified, true);
    assert.equal(ok.change_attribution, 'isolated');
    assert.deepEqual(ok.contradicted_files, []);
    const lie = crossCheck(d, ['a.txt', 'ghost.txt'], true, 'subgoal');
    assert.equal(lie.changed_files_verified, false);
    assert.deepEqual(lie.contradicted_files, ['ghost.txt']);
  });
});

test('crossCheck shared worktree: a contradiction still fails, but a clean claim is not a positive attribution', async () => {
  await repo((d) => {
    writeFileSync(join(d, 'a.txt'), 'two\n');
    const clean = crossCheck(d, ['a.txt'], false, 'subgoal');
    assert.equal(clean.changed_files_verified, null);
    assert.equal(clean.change_attribution, 'shared-worktree');
    assert.equal(crossCheck(d, ['ghost.txt'], false, 'subgoal').changed_files_verified, false);
  });
});

test('crossCheck reads a claim the way executors write it: absolute, with a note, as a glob, as ./relative', async () => {
  await repo((d) => {
    mkdirSync(join(d, 'src'));
    writeFileSync(join(d, 'src', 'x.mjs'), 'x');
    writeFileSync(join(d, 'src', 'y.mjs'), 'y');
    const claims = [join(d, 'src', 'x.mjs'), 'src/y.mjs (new file, 12 lines)', 'src/*.mjs', './src/x.mjs'];
    const r = crossCheck(d, claims, true, 'subgoal');
    assert.deepEqual(r.contradicted_files, []);
    assert.equal(r.changed_files_verified, true);
    assert.equal(crossCheck(d, ['src/*.css'], true, 'subgoal').changed_files_verified, false, 'a glob matching nothing is a contradiction');
  });
});

test('crossCheck: a document that claims no files is unattributed, not verified', async () => {
  await repo((d) => {
    writeFileSync(join(d, 'a.txt'), 'two\n');
    const r = crossCheck(d, [], true, 'document');
    assert.equal(r.changed_files_verified, null);
    assert.equal(r.change_attribution, 'document-unchanged');
  });
});

test('crossCheck: a claimed file that exists but is git-ignored is neither contradicted nor verified', async () => {
  await repo((d) => {
    writeFileSync(join(d, '.gitignore'), '.teams_output/\n');
    mkdirSync(join(d, '.teams_output', 'team'), { recursive: true });
    writeFileSync(join(d, '.teams_output', 'team', 'doc.md'), 'x');
    const r = crossCheck(d, ['.teams_output/team/doc.md'], true, 'subgoal');
    assert.deepEqual(r.contradicted_files, []);
    assert.equal(r.changed_files_verified, null);
    assert.deepEqual(r.ignored_files, ['.teams_output/team/doc.md']);
  });
});

test('crossCheck: wiki claims are dropped, and a file the node committed since its base still counts (committed_files)', async () => {
  await repo((d) => {
    const base = git(d, 'rev-parse', 'HEAD');
    writeFileSync(join(d, 'c.txt'), 'c');
    git(d, 'add', 'c.txt');
    git(d, 'commit', '-q', '-m', 'node commit');
    const r = crossCheck(d, ['c.txt', '.teams_wiki/page.md'], true, 'subgoal', base);
    assert.deepEqual(r.contradicted_files, []);
    assert.equal(r.changed_files_verified, true);
    assert.deepEqual(r.committed_files, ['c.txt']);
    assert.equal(r.change_base, base);
    assert.equal(crossCheck(d, ['c.txt'], true, 'subgoal').changed_files_verified, false, 'without the base the clean tree shows nothing');
    assert.equal(crossCheck(d, ['c.txt'], true, 'subgoal', '0000000000000000000000000000000000000000').change_base, null, 'an unreachable base falls back to status alone and says so');
  });
});

test('verifySnapshot/verifyRestore: no git means nothing to guard', async () => {
  await plain((d) => {
    const run = { cwd: d, nodes: [] };
    const snap = verifySnapshot(run, { node_id: 'x' });
    assert.deepEqual(snap, { noGit: true });
    assert.deepEqual(verifyRestore(run, { node_id: 'x' }, snap), []);
  });
});

test('verifyRestore puts back what a read-only node changed: tracked edits, new files, and bytes of an already-dirty file', async () => {
  await repo((d) => {
    writeFileSync(join(d, 'dirty.txt'), 'seed');
    git(d, 'add', 'dirty.txt');
    git(d, 'commit', '-q', '-m', 'dirty seed');
    writeFileSync(join(d, 'dirty.txt'), 'legit uncommitted work');
    const run = { cwd: d, nodes: [], spec: { subgoals: [] } };
    const n = { node_id: 'gate:U1:1', stage: 'gate' };
    const snap = verifySnapshot(run, n);
    assert.deepEqual(snap.paths, ['dirty.txt']);

    writeFileSync(join(d, 'a.txt'), 'node edit');           // tracked, clean before
    writeFileSync(join(d, 'new.txt'), 'node new file');     // untracked, absent before
    writeFileSync(join(d, 'dirty.txt'), 'node overwrote');  // dirty before
    mkdirSync(join(d, '.teams_output'), { recursive: true });
    writeFileSync(join(d, '.teams_output', 'ledger'), 'harness write'); // never blamed

    const changed = verifyRestore(run, n, snap);
    assert.deepEqual(changed.sort(), ['a.txt', 'dirty.txt', 'new.txt']);
    assert.equal(readFileSync(join(d, 'a.txt'), 'utf8'), 'one\n');
    assert.equal(existsSync(join(d, 'new.txt')), false);
    assert.equal(readFileSync(join(d, 'dirty.txt'), 'utf8'), 'legit uncommitted work');
    assert.equal(readFileSync(join(d, '.teams_output', 'ledger'), 'utf8'), 'harness write');
    assert.deepEqual(verifyRestore(run, n, snap), [], 'once restored, the verdict stands');
  });
});

test('verifyRestore does not blame a node for the declared files of a sibling that is running right now', async () => {
  await repo((d) => {
    const run = {
      cwd: d,
      spec: { subgoals: [{ id: 'U1', files: ['a.txt'] }, { id: 'U2', files: ['other/*.js'] }] },
      nodes: [
        { node_id: 'gate:U1:1', stage: 'gate', subgoal_id: 'U1', state: 'running' },
        { node_id: 'implement:U2:1', stage: 'implement', subgoal_id: 'U2', state: 'running' },
      ],
    };
    const snap = verifySnapshot(run, run.nodes[0]);
    assert.deepEqual(snap.writers, ['other/*.js']);
    mkdirSync(join(d, 'other'));
    writeFileSync(join(d, 'other', 'mine.js'), 'sibling is writing this');
    writeFileSync(join(d, 'a.txt'), 'node edit');
    assert.deepEqual(verifyRestore(run, run.nodes[0], snap), ['a.txt']);
    assert.equal(existsSync(join(d, 'other', 'mine.js')), true, 'the running sibling\'s own file is left alone');
  });
});
