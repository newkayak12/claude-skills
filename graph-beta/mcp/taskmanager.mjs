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

const SERVER = { name: 'task-manager', version: '0.6.0' };
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
  accept: `Return JSON: {"stage_ok": true, "skills_used": ["<skill or none>"], "accept": true|false, "match_pct": 0-100, "gaps": ["what the package did not deliver"], "observations": ["weaknesses that do not block"], "reason": "...", "evidence": "..."}
You are the judge, not the actor. The child run's own goal gate and report are below; judge them against THIS package's acceptance, which the child never saw in full. A child that passed its own gate but delivered less than the package asked for is a gap here. Absent evidence is a gap, not a pass.`,
  integrate: `Return JSON: {"stage_ok": true|false, "skills_used": ["<skill or none>"], "verified": true|false, "checks": ["command -> observed output"], "evidence": "..."}
The package branches are already merged into the integration worktree named below - the manager did that and recorded each merge commit. Your job is what no package could do alone: run the goal-level checks the shape's acceptance implies against the combined tree, and read the seams between packages. stage_ok=false when a check could not run at all. verified=false when the combined tree fails a check the packages passed separately. Do not fix package work here: a failing seam is a gap for the gate and a repackage for the manager.`,
  'gate:goal': `Return JSON: {"stage_ok": true, "skills_used": ["<skill or none>"], "accept": true|false, "match_pct": 0-100, "gaps": ["what blocks acceptance"], "observations": ["weaknesses that do not block"], "spec_drift": ["where the shape asked for less than the request did"], "reason": "...", "evidence": "..."}
You are the judge, not the actor, and the only node that sees the original request again. Judge the integrated result against BOTH the goal-level acceptance and the REQUEST as written. Anything the request asked for that no package delivered and no criterion named belongs in "spec_drift". Absent evidence is a gap, not a pass.`,
  report: `Return JSON: {"stage_ok": true, "handoff": "<the final report>", "evidence": "..."}
Synthesize from the node results below only: which packages ran, what each delivered, what the integration showed, what the gate said. State plainly what was not done and why.`,
};

function bullets(list) {
  return (list || []).map((x) => `- ${x}`).join('\n') || '- (none)';
}

// ---------- task creation ----------

function createTask(a) {
  const cwd = resolve(String(a.cwd));
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
    max_retries: Number.isInteger(a.max_retries) ? a.max_retries : 2,
    // 'process': every package is driven by its own headless session (see spawnChildDriver).
    // 'inline': the dispatch only opens the child run and the caller drives it itself.
    child_driver: a.child_driver === 'inline' ? 'inline' : 'process',
    // Everything a child run needs to route the way the parent's session routes.
    child_opts: {
      vendor: a.vendor || 'auto',
      allocation: a.allocation || 'ordered',
      host_vendor: a.host_vendor || null,
      host_model: a.host_model || null,
      native_models: a.native_models || null,
      model: a.model || null,
      policy: a.policy && typeof a.policy === 'object' ? a.policy : {},
      candidates: a.candidates || null,
      sandbox: a.sandbox || null,
      max_retries: Number.isInteger(a.max_retries) ? a.max_retries : 2,
      auto_reassign: a.auto_reassign !== false,
    },
    created_at: Date.now(),
    spec: null,
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

// ---------- worktrees and child runs ----------

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function shortId(taskId) {
  return String(taskId).slice(0, 8);
}

// One worktree per package, kept across attempts: a retry continues in the tree the first
// attempt left, exactly as a graph retry keeps the worktree of the attempt it replaces.
// `base` is the commit or branch the tree starts from - the project's HEAD, or a dependency's
// branch so the package builds on what it depends on instead of re-discovering it at merge.
function ensureWorktree(task, name, base = 'HEAD') {
  const path = join(taskDir(task.run_id), 'worktrees', name);
  const branch = `harness/${shortId(task.run_id)}/${name}`;
  if (existsSync(join(path, '.git'))) return { ok: true, path, branch, created: false };
  mkdirSync(dirname(path), { recursive: true });
  const exists = git(task.cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
  const r = exists
    ? git(task.cwd, ['worktree', 'add', path, branch])
    : git(task.cwd, ['worktree', 'add', '-b', branch, path, base]);
  if (!r.ok) return { ok: false, path, branch, reason: r.err || r.out || 'git worktree add failed' };
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
  const drop = git(cwd, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', '.harness-run']);
  if (!drop.ok) return { ok: false, reason: drop.err || 'could not leave .harness-run out of the commit' };
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
  lines.push(`The worktree is private to this package and branched from the project's HEAD; integration happens later, elsewhere.`);
  lines.push('');
  lines.push('Package acceptance - what the manager will judge this run against:');
  lines.push(bullets(pkg.acceptance));
  if ((pkg.touches || []).length) {
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
function driverPrompt(task, child) {
  const o = task.child_opts || {};
  const routing = [
    o.host_vendor ? `host_vendor ${o.host_vendor}` : '',
    o.host_model ? `host_model ${o.host_model}` : '',
    Array.isArray(o.native_models) && o.native_models.length ? `native_models ${o.native_models.join(', ')}` : '',
  ].filter(Boolean);
  return [
    `Use the graph-beta:orchestrate skill, but CONTINUE the graph run that is already open instead of opening one:`,
    `run_id ${child.run_id} at cwd ${child.cwd}. Do not call graph_open or tm_open.`,
    `Read references/loop.md, then drive graph_next/graph_run/graph_submit exactly as it says until the run is`,
    `complete or blocked - a fresh agent for every ready node, its JSON relayed verbatim to graph_submit,`,
    `graph_retry as the loop says.`,
    routing.length ? `Pass ${routing.join(', ')}.` : '',
    `End with the skill's output template.`,
  ].filter(Boolean).join(' ');
}

function spawnChildDriver(task, n) {
  const dir = join(taskDir(task.run_id), 'drivers');
  const base = String(n.node_id).replace(/[^A-Za-z0-9._-]/g, '_');
  const log = join(dir, `${base}.stream.jsonl`);
  const stderr = join(dir, `${base}.stderr.txt`);
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
    const proc = spawn(argv[0], [...argv.slice(1), driverPrompt(task, n.child)], {
      cwd: n.child.cwd,
      env,
      detached: true,
      // stdin must be closed, not inherited: a nested `claude -p` waits forever on the parent's.
      stdio: ['ignore', out, err],
    });
    proc.unref();
    return { pid: proc.pid || null, started_at: Date.now(), log, stderr, command };
  } catch (e) {
    return { pid: null, started_at: Date.now(), log, stderr, command, error: String((e && e.message) || e) };
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
  const wt = ensureWorktree(task, String(pkg.id), depBranches[0] || 'HEAD');
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
  if (task.child_driver !== 'inline') {
    const driver = spawnChildDriver(task, n);
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
  const driver = (n.child && n.child.driver) || null;
  if (cs.state === 'running') {
    if (!driver || driverAlive(driver)) {
      throw new Error(`dispatch ${n.node_id}: child run ${n.child.run_id} is still running (${JSON.stringify(cs.counts)}). `
        + (driver
          ? `Its driver process (pid ${driver.pid}) is still working; wait and poll tm_next, then submit this node again.`
          : `Drive it with graph_next/graph_run/graph_submit at cwd ${n.child.cwd}, then submit this node again.`));
    }
    // The driver died with the run unfinished - a crash, a usage limit, a kill. That is not a
    // verdict about the package, but it is an honest end for this attempt: fold it as blocked
    // so tm_retry can open the next one in the same worktree.
    const tail = driverStderrTail(driver);
    return {
      ...base, stage_ok: false, accept: false, gaps: g.gaps || [], match_pct: g.match_pct,
      child_state: 'running',
      driver: { pid: driver.pid, log: driver.log, stderr: driver.stderr },
      driver_stderr: tail,
      reason: `child driver exited (pid ${driver.pid}) with the run still running (${JSON.stringify(cs.counts)})`
        + (tail ? `: ${tail}` : ''),
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
  const wt = ensureWorktree(task, round === 1 ? 'integration' : `integration-${round}`);
  if (!wt.ok) {
    n.state = 'failed';
    n.result = { stage_ok: false, verified: false, reason: `could not create the integration worktree: ${wt.reason}` };
    return;
  }
  const merged = [];
  const ordered = dependencyOrder(task.spec.packages || []);
  for (const p of ordered) {
    const branch = deliveredBranch(task, p.id);
    if (!branch) {
      n.state = 'failed';
      n.result = { stage_ok: false, verified: false, reason: `package ${p.id} has no delivered branch to merge` };
      return;
    }
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
  n.integration = { cwd: wt.path, branch: wt.branch, merged };
  record(task, { event: 'integrated', task_id: task.run_id, node_id: n.node_id, merged: merged.length });
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
    L.push(`${n.integration.cwd} on branch ${n.integration.branch}, created from the project's HEAD.`);
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

function succeeded(n, result) {
  if (result.stage_ok !== true) return false;
  const f = VERDICT[n.stage];
  return f ? result[f] === true : true;
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
  n.state = succeeded(n, result) ? 'done' : 'failed';
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
    description: 'Open a task for a request that may be too large for one graph run. Builds size -> shape -> critique on disk under ~/.harness/tasks/<task_id>/ and returns the first ready node. If size comes back S the task deletes itself and tells you to graph_open instead. Routing arguments are passed through to every child run.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' }, cwd: { type: 'string', description: 'the project root: child worktrees branch from its HEAD' },
        context: { type: 'string' },
        flow: { type: 'string', enum: ['auto', 'develop', 'document'] },
        vendor: { type: 'string' }, allocation: { type: 'string', enum: ['ordered', 'balanced'] },
        host_vendor: { type: 'string' }, host_model: { type: 'string' }, native_models: { type: 'array', items: { type: 'string' } },
        size: { type: 'string', enum: ['S', 'L'], description: 'Pin the size instead of measuring it: L when the user said in their own words that the request must be split into packages, S when they said one run must carry it. The size node is recorded as pinned.' },
        model: { type: 'string' }, policy: { type: 'object' }, candidates: { type: 'array', items: { type: 'string' } },
        skills: { description: 'Method per manager stage, overriding the defaults: {"shape": ["develop:domain-driven-design"], "critique": []}. false runs every stage on its contract alone. A skill named here must be analytic and non-dialogic - a node runs headless and cannot answer a skill that asks it something.' },
        sandbox: { type: 'string' }, max_retries: { type: 'number' },
        child_driver: { type: 'string', enum: ['process', 'inline'], description: "How a package's child run is driven. 'process' (default): the manager spawns a headless session per package that drives the child to the end, and you only fold it. 'inline': the dispatch only opens the child run and you drive it yourself, node by node, in this session." },
      },
      required: ['request', 'cwd'],
    },
    outputSchema: NEXT_SCHEMA,
  },
  {
    name: 'tm_next',
    description: 'Which manager nodes are ready, each with a briefing_path for a fresh agent, plus every running child as {cwd, run_id, driver}. A ready dispatch node is executed here and now: its worktree is created, its child graph run opened, and (unless the task was opened with child_driver "inline") a headless driver process spawned to run that child to the end. Poll tm_next while a child driver is alive; do not drive that child yourself. tm_submit the dispatch node once the child is no longer running.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    outputSchema: NEXT_SCHEMA,
  },
  {
    name: 'tm_submit',
    description: 'Record a manager node. For size/shape/critique/accept/integrate/gate/report pass the payload the fresh agent returned. For a dispatch node pass no payload: the manager reads the child run file and folds its goal-gate verdict and report into the node. Refused while the child is still running and its driver alive; a child whose driver died unfinished folds as blocked.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, node_id: { type: 'string' }, payload: { type: 'object' } },
      required: ['task_id', 'node_id'],
    },
    outputSchema: VERDICT_SCHEMA,
  },
  {
    name: 'tm_retry',
    description: 'Open a fresh attempt. With package_id: a new dispatch in the same worktree, carrying the rejection forward into the child request. With repackage: [ids] after an integration conflict, reshape with those packages told to become one or to depend on each other. Without either: reshape (shape + critique) and discard the package graph. When the budget is gone the failure is settled and the report is released over the unreachable set.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, package_id: { type: 'string' }, repackage: { type: 'array', items: { type: 'string' }, description: 'the conflicting_packages an integrate or dispatch failure named' } }, required: ['task_id'] },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' }, retried: { type: 'boolean' }, attempt: { type: 'number' }, reason: { type: 'string' }, unreachable: { type: 'array', items: { type: 'string' } } }, required: ['task_id', 'retried'] },
  },
  {
    name: 'tm_status',
    description: 'Compact task state: counts, per-node state and verdict, child pointers. Omit task_id to list every task the manager knows. full:true returns the whole task file - large by design.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, node_id: { type: 'string' }, full: { type: 'boolean' } } },
    outputSchema: { type: 'object' },
  },
];

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
  return toolNext({ task_id: task.run_id });
}

// Size S: this request needs no manager. Say where to go, and leave nothing behind - a
// task directory for a request that never had packages is clutter that looks like state.
function delegateIfSmall(task, n, out) {
  if (!(n.stage === 'size' && n.state === 'done' && task.size === 'S')) return null;
  const delegate = {
    tool: 'graph_open',
    args: { request: task.request, cwd: task.cwd, context: task.context || undefined,
      flow: task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'), ...task.child_opts },
    reason: 'size S: one graph run carries it; the manager adds nothing',
  };
  try { rmSync(taskDir(task.run_id), { recursive: true, force: true }); } catch { /* best-effort */ }
  return { ...out, state: 'done', task_state: 'delegated', delegate };
}

function toolNext(a) {
  const task = mustFindTask(a);
  // Dispatch nodes run here, the moment they are ready. Doing it in tm_next rather than in
  // a separate call means the session cannot forget to, and cannot do it twice.
  let opened = 0;
  for (const n of readyNodes(task)) {
    if (n.stage !== 'dispatch') continue;
    openChild(task, n);
    opened++;
  }
  if (opened) saveRun(task);
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
  const children = task.nodes.filter((n) => n.stage === 'dispatch' && n.state === 'running' && n.child).map((n) => {
    const child = loadRun(n.child.cwd, n.child.run_id);
    const childState = child ? runState(child).state : 'missing';
    const driver = n.child.driver || null;
    const alive = driverAlive(driver);
    const fold = `tm_submit({task_id, node_id: "${n.node_id}"})`;
    let next;
    if (childState !== 'running') next = fold;
    else if (!driver) next = `graph_next({run_id: "${n.child.run_id}", cwd: "${n.child.cwd}"}) and drive it; tm_submit this node when complete`;
    else if (alive) next = `its driver process (pid ${driver.pid}) is running this child: wait; poll tm_next; do not drive this child yourself`;
    else next = `driver exited before the run finished: ${fold} folds it as blocked, then tm_retry({package_id: "${n.subgoal_id}"}) reopens it (or reopen the task with child_driver "inline" to drive children yourself)`;
    return {
      node_id: n.node_id,
      package_id: n.subgoal_id,
      cwd: n.child.cwd,
      run_id: n.child.run_id,
      branch: n.child.branch,
      child_state: childState,
      ...(driver ? { driver: { pid: driver.pid, alive, log: driver.log } } : {}),
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
  const state = runState(task);
  return {
    task_id: task.run_id,
    cwd: task.cwd,
    state: state.state,
    counts: state.counts,
    size: task.size,
    flow: task.flow !== 'auto' ? task.flow : (task.flow_chosen || 'auto'),
    child_driver: task.child_driver || 'process',
    packages: task.spec ? task.spec.packages.map((p) => p.id) : [],
    nodes: task.nodes.filter((n) => (a.node_id ? n.node_id === a.node_id : true)).map((n) => (n.state === 'pending' || n.state === 'running'
      ? { node_id: n.node_id, stage: n.stage, state: n.state, deps: n.deps, after: n.after || [],
          ...(n.child ? { child: { ...n.child, ...(n.child.driver ? { driver: { ...n.child.driver, alive: driverAlive(n.child.driver) } } : {}) } } : {}) }
      : verdict(task, n))),
  };
}

// ---------- JSON-RPC / MCP plumbing ----------

function callTool(name, args) {
  const a = args || {};
  switch (name) {
    case 'tm_open': return toolOpen(a);
    case 'tm_next': return toolNext(a);
    case 'tm_submit': return toolSubmit(a);
    case 'tm_retry': return toolRetry(a);
    case 'tm_status': return toolStatus(a);
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
