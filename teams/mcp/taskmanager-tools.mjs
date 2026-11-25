// taskmanager-tools.mjs - the tool schema table, dispatch and callTool; split out of taskmanager.mjs (card 128 step 1), moved verbatim.
import { ticketSnapshot } from './tickets.mjs';
import { expireAsks, toolAsk } from './taskmanager-asks.mjs';
import { mustFindTask, withTask } from './taskmanager-stages.mjs';
import { serviceDaemon } from './taskmanager-drivers.mjs';
import { syncTickets, toolAssign, toolBoard, toolCancel, toolClean, toolDocs, toolEvents, toolFile, toolHold, toolInbox, toolLog, toolNextUnlessHeld, toolOpen, toolRetry, toolRun, toolStatus, toolTicket, toolWait } from './taskmanager-handlers.mjs';
import { toolSubmit } from './taskmanager-claims.mjs';
import { post, readMarked } from './bus.mjs';

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
    description: 'Open a task for a request that may be too large for one graph run. Spawns a daemon that drives the whole task (size, shape, critique, package dispatch, integrate, goal gate, report) under ~/.harness/tasks/<task_id>/. The caller never drives a node: watch with tm_status/tm_board/tm_events, or block briefly with tm_wait. Prefer tm_run unless you also want tm_next\'s node-by-node reply.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'One request. Beside `requests`, leave it out, or send requests[0] itself or a one-line title (at most 120 chars, kept as the task\'s title); anything else is refused.' }, cwd: { type: 'string', description: 'the project root: child worktrees branch from its HEAD, and a size-S run under s_driver "process" opens directly here' },
        context: { type: 'string' },
        name: { type: 'string', description: 'Optional short name for this EPIC, a few words in the request\'s language. Pass it only when the request\'s first clause does not read as a title (a chat sentence, not a card title). Stored once in task.json and shown beside the key; derived from the request when omitted.' },
        flow: { type: 'string', enum: ['auto', 'develop', 'document'] },
        vendor: { type: 'string' }, allocation: { type: 'string', enum: ['ordered', 'balanced'] },
        host_vendor: { type: 'string' }, host_model: { type: 'string' }, native_models: { type: 'array', items: { type: 'string' } },
        size: { type: 'string', enum: ['S', 'L'], description: 'Pin the size instead of measuring it: L when the user said in their own words that the request must be split into packages, S when they said one run must carry it. The size node is recorded as pinned.' },
        model: { type: 'string' }, policy: { type: 'object' }, candidates: { type: 'array', items: { type: 'string' } },
        models: { type: 'object', additionalProperties: { type: 'string' }, description: 'Per-stage model overrides.' },
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
        requests: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { request: { type: 'string' }, acceptance: { type: 'array', items: { type: 'string' } } }, required: ['request'] }] }, description: 'A backlog instead of one request: several EPIC-level items, priority = array order (first is highest). An item may be {request, acceptance: ["..."]} to declare that item\'s own acceptance criteria - when every item declares them (or shared_acceptance is given), roles.planning "auto" runs the light PLAN chain (investigate -> template-fill -> gate) instead of the full one. shape treats each as its own story set; with budget_usd/timebox_minutes in play, the lowest-priority items still unshaped or undispatched when the stop trips are exactly what the report names "Next backlog". `request` may stay beside it only as requests[0] itself or a one-line title of at most 120 chars; anything else is refused.' },
        shared_acceptance: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria that apply to EVERY backlog item (or to the single request) - the structured form of an "Acceptance for every item:" block. Written into the request text and, when non-empty, makes roles.planning "auto" pick the light PLAN chain (_repo/docs/plans/2026-09-28-teams-light-plan.md). roles.planning itself (team.json or a roles argument) takes true (full chain), "light" (force light) or "auto" (default: light when acceptance is declared - structured fields, or a numbered backlog with an "Acceptance:" heading and bullets - else full). false is refused with a note: planning always runs, one card per feature area, and every task gets a PRD and user stories.' },
        context_from: { type: 'string', description: 'A prior task_id (or its ticket key). Its retro.json - the Retrospective and Next backlog a finished task\'s report stage writes - is read and folded into this task\'s own context: what failed and why, retries, defects left, and any unaccepted packages or unresolved questions the prior task ran out of budget/timebox to reach. The prior task\'s own Next backlog is NOT auto-added to `requests` - naming it here is a decision this task\'s own request should still make in its own words. tm_open returns carryover_candidates (backlog items and user stories the prior Sprint did not ship) for the person to choose from.' },
        initiative: { type: 'string', description: 'default null, also settable in .claude/team.json. An optional label ABOVE this EPIC - several EPICs toward one outcome (a slug-normalized "I-<slug>" key: lowercased, non-alphanumeric runs collapsed to one "-"). Display/grouping only: tm_board groups every EPIC by it once any task has one, and tm_ticket("I-<slug>") lists that group\'s EPICs with state and cost. Never read by scheduling or execution, and never nests a task inside another - EPICs under the same initiative are still independent tasks.' },
        decisions: { type: 'array', items: { type: 'object', properties: { question: { type: 'string' }, chose: { type: 'string' }, because: { type: 'string' } }, required: ['question', 'chose'] }, description: 'What the entry skill settled with the user in its brainstorm before calling tm_open: [{question, chose, because?}]. Written as the first entries of task.decisions (source "brainstorm", decided_in "session"); PLAN and every package read them as settled rules, and an ask about the same question is never opened again. Passing it (even []) skips the engine\'s own brainstorm node.' },
        brainstorm: { type: 'boolean', description: 'default true, also settable in .claude/team.json. With no decisions[], the engine holds the brainstorm itself: a `brainstorm` node after size, ahead of PLAN/shape, restates intent/scope/approach/assumptions from the request and asks the requester one card of questions when interactive (defaults otherwise). Its result becomes task.decisions (source "self-brainstorm", or "ask" where a person chose) and the report leads with what the engine decided on its own. false skips the node.' },
      },
      required: ['cwd'],
    },
    outputSchema: NEXT_SCHEMA,
  },
  {
    name: 'tm_run',
    description: 'Open a task exactly like tm_open and spawn the same daemon, but never self-drive and never return a node table: just {task_id, run_id, docs_dir}. For a caller that hands off a whole request and walks away; follow up with tm_wait, or tm_status/tm_board any time.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'Same meaning as tm_open({request}).' }, cwd: { type: 'string' }, context: { type: 'string' },
        name: { type: 'string', description: 'Same meaning as tm_open({name}): a few words in the request\'s language, passed only when the request\'s first clause does not read as a title. Stored once in task.json and shown beside the key; derived from the request when omitted.' },
        flow: { type: 'string', enum: ['auto', 'develop', 'document'] },
        vendor: { type: 'string' }, allocation: { type: 'string', enum: ['ordered', 'balanced'] },
        host_vendor: { type: 'string' }, host_model: { type: 'string' }, native_models: { type: 'array', items: { type: 'string' } },
        size: { type: 'string', enum: ['S', 'L'] },
        model: { type: 'string' }, policy: { type: 'object' }, candidates: { type: 'array', items: { type: 'string' } },
        models: { type: 'object', additionalProperties: { type: 'string' }, description: 'Per-stage model overrides.' },
        skills: { description: 'Same meaning as tm_open({skills}).' },
        sandbox: { type: 'string' }, max_retries: { type: 'number' },
        isolated: { type: 'boolean' }, mixed: { type: 'boolean' },
        driver_restarts: { type: 'integer' }, goal_threshold: { type: 'integer' }, goal_judges: { type: 'integer' },
        stall_minutes: { type: 'integer' }, restart_period_minutes: { type: 'integer' },
        budget_usd: { type: ['number', 'null'], description: 'Same meaning as tm_open({budget_usd}).' },
        timebox_minutes: { type: ['number', 'null'], description: 'Same meaning as tm_open({timebox_minutes}).' },
        requests: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { request: { type: 'string' }, acceptance: { type: 'array', items: { type: 'string' } } }, required: ['request'] }] }, description: 'Same meaning as tm_open({requests}).' },
        shared_acceptance: { type: 'array', items: { type: 'string' }, description: 'Same meaning as tm_open({shared_acceptance}).' },
        context_from: { type: 'string', description: 'Same meaning as tm_open({context_from}).' },
        initiative: { type: 'string', description: 'Same meaning as tm_open({initiative}).' },
        decisions: { type: 'array', items: { type: 'object' }, description: 'Same meaning as tm_open({decisions}).' },
        brainstorm: { type: 'boolean', description: 'Same meaning as tm_open({brainstorm}).' },
      },
      required: ['cwd'],
    },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' }, run_id: { type: 'string' }, docs_dir: { type: 'string' }, state: { type: 'string' } }, required: ['task_id', 'run_id', 'docs_dir'] },
  },
  {
    name: 'tm_next',
    description: 'Which manager nodes are ready (each with a briefing_path) plus every running child as {cwd, run_id, driver}. Executes a ready dispatch node here (worktree, child run, headless driver) and services dead drivers: just poll again. Never drive a child yourself; tm_submit the dispatch node once its child stops. A daemon-driven task is left to the daemon.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    outputSchema: NEXT_SCHEMA,
  },
  {
    name: 'tm_wait',
    description: 'Bounded long-poll on a daemon-driven task: blocks up to max_ms and returns the node transitions (finished nodes, newest last) since `cursor`, or an empty list on timeout - never the full state. Pass the previous reply\'s `cursor` back to continue (omit or 0 starts from the beginning). Call again while `state` is "running"; stop when it is "complete" or "blocked".',
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
    description: 'Record a manager node: pass the payload the fresh agent returned; a dispatch node takes none, the manager folds the child run\'s verdict. Refused while the child runs with a live driver, or is waiting_capacity (tm_retry({reset_capacity:true})). Pass `key` (a TASK key from tm_inbox) instead of node_id to answer a waiting_human card. Idempotent per {task_id, node_id, attempt}.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, node_id: { type: 'string' }, key: { type: 'string', description: 'a TASK key (E-xxxxxxxx/Pn/subgoalId) naming a waiting_human card, in place of node_id' }, attempt: { type: 'integer', description: 'this node\'s attempt number, for the idempotency check above. Optional - node_id already disambiguates attempts for every retryable stage.' }, payload: { type: 'object' } },
      required: ['task_id'],
    },
    outputSchema: VERDICT_SCHEMA,
  },
  {
    name: 'tm_retry',
    description: 'Open a fresh attempt. package_id: a new dispatch in the same worktree, carrying the rejection forward. repackage: [ids] after an integration conflict. repair: true after integrate came back verified=false with no conflicts. reset_capacity: true respawns drivers parked waiting_capacity after a usage-limit death. With none, continues from the node that stopped the graph or resumes a dead daemon.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, package_id: { type: 'string' }, repackage: { type: 'array', items: { type: 'string' }, description: 'the conflicting_packages an integrate or dispatch failure named' }, repair: { type: 'boolean', description: 'the last integrate failed with verified=false and no conflicts: open a package that runs IN the integration worktree, where every package branch is merged and the defect is visible. package_id: "integration" is an alias for it.' }, reset_capacity: { type: 'boolean', description: 'a driver is parked on waiting_capacity after a usage-limit death (see tm_next\'s children[].waiting_capacity, or the top-level one for a size-S task). Clears it and respawns a driver on the same run_id, spending no restart. Combine with package_id to target just that package.' }, avoid_executors: { type: 'array', items: { type: 'string' }, description: 'a blocked size-S task whose run stopped on a failed report node (tm_next names it): executors (vendors) the report rerun is routed away from - tried last, never dropped. A bare tm_retry({task_id}) already retries that report.' }, different_vendor: { type: 'boolean', description: 'same blocked size-S failed-report case: avoid the executor that ran the failed report (shorthand for naming it in avoid_executors).' } }, required: ['task_id'] },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' }, retried: { type: 'boolean' }, attempt: { type: 'number' }, resumed: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' }, unreachable: { type: 'array', items: { type: 'string' } } }, required: ['task_id', 'retried'] },
  },
  {
    name: 'tm_file',
    description: 'File one or more develop STORYs against a task that has already reached goal level (a gate:goal node exists): the path a QA-found defect takes (a fresh package per story, its own dispatch/accept chain, a fresh integrate and goal gate behind it), but filed with reporter "user" / origin "tm_file". Never counted against qa_rounds, so it always proceeds.',
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
    description: 'Compact task state: the EPIC `name` (a short natural-language name), counts, per-node state and verdict, child pointers. Omit task_id to list every task the manager knows. full:true returns the whole task file - large by design.',
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
    description: 'Ticket-shaped board. Omit task_id for every EPIC (key, name, state, phase), grouped by `initiative` as `groups: [{initiative, key: "I-<slug>", epics}]` when any task has one, else a flat `{epics}` list. With task_id: the EPIC header plus its STORY kanban (one row per package) and a doc_path to INDEX.md (may not exist yet; see tm_docs). task_id accepts a run id or the key E-xxxxxxxx. Read-only.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } } },
    outputSchema: { type: 'object' },
  },
  {
    name: 'tm_ticket',
    description: 'One ticket by key: I-<slug> for an initiative (every EPIC under it, with state and cost), E-xxxxxxxx for an EPIC (with its `name`), E-xxxxxxxx/Pn for a STORY. Returns state, worktree/branch, task progress (x/y) and the last accept verdict, plus doc_path (EPIC/STORY) and reporter/origin/link (STORY). Read-only.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    outputSchema: { type: 'object' },
  },
  {
    name: 'tm_log',
    description: 'Follow one ticket\'s log as readable lines, newest last. key E-xxxxxxxx/Pn: the STORY\'s latest driver stream, one line per event (E-xxxxxxxx/S for a size-S task\'s single run). key E-xxxxxxxx: the task ledger (as tm_events). Reads only the last `tail` lines (default 50, max 500). Pass the previous reply\'s `cursor` as `since` for only newer lines; raw:true returns exact lines. Read-only.',
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
    description: 'Pin a card to a human, or release it back to auto. `key` is a STORY (E-xxxxxxxx/Pn, every subgoal in it) or TASK (E-xxxxxxxx/Pn/subgoalId) key; a TASK key needs its child run to exist. `to: "human"` (optionally `who`) pins the AUTHOR stage only (implement/draft/cases), never a judging stage, and parks it in waiting_human. `to: "auto"` releases it back to pending.',
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
    description: 'Two sections. `cards` is every waiting_human card across every task (or one, with task_id): TASK ticket key, title, what is asked (acceptance criteria, briefing_path), assignee and since when. Complete one with tm_submit({task_id, key, payload}). `decided` is every card a MODEL tried to pin that a non-interactive run sent to an AI instead; object with tm_assign. Read-only.',
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
    description: '(Re)render the phase markdown under <docs_dir>/E-<task8>/ from task.json (INDEX, request, shape, critique, one page per STORY, integrate, goal gate, report), whichever have data. rebuild:true DELETES THE ENTIRE EPIC DOCS DIRECTORY FIRST, then writes every file fresh; by default files are overwritten and a stale one from a dropped package survives. The md is a view; the engine never reads it back.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' }, rebuild: { type: 'boolean', description: 'default false. true deletes <docs_dir>/E-<task8>/ recursively before re-rendering - destructive, use to clear stale files left by a dropped package.' } }, required: ['task_id'] },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' }, rebuild: { type: 'boolean' }, written: { type: 'array', items: { type: 'string' } } } },
  },
  {
    name: 'tm_clean',
    description: 'EPIC teardown: removes the worktrees and local branches a finished task\'s packages created. With task_id: refused while the task runs (tm_wait first, or wait: true); dry_run defaults false. Without task_id: sweeps every terminal task; dry_run defaults true. Never touches the integration worktree/branch; a package branch is deleted only once merged into it or HEAD, else listed in kept_branches.',
    inputSchema: { type: 'object', properties: {
      task_id: { type: 'string' },
      wait: { type: 'boolean', description: 'default false. true with task_id waits (bounded by max_ms, abortable, like tm_wait) for a terminal state, then cleans; ignored by a sweep.' },
      max_ms: { type: 'number', description: 'wait budget in ms, default 60000, capped at 300000. Only read with wait: true.' },
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
    description: 'Stop a running, blocked or partial task for good: marks it cancelled, kills its daemon, drivers and judges (confirming every pid dead), retires its child runs, writes a report stub (80-report.md) and appends daemon_done then `clean`. The task reads `cancelled` (terminal); tm_retry and tm_submit refuse it. Worktrees and branches stay for tm_clean. A no-op on a finished task.',
    inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
    outputSchema: { type: 'object', properties: {
      task_id: { type: 'string' }, state: { type: 'string' }, noop: { type: 'boolean' }, reason: { type: 'string' }, was: { type: 'string' },
      killed: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, pid: { type: 'integer' } } } },
      retired_runs: { type: 'integer' }, report: { type: 'string' }, note: { type: 'string' },
    } },
  },
  {
    name: 'tm_ask',
    description: 'For a running STORY\'s own driver: ask the TeamLeader a question the briefing and the plan do not settle. It parks the driver - end your turn right after the call; you are resumed at no cost with the answer in your prompt. The TeamLeader answers from the plan and wiki, or forwards to the person. Refused for an empty question, a key that is not a STORY of this task, or a STORY that is not running.',
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
  {
    name: 'tm_hold',
    description: 'Hold or resume a task on purpose. action `hold` (reason required) records task.hold and starts no driver until `resume`; a driver mid-turn finishes. `resume` lifts it and raises the daemon. Refused for a held, done, cleaned or cancelled task (hold) and for an unheld task (resume).',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        action: { type: 'string', enum: ['hold', 'resume'] },
        reason: { type: 'string', description: 'why the task is held (required for hold)' },
      },
      required: ['task_id', 'action'],
    },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' }, held: { type: 'boolean' }, hold: { type: 'object' } }, required: ['task_id', 'held'] },
  },
  {
    name: 'tm_post',
    description: 'Post one message on the task\'s bus. `from` is your own STORY key (E-xxxxxxxx/Pn), never `teamleader` or `person`. `to` is a STORY key, `teamleader`, `person` or `all`. A STORY may post only to a sibling STORY or the teamleader: never the person (use tm_ask), `all`, itself or a finished STORY. Body 1-8192 chars. Refusals read `tm_post refused: <reason>`. Returns `ts` and topic.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        from: { type: 'string', description: 'your own STORY key (E-xxxxxxxx/Pn), or teamleader, or person' },
        to: { type: 'string', description: 'a STORY key, teamleader, person or all' },
        body: { type: 'string', description: 'the message, 1 to 8192 characters' },
        reply_to: { type: 'number', description: 'the ts of the message this answers, when it answers one' },
      },
      required: ['task_id', 'from', 'to', 'body'],
    },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' }, ts: { type: 'number' }, topic: { type: 'string' } }, required: ['task_id', 'ts', 'topic'] },
  },
  {
    name: 'tm_read',
    description: 'Read the task\'s bus as `key`: a STORY key sees messages to it, from it and to `all`; `teamleader` and `person` see every message (a driver may not read as those). Pass the previous reply\'s `cursor` (last ts seen; 0 or none starts at the beginning) for only newer ones. At most 50 per call, oldest first; `more: true` means call again with the returned cursor. Refused as `tm_read refused: <reason>`.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        key: { type: 'string', description: 'your own STORY key (E-xxxxxxxx/Pn), or teamleader, or person' },
        cursor: { type: 'number', description: 'the cursor of your previous tm_read; default 0' },
      },
      required: ['task_id', 'key'],
    },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' }, key: { type: 'string' }, messages: { type: 'array', items: { type: 'object', properties: { ts: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' }, topic: { type: 'string' }, body: { type: 'string' }, reply_to: { type: ['number', 'null'] } } } }, cursor: { type: 'number' }, more: { type: 'boolean' } }, required: ['task_id', 'key', 'messages', 'cursor', 'more'] },
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
    case 'tm_next': return toolNextUnlessHeld(a);
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
    case 'tm_clean': return toolClean(a, signal);
    case 'tm_cancel': return toolCancel(a);
    case 'tm_ask': return toolAsk(a);
    case 'tm_hold': return toolHold(a);
    case 'tm_post': return withTask(a, (task) => post(task, a, process.env));
    case 'tm_read': return withTask(a, (task) => ({ task_id: task.run_id, key: a.key, ...readMarked(task, { reader: a.key, cursor: a.cursor }) }));
    default: throw new Error('unknown tool: ' + name);
  }
}

// async because dispatch('tm_open'|'tm_run', ...) returns a promise (the open handlers are
// async) - every other tool still resolves synchronously, `await` just passes those straight
// through.
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
