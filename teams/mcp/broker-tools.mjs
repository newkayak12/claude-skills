// broker-tools.mjs - the broker's tool table (team_open, team_next, team_run, team_submit,
// team_retry, team_status), their handlers, and the callTool dispatch stdio.mjs calls with a ctx.
// Cut out of broker.mjs (card 128). Imports every other broker-*.mjs module; none imports this one.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { capacityFailure, JUDGING_STAGES } from './routing.mjs';
import {
  REASONING_STAGES,
  createRun,
  loadRun,
  saveRun,
  listRuns,
  getNode,
  stagePolicy,
  openRepair,
  retrySubgoal,
  retryReport,
  retrySpec,
  readyNodes,
  runState,
  unmetDeps,
  nodeBriefing,
  isAuthorNode,
  nodeKind,
  flowOf,
  goalRoundOf,
  goalGateSiblings,
  goalConsensus,
  promoteWaitingHuman,
  promoteHumanGates,
  autoPassHumanGateResult,
} from './graph.mjs';
import { composePrompt } from './prompts.mjs';
import { nodeEndEntry, nodeStartEntry, regionPointer, resolveStageModel, usageFromStream } from './nodelaunch.mjs';
import { readTeamConfig, resolveTeamOptions } from './teamconfig.mjs';
import { brokerDir, loadVendors, probeCache, readJson, record, runAdapter, syncOpenNodes } from './broker-vendors.mjs';
import { applyRollback, attributionBase, crossCheck, isWikiClaim, recordCheckpoint, verifyRestore, verifySnapshot } from './broker-checkpoint.mjs';
import { entry, parseVendorResult, verdict } from './broker-normalize.mjs';
import {
  checkpointInterruption,
  finishNode,
  repairBriefing,
  reviewIndependence,
  submitResult,
  subgoalFeedback,
  writeHumanBriefing,
} from './broker-independence.mjs';
import { activeNodes, ingestHandoff, knownCwds, mustFindRun, reclaimAbandoned, route } from './broker-routing.mjs';

// ---------- tools ----------

// Declared so a client can validate what comes back rather than trusting shape by
// convention. These describe the VERDICT surface deliberately: the payload - spec,
// handoffs, evidence, changed-file lists - never crosses this boundary.
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    run_id: { type: 'string' },
    node_id: { type: 'string' },
    stage: { type: 'string' },
    vendor: { type: 'string' },
    executor: { type: 'string', description: 'assigned AI vendor, including native host execution' },
    model: { type: ['string', 'null'], description: 'assigned model' },
    recoverable: { type: 'boolean' },
    checkpoint_path: { type: 'string' },
    next: { type: 'string' },
    state: { type: 'string', enum: ['pending', 'running', 'done', 'failed', 'skipped', 'unreachable'] },
    stage_ok: { type: 'boolean' },
    verified: { type: 'boolean', description: 'test nodes' },
    accept: { type: 'boolean', description: 'gate nodes' },
    match_pct: { type: 'number', description: 'gate nodes' },
    gap_count: { type: 'number', description: 'gate nodes' },
    observation_count: { type: 'number', description: 'gate nodes: non-blocking weaknesses' },
    spec_drift_count: { type: 'number', description: 'goal gate: where the spec asked less than the request' },
    sound: { type: 'boolean', description: 'critique nodes' },
    changed_files_verified: { type: ['boolean', 'null'], description: 'null means could not attribute - not a pass' },
    change_attribution: { type: ['string', 'null'], enum: ['isolated', 'shared-worktree', 'no-git', 'document-unchanged', null] },
    reviewer_independence: { type: 'string', enum: ['distinct-identity', 'unverifiable-self'], description: 'review and revise nodes: whether the broker could see that the reviewer is not the draft author' },
    contradicted_files: { type: 'array', items: { type: 'string' } },
    submitted_stage_ok: { type: 'boolean', description: 'present when the broker overruled the executor' },
    self_reported_stage_ok: { type: 'boolean', description: 'present (false) when an authoring node reported stage_ok:false with no reason and no failing check, and the broker let the chain judge the work instead' },
    missing_verdict: { type: 'string', description: 'the verdict field the node failed to return' },
    killed_for: { type: 'string', enum: ['timeout', 'cancelled'] },
    reason: { type: 'string' },
    detail_path: { type: ['string', 'null'], description: 'read this for one node only; never pull a whole run into context' },
  },
  required: ['node_id', 'stage', 'state', 'stage_ok'],
};

const READY_SCHEMA = {
  type: 'object',
  properties: {
    run_id: { type: 'string' },
    cwd: { type: 'string' },
    state: { type: 'string', enum: ['running', 'blocked', 'complete'] },
    counts: { type: 'object' },
    flow: { type: 'string', description: 'the flow the run is in: fixed by the entry, chosen by plan, or still "auto" before plan ran' },
    size: { type: 'string', enum: ['S', 'L'], description: 'what plan measured; absent before plan ran or when it did not say' },
    ready: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          node_id: { type: 'string' },
          stage: { type: 'string' },
          vendor: { type: 'string' },
          executor: { type: 'string' },
          model: { type: 'string' },
          routing_reason: { type: 'string' },
          attempts: { type: 'array', items: { type: 'object' } },
          briefing_path: { type: 'string', description: 'self-routed nodes only' },
          next: { type: 'string' },
        },
        required: ['node_id', 'stage', 'vendor'],
      },
    },
  },
  required: ['run_id', 'state', 'ready'],
};

const STATUS_SCHEMA = {
  type: 'object',
  properties: {
    run_id: { type: 'string' },
    cwd: { type: 'string' },
    state: { type: 'string', enum: ['running', 'blocked', 'complete'] },
    counts: { type: 'object' },
    goal_verdict: { type: 'object', description: 'the most recent goal-gate round\'s consensus, once every judge has settled: {accept, match_pct (min across judges), judges: [{node_id, state, accept, match_pct, identity}], gaps, spec_drift}' },
    has_spec: { type: 'boolean' },
    subgoals: { type: 'array', items: { type: 'string' } },
    nodes: { type: 'array', items: { type: 'object' } },
    cwds: { type: 'array', items: { type: 'string' }, description: 'overview form only' },
    runs: { type: 'array', items: { type: 'object' }, description: 'overview form only: one row per run, newest first' },
    config_notes: { type: 'array', items: { type: 'string' }, description: 'present only when .claude/team.json had an unrecognized key or a value that failed its validator - each note names the key and what was wrong with it' },
  },
};

const RETRY_SCHEMA = {
  type: 'object',
  properties: {
    run_id: { type: 'string' },
    target: { type: 'string', description: 'a subgoal id, "spec", or "goal_gate"' },
    retried: { type: 'boolean' },
    attempt: { type: 'number' },
    repair_id: { type: 'string', description: 'present when target is "goal_gate": the repair node opened' },
    reason: { type: 'string' },
    unreachable: { type: 'array', items: { type: 'string' }, description: 'retried=false with the budget gone: nodes that can never run now, so the report is released' },
    state: { type: 'string' },
    ready: { type: 'array', items: { type: 'object' } },
  },
  required: ['run_id', 'retried'],
};

const TOOLS = [
  {
    name: 'team_open',
    description:
      'Throw a raw request at the broker. It builds the harness flow as a node graph on disk and returns a run_id plus the first ready node. Nothing else about the run enters your context.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'the raw request, verbatim' },
        cwd: { type: 'string', description: 'absolute working directory for the whole run' },
        context: { type: 'string' },
        vendor: { type: 'string', description: '"auto" (default, stays on self unless candidates are given), a vendor name to require it, or "self"' },
        allocation: { type: 'string', enum: ['ordered', 'balanced'], description: 'balanced discovers Claude/Codex, scores stage fit, review independence, load and execution errors; ordered preserves legacy candidate order' },
        host_vendor: { type: 'string', enum: ['claude', 'codex'], description: 'Host with fresh native agents; selected host work returns self with executor identity. Omit if native role isolation is unavailable.' },
        host_model: { type: 'string', description: 'Current driving model, used for reasoning on the host. Fable/Astra require explicit model policy; they are not inherited automatically.' },
        native_models: { type: 'array', items: { type: 'string' }, description: 'Models selectable by fresh native agents. Omit only if the host can select all requested models; unsupported assignments fail visibly.' },
        model: { type: 'string', description: 'default model for every stage; a policy entry overrides it' },
        policy: {
          type: 'object',
          description:
            'Per-stage routing: {"plan":{"vendor":"self","model":"opus"},"implement":{"vendor":"codex"},"report":{"model":"sonnet"}}. Keys are stage names (plan, setgoal, critique, implement, test, draft, review, gate, report) plus the optional "gate:goal". A document subgoal review must not run on the identity that drafted it; give review its own vendor or model here. Each entry may set vendor, candidates, sandbox, model. A stage entry wins over the run-level setting.',
        },
        candidates: { type: 'array', items: { type: 'string' }, description: 'vendor preference order for "auto"' },
        sandbox: { type: 'string' },
        isolated: { type: 'boolean', description: 'cwd is a private worktree with only this run in it' },
        interactive: { type: 'boolean', description: 'default false, also settable in .claude/team.json. When a planning subgoal\'s investigate stage returns an unknown that names candidate answers, true opens an `ask` card (ask:<subgoal>:<attempt>) between investigate and draft and parks the run in waiting_human until a person picks - tm_inbox lists it, tm_submit({key, payload:{decisions}}) answers it, exactly like any other human card. false decides by default and records what it would have asked on run.unasked instead, so the report can show the questions nobody was asked.' },
        goal_threshold: { type: 'integer', description: 'default 90: the goal gate must report match_pct at or above this to accept. A gate that says accept with 70% match is reporting a partial result as a pass; the number it already returns is made to mean something. 0 accepts on the verdict alone.' },
        goal_judges: { type: 'integer', description: 'default 2: independent judges on the goal gate. Each round opens that many sibling gate nodes (gate:goal:<round>, gate:goal:<round>b, ...) over the same subgoal gates, routed to different identities where possible. The run accepts only if EVERY judge accepts at or above goal_threshold; gaps and spec_drift are the union. 1 reproduces the single-judge behaviour every earlier run had. A rejected round opens a repair pass over the assembled result (team_retry({repair:true}) forces one) rather than reassigning a subgoal.' },
        auto_reassign: { type: 'boolean', description: 'default true: a rejected subgoal gate, review or test opens the next attempt itself, carrying the rejection feedback, and settles when the budget is gone. false leaves the next attempt to team_retry, which makes a rejection advisory - a caller that never retries simply stops.' },
        max_retries: { type: 'number' },
        flow: { type: 'string', enum: ['auto', 'develop', 'document'], description: 'auto (default): plan decides from the request. develop: subgoals default to code work. document: subgoals default to written artifacts. Set by the entry skill, not by the user.' },
        mixed: { type: 'boolean', description: 'default true. false: every subgoal must be the flow\'s kind; a spec that mixes kinds fails at setgoal.' },
        skills: { description: 'Method per engine stage, overriding the defaults: {"plan": ["agents:agent-task-decomposer"], "critique": []}. Keys are plan, critique, test, review, gate, plus the optional gate:goal. false runs every one of those stages on its contract alone. A skill named here must be analytic and non-dialogic - a node runs headless and cannot answer a skill that asks it something.' },
        mounts: { description: 'Advisory MCP tools per engine stage, overriding the defaults: {"plan": ["mcp__sequential-thinking__sequentialthinking"]}. Keys are plan, setgoal, plus the optional gate:goal. false offers none of them. A tool named here that is not connected is skipped in silence, never searched for.' },
        retry_policy: { type: 'string', enum: ['continue', 'rollback'], description: 'default "continue", also settable in .claude/team.json. What team_retry (or autoReassign\'s own automatic retry) does with the worktree a rejected implement/draft/cases/audit attempt left. "continue" (default, today\'s only behavior) builds the next attempt on top of it. "rollback" resets the worktree to the checkpoint broker.mjs recorded before that subgoal\'s OWN FIRST attempt touched it, then re-runs with the failed gate\'s gaps as feedback - only when this run has exactly one subgoal (a shared worktree with a sibling subgoal still working in it cannot be reset for one of them without discarding the other\'s progress too; team_retry\'s reply names why it fell back to continue when that guard trips). _repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md §5 measured two real runs before defaulting to continue: both showed a retried implement CONVERGING on gate feedback across attempts (52%->60%->78%) rather than repeating the same mistake.' },
      },
      required: ['request', 'cwd'],
    },
    outputSchema: READY_SCHEMA,
  },
  {
    name: 'team_next',
    description:
      'Ask which node to run next. Returns node ids, stages, and their routing - never the goal-spec, handoffs, or evidence. For a node routed to "self" it returns a briefing_path to read; for a vendor node you do not need to read anything.',
    inputSchema: {
      type: 'object',
      properties: { run_id: { type: 'string' }, cwd: { type: 'string' } },
      required: ['run_id'],
    },
    outputSchema: READY_SCHEMA,
  },
  {
    name: 'team_run',
    description:
      'Execute one node with its routed vendor and return a one-line verdict. The broker composes the prompt from graph state - you do not pass one. Blocks until the vendor exits: do not background it, do not poll.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        node_id: { type: 'string' },
        cwd: { type: 'string' },
        model: { type: 'string' },
        add_dirs: { type: 'array', items: { type: 'string' } },
      },
      required: ['run_id', 'node_id'],
    },
    outputSchema: VERDICT_SCHEMA,
  },
  {
    name: 'team_submit',
    description:
      'Record a node you executed yourself. Same adjudication a vendor result gets: claimed changed_files are cross-checked against the worktree, and stage_ok comes back adjudicated, never raised. Idempotent per {run_id, node_id, attempt}: a node_id already carries its attempt number in most stages (implement:U1:2), so a duplicate call for a node that has already finished - the same request arriving twice, a retried MCP call - is a no-op that returns the stored verdict (`idempotent: true`) instead of erroring or re-adjudicating. Pass `attempt` when you have it for a stricter check (rejected if it does not match the node\'s own attempt).',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        node_id: { type: 'string' },
        cwd: { type: 'string' },
        attempt: { type: 'integer', description: 'this node\'s attempt number, for the idempotency check above. Optional - node_id already disambiguates attempts for every retryable stage.' },
        payload: {
          type: 'object',
          description:
            'the stage JSON contract for this node (implement/test/gate/etc). Passed through to the graph and never echoed back to you.',
        },
      },
      required: ['run_id', 'node_id', 'payload'],
    },
    outputSchema: VERDICT_SCHEMA,
  },
  {
    name: 'team_retry',
    description:
      'Open a fresh attempt, carrying the rejection feedback forward. With subgoal_id, retries that subgoal. With node_id naming a failed report node, reruns just that report (optionally away from avoid_executors). Without it, retries the spec itself (setgoal + critique) and discards the subgoal graph the rejected spec produced. The failed attempt stays in the graph as evidence. When the retry budget is gone the failure is settled instead: every node that needed its output becomes `unreachable`, and the report - which only waits for the goal gate to finish, not to pass - becomes ready to write the partial account.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        subgoal_id: { type: 'string', description: 'omit to retry the spec after a critique rejected it' },
        node_id: { type: 'string', description: 'Resume an interrupted/quota-exhausted node, retaining files and checkpoint. Does not reopen a completed or gate-rejected node. Also accepts a FAILED report node (its own stage_ok false): only that node reruns, carrying its previous reason and gaps as feedback, within the same retry budget; the other nodes are untouched.' },
        avoid_executors: { type: 'array', items: { type: 'string' }, description: 'With a failed report node_id: executors (vendors) the rerun is routed away from - tried last, never dropped.' },
        different_vendor: { type: 'boolean', description: 'With a failed report node_id: avoid the executor that ran the failed attempt (shorthand for naming it in avoid_executors).' },
        reset_capacity: { type: 'boolean', description: 'Retry vendors after the caller confirms their quota is available again. With node_id it also reopens that interrupted node; alone it clears exclusions - including ones recorded at probe time, where no node was ever interrupted - re-ranks undispatched work and returns the next ready nodes.' },
        repair: { type: 'boolean', description: 'Force a repair round over the most recent settled goal-gate round, the same move auto_reassign makes on its own when consensus rejects. Use it when auto_reassign is off, or when a stalled round (two repairs closing the same gaps) needs a deliberate third try.' },
        cwd: { type: 'string' },
      },
      required: ['run_id'],
    },
    outputSchema: RETRY_SCHEMA,
  },
  {
    name: 'team_status',
    description:
      'Compact run state: node counts, per-node state and verdict. Omit run_id to see every run in cwd instead - state, counts, and which node is running right now with its vendor and elapsed seconds. Pass full:true only when you actually need a payload - it is large by design and normally stays out of your context.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        cwd: { type: 'string' },
        node_id: { type: 'string' },
        full: { type: 'boolean' },
      },
    },
    outputSchema: STATUS_SCHEMA,
  },
];

// ---------- tool implementations ----------

// The broker owns the flow, so both execution paths enforce it identically. Without
// this on team_submit, a caller could record a node whose dependencies never ran and
// the ordering would be advisory rather than real.
function requireRunnable(run, nodeId) {
  const n = getNode(run, nodeId);
  if (!n) throw new Error(`unknown node ${nodeId}`);
  if (n.state !== 'pending') throw new Error(`node ${n.node_id} is ${n.state}, not pending`);
  const missing = unmetDeps(run, n);
  if (missing.length) throw new Error(`node ${n.node_id} is blocked on ${missing.join(', ')}`);
  return n;
}

async function toolGraphOpen(a) {
  const cwd = resolve(String(a.cwd));
  knownCwds.add(cwd);
  // .claude/team.json layers under an explicit team_open argument of the same name -
  // the same precedence tm_open's own resolveTeamOptions call gives it (teamconfig.mjs).
  // Only vendor/allocation/goal_threshold/max_retries/interactive/retry_policy/human_gates
  // are both a TEAM_DEFAULTS key and a team_open argument that createRun actually consumes
  // on a single run; the other TEAM_DEFAULTS keys (brainstorm, max_parallel_teams,
  // max_parallel_ceiling, qa_rounds, roles, driver_restarts, docs_dir) belong to
  // tm_open's multi-team/TaskManager layer and are not team_open arguments at all.
  const team = resolveTeamOptions(a, readTeamConfig(cwd).config);
  const T = team.opts;
  const run = createRun({
    cwd,
    request: String(a.request),
    context: a.context || '',
    vendor: T.vendor,
    allocation: T.allocation,
    host_vendor: a.host_vendor || null,
    host_model: a.host_model || null,
    native_models: a.native_models || null,
    model: a.model || null,
    policy: a.policy || {},
    candidates: a.candidates || null,
    sandbox: a.sandbox || null,
    isolated: a.isolated === true,
    interactive: T.interactive === true,
    human_gates: Array.isArray(T.human_gates) ? T.human_gates.slice() : [],
    auto_reassign: a.auto_reassign !== false,
    goal_threshold: T.goal_threshold,
    // goal_judges is not a TEAM_DEFAULTS key, so resolveTeamOptions never touches it - it
    // is not pinnable in team.json. The MCP tool boundary defaults it to two judges;
    // createRun itself defaults to one, so a caller that builds runs directly - the
    // TaskManager's own per-package child runs among them - keeps today's single-gate
    // behaviour unless it asks otherwise.
    goal_judges: Number.isInteger(a.goal_judges) && a.goal_judges > 0 ? a.goal_judges : 2,
    max_retries: T.max_retries,
    retry_policy: T.retry_policy,
    flow: a.flow,
    mixed: a.mixed,
    skills: a.skills,
    mounts: a.mounts,
  });
  // resolveTeamOptions' notes (an unrecognized team.json key, or one whose value failed
  // its validator) reach tm_status's team.notes on the tm_open path but had nowhere to
  // land here - team_open handed back only READY_SCHEMA, so a typo'd key was silently
  // ignored with no diagnostic anywhere. Persist it on the run itself so team_status can
  // surface it, the same way task.team.notes does for tm_open.
  if (team.notes.length) run.config_notes = team.notes;
  saveRun(run);
  record(cwd, { event: 'team_open', run_id: run.run_id, vendor: run.vendor, flow: run.flow, mixed: run.mixed });
  return { run_id: run.run_id, cwd, ...(await toolGraphNext({ run_id: run.run_id, cwd })) };
}

async function toolGraphNext(a) {
  const run = mustFindRun(a);
  reclaimAbandoned(run);
  // A human-pinned node that just became ready parks in waiting_human here, before readyNodes()
  // is even read - the same reason reclaimAbandoned runs first: this is where "ready" is decided
  // for real. Write its briefing exactly like a self node's (below), because tm_inbox has to
  // point the main session at SOMETHING readable - "what is asked" is the same briefing a fresh
  // agent would have read, not a second document invented for a human.
  const promoted = promoteWaitingHuman(run);
  // gate:human (D2 Task 4): a node whose stage is in run.human_gates never reaches a driver -
  // interactive parks it exactly like the pin above (same briefing, same tm_inbox/tm_submit
  // path); non-interactive auto-passes it here and now through the same finishNode every other
  // submission goes through, so autoReassign and every stage-specific completion hook still run.
  const { parked: gateParked, autoPass } = promoteHumanGates(run);
  for (const n of autoPass) finishNode(run, n, autoPassHumanGateResult(n), 'auto');
  const allParked = [...promoted, ...gateParked];
  if (allParked.length) {
    for (const n of allParked) writeHumanBriefing(run, n);
    saveRun(run);
    record(run.cwd, { event: 'node_waiting_human', run_id: run.run_id, nodes: allParked.map((n) => n.node_id) });
  }
  let ready = readyNodes(run);

  // `isolated` is the broker's own claim that one node had the worktree to itself, and
  // it is what makes positive attribution sound. Offering two independent implement
  // nodes at once invites the orchestrator to run both and quietly falsifies it. Under
  // isolation, hand out one mutating node at a time; reasoning nodes write nothing and
  // stay parallel.
  if (run.isolated) {
    let mutatingOffered = run.nodes.some((n) => n.state === 'running' && !REASONING_STAGES.has(n.stage));
    ready = ready.filter((n) => {
      if (REASONING_STAGES.has(n.stage)) return true;
      if (mutatingOffered) return false;
      mutatingOffered = true;
      return true;
    });
  }

  const state = runState(run);
  const response = {
    run_id: run.run_id,
    state: state.state,
    counts: state.counts,
    flow: flowOf(run) || run.flow || 'auto',
    ...(run.size ? { size: run.size } : {}),
    ready: await (async () => {
      const offered = [];
      for (const n of ready) {
      const r = await route(run, n);
      if (run.allocation === 'balanced' && r.vendor !== 'vendor-failure') {
        n.assignment = r;
        n.executor = r.executor || r.vendor;
        saveRun(run);
      }
      const briefingPath = join(brokerDir(run.cwd), run.run_id, 'briefings', `${n.node_id.replace(/[^A-Za-z0-9._-]/g, '_')}.md`);
      if (r.vendor === 'self') {
        // A self-executed node never passes through team_run's own n.state='running' checkpoint
        // hook (there is no team_run call - the native agent does the work itself, then
        // team_submit's), so this is the only place its attempt begins from the broker's point
        // of view. Idempotent (recordCheckpoint no-ops once n.checkpoint is set), so re-offering
        // the same ready node on a later poll costs nothing.
        if (isAuthorNode(run, n) && recordCheckpoint(run, n)) saveRun(run);
        try {
          mkdirSync(dirname(briefingPath), { recursive: true });
          writeFileSync(briefingPath, composePrompt(run, n, nodeBriefing(run, n)));
        } catch {
          /* the orchestrator can still fall back to team_status full:true */
        }
      }
      offered.push({
        node_id: n.node_id,
        stage: n.stage,
        vendor: r.vendor,
        executor: r.executor,
        routing_reason: r.reason,
        attempts: r.vendor === 'vendor-failure' ? r.attempts : undefined,
        briefing_path: r.vendor === 'self' ? briefingPath : undefined,
        model: r.model || undefined,
        next: r.vendor === 'self' ? 'dispatch briefing_path to a fresh native agent at model, then team_submit' : r.vendor === 'vendor-failure' ? 'no vendor is ready; see attempts' : 'call team_run',
      });
      }
      return offered;
    })(),
  };
  run.routing_blocked = Boolean(response.ready.length && response.ready.every(n => n.vendor === 'vendor-failure'));
  // Blocked only because every vendor a ready node may use is out of credit is a wait, not a
  // failure: the manager parks the package until the reset instead of spending retries on a
  // probe that will say the same thing (code-beta-X3 burned six dispatches in 70 seconds).
  const spent = (x) => /^usage capacity exhausted/.test(String(x.reason || ''));
  const capacityOnly = run.routing_blocked && response.ready.every(n => (n.attempts || []).length && n.attempts.every(spent));
  if (capacityOnly) run.routing_blocked_capacity = response.ready.flatMap(n => n.attempts).map(x => x.reason)[0];
  else run.routing_blocked_capacity = null; // assigned: saveRun's merge keeps a deleted key
  saveRun(run);
  response.state = runState(run).state;
  return response;
}

// {api_calls, peak_context_tokens} of one node's session: its adapter events file, else the
// adapter's stdout. Nulls when neither holds usage; never throws.
function nodeUsage(eventsPath, stdout) {
  let u = { api_calls: null, peak_context_tokens: null };
  try { u = usageFromStream(readFileSync(eventsPath, 'utf8')); } catch { /* no events file */ }
  if (u.api_calls == null && u.peak_context_tokens == null) u = usageFromStream(stdout);
  return u;
}

async function toolGraphRun(a) {
  const run = mustFindRun(a);
  let n = requireRunnable(run, String(a.node_id));
  // team_next never offers this node (promoteWaitingHuman parks it in waiting_human first), but
  // a caller who already has the node_id can still reach team_run directly before that happens -
  // §0.3 of _repo/docs/plans/2026-09-17-teams-team-v0.13.0.md fixes human OUT of the routing pool
  // entirely, and without this guard route()'s own early return (line ~427, honoring
  // node.assignment as-is) would hand this node's vendor straight through as 'human', which
  // loadVendors(run.cwd) has no entry for.
  if (n.assignment && n.assignment.executor === 'human') {
    throw new Error(`node ${n.node_id} is pinned to a human executor; call team_next to move it to waiting_human, then tm_inbox/tm_submit from the main session`);
  }

  const r = await route(run, n);
  if (r.vendor === 'self') throw new Error(`node ${n.node_id} is routed to self - use team_submit`);
  if (r.vendor === 'vendor-failure') {
    n.state = 'failed';
    n.result = { stage_ok: false, reason: r.attempts.map((x) => `${x.vendor}: ${x.reason}`).join(' | ') };
    n.vendor = 'vendor-failure';
    saveRun(run);
    return verdict(run, n);
  }

  // Policy is the default; an explicit team_run({model}) still wins for one call. The claude
  // adapter always gets an explicit model by stage (card 130: implement/test sonnet; plan,
  // critique, review, gate, report opus; team.json `models` overrides) unless one is pinned at
  // tm_open / team_run. Any other vendor keeps the model routing chose: a stage alias means
  // nothing to it.
  const launchStage = n.node_id.startsWith('gate:goal') ? 'gate:goal' : n.stage;
  const stageModels = resolveTeamOptions({}, readTeamConfig(run.cwd).config).opts.models;
  const chosenModel = a.model || (r.vendor === 'claude'
    ? stagePolicy(run, n).model || resolveStageModel(launchStage, { models: stageModels })
    : r.model);
  const independence = reviewIndependence(run, n, r.executor || r.vendor, chosenModel);

  const vendor = loadVendors(run.cwd)[r.vendor];
  const ticket = randomUUID();
  n.ticket = ticket;
  n.executor = r.executor || r.vendor;
  n.model = r.model || null;
  n.state = 'running';
  n.started_at = Date.now();
  if (isAuthorNode(run, n)) recordCheckpoint(run, n);
  saveRun(run);
  syncOpenNodes(run);
  const activeKey = `${run.run_id}:${n.node_id}`;
  activeNodes.add(activeKey);

  const dir = join(brokerDir(run.cwd), run.run_id, n.node_id.replace(/[^A-Za-z0-9._-]/g, '_'), ticket);
  mkdirSync(dir, { recursive: true });
  const promptPath = join(dir, 'prompt.md');
  const outPath = join(dir, 'result.json');
  const eventsPath = join(dir, 'events.jsonl');
  writeFileSync(promptPath, composePrompt(run, n, nodeBriefing(run, n), { regionPointer }));
  n.detail_path = outPath;
  saveRun(run);

  // Implement/test go through the adapter's stage contract, which enforces their JSON
  // schema. Reasoning nodes must NOT: their shapes differ per stage (setgoal returns a
  // spec, gate returns a verdict) and the implement schema is additionalProperties:false,
  // so a valid setgoal answer would be rejected as malformed. The adapter's --stage is
  // optional, so we omit it and parse the model's reply here instead.
  // The adapter knows two staged schemas: implement (files + checks) and test (verified).
  // A draft is implement-shaped - it writes files and reports them - so it borrows that
  // schema; review is reasoning and runs unstaged like the other judging nodes.
  const reasoning = REASONING_STAGES.has(n.stage);
  // review and gate are reasoning (read-only sandbox, no Edit/Write), but their own contract
  // asks them to re-run the acceptance checks a command names - wc -w, a validator script,
  // git diff --stat - not to trust the authoring node's report of them. A reasoning node with
  // no Bash cannot do that (P4:review:U1, portfolio-refresh Sprint: rejected twice on
  // `verified:false` for "no Bash tool available in this reasoning node", passed on attempt 3
  // on the identical unverifiable evidence - the verdict was luck, not the work). --verify
  // tells the adapter to grant Bash under the read-only profile anyway, for exactly these two
  // stages; every other reasoning stage (plan, setgoal, critique, report, reduce, ask) is
  // judgment over text and gets no Bash, unchanged.
  const verifies = n.stage === 'review' || n.stage === 'gate';
  const args = [
    ...(reasoning ? [] : ['--stage', n.stage === 'test' ? 'test' : 'implement']),
    '--cwd', run.cwd,
    '--prompt-file', promptPath,
    '--events-output', eventsPath,
    '--output', outPath,
    '--sandbox', r.sandbox,
  ];
  if (verifies) args.push('--verify');
  // Judging stages (reasoning ones carry no --stage, so the adapter cannot tell) never get the wiki.
  if (JUDGING_STAGES.has(n.stage)) args.push('--no-wiki');
  if (run.isolated && !REASONING_STAGES.has(n.stage)) args.push('--isolated');
  for (const d of Array.isArray(a.add_dirs) ? a.add_dirs : []) args.push('--add-dir', String(d));
  if (chosenModel) args.push('--model', String(chosenModel));

  // Taken before the adapter runs, so a --verify node's own Bash access can be checked
  // against it afterward regardless of what the node itself claims (verifySnapshot/
  // verifyRestore in broker-checkpoint.mjs).
  const verifySnap = verifies ? verifySnapshot(run, n) : null;

  // One adapter process is this node's whole session; the ledger brackets it.
  record(run.cwd, nodeStartEntry({ run_id: run.run_id, node_id: n.node_id, stage: n.stage, model: chosenModel ? String(chosenModel) : null }));
  let proc;
  try {
    proc = await runAdapter(vendor, args, run.cwd, {
      register: (cancel) => { if (a.__onCancel) a.__onCancel(cancel); },
      timeoutMs: a.timeout_ms,
      stage: r.vendor === 'claude' ? launchStage : undefined,
      models: stageModels,
    });
  } finally {
    activeNodes.delete(activeKey);
  }
  record(run.cwd, nodeEndEntry({ run_id: run.run_id, node_id: n.node_id, stage: n.stage, model: chosenModel ? String(chosenModel) : null, ...nodeUsage(eventsPath, proc.stdout) }));
  const report = readJson(outPath) || {};
  const payload = parseVendorResult(report) || {};

  // The vendor call above may have taken minutes. Anything this process remembers about
  // the run is potentially stale, so re-read before recording - otherwise finishing this
  // node writes back a snapshot that erases whatever else completed meanwhile.
  const fresh = loadRun(run.cwd, run.run_id);
  if (fresh) {
    run.nodes = fresh.nodes;
    run.spec = fresh.spec;
    // A STORY pin another process drained meanwhile lives on the run, not on a node (M5): carry
    // it, so what this node expands (setgoal's subgoals) is pinned the way the person asked.
    if (fresh.subgoal_assignee) run.subgoal_assignee = fresh.subgoal_assignee;
    else delete run.subgoal_assignee;
    if ('model_subgoal_assignee' in fresh) run.model_subgoal_assignee = fresh.model_subgoal_assignee;
    else delete run.model_subgoal_assignee;
    const again = getNode(run, n.node_id);
    if (again) {
      again.ticket = n.ticket;
      again.started_at = n.started_at;
      again.detail_path = n.detail_path;
      n = again;
    }
  }
  // Whatever a person queued while this vendor ran (tm_assign, tm_submit({key})) is applied now,
  // before this node's result expands anything - the same drain every tool entry point makes
  // (mustFindRun). A STORY pin queued during setgoal otherwise waited for the next team_next and
  // missed the subgoals this very result creates (M5).
  ingestHandoff(run);
  n = getNode(run, n.node_id) || n;

  const transportOk = proc.status === 0;
  // A provider's usage limit is never a verdict on the work, under either allocation: code-sprint-S2's
  // second PLAN run (allocation ordered) had every codex node exit 1 on "You've hit your usage
  // limit", each counted as a failed attempt, until the package's retries were spent. The
  // message lives only in the adapter's own event stream, so that is read too.
  let eventsTail = '';
  try {
    const ev = report.events_output || '';
    if (ev && existsSync(ev)) { const t = readFileSync(ev, 'utf8'); eventsTail = t.slice(-8192); }
  } catch { /* no events file - stderr and the report are all there is */ }
  if ((!transportOk || report.stage_ok === false)
      && capacityFailure({ ...report, stdout: [report.stdout || '', eventsTail].join('\n') }, proc.stderr)) {
    return checkpointInterruption(run, n, r.executor || r.vendor, { ...report,
      transport: { status: proc.status, stderr: proc.stderr, stdout: proc.stdout } }, 'quota');
  }
  // A vendor that answered in full but whose JSON does not parse has not failed the work - it
  // mistyped the envelope. portfolio-refresh's QA (2026-09-28) wrote a complete plan with one
  // stray `]` after its last string; the adapter exited 1, nothing retries a plan node, and the
  // Sprint's only QA pass blocked at 0/3. One fresh attempt, same vendor; a second is a failure.
  const malformed = !proc.killed_for && /[{[]/.test(String(report.last_message || ''))
    && !report.result && (Object.keys(payload).length === 0 || payload._unparsed === true);
  if (malformed && !(n.interruptions || []).some((i) => i.kind === 'malformed')) {
    return checkpointInterruption(run, n, r.executor || r.vendor, { ...report,
      transport: { status: proc.status, stderr: proc.stderr } }, 'malformed');
  }
  let result;
  if (!transportOk) {
    const why = proc.killed_for === 'timeout'
      ? `vendor exceeded the node timeout and was killed`
      : proc.killed_for === 'cancelled'
        ? 'cancelled by the client'
        : '';
    result = { stage_ok: false, killed_for: proc.killed_for || '', reason: why || proc.stderr.slice(-300) || `adapter exit ${proc.status}` };
  } else if (reasoning) {
    // Nothing to cross-check: these nodes are judged by their content, not by files.
    // The adapter ran unstaged, so there is no report.stage_ok - the payload is it.
    // An unparseable or empty reply is a failed node, never a silent pass.
    const unusable = !payload || payload._unparsed === true || Object.keys(payload).length === 0;
    result = unusable
      ? {
          stage_ok: false,
          reason: `${entry(n)} returned no usable JSON: ${String((payload && payload.handoff) || report.last_message || '').slice(0, 200)}`,
        }
      : { ...payload, stage_ok: payload.stage_ok !== false, ...(independence ? { reviewer_independence: independence.independence } : {}) };
  } else {
    const check = crossCheck(run.cwd, payload.changed_files, run.isolated, nodeKind(run, n), attributionBase(run, n));
    const contradicted = check.contradicted_files.length > 0;
    result = {
      ...payload,
      ...(Array.isArray(payload.changed_files) ? { changed_files: payload.changed_files.filter((f) => !isWikiClaim(f)) } : {}),
      stage_ok: report.stage_ok === true && !contradicted,
      ...check,
      verification_error: contradicted
        ? `claimed changed_files not present in the worktree: ${check.contradicted_files.join(', ')}`
        : report.verification_error || '',
      // audit is not a REASONING_STAGES member (graph.mjs's planning-audit table keeps every
      // non-final chain stage "mutating" on purpose - see that table's own comment), so it
      // never reaches the reasoning branch above. Its cross-run independence check still
      // belongs on the result; merged here instead of gating a whole extra branch on one stage.
      ...(independence ? { reviewer_independence: independence.independence } : {}),
    };
  }
  if (verifySnap) {
    const mutated = verifyRestore(run, n, verifySnap);
    if (mutated.length) {
      result = {
        stage_ok: false,
        reason: `${entry(n)} used its --verify Bash access to change ${mutated.join(', ')} while judging read-only. Restored; this attempt is void - a ${n.stage} node's verdict on a tree it edited itself is not evidence.`,
      };
      record(run.cwd, { event: 'verify_write_guard_violation', run_id: run.run_id, node_id: n.node_id, stage: n.stage, paths: mutated });
    }
  }
  return finishNode(run, n, result, r.vendor);
}

// At-least-once delivery (_repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md §5): a caller
// that submits the same node twice - a retried MCP call, two drivers racing on one node - must
// not have its second call re-adjudicate (or, for a dispatch-shaped node, redo a git commit) what
// the first already settled. node_id already disambiguates ATTEMPT for every stage this engine
// retries (implement:U1:2, gate:goal:3, shape:2 all carry the round in the id), so {run_id,
// node_id} is already the idempotency key in the common case; `attempt`, when the caller has it,
// is one more check rather than the whole of it.
function idempotentSubmit(run, n, a) {
  if (!n || n.state === 'pending' || n.state === 'running' || !n.result) return null;
  if (a.attempt != null && Number(a.attempt) !== (n.attempt || 1)) return null;
  return { ...verdict(run, n), idempotent: true, note: `node ${n.node_id} already ${n.state}; returning the stored result, no work repeated` };
}

function toolGraphSubmit(a) {
  const run = mustFindRun(a);
  const already = idempotentSubmit(run, getNode(run, String(a.node_id)), a);
  if (already) return already;
  const n = requireRunnable(run, String(a.node_id));
  const payload = a.payload || {};
  if (run.allocation === 'balanced') {
    if (!n.assignment || n.assignment.vendor !== 'self') throw new Error('balanced node must be assigned to a native executor by team_next before submit');
    n.executor = n.assignment.executor || 'self';
    n.model = n.assignment.model || null;
    if (payload.stage_ok === false && capacityFailure(payload)) return checkpointInterruption(run, n, n.executor, payload, 'quota');
  }
  return submitResult(run, n, payload, 'self');
}

async function toolGraphRetry(a) {
  const run = mustFindRun(a);
  // Validate before touching anything: a call that is going to be rejected must not have
  // already spent the capacity reset. The node itself is looked up again below, after the
  // reset has saved - saveRun rebuilds run.nodes, so a reference taken here can go stale.
  const retryable = (n) => n && n.state === 'pending' && n.recovery;
  // A failed report (its own stage_ok false, not interrupted) is the one other node team_retry
  // reopens: it rewrites from the ledger, so only that node reruns.
  const failedReport = (n) => n && n.stage === 'report' && n.state === 'failed' && n.result
    && n.result.stage_ok === false && !n.recovery;
  const target = a.node_id ? getNode(run, String(a.node_id)) : null;
  if (a.node_id && !retryable(target) && !failedReport(target)) {
    throw new Error('node_id must identify a currently interrupted pending node');
  }
  if (a.avoid_executors != null && !Array.isArray(a.avoid_executors)) {
    throw new Error('avoid_executors must be an array of executor names');
  }

  // A vendor can be excluded before it ever runs a node, so a capacity reset cannot
  // require an interrupted node to name.
  if (a.reset_capacity === true) {
    run.unavailable_vendors = {};
    run.capacity_epoch = (run.capacity_epoch || 0) + 1;
    probeCache.clear();
    // An assignment made while the vendor was excluded is stale: re-rank it. Work already
    // dispatched keeps its executor - only what has not left the gate is reconsidered.
    for (const n of run.nodes) if (n.state === 'pending' && !n.ticket) delete n.assignment;
    saveRun(run);
    if (!a.node_id && !a.subgoal_id) {
      record(run.cwd, { event: 'team_retry', run_id: run.run_id, target: 'capacity' });
      return { run_id: run.run_id, target: 'capacity', retried: true, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
    }
  }

  if (a.node_id) {
    const n = getNode(run, String(a.node_id));
    if (failedReport(n)) {
      const out = retryReport(run, '', { node_id: n.node_id, avoid_executors: a.avoid_executors, different_vendor: a.different_vendor === true });
      if (out.refused) throw new Error(out.reason);
      if (!out.attempt) {
        record(run.cwd, { event: 'team_settle', run_id: run.run_id, target: n.node_id, unreachable: out.unreachable.length });
        return { run_id: run.run_id, target: n.node_id, retried: false, reason: out.reason, unreachable: out.unreachable, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
      }
      record(run.cwd, { event: 'team_retry', run_id: run.run_id, target: n.node_id, attempt: out.attempt });
      return { run_id: run.run_id, target: n.node_id, retried: true, attempt: out.attempt, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
    }
    n.state = 'pending';
    n.ticket = null;
    delete n.assignment;
    saveRun(run);
    return { run_id: run.run_id, target: n.node_id, retried: true, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
  }

  // Force a repair round: the same move autoReassignGoalGate makes on its own when
  // consensus rejects, callable directly for auto_reassign:false runs or to push past
  // a stall the caller wants to override.
  if (a.repair === true) {
    const rounds = [...new Set(run.nodes.filter((n) => n.stage === 'gate' && n.subgoal_id === null)
      .map((n) => goalRoundOf(n.node_id)).filter((r) => r != null))];
    if (!rounds.length) throw new Error('no goal-gate round exists yet to repair');
    const round = Math.max(...rounds);
    const consensus = goalConsensus(run, round);
    if (!consensus || !consensus.settled) throw new Error(`goal-gate round ${round} has not finished judging yet`);
    if (consensus.accept) throw new Error(`goal-gate round ${round} already accepted - nothing to repair`);
    // repair's `after` edge only counts a failed judge as settled once it is final -
    // the same mark autoReassignGoalGate leaves before opening repair on its own.
    for (const s of goalGateSiblings(run, round)) if (s.state === 'failed') s.final = true;
    const feedback = repairBriefing(run, consensus);
    const out = openRepair(run, round, feedback, run.goal_judges || goalGateSiblings(run, round).length);
    if (!out.attempt) {
      record(run.cwd, { event: 'team_settle', run_id: run.run_id, target: 'goal_gate', round, reason: out.reason });
      return { run_id: run.run_id, target: 'goal_gate', retried: false, reason: out.reason, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
    }
    record(run.cwd, { event: 'team_repair', run_id: run.run_id, target: 'goal_gate', round, attempt: out.attempt, repair_id: out.repair_id, forced: true });
    return { run_id: run.run_id, target: 'goal_gate', retried: true, attempt: out.attempt, repair_id: out.repair_id, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
  }

  // No subgoal named means the spec itself was rejected: redo setgoal and critique.
  if (!a.subgoal_id) {
    const source = run.nodes
      .filter((n) => (n.stage === 'critique' || n.stage === 'setgoal') && n.state === 'failed' && n.result)
      .pop() || run.nodes.filter((n) => n.stage === 'critique' && n.result).pop();
    const fb = source && source.result
      ? [source.result.reason || '', ...(source.result.blocking || []),
         ...(source.result.spec_problems || []), ...(source.result.problems || [])]
          .filter(Boolean).join('\n- ')
      : '';
    const out = retrySpec(run, fb);
    if (!out.attempt) {
      record(run.cwd, { event: 'team_settle', run_id: run.run_id, target: 'spec', unreachable: out.unreachable.length });
      return { run_id: run.run_id, target: 'spec', retried: false, reason: out.reason, unreachable: out.unreachable, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
    }
    record(run.cwd, { event: 'team_retry', run_id: run.run_id, target: 'spec', attempt: out.attempt });
    return { run_id: run.run_id, target: 'spec', retried: true, attempt: out.attempt, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
  }

  // The feedback is whatever judged the attempt last: a gate's gaps, or - when the
  // attempt never reached its gate - the check that failed it. A review that listed
  // what the text lacks, or a test that printed the failing command, is the feedback
  // the next draft or implement needs; carrying only gate verdicts sent it in blind.
  const sid = String(a.subgoal_id);
  const out = retrySubgoal(run, sid, subgoalFeedback(run, sid));
  if (!out.attempt) {
    record(run.cwd, { event: 'team_settle', run_id: run.run_id, subgoal_id: sid, unreachable: out.unreachable.length });
    return { run_id: run.run_id, target: sid, subgoal_id: sid, retried: false, reason: out.reason, unreachable: out.unreachable, ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
  }
  const rollback = applyRollback(out.run, out.rollback, sid);
  record(run.cwd, { event: 'team_retry', run_id: run.run_id, subgoal_id: sid, attempt: out.attempt });
  return { run_id: run.run_id, target: sid, subgoal_id: sid, retried: true, attempt: out.attempt, ...(rollback ? { rollback } : {}), ...(await toolGraphNext({ run_id: run.run_id, cwd: run.cwd })) };
}

// What is happening right now, without a run_id in hand. A lead that lost the id - a
// fresh session, a compaction, a second operator looking in - had no way back into a run
// from the MCP alone, and no way to see what a blocking team_run is doing meanwhile.
// One row per run, newest first; payloads stay out of it exactly as elsewhere.
function progressOverview(a) {
  const cwds = a.cwd ? [resolve(String(a.cwd))] : [...knownCwds];
  if (!cwds.length) throw new Error('pass cwd or run_id - the broker knows no working directory yet');
  const now = Date.now();
  const runs = [...new Set(cwds)].flatMap((cwd) => listRuns(cwd))
    .sort((x, y) => (y.created_at || 0) - (x.created_at || 0))
    .map((run) => {
      reclaimAbandoned(run);
      const state = runState(run);
      const finished = run.nodes.filter((n) => n.state === 'done' || n.state === 'failed').at(-1);
      const stalled = Object.keys(run.unavailable_vendors || {});
      return {
        run_id: run.run_id,
        cwd: run.cwd,
        state: state.state,
        counts: state.counts,
        request: String(run.request || '').slice(0, 160),
        created_at: new Date(run.created_at || now).toISOString(),
        running: run.nodes.filter((n) => n.state === 'running').map((n) => ({
          node_id: n.node_id,
          stage: n.stage,
          executor: n.executor || n.vendor || null,
          model: n.model || null,
          elapsed_s: Math.round((now - (n.started_at || now)) / 1000),
        })),
        last_finished: finished ? { node_id: finished.node_id, stage: finished.stage, state: finished.state } : null,
        ...(stalled.length ? { unavailable_vendors: run.unavailable_vendors } : {}),
      };
    });
  return { cwds: [...new Set(cwds)], runs };
}

function toolGraphStatus(a) {
  if (a.run_id === undefined || a.run_id === null || a.run_id === '') return progressOverview(a);
  const run = mustFindRun(a);
  reclaimAbandoned(run);
  if (a.full) {
    if (a.node_id) {
      const n = getNode(run, String(a.node_id));
      if (!n) throw new Error(`unknown node ${a.node_id}`);
      return { run_id: run.run_id, node: n };
    }
    return run;
  }
  const state = runState(run);
  return {
    run_id: run.run_id,
    cwd: run.cwd,
    state: state.state,
    counts: state.counts,
    ...(state.goal_verdict ? { goal_verdict: state.goal_verdict } : {}),
    has_spec: !!run.spec,
    flow: flowOf(run) || run.flow || 'auto',
    mixed: run.mixed !== false,
    ...(run.size ? { size: run.size } : {}),
    ...(run.config_notes && run.config_notes.length ? { config_notes: run.config_notes } : {}),
    subgoals: run.spec ? (run.spec.subgoals || []).map((s) => s.id) : [],
    nodes: run.nodes
      .filter((n) => (a.node_id ? n.node_id === a.node_id : true))
      .map((n) => (n.state === 'pending' || n.state === 'running'
        ? {
          node_id: n.node_id,
          stage: n.stage,
          state: n.state,
          deps: n.deps,
          after: n.after || [],
          // A blocking team_run is otherwise invisible: the node reads as bare "running"
          // with no way to tell which vendor is on it or whether it is stuck.
          ...(n.state === 'running'
            ? {
              executor: n.executor || n.vendor || null,
              model: n.model || null,
              elapsed_s: Math.round((Date.now() - (n.started_at || Date.now())) / 1000),
            }
            : {}),
        }
        : verdict(run, n))),
  };
}

// ---------- JSON-RPC / MCP plumbing ----------
// The loop itself (initialize, tools/list, tools/call, progress, cancellation) is stdio.mjs;
// this is the broker's tool dispatch, which stdio.mjs calls with a ctx.

async function callTool(name, args, ctx = {}) {
  const a = args || {};
  if (a.cwd) knownCwds.add(resolve(String(a.cwd)));
  switch (name) {
    case 'team_open': return await toolGraphOpen(a);
    case 'team_next': return await toolGraphNext(a);
    case 'team_run':
      // The vendor child is stopped through the `cancel` that runAdapter hands out; a client's
      // notifications/cancelled reaches it as ctx.registerChild(...).kill().
      return await toolGraphRun({ ...a, __onCancel: (cancel) => { if (ctx.registerChild) ctx.registerChild({ kill: cancel }); } });
    case 'team_submit': return toolGraphSubmit(a);
    case 'team_retry': return await toolGraphRetry(a);
    case 'team_status': return toolGraphStatus(a);
    default: throw new Error('unknown tool: ' + name);
  }
}

export { TOOLS as BROKER_TOOLS, callTool as callBrokerTool };
