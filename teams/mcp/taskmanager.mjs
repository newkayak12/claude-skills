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
//      of a run file; a second writer is the race mergeOnto exists to paper over. A human's pin
//      (tm_assign) or card answer (tm_submit({key})) is an exception that proves the rule, not a
//      hole in it: both preview their effect against a read-only loadRun (applyPinAction /
//      broker.mjs's computeSubmitResult - the SAME functions the broker itself applies for real)
//      and then queueHumanAction the actual instruction - graph.mjs's own handoff, drained by
//      the broker's mustFindRun the next time anything touches the run. 0.27.3 broke rule 2
//      here, loadRun+saveRun'ing the child directly from this process (2026-09-24 review, against
//      this header and design §7's "changed_files는 워크트리 대조로 똑같이 검증" - a human's
//      report was taken at face value, with no cross-check at all).
//   3. It does not call the graph broker over MCP. There is no server-to-server JSON-RPC channel,
//      and the driving session is already the relay: `tm_next` hands back a child pointer
//      {cwd, run_id}, the session drives the child with team_next/team_run/team_submit,
//      and calls `tm_submit` on the dispatch node when the child's report is done. Importing
//      broker.mjs as a library for computeSubmitResult (below) is not that channel - it is a
//      pure, read-only function call, made possible only because broker.mjs is import-safe
//      (isEntryPoint guards its stdio loop the same way this file's own `isMain` does).
//
// The child run is opened HERE, by the server, on a dispatch node - never by a model inside
// a node. The "do not re-enter the harness" rule in every node prompt stays true.
//
// State lives under ~/.harness/tasks/<task_id>/ (HARNESS_TASKS_DIR overrides), never under a
// project cwd: a task's packages live in several worktrees and belong to none of them.
// Zero dependencies: MCP's stdio transport is newline-delimited JSON-RPC 2.0.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, readdirSync, openSync, closeSync, statSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { touchMarker } from './engage.mjs';
import {
  epicKey, storyKey, taskKey, docPaths, latestBySubgoal, epicTicketState, epicPhase,
  storyTicketState, storyTaskProgress, epicBoardRows, ticketSnapshot,
  storyLinks, packageReporter, parseTicketKey, storyBlockedReason,
} from './tickets.mjs';
import { writeDocs } from './docs.mjs';
import { conventionsBlock } from './conventions.mjs';
import { readTeamConfig, resolveTeamOptions, TEAM_DEFAULTS } from './teamconfig.mjs';
import { pluginDirArgs, isEntryPoint, teamsPluginRoot } from './pluginroots.mjs';
import { ensureViewer, readViewRecord, viewUrl } from './viewserver.mjs';
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
  KINDS,
  DEFAULT_KIND,
  kindOf,
  REASONING_STAGES,
  authorStage,
  applyPinAction,
  queueHumanAction,
  peekHumanActions,
  currentAttempt,
  openAsk,
  promoteHumanGates,
  autoPassHumanGateResult,
  humanGateResultFromPayload,
  humanGateIdentity,
} from './graph.mjs';
import { computeSubmitResult } from './broker.mjs';
// The same driver-stream reader view.mjs's RESOURCE view already uses (see drivercost.mjs's own
// header comment) - reused here, not re-parsed, so tm_status/tm_board/the report briefing can
// never disagree with what the view surface already shows for the same task.
import { pidAlive } from './proc.mjs';
import { collectDriverCosts, collectTaskCosts, collectNodeCosts } from '../scripts/bench/lib/drivercost.mjs';
import { applyMerge, foldRecords } from './reducers.mjs';

const SERVER = { name: 'task-manager', version: '0.7.0' };
const DEFAULT_PROTOCOL = '2025-06-18';

// ---------- where tasks live ----------

export function tasksRoot() {
  return process.env.HARNESS_TASKS_DIR ? resolve(process.env.HARNESS_TASKS_DIR) : join(homedir(), '.harness', 'tasks');
}
export function taskDir(taskId) {
  return join(tasksRoot(), taskId);
}
export function taskPath(taskId) {
  return join(taskDir(taskId), 'task.json');
}

export function record(task, entry) {
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
export const STAGE_SKILLS = {
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

// Every manager stage that decides or judges. size only measures, and report only recounts.
const MANAGER_CONVENTION_STAGES = new Set(['shape', 'critique', 'accept', 'integrate', 'gate', 'gate:goal']);

// Same field, same short wording, as prompts.mjs's own QUESTIONS_CONTRACT (D2 slice 3, 0.29.0) -
// this file's manager-level judging stages (shape/critique/accept/integrate/gate/gate:goal) get
// the identical `questions[]` contract the child-run graph's stages do, generalized from
// investigate's own unknowns[]. Kept as a second literal rather than importing prompts.mjs's
// constant: the two files already diverge on every other line of these contracts, and importing
// one string across that boundary would suggest a coupling that does not otherwise exist.
const QUESTIONS_CONTRACT = `Optional: "questions": [{"question": "...", "to": "<role or person who owns this, if you can name one>", "options": [{"option": "...", "consequence": "..."}], "default": "<what you decide if nobody answers - required whenever "options" is>", "why": "<why this is not yours to decide alone>"}]. Only for a decision with a real owner other than you - not a hedge on ordinary judgment. An interactive run stops and asks; otherwise "default" is used and the question is recorded on the report as decided-for-you.`;

export const CONTRACT = {
  size: `Return JSON: {"stage_ok": true, "skills_used": ["<skill or none>"], "size": "S|L", "flow": "develop|document", "sizing": ["command -> what it showed"], "handoff": "<what shape needs to know>", "evidence": "..."}
S means one graph run in one worktree can carry the whole request. L means it spans independent modules, packages or repositories that each need their own run and worktree, integrated afterwards. Decide from what commands show - file and module counts, ownership boundaries, build units - and put those commands in "sizing". The default is S: a manager layer exists, and the temptation is to use it. Over-sizing costs a worktree, a run and an integration per package; under-sizing costs one retry.`,
  shape: `Return JSON: {"stage_ok": true, "skills_used": ["<skill or none>"], "acceptance": ["goal-level criteria for the integrated result"], "packages": [{"id": "P1", "title": "...", "flow": "develop|document", "skills": ["plugin:skill"], "brief": "<the request this package's own graph run will receive - self-contained>", "acceptance": ["what the package must deliver, checkable inside its worktree"], "touches": ["paths or modules this package changes"], "deps": ["P0"], "implements": ["US-1"], "enables": [], "split": false}], "handoff": "...", "evidence": "..."}
"skills" is optional and is method for the package, not for you: you are the stage that knows what each package IS, and a CLI package and a reference-document package want different method. Name the skills that package's own nodes should work by, and they travel into its child run; leave it out when the brief is method enough. Do not name a skill that asks its reader questions - the child's nodes run headless too.
Three rules critique will refuse the shape over, so decide them here rather than letting it find them. One: every shared artifact two or more packages depend on - the composition root or app assembly that makes the merged tree runnable, a cross-package contract, an auth or admission token and its verifier, a shared schema or type - is owned by exactly one package, named in that package's touches[] AND in its acceptance[]. A package may not be judged on a primitive no package was told to build. A package that owns only such artifacts delivers no story by itself: leave its implements[] empty and list in enables[] the stories that cannot be delivered without it - never claim a story in implements[] to get it past coverage. Two: every goal-level criterion must be checkable by the integration step from the merged tree alone, and no two of them may contradict each other; a criterion that needs an environment this harness cannot produce states the achievable measurement and what it extrapolates from, rather than naming a number no run can reach. Three: a package's own acceptance must be satisfiable from that package's deps[] alone - if proving it needs a sibling's delivered result, that sibling is a dependency or the criterion belongs to whoever has it.
Each package becomes one graph run in its own worktree. A package with no deps branches from the current HEAD; a package with deps branches from its first dependency's delivered branch with the others merged in, so it builds on what they delivered - not on stubs. Two packages that touch the same path will conflict at integration: split by ownership, not by phase. A dependency means the package needs another's delivered result; it receives that package's report as context and starts from its tree. Every package must be size S on its own - if one still needs splitting, the shape is wrong. Two to six packages is the usual range. "split": true (or "size": "L") is the one exception to that rule - the rare package whose own scope still needs its own shape/dispatch cycle inside its child run; leave it false for the ordinary package, whose child run opens with this shape's own acceptance already decided and no plan/setgoal/critique/gate:goal of its own to redo (§3, docs/plans/2026-09-21-teams-server-owns-the-loop.md).
${QUESTIONS_CONTRACT}`,
  critique: `Return JSON: {"stage_ok": true, "skills_used": ["<skill or none>"], "sound": true|false, "blocking": ["..."], "problems": ["..."], "handoff": "...", "evidence": "..."}
Attack the shape: packages that overlap in touches[], a dependency the brief does not actually need, a package too large to be one run, a goal-level criterion no integration step could check, and - above all - a request that was S sized as L. Set sound=false only for defects in "blocking" that make the packages impossible to run or impossible to integrate. Everything else is a problem, carried forward as advice.
Blocking defects come in three kinds - name the kind inline in the "blocking" entry itself (e.g. "shape - ..."), so it is legible without a second pass. (These are not the A/B/C of the plan docs' critique measurements, which classify by where the fix lands.) shape: the "## Shape analysis" facts above are signals, not verdicts - a genuinely small app can be one linear chain, and one package can legitimately hold the shared contract - so decide with evidence from the brief, not from the numbers alone. A foundation or shared package that owns, in touches[], more than the contracts/types/protocols/interfaces the other packages build against (bloated in the analysis, or simply the one everything else deps on) is a shape defect unless the shape says why that extra scope cannot be split out. A fully serial shape (max_parallel_width 1 across more than one package) is a shape defect unless a real data dependency the brief itself names - not convenience, not habit, not "it was easier to write in order" - requires every edge; a chain that only avoids coordination is blocking, not a problem carried forward as advice. unrunnable: packages that overlap in touches[], a dependency cycle, a dependency the brief does not need, a package too large to be one run. unjudgeable: a goal-level criterion no integration step could check, criteria that contradict each other, or a request that was S sized as L. sound=false whenever "blocking" holds any entry - a shape defect blocks as much as an unrunnable one.
${QUESTIONS_CONTRACT}`,
  accept: `Return JSON: {"stage_ok": true, "skills_used": ["<skill or none>"], "accept": true|false, "match_pct": 0-100, "checks": ["<what you verified in the worktree or the report, and what it showed>"], "gaps": ["what the package did not deliver"], "observations": ["weaknesses that do not block"], "reason": "...", "evidence": "..."}
You are the judge, not the actor. The child run's own goal gate and report are below; judge them against THIS package's acceptance, which the child never saw in full. A child that passed its own gate but delivered less than the package asked for is a gap here. Absent evidence is a gap, not a pass.
accept:true with an empty checks[] is refused by the engine - a judgement with no evidence is a guess.
If "What the child run delivered" below has an "Upstream defects it reported" list, the child found something wrong OUTSIDE this package's own touches[], in a package it deps on - not a gap in what THIS package delivered. Copy every one of them through verbatim into your own JSON as "upstream_defects": [{"package": "...", "title": "...", "evidence": "...", "touches": ["..."]}] - the manager files each one as a fix STORY owned by the upstream package's own scope, the same way a QA-found defect is filed. Do not judge this package down, and do not put an upstream defect only in "gaps": it is not this package's fault and is not this package's fix.
${QUESTIONS_CONTRACT}`,
  integrate: `Return JSON: {"stage_ok": true|false, "skills_used": ["<skill or none>"], "verified": true|false, "checks": ["command -> observed output"], "unowned": ["requirement -> the package that delivered it, NONE if no package did, or <package> -> did not deliver its own stated scope"], "duplication": ["responsibility built more than once -> the packages that each built it, and what shared module it should have been"], "volume": ["package -> files/LOC/tests it delivered -> plausible for its stated scope, or looks like a card was closed rather than a job finished, and why"], "evidence": "..."}
The package branches are already merged into the integration worktree named below - the manager did that and recorded each merge commit. Your job is what no package could do alone: run the goal-level checks the shape's acceptance implies against the combined tree, and read the seams between packages. stage_ok=false when a check could not run at all. verified=false when the combined tree fails a check the packages passed separately. Do not fix package work here: a failing seam is a gap for the gate and a repackage for the manager.
Three more questions, answered with evidence, not vibes - the same product-owner pass planning's audit takes after integration, run here so it happens even when roles.planning is off (audit, when it does run, takes this as its own second pass - do not treat this as done because that one is coming): missing - map every requirement in the request or the shape's acceptance to the package that implemented it, name any with no owning package, and name any package whose stated scope it did not actually deliver, into "unowned". duplication - name any responsibility two or more packages each implemented, and any type or helper multiple packages each defined locally instead of sharing, into "duplication", saying what the shared module should be called. volume - for each package, give file/LOC/test counts and say whether that size is plausible for its stated scope, into "volume", with the reasoning that got you there, not just the numbers. An empty list in any of the three is a real finding, not something you skipped.
verified:true with an empty checks[] is refused by the engine - a judgement with no evidence is a guess.
${QUESTIONS_CONTRACT}`,
  'gate:goal': `Return JSON: {"stage_ok": true, "skills_used": ["<skill or none>"], "accept": true|false, "match_pct": 0-100, "checks": ["<what you verified and what it showed>"], "gaps": ["what blocks acceptance"], "observations": ["weaknesses that do not block"], "spec_drift": ["where the shape asked for less than the request did"], "reason": "...", "evidence": "..."}
You are the judge, not the actor, and the only node that sees the original request again. Judge the integrated result against BOTH the goal-level acceptance and the REQUEST as written. Anything the request asked for that no package delivered and no criterion named belongs in "spec_drift". Absent evidence is a gap, not a pass.
accept:true with an empty checks[] is refused by the engine - a judgement with no evidence is a guess.
${QUESTIONS_CONTRACT}`,
  report: `Return JSON: {"stage_ok": true, "handoff": "<the final report>", "evidence": "..."}
Synthesize from the node results below only: which packages ran, what each delivered, what the integration showed, what the gate said. State plainly what was not done and why.`,
  // A card the manager graph parks for a human the moment a `questions[]`-bearing stage
  // completes (openAsk, generalized in graph.mjs - D2 slice 3). It never dispatches to a
  // fresh agent - the same reason `ask` is not in MANAGER_CONVENTION_STAGES above - this entry
  // exists only so composeTaskPrompt has contract text to show the PERSON reading the card
  // (tm_inbox's briefing_path), not a model.
  ask: `Return JSON: {"stage_ok": true|false, "decisions": [{"question": "<the question, as it was asked>", "chose": "<the option you picked, in full>", "because": "<optional: why, or a condition on it>"}], "evidence": "who decided, and when"}`,
};

// What an ordinary accept never has to say, and a phase-Team's accept does. Both of these pass
// a list UP to the manager rather than judging it: the QA accept's `defects` and the audit
// accept's `unmet` are what finish() files STORYs from (§5b). A judge that is never told to
// return the field returns a verdict the hook has nothing to act on - so the field is named
// here, in the same breath as the contract it extends, rather than left to the child's report.
const ACCEPT_EXTRA = {
  qa: `This package is the goal-level QA pass, so your JSON carries one more field: "defects": [{"title": "...", "touches": ["path"], "deps": ["P1"], "evidence": "<how to reproduce>", "severity": "high|medium|low"}]. Every defect the QA report substantiates goes there, whether or not you accept the package - the manager files each one as its own STORY and loops the task back through integration. An empty list is the right answer when QA found nothing; do not invent one, and do not put a defect only in "gaps". If the briefing below has a "Defects it reported" list under "What the child run delivered", every entry there came from the case set actually being run and MUST turn into one object in your own "defects" array (title + evidence at minimum) - dropping one because the package also gets accepted is exactly the failure this field exists to prevent.`,
  audit: `This package is planning's audit pass, so your JSON carries one more field: "unmet": ["US-n -> what the integrated result still does not do"]. Put every user story the audit showed is unsatisfied there, one entry each, whether or not you accept the package - the manager files each as its own STORY. An empty list is the right answer when every story is met.`,
};

function bullets(list) {
  return (list || []).map((x) => `- ${x}`).join('\n') || '- (none)';
}

// ---------- task creation ----------

// requests[]: a backlog instead of one request (§B.3) - several EPIC-level items, priority =
// array order (index 0 highest). task.requests carries the raw array (the retro and shape's own
// briefing both read it by index); task.request stays the ONE string every size/shape/PLAN
// briefing already reads - this is a second way to WRITE it, not a second thing anything
// downstream has to understand. Single `request` is untouched: this only runs when `requests`
// was actually given.
function composeBacklogRequest(requests) {
  return requests.map((r, i) => `[backlog priority ${i}] ${r}`).join('\n\n');
}

// tm_open({context_from: <prior task id or ticket key>}) (§B.2): folds a finished task's own
// retro.json - the Retrospective and Next backlog its report stage wrote (docs.mjs's
// renderRetro) - into this task's context, so a new Sprint opens already knowing what the last
// one left unresolved. Best-effort: a prior task with no report yet, an unreadable retro.json,
// or a ref that does not resolve at all leaves context untouched rather than failing tm_open
// over a document that is evidence, not a dependency (the same rule record()/writeDocs already
// follow elsewhere in this file).
// Best-effort by design - a follow-up Sprint still opens without its prior retro - but never
// silent: {text, unresolved} names why nothing was folded in, and tm_open hands that back, so a
// caller who asked for context_from learns it came up empty instead of assuming it did not.
function priorRetroContext(contextFrom) {
  if (!contextFrom) return { text: '', unresolved: null };
  let id = null;
  try { id = resolveTaskRef(contextFrom); } catch { id = null; }
  const prior = id && loadRunAt(taskPath(id));
  if (!prior) return { text: '', unresolved: `no task ${contextFrom} under ${tasksRoot()}` };
  const retroPath = docPaths(prior).retro;
  if (!existsSync(retroPath)) return { text: '', unresolved: `task ${prior.run_id} has no retro.json yet - its report has not run (${retroPath})` };
  try {
    const retro = JSON.parse(readFileSync(retroPath, 'utf8'));
    const L = [`Context from the prior task ${prior.run_id} (${epicKey(prior.run_id)}), "${String(prior.request || '').slice(0, 160)}":`, ''];
    L.push('Retrospective - what failed and why:');
    L.push(bullets((retro.retrospective.what_failed || []).map((f) => `${f.node_id} (${f.stage}): ${f.reason}`)));
    if ((retro.retrospective.retries || []).length) L.push('', 'Retries:', bullets(retro.retrospective.retries.map((r) => `${r.package_id}: ${r.attempts} attempts`)));
    if ((retro.next_backlog.unshipped_requests || []).length) L.push('', 'Next backlog - backlog items not shipped (priority order):', bullets(retro.next_backlog.unshipped_requests.map((r) => `[${r.priority}] ${r.request}`)));
    L.push('', 'Next backlog - unaccepted packages:');
    L.push(bullets((retro.next_backlog.unaccepted_packages || []).map((p) => `${p.id} (${p.title}): ${p.reason}`)));
    if ((retro.next_backlog.unresolved_defects || []).length) L.push('', 'Unresolved defects:', bullets(retro.next_backlog.unresolved_defects.map((d) => d.title)));
    if ((retro.next_backlog.open_questions || []).length) L.push('', 'Open questions nobody answered:', bullets(retro.next_backlog.open_questions.map((q) => q.question || JSON.stringify(q))));
    // The prior Sprint's accepted work lives on its last verified integration branch, which
    // nothing merges into the project's own branch: code-sprint-S8's main was still at seed after
    // P1+P2 shipped, so a follow-up Sprint branched from HEAD would rebuild on nothing. When that
    // branch exists and HEAD does not already contain it, this task starts from it instead.
    const integ = prior.nodes.filter((n) => n.stage === 'integrate' && n.state === 'done' && n.integration && n.integration.branch).pop();
    let base_ref = null;
    if (integ) {
      const b = integ.integration.branch;
      const exists = git(prior.cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]).ok;
      const merged = exists && git(prior.cwd, ['merge-base', '--is-ancestor', b, 'HEAD']).ok;
      if (exists && !merged) {
        base_ref = b;
        L.push('', `This task starts from the prior task's integration branch ${b} - its accepted work is not on the project's own branch yet. Build on it; do not rebuild it.`);
      }
    }
    return { text: L.join('\n'), unresolved: null, base_ref };
  } catch (e) {
    return { text: '', unresolved: `retro.json of ${prior.run_id} could not be read: ${String((e && e.message) || e)}` };
  }
}

function createTask(a) {
  if (a.child_driver !== undefined || a.s_driver !== undefined) {
    throw new Error('child_driver and s_driver were removed in 0.10.0: the driving session never drives a child run or the manager loop. Open the task and watch tm_status / tm_events; the daemon and package drivers do the rest.');
  }
  const requests = Array.isArray(a.requests) && a.requests.length ? a.requests.map(String) : null;
  if (!requests && (a.request == null || String(a.request).trim() === '')) {
    throw new Error('tm_open needs either request (a string) or requests (a non-empty array of strings), not neither');
  }
  if (requests && a.request != null && String(a.request).trim() !== '') {
    throw new Error('tm_open takes request OR requests, not both - requests: [...] IS the several-item form of request');
  }
  const cwd = resolve(String(a.cwd));
  const teamFile = readTeamConfig(cwd);
  const team = resolveTeamOptions(a, teamFile.config);
  const T = team.opts;
  const taskId = randomUUID();
  const depth = Number.isInteger(a.depth) ? a.depth : 0;
  const priorRetro = priorRetroContext(a.context_from);
  // A backlog held to a box is only boxable as packages: enforceBudget stops by leaving the
  // lowest-priority PACKAGES undispatched, and a size-S task has none, so an S backlog ran past
  // its budget to the end (code-sprint-S1, 2026-09-26: the ledger backlog measured S, as the
  // monorepo fixtures do). Pinned L here unless the caller pinned a size itself.
  const boxedBacklog = !!(requests && requests.length > 1 && (T.budget_usd != null || T.timebox_minutes != null));
  const task = {
    run_id: taskId,
    kind: 'task',
    store_path: taskPath(taskId),
    cwd,
    request: requests ? composeBacklogRequest(requests) : String(a.request),
    requests, // null for the ordinary single-request task - the byte-for-byte compat case.
    context: [priorRetro.text, a.context || ''].filter(Boolean).join('\n\n'),
    ...(priorRetro.unresolved ? { context_from_unresolved: priorRetro.unresolved } : {}),
    // Where package and integration worktrees branch from (see priorRetroContext). null = HEAD.
    base_ref: priorRetro.base_ref || null,
    flow: FLOWS[a.flow] ? a.flow : 'auto',
    flow_chosen: null,
    size: null,
    // How many packages deep this task was opened - 0 for a tm_open a caller drives directly.
    // Nothing in this codebase opens a nested tm_open yet (a package's child is a graph.mjs
    // run, never another task), so this is forward declared for when it does; max_depth
    // (teamconfig.mjs) reads it via child_opts.depth below to force every package this task
    // opens at depth >= max_depth to run chain-only (§3, openChild).
    depth,
    // The user said, in their own words, that this must be split (L) or must stay one run
    // (S): the size node is recorded as pinned and never measured. Mirrors the flow pin.
    size_pinned: ['S', 'L'].includes(a.size) ? a.size : (boxedBacklog ? 'L' : null),
    size_pin_source: ['S', 'L'].includes(a.size) ? 'caller' : (boxedBacklog ? 'boxed-backlog' : null),
    // false turns method off entirely; an object overrides STAGE_SKILLS per stage.
    stage_skills: a.skills === false ? false : (a.skills && typeof a.skills === 'object' ? a.skills : null),
    max_retries: T.max_retries,
    // How many times a package's dead driver is respawned on the SAME child run_id before the
    // dispatch is folded blocked. A usage-limit death never spends this budget - see
    // serviceDeadDriver.
    driver_restarts: T.driver_restarts,
    // See serviceStalledDriver/serviceDeadDriver and teamconfig.mjs's own comments: stall_minutes
    // flags (then, at 3x, kills) a driver that is alive but making no progress;
    // restart_period_minutes turns driver_restarts from a flat forever counter into a sliding
    // window.
    stall_minutes: T.stall_minutes,
    restart_period_minutes: T.restart_period_minutes,
    // Whether the single run a size-S request becomes is opened isolated. It is a tm_open
    // argument because the manager, not the entry skill, is what opens that run.
    isolated: a.isolated === true,
    // Same story as isolated: an entry skill pinned to 'develop' or 'document' says whether the
    // other kind may appear in the spec at all. Carried on the task, for that same size-S run.
    mixed: a.mixed !== false,
    // The floor the manager's own goal gate's match_pct must clear - same meaning, same
    // default, as the graph engine's run.goal_threshold.
    goal_threshold: T.goal_threshold,
    // Whether this EPIC's runs may stop and ask a person. Carried on the task as well as in
    // child_opts so tm_status can show it without opening a child run.
    interactive: T.interactive === true,
    // gate:human (0.29.0): which judging stages of THIS task's own manager graph (shape,
    // critique, accept, integrate, gate, gate:goal live in task.nodes - task.json is itself a
    // run, graph.mjs's promoteHumanGates works over it unmodified) a person must accept or
    // reject. Also threaded into child_opts below so every package's own child run gates the
    // same stages inside its own chain.
    human_gates: Array.isArray(T.human_gates) ? T.human_gates.slice() : [],
    // Set once a daemon is spawned for this task (serviceDaemon/spawnDaemon): {pid, started_at,
    // log, stderr, exit, command, spawn_count, restarts, exhausted}. null under noDaemon().
    daemon: null,
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
      // One package's child run is one level deeper than the task that opens it - this task's
      // own depth, since a package's child is a graph.mjs run, not another task (§3, item 3).
      depth: depth + 1,
      // T already layers team.json under an explicit tm_open arg (teamconfig.mjs's
      // resolveTeamOptions), the same precedence vendor/allocation above already rely on -
      // so reading T here, not `a` with its own hardcoded fallback, is what keeps a project's
      // pinned goal_threshold/max_retries from being silently dropped for every child run.
      max_retries: T.max_retries,
      auto_reassign: a.auto_reassign !== false,
      goal_threshold: T.goal_threshold,
      // Read from T, not `a`, for the same reason max_retries/goal_threshold above are: a
      // project that pinned interactive in team.json means every child run, not just the
      // manager. This is the value graph.mjs's createRun turns into run.interactive, which is
      // what openAsk consults.
      interactive: T.interactive === true,
      // Same reasoning as interactive just above - a package's own child run gates the same
      // stages createRun's own chain has (critique, gate, gate:goal) that the project named.
      human_gates: Array.isArray(T.human_gates) ? T.human_gates.slice() : [],
      // team_open's own tool boundary (broker.mjs) defaults this to 2; createRun's own bare
      // default is 1, deliberately - see graph.mjs's createRun and the commit that introduced
      // goal_judges, 858e0b9: "createRun itself still defaults goal_judges to 1, so a caller
      // that builds runs directly - the TaskManager's per-package child runs among them - is
      // unaffected unless it asks otherwise". That was not an oversight left for this fix:
      // bumping this default to 2 was tried here first and broke 18 of this suite's existing
      // tests (every helper that drives a child to its report submits exactly one gate:goal:N -
      // a second, letter-suffixed sibling never gets a verdict and the round never settles). The
      // bug this fixes is narrower than the default: before this line, tm_open had no
      // `goal_judges` argument at all, so no caller could raise a package's judge count above 1
      // even by asking - every EPIC package was pinned to single-judge with no escape hatch.
      // Keeping createRun's own default here is consistent with that precedent AND lets an
      // explicit tm_open({goal_judges}) argument reach every child run for the first time. Not
      // yet a team.json key - teamconfig.mjs's TEAM_DEFAULTS is out of scope for this change.
      goal_judges: Number.isInteger(a.goal_judges) && a.goal_judges > 0 ? a.goal_judges : 1,
      // Read from T for the same reason interactive/goal_threshold above are: a project that
      // pins retry_policy in team.json means every child run's own retrySubgoal, not just this
      // task's own retryPackage (which reads task.team.opts.retry_policy directly - see
      // retryPackage). graph.mjs's createRun turns this into run.retry_policy.
      retry_policy: T.retry_policy === 'rollback' ? 'rollback' : 'continue',
    },
    created_at: Date.now(),
    spec: null,
    // Set only for a size-S task: {cwd, run_id, driver, spawn_count,
    // waiting_capacity?} for the one graph run the manager opened and is driving with a
    // headless session, mirroring a package's n.child.
    s_run: null,
    // The synthetic planning phase-Team package (§0.1), stashed here (not in task.spec.packages,
    // which shape owns and which is still null before shape runs). packageOf reads it directly,
    // the same way it reads task.qa_pkg for the QA phase-Team (Task 4) - neither ever joins
    // task.spec.packages; docs/board render them from these fields instead (Task 6).
    // null when roles.planning is off - the default, and the byte-for-byte compat case.
    planning_pkg: null,
    nodes: T.roles.planning
      ? [node('size', 'size', [])]
      : [
        node('size', 'size', []),
        node('shape', 'shape', ['size']),
        node('critique', 'critique', ['shape']),
      ],
  };
  if (T.roles.planning) {
    task.planning_pkg = {
      id: 'PLAN',
      phase: 'planning',
      flow: 'plan',
      title: 'PRD',
      brief: task.request,
      acceptance: ['PRD covers the request'],
      deps: [],
      touches: [],
    };
    pushChain(task, PACKAGE_CHAIN, 'PLAN', 1, ['size'], [], {});
    task.nodes.push(node('shape', 'shape', ['accept:PLAN:1']));
    task.nodes.push(node('critique', 'critique', ['shape']));
  }
  return saveRun(task);
}

export function mustFindTask(a) {
  // resolveTaskRef turns the ticket key E-xxxxxxxx into the run id it names (§8) - the same
  // 8-hex-prefix match tm_ticket resolves its key with. Every task_id-taking tool goes through
  // this one lookup (including callTool's own serviceDaemon call, which calls mustFindTask ahead
  // of dispatch), so a ticket key works anywhere a run id already did, tm_board included.
  const id = resolveTaskRef(a.task_id);
  const task = id && loadRunAt(taskPath(id));
  if (!task) throw new Error(`unknown task ${a.task_id}`);
  return task;
}

// ---------- shape validation and expansion ----------

// userStories is task.planning_pkg's dispatch:PLAN:1 result.user_stories, passed only for a
// task planning ran on - finish() decides that, so this stays a pure function of what it is
// handed. undefined/null skips the check entirely (planning off: nothing to be complete against).
// A user story arrives from gate:goal as {"id": "US-1", "title": "...", "acceptance": [...]} -
// the shape its own contract asks for. `String(story)` on that gives "[object Object]", which
// matched no packages[].implements[] entry, so with planning on shape could never pass and the
// develop workflow could not stand up at all (idol-pm-1, 2026-09-22). Invisible until then only
// because every earlier planning run returned zero stories and the loop never ran.
export function storyId(story) {
  if (story && typeof story === 'object') return String(story.id || story.US || story.story_id || '').trim();
  return String(story == null ? '' : story).trim();
}

export function storyLabel(story) {
  const id = storyId(story);
  const title = story && typeof story === 'object' ? String(story.title || '').trim() : '';
  return title ? `${id} - ${title}` : id;
}

// A touches entry as the path it claims: a trailing /** or /* claims the directory, so
// "src/a/**", "src/a/*" and "src/a" are one scope. Any other wildcard is left as written and
// only ever matches itself - guessing what "src/*.test.ts" covers would fail good shapes.
function touchScope(t) {
  return t.replace(/\/\*\*?$/, '');
}

function scopesOverlap(a, b) {
  if (a === b) return true;
  if (/[*?[]/.test(a) || /[*?[]/.test(b)) return false;
  return a.startsWith(b + '/') || b.startsWith(a + '/');
}

export function validateShape(spec, userStories) {
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
  // Containment counts, not only equality: idol-pm-4 (2026-09-23) passed with P1 owning
  // src/identity/module.ts and P2 owning src/identity/**, one file claimed twice in two spellings.
  const claimsOf = new Map();
  for (const p of packages) {
    for (const t of (p && p.touches) || []) {
      const raw = String(t).replace(/\/+$/, '');
      const key = touchScope(raw);
      for (const [other, [oid, oraw]] of claimsOf) {
        if (oid === String(p.id) || !scopesOverlap(key, other)) continue;
        problems.push(raw === oraw
          ? `packages ${oid} and ${p.id} both touch ${raw}`
          : `packages ${oid} and ${p.id} both touch ${key.length >= other.length ? raw : oraw}: ${oid}'s ${oraw} and ${p.id}'s ${raw} overlap - narrow one so each path has one owner`);
      }
      if (!claimsOf.has(key)) claimsOf.set(key, [String(p.id), raw]);
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
  // §5's completeness check: every user story planning produced must be implemented by some
  // package, or it silently falls through the crack between "planning decided it" and "shape
  // scheduled it". Only checked when planning actually ran (userStories is an array, not null).
  if (Array.isArray(userStories)) {
    const claims = (p) => (Array.isArray(p && p.implements) ? p.implements.map(String) : []);
    const covered = new Set(packages.flatMap(claims));
    const missing = userStories.map(storyId).filter((u) => u && !covered.has(u));
    if (missing.length) problems.push(`user stories not implemented by any package: ${missing.join(', ')}`);
    // Union coverage alone is satisfied by a shape where everyone claims everything, and that
    // is what a real one did: idol-pm-2 (2026-09-22) had P1 and P6 each claim all four stories,
    // so the check passed over a split that said nothing about who owns what. These two read the
    // same field for what it is meant to mean - what this package delivers, not what it touches.
    const ids = userStories.map(storyId).filter(Boolean);
    if (ids.length && packages.length > 1) {
      for (const p of packages) {
        const mine = new Set(claims(p));
        // A package that owns only rule one's shared artifacts - the composition root, a shared
        // contract - delivers no story itself. Requiring implements[] of it made the shape lie:
        // idol-pm-4 (2026-09-23) pinned US-7 on its foundation package to pass, and when shape:2
        // told the truth (P1 and P7 with no story) this check rejected it.
        const enables = new Set((Array.isArray(p && p.enables) ? p.enables : []).map(String).filter((u) => ids.includes(u)));
        if (!mine.size && !enables.size) problems.push(`package ${p.id} implements no user story: every package in a planned task delivers some part of the PRD, or it is not in this shape - a package that owns only shared artifacts other packages build on lists the stories it makes possible in enables[] instead`);
        else if (ids.every((u) => mine.has(u))) problems.push(`package ${p.id} claims every user story (${ids.join(', ')}): implements[] is what this package delivers, not what it touches - a package that delivers all of them is the whole job, not a package`);
      }
    }
  }
  return problems;
}

// Signals, not a validator: the shapes validateShape lets through can still be a foundation
// package holding nine scopes while its siblings hold two, or a strict chain no sibling could
// have started earlier - a real small app can legitimately be one linear chain, so this never
// fails the shape itself. It only computes facts for critique to weigh against the brief.
// Evidence: awake-beta-ref1 (P1<-P2<-P3<-P4, P1 owned contracts+policy+tests, 3 attempts) and
// idol-beta-pm4 (P1 owned kernel+contracts+app+a whole catalog domain) both passed validateShape
// clean; critique named the frozen-contract risk in ref1's problems[] but never blocking[].
//
// touches breadth is `touches[].length` - how many scopes a package claims. bloat fires when a
// package's breadth is >= 2x the sibling median AND >= BLOAT_FLOOR, so a 2-vs-1 split on a
// two-package task (median 1, floor unmet) does not trip it - only a package that is really
// carrying disproportionate scope does.
const BLOAT_FLOOR = 4;

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// max_parallel_width: the DAG's widest round, the same readiness graph.mjs itself would compute
// - a package is ready once every package it deps on has already been placed in an earlier
// round. phase-Teams (QA/audit) are never in `packages` (expandPackages adds task.qa_pkg
// separately, after shape/critique have already reasoned about the shape), so nothing here
// needs to exclude them by hand. A cycle (already a validateShape problem) just stops the walk
// early - this is a signal, not a second validator, so it degrades rather than throws.
export function shapeAnalysis(packages) {
  const pkgs = Array.isArray(packages) ? packages : [];
  const ids = new Set(pkgs.map((p) => String(p && p.id)));
  const touches = pkgs.map((p) => (Array.isArray(p && p.touches) ? p.touches.length : 0));
  const m = median(touches);
  const bloated = pkgs
    .map((p, i) => ({ id: p && p.id != null ? String(p.id) : `#${i}`, touches: touches[i] }))
    .filter((p) => p.touches >= BLOAT_FLOOR && p.touches >= 2 * m);

  const deps = new Map(pkgs.map((p) => [String(p.id), ((p && p.deps) || []).map(String).filter((d) => ids.has(d) && d !== String(p.id))]));
  const placed = new Set();
  let width = 0;
  for (let round = 0; placed.size < deps.size && round <= deps.size; round += 1) {
    const ready = [...deps.keys()].filter((id) => !placed.has(id) && deps.get(id).every((d) => placed.has(d)));
    if (!ready.length) break; // a cycle - validateShape already reports it
    width = Math.max(width, ready.length);
    for (const id of ready) placed.add(id);
  }
  return {
    package_count: pkgs.length,
    touches_median: m,
    max_parallel_width: pkgs.length ? width : 0,
    bloated,
    fully_serial: pkgs.length > 1 && width === 1,
  };
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
  task.nodes.push(node(integrateId, 'integrate', acceptIds, { subgoal_id: null }));
  // roles.qa (§2): a QA phase-Team runs once over the integrated tree, between integrate and
  // the goal gate - same synthetic-package pattern as planning_pkg (§0.1), reusing repairWorktree
  // rather than a fresh worktree since QA's tree IS the integration tree.
  let goalGateDep = integrateId;
  if (task.team && task.team.opts && task.team.opts.roles && task.team.opts.roles.qa) {
    task.qa_pkg = {
      id: 'QA', phase: 'qa', flow: 'qa', integration_of: integrateId, title: 'QA',
      brief: 'Run the goal-level QA pass over the integrated result: exercise it the way a user would and report defects.',
      acceptance: ['the integrated result has been exercised end to end and defects, if any, are reported'],
      deps: [], touches: [],
    };
    goalGateDep = pushChain(task, PACKAGE_CHAIN, 'QA', round, [integrateId], [], {});
  }
  const goalGate = `gate:goal:${nextIndex(task, 'gate:goal')}`;
  const reportId = round === 1 ? 'report' : `report:${round}`;
  task.nodes.push(node(goalGate, 'gate', [goalGateDep], { subgoal_id: null }));
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

// The dispatch that opened this package in the CURRENT shape round: expandPackages gives every
// first dispatch of a round the live critique as a dep. A reshape leaves the old round's nodes
// skipped in place, so "the first dispatch of this package" is the discarded round's.
function roundDispatch(task, pkgId) {
  const critique = task.nodes.filter((n) => n.stage === 'critique' && n.state !== 'skipped').pop();
  const mine = task.nodes.filter((x) => x.subgoal_id === pkgId && x.stage === 'dispatch');
  return (critique && mine.find((x) => x.deps.includes(critique.node_id))) || mine[0] || null;
}

function retryPackage(task, pkgId, feedback) {
  const prior = task.nodes.filter((n) => n.subgoal_id === pkgId && n.stage === 'accept');
  const attempt = Math.max(0, ...prior.map((n) => n.attempt || 1)) + 1;
  // The budget is per shape round. idol-pm-4 (2026-09-23) reshaped twice, and counting every
  // accept node ever pushed spent a retry of each package on rounds it never ran in.
  const first = roundDispatch(task, pkgId);
  const spent = attempt - ((first && first.attempt) || 1);
  if (spent > task.max_retries) {
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
  // Deps come from this round's dispatch. Copying the package's first-ever dispatch wired
  // idol-pm-4's retries to `critique` and `accept:P1:1` - both skipped by the reshape - so four
  // retries sat pending forever and the daemon ended the task blocked with budget left.
  const baseDeps = first ? first.deps.slice() : ['critique'];
  // rollback (docs/plans/2026-09-23-teams-reducer-human-rollback.md §5, item 3): the new
  // dispatch's worktree (openChild, ensureWorktree) is the SAME one every attempt of this
  // package ever ran in - "continue" is what happens if rollback_to is left unset here, exactly
  // as it always has. When the task's retry_policy is 'rollback', point the new attempt at the
  // last commit this package actually had accepted (commitWorktree only ever commits on
  // accept:true - taskmanager.mjs's foldChild), or its worktree's own base commit if none of its
  // attempts ever passed. openChild performs the actual reset when it sees this field on a
  // reused worktree.
  const policy = (task.team && task.team.opts && task.team.opts.retry_policy) === 'rollback' ? 'rollback' : 'continue';
  let rollbackTo = null;
  if (policy === 'rollback') {
    const goodAccepts = task.nodes.filter((n) => n.subgoal_id === pkgId && n.stage === 'accept' && n.state === 'done' && n.result && n.result.commit);
    const lastGood = goodAccepts.sort((a, b) => (a.attempt || 1) - (b.attempt || 1)).pop();
    const anyDispatch = task.nodes.find((n) => n.subgoal_id === pkgId && n.stage === 'dispatch' && n.base_commit);
    rollbackTo = (lastGood && lastGood.result.commit) || (anyDispatch && anyDispatch.base_commit) || null;
  }
  const accept = pushChain(task, PACKAGE_CHAIN, pkgId, attempt, baseDeps, [], { feedback: feedback || '' });
  if (rollbackTo) {
    const dispatchNode = task.nodes.find((x) => x.node_id === `dispatch:${pkgId}:${attempt}`);
    if (dispatchNode) dispatchNode.rollback_to = rollbackTo;
  }
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
  return { task: saveRun(task), attempt, reason: '', ...(rollbackTo ? { rollback_to: rollbackTo } : {}) };
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
  if (r.judge_failed === true) {
    return { error: `${last.node_id} was never judged (${String(r.reason || '').slice(0, 120)}); it is re-judged, not repaired.` };
  }
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

// Opens a fresh `integrate:N` depending on `acceptIds` and reroutes every node that referenced
// `oldId` in its deps/after (gate:goal chief among them) to the fresh integrate instead -
// marking `supersedes: oldId` for evidence. The one move both a repair (one package's accept)
// and a filed defect STORY (one or more packages' accepts, §5b) make once their fix needs a
// fresh combined tree: openRepair and fileDefects both call this instead of each inlining their
// own copy of the rewiring loop.
function reintegrateBehind(task, oldId, acceptIds, feedback) {
  const fresh = `integrate:${nextIndex(task, 'integrate')}`;
  task.nodes.push(node(fresh, 'integrate', acceptIds.slice(), { subgoal_id: null, feedback: feedback || '', supersedes: oldId }));
  for (const x of task.nodes) {
    if (x.node_id === fresh) continue;
    x.deps = x.deps.map((d) => (d === oldId ? fresh : d));
    x.after = (x.after || []).map((d) => (d === oldId ? fresh : d));
  }
  return fresh;
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
  const fb = [r.reason, ...(r.gaps || []), ...(r.checks || [])].filter(Boolean).join('\n- ');
  const fresh = reintegrateBehind(task, integ.node_id, [accept], fb);
  return { task: saveRun(task), package_id: id, integrate: fresh, reason: '' };
}

// The daemon's own route out of a failed package - the move tm_retry({package_id}) makes for a
// caller, made by the loop itself. A package attempt fails two ways the manager can act on: its
// dispatch folded failed (the child ran out of its own gate retries and blocked, or its driver
// died past its restart budget), or its accept rejected. Either way, while retryPackage's
// max_retries budget allows, the next attempt opens with the last verdict's reason and gaps as
// feedback, exactly as the tool would; when the budget is spent retryPackage settles the
// failure so runState reads blocked for good. Skipped: a dispatch that failed on a merge conflict
// (a shape problem no retry fixes), a repair package (openRepair owns its budget), and any
// package that already has a later attempt. trap-beta-T1 (2026-09-21) stopped here: P1's child
// spent three gate attempts, folded failed, and the daemon recorded daemon_done on a task with a
// whole max_retries budget untouched.
// A failed shape or critique has the same shape as a failed package: the engine already knows
// how to recover (retryShape carries the verdict into the next attempt) and already knows what
// to say. Only tm_retry ever called it, so with the daemon owning the loop since v0.16.0 a
// critique that found real defects simply stopped the task and waited for a person - idol-pm-1
// (2026-09-22) named three blocking defects in the shape and sat blocked with the fix in hand.
// This is autoRepair/autoRetryPackages for the shaping pair, budgeted the same way.
export function autoReshape(task) {
  // A stopped box opens nothing new (see autoRetryPackages): a repair or reshape now would sit
  // undispatched with the task reading running forever. enforceBudget closes it to the report.
  if (task.budget_stopped) return false;
  if (task.s_run) return false;
  // A judge that could not judge is not a verdict on the shape, exactly as it is not one on a
  // package (autoRetryPackages skips the same result for the same reason). autoRejudge owns the
  // node while its rejudge budget lasts - and it deliberately waits a minute (or a usage-limit
  // reset) before reopening, so within that window this function would otherwise find a 'failed'
  // shape/critique and spend a whole reshape attempt on it, carrying "judge process did not
  // finish within 45m and was killed" into the next shape as if it were a critique. idol-pm-1
  // (2026-09-22) hit the 45m judge timeout twice in 247 minutes; under this code that is two of
  // the three shaping attempts gone to a timeout string. Once the rejudge budget IS spent there
  // is no verdict coming, and reshaping is the only move left - so reshape then.
  const judgeStuck = (n) => n.result.judge_failed === true && (n.judge_attempts || 0) < JUDGE_ATTEMPTS_MAX;
  const source = task.nodes.filter((n) => (n.stage === 'critique' || n.stage === 'shape') && n.state === 'failed' && n.result && !n.final && !judgeStuck(n)).pop();
  if (!source) return false;
  // Nothing else may still be moving: a live dispatch belongs to the shape being replaced.
  if (task.nodes.some((n) => n.state === 'running')) return false;
  const fb = [source.result.reason || '', ...(source.result.blocking || []), ...(source.result.shape_problems || []), ...(source.result.problems || [])]
    .filter(Boolean).join('\n- ');
  const out = retryShape(task, fb);
  record(task, { event: out.attempt ? 'auto_reshape' : 'tm_settle', task_id: task.run_id, target: 'shape', attempt: out.attempt, from: source.node_id });
  return !!out.attempt;
}

export function autoRetryPackages(task) {
  // A stopped box dispatches nothing new (advanceDispatches), so a retry opened now could never
  // run - code-sprint-S2 opened PLAN attempt 3 after budget_stopped, and it sat pending. The
  // failure stands as this Sprint's outcome and enforceBudget carries the rest to the report.
  if (task.budget_stopped) return false;
  let changed = false;
  // The phase-Team packages belong here for the same reason packageOf() has to know them: they
  // are dispatched and accepted exactly like a package, they just do not live in the list shape
  // owns. Without them a rejected accept:PLAN (or QA, or AUDIT) had no route forward at all -
  // the daemon would record daemon_done on a task whose whole retry budget was untouched, the
  // same wedge autoRepair/autoReshape were written to close. Reachable from the accept floor
  // below, which is the first thing that rejects a PLAN fold on a number rather than a verdict.
  const packages = [task.planning_pkg, task.qa_pkg, task.audit_pkg, ...((task.spec && task.spec.packages) || [])].filter(Boolean);
  for (const pkg of packages) {
    if (pkg.repair) continue;
    const pid = String(pkg.id);
    const mine = task.nodes.filter((n) => n.subgoal_id === pid && (n.stage === 'dispatch' || n.stage === 'accept'));
    if (!mine.length) continue;
    const lastAttempt = Math.max(...mine.map((n) => n.attempt || 1));
    const latest = mine.filter((n) => (n.attempt || 1) === lastAttempt);
    const failed = latest.find((n) => n.state === 'failed' && n.result && !n.final);
    if (!failed) continue;
    if (latest.some((n) => n.state === 'running' || n.state === 'pending' || n.state === 'ready') && failed.stage === 'dispatch') {
      // accept of this attempt still open behind a failed dispatch cannot be - but guard anyway
    }
    if ((failed.result.conflicts || []).length) continue;
    if (failed.result.waiting_capacity) continue;
    if (failed.result.judge_failed === true) continue; // no verdict yet - autoRejudge owns it
    // A failed dispatch:QA whose child actually ran execute and recorded defects (foldChild's
    // defectsFound, carried onto this node as result.defects) is not a package to retry - its
    // case set already found what it was sent to find. Before this check, a rejected or
    // blocked dispatch:QA looped straight back into retryPackage, opening a fresh dispatch:QA
    // on the SAME integrated tree to run the SAME case set again - accept:QA (the only place
    // that normally files a defect, see finish()'s accept:QA hook above) never runs because its
    // data dep is a failed, not done, dispatch (awake-beta-ref1, 2026-09-24: dispatch:QA:1
    // failed with gaps:[] and the defects nowhere to go, and the daemon opened dispatch:QA:2
    // over the identical bug). File them here instead, capped by qa_rounds the same way
    // accept:QA's own hook caps a passing accept that reports defects - a dispatch that never
    // reached accept must not get a second, uncapped route to the same file.
    if (pkg.phase === 'qa' && failed.stage === 'dispatch' && Array.isArray(failed.result.defects) && failed.result.defects.length) {
      const qaAttempts = task.nodes.filter((x) => x.stage === 'dispatch' && x.subgoal_id === 'QA').length;
      const cap = Number.isInteger(task.team && task.team.opts && task.team.opts.qa_rounds)
        ? task.team.opts.qa_rounds : TEAM_DEFAULTS.qa_rounds;
      // The accept node this failed dispatch was gating can never become ready now - its one
      // data dep is a failed dispatch, and `settled` (graph.mjs) never counts a plain `failed`
      // as done. Retire it in place, the same words retryPackage uses for a superseded attempt,
      // so it does not sit `pending` forever confusing tm_status/tm_board.
      for (const sib of latest) {
        if (sib.state === 'pending') {
          sib.state = 'skipped';
          sib.result = { stage_ok: false, reason: 'its dispatch found defects; filed directly instead of judged' };
        }
      }
      failed.final = true;
      const records = failed.result.defects.map((d) => ({ title: d.length > 120 ? `${d.slice(0, 117)}...` : d, evidence: d }));
      if (qaAttempts > cap) {
        task.unresolved_defects = (task.unresolved_defects || []).concat(records.map((d) => ({ ...d, round: qaAttempts })));
        saveRun(task);
        record(task, { event: 'daemon_retry_settled', task_id: task.run_id, package_id: pid, reason: 'qa_rounds exhausted with unresolved defects', failed_node: failed.node_id });
      } else {
        const out = fileDefects(task, records, { reporter: 'qa' });
        record(task, { event: 'daemon_defects_filed', task_id: task.run_id, package_id: pid, filed: out.filed, failed_node: failed.node_id });
      }
      changed = true;
      continue;
    }
    // §upstream_defects: a package whose dispatch failed (its own acceptance could not pass
    // while an upstream dependency was broken - not the QA case above, but the same wedge for an
    // ordinary develop package: awake-beta-ref2, 2026-09-25) carries them the same way foldChild
    // carries QA's defects through regardless of the fold's own accept/reject verdict. File the
    // fix and reopen this package's own next attempt wired onto it, instead of the blind retry
    // below reopening the SAME impossible attempt against the SAME broken upstream a third time.
    if (failed.stage === 'dispatch' && Array.isArray(failed.result.upstream_defects) && failed.result.upstream_defects.length) {
      const out = fileUpstreamDefects(task, pid, failed.result.upstream_defects);
      if (out.downstream_attempt) {
        record(task, {
          event: 'daemon_upstream_defects_filed', task_id: task.run_id, package_id: pid,
          filed: out.filed, targeted: out.targeted, downstream_attempt: out.downstream_attempt, failed_node: failed.node_id,
        });
        changed = true;
        continue;
      }
      // Every upstream package this attempt named was already at its own upstream_fix_rounds
      // cap (recorded onto task.unresolved_defects by fileUpstreamDefects), or named no real
      // package id at all - nothing left to file or wire. Fall through to the ordinary retry
      // below, same as before this existed.
    }
    const fb = [failed.result.reason || '', ...(failed.result.gaps || [])].filter(Boolean).join('\n- ');
    const out = retryPackage(task, pid, fb);
    record(task, {
      event: out.attempt ? 'daemon_retry_opened' : 'daemon_retry_settled', task_id: task.run_id,
      // The feedback the retry was opened ON, not just retryPackage's own settle reason (set only
      // when it declines): every daemon_retry_opened read reason:"" before (trap, idol-beta-ask1),
      // so a person reading tm_events saw a retry and never why.
      package_id: pid, attempt: out.attempt || null, reason: String(out.reason || fb || '').slice(0, 400), failed_node: failed.node_id,
    });
    changed = true;
  }
  return changed;
}

// Clears a parked-on-capacity driver (every waiting child, or one package's, or the s_run)
// and respawns it on the same run_id - none of it counts against driver_restarts. Shared by
// tm_retry({reset_capacity:true}) and the daemon's own autoResumeCapacity.
export function clearCapacity(task, packageId) {
  const resumed = [];
  const a = { package_id: packageId };
    if (task.s_run && task.s_run.waiting_capacity && (!a.package_id || String(a.package_id) === 'S')) {
      record(task, { event: 'child_driver_capacity_cleared', task_id: task.run_id, node_id: 'S', was: task.s_run.waiting_capacity });
      delete task.s_run.waiting_capacity;
      if (!noDriver()) {
        const restarts = (task.s_run.driver && task.s_run.driver.restarts) || [];
        const fresh = spawnChildDriver(task, 'S', task.s_run, { resume: true, attempt: nextSpawnAttempt(task.s_run) });
        fresh.restarts = restarts;
        task.s_run.driver = fresh;
        delete task.s_run.stalled_since;
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
        delete n.child.stalled_since;
        record(task, { event: 'child_driver_restarted', task_id: task.run_id, node_id: n.node_id, pid: fresh.pid, reason: 'reset_capacity' });
      }
      resumed.push(n.node_id);
    }
  return resumed;
}

// "You've hit your session limit · resets 5:40pm (UTC)" / "resets 11:50pm (Asia/Seoul)" -> the
// epoch ms of that wall-clock time in that zone, the first occurrence after `since`. Unparseable
// -> since + 30 minutes, the same fallback drive.sh uses.
export function capacityResetAt(reason, since) {
  // Minutes are optional: idol-beta-ask1's P6 read "resets 3pm (UTC)", fell to the 30-minute
  // fallback, resumed an hour early and hit the limit again four seconds later.
  const m = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?/i.exec(String(reason || ''));
  const base = Number(since) || Date.now();
  if (!m) return base + 30 * 60 * 1000;
  let h = Number(m[1]) % 12; if (m[3].toLowerCase() === 'pm') h += 12;
  const min = Number(m[2] || 0);
  const tz = m[4] || 'UTC';
  // Walk the zone's wall clock: find the offset at `since`, build the candidate, roll a day if past.
  const wall = (ms) => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
      const g = (t) => Number(parts.find((x) => x.type === t).value);
      return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute') };
    } catch { return null; }
  };
  const w = wall(base);
  if (!w) return base + 30 * 60 * 1000;
  // zone offset at `since`: (wall clock as if UTC) - actual
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  const offset = asUtc - Math.floor(base / 60000) * 60000;
  let candidate = Date.UTC(w.y, w.mo - 1, w.d, h, min) - offset;
  if (candidate <= base) candidate += 24 * 60 * 60 * 1000;
  return candidate;
}

const CAPACITY_GRACE_MS = 3 * 60 * 1000;

// The daemon's own tm_retry({reset_capacity:true}): once the reset time a provider named has
// passed (plus a few minutes' grace), clear the park and respawn - the caller no longer has to
// notice. trap-beta-T2 (2026-09-21) sat 1h51m on "resets 5:40pm (UTC)" after the reset because
// nothing in the loop read the clock.
export function autoResumeCapacity(task, now = Date.now()) {
  const due = (w) => w && now >= capacityResetAt(w.reason, w.since) + CAPACITY_GRACE_MS;
  let resumed = [];
  if (task.s_run && due(task.s_run.waiting_capacity)) resumed = resumed.concat(clearCapacity(task, 'S'));
  for (const n of task.nodes) {
    if (n.stage !== 'dispatch' || n.state !== 'running' || !n.child || !due(n.child.waiting_capacity)) continue;
    resumed = resumed.concat(clearCapacity(task, String(n.subgoal_id)));
  }
  if (!resumed.length) return false;
  saveRun(task);
  record(task, { event: 'daemon_capacity_resumed', task_id: task.run_id, resumed });
  return true;
}

const JUDGE_ATTEMPTS_MAX = 2;

// A judging node whose judge could not judge (process failed, timed out, replied without JSON,
// or answered with a usage-limit notice) has no verdict - it is not a refusal, and the moves a
// refusal triggers (a repair package, a package retry) must not fire on it. The daemon marks
// such results judge_failed:true; this reopens the node for another single-shot judge, at most
// JUDGE_ATTEMPTS_MAX more times, after a usage-limit reset when the reply named one. trap-beta-T2:
// integrate:1's judge hit the session limit and autoRepair opened a repair package on it.
// The earliest time autoRejudge will reopen a failed judge that still has attempts left, or
// null. The daemon's loop reads "not running" as done; a judge failure waiting out its 60s
// back-off (or a usage-limit reset) is not done - code-sprint-S5's daemon recorded daemon_done
// blocked seconds after integrate:2's re-judge was scheduled, so the re-judge never came.
export function pendingRejudgeAt(task) {
  let at = null;
  for (const n of task.nodes) {
    if (n.state !== 'failed' || !n.result || n.result.judge_failed !== true) continue;
    if ((n.judge_attempts || 0) >= JUDGE_ATTEMPTS_MAX) continue;
    const reason = String(n.result.reason || '');
    const t = /session limit|usage limit|resets\s+\d/i.test(reason)
      ? capacityResetAt(reason, n.finished_at || Date.now()) + CAPACITY_GRACE_MS
      : (n.finished_at || 0) + 60 * 1000;
    if (at === null || t < at) at = t;
  }
  return at;
}

export function autoRejudge(task, now = Date.now()) {
  let changed = false;
  for (const n of task.nodes) {
    if (n.state !== 'failed' || !n.result || n.result.judge_failed !== true) continue;
    if ((n.judge_attempts || 0) >= JUDGE_ATTEMPTS_MAX) continue;
    const reason = String(n.result.reason || '');
    const at = /session limit|usage limit|resets\s+\d/i.test(reason)
      ? capacityResetAt(reason, n.finished_at || now) + CAPACITY_GRACE_MS
      : (n.finished_at || 0) + 60 * 1000;
    if (now < at) continue;
    n.judge_attempts = (n.judge_attempts || 0) + 1;
    n.judge_failures = (n.judge_failures || []).concat([{ at: n.finished_at || null, reason: reason.slice(0, 300) }]);
    n.state = 'pending';
    n.reopened = (n.reopened || 0) + 1; // mergeOnto's one legitimate terminal -> pending path
    delete n.result; delete n.finished_at; delete n.started_at;
    record(task, { event: 'daemon_rejudge', task_id: task.run_id, node_id: n.node_id, attempt: n.judge_attempts, reason: reason.slice(0, 200) });
    changed = true;
  }
  if (changed) saveRun(task);
  return changed;
}

// The daemon's own route out of a refused integrate. tm_retry({package_id: "integration"}) is the
// same move made by a caller; the daemon makes it itself, because a task whose integrate refused
// on its checks (verified:false, a combined tree that exists, no merge conflict) is not blocked -
// it has a repair left to try, budgeted by max_retries exactly as openRepair already counts.
// seam-beta-D2 (2026-09-21) stopped here: integrate rightly refused (cli tests hardcoded exit
// numbers), the daemon saw runState "blocked", recorded daemon_done and left, three accepted
// packages one repair short of a report. Returns true when a repair package was opened (or the
// budget was spent and the failure settled) so the daemon knows the graph changed.
export function autoRepair(task) {
  // A stopped box opens nothing new (see autoRetryPackages): a repair or reshape now would sit
  // undispatched with the task reading running forever. enforceBudget closes it to the report.
  if (task.budget_stopped) return false;
  const target = integrateToRepair(task);
  if (!target.node) return false;
  const out = openRepair(task, target.node);
  record(task, {
    event: 'daemon_repair_opened', task_id: task.run_id, integrate: target.node.node_id,
    package_id: out.package_id, integrate_next: out.integrate || null, reason: out.reason || '',
  });
  return true;
}

// ---------- defect STORYs: tm_file and the QA re-loop (v0.12.1 Task 1, §5b) ----------
//
// Files one ordinary develop package per defect - unlike a repair package, each gets its OWN
// fresh worktree (shape's usual package machinery), because a defect fix is normal develop work,
// not a fix to a seam only visible in the combined tree. `reporter` is set instead of `repair:
// true` so the board (tickets.mjs epicBoardRows) and docs can tell a filed STORY apart from one
// shape produced. Reuses reintegrateBehind for the same "detour gate:goal through a fresh
// integrate" move openRepair makes; unlike openRepair this can file more than one package at
// once (one QA gate can report several defects in the same round).
//
// Deliberately does NOT touch QA here: reopening a QA round the moment defects are filed would
// make the QA phase-Team's dispatch "live" at the same time as the defect packages' own dispatch
// nodes - exactly the concurrency the v0.12.1 self-review flags as breaking the
// max_parallel_teams/runningStories phase-Team exemption (taskmanager.mjs's isPhaseTeam block,
// below). Instead the integrate-completion hook in finish() reopens QA lazily, only once the
// fresh integrate this call creates has itself finished - by which point every defect package is
// already done, not running, so the exemption's original premise (a phase-Team dispatch is never
// concurrent with a develop STORY dispatch) keeps holding. See that hook's comment for the rest
// of this argument.
//
// Never itself checks qa_rounds: the cap is the caller's job. The accept:QA:N hook below checks
// it before deciding whether to call this at all; tm_file (a user filing a STORY directly) never
// checks it - a user-filed STORY is not a QA round (v0.12.1 self-review's open risk on tm_file
// vs qa_rounds, resolved here: tm_file always proceeds, uncapped).
function fileDefects(task, defects, opts) {
  const reporter = (opts && opts.reporter) || 'you';
  const packages = task.spec.packages;
  const goal = task.nodes.filter((n) => n.stage === 'gate' && n.subgoal_id == null).pop();
  if (!goal) throw new Error('this task has not reached goal level yet - there is no gate:goal to reroute a filed STORY behind');
  const oldDep = goal.deps[0];
  const acceptIds = [];
  const filed = [];
  for (const d of defects) {
    const id = `D${packages.filter((p) => p.reporter).length + 1}`;
    const evidence = d && d.evidence ? String(d.evidence) : '';
    const title = (d && d.title) || `defect ${id}`;
    const pkg = {
      id,
      title,
      reporter,
      flow: task.flow_chosen || 'auto',
      brief: [
        `This package fixes a defect filed against this task's integrated result.`,
        `Title: ${title}`,
        d && d.severity ? `Severity: ${d.severity}` : '',
        evidence ? `Evidence:\n${evidence}` : '',
      ].filter(Boolean).join('\n'),
      // §5b: acceptance is that the reproduction QA (or the filer) gave stops reproducing.
      acceptance: [evidence ? `the reproduction below no longer reproduces the defect:\n${evidence}` : `"${title}" no longer reproduces`],
      touches: ((d && d.touches) || []).map(String),
      deps: ((d && d.deps) || []).map(String),
    };
    packages.push(pkg);
    filed.push(pkg);
    // Every named dep is a sibling package id, resolved to ITS current accept the same way a
    // shape-declared package's deps are resolved in expandPackages - all of them are already
    // done by the time a goal-level defect can even be filed, so this always finds one.
    const headDeps = pkg.deps.map((dep) => { const acc = latestBySubgoal(task, dep, 'accept'); return acc ? acc.node_id : null; }).filter(Boolean);
    acceptIds.push(pushChain(task, PACKAGE_CHAIN, id, 1, headDeps, [], { feedback: '' }));
  }
  const feedback = defects.map((d) => `${(d && d.title) || ''}${d && d.evidence ? `: ${d.evidence}` : ''}`).filter(Boolean).join('\n- ');
  const fresh = reintegrateBehind(task, oldDep, acceptIds, feedback);
  // acceptIds (parallel to `filed`, same order) is what fileUpstreamDefects reads to rewire a
  // downstream package's own next attempt onto the fix instead of the upstream package's stale
  // accept - every other caller ignores the extra key.
  return { task: saveRun(task), filed: filed.map((p) => p.id), acceptIds: acceptIds.slice(), integrate: fresh };
}

// ---------- upstream defects: a downstream package's own fix-forward route (§upstream_defects) ----------
//
// A package's dispatch (implement/test/gate, or the manager's own accept judging it) can name a
// defect it found OUTSIDE its own touches[], in a package it deps on - a frozen-contract problem
// no downstream package may fix in its own worktree (this package's files are not in scope
// there). awake-beta-ref2 (2026-09-25): P3 (adapters) was ACCEPTED at 93 identifying Claude Code
// processes by kernel comm=='claude', but on P4's host the real CLI's kernel comm is a version
// string; P4 proved it, but had no route but to fail its own dispatch against a package it could
// not touch, twice, and the daemon just reopened the identical, impossible retry a third time.
//
// This is the fix-forward route: file a fix STORY owned by the UPSTREAM package's own scope
// (touches from that package, deps on that package - reusing fileDefects/reintegrateBehind, the
// same machinery a QA-found defect already takes), then reopen the DOWNSTREAM package's own next
// attempt with its deps rewired onto the fix's accept instead of the upstream package's now-
// superseded one - so it waits for the fix and re-runs against it, instead of retrying blind
// against the same broken upstream. Capped per upstream package by team.opts.upstream_fix_rounds
// (teamconfig.mjs), the same way qa_rounds caps a QA round that keeps finding the same defect:
// beyond it, recorded onto task.unresolved_defects instead of filed, and the caller (finish()'s
// accept hook, or autoRetryPackages' failed-dispatch branch) falls back to its own ordinary path.
//
// Returns {filed, targeted, downstream_attempt} - `targeted` is the upstream package ids a fix
// was actually filed against this call (empty when every one of them was already at cap), and
// `downstream_attempt` is the new dispatch:<downstreamPid>:N this opened, or null when nothing
// was filed (nothing to wire the downstream package behind).
function fileUpstreamDefects(task, downstreamPid, defects) {
  const cap = Number.isInteger(task.team && task.team.opts && task.team.opts.upstream_fix_rounds)
    ? task.team.opts.upstream_fix_rounds : TEAM_DEFAULTS.upstream_fix_rounds;
  const byUpstream = new Map();
  for (const d of Array.isArray(defects) ? defects : []) {
    const upstreamId = d && d.package != null ? String(d.package) : '';
    if (!upstreamId || upstreamId === String(downstreamPid)) continue; // no id, or a package naming itself
    if (!byUpstream.has(upstreamId)) byUpstream.set(upstreamId, []);
    byUpstream.get(upstreamId).push(d);
  }
  const records = [];
  const targeted = [];
  for (const [upstreamId, group] of byUpstream) {
    const upstreamPkg = packageOf(task, upstreamId);
    if (!upstreamPkg) continue; // not a real package id in this task - nothing to file against
    // Rounds already run against THIS upstream package - every prior fix STORY fileUpstreamDefects
    // itself filed, regardless of which downstream package found the next one. Read off the
    // packages list, the same way qaAttempts (autoRetryPackages) counts dispatch:QA nodes: a
    // filed fix package's own deps names the upstream id it was filed against (see `records`
    // below), so this needs no extra bookkeeping field of its own.
    const priorRounds = (task.spec.packages || []).filter((p) => p.reporter === 'upstream' && (p.deps || []).map(String).includes(upstreamId)).length;
    if (priorRounds >= cap) {
      task.unresolved_defects = (task.unresolved_defects || []).concat(group.map((d) => ({
        title: (d && d.title) || `upstream defect in ${upstreamId}`, evidence: (d && d.evidence) || '',
        reporter: 'upstream', upstream: upstreamId, reported_by: String(downstreamPid), round: priorRounds + 1,
      })));
      record(task, { event: 'upstream_fix_rounds_exhausted', task_id: task.run_id, package_id: String(downstreamPid), upstream: upstreamId, filed: priorRounds });
      continue;
    }
    targeted.push(upstreamId);
    for (const d of group) {
      records.push({
        title: (d && d.title) || `upstream defect in ${upstreamId}`,
        evidence: (d && d.evidence) || '',
        // The upstream package's OWN scope, not the downstream reporter's: the fix has to land
        // in the files the defect actually lives in, and touches[] is what shape's own rule
        // (CONTRACT.shape) already uses to say who owns what.
        touches: (d && Array.isArray(d.touches) && d.touches.length ? d.touches : upstreamPkg.touches) || [],
        deps: [upstreamId],
      });
    }
  }
  if (!records.length) return { filed: [], targeted: [], downstream_attempt: null };
  const out = fileDefects(task, records, { reporter: 'upstream' });
  const fixAcceptsByUpstream = {};
  out.acceptIds.forEach((accId, i) => {
    const upstreamId = records[i].deps[0];
    (fixAcceptsByUpstream[upstreamId] = fixAcceptsByUpstream[upstreamId] || []).push(accId);
  });
  // Reopen the downstream package's own next attempt - retryPackage's usual move (supersede the
  // open attempt, keep its retry budget, reopen a failed integrate that blamed it) EXCEPT for its
  // deps: retryPackage would copy the package's very FIRST dispatch's deps unchanged, which is
  // exactly the stale accept:<upstream>:N this whole mechanism exists to stop retrying against.
  const feedback = `blocked on a defect this package found outside its own scope, in ${targeted.join(', ')}: waiting for the fix package(s) filed against ${targeted.join(', ')} to be accepted before retrying.`;
  const retried = retryPackage(task, downstreamPid, feedback);
  if (retried.attempt) {
    const dispatchNode = task.nodes.find((x) => x.node_id === `dispatch:${downstreamPid}:${retried.attempt}`);
    if (dispatchNode) {
      const rewritten = [];
      for (const dep of dispatchNode.deps) {
        const m = /^accept:(.+):\d+$/.exec(dep);
        if (m && fixAcceptsByUpstream[m[1]]) rewritten.push(...fixAcceptsByUpstream[m[1]]);
        else rewritten.push(dep);
      }
      dispatchNode.deps = [...new Set(rewritten)];
      saveRun(task);
    }
  }
  return { task, filed: out.filed, targeted, downstream_attempt: retried.attempt || null };
}

// ---------- the audit phase-Team: planning's second pass (v0.12.1 Task 2, §2, §3) ----------
//
// Opens AUDIT in front of gate:goal, the same shape the QA phase-Team takes, once the node
// gate:goal currently hangs on has finished - the last accept:QA:N when roles.qa is on, the
// integrate itself when it is off. Gated on roles.planning ALONE (team leader decision #4): the
// audit is planning's own second pass over the EPIC, so hanging it off roles.qa would delete a
// planning stage the user never asked to turn off. The QA report is consumed when one exists and
// is simply absent when it does not - which is also why the brief is built here, at open time,
// rather than at shape: only now is there an integrated result and (maybe) a QA verdict to name.
// routing.mjs's AUTHOR_OF cannot see this run's author: audit's author - the PLAN package's
// draft/revise - ran in a sibling child run, folded away before this one ever opens, so there
// is no in-run peer sharing a subgoal_id the way every other judging stage's actor lookup finds
// one. Read that run once, here, before it is gone (it stays on disk, but there is no reason to
// re-open it every time audit routes a candidate) - revise's identity wins over draft's when
// both exist, the same precedence parentShapedChild gives revise's handoff over draft's, because
// revise is the last hand that actually wrote what audit is now reading.
function planAuthorIdentity(task) {
  const planDispatch = latestBySubgoal(task, 'PLAN', 'dispatch');
  if (!planDispatch || !planDispatch.child) return null;
  const planRun = loadRun(planDispatch.child.cwd, planDispatch.child.run_id);
  if (!planRun || !Array.isArray(planRun.nodes)) return null;
  const author = planRun.nodes.filter((x) => x.stage === 'revise' && x.state === 'done').pop()
    || planRun.nodes.filter((x) => x.stage === 'draft' && x.state === 'done').pop();
  if (!author) return null;
  return { executor: author.executor || null, vendor: author.vendor || null, model: author.model || null };
}

function openAudit(task, afterNodeId) {
  const integ = task.nodes.filter((x) => x.stage === 'integrate' && x.state === 'done' && x.integration).pop();
  const planDispatch = latestBySubgoal(task, 'PLAN', 'dispatch');
  const stories = (planDispatch && planDispatch.result && Array.isArray(planDispatch.result.user_stories))
    ? planDispatch.result.user_stories : [];
  const qaAccept = task.nodes.filter((x) => x.stage === 'accept' && x.subgoal_id === 'QA' && x.state === 'done' && x.result).pop();
  const L = [
    `This is planning's second pass over this task: cross-check what was actually built against the PRD this same Team wrote, and say which user stories are still unmet.`,
    '',
    // awake-beta-ref2 AUDIT:2 (2026-09-25): after a fix round, setgoal listed the source files it
    // meant to inspect in files[], the document-path rule rejected the spec, and the audit ended
    // blocked - the same split planning's own setgoal learned in idol-pm-3.
    `Each audit subgoal's files[] is only the markdown report it writes. The code, tests and documents it must inspect go in that subgoal's sources[] - never in files[].`,
    '',
    'User stories the PRD produced:',
    bullets(stories),
  ];
  if (qaAccept) {
    const r = qaAccept.result;
    L.push('', `The goal-level QA pass has already run (${qaAccept.node_id}). Its verdict, as further evidence - a story whose files exist can still be unmet:`);
    L.push(`- accept: ${r.accept === true} (match ${r.match_pct == null ? '?' : r.match_pct})`);
    if ((r.gaps || []).length) L.push('Gaps it named:', bullets(r.gaps));
    if ((r.defects || []).length) L.push('Defects it reported:', bullets(r.defects.map((d) => (d && d.title) || String(d))));
  }
  task.audit_pkg = {
    id: 'AUDIT', phase: 'audit', flow: 'audit', integration_of: integ ? integ.node_id : null,
    title: 'planning audit',
    brief: L.join('\n'),
    acceptance: ['every user story in the PRD is judged against the integrated result, and the unmet ones are named'],
    deps: [], touches: [],
    // Threaded into the audit child run by openChild as `external_author` - routing.mjs's
    // externalAuthorOf reads it to route audit away from this identity when a peer vendor is
    // available, and broker.mjs's reviewIndependence records reviewer_independence on the audit
    // node's result either way, the same "route away where possible, record it regardless"
    // pattern review/revise already runs for their own in-run author.
    author_identity: planAuthorIdentity(task),
  };
  const accept = pushChain(task, PACKAGE_CHAIN, 'AUDIT', nextIndex(task, 'dispatch:AUDIT'), [afterNodeId], [], {});
  const goal = task.nodes.filter((x) => x.stage === 'gate' && x.subgoal_id == null).pop();
  if (goal) goal.deps = [accept];
  return accept;
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
export function noDriver() { return process.env.HARNESS_TEST_NO_DRIVER === '1'; }

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
// .teams_output/ (the usual case), git refuses `:!.teams_output` as "a path that is ignored" and
// exits 1 before staging anything. The first e2e task to reach a fold failed exactly there,
// with both children accepted and nothing committed.
// Everything under the worktree that is harness state rather than delivered work. .teams_output
// and the marker dir are always relative; the tasks root usually is not - it defaults to
// ~/.harness/tasks, outside any project - but HARNESS_TASKS_DIR can put it inside the tree, and
// then a fold commits the whole manager: idol-pm-1's planning commit (2026-09-22) carried 1,520
// lines of task.json, board/ledger jsonl and a 1,326-line raw vendor stream log alongside the
// 220-line PRD that was the only thing anyone wanted.
export function harnessPathsUnder(cwd) {
  const paths = ['.teams_output', '.claude/.harness-markers'];
  // Both sides as realpaths. On macOS $TMPDIR is /var/..., which is /private/var/...; a package's
  // cwd arrives as the realpath and HARNESS_TASKS_DIR as given, so relative() walked out through
  // `..` and called the manager's own state outside the tree. idol-pm-4 (2026-09-23) committed
  // eight .harness-tasks files into P1's product branch that way - the same /var trap 0.8.1 hit.
  // A path that does not exist yet resolves through its nearest existing ancestor.
  const real = (p) => {
    const abs = resolve(p);
    try { return realpathSync(abs); } catch { /* not there yet */ }
    const up = dirname(abs);
    return up === abs ? abs : join(real(up), basename(abs));
  };
  try {
    const rel = relative(real(cwd), real(tasksRoot()));
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) paths.push(rel);
  } catch { /* an unresolvable root is simply not inside this tree */ }
  return paths;
}

// `git add`/`rm --cached`/`commit` each take the worktree's index.lock. Two processes folding
// the same child at the same moment - daemon.mjs's fold loop against a direct tm_submit, a race
// the daemon's header explicitly allows - make the loser fail on "index.lock: File exists" for
// a few milliseconds. That is contention, not a broken tree: wait it out, briefly and boundedly,
// rather than turn a passed package into a failed dispatch.
const INDEX_LOCK_RETRIES = 8;
const INDEX_LOCK_WAIT_MS = 150;
function gitIndexed(cwd, args) {
  let r = git(cwd, args);
  for (let i = 0; !r.ok && /index\.lock/.test(r.err) && i < INDEX_LOCK_RETRIES; i++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, INDEX_LOCK_WAIT_MS);
    r = git(cwd, args);
  }
  return r;
}

export function commitWorktree(cwd, message) {
  const add = gitIndexed(cwd, ['add', '-A', '--', '.']);
  if (!add.ok) return { ok: false, reason: add.err || 'git add failed' };
  // .claude/.harness-markers/ gets the same treatment for the same reason, plus one of its own:
  // every worktree writes its own marker with its own timestamp (engage.mjs), so committing it
  // would make every package branch differ in that one file and every integrate merge conflict
  // on it. install.mjs gitignores it in a real project; a project without it must not break.
  const drop = gitIndexed(cwd, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', ...harnessPathsUnder(cwd)]);
  if (!drop.ok) return { ok: false, reason: drop.err || 'could not leave the harness state out of the commit' };
  const staged = git(cwd, ['diff', '--cached', '--quiet']);
  if (staged.ok) return { ok: true, commit: null }; // nothing to commit is not an error
  const c = gitIndexed(cwd, ['-c', 'user.email=harness@local', '-c', 'user.name=harness', 'commit', '-q', '-m', message]);
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

export function packageOf(task, id) {
  // The planning phase-Team's package lives on task.planning_pkg, not task.spec.packages: its
  // dispatch/accept run before shape, while task.spec is still null (§0.1).
  if (task.planning_pkg && String(task.planning_pkg.id) === String(id)) return task.planning_pkg;
  // Same reasoning for the QA phase-Team's package: expandPackages stashes it on task.qa_pkg
  // rather than pushing it into task.spec.packages, which shape (not the manager) owns.
  if (task.qa_pkg && String(task.qa_pkg.id) === String(id)) return task.qa_pkg;
  // And the audit phase-Team's, for the same reason again: openAudit stashes it on task.audit_pkg
  // when planning's second pass opens, long after shape has closed its own package list.
  if (task.audit_pkg && String(task.audit_pkg.id) === String(id)) return task.audit_pkg;
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
// What the live critique said about ONE package. A critique that passes (sound: true) can still
// name problems - idol-beta-ask1's critique:2 said "raise P4 to at least 10,000 hold+pay flows at
// capacity 100", and P4 was dispatched with its acceptance unchanged at 5,000/50: problems[] was
// read by nobody after the critique node finished. Matched by the package id as a whole word.
export function critiqueNotesFor(task, pkgId) {
  const c = task.nodes.filter((n) => n.stage === 'critique' && n.state === 'done' && n.result).pop();
  if (!c || !pkgId) return [];
  const re = new RegExp(`(^|[^A-Za-z0-9_])${String(pkgId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`);
  const all = [...(c.result.problems || []), ...(c.result.blocking || [])]
    .map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  return all.filter((t) => re.test(t));
}

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
  } else if (pkg.phase === 'planning') {
    // Without this the planning run reads a request that says "implement ..." and does exactly
    // that (first real-vendor run, 2026-09-22: the PLAN child opened implement/test/gate chains
    // and started building the CLI). The request is the thing to PLAN, not the thing to do.
    lines.push(`This is the planning phase-Team. The request above describes work that OTHER packages will build later; your deliverable is this request's planning documents - not the implementation. The PRD is the floor of that set: the problem, the users, user stories with acceptance criteria an engineer can build from, scope and non-goals, risks and open questions. Nothing limits you to one document, and the run decides its own set: when this request's domain has a vocabulary, rules people will argue about, or a stated load condition, those belong in documents of their own rather than compressed into the PRD or dropped into its Out of scope.`);
    lines.push(`Each document in that set is investigated before it is written: its first stage reads the project tree, whatever material this request names or attaches, and the domain's own sources where they are reachable, and comes back with findings that cite where each one came from plus the decisions no source could answer. Those unanswered ones are carried into the documents as open questions with owners. Do not let them be answered by invention instead - a rule a user story rests on that nobody decided is missing whether it is written down or not, and this stage exists because the runs before it wrote hundreds of confident lines naming none of their domain's actual rules.`);
    lines.push(`Change no source files. This run works directly in the project root; the planning documents and the findings files written beside them are the deliverable, and nothing else you write is kept. The user_stories[] you return are what the manager hands to the shape stage that splits the work into packages.`);
  } else if (pkg.phase === 'qa') {
    lines.push(`This worktree is the COMBINED tree of every package in this task: all of their branches are already merged here, on the integration branch itself.`);
    lines.push(`This is the goal-level QA pass, run once over the integrated result. Exercise it the way a user would and report what you find.`);
    lines.push(`Write only to test/ and your own report - src/ and every package's delivered files are read-only here. This is a review, not a repair: a defect you find is reported, not fixed.`);
  } else if (pkg.phase === 'audit') {
    lines.push(`This worktree is the COMBINED tree of every package in this task: all of their branches are already merged here, on the integration branch itself.`);
    lines.push(`This is planning's own second pass over this EPIC, taken after integration. Read the tree against the PRD's user stories in your request above and judge each one: satisfied, partially satisfied, or missing.`);
    lines.push(`You have no edit rights here - not over the tree and not over the PRD. Change no files. An unmet story is reported, not fixed: the manager files it as its own STORY.`);
  } else {
    lines.push(task.base_ref
      ? `The worktree is private to this package and branched from ${task.base_ref} - the prior Sprint's integrated work, which this task builds on; integration happens later, elsewhere.`
      : `The worktree is private to this package and branched from the project's HEAD; integration happens later, elsewhere.`);
  }
  lines.push('');
  lines.push('Package acceptance - what the manager will judge this run against:');
  lines.push(bullets(pkg.acceptance));
  const notes = critiqueNotesFor(task, pkg.id);
  if (notes.length) {
    lines.push('');
    lines.push('The critique of the plan named this about your package. Address each one, or say in your handoff why not - the manager\'s accept reads the same list:');
    lines.push(bullets(notes));
  }
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

export function driverArgv(task = null) {
  // Tests (and anyone with a different CLI) replace the whole command line here; the prompt is
  // always appended as the last argument.
  const override = String(process.env.HARNESS_CHILD_DRIVER || '').trim();
  if (override) return override.split(/\s+/);
  const argv = ['claude', '-p', '--output-format', 'stream-json', '--verbose',
    '--dangerously-skip-permissions', '--setting-sources', 'project'];
  // This server is launched with CLAUDE_PLUGIN_ROOT when it runs from a --plugin-dir; the child
  // needs the same directory to see the same plugin. Without it the plugin is installed.
  argv.push('--plugin-dir', teamsPluginRoot());
  // And every plugin the method tables name (pluginroots.mjs): --setting-sources project hides
  // the user's installed plugins, so without these the child's nodes never see a single skill
  // they are told to load - which is how every bench run before 0.18.0 ran (skills_used none).
  argv.push(...pluginDirArgs({
    skills: [task && task.child_opts && task.child_opts.skills, task && task.stage_skills, Object.values(STAGE_SKILLS)].filter(Boolean),
    extraDirs: (task && task.team && task.team.opts && task.team.opts.plugin_dirs) || [],
  }));
  return argv;
}

// The child's request and context are already in its run file. This says only which run to
// continue and how to drive it - the same words that resume an interrupted bench workspace.
// opts.resume marks a driver spawned in place of one that died before the run finished: the
// run and its worktree already carry whatever that attempt completed, so the new session is
// told to read team_status first rather than redo work.
function driverPrompt(task, child, opts = {}) {
  const o = task.child_opts || {};
  const routing = [
    o.host_vendor ? `host_vendor ${o.host_vendor}` : '',
    o.host_model ? `host_model ${o.host_model}` : '',
    Array.isArray(o.native_models) && o.native_models.length ? `native_models ${o.native_models.join(', ')}` : '',
  ].filter(Boolean);
  return [
    `Use the teams:orchestrate skill, but CONTINUE the graph run that is already open instead of opening one:`,
    `run_id ${child.run_id} at cwd ${child.cwd}. Do not call team_open or tm_open.`,
    opts.resume
      ? `A previous driver for this exact run died before it finished; call team_status({run_id, cwd}) first to see what it already completed, and resume from there - do not redo a node that is already done.`
      : '',
    `Read references/loop.md, then drive team_next/team_run/team_submit exactly as it says until the run is`,
    `complete or blocked - a fresh agent for every ready node, its JSON relayed verbatim to team_submit,`,
    `team_retry as the loop says.`,
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
  const argv = driverArgv(task);
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

export function driverAlive(driver) {
  return !!(driver && driver.pid) && pidAlive(driver.pid);
}

function killDriver(driver) {
  if (!driverAlive(driver)) return false;
  // detached:true made it a group leader, so the whole subtree goes. Best effort either way.
  try { process.kill(-driver.pid, 'SIGTERM'); return true; } catch { /* fall through */ }
  try { process.kill(driver.pid, 'SIGTERM'); return true; } catch { return false; }
}

export function driverStderrTail(driver, chars = 300) {
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

// The restart budget and the restarts that count against it (the sliding window when
// restart_period_minutes > 0 - see serviceDeadDriver). Shared with dispatchSettled, which has to
// know when a dead driver will never be respawned so the dispatch can fold instead of sitting
// 'running' forever: idol-beta-ask1's P6 spent its budget and then stayed running 16h+, because
// dispatchSettled only ever read the child run's own state, which a dead driver never advances.
function restartBudget(task) {
  return Number.isInteger(task.driver_restarts) ? task.driver_restarts : 2;
}

// OTP-style restart intensity: driver_restarts is a flat, forever counter by default
// (restart_period_minutes 0, teamconfig.mjs) - every death this run has ever had counts
// against the budget. >0 makes it a sliding window: only the restarts whose own `at` falls
// inside the last restart_period_minutes count, so a package that dies once an hour for a week
// never exhausts a budget sized for "how many deaths in a row".
function countedDriverRestarts(task, driver) {
  const prior = (driver && driver.restarts) || [];
  const periodMinutes = Number.isInteger(task.restart_period_minutes) ? task.restart_period_minutes : TEAM_DEFAULTS.restart_period_minutes;
  return periodMinutes > 0
    ? prior.filter((r) => Number.isInteger(r.at) && Date.now() - r.at <= periodMinutes * 60000)
    : prior;
}

export function driverRestartsSpent(task, child) {
  const d = child && child.driver;
  if (!d || driverAlive(d) || child.waiting_capacity) return false;
  return countedDriverRestarts(task, d).length >= restartBudget(task);
}

// Called on every tm_next poll (and defensively from foldChild) for a package whose driver is
// no longer alive while its child run is still `running`. Distinguishes three cases:
//   - the driver died because a usage limit was hit: park it on `waiting_capacity`, spend no
//     restart, and wait for tm_retry({reset_capacity:true}).
//   - the driver died for any other reason and the restart budget is not spent: respawn a
//     driver on the SAME run_id with a resume prompt, and record the death on driver.restarts.
//   - the budget is spent: do nothing and let the dispatch fold blocked with every tail.
// Returns true when it changed anything (so the caller knows to persist the task).
export function serviceDeadDriver(task, child, nodeId) {
  const driver = child.driver;
  if (!driver || driverAlive(driver)) return false;
  const run = loadRun(child.cwd, child.run_id);
  const cs = run ? runState(run) : { state: 'missing' };
  // A run parked on a human is not a dead run, and no driver is SUPPOSED to be alive while it
  // waits - that is the whole point of waiting_human (zero compute while waiting). But an answer
  // ALREADY QUEUED for it has nobody to apply it: the handoff queue is drained by the broker, the
  // broker only runs inside a driver, and tm_submit's own revive fires only on the call that
  // queues. idol-beta-ask1 (2026-09-25) is what that looks like - three answers accepted into the
  // queue, the driver killed before it drained them, and no path left that would ever bring one
  // back. So a parked child whose queue is not empty does need a driver; a parked child whose
  // queue is empty correctly gets none.
  if (cs.state === 'waiting_human') {
    if (!peekHumanActions(child.cwd, child.run_id).length) return false;
  } else if (cs.state !== 'running') {
    return false; // the run finished; an ordinary fold reads that
  }
  if (child.waiting_capacity) return false; // already parked; reset_capacity is the way out
  const tail = driverStderrTail(driver, 2000);
  const usage = driverUsageLimitText(driver);
  const entry = { pid: driver.pid, exit: driverExitInfo(driver), at: Date.now(), stderr_tail: (usage || tail).slice(-300) };
  if (usage) {
    child.waiting_capacity = { reason: usage.slice(0, 500), since: Date.now() };
    record(task, { event: 'child_driver_capacity', task_id: task.run_id, node_id: nodeId, pid: driver.pid, reason: usage.slice(0, 300) });
    return true;
  }
  const budget = restartBudget(task);
  const priorRestarts = driver.restarts || [];
  const countedRestarts = countedDriverRestarts(task, driver);
  if (countedRestarts.length >= budget) return false; // budget spent (within the window, if any): fold it, do not respawn again
  const restarts = [...priorRestarts, entry];
  const fresh = spawnChildDriver(task, nodeId, child, { resume: true, attempt: nextSpawnAttempt(child) });
  fresh.restarts = restarts;
  child.driver = fresh;
  delete child.stalled_since; // a fresh driver has made no progress yet, but it has also not stalled
  record(task, { event: 'child_driver_restarted', task_id: task.run_id, node_id: nodeId, pid: fresh.pid, restart: restarts.length, budget });
  return true;
}

// The mtime of whatever this child's own driver most recently touched - the same directory
// daemon.mjs's own waitForProgress already watches for this exact child (the broker's run file
// under .teams_output/broker/runs/), plus its ledger, which is cheap to stat and moves on every
// node the child's driver finishes even on a poll where the run file itself does not change
// (queueHumanAction and a few other paths append to the ledger without touching the run's own
// mtime). board.jsonl is TASK-level, not per-child (taskmanager.mjs's own board.jsonl, not a
// broker concept), so it is not read here. null when nothing has been written yet.
function childProgressMtime(child) {
  if (!child || !child.cwd || !child.run_id) return null;
  const candidates = [
    join(child.cwd, '.teams_output', 'broker', 'runs', `${child.run_id}.json`),
    join(child.cwd, '.teams_output', 'broker', 'ledger.jsonl'),
  ];
  let latest = null;
  for (const p of candidates) {
    try {
      const t = statSync(p).mtimeMs;
      if (latest === null || t > latest) latest = t;
    } catch { /* not written yet - fine, another candidate (or driver.started_at) covers it */ }
  }
  return latest;
}

// Driver LIVENESS is not driver PROGRESS: a pid that still answers process.kill(pid,0) can be a
// wedged model, a provider hang with no error text, or a tool call that never returns - none of
// which serviceDeadDriver ever sees, because it only runs once the pid is actually gone. This is
// the Temporal-heartbeat analogue for a driver this server does not control the inside of:
// stall_minutes (teamconfig.mjs, default 20, 0 disables) is read against childProgressMtime, the
// same files daemon.mjs's waitForProgress already watches for this child.
//
// idol-pm-4 (2026-09-2x) had a legitimate 16-minute gap between tool calls mid-run - killing on
// the first sign of quiet would have cut off a driver that was still working. So the first
// threshold only RECORDS the stall once (child_driver_stalled; child.stalled_since guards the
// repeat) and does nothing else. Only past 3x stall_minutes with STILL no progress does this
// kill the driver (child_driver_killed, reason 'stalled') - and it stops there. It does not
// respawn: the very next poll finds driverAlive() false and serviceDeadDriver's own path takes
// over, exactly as it would for a crash, spending a restart the same way.
//
// Returns true when it changed anything (so the caller knows to persist the task), same
// contract as serviceDeadDriver.
export function serviceStalledDriver(task, child, nodeId) {
  const driver = child.driver;
  if (!driver || !driverAlive(driver)) return false; // dead is serviceDeadDriver's job, not this one
  const stallMinutes = Number.isInteger(task.stall_minutes) ? task.stall_minutes : TEAM_DEFAULTS.stall_minutes;
  if (!stallMinutes) return false; // 0 disables the check
  const run = loadRun(child.cwd, child.run_id);
  const cs = run ? runState(run) : { state: 'missing' };
  if (cs.state !== 'running') return false; // nothing left to make progress on
  // The LATER of last progress and this driver's own start: a driver respawned after a long
  // park (capacity, a dead predecessor) inherits the old progress mtime, and measured from that
  // alone it read 79 minutes idle the moment it came up - idol-beta-ask1's P6 had eight fresh
  // drivers killed as "stalled" within 68 ms and its whole restart budget spent.
  const progressAt = Math.max(childProgressMtime(child) ?? 0, driver.started_at ?? 0) || Date.now();
  const idleMs = Date.now() - progressAt;
  const stallMs = stallMinutes * 60000;
  if (idleMs < stallMs) {
    if (!child.stalled_since) return false; // never flagged: nothing to clear
    delete child.stalled_since;
    record(task, { event: 'child_driver_progress_resumed', task_id: task.run_id, node_id: nodeId, pid: driver.pid });
    return true;
  }
  if (idleMs >= stallMs * 3) {
    killDriver(driver);
    record(task, { event: 'child_driver_killed', task_id: task.run_id, node_id: nodeId, pid: driver.pid, reason: 'stalled', idle_minutes: Math.round(idleMs / 60000) });
    return true;
  }
  if (child.stalled_since) return false; // already recorded once; wait for a resume or the kill threshold
  child.stalled_since = Date.now();
  record(task, { event: 'child_driver_stalled', task_id: task.run_id, node_id: nodeId, pid: driver.pid, idle_minutes: Math.round(idleMs / 60000) });
  return true;
}

// ---------- the daemon: server owns the loop ----------
//
// tm_open (and tm_run) no longer hand a model session a loop to run: they spawn a second
// process - `node daemon.mjs --task <id>` - that drives this task's graph directly, by calling
// the very functions this file exports (advanceDispatches, finish, foldChild, ...), the same
// recursion-by-process rule Task 11's block comment gives child drivers, extended one level up.
// The difference from the TaskLeader it replaces is that there is no model in this process at
// all except where a node genuinely needs judgment - the daemon spawns a single-shot `claude -p`
// per judging node (composeTaskPrompt's own briefing, its own Required-output contract), reads
// the last `result` event back, and calls finish() itself. A relay session cost $9.66 and 91
// turns to move JSON it never looked at; a loop is code, not a conversation.
//
// One writer, no arbitration: the old inbox (a mutating call from anyone but the leader queued
// for the leader to drain) existed only because the leader was itself a model session that had
// to poll its OWN inbox at the top of its OWN tm_next to see it. The daemon is not a client of
// this MCP server - it never calls back into it - so a direct tm_submit/tm_retry from any other
// caller and the daemon's own graph.mjs saveRun() calls are just two writers sharing the same
// mkdir-lock saveRun already serializes; requireRunnable's fresh state re-read (mustFindTask
// loads from disk on every call) is what stops either side from finishing a node twice.

function daemonPath() {
  return join(dirname(fileURLToPath(import.meta.url)), 'daemon.mjs');
}

// Test seam, like HARNESS_CHILD_DRIVER for a package driver: replaces the whole daemon command
// line so a test can point it at a fake script instead of a real `node daemon.mjs`, which would
// import this whole module and start driving the graph for real. `--task <id>` is always
// appended, exactly as a package driver's prompt always carries its run_id.
function daemonArgv(taskId) {
  const override = String(process.env.HARNESS_DAEMON || '').trim();
  const argv = override ? override.split(/\s+/) : ['node', daemonPath()];
  return [...argv, '--task', taskId];
}

// Test seam only, never an option, same rule as noDriver(): a caller that wants to drive a
// task's manager nodes by hand through tm_next/tm_submit/tm_retry (every test in this suite,
// bar the daemon's own) sets this and nothing spawns to race it. HARNESS_TEST_NO_LEADER is the
// name the whole existing test surface already uses for exactly this switch; kept rather than
// renamed so that surface does not have to move. HARNESS_TEST_NO_DAEMON is the same switch under
// its current name, for anything written after the daemon replaced the leader.
export function noDaemon() {
  return noDriver() || process.env.HARNESS_TEST_NO_LEADER === '1' || process.env.HARNESS_TEST_NO_DAEMON === '1';
}

// task.daemon mirrors task.leader's old shape: {pid, started_at, log, stderr, exit, command,
// spawn_count, restarts, exhausted}. Spawned detached + unref(), like every driver - it has to
// outlive the session that opened the task, because closing that session must not stop the run.
function spawnDaemon(task, opts = {}) {
  const dir = join(taskDir(task.run_id), 'daemon');
  const attempt = task.daemon ? (task.daemon.spawn_count || 0) : 0;
  const suffix = attempt > 0 ? `.restart${attempt}` : '';
  const log = join(dir, `daemon${suffix}.log.jsonl`);
  const stderr = join(dir, `daemon${suffix}.stderr.txt`);
  const exitFile = join(dir, `daemon${suffix}.exit.json`);
  const argv = daemonArgv(task.run_id);
  const command = argv.join(' ');
  let out = null;
  let err = null;
  try {
    mkdirSync(dir, { recursive: true });
    out = openSync(log, 'a');
    err = openSync(stderr, 'a');
    const env = { ...process.env };
    delete env.CLAUDECODE; // a nested claude -p (the daemon's own judge calls) refuses to start with it set
    if (process.env.HARNESS_TASKS_DIR) env.HARNESS_TASKS_DIR = tasksRoot();
    const proc = spawn(argv[0], [...argv.slice(1)], { cwd: task.cwd, env, detached: true, stdio: ['ignore', out, err] });
    try {
      proc.on('exit', (code, signal) => {
        try { appendFileSync(exitFile, JSON.stringify({ code, signal, at: Date.now() }) + '\n'); } catch { /* best-effort */ }
      });
    } catch { /* best-effort */ }
    proc.unref();
    const d = { pid: proc.pid || null, started_at: Date.now(), log, stderr, exit: exitFile, command };
    task.daemon = { ...d, spawn_count: attempt + 1, restarts: task.daemon ? (task.daemon.restarts || 0) + (opts.resume ? 1 : 0) : 0, exhausted: false };
    record(task, { event: opts.resume ? 'daemon_restarted' : 'daemon_spawned', task_id: task.run_id, pid: d.pid, log: d.log, ...(d.error ? { error: d.error } : {}) });
  } catch (e) {
    const error = String((e && e.message) || e);
    task.daemon = { pid: null, started_at: Date.now(), log, stderr, exit: exitFile, command, error, spawn_count: attempt + 1, restarts: task.daemon ? (task.daemon.restarts || 0) : 0, exhausted: false };
    record(task, { event: 'daemon_spawn_failed', task_id: task.run_id, error });
  } finally {
    for (const fd of [out, err]) { try { if (fd !== null) closeSync(fd); } catch { /* already closed */ } }
  }
}

// The state a caller OUTSIDE the s_run's own graph should be told. A size-S task's manager
// graph - three nodes - settles the moment `size` resolves (shape/critique skipped by
// delegateIfSmall), which is not the task being done: the work is in the one child run
// task.s_run points at. Judging a live S task by its own settled manager graph is exactly the
// bug that once made a watcher call a live run "blocked" while the child was still building (see
// toolNextSRun, and the historical note on the test above this one) - so anything that needs to
// know "is there still work here", not just "what does the manager's own node list say", reads
// THIS instead of runState(task) directly. serviceDaemon and tm_wait both need it; daemon.mjs
// imports it for the same reason rather than re-deriving its own copy.
export function taskState(task) {
  if (!task.s_run) return runState(task);
  const run = loadRun(task.s_run.cwd, task.s_run.run_id);
  const cs = run ? runState(run) : { state: 'missing', counts: {} };
  return {
    state: cs.state === 'running' ? 'running' : (cs.state === 'complete' ? 'complete' : 'blocked'),
    counts: cs.counts || {},
  };
}

// Called at the top of (and again after) every tm_* entry that has a task_id. No gate, no
// watcher branch, no inbox: any caller may read or mutate the task at any time, the same as it
// always could when there was no daemon at all. This only re-raises a dead daemon while work
// remains - taskState() is the only thing that decides whether there is anything left to drive.
function serviceDaemon(task) {
  if (noDaemon()) return false;
  const st = taskState(task).state;
  if (st === 'complete' || st === 'blocked') return false;
  if (task.daemon && driverAlive(task.daemon)) return false;
  if (task.daemon && task.daemon.exhausted) return false;
  const budget = Number.isInteger(task.driver_restarts) ? task.driver_restarts : 2;
  if (task.daemon && (task.daemon.restarts || 0) >= budget) {
    task.daemon.exhausted = true;
    record(task, { event: 'daemon_exhausted', task_id: task.run_id, restarts: task.daemon.restarts, stderr: driverStderrTail(task.daemon) });
    saveRun(task);
    return true;
  }
  spawnDaemon(task, { resume: !!task.daemon });
  saveRun(task);
  return true;
}

// Executed by the server the moment the node is ready. The model never opens a run.
export function openChild(task, n) {
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
  // A planning phase-Team package is a second exception, for a different reason: its result is
  // the node's own output (the PRD, the user_stories[]), not a file artifact, so no isolated
  // worktree is needed - it runs directly in the project cwd (§0.1, Task 2).
  // A QA phase-Team package is a third exception that IS shaped like a repair: it judges the
  // very tree integrate just built, so it reuses that worktree the same way repairWorktree
  // already does for a repair package (§0.3 finding 3 - same mechanism, no new function).
  // The audit phase-Team joins QA in that third exception, and for the same reason: it judges
  // the integrated tree, so its worktree IS the integration worktree.
  const wt = pkg.repair || pkg.phase === 'qa' || pkg.phase === 'audit'
    ? repairWorktree(task, pkg)
    : pkg.phase === 'planning'
      ? { ok: true, path: task.cwd, branch: null, created: false }
      : ensureWorktree(task, String(pkg.id), depBranches[0] || task.base_ref || 'HEAD');
  if (!wt.ok) {
    n.state = 'failed';
    n.result = { stage_ok: false, reason: `could not create a worktree for ${pkg.id}: ${wt.reason}` };
    record(task, { event: 'dispatch_failed', task_id: task.run_id, node_id: n.node_id, reason: n.result.reason });
    return;
  }
  // rollback (docs/plans/2026-09-23-teams-reducer-human-rollback.md §5, item 3): only a package
  // with a worktree of its own (not repair/qa/audit/planning, which all reuse someone else's
  // tree) has a branch retryPackage can reset. The first time this package id ever creates the
  // worktree, its HEAD is the base every later attempt would roll back to if none of them are
  // ever accepted; retryPackage reads it back via n.base_commit on whichever dispatch node set
  // it, across shape rounds - ensureWorktree keeps ONE worktree per package id forever, so this
  // is written at most once.
  const ownWorktree = !pkg.repair && pkg.phase !== 'qa' && pkg.phase !== 'audit' && pkg.phase !== 'planning';
  if (ownWorktree && wt.created) {
    const head = git(wt.path, ['rev-parse', 'HEAD']);
    if (head.ok) n.base_commit = head.out;
  }
  // retryPackage (below) stamped n.rollback_to on THIS dispatch node when it opened, if the
  // task's retry_policy is 'rollback' and it found a commit to roll back to. Reused worktree
  // (wt.created false is exactly "a retry continuing where the last attempt left it") is the
  // only case this applies - a fresh worktree has nothing on it yet to discard.
  if (ownWorktree && !wt.created && n.rollback_to) {
    const reset = git(wt.path, ['reset', '--hard', n.rollback_to]);
    if (reset.ok) {
      git(wt.path, ['clean', '-fd']);
      record(task, { event: 'worktree_rolled_back', task_id: task.run_id, node_id: n.node_id, package_id: String(pkg.id), checkpoint: n.rollback_to });
    } else {
      record(task, { event: 'rollback_failed', task_id: task.run_id, node_id: n.node_id, package_id: String(pkg.id), reason: reset.err || reset.out || 'git reset --hard failed' });
    }
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
  // §3: a package this task already shaped and critiqued opens its child run with the
  // subgoal chain only - no run-level plan/setgoal/critique/gate:goal/report, which would
  // only redo what shape+critique already settled and re-judge what this one subgoal's own
  // gate is about to judge. Three things turn it off: a phase-Team package (PLAN/QA/AUDIT),
  // which never went through this task's own shape at all; a repair package, whose seam-fix
  // brief may need more than one unit of work; and a package shape itself marked as still
  // needing its own split (`split: true`, or `size: 'L'` - the same letter the manager's own
  // size node would have used). depth >= max_depth overrides that last escape hatch: a
  // package this deep may not open its own shape/dispatch cycle regardless of what it asked
  // for, so it always runs chain-only.
  const isPhaseTeam = pkg.repair || pkg.phase === 'planning' || pkg.phase === 'qa' || pkg.phase === 'audit';
  const needsSplit = pkg.split === true || pkg.size === 'L';
  const maxDepth = Number.isInteger(task.team && task.team.opts && task.team.opts.max_depth)
    ? task.team.opts.max_depth : TEAM_DEFAULTS.max_depth;
  const depthForced = (task.depth || 0) >= maxDepth;
  const parentShaped = !isPhaseTeam && (depthForced || !needsSplit);
  const child = createRun({
    ...task.child_opts,
    cwd: wt.path,
    request: [String(pkg.brief), n.feedback ? `\n\nPrevious attempt of this package was rejected - fix this:\n${n.feedback}` : ''].join(''),
    context: childContext(task, pkg),
    isolated: true,
    flow,
    // A phase-Team run is pinned to its flow's kind: a planning run writes a PRD, a qa run
    // runs cases, an audit run audits. mixed:true here let the first real planning run's own
    // plan node decompose the request into develop subgoals and start implementing it.
    mixed: !(pkg.phase === 'planning' || pkg.phase === 'qa' || pkg.phase === 'audit'),
    parent_shaped: parentShaped,
    goal: pkg.title || pkg.brief,
    acceptance: Array.isArray(pkg.acceptance) && pkg.acceptance.length ? pkg.acceptance : null,
    // A STORY-level pin (shape's own `assignee: "human"` on the package, or tm_assign called
    // before this package ever dispatched) - only reaches the child run on the common
    // parent_shaped path (createRun's own parent_shaped branch is the only place that reads it):
    // the run IS the one subgoal's chain, so "the package" and "its one subgoal" are the same
    // card. A package that still needs its own shape/setgoal (needsSplit) has no single subgoal
    // yet to pin - tm_assign on a STORY like that has nothing to touch until it is (re-)shaped.
    subgoal_assignee: pkg.assignee || null,
    // The audit phase-Team's own judge≠author gap (routing.mjs's externalAuthorOf, broker.mjs's
    // reviewIndependence): only openAudit's package ever sets this field, so every other package
    // threads a plain null through, unchanged.
    external_author: pkg.author_identity || null,
  });
  n.state = 'running';
  n.started_at = Date.now();
  n.child = { cwd: wt.path, run_id: child.run_id, branch: wt.branch, flow, based_on };
  record(task, { event: 'dispatch', task_id: task.run_id, node_id: n.node_id, child_run_id: child.run_id, cwd: wt.path, branch: wt.branch, parent_shaped: parentShaped });
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

// Whether a running dispatch node's child has stopped running - the point past which foldChild
// can be called without it throwing "still running". Read-only: it does not service a dead
// driver itself (serviceRunningDispatches/foldChild already do that elsewhere) - it only answers
// "is there something to fold", which is what the daemon's own loop needs to know before it
// tries.
export function dispatchSettled(task, n) {
  if (!n.child) return false;
  const child = loadRun(n.child.cwd, n.child.run_id);
  if (!child) {
    // Missing file: foldChild will report that, and that IS a fold. Unparseable file: another
    // process is mid-write (or was, before saveRun became write-then-rename); not settled yet.
    return !existsSync(join(n.child.cwd, '.teams_output', 'broker', 'runs', `${n.child.run_id}.json`));
  }
  const st = runState(child).state;
  // waiting_human is not a settled child any more than 'running' is - the package's driver
  // already exited (zero compute while it waits, see graph.mjs's promoteWaitingHuman), but the
  // package itself is not done, not blocked, and not this attempt's failure: folding it here
  // would count a human's turnaround time as a package failure and spend a retry nobody asked
  // for. It stays open until the human answers (tm_submit) and the child moves on its own.
  // A running child whose driver is dead for good (restart budget spent, not parked on
  // capacity) will never advance on its own: that is settled, and foldChild folds it blocked
  // with every attempt's stderr, so the package's retry (or a person) can take it from there.
  if (st === 'running' && driverRestartsSpent(task, n.child)) return true;
  if (st === 'running' || st === 'waiting_human') return false;
  if (st === 'complete') return true;
  // Blocked or missing-report with a live driver: the driver's own broker may be about to open
  // the next attempt (auto_reassign), or is about to exit having reported the block. Either way
  // the settle signal is the driver's exit (serviceRunningDispatches reads its exit file), not
  // this snapshot. seam-silent-beta-E1: folded a 'blocked' P1 whose driver was on implement:U1:2.
  if (n.child.driver && driverAlive(n.child.driver)) return false;
  return true;
}

// serviceDeadDriver generalized to task.s_run, which mirrors n.child but is not a node's child -
// it is the task's own single run under a size-S request. Same story as dispatchSettled: a tiny
// wrapper so the daemon's S-branch does not have to know serviceDeadDriver's node-shaped calling
// convention.
export function serviceSRun(task) {
  if (!task.s_run || !task.s_run.driver) return false;
  return serviceDeadDriver(task, task.s_run, 'S') || serviceStalledDriver(task, task.s_run, 'S');
}

// The child's account, read from its file. This is the only place the manager touches a
// run file, and it only reads.
// A parent_shaped child (§3) has no run-level gate:goal and no report node - it IS its one
// subgoal's chain, nothing else. `gate` is that chain's own terminal gate (same verdict
// fields as a goal gate: accept/match_pct/gaps/reason/checks - see prompts.mjs's `gate`
// contract), the stand-in foldChild reads below in place of a run-level gate:goal node.
// `authored` is the chain's last mutating stage (the one before its gate - implement for a
// subgoal, revise for planning, draft for a document, execute for qa), the stand-in for a
// report's handoff: a parent_shaped run's dependents still need a one-line account of what
// this package delivered, and there is no report node to read it from.
function parentShapedChild(child) {
  const sg = child.parent_shaped && child.spec && Array.isArray(child.spec.subgoals) ? child.spec.subgoals[0] : null;
  if (!sg) return { gate: null, authored: null };
  const chain = (KINDS[kindOf(sg)] || KINDS[DEFAULT_KIND]).chain;
  const latest = (stage) => {
    const nodes = child.nodes.filter((x) => x.stage === stage && x.subgoal_id === String(sg.id) && x.result);
    return nodes.length ? nodes[nodes.length - 1] : null;
  };
  // Not every mutating stage in a chain carries a handoff (test/review/execute are
  // verification, not authorship - see prompts.mjs's CONTRACT). Walk the chain's mutating
  // stages (everything but the closing gate) back to front and take the last one whose
  // result actually has one: planning's revise rewrites over draft's first pass, so its
  // handoff is the truer "what does this package now say" than the earlier draft's - but a
  // run that never reached revise still has draft's to fall back to.
  let authored = null;
  for (let i = chain.length - 2; i >= 0; i--) {
    const cand = latest(chain[i]);
    if (cand && cand.result && cand.result.handoff) { authored = cand; break; }
  }
  return { gate: latest(chain[chain.length - 1]), authored };
}

export function foldChild(task, n) {
  const pkg = packageOf(task, n.subgoal_id);
  const child = loadRun(n.child.cwd, n.child.run_id);
  if (!child) return { stage_ok: false, reason: `child run ${n.child.run_id} has no file under ${n.child.cwd}` };
  const cs = runState(child);
  const { gate: chainGate, authored: chainAuthored } = parentShapedChild(child);
  const goalGate = chainGate || child.nodes.filter((x) => x.stage === 'gate' && x.subgoal_id === null && x.result).pop();
  const report = child.nodes.filter((x) => x.stage === 'report' && x.state === 'done' && x.result).pop();
  // Through the declared registry (reducers.mjs), not an inline Set literal: the same union
  // merge goalConsensus and the run's own `reduce` node use, named once instead of copied.
  // Keyed by (node_id, attempt) - a node this loop sees twice (unlikely here since `child.nodes`
  // is read fresh each call, but the registry does not get to assume that of every caller)
  // still folds to the same set, which is the idempotence property item 1 asks for.
  const changed = applyMerge('union', child.nodes
    .filter((x) => x.result && Array.isArray(x.result.changed_files))
    .map((x) => ({ node_id: x.node_id, attempt: x.attempt || 1, value: x.result.changed_files })));
  // A round may have more than one judge (goal_judges > 1, the default above): the round's
  // consensus - every judge accepting, not any one sibling's own verdict - decides whether it
  // accepted. Reading the last gate node in node order (as this used to, unconditionally) picks
  // whichever sibling happens to sort last, which is not necessarily the primary and is never
  // the AND of all of them - a single dissenting judge could be silently overridden by whichever
  // one node the filter's .pop() lands on. runState already computes the true consensus as
  // goal_verdict, and it reduces to exactly this node's own fields when there is one judge, so
  // overriding with it here is a strict generalization, not a behaviour change, for a run still
  // opened with the legacy default. reason/observations have no consensus-level counterpart
  // (they are free text a single judge writes), so those two still come from the raw node.
  const raw = (goalGate && goalGate.result) || {};
  const gv = cs.goal_verdict;
  const g = gv ? { ...raw, accept: gv.accept, match_pct: gv.match_pct, gaps: gv.gaps, spec_drift: gv.spec_drift } : raw;
  // The child's `reduce` observed its subgoals' artifacts as a set and reported what did not
  // line up, without repairing any of it - deciding is the level above's job, and this is that
  // level. Carrying it into the fold is what makes that true: without this the findings die
  // inside the child run, and the manager integrates a tree whose seams nobody named.
  const reduceNode = child.nodes.filter((x) => x.stage === 'reduce' && x.result).pop();
  const rd = (reduceNode && reduceNode.result) || null;
  const setFindings = rd
    ? {
      undeclared: rd.undeclared || [],
      collisions: rd.collisions || [],
      orphans: rd.orphans || [],
      repairs_needed: rd.repairs_needed || [],
      // The deterministic check (item 2), recorded onto the reduce node's own result by
      // broker.mjs's finishNode - carried up here so the manager's own accept/gate:goal sees a
      // file or heading collision even when the child's LLM reduce pass did not report it.
      write_scope: rd.write_scope || null,
    }
    : null;
  // Read directly off every execute node in the child (graph.mjs's KINDS.qa chain), not off
  // the run's own gate:goal verdict - a defect the QA case set found is real evidence
  // regardless of whether the child run ever reached its goal gate at all (a blocked child,
  // an integration conflict on THIS attempt) or of whether a judging LLM faithfully restated
  // it there. Deduped because a subgoal that retried (a genuine stage_ok:false execute
  // failure, then a clean rerun) can otherwise report the same defect twice. This is what
  // autoRetryPackages (below) reads to decide "file it" over "retry the whole QA package",
  // and what composeTaskPrompt shows the accept:QA agent as "Defects it reported".
  const defectsFound = [...new Set(
    child.nodes
      .filter((x) => x.stage === 'execute' && x.result && Array.isArray(x.result.defects))
      .flatMap((x) => x.result.defects.map((d) => String(d).trim()))
      .filter(Boolean),
  )];
  // §upstream_defects: a defect this package's own implement/test/gate found OUTSIDE its own
  // scope, in an upstream package it deps on (prompts.mjs's UPSTREAM_DEFECT_CONTRACT) - read
  // straight off every node in the child that can carry one, the same "regardless of whether the
  // child ever reached a goal-gate verdict" reasoning defectsFound above already uses, so a child
  // that never reached its own gate:U1 (folded blocked, not just done) still surfaces what
  // implement/test already found. Deduped by (package, title): a retried attempt that reports the
  // same upstream defect twice must not file it twice.
  const upstreamDefectsFound = (() => {
    const seen = new Map();
    for (const x of child.nodes) {
      const list = x.result && Array.isArray(x.result.upstream_defects) ? x.result.upstream_defects : [];
      for (const d of list) {
        if (!d || !d.package) continue;
        const key = `${d.package}::${d.title || ''}`;
        if (!seen.has(key)) {
          seen.set(key, {
            package: String(d.package),
            title: String(d.title || `upstream defect in ${d.package}`),
            evidence: String(d.evidence || ''),
            touches: Array.isArray(d.touches) ? d.touches.map(String) : [],
          });
        }
      }
    }
    return [...seen.values()];
  })();
  const base = {
    child_run_id: child.run_id,
    child_cwd: n.child.cwd,
    branch: n.child.branch,
    child_state: cs.state,
    child_counts: cs.counts,
    changed_files: changed,
    ...(defectsFound.length ? { defects: defectsFound } : {}),
    ...(upstreamDefectsFound.length ? { upstream_defects: upstreamDefectsFound } : {}),
    ...(setFindings ? { set_findings: setFindings } : {}),
    report: report ? String(report.result.handoff || '') : (chainAuthored ? String(chainAuthored.result.handoff || '') : ''),
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
          : `Drive it with team_next/team_run/team_submit at cwd ${n.child.cwd}, then submit this node again.`));
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
    // account of why, and is what a retried package needs to hear. A parent_shaped child has
    // no goal gate at all, and even a full child that ran out of subgoal retries never reached
    // one - so the verdicts that actually stopped it are its failed gate/test/review nodes.
    // Without them the retry brief said only "test:U1:3 failed with no retry left"
    // (trap-beta-T2, 2026-09-21) and the next attempt had nothing to fix from.
    const verdicts = child.nodes
      .filter((x) => x.state === 'failed' && x.result && REASONING_STAGES.has(x.stage) && (x.result.reason || (x.result.gaps || []).length))
      .slice(-3);
    const vReason = verdicts.map((x) => `${x.node_id}${x.result.match_pct != null ? ` (${x.result.match_pct}%)` : ''}: ${x.result.reason || ''}`).filter(Boolean).join('\n');
    const vGaps = verdicts.flatMap((x) => x.result.gaps || []);
    return {
      ...base, stage_ok: false, accept: false,
      gaps: [...new Set([...(g.gaps || []), ...vGaps])],
      match_pct: g.match_pct != null ? g.match_pct : (verdicts.length ? verdicts[verdicts.length - 1].result.match_pct : undefined),
      child_verdicts: verdicts.map((x) => ({ node_id: x.node_id, match_pct: x.result.match_pct, reason: x.result.reason || '', gaps: x.result.gaps || [] })),
      // g.reason for a chain-only child that ran out of retries is the terminal node's one-line
      // account ("unreachable: test:U1:3 failed with no retry left"); the verdicts are the substance.
      reason: `child run ended blocked${g.reason ? `: ${g.reason}` : ''}${vReason ? `. Its own verdicts:\n${vReason}` : ''} (${JSON.stringify(cs.counts)})`,
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
  // A PRD with no user stories is not a PRD the rest of this task can use: shape's completeness
  // check has nothing to check, the audit has nothing to audit, and every downstream briefing
  // says "(none)". goal-code-beta-R1 (2026-09-18) accepted exactly that at 93% and the run went
  // on to build from the request alone. The child's own gate cannot see this - it judges its
  // document, not what the manager needs from it - so the fold is where it has to be caught.
  const planningStories = pkg && pkg.phase === 'planning'
    ? (Array.isArray(g.user_stories) ? g.user_stories : []).filter((u) => storyId(u))
    : null;
  // Same principle as the story check: a structural requirement the contract states in words is
  // verified here rather than trusted to a judge that accepted a PRD missing three of them.
  if (planningStories && g.accept === true && planningStories.length) {
    const missing = missingPrdSections(n.child ? n.child.cwd : task.cwd, (Array.isArray(g.prd_paths) ? g.prd_paths : []).length
      ? g.prd_paths
      : [...new Set((child.nodes || []).flatMap((x) => (x.result && x.result.changed_files) || []).map(String))]);
    if (missing.length) {
      return {
        ...base, stage_ok: true, accept: false, match_pct: g.match_pct, user_stories: planningStories,
        gaps: [...(g.gaps || []), ...missing.map((m) => `the PRD has no "${m}" section`)],
        reason: `the PRD is missing required sections: ${missing.join(', ')}. Every one of them is a heading a reader looks for and this document does not answer`,
      };
    }
  }
  if (planningStories && g.accept === true && !planningStories.length) {
    return {
      ...base, stage_ok: true, accept: false, match_pct: g.match_pct, user_stories: [],
      gaps: [...(g.gaps || []), 'the PRD names no user stories, so nothing downstream can be built or audited against it'],
      reason: 'the planning run returned no user stories: the PRD must carry a "## User stories" section and gate:goal must return it as user_stories[]',
    };
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
    // The planning phase-Team's structured bridge (§0.4 finding 2): shape's implements[]
    // completeness check needs the ID list, not the PRD body, which stays in the child run.
    ...(pkg && pkg.phase === 'planning' ? {
      user_stories: Array.isArray(g.user_stories) ? g.user_stories : [],
      // Where the PRD actually is. The child's own nodes recorded it; nothing else knows, and
      // shape's briefing has no other way to name a file a reader can open.
      prd_paths: [...new Set((child.nodes || []).flatMap((x) => (x.result && x.result.changed_files) || []).map(String))],
    } : {}),
  };
}

export function prepareIntegration(task, n) {
  const round = Number(String(n.node_id).split(':')[1] || 1);
  // After an accepted repair, this round starts FROM the repaired integration branch and
  // merges nothing: that branch already is every package branch merged, plus the repair. The
  // seam was fixed in the combined tree, and re-merging from HEAD would recreate it.
  const repair = repairBase(task, n);
  const wt = ensureWorktree(task, round === 1 ? 'integration' : `integration-${round}`, repair ? repair.branch : (task.base_ref || 'HEAD'));
  if (!wt.ok) {
    n.state = 'failed';
    n.result = { stage_ok: false, verified: false, reason: `could not create the integration worktree: ${wt.reason}` };
    return;
  }
  const merged = repair ? [{ package: repair.package, branch: repair.branch, commit: repair.commit }] : [];
  // A package whose dispatch was permanently skipped (§B.1: budget/timebox exhausted before it
  // ever got a driver) never has a delivered branch and never will - unlike an ordinary pending
  // retry, which this integrate would simply wait for. Read its LATEST attempt, not "any": a
  // package that was skipped once and later retried (not today's budget path, but a state this
  // general check should not misread) has a real delivered branch by its later attempt.
  const skippedForBudget = (id) => { const d = latestBySubgoal(task, String(id), 'dispatch'); return !!d && d.state === 'skipped'; };
  const ordered = dependencyOrder((task.spec.packages || []).filter((p) => !p.repair && !skippedForBudget(p.id)));
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

// The manager-level reduce (item 4): a package's own dispatch attempts are its RETRY history,
// not siblings - a rejected attempt 1 must not veto an accepted attempt 3 the way a dissenting
// SIBLING judge should. So every field folds through the same registry foldChild and the
// run-level `reduce` node use (reducers.mjs), except `accept` itself, which this function
// deliberately overrides to last-by-attempt instead of the registry's and-consensus default -
// the registry's `accept` rule is for consensus among SIBLINGS in one round (graph.mjs's
// goalConsensus), and a package's retry history is not that.
function packageReducerKind(pkg) {
  if (!pkg) return DEFAULT_KIND;
  if (pkg.phase === 'planning') return 'planning';
  if (pkg.phase === 'qa') return 'qa';
  if (pkg.phase === 'audit') return 'planning-audit';
  return DEFAULT_KIND;
}

export function foldPackageHistory(task) {
  const out = {};
  for (const pkg of (task.spec && task.spec.packages) || []) {
    const dispatches = task.nodes.filter((x) => x.stage === 'dispatch' && x.subgoal_id === String(pkg.id) && x.result);
    if (!dispatches.length) continue;
    const records = dispatches.map((x) => {
      const r = x.result;
      const fields = {
        changed_files: r.changed_files || [],
        gaps: r.gaps || [],
        reason: r.reason || '',
      };
      if (Array.isArray(r.defects)) fields.defects = r.defects;
      if (Number.isFinite(r.match_pct)) fields.match_pct = r.match_pct;
      // Not tracked anywhere in this codebase today (see reducers.mjs's DEFAULT_FIELDS
      // comment) - carried through untouched, for whenever a dispatch result starts
      // reporting one, rather than requiring a registry change to pick it up.
      if (r.cost !== undefined) fields.cost = r.cost;
      return { node_id: x.node_id, attempt: x.attempt || 1, fields };
    });
    const acceptEntries = dispatches
      .filter((x) => x.result.accept !== undefined)
      .map((x) => ({ node_id: x.node_id, attempt: x.attempt || 1, value: x.result.accept === true }));
    out[String(pkg.id)] = {
      ...foldRecords(packageReducerKind(pkg), records),
      accept: acceptEntries.length ? applyMerge('last-by-attempt', acceptEntries) : undefined,
      attempts: records.length,
    };
  }
  return out;
}

// ---------- briefings ----------

export function briefingPath(task, n) {
  return join(taskDir(task.run_id), 'briefings', `${n.node_id.replace(/[^A-Za-z0-9._-]/g, '_')}.md`);
}

// The manager-graph twin of broker.mjs's writeHumanBriefing: the card a person reads for a
// node openAsk or promoteHumanGates just parked on task.nodes directly (shape/critique/accept/
// integrate/gate/gate:goal - not a package's child run). Best-effort like its sibling - a
// failed write leaves tm_inbox to fall back on the node's own fields, not a hard error.
export function writeManagerBriefing(task, n) {
  if (!n) return;
  try {
    const p = briefingPath(task, n);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, composeTaskPrompt(task, n));
    n.briefing_path = p;
  } catch { /* tm_inbox falls back to tm_status full:true */ }
}

export function composeTaskPrompt(task, n) {
  const L = [];
  L.push(`# ${n.stage} node ${n.node_id} (task manager)`);
  L.push('');
  L.push(`Project directory: ${task.cwd}`);
  L.push(MUTATING.has(n.stage)
    ? `You may run commands and change files only inside the integration worktree named below.`
    : `This is a reasoning node. Read what you need under the project directory; do not modify project files.`);
  L.push('');
  L.push(`You ARE this node of the task manager. Do the stage work directly with your own tools.`);
  L.push(`Do not re-enter the harness from inside it: no team_open, no tm_open, no broker or adapter call.`);
  L.push(`Child runs are opened and driven around you, never by you.`);
  L.push('');
  L.push(`## Request`);
  L.push(task.request);
  if (task.context) { L.push(''); L.push(`## Context from the requester`); L.push(task.context); }
  // requests[] (§B.3): the request above is already the whole backlog, "[backlog priority N] ..."
  // per item, N=0 highest - shape is the one stage that has to act on the ordering, by setting
  // each package's own `priority` (its existing field: array position already decides dispatch
  // order, advanceDispatches' own sort) consistent with which backlog item it implements. Nothing
  // downstream needs telling twice: critique/accept/gate:goal only ever read the packages shape
  // already ordered.
  if (n.stage === 'shape' && Array.isArray(task.requests) && task.requests.length) {
    L.push('');
    L.push(`## Backlog priority`);
    L.push(`This request is a backlog of ${task.requests.length} items in priority order (item 0 is highest). Give every package a \`priority\` consistent with which backlog item(s) it implements - a package serving only a low-priority item gets a high priority NUMBER, so it is the one left undispatched if budget_usd/timebox_minutes runs out before everything ships (advanceDispatches dispatches ascending priority first). Also give every package \`backlog: [N, ...]\` - the backlog priority numbers it implements - so the retro can name which backlog items shipped and which carry into the next Sprint.`);
  }
  if (task.size || task.flow_chosen || task.flow !== 'auto') {
    L.push('');
    L.push(`## Sizing`);
    if (task.size) L.push(`size: ${task.size}`);
    L.push(`flow: ${task.flow !== 'auto' ? `${task.flow} (fixed by the entry)` : task.flow_chosen ? `${task.flow_chosen} (chosen by size)` : 'auto'}`);
  }
  if (n.stage === 'shape' && task.planning_pkg) {
    const planDispatch = task.nodes.find((x) => x.node_id === 'dispatch:PLAN:1');
    const userStories = (planDispatch && planDispatch.result && Array.isArray(planDispatch.result.user_stories))
      ? planDispatch.result.user_stories : [];
    L.push('');
    L.push(`## Planning phase-Team`);
    // A link, never the PRD body itself (§7c "payload를 main에 올리지 않는다"): the body stays
    // in the child run and its rendered doc, not in this briefing.
    // The path the planning run actually wrote, not docPaths()'s 10-prd.md: that file is a link
    // page rendered by tm_docs at report time, so at shape time it does not exist yet and never
    // carries the PRD body at all. Pointing shape at it left it with no PRD to read (R1, 2026-09-18).
    const prdPaths = (planDispatch && planDispatch.result && Array.isArray(planDispatch.result.prd_paths))
      ? planDispatch.result.prd_paths : [];
    L.push(prdPaths.length
      ? `A planning phase-Team ran ahead of this stage and wrote the PRD to ${prdPaths.join(', ')}. Read it there - it is the reasoning behind the stories below, and its body is not repeated here.`
      : `A planning phase-Team ran ahead of this stage, but reported no document path. Its user stories are below; there is no PRD body to read.`);
    L.push(`User stories it produced - every "packages[].implements[]" this stage returns must together cover all of these, by id:`);
    L.push(bullets(userStories.map(storyLabel)));
    // What the judges said while letting it through. A gap named on an ACCEPTED node used to go
    // nowhere at all - gaps travelled only on rejection - so accept:PLAN calling the PRD "a
    // generic high-demand ticketing PRD with 'idol concert' in the title" (idol-pm-1,
    // 2026-09-22) reached no later stage and changed nothing about what got built.
    const planAccept = task.nodes.find((x) => x.node_id === 'accept:PLAN:1');
    const carried = [
      ...((planDispatch && planDispatch.result && planDispatch.result.gaps) || []),
      ...((planAccept && planAccept.result && planAccept.result.gaps) || []),
      ...((planAccept && planAccept.result && planAccept.result.observations) || []),
    ].filter(Boolean);
    if (carried.length) {
      L.push('');
      L.push(`The PRD was accepted WITH these gaps still open. They were not blocking, and they are not yours to fix - but a package split that ignores them ships them:`);
      L.push(bullets([...new Set(carried)]));
    }
  }
  if (task.spec && ['critique', 'integrate', 'gate', 'report'].includes(n.stage)) {
    L.push('');
    L.push(`## Goal-level acceptance`);
    L.push(bullets(task.spec.acceptance));
    L.push('');
    L.push(`## Packages`);
    // The manager-level reduce (item 4): the most recent integrate's declared per-package fold -
    // every attempt a package went through, folded through the same registry foldChild uses, not
    // just the latest dispatch's own snapshot below. Present once at least one integrate has
    // settled; gate:goal and report are exactly the stages that need a package's whole history,
    // not only where it landed.
    const foldedIntegrate = task.nodes.filter((x) => x.stage === 'integrate' && x.result && x.result.package_fold).pop();
    const fold = foldedIntegrate ? foldedIntegrate.result.package_fold : null;
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
      const f = fold && fold[String(p.id)];
      if (f) {
        L.push(`Folded across ${f.attempts} attempt(s): accept=${f.accept === undefined ? '?' : f.accept}`
          + `${f.match_pct !== undefined ? ` match=${f.match_pct}%` : ''}`
          + `${(f.changed_files || []).length ? ` · ${f.changed_files.length} file(s) changed` : ''}`
          + `${(f.defects || []).length ? ` · ${f.defects.length} defect(s)` : ''}`);
      }
      L.push('');
    }
    // Facts, not a verdict (§ shapeAnalysis) - handed to critique so it sees, unprompted, exactly
    // what the audit found only after the fact: awake-beta-ref1's P1 owning 9 scopes on a
    // strictly serial chain, named in problems[] but never blocking[]. Shown only to critique -
    // integrate/gate/report already have the merged tree or the child reports to judge from, and
    // repeating package-count-and-width facts there would be noise, not evidence.
    if (n.stage === 'critique') {
      const sa = shapeAnalysis(task.spec.packages || []);
      L.push(`## Shape analysis`);
      L.push(`${sa.package_count} packages, touches median ${sa.touches_median}, max parallel width ${sa.max_parallel_width}${sa.fully_serial ? ' — fully serial: every package waits on the one before it' : ''}.`);
      L.push(sa.bloated.length
        ? `Bloated: ${sa.bloated.map((b) => `${b.id} owns ${b.touches} scopes (touches median is ${sa.touches_median})`).join('; ')}.`
        : `No package's touches breadth is 2x the sibling median or more.`);
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
      const notes = critiqueNotesFor(task, pkg.id);
      if (notes.length) {
        L.push(`The plan's critique named this about ${pkg.id} (the child was told the same). Check each was addressed or its handoff says why not; an unaddressed one with no reason is a gap:`);
        L.push(bullets(notes));
      }
    }
    // QA and AUDIT judge the INTEGRATED result against the whole task, not one package of their
    // own - pkg.acceptance above is deliberately a generic one-liner ("exercise it end to end")
    // because their scope is everything, not a slice. Left at that, this judge's only basis for
    // a verdict was that one-liner plus the child's own self-report below: structurally unable to
    // tell a QA pass that ran three trivial cases and declared no defects from one that actually
    // exercised the goal. What it needs to tell the difference is what the task actually promised
    // and what the develop packages themselves claimed they would deliver - the same facts
    // critique/integrate/gate already see (line ~1871), scoped here to QA/AUDIT alone rather than
    // widening that stage gate onto every accept: an ordinary package's own accept (P1, a repair)
    // is already handed exactly the package it is judging and needs nothing about its siblings to
    // do that job, and accept is the highest-frequency node type in this task - drowning all of
    // them in a full sibling-package dump would make each judge less, not more.
    // Deliberately NOT included: every package's branch/child_run_id/dispatch state (routing
    // plumbing, not a check the judge can act on), other accept nodes' own verdicts (one judge's
    // opinion is not evidence for another), and critique's or integrate's full transcripts (a
    // different question than "did QA/AUDIT do their job", answered by the report/gate stages
    // that already exist for it).
    if (task.spec && pkg && (pkg.phase === 'qa' || pkg.phase === 'audit')) {
      L.push('');
      L.push(`## Goal-level acceptance`);
      L.push(bullets(task.spec.acceptance));
      L.push('');
      L.push(`## What the develop packages promised`);
      for (const p of task.spec.packages || []) {
        L.push(`### ${p.id} — ${p.title}`);
        if ((p.touches || []).length) L.push(`Touches: ${p.touches.join(', ')}`);
        L.push(`Acceptance:`);
        L.push(bullets(p.acceptance));
        L.push('');
      }
      if (pkg.phase === 'audit') {
        const planDispatch = latestBySubgoal(task, 'PLAN', 'dispatch');
        const userStories = (planDispatch && planDispatch.result && Array.isArray(planDispatch.result.user_stories))
          ? planDispatch.result.user_stories : [];
        L.push(`## User stories from the PRD`);
        L.push(bullets(userStories.map(storyLabel)));
      }
    }
    if (d && d.result) {
      const r = d.result;
      L.push('');
      L.push(`## What the child run delivered`);
      L.push(`child run ${r.child_run_id} at ${r.child_cwd} on branch ${r.branch} — ${r.child_state}`);
      L.push(`Its goal gate: accept=${r.accept} match=${r.match_pct === undefined ? '?' : r.match_pct + '%'}`);
      if ((r.gaps || []).length) L.push(`Gaps it named:\n${bullets(r.gaps)}`);
      if ((r.spec_drift || []).length) L.push(`Spec drift it named:\n${bullets(r.spec_drift)}`);
      // The child's set fold (its own `reduce` node, plus the deterministic write-scope check
      // recorded onto it - item 1/2 of the reducer plan): what its parallel subgoals collided
      // on, carried up from foldChild's set_findings so this package's own accept sees it too.
      if (r.set_findings) {
        const sf = r.set_findings;
        if ((sf.collisions || []).length) L.push(`Files its subgoals both wrote with no single owner:\n${bullets(sf.collisions.map((c) => `${c.file || c}`))}`);
        if ((sf.undeclared || []).length) L.push(`Files on disk no subgoal declared:\n${bullets(sf.undeclared)}`);
        if ((sf.orphans || []).length) L.push(`Artifacts left by a superseded attempt:\n${bullets(sf.orphans)}`);
        const ws = sf.write_scope;
        if (ws && ((ws.collisions || []).length || (ws.undeclared_writers || []).length || (ws.heading_collisions || []).length)) {
          L.push(`Deterministic write-scope check also found:`);
          L.push(bullets([
            ...ws.collisions.map((c) => `${c.file}: written by ${c.written_by.join(', ')}, declared by ${c.declared_by.length ? c.declared_by.join(', ') : '(nobody)'}`),
            ...ws.undeclared_writers.map((u) => `${u.subgoal_id} wrote ${u.file}, declared by ${u.declared_owners.join(', ')}`),
            ...ws.heading_collisions.map((h) => `${h.file}: ${h.subgoals.join(' & ')} — ${h.reason}`),
          ]));
        }
      }
      // §5b: a QA package's own execute node(s), read directly off the child run (foldChild's
      // defectsFound) regardless of whether the child ever reached a goal-gate verdict about
      // them. The qa accept contract (below) tells this agent to relay every one of these into
      // its own "defects" field - this is the list it must not drop any of.
      if ((r.defects || []).length) L.push(`Defects it reported:\n${bullets(r.defects)}`);
      // §upstream_defects: foldChild carries these through regardless of which package's child
      // reported them (not QA/audit-only, unlike r.defects above) - the accept contract (above)
      // tells this judge to relay every one of them into its own JSON verbatim.
      if ((r.upstream_defects || []).length) {
        L.push(`Upstream defects it reported:\n${bullets(r.upstream_defects.map((d) => `${d && d.package ? `${d.package}: ` : ''}${(d && d.title) || String(d)}${d && d.evidence ? ` -> ${d.evidence}` : ''}`))}`);
      }
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
    // A budget/timebox sweep reintegrates over only what accepted. Judged against the whole goal
    // that set can never verify - code-sprint-S5's integrate:2 refused because the skipped P3/P4's
    // work was "unowned", which is exactly what the sweep already recorded, and the task ended
    // blocked with no report. Here the question is whether the kept packages work together.
  }
  // The same scope holds for the goal gate that judges that reintegration.
  if ((n.stage === 'integrate' || String(n.node_id).startsWith('gate:goal'))
      && task.budget_stopped && (task.budget_stopped.skipped_packages || []).length) {
    const verdictField = n.stage === 'integrate' ? 'verified' : 'accept';
    L.push('');
    L.push(`## Scope: the Sprint's box ran out`);
    L.push(`budget_usd/timebox_minutes stopped this task. Packages ${task.budget_stopped.skipped_packages.join(', ')} were never dispatched and are carried to the next Sprint - their work is absent BY DESIGN, not a defect. Judge only the packages that were merged: that they work together and meet their own acceptance, and the goal-level criteria they alone can satisfy. Set ${verdictField} true if they do. Name the skipped work (in unowned or gaps) for the record, but it is not a reason to refuse.`);
  }
  if (n.stage === 'report') {
    // The same account tm_status/tm_board and view.mjs's header now show (collectDriverCosts,
    // drivercost.mjs) - stated here explicitly so 80-report.md (docs.mjs's renderReport, which
    // relays this node's own `report` string verbatim) actually says what the task cost instead
    // of that number sitting only in the raw drivers/*.stream.jsonl logs.
    const reportCost = collectTaskCosts(taskDir(task.run_id), task);
    L.push('');
    L.push(`## Cost and turns`);
    L.push(`Total across every session this task spawned: $${reportCost.cost_usd.toFixed(2)} ($${reportCost.drivers_usd.toFixed(2)} driver and manager sessions + $${reportCost.nodes_usd.toFixed(2)} node sessions), ${reportCost.turns} turns, ${reportCost.sessions} sessions.`);
    L.push(`State this in the report - it is the one place a person reads it without opening a raw driver log.`);
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
  // The project's own rules reach the manager's judging stages too: shape splits the work and
  // accept/gate judge the result, and until now neither could see a project rule at all -
  // conventions.mjs was wired into the child graph's stages only (2026-09-22).
  if (MANAGER_CONVENTION_STAGES.has(n.stage)) {
    const conv = conventionsBlock(task.cwd, { stage: 'manager' });
    if (conv) { L.push(''); L.push(conv); }
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
  if (n.stage === 'accept') {
    const judged = packageOf(task, n.subgoal_id);
    if (judged && ACCEPT_EXTRA[judged.phase]) L.push(ACCEPT_EXTRA[judged.phase]);
  }
  L.push('');
  L.push(`Return that JSON object and nothing else.`);
  return L.join('\n');
}

// ---------- verdicts ----------

export function succeeded(task, n, result) {
  if (result.stage_ok !== true) return false;
  const f = VERDICT[n.stage];
  if (!f) return true;
  if (result[f] !== true) return false;
  // The manager's own goal gate is held to the same floor the graph engine holds its
  // goal gate to: accept:true at 40% match is reporting a partial result as a pass.
  // There is no per-package gate in the manager - every 'gate' node here IS the goal gate.
  // And by that same reading `accept` IS the gate for its package, so it gets the same floor:
  // without one, match_pct was decorative on every accept node. idol-pm-1's PRD was accepted at
  // 88% by a judgement whose own text said the document named nothing specific to the domain
  // ("fan-club"/"팬클럽"/"presale" zero times) - the number was recorded and nothing acted on it.
  // A rejection here is not the end of the package: it buys the retry max_retries already
  // budgets, with the gaps that cost it the points carried into the next attempt.
  // An accept below the floor fails only when the judge named something missing. The gate
  // contract tells a judge that a run which met its bar with known weaknesses is not a 100, and
  // observations never block - so an accept:true with gaps[] empty lands at 87-88 by design, and
  // the floor was turning those points into a rejection the judge never made. idol-pm-4
  // (2026-09-23): P2 and P5 accepted at 88 with no gaps, both failed, both rebuilt from scratch.
  // idol-pm-1's PRD, the case the floor exists for, named its gap - it still fails.
  if ((n.stage === 'gate' || n.stage === 'accept') && Number.isFinite(result.match_pct)) {
    const floor = Number.isInteger(task.goal_threshold) ? task.goal_threshold : 90;
    const named = Array.isArray(result.gaps) && result.gaps.length > 0;
    // accept:QA is the exception: its points are docked for the defects it files, and filing them
    // is what fixes them. Failing it on the floor dropped the defects (the file hook runs only on
    // 'done') and reran the whole QA on the same tree (awake-beta-ref1: accept:QA:2 accepted at
    // 72 with a real defect filed, failed on the floor, dispatch:QA:3 reopened over the same bug).
    const filesDefects = n.stage === 'accept' && n.subgoal_id === 'QA'
      && Array.isArray(result.defects) && result.defects.length > 0;
    // A goal gate after a budget/timebox sweep judges a Sprint that deliberately left packages
    // undone: its match against the WHOLE goal sits below the floor by construction (code-sprint-S6:
    // accept:true at 72 with three of four backlog items shipped, failed on the floor, no report).
    // The judge's own accept stands; the shortfall is what the retro's Next backlog carries.
    const boxedGoal = n.stage === 'gate' && String(n.node_id).startsWith('gate:goal')
      && task.budget_stopped && (task.budget_stopped.skipped_packages || []).length > 0;
    if (result.match_pct < floor && (n.stage === 'gate' || named) && !filesDefects && !boxedGoal) return false;
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

// Gap 2 (judge≠author): the manager's own reasoning nodes - shape, critique, accept, integrate,
// gate, gate:goal - all run through daemon.mjs's judge(), one identical `claude -p` invocation
// per node (that file's own comment on judge()): no vendor is ever selected among candidates and
// no executor/vendor is ever recorded on a manager node, unlike a package's dispatch/accept
// chain, which broker.mjs routes and tags normally. routing.mjs's AUTHOR_OF same-actor penalty
// only nudges a CHOICE among ranked candidates, and judge() offers no choice to nudge - "route
// it away" (the same phrase openAudit's own gap answers with externalAuthorOf) has no move to
// make here today, since nothing stands ready to run critique or accept on a second identity.
// What is still owed, and what this gives, is the honest half of broker.mjs's own
// reviewIndependence pattern: recording reviewer_independence rather than asserting an
// independence this path cannot back up. Both sides of a manager judgement are the same
// untracked host identity by construction (`self`, the same word broker.mjs's own identityOf
// falls back to for an executor it cannot see), so this always reads 'unverifiable-self' -
// never 'distinct-identity', because nothing here could prove that even when accept's own
// package really did land on a peer vendor (broker.mjs's normal cross-vendor routing still
// applies to a package's own dispatch/accept chain - only the MANAGER's own nodes are exempt
// from it): the manager's own side of the comparison has no identity of its own to compare
// with, so "unverifiable" is the honest word regardless of what the other side turns out to be.
function managerReviewerIndependence(task, n) {
  if (n.stage === 'critique') {
    const shape = task.nodes.filter((x) => x.stage === 'shape' && x.state === 'done').pop();
    return shape ? 'unverifiable-self' : null;
  }
  if (n.stage === 'accept') {
    const dispatch = task.nodes.find((x) => x.stage === 'dispatch' && x.subgoal_id === n.subgoal_id
      && x.node_id === n.node_id.replace(/^accept:/, 'dispatch:'));
    const child = dispatch && dispatch.child ? loadRun(dispatch.child.cwd, dispatch.child.run_id) : null;
    if (!child) return null;
    const sg = child.spec && Array.isArray(child.spec.subgoals) ? child.spec.subgoals[0] : null;
    if (!sg) return null;
    const chain = (KINDS[kindOf(sg)] || KINDS[DEFAULT_KIND]).chain;
    // Any mutating (non-final) stage of the chain having a done node is enough to say
    // "this package was authored" - which specific stage (implement/draft/execute) does not
    // matter here, unlike planAuthorIdentity's audit-side need for the actual identity: accept
    // has no identity of its own to compare against, so only "was there an author" is asked.
    const authored = chain.slice(0, -1).some((stage) => child.nodes.some((x) => x.stage === stage
      && x.subgoal_id === String(sg.id) && x.state === 'done'));
    return authored ? 'unverifiable-self' : null;
  }
  return null;
}

export function finish(task, n, result) {
  // A node settling is what moves a ticket, and it is the one place both callers pass through -
  // tm_submit and the daemon alike. Hooking the caller instead left the whole surface stale
  // between steps, and a daemon step is a whole judge call long (2026-09-22).
  const ticketsBefore = ticketSnapshot(task);
  // The merges the manager made are part of the integrate node's account.
  if (n.stage === 'integrate' && n.integration) {
    result = { ...result, integration_branch: n.integration.branch, integration_cwd: n.integration.cwd,
      merged: (n.integration.merged || []).map((m) => `${m.package} ${m.branch} -> ${m.commit}`) };
  }
  const reviewerIndependence = managerReviewerIndependence(task, n);
  if (reviewerIndependence) result = { ...result, reviewer_independence: reviewerIndependence };
  const f = VERDICT[n.stage];
  const floor = Number.isInteger(task.goal_threshold) ? task.goal_threshold : 90;
  const belowFloor = n.stage === 'gate' && f && result[f] === true
    && Number.isFinite(result.match_pct) && result.match_pct < floor;
  if (belowFloor && task.budget_stopped && (task.budget_stopped.skipped_packages || []).length && String(n.node_id).startsWith('gate:goal')) {
    result = { ...result, goal_floor_waived: `budget/timebox stopped the Sprint with ${task.budget_stopped.skipped_packages.join(', ')} undone; match_pct ${result.match_pct} is judged against the whole goal` };
  }
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

  // Manager-level reduce (item 4): every package's declared fold - who changed what, its
  // verdicts across attempts, defects, cost if a dispatch ever reports one - carried through
  // the same registry foldChild and the run-level reduce use. Attached once integrate settles,
  // since that is the point every package this round touches has a dispatch result to fold.
  if (n.stage === 'integrate' && n.state === 'done') {
    n.result = { ...n.result, package_fold: foldPackageHistory(task) };
  }

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
    const planDispatch = task.planning_pkg ? task.nodes.find((x) => x.node_id === 'dispatch:PLAN:1') : null;
    const userStories = task.planning_pkg
      ? ((planDispatch && planDispatch.result && Array.isArray(planDispatch.result.user_stories)) ? planDispatch.result.user_stories : [])
      : null;
    const problems = validateShape(result, userStories);
    if (problems.length) {
      n.state = 'failed';
      n.result = { ...result, stage_ok: false, shape_problems: problems, reason: `unusable shape: ${problems.join('; ')}` };
    } else {
      task.spec = {
        acceptance: result.acceptance,
        packages: result.packages.map((p, i) => ({ ...p, id: String(p.id), priority: Number.isInteger(p.priority) ? p.priority : i })),
      };
      expandPackages(task, task.spec.packages);
    }
  }
  // The QA phase-Team's gate result carries defects (§5b), not a pass/fail on the QA package
  // itself - `accept:QA:N` still finishes 'done' whether or not it found any. Capped by
  // qa_rounds: once the QA package has already been attempted that many times, a further defect
  // is not filed as a new STORY - it is recorded for the report's "unresolved defects" section
  // instead, and the EPIC proceeds (gate:goal is already wired to this very node - see the
  // integrate-completion hook below).
  if (n.stage === 'accept' && n.subgoal_id === 'QA' && n.state === 'done') {
    const defects = Array.isArray(result.defects) ? result.defects : [];
    if (defects.length) {
      const qaAttempts = task.nodes.filter((x) => x.stage === 'accept' && x.subgoal_id === 'QA').length;
      const cap = Number.isInteger(task.team && task.team.opts && task.team.opts.qa_rounds)
        ? task.team.opts.qa_rounds : TEAM_DEFAULTS.qa_rounds;
      if (qaAttempts > cap) {
        task.unresolved_defects = (task.unresolved_defects || []).concat(defects.map((d) => ({ ...d, round: qaAttempts })));
      } else {
        fileDefects(task, defects, { reporter: 'qa' });
      }
    }
  }
  // §upstream_defects: ANY package's accept (not just QA/AUDIT) can carry these - foldChild reads
  // them off the child's own implement/test/gate regardless of package phase, and the base accept
  // contract (above) tells every judge to relay them through. File each as a fix STORY owned by
  // the upstream package's own scope, and reopen THIS package's own next attempt wired onto the
  // fix instead of blindly repeating what just passed against a still-broken dependency.
  if (n.stage === 'accept' && n.state === 'done' && Array.isArray(result.upstream_defects) && result.upstream_defects.length) {
    fileUpstreamDefects(task, n.subgoal_id, result.upstream_defects);
  }
  // Every integrate that finishes reroutes gate:goal behind it (see fileDefects/reintegrateBehind
  // above and retryPackage's own re-integrate loop) - so "an integrate just finished" is the one
  // moment that generalizes over both "the first round" (expandPackages already wired QA ahead of
  // time, at shape) and "a later round" (a filed defect's fix, where nothing has wired QA yet).
  // Reopen a fresh QA round here, lazily, only when nothing already depends on THIS integrate for
  // QA - which is deliberately what makes the phase-Team exemption above still safe: by the time
  // any integrate reaches 'done', every package it depends on is already done too (integrate's own
  // deps are every one of those accepts), so the QA dispatch this opens is never concurrent with a
  // develop STORY dispatch that fed into it.
  if (n.stage === 'integrate' && n.state === 'done'
    && task.team && task.team.opts && task.team.opts.roles && task.team.opts.roles.qa) {
    const alreadyWired = task.nodes.some((x) => x.stage === 'dispatch' && x.subgoal_id === 'QA' && x.deps.includes(n.node_id));
    if (!alreadyWired) {
      const goal = task.nodes.filter((x) => x.stage === 'gate' && x.subgoal_id == null).pop();
      const qaRound = nextIndex(task, 'dispatch:QA');
      const qaAccept = pushChain(task, PACKAGE_CHAIN, 'QA', qaRound, [n.node_id], [], {});
      if (goal) goal.deps = [qaAccept];
    }
  }
  // planning's second pass (§2, decision #4). The trigger is "the node gate:goal is waiting on
  // just finished": accept:QA:N when roles.qa is on, the integrate itself when it is off. Reading
  // gate:goal's own dep rather than the node's stage alone is what keeps this from firing on a
  // round that ended in defects - fileDefects (above) has already rerouted gate:goal to a fresh
  // integrate by the time this runs, so the audit waits for the fix instead of auditing a tree
  // that is about to be rebuilt.
  // The `&& !roles.qa` on the integrate branch below looks like it is keeping this from firing
  // on an integrate that QA still needs to see, but it is dead: verified by mutation (removed it,
  // the full suite - including the roles.qa-on tests above - stayed green). When roles.qa is on,
  // the QA-reopen hook just above ALWAYS runs first for the same finishing integrate node and
  // rewrites goal.deps to a fresh accept:QA:N before this line ever reads it, so the `goal.deps[0]
  // === n.node_id` check two lines down is already false by the time it matters - the `!roles.qa`
  // never gets to be the reason. When roles.qa is off, `!roles.qa` was true anyway, so it changes
  // nothing there either. Left in (not deleted) because it reads as documentation of intent - "do
  // not open the audit out from under a pending QA round" - even though the reopen hook's own
  // side effect on goal.deps is what actually enforces that.
  const roles = (task.team && task.team.opts && task.team.opts.roles) || {};
  // roles.audit defaults true, paired with roles.planning exactly like before this key existed
  // (teamconfig.mjs) - so a project that never sets it keeps today's behaviour, and one that
  // sets `roles: {audit: false}` keeps the rest of planning without the post-integration pass.
  if (roles.planning && roles.audit !== false && n.state === 'done'
    && ((n.stage === 'accept' && n.subgoal_id === 'QA') || (n.stage === 'integrate' && !roles.qa))) {
    const goal = task.nodes.filter((x) => x.stage === 'gate' && x.subgoal_id == null).pop();
    if (goal && goal.deps.length === 1 && goal.deps[0] === n.node_id) openAudit(task, n.node_id);
  }
  // An unmet user story the audit named is filed exactly like a QA-found defect - same STORY
  // path, same detour through a fresh integrate - under its own reporter, and capped by the same
  // qa_rounds knob for the same reason: a pass that can file work which reopens the pass needs a
  // bound, and a second knob for the second such pass would only be two numbers to keep in step.
  if (n.stage === 'accept' && n.subgoal_id === 'AUDIT' && n.state === 'done') {
    const unmet = (Array.isArray(result.unmet) ? result.unmet : [])
      .map((u) => (u && typeof u === 'object' ? u : { title: String(u), evidence: '' }));
    if (unmet.length) {
      const rounds = task.nodes.filter((x) => x.stage === 'accept' && x.subgoal_id === 'AUDIT').length;
      const cap = Number.isInteger(task.team && task.team.opts && task.team.opts.qa_rounds)
        ? task.team.opts.qa_rounds : TEAM_DEFAULTS.qa_rounds;
      if (rounds > cap) {
        task.unresolved_defects = (task.unresolved_defects || []).concat(unmet.map((u) => ({ ...u, reporter: 'planning-audit', round: rounds })));
      } else {
        const out = fileDefects(task, unmet, { reporter: 'planning-audit' });
        // What 65-audit.md links. Kept on the node rather than recomputed from the package list
        // because a later round's STORYs would be indistinguishable from this one's.
        n.result = { ...n.result, filed: out.filed };
      }
    }
  }
  // D2 slice 3 (0.29.0): the manager graph's own judging/deciding stages (shape, critique,
  // accept, integrate, gate, gate:goal) get the same `questions[]` treatment the child-run
  // graph's stages do (broker.mjs's finishNode, its own comment explains the contract shape) -
  // reused unmodified because task.json is itself a run (openAsk/getNode work over any
  // object with `.nodes`). Manager-level cards get a briefing written explicitly, the way
  // writeHumanBriefing does for a child run - toolNext's own ready-node loop never sees an
  // `ask` node because openAsk parks it 'waiting_human' at birth, never 'pending'.
  if (n.state === 'done' && Array.isArray(n.result.questions) && n.result.questions.length) {
    const decidable = n.result.questions.filter((q) => q && q.question
      && ((Array.isArray(q.options) && q.options.length > 1) || q.default !== undefined));
    if (decidable.length) {
      if (task.interactive) {
        for (const askId of openAsk(task, n, decidable)) writeManagerBriefing(task, getNode(task, askId));
      } else {
        task.unasked = [...(task.unasked || []), ...decidable.map((q) => ({
          subgoal_id: n.subgoal_id, node_id: n.node_id, stage: n.stage,
          question: q.question, owner: q.to || null, options: q.options || null,
          decided: q.default !== undefined ? q.default : null, why: q.why || null,
        }))];
      }
    }
  }
  saveRun(task);
  record(task, { event: 'node_finish', task_id: task.run_id, node_id: n.node_id, stage: n.stage, stage_ok: n.result.stage_ok === true, state: n.state });
  try { syncTickets(task, ticketsBefore, n.node_id); } catch { /* evidence, not a dependency */ }
  return verdict(task, n);
}

// ---------- tools ----------

const NEXT_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string' },
    // 'delegated' has no producer: a size-S task always opens its own run via openSRun and
    // reports task_state: 's_run' (delegateIfSmall) - see the removed `delegate` field below,
    // same story.
    state: { type: 'string', enum: ['running', 'blocked', 'complete'] },
    counts: { type: 'object' },
    size: { type: 'string', enum: ['S', 'L'] },
    flow: { type: 'string' },
    run_id: { type: 'string' },
    cwd: { type: 'string' },
    ready: { type: 'array', items: { type: 'object', properties: {
      node_id: { type: 'string' }, stage: { type: 'string' }, briefing_path: { type: 'string' }, next: { type: 'string' },
    }, required: ['node_id', 'stage'] } },
    children: { type: 'array', description: 'running dispatch nodes and their child runs', items: { type: 'object', properties: {
      node_id: { type: 'string' }, package_id: { type: 'string' }, cwd: { type: 'string' }, run_id: { type: 'string' },
      branch: { type: 'string' }, child_state: { type: 'string' }, next: { type: 'string' },
    } } },
    view_url: { type: 'string', description: 'the one browser window for this tasks root (scripts/view.mjs, ensureViewer): open it to watch the run. Absent when TEAMS_VIEW=0 or the viewer could not start - never required, a task opens the same either way.' },
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
    task_state: { type: 'string', enum: ['s_run'], description: 'present, and always "s_run", on the tm_submit reply that resolves the size node to S: the task opened its own graph run (openSRun) and this reply already carries tm_next\'s own fields (ready/children/etc.) for that run. Absent for every other node, and for a size-L task, where those same fields describe the manager\'s own graph instead.' },
  },
  required: ['task_id', 'node_id', 'stage', 'state', 'stage_ok'],
};

const TOOLS = [
  {
    name: 'tm_open',
    description: 'Open a task for a request that may be too large for one graph run. Builds size -> shape -> critique on disk under ~/.harness/tasks/<task_id>/ and spawns a daemon process that drives the whole task to completion by itself - size, shape, critique, every package dispatch and fold, integrate, the goal gate, the report. The caller never drives a node: watch with tm_status/tm_board/tm_events, or block for a bounded stretch with tm_wait. Routing arguments are passed through to every child run. Prefer tm_run for a caller that does not also want tm_next\'s node-by-node reply.',
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
        stall_minutes: { type: 'integer', description: 'default 20, also settable in .claude/team.json. A driver can be alive (its pid answers) and still be making no progress - this is the "no progress" signal, read against the mtime of the files this child\'s own run writes. Idle this long flags the dispatch once (stalled_since, cleared the moment progress resumes); idle 3x this long kills the driver and lets the ordinary dead-driver path respawn it, spending a restart. 0 disables the whole check.' },
        restart_period_minutes: { type: 'integer', description: 'default 0 (a flat, forever counter - today\'s behavior), also settable in .claude/team.json. >0 turns driver_restarts into a sliding window in minutes: only restarts within the last restart_period_minutes count toward the budget, so a driver that dies rarely never exhausts a budget sized for "how many deaths in a row".' },
        interactive: { type: 'boolean', description: 'default false, also settable in .claude/team.json. Passed to every child run. When a planning subgoal\'s investigate stage comes back with a decision it could not settle from any source but CAN name candidates for, true opens an `ask` card between investigate and draft and parks that run in waiting_human until a person picks - tm_inbox lists it (with its questions and options), tm_submit({key, payload:{decisions}}) answers it. false decides by default and records the questions on the run instead, so the report can show what nobody was asked.' },
        goal_threshold: { type: 'integer', description: 'default 90: the manager\'s own goal gate must report match_pct at or above this to accept, and it is passed through to every child run as its own goal_threshold. A gate that says accept with 40% match is reporting a partial result as a pass. 0 accepts on the verdict alone.' },
        goal_judges: { type: 'integer', description: 'default 1: independent judges on EVERY child run\'s own goal gate (each package\'s dispatch, and the one run a size-S task opens). >1 opens that many sibling gate nodes per round, routed to different identities where possible, and accepts only if every judge accepts at or above goal_threshold - the same mechanism team_open documents (default 2 there). The default stays 1 here, matching every run this manager has ever opened, so an existing project sees no change in judge count or cost unless it asks for more. This is the child run\'s own gate, not the manager\'s own top-level gate:goal, which is a separate, single-judge mechanism unaffected by this option.' },
        retry_policy: { type: 'string', enum: ['continue', 'rollback'], description: 'default "continue", also settable in .claude/team.json. What a retried attempt does with the worktree the failed one left: "continue" (default, today\'s only behavior) builds the next attempt on top of it. "rollback" resets the worktree first - a subgoal\'s own implement/draft to the checkpoint recorded before ITS first attempt touched it (single-subgoal child runs only; a shared worktree with a sibling subgoal still in flight cannot be reset for one of them, so it falls back to continue and says why), a package\'s own retry (tm_retry/retryPackage) to its last ACCEPTED commit, or the worktree\'s base commit if none of its attempts ever passed - then re-runs with the failed gate\'s gaps as feedback either way. docs/plans/2026-09-23-teams-reducer-human-rollback.md §5 measured two real runs before defaulting to continue: both showed a retried implement CONVERGING on gate feedback across attempts rather than repeating the same mistake, so there is no evidence yet that discarding an attempt\'s work helps more than it loses.' },
        budget_usd: { type: ['number', 'null'], description: 'default null (unlimited), also settable in .claude/team.json. Spend is summed from every driver\'s own stream log under this task (drivers/*.stream.jsonl result events\' total_cost_usd) each daemon tick. At 80% of this a warning is recorded once (tm_status shows it); at 100% no NEW package is dispatched - a package already running finishes - and once nothing is left running, a fresh integrate opens over just what accepted, naming the rest "not done" in the report rather than dropping them silently. Whichever of budget_usd/timebox_minutes is closer to its own limit decides; either alone is a real stop.' },
        timebox_minutes: { type: ['number', 'null'], description: 'default null (unlimited), also settable in .claude/team.json. Minutes since tm_open, the same stop condition budget_usd is, on the same clock - see its own description for exactly what 80% and 100% do.' },
        requests: { type: 'array', items: { type: 'string' }, description: 'A backlog instead of one request: several EPIC-level items, priority = array order (first is highest). shape treats each as its own story set; with budget_usd/timebox_minutes in play, the lowest-priority items still unshaped or undispatched when the stop trips are exactly what the report names "Next backlog". Mutually exclusive with `request` - send one or the other, never both.' },
        context_from: { type: 'string', description: 'A prior task_id (or its ticket key). Its retro.json - the Retrospective and Next backlog a finished task\'s report stage writes - is read and folded into this task\'s own context: what failed and why, retries, defects left, and any unaccepted packages or unresolved questions the prior task ran out of budget/timebox to reach. The prior task\'s own Next backlog is NOT auto-added to `requests` - naming it here is a decision this task\'s own request should still make in its own words.' },
      },
      required: ['request', 'cwd'],
    },
    outputSchema: NEXT_SCHEMA,
  },
  {
    name: 'tm_run',
    description: 'Open a task exactly like tm_open, and spawn the same daemon to drive it - but never self-drive and never return a node table: just {task_id, run_id, docs_dir}. This is the entry point for a caller that wants to hand off a whole request and walk away (§4-B of the design doc); follow up with tm_wait for a bounded look at progress, or tm_status/tm_board any time, or nothing at all if only the final docs matter.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string' }, cwd: { type: 'string' }, context: { type: 'string' },
        flow: { type: 'string', enum: ['auto', 'develop', 'document'] },
        vendor: { type: 'string' }, allocation: { type: 'string', enum: ['ordered', 'balanced'] },
        host_vendor: { type: 'string' }, host_model: { type: 'string' }, native_models: { type: 'array', items: { type: 'string' } },
        size: { type: 'string', enum: ['S', 'L'] },
        model: { type: 'string' }, policy: { type: 'object' }, candidates: { type: 'array', items: { type: 'string' } },
        skills: { description: 'Same meaning as tm_open({skills}).' },
        sandbox: { type: 'string' }, max_retries: { type: 'number' },
        isolated: { type: 'boolean' }, mixed: { type: 'boolean' },
        driver_restarts: { type: 'integer' }, goal_threshold: { type: 'integer' }, goal_judges: { type: 'integer' },
        stall_minutes: { type: 'integer' }, restart_period_minutes: { type: 'integer' },
        budget_usd: { type: ['number', 'null'], description: 'Same meaning as tm_open({budget_usd}).' },
        timebox_minutes: { type: ['number', 'null'], description: 'Same meaning as tm_open({timebox_minutes}).' },
        requests: { type: 'array', items: { type: 'string' }, description: 'Same meaning as tm_open({requests}) - mutually exclusive with `request`.' },
        context_from: { type: 'string', description: 'Same meaning as tm_open({context_from}).' },
      },
      required: ['request', 'cwd'],
    },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' }, run_id: { type: 'string' }, docs_dir: { type: 'string' }, state: { type: 'string' }, view_url: { type: 'string', description: 'see tm_open({view_url}) - same viewer, same tasks root.' } }, required: ['task_id', 'run_id', 'docs_dir'] },
  },
  {
    name: 'tm_next',
    description: 'Which manager nodes are ready, each with a briefing_path for a fresh agent, plus every running child as {cwd, run_id, driver}. A ready dispatch node is executed here and now: its worktree is created, its child graph run opened, and a headless driver process spawned to run that child to the end. Also where a dead driver is serviced: respawned on the same run_id (driver.restarts) if the budget allows, or parked on waiting_capacity after a usage-limit death - neither needs you to do anything but poll again. A size-S task under s_driver "process" has no manager nodes at all; tm_next instead returns {run_id, cwd, driver, nodes, report} for the one run it is driving, ready for the entry skill\'s output template once state is complete or blocked. Poll tm_next while a driver is alive; do not drive that child yourself. tm_submit the dispatch node once the child is no longer running. A task opened with a daemon in play (tm_open/tm_run when not under a test seam) is normally left to the daemon - call tm_next only to drive by hand or to inspect a node\'s briefing_path.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    outputSchema: NEXT_SCHEMA,
  },
  {
    name: 'tm_wait',
    description: 'Bounded long-poll on a task the daemon is driving: blocks up to max_ms, returning the node transitions (finished nodes, newest last) recorded since `cursor`, or an empty list on timeout - never the full state. Pass the previous reply\'s `cursor` back in to continue watching without re-reading anything already seen; omit it (or pass 0) to start from the beginning. This is the way to watch a tm_run/tm_open task without accumulating its payload in your own context: call again with the returned `cursor` while `state` is "running", stop when it is "complete" or "blocked".',
    inputSchema: { type: 'object', properties: {
      task_id: { type: 'string' },
      cursor: { type: 'number', description: 'a ts from a previous tm_wait reply; 0 or omitted to start from the beginning' },
      max_ms: { type: 'number', description: 'default 60000, capped at 300000 - the same cap tm_next\'s old wait_ms used, measured to return cleanly through Claude Code\'s MCP client' },
    }, required: ['task_id'] },
    outputSchema: { type: 'object', properties: {
      task_id: { type: 'string' }, state: { type: 'string' }, counts: { type: 'object' },
      cursor: { type: 'number', description: 'pass this back as the next call\'s cursor' },
      timed_out: { type: 'boolean' },
      transitions: { type: 'array', items: { type: 'object', properties: {
        node_id: { type: 'string' }, stage: { type: 'string' }, state: { type: 'string' }, stage_ok: { type: 'boolean' }, ts: { type: 'number' },
      } } },
    }, required: ['task_id', 'state', 'cursor', 'transitions'] },
  },
  {
    name: 'tm_submit',
    description: 'Record a manager node. For size/shape/critique/accept/integrate/gate/report pass the payload the fresh agent returned. For a dispatch node pass no payload: the manager reads the child run file and folds its goal-gate verdict and report into the node. Refused while the child is still running and its driver alive, or waiting_capacity (a usage-limit death; use tm_retry({reset_capacity:true})); a child whose driver died mid-run and spent its whole restart budget folds as blocked, with every attempt\'s stderr. Pass `key` (a TASK ticket key from tm_inbox) instead of node_id to submit a human\'s own answer for a waiting_human card - the flow continues exactly as if a driver had submitted it (its child run\'s driver resumes automatically); a later gate rejection sends the next attempt back to waiting_human for the same human, never to a model. Idempotent per {task_id, node_id, attempt}: node_id already carries the round for every retryable stage (dispatch:P1:2, shape:2), so a duplicate submit of a node that already finished is a no-op returning the stored verdict (`idempotent: true`) - it does not re-fold a dispatch (no second git commit) or re-run finish()\'s side effects. Pass `attempt` for a stricter check.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, node_id: { type: 'string' }, key: { type: 'string', description: 'a TASK key (E-xxxxxxxx/Pn/subgoalId) naming a waiting_human card, in place of node_id' }, attempt: { type: 'integer', description: 'this node\'s attempt number, for the idempotency check above. Optional - node_id already disambiguates attempts for every retryable stage.' }, payload: { type: 'object' } },
      required: ['task_id'],
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
    name: 'tm_file',
    description: 'File one or more develop STORYs directly against a task that has already reached goal level (a gate:goal node exists) - the same path a QA-found defect takes (§5b: a fresh package per story, its own dispatch/accept chain, a fresh integrate opened behind it, gate:goal - and a fresh QA round if roles.qa is on - rerouted there), but reporter: "you" on the board instead of "qa". Never checked against qa_rounds: a user filing a STORY is not a QA round, so this always proceeds regardless of how many QA rounds this task has already run.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        stories: { type: 'array', items: { type: 'object', properties: {
          title: { type: 'string' },
          touches: { type: 'array', items: { type: 'string' } },
          deps: { type: 'array', items: { type: 'string' }, description: 'sibling package ids this STORY builds on - resolved to their current accept.' },
          evidence: { type: 'string' },
          severity: { type: 'string' },
        }, required: ['title'] } },
      },
      required: ['task_id', 'stories'],
    },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' }, filed: { type: 'array', items: { type: 'string' } }, integrate: { type: 'string' } }, required: ['task_id', 'filed'] },
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
  {
    name: 'tm_board',
    description: 'Ticket-shaped board (§4/§8 of the design doc). Omit task_id for every EPIC this manager knows (key, state, phase). With task_id: the EPIC header plus its STORY kanban - one row per package, its state derived from task.json the same way tm_status is, never a second source of truth - and a doc_path to the human-readable INDEX.md (which may not exist on disk yet; see tm_docs). task_id accepts a full run id or the ticket key E-xxxxxxxx (the same 8-hex-prefix resolution tm_ticket uses). Read-only.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } } },
    outputSchema: { type: 'object' },
  },
  {
    name: 'tm_ticket',
    description: 'One ticket by key: E-xxxxxxxx for the EPIC, E-xxxxxxxx/Pn for a STORY. State, worktree/branch, task progress (x/y) and the last accept verdict, plus a doc_path. Read-only; a doc_path is always returned, even before tm_docs has written anything there.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    outputSchema: { type: 'object' },
  },
  {
    name: 'tm_assign',
    description: 'Pin a card to a human, or release it back to auto. `key` is a STORY (E-xxxxxxxx/Pn, every subgoal in that package\'s child run) or TASK (E-xxxxxxxx/Pn/subgoalId, just that one) ticket key. `to: "human"` (optionally `who`, or `to: {executor: "human", who}`) pins the subgoal\'s AUTHOR stage only (implement/draft/cases - see graph.mjs\'s authorStage) - a judging stage (test/review/gate/critique) is never assigned to the human who did the work. `to: "auto"` releases it: a card already parked waiting_human goes back to pending and dispatches normally on the next team_next. The pin lives on the child run\'s own spec (the same `assignee` field setgoal itself may write), so a rejected human-authored subgoal\'s next attempt is pinned again automatically. Called here, by the user, the pin always parks the node in waiting_human regardless of the run\'s interactive setting - the user is present by definition. The SAME field, written by a shape/setgoal instead, only parks when the run is interactive; otherwise it is auto-decided (dispatched to an AI, recorded, listed in tm_inbox\'s `decided`) - see graph.mjs\'s applyHumanPin. A STORY may be taken before it dispatches: the pin rides on the package and reaches its child run when it opens. A TASK key needs the child run to exist.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        key: { type: 'string', description: 'E-xxxxxxxx/Pn (STORY) or E-xxxxxxxx/Pn/subgoalId (TASK)' },
        to: { description: '"human", {executor: "human", who: "<name>"}, or "auto" to release' },
        who: { type: 'string', description: 'shorthand for to: {executor: "human", who}' },
      },
      required: ['task_id', 'key', 'to'],
    },
    outputSchema: { type: 'object', properties: {
      key: { type: 'string' }, kind: { type: 'string', enum: ['STORY', 'TASK'] }, to: { type: 'string' }, who: { type: ['string', 'null'] },
      assigned: { type: 'array', items: { type: 'object', properties: { subgoal_id: { type: 'string' }, node_id: { type: 'string' }, state: { type: 'string' }, assignment: { type: ['object', 'null'] } } } },
    }, required: ['key', 'kind', 'to', 'assigned'] },
  },
  {
    name: 'tm_inbox',
    description: 'Two sections (design §7): `cards` is every waiting_human card, across every task (or one, with task_id) - a headless driver cannot reach a human, so this is how the main session finds work a human pinned to themselves (tm_assign, always honoured) or that this run is interactive about. For each: its TASK ticket key, title, what is asked (acceptance criteria and a briefing_path with the full brief), who it is assigned to, and since when. Complete one with tm_submit({task_id, key, payload}). `decided` is every card a MODEL tried to pin (a shape package or setgoal subgoal writing its own assignee) that this run auto-decided instead of parking, because the run is not interactive - dispatched to an AI as normal, with why recorded; object to one by tm_assign-ing it to a human yourself. Read-only; safe from any session.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } } },
    outputSchema: { type: 'object', properties: {
      cards: { type: 'array', items: { type: 'object', properties: {
        key: { type: 'string' }, task_id: { type: 'string' }, node_id: { type: 'string' }, title: { type: 'string' },
        acceptance: { type: 'array', items: { type: 'string' } }, briefing_path: { type: ['string', 'null'] },
        who: { type: ['string', 'null'] }, since: { type: ['number', 'null'] },
      } } },
      decided: { type: 'array', items: { type: 'object', properties: {
        key: { type: 'string' }, task_id: { type: 'string' }, node_id: { type: 'string' }, title: { type: 'string' },
        who: { type: ['string', 'null'] }, reason: { type: 'string' }, since: { type: ['number', 'null'] },
      } } },
    }, required: ['cards', 'decided'] },
  },
  {
    name: 'tm_docs',
    description: '(Re)render the phase markdown under <docs_dir>/E-<task8>/ from task.json - INDEX, request, shape, critique, one page per STORY, integrate, goal gate and report, whichever already have data (§7c). rebuild:true DELETES THE ENTIRE EPIC DOCS DIRECTORY FIRST, then writes every file fresh; without it (the default), existing files are simply overwritten and a stale file from a dropped package survives. The engine never reads these back - md is a rendered view, not a second source of truth.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, rebuild: { type: 'boolean', description: 'default false. true deletes <docs_dir>/E-<task8>/ recursively before re-rendering - destructive, use to clear stale files left by a dropped package.' } }, required: ['task_id'] },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' }, rebuild: { type: 'boolean' }, written: { type: 'array', items: { type: 'string' } } } },
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

// Synchronous on purpose, exactly like the old leader-era one this replaces: this whole server
// is one synchronous stdin loop (see the bottom of this file), and each client session has its
// own server process, so blocking here blocks nothing but the one tm_wait call that asked for it.
function sleepSync(ms) {
  if (!(ms > 0)) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// tm_wait's own read of the ledger: every `node_finish` record() emits (finish(), above) is
// already the transition a caller wants - node_id, stage, state, stage_ok - so tm_wait reads
// that stream back rather than keeping a second cursor-indexed log of its own.
function nodeTransitionsSince(task, since) {
  let lines = [];
  try { lines = readFileSync(join(taskDir(task.run_id), 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { lines = []; }
  return lines
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.event === 'node_finish' && e.ts > since);
}

const WAIT_MS_MAX = 300000;
// tm_wait: the bounded long-poll a caller uses to follow a daemon-driven task without holding
// its state in its own context (§4-A of the design doc). Unlike the old tm_next({wait_ms}) it
// replaces, this never drives anything itself - it only reads the ledger and re-raises a dead
// daemon (serviceDaemon, the same call every other tm_* entry makes) so a caller that keeps
// calling tm_wait is enough, on its own, to keep a task alive across a daemon crash.
function toolWait(a) {
  const budget = Math.min(Math.max(Number(a.max_ms) || 60000, 0), WAIT_MS_MAX);
  const since = Number(a.cursor) || 0;
  const until = Date.now() + budget;
  let task = mustFindTask(a);
  let events = nodeTransitionsSince(task, since);
  while (!events.length && Date.now() < until && taskState(task).state === 'running') {
    sleepSync(Math.min(2000, until - Date.now()));
    task = mustFindTask(a); // re-read from disk: the daemon writes task.json from its own process
    serviceDaemon(task);
    events = nodeTransitionsSince(task, since);
  }
  const st = taskState(task);
  const cursor = events.length ? events[events.length - 1].ts : since;
  return {
    task_id: task.run_id,
    state: st.state,
    counts: st.counts,
    cursor,
    timed_out: events.length === 0 && st.state === 'running',
    transitions: events.map((e) => ({ node_id: e.node_id, stage: e.stage, state: e.state, stage_ok: e.stage_ok === true, ts: e.ts })),
  };
}

// board.jsonl - ticket TRANSITIONS only, append-only, never read as ground truth. tickets.mjs's
// pure functions over task.json are the ground truth; this is the JIRA-style history a human
// reads (§4, §7b). Written by diffing a before/after snapshot around the tools that can actually
// move a ticket - never by instrumenting taskmanager.mjs's dozen individual mutation sites one at
// a time. tm_file joined this set in v0.12.1: filing a STORY moves its ticket from nonexistent to
// BACKLOG/READY exactly like tm_retry opening a repair package does.
const BOARD_TOOLS = new Set(['tm_open', 'tm_run', 'tm_next', 'tm_submit', 'tm_retry', 'tm_file']);

// The last state board.jsonl recorded for each key. Read rather than remembered: the two
// writers are in different processes, so an in-memory guard would not see the other's line.
function lastLoggedStates(path) {
  const last = new Map();
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const e = JSON.parse(line); if (e && e.key) last.set(String(e.key), String(e.to)); } catch { /* torn line */ }
    }
  } catch { /* no board yet */ }
  return last;
}

// The PRD's required sections, and the headings a document is allowed to call them. The
// contract names them exactly; a real run renamed two ("Goals (measurable)" for Success
// criteria, "Non-Goals" for Out of scope), dropped Solution overview entirely, and gate:goal
// accepted it at 95% (idol-pm-2, 2026-09-22). A judge will not check a structural requirement
// reliably, and it does not need to: this is a grep. The alternatives are the renames a reader
// would accept without blinking - anything further afield is a section that is missing.
const PRD_SECTIONS = [
  ['Problem', ['problem', 'problem statement', '문제']],
  ['Target users', ['target users', 'users', 'personas', 'users / personas', '대상 사용자']],
  ['Solution overview', ['solution overview', 'solution', 'overview', 'proposed solution', '솔루션']],
  ['Success criteria', ['success criteria', 'success metrics', 'goals', 'goals (measurable)', 'measurable goals', '성공 기준']],
  ['User stories', ['user stories', 'stories', '유저 스토리']],
  ['Out of scope', ['out of scope', 'non-goals', 'non goals', 'scope & non-goals', 'scope and non-goals', '비목표']],
  ['Open questions', ['open questions', 'open items', 'risks & open questions', 'risks and open questions', '미해결 질문']],
];

// Headings the PRD does not carry, under any of the names above, at any level. Reads the files
// the planning run reported writing; a file it cannot read is not evidence of absence, so an
// unreadable PRD yields no complaint here (the zero-stories check already covers the empty case).
export function missingPrdSections(cwd, paths) {
  let text = '';
  for (const rel of paths || []) {
    try { text += `\n${readFileSync(resolve(cwd, String(rel)), 'utf8')}`; } catch { /* unreadable */ }
  }
  if (!text.trim()) return [];
  const headings = (text.match(/^#{1,6} .*$/gm) || []).map((h) => h.replace(/^#+\s*/, '').replace(/[:：].*$/, '').trim().toLowerCase());
  return PRD_SECTIONS
    .filter(([, names]) => !headings.some((h) => names.some((n) => h === n || h.startsWith(`${n} `) || h.includes(n))))
    .map(([canonical]) => canonical);
}

// A ticket is three things and they have to agree: its state (tickets.mjs over task.json), its
// history (board.jsonl) and its body (docs.mjs's pages). Until now only the first was ever
// right - board.jsonl froze at tm_open and not one page was written, because both hung off MCP
// tool calls that the daemon, which owns the loop since v0.16.0, does not make. idol-pm-1
// (2026-09-22) ran 81 minutes with a DONE story still reading READY and an empty docs directory.
// This is the one place the whole surface is brought forward, called from the tool boundary and
// from the daemon's step alike. writeDocs is a pure re-render, so calling it often is cheap and
// idempotent; a failure to write evidence never fails the run that produced it.
export function syncTickets(task, before, by) {
  appendBoardTransitions(task, before, by);
  try { writeDocs(task); } catch { /* evidence, not a dependency - same rule as record() */ }
}

export function appendBoardTransitions(task, before, by) {
  const after = ticketSnapshot(task);
  const path = join(taskDir(task.run_id), 'board.jsonl');
  // Two writers now reach this: finish(), which snapshots around one node settling, and the
  // daemon, which snapshots around a whole step containing it. Their windows overlap, so the
  // same move is seen twice. The board is the ground truth for what it has already said, so a
  // transition into a state a key is already logged at is a re-observation, not a new move.
  const logged = lastLoggedStates(path);
  for (const [key, to] of Object.entries(after)) {
    const from = before[key] || null;
    if (from === to) continue;
    if (logged.get(key) === to) continue;
    try {
      mkdirSync(taskDir(task.run_id), { recursive: true });
      appendFileSync(path, JSON.stringify({ ts: Date.now(), key, from, to, by: String(by || 'tm') }) + '\n');
    } catch { /* the board is evidence, not a dependency - same rule as record() */ }
  }
}

function toolBoard(a) {
  if (!a.task_id) {
    let ids = [];
    try { ids = readdirSync(tasksRoot()); } catch { ids = []; }
    const epics = ids.map((id) => loadRunAt(taskPath(id))).filter(Boolean)
      .sort((x, y) => (y.created_at || 0) - (x.created_at || 0))
      .map((t) => ({ key: epicKey(t.run_id), task_id: t.run_id, title: String(t.request).slice(0, 60), state: epicTicketState(t), phase: epicPhase(t) }));
    return { epics };
  }
  const task = mustFindTask(a);
  // One collectDriverCosts call per task_id lookup - cheap (drivers/ is a handful of files even
  // on a large task), the same reason tm_status now pays it too.
  const driverTotal = collectTaskCosts(taskDir(task.run_id), task);
  return {
    key: epicKey(task.run_id),
    task_id: task.run_id,
    title: String(task.request).slice(0, 80),
    state: epicTicketState(task),
    phase: epicPhase(task),
    daemon: task.daemon ? { pid: task.daemon.pid, alive: driverAlive(task.daemon) } : null,
    cost: { usd: driverTotal.cost_usd, turns: driverTotal.turns, sessions: driverTotal.sessions },
    stories: epicBoardRows(task),
    doc_path: docPaths(task).index,
  };
}

// The EPIC half of a ticket key (E-xxxxxxxx) resolved to the run id it names - an 8-hex
// prefix match over tasksRoot(). Shared by tm_ticket and tm_board so both resolve an EPIC
// prefix identically and fail identically on an unknown one; a second copy of this lookup is
// how the two tools would drift apart again.
function findEpicByPrefix(epic8) {
  let ids = [];
  try { ids = readdirSync(tasksRoot()); } catch { ids = []; }
  const found = ids.find((id) => id.startsWith(epic8));
  if (!found) throw new Error(`no EPIC starting with ${epic8}`);
  return found;
}

// tm_board's task_id: accepts a full run id unchanged, or the ticket key E-xxxxxxxx (§8),
// resolved through findEpicByPrefix exactly as tm_ticket resolves its key's EPIC half.
// Anything else is passed through for mustFindTask to reject with its own "unknown task" error.
function resolveTaskRef(raw) {
  const s = String(raw || '');
  const m = /^E-([0-9a-f]{8})$/.exec(s);
  return m ? findEpicByPrefix(m[1]) : s;
}

// Resolves a ticket key into its task and, when present, package/subgoal segments - the same
// three-way split tm_assign needs (STORY for a package, TASK for a subgoal). One parser
// (tickets.mjs's parseTicketKey) plus one EPIC lookup, so tm_ticket and tm_assign can never
// again resolve the same key two different ways - the bug parseTicketKey's own header
// documents (a TASK key's "Pn/subgoalId" silently read as one greedy STORY pkgId).
function resolveTicketRef(key) {
  const parsed = parseTicketKey(key);
  if (!parsed) throw new Error(`unrecognized ticket key "${key}": expected E-xxxxxxxx, E-xxxxxxxx/Pn, or E-xxxxxxxx/Pn/subgoalId`);
  const found = findEpicByPrefix(parsed.epic8);
  const task = mustFindTask({ task_id: found });
  return { task, pkgId: parsed.pkgId, subgoalId: parsed.subgoalId };
}

function toolTicket(a) {
  const key = String(a.key || '');
  const { task, pkgId, subgoalId } = resolveTicketRef(key);
  if (!pkgId) {
    return {
      key: epicKey(task.run_id), task_id: task.run_id, kind: 'EPIC',
      title: String(task.request).slice(0, 160),
      state: epicTicketState(task), phase: epicPhase(task),
      daemon: task.daemon ? { pid: task.daemon.pid, alive: driverAlive(task.daemon) } : null,
      doc_path: docPaths(task).index,
    };
  }
  const pkg = packageOf(task, pkgId);
  if (!pkg) throw new Error(`no package ${pkgId} in ${epicKey(task.run_id)} (packages: ${((task.spec && task.spec.packages) || []).map((p) => p.id).join(', ') || 'none yet'})`);
  // A TASK key resolves the package it belongs to (§8's tm_ticket table has no TASK row of its
  // own yet) - the card itself is reachable through tm_inbox (waiting on a human) or the child
  // run's own team_status, not this tool.
  if (subgoalId) {
    throw new Error(`tm_ticket does not render a TASK key ("${key}") yet - see its STORY (${storyKey(task.run_id, pkgId)}) instead, or tm_inbox if ${key} is waiting on a human`);
  }
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  const accept = latestBySubgoal(task, pkgId, 'accept');
  return {
    key: storyKey(task.run_id, pkgId), task_id: task.run_id, kind: 'STORY',
    title: pkg.title,
    state: storyTicketState(task, pkgId),
    blocked_reason: storyBlockedReason(task, pkgId),
    tasks: storyTaskProgress(task, pkgId),
    worktree: dispatch && dispatch.child ? { cwd: dispatch.child.cwd, branch: dispatch.child.branch } : null,
    last_verdict: accept && accept.result ? { accept: accept.result.accept, match_pct: accept.result.match_pct, gaps: accept.result.gaps || [] } : null,
    reporter: packageReporter(pkg),
    links: storyLinks(task, pkgId),
    // Which of this STORY's subgoals a human owns right now - tm_assign's own read-back, and
    // the only place a card's `who` is visible outside tm_inbox (which only lists a card once
    // it is actually waiting_human, not merely pinned for a future attempt).
    human_assignments: humanAssignments(task, pkgId),
    doc_path: docPaths(task).story(pkgId),
  };
}

// Which of a STORY's subgoals a human owns, read off the child run's own spec (tm_ticket's
// human_assignments field). [] before the package has a child run/spec at all - nothing to pin
// to a human yet, the same guard tm_assign itself has to make.
function humanAssignments(task, pkgId) {
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  if (!dispatch || !dispatch.child) return [];
  const child = loadRun(dispatch.child.cwd, dispatch.child.run_id);
  if (!child || !child.spec) return [];
  return (child.spec.subgoals || [])
    .filter((s) => s.assignee)
    .map((s) => ({ subgoal_id: String(s.id), who: (s.assignee && typeof s.assignee === 'object' ? s.assignee.who : null) || null }));
}

// tm_assign({task_id, key, to}): the pin path, at runtime, for the same `assignee` field a
// shape/spec can already carry (graph.mjs's applyHumanPin/releaseHumanPin, shared with
// expandSubgoals/retrySubgoal so a rejected human-authored subgoal's next attempt is pinned
// again automatically - see graph.mjs's own comment on why). A STORY key (E-xxxxxxxx/Pn) pins
// every subgoal currently in that package's child run; a TASK key (E-xxxxxxxx/Pn/subgoalId)
// pins just the one. Only the kind's AUTHOR stage ever carries the pin - applyHumanPin enforces
// that, not this function - so a judging stage can never be assigned to the human who did the
// work being judged. The child itself is never saved here: this function only PREVIEWS the pin
// (against a read-only loadRun, through applyPinAction - the same function the broker uses to
// apply it for real) and queues the instruction for the broker to pick up - see graph.mjs's
// queueHumanAction and this file's own header, rule 2.
function toolAssign(a) {
  const task = mustFindTask(a);
  const key = String(a.key || '');
  const parsed = parseTicketKey(key);
  if (!parsed || !parsed.pkgId) throw new Error(`tm_assign needs a STORY or TASK key (E-xxxxxxxx/Pn[/subgoalId]), got "${key}"`);
  const { pkgId, subgoalId } = parsed;

  const toRaw = a.to;
  const toHuman = toRaw === 'human' || (toRaw && typeof toRaw === 'object' && toRaw.executor === 'human');
  const toAuto = toRaw === 'auto';
  if (!toHuman && !toAuto) throw new Error(`tm_assign({to}) must be "human", {executor: "human", who}, or "auto" to release - got ${JSON.stringify(toRaw)}`);
  const who = a.who || (toRaw && typeof toRaw === 'object' ? toRaw.who : null) || null;

  // A STORY pin also lives on the package itself, so the card stays the human's across a
  // re-dispatch and can be taken before it ever dispatched - a READY card is the one a person
  // picks up off the board, and refusing it until a driver was already on it was backwards.
  // openChild hands pkg.assignee to the child run it opens.
  const pkg = !subgoalId ? packageOf(task, pkgId) : null;
  if (!subgoalId && !pkg) throw new Error(`no package ${pkgId} in ${epicKey(task.run_id)}`);
  if (pkg) {
    if (toAuto) delete pkg.assignee;
    // {by: 'user'} is what applyHumanPin (graph.mjs) reads to tell this pin apart from the
    // SAME field a shape/setgoal writes on its own - the user just called tm_assign, so this
    // one always parks regardless of run.interactive (§7); an unmarked assignee is the model's.
    else pkg.assignee = { by: 'user', ...(who ? { who } : {}) };
    saveRun(task);
  }
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  if (!dispatch || !dispatch.child) {
    if (subgoalId) throw new Error(`${key} has no child run yet - pin its STORY (${storyKey(task.run_id, pkgId)}) instead, which holds until it dispatches`);
    record(task, { event: 'tm_assign', task_id: task.run_id, key, to: toAuto ? 'auto' : 'human', who, nodes: [] });
    return { key, kind: 'STORY', to: toAuto ? 'auto' : 'human', who, assigned: [] };
  }
  const child = loadRun(dispatch.child.cwd, dispatch.child.run_id);
  if (!child || !child.spec) throw new Error(`${key}'s child run has no spec yet - shape/setgoal has not produced subgoals to pin`);

  // Anything this task already queued for the broker but has not drained yet (a prior tm_assign
  // this same tick, before any team_next/team_submit/team_status touched the run) is replayed
  // onto this read-only copy first, through the same applyPinAction the loop below uses for its
  // own pin - otherwise this call's preview would be computed against a child that is stale by
  // exactly the pins this task itself just queued.
  for (const pending of peekHumanActions(dispatch.child.cwd, dispatch.child.run_id)) {
    if (pending.kind === 'pin') applyPinAction(child, pending);
  }

  const ids = subgoalId ? [subgoalId] : (child.spec.subgoals || []).map((s) => String(s.id));
  if (subgoalId && !ids.some((id) => id === subgoalId)) throw new Error(`no subgoal ${subgoalId} in ${storyKey(task.run_id, pkgId)}'s child run`);

  const assigned = [];
  for (const sid of ids) {
    const sg = child.spec.subgoals.find((s) => String(s.id) === sid);
    if (!sg) throw new Error(`no subgoal ${sid} in ${storyKey(task.run_id, pkgId)}'s child run`);
    const attempt = currentAttempt(child, sid);
    const action = { kind: 'pin', subgoal_id: sid, attempt, to: toAuto ? 'auto' : 'human', who };
    applyPinAction(child, action); // preview only - child is never saved, see below
    queueHumanAction(dispatch.child.cwd, dispatch.child.run_id, action);
    const nodeId = `${authorStage(kindOf(sg))}:${sid}:${attempt}`;
    const live = getNode(child, nodeId);
    assigned.push({ subgoal_id: sid, node_id: nodeId, state: live ? live.state : null, assignment: (live && live.assignment) || null });
  }
  // Not saveRun(child): the broker is the one writer of a child run file (this file's own header,
  // rule 2). queueHumanAction leaves the pin as a manager-owned handoff instead of writing it here
  // directly - the 0.27.3 review (2026-09-24) caught this saveRun(child) writing the child from
  // the manager's process. The broker applies it for real, through applyPinAction (the exact
  // function the preview above just ran), the next time anything calls mustFindRun for this run -
  // team_next's own promoteWaitingHuman is what actually parks the card once ingestHandoff has
  // set its assignment (broker.mjs).
  record(task, { event: 'tm_assign', task_id: task.run_id, key, to: toAuto ? 'auto' : 'human', who, nodes: assigned.map((x) => x.node_id) });
  return { key, kind: subgoalId ? 'TASK' : 'STORY', to: toAuto ? 'auto' : 'human', who, assigned };
}

// tm_inbox({task_id?}): the two sections design §7 names - waiting (I must act) and
// decided-for-you (auto-decided, with a way to object). `cards` is every waiting_human node,
// read straight off the state graph.mjs's promoteWaitingHuman already parked - no second list
// to keep in sync. `decided` is every node applyHumanPin (graph.mjs) routed to an AI instead of
// parking because the pin was the MODEL's (a shape/setgoal assignee, not tm_assign) and the run
// was not interactive - graph.mjs's own auto_decided_pin record on the node, surfaced here so a
// person can see what was defaulted and object (tm_assign it to themselves) instead of the
// decision being invisible. Scans every package's child run (dispatch.child) for a node in
// either state; a task with no packages dispatched yet simply contributes none. Both sorted
// oldest-first.
// One node -> one card/decided entry, shared by every run this scans (a package's child run
// AND, since 0.29.0, the manager graph itself - task.json is a run too). `pid` is the STORY
// this node's key sits under, or the literal 'TASK' for a manager-level node with no package.
// A run-level node (subgoal_id null - setgoal/plan/critique/gate:goal, or the manager's own
// shape/critique/accept/integrate/gate/gate:goal) has no subgoal id to key off, so the key's
// last segment falls back to the node's own node_id - still unique, still a valid TASK key
// (parseTicketKey only requires a third segment, never that it name a real subgoal).
function inboxEntry(task, pid, run, n) {
  const sg = run.spec && (run.spec.subgoals || []).find((s) => String(s.id) === String(n.subgoal_id));
  // An `ask` card is keyed by its own node id, never by its subgoal. Since 0.28.7 one subgoal's
  // questions are split into one card per owner (idol-beta-ask1 raised five for U4 alone), so a
  // subgoal-keyed card is ambiguous - and tm_submit, handed an ambiguous key, would apply one
  // owner's answers to another owner's card. The third key segment already accepts a node id
  // (toolSubmitHuman's own fallback branch), so this needs no new addressing scheme, only an
  // unambiguous one. A pinned author card stays subgoal-keyed: there is only ever one per
  // subgoal, and that is the key 0.27.3 documented.
  const key = taskKey(task.run_id, pid, n.stage === 'ask' ? n.node_id : (n.subgoal_id || n.node_id));
  if (n.state === 'waiting_human') {
    return { card: {
      key,
      task_id: task.run_id,
      node_id: n.node_id,
      // Three kinds of card park here and they ask for different things: a pinned author stage
      // wants the work done (0.27.3), an `ask` node wants one decision picked from named
      // candidates (graph.mjs's openAsk, generalized past investigate in 0.29.0), a `human_gate`
      // node wants an accept/reject with reasons (graph.mjs's promoteHumanGates). `stage` and
      // `human_gate` are what tell them apart; `questions` is only ever present on the second.
      stage: n.stage,
      ...(n.human_gate ? { human_gate: true } : {}),
      title: (sg && sg.title) || String(n.subgoal_id || n.node_id),
      acceptance: (sg && sg.acceptance) || [],
      ...(n.stage === 'ask' ? { questions: n.questions || [] } : {}),
      briefing_path: n.briefing_path || null,
      who: (n.assignment && n.assignment.who) || null,
      since: n.waiting_since || null,
    } };
  }
  if (n.auto_decided_pin) {
    return { decided: {
      key,
      task_id: task.run_id,
      node_id: n.node_id,
      stage: n.stage,
      title: (sg && sg.title) || String(n.subgoal_id || n.node_id),
      who: n.auto_decided_pin.who || null,
      reason: n.auto_decided_pin.reason,
      since: n.auto_decided_pin.at || null,
    } };
  }
  return null;
}

// tm_inbox({task_id?}): the two sections design §7 names - waiting (I must act) and
// decided-for-you (auto-decided, with a way to object). `cards` is every waiting_human node,
// read straight off the state graph.mjs's promoteWaitingHuman/promoteHumanGates already parked
// - no second list to keep in sync. `decided` is every node applyHumanPin/promoteHumanGates
// (graph.mjs) routed past a person instead of parking, because the run is not interactive -
// graph.mjs's own auto_decided_pin record on the node, surfaced here so a person can see what
// was defaulted and object instead of the decision being invisible. Scans every package's
// child run (dispatch.child) AND, since 0.29.0, the task's own manager graph (task.nodes) - a
// task with no packages dispatched yet, and one with none of its own manager-level cards
// either, simply contributes none. Both sorted oldest-first.
function toolInbox(a) {
  const ids = a.task_id ? [String(a.task_id)] : (() => { try { return readdirSync(tasksRoot()); } catch { return []; } })();
  const cards = [];
  const decided = [];
  for (const tid of ids) {
    const task = loadRunAt(taskPath(tid));
    if (!task) continue;
    for (const n of task.nodes) {
      const entry = inboxEntry(task, 'TASK', task, n);
      if (entry && entry.card) cards.push(entry.card);
      if (entry && entry.decided) decided.push(entry.decided);
    }
    const packages = [task.planning_pkg, task.qa_pkg, task.audit_pkg, ...((task.spec && task.spec.packages) || [])].filter(Boolean);
    for (const pkg of packages) {
      const pid = String(pkg.id);
      const dispatch = latestBySubgoal(task, pid, 'dispatch');
      if (!dispatch || !dispatch.child) continue;
      const child = loadRun(dispatch.child.cwd, dispatch.child.run_id);
      if (!child) continue;
      for (const n of child.nodes) {
        const entry = inboxEntry(task, pid, child, n);
        if (entry && entry.card) cards.push(entry.card);
        if (entry && entry.decided) decided.push(entry.decided);
      }
    }
  }
  cards.sort((x, y) => (x.since || 0) - (y.since || 0));
  decided.sort((x, y) => (x.since || 0) - (y.since || 0));
  return { cards, decided };
}

// tm_docs's whole job: call docs.mjs's single write site. No rendering logic lives here, and no
// second write site is introduced - writeDocs takes no clock, so this stays a pure function of
// task.json every time it is called (rebuild or not).
function toolDocs(a) {
  const task = mustFindTask(a);
  const written = writeDocs(task, { rebuild: a.rebuild === true });
  return { task_id: task.run_id, rebuild: a.rebuild === true, written };
}

export function requireRunnable(task, nodeId) {
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

// Shared by tm_open and tm_run: create the task and, when the caller pinned size, resolve the
// size node right away exactly like a measured S/L would. Returns {task, delegated, view} -
// delegated is delegateIfSmall's own return (already carrying task_state: 's_run' and the S
// run's own tm_next-shaped fields) when the pin was S, null otherwise so the caller decides what
// to do next with an L (or unmeasured) task. view is ensureViewer's {url, port, pid, started} or
// null - the one call site for the one human window a tasks root gets, made right here because
// this is the only place tm_open and tm_run's task-creation paths meet; a call added separately
// in each of them is exactly the split-default shape this file's tests (test-defaults.mjs) exist
// to catch. Called after record() above, so the task directory already exists on disk. The
// await is wrapped for the same reason ensureViewer already swallows its own errors: this call
// must never be able to fail the open, even on a throw ensureViewer did not anticipate.
async function openTaskAndMaybePin(a, eventName) {
  const task = createTask(a);
  record(task, { event: eventName, task_id: task.run_id, cwd: task.cwd, flow: task.flow, size_pinned: task.size_pinned, ...(task.size_pin_source ? { size_pin_source: task.size_pin_source } : {}), ...(task.context_from_unresolved ? { context_from_unresolved: task.context_from_unresolved } : {}) });
  let view = null;
  try { view = await ensureViewer(tasksRoot(), task.run_id); } catch { view = null; }
  if (!task.size_pinned) return { task, delegated: null, view };
  const n = task.nodes.find((x) => x.node_id === 'size');
  const out = finish(task, n, {
    stage_ok: true, size: task.size_pinned, size_source: 'pinned', sizing: [],
    handoff: task.size_pin_source === 'boxed-backlog'
      ? 'Size pinned L: this is a backlog held to a budget/timebox, and the box can only stop by leaving the lowest-priority packages undispatched. Nothing was measured; shape decides the packages from the backlog and the tree.'
      : task.size_pinned === 'L'
      ? 'Size pinned L by the entry: the user said the request must be split into packages. Nothing was measured; shape decides the packages from the request and the tree.'
      : 'Size pinned S by the entry: the user said one run must carry it.',
    evidence: 'no measurement: pinned by the caller',
  });
  const delegated = delegateIfSmall(task, n, out);
  if (!delegated) saveRun(task);
  return { task, delegated, view };
}

// tm_open: kept for the existing skill path and this whole test suite, byte-for-byte compatible
// under noDaemon() (every test that drives a task by hand sets it). With a daemon in play, this
// does NOT also call toolNext() itself for an L task - toolNext opens ready dispatches and would
// race the very daemon this call just spawned into opening the same node twice. So the shapes
// diverge on purpose: noDaemon() gets the old, fully-driven reply (ready[]/children[]); a real
// daemon gets a thin pointer, and the caller reads progress with tm_status/tm_board/tm_wait
// instead - the daemon and package drivers do the rest.
async function toolOpen(a) {
  const { task, delegated, view } = await openTaskAndMaybePin(a, 'tm_open');
  const viewFields = { ...(view && view.url ? { view_url: view.url } : {}), ...(task.context_from_unresolved ? { context_from_unresolved: task.context_from_unresolved } : {}) };
  if (delegated) return { ...delegated, docs_dir: docPaths(task).dir, ...viewFields };
  if (noDaemon()) return { ...toolNext({ task_id: task.run_id }), ...viewFields };
  return { task_id: task.run_id, state: runState(task).state, docs_dir: docPaths(task).dir, ...viewFields };
}

// tm_run: the non-driving entry point §4/§10-1 of the design doc asks for - open, spawn the
// daemon, hand back a pointer, never block and never self-drive. Always this shape, daemon
// spawned or not (noDaemon() only stops the process from actually starting; a test that wants
// to drive a tm_run-created task by hand still can, through tm_next/tm_submit, exactly as it
// would for a tm_open-created one).
async function toolRun(a) {
  const { task, delegated, view } = await openTaskAndMaybePin(a, 'tm_run');
  const viewFields = { ...(view && view.url ? { view_url: view.url } : {}), ...(task.context_from_unresolved ? { context_from_unresolved: task.context_from_unresolved } : {}) };
  return {
    task_id: task.run_id,
    run_id: task.run_id,
    docs_dir: docPaths(task).dir,
    state: delegated ? delegated.state : runState(task).state,
    ...viewFields,
  };
}

// Size S, s_driver 'process' (the default): open the one graph run this request needs, in the
// project's own cwd - not a package worktree, there is no shape to make one - and spawn a
// driver for it the same way a package's dispatch does. task.s_run mirrors n.child.
export function openSRun(task) {
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
export function delegateIfSmall(task, n, out) {
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
  if (cs.state === 'running' && s.driver) {
    if (!driverAlive(s.driver)) { if (serviceDeadDriver(task, s, 'S')) saveRun(task); }
    else if (serviceStalledDriver(task, s, 'S')) saveRun(task);
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
  if (s.stalled_since) out.stalled_since = s.stalled_since;
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
    out.next = `driver died and the restart budget (${budget}) is spent; team_status({run_id, cwd}) shows where it stopped, ; tm_retry({task_id}) gives it a fresh session where the dead one stopped`;
  } else {
    out.next = `drive it yourself with team_next/team_run/team_submit at cwd ${s.cwd}, run_id ${s.run_id}`;
  }
  return out;
}

// ---------- budget / timebox (the Sprint's missing box - no prior stop condition bounded
// either cost or time; a task ran until its graph naturally finished or someone intervened) ----

// The task's total spend across every driver it has ever spawned - a size-L task's package
// drivers AND a size-S task's own single s_run driver both write under the same drivers/
// directory (spawnChildDriver's nodeIdLabel is "S" for the latter), so one glob covers both.
// Reuses collectDriverCosts (drivercost.mjs) - the SAME driver-stream reader tm_status/tm_board/
// view.mjs's RESOURCE view already read this task's cost through - rather than a second parser
// that walks drivers/*.stream.jsonl itself: that would not only duplicate the "last result
// event wins" parsing rule, it would also drop the dedup collectDriverCosts does by (task_id,
// driver filename) for a driver stream a worktree checked out a copy of, silently double-
// counting spend budgetStatus/enforceBudget rely on to stop a run at 100%.
export function taskSpend(task) {
  return collectTaskCosts(taskDir(task.run_id), task).cost_usd;
}

export function taskElapsedMinutes(task) {
  return (Date.now() - (task.created_at || Date.now())) / 60000;
}

// {pct, over, warn, spend, elapsed_minutes}. Neither budget_usd nor timebox_minutes set:
// unlimited, today's behaviour exactly (pct 0, never over). Either set: pct is the WORSE
// (larger) of the two fractions spent, since a dollar figure and a clock both cap the same run
// and either alone is a real stop condition - not "both must be exhausted". A limit of exactly
// 0 with any spend/elapsed at all reads as already over (Infinity), rather than a division that
// hides a misconfigured "stop immediately" as 0/0.
export function budgetStatus(task) {
  const opts = (task.team && task.team.opts) || {};
  const budget = Number.isFinite(opts.budget_usd) ? opts.budget_usd : null;
  const timebox = Number.isFinite(opts.timebox_minutes) ? opts.timebox_minutes : null;
  const spend = (budget != null) ? taskSpend(task) : 0;
  const elapsed = taskElapsedMinutes(task);
  if (budget == null && timebox == null) return { pct: 0, over: false, warn: false, spend: 0, elapsed_minutes: elapsed };
  const frac = (used, limit) => (limit == null ? 0 : (limit > 0 ? used / limit : (used > 0 ? Infinity : 0)));
  const pct = Math.max(frac(spend, budget), frac(elapsed, timebox));
  return {
    pct, over: pct >= 1, warn: pct >= 0.8, spend, elapsed_minutes: elapsed,
    ...(budget != null ? { budget_usd: budget } : {}), ...(timebox != null ? { timebox_minutes: timebox } : {}),
  };
}

// Called every daemon tick (daemon.mjs's stepOnceInner) and by tm_next's own toolNext - the same
// two call sites advanceDispatches/autoRepair/autoRetryPackages/autoReshape already share, so a
// hand-driven test and the daemon can never disagree about when the stop trips. Records the 80%
// warning once (task.budget_warned); at 100% sets task.budget_stopped once, which
// advanceDispatches itself checks at its own top to refuse opening another package - checked
// there, not duplicated here, the same way every other "is this allowed" question in this file
// lives at its one call site. "Finishes in-flight" is exactly what NOT killing a running dispatch
// means: this function only ever settles a package whose dispatch node is still 'pending',
// meaning no driver was ever spawned for it. Once nothing is left running, the pending packages
// still blocking the current integrate are marked 'skipped' (an established terminal state -
// see VERDICT_SCHEMA's own state enum) and a fresh integrate opens over just the accepted set,
// reusing reintegrateBehind - the exact mechanism a filed defect or a repair already opens a
// fresh integrate with, just handed the accepted subset instead of the full one.
// The last resort of a stopped box, tried only once the package sweep below has nothing left to
// do - run first, it closed a task whose ready dispatch the sweep was about to settle.
function closeStoppedToReport(task) {
  // Stopped, nothing left running, and the graph blocked short of its report (code-sprint-S5:
  // integrate:2 over the kept packages refused, a repair would need a dispatch the box forbids).
  // A stopped Sprint still owes its review and retro: settle every pending node but the report,
  // so the report's own `after` edge is satisfied and it runs. A pending re-judge is left to run.
  // Not only 'blocked': code-sprint-P2 (roles.planning) stopped after shape, and the goal gate
  // waited on accept:AUDIT:1 - a node the audit phase-Team would create only by dispatching, which
  // the box forbids. Pending nodes, none ready, nothing running: the task read 'running' and the
  // daemon waited forever. Stuck is stuck, whatever runState calls it.
  // A ready dispatch is as stuck as a waiting one here: advanceDispatches opens nothing once the
  // box is stopped (P2's dispatch:AUDIT:1 sat ready for 25 minutes).
  const stuck = !readyNodes(task).some((n) => n.stage !== 'report' && n.stage !== 'dispatch') && !task.nodes.some((n) => n.state === 'waiting_human');
  if (!task.nodes.some((n) => n.state === 'running') && pendingRejudgeAt(task) === null
      && (runState(task).state === 'blocked' || stuck)) {
    const report = task.nodes.filter((n) => n.stage === 'report' && n.state === 'pending').pop();
    if (report) {
      const settledIds = [];
      for (const n of task.nodes) {
        if (n === report || n.state !== 'pending') continue;
        n.state = 'skipped';
        n.final = true;
        n.result = { stage_ok: false, reason: 'skipped: budget/timebox exhausted - the Sprint closes on what it has' };
        settledIds.push(n.node_id);
      }
      for (const n of task.nodes) if (n.state === 'failed' && !n.final) n.final = true;
      record(task, { event: 'budget_closed', task_id: task.run_id, skipped: settledIds });
      return true;
    }
  }
  return false;
}

export function enforceBudget(task) {
  const status = budgetStatus(task);
  let progressed = false;
  if (status.warn && !task.budget_warned) {
    task.budget_warned = true;
    record(task, { event: 'budget_warning', task_id: task.run_id, pct: Math.round(status.pct * 100), spend: status.spend, elapsed_minutes: Math.round(status.elapsed_minutes) });
    progressed = true;
  }
  if (!status.over) return progressed;
  if (!task.budget_stopped) {
    task.budget_stopped = {
      at: Date.now(), spend: status.spend, elapsed_minutes: Math.round(status.elapsed_minutes),
      budget_usd: status.budget_usd == null ? null : status.budget_usd,
      timebox_minutes: status.timebox_minutes == null ? null : status.timebox_minutes,
      skipped_packages: [],
    };
    record(task, { event: 'budget_stopped', task_id: task.run_id, ...task.budget_stopped });
    progressed = true;
  }
  // Stopped before shape ever produced packages (code-sprint-S2, 2026-09-26: the whole $6 went
  // on a PLAN team whose gate never passed). There is nothing to leave undispatched and no
  // integrate to reopen, and the report node does not exist yet - so without this the task sat
  // with a retry nobody would dispatch, no report and no retro.json, and the next Sprint had
  // nothing to continue from. Once nothing is running: every pending node is skipped and a
  // report opens on its own, which writes the retro with the whole backlog carried forward.
  if (!task.spec || !Array.isArray(task.spec.packages)) {
    if (task.nodes.some((n) => n.state === 'running')) return progressed;
    if (task.nodes.some((n) => n.stage === 'report')) return progressed;
    const skipped = [];
    for (const n of task.nodes) {
      if (n.state !== 'pending') continue;
      n.state = 'skipped';
      n.final = true;
      n.result = { stage_ok: false, reason: 'skipped: budget/timebox exhausted before shape' };
      skipped.push(n.node_id);
    }
    task.nodes.push(node('report', 'report', [], { subgoal_id: null }));
    task.budget_stopped.before_shape = true;
    record(task, { event: 'budget_swept', task_id: task.run_id, skipped, before_shape: true });
    return true;
  }
  // Nothing to sweep while a dispatch this task already opened is still running.
  if (task.nodes.some((n) => n.stage === 'dispatch' && n.state === 'running')) return progressed;
  const currentIntegrate = task.nodes.filter((n) => n.stage === 'integrate' && n.state !== 'done' && !n.final).pop();
  if (!currentIntegrate) return closeStoppedToReport(task) || progressed; // no integrate left pending on a never-run package
  const neverRan = task.nodes.filter((n) => n.stage === 'dispatch' && n.state === 'pending'
    && currentIntegrate.deps.some((d) => d.startsWith(`accept:${n.subgoal_id}:`)));
  if (!neverRan.length) return closeStoppedToReport(task) || progressed;
  const skipped = [];
  for (const dn of neverRan) {
    dn.state = 'skipped';
    dn.final = true;
    dn.result = { stage_ok: false, reason: 'skipped: budget/timebox exhausted before this package could dispatch' };
    const an = task.nodes.find((x) => x.node_id === dn.node_id.replace(/^dispatch:/, 'accept:'));
    if (an) { an.state = 'skipped'; an.final = true; an.result = { stage_ok: false, reason: 'skipped: budget/timebox exhausted' }; }
    skipped.push(dn.subgoal_id);
  }
  const keptAccepts = currentIntegrate.deps.filter((d) => { const x = task.nodes.find((y) => y.node_id === d); return x && x.state === 'done'; });
  task.budget_stopped.skipped_packages = [...new Set([...(task.budget_stopped.skipped_packages || []), ...skipped])];
  if (!keptAccepts.length) {
    // Nothing accepted: an integrate over zero packages merges nothing and its judge (and the
    // goal gate after it) is paid to look at an empty tree - code-sprint-P2 stopped right after
    // shape and opened integrate:2 with merged 0. Settle the rest and let the report run.
    for (const x of task.nodes) {
      if (x.state !== 'pending' || x.stage === 'report') continue;
      x.state = 'skipped';
      x.final = true;
      x.result = { stage_ok: false, reason: 'skipped: budget/timebox exhausted with no package accepted - nothing to integrate' };
    }
    record(task, { event: 'budget_swept', task_id: task.run_id, skipped, nothing_accepted: true });
    return true;
  }
  reintegrateBehind(task, currentIntegrate.node_id, keptAccepts, `budget/timebox exhausted; not done: ${skipped.join(', ')}`);
  record(task, { event: 'budget_swept', task_id: task.run_id, skipped });
  return true;
}

// Opens every ready dispatch node this poll is allowed to - the phase-Team exemption and
// max_parallel_teams for ordinary STORY packages - and returns how many it opened. Shared by
// tm_next (a caller driving the graph by hand, chiefly tests) and the daemon's own loop, so the
// two can never disagree about which dispatch is allowed to open when.
export function advanceDispatches(task) {
  // budget/timebox stop: no NEW package opens once the task is over budget - a running one
  // (this check never sees, since it never touches state 'running') still finishes.
  if (task.budget_stopped) return 0;
  // max_parallel_teams caps how many develop STORY dispatches run at once - phase-Team
  // packages (PLAN/QA/AUDIT) are exempt, both from the count and from the cap itself: the design
  // already limits each to at most one at a time (§2 "v0.12.0이 하지 않는 것"), so throttling
  // them further would only add a wait with nothing behind it.
  let opened = 0;
  const isPhaseTeam = (n) => { const pkg = packageOf(task, n.subgoal_id); return !!(pkg && (pkg.phase === 'planning' || pkg.phase === 'qa' || pkg.phase === 'audit')); };
  const readyDispatch = readyNodes(task).filter((n) => n.stage === 'dispatch');
  for (const n of readyDispatch) {
    if (!isPhaseTeam(n)) continue;
    openChild(task, n);
    opened++;
  }
  // The fallback reads TEAM_DEFAULTS.max_parallel_teams rather than repeating its literal. It
  // only fires for a task.json written before task.team existed - createTask has set task.team
  // on every task since taskmanager.mjs:187, so a task created by the current code always has
  // task.team.opts.max_parallel_teams and never reaches this branch.
  const maxParallel = Number.isInteger(task.team && task.team.opts && task.team.opts.max_parallel_teams)
    ? task.team.opts.max_parallel_teams : TEAM_DEFAULTS.max_parallel_teams;
  const runningStories = task.nodes.filter((n) => n.stage === 'dispatch' && n.state === 'running' && !isPhaseTeam(n)).length;
  const slots = Math.max(0, maxParallel - runningStories);
  const storyReady = readyDispatch.filter((n) => !isPhaseTeam(n))
    .sort((a, b) => {
      const pa = packageOf(task, a.subgoal_id);
      const pb = packageOf(task, b.subgoal_id);
      return (Number.isInteger(pa && pa.priority) ? pa.priority : 0) - (Number.isInteger(pb && pb.priority) ? pb.priority : 0);
    });
  for (const n of storyReady.slice(0, slots)) {
    openChild(task, n);
    opened++;
  }
  return opened;
}

// Every running dispatch whose driver is no longer alive gets serviced here: respawned on the
// same run_id, or parked on capacity, before anyone ever sees it as something to fold. Only a
// spent restart budget leaves it dead. Returns how many it touched.
export function serviceRunningDispatches(task) {
  let serviced = 0;
  for (const n of task.nodes) {
    if (n.stage !== 'dispatch' || n.state !== 'running' || !n.child || !n.child.driver) continue;
    if (serviceDeadDriver(task, n.child, n.node_id)) serviced++;
    else if (serviceStalledDriver(task, n.child, n.node_id)) serviced++;
  }
  return serviced;
}

// Integration is mechanical up to the checks: the worktree and the merges are done here, in
// dependency order, so a conflict is a fact the manager saw and not a claim a node made. Only
// after this does an integrate node's own judging (composeTaskPrompt's CONTRACT.integrate) run.
export function prepareReadyIntegrations(task) {
  let prepared = 0;
  for (const n of readyNodes(task)) {
    if (n.stage !== 'integrate' || n.integration) continue;
    prepareIntegration(task, n);
    saveRun(task);
    prepared++;
  }
  return prepared;
}

// gate:human (D2 Task 4): a manager-graph judging node (shape/critique/accept/integrate/gate/
// gate:goal) named in human_gates never reaches a driver - see graph.mjs's promoteHumanGates
// for why this is safe to call on task.json unmodified (it is itself a run). Interactive parks
// it for tm_inbox/tm_submit; non-interactive auto-passes it through the same finish() a
// driver's own submission would take. Exported and called from both tm_next (toolNext, a
// caller driving the graph by hand) and the daemon's own loop (daemon.mjs's stepOnceInner,
// right before it judges every ready reasoning node) - same reason advanceDispatches/
// prepareReadyIntegrations are shared rather than each caller deciding readiness on its own:
// the daemon judges every ready node directly, with no tool boundary in between, so a hook
// that only lived in toolNext would never fire on an autonomous run.
export function promoteManagerHumanGates(task) {
  const { parked, autoPass } = promoteHumanGates(task);
  for (const n of autoPass) finish(task, n, autoPassHumanGateResult(n));
  if (parked.length) {
    for (const n of parked) writeManagerBriefing(task, n);
    saveRun(task);
  }
  return { parked, autoPass };
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
  // a separate call means a caller driving the graph by hand cannot forget to, and cannot do it
  // twice - the same three steps the daemon's own loop runs, shared through the exports above so
  // the two never diverge on what "ready" means.
  if (enforceBudget(task)) saveRun(task);
  if (advanceDispatches(task)) saveRun(task);
  if (serviceRunningDispatches(task)) saveRun(task);
  prepareReadyIntegrations(task);
  promoteManagerHumanGates(task);
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
    const stalled = n.child.stalled_since || null;
    const restarts = (driver && driver.restarts) || [];
    const fold = `tm_submit({task_id, node_id: "${n.node_id}"})`;
    let next;
    if (childState !== 'running') next = fold;
    else if (!driver) next = `team_next({run_id: "${n.child.run_id}", cwd: "${n.child.cwd}"}) and drive it; tm_submit this node when complete`;
    else if (waiting) next = `waiting on provider capacity (${waiting.reason.slice(0, 160)}); tell the user the reset time and stop. tm_retry({task_id, package_id: "${n.subgoal_id}", reset_capacity:true}) resumes it`;
    else if (alive && stalled) next = `its driver process (pid ${driver.pid}) is alive but has made no progress since ${new Date(stalled).toISOString()} (stall_minutes); poll tm_next - past 3x stall_minutes it is killed and respawned on its own`;
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
      ...(stalled ? { stalled_since: stalled } : {}),
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

// At-least-once delivery, this layer's own copy of broker.mjs's idempotentSubmit (same reasoning:
// docs/plans/2026-09-23-teams-reducer-human-rollback.md §5). Matters more here than at the
// node layer - a dispatch node's fold (foldChild) commits the package's worktree on accept
// (taskmanager.mjs's commitWorktree), and finish() runs shape validation, QA/audit defect
// filing and much else besides; none of it is safe to run twice on the same node. node_id
// already carries the round/attempt for every stage that retries (dispatch:P1:2, shape:2,
// gate:goal:3), so {task_id, node_id} is the key in the common case; `attempt` is one more check.
function idempotentSubmit(task, n, a) {
  if (!n || n.state === 'pending' || n.state === 'running' || !n.result) return null;
  if (a.attempt != null && Number(a.attempt) !== (n.attempt || 1)) return null;
  return { ...verdict(task, n), idempotent: true, note: `node ${n.node_id} already ${n.state}; returning the stored result, no work repeated` };
}

function toolSubmit(a) {
  const task = mustFindTask(a);
  if (a.key) return toolSubmitHuman(task, a);
  const already = idempotentSubmit(task, getNode(task, String(a.node_id)), a);
  if (already) return already;
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

// tm_submit({task_id, key, payload}): the human's own answer for a waiting_human card. Through
// 0.27.2 this was the one write this file ever made to a child run, and 0.27.3 kept it that way
// (loadRun+saveRun'd the child directly) - a violation of this file's own header, rule 2, and of
// design §7 (a human's implement/draft/cases is supposed to get "changed_files는 워크트리 대조로
// 똑같이 검증", the same worktree cross-check an AI's report gets; 0.27.3 took stage_ok at face
// value instead, no cross-check at all). Caught by the 2026-09-24 review. Fixed the same way
// tm_assign above is: computeSubmitResult (broker.mjs, imported - see this file's header, rule 3)
// runs the real cross-check and verdict logic read-only, against a loadRun'd copy of the child
// that is never saved, so this call can still answer synchronously and correctly without writing
// anything; queueHumanAction leaves the actual payload as a manager-owned handoff, and the broker
// applies it for real - through that SAME function, plus finishNode - the next time anything
// calls mustFindRun for this run. Everything downstream of a real "done" (test, review, gate, and
// a rejection's own retry back to waiting_human - graph.mjs's applyHumanPin, called again by
// retrySubgoal) still runs through the real broker once the child's driver resumes, exactly as it
// always has; only WHO performs the verdict on THIS node's own payload changed.
// A human_gate card's payload is {accept, reason?, gaps?}, not driver-shaped JSON - converted
// here, once, into the stage's own result shape (graph.mjs's humanGateResultFromPayload) before
// it goes anywhere a driver's own submission would (computeSubmitResult/finish), so every
// downstream reader sees the same shape regardless of who judged the node.
function humanSubmitPayload(n, rawPayload) {
  if (!n.human_gate) return rawPayload || {};
  if (typeof (rawPayload || {}).accept !== 'boolean') {
    throw new Error(`${n.node_id} is a human gate (gate:human): payload needs {accept: true|false, reason?, gaps?}`);
  }
  return humanGateResultFromPayload(n, rawPayload);
}

// The manager-graph twin of the child-run branch below: pkgId 'TASK' addresses task.nodes
// directly (a run/task-level card - setgoal/plan/critique/gate:goal generalized questions, or
// gate:human on shape/critique/accept/integrate/gate/gate:goal). task.json is this file's own
// to write (unlike a child run, rule 2's "READS child run files and never writes them" does not
// apply here), so this calls finish() directly instead of queueing through the broker - there
// is no driver to resume, the manager graph has none of its own.
function toolSubmitHumanManager(task, key, nodeId, rawPayload) {
  const n = getNode(task, nodeId);
  if (!n || n.state !== 'waiting_human') {
    throw new Error(n ? `${key}'s card (${nodeId}) is ${n.state}, not waiting_human - nothing to submit` : `${key} has no card waiting on a human`);
  }
  if (n.stage === 'ask' && !Array.isArray((rawPayload || {}).decisions)) {
    throw new Error(`${key}'s card (${nodeId}) is a decision: payload needs decisions[], one {question, chose} per question in tm_inbox`);
  }
  const shaped = humanSubmitPayload(n, rawPayload);
  // finish() (unlike broker.mjs's computeSubmitResult) does not default stage_ok on a raw
  // submission - a driver's own JSON always states it, but a person answering a decisions[]
  // card typically does not. Same default computeSubmitResult gives the child-run path: absent
  // means true, only an explicit false means false.
  const payload = { ...shaped, stage_ok: shaped.stage_ok !== false };
  const verdictOut = finish(task, n, payload);
  record(task, { event: 'tm_submit_human', task_id: task.run_id, key, node_id: nodeId, stage_ok: verdictOut.stage_ok === true });
  return { task_id: task.run_id, key, node_id: nodeId, state: n.state, result: n.result };
}

function toolSubmitHuman(task, a) {
  const key = String(a.key);
  const parsed = parseTicketKey(key);
  if (!parsed || !parsed.pkgId || !parsed.subgoalId) throw new Error(`tm_submit({key}) needs a TASK key (E-xxxxxxxx/Pn/subgoalId), got "${key}"`);
  const { pkgId, subgoalId } = parsed;
  // 'TASK' is not a real package id (STORY keys are 'P1', 'P2', ... - shape's own package.id) -
  // it is the pseudo-package this module's own toolInbox/inboxEntry key a manager-level node
  // under, since such a node has no package to belong to at all.
  if (pkgId === 'TASK') return toolSubmitHumanManager(task, key, subgoalId, a.payload || {});
  const dispatch = latestBySubgoal(task, pkgId, 'dispatch');
  if (!dispatch || !dispatch.child) throw new Error(`${key} has no child run yet`);
  const child = loadRun(dispatch.child.cwd, dispatch.child.run_id);
  if (!child) throw new Error(`${key}'s child run file is missing`);
  const sg = child.spec && (child.spec.subgoals || []).find((s) => String(s.id) === subgoalId);
  // A card this same task already queued an answer for (this tick's own earlier tm_submit, not
  // yet drained by the broker) is not `waiting_human` on disk yet either - queueHumanAction below
  // never flips it. Without this, a second submission of the same card would see the same stale
  // waiting_human node the first call did and be accepted twice.
  const alreadyQueued = new Set(peekHumanActions(dispatch.child.cwd, dispatch.child.run_id)
    .filter((x) => x.kind === 'submit').map((x) => x.node_id));
  let n;
  if (sg) {
    // The waiting node, not the predicted one. authorStage answered this while a pinned author
    // stage was the only thing that could park here; an `ask` node (graph.mjs's openAsk) is not
    // in the kind's chain at all, so computing its id was never possible. A subgoal has at most
    // one card open at a time by construction - ask sits on draft's dep edge, so the two can
    // never be waiting together - and authorStage stays as the name used to explain an empty
    // inbox for this key.
    const attempt = currentAttempt(child, subgoalId);
    const waiting = child.nodes.filter((x) => String(x.subgoal_id) === subgoalId && x.state === 'waiting_human' && !alreadyQueued.has(x.node_id));
    if (!waiting.length) {
      const predicted = `${authorStage(kindOf(sg))}:${subgoalId}:${attempt}`;
      const n0 = getNode(child, predicted);
      throw new Error(n0
        ? `${key}'s card (${predicted}) is ${alreadyQueued.has(predicted) ? 'submitted, awaiting the broker' : n0.state}, not waiting_human - nothing to submit`
        : `${key} has no card waiting on a human`);
    }
    // Ambiguity is refused, not resolved by picking. Answers belong to the card that asked for
    // them; applying one owner's decisions to another owner's questions would be silent and wrong.
    if (waiting.length > 1) {
      throw new Error(`${key} has ${waiting.length} cards waiting (${waiting.map((x) => x.node_id).join(', ')}) - name one: ${waiting.map((x) => taskKey(task.run_id, pkgId, x.node_id)).join(' | ')}`);
    }
    n = waiting[0];
  } else {
    // No subgoal by that id: the key's third segment is a run-level node's own node_id instead
    // (setgoal/plan/critique/gate:goal - subgoal_id null, generalized questions or gate:human -
    // see inboxEntry's key scheme, taskmanager.mjs). Same card machinery either way from here.
    const n0 = getNode(child, subgoalId);
    if (!n0 || n0.state !== 'waiting_human' || alreadyQueued.has(n0.node_id)) {
      throw new Error(n0
        ? `${key}'s card (${n0.node_id}) is ${alreadyQueued.has(n0.node_id) ? 'submitted, awaiting the broker' : n0.state}, not waiting_human - nothing to submit`
        : `no subgoal or node ${subgoalId} in ${key}'s child run`);
    }
    n = n0;
  }
  const nodeId = n.node_id;
  if (n.stage === 'ask' && !Array.isArray((a.payload || {}).decisions)) {
    throw new Error(`${key}'s card (${nodeId}) is a decision: payload needs decisions[], one {question, chose} per question in tm_inbox`);
  }

  const payload = humanSubmitPayload(n, a.payload || {});
  const { result, done } = computeSubmitResult(child, n, payload, 'human');
  const answeredAt = Date.now();
  queueHumanAction(dispatch.child.cwd, dispatch.child.run_id, { kind: 'submit', node_id: nodeId, payload, answered_at: answeredAt });
  record(task, { event: 'tm_submit_human', task_id: task.run_id, key, node_id: nodeId, stage_ok: result.stage_ok });

  // The driver already exited the moment nothing was left ready for it (zero compute while
  // waiting - graph.mjs's promoteWaitingHuman). Resume it now, the same shape clearCapacity
  // already uses for its own "not a crash, don't spend a restart" respawn: restarts carries
  // over untouched, because this is exactly what the driver was always going to do next, not a
  // failure it is recovering from. This is task.json's own dispatch node, this file's to write
  // either way (rule 2 is about the CHILD run, not the task's own).
  // Only when nothing is driving the run: a sibling subgoal still in flight keeps its driver
  // alive, and that driver picks the answered node up on its next team_next. A second driver on
  // the same run would dispatch the same ready nodes twice.
  if (!noDriver() && !driverAlive(dispatch.child.driver)) {
    const restarts = (dispatch.child.driver && dispatch.child.driver.restarts) || [];
    const fresh = spawnChildDriver(task, dispatch.node_id, dispatch.child, { resume: true, attempt: nextSpawnAttempt(dispatch.child) });
    fresh.restarts = restarts;
    dispatch.child.driver = fresh;
    delete dispatch.child.stalled_since;
    saveRun(task);
    record(task, { event: 'child_driver_restarted', task_id: task.run_id, node_id: dispatch.node_id, pid: fresh.pid, reason: 'human_submitted' });
  }
  return { task_id: task.run_id, key, node_id: nodeId, state: done ? 'done' : 'failed', result };
}

function toolRetry(a) {
  const task = mustFindTask(a);
  // A driver parked waiting_capacity after a usage-limit death spent no restart; the way back
  // is not a retried package but a cleared wait, once the caller believes capacity is back.
  // Clears every waiting child (or just package_id's, or task.s_run for a size-S task) and
  // respawns its driver - none of that counts against driver_restarts.
  if (a.reset_capacity === true) {
    const resumed = clearCapacity(task, a.package_id != null ? String(a.package_id) : null);
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

function toolFile(a) {
  const task = mustFindTask(a);
  if (!task.spec || !Array.isArray(task.spec.packages)) throw new Error('this task has no shape yet - tm_file needs an existing package list to file a STORY beside');
  const stories = Array.isArray(a.stories) ? a.stories : [];
  if (!stories.length) throw new Error('tm_file needs at least one story in stories[]');
  const out = fileDefects(task, stories, { reporter: 'you' });
  record(task, { event: 'tm_file', task_id: task.run_id, filed: out.filed, integrate: out.integrate });
  return { task_id: task.run_id, filed: out.filed, integrate: out.integrate };
}

// Every package dispatch (and its restarts) logs to <taskDir>/drivers/dispatch_<node_id>_*.
// spawnChildDriver's own nodeIdLabel is the dispatch node_id itself (e.g. "dispatch:P1:1"),
// sanitized to "dispatch_P1_1" - so a package's OWN total, across every attempt a retry ever
// opened, is exactly the streams collectDriverCosts already found whose filename starts with
// "dispatch_<pkgId>_". Reused, not re-derived: this is the same accounting driverCostOf/
// collectDriverCosts do for the RESOURCE view (drivercost.mjs), just grouped one level up.
// Plus the node sessions of every child run this package's dispatches opened (node_streams
// are keyed <child run_id>/<node>/<attempt>), since a package's work is mostly those.
function packageCostRollup(driverTotal, pkgId, task) {
  const prefix = `dispatch_${String(pkgId).replace(/[^A-Za-z0-9._-]/g, '_')}_`;
  const matches = driverTotal.streams.filter((s) => (String(s.stream).split(/[\\/]/).pop() || '').startsWith(prefix));
  const runIds = new Set(((task && task.nodes) || []).filter((n) => n.stage === 'dispatch' && n.subgoal_id === pkgId && n.child && n.child.run_id).map((n) => String(n.child.run_id)));
  const nodeMatches = (driverTotal.node_streams || []).filter((s) => runIds.has(String(s.stream).split('/')[0]));
  const all = [...matches, ...nodeMatches];
  return {
    id: pkgId,
    cost_usd: +all.reduce((a, s) => a + s.cost_usd, 0).toFixed(4),
    turns: all.reduce((a, s) => a + s.turns, 0),
  };
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
  // Read the existing record, never spawn one: tm_status is how a caller who joined a running
  // task after tm_open/tm_run returned finds the same link - it must not have the side effect of
  // starting a viewer just because someone polled status.
  const viewRecord = readViewRecord(tasksRoot());
  const viewFields = viewRecord ? { view_url: viewUrl(viewRecord.port, task.run_id) } : {};
  // The same account view.mjs's header already shows (view-collect.mjs's collectTask, same
  // collectDriverCosts call) - a caller polling tm_status only never had this at all, so a run
  // like awake-beta-ref1's $53.93 / 222 turns sat visible only in the raw driver logs.
  const driverTotal = collectTaskCosts(taskDir(task.run_id), task);
  const costFields = { cost: { usd: driverTotal.cost_usd, turns: driverTotal.turns, sessions: driverTotal.sessions, drivers_usd: driverTotal.drivers_usd, nodes_usd: driverTotal.nodes_usd, ...(driverTotal.estimated_usd ? { estimated_usd: driverTotal.estimated_usd } : {}) } };
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
        ...(task.s_run.waiting_capacity ? { waiting_capacity: task.s_run.waiting_capacity } : {}),
        ...(task.s_run.stalled_since ? { stalled_since: task.s_run.stalled_since } : {}) },
      packages: [],
      ...costFields,
      daemon: task.daemon ? { pid: task.daemon.pid, alive: driverAlive(task.daemon), log: task.daemon.log, stderr: task.daemon.stderr, spawn_count: task.daemon.spawn_count, restarts: task.daemon.restarts || 0, exhausted: !!task.daemon.exhausted, stderr_tail: driverStderrTail(task.daemon) } : null,
      team: task.team || null,
      ...viewFields,
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
    // Same facts critique's briefing sees, surfaced here too - so a human polling status catches
    // a bloated foundation package or a fully-serial shape without opening the briefing file.
    ...(task.spec ? (() => {
      const sa = shapeAnalysis(task.spec.packages || []);
      return { shape: { max_parallel_width: sa.max_parallel_width, fully_serial: sa.fully_serial, touches_median: sa.touches_median, bloated: sa.bloated } };
    })() : {}),
    // Per-package total (every attempt/restart that package ever spawned), separate from
    // `packages` above so that field - already pinned elsewhere as a plain id list - never
    // changes shape.
    package_costs: task.spec ? task.spec.packages.map((p) => packageCostRollup(driverTotal, p.id, task)) : [],
    // Why a package with nothing running is not making progress - tm_ticket already surfaces
    // this per-STORY (storyBlockedReason, tickets.mjs); tm_status lists every package that IS
    // blocked, in one place, without a caller having to poll tm_ticket per package id. Includes
    // 'upstream_defect' (§upstream_defects) - a package rewired to wait on a fix STORY it itself
    // filed against an upstream dependency, not a blind retry - alongside the existing
    // unmet_deps/capacity/human_wait/restart_exhausted reasons. Only entries that ARE blocked;
    // an unblocked task reads exactly as it did before this field existed.
    blocked: task.spec ? task.spec.packages
      .map((p) => ({ package_id: p.id, blocked_reason: storyBlockedReason(task, p.id) }))
      .filter((b) => b.blocked_reason) : [],
    ...costFields,
    nodes: task.nodes.filter((n) => (a.node_id ? n.node_id === a.node_id : true)).map((n) => (n.state === 'pending' || n.state === 'running'
      ? { node_id: n.node_id, stage: n.stage, state: n.state, deps: n.deps, after: n.after || [],
          ...(n.child ? { child: { ...n.child, ...(n.child.driver ? { driver: { ...n.child.driver, alive: driverAlive(n.child.driver) } } : {}) } } : {}) }
      : verdict(task, n))),
    daemon: task.daemon ? { pid: task.daemon.pid, alive: driverAlive(task.daemon), log: task.daemon.log, stderr: task.daemon.stderr, spawn_count: task.daemon.spawn_count, restarts: task.daemon.restarts || 0, exhausted: !!task.daemon.exhausted, stderr_tail: driverStderrTail(task.daemon) } : null,
    team: task.team || null,
    // Only present when either knob is actually set - a task that never asked for a budget or
    // timebox reads exactly as it did before this existed.
    ...((task.team && task.team.opts && (task.team.opts.budget_usd != null || task.team.opts.timebox_minutes != null)) ? { budget: budgetStatus(task) } : {}),
    ...viewFields,
  };
}

// ---------- JSON-RPC / MCP plumbing ----------

function dispatch(name, a) {
  switch (name) {
    case 'tm_open': return toolOpen(a);
    case 'tm_run': return toolRun(a);
    case 'tm_next': return toolNext(a);
    case 'tm_wait': return toolWait(a);
    case 'tm_submit': return toolSubmit(a);
    case 'tm_retry': return toolRetry(a);
    case 'tm_file': return toolFile(a);
    case 'tm_status': return toolStatus(a);
    case 'tm_events': return toolEvents(a);
    case 'tm_board': return toolBoard(a);
    case 'tm_ticket': return toolTicket(a);
    case 'tm_assign': return toolAssign(a);
    case 'tm_inbox': return toolInbox(a);
    case 'tm_docs': return toolDocs(a);
    default: throw new Error('unknown tool: ' + name);
  }
}

// async because dispatch('tm_open'|'tm_run', ...) now returns a promise (openTaskAndMaybePin
// awaits ensureViewer) - every other tool still resolves synchronously, `await` just passes
// those straight through.
async function callTool(name, args) {
  const a = args || {};
  // Re-raise a dead daemon before doing anything else, on every tool that already has a task to
  // raise one for. No gate here beyond that: any caller may read or mutate the task at any time -
  // there is no leader to defer to and no inbox to queue behind. saveRun's own mkdir-lock is what
  // makes two writers (this call and the daemon's own loop) safe together.
  if (a.task_id && name !== 'tm_open' && name !== 'tm_run') {
    serviceDaemon(mustFindTask(a));
  }
  // board.jsonl: taken as a before/after diff of the tools that can move a ticket.
  if (!BOARD_TOOLS.has(name)) return dispatch(name, a);
  const before = a.task_id ? ticketSnapshot(mustFindTask(a)) : {};
  const out = await dispatch(name, a);
  const taskId = (out && out.task_id) || a.task_id;
  if (taskId) {
    try { syncTickets(mustFindTask({ task_id: taskId }), before, a.node_id || name); } catch { /* best-effort, like record() */ }
    // A mutation may have just turned a blocked task running again (tm_retry, tm_file) or opened
    // a brand-new one (tm_open, tm_run): re-check right after, not only on the NEXT call in, so a
    // caller that never polls again still leaves the task with a live daemon behind it.
    try { serviceDaemon(mustFindTask({ task_id: taskId })); } catch { /* best-effort */ }
  }
  return out;
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handle(msg) {
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
        const out = await callTool(params && params.name, params && params.arguments);
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

// Only run the stdio server when this file is the process entry point. daemon.mjs imports this
// module as a plain library - advanceDispatches, finish, foldChild, and the rest of the exports
// above - to drive a task's graph directly, without a JSON-RPC layer in between. Its own stdin is
// closed (spawnDaemon's stdio: ['ignore', ...]), and an ignored stream emits 'end' as soon as
// Node looks at it - so without this guard, importing taskmanager.mjs would call process.exit(0)
// on the daemon within its first tick, before it ever read the task it was told to drive.
//
// isEntryPoint (pluginroots.mjs) realpath-resolves both sides of the comparison rather than
// comparing raw strings - a symlinked plugin path (macOS's $TMPDIR -> /private/var, or an
// installed-marketplace layout) must still count as "this file is argv[1]" when it names the
// same real file. The raw-string version of this guard shipped in 3c5ad0c8 and exited silently,
// starting nothing, the first time a real path actually went through a symlink.
const isMain = isEntryPoint(import.meta.url);

if (isMain) {
  let buf = '';
  // handle() is async (tools/call can now await callTool -> dispatch -> tm_open/tm_run's own
  // await on ensureViewer). Chaining each line onto `queue` keeps replies in the same order
  // requests arrived - the same guarantee the old fully-synchronous loop gave for free - instead
  // of however their individual promises happen to settle.
  let queue = Promise.resolve();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      queue = queue.then(async () => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        let out;
        try { out = await handle(msg); } catch (e) {
          out = typeof msg.id === 'undefined' ? null : { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String((e && e.message) || e) } };
        }
        if (out) emit(out);
      });
    }
  });
  process.stdin.on('end', () => { queue.then(() => process.exit(0)); });
}
