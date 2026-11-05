// graph-nodes.mjs - building a run and its nodes (cut from graph.mjs).
//
// node(), createRun(), the per-stage routing policy, spec validation and the chain wiring that
// expandSubgoals and retrySubgoal share. Reads graph-kinds.mjs's tables and saves through
// graph-runfile.mjs; everything that mutates an existing graph (pins, repair, retry) builds on this.

import { randomUUID } from 'node:crypto';
import { DEFAULT_MODELS } from './routing.mjs';
import { KINDS, FLOWS, kindOf } from './graph-kinds.mjs';
import { saveRun } from './graph-runfile.mjs';

// Two kinds of edge. `deps` is a data dependency: the node consumes what the dep
// produced, so the dep must be `done`. `after` is order-only, Make's `|` prerequisite:
// the node must not start before the dep has finished, but it does not need the dep to
// have succeeded. Without the second kind the report could never run behind a gate that
// rejected the work - and writing the account of a failure is precisely the report's job.
export function node(id, stage, deps, extra) {
  return {
    node_id: id,
    stage,
    deps: deps || [],
    after: [],
    state: 'pending',
    attempt: 1,
    ticket: null,
    result: null,
    ...(extra || {}),
  };
}

export function createRun(opts) {
  const run = {
    run_id: randomUUID(),
    cwd: opts.cwd,
    request: opts.request,
    context: opts.context || '',
    vendor: opts.vendor || 'auto',
    allocation: opts.allocation || 'ordered',
    host_vendor: opts.host_vendor || null,
    host_model: opts.host_model || null,
    native_models: opts.native_models || null,
    // Run-level default; a policy entry overrides it per stage.
    model: opts.model || null,
    // Per-stage routing. The harness contract pins reasoning to a strong model and
    // execution to whatever can actually write here, but the graph had no way to say so:
    // one vendor was chosen once at team_open and used for plan, implement and report
    // alike, while `model` existed only as an argument the caller had to remember on
    // every single team_run. Policy makes that a property of the run instead.
    policy: opts.policy && typeof opts.policy === 'object' ? opts.policy : {},
    candidates: opts.candidates || null,
    sandbox: opts.sandbox || null,
    isolated: opts.isolated === true,
    // Whether a decision this run cannot settle from sources is put to a person (openAsk) or
    // decided by default and merely recorded (run.unasked). Off unless asked for: a run opened
    // by a daemon nobody is watching must still be able to finish.
    interactive: opts.interactive === true,
    // task.decisions (_repo/docs/plans/2026-09-28-teams-light-plan.md §6.2-2): what this task already
    // decided before this run opened - the session brainstorm, the engine's own brainstorm node,
    // PLAN's asks and defaults. A snapshot, not a reference: graph.mjs never sees the task, and
    // the decisions it snapshots are written once, before any package opens. openAsk and
    // nodeBriefing read it next to answeredDecisions(run). Absent (not []) when there is none,
    // so a run opened by anything but the task manager is byte-for-byte what it was.
    ...(Array.isArray(opts.task_decisions) && opts.task_decisions.length ? { task_decisions: opts.task_decisions.map((d) => ({ ...d })) } : {}),
    // §6.2-3: a package child run past PLAN. Its new questions are decided by default and
    // recorded even when `interactive` - only a blocking one (routeExecutionQuestions) is kept
    // for the task manager to park once at EPIC level.
    ...(opts.execution_phase === true ? { execution_phase: true } : {}),
    // gate:human (D2 Task 4): which judging stages this run must stop and have a person
    // accept/reject, by name ('critique', 'gate', 'gate:goal', ...) - see promoteHumanGates.
    // Threaded the same way `interactive` is (teamconfig.mjs -> task.child_opts -> here).
    human_gates: Array.isArray(opts.human_gates) ? opts.human_gates.slice() : [],
    // A rejected subgoal gate opens its own next attempt. false makes a rejection advisory
    // again: the run blocks and waits for team_retry, which a caller may simply never call.
    auto_reassign: opts.auto_reassign !== false,
    // The floor the goal gate's match_pct must clear. Carried on the run because the gate is
    // judged in the broker, which only has the run to read it from.
    goal_threshold: Number.isInteger(opts.goal_threshold) ? opts.goal_threshold : 90,
    // How many independent judges sit on the goal gate. 1 is every prior behaviour: a
    // single gate:goal:<round> node, its own accept/match_pct decides the round. The
    // MCP tool boundary (team_open) defaults this to 2 for a fresh run; createRun
    // itself defaults to 1 so a caller that builds runs directly - the TaskManager's
    // per-package child runs among them - keeps behaving exactly as before unless it
    // asks for more judges.
    goal_judges: Number.isInteger(opts.goal_judges) && opts.goal_judges > 0 ? opts.goal_judges : 1,
    // A ceiling on setgoal's subgoal count, or null. The manager sets 1 on a boxed Sprint's
    // planning run: told in words that one PRD would do, code-sprint-P3's planner still wrote two
    // documents and spent $10.86 of $15 before a package ran.
    max_subgoals: Number.isInteger(opts.max_subgoals) && opts.max_subgoals > 0 ? opts.max_subgoals : null,
    // 'light' only on a PLAN child the manager resolved to the light chain (_repo/docs/plans/
    // 2026-09-28-teams-light-plan.md §2.5); defaultKind/normalizeSpec read it. Absent otherwise.
    ...(opts.planning_mode === 'light' ? { planning_mode: 'light' } : {}),
    max_retries: Number.isInteger(opts.max_retries) ? opts.max_retries : 2,
    // continue (default) or rollback - _repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md §5.
    // Read by retrySubgoal below to decide whether a rejected attempt's worktree edits stay (as
    // every retry has always left them) or are reset to the attempt's own pre-checkpoint first.
    retry_policy: opts.retry_policy === 'rollback' ? 'rollback' : 'continue',
    // `auto` lets plan pick the flow; an entry skill pins it. `mixed` false turns the pin
    // into a rule every subgoal must follow.
    flow: FLOWS[opts.flow] ? opts.flow : 'auto',
    mixed: opts.mixed !== false,
    // team_open({skills}) mirrors tm_open's mechanism (taskmanager.mjs STAGE_SKILLS) for
    // the graph engine's own stages - see mounts.mjs. false turns stage-mounted method off
    // entirely; an object overrides the per-stage default; anything else keeps it.
    skills: opts.skills === false ? false : (opts.skills && typeof opts.skills === 'object' ? opts.skills : null),
    // team_open({mounts}) is the same switch for the advisory MCP tools mounts.mjs offers
    // per stage (plan, setgoal, gate:goal) - skipped in silence if the tool is not connected.
    mounts: opts.mounts === false ? false : (opts.mounts && typeof opts.mounts === 'object' ? opts.mounts : null),
    flow_chosen: null,
    size: null,
    created_at: Date.now(),
    spec: null,
    nodes: [],
    // Cross-run author identity ({executor, vendor, model} or null), for a run whose judging
    // stage's author never ran in ITS OWN nodes[] - today only the planning-audit kind's `audit`
    // stage, whose author is the PLAN package's draft/revise, folded away in a sibling run
    // before this one opens (taskmanager.mjs's openAudit/planAuthorIdentity). routing.mjs's
    // externalAuthorOf and broker.mjs's reviewIndependence both read this field; every run that
    // is not an audit child simply carries null, same as opts.external_author being absent.
    external_author: opts.external_author || null,
  };
  // A package the task manager shaped and critiqued (openChild) still runs the full harness
  // inside its own child run - plan -> setgoal -> critique -> <chain> -> gate:goal -> report -
  // the fractal rule of _repo/docs/plans/2026-09-17-teams-team.md §2 (each Team runs the four steps
  // inside itself). What the manager already settled travels down as data, not as skipped
  // nodes: `package` tells plan it is writing a BUILD plan for this one package (not a re-split
  // of the EPIC - prompts.mjs's packageBlock), and its acceptance is carried verbatim into the
  // spec (normalizeSpec). `subgoal_assignee` is a STORY-level human pin (pkg.assignee, or
  // tm_assign before dispatch), applied to the subgoals setgoal produces (expandSubgoals).
  // The 2026-09-21 chain-only shortcut (`parent_shaped`) was reverted on 2026-09-28.
  if (opts.package && typeof opts.package === 'object') {
    run.package = {
      id: opts.package.id != null ? String(opts.package.id) : null,
      origin: opts.package.origin ? String(opts.package.origin) : 'shape',
      title: String(opts.goal || opts.package.title || ''),
      acceptance: Array.isArray(opts.acceptance) ? opts.acceptance.map(String).filter(Boolean) : [],
    };
  }
  if (opts.subgoal_assignee) run.subgoal_assignee = opts.subgoal_assignee;
  run.nodes.push(
    node('plan', 'plan', []),
    node('setgoal', 'setgoal', ['plan']),
    node('critique', 'critique', ['setgoal']),
  );
  return saveRun(run);
}

// What this stage should run on. A stage entry wins over the run-level setting, which
// wins over the built-in default. `stage` keys are the STAGES values; `gate:goal` may be
// keyed separately from the per-subgoal gates.
export function stagePolicy(run, node) {
  const p = run.policy || {};
  const specific = node.node_id.startsWith('gate:goal') ? p['gate:goal'] : null;
  const byStage = p[node.stage] || {};
  const entry = { ...byStage, ...(specific || {}) };
  const out = {
    vendor: entry.vendor === undefined ? run.vendor : entry.vendor,
    candidates: entry.candidates === undefined ? run.candidates : entry.candidates,
    sandbox: entry.sandbox === undefined ? run.sandbox : entry.sandbox,
    model: entry.model === undefined ? (run.model || null) : entry.model,
  };
  return goalJudgeBias(run, node, out);
}

// A second (or third) judge on the same goal-gate round, asked with the same candidate
// order and the same model as the primary, tends to land on the same identity - which
// makes the second opinion decorative rather than independent. Best-effort only: a
// judge past the primary (`gate:goal:<round><letter>`) gets its candidate order biased
// away from the primary's resolved vendor when more than one is configured; failing
// that, and only when this judge is pinned to the very vendor the primary used, it
// gets the vendor's ordinary default tier rather than whatever the primary got (the
// goal gate is a "decisive" stage, so selectModel would otherwise hand both the same
// host model). Nothing here blocks a run that only has one identity available - a
// default self-routed run keeps working exactly as it did with one judge - and the
// judges actually reached is what `goal_verdict.judges[].identity` reports, not what
// this function hoped for.
function goalJudgeBias(run, node, pol) {
  const m = /^gate:goal:(\d+)[a-z]$/.exec(node.node_id || '');
  if (!m) return pol;
  const primary = getNode(run, `gate:goal:${m[1]}`);
  if (!primary) return pol;
  const primaryVendor = primary.executor || primary.vendor || null;
  if (!primaryVendor) return pol;
  const out = { ...pol };
  const candidates = Array.isArray(out.candidates) ? out.candidates : null;
  if (candidates && candidates.length > 1) {
    out.candidates = [...candidates].sort((a, b) => (a === primaryVendor ? 1 : 0) - (b === primaryVendor ? 1 : 0));
    return out;
  }
  const pinnedVendor = out.vendor && !['auto', undefined, null].includes(out.vendor)
    ? out.vendor
    : (candidates && candidates.length === 1 ? candidates[0] : null);
  if (!out.model && pinnedVendor && pinnedVendor === primaryVendor && DEFAULT_MODELS[pinnedVendor]) {
    out.model = DEFAULT_MODELS[pinnedVendor];
  }
  return out;
}

export function getNode(run, nodeId) {
  return run.nodes.find((n) => n.node_id === nodeId) || null;
}

// A malformed spec does not fail loudly on its own - it fails as a deadlock much later,
// which is far harder to read. Each of these was observed: a setgoal that returned no
// spec left the graph at three nodes; a spec with zero subgoals made the goal gate
// immediately ready over no work at all; a dep naming a subgoal that does not exist left
// its node waiting on a gate that could never be created.
// Kinds whose product is a written document, never a change to source. Their subgoals may
// only name document paths in files[] (validateSpec), and their authoring stages are told so
// in as many words (prompts.mjs).
export const DOCUMENT_ONLY_KINDS = new Set(['planning', 'planning-light', 'planning-audit']);

export function validateSpec(spec, opts = {}) {
  const problems = [];
  if (!spec || typeof spec !== 'object') return ['setgoal returned no spec object'];
  if (!spec.goal) problems.push('spec has no goal');
  if (!Array.isArray(spec.acceptance) || !spec.acceptance.length) {
    problems.push('spec has no goal-level acceptance criteria');
  }
  const subgoals = spec.subgoals;
  if (!Array.isArray(subgoals) || !subgoals.length) {
    problems.push('spec has no subgoals - there would be nothing to implement');
    return problems;
  }

  if (Number.isInteger(opts.max_subgoals) && subgoals.length > opts.max_subgoals) {
    problems.push(`spec has ${subgoals.length} subgoals; this run allows at most ${opts.max_subgoals} - fold the rest into ${opts.max_subgoals === 1 ? 'the one' : 'those'}`);
  }
  const ids = new Set();
  for (const sg of subgoals) {
    const id = sg && sg.id != null ? String(sg.id) : '';
    if (!id) { problems.push('a subgoal has no id'); continue; }
    if (ids.has(id)) problems.push(`duplicate subgoal id ${id}`);
    ids.add(id);
    if (!sg.title) problems.push(`subgoal ${id} has no title`);
    if (!Array.isArray(sg.acceptance) || !sg.acceptance.length) {
      problems.push(`subgoal ${id} has no acceptance criteria`);
    }
    if (!KINDS[kindOf(sg)]) problems.push(`subgoal ${id} has unknown kind ${kindOf(sg)}`);
    else if (opts.mixed === false && opts.kind && kindOf(sg) !== opts.kind) {
      problems.push(`subgoal ${id} has kind ${kindOf(sg)}, but this run is flow ${opts.flow || opts.kind} with mixed=false`);
    }
    // A planning or audit subgoal produces a document and nothing else. Without this rule
    // setgoal named source files in `files` and the draft node wrote its PRD sections INTO
    // them - measured, 2026-09-22, P1: a "Time and Clock resolution rules" subgoal whose
    // files[] were packages/queue/src/index.mjs and packages/cli/src/index.mjs, both duly
    // edited. (Planning cards now run in worktrees of their own - cards-everywhere C2 - but a
    // PRD written into source is still not a PRD.)
    if (DOCUMENT_ONLY_KINDS.has(kindOf(sg))) {
      for (const f of (sg && sg.files) || []) {
        if (!/\.(md|markdown|txt|rst|adoc)$/i.test(String(f))) {
          problems.push(`subgoal ${id} is ${kindOf(sg)} work, which writes a document - "${f}" is not a document path. Name the markdown file this section belongs in.`);
        }
      }
    }
  }
  for (const sg of subgoals) {
    const id = sg && sg.id != null ? String(sg.id) : '';
    for (const d of (sg && sg.deps) || []) {
      const dep = String(d);
      if (dep === id) problems.push(`subgoal ${id} depends on itself`);
      else if (!ids.has(dep)) problems.push(`subgoal ${id} depends on ${dep}, which is not in the spec`);
    }
    for (const d of (sg && sg.after) || []) {
      const dep = String(d);
      if (dep === id) problems.push(`subgoal ${id} is ordered after itself`);
      else if (!ids.has(dep)) problems.push(`subgoal ${id} is ordered after ${dep}, which is not in the spec`);
    }
  }

  // A cycle deadlocks exactly like a dangling dep, and is just as silent. Order-only
  // edges deadlock the same way, so they count.
  const edges = new Map(subgoals.map((sg) => [
    String(sg.id),
    [...(sg.deps || []), ...(sg.after || [])].map(String).filter((d) => ids.has(d)),
  ]));
  const state = new Map();
  const walk = (id, path) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      problems.push(`dependency cycle: ${[...path.slice(path.indexOf(id)), id].join(' -> ')}`);
      return;
    }
    state.set(id, 'open');
    for (const d of edges.get(id) || []) walk(d, [...path, id]);
    state.set(id, 'done');
  };
  for (const id of ids) walk(id, []);

  return problems;
}

// Subgoals arrive only after setgoal has run, so the per-subgoal part of the graph is
// built then. Goal-level gate and report depend on every subgoal gate, which is what
// keeps the report from summarizing work that never passed.
// The nth node of a kind, so a re-expansion after a spec retry cannot collide with the
// retired nodes it left behind. Reusing an id there silently created nothing: the run
// went straight to "complete" with no implement node ever having run.
export function nextIndex(run, prefix) {
  return run.nodes.filter((n) => n.node_id === prefix || n.node_id.startsWith(prefix + ':')).length + 1;
}

// One attempt of one subgoal: a chain of stages, wired head to tail. Returns the last id.
// Takes the chain itself, not a kind, so a run with its own stage table (the TaskManager's
// package chain) can use the same wiring.
export function pushChain(run, chain, subgoalId, attempt, headDeps, headAfter, headExtra) {
  let prev = null;
  for (const stage of chain) {
    const id = `${stage}:${subgoalId}:${attempt}`;
    const extra = { subgoal_id: subgoalId, attempt, ...(prev ? {} : { after: headAfter, ...headExtra }) };
    run.nodes.push(node(id, stage, prev ? [prev] : headDeps, extra));
    prev = id;
  }
  return prev;
}
