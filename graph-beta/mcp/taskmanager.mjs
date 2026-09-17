#!/usr/bin/env node
// task-manager - local stdio MCP server for requests too large for one graph run.
//
// A graph run is bound to one working directory and one spec. A medium or large request
// spans modules, worktrees, sometimes repositories: it has to be split into packages, each
// run as its own graph in its own worktree, then integrated and judged as a whole. That is
// this server's job, and only that:
//
//   size -> shape -> critique -> [dispatch -> accept] per package -> integrate -> gate:goal -> report
//
// Three rules keep it small:
//
//   1. It reuses graph.mjs as a library - nodes, typed edges, readiness, retries, settled
//      failure - and adds no second DAG. Its own stage names are the only thing new.
//   2. It READS child run files and never writes them. The graph broker is the one writer
//      of a run file; a second writer is the race mergeOnto exists to paper over.
//   3. It does not call the graph broker. MCP has no server-to-server channel, and the
//      driving session is already the relay: `tm_next` hands back a child pointer
//      {cwd, run_id}, the session drives the child with graph_next/graph_run/graph_submit,
//      and calls `tm_submit` on the dispatch node when the child's report is done.
//
// The child run is opened HERE, by the server, on a dispatch node - never by a model inside
// a node. The "do not re-enter the harness" rule in every node prompt stays true.
//
// State lives under ~/.harness/tasks/<task_id>/ (HARNESS_TASKS_DIR overrides), never under a
// project cwd: a task's packages live in several worktrees and belong to none of them.
// Zero dependencies: MCP's stdio transport is newline-delimited JSON-RPC 2.0.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, readdirSync, openSync, closeSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { touchMarker } from './engage.mjs';
import { readTeamConfig, resolveTeamOptions } from './teamconfig.mjs';
import {
  node,
  pushChain,
  nextIndex,
  saveRun,
  loadRun,
  loadRunAt,
  createRun,
  getNode,
  readyNodes,
  unmetDeps,
  runState,
  settleFailure,
  FLOWS,
} from './graph.mjs';

const SERVER = { name: 'task-manager', version: '0.7.0' };
const DEFAULT_PROTOCOL = '2025-06-18';

// ---------- where tasks live ----------

function tasksRoot() {
  return process.env.HARNESS_TASKS_DIR ? resolve(process.env.HARNESS_TASKS_DIR) : join(homedir(), '.harness', 'tasks');
}
function taskDir(taskId) {
  return join(tasksRoot(), taskId);
}
function taskPath(taskId) {
  return join(taskDir(taskId), 'task.json');
}

function record(task, entry) {
  try {
    mkdirSync(taskDir(task.run_id), { recursive: true });
    appendFileSync(join(taskDir(task.run_id), 'ledger.jsonl'), JSON.stringify({ ts: Date.now(), ...entry }) + '\n');
  } catch {
    /* the ledger is evidence, not a dependency */
  }
}

// ---------- the manager's stages ----------

// Nodes that mutate something: integrate merges branches. Everything else reads and judges.
const MUTATING = new Set(['integrate']);
// The chain every package expands into. dispatch is executed by this server (worktree +
// child run); accept is a reasoning node judging what the child delivered.
const PACKAGE_CHAIN = ['dispatch', 'accept'];
// A judging node's verdict field; stage_ok alone never completes one of these.
const VERDICT = { critique: 'sound', dispatch: 'accept', accept: 'accept', integrate: 'verified', gate: 'accept' };

// Method a stage may load before it works. A skill named here must be analytic and
// non-dialogic: it reasons about material it is handed and never asks the operator
// anything - a node runs headless, so a skill with a "What You Do" half has no one to do
// it. `size` gets none on purpose: it is a measurement, and its one failure mode is
// reaching for method instead of running commands. The stage contract always outranks a
// skill's own output template; the briefing says so, and the contract asks each stage to
// name what it actually loaded so the effect can be measured rather than assumed.
const STAGE_SKILLS = {
  size: [],
  shape: ['develop:domain-driven-design', 'develop:architecture-designer'],
  critique: ['think:devils-advocate', 'cognition:assumption-extractor'],
  accept: ['cognition:epistemic-reasoner'],
  integrate: ['cognition:second-order-thinker'],
  'gate:goal': ['cognition:critical-thinking-workflow'],
};

// tm_open({skills: {...}}) merges over the defaults; skills: false turns the whole thing off.
function stageSkills(task, n) {
  if (task.stage_skills === false) return [];
  const key = n.node_id.startsWith('gate:goal') ? 'gate:goal' : n.stage;
  const override = task.stage_skills && typeof task.stage_skills === 'object' ? task.stage_skills[key] : undefined;
  const list = Array.isArray(override) ? override : STAGE_SKILLS[key];
  return (list || []).map(String).filter(Boolean);
}

const CONTRACT = {
  size: `Return JSON: {"stage_ok": true, "skills_used": ["<skill or none>"], "size": "S|L", "flow": "develop|document", "sizing": ["command -> what it showed"], "handoff": "<what shape needs to know>", "evidence": "..."}
S means one graph run in one worktree can carry the whole request. L means it spans independent modules, packages or repositories that each need their own run and worktree, integrated afterwards. Decide from what commands show - file and module counts, ownership boundaries, build units - and put those commands in "sizing". The default is S: a manager layer exists, and the temptation is to use it. Over-sizing costs a worktree, a run and an integration per package; under-sizing costs one retry.`,
  shape: `Return JSON: {"stage_ok": true, "skills_used": ["<skill or none>"], "acceptance": ["goal-level criteria for the integrated result"], "packages": [{"id": "P1", "title": "...", "flow": "develop|document", "skills": ["plugin:skill"], "brief": "<the request this package's own graph run will receive - self-contained>", "acceptance": ["what the package must deliver, checkable inside its worktree"], "touches": ["paths or modules this package changes"], "deps": ["P0"]}], "handoff": "...", "evidence": "..."}
"skills" is optional and is method for the package, not for you: you are the stage that knows what each package IS, and a CLI package and a reference-document package want different method. Name the skills that package's own nodes should work by, and they travel into its child run; leave it out when the brief is method enough. Do not name a skill that asks its reader questions - the child's nodes run headless too.
Each package becomes one graph run in its own worktree. A package with no deps branches from the current HEAD; a package with deps branches from its first dependency's delivered branch with the others merged in, so it builds on what they delivered - not on stubs. Two packages that touch the same path will conflict at integration: split by ownership, not by phase. A dependency means the package needs another's delivered result; it receives that package's report as context and starts from its tree. Every package must be size S on its own - if one still needs splitting, the shape is wrong. Two to six packages is the usual range.`,
  critique: `Return JSON: {"stage_ok": true, "skills_used": ["<skill or none>"], "sound": true|false, "blocking": ["..."], "problems": ["..."], "handoff": "...", "evidence": "..."}
Attack the shape: packages that overlap in touches[], a dependency the brief does not actually need, a package too large to be one run, a goal-level criterion no integration step could check, and - above all - a request that was S sized as L. Set sound=false only for defects in "blocking" that make the packages impossible to run or impossible to integrate. Everything else is a problem, carried forward as advice.`,
  accept: `Return JSON: {"stage_ok": true, "skills_used": ["<skill or none>"], "accept": true|false, "match_pct": 0-100, "checks": ["<what you verified in the worktree or the report, and what it showed>"], "gaps": ["what the package did not deliver"], "observations": ["weaknesses that do not block"], "reason": "...", "evidence": "..."}
You are the judge, not the actor. The child run's own goal gate and report are below; judge them against THIS package's acceptance, which the child never saw in full. A child that passed its own gate but delivered less than the package asked for is a gap here. Absent evidence is a gap, not a pass.
accept:true with an empty checks[] is refused by the engine - a judgement with no evidence is a guess.`,
  integrate: `Return JSON: {"stage_ok": true|false, "skills_used": ["<skill or none>"], "verified": true|false, "checks": ["command -> observed output"], "evidence": "..."}
The package branches are already merged into the integration worktree named below - the manager did that and recorded each merge commit. Your job is what no package could do alone: run the goal-level checks the shape's acceptance implies against the combined tree, and read the seams between packages. stage_ok=false when a check could not run at all. verified=false when the combined tree fails a check the packages passed separately. Do not fix package work here: a failing seam is a gap for the gate and a repackage for the manager.
verified:true with an empty checks[] is refused by the engine - a judgement with no evidence is a guess.`,
  'gate:goal': `Return JSON: {"stage_ok": true, "skills_used": ["<skill or none>"], "accept": true|false, "match_pct": 0-100, "checks": ["<what you verified and what it showed>"], "gaps": ["what blocks acceptance"], "observations": ["weaknesses that do not block"], "spec_drift": ["where the shape asked for less than the request did"], "reason": "...", "evidence": "..."}
You are the judge, not the actor, and the only node that sees the original request again. Judge the integrated result against BOTH the goal-level acceptance and the REQUEST as written. Anything the request asked for that no package delivered and no criterion named belongs in "spec_drift". Absent evidence is a gap, not a pass.
accept:true with an empty checks[] is refused by the engine - a judgement with no evidence is a guess.`,
  report: `Return JSON: {"stage_ok": true, "handoff": "<the final report>", "evidence": "..."}
Synthesize from the node results below only: which packages ran, what each delivered, what the integration showed, what the gate said. State plainly what was not done and why.`,
};

function bullets(list) {
  return (list || []).map((x) => `- ${x}`).join('\n') || '- (none)';
}

// ---------- task creation ----------

function createTask(a) {
  if (a.child_driver !== undefined || a.s_driver !== undefined) {
    throw new Error('child_driver and s_driver were removed in 0.10.0: the driving session never drives a child run or the manager loop. Open the task and watch tm_status / tm_events; the TaskLeader and package drivers do the rest.');
  }
  const cwd = resolve(String(a.cwd));
  const teamFile = readTeamConfig(cwd);
  const team = resolveTeamOptions(a, teamFile.config);
  const T = team.opts;
  const taskId = randomUUID();
  const task = {
    run_id: taskId,
    kind: 'task',
    store_path: taskPath(taskId),
    cwd,
    request: String(a.request),
    context: a.context || '',
    flow: FLOWS[a.flow] ? a.flow : 'auto',
    flow_chosen: null,
    size: null,
    // The user said, in their own words, that this must be split (L) or must stay one run
    // (S): the size node is recorded as pinned and never measured. Mirrors the flow pin.
    size_pinned: ['S', 'L'].includes(a.size) ? a.size : null,
    // false turns method off entirely; an object overrides STAGE_SKILLS per stage.
    stage_skills: a.skills === false ? false : (a.skills && typeof a.skills === 'object' ? a.skills : null),
    max_retries: T.max_retries,
    // How many times a package's dead driver is respawned on the SAME child run_id before the
    // dispatch is folded blocked. A usage-limit death never spends this budget - see
    // serviceDeadDriver.
    driver_restarts: T.driver_restarts,
    // Whether the single run a size-S request becomes is opened isolated. It is a tm_open
    // argument because the manager, not the entry skill, is what opens that run.
    isolated: a.isolated === true,
    // Same story as isolated: an entry skill pinned to 'develop' or 'document' says whether the
    // other kind may appear in the spec at all. Carried on the task, for that same size-S run.
    mixed: a.mixed !== false,
    // The floor the manager's own goal gate's match_pct must clear - same meaning, same
    // default, as the graph engine's run.goal_threshold.
    goal_threshold: T.goal_threshold,
    // Best-effort: the agent/session name the TaskLeader driver SendMessages on every state
    // change. null falls back to "whoever ListAgents shows opened this task".
    notify: typeof a.notify === 'string' && a.notify ? a.notify : null,
    // Set once tm_open spawns it (toolOpen): {pid, started_at, log, stderr, exit, command,
    // spawn_count, restarts, exhausted}. null under noLeader() - see serviceLeader/spawnLeader.
    leader: null,
    // .claude/team.json project defaults, layered under explicit tm_open arguments - see
    // teamconfig.mjs. Recorded here (not just applied) so tm_status can show where each
    // resolved option came from.
    team: { opts: T, sources: team.sources, notes: team.notes, file_status: teamFile.status },
    // Everything a child run needs to route the way the parent's session routes.
    child_opts: {
      vendor: T.vendor,
      allocation: T.allocation,
      host_vendor: a.host_vendor || null,
      host_model: a.host_model || null,
      native_models: a.native_models || null,
      model: a.model || null,
      policy: a.policy && typeof a.policy === 'object' ? a.policy : {},
      candidates: a.candidates || null,
      sandbox: a.sandbox || null,
      max_retries: Number.isInteger(a.max_retries) ? a.max_retries : 2,
      auto_reassign: a.auto_reassign !== false,
      goal_threshold: Number.isInteger(a.goal_threshold) ? a.goal_threshold : 90,
    },
    created_at: Date.now(),
    spec: null,
    // Set only for a size-S task: {cwd, run_id, driver, spawn_count,
    // waiting_capacity?} for the one graph run the manager opened and is driving with a
    // headless session, mirroring a package's n.child.
    s_run: null,
    nodes: [
      node('size', 'size', []),
      node('shape', 'shape', ['size']),
      node('critique', 'critique', ['shape']),
    ],
  };
  return saveRun(task);
}

function mustFindTask(a) {
  const id = String(a.task_id || '');
  const task = id && loadRunAt(taskPath(id));
  if (!task) throw new Error(`unknown task ${a.task_id}`);
  return task;
}

// ---------- shape validation and expansion ----------

function validateShape(spec) {
  const problems = [];
  if (!spec || typeof spec !== 'object') return ['shape returned no packages object'];
  if (!Array.isArray(spec.acceptance) || !spec.acceptance.length) problems.push('shape has no goal-level acceptance criteria');
  const packages = spec.packages;
  if (!Array.isArray(packages) || !packages.length) {
    problems.push('shape has no packages - there would be nothing to dispatch');
    return problems;
  }
  if (packages.length === 1) problems.push('shape has one package: a request that fits one run is size S and needs no manager');
  const ids = new Set();
  for (const p of packages) {
    const id = p && p.id != null ? String(p.id) : '';
    if (!id) { problems.push('a package has no id'); continue; }
    if (ids.has(id)) problems.push(`duplicate package id ${id}`);
    ids.add(id);
    if (!p.title) problems.push(`package ${id} has no title`);
    if (!p.brief) problems.push(`package ${id} has no brief - its child run would have no request`);
    if (!Array.isArray(p.acceptance) || !p.acceptance.length) problems.push(`package ${id} has no acceptance criteria`);
    if (p.flow != null && !FLOWS[p.flow]) problems.push(`package ${id} has unknown flow ${p.flow}`);
  }
  for (const p of packages) {
    const id = p && p.id != null ? String(p.id) : '';
    for (const d of (p && p.deps) || []) {
      const dep = String(d);
      if (dep === id) problems.push(`package ${id} depends on itself`);
      else if (!ids.has(dep)) problems.push(`package ${id} depends on ${dep}, which is not in the shape`);
    }
  }
  // Overlapping touches is what integration conflicts are made of; say so before dispatch.
  const owners = new Map();
  for (const p of packages) {
    for (const t of (p && p.touches) || []) {
      const key = String(t).replace(/\/+$/, '');
      if (owners.has(key) && owners.get(key) !== String(p.id)) problems.push(`packages ${owners.get(key)} and ${p.id} both touch ${key}`);
      owners.set(key, String(p.id));
    }
  }
  const edges = new Map(packages.map((p) => [String(p.id), ((p.deps || []).map(String)).filter((d) => ids.has(d))]));
  const state = new Map();
  const walk = (id, path) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') { problems.push(`dependency cycle: ${[...path.slice(path.indexOf(id)), id].join(' -> ')}`); return; }
    state.set(id, 'open');
    for (const d of edges.get(id) || []) walk(d, [...path, id]);
    state.set(id, 'done');
  };
  for (const id of ids) walk(id, []);
  return problems;
}

function expandPackages(task, packages) {
  const live = task.nodes.filter((n) => n.stage === 'critique' && n.state !== 'skipped').pop();
  const critiqueDep = live ? live.node_id : 'critique';
  const round = Math.max(1, ...packages.map((p) => nextIndex(task, `dispatch:${String(p.id)}`)));
  const acceptIds = [];
  for (const p of packages) {
    const id = String(p.id);
    const deps = (p.deps || []).map((d) => `accept:${d}:${round}`);
    acceptIds.push(pushChain(task, PACKAGE_CHAIN, id, round, [critiqueDep, ...deps], [], {}));
  }
  const integrateId = `integrate:${nextIndex(task, 'integrate')}`;
  const goalGate = `gate:goal:${nextIndex(task, 'gate:goal')}`;
  const reportId = round === 1 ? 'report' : `report:${round}`;
  task.nodes.push(node(integrateId, 'integrate', acceptIds, { subgoal_id: null }));
  task.nodes.push(node(goalGate, 'gate', [integrateId], { subgoal_id: null }));
  task.nodes.push(node(reportId, 'report', [], { after: [goalGate] }));
  return saveRun(task);
}

function retryShape(task, feedback) {
  const priors = task.nodes.filter((n) => n.stage === 'shape');
  const attempt = priors.length + 1;
  if (attempt > task.max_retries + 1) {
    const dead = task.nodes.filter((n) => (n.stage === 'shape' || n.stage === 'critique') && n.state === 'failed' && !n.final);
    const unreachable = dead.flatMap((n) => settleFailure(task, n));
    return { task: saveRun(task), attempt: null, reason: 'retry budget exhausted', unreachable };
  }
  for (const n of task.nodes) {
    if (n.node_id === 'size') continue;
    if (n.state === 'pending' || n.state === 'failed') {
      n.state = 'skipped';
      n.result = n.result || { stage_ok: false, reason: `superseded by shape attempt ${attempt}` };
    }
  }
  task.spec = null;
  task.nodes.push(node(`shape:${attempt}`, 'shape', ['size'], { attempt, feedback: feedback || '' }));
  task.nodes.push(node(`critique:${attempt}`, 'critique', [`shape:${attempt}`], { attempt }));
  return { task: saveRun(task), attempt, reason: '' };
}

function retryPackage(task, pkgId, feedback) {
  const prior = task.nodes.filter((n) => n.subgoal_id === pkgId && n.stage === 'accept');
  const attempt = prior.length + 1;
  if (attempt > task.max_retries + 1) {
    const dead = task.nodes.filter((n) => n.subgoal_id === pkgId && n.state === 'failed' && !n.final);
    // Settle first, save second: an object literal evaluates left to right, and a save that
    // runs before the settling writes the unsettled graph.
    const unreachable = dead.flatMap((n) => settleFailure(task, n));
    return { task: saveRun(task), attempt: null, reason: 'retry budget exhausted', unreachable };
  }
  const prevAccept = `accept:${pkgId}:${attempt - 1}`;
  for (const n of task.nodes) {
    if (n.subgoal_id !== pkgId || (n.attempt || 1) !== attempt - 1) continue;
    // Nothing downstream will ever read what this attempt's driver is still doing, and it holds
    // the worktree the next attempt continues in. Stop it before the fresh dispatch opens.
    if (n.stage === 'dispatch' && n.child && killDriver(n.child.driver)) {
      record(task, { event: 'child_driver_killed', task_id: task.run_id, node_id: n.node_id, pid: n.child.driver.pid, reason: `superseded by attempt ${attempt}` });
    }
    if (n.state === 'pending') {
      n.state = 'skipped';
      n.result = { stage_ok: false, reason: `superseded by attempt ${attempt}` };
    }
  }
  const first = task.nodes.find((x) => x.subgoal_id === pkgId && x.stage === 'dispatch');
  const baseDeps = first ? first.deps.slice() : ['critique'];
  const accept = pushChain(task, PACKAGE_CHAIN, pkgId, attempt, baseDeps, [], { feedback: feedback || '' });
  for (const n of task.nodes) {
    if (n.node_id === accept) continue;
    n.deps = n.deps.map((d) => (d === prevAccept ? accept : d));
    n.after = (n.after || []).map((d) => (d === prevAccept ? accept : d));
  }
  // An integrate that failed its checks and blamed this package stays failed forever unless
  // someone re-judges the combined tree once the package is redone - the same wedge the graph
  // engine had with a rejected gate:goal. Open a fresh integrate over the same accepts (now
  // pointing at the new attempt) and move the goal gate behind it. The first docs task to
  // reach this point ended blocked with every document delivered and no route forward.
  for (const old of task.nodes.filter((x) => x.stage === 'integrate' && x.state === 'failed' && !x.final && x.deps.includes(accept))) {
    if (task.nodes.some((x) => x.supersedes === old.node_id)) continue;
    const fresh = `integrate:${nextIndex(task, 'integrate')}`;
    const fb = [feedback, old.result && old.result.reason, ...((old.result && old.result.gaps) || [])].filter(Boolean).join('\n');
    task.nodes.push(node(fresh, 'integrate', old.deps.slice(), { subgoal_id: null, feedback: fb, supersedes: old.node_id }));
    for (const n of task.nodes) {
      if (n.node_id === fresh) continue;
      n.deps = n.deps.map((d) => (d === old.node_id ? fresh : d));
      n.after = (n.after || []).map((d) => (d === old.node_id ? fresh : d));
    }
  }
  return { task: saveRun(task), attempt, reason: '' };
}

// ---------- repair: the package whose worktree is the integration tree ----------

// A seam is a defect that exists only in the combined tree: package P2's README example needs
// something P4 installed, two packages' exports disagree about a name. tm_retry({package_id})
// cannot reach it - it reopens that package in its OWN worktree, where the offending claim is
// still true and the defect does not reproduce. `goal-docs` round 2 ended settled-failure
// exactly there: every package accepted, integrate refusing twice, and no tool that could see
// what integrate saw. The answer is a package whose worktree IS the integration tree.
//
// Which integrate that would be, or why it is not one. Returns {node} or {error}: the caller
// throws, and the error has to name what to call instead - a manager session that gets an
// unhelpful refusal here has nowhere left to go.
function integrateToRepair(task) {
  const last = task.nodes.filter((x) => x.stage === 'integrate').pop();
  if (!last) {
    return { error: 'this task has integrated nothing yet, so there is no combined tree to repair. '
      + 'Retry a package with tm_retry({task_id, package_id}), or reshape with tm_retry({task_id}).' };
  }
  if (last.state !== 'failed') {
    return { error: `${last.node_id} is ${last.state}, not failed: a repair package exists to make a failed integrate's checks pass, and there is nothing here to repair`
      + (last.state === 'pending' ? '. Run it first - tm_next hands you its briefing.' : '.') };
  }
  const r = last.result || {};
  if (r.verified === true) {
    return { error: `${last.node_id} verified the combined tree; its failure is not a seam. Fix what its stage_ok=false named, or retry the package its checks blame with tm_retry({task_id, package_id}).` };
  }
  if ((r.conflicts || []).length) {
    const ids = (r.conflicting_packages || []).map((x) => `"${x}"`).join(', ');
    return { error: `${last.node_id} failed on a merge conflict (${r.conflicts.join(', ')}), not on its checks: two packages own the same path, which is a shape failure and no repair can fix it. `
      + `tm_retry({task_id, repackage: [${ids}]}) reshapes them together.` };
  }
  if (!last.integration || !last.integration.cwd) {
    return { error: `${last.node_id} never reached a combined tree (${r.reason || 'it failed before the merges'}), so there is nothing for a repair package to work in.` };
  }
  if (task.nodes.some((x) => x.supersedes === last.node_id)) {
    return { error: `${last.node_id} has already been superseded; run the integrate that replaced it instead.` };
  }
  return { node: last };
}

// Append a repair package to the shape, expand it like any other package, and open a fresh
// integrate behind it - the same move retryPackage makes when a package it retried was the one
// an integrate blamed. The old integrate stays failed as evidence, superseded, and the goal
// gate and report move behind the new one.
function openRepair(task, integ) {
  const packages = (task.spec && task.spec.packages) || [];
  const priors = packages.filter((p) => p.repair);
  if (priors.length > task.max_retries) {
    // Settle before saving: the same ordering retryPackage needs, for the same reason.
    const unreachable = settleFailure(task, integ);
    return { task: saveRun(task), package_id: null, reason: 'repair budget exhausted', unreachable };
  }
  const round = Number(String(integ.node_id).split(':')[1] || 1);
  const id = `R${priors.length + 1}`;
  const r = integ.result || {};
  const brief = [
    `This package works on the COMBINED tree of every package in this task - its worktree is the integration worktree, with all package branches already merged - and its whole job is to make the integration checks below pass.`,
    '',
    `Integration round ${round} was not verified.`,
    r.reason ? `Why it refused:\n${r.reason}` : '',
    (r.gaps || []).length ? `Gaps it named:\n${bullets(r.gaps)}` : '',
    (r.checks || []).length ? `Checks it ran:\n${bullets(r.checks)}` : '',
    r.evidence ? `Evidence:\n${r.evidence}` : '',
  ].filter(Boolean).join('\n');
  packages.push({
    id,
    title: `repair: integration ${round}`,
    repair: true,
    integration_of: integ.node_id,
    flow: task.flow_chosen || 'auto',
    brief,
    acceptance: ((task.spec && task.spec.acceptance) || []).slice(),
    // Every path any package claimed: the seam is between them, so none of them is out of bounds.
    touches: [...new Set(packages.flatMap((p) => (p.touches || []).map(String)))],
    deps: packages.filter((p) => !p.repair).map((p) => String(p.id)),
  });
  // The same deps the failed integrate had - every package's accept, all done. A repair that
  // depended on the failed integrate itself could never become ready: a failed node is never
  // satisfied.
  const accept = pushChain(task, PACKAGE_CHAIN, id, 1, integ.deps.slice(), [], { feedback: '' });
  const fresh = `integrate:${nextIndex(task, 'integrate')}`;
  const fb = [r.reason, ...(r.gaps || []), ...(r.checks || [])].filter(Boolean).join('\n- ');
  task.nodes.push(node(fresh, 'integrate', [accept], { subgoal_id: null, feedback: fb, supersedes: integ.node_id }));
  for (const x of task.nodes) {
    if (x.node_id === fresh) continue;
    x.deps = x.deps.map((d) => (d === integ.node_id ? fresh : d));
    x.after = (x.after || []).map((d) => (d === integ.node_id ? fresh : d));
  }
  return { task: saveRun(task), package_id: id, integrate: fresh, reason: '' };
}

// ---------- worktrees and child runs ----------

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function shortId(taskId) {
  return String(taskId).slice(0, 8);
}

// Test seam only, never an option. The driving session does not drive: every package, every
// size-S run and the manager loop itself belong to their own headless sessions, because a
// session that relays each node's briefing and result through its own context burns it out
// (measured: 507k tokens over 331 turns, ~55% of one task's cost, dead at the usage limit).
// A test that wants to submit nodes by hand through the broker sets this and nothing spawns.
function noDriver() { return process.env.HARNESS_TEST_NO_DRIVER === '1'; }

// Test seam only, like noDriver() but narrower: disables just the TaskLeader auto-spawn (and the
// inbox/watcher gate that only exists once a leader does) without touching package or size-S
// driver spawning. A fixture that drives a real fake-driver process for a PACKAGE dispatch sets
// this so a leader - spawned from the very same HARNESS_CHILD_DRIVER script - cannot race its own
// direct tm_submit calls into the inbox, or (with no HARNESS_CHILD_DRIVER override at all) spawn a
// real `claude` process merely because tm_open was called.
function noLeader() { return noDriver() || process.env.HARNESS_TEST_NO_LEADER === '1'; }

// The engagement marker (engage.mjs) lives at .claude/.harness-markers/ INSIDE the tree, because
// that is where the harness gate looks. It is harness state, not project content, so git must
// not see it at all: an untracked marker leaves every worktree dirty and a committed one makes
// every package branch conflict on a timestamp. info/exclude is the local, never-committed place
// for that, and it is read from the common git dir, so one write covers the repo and every
// worktree of it. install.mjs also gitignores the path for projects that want it committed.
const EXCLUDE_LINE = '.claude/.harness-markers/';
function excludeMarkers(cwd) {
  try {
    const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (!common.ok || !common.out) return false;
    const info = join(common.out, 'info');
    const file = join(info, 'exclude');
    const cur = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (cur.split(/\r?\n/).some((l) => l.trim() === EXCLUDE_LINE)) return true;
    mkdirSync(info, { recursive: true });
    writeFileSync(file, cur + (cur === '' || cur.endsWith('\n') ? '' : '\n') + EXCLUDE_LINE + '\n');
    return true;
  } catch {
    return false;
  }
}

// A worktree holds only what git committed. harness's own gate (.claude/harness-gate.json,
// enforced by .claude/hooks/goal-gate.mjs) is installed into the PROJECT tree by
// harness:install, but if the user has not yet committed it, a fresh worktree branches from a
// HEAD that never had it: the worker inside is silently ungated, while the user still believes
// tm_open is protected. Every hook here is deliberately fail-open, and this stays that way - a
// warning, never a blocked dispatch - but fail-open plus a false belief in protection is the
// trap, so it has to be said somewhere a person looks. The ledger is that place: the same
// best-effort record() every other worktree/dispatch event already uses.
function warnUncommittedGate(task, worktreePath) {
  try {
    if (!existsSync(join(task.cwd, '.claude', 'harness-gate.json'))) return;
    if (existsSync(join(worktreePath, '.claude', 'harness-gate.json'))) return;
    record(task, {
      event: 'gate_uncommitted',
      task_id: task.run_id,
      path: worktreePath,
      reason: `${task.cwd} has .claude/harness-gate.json but this worktree does not: a worktree `
        + `inherits only committed files, so the harness gate is NOT enforced here. Commit `
        + `.claude/harness-gate.json and .claude/hooks/goal-gate.mjs in the project, then retry.`,
    });
  } catch {
    /* best-effort, like touchMarker */
  }
}

// One worktree per package, kept across attempts: a retry continues in the tree the first
// attempt left, exactly as a graph retry keeps the worktree of the attempt it replaces.
// `base` is the commit or branch the tree starts from - the project's HEAD, or a dependency's
// branch so the package builds on what it depends on instead of re-discovering it at merge.
function ensureWorktree(task, name, base = 'HEAD') {
  const path = join(taskDir(task.run_id), 'worktrees', name);
  const branch = `harness/${shortId(task.run_id)}/${name}`;
  if (existsSync(join(path, '.git'))) {
    // The harness gate (if this project also installs harness) reads .claude/.harness-markers/
    // from the session's cwd, which for a worker IS this worktree. See engage.mjs.
    excludeMarkers(path);
    touchMarker(path, task.run_id);
    warnUncommittedGate(task, path);
    return { ok: true, path, branch, created: false };
  }
  mkdirSync(dirname(path), { recursive: true });
  const exists = git(task.cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
  const r = exists
    ? git(task.cwd, ['worktree', 'add', path, branch])
    : git(task.cwd, ['worktree', 'add', '-b', branch, path, base]);
  if (!r.ok) return { ok: false, path, branch, reason: r.err || r.out || 'git worktree add failed' };
  excludeMarkers(path);
  touchMarker(path, task.run_id);
  warnUncommittedGate(task, path);
  return { ok: true, path, branch, created: !exists };
}

// A child run changes files; it does not commit. The package branch has to carry the work for
// anything downstream to build on it, so the manager commits the worktree when it folds an
// accepted child. This writes to git, not to the child's run file - the run file stays the
// broker's alone. The run's own state directory is left out of the commit - by unstaging it
// after the add, not by a negative pathspec: when the project's .gitignore already lists
// .harness-run/ (the usual case), git refuses `:!.harness-run` as "a path that is ignored" and
// exits 1 before staging anything. The first e2e task to reach a fold failed exactly there,
// with both children accepted and nothing committed.
function commitWorktree(cwd, message) {
  const add = git(cwd, ['add', '-A', '--', '.']);
  if (!add.ok) return { ok: false, reason: add.err || 'git add failed' };
  // .claude/.harness-markers/ gets the same treatment for the same reason, plus one of its own:
  // every worktree writes its own marker with its own timestamp (engage.mjs), so committing it
  // would make every package branch differ in that one file and every integrate merge conflict
  // on it. install.mjs gitignores it in a real project; a project without it must not break.
  const drop = git(cwd, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', '.harness-run', '.claude/.harness-markers']);
  if (!drop.ok) return { ok: false, reason: drop.err || 'could not leave the harness state out of the commit' };
  const staged = git(cwd, ['diff', '--cached', '--quiet']);
  if (staged.ok) return { ok: true, commit: null }; // nothing to commit is not an error
  const c = git(cwd, ['-c', 'user.email=harness@local', '-c', 'user.name=harness', 'commit', '-q', '-m', message]);
  if (!c.ok) return { ok: false, reason: c.err || 'git commit failed' };
  return { ok: true, commit: git(cwd, ['rev-parse', 'HEAD']).out };
}

// Merge one branch into a worktree. A conflict is observed, not reported: the files git
// marks unmerged are the evidence, and the merge is aborted so the tree stays usable.
function mergeInto(cwd, branch, message) {
  const r = git(cwd, ['-c', 'user.email=harness@local', '-c', 'user.name=harness', 'merge', '--no-ff', '--no-edit', '-m', message, branch]);
  if (r.ok) return { ok: true, commit: git(cwd, ['rev-parse', 'HEAD']).out };
  const conflicts = git(cwd, ['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
  git(cwd, ['merge', '--abort']);
  return { ok: false, conflicts, reason: r.err || r.out || 'merge failed' };
}

// Packages in an order where every dependency comes before what depends on it.
function dependencyOrder(packages) {
  const byId = new Map(packages.map((p) => [String(p.id), p]));
  const out = [];
  const seen = new Set();
  const visit = (p) => {
    const id = String(p.id);
    if (seen.has(id)) return;
    seen.add(id);
    for (const d of p.deps || []) if (byId.has(String(d))) visit(byId.get(String(d)));
    out.push(p);
  };
  for (const p of packages) visit(p);
  return out;
}

// Which of the given packages own a conflicting path, by their declared touches[]. Declared
// ownership is a claim; the conflict is the fact. Both go in the reason so shape can see
// where the claim and the fact disagreed.
function ownersOf(packages, files) {
  const owners = new Set();
  for (const f of files) {
    for (const p of packages) {
      if ((p.touches || []).some((t) => { const k = String(t).replace(/\/+$/, ''); return f === k || f.startsWith(k + '/'); })) owners.add(String(p.id));
    }
  }
  return [...owners];
}

// The branch a dependency delivered on, if its dispatch has folded.
function deliveredBranch(task, pkgId) {
  const d = task.nodes.filter((n) => n.subgoal_id === String(pkgId) && n.stage === 'dispatch' && n.state === 'done' && n.child).pop();
  return d ? d.child.branch : null;
}

function packageOf(task, id) {
  return ((task.spec && task.spec.packages) || []).find((p) => String(p.id) === String(id)) || null;
}

// A repair package gets no worktree of its own: it runs IN the integration worktree of the
// integrate that refused, because that is the only tree the seam exists in. Everything else
// about it is an ordinary package, which is why this returns the same shape ensureWorktree
// does - created:false, since the tree is already there with every package branch merged.
function repairWorktree(task, pkg) {
  const src = task.nodes.find((x) => x.node_id === String(pkg.integration_of) && x.integration);
  if (!src) return { ok: false, path: null, branch: null, reason: `${pkg.id} repairs ${pkg.integration_of}, which has no integration worktree` };
  if (!existsSync(join(src.integration.cwd, '.git'))) return { ok: false, path: src.integration.cwd, branch: src.integration.branch, reason: `the integration worktree at ${src.integration.cwd} is gone` };
  return { ok: true, path: src.integration.cwd, branch: src.integration.branch, created: false };
}

// Where integration round N starts. Normally the project's HEAD, with every package branch
// merged in. But once a repair package has been accepted, its delivered branch IS the
// integration branch of the round that failed, now carrying the repair commit: merging the
// package branches into a fresh tree from HEAD would rebuild exactly the tree the repair was
// made against and throw the repair away. This finds that branch - named by the integrate's
// own deps first, and otherwise by the latest accepted repair package the shape holds.
function repairBase(task, n) {
  const named = (n.deps || []).map((d) => /^accept:(.+):\d+$/.exec(String(d))).filter(Boolean).map((m) => m[1]);
  const rest = ((task.spec && task.spec.packages) || []).map((p) => String(p.id)).reverse();
  for (const id of [...named, ...rest]) {
    const pkg = packageOf(task, id);
    if (!pkg || !pkg.repair) continue;
    const branch = deliveredBranch(task, id);
    const d = task.nodes.filter((x) => x.subgoal_id === String(id) && x.stage === 'dispatch' && x.state === 'done' && x.result && x.result.accept === true).pop();
    if (!branch || !d) continue;
    return { package: String(pkg.id), branch, commit: (d.result && d.result.commit) || null };
  }
  return null;
}

// Does this worktree's HEAD already contain that branch? Cheap, and the only way to tell a
// package branch the repair was made on from one a retry delivered while the repair ran.
function containsBranch(cwd, branch) {
  return git(cwd, ['merge-base', '--is-ancestor', branch, 'HEAD']).ok;
}

// Array.isArray rather than a truthiness check: a shape that returns "skills":
// "develop:cli-developer" as a bare string would otherwise be spread through the briefing one
// character per bullet, and the package would look like it had asked for twenty skills.
function packageSkills(pkg) {
  return (Array.isArray(pkg && pkg.skills) ? pkg.skills : []).map(String).filter(Boolean);
}

// What a package's child run is told beyond its own brief: the package contract, and the
// reports of the packages it depends on. Not the whole request - that is what the brief
// is for - and never another package's spec.
function childContext(task, pkg) {
  const lines = [];
  lines.push(`This run is package ${pkg.id} (${pkg.title}) of a larger task managed outside this worktree.`);
  if (pkg.repair) {
    // The one package that is not private to itself. Said plainly, because the defect it is
    // here for cannot be seen from any single package's tree: every other child was told to
    // stay inside its own paths, and this one has to be told the opposite in as many words.
    lines.push(`This worktree is the COMBINED tree of every package in this task: all of their branches are already merged here, and you are on the integration branch itself.`);
    lines.push(`The goal-level integration checks were run on this tree and FAILED. What failed is in your request above. Your job is to make those checks pass.`);
    lines.push(`Every package's files are yours to touch - that is the point of this package. The defect lives in the seam between packages, which is why no package could repair it in its own worktree.`);
    lines.push(`Do not undo another package's work to get the checks green. Reconcile them: change the least that makes the combined tree true.`);
  } else {
    lines.push(`The worktree is private to this package and branched from the project's HEAD; integration happens later, elsewhere.`);
  }
  lines.push('');
  lines.push('Package acceptance - what the manager will judge this run against:');
  lines.push(bullets(pkg.acceptance));
  if (pkg.repair && (pkg.touches || []).length) {
    lines.push('');
    lines.push('Paths the packages of this task own. All of them are in scope here:');
    lines.push(bullets(pkg.touches));
  } else if ((pkg.touches || []).length) {
    lines.push('');
    lines.push('Paths this package owns. Stay inside them; another package owns the rest:');
    lines.push(bullets(pkg.touches));
  }
  // Method for the whole child run, named by shape because shape is the stage that knows what
  // each package IS - a CLI package and a reference-document package want different method,
  // and the manager's own STAGE_SKILLS table cannot know which is which. The precedence has to
  // be restated here rather than left to the child: its nodes never see the manager's briefing,
  // so this context is the only place they hear it.
  const skills = packageSkills(pkg);
  if (skills.length) {
    lines.push('');
    lines.push('Method for this package — load each of these that is available, then work the way it says:');
    lines.push(bullets(skills));
    lines.push('A skill that is not installed here is skipped without comment or substitute. Its own output template does not apply - each node\'s own "Required output" is the only shape it may return - and neither does its "what you do / what I do" half: nobody is reading this but the machine that called you, so ask nothing and finish the work yourself.');
  }
  for (const d of pkg.deps || []) {
    const acc = task.nodes.filter((n) => n.subgoal_id === String(d) && n.stage === 'dispatch' && n.state === 'done' && n.result).pop();
    if (acc && acc.result) {
      lines.push('');
      lines.push(`Delivered by package ${d}, which this one depends on (branch ${acc.result.branch || '?'}):`);
      lines.push(String(acc.result.report || acc.result.reason || '').slice(0, 3000));
    }
  }
  if (task.context) {
    lines.push('');
    lines.push('From the requester:');
    lines.push(task.context);
  }
  return lines.join('\n');
}

// ---------- child driver processes ----------

// Recursion by process, not by tool call. When the session that drives the manager also drives
// every child node, one L task pushed 54 node briefings and their result JSONs through a single
// context - 507k tokens, 331 turns, and a run that died on the session's usage limit. So a ready
// dispatch spawns its own headless session in the package worktree, which runs the ordinary
// graph loop to the end; the manager waits and folds the result. Manager context per package:
// a few lines.

function driverArgv() {
  // Tests (and anyone with a different CLI) replace the whole command line here; the prompt is
  // always appended as the last argument.
  const override = String(process.env.HARNESS_CHILD_DRIVER || '').trim();
  if (override) return override.split(/\s+/);
  const argv = ['claude', '-p', '--output-format', 'stream-json', '--verbose',
    '--dangerously-skip-permissions', '--setting-sources', 'project'];
  // This server is launched with CLAUDE_PLUGIN_ROOT when it runs from a --plugin-dir; the child
  // needs the same directory to see the same plugin. Without it the plugin is installed.
  if (process.env.CLAUDE_PLUGIN_ROOT) argv.push('--plugin-dir', process.env.CLAUDE_PLUGIN_ROOT);
  return argv;
}

// The child's request and context are already in its run file. This says only which run to
// continue and how to drive it - the same words that resume an interrupted bench workspace.
// opts.resume marks a driver spawned in place of one that died before the run finished: the
// run and its worktree already carry whatever that attempt completed, so the new session is
// told to read graph_status first rather than redo work.
function driverPrompt(task, child, opts = {}) {
  const o = task.child_opts || {};
  const routing = [
    o.host_vendor ? `host_vendor ${o.host_vendor}` : '',
    o.host_model ? `host_model ${o.host_model}` : '',
    Array.isArray(o.native_models) && o.native_models.length ? `native_models ${o.native_models.join(', ')}` : '',
  ].filter(Boolean);
  return [
    `Use the graph-beta:orchestrate skill, but CONTINUE the graph run that is already open instead of opening one:`,
    `run_id ${child.run_id} at cwd ${child.cwd}. Do not call graph_open or tm_open.`,
    opts.resume
      ? `A previous driver for this exact run died before it finished; call graph_status({run_id, cwd}) first to see what it already completed, and resume from there - do not redo a node that is already done.`
      : '',
    `Read references/loop.md, then drive graph_next/graph_run/graph_submit exactly as it says until the run is`,
    `complete or blocked - a fresh agent for every ready node, its JSON relayed verbatim to graph_submit,`,
    `graph_retry as the loop says.`,
    routing.length ? `Pass ${routing.join(', ')}.` : '',
    `End with the skill's output template.`,
  ].filter(Boolean).join(' ');
}

// nodeIdLabel names the log files under <taskDir>/drivers/ (a package's node_id, or "S" for a
// size-S task's single run). child is the {cwd, run_id} pointer - n.child for a package,
// task.s_run for a size-S task; both are plain objects the caller can keep mutating (driver,
// spawn_count, restarts, waiting_capacity) after this returns.
function spawnChildDriver(task, nodeIdLabel, child, opts = {}) {
  const dir = join(taskDir(task.run_id), 'drivers');
  const base = String(nodeIdLabel).replace(/[^A-Za-z0-9._-]/g, '_');
  const attempt = Number.isInteger(opts.attempt) ? opts.attempt : 0;
  const suffix = attempt > 0 ? `.restart${attempt}` : '';
  const log = join(dir, `${base}${suffix}.stream.jsonl`);
  const stderr = join(dir, `${base}${suffix}.stderr.txt`);
  const exitFile = join(dir, `${base}${suffix}.exit.json`);
  const argv = driverArgv();
  const command = argv.join(' ');
  let out = null;
  let err = null;
  try {
    mkdirSync(dir, { recursive: true });
    out = openSync(log, 'a');
    err = openSync(stderr, 'a');
    const env = { ...process.env };
    // A nested claude refuses to start inside a claude session, and resolving the tasks dir
    // keeps a relative HARNESS_TASKS_DIR pointing at the same place from the child's cwd.
    delete env.CLAUDECODE;
    if (process.env.HARNESS_TASKS_DIR) env.HARNESS_TASKS_DIR = tasksRoot();
    if (opts.env) Object.assign(env, opts.env);
    const prompt = opts.prompt || driverPrompt(task, child, opts);
    const proc = spawn(argv[0], [...argv.slice(1), prompt], {
      cwd: child.cwd,
      env,
      detached: true,
      // stdin must be closed, not inherited: a nested `claude -p` waits forever on the parent's.
      stdio: ['ignore', out, err],
    });
    // Held only for this process's lifetime, and only useful while it is: a restart across an
    // MCP server restart has no exit code to record, which is fine - the stderr tail already
    // carries the evidence.
    try {
      proc.on('exit', (code, signal) => {
        try { appendFileSync(exitFile, JSON.stringify({ code, signal, at: Date.now() }) + '\n'); } catch { /* best-effort */ }
      });
    } catch { /* best-effort */ }
    proc.unref();
    return { pid: proc.pid || null, started_at: Date.now(), log, stderr, exit: exitFile, command };
  } catch (e) {
    return { pid: null, started_at: Date.now(), log, stderr, exit: exitFile, command, error: String((e && e.message) || e) };
  } finally {
    for (const fd of [out, err]) { try { if (fd !== null) closeSync(fd); } catch { /* already closed */ } }
  }
}

function driverAlive(driver) {
  if (!driver || !driver.pid) return false;
  try {
    process.kill(driver.pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists and is not ours to signal. Anything else: it is gone.
    return !!(e && e.code === 'EPERM');
  }
}

function killDriver(driver) {
  if (!driverAlive(driver)) return false;
  // detached:true made it a group leader, so the whole subtree goes. Best effort either way.
  try { process.kill(-driver.pid, 'SIGTERM'); return true; } catch { /* fall through */ }
  try { process.kill(driver.pid, 'SIGTERM'); return true; } catch { return false; }
}

function driverStderrTail(driver, chars = 300) {
  if (!driver || !driver.stderr) return '';
  try {
    if (!statSync(driver.stderr).size) return '';
    return readFileSync(driver.stderr, 'utf8').slice(-chars).trim();
  } catch {
    return '';
  }
}

// The exit code/signal recorded by spawnChildDriver's own 'exit' listener, if this server
// process was still alive to hear it. null when unknown - a restart across server processes,
// or a driver still starting up.
function driverExitInfo(driver) {
  if (!driver || !driver.exit) return null;
  try {
    if (!existsSync(driver.exit)) return null;
    const lines = readFileSync(driver.exit, 'utf8').trim().split('\n').filter(Boolean);
    if (!lines.length) return null;
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

// Reads the driver's own stdout stream (NDJSON, `claude -p --output-format stream-json`) for
// its last `result` event, and returns that text only when it names a usage limit - the same
// pattern scripts/bench/drive.sh uses to tell a spent quota from an ordinary ending. A death
// with this text set is not the package's failure and must not spend a restart.
function driverUsageLimitText(driver) {
  if (!driver || !driver.log) return '';
  try {
    if (!existsSync(driver.log)) return '';
    const lines = readFileSync(driver.log, 'utf8').split('\n');
    let last = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e && e.type === 'result') last = e;
    }
    const text = last && typeof last.result === 'string' ? last.result : '';
    return /hit your [a-z0-9-]+ limit/i.test(text) ? text : '';
  } catch {
    return '';
  }
}

// The next spawn's attempt number for this child, for a unique log filename - shared by a
// budget restart and a reset_capacity restart so the two schemes never collide on one.
function nextSpawnAttempt(child) {
  const n = (Number.isInteger(child.spawn_count) ? child.spawn_count : 0) + 1;
  child.spawn_count = n;
  return n;
}

// Called on every tm_next poll (and defensively from foldChild) for a package whose driver is
// no longer alive while its child run is still `running`. Distinguishes three cases:
//   - the driver died because a usage limit was hit: park it on `waiting_capacity`, spend no
//     restart, and wait for tm_retry({reset_capacity:true}).
//   - the driver died for any other reason and the restart budget is not spent: respawn a
//     driver on the SAME run_id with a resume prompt, and record the death on driver.restarts.
//   - the budget is spent: do nothing and let the dispatch fold blocked with every tail.
// Returns true when it changed anything (so the caller knows to persist the task).
function serviceDeadDriver(task, child, nodeId) {
  const driver = child.driver;
  if (!driver || driverAlive(driver)) return false;
  const run = loadRun(child.cwd, child.run_id);
  const cs = run ? runState(run) : { state: 'missing' };
  if (cs.state !== 'running') return false; // the run finished; an ordinary fold reads that
  if (child.waiting_capacity) return false; // already parked; reset_capacity is the way out
  const tail = driverStderrTail(driver, 2000);
  const usage = driverUsageLimitText(driver);
  const entry = { pid: driver.pid, exit: driverExitInfo(driver), at: Date.now(), stderr_tail: (usage || tail).slice(-300) };
  if (usage) {
    child.waiting_capacity = { reason: usage.slice(0, 500), since: Date.now() };
    record(task, { event: 'child_driver_capacity', task_id: task.run_id, node_id: nodeId, pid: driver.pid, reason: usage.slice(0, 300) });
    return true;
  }
  const budget = Number.isInteger(task.driver_restarts) ? task.driver_restarts : 2;
  const priorRestarts = driver.restarts || [];
  if (priorRestarts.length >= budget) return false; // budget spent: fold it, do not respawn again
  const restarts = [...priorRestarts, entry];
  const fresh = spawnChildDriver(task, nodeId, child, { resume: true, attempt: nextSpawnAttempt(child) });
  fresh.restarts = restarts;
  child.driver = fresh;
  record(task, { event: 'child_driver_restarted', task_id: task.run_id, node_id: nodeId, pid: fresh.pid, restart: restarts.length, budget });
  return true;
}

// ---------- the TaskLeader driver ----------
//
// tm_open no longer hands the opening session a manager loop to run: it spawns a second headless
// session - the TaskLeader - that runs references/manager.md's loop (tm_next/tm_submit/tm_retry)
// on this task_id until it is complete or blocked, exactly the way a package's own driver runs
// the graph loop on a child run. The opening session only watches: tm_status for state, tm_events
// for what happened, and a best-effort SendMessage from the leader on every change.
//
// A mutating call from anyone other than the leader process itself is queued to an inbox instead
// of applied directly, and the leader drains it at the top of its own tm_next - the same
// recursion-by-process rule Task 11's block comment gives child drivers, extended one level up.

function leaderPrompt(task, opts = {}) {
  return [
    `You are the TaskLeader of graph-beta task ${task.run_id} at cwd ${task.cwd}. The task is already open: Do not call tm_open.`,
    `Use the graph-beta:orchestrate skill and read references/manager.md; run its loop with tm_next / tm_submit / tm_retry on this task_id`,
    `until tm_status reports complete or blocked, or the report node has run. A fresh agent for every ready manager node, its JSON relayed verbatim.`,
    `You never do a node's work yourself, never edit project files, never open a child run by hand.`,
    opts.resume ? `A previous leader for this task died; call tm_status first and resume from what is already done - do not redo a done node.` : '',
    task.notify ? `On every state change, if ListAgents lists "${task.notify}", SendMessage it one line: task_id, phase, state, and what changed. If the tool or the name is missing, skip silently and never wait for it.`
                : `On every state change, if the session that opened this task is listed by ListAgents, SendMessage it one line: task_id, phase, state, and what changed. If session messaging is unavailable, skip silently and never wait for it.`,
    `End with the skill's output template.`,
  ].filter(Boolean).join(' ');
}
function isLeaderProcess(task) { return process.env.HARNESS_LEADER_OF === task.run_id; }
function leaderAlive(task) { return !!(task.leader && driverAlive(task.leader)); }

function spawnLeader(task, opts = {}) {
  const attempt = task.leader ? (task.leader.spawn_count || 0) : 0;
  const d = spawnChildDriver(task, 'leader', { cwd: task.cwd, run_id: task.run_id }, { attempt, prompt: leaderPrompt(task, opts), env: { HARNESS_LEADER_OF: task.run_id } });
  task.leader = { ...d, spawn_count: attempt + 1, restarts: task.leader ? (task.leader.restarts || 0) + (opts.resume ? 1 : 0) : 0, exhausted: false };
  record(task, { event: opts.resume ? 'leader_restarted' : 'leader_spawned', task_id: task.run_id, pid: d.pid, log: d.log, ...(d.error ? { error: d.error } : {}) });
}

// Called at the top of every tm_* entry. The main session never drives; it re-raises the leader.
function serviceLeader(task) {
  if (noLeader() || !task.leader || isLeaderProcess(task)) return false;
  const st = runState(task).state;
  if (st === 'complete' || st === 'blocked') return false;
  if (driverAlive(task.leader)) return false;
  if (task.leader.exhausted) return false;
  if ((task.leader.restarts || 0) >= task.driver_restarts) {
    task.leader.exhausted = true;
    record(task, { event: 'leader_exhausted', task_id: task.run_id, restarts: task.leader.restarts, stderr: driverStderrTail(task.leader) });
    saveRun(task);
    return true;
  }
  spawnLeader(task, { resume: true });
  saveRun(task);
  return true;
}

// A tool call that mutates the task, made by a process that is not the leader while a leader is
// alive, is queued here instead of applied - the leader drains it at the top of its own tm_next.
const MUTATING_TOOLS = new Set(['tm_submit', 'tm_retry', 'tm_settle', 'tm_repackage', 'tm_repair', 'tm_reset_capacity']);
let inboxSeq = 0;
function queueToInbox(task, tool, args) {
  const dir = join(taskDir(task.run_id), 'inbox');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${Date.now()}-${String(++inboxSeq).padStart(4, '0')}-${tool}.json`);
  writeFileSync(path, JSON.stringify({ tool, args, ts: Date.now(), from_pid: process.pid }) + '\n');
  record(task, { event: 'inbox_queued', task_id: task.run_id, tool, path });
  return { queued: true, task_id: task.run_id, tool, inbox_path: path, applied_by: 'the leader on its next tm_next', leader: { pid: task.leader.pid, alive: leaderAlive(task) } };
}
function drainInbox(task) {
  const dir = join(taskDir(task.run_id), 'inbox');
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { return 0; }
  let applied = 0;
  for (const f of files) {
    const path = join(dir, f);
    let req;
    try { req = JSON.parse(readFileSync(path, 'utf8')); } catch { mkdirSync(join(dir, 'failed'), { recursive: true }); try { writeFileSync(join(dir, 'failed', f), readFileSync(path)); rmSync(path); } catch { /* best-effort */ } continue; }
    try {
      callTool(req.tool, { ...req.args, task_id: task.run_id });
      record(task, { event: 'inbox_applied', task_id: task.run_id, tool: req.tool, path });
      applied++;
    } catch (e) {
      record(task, { event: 'inbox_failed', task_id: task.run_id, tool: req.tool, path, error: String((e && e.message) || e) });
      mkdirSync(join(dir, 'failed'), { recursive: true });
      try { writeFileSync(join(dir, 'failed', f), readFileSync(path)); } catch { /* best-effort */ }
    }
    try { rmSync(path); } catch { /* best-effort */ }
  }
  return applied;
}

// Executed by the server the moment the node is ready. The model never opens a run.
function openChild(task, n) {
  const pkg = packageOf(task, n.subgoal_id);
  if (!pkg) {
    n.state = 'failed';
    n.result = { stage_ok: false, reason: `no package ${n.subgoal_id} in the shape` };
    return;
  }
  // A package that depends on others starts from what they delivered: its tree is branched
  // from the first dependency's branch and the rest are merged in. A conflict between two
  // dependencies here is the same fact integration would find later, found earlier.
  const depBranches = (pkg.deps || []).map((d) => deliveredBranch(task, d)).filter(Boolean);
  // A repair package is the exception: its tree is the integration tree of the integrate it
  // repairs, already holding every package's work. Nothing is created and nothing is merged.
  const wt = pkg.repair
    ? repairWorktree(task, pkg)
    : ensureWorktree(task, String(pkg.id), depBranches[0] || 'HEAD');
  if (!wt.ok) {
    n.state = 'failed';
    n.result = { stage_ok: false, reason: `could not create a worktree for ${pkg.id}: ${wt.reason}` };
    record(task, { event: 'dispatch_failed', task_id: task.run_id, node_id: n.node_id, reason: n.result.reason });
    return;
  }
  const based_on = [];
  if (wt.created) {
    if (depBranches[0]) based_on.push(depBranches[0]);
    for (const b of depBranches.slice(1)) {
      const m = mergeInto(wt.path, b, `harness: base ${pkg.id} on ${b}`);
      if (!m.ok) {
        const merged = (pkg.deps || []).filter((d) => based_on.includes(deliveredBranch(task, d)));
        const culprit = (pkg.deps || []).find((d) => deliveredBranch(task, d) === b);
        n.state = 'failed';
        n.result = {
          stage_ok: false, accept: false, conflicts: m.conflicts,
          conflicting_packages: [String(culprit), ...merged.map(String)],
          reason: `dependencies of ${pkg.id} conflict with each other on ${m.conflicts.join(', ')} (${culprit} against ${merged.join(', ')}); repackage them`,
        };
        record(task, { event: 'dispatch_failed', task_id: task.run_id, node_id: n.node_id, reason: n.result.reason });
        return;
      }
      based_on.push(b);
    }
  }
  const flow = FLOWS[pkg.flow] ? pkg.flow : (task.flow_chosen && FLOWS[task.flow_chosen] ? task.flow_chosen : 'auto');
  const child = createRun({
    ...task.child_opts,
    cwd: wt.path,
    request: [String(pkg.brief), n.feedback ? `\n\nPrevious attempt of this package was rejected - fix this:\n${n.feedback}` : ''].join(''),
    context: childContext(task, pkg),
    isolated: true,
    flow,
    mixed: true,
  });
  n.state = 'running';
  n.started_at = Date.now();
  n.child = { cwd: wt.path, run_id: child.run_id, branch: wt.branch, flow, based_on };
  record(task, { event: 'dispatch', task_id: task.run_id, node_id: n.node_id, child_run_id: child.run_id, cwd: wt.path, branch: wt.branch });
  if (!noDriver()) {
    n.child.spawn_count = 0; // the first spawn gets no filename suffix; a respawn starts at 1
    const driver = spawnChildDriver(task, n.node_id, n.child);
    n.child.driver = driver;
    record(task, {
      event: 'child_driver_spawned', task_id: task.run_id, node_id: n.node_id, child_run_id: child.run_id,
      pid: driver.pid, cwd: n.child.cwd, log: driver.log, command: driver.command,
      ...(driver.error ? { error: driver.error } : {}),
    });
  }
}

// The child's account, read from its file. This is the only place the manager touches a
// run file, and it only reads.
function foldChild(task, n) {
  const child = loadRun(n.child.cwd, n.child.run_id);
  if (!child) return { stage_ok: false, reason: `child run ${n.child.run_id} has no file under ${n.child.cwd}` };
  const cs = runState(child);
  const goalGate = child.nodes.filter((x) => x.stage === 'gate' && x.subgoal_id === null && x.result).pop();
  const report = child.nodes.filter((x) => x.stage === 'report' && x.state === 'done' && x.result).pop();
  const changed = [...new Set(child.nodes.flatMap((x) => (x.result && Array.isArray(x.result.changed_files) ? x.result.changed_files : [])))];
  const g = (goalGate && goalGate.result) || {};
  const base = {
    child_run_id: child.run_id,
    child_cwd: n.child.cwd,
    branch: n.child.branch,
    child_state: cs.state,
    child_counts: cs.counts,
    changed_files: changed,
    report: report ? String(report.result.handoff || '') : '',
  };
  if (cs.state === 'running') {
    // A direct tm_submit (skipping tm_next) still gets the same dead-driver handling tm_next
    // gives it on every poll: respawn on the same run_id, or park on capacity, before ever
    // folding blocked. Persist first - this throws on every branch but the last.
    if (n.child.driver && !driverAlive(n.child.driver) && serviceDeadDriver(task, n.child, n.node_id)) saveRun(task);
    const driver = n.child.driver || null;
    if (n.child.waiting_capacity) {
      throw new Error(`dispatch ${n.node_id}: child run ${n.child.run_id} is waiting on provider capacity `
        + `(${n.child.waiting_capacity.reason}). Tell the user the reset time and stop; `
        + `tm_retry({task_id, package_id: "${n.subgoal_id}", reset_capacity: true}) resumes it once capacity is back.`);
    }
    if (!driver || driverAlive(driver)) {
      throw new Error(`dispatch ${n.node_id}: child run ${n.child.run_id} is still running (${JSON.stringify(cs.counts)}). `
        + (driver
          ? `Its driver process (pid ${driver.pid}) is still working; wait and poll tm_next, then submit this node again.`
          : `Drive it with graph_next/graph_run/graph_submit at cwd ${n.child.cwd}, then submit this node again.`));
    }
    // The driver died with the run unfinished and the restart budget (serviceDeadDriver already
    // tried) is spent. That is not a verdict about the package, but it is an honest end for
    // this attempt: fold it as blocked, with every attempt's stderr, so tm_retry can open the
    // next one in the same worktree.
    const restarts = driver.restarts || [];
    const tail = driverStderrTail(driver);
    const tails = [...restarts.map((r) => r.stderr_tail).filter(Boolean), tail].filter(Boolean);
    return {
      ...base, stage_ok: false, accept: false, gaps: g.gaps || [], match_pct: g.match_pct,
      child_state: 'running',
      driver: { pid: driver.pid, log: driver.log, stderr: driver.stderr },
      driver_restarts: restarts,
      driver_stderr: tails.join(' | '),
      reason: `child driver exited (pid ${driver.pid}) after ${restarts.length} restart(s) with the run still running (${JSON.stringify(cs.counts)})`
        + (tails.length ? `: ${tails.join(' | ')}` : ''),
    };
  }
  if (cs.state === 'blocked') {
    // The child stopped short of a report. Whatever its goal gate said is still the best
    // account of why, and is what a retried package needs to hear.
    return {
      ...base, stage_ok: false, accept: false, gaps: g.gaps || [], match_pct: g.match_pct,
      reason: `child run ended blocked${g.reason ? `: ${g.reason}` : ''} (${JSON.stringify(cs.counts)})`,
    };
  }
  // An accepted child's work becomes a commit on the package branch, so a dependent package
  // and the integration can start from it. A rejected child's tree is left as it is - the
  // retry continues there.
  let commit = null;
  if (g.accept === true) {
    const c = commitWorktree(n.child.cwd, `harness: package ${n.subgoal_id} attempt ${n.attempt || 1} (${child.run_id})`);
    if (!c.ok) return { ...base, stage_ok: false, accept: false, reason: `child passed but its worktree could not be committed: ${c.reason}` };
    commit = c.commit;
  }
  return {
    ...base,
    commit,
    stage_ok: true,
    accept: g.accept === true,
    match_pct: g.match_pct,
    gaps: g.gaps || [],
    observations: g.observations || [],
    spec_drift: g.spec_drift || [],
    reason: g.accept === true ? '' : (g.reason || 'child goal gate did not accept'),
    evidence: `child ${child.run_id}: ${cs.counts.done} done, ${cs.counts.failed} failed, ${cs.counts.unreachable} unreachable`,
  };
}

function prepareIntegration(task, n) {
  const round = Number(String(n.node_id).split(':')[1] || 1);
  // After an accepted repair, this round starts FROM the repaired integration branch and
  // merges nothing: that branch already is every package branch merged, plus the repair. The
  // seam was fixed in the combined tree, and re-merging from HEAD would recreate it.
  const repair = repairBase(task, n);
  const wt = ensureWorktree(task, round === 1 ? 'integration' : `integration-${round}`, repair ? repair.branch : 'HEAD');
  if (!wt.ok) {
    n.state = 'failed';
    n.result = { stage_ok: false, verified: false, reason: `could not create the integration worktree: ${wt.reason}` };
    return;
  }
  const merged = repair ? [{ package: repair.package, branch: repair.branch, commit: repair.commit }] : [];
  const ordered = dependencyOrder((task.spec.packages || []).filter((p) => !p.repair));
  for (const p of ordered) {
    const branch = deliveredBranch(task, p.id);
    if (!branch) {
      n.state = 'failed';
      n.result = { stage_ok: false, verified: false, reason: `package ${p.id} has no delivered branch to merge` };
      return;
    }
    // A package branch the repair was made on is already in this tree. Only one delivered
    // since - a retry that landed while the repair ran - is outside it, and it is merged in
    // dependency order like any other.
    if (repair && containsBranch(wt.path, branch)) continue;
    const m = mergeInto(wt.path, branch, `harness: integrate ${p.id} (${branch})`);
    if (!m.ok) {
      const owners = ownersOf(ordered.filter((q) => merged.some((x) => x.package === String(q.id))), m.conflicts);
      n.state = 'failed';
      n.result = {
        stage_ok: false, verified: false,
        integration_branch: wt.branch, merged: merged.map((x) => `${x.package} ${x.branch} -> ${x.commit}`),
        conflicts: m.conflicts,
        conflicting_packages: [String(p.id), ...owners],
        reason: `merge of ${p.id} conflicts on ${m.conflicts.join(', ')}`
          + (owners.length ? ` with ${owners.join(', ')} (by declared touches)` : ' with an already merged package none of them declared')
          + `; tm_retry({repackage: [${[String(p.id), ...owners].map((x) => `"${x}"`).join(', ')}]}) reshapes them together`,
      };
      record(task, { event: 'integrate_conflict', task_id: task.run_id, node_id: n.node_id, conflicts: m.conflicts, packages: n.result.conflicting_packages });
      return;
    }
    merged.push({ package: String(p.id), branch, commit: m.commit });
  }
  n.integration = { cwd: wt.path, branch: wt.branch, merged, ...(repair ? { based_on: 'repair', repair_package: repair.package } : {}) };
  record(task, { event: 'integrated', task_id: task.run_id, node_id: n.node_id, merged: merged.length, ...(repair ? { based_on: 'repair' } : {}) });
}

// ---------- briefings ----------

function briefingPath(task, n) {
  return join(taskDir(task.run_id), 'briefings', `${n.node_id.replace(/[^A-Za-z0-9._-]/g, '_')}.md`);
}

function composeTaskPrompt(task, n) {
  const L = [];
  L.push(`# ${n.stage} node ${n.node_id} (task manager)`);
  L.push('');
  L.push(`Project directory: ${task.cwd}`);
  L.push(MUTATING.has(n.stage)
    ? `You may run commands and change files only inside the integration worktree named below.`
    : `This is a reasoning node. Read what you need under the project directory; do not modify project files.`);
  L.push('');
  L.push(`You ARE this node of the task manager. Do the stage work directly with your own tools.`);
  L.push(`Do not re-enter the harness from inside it: no graph_open, no tm_open, no broker or adapter call.`);
  L.push(`Child runs are opened and driven around you, never by you.`);
  L.push('');
  L.push(`## Request`);
  L.push(task.request);
  if (task.context) { L.push(''); L.push(`## Context from the requester`); L.push(task.context); }
  if (task.size || task.flow_chosen || task.flow !== 'auto') {
    L.push('');
    L.push(`## Sizing`);
    if (task.size) L.push(`size: ${task.size}`);
    L.push(`flow: ${task.flow !== 'auto' ? `${task.flow} (fixed by the entry)` : task.flow_chosen ? `${task.flow_chosen} (chosen by size)` : 'auto'}`);
  }
  if (task.spec && ['critique', 'integrate', 'gate', 'report'].includes(n.stage)) {
    L.push('');
    L.push(`## Goal-level acceptance`);
    L.push(bullets(task.spec.acceptance));
    L.push('');
    L.push(`## Packages`);
    for (const p of task.spec.packages || []) {
      L.push(`### ${p.id} — ${p.title}${p.flow ? ` (${p.flow})` : ''}`);
      if ((p.deps || []).length) L.push(`Depends on: ${p.deps.join(', ')}`);
      if ((p.touches || []).length) L.push(`Touches: ${p.touches.join(', ')}`);
      // Shown so critique can attack the method the same way it attacks the split: a package
      // handed a skill that fits nothing it does is a defect in the shape, not in the child.
      if (packageSkills(p).length) L.push(`Method: ${packageSkills(p).join(', ')}`);
      L.push(`Acceptance:`);
      L.push(bullets(p.acceptance));
      const d = task.nodes.filter((x) => x.subgoal_id === String(p.id) && x.stage === 'dispatch' && x.result).pop();
      if (d && d.result) L.push(`Branch: ${d.result.branch || '?'} · child ${d.result.child_run_id || '?'} · ${d.state}${d.result.accept === undefined ? '' : ` accept=${d.result.accept}`}`);
      L.push('');
    }
  }
  if (n.stage === 'accept') {
    const pkg = packageOf(task, n.subgoal_id);
    const d = task.nodes.find((x) => x.subgoal_id === n.subgoal_id && x.stage === 'dispatch' && (x.attempt || 1) === (n.attempt || 1));
    if (pkg) {
      L.push('');
      L.push(`## Package ${pkg.id} — ${pkg.title}`);
      L.push(`Acceptance:`);
      L.push(bullets(pkg.acceptance));
      if ((pkg.touches || []).length) L.push(`Touches: ${pkg.touches.join(', ')}`);
    }
    if (d && d.result) {
      const r = d.result;
      L.push('');
      L.push(`## What the child run delivered`);
      L.push(`child run ${r.child_run_id} at ${r.child_cwd} on branch ${r.branch} — ${r.child_state}`);
      L.push(`Its goal gate: accept=${r.accept} match=${r.match_pct === undefined ? '?' : r.match_pct + '%'}`);
      if ((r.gaps || []).length) L.push(`Gaps it named:\n${bullets(r.gaps)}`);
      if ((r.spec_drift || []).length) L.push(`Spec drift it named:\n${bullets(r.spec_drift)}`);
      if ((r.changed_files || []).length) L.push(`Files it reported changing:\n${bullets(r.changed_files)}`);
      L.push(`Its report:`);
      L.push(r.report || '(no report)');
      L.push('');
      L.push(`Verify in the worktree at ${r.child_cwd}. The report is a claim; the tree is the evidence.`);
    }
  }
  if (n.stage === 'integrate' && n.integration) {
    L.push('');
    L.push(`## Integration worktree`);
    L.push(`${n.integration.cwd} on branch ${n.integration.branch}, created from ${n.integration.based_on === 'repair' ? `the repaired integration branch of package ${n.integration.repair_package}` : `the project's HEAD`}.`);
    L.push(`Already merged, in dependency order:`);
    L.push(bullets((n.integration.merged || []).map((m) => `${m.package}: ${m.branch} -> ${m.commit}`)));
    L.push(`Run the goal-level checks there. Read the seams: where one package's output meets another's input.`);
  }
  if (['gate', 'report'].includes(n.stage)) {
    L.push('');
    L.push(`## Every node in this task`);
    L.push(`Judge from these facts. A node that failed, was skipped, or became unreachable is part of the outcome.`);
    for (const x of task.nodes) {
      if (!x.result || x.node_id === n.node_id) continue;
      const r = x.result;
      const v = [x.state,
        r.accept === undefined ? '' : `accept=${r.accept}`,
        r.verified === undefined ? '' : `verified=${r.verified}`,
        r.sound === undefined ? '' : `sound=${r.sound}`,
        r.match_pct === undefined ? '' : `match=${r.match_pct}%`].filter(Boolean).join(' ');
      L.push(`### ${x.node_id} (${x.stage}) — ${v}`);
      if (r.branch) L.push(`Branch: ${r.branch}${r.commit ? ` @ ${r.commit}` : ''}`);
      if (r.integration_branch) L.push(`Integration branch: ${r.integration_branch}`);
      if ((r.merged || []).length) L.push(`Merged:\n${bullets(r.merged)}`);
      if ((r.conflicts || []).length) L.push(`Conflicts:\n${bullets(r.conflicts)}`);
      if ((r.conflicting_packages || []).length) L.push(`Conflicting packages: ${r.conflicting_packages.join(', ')}`);
      if ((r.checks || []).length) L.push(`Checks:\n${bullets(r.checks)}`);
      if (r.handoff) L.push(r.handoff);
      if (r.report) L.push(r.report);
      if (r.evidence) L.push(`Evidence: ${r.evidence}`);
      const gaps = r.gaps || [...(r.blocking || []), ...(r.problems || [])];
      if (gaps.length) L.push(`Gaps:\n${bullets(gaps)}`);
      if (r.reason) L.push(`Reason: ${r.reason}`);
      L.push('');
    }
  }
  if (n.stage === 'shape' || n.stage === 'critique') {
    const size = task.nodes.filter((x) => x.stage === 'size' && x.result).pop();
    if (size && size.result) {
      L.push('');
      L.push(`## From size`);
      if ((size.result.sizing || []).length) L.push(`Measured:\n${bullets(size.result.sizing)}`);
      if (size.result.handoff) L.push(size.result.handoff);
    }
    const shape = n.stage === 'critique' ? task.nodes.filter((x) => x.stage === 'shape' && x.result && x.state === 'done').pop() : null;
    if (shape && shape.result && shape.result.handoff) { L.push(''); L.push(`## From shape`); L.push(shape.result.handoff); }
  }
  const skills = stageSkills(task, n);
  if (skills.length) {
    L.push('');
    L.push(`## Method`);
    L.push(`Load these skills first and work the way they say, each one that is available to you:`);
    L.push(bullets(skills));
    L.push(`A skill that is not installed here is simply skipped - do not look for a substitute, and never stop to report a missing one.`);
    L.push(`Two rules outrank everything a skill says. Its output template does not apply: the "Required output" below is the only shape you may return. And its "what you do / what I do" half does not apply: nobody is reading this but the machine that called you, so ask no questions, offer no choices, and finish the work yourself.`);
    L.push(`List in "skills_used" the ones you actually loaded, or ["none"].`);
  }
  if (n.feedback) {
    L.push('');
    L.push(`## Previous attempt was rejected — fix this`);
    L.push(n.feedback);
  }
  L.push('');
  L.push(`## Required output`);
  L.push(n.node_id.startsWith('gate:goal') ? CONTRACT['gate:goal'] : CONTRACT[n.stage]);
  L.push('');
  L.push(`Return that JSON object and nothing else.`);
  return L.join('\n');
}

// ---------- verdicts ----------

function succeeded(task, n, result) {
  if (result.stage_ok !== true) return false;
  const f = VERDICT[n.stage];
  if (!f) return true;
  if (result[f] !== true) return false;
  // The manager's own goal gate is held to the same floor the graph engine holds its
  // goal gate to: accept:true at 40% match is reporting a partial result as a pass.
  // There is no per-package gate in the manager - every 'gate' node here IS the goal gate.
  if (n.stage === 'gate' && Number.isFinite(result.match_pct)) {
    const floor = Number.isInteger(task.goal_threshold) ? task.goal_threshold : 90;
    if (result.match_pct < floor) return false;
  }
  // A rejection needs no evidence of its own. A positive verdict does: dispatch's accept
  // is computed by the manager itself from the folded child and is exempt, but gate,
  // accept and integrate are judgements a fresh agent returned, and accept:true/verified:true
  // with nothing in checks[] is a guess wearing a verdict.
  if (['gate', 'accept', 'integrate'].includes(n.stage) && !(Array.isArray(result.checks) && result.checks.length > 0)) {
    return false;
  }
  return true;
}

function verdict(task, n) {
  const r = n.result || {};
  const out = {
    task_id: task.run_id,
    node_id: n.node_id,
    stage: n.stage,
    state: n.state,
    stage_ok: r.stage_ok === true,
  };
  const f = VERDICT[n.stage];
  if (f) out[f] = r[f] === true;
  if (n.stage === 'size' && r.size) { out.size = r.size; if (r.flow) out.flow = r.flow; }
  if (['accept', 'gate', 'dispatch'].includes(n.stage)) {
    if (r.match_pct !== undefined) out.match_pct = r.match_pct;
    out.gap_count = (r.gaps || []).length;
  }
  if (n.stage === 'dispatch' && n.child) out.child = { cwd: n.child.cwd, run_id: n.child.run_id, branch: n.child.branch, ...(r.commit ? { commit: r.commit } : {}) };
  if ((r.conflicting_packages || []).length) { out.conflicts = r.conflicts; out.conflicting_packages = r.conflicting_packages; }
  if (n.stage === 'integrate' && n.integration) out.integration = { cwd: n.integration.cwd, branch: n.integration.branch, merged: (n.integration.merged || []).length };
  if (n.state === 'failed' && r.stage_ok === true && f && r[f] === undefined) out.missing_verdict = f;
  const reason = String(r.reason || '');
  if (reason) out.reason = reason.slice(0, 300);
  return out;
}

function finish(task, n, result) {
  // The merges the manager made are part of the integrate node's account.
  if (n.stage === 'integrate' && n.integration) {
    result = { ...result, integration_branch: n.integration.branch, integration_cwd: n.integration.cwd,
      merged: (n.integration.merged || []).map((m) => `${m.package} ${m.branch} -> ${m.commit}`) };
  }
  const f = VERDICT[n.stage];
  const floor = Number.isInteger(task.goal_threshold) ? task.goal_threshold : 90;
  const belowFloor = n.stage === 'gate' && f && result[f] === true
    && Number.isFinite(result.match_pct) && result.match_pct < floor;
  const noEvidence = ['gate', 'accept', 'integrate'].includes(n.stage) && f && result[f] === true
    && !(Array.isArray(result.checks) && result.checks.length > 0);
  n.state = succeeded(task, n, result) ? 'done' : 'failed';
  if (n.state === 'failed' && belowFloor) {
    // The judging itself worked - it is the number that overrules the word, exactly as
    // the graph engine's own goal gate is held to its floor.
    result = { ...result, reason: `match_pct ${result.match_pct} below the goal threshold ${floor}` };
  } else if (n.state === 'failed' && noEvidence) {
    // A rejection needs no evidence of its own; a positive verdict does. This is the
    // manager's own judging failing to do its job, not a verdict on the work it judged.
    result = { ...result, stage_ok: false, reason: `${n.stage} returned a positive verdict without a check; a judgement with no evidence is a guess` };
  }
  n.result = result;
  n.finished_at = Date.now();

  if (n.stage === 'size' && n.state === 'done') {
    if (!['S', 'L'].includes(result.size)) {
      n.state = 'failed';
      n.result = { ...result, stage_ok: false, reason: 'size returned neither S nor L' };
    } else {
      task.size = result.size;
      if (task.flow === 'auto') task.flow_chosen = FLOWS[result.flow] ? result.flow : null;
    }
  }
  if (n.stage === 'shape' && n.state === 'done') {
    const problems = validateShape(result);
    if (problems.length) {
      n.state = 'failed';
      n.result = { ...result, stage_ok: false, shape_problems: problems, reason: `unusable shape: ${problems.join('; ')}` };
    } else {
      task.spec = { acceptance: result.acceptance, packages: result.packages.map((p) => ({ ...p, id: String(p.id) })) };
      expandPackages(task, task.spec.packages);
    }
  }
  saveRun(task);
  record(task, { event: 'node_finish', task_id: task.run_id, node_id: n.node_id, stage: n.stage, stage_ok: n.result.stage_ok === true, state: n.state });
  return verdict(task, n);
}

// ---------- tools ----------

const NEXT_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string' },
    state: { type: 'string', enum: ['running', 'blocked', 'complete', 'delegated'] },
    counts: { type: 'object' },
    size: { type: 'string', enum: ['S', 'L'] },
    flow: { type: 'string' },
    delegate: { type: 'object', description: 'size S: open this with graph_open instead; the task left nothing on disk' },
    ready: { type: 'array', items: { type: 'object', properties: {
      node_id: { type: 'string' }, stage: { type: 'string' }, briefing_path: { type: 'string' }, next: { type: 'string' },
    }, required: ['node_id', 'stage'] } },
    children: { type: 'array', description: 'running dispatch nodes and their child runs', items: { type: 'object', properties: {
      node_id: { type: 'string' }, package_id: { type: 'string' }, cwd: { type: 'string' }, run_id: { type: 'string' },
      branch: { type: 'string' }, child_state: { type: 'string' }, next: { type: 'string' },
    } } },
  },
  required: ['task_id', 'state'],
};

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string' }, node_id: { type: 'string' }, stage: { type: 'string' },
    state: { type: 'string', enum: ['pending', 'running', 'done', 'failed', 'skipped', 'unreachable'] },
    stage_ok: { type: 'boolean' },
    sound: { type: 'boolean' }, accept: { type: 'boolean' }, verified: { type: 'boolean' },
    size: { type: 'string' }, flow: { type: 'string' },
    match_pct: { type: 'number' }, gap_count: { type: 'number' },
    child: { type: 'object' }, integration: { type: 'object' }, conflicts: { type: 'array', items: { type: 'string' } },
    conflicting_packages: { type: 'array', items: { type: 'string' }, description: 'pass to tm_retry({repackage})' },
    missing_verdict: { type: 'string' }, reason: { type: 'string' },
    delegate: { type: 'object' },
  },
  required: ['task_id', 'node_id', 'stage', 'state', 'stage_ok'],
};

const TOOLS = [
  {
    name: 'tm_open',
    description: 'Open a task for a request that may be too large for one graph run. Builds size -> shape -> critique on disk under ~/.harness/tasks/<task_id>/ and returns the first ready node. If size comes back S the task opens that one graph run itself and drives it with its own headless session - poll tm_next for it like any child. The driving session never drives a run or the manager loop. Routing arguments are passed through to every child run.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' }, cwd: { type: 'string', description: 'the project root: child worktrees branch from its HEAD, and a size-S run under s_driver "process" opens directly here' },
        context: { type: 'string' },
        flow: { type: 'string', enum: ['auto', 'develop', 'document'] },
        vendor: { type: 'string' }, allocation: { type: 'string', enum: ['ordered', 'balanced'] },
        host_vendor: { type: 'string' }, host_model: { type: 'string' }, native_models: { type: 'array', items: { type: 'string' } },
        size: { type: 'string', enum: ['S', 'L'], description: 'Pin the size instead of measuring it: L when the user said in their own words that the request must be split into packages, S when they said one run must carry it. The size node is recorded as pinned.' },
        model: { type: 'string' }, policy: { type: 'object' }, candidates: { type: 'array', items: { type: 'string' } },
        skills: { description: 'Method per manager stage, overriding the defaults: {"shape": ["develop:domain-driven-design"], "critique": []}. false runs every stage on its contract alone. A skill named here must be analytic and non-dialogic - a node runs headless and cannot answer a skill that asks it something.' },
        sandbox: { type: 'string' }, max_retries: { type: 'number' },
        isolated: { type: 'boolean', description: 'Passed to the graph run this task opens (the single run of a size-S request, or each package child run). true only when you created or were handed a private worktree holding this run alone.' },
        mixed: { type: 'boolean', description: 'Passed the same way isolated is, to the same size-S run. Default true. false forbids the other kind of work entirely - a develop-flow request with a document subgoal fails at setgoal instead of quietly running one. Has no effect on an L task: every package is already mixed:true.' },
        driver_restarts: { type: 'integer', description: 'default 2: how many times a package or size-S driver that died mid-run is respawned on the SAME run_id before the dispatch folds blocked. A usage-limit death never spends this - it parks on waiting_capacity for tm_retry({reset_capacity:true}) instead.' },
        goal_threshold: { type: 'integer', description: 'default 90: the manager\'s own goal gate must report match_pct at or above this to accept, and it is passed through to every child run as its own goal_threshold. A gate that says accept with 40% match is reporting a partial result as a pass. 0 accepts on the verdict alone.' },
        notify: { type: 'string', description: 'agent/session name for the TaskLeader driver\'s one-line SendMessage progress updates, best-effort. Defaults to whoever ListAgents shows opened this task.' },
      },
      required: ['request', 'cwd'],
    },
    outputSchema: NEXT_SCHEMA,
  },
  {
    name: 'tm_next',
    description: 'Which manager nodes are ready, each with a briefing_path for a fresh agent, plus every running child as {cwd, run_id, driver}. A ready dispatch node is executed here and now: its worktree is created, its child graph run opened, and a headless driver process spawned to run that child to the end. Also where a dead driver is serviced: respawned on the same run_id (driver.restarts) if the budget allows, or parked on waiting_capacity after a usage-limit death - neither needs you to do anything but poll again. A size-S task under s_driver "process" has no manager nodes at all; tm_next instead returns {run_id, cwd, driver, nodes, report} for the one run it is driving, ready for the entry skill\'s output template once state is complete or blocked. Poll tm_next while a driver is alive; do not drive that child yourself. tm_submit the dispatch node once the child is no longer running.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    outputSchema: NEXT_SCHEMA,
  },
  {
    name: 'tm_submit',
    description: 'Record a manager node. For size/shape/critique/accept/integrate/gate/report pass the payload the fresh agent returned. For a dispatch node pass no payload: the manager reads the child run file and folds its goal-gate verdict and report into the node. Refused while the child is still running and its driver alive, or waiting_capacity (a usage-limit death; use tm_retry({reset_capacity:true})); a child whose driver died mid-run and spent its whole restart budget folds as blocked, with every attempt\'s stderr.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, node_id: { type: 'string' }, payload: { type: 'object' } },
      required: ['task_id', 'node_id'],
    },
    outputSchema: VERDICT_SCHEMA,
  },
  {
    name: 'tm_retry',
    description: 'Open a fresh attempt. With package_id: a new dispatch in the same worktree, carrying the rejection forward into the child request. With repackage: [ids] after an integration conflict, reshape with those packages told to become one or to depend on each other. With repair: true after an integrate came back verified=false with no conflicts: a repair package whose worktree IS the integration tree, for a seam no package can reproduce alone. With reset_capacity: true, clears every child (or just package_id\'s, or the size-S run) parked waiting_capacity after a usage-limit death and respawns its driver - this spends no restart. Without any of them: reshape (shape + critique) and discard the package graph. When the budget is gone the failure is settled and the report is released over the unreachable set.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, package_id: { type: 'string' }, repackage: { type: 'array', items: { type: 'string' }, description: 'the conflicting_packages an integrate or dispatch failure named' }, repair: { type: 'boolean', description: 'the last integrate failed with verified=false and no conflicts: open a package that runs IN the integration worktree, where every package branch is merged and the defect is visible. package_id: "integration" is an alias for it.' }, reset_capacity: { type: 'boolean', description: 'a driver is parked on waiting_capacity after a usage-limit death (see tm_next\'s children[].waiting_capacity, or the top-level one for a size-S task). Clears it and respawns a driver on the same run_id, spending no restart. Combine with package_id to target just that package.' } }, required: ['task_id'] },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' }, retried: { type: 'boolean' }, attempt: { type: 'number' }, resumed: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' }, unreachable: { type: 'array', items: { type: 'string' } } }, required: ['task_id', 'retried'] },
  },
  {
    name: 'tm_status',
    description: 'Compact task state: counts, per-node state and verdict, child pointers. Omit task_id to list every task the manager knows. full:true returns the whole task file - large by design.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, node_id: { type: 'string' }, full: { type: 'boolean' } } },
    outputSchema: { type: 'object' },
  },
  {
    name: 'tm_events',
    description: 'Tail the task ledger: what the manager and its drivers did, newest last. since: a ts to start after; limit: default 50. Read-only; safe from any session.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, since: { type: 'number' }, limit: { type: 'integer' } }, required: ['task_id'] },
    outputSchema: { type: 'object' },
  },
];

function toolEvents(a) {
  const task = mustFindTask(a);
  const since = Number(a.since) || 0;
  const limit = Number.isInteger(a.limit) && a.limit > 0 ? a.limit : 50;
  let lines = [];
  try { lines = readFileSync(join(taskDir(task.run_id), 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { lines = []; }
  const events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && e.ts > since);
  return { task_id: task.run_id, count: events.length, events: events.slice(-limit) };
}

function requireRunnable(task, nodeId) {
  const n = getNode(task, nodeId);
  if (!n) throw new Error(`unknown node ${nodeId}`);
  if (n.stage === 'dispatch') {
    if (n.state !== 'running') throw new Error(`dispatch ${n.node_id} is ${n.state}; only a running dispatch can be folded`);
    return n;
  }
  if (n.state !== 'pending') throw new Error(`node ${n.node_id} is ${n.state}, not pending`);
  const missing = unmetDeps(task, n);
  if (missing.length) throw new Error(`node ${n.node_id} is blocked on ${missing.join(', ')}`);
  return n;
}

function toolOpen(a) {
  const task = createTask(a);
  record(task, { event: 'tm_open', task_id: task.run_id, cwd: task.cwd, flow: task.flow, size_pinned: task.size_pinned });
  if (task.size_pinned) {
    const n = task.nodes.find((x) => x.node_id === 'size');
    const out = finish(task, n, {
      stage_ok: true, size: task.size_pinned, size_source: 'pinned', sizing: [],
      handoff: task.size_pinned === 'L'
        ? 'Size pinned L by the entry: the user said the request must be split into packages. Nothing was measured; shape decides the packages from the request and the tree.'
        : 'Size pinned S by the entry: the user said one run must carry it.',
      evidence: 'no measurement: pinned by the caller',
    });
    const delegated = delegateIfSmall(task, n, out);
    if (delegated) return delegated;
    saveRun(task);
  }
  if (!noLeader()) { spawnLeader(task); saveRun(task); }
  return { ...toolNext({ task_id: task.run_id }), leader: task.leader ? { pid: task.leader.pid, log: task.leader.log } : null };
}

// Size S, s_driver 'process' (the default): open the one graph run this request needs, in the
// project's own cwd - not a package worktree, there is no shape to make one - and spawn a
// driver for it the same way a package's dispatch does. task.s_run mirrors n.child.
function openSRun(task) {
  const flow = task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto');
  const child = createRun({
    ...task.child_opts,
    cwd: task.cwd,
    request: task.request,
    context: task.context || '',
    isolated: task.isolated === true,
    flow: FLOWS[flow] ? flow : 'auto',
    mixed: task.mixed !== false,
  });
  task.s_run = { cwd: task.cwd, run_id: child.run_id };
  excludeMarkers(task.cwd);
  touchMarker(task.cwd, task.run_id);
  record(task, { event: 's_open', task_id: task.run_id, run_id: child.run_id, cwd: task.cwd });
  if (!noDriver()) {
    task.s_run.spawn_count = 0;
    const driver = spawnChildDriver(task, 'S', task.s_run);
    task.s_run.driver = driver;
    record(task, {
      event: 'child_driver_spawned', task_id: task.run_id, node_id: 'S', child_run_id: child.run_id,
      pid: driver.pid, cwd: task.cwd, log: driver.log, command: driver.command,
      ...(driver.error ? { error: driver.error } : {}),
    });
  }
}

// Size S: this request needs no manager stage graph, only one run. The manager opens that run
// here and drives it with its own headless session; the task stays on disk only as the pointer
// to it, and the caller polls tm_next until the report arrives, exactly as it would for one L
// package. There is no shape in which the caller drives it instead.
function delegateIfSmall(task, n, out) {
  if (!(n.stage === 'size' && n.state === 'done' && task.size === 'S')) return null;
  for (const x of task.nodes) {
    if (x.node_id === 'size') continue;
    if (x.state === 'pending') { x.state = 'skipped'; x.result = { stage_ok: false, reason: 'size S: the single run is driven directly, with no shape/critique stages' }; }
  }
  openSRun(task);
  saveRun(task);
  return { ...out, task_state: 's_run', ...toolNext({ task_id: task.run_id }) };
}

// tm_next for a size-S task driven by s_driver 'process': there is no manager node graph to
// read readiness from, only the one run task.s_run points at. Shaped so the caller can fill
// the entry skill's output template - node/vendor/stage_ok/note, then the report - without
// ever opening a node payload itself.
function toolNextSRun(task) {
  const s = task.s_run;
  const run = loadRun(s.cwd, s.run_id);
  const cs = run ? runState(run) : { state: 'missing', counts: {} };
  if (cs.state === 'running' && s.driver && !driverAlive(s.driver)) {
    if (serviceDeadDriver(task, s, 'S')) saveRun(task);
  }
  const driver = s.driver || null;
  const out = {
    task_id: task.run_id,
    state: cs.state === 'running' ? 'running' : (cs.state === 'complete' ? 'complete' : 'blocked'),
    counts: cs.counts || {},
    ...(task.size ? { size: task.size } : {}),
    flow: task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'),
    run_id: s.run_id,
    cwd: s.cwd,
    ready: [],
    children: [],
  };
  if (driver) out.driver = { pid: driver.pid, alive: driverAlive(driver), log: driver.log, ...((driver.restarts || []).length ? { restarts: driver.restarts.length } : {}) };
  if (s.waiting_capacity) out.waiting_capacity = s.waiting_capacity;
  if (cs.state !== 'running') {
    out.nodes = run ? run.nodes.filter((x) => x.result).map((x) => ({
      node_id: x.node_id,
      stage: x.stage,
      vendor: (x.result && (x.result.vendor || x.result.executor)) || 'self',
      stage_ok: !!(x.result && x.result.stage_ok === true),
      note: String((x.result && (x.result.reason || x.result.evidence)) || '').slice(0, 140),
    })) : [];
    const report = run ? run.nodes.filter((x) => x.stage === 'report' && x.state === 'done' && x.result).pop() : null;
    out.report = report ? String(report.result.handoff || '') : '';
    out.next = 'this task is finished: relay the node table and the report to the requester, exactly as the entry skill\'s output template asks';
  } else if (s.waiting_capacity) {
    out.next = `waiting on provider capacity (${s.waiting_capacity.reason.slice(0, 160)}); tell the user the reset time and stop. tm_retry({task_id, reset_capacity:true}) resumes it`;
  } else if (driver && driverAlive(driver)) {
    out.next = `its driver process (pid ${driver.pid}) is running this run: wait; poll tm_next; do not drive it yourself`;
  } else if (driver) {
    const budget = Number.isInteger(task.driver_restarts) ? task.driver_restarts : 2;
    out.next = `driver died and the restart budget (${budget}) is spent; graph_status({run_id, cwd}) shows where it stopped, ; tm_retry({task_id}) gives it a fresh session where the dead one stopped`;
  } else {
    out.next = `drive it yourself with graph_next/graph_run/graph_submit at cwd ${s.cwd}, run_id ${s.run_id}`;
  }
  return out;
}

function toolNext(a) {
  const task = mustFindTask(a);
  // Refresh the shared engagement marker in every tree a live driver is working in, so the
  // harness gate's 2h window never closes on a long package (see engage.mjs).
  for (const n of task.nodes) {
    if (n.child && n.child.cwd && n.state === 'running') touchMarker(n.child.cwd, task.run_id);
  }
  if (task.s_run && task.s_run.cwd) touchMarker(task.s_run.cwd, task.run_id);
  if (task.s_run) return toolNextSRun(task);
  // Dispatch nodes run here, the moment they are ready. Doing it in tm_next rather than in
  // a separate call means the session cannot forget to, and cannot do it twice.
  let opened = 0;
  for (const n of readyNodes(task)) {
    if (n.stage !== 'dispatch') continue;
    openChild(task, n);
    opened++;
  }
  if (opened) saveRun(task);
  // Every running dispatch whose driver is no longer alive gets serviced here, on every poll:
  // respawned on the same run_id, or parked on capacity, before the caller ever sees it as
  // something to fold. Only a spent restart budget leaves it dead for the children[] map below.
  let serviced = 0;
  for (const n of task.nodes) {
    if (n.stage !== 'dispatch' || n.state !== 'running' || !n.child || !n.child.driver) continue;
    if (serviceDeadDriver(task, n.child, n.node_id)) serviced++;
  }
  if (serviced) saveRun(task);
  // Integration is mechanical up to the checks: the worktree and the merges are done here,
  // in dependency order, so a conflict is a fact the manager saw and not a claim a node made.
  for (const n of readyNodes(task)) {
    if (n.stage !== 'integrate' || n.integration) continue;
    prepareIntegration(task, n);
    saveRun(task);
  }
  const state = runState(task);
  const ready = readyNodes(task).map((n) => {
    const p = briefingPath(task, n);
    try { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, composeTaskPrompt(task, n)); } catch { /* status full is the fallback */ }
    return { node_id: n.node_id, stage: n.stage, briefing_path: p, next: 'dispatch briefing_path to a fresh native agent, then tm_submit' };
  });
  const budget = Number.isInteger(task.driver_restarts) ? task.driver_restarts : 2;
  const children = task.nodes.filter((n) => n.stage === 'dispatch' && n.state === 'running' && n.child).map((n) => {
    const child = loadRun(n.child.cwd, n.child.run_id);
    const childState = child ? runState(child).state : 'missing';
    const driver = n.child.driver || null;
    const alive = driverAlive(driver);
    const waiting = n.child.waiting_capacity || null;
    const restarts = (driver && driver.restarts) || [];
    const fold = `tm_submit({task_id, node_id: "${n.node_id}"})`;
    let next;
    if (childState !== 'running') next = fold;
    else if (!driver) next = `graph_next({run_id: "${n.child.run_id}", cwd: "${n.child.cwd}"}) and drive it; tm_submit this node when complete`;
    else if (waiting) next = `waiting on provider capacity (${waiting.reason.slice(0, 160)}); tell the user the reset time and stop. tm_retry({task_id, package_id: "${n.subgoal_id}", reset_capacity:true}) resumes it`;
    else if (alive) next = `its driver process (pid ${driver.pid}) is running this child: wait; poll tm_next; do not drive this child yourself`;
    else next = `driver died and the restart budget (${budget}) is spent: ${fold} folds it as blocked with every attempt's stderr, then tm_retry({package_id: "${n.subgoal_id}"}) reopens it (or reopen the task with child_driver "inline" to drive children yourself)`;
    return {
      node_id: n.node_id,
      package_id: n.subgoal_id,
      cwd: n.child.cwd,
      run_id: n.child.run_id,
      branch: n.child.branch,
      child_state: childState,
      ...(driver ? { driver: { pid: driver.pid, alive, log: driver.log, ...(restarts.length ? { restarts: restarts.length } : {}) } } : {}),
      ...(waiting ? { waiting_capacity: waiting } : {}),
      next,
    };
  });
  return {
    task_id: task.run_id,
    state: state.state,
    counts: state.counts,
    ...(task.size ? { size: task.size } : {}),
    flow: task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'),
    ready,
    children,
  };
}

function toolSubmit(a) {
  const task = mustFindTask(a);
  record(task, { event: 'tm_submit', task_id: task.run_id, node_id: String(a.node_id) });
  const n = requireRunnable(task, String(a.node_id));
  if (n.stage === 'dispatch') {
    if (a.payload && Object.keys(a.payload).length) throw new Error('a dispatch node takes no payload: the manager reads the child run itself');
    const result = foldChild(task, n);
    return finish(task, n, result);
  }
  const payload = a.payload || {};
  const result = { ...payload, stage_ok: payload.stage_ok !== false };
  const out = finish(task, n, result);
  return delegateIfSmall(task, n, out) || out;
}

function toolRetry(a) {
  const task = mustFindTask(a);
  // A driver parked waiting_capacity after a usage-limit death spent no restart; the way back
  // is not a retried package but a cleared wait, once the caller believes capacity is back.
  // Clears every waiting child (or just package_id's, or task.s_run for a size-S task) and
  // respawns its driver - none of that counts against driver_restarts.
  if (a.reset_capacity === true) {
    const resumed = [];
    if (task.s_run && task.s_run.waiting_capacity && (!a.package_id || String(a.package_id) === 'S')) {
      record(task, { event: 'child_driver_capacity_cleared', task_id: task.run_id, node_id: 'S', was: task.s_run.waiting_capacity });
      delete task.s_run.waiting_capacity;
      if (!noDriver()) {
        const restarts = (task.s_run.driver && task.s_run.driver.restarts) || [];
        const fresh = spawnChildDriver(task, 'S', task.s_run, { resume: true, attempt: nextSpawnAttempt(task.s_run) });
        fresh.restarts = restarts;
        task.s_run.driver = fresh;
        record(task, { event: 'child_driver_restarted', task_id: task.run_id, node_id: 'S', pid: fresh.pid, reason: 'reset_capacity' });
      }
      resumed.push('S');
    }
    for (const n of task.nodes) {
      if (n.stage !== 'dispatch' || n.state !== 'running' || !n.child || !n.child.waiting_capacity) continue;
      if (a.package_id && n.subgoal_id !== String(a.package_id)) continue;
      record(task, { event: 'child_driver_capacity_cleared', task_id: task.run_id, node_id: n.node_id, was: n.child.waiting_capacity });
      delete n.child.waiting_capacity;
      if (!noDriver()) {
        const restarts = (n.child.driver && n.child.driver.restarts) || [];
        const fresh = spawnChildDriver(task, n.node_id, n.child, { resume: true, attempt: nextSpawnAttempt(n.child) });
        fresh.restarts = restarts;
        n.child.driver = fresh;
        record(task, { event: 'child_driver_restarted', task_id: task.run_id, node_id: n.node_id, pid: fresh.pid, reason: 'reset_capacity' });
      }
      resumed.push(n.node_id);
    }
    saveRun(task);
    record(task, { event: 'tm_reset_capacity', task_id: task.run_id, resumed });
    return { task_id: task.run_id, retried: resumed.length > 0, resumed, reason: resumed.length ? '' : 'nothing in this task is waiting on provider capacity', ...toolNext({ task_id: task.run_id }) };
  }
  // Two children pass and the merge fails: that is nobody's failure but the shape's. The
  // packages that collided go back to shape as one instruction - make them one package, or
  // order them so the later one builds on the earlier - with the conflicting files as the
  // evidence. Worktrees of ids the new shape keeps are reused with their delivered commits.
  if (Array.isArray(a.repackage) && a.repackage.length) {
    const ids = a.repackage.map(String);
    const unknown = ids.filter((id) => !packageOf(task, id));
    if (unknown.length) throw new Error(`repackage names packages not in the shape: ${unknown.join(', ')}`);
    const failed = task.nodes.filter((n) => n.state === 'failed' && n.result && (n.result.conflicts || []).length).pop();
    const fb = [
      `Repackage ${ids.join(' and ')}: they conflicted at integration and cannot be independent packages.`,
      `Either shape them as ONE package, or make one depend on the other so it starts from the other's delivered branch.`,
      ...(failed ? [`Conflicting files: ${failed.result.conflicts.join(', ')}`, failed.result.reason || ''] : []),
      ...ids.map((id) => { const p = packageOf(task, id); return `${id} (${p.title}) declared touches: ${(p.touches || []).join(', ') || '(none)'}`; }),
      `Worktrees of package ids you keep are reused with the work they already delivered.`,
    ].filter(Boolean).join('\n- ');
    const out = retryShape(task, fb);
    record(task, { event: out.attempt ? 'tm_repackage' : 'tm_settle', task_id: task.run_id, packages: ids, attempt: out.attempt });
    return { task_id: task.run_id, target: 'shape', repackage: ids, retried: !!out.attempt, attempt: out.attempt || undefined, reason: out.reason, unreachable: out.unreachable, ...toolNext({ task_id: task.run_id }) };
  }
  // An integrate that refused over a seam has no package to blame: reopening one puts the child
  // back in its own worktree, where the offending claim is still true and the defect is not
  // reproducible. The repair package is the route out, and `package_id: "integration"` is the
  // alias for it because that is what the first real task to reach this wedge reached for.
  if (a.repair === true || (a.package_id != null && String(a.package_id) === 'integration')) {
    const target = integrateToRepair(task);
    if (target.error) throw new Error(target.error);
    const out = openRepair(task, target.node);
    record(task, { event: out.package_id ? 'tm_repair' : 'tm_settle', task_id: task.run_id, package_id: out.package_id, integrate: target.node.node_id });
    return { task_id: task.run_id, target: out.package_id || target.node.node_id, package_id: out.package_id || undefined, repair: true,
      repairs: target.node.node_id, retried: !!out.package_id, attempt: out.package_id ? 1 : undefined,
      reason: out.reason, unreachable: out.unreachable, ...toolNext({ task_id: task.run_id }) };
  }
  if (!a.package_id) {
    const source = task.nodes.filter((n) => (n.stage === 'critique' || n.stage === 'shape') && n.state === 'failed' && n.result).pop();
    const fb = source && source.result
      ? [source.result.reason || '', ...(source.result.blocking || []), ...(source.result.shape_problems || []), ...(source.result.problems || [])].filter(Boolean).join('\n- ')
      : '';
    const out = retryShape(task, fb);
    record(task, { event: out.attempt ? 'tm_retry' : 'tm_settle', task_id: task.run_id, target: 'shape', attempt: out.attempt });
    return { task_id: task.run_id, target: 'shape', retried: !!out.attempt, attempt: out.attempt || undefined, reason: out.reason, unreachable: out.unreachable, ...toolNext({ task_id: task.run_id }) };
  }
  const pid = String(a.package_id);
  // A package id the shape never named would open a phantom package with a dispatch that can
  // only fail. The first task to reach a failed integrate probed `package_id: "integrate"`.
  const known = ((task.spec && task.spec.packages) || []).map((p) => String(p.id));
  if (!known.includes(pid)) throw new Error(`no package ${pid} in the shape (packages: ${known.join(', ') || 'none yet'}); a failed integrate is retried through the package its checks blame, or reshaped with repackage`);
  const judged = task.nodes.filter((n) => n.subgoal_id === pid && n.result && (n.stage === 'accept' || n.state === 'failed'));
  const last = judged[judged.length - 1];
  const fb = last && last.result ? [last.result.reason || '', ...(last.result.gaps || [])].filter(Boolean).join('\n- ') : '';
  const out = retryPackage(task, pid, fb);
  record(task, { event: out.attempt ? 'tm_retry' : 'tm_settle', task_id: task.run_id, package_id: pid, attempt: out.attempt });
  return { task_id: task.run_id, target: pid, package_id: pid, retried: !!out.attempt, attempt: out.attempt || undefined, reason: out.reason, unreachable: out.unreachable, ...toolNext({ task_id: task.run_id }) };
}

function toolStatus(a) {
  if (!a.task_id) {
    let ids = [];
    try { ids = readdirSync(tasksRoot()); } catch { ids = []; }
    const tasks = ids.map((id) => loadRunAt(taskPath(id))).filter(Boolean)
      .sort((x, y) => (y.created_at || 0) - (x.created_at || 0))
      .map((t) => { const s = runState(t); return { task_id: t.run_id, cwd: t.cwd, state: s.state, counts: s.counts, size: t.size, request: String(t.request).slice(0, 160), created_at: new Date(t.created_at).toISOString() }; });
    return { root: tasksRoot(), tasks };
  }
  const task = mustFindTask(a);
  if (a.full) {
    if (a.node_id) { const n = getNode(task, String(a.node_id)); if (!n) throw new Error(`unknown node ${a.node_id}`); return { task_id: task.run_id, node: n }; }
    return task;
  }
  if (task.s_run) {
    const run = loadRun(task.s_run.cwd, task.s_run.run_id);
    const cs = run ? runState(run) : { state: 'missing', counts: {} };
    return {
      task_id: task.run_id,
      cwd: task.cwd,
      state: cs.state,
      counts: cs.counts,
      size: task.size,
      flow: task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'),
      s_run: { cwd: task.s_run.cwd, run_id: task.s_run.run_id,
        ...(task.s_run.driver ? { driver: { ...task.s_run.driver, alive: driverAlive(task.s_run.driver) } } : {}),
        ...(task.s_run.waiting_capacity ? { waiting_capacity: task.s_run.waiting_capacity } : {}) },
      packages: [],
      leader: task.leader ? { pid: task.leader.pid, alive: leaderAlive(task), log: task.leader.log, stderr: task.leader.stderr, spawn_count: task.leader.spawn_count, restarts: task.leader.restarts || 0, exhausted: !!task.leader.exhausted, stderr_tail: driverStderrTail(task.leader) } : null,
      team: task.team || null,
    };
  }
  const state = runState(task);
  return {
    task_id: task.run_id,
    cwd: task.cwd,
    state: state.state,
    counts: state.counts,
    size: task.size,
    flow: task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'),
    packages: task.spec ? task.spec.packages.map((p) => p.id) : [],
    nodes: task.nodes.filter((n) => (a.node_id ? n.node_id === a.node_id : true)).map((n) => (n.state === 'pending' || n.state === 'running'
      ? { node_id: n.node_id, stage: n.stage, state: n.state, deps: n.deps, after: n.after || [],
          ...(n.child ? { child: { ...n.child, ...(n.child.driver ? { driver: { ...n.child.driver, alive: driverAlive(n.child.driver) } } : {}) } } : {}) }
      : verdict(task, n))),
    leader: task.leader ? { pid: task.leader.pid, alive: leaderAlive(task), log: task.leader.log, stderr: task.leader.stderr, spawn_count: task.leader.spawn_count, restarts: task.leader.restarts || 0, exhausted: !!task.leader.exhausted, stderr_tail: driverStderrTail(task.leader) } : null,
    team: task.team || null,
  };
}

// ---------- JSON-RPC / MCP plumbing ----------

function callTool(name, args) {
  const a = args || {};
  // The TaskLeader gate: runs before every tool but tm_open (there is no task yet to gate).
  // Any dead leader is serviced here so it is respawned (or reported exhausted) on any tm_* call,
  // not just tm_next. While a leader is alive and this call is not from the leader process itself,
  // a mutating tool is queued to the inbox instead of applied, and tm_next reports the leader's
  // state instead of driving; the leader drains the inbox at the top of its OWN tm_next below.
  if (a.task_id && name !== 'tm_open') {
    const task = mustFindTask(a);
    serviceLeader(task);
    const watcher = !noLeader() && !isLeaderProcess(task) && task.leader && leaderAlive(task);
    if (watcher && MUTATING_TOOLS.has(name)) return queueToInbox(task, name, a);
    if (watcher && name === 'tm_next') {
      const st = runState(task);
      return {
        task_id: task.run_id, state: st.state, counts: st.counts, driven_by: 'leader',
        leader: { pid: task.leader.pid, alive: true, log: task.leader.log, restarts: task.leader.restarts },
        hint: 'the TaskLeader driver runs the loop; watch tm_status({task_id}) and tm_events({task_id})',
      };
    }
    if (name === 'tm_next' && (isLeaderProcess(task) || noDriver())) { const n = drainInbox(task); if (n) a.__inbox_applied = n; }
  }
  switch (name) {
    case 'tm_open': return toolOpen(a);
    case 'tm_next': return { ...toolNext(a), inbox_applied: a.__inbox_applied || 0 };
    case 'tm_submit': return toolSubmit(a);
    case 'tm_retry': return toolRetry(a);
    case 'tm_status': return toolStatus(a);
    case 'tm_events': return toolEvents(a);
    default: throw new Error('unknown tool: ' + name);
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params && typeof params.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
      });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      try {
        const out = callTool(params && params.name, params && params.arguments);
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: String((e && e.message) || e) }], isError: true });
      }
    }
    default:
      if (typeof id === 'undefined') return null;
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } };
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    let out;
    try { out = handle(msg); } catch (e) {
      out = typeof msg.id === 'undefined' ? null : { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String((e && e.message) || e) } };
    }
    if (out) emit(out);
  }
});
process.stdin.on('end', () => process.exit(0));
