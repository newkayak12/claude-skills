// broker-checkpoint.mjs - the worktree cross-check and the checkpoint / rollback machinery,
// cut out of broker.mjs (card 128). Imports only broker-vendors.mjs (ledger, HARNESS_ROOT) and
// graph.mjs.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { authorStage, nodeKind } from './graph.mjs';
import { HARNESS_ROOT, record } from './broker-vendors.mjs';

// ---------- worktree cross-check ----------

export function gitChanged(cwd) {
  // -z: paths verbatim - the default output quotes any path with a space or non-ASCII byte,
  // and a quoted path never equals the claim. A rename is "R  new\0old", so the entry after a
  // rename/copy is its source and is skipped.
  const r = spawnSync('git', ['-c', 'core.quotePath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  const parts = r.stdout.split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    if (!isWikiPath(e.slice(3))) out.push(e.slice(3));
    if (e[0] === 'R' || e[0] === 'C') i++;
  }
  return out;
}

// What was committed between `base` and HEAD - a node that commits its own work leaves git status
// clean (runit-u10b child-P1-1: be40eee, 5fe1b85, all three attempts called liars). [] when there
// is no base; null when base is not an ancestor of HEAD (reset/rebased away), so crossCheck falls
// back to status alone. --no-renames lists both sides of a rename; a deletion is listed too.
function gitChangedSince(cwd, base) {
  if (!base) return [];
  if (spawnSync('git', ['merge-base', '--is-ancestor', base, 'HEAD'], { cwd }).status !== 0) return null;
  const r = spawnSync('git', ['-c', 'core.quotePath=false', 'diff', '--name-only', '--no-renames', '-z', base, 'HEAD'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  return r.stdout.split('\0').filter((p) => p && !isWikiPath(p));
}

// ---------- checkpoint / rollback (_repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md §5) ----------

function gitHead(cwd) {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// `git stash create` writes a commit object holding the dirty state WITHOUT touching the
// working tree or the stash ref (unlike `git stash push`/`save`) - a read, not a mutation, so it
// is safe to call on every dispatch even though most of them are never rolled back to. Empty
// output (clean tree) is not an error; there is simply nothing to snapshot beyond HEAD.
function gitStashCreate(cwd) {
  const r = spawnSync('git', ['stash', 'create'], { cwd, encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  return r.status === 0 && out ? out : null;
}

// Called once per node, right before its attempt starts doing work (team_run's vendor path,
// team_next's self-vendor offer). A no-git cwd (isolated:false test fixtures, mostly) leaves
// n.checkpoint unset - rollback then has nothing to target and retrySubgoal's own guard reports
// why, exactly like the no-git branch of crossCheck reports 'no-git' rather than failing.
export function recordCheckpoint(run, n) {
  if (n.checkpoint) return false;
  const head = gitHead(run.cwd);
  if (!head) return false;
  n.checkpoint = { head, stash: gitStashCreate(run.cwd), at: Date.now() };
  return true;
}

// The other half of retrySubgoal's `rollback` decision: it names the checkpoint, this performs
// it. Reset discards the failed attempt's edits (tracked and untracked alike - clean -fd, the
// same reach `git status --porcelain --untracked-files=all` already gives crossCheck) and returns
// to the head recorded before that attempt began. The stash object is not popped: reset --hard
// already puts the tree at that exact commit, and popping on top of it would reapply the very
// edits rollback exists to discard - the stash ref is kept only as an inspectable record of what
// was thrown away (`git stash show/apply <sha>` if a person wants to look).
export function applyRollback(run, rollback, subgoalId) {
  if (!rollback || rollback.skipped || !rollback.checkpoint) return rollback || null;
  const { head } = rollback.checkpoint;
  const reset = spawnSync('git', ['reset', '--hard', head], { cwd: run.cwd, encoding: 'utf8' });
  if (reset.status !== 0) {
    record(run.cwd, { event: 'rollback_failed', run_id: run.run_id, subgoal_id: subgoalId, node_id: rollback.node_id, reason: (reset.stderr || '').trim() });
    return { skipped: true, reason: `git reset --hard ${head} failed: ${(reset.stderr || '').trim()}` };
  }
  spawnSync('git', ['clean', '-fd'], { cwd: run.cwd, encoding: 'utf8' });
  record(run.cwd, { event: 'rollback_applied', run_id: run.run_id, subgoal_id: subgoalId, node_id: rollback.node_id, checkpoint: head });
  return { ...rollback, applied: true };
}

// The commit a node's claims are attributed from: the checkpoint before its subgoal's FIRST author
// attempt (the same firstAuthor graph.mjs's retrySubgoal rolls back to), so attempt 2 re-claiming
// what attempt 1 committed still counts. Falls back to the node's own checkpoint, else none.
export function attributionBase(run, n) {
  const stage = authorStage(nodeKind(run, n));
  const first = n.subgoal_id
    ? run.nodes.find((x) => x.subgoal_id === n.subgoal_id && x.stage === stage && (x.attempt || 1) === 1)
    : null;
  return first?.checkpoint?.head || n.checkpoint?.head || null;
}

// Positive attribution is only sound when this node had the worktree to itself.
// Otherwise null - "could not attribute" is neither a pass nor a failure.
export function crossCheck(cwd, claimed, isolated, kind, sinceBase = null) {
  const status = gitChanged(cwd);
  if (status === null) return { changed_files_verified: null, change_attribution: 'no-git', contradicted_files: [] };
  // Files the node committed since its attribution base count as changed too. Unreachable base ->
  // status only, and change_base null says so.
  const since = gitChangedSince(cwd, sinceBase);
  const changeBase = since && sinceBase ? sinceBase : null;
  const observed = [...new Set([...status, ...(since || [])])];
  // A document draft that reports no files is not caught lying - it wrote nothing git
  // can see, perhaps because the deliverable is the handoff text itself. Under isolation
  // an empty claim used to verify as `true`, which asserts attribution of nothing. Say
  // "could not attribute" and leave the judgement to review, whose job it is.
  if (kind === 'document' && !(Array.isArray(claimed) && claimed.length)) {
    return { changed_files_verified: null, change_attribution: 'document-unchanged', contradicted_files: [], change_base: changeBase };
  }
  // A briefing names files by absolute path, so a truthful executor claims them that way,
  // while git reports them relative to cwd. Compare in one space. A path outside cwd is
  // left as-is rather than trimmed, so it stays unmatched instead of matching by suffix.
  const base = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  // A claim is a path, sometimes with a note after it: "test/smoke.test.mjs (deleted)",
  // "test/fixtures/*.json (23 fixtures: ...)". code-sprint-P4 lost the first attempt of three
  // packages - nine implement nodes - to "(deleted)" alone: git listed the deletion, the note
  // made the claim a different string. The note is dropped; a glob matches what git lists.
  const toRel = (f) => {
    const p = String(f).replace(/\s+\([^)]*\)?.*$/, '').trim().replace(/\\/g, '/');
    return (p.startsWith(base) ? p.slice(base.length) : p).replace(/^\.\//, '');
  };
  const globRe = (g) => new RegExp('(^|/)' + g.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
  const seenIn = (list, r) => (r.includes('*') ? list.some((o) => globRe(r).test(o)) : list.some((o) => o === r || o.endsWith('/' + r)));
  const seen = (r) => seenIn(observed, r);
  const list = Array.isArray(claimed) ? claimed.map(String).filter((f) => !isWikiClaim(f)) : [];
  const unseen = list.filter((f) => {
    const r = toRel(f);
    return !r || !seen(r);
  });
  // git status never lists an ignored path, so a file written there is invisible to it - and
  // the team's own documents live under .teams_output/, which the project ignores.
  // code-sprint-P3: every investigate of the first PLAN run wrote its findings to
  // .teams_output/team/E-*/..., was called a liar, and six nodes and $3.99 went nowhere. A claimed
  // file that exists and is ignored is not contradicted; it is also not verified.
  const ignored = unseen.filter((f) => {
    const r = toRel(f);
    return r && existsSync(join(cwd, r)) && spawnSync('git', ['check-ignore', '-q', '--', r], { cwd }).status === 0;
  });
  const missing = unseen.filter((f) => !ignored.includes(f));
  // Claims accepted only because of a commit since change_base - git status alone would have
  // contradicted them - so triage can tell a commit is what verified the claim.
  const committed = list.filter((f) => {
    const r = toRel(f);
    return r && !unseen.includes(f) && !seenIn(status, r);
  });
  const extra = { change_base: changeBase, ...(committed.length ? { committed_files: committed } : {}), ...(ignored.length ? { ignored_files: ignored } : {}) };
  if (!isolated) {
    return {
      changed_files_verified: missing.length ? false : null,
      change_attribution: 'shared-worktree',
      contradicted_files: missing,
      ...extra,
    };
  }
  return { changed_files_verified: missing.length ? false : ignored.length ? null : true, change_attribution: 'isolated', contradicted_files: missing, ...extra };
}

// review/gate's --verify grants Bash under a read-only tool profile that has no OS sandbox
// behind it for this vendor (the claude adapter's own top comment says so) - a denylist of
// mutating git/fs verbs helps, but does not catch a redirect (`echo x > path`), `tee`, or a
// scripting language writing a file directly. This pair is the actual backstop: fingerprint
// the whole worktree before the node runs, and if anything differs after, restore it and
// void the node's own verdict - "read-only" holds because the work is put back, not only
// because the model was asked nicely.
//
// This used to fingerprint only the node's own subgoal's declared files[], byte for byte,
// never a whole-tree git status - on the theory (still true) that two sibling subgoals can
// share one cwd when the run is not isolated ("isolated" means only this RUN has the cwd, not
// that each subgoal does - team_open's own schema says so), and each legitimately writes its
// OWN files while this one's gate is judging. But that scope was also the gap: a verify-mode
// node could write ANY file NOT in its own subgoal's files[] - another subgoal's tracked
// file, a brand-new untracked file, a build artifact - and the fingerprint never looked
// there, so nothing caught it.
//
// The fix watches every path `git status` reports (tracked or not) and narrows only two ways:
//   - isHarnessPath: the harness's own writes while a node runs (the ledger, probe caches,
//     every node's own prompt/result files, all under HARNESS_ROOT) are never the node's doing.
//   - concurrentWriterFiles: a SIBLING subgoal whose own author node is genuinely `running`
//     right now may touch its own declared files without blame - the concurrency the old
//     scoping was built for. A sibling that is not concurrently running (finished, not yet
//     started, or this is a whole-tree gate:goal with no sibling gates still open) earns no
//     such cover; a change to its file is attributed to this node like any other.
// Everything else that changes - including this node's own subgoal's files, the original
// scope, still covered - is a violation.
// .teams_wiki/ is the project wiki claude and codex workers write through wiki_write: shared
// notes, never a node's changed file, never reverted, never blamed on a verifier.
const WIKI_ROOT = '.teams_wiki';
function isWikiPath(rel) {
  return rel === WIKI_ROOT || rel.startsWith(WIKI_ROOT + '/');
}
// A claim may be absolute or carry a note after the path; either way it names a wiki page.
export const isWikiClaim = (f) => /(^|[\\/])\.teams_wiki([\\/]|\s|$)/.test(String(f));
function isHarnessPath(rel) {
  return rel === HARNESS_ROOT || rel.startsWith(HARNESS_ROOT + '/');
}

// The same glob shape crossCheck uses for a claimed file against git's observed list,
// factored out so a declared files[] pattern can be tested against an observed path here too.
function fileGlobRe(g) {
  return new RegExp('(^|/)' + g.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
}
function declaresPath(patterns, rel) {
  return patterns.some((p) => {
    const q = String(p).replace(/^\.\//, '');
    return q.includes('*') ? fileGlobRe(q).test(rel) : (rel === q || rel.endsWith('/' + q));
  });
}

// Every OTHER node's declared files[], but only for a subgoal whose own node is actually in
// state 'running' right now - read fresh by the caller at both ends of the window (before
// dispatch, and again at restore time) and unioned there, since a sibling can start or finish
// while this node runs. A subgoal that merely exists in the spec earns no cover; only a node
// genuinely mid-flight does, which is exactly the concurrency the whole-tree check must not
// misattribute.
function concurrentWriterFiles(run, n) {
  const subgoals = (run.spec && run.spec.subgoals) || [];
  const files = [];
  for (const other of run.nodes) {
    if (other.node_id === n.node_id || other.state !== 'running' || !other.subgoal_id) continue;
    const sg = subgoals.find((s) => String(s.id) === String(other.subgoal_id));
    for (const f of (Array.isArray(sg?.files) ? sg.files : [])) {
      if (typeof f === 'string') files.push(f);
    }
  }
  return files;
}

export function verifySnapshot(run, n) {
  const changed = gitChanged(run.cwd);
  if (changed === null) return { noGit: true };
  const paths = changed.filter((p) => !isHarnessPath(p));
  const data = {};
  for (const p of paths) {
    try { data[p] = readFileSync(join(run.cwd, p)); } catch { data[p] = null; }
  }
  return { paths, data, writers: concurrentWriterFiles(run, n) };
}

// Returns the paths that changed and had to be put back - an empty array means the node's
// own verdict stands. Best-effort restore: a failure to write back is still reported, so the
// caller voids the verdict either way rather than trusting a tree it could not confirm.
export function verifyRestore(run, n, before) {
  if (before.noGit) return [];
  const after = gitChanged(run.cwd);
  if (after === null) return [];
  const writers = [...new Set([...(before.writers || []), ...concurrentWriterFiles(run, n)])];
  const beforeMap = before.data || {};
  const beforeSet = new Set(before.paths || []);
  const all = new Set([...beforeSet, ...after.filter((p) => !isHarnessPath(p))]);
  const changed = [];
  for (const p of all) {
    if (declaresPath(writers, p)) continue; // a concurrently-running sibling's own file - not this node's doing
    const abs = join(run.cwd, p);
    let now;
    try { now = readFileSync(abs); } catch { now = null; }
    if (!beforeSet.has(p)) {
      // Clean (or nonexistent) before this node ran, and different now: entirely this
      // node's own doing. Tracked -> a git checkout restores exactly the pre-node state,
      // since "clean" means that state IS what HEAD holds. Untracked -> it did not exist
      // at all before this node ran; remove it outright.
      if (now === null) continue; // vanished on its own; nothing to restore
      changed.push(p);
      const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', p], { cwd: run.cwd }).status === 0;
      if (tracked) {
        spawnSync('git', ['checkout', '--', p], { cwd: run.cwd });
      } else {
        try { rmSync(abs, { force: true }); } catch { /* best-effort */ }
        spawnSync('git', ['clean', '-fq', '--', p], { cwd: run.cwd });
      }
      continue;
    }
    // Already dirty (or untracked) before this node ran - a git checkout would blow away
    // whatever legitimate uncommitted work put it in that state (the subgoal's own
    // implement, most commonly). Restore the exact bytes captured before dispatch instead.
    const was = beforeMap[p];
    const same = now === null ? was === null : was !== null && Buffer.compare(now, was) === 0;
    if (same) continue;
    changed.push(p);
    try {
      if (was === null) rmSync(abs, { force: true });
      else { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, was); }
    } catch { /* reported regardless - the caller voids the verdict either way */ }
  }
  return changed;
}
