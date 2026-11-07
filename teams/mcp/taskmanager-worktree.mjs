// taskmanager-worktree.mjs - worktrees, child runs and tm_clean; split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { record, taskDir, tasksRoot } from './taskstate.mjs';
import { taskFigure } from './drivercost.mjs';
import { packageName } from './names.mjs';
import { touchMarker } from './engage.mjs';
import { manifestPathOf, newTopLevelDirs } from './layout-guard.mjs';
import { epicKey, planningPkgs, qaPkgs, taskKey } from './tickets.mjs';
import { readyNodes } from './graph.mjs';

// ---------- worktrees and child runs ----------

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function shortId(taskId) {
  return String(taskId).slice(0, 8);
}

// Test seam only, never an option. The driving session does not drive: every package, every
// size-S run and the manager loop itself belong to their own headless sessions, because a
// session that relays each node's briefing and result through its own context burns it out
// (measured: 507k tokens over 331 turns, ~55% of one task's cost, dead at the usage limit).
// A test that wants to submit nodes by hand through the broker sets this and nothing spawns.
export function noDriver() { return process.env.HARNESS_TEST_NO_DRIVER === '1'; }

// The engagement marker (engage.mjs) lives at .claude/.harness-markers/ INSIDE the tree, because
// that is where the harness gate looks. It is harness state, not project content, so git must
// not see it at all: an untracked marker leaves every worktree dirty and a committed one makes
// every package branch conflict on a timestamp. info/exclude is the local, never-committed place
// for that, and it is read from the common git dir, so one write covers the repo and every
// worktree of it. install.mjs also gitignores the path for projects that want it committed.
const EXCLUDE_LINE = '.claude/.harness-markers/';
function excludeMarkers(cwd) {
  try {
    const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (!common.ok || !common.out) return false;
    const info = join(common.out, 'info');
    const file = join(info, 'exclude');
    const cur = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (cur.split(/\r?\n/).some((l) => l.trim() === EXCLUDE_LINE)) return true;
    mkdirSync(info, { recursive: true });
    writeFileSync(file, cur + (cur === '' || cur.endsWith('\n') ? '' : '\n') + EXCLUDE_LINE + '\n');
    return true;
  } catch {
    return false;
  }
}

// A worktree holds only what git committed. harness's own gate (.claude/harness-gate.json,
// enforced by .claude/hooks/goal-gate.mjs) is installed into the PROJECT tree by
// harness:install, but if the user has not yet committed it, a fresh worktree branches from a
// HEAD that never had it: the worker inside is silently ungated, while the user still believes
// tm_open is protected. Every hook here is deliberately fail-open, and this stays that way - a
// warning, never a blocked dispatch - but fail-open plus a false belief in protection is the
// trap, so it has to be said somewhere a person looks. The ledger is that place: the same
// best-effort record() every other worktree/dispatch event already uses.
function warnUncommittedGate(task, worktreePath) {
  try {
    if (!existsSync(join(task.cwd, '.claude', 'harness-gate.json'))) return;
    if (existsSync(join(worktreePath, '.claude', 'harness-gate.json'))) return;
    record(task, {
      event: 'gate_uncommitted',
      task_id: task.run_id,
      path: worktreePath,
      reason: `${task.cwd} has .claude/harness-gate.json but this worktree does not: a worktree `
        + `inherits only committed files, so the harness gate is NOT enforced here. Commit `
        + `.claude/harness-gate.json and .claude/hooks/goal-gate.mjs in the project, then retry.`,
    });
  } catch {
    /* best-effort, like touchMarker */
  }
}

// One worktree per package, kept across attempts: a retry continues in the tree the first
// attempt left, exactly as a graph retry keeps the worktree of the attempt it replaces.
// `base` is the commit or branch the tree starts from - the project's HEAD, or a dependency's
// branch so the package builds on what it depends on instead of re-discovering it at merge.
// The one place a package or integration tree gets its dir and branch; ensureWorktree and
// findGoneWorktree both ask it. A task without a slug keeps harness/<id8>/<name> and worktrees/<name>.
// With one, a package that already ran keeps the dir and branch its dispatch node stored (a retry or
// a reshaped title must not move it), else <Pid>[-<package-slug>]; integration (no title) is `name`.
function worktreeNames(task, name, title) {
  const root = join(taskDir(task.run_id), 'worktrees');
  if (!task.slug) return { path: join(root, name), branch: `harness/${shortId(task.run_id)}/${name}` };
  const stored = (task.nodes || []).filter((x) => x.stage === 'dispatch' && x.subgoal_id === name && x.child && x.child.cwd && x.child.branch).pop();
  if (stored) return { path: stored.child.cwd, branch: stored.child.branch };
  const label = title == null ? name : packageName(name, title);
  return { path: join(root, label), branch: `teams/${task.slug}/${label}` };
}

// A branch some node of this task recorded: the only existing ref a slugged task may reuse.
function recordedBranch(task, branch) {
  return (task.nodes || []).some((x) => (x.child && x.child.branch === branch) || (x.integration && x.integration.branch === branch));
}

function ensureWorktree(task, name, base = 'HEAD', title) {
  const { path, branch } = worktreeNames(task, name, title);
  if (existsSync(join(path, '.git'))) {
    // The harness gate (if this project also installs harness) reads .claude/.harness-markers/
    // from the session's cwd, which for a worker IS this worktree. See engage.mjs.
    excludeMarkers(path);
    touchMarker(path, task.run_id);
    warnUncommittedGate(task, path);
    return { ok: true, path, branch, created: false };
  }
  // Created only on the first open. A tree this task already ran a child in that is not there now
  // was deleted from outside: re-creating it from the branch would hand a driver a tree without
  // the work it had, so it is refused and the daemon stops (worktreeGoneStop).
  if (wasOpened(task, path)) return { ok: false, gone: true, path, branch, reason: `the worktree at ${path} is gone` };
  mkdirSync(dirname(path), { recursive: true });
  const exists = git(task.cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
  // A slug names this task alone: a branch under it that no node recorded was made by someone else
  // (two tm_open calls racing to one slug), and building on it would mix their work into this one.
  if (exists && task.slug && !recordedBranch(task, branch)) {
    return { ok: false, path, branch, reason: `branch ${branch} already exists and this task did not create it` };
  }
  const r = exists
    ? git(task.cwd, ['worktree', 'add', path, branch])
    : git(task.cwd, ['worktree', 'add', '-b', branch, path, base]);
  if (!r.ok) return { ok: false, path, branch, reason: r.err || r.out || 'git worktree add failed' };
  excludeMarkers(path);
  touchMarker(path, task.run_id);
  warnUncommittedGate(task, path);
  return { ok: true, path, branch, created: !exists };
}

// A child run changes files; it does not commit. The package branch has to carry the work for
// anything downstream to build on it, so the manager commits the worktree when it folds an
// accepted child. This writes to git, not to the child's run file - the run file stays the
// broker's alone. The run's own state directory is left out of the commit - by unstaging it
// after the add, not by a negative pathspec: when the project's .gitignore already lists
// .teams_output/ (the usual case), git refuses `:!.teams_output` as "a path that is ignored" and
// exits 1 before staging anything. The first e2e task to reach a fold failed exactly there,
// with both children accepted and nothing committed.
// Everything under the worktree that is harness state rather than delivered work. .teams_output
// and the marker dir are always relative; the tasks root usually is not - it defaults to
// ~/.harness/tasks, outside any project - but HARNESS_TASKS_DIR can put it inside the tree, and
// then a fold commits the whole manager: idol-pm-1's planning commit (2026-09-22) carried 1,520
// lines of task.json, board/ledger jsonl and a 1,326-line raw vendor stream log alongside the
// 220-line PRD that was the only thing anyone wanted.
export function harnessPathsUnder(cwd) {
  const paths = ['.teams_output', '.claude/.harness-markers'];
  // Both sides as realpaths. On macOS $TMPDIR is /var/..., which is /private/var/...; a package's
  // cwd arrives as the realpath and HARNESS_TASKS_DIR as given, so relative() walked out through
  // `..` and called the manager's own state outside the tree. idol-pm-4 (2026-09-23) committed
  // eight .harness-tasks files into P1's product branch that way - the same /var trap 0.8.1 hit.
  // A path that does not exist yet resolves through its nearest existing ancestor.
  const real = (p) => {
    const abs = resolve(p);
    try { return realpathSync(abs); } catch { /* not there yet */ }
    const up = dirname(abs);
    return up === abs ? abs : join(real(up), basename(abs));
  };
  try {
    const rel = relative(real(cwd), real(tasksRoot()));
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) paths.push(rel);
  } catch { /* an unresolvable root is simply not inside this tree */ }
  return paths;
}

// `git add`/`rm --cached`/`commit` each take the worktree's index.lock. Two processes folding the
// same child at once (daemon fold loop vs a direct tm_submit) no longer happens: the fold claim
// (claimed in a mutateTask) lets one of them fold. The retry stays as defence against a user's
// own git, or another tool, holding index.lock for a few milliseconds - contention, not a broken
// tree: wait it out, briefly and boundedly, rather than turn a passed package into a failed dispatch.
const INDEX_LOCK_RETRIES = 8;
const INDEX_LOCK_WAIT_MS = 150;
function gitIndexed(cwd, args) {
  let r = git(cwd, args);
  for (let i = 0; !r.ok && /index\.lock/.test(r.err) && i < INDEX_LOCK_RETRIES; i++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, INDEX_LOCK_WAIT_MS);
    r = git(cwd, args);
  }
  return r;
}

// opts.layoutGuard (card 86): refuse the commit when it adds a top-level directory the pre-commit
// HEAD does not have (layout-guard.mjs: dot-dirs and a directory carrying its own
// .claude-plugin/plugin.json are exempt). Nothing is committed, the index is put back, and the
// files stay on disk so the retried node can delete them: {ok:false, layout:[dirs], paths:[files], reason}.
// foldChild passes it only for qa, audit and repair packages - a develop package legitimately
// creates src/ in a greenfield project. The same check at integrate, as a backstop for a develop
// package that adds one anyway, is an open question and not done here.
export function commitWorktree(cwd, message, opts = {}) {
  const add = gitIndexed(cwd, ['add', '-A', '--', '.']);
  if (!add.ok) return { ok: false, reason: add.err || 'git add failed' };
  // .claude/.harness-markers/ gets the same treatment for the same reason, plus one of its own:
  // every worktree writes its own marker with its own timestamp (engage.mjs), so committing it
  // would make every package branch differ in that one file and every integrate merge conflict
  // on it. install.mjs gitignores it in a real project; a project without it must not break.
  const drop = gitIndexed(cwd, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', ...harnessPathsUnder(cwd)]);
  if (!drop.ok) return { ok: false, reason: drop.err || 'could not leave the harness state out of the commit' };
  const staged = git(cwd, ['diff', '--cached', '--quiet']);
  if (staged.ok) return { ok: true, commit: null }; // nothing to commit is not an error
  if (opts.layoutGuard) {
    const tops = git(cwd, ['ls-tree', '-d', '--name-only', '-z', 'HEAD']);
    if (tops.ok) { // no HEAD (an unborn branch) has no layout to compare with
      const paths = git(cwd, ['diff', '--cached', '--name-only', '-z']).out.split('\0').filter(Boolean);
      const baseDirs = tops.out.split('\0').filter(Boolean);
      const layout = newTopLevelDirs(paths, baseDirs, (d) => paths.includes(manifestPathOf(d)));
      if (layout.length) {
        const reset = gitIndexed(cwd, ['reset', '-q']);
        if (!reset.ok) return { ok: false, reason: reset.err || 'could not unstage the refused commit' };
        const offending = paths.filter((p) => layout.includes(p.split('/')[0]) && p.includes('/'));
        return {
          ok: false, layout, paths: offending,
          reason: `new top-level director${layout.length === 1 ? 'y' : 'ies'} ${layout.map((d) => `${d}/`).join(', ')} (${offending.length} file(s): ${offending.join(', ')})`,
        };
      }
    }
  }
  const c = gitIndexed(cwd, ['commit', '-q', '-m', message]);
  if (!c.ok) return { ok: false, reason: c.err || 'git commit failed' };
  return { ok: true, commit: git(cwd, ['rev-parse', 'HEAD']).out };
}

// Merge one branch into a worktree. A conflict is observed, not reported: the files git
// marks unmerged are the evidence, and the merge is aborted so the tree stays usable.
function mergeInto(cwd, branch, message) {
  const r = git(cwd, ['merge', '--no-ff', '--no-edit', '-m', message, branch]);
  if (r.ok) return { ok: true, commit: git(cwd, ['rev-parse', 'HEAD']).out };
  const conflicts = git(cwd, ['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
  git(cwd, ['merge', '--abort']);
  return { ok: false, conflicts, reason: r.err || r.out || 'merge failed' };
}

// ---------- tm_clean: EPIC teardown (§14 C-11) ----------
//
// A package worktree (ensureWorktree(task, pkg.id, ...)) accumulates forever once its dispatch
// is done - nothing server-owned ever removes it. Only the tree, never the integration tree: a
// repair/qa/audit package reuses the integration worktree wholesale (openChild), and a package
// merges INTO it (prepareIntegration) - teams never merges an integration branch into the
// project's own branch (v0.31.1's finding, still true), so that branch is the only place this
// task's accepted work survives once package branches are gone. A planning card has a worktree
// of its own (cards-everywhere C2) and is cleaned like a package: its branch is deleted once plan-integrate
// is done (the PRD is snapshotted), and the merged 10-prd.md does not need the tree - the
// planning integrate snapshotted every card's section (preparePlanIntegration).
//
// One candidate per package id: ensureWorktree keeps exactly one worktree per id for the whole
// task, reused by every attempt (retries included), so collecting every dispatch node's
// n.child.cwd/branch and keying by cwd already de-duplicates across attempts.
function dispatchWorktreeCandidates(task) {
  const byCwd = new Map();
  for (const n of task.nodes) {
    if (n.stage === 'dispatch' && n.child && n.child.branch && n.child.cwd && n.child.cwd !== task.cwd) {
      if (!byCwd.has(n.child.cwd)) byCwd.set(n.child.cwd, { package_id: n.subgoal_id, cwd: n.child.cwd, branch: n.child.branch });
    }
  }
  return [...byCwd.values()];
}

// Every integration tree this task ever opened (integrate:1, integrate:2 after a conflict
// reshape, a repair round that reused the prior one's tree) - the delivered result(s). Never a
// clean target: see the header above.
function integrationTrees(task) {
  const out = [];
  const seen = new Set();
  for (const n of task.nodes) {
    if (n.stage === 'integrate' && n.integration && n.integration.cwd && !seen.has(n.integration.cwd)) {
      seen.add(n.integration.cwd);
      out.push({ node_id: n.node_id, cwd: n.integration.cwd, branch: n.integration.branch });
    }
  }
  return out;
}

// A package branch is safe to delete once every commit on it is reachable from somewhere the
// work survives without it: an integration branch it was merged into, or the project's own HEAD
// (a user may have merged or cherry-picked it there by hand). Returns the ref it is reachable
// from, or null - never guessed, always checked with git itself.
function branchReachableFrom(cwd, branch, refs) {
  for (const ref of refs) {
    if (!ref) continue;
    if (!git(cwd, ['rev-parse', '--verify', '--quiet', ref]).ok) continue;
    if (git(cwd, ['merge-base', '--is-ancestor', branch, ref]).ok) return ref;
  }
  return null;
}

// Runs (or, dry_run, plans) the teardown for one task already known to be terminal (see
// toolClean). Removing a worktree never loses work - the branch ref keeps every commit whether
// or not a tree is checked out against it - so the worktree directory is always removed once the
// task is done; only the BRANCH is conditional on reachability, per the tool's own contract
// ("never delete a branch with commits not reachable from the integrated result").
function cleanTask(task, dryRun) {
  const keep = integrationTrees(task);
  const keepCwds = new Set([task.cwd, ...keep.map((k) => k.cwd)]);
  const refs = [...keep.map((k) => k.branch), 'HEAD'];
  const candidates = dispatchWorktreeCandidates(task).filter((c) => !keepCwds.has(c.cwd));
  const planIntegrated = task.nodes.some((n) => n.stage === 'plan-integrate' && n.state === 'done');
  const removed_worktrees = [];
  const removed_branches = [];
  const kept_branches = [];
  const already_clean = [];
  // The node-adapter sessions live in the worktrees about to go: write the spend while they exist.
  if (!dryRun) {
    try {
      const fig = taskFigure(taskDir(task.run_id), task);
      record(task, { event: 'cost_recorded', task_id: task.run_id, spend: fig.spend, estimated: fig.estimated });
    } catch { /* the ledger is evidence, not a dependency */ }
  }
  for (const c of candidates) {
    const branchRef = `refs/heads/${c.branch}`;
    const branchExists = git(task.cwd, ['rev-parse', '--verify', '--quiet', branchRef]).ok;
    const worktreeExists = existsSync(join(c.cwd, '.git'));
    if (!branchExists && !worktreeExists) { already_clean.push({ package_id: c.package_id, cwd: c.cwd, branch: c.branch }); continue; }
    // A planning card's branch carries a PRD commit no integration branch holds. Once plan-integrate
    // is done its section is snapshotted into 10-prd.md, so the branch this task made is spent.
    const spentPlanCard = planIntegrated && recordedBranch(task, c.branch) && (task.planning_pkgs || []).some((p) => p.id === c.package_id);
    const reachableVia = branchExists ? (branchReachableFrom(task.cwd, c.branch, refs) || (spentPlanCard ? 'plan-integrate' : null)) : null;
    if (dryRun) {
      if (worktreeExists) removed_worktrees.push({ package_id: c.package_id, cwd: c.cwd, branch: c.branch });
      if (branchExists) {
        if (reachableVia) removed_branches.push({ package_id: c.package_id, branch: c.branch, reachable_via: reachableVia });
        else kept_branches.push({ package_id: c.package_id, branch: c.branch, reason: 'not reachable from any integration branch or the project HEAD - would remove only the worktree directory and keep this branch' });
      }
      continue;
    }
    if (worktreeExists) {
      const rm = git(task.cwd, ['worktree', 'remove', '--force', c.cwd]);
      if (rm.ok || !existsSync(c.cwd)) removed_worktrees.push({ package_id: c.package_id, cwd: c.cwd, branch: c.branch });
      else kept_branches.push({ package_id: c.package_id, branch: c.branch, cwd: c.cwd, reason: `could not remove the worktree: ${rm.err || rm.out}` });
    }
    if (branchExists) {
      if (reachableVia) {
        const del = git(task.cwd, ['branch', '-D', c.branch]);
        if (del.ok) removed_branches.push({ package_id: c.package_id, branch: c.branch, reachable_via: reachableVia });
        else kept_branches.push({ package_id: c.package_id, branch: c.branch, reason: `could not delete the branch: ${del.err || del.out}` });
      } else {
        kept_branches.push({ package_id: c.package_id, branch: c.branch, reason: 'not reachable from any integration branch or the project HEAD - kept, worktree directory removed' });
      }
    }
  }
  git(task.cwd, ['worktree', 'prune']);
  // Recorded even when nothing was removed: .claude/hooks/repo-rules.mjs releases its push hold on a last `clean` event.
  if (!dryRun) {
    record(task, {
      event: 'clean', task_id: task.run_id,
      removed_worktrees: removed_worktrees.map((x) => x.package_id),
      removed_branches: removed_branches.map((x) => x.package_id),
      kept_branches: kept_branches.map((x) => x.package_id),
    });
  }
  return {
    task_id: task.run_id, dry_run: dryRun,
    kept: keep.map((k) => ({ node_id: k.node_id, cwd: k.cwd, branch: k.branch })),
    removed_worktrees, removed_branches, kept_branches, already_clean,
  };
}

// Packages in an order where every dependency comes before what depends on it.
function dependencyOrder(packages) {
  const byId = new Map(packages.map((p) => [String(p.id), p]));
  const out = [];
  const seen = new Set();
  const visit = (p) => {
    const id = String(p.id);
    if (seen.has(id)) return;
    seen.add(id);
    for (const d of p.deps || []) if (byId.has(String(d))) visit(byId.get(String(d)));
    out.push(p);
  };
  for (const p of packages) visit(p);
  return out;
}

// Which of the given packages own a conflicting path, by their declared touches[]. Declared
// ownership is a claim; the conflict is the fact. Both go in the reason so shape can see
// where the claim and the fact disagreed.
function ownersOf(packages, files) {
  const owners = new Set();
  for (const f of files) {
    for (const p of packages) {
      if ((p.touches || []).some((t) => { const k = String(t).replace(/\/+$/, ''); return f === k || f.startsWith(k + '/'); })) owners.add(String(p.id));
    }
  }
  return [...owners];
}

// The branch a dependency delivered on, if its dispatch has folded.
function deliveredBranch(task, pkgId) {
  const d = task.nodes.filter((n) => n.subgoal_id === String(pkgId) && n.stage === 'dispatch' && n.state === 'done' && n.child).pop();
  return d ? d.child.branch : null;
}

export function packageOf(task, id) {
  // The planning cards live on task.planning_pkgs, not task.spec.packages: their dispatch/accept
  // run before shape, while task.spec is still null (§0.1, cards-everywhere C2).
  const plan = planningPkgs(task).find((p) => String(p.id) === String(id));
  if (plan) return plan;
  // Same reasoning for the QA cards: expandPackages stashes them on task.qa_pkgs rather than
  // pushing them into task.spec.packages, which shape (not the manager) owns.
  const qa = qaPkgs(task).find((p) => String(p.id) === String(id));
  if (qa) return qa;
  // And the audit phase-Team's, for the same reason again: openAudit stashes it on task.audit_pkg
  // when planning's second pass opens, long after shape has closed its own package list.
  if (task.audit_pkg && String(task.audit_pkg.id) === String(id)) return task.audit_pkg;
  return ((task.spec && task.spec.packages) || []).find((p) => String(p.id) === String(id)) || null;
}

// A repair package gets no worktree of its own: it runs IN the integration worktree of the
// integrate that refused, because that is the only tree the seam exists in. Everything else
// about it is an ordinary package, which is why this returns the same shape ensureWorktree
// does - created:false, since the tree is already there with every package branch merged.
function repairWorktree(task, pkg) {
  const src = task.nodes.find((x) => x.node_id === String(pkg.integration_of) && x.integration);
  if (!src) return { ok: false, path: null, branch: null, reason: `${pkg.id} repairs ${pkg.integration_of}, which has no integration worktree` };
  if (!existsSync(join(src.integration.cwd, '.git'))) return { ok: false, gone: true, path: src.integration.cwd, branch: src.integration.branch, reason: `the integration worktree at ${src.integration.cwd} is gone` };
  return { ok: true, path: src.integration.cwd, branch: src.integration.branch, created: false };
}

// A package tree some node of this task already ran a child in.
function wasOpened(task, path) {
  return (task.nodes || []).some((x) => x.child && x.child.cwd === path);
}

// A directory a driver (or judge) is about to be spawned into that is gone, or null. Checked
// before any spawn, not after one failed: a package tree that existed and vanished (running child,
// a retry about to reopen it, a repair/QA/audit package's integration tree) and the task's own
// cwd. A tree not yet created is not gone - ensureWorktree makes it on the first open.
export function findGoneWorktree(task) {
  if (task.cwd && !existsSync(task.cwd)) return { kind: 'task_cwd', node_id: null, subgoal_id: null, path: task.cwd };
  for (const n of task.nodes || []) {
    if (n.stage === 'dispatch' && n.state === 'running' && n.child && n.child.cwd && !existsSync(n.child.cwd)) {
      return { kind: 'package', node_id: n.node_id, subgoal_id: n.subgoal_id, path: n.child.cwd };
    }
  }
  for (const n of readyNodes(task)) {
    if (n.stage !== 'dispatch' || n.state !== 'pending') continue;
    const pkg = packageOf(task, n.subgoal_id);
    if (!pkg) continue;
    if (pkg.repair || pkg.phase === 'qa' || pkg.phase === 'audit') {
      const src = task.nodes.find((x) => x.node_id === String(pkg.integration_of) && x.integration);
      if (src && !existsSync(join(src.integration.cwd, '.git'))) return { kind: 'integration', node_id: n.node_id, subgoal_id: n.subgoal_id, path: src.integration.cwd };
      continue;
    }
    const { path } = worktreeNames(task, String(pkg.id), pkg.title);
    if (!existsSync(join(path, '.git')) && wasOpened(task, path)) return { kind: 'package', node_id: n.node_id, subgoal_id: n.subgoal_id, path };
  }
  return null;
}

// The daemon's stop for a gone directory: nothing is spawned into it, one `worktree_gone` event
// names the node key and the missing path, and taskState reads blocked until a person decides
// (tm_cancel, or tm_clean once it is settled). Inside a transaction; the flag rides its commit.
// Returns the stop, whether it was written now or already stood.
export function worktreeGoneStop(task, found = null) {
  if (task.worktree_gone || task.cancelled) return task.worktree_gone || null;
  const f = found || findGoneWorktree(task);
  if (!f) return null;
  const key = f.key || (f.node_id ? taskKey(task.run_id, f.subgoal_id, f.node_id) : epicKey(task.run_id));
  const reason = f.kind === 'task_cwd'
    ? `the task's own directory ${f.path} is gone`
    : `the ${f.kind === 'integration' ? 'integration' : 'package'} worktree ${f.path} is gone`;
  task.worktree_gone = { kind: f.kind, node_id: f.node_id, key, path: f.path, reason, at: Date.now() };
  record(task, { event: 'worktree_gone', task_id: task.run_id, node_id: f.node_id, key, path: f.path, kind: f.kind, reason });
  return task.worktree_gone;
}

// Where integration round N starts. Normally the project's HEAD, with every package branch
// merged in. But once a repair package has been accepted, its delivered branch IS the
// integration branch of the round that failed, now carrying the repair commit: merging the
// package branches into a fresh tree from HEAD would rebuild exactly the tree the repair was
// made against and throw the repair away. This finds that branch - named by the integrate's
// own deps first, and otherwise by the latest accepted repair package the shape holds.
function repairBase(task, n) {
  const named = (n.deps || []).map((d) => /^accept:(.+):\d+$/.exec(String(d))).filter(Boolean).map((m) => m[1]);
  const rest = ((task.spec && task.spec.packages) || []).map((p) => String(p.id)).reverse();
  for (const id of [...named, ...rest]) {
    const pkg = packageOf(task, id);
    if (!pkg || !pkg.repair) continue;
    const branch = deliveredBranch(task, id);
    const d = task.nodes.filter((x) => x.subgoal_id === String(id) && x.stage === 'dispatch' && x.state === 'done' && x.result && x.result.accept === true).pop();
    if (!branch || !d) continue;
    return { package: String(pkg.id), branch, commit: (d.result && d.result.commit) || null };
  }
  return null;
}

// Does this worktree's HEAD already contain that branch? Cheap, and the only way to tell a
// package branch the repair was made on from one a retry delivered while the repair ran.
function containsBranch(cwd, branch) {
  return git(cwd, ['merge-base', '--is-ancestor', branch, 'HEAD']).ok;
}

// The base a package's own diff is read from: the commit its latest dispatch opened on when that
// is still behind the branch, else the merge-base with this tree.
function packageDiffBase(task, cwd, pkgId, branch) {
  const d = task.nodes.filter((x) => x.stage === 'dispatch' && x.subgoal_id === String(pkgId) && x.base_commit).pop();
  if (d && git(cwd, ['merge-base', '--is-ancestor', d.base_commit, branch]).ok) return d.base_commit;
  const mb = git(cwd, ['merge-base', 'HEAD', branch]);
  return mb.ok && mb.out ? mb.out : null;
}

// Is a package's own change already in this tree? Its diff is empty, or reverse-applies cleanly
// (a commit that is not an ancestor can still carry text the tree already has). E-ea14c9c4 (card
// 109): filed duplicates of one fix were built and accepted, and merging the second one again
// ended integrate `blocked`. Fails open: any git error reads "not applied" and the merge runs.
function alreadyApplied(task, cwd, pkgId, branch) {
  const base = packageDiffBase(task, cwd, pkgId, branch);
  if (!base) return false;
  const d = spawnSync('git', ['diff', '--binary', base, branch], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (d.status !== 0) return false;
  if (!d.stdout) return true;
  return spawnSync('git', ['apply', '--check', '--reverse', '-'], { cwd, input: d.stdout, encoding: 'utf8' }).status === 0;
}

// The files a package branch changes on its own, for naming who a deferred conflict is with.
function packageDiffFiles(task, cwd, pkgId, branch) {
  const base = packageDiffBase(task, cwd, pkgId, branch);
  return base ? git(cwd, ['diff', '--name-only', base, branch]).out.split('\n').filter(Boolean) : [];
}

export { alreadyApplied, cleanTask, containsBranch, deliveredBranch, dependencyOrder, ensureWorktree, excludeMarkers, git, integrationTrees, mergeInto, ownersOf, packageDiffFiles, repairBase, repairWorktree };
