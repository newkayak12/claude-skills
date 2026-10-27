// Run scope: which paths a run touched. A baseline is taken before the run (every dirty path
// with a content hash); the touched set is what is dirty now and is absent from the baseline
// or hashes differently. Pure functions plus a thin git/fs reader.
//
// Size-S verdict: verdict({cwd, baseline, scope}) checks the touched set against the scope the
// run declared (paths, directories or globs) and returns {ok, outOfScope}. CLI contract of
// `node teams/scripts/scope.mjs verdict`: exit 0 pass, exit 1 fail with the out-of-scope paths
// printed one per line, exit 2 usage error (no --baseline or --scope).
//
// Default 'b2' (PRD) and its known limits. Git status plus a baseline cannot tell which run wrote
// a path that appeared after the baseline, so attribution is by scope:
//   (b) a foreign dirty path INSIDE the declared scope that appears after the baseline is
//       attributed to this run and passes. This is only a partial answer: it is not told apart
//       from this run's own write.
//   (d) a foreign write AFTER the baseline OUTSIDE the declared scope still fails the verdict.
//       Known limit, not hidden: another run's new write is counted as this run's.
//   Two runs editing the same file are out of scope: the second run's baseline hashes the first
//   run's edit, and any later change to that file is attributed to the second run.
// The engine does not run this itself; a prompt tells the model to run the CLI.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';

// Paths from `git status --porcelain -z --untracked-files=all` output.
// Entries are "XY <path>\0"; a rename or copy is followed by one extra "<orig>\0" field.
export function parsePorcelain(out) {
  const fields = String(out).split('\0');
  const paths = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (f.length < 4) continue;
    paths.push(f.slice(3));
    if (f[0] === 'R' || f[0] === 'C' || f[1] === 'R' || f[1] === 'C') i++;
  }
  return paths;
}

// Content hash of a path; a missing path (deleted) hashes to '-'.
export function hashPath(cwd, path) {
  const full = join(cwd, path);
  try {
    const st = lstatSync(full);
    if (!st.isFile()) return `${st.isSymbolicLink() ? 'link' : 'other'}:${st.size}`;
    return createHash('sha1').update(readFileSync(full)).digest('hex');
  } catch {
    return '-';
  }
}

export function dirtyPaths(cwd) {
  const out = execFileSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return parsePorcelain(out);
}

// Baseline: { path: hash } for every path dirty now.
export function baseline(cwd) {
  const map = {};
  for (const p of dirtyPaths(cwd)) map[p] = hashPath(cwd, p);
  return map;
}

// Paths dirty now that are absent from the baseline or whose content changed since it.
// A baseline path left as it was is excluded; one edited again, or a new one, is counted.
export function touched(cwd, base = {}) {
  const out = [];
  for (const p of dirtyPaths(cwd)) {
    if (!Object.hasOwn(base, p) || base[p] !== hashPath(cwd, p)) out.push(p);
  }
  return out.sort();
}

// Is `path` covered by one scope entry? An entry is an exact path, a directory (with or without
// a trailing '/') covering everything under it, or a glob: '**' matches across '/', '*' and '?'
// stay inside one path segment.
export function inScope(path, scope) {
  for (let entry of scope) {
    entry = String(entry).trim().replace(/^\.\//, '');
    if (!entry) continue;
    if (path === entry || path.startsWith(entry.replace(/\/*$/, '/'))) return true;
    if (!/[*?]/.test(entry)) continue;
    const re = entry
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\/|\*\*|\*|\?/g, (m) => ({ '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' })[m]);
    if (new RegExp(`^${re}$`).test(path)) return true;
  }
  return false;
}

// Engine verdict for a size-S run: the touched set (see above) must lie inside `scope`.
export function verdict({ cwd, baseline: base = {}, scope = [] }) {
  const outOfScope = touched(cwd, base).filter((p) => !inScope(p, scope));
  return { ok: outOfScope.length === 0, outOfScope };
}
