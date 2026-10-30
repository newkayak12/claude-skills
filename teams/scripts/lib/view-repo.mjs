// Which tasks belong to a session's repo, for the pane, band and events of `view.mjs --once`.
// The rule is the push hold's (.claude/hooks/repo-rules.mjs, commonDir/sameRepo): the main checkout
// and every linked worktree share one `git rev-parse --git-common-dir`; a task whose cwd no longer
// resolves to a repo (or a session cwd that is not one) is matched by exact realpath. Pure node, no
// UI: the mod only draws the `worktree` this returns.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const samePath = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });

// One memo per `run`, so an injected runner (a test's counter) starts empty and the default is shared.
const memos = new WeakMap();

// { common, top } of the checkout `dir` is in (realpath'd), or null when it is not one. One git call
// per dir per process.
export function gitFacts(dir, run = git) {
  let memo = memos.get(run);
  if (!memo) memos.set(run, memo = new Map());
  if (memo.has(dir)) return memo.get(dir);
  let facts = null;
  try {
    const [common, top] = run(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel']).trim().split('\n');
    if (common && top) facts = { common: samePath(common), top: samePath(top) };
  } catch { /* not a repo, or the dir is gone */ }
  memo.set(dir, facts);
  return facts;
}

// (taskCwd) => { match, worktree }. worktree is the basename of the task's checkout when it is a
// different checkout of the session's repo, else null. The session's facts are read on first need,
// so a task in the session's own directory costs no git call.
export function repoMatcher(sessionCwd, { run = git } = {}) {
  if (!sessionCwd) return () => ({ match: true, worktree: null });
  const own = samePath(sessionCwd);
  let session;
  return (taskCwd) => {
    if (!taskCwd) return { match: false, worktree: null };
    const at = samePath(taskCwd);
    if (at === own) return { match: true, worktree: null };
    if (session === undefined) session = gitFacts(own, run);
    const task = session ? gitFacts(at, run) : null;
    if (!task || task.common !== session.common) return { match: false, worktree: null };
    return { match: true, worktree: task.top === session.top ? null : basename(task.top) };
  };
}
