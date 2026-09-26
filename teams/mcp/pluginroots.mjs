// pluginroots.mjs - which plugin directories a child driver or judge session must be given.
//
// Every method table in this plugin names skills as `plugin:skill` (graph.mjs KINDS,
// mounts.mjs GRAPH_STAGE_SKILLS, taskmanager.mjs STAGE_SKILLS, a spec's own sg.skills).
// The sessions that run those nodes are spawned with `--setting-sources project`, which hides
// the user's installed plugins, plus `--plugin-dir $CLAUDE_PLUGIN_ROOT` - the teams plugin
// alone. So until 0.18.0 every named skill was absent at runtime and the prompt's own rule
// ("a skill that is not installed here is skipped without comment") made every node run on
// its contract text alone: 2026-09-22's inspection found skills_used null/none on every node
// of every bench run, and a shape that reported two skills it could not have loaded.
//
// This module turns a skill list into the plugin directories that hold them, in the two
// layouts a plugin root can have:
//   development checkout   <repo>/<plugin>/                       (CLAUDE_PLUGIN_ROOT = <repo>/teams)
//   installed marketplace  <cache>/<marketplace>/<plugin>/<ver>/  (CLAUDE_PLUGIN_ROOT = .../teams/<ver>)
// A directory counts only when it holds .claude-plugin/plugin.json. Nothing here is required:
// a plugin that cannot be found is left out and the node falls back to its contract, as before.

import { existsSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS } from './graph.mjs';
import { GRAPH_STAGE_SKILLS } from './mounts.mjs';

// isEntryPoint(): whether the module that calls this (via its own `import.meta.url`) was
// invoked directly - `node <this file>` - rather than merely imported as a library. Both
// taskmanager.mjs (`isMain`, its stdio-loop guard) and daemon.mjs (`RUN_AS_MAIN`, the same
// guard one process down: daemon.mjs imports taskmanager.mjs as a library and must not also
// start ITS stdio loop) need exactly this check, so it lives here - the one module both already
// import (pluginDirArgs) - rather than being copied into each, which is how the two guards drifted
// apart in the first place: 3c5ad0c8 added a raw `fileURLToPath(import.meta.url) ===
// resolve(process.argv[1])` string comparison to both files. That breaks the moment either side
// of the comparison is reached through a symlink - e.g. macOS resolving $TMPDIR's `/var/...`
// to `/private/var/...` - which is exactly the trap a bench run hit: the plugin loaded from a
// symlinked path, `import.meta.url` kept the symlinked string, `argv[1]` did not match, the
// guard decided "not main", and the server exited 0 having started nothing. realpathSync on
// both sides (tolerating a path that does not exist, e.g. under a bundler or a fake test argv0)
// makes two names for the same file compare equal regardless of which side is symlinked.
export function isEntryPoint(importMetaUrl) {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  let a;
  try { a = fileURLToPath(importMetaUrl); } catch { return false; }
  let b = resolve(argv1);
  try { a = realpathSync(a); } catch { /* leave as-is */ }
  try { b = realpathSync(b); } catch { /* leave as-is */ }
  return a === b;
}

export function pluginOf(skill) {
  const s = String(skill || '');
  const i = s.indexOf(':');
  return i > 0 ? s.slice(0, i) : null;
}

function isPlugin(dir) {
  try { return statSync(dir).isDirectory() && existsSync(join(dir, '.claude-plugin', 'plugin.json')); } catch { return false; }
}

// Highest version subdirectory of an installed plugin (<plugin>/<ver>/), numeric-aware.
function newestVersionDir(dir) {
  let entries;
  try { entries = readdirSync(dir).filter((e) => isPlugin(join(dir, e))); } catch { return null; }
  if (!entries.length) return null;
  const key = (v) => v.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  entries.sort((a, b) => {
    const ka = key(a); const kb = key(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const x = ka[i]; const y = kb[i];
      if (x === y) continue;
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      if (typeof x === 'number' && typeof y === 'number') return x - y;
      return String(x) < String(y) ? -1 : 1;
    }
    return 0;
  });
  return join(dir, entries[entries.length - 1]);
}

// The plugin names every built-in method table refers to, plus whatever extra skill lists
// the caller has (a task's stage_skills overrides, a run's spec skills).
export function referencedPlugins(extraSkillLists = []) {
  const names = new Set();
  const add = (list) => { for (const s of list || []) { const p = pluginOf(s); if (p) names.add(p); } };
  for (const kind of Object.values(KINDS)) for (const list of Object.values(kind.skills || {})) add(list);
  for (const list of Object.values(GRAPH_STAGE_SKILLS)) add(list);
  for (const list of extraSkillLists) {
    if (Array.isArray(list)) add(list);
    else if (list && typeof list === 'object') for (const v of Object.values(list)) add(v);
  }
  return [...names].sort();
}

// The teams plugin's own root: CLAUDE_PLUGIN_ROOT when the host set it, else this file's own
// location (mcp/..), which is always true. Only the env var used to count: a driver respawned by
// a process launched without it (a daemon or MCP server started from another shell) came up with
// no teams MCP servers at all - idol-beta-ask1's PLAN restarts answered "team_* tools aren't
// available" and quit, each one a spent restart.
export function teamsPluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

// Where plugin `name` lives, relative to the teams plugin's own root. null when not found.
export function resolvePluginDir(name, pluginRoot) {
  if (!pluginRoot || !name || /[\\/]/.test(name)) return null;
  const root = resolve(pluginRoot);
  // development checkout: sibling directory
  const sibling = join(dirname(root), name);
  if (isPlugin(sibling)) return sibling;
  // installed marketplace: ../../<name>/<ver>
  const installed = join(dirname(dirname(root)), name);
  const versioned = newestVersionDir(installed);
  if (versioned) return versioned;
  return null;
}

// Plugin directories to pass alongside pluginRoot itself. `skills` are extra skill lists (see
// referencedPlugins); `extraDirs` are explicit directories (team.json plugin_dirs), kept when
// they exist. pluginRoot is never repeated. Order is stable: explicit dirs first, then names.
export function skillPluginDirs({ pluginRoot = teamsPluginRoot(), skills = [], extraDirs = [] } = {}) {
  const out = [];
  const seen = new Set(pluginRoot ? [resolve(pluginRoot)] : []);
  const push = (d) => { if (!d) return; const r = resolve(d); if (seen.has(r)) return; seen.add(r); out.push(r); };
  for (const d of extraDirs || []) if (isPlugin(d)) push(d);
  if (pluginRoot) for (const name of referencedPlugins(skills)) push(resolvePluginDir(name, pluginRoot));
  return out;
}

export function pluginDirArgs(opts = {}) {
  return skillPluginDirs(opts).flatMap((d) => ['--plugin-dir', d]);
}
