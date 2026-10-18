// teams/mcp/basefail.mjs - pure helpers for "a failure that reproduces on the base commit is
// excluded from a package's score". Nothing here reads task state or config; the task manager
// passes in the package's output and exit code.
//
// The same command runs twice (a repeat flags flakiness) in one detached worktree at baseSha,
// created under os.tmpdir() and removed in a finally. A test failing in the package and in both
// base runs is excluded; one failing in the package only is kept; one whose result differs between
// the two base runs is flaky and kept. When no failing names parse on either side the exit codes
// decide: package and both base runs non-zero excludes the whole check as one item.
//
// A base run that throws, times out (no exit status) or cannot get its worktree excuses nothing
// and is not cached. The base-side result is cached per (baseSha, command) for the life of the
// process; the package side is never cached. The timeout is a constant, not a config key.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TIMEOUT_MS = 120000;
const cache = new Map();

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// The commit the package branched from: baseCommit when it exists, else the merge-base of branch
// and baseRef (HEAD when none). Never a bare HEAD; a git error with no merge-base propagates.
export function resolveBase({ cwd, baseCommit, branch, baseRef }) {
  if (baseCommit) {
    try {
      git(cwd, 'cat-file', '-e', `${baseCommit}^{commit}`);
      return git(cwd, 'rev-parse', `${baseCommit}^{commit}`);
    } catch { /* missing: fall through to the merge-base */ }
  }
  return git(cwd, 'merge-base', branch, baseRef || 'HEAD');
}

// Failing test names from TAP / node:test output, de-duplicated; [] when none parse.
export function failingTests(output) {
  if (typeof output !== 'string') return [];
  const names = [];
  for (const line of output.split('\n')) {
    const m = /^\s*not ok \d+ - (.+?)(?:\s+#.*)?\s*$/.exec(line);
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

export function exclusionLine({ test, base }) {
  return `excluded (also fails on base ${base}): ${test}`;
}

const defaultRun = (command, { cwd, timeout }) => spawnSync(command, { shell: true, cwd, timeout, encoding: 'utf8' });

// {names, exit} of one base run, or null when it has no exit status (threw or timed out).
function baseRun(run, command, cwd, timeout) {
  try {
    const r = run(command, { cwd, timeout });
    if (!r || r.error || typeof r.status !== 'number') return null;
    return { names: failingTests(`${r.stdout || ''}\n${r.stderr || ''}`), exit: r.status };
  } catch {
    return null;
  }
}

function runTwiceOnBase({ cwd, baseSha, command, timeoutMs, run }) {
  let dir;
  let wt;
  try {
    dir = mkdtempSync(join(tmpdir(), 'basefail-'));
    wt = join(dir, 'wt');
    git(cwd, 'worktree', 'add', '--detach', wt, baseSha);
    const first = baseRun(run, command, wt, timeoutMs);
    const second = first && baseRun(run, command, wt, timeoutMs);
    return second ? [first, second] : null;
  } catch {
    return null;
  } finally {
    if (wt) { try { git(cwd, 'worktree', 'remove', '--force', wt); } catch { /* pruned below */ } }
    if (dir) rmSync(dir, { recursive: true, force: true });
    try { git(cwd, 'worktree', 'prune'); } catch { /* best-effort */ }
  }
}

export function compareOnBase({ cwd, baseSha, command, packageOutput, packageExit, timeoutMs = TIMEOUT_MS, run = defaultRun }) {
  const key = `${baseSha}\0${command}`;
  let base = cache.get(key);
  if (!base) {
    base = runTwiceOnBase({ cwd, baseSha, command, timeoutMs, run });
    if (base) cache.set(key, base);
  }
  const sha7 = String(baseSha).slice(0, 7);
  const pkg = failingTests(packageOutput);
  const [b1, b2] = base || [];
  if (!base) return { excluded: [], kept: pkg.length ? pkg : [command], flaky: [], fallback: pkg.length ? 'names' : 'exit' };

  if (pkg.length || b1.names.length || b2.names.length) {
    const excluded = [];
    const kept = [];
    const flaky = [];
    for (const test of pkg) {
      const a = b1.names.includes(test);
      const b = b2.names.includes(test);
      if (a && b) excluded.push({ test, base: sha7 });
      else {
        kept.push(test);
        if (a !== b) flaky.push(test);
      }
    }
    return { excluded, kept, flaky, fallback: 'names' };
  }

  const both = (b1.exit !== 0) && (b2.exit !== 0);
  const flaky = (b1.exit !== 0) !== (b2.exit !== 0) ? [command] : [];
  if (packageExit !== 0 && both) return { excluded: [{ test: command, base: sha7 }], kept: [], flaky, fallback: 'exit' };
  return { excluded: [], kept: [command], flaky, fallback: 'exit' };
}
