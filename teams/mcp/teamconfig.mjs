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
// or is auto-decided past it, graph.mjs's applyHumanPin). `human_gates` is live as of 0.29.0
// (graph.mjs's promoteHumanGates) - a list of judging stages a person must accept/reject
// instead of a model. `human_scope` (leader/all) never shipped and is retired: when a person is
// called is now decided by task.decisions (docs/plans/2026-09-28-teams-light-plan.md §6) - the
// session brainstorm before tm_open, else the engine's own `brainstorm` node (one ask when
// interactive), and during execution only a blocking question, once, at EPIC level. A team.json
// that still names it is accepted with a note, never an error (DEPRECATED below).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// A fixed 2 used to be the only option here, and it was a guess, not a measurement - a measured
// cause of slowness (docs/plans/2026-09-21-teams-server-owns-the-loop.md §0/§7), left in place
// until "a capacity-based rule (same plan, §7)" replaced it. This is that rule: 'auto' (the
// default since 2026-09-28) hands the cap to an AIMD controller (taskmanager.mjs's
// ensureAutoParallel/updateAutoParallel, applied in advanceDispatches) that starts at 2 - the
// same number this used to be pinned at forever - and adjusts it from there per develop-STORY
// dispatch outcome: +1 after a window of clean settles, halved the moment a dispatch's own
// driver shows the vendor/host pushing back. A project that still wants a fixed number sets one
// (an integer here, in team.json, or as a tm_open argument) exactly as before; only the DEFAULT
// changed, not the numeric path - CHECK.max_parallel_teams below still accepts either shape.
export const AUTO_MAX_PARALLEL_TEAMS = 'auto';

export const TEAM_FILE = join('.claude', 'team.json');

// The string values roles.planning takes besides true/false (see TEAM_DEFAULTS.roles).
export const PLANNING_MODES = ['light', 'auto'];

export const TEAM_DEFAULTS = Object.freeze({
  max_parallel_teams: AUTO_MAX_PARALLEL_TEAMS,
  // Only consulted by the auto controller above (ensureAutoParallel), and only when THIS is not
  // set: null derives the ceiling from the host itself (min(os.availableParallelism()/2, 6)) so a
  // small dev box and a big CI runner do not probe to the same number. Set it to pin the ceiling
  // instead - a project that knows its own vendor/rate-limit headroom better than a core count can.
  max_parallel_ceiling: null,
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
  // How long (ms) an interactive `ask` card may wait on a person before the engine answers it
  // itself with each question's `default` (else its first, recommended option - the same pick a
  // non-interactive run makes), recorded `by: 'timeout'` (design §7). null = wait forever,
  // today's behaviour. tm_open only - team_open has no human-wait concept of its own. Read off
  // task.ask_timeout (createTask copies it from the resolved layer), never from raw args; see
  // taskmanager.mjs's expireAsks for who checks the deadline.
  ask_timeout: null,
  // §6.5-3: whether the engine holds its own brainstorm (a `brainstorm` node after size, ahead of
  // PLAN/shape) when tm_open got no decisions[] from a session brainstorm. false skips it; a
  // decisions[] argument skips it regardless.
  brainstorm: true,
  // gate:human (0.29.0): which judging stages must stop and have a person accept/reject
  // instead of a model - 'critique', 'gate', 'gate:goal' (or, at the manager layer, 'accept',
  // 'integrate'). Empty means no gate is configured; naming a non-judging stage (e.g.
  // 'shape', 'implement') is accepted here but has no effect - promoteHumanGates (graph.mjs)
  // only acts on a stage with a VERDICT field. Interactive parks the node in waiting_human for
  // tm_inbox/tm_submit exactly like an ask card; non-interactive auto-passes it (see
  // autoPassHumanGateResult) rather than blocking a run nobody is watching.
  human_gates: [],
  qa_rounds: 2,
  // A downstream package's dispatch (implement/test/gate, or the manager's own accept) can name
  // a defect it found OUTSIDE its own touches[], in a package it deps on - a frozen-contract
  // problem no downstream package may fix itself (taskmanager.mjs's upstream_defects handling,
  // the fix-forward route the QA/audit defect machinery lacked for this case: awake-beta-ref2,
  // 2026-09-25, P3 accepted at 93 on a kernel-detection assumption that did not hold on P4's own
  // host, and P4 had no route but to fail its own dispatch against an upstream package it could
  // not touch). Capped the same way qa_rounds caps a QA round that keeps finding the same
  // defect: once a fix has already been filed against the SAME upstream package this many
  // times, a further upstream_defects report against it is recorded onto
  // task.unresolved_defects instead of filed as another fix STORY, and the downstream package is
  // left to the ordinary retry/settle path.
  upstream_fix_rounds: 2,
  // audit used to ride on roles.planning alone (taskmanager.mjs's openAudit was gated on
  // `roles.planning`, nothing else - the audit pass is planning's own second pass, so it had no
  // independent switch). It is still ON by default whenever planning is - that pairing is
  // unchanged, so a project that never heard of this key keeps today's behaviour byte for byte -
  // but a project may now turn audit off while keeping the rest of planning (a PRD without the
  // post-integration cross-check), which `roles.planning` alone could never express.
  // roles.planning takes true | false | 'light' | 'auto' (docs/plans/2026-09-28-teams-light-plan.md
  // §2.5). 'auto' (the default since 2026-09-28, was true) picks the light PLAN chain
  // (investigate -> template-fill -> gate) when the backlog already declares its acceptance -
  // acceptance.mjs's hasDeclaredAcceptance - and the full one otherwise. It never picks false:
  // dropping PLAN is always a person's explicit choice. true stays the full chain, as before.
  // This changes what an unconfigured caller runs, so it is recorded as its own decision in
  // that plan doc; audit still rides on planning being on at all, whichever chain it runs.
  roles: { planning: 'auto', qa: true, audit: true },
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
  // What a retry (a subgoal's implement/draft re-attempt after its own gate rejects it, or a
  // package's dispatch re-attempt after retryPackage) does with the worktree the failed attempt
  // left behind. `continue` (default) builds the next attempt on top of it, exactly as every
  // retry has always worked - ensureWorktree/graph.mjs's retrySubgoal already keep the same tree
  // across attempts, this key only makes that a declared policy rather than the only option.
  // `rollback` resets the worktree to the last checkpoint that passed its gate (this subgoal's
  // pre-attempt state at the node level; the package's last accepted commit, or its base commit
  // if none, at the retryPackage level) before the new attempt opens, then carries the failed
  // gate's gaps forward as feedback exactly as continue does. docs/plans/
  // 2026-09-23-teams-reducer-human-rollback.md §5 measured two real runs before picking a
  // default: both showed a retried implement CONVERGING on its own gate's feedback across
  // attempts (52%->60%->78%, 74%->78%) rather than repeating the same mistake, so continue - the
  // existing, tested behaviour - stays the default; rollback is here for a team that hits the
  // OTHER failure mode the measurement also saw (a structural collapse - "reduce is unreachable"
  // - where continuing has nothing coherent to build on).
  retry_policy: 'continue',
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
  // The box tripping does not freeze every running dispatch: a package (or PLAN/S run) whose
  // accept the closing path still needs is let finish, same as always, but not forever - only
  // until it has spent this much more since budget_stopped (or budget_grace_minutes elapses,
  // whichever first), then enforceBudget kills it the same way a stalled driver is killed and
  // skips its accept like any package that never ran. null derives 10% of budget_usd (0 with no
  // budget_usd set - a timebox alone gets no dollar grace, only the minutes one). A phase-Team
  // pass (QA, AUDIT) gets no grace at all: closeStoppedToReport's own goal-gate rewire never
  // reads its accept once the box is over, so portfolio-refresh-80ec931a (2026-09-28) paid for
  // 12 more minutes of a QA child whose result the report then named "superseded" for nothing.
  budget_grace_usd: null,
  budget_grace_minutes: 5,
  // Optional grouping ABOVE the EPIC (`Initiative (optional) > Epic > Story > Sub-task`, the
  // hierarchy tm_open's own caller uses) - a person's own label for "several EPICs toward one
  // outcome", never read by scheduling or execution (createTask only stashes it on task.json;
  // nothing branches on it). null (the default) is today's behaviour byte for byte: no EPIC has
  // one, tm_board's all-epics listing stays exactly the flat list it always was. Slug-normalized
  // (see normalizeInitiative below) so "Q1 Roadmap" and "q1-roadmap" group under the same
  // `I-q1-roadmap` key regardless of which spelling a caller or a team.json default used.
  initiative: null,
});

// One validator per key. A value that fails is ignored (the lower layer's value stays) and
// the caller gets a note; nothing here ever throws.
const CHECK = {
  max_parallel_teams: (v) => v === 'auto' || (Number.isInteger(v) && v >= 1),
  max_parallel_ceiling: (v) => v === null || (Number.isInteger(v) && v >= 1),
  max_depth: (v) => Number.isInteger(v) && v >= 0,
  qa_rounds: (v) => Number.isInteger(v) && v >= 0,
  upstream_fix_rounds: (v) => Number.isInteger(v) && v >= 0,
  roles: (v) => v && typeof v === 'object' && !Array.isArray(v)
    && Object.entries(v).every(([k, b]) => k in TEAM_DEFAULTS.roles
      && (typeof b === 'boolean' || (k === 'planning' && PLANNING_MODES.includes(b)))),
  interactive: (v) => typeof v === 'boolean',
  ask_timeout: (v) => v === null || (Number.isInteger(v) && v > 0),
  brainstorm: (v) => typeof v === 'boolean',
  human_gates: (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0),
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
  budget_grace_usd: (v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0),
  budget_grace_minutes: (v) => Number.isInteger(v) && v >= 0,
  plugin_dirs: (v) => Array.isArray(v) && v.every((d) => typeof d === 'string' && d.length > 0),
  retry_policy: (v) => v === 'continue' || v === 'rollback',
  initiative: (v) => v === null || (typeof v === 'string' && v.trim().length > 0),
};

// The one place an initiative label becomes the slug its `I-<slug>` key and tm_board's grouping
// both key off - lowercased, non-alphanumeric runs collapsed to a single '-', leading/trailing
// '-' trimmed. Applied once, here, so "Q1 Roadmap", "q1-roadmap" and "Q1_Roadmap!" all resolve
// to the identical group rather than three near-miss ones a raw string compare would keep apart.
// null in, null out - a task that never set one stays byte-for-byte today's behaviour.
export function normalizeInitiative(v) {
  if (v == null) return null;
  const slug = String(v).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || null;
}

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

// Keys a team.json may still carry from an older design, accepted and ignored with a note that
// says why rather than the generic "unknown key".
const DEPRECATED = {
  human_scope: 'no-op: replaced by task.decisions (session brainstorm / brainstorm node / EPIC-level blocking questions)',
};

function applyLayer(opts, sources, notes, layer, name) {
  for (const [k, v] of Object.entries(layer || {})) {
    if (k in DEPRECATED) { notes.push(`${name}: "${k}" is deprecated, ${DEPRECATED[k]}`); continue; }
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
  opts.initiative = normalizeInitiative(opts.initiative);
  return { opts, sources, notes };
}
