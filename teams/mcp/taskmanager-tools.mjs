// taskmanager-tools.mjs - the tool schema table, dispatch and callTool; split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { ticketSnapshot } from './tickets.mjs';
import { expireAsks, toolAsk } from './taskmanager-asks.mjs';
import { mustFindTask, withTask } from './taskmanager-stages.mjs';
import { serviceDaemon } from './taskmanager-drivers.mjs';
import { syncTickets, toolAssign, toolBoard, toolCancel, toolClean, toolDocs, toolEvents, toolFile, toolInbox, toolLog, toolOpen, toolRetry, toolRun, toolStatus, toolTicket, toolWait } from './taskmanager-handlers.mjs';
import { toolNext, toolSubmit } from './taskmanager-claims.mjs';

// ---------- tools ----------

const NEXT_SCHEMA = {
  type: 'object',
  properties: {
    task_id: { type: 'string' },
    // A size-S task hands the request to the development harness and reports task_state:
    // 'harness' - see the removed `delegate` field below.
    state: { type: 'string', enum: ['running', 'blocked', 'complete', 'partial'] },
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
    task_state: { type: 'string', enum: ['harness'], description: 'present, and always "harness", on the reply that sizes a task S (tm_submit of `size`, or tm_open/tm_run with size "S"): the task handed the request to one headless development-harness driver and this reply already carries tm_next\'s own fields (harness, driver, state) for it. Absent for every other node and for a size-L task.' },
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
        max_live_drivers: { type: 'integer', description: 'default 4, also settable in .claude/team.json. A machine-wide cap on live teams-spawned `claude -p` drivers and judges across every task under the tasks root. At or over it a spawn site spawns nothing: the node stays ready, one waiting_cap ledger event is written, and the daemon re-checks within 15 s (no timeout).' },
        interactive: { type: 'boolean', description: 'default false, also settable in .claude/team.json. Passed to every child run. When a planning subgoal\'s investigate stage comes back with a decision it could not settle from any source but CAN name candidates for, true opens an `ask` card between investigate and draft and parks that run in waiting_human until a person picks - tm_inbox lists it (with its questions and options), tm_submit({key, payload:{decisions}}) answers it. false decides by default and records the questions on the run instead, so the report can show what nobody was asked.' },
        ask_timeout: { type: ['integer', 'null'], description: 'default null (wait forever), also settable in .claude/team.json. Milliseconds an interactive `ask` card may wait on a person; once it expires the engine answers it itself with each question\'s `default` (else its first, recommended option), recorded `by: "timeout"` and listed in tm_inbox\'s `decided`. Checked by the task daemon (and on any tm_* call for this task), so expiry lands within ~15s of the deadline.' },
        goal_threshold: { type: 'integer', description: 'default 90: the manager\'s own goal gate must report match_pct at or above this to accept, and it is passed through to every child run as its own goal_threshold. A gate that says accept with 40% match is reporting a partial result as a pass. 0 accepts on the verdict alone.' },
        goal_judges: { type: 'integer', description: 'default 1: independent judges on EVERY child run\'s own goal gate (each package\'s dispatch, and the one run a size-S task opens). >1 opens that many sibling gate nodes per round, routed to different identities where possible, and accepts only if every judge accepts at or above goal_threshold - the same mechanism team_open documents (default 2 there). The default stays 1 here, matching every run this manager has ever opened, so an existing project sees no change in judge count or cost unless it asks for more. This is the child run\'s own gate, not the manager\'s own top-level gate:goal, which is a separate, single-judge mechanism unaffected by this option.' },
        retry_policy: { type: 'string', enum: ['continue', 'rollback'], description: 'default "continue", also settable in .claude/team.json. What a retried attempt does with the worktree the failed one left: "continue" (default, today\'s only behavior) builds the next attempt on top of it. "rollback" resets the worktree first - a subgoal\'s own implement/draft to the checkpoint recorded before ITS first attempt touched it (single-subgoal child runs only; a shared worktree with a sibling subgoal still in flight cannot be reset for one of them, so it falls back to continue and says why), a package\'s own retry (tm_retry/retryPackage) to its last ACCEPTED commit, or the worktree\'s base commit if none of its attempts ever passed - then re-runs with the failed gate\'s gaps as feedback either way. _repo/docs/plans/2026-09-23-teams-reducer-human-rollback.md §5 measured two real runs before defaulting to continue: both showed a retried implement CONVERGING on gate feedback across attempts rather than repeating the same mistake, so there is no evidence yet that discarding an attempt\'s work helps more than it loses.' },
        budget_usd: { type: ['number', 'null'], description: 'default null (unlimited), also settable in .claude/team.json. Spend is the task\'s full cost (collectTaskCosts, taskSpend): every driver\'s own stream log under this task (drivers/*.stream.jsonl result events\' total_cost_usd) PLUS every child graph run\'s own node adapter sessions (each worktree\'s .teams_output/broker/<run_id>/<node>/<attempt>/events.jsonl), summed each daemon tick. At 80% of this a warning is recorded once (tm_status shows it); at 100% no NEW package is dispatched - a package already running finishes - and once nothing is left running, a fresh integrate opens over just what accepted, naming the rest "not done" in the report rather than dropping them silently. Whichever of budget_usd/timebox_minutes is closer to its own limit decides; either alone is a real stop. The stop never kills a running dispatch, and a stopped task still owes its goal gate and report - both continue to spend past the 100% mark. This is by design (a truncated report with no gate/retro is worse than a few dollars over), but it is real: budget a reserve above your real target for the in-flight package finishing plus goal-gate+report, and read the harvested summary\'s budget.post_stop_usd after the fact to see exactly how much that reserve needed to be.' },
        timebox_minutes: { type: ['number', 'null'], description: 'default null (unlimited), also settable in .claude/team.json. Minutes since tm_open, the same stop condition budget_usd is, on the same clock - see its own description for exactly what 80% and 100% do.' },
        budget_grace_usd: { type: ['number', 'null'], description: 'default null (10% of budget_usd when budget_usd is set, else no dollar grace), also settable in .claude/team.json. At 100% a dispatch already running whose accept the closing path still needs (a package, PLAN, or a size-S run) is let finish, but not forever: past this much MORE spend since the stop (or budget_grace_minutes, whichever first) it is killed too (killDriver, the same stop retryPackage/serviceStalledDriver already use) and its accept is skipped like a package that never ran. A phase-Team pass (QA, AUDIT) gets none of this grace - it is killed the moment the box trips, since the goal-gate rewire already never reads its accept once stopped.' },
        budget_grace_minutes: { type: 'integer', description: 'default 5, also settable in .claude/team.json. See budget_grace_usd - whichever of the two limits a still-running, still-needed dispatch reaches first stops it.' },
        requests: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { request: { type: 'string' }, acceptance: { type: 'array', items: { type: 'string' } } }, required: ['request'] }] }, description: 'A backlog instead of one request: several EPIC-level items, priority = array order (first is highest). An item may be {request, acceptance: ["..."]} to declare that item\'s own acceptance criteria - when every item declares them (or shared_acceptance is given), roles.planning "auto" runs the light PLAN chain (investigate -> template-fill -> gate) instead of the full one. shape treats each as its own story set; with budget_usd/timebox_minutes in play, the lowest-priority items still unshaped or undispatched when the stop trips are exactly what the report names "Next backlog". Mutually exclusive with `request` - send one or the other, never both.' },
        shared_acceptance: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria that apply to EVERY backlog item (or to the single request) - the structured form of an "Acceptance for every item:" block. Written into the request text and, when non-empty, makes roles.planning "auto" pick the light PLAN chain (_repo/docs/plans/2026-09-28-teams-light-plan.md). roles.planning itself (team.json or a roles argument) takes true (full chain), "light" (force light) or "auto" (default: light when acceptance is declared - structured fields, or a numbered backlog with an "Acceptance:" heading and bullets - else full). false is refused with a note: planning always runs, one card per feature area, and every task gets a PRD and user stories.' },
        context_from: { type: 'string', description: 'A prior task_id (or its ticket key). Its retro.json - the Retrospective and Next backlog a finished task\'s report stage writes - is read and folded into this task\'s own context: what failed and why, retries, defects left, and any unaccepted packages or unresolved questions the prior task ran out of budget/timebox to reach. The prior task\'s own Next backlog is NOT auto-added to `requests` - naming it here is a decision this task\'s own request should still make in its own words. tm_open returns carryover_candidates (backlog items and user stories the prior Sprint did not ship) for the person to choose from.' },
        initiative: { type: 'string', description: 'default null, also settable in .claude/team.json. An optional label ABOVE this EPIC - several EPICs toward one outcome (a slug-normalized "I-<slug>" key: lowercased, non-alphanumeric runs collapsed to one "-"). Display/grouping only: tm_board groups every EPIC by it once any task has one, and tm_ticket("I-<slug>") lists that group\'s EPICs with state and cost. Never read by scheduling or execution, and never nests a task inside another - EPICs under the same initiative are still independent tasks.' },
        decisions: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, chose: { type: 'string' }, because: { type: 'string' } }, required: ['question', 'chose'] }, description: 'What the entry skill settled with the user in its brainstorm before calling tm_open: [{question, chose, because?}]. Written as the first entries of task.decisions (source "brainstorm", decided_in "session"); PLAN and every package read them as settled rules, and an ask about the same question is never opened again. Passing it (even []) skips the engine\'s own brainstorm node.' },
        brainstorm: { type: 'boolean', description: 'default true, also settable in .claude/team.json. With no decisions[], the engine holds the brainstorm itself: a `brainstorm` node after size, ahead of PLAN/shape, restates intent/scope/approach/assumptions from the request and asks the requester one card of questions when interactive (defaults otherwise). Its result becomes task.decisions (source "self-brainstorm", or "ask" where a person chose) and the report leads with what the engine decided on its own. false skips the node.' },
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
        requests: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { request: { type: 'string' }, acceptance: { type: 'array', items: { type: 'string' } } }, required: ['request'] }] }, description: 'Same meaning as tm_open({requests}) - mutually exclusive with `request`.' },
        shared_acceptance: { type: 'array', items: { type: 'string' }, description: 'Same meaning as tm_open({shared_acceptance}).' },
        context_from: { type: 'string', description: 'Same meaning as tm_open({context_from}).' },
        initiative: { type: 'string', description: 'Same meaning as tm_open({initiative}).' },
        decisions: { type: 'array', items: { type: 'object' }, description: 'Same meaning as tm_open({decisions}).' },
        brainstorm: { type: 'boolean', description: 'Same meaning as tm_open({brainstorm}).' },
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
    description: 'Open a fresh attempt. With package_id: a new dispatch in the same worktree, carrying the rejection forward into the child request. With repackage: [ids] after an integration conflict, reshape with those packages told to become one or to depend on each other. With repair: true after an integrate came back verified=false with no conflicts: a repair package whose worktree IS the integration tree, for a seam no package can reproduce alone. With reset_capacity: true, clears every child (or just package_id\'s, or the size-S run) parked waiting_capacity after a usage-limit death and respawns its driver - this spends no restart. A blocked size-S task whose run stopped on a failed report node is retried with this call alone: only that report is re-pended (with its failure as feedback; avoid_executors / different_vendor route it away from the executor that failed it) and a fresh driver continues the same run. Without any of them: reshape (shape + critique) and discard the package graph. When the budget is gone the failure is settled and the report is released over the unreachable set.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, package_id: { type: 'string' }, repackage: { type: 'array', items: { type: 'string' }, description: 'the conflicting_packages an integrate or dispatch failure named' }, repair: { type: 'boolean', description: 'the last integrate failed with verified=false and no conflicts: open a package that runs IN the integration worktree, where every package branch is merged and the defect is visible. package_id: "integration" is an alias for it.' }, reset_capacity: { type: 'boolean', description: 'a driver is parked on waiting_capacity after a usage-limit death (see tm_next\'s children[].waiting_capacity, or the top-level one for a size-S task). Clears it and respawns a driver on the same run_id, spending no restart. Combine with package_id to target just that package.' }, avoid_executors: { type: 'array', items: { type: 'string' }, description: 'a blocked size-S task whose run stopped on a failed report node (tm_next names it): executors (vendors) the report rerun is routed away from - tried last, never dropped. A bare tm_retry({task_id}) already retries that report.' }, different_vendor: { type: 'boolean', description: 'same blocked size-S failed-report case: avoid the executor that ran the failed report (shorthand for naming it in avoid_executors).' } }, required: ['task_id'] },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' }, retried: { type: 'boolean' }, attempt: { type: 'number' }, resumed: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' }, unreachable: { type: 'array', items: { type: 'string' } } }, required: ['task_id', 'retried'] },
  },
  {
    name: 'tm_file',
    description: 'File one or more develop STORYs directly against a task that has already reached goal level (a gate:goal node exists) - the same path a QA-found defect takes (§5b: a fresh package per story, its own dispatch/accept chain, a fresh integrate opened behind it, gate:goal - and a fresh QA round if roles.qa is on - rerouted there), but reporter: "user" / origin: "tm_file" on the board instead of reporter: "qa" / origin: "qa". Never checked against qa_rounds: a user filing a STORY is not a QA round, so this always proceeds regardless of how many QA rounds this task has already run.',
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
    description: 'Ticket-shaped board (§4/§8 of the design doc). Omit task_id for every EPIC this manager knows (key, state, phase) - grouped by `initiative` (a `groups: [{initiative, key: "I-<slug>", epics}]` array, an initiative-less `null` group included) whenever at least one task has one set; with none set anywhere, exactly the flat `{epics}` list this always returned. With task_id: the EPIC header plus its STORY kanban - one row per package, its state derived from task.json the same way tm_status is, never a second source of truth - and a doc_path to the human-readable INDEX.md (which may not exist on disk yet; see tm_docs). task_id accepts a full run id or the ticket key E-xxxxxxxx (the same 8-hex-prefix resolution tm_ticket uses). Read-only.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } } },
    outputSchema: { type: 'object' },
  },
  {
    name: 'tm_ticket',
    description: 'One ticket by key: I-<slug> for an initiative (every EPIC under it, with state and cost - see tm_open({initiative})), E-xxxxxxxx for the EPIC, E-xxxxxxxx/Pn for a STORY. State, worktree/branch, task progress (x/y) and the last accept verdict, plus a doc_path (EPIC/STORY only) and reporter/origin/link (STORY only - reporter is the issuing team, origin the stage that filed it, link only set for an upstream fix). Read-only; a doc_path is always returned for an EPIC/STORY, even before tm_docs has written anything there.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    outputSchema: { type: 'object' },
  },
  {
    name: 'tm_log',
    description: 'Follow one ticket\'s own log as readable lines, newest last (design §8). key E-xxxxxxxx/Pn: the STORY\'s latest dispatch driver stream (child.driver.log - drivers/<node>.stream.jsonl; E-xxxxxxxx/S for a size-S task\'s single run), one line per stream event (init, assistant text, -> tool call, <- tool result, result with turns/cost). key E-xxxxxxxx: the task ledger (the same records tm_events returns as JSON), one "HH:MM:SS event k=v" line each. Only the last `tail` lines are read (default 50, max 500) - the file is read from its end, never whole. since: pass the previous reply\'s `cursor` (a byte offset) to get only lines appended after it. raw:true returns the exact log lines instead. Read-only; safe from any session.',
    inputSchema: { type: 'object', properties: {
      key: { type: 'string', description: 'E-xxxxxxxx (EPIC ledger) or E-xxxxxxxx/Pn (STORY driver log)' },
      tail: { type: 'integer', description: 'default 50, max 500' },
      since: { type: 'integer', description: 'byte cursor from a previous reply' },
      raw: { type: 'boolean', description: 'default false' },
    }, required: ['key'] },
    outputSchema: { type: 'object', properties: {
      key: { type: 'string' }, task_id: { type: 'string' }, kind: { type: 'string', enum: ['EPIC', 'STORY'] }, source: { type: 'string', enum: ['ledger', 'driver'] },
      node_id: { type: ['string', 'null'] }, log: { type: ['string', 'null'] }, exists: { type: 'boolean' }, alive: { type: ['boolean', 'null'] },
      count: { type: 'integer' }, truncated: { type: 'boolean' }, cursor: { type: 'integer' }, lines: { type: 'array', items: { type: 'string' } },
    }, required: ['key', 'kind', 'source', 'lines', 'cursor'] },
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
  {
    name: 'tm_clean',
    description: 'EPIC teardown (§14 C-11): removes the git worktrees and local branches a task\'s packages created, once the task is done. With task_id: refused (throws) while the task is still running - a live daemon or dispatch means there is nothing settled yet to clean, check tm_status/tm_wait first. dry_run defaults false here - naming one task is already the decision to act. Without task_id: sweeps every task under the tasks root, silently skipping any still running rather than refusing the whole call; dry_run defaults true (list what each terminal task would lose, change nothing) since no single task was chosen. Never touches the integration worktree/branch - teams never merges it into the project\'s own branch, so it is the only place a task\'s accepted work survives once package branches are gone; a repair/qa/audit package\'s "worktree" already IS that tree and is filtered out the same way. A package branch is deleted only once every commit on it is reachable from an integration branch or the project\'s own HEAD (git merge-base --is-ancestor, actually checked, never assumed) - one that is not is reported under kept_branches with why, and only its worktree directory is removed (the branch ref alone still holds every commit). task.json, docs and driver logs are left alone; a `clean` event is appended to the task\'s own ledger. Idempotent: a worktree or branch already gone from an earlier call reads as already_clean.',
    inputSchema: { type: 'object', properties: {
      task_id: { type: 'string' },
      dry_run: { type: 'boolean', description: 'default false with task_id (an explicit target), true without one (a sweep lists candidates by default). true reports removed_worktrees/removed_branches as a plan and touches no git state.' },
    } },
    outputSchema: { type: 'object', properties: {
      task_id: { type: 'string' }, dry_run: { type: 'boolean' },
      kept: { type: 'array', items: { type: 'object', properties: { node_id: { type: 'string' }, cwd: { type: 'string' }, branch: { type: ['string', 'null'] } } } },
      removed_worktrees: { type: 'array', items: { type: 'object', properties: { package_id: { type: 'string' }, cwd: { type: 'string' }, branch: { type: 'string' } } } },
      removed_branches: { type: 'array', items: { type: 'object', properties: { package_id: { type: 'string' }, branch: { type: 'string' }, reachable_via: { type: 'string' } } } },
      kept_branches: { type: 'array', items: { type: 'object', properties: { package_id: { type: 'string' }, branch: { type: 'string' }, reason: { type: 'string' } } } },
      already_clean: { type: 'array', items: { type: 'object' } },
      tasks: { type: 'array', items: { type: 'object' }, description: 'present only when task_id is omitted - one entry per task under the tasks root' },
    } },
  },
  {
    name: 'tm_cancel',
    description: 'Stop a running, blocked or partial task for good. In order: saves a cancel marker on task.json in the same commit that clears spawning reservations and in-flight open claims; kills the task\'s daemon, drivers and judges and confirms every pid dead before anything is appended; retires the task\'s own child graph runs; writes a report stub at <docs_dir>/E-<task8>/80-report.md; appends daemon_done {state:"cancelled"} and then `clean` as the last ledger event (which releases the repo push hold). The task then reads `cancelled` (terminal); tm_status, tm_clean, tm_wait and tm_next spawn nothing on it, and tm_retry and tm_submit refuse it. Worktrees and branches are left for a later tm_clean. On a complete, cancelled or already-cleaned task it is a no-op that reports the current state.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    outputSchema: { type: 'object', properties: {
      task_id: { type: 'string' }, state: { type: 'string' }, noop: { type: 'boolean' }, reason: { type: 'string' }, was: { type: 'string' },
      killed: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, pid: { type: 'integer' } } } },
      retired_runs: { type: 'integer' }, report: { type: 'string' }, note: { type: 'string' },
    } },
  },
  {
    name: 'tm_ask',
    description: 'For a running STORY\'s own driver: ask the TeamLeader a question the briefing and the plan do not settle. Records `asked` on the task\'s ledger and parks the driver - end your turn right after the call; you are resumed, at no cost while you wait, with the answer in your prompt. A fresh answer node reads the plan and the wiki and either answers, or forwards the question to the person as an ask card (tm_inbox) that tm_submit answers. There is no timeout, no cap on questions and no de-dupe. Refused for an empty question, a key that is not a STORY of this task, or a STORY that is not running.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        key: { type: 'string', description: 'your own STORY key (E-xxxxxxxx/Pn), as your prompt gives it' },
        question: { type: 'string', description: 'the whole question, in your own words' },
      },
      required: ['task_id', 'key', 'question'],
    },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' }, key: { type: 'string' }, ask_id: { type: 'string' }, state: { type: 'string' }, next: { type: 'string' } }, required: ['task_id', 'key', 'ask_id', 'state'] },
  },
];

// board.jsonl - ticket TRANSITIONS only, append-only, never read as ground truth. tickets.mjs's
// pure functions over task.json are the ground truth; this is the JIRA-style history a human
// reads (§4, §7b). Written by diffing a before/after snapshot around the tools that can actually
// move a ticket - never by instrumenting taskmanager.mjs's dozen individual mutation sites one at
// a time. tm_file joined this set in v0.12.1: filing a STORY moves its ticket from nonexistent to
// BACKLOG/READY exactly like tm_retry opening a repair package does.
const BOARD_TOOLS = new Set(['tm_open', 'tm_run', 'tm_next', 'tm_submit', 'tm_retry', 'tm_file']);

// ---------- JSON-RPC / MCP plumbing ----------

function dispatch(name, a, signal) {
  switch (name) {
    case 'tm_open': return toolOpen(a);
    case 'tm_run': return toolRun(a);
    case 'tm_next': return toolNext(a);
    case 'tm_wait': return toolWait(a, signal);
    case 'tm_submit': return toolSubmit(a);
    case 'tm_retry': return toolRetry(a);
    case 'tm_file': return toolFile(a);
    case 'tm_status': return toolStatus(a);
    case 'tm_events': return toolEvents(a);
    case 'tm_board': return toolBoard(a);
    case 'tm_ticket': return toolTicket(a);
    case 'tm_log': return toolLog(a);
    case 'tm_assign': return toolAssign(a);
    case 'tm_inbox': return toolInbox(a);
    case 'tm_docs': return toolDocs(a);
    case 'tm_clean': return toolClean(a);
    case 'tm_cancel': return toolCancel(a);
    case 'tm_ask': return toolAsk(a);
    default: throw new Error('unknown tool: ' + name);
  }
}

// async because dispatch('tm_open'|'tm_run', ...) now returns a promise (openTaskAndMaybePin
// awaits ensureViewer) - every other tool still resolves synchronously, `await` just passes
// those straight through.
//
// Exported for teams/scripts/run.mjs (§4-C / §8 step 1 of _repo/docs/plans/
// 2026-09-21-teams-server-owns-the-loop.md): the headless CLI imports THIS, the exact function
// the JSON-RPC surface below calls for tools/call, rather than re-implementing tm_run's
// open+spawn or tm_wait's poll loop a second time. Same reuse daemon.mjs already relies on for
// advanceDispatches/finish/foldChild - one path, in-process, no stdio layer in between.
export async function callTool(name, args, ctx) {
  const a = args || {};
  // Re-raise a dead daemon before doing anything else, on every tool that already has a task to
  // raise one for. No gate here beyond that: any caller may read or mutate the task at any time -
  // there is no leader to defer to and no inbox to queue behind. store.mjs mutateTask is what
  // makes two writers (this call and the daemon's own loop) safe together: each reads task.json
  // fresh under the lock and writes it whole.
  // One transaction: two concurrent callers cannot both see a dead daemon and both reserve its
  // spawn; the spawn itself runs after the commit (task.daemon.spawning, reserveSpawn).
  if (a.task_id && name !== 'tm_open' && name !== 'tm_run' && name !== 'tm_cancel') {
    withTask(a, (task) => {
      // A cancelled task is left alone: no ask answered, no daemon raised.
      if (task.cancelled) return;
      // An expired ask is answered on the next look even when no daemon is left to notice it.
      expireAsks(task);
      serviceDaemon(task);
    });
  }
  // board.jsonl: taken as a before/after diff of the tools that can move a ticket.
  if (!BOARD_TOOLS.has(name)) return dispatch(name, a, ctx?.signal);
  const before = a.task_id ? ticketSnapshot(mustFindTask(a)) : {};
  const out = await dispatch(name, a, ctx?.signal);
  const taskId = (out && out.task_id) || a.task_id;
  if (taskId) {
    try { syncTickets(mustFindTask({ task_id: taskId }), before, a.node_id || name); } catch { /* best-effort, like record() */ }
    // A mutation may have just turned a blocked task running again (tm_retry, tm_file) or opened
    // a brand-new one (tm_open, tm_run): re-check right after, not only on the NEXT call in, so a
    // caller that never polls again still leaves the task with a live daemon behind it.
    try { withTask({ task_id: taskId }, serviceDaemon); } catch { /* best-effort */ }
  }
  return out;
}

export { TOOLS };
