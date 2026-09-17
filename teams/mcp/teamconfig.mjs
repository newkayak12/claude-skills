// teams/mcp/teamconfig.mjs - project defaults for tm_open, read from .claude/team.json.
//
// Precedence is built-in defaults < team.json < explicit tm_open arguments. Every resolved key
// carries where it came from so tm_status can show it. Keys that no code acts on yet
// (interactive, human_gates, roles, ...) are still resolved and recorded: the file is the
// contract, the rounds after 0.10 fill in the behaviour.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TEAM_FILE = join('.claude', 'team.json');

export const TEAM_DEFAULTS = Object.freeze({
  interactive: false,
  human_gates: [],
  human_scope: 'leader',
  max_parallel_teams: 2,
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
  interactive: (v) => typeof v === 'boolean',
  human_gates: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  human_scope: (v) => v === 'leader' || v === 'all',
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
  const opts = { ...TEAM_DEFAULTS, roles: { ...TEAM_DEFAULTS.roles }, human_gates: [] };
  const sources = Object.fromEntries(Object.keys(TEAM_DEFAULTS).map((k) => [k, 'default']));
  const notes = [];
  applyLayer(opts, sources, notes, fileConfig, 'team.json');
  const fromArgs = Object.fromEntries(Object.entries(args || {}).filter(([k]) => k in TEAM_DEFAULTS));
  applyLayer(opts, sources, notes, fromArgs, 'args');
  return { opts, sources, notes };
}
