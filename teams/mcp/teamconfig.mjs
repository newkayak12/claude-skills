// teams/mcp/teamconfig.mjs - project defaults for tm_open, read from .claude/team.json.
//
// Precedence is built-in defaults < team.json < explicit tm_open arguments. Every resolved key
// carries where it came from so tm_status can show it. roles and max_depth are both acted on now
// (taskmanager.mjs); a key still resolved and recorded with nothing reading it yet stays that way
// on purpose - the file is the contract, a later round fills in the behaviour.
//
// Human-as-a-node (interactive, human_gates, human_scope) was removed here - see the note above
// PROVISIONAL_MAX_PARALLEL_TEAMS's neighbour, max_depth, for where that design now lives.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// 2 is a guess, not a measurement, and a measured cause of slowness (docs/plans/
// 2026-09-21-teams-server-owns-the-loop.md §0/§7). It stays the default until a capacity-based
// rule (same plan, §7) replaces it - named here so that replacement is a one-line edit, not a
// grep for a bare "2" among max_depth/qa_rounds/driver_restarts's own 2s.
const PROVISIONAL_MAX_PARALLEL_TEAMS = 2;

export const TEAM_FILE = join('.claude', 'team.json');

export const TEAM_DEFAULTS = Object.freeze({
  max_parallel_teams: PROVISIONAL_MAX_PARALLEL_TEAMS,
  // The depth cap on a package re-decomposing itself (a STORY that, inside its own child run,
  // still needs its own shape/dispatch cycle - pkg.split:true or pkg.size:'L', taskmanager.mjs's
  // openChild). Enforced there: a package opened at task.depth >= this value is always
  // parent_shaped chain-only regardless of what it asked for (docs/plans/
  // 2026-09-21-teams-server-owns-the-loop.md §3, item 3). task.depth itself is only ever 0 today
  // - nothing in this codebase opens a nested tm_open yet - so this cap has no live effect until
  // that exists; it is threaded through task.child_opts.depth now so it is ready when it does.
  max_depth: 2,
  qa_rounds: 2,
  roles: { planning: false, qa: false },
  goal_threshold: 90,
  max_retries: 2,
  driver_restarts: 2,
  vendor: 'auto',
  allocation: 'ordered',
  // The DEFAULT lives under .teams_output/, but this key is user-settable, so docs_dir is not
  // pinned to that root - and three other places assume that root without consulting this key:
  // install.mjs:22 scaffolds the project .gitignore with '.teams_output/', commitWorktree
  // (taskmanager.mjs:645) unstages '.teams_output' so engine state never enters a package
  // commit, and dispatch-gate.mjs:118 allows writes under '.teams_output/'.
  //
  // A project that moves docs_dir outside that root therefore loses .gitignore coverage for its
  // rendered phase markdown. That is a coupling, not a duplicated default: the four uses of the
  // string '.teams_output' across teams/mcp are four independent facts (the broker state root at
  // broker.mjs:144 and graph.mjs:217, this default, the gitignore scaffold, the unstage
  // pathspec), not one value written four times - which is why they are deliberately NOT hoisted
  // into a shared constant. A constant would assert they must move together, and they must not.
  // The rendered markdown is a human-readable artifact; a project that moves it out may well
  // want it committed. Recorded here rather than "fixed" because the right behaviour is a
  // product decision nobody has made.
  docs_dir: join('.teams_output', 'team'),
});

// One validator per key. A value that fails is ignored (the lower layer's value stays) and
// the caller gets a note; nothing here ever throws.
const CHECK = {
  max_parallel_teams: (v) => Number.isInteger(v) && v >= 1,
  max_depth: (v) => Number.isInteger(v) && v >= 0,
  qa_rounds: (v) => Number.isInteger(v) && v >= 0,
  roles: (v) => v && typeof v === 'object' && !Array.isArray(v)
    && Object.entries(v).every(([k, b]) => k in TEAM_DEFAULTS.roles && typeof b === 'boolean'),
  goal_threshold: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  max_retries: (v) => Number.isInteger(v) && v >= 0,
  driver_restarts: (v) => Number.isInteger(v) && v >= 0,
  vendor: (v) => typeof v === 'string' && v.length > 0,
  allocation: (v) => typeof v === 'string' && v.length > 0,
  docs_dir: (v) => typeof v === 'string' && v.length > 0,
};

export function readTeamConfig(cwd) {
  const path = join(cwd, TEAM_FILE);
  if (!existsSync(path)) return { config: {}, path, status: 'absent' };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { config: {}, path, status: 'parse-error' };
    return { config: parsed, path, status: 'ok' };
  } catch {
    return { config: {}, path, status: 'parse-error' };
  }
}

function applyLayer(opts, sources, notes, layer, name) {
  for (const [k, v] of Object.entries(layer || {})) {
    if (!(k in CHECK)) { notes.push(`${name}: unknown key "${k}" ignored`); continue; }
    if (!CHECK[k](v)) { notes.push(`${name}: "${k}" has the wrong type or range, ignored`); continue; }
    opts[k] = k === 'roles' ? { ...opts.roles, ...v } : (Array.isArray(v) ? v.slice() : v);
    sources[k] = name;
  }
}

// `args` is the raw tm_open argument object; only keys named in TEAM_DEFAULTS are considered,
// so tm_open's other arguments (request, cwd, size, ...) pass through untouched.
export function resolveTeamOptions(args, fileConfig) {
  const opts = { ...TEAM_DEFAULTS, roles: { ...TEAM_DEFAULTS.roles } };
  const sources = Object.fromEntries(Object.keys(TEAM_DEFAULTS).map((k) => [k, 'default']));
  const notes = [];
  applyLayer(opts, sources, notes, fileConfig, 'team.json');
  const fromArgs = Object.fromEntries(Object.entries(args || {}).filter(([k]) => k in TEAM_DEFAULTS));
  applyLayer(opts, sources, notes, fromArgs, 'args');
  return { opts, sources, notes };
}
