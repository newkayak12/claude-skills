// Run scope: which paths a run touched. A baseline is taken before the run (every dirty path
// with a content hash); the touched set is what is dirty now and is absent from the baseline
// or hashes differently. Pure functions plus a thin git/fs reader.

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
