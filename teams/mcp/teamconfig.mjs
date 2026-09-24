// teams/mcp/teamconfig.mjs - project defaults for tm_open, read from .claude/team.json.
//
// Precedence is built-in defaults < team.json < explicit tm_open arguments. Every resolved key
// carries where it came from so tm_status can show it. roles and max_depth are both acted on now
// (taskmanager.mjs); a key still resolved and recorded with nothing reading it yet stays that way
// on purpose - the file is the contract, a later round fills in the behaviour.
//
// Human-as-a-node came back one key at a time as the machinery landed: `interactive` is live
// (0.28.0 - it is what decides whether a planning run opens an `ask` card for a decision its
// investigate stage could not settle, graph.mjs's openAsk; this same key also decides, per the
// 0.27.3 review, whether a MODEL-written `assignee` pin - a shape package's own field or a
// setgoal subgoal's own field, as opposed to a user's tm_assign - parks a node in waiting_human
// or is auto-decided past it, graph.mjs's applyHumanPin). human_gates/human_scope are still
// only design - see the note above PROVISIONAL_MAX_PARALLEL_TEAMS's neighbour, max_depth.
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
  // Does this project want to be asked? false decides by default and records the questions it
  // would have put to a person (run.unasked, surfaced in the report); true opens an `ask` card
  // per decision and parks the run on it. false is the default because a run nobody is watching
  // must still finish, and because v0.13.0 §0.2 argued the recorded question is more useful than
  // a silent assumption either way. Also gates a MODEL-written `assignee` pin the same way (a
  // shape/setgoal field, never tm_assign - that one always parks): off, it is auto-decided
  // (dispatched to an AI, recorded on the node, listed in tm_inbox's `decided`) instead of
  // parking forever with nobody watching to notice (0.27.3 review, 2026-09-24).
  interactive: false,
  qa_rounds: 2,
  // audit used to ride on roles.planning alone (taskmanager.mjs's openAudit was gated on
  // `roles.planning`, nothing else - the audit pass is planning's own second pass, so it had no
  // independent switch). It is still ON by default whenever planning is - that pairing is
  // unchanged, so a project that never heard of this key keeps today's behaviour byte for byte -
  // but a project may now turn audit off while keeping the rest of planning (a PRD without the
  // post-integration cross-check), which `roles.planning` alone could never express.
  roles: { planning: true, qa: true, audit: true },
  goal_threshold: 90,
  max_retries: 2,
  driver_restarts: 2,
  // A driver can answer process.kill(pid,0) and still be doing nothing - a wedged model, a
  // provider hang with no error, a tool call that never returns. stall_minutes is the "no
  // progress" signal for that: the mtime of the files daemon.mjs's own waitForProgress already
  // watches for this child (its broker run file, plus its ledger) idle this long marks the
  // dispatch stalled (once, recorded, taskmanager.mjs's serviceStalledDriver); idle 3x this long
  // kills the driver and lets the ordinary dead-driver path (serviceDeadDriver) respawn it,
  // spending a restart like any other death. 0 disables the whole check - a project whose own
  // work legitimately goes quiet for stretches (idol-pm-4's 16-minute tool-call gaps) should
  // raise this rather than disable it, since the first threshold only records, it never kills.
  stall_minutes: 20,
  // driver_restarts is a flat, forever counter by default (0 here) - the OTP "flat" restart
  // strategy. >0 makes it a sliding window in minutes: only restarts whose own timestamp
  // (driver.restarts[].at, already recorded by serviceDeadDriver) falls inside the last
  // restart_period_minutes count toward driver_restarts, so a package that dies once every hour
  // for a week never exhausts its budget the way a flat counter would - see serviceDeadDriver's
  // own windowing.
  restart_period_minutes: 0,
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
  // Extra plugin directories every child driver and judge session is given with --plugin-dir,
  // on top of the ones pluginroots.mjs finds for the skills the method tables name.
  plugin_dirs: [],
  // The Sprint's own missing box (docs/plans' Scrum Guide mapping audit: no backlog, no
  // timebox/budget, no retro - this is the second of those three). null is unlimited, today's
  // behaviour byte for byte: a task that never sets either keeps running exactly as it always
  // has. Set, taskmanager.mjs's budgetStatus reads whichever is tighter as a fraction spent (a
  // dollar figure and a clock both cap the same run, and either alone is real) - at 80%
  // enforceBudget records one warning; at 100% it stops advanceDispatches from opening another
  // package, lets whatever is already running finish, and reintegrates over just what accepted,
  // the unopened packages named in the report as "not done" rather than silently dropped.
  budget_usd: null,
  timebox_minutes: null,
});

// One validator per key. A value that fails is ignored (the lower layer's value stays) and
// the caller gets a note; nothing here ever throws.
const CHECK = {
  max_parallel_teams: (v) => Number.isInteger(v) && v >= 1,
  max_depth: (v) => Number.isInteger(v) && v >= 0,
  qa_rounds: (v) => Number.isInteger(v) && v >= 0,
  roles: (v) => v && typeof v === 'object' && !Array.isArray(v)
    && Object.entries(v).every(([k, b]) => k in TEAM_DEFAULTS.roles && typeof b === 'boolean'),
  interactive: (v) => typeof v === 'boolean',
  goal_threshold: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  max_retries: (v) => Number.isInteger(v) && v >= 0,
  driver_restarts: (v) => Number.isInteger(v) && v >= 0,
  stall_minutes: (v) => Number.isInteger(v) && v >= 0,
  restart_period_minutes: (v) => Number.isInteger(v) && v >= 0,
  vendor: (v) => typeof v === 'string' && v.length > 0,
  allocation: (v) => typeof v === 'string' && v.length > 0,
  docs_dir: (v) => typeof v === 'string' && v.length > 0,
  budget_usd: (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0),
  timebox_minutes: (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0),
  plugin_dirs: (v) => Array.isArray(v) && v.every((d) => typeof d === 'string' && d.length > 0),
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
