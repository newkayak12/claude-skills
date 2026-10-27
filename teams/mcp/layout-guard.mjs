// layout-guard.mjs - keep a QA, audit or repair node's scratch out of the project.
//
// Card 86 (E-7d212456): a QA package committed throwaway scripts under a new top-level test/
// directory. A project's top level is a plugin, a dot-dir, or it does not exist; scratch belongs
// in the node's own run dir or the OS temp dir. SCRATCH_RULE is the one sentence every prompt
// that can tempt a node into writing scratch carries; newTopLevelDirs is the pure check the
// package commit runs on the staged paths (taskmanager.mjs's commitWorktree guard).

export const SCRATCH_RULE = 'Scratch files (throwaway scripts, fixtures, probe output) go under your node\'s run dir (.teams_output/...) or the OS temp dir, never as a new path in the project.';

const MANIFEST = '.claude-plugin/plugin.json';

// stagedPaths: repo-relative paths about to be committed. baseTopLevelDirs: the top-level
// directories of the pre-commit HEAD. hasPluginManifest(dir): true when the package adds
// <dir>/.claude-plugin/plugin.json. Returns the new top-level directories (sorted, unique),
// dot-dirs exempt, a manifest-carrying directory exempt, root-level files not directories.
export function newTopLevelDirs(stagedPaths, baseTopLevelDirs, hasPluginManifest) {
  const base = new Set(baseTopLevelDirs || []);
  const manifest = typeof hasPluginManifest === 'function' ? hasPluginManifest : () => false;
  const out = new Set();
  for (const p of stagedPaths || []) {
    const parts = String(p).split('/').filter(Boolean);
    if (parts.length < 2) continue; // a root-level file is not a directory
    const dir = parts[0];
    if (dir.startsWith('.') || base.has(dir) || manifest(dir)) continue;
    out.add(dir);
  }
  return [...out].sort();
}

// The manifest path a package must add for `dir` to be exempt.
export function manifestPathOf(dir) {
  return `${dir}/${MANIFEST}`;
}
