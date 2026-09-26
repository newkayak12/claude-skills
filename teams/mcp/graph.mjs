// graph.mjs - the harness flow as a persisted node graph.
//
// The broker owns WHICH nodes exist, in what order, and who may execute each one.
// It does not own what happens inside a node - that is the model's job, whichever
// vendor gets assigned. Splitting it this way is the point: the flow stops being
// something each orchestrator re-improvises in prose and becomes state on disk that
// survives a restart and can be read by a hook.
//
// Runs live at <cwd>/.teams_output/broker/runs/<run_id>.json.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_MODELS } from './routing.mjs';
import { applyMerge, writeScopeFindings } from './reducers.mjs';

export const STAGES = [
  'plan',      // decompose the raw request
  'setgoal',   // turn the plan into a goal-spec
  'critique',  // adversarial pass over the goal-spec (judge != author)
  'implement', // per code subgoal
  'test',      // per code subgoal, verification-only
  'draft',     // per document subgoal
  'review',    // per document subgoal, reader's pass (reviewer != author)
  'gate',      // per subgoal, then once at goal level (judge != actor)
  'repair',    // run-level, opened when goal-gate consensus rejects the assembled result
  'report',    // synthesize from the ledger
];

// What kind of work a subgoal is decides which node chain it expands into. The engine
// below - edges, readiness, retries, settled failure - does not care what the stages are
// called; only this table and the contracts in prompts.mjs do. The chain's first node
// carries the subgoal's deps and `after`, each later node depends on the one before it,
// and the last node is the gate the goal gate collects.
//
//   subgoal   the code flow the stable engine has always run. implement mutates the
//             worktree and is cross-checked against git; test runs commands.
//   document  a written artifact. draft mutates the worktree too (it writes the file)
//             but the check on it is a reading, not a command: review is a reasoning
//             node, and its verdict - like test's - is `verified`. A document that
//             touched nothing is not contradicted by git; it is judged by its reviewer.
//
// `reasoning` names the chain stages that write nothing. Everything not listed there,
// and not in BASE_REASONING, is a mutating stage: routed to a writable sandbox, offered
// one at a time under isolation, and cross-checked against the worktree.
//
// `skills` is method, by the stage that does the work. It is named here rather than asked
// for in the spec because asking did not work: the first live runs came back with
// `skills: []` on every subgoal and no `skills` field at all on any package, while
// `persona` - asked for in the same breath - was filled in every time and filled well.
// The difference is that the flow hands setgoal a list of personas to choose from, and the
// skills contract handed it a shape (`["plugin:skill"]`) and no candidates. An agent that
// cannot see what is installed will not invent a name, and an empty array is the honest
// answer to an impossible question. A kind knows what its own stages are for, so the kind
// is where the list belongs - which is also how the generation this replaced did it, with
// skill names written into the prompts rather than chosen at runtime.
export const KINDS = {
  subgoal: {
    chain: ['implement', 'test', 'gate'],
    reasoning: [],
    skills: {
      implement: ['develop:clean-code'],
      test: ['develop:testing-workflow', 'completion:verification-before-completion'],
      gate: ['think:devils-advocate'],
    },
  },
  document: {
    chain: ['draft', 'review', 'gate'],
    reasoning: ['review'],
    skills: {
      draft: ['write:doc-coauthoring'],
      review: ['write:writer-verification'],
      gate: ['think:devils-advocate'],
    },
  },
  // planning and qa both mutate on every authoring stage, unlike document's review: revise
  // rewrites the PRD itself (a different identity from draft, with edit rights - not only a
  // judge, per the design doc), and execute is qa's test - it runs the case set and reports
  // defects, not a verdict on someone else's claim. Neither belongs in `reasoning`; only the
  // closing `gate` judges. (The design doc's own table listed revise as reasoning while also
  // describing it as having edit rights - a contradiction; this follows document's precedent
  // instead: the mutating stage is never reasoning.)
  planning: {
    // `investigate` leads because the two real planning runs (idol-pm-1/2, 2026-09-22) had no
    // stage that ever touched a source: draft wrote from the request alone, revise rewrote what
    // draft had written, gate scored it. Every other kind meets reality somewhere - subgoal's
    // test runs commands, qa's execute runs the case set - and planning met it nowhere, so a
    // domain's own rules (a presale's eligibility, a cancellation window, a per-person limit)
    // could only be invented or omitted. No amount of contract wording fixes a stage with zero
    // input; a stage that reads first does. Its second job is naming what no source could
    // answer, so draft carries those as open questions instead of inventing them.
    chain: ['investigate', 'draft', 'revise', 'gate'],
    reasoning: [],
    author: 'draft',
    skills: {
      // No PM plugin is named here: pm is unpublished, so 'pm:prd-development' could never
      // mount and left every planning draft with no method at all. The PRD method now lives
      // in prompts.mjs's PRD_CONTRACT, inside the draft contract itself.
      investigate: ['develop:domain-driven-design', 'cognition:assumption-extractor'],
      draft: ['write:doc-coauthoring'],
      revise: ['write:writer-verification', 'think:devils-advocate'],
      gate: ['think:devils-advocate'],
    },
  },
  qa: {
    chain: ['cases', 'execute', 'gate'],
    reasoning: [],
    skills: {
      cases: ['develop:test-master', 'develop:scenario-director'],
      execute: ['develop:scenario-actor', 'completion:verification-before-completion'],
      gate: ['think:devils-advocate'],
    },
  },
  // planning's own second pass over an EPIC, after integration: audit compares the PRD's
  // user_stories[] against what was actually built (and, when a QA report exists, against
  // it too) and gate judges completeness. Unlike planning's revise, audit has no edit
  // rights - that is stated in the audit stage's own Required-output contract
  // (prompts.mjs), not encoded here via `reasoning`, because this table follows the same
  // shape planning and qa already use: every non-final chain stage counts as mutating, and
  // only the closing gate judges. audit's own skill is think:devils-advocate, same as
  // gate - its character is judgment, not authorship, so there is no draft/revise-style
  // authoring skill to name. taskmanager.mjs's openAudit opens a child run of this kind once
  // integration (and QA, when it is on) has finished, whenever roles.planning is set.
  'planning-audit': {
    chain: ['audit', 'gate'],
    reasoning: [],
    skills: {
      audit: ['think:devils-advocate'],
      gate: ['think:devils-advocate'],
    },
  },
};

// The method a node inherits from its kind. A spec that names its own `skills` for the
// subgoal replaces the family for authoring stages - setgoal knows this particular piece
// of work, the kind only knows the shape of the work - but a judging stage keeps its own:
// a gate's method is the gate's, and handing it the author's was the bug that made a gate
// act as the implementer it was supposed to be checking.
export function kindSkills(kind, stage) {
  const table = (KINDS[kind] || KINDS[DEFAULT_KIND]).skills || {};
  return (table[stage] || []).slice();
}
export const DEFAULT_KIND = 'subgoal';

export function kindOf(sg) {
  return sg && sg.kind != null ? String(sg.kind) : DEFAULT_KIND;
}

// Stages whose work is reasoning rather than file mutation. They are still routed and
// still adjudicated, but a claimed file list is not what makes them true, so the
// worktree cross-check has nothing to contradict. The run-level stages are fixed; the
// per-subgoal ones come from the kind table so a new kind cannot forget to declare them.
// `reduce` is here because it reports and does not repair. The level above decides what to
// do about what it finds - that is the same rule the ticket model already runs on, where a
// TASK is a card a sub picks up and the level above it owns the outcome. A reduce that
// deleted an orphan on its own authority would be deciding at the level that observed,
// which is exactly the confusion the engine keeps out of its judging stages.
const BASE_REASONING = ['plan', 'setgoal', 'critique', 'gate', 'report', 'reduce', 'ask'];
export const REASONING_STAGES = new Set([
  ...BASE_REASONING,
  ...Object.values(KINDS).flatMap((k) => k.reasoning || []),
]);

// The field that carries a judging node's verdict. stage_ok on these nodes means only
// "the judging itself worked"; the verdict must be present and affirmative for the node
// to count as done. A stage absent here has no verdict beyond stage_ok.
export const VERDICT_FIELD = { gate: 'accept', critique: 'sound', test: 'verified', review: 'verified', execute: 'verified' };

// A flow is what the user-facing entry chose - or, under `auto`, what the plan node decided
// from the request. It sets the kind a subgoal gets when setgoal names none, and gives
// setgoal a persona set to draw from. With `mixed: false` it also forbids the other kinds,
// which is what a manual `teams:document` entry means by "this is a writing job".
export const FLOWS = {
  develop: {
    kind: 'subgoal',
    personas: ['implementer who owns the module being changed', 'test engineer who distrusts the implementation narrative', 'reviewer who has to maintain this code next year'],
  },
  document: {
    kind: 'document',
    personas: ['technical writer who has never seen this codebase', 'the reader the document is for - name their role', 'editor checking every claim against the source'],
  },
  // Flow name collides in spelling with the `plan` STAGE (the run's own decomposition node) -
  // different namespace, same word, because that is what the design doc names the entry skill.
  // A node id is never a flow name and vice versa, so nothing in the engine confuses them.
  plan: {
    kind: 'planning',
    personas: ['PO who owns value and scope', 'domain expert who owns terminology and rules', 'implementation lead reading for feasibility'],
  },
  qa: {
    kind: 'qa',
    personas: ['QA who represents the user', 'release manager weighing risk', 'someone deliberately trying malicious or malformed input'],
  },
  // The 기획 크로스 검수 (planning cross-review) pass: planning's own identity, run a
  // second time against the integrated result, so its persona list is planning's own -
  // verbatim, not a new set (a decision already made, not this file's to reopen).
  audit: {
    kind: 'planning-audit',
    personas: ['PO who owns value and scope', 'domain expert who owns terminology and rules', 'implementation lead reading for feasibility'],
  },
};
export const DEFAULT_FLOW = 'develop';

// The flow this run is actually in: fixed by the entry, or chosen by plan under `auto`.
export function flowOf(run) {
  const f = run.flow && run.flow !== 'auto' ? run.flow : run.flow_chosen;
  return FLOWS[f] ? f : null;
}

export function defaultKind(run) {
  const f = flowOf(run);
  return f ? FLOWS[f].kind : DEFAULT_KIND;
}

// Every subgoal leaves setgoal with an explicit kind, so nothing downstream - retries, the
// author check, the cross-check - has to know what the run's default was at the time.
export function normalizeSpec(run, spec) {
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.subgoals)) return spec;
  const dflt = defaultKind(run);
  return { ...spec, subgoals: spec.subgoals.map((sg) => (sg && typeof sg === 'object' && sg.kind == null ? { ...sg, kind: dflt } : sg)) };
}

// The stage that AUTHORS the artifact - the identity a later reviewing stage must not be.
// This was chain[0] until planning grew an `investigate` stage in front of `draft`: the
// investigator reads sources and writes findings, it does not write the document, so
// comparing revise against it would have let the drafter revise their own draft. A kind
// may name its author explicitly; chain[0] remains the default, which is still correct for
// every other kind (implement, draft, cases).
export function authorStage(kind) {
  const k = KINDS[kind] || KINDS[DEFAULT_KIND];
  return k.author || k.chain[0];
}

// Is this node the one that MUTATES the worktree for its subgoal (implement/draft/cases/audit -
// whatever authorStage(kind) names)? The checkpoint/rollback mechanism (broker.mjs) only cares
// about these: a judging stage (test/review/gate/critique) reads the tree, it does not write it,
// so there is nothing on its own attempt worth snapshotting.
export function isAuthorNode(run, n) {
  if (!n || !n.subgoal_id) return false;
  const sg = ((run.spec && run.spec.subgoals) || []).find((s) => String(s.id) === String(n.subgoal_id));
  return n.stage === authorStage(kindOf(sg));
}

// The human pin: a subgoal's own `assignee` field (written into the spec by setgoal itself, or
// at runtime by tm_assign) lands on exactly one node - the kind's author stage, never a judging
// one. A gate/review/test/critique judging the very work a human just did must stay automatic:
// pinning a judge to the same human it is meant to check would be the same same-actor mistake
// routing.mjs's AUTHOR_OF guards against for AI identities, just unguarded because a human was
// never in that table at all. Called right after pushChain creates the attempt - expandSubgoals'
// first attempt and retrySubgoal's every later one both call it, so a rejected human-authored
// subgoal comes back to a human again, not a model (docs/plans/2026-09-23-teams-reducer-human-
// rollback.md §0.2: a headless driver has no surface to reach one). A node already past
// 'pending' (running or done before the pin landed) is left alone - the spec's `assignee` still
// updates, so the NEXT attempt, if this one is rejected, picks it up.
//
// Two different hands write `assignee`, and docs/plans/2026-09-17-teams-team.md §7 ("사용자 =
// 그래프 노드") treats them differently. tm_assign marks its own writes {by: 'user'}
// (taskmanager.mjs's toolAssign, both the STORY-level pkg.assignee and the TASK-level
// sg.assignee) - the user is present by definition (they just called the tool), so that pin
// always parks the node in waiting_human, interactive or not. Anything else - a shape package's
// own `assignee` field (openChild's subgoal_assignee, itself the model's SHAPE output) or a
// setgoal subgoal's own `assignee` field - is the MODEL writing, not the user, and §7's
// "실행 규칙" is explicit that a model-authored pin is a decision the run defaults on its own
// unless the team asked to be interrupted: honoured as a parking pin only when run.interactive
// is true. This is the fix for the 0.27.3 review (2026-09-24): 0.27.3 parked ANY assignee:
// "human" unconditionally, so a model that wrote one into a shape or setgoal spec during a
// headless/bench run (nobody watching, interactive's own default is false) deadlocked the node
// in waiting_human forever - a flag nobody set was read as a question nobody could answer.
// Non-interactive now routes the node to an AI exactly as if nothing had been written, and
// records what would have parked it on the node itself (auto_decided_pin) - tm_inbox's
// `decided` section is exactly that record surfaced. "플래그 없는 실행은 '질문 없는 실행'이
// 아니라 '질문에 default로 답한 실행'이다. 차이는 기록에 있다." (§7).
function pinSource(pin) {
  return pin && typeof pin === 'object' && pin.by === 'user' ? 'user' : 'model';
}

export function applyHumanPin(run, sg, subgoalId, attempt) {
  const pin = sg && sg.assignee;
  if (!pin) return null;
  const n = getNode(run, `${authorStage(kindOf(sg))}:${subgoalId}:${attempt}`);
  if (!n || n.state !== 'pending') return null;
  const who = pin && typeof pin === 'object' ? (pin.who || null) : null;
  const source = pinSource(pin);
  if (source === 'model' && !run.interactive) {
    n.auto_decided_pin = {
      by: 'auto',
      who,
      pin: typeof pin === 'object' ? { ...pin } : pin,
      reason: 'assignee:"human" came from the shape/spec, not tm_assign, and this run is not interactive - dispatched to an AI instead of parking (§7)',
      at: Date.now(),
    };
    return null;
  }
  n.assignment = {
    executor: 'human', vendor: 'human', who,
    reason: source === 'user' ? 'pinned by tm_assign' : 'pinned by the subgoal spec (assignee)',
  };
  return n;
}

// The release half of the same pin (tm_assign({to: 'auto'})): drops the spec's own `assignee`
// and, when the node has not been picked up yet, whatever it already carries. A node still
// `waiting_human` goes back to `pending` so the very next team_next offers it to the ordinary
// candidate pool like any other node - "release with to: auto dispatches normally" is this line.
export function releaseHumanPin(run, sg, subgoalId, attempt) {
  if (sg) delete sg.assignee;
  const n = getNode(run, `${authorStage(kindOf(sg))}:${subgoalId}:${attempt}`);
  if (!n) return null;
  if (n.state === 'waiting_human') {
    n.state = 'pending';
    delete n.waiting_since;
  }
  if (n.assignment && n.assignment.executor === 'human') delete n.assignment;
  return n;
}

// One action ({subgoal_id, attempt, to: 'human'|'auto', who}), one place it is applied: tm_assign's
// own read-only preview (taskmanager.mjs, never saved) and the broker's real ingestion
// (mustFindRun -> drainHumanActions, broker.mjs) both call this, rather than each re-deciding
// "which of applyHumanPin/releaseHumanPin, with what assignee" on its own - that duplication is
// exactly how the preview and the real write could drift apart. See queueHumanAction below for
// why the write is queued at all instead of landing here directly.
export function applyPinAction(run, action) {
  const sg = run.spec && (run.spec.subgoals || []).find((s) => String(s.id) === action.subgoal_id);
  if (!sg) return null;
  if (action.to === 'auto') {
    delete sg.assignee;
    return releaseHumanPin(run, sg, action.subgoal_id, action.attempt);
  }
  // Only tm_assign queues a pin action, so this pin is the user's own - it parks whatever
  // `interactive` says (a model-written assignee is the one that needs interactive, §7).
  sg.assignee = { by: 'user', ...(action.who ? { who: action.who } : {}) };
  return applyHumanPin(run, sg, action.subgoal_id, action.attempt);
}

// The attempt a subgoal is currently on, read back from the nodes themselves - what tm_assign
// has (a subgoal id, resolved from a ticket key) instead of the round number expandSubgoals and
// retrySubgoal already track as they go.
export function currentAttempt(run, subgoalId) {
  const mine = run.nodes.filter((n) => n.subgoal_id === String(subgoalId));
  return mine.length ? Math.max(...mine.map((n) => n.attempt || 1)) : 1;
}

// The kind of the subgoal a node belongs to, from the run's spec. Run-level nodes have none.
export function nodeKind(run, n) {
  if (!n || !n.subgoal_id || !run.spec) return null;
  const sg = (run.spec.subgoals || []).find((s) => String(s.id) === String(n.subgoal_id));
  return sg ? kindOf(sg) : null;
}

function runsDir(cwd) {
  return join(cwd, '.teams_output', 'broker', 'runs');
}

function runPath(cwd, runId) {
  return join(runsDir(cwd), runId + '.json');
}

// A human's pin (tm_assign) or card answer (tm_submit({key})) crosses from the TaskManager's
// process into a child run it does not own. This directory is NOT runsDir - queueHumanAction
// never touches a run file - so the manager can record the human's intent without being the
// one who writes the child's graph (README: "a child graph run is written only by its own
// broker... the broker opens it, never a node"). The broker drains it (broker.mjs's
// ingestHandoff, called from mustFindRun) and applies each action for real, through the exact
// functions - applyPinAction above, computeSubmitResult+finishNode in broker.mjs - the
// manager's own preview already ran read-only. Before 0.27.4 this queue did not exist:
// taskmanager.mjs loadRun+saveRun'd the child directly, because broker.mjs bound process.stdin
// at module scope and could not be imported for its real logic at all (2026-09-24 review
// against this file's own header and design §7's "changed_files는 워크트리 대조로 똑같이 검증").
function handoffDir(cwd) {
  return join(cwd, '.teams_output', 'broker', 'handoffs');
}

function handoffPath(cwd, runId) {
  return join(handoffDir(cwd), runId + '.json');
}

function readHandoffQueue(cwd, runId) {
  try {
    const queue = JSON.parse(readFileSync(handoffPath(cwd, runId), 'utf8'));
    return Array.isArray(queue) ? queue : [];
  } catch {
    return [];
  }
}

// The manager's own write - appends, never touches runPath. Write-then-rename for the same
// torn-read reason saveRun uses it: a broker mid-drainHumanActions must never see a half-written
// queue.
export function queueHumanAction(cwd, runId, action) {
  const path = handoffPath(cwd, runId);
  mkdirSync(dirname(path), { recursive: true });
  // Under the same lock the drain takes. Unlocked, a drain landing between this read and this
  // rename either lost the action pushed here or applied the one it had just drained twice.
  const lock = acquire(path);
  try {
    const queue = readHandoffQueue(cwd, runId);
    queue.push(action);
    const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    writeFileSync(tmp, JSON.stringify(queue));
    renameSync(tmp, path);
  } finally {
    release(lock);
  }
}

// The manager's own read of what it has queued but the broker has not drained yet, so a second
// tm_assign/tm_submit in the same tick previews against its own prior call instead of the stale
// on-disk child - peekHumanActions never deletes; only drainHumanActions (the broker's read) does.
export function peekHumanActions(cwd, runId) {
  return readHandoffQueue(cwd, runId);
}

// The broker's own read: drains (reads, then removes) so the same action is never applied
// twice. Only ever called from mustFindRun (broker.mjs) - see the header comment above.
export function drainHumanActions(cwd, runId) {
  const path = handoffPath(cwd, runId);
  if (!existsSync(path)) return [];
  const lock = acquire(path);
  try {
    const queue = readHandoffQueue(cwd, runId);
    if (queue.length) {
      try { rmSync(path, { force: true }); } catch { /* already gone */ }
    }
    return queue;
  } finally {
    release(lock);
  }
}

// A run file is read-modify-written by every mutation, and a node can be held open for
// minutes while a vendor works. Two brokers on one run therefore raced: the slow one's
// stale snapshot overwrote a node the fast one had already finished and reported `done`
// to its client. The work had happened; only the record vanished.
//
// mkdir is atomic on every filesystem we care about, so it is the lock.
const LOCK_STALE_MS = 30 * 1000;

// Where this run's file is. The broker's runs live under their project; a run that manages
// other runs (the TaskManager's) lives outside any project and says so with `store_path`.
// Everything else - lock, merge, save, load - keys off this one function.
export function pathOf(run) {
  return run.store_path || runPath(run.cwd, run.run_id);
}

function acquire(path) {
  const lock = path + '.lock';
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      mkdirSync(lock);
      return lock;
    } catch {
      // A lock left behind by a killed process must not wedge the run forever.
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue; // it vanished between the two calls; try again
      }
      if (Date.now() > deadline) return null; // fall through unlocked rather than hang
      // Busy-wait briefly: the critical section is a file write, measured in microseconds.
      const spin = Date.now() + 5;
      while (Date.now() < spin) { /* yield-free by design; this is a sub-millisecond wait */ }
    }
  }
}

function release(lock) {
  if (!lock) return;
  try {
    rmSync(lock, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

// Apply this process's view of the run onto whatever is currently on disk, instead of
// replacing it. Nodes another broker finished while we were working are kept.
function mergeOnto(fresh, mine) {
  if (!fresh) return mine;
  const byId = new Map(fresh.nodes.map((n) => [n.node_id, n]));
  for (const n of mine.nodes) {
    const cur = byId.get(n.node_id);
    // A terminal state on disk that we never saw belongs to another broker: keep it.
    const recoveringOwnExecution = cur?.state === 'running' && cur.ticket
      && n.recovery?.from_ticket === cur.ticket;
    // A deliberate reopen (the daemon re-judging a node whose judge never judged - autoRejudge)
    // carries a higher `reopened` count than the disk copy; that is the one legitimate way back
    // from a terminal state to pending.
    const reopenedOnPurpose = n.state === 'pending' && (n.reopened || 0) > ((cur && cur.reopened) || 0);
    if (cur && cur.state !== 'pending' && n.state === 'pending' && !recoveringOwnExecution && !reopenedOnPurpose) continue;
    byId.set(n.node_id, n);
  }
  const freshEpoch = fresh.capacity_epoch || 0;
  const mineEpoch = mine.capacity_epoch || 0;
  const unavailable = freshEpoch > mineEpoch ? fresh.unavailable_vendors
    : mineEpoch > freshEpoch ? mine.unavailable_vendors
      : { ...(fresh.unavailable_vendors || {}), ...(mine.unavailable_vendors || {}) };
  return { ...fresh, ...mine, nodes: [...byId.values()],
    capacity_epoch: Math.max(freshEpoch, mineEpoch), unavailable_vendors: unavailable || {} };
}

export function saveRun(run) {
  const path = pathOf(run);
  mkdirSync(dirname(path), { recursive: true });
  const lock = acquire(path);
  try {
    const merged = mergeOnto(loadRunAt(path), run);
    // Write-then-rename: a reader in another process (the daemon's dispatchSettled, a tm_status
    // from a session) must never see a truncated file. A plain writeFileSync truncates first and
    // fills second, and seam-beta-D2 (2026-09-21) caught the daemon in that gap - it read a torn
    // child run, called the dispatch settled, then foldChild re-read a whole file and threw.
    const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    writeFileSync(tmp, JSON.stringify(merged, null, 2) + '\n');
    renameSync(tmp, path);
    // Keep the caller's object consistent with what was written.
    run.nodes = merged.nodes;
    run.capacity_epoch = merged.capacity_epoch || 0;
    run.unavailable_vendors = merged.unavailable_vendors || {};
    return run;
  } finally {
    release(lock);
  }
}

export function loadRunAt(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function loadRun(cwd, runId) {
  return loadRunAt(runPath(cwd, runId));
}

// A run id alone is enough to find the run when the caller did not pass a cwd,
// as long as some cwd is known to this process.
export function findRun(runId, cwds) {
  for (const c of cwds) {
    if (!c) continue;
    const r = loadRun(c, runId);
    if (r) return r;
  }
  return null;
}

export function listRuns(cwd) {
  try {
    return readdirSync(runsDir(cwd))
      .filter((f) => f.endsWith('.json'))
      .map((f) => loadRun(cwd, f.slice(0, -5)))
      .filter(Boolean);
  } catch {
    return [];
  }
}

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
    max_retries: Number.isInteger(opts.max_retries) ? opts.max_retries : 2,
    // continue (default) or rollback - docs/plans/2026-09-23-teams-reducer-human-rollback.md §5.
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
    // How many packages deep this run was opened. 0 at the top; task.child_opts.depth =
    // parent.depth + 1 for every package's child run (teamconfig.mjs's max_depth reads
    // this). A caller that never asks - the ordinary team_open path, every run before this
    // field existed - gets 0, which max_depth (default 2) never trips.
    depth: Number.isInteger(opts.depth) ? opts.depth : 0,
    nodes: [],
    // Cross-run author identity ({executor, vendor, model} or null), for a run whose judging
    // stage's author never ran in ITS OWN nodes[] - today only the planning-audit kind's `audit`
    // stage, whose author is the PLAN package's draft/revise, folded away in a sibling run
    // before this one opens (taskmanager.mjs's openAudit/planAuthorIdentity). routing.mjs's
    // externalAuthorOf and broker.mjs's reviewIndependence both read this field; every run that
    // is not an audit child simply carries null, same as opts.external_author being absent.
    external_author: opts.external_author || null,
  };
  // A parent that already shaped and critiqued this run's one subgoal (docs/plans/
  // 2026-09-21-teams-server-owns-the-loop.md §3) hands it down already decided: run-level
  // plan/setgoal/critique would only re-derive what the parent's shape+critique already
  // settled, and a goal-level gate would only re-judge what that one subgoal's own gate
  // just judged. Skip both layers - this run IS the subgoal chain, nothing else. No plan
  // node ever runs here, so run.flow (opts.flow - a package's child is always opened with a
  // resolved flow, never 'auto') decides the kind directly instead of waiting on flow_chosen.
  if (opts.parent_shaped === true) {
    run.parent_shaped = true;
    const kind = FLOWS[run.flow] ? FLOWS[run.flow].kind : DEFAULT_KIND;
    const acceptance = Array.isArray(opts.acceptance) && opts.acceptance.length
      ? opts.acceptance.slice()
      : [String(opts.goal || opts.request || '').slice(0, 200) || 'the package meets its brief'];
    run.spec = {
      goal: opts.goal || opts.request,
      acceptance,
      subgoals: [{ id: 'U1', title: opts.goal || 'the package', kind, acceptance: acceptance.slice(), deps: [], after: [], ...(opts.subgoal_assignee ? { assignee: opts.subgoal_assignee } : {}) }],
    };
    pushChain(run, (KINDS[kind] || KINDS[DEFAULT_KIND]).chain, 'U1', 1, [], [], {});
    applyHumanPin(run, run.spec.subgoals[0], 'U1', 1);
  } else {
    run.nodes.push(
      node('plan', 'plan', []),
      node('setgoal', 'setgoal', ['plan']),
      node('critique', 'critique', ['setgoal']),
    );
  }
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
export const DOCUMENT_ONLY_KINDS = new Set(['planning', 'planning-audit']);

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
    // edited. A planning run has no worktree of its own, so that lands in the real tree.
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

// The gate that closes a subgoal's attempt, by its kind - the last stage in the chain.
function gateStage(kind) {
  const { chain } = KINDS[kind] || KINDS[DEFAULT_KIND];
  return chain[chain.length - 1];
}

// A parent_shaped run's terminal node: the latest-attempt gate of its one subgoal. There is
// no gate:goal and no report on this run, so runState (below) and any caller reading the
// child's own account of itself (taskmanager.mjs's foldChild) read this instead. Latest
// attempt is the last-pushed one, the same convention retrySubgoal's own `heads.at(-1)` and
// `prior.length` counting rely on elsewhere in this file.
export function parentShapedTerminal(run) {
  const sg = run.spec && Array.isArray(run.spec.subgoals) ? run.spec.subgoals[0] : null;
  if (!sg) return null;
  const stage = gateStage(kindOf(sg));
  const nodes = run.nodes.filter((n) => n.stage === stage && n.subgoal_id === String(sg.id));
  return nodes.length ? nodes[nodes.length - 1] : null;
}

// ---------- goal-gate consensus and repair (Step 9) ----------
//
// A goal-gate "round" is one or more sibling `gate` nodes with subgoal_id null, all
// judging the same assembled result over the same deps. The primary is unlettered
// (`gate:goal:3`); a second and further judge get a letter suffix (`gate:goal:3b`,
// `gate:goal:3c`, ...) so `goal_judges:1` reproduces the exact node id every prior run
// and test relied on, and `nextIndex(run, 'gate:goal')`-style counting elsewhere still
// treats the round as one thing rather than N.

function goalGateSuffix(i) {
  return i === 0 ? '' : String.fromCharCode(98 + i - 1); // 0 -> '', 1 -> 'b', 2 -> 'c', ...
}

// The round number embedded in a goal-gate node id, or null for anything else -
// including a subgoal gate, which never starts with `gate:goal`.
export function goalRoundOf(nodeId) {
  const m = /^gate:goal:(\d+)[a-z]?$/.exec(nodeId || '');
  return m ? Number(m[1]) : null;
}

// Every judge of a round, primary first, in a stable id order.
export function goalGateSiblings(run, round) {
  return run.nodes
    .filter((n) => n.stage === 'gate' && n.subgoal_id === null && goalRoundOf(n.node_id) === round)
    .sort((a, b) => a.node_id.localeCompare(b.node_id));
}

// One past the highest round already opened - siblings all share a round, so counting
// by node_id prefix the way `nextIndex` does would count N per round and desync the
// letter suffixes from the round number.
export function nextGoalRound(run) {
  let max = 0;
  for (const n of run.nodes) {
    const r = goalRoundOf(n.node_id);
    if (r != null && r > max) max = r;
  }
  return max + 1;
}

// Opens a fresh round of `judges` sibling gate nodes, all sharing `deps`. Used both for
// the round a fresh subgoal expansion produces and for the round that follows a repair.
export function pushGoalGateRound(run, deps, extra, judges) {
  const round = nextGoalRound(run);
  const n = Math.max(1, Number.isInteger(judges) ? judges : 1);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `gate:goal:${round}${goalGateSuffix(i)}`;
    run.nodes.push(node(id, 'gate', deps.slice(), { subgoal_id: null, ...(extra || {}) }));
    ids.push(id);
  }
  return { round, ids };
}

// Consensus over one round: null until every judge has a terminal state. `accept`
// requires every judge's OWN verdict to have passed (nodeSucceeded already enforces
// that judge's accept/match_pct/checks rule, so a judge that fails on any of those
// never reaches `done`) - consensus adds nothing beyond "all of them, not just one".
// `routing_failure` is a peer that could not judge at all (transport, vendor,
// unparseable reply): the same distinction the subgoal branch of autoReassign draws,
// and the caller's problem, not a rejection to repair.
export function goalConsensus(run, round) {
  const judges = goalGateSiblings(run, round);
  if (!judges.length) return null;
  const routingFailure = judges.some((n) => n.result && n.result.stage_ok !== true);
  const settled = !routingFailure && judges.every((n) => n.state === 'done' || n.state === 'failed');
  // Through the declared registry (reducers.mjs), not an inline Set/Math.min: this is the same
  // AND-consensus / min / concat-dedup merge foldChild and the run-level `reduce` node use, so a
  // reader learns the rule once. Judges are true SIBLINGS (one round, several independent
  // opinions), which is exactly what and-consensus/min/concat-dedup are for - unlike a
  // package's own retry history (taskmanager.mjs's foldPackageHistory), where the same field
  // names mean something else and are folded last-by-attempt instead.
  const acceptEntries = judges.map((n) => ({ node_id: n.node_id, attempt: round, value: n.state === 'done' }));
  const matchEntries = judges
    .map((n) => ({ node_id: n.node_id, attempt: round, value: n.result && Number.isFinite(n.result.match_pct) ? n.result.match_pct : undefined }))
    .filter((e) => e.value !== undefined);
  const gapsEntries = judges.map((n) => ({ node_id: n.node_id, attempt: round, value: (n.result && n.result.gaps) || [] }));
  const driftEntries = judges.map((n) => ({ node_id: n.node_id, attempt: round, value: (n.result && n.result.spec_drift) || [] }));
  return {
    round,
    settled,
    routing_failure: routingFailure,
    accept: settled && applyMerge('and-consensus', acceptEntries),
    match_pct: matchEntries.length ? applyMerge('min', matchEntries) : null,
    gaps: applyMerge('concat-dedup', gapsEntries),
    spec_drift: applyMerge('concat-dedup', driftEntries),
    judges: judges.map((n) => ({
      node_id: n.node_id,
      state: n.state,
      accept: n.result ? n.result.accept === true : null,
      match_pct: n.result && Number.isFinite(n.result.match_pct) ? n.result.match_pct : null,
      identity: `${n.executor || n.vendor || 'self'}@${n.model || 'default'}`,
    })),
  };
}

// One repair per rejected round, capped like every other attempt counter -
// `nextIndex(run, 'repair')` is deliberately not reused: subgoal budgets are per
// subgoal, the spec budget is per run, and this is a third counter with its own name.
export function nextRepairIndex(run) {
  return run.nodes.filter((n) => n.stage === 'repair').length + 1;
}

// Opens repair:N over the rejecting round's siblings, then a fresh goal-gate round
// behind it - `repair:N after [gate:goal:round's siblings]`, `gate:goal:round+1 deps
// [repair:N, ...the subgoal gates that fed round]` - and moves the report's `after`
// from the old round onto the new one. Over budget, the rejecting siblings are marked
// final and the report is left free to run on partial work, same as every other
// exhausted budget in this engine.
//
// repair's edge to the round it follows is `after`, not `deps`: a rejecting judge ends
// `failed`, never `done`, and a data dep only ever waits for `done` - repair would sit
// forever behind a round it exists to answer. `after` only needs the round settled,
// which a failed-and-final judge already is.
export function openRepair(run, round, feedback, judges) {
  const siblings = goalGateSiblings(run, round);
  const attempt = nextRepairIndex(run);
  if (attempt > run.max_retries) {
    for (const s of siblings) if (s.state === 'failed') s.final = true;
    return { run: saveRun(run), attempt: null, reason: 'repair budget exhausted' };
  }
  const subgoalGateIds = siblings.length ? siblings[0].deps.slice() : [];
  const repairId = `repair:${attempt}`;
  run.nodes.push(node(repairId, 'repair', [], { after: siblings.map((s) => s.node_id), feedback: feedback || '' }));
  const { ids: freshIds } = pushGoalGateRound(run, [repairId, ...subgoalGateIds], {}, judges || 1);

  const oldIds = new Set(siblings.map((s) => s.node_id));
  for (const n of run.nodes) {
    if (n.node_id === repairId) continue; // repair itself follows the OLD round, not the new one it opens
    if (!n.after || !n.after.some((d) => oldIds.has(d))) continue;
    n.after = [...new Set([...n.after.filter((d) => !oldIds.has(d)), ...freshIds])];
  }
  return { run: saveRun(run), attempt, repair_id: repairId, gate_ids: freshIds };
}

// The one place this graph stops and asks a person. `investigate` (0.26.0) names what no source
// could answer; until now every one of those went into the document as an open question and the
// run finished without ever having asked anybody. An unknown whose owner is a person and whose
// answer is a choice between named candidates is not a gap in the research - it is a decision
// waiting on someone, and a plan that ships it unasked is a plan that decided by default.
//
// Shape: `ask:<subgoal>:<attempt>` (one per distinct owner - see the grouping below) sits
// between investigate and whatever consumed it (draft), carrying `questions[]` straight from
// investigate's own unknowns. It is born with the same
// human pin applyHumanPin writes, so promoteWaitingHuman parks it in `waiting_human` the moment
// its dep is done and NOTHING here polls a model for it - tm_inbox is the only reader,
// tm_submit({key}) the only writer, exactly as for a pinned author stage (0.27.3). That is why
// this needed no new state, no new inbox and no new resume path: the human-card machinery was
// already there, and an asked decision is just another card.
//
// Only inserted when the run is `interactive`. v0.13.0's default (interactive: false) is to
// decide automatically and record what it WOULD have asked - broker.mjs keeps those on
// run.unasked so the report can show the questions nobody answered, which reads better than a
// document quietly full of assumptions.
// D2 slice 3 (0.29.0, docs/plans/2026-09-23-teams-reducer-human-rollback.md §1): `questions[]`
// is no longer investigate's `unknowns[]` alone - any judging/deciding stage's own contract
// (setgoal, plan, critique, shape, gate, accept, gate:goal, a QA cases set) may return the same
// shape ({question, to/owner, options?, default, why}), and the engine treats it identically.
// Two relaxations from the investigate-only version made that possible:
// - decidability no longer requires >1 named options: a question with a stated `default` is
//   decidable on its own (the non-interactive path needs exactly that to auto-decide), options
//   remain how a person is offered more than the default to pick from.
// - the card's owner key falls back to the node's own node_id when it has no subgoal_id - every
//   run/task-level judging node (setgoal, plan, critique, gate:goal, and shape/accept/integrate
//   at the manager layer) has none, and investigate was the only stage with one to begin with.
// Every decision a person has already made for this owner (a subgoal id, or a manager node's own
// id - the same key openAsk uses), read off the `ask` nodes themselves. Superseded attempts are
// included on purpose: an answer does not stop being an answer because the attempt that asked for
// it was retried. Read by openAsk (never ask twice) and by nodeBriefing (so the stage writing the
// next round of questions knows what is settled).
// owner === undefined: every decision a person made anywhere in this run, each tagged with the
// owner it was made for. A decision is the run's, not one subgoal's: idol-beta-ask1 asked the
// fan-club tier question under U1 (multi-tier), then again under U2 and U3 (single tier) - each
// investigate only saw its own owner's settled answers, and the documents came out contradicting.
export function answeredDecisions(run, owner) {
  const out = [];
  const seen = new Set();
  for (const x of run.nodes) {
    if (x.stage !== 'ask') continue;
    // ask_owner since 0.29.2; fall back to subgoal_id for a card written before it existed.
    const own = String(x.ask_owner || x.subgoal_id || '');
    if (owner !== undefined && own !== String(owner)) continue;
    for (const d of (x.result && x.result.decisions) || []) {
      if (!d || !d.question || seen.has(d.question)) continue;
      seen.add(d.question);
      out.push(owner === undefined ? { ...d, decided_for: own } : d);
    }
  }
  return out;
}

export function openAsk(run, n, questions) {
  if (!n) return [];
  let qs = (questions || []).filter((q) => q && (q.question || q.unknown)
    && ((Array.isArray(q.options) && q.options.length > 1) || q.default !== undefined));
  if (!qs.length) return [];
  const attempt = n.attempt || 1;
  const owner = n.subgoal_id || n.node_id;
  if (run.nodes.some((x) => x.node_id === `ask:${owner}:${attempt}`)) return [];
  // A question a person already answered on an earlier attempt of this same owner is settled, and
  // asking it again is asking them to decide twice. idol-beta-ask1 (2026-09-25) measured it: U4's
  // draft failed twice, its third investigate raised six questions, and two were byte-identical to
  // ones answered on ask:U4:1 - a node the retry superseded, so nothing downstream knew. Exact
  // match only, because the engine stored both strings itself and needs no judgement to compare
  // them. The other four were rewordings of the same decisions, which no string filter can catch -
  // that is why answeredDecisions also reaches the next attempt's own briefing (nodeBriefing):
  // the stage that writes the question is the one that should know it is already decided.
  const settled = new Set(answeredDecisions(run).map((d) => d.question));
  if (settled.size) {
    qs = qs.filter((q) => !settled.has(q.question || q.unknown));
    if (!qs.length) return [];
  }
  // Whoever consumed the node now consumes the answers instead. Order-only (`after`) edges
  // count as consumers too, not just data (`deps`) ones - gate:goal's only downstream is
  // `report` via `after` (expandSubgoals leaves the subgoal gates as `after`, not `deps`, once
  // `reduce` takes the data edge), and a report written before a gate:goal question is settled
  // would omit the very decision it is meant to state as a rule.
  const consumers = run.nodes.filter((x) => (x.deps || []).includes(n.node_id) || (x.after || []).includes(n.node_id));

  // One card per owner, not one card per subgoal. The first real interactive run (idol-beta-ask1,
  // 2026-09-24) came back with seven questions on one card owned by five different roles - the PO,
  // a capacity lead, Legal/Finance, SRE and Security - addressed to whichever happened to be first.
  // Nobody can answer that card: it is five people's work in one envelope, and the design this
  // came from is explicit that a checkpoint without a named owner is where the pattern breaks
  // (docs/plans/2026-09-23-teams-reducer-human-rollback.md §0'). Grouped in first-appearance
  // order so the leading card stays `ask:<sg>:<attempt>` and reads the same as before whenever
  // there is only one owner - which is the common case and every test written before this.
  const groups = new Map();
  for (const q of qs) {
    // `to` is the generalized contract's field name (docs/plans/2026-09-23-teams-reducer-
    // human-rollback.md §1); `owner` is investigate's own, kept so its existing unknowns[]
    // still group exactly as before.
    const key = (typeof q.to === 'string' && q.to.trim()) || (typeof q.owner === 'string' && q.owner.trim()) || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }
  const ids = [];
  let i = 0;
  for (const [who, groupQs] of groups) {
    // `ask:U1:1`, `ask:U1:1b`, `ask:U1:1c` - the same suffixing pushGoalGateRound uses for
    // sibling judges, so nothing downstream has to learn a second id shape.
    const askId = `ask:${owner}:${attempt}${i === 0 ? '' : String.fromCharCode(97 + i)}`;
    run.nodes.push(node(askId, 'ask', [n.node_id], {
      subgoal_id: n.subgoal_id,
      // The key this card's questions belong to - a subgoal id, or a manager node's own id when
      // the asking stage has no subgoal (0.29.0). Stored rather than re-derived: the card's own
      // node_id is `ask:<owner>:<attempt>`, so reading the owner back out of it would mean
      // parsing, and answeredDecisions has to match it exactly across attempts.
      ask_owner: String(owner),
      attempt,
      questions: groupQs,
      assignment: { executor: 'human', vendor: 'human', who: who || null, reason: `a decision no source could answer (${n.stage} questions)` },
      // Parked here rather than left for promoteWaitingHuman to find on the next team_next. Its
      // one dep is the node whose own submission is creating it, so it is ready by construction -
      // and a card that only becomes visible once somebody polls is a card tm_inbox cannot be
      // trusted to list.
      state: 'waiting_human',
      waiting_since: Date.now(),
    }));
    ids.push(askId);
    i += 1;
  }
  // The consumer waits for every owner: work written while one of them is still deciding would
  // carry that decision as an open question and the answer would arrive too late to be a rule.
  // Rewired into whichever list originally named the node - a data (`deps`) consumer stays a
  // data consumer, an order-only (`after`) one stays order-only.
  for (const c of consumers) {
    if (c.deps.includes(n.node_id)) c.deps = [...c.deps.filter((d) => d !== n.node_id), ...ids];
    if ((c.after || []).includes(n.node_id)) c.after = [...c.after.filter((d) => d !== n.node_id), ...ids];
  }
  return ids;
}

export function expandSubgoals(run, subgoals) {
  const gateIds = [];
  // After a spec retry the live critique is critique:N, not the retired `critique`.
  const liveCritique = run.nodes.filter((n) => n.stage === 'critique' && n.state !== 'skipped').pop();
  const critiqueDep = liveCritique ? liveCritique.node_id : 'critique';

  // One attempt number for the whole expansion, so a subgoal's deps can name its
  // siblings' gates without guessing which round they belong to.
  const round = Math.max(
    1,
    ...subgoals.map((sg) => nextIndex(run, `implement:${String(sg.id)}`)),
  );

  for (const sg of subgoals) {
    const id = String(sg.id);
    const deps = (sg.deps || []).map((d) => `gate:${d}:${round}`);
    const after = (sg.after || []).map((d) => `gate:${d}:${round}`);
    gateIds.push(pushChain(run, (KINDS[kindOf(sg)] || KINDS[DEFAULT_KIND]).chain, id, round, [critiqueDep, ...deps], after, {}));
    applyHumanPin(run, sg, id, round);
  }
  // Where parallel subgoals converge. Until this node existed the only place they met was
  // the goal gate, which is a judging node and writes nothing - so nothing ever looked at
  // the artifacts as a set. What held that seam together was a convention: the setgoal
  // contract tells subgoals sharing one file to each name the heading they own. A
  // convention breaks quietly and nobody checks it, and idol-plan-2 (2026-09-23) is what
  // that looks like in practice - five sibling investigate stages, told to name their
  // findings file after their subgoal, produced U1-investigate.md,
  // U3-1-investigate-notes.md, investigate-U4-findings.md, investigate-U2-findings.md and
  // decisions/investigate_U5_1-findings.md, and a retry left investigate_U5_2 beside its
  // own first attempt as an orphan. `reduce` is the leader that folds the set: it reads
  // what the subgoals actually wrote and reports what does not line up. It does not judge
  // - that stays the goal gate's job.
  //
  // Only pushed when there is more than one subgoal: a single-subgoal run has nothing to
  // fold, and inserting a node there would add a model call that can only say "nothing to
  // do".
  let gateDeps = gateIds;
  let gateAfter = [];
  if (subgoals.length > 1) {
    const reduceId = round === 1 ? 'reduce' : `reduce:${round}`;
    run.nodes.push(node(reduceId, 'reduce', gateIds, {}));
    // The goal gate's data edge moves to reduce, but its SIGHT must not narrow with it:
    // nodeBriefing walks deps and after, so a gate whose deps are ['reduce'] alone would be
    // handed one node's lists and none of the work it is judging. The subgoal gates stay on
    // as order-only edges, which is what `after` is for - they are already satisfied by the
    // time reduce is, so this adds no waiting, only visibility.
    gateDeps = [reduceId];
    gateAfter = gateIds.slice();
  }
  // Multi-judge consensus (Step 9 / D-goal-consensus): a fresh round of `run.goal_judges`
  // sibling gates over the same subgoal gates, instead of the single node this used to
  // push directly. goal_judges:1 is exactly the old shape - one node named `gate:goal:N`.
  const { ids: goalGates } = pushGoalGateRound(run, gateDeps, gateAfter.length ? { after: gateAfter } : {}, run.goal_judges || 1);
  const reportId = round === 1 ? 'report' : `report:${round}`;
  // Order-only: the report waits for every judge in the round to be settled, not to
  // pass. A run whose subgoal ran out of retries used to end `blocked` with the
  // passing subgoals' work never reported - partial success was simply lost.
  run.nodes.push(node(reportId, 'report', [], { after: goalGates }));
  return saveRun(run);
}

// Deterministic sibling write-scope check (item 2 of the reducer plan, §0.1/§4 of
// docs/plans/2026-09-23-teams-reducer-human-rollback.md): whether parallel subgoals collided
// on a file - or, sharing one document, the same heading - without a single declared owner.
// This is a pure function of run state, not a model call, so it runs whether or not the run's
// own `reduce` LLM pass happened to notice the same thing (see broker.mjs's finishNode, which
// records this onto the `reduce` node's own result) and whether or not a run even HAS a reduce
// node - `n` may be the goal gate itself on a run with exactly one subgoal, where there is
// nothing to collide and this returns three empty lists.
//
// `n`'s subgoal gates are wherever the caller put them: `reduce`'s own deps (the direct fold),
// or `gate:goal`'s `after` (the goal gate depends on `reduce` alone but keeps every subgoal
// gate as order-only sight - expandSubgoals's own comment on gateAfter explains why). Reading
// both covers either caller without either needing to know how the other is wired.
export function computeWriteScope(run, n) {
  const subgoals = (run.spec && run.spec.subgoals) || [];
  const ids = [...new Set([...(n.deps || []), ...(n.after || [])])];
  const records = ids
    .map((id) => getNode(run, id))
    .filter((g) => g && g.stage === 'gate' && g.subgoal_id)
    .map((g) => {
      const sg = subgoals.find((s) => String(s.id) === String(g.subgoal_id));
      const stage = authorStage(kindOf(sg));
      const author = getNode(run, `${stage}:${g.subgoal_id}:${g.attempt || 1}`);
      return {
        subgoal_id: g.subgoal_id,
        attempt: g.attempt || 1,
        changed_files: (author && author.result && Array.isArray(author.result.changed_files)) ? author.result.changed_files : [],
      };
    });
  return writeScopeFindings(subgoals, records);
}

// Failure becomes definitive at exactly one point: when the retry budget is gone.
// Until then a failed node is a retry waiting to happen, and nothing downstream may be
// written off. Once it is definitive, everything that needs the node's output through a
// data edge can never run - mark it `unreachable` with the reason, transitively, so the
// graph says so instead of sitting `blocked` with a pile of `pending` nodes. A node that
// already failed downstream is final too: no retry of it can succeed with a dead upstream.
// Order-only edges do not propagate; that is what they are for.
export function settleFailure(run, root) {
  if (!root || root.state !== 'failed') return [];
  const touched = [];
  root.final = true;
  const queue = [root];
  while (queue.length) {
    const x = queue.shift();
    const why = x.state === 'failed' ? `${x.node_id} failed with no retry left` : `${x.node_id} is unreachable`;
    for (const n of run.nodes) {
      if (!n.deps.includes(x.node_id)) continue;
      if (n.state === 'pending') {
        n.state = 'unreachable';
        n.result = { stage_ok: false, reason: `unreachable: ${why}` };
        touched.push(n.node_id);
        queue.push(n);
      } else if (n.state === 'failed' && !n.final) {
        n.final = true;
        touched.push(n.node_id);
        queue.push(n);
      }
    }
  }
  return touched;
}

// A rejected subgoal gets a fresh attempt rather than a retried node: the old attempt
// stays in the graph as evidence of what was tried and why it failed.
export function retrySubgoal(run, subgoalId, feedback) {
  const sg = ((run.spec && run.spec.subgoals) || []).find((x) => String(x.id) === String(subgoalId));
  const kind = kindOf(sg);
  const gateOf = gateStage(kind);
  const prior = run.nodes.filter((n) => n.subgoal_id === subgoalId && n.stage === gateOf);
  const attempt = prior.length + 1;
  if (attempt > run.max_retries + 1) {
    const dead = run.nodes.filter((n) => n.subgoal_id === subgoalId && n.state === 'failed' && !n.final);
    const unreachable = dead.flatMap((n) => settleFailure(run, n));
    return { run: saveRun(run), attempt: null, reason: 'retry budget exhausted', unreachable };
  }

  const prevGate = `${gateOf}:${subgoalId}:${attempt - 1}`;

  // The previous attempt may have died at implement, leaving its test and gate pending
  // forever. Retire them: a node waiting on a dep that can never complete is a dead
  // loop, and a dep on a failed node never satisfies.
  for (const n of run.nodes) {
    if (n.subgoal_id === subgoalId && (n.attempt || 1) === attempt - 1 && n.state === 'pending') {
      n.state = 'skipped';
      n.result = { stage_ok: false, reason: `superseded by attempt ${attempt}` };
    }
  }

  // The new attempt starts from the upstream its own generation had, not from the attempt
  // that just failed - every attempt in a generation copies the same baseDeps, so the latest
  // head node carries it. Reading the *earliest* head node instead was a run-killer: after a
  // spec-level retry re-expands the subgoals, attempt 1's deps name gate nodes that retry
  // skipped as superseded, so the new attempt was born waiting on the dead generation and
  // could never become ready. Observed in a live run, which then blocked with the goal gate
  // and two subgoals never reached and a retry budget spent on a node nothing was waiting for.
  const headStage = (KINDS[kind] || KINDS[DEFAULT_KIND]).chain[0];
  const heads = run.nodes.filter((x) => x.subgoal_id === subgoalId && x.stage === headStage);
  const live = heads.filter((x) => !(x.state === 'skipped' && x.result && /superseded/.test(x.result.reason || '')));
  const head = (live.length ? live : heads).at(-1);
  const baseDeps = head ? head.deps.slice() : ['critique'];
  const baseAfter = head ? (head.after || []).slice() : [];

  // rollback (docs/plans/2026-09-23-teams-reducer-human-rollback.md §5): reset the worktree to
  // the checkpoint broker.mjs recorded before this subgoal's OWN first attempt touched it, i.e.
  // the state that had already cleared every gate upstream of this subgoal - not a checkpoint
  // from any later attempt, which would itself carry a still-uncommitted, still-failing edit.
  // Guarded to a run with exactly one subgoal: a shared worktree with siblings still working in
  // it cannot be reset for one subgoal without also discarding theirs (no per-subgoal commit
  // exists to reset around - nothing commits until the whole package folds, taskmanager.mjs's
  // commitWorktree). The caller (broker.mjs's team_retry) performs the actual git reset; this
  // function only decides and reports the target, staying pure like the rest of this file.
  const authorNodesFor = (att) => run.nodes.filter((x) => x.subgoal_id === subgoalId && x.stage === authorStage(kind) && (x.attempt || 1) === att);
  const soleSubgoal = ((run.spec && run.spec.subgoals) || []).length <= 1;
  const firstAuthor = authorNodesFor(1)[0];
  let rollback = null;
  if (run.retry_policy === 'rollback') {
    if (!soleSubgoal) rollback = { skipped: true, reason: `run has ${(run.spec.subgoals || []).length} subgoals sharing one worktree; rollback would also discard their work, so this retry continues instead` };
    else if (!firstAuthor || !firstAuthor.checkpoint) rollback = { skipped: true, reason: 'no checkpoint was recorded for this subgoal\'s first attempt; continuing instead' };
    else rollback = { checkpoint: firstAuthor.checkpoint, node_id: firstAuthor.node_id };
  }

  const gate = pushChain(run, (KINDS[kind] || KINDS[DEFAULT_KIND]).chain, subgoalId, attempt, baseDeps, baseAfter, { feedback: feedback || '' });
  // A subgoal the spec pinned to a human stays pinned on its next attempt too - a rejection
  // must send the SAME card back to waiting_human, never quietly hand the retry to a model.
  applyHumanPin(run, sg, subgoalId, attempt);

  // Anything that waited on the old attempt's gate must wait on the new one.
  for (const n of run.nodes) {
    if (n.node_id === gate) continue;
    n.deps = n.deps.map((d) => (d === prevGate ? gate : d));
    n.after = (n.after || []).map((d) => (d === prevGate ? gate : d));
  }
  // A goal gate retired by an earlier failure would strand the rebuilt attempt.
  for (const n of run.nodes) {
    if (n.stage === 'gate' && n.subgoal_id === null && n.state === 'skipped' && n.deps.includes(gate)) {
      n.state = 'pending';
      n.result = null;
    }
  }
  // A fold that already ran folded the set as it was BEFORE this retry, and the rewire above
  // just moved its data edge onto an attempt it has never seen. Leaving it `done` hands the
  // goal gate a stale reading of the artifacts and, worse, one that looks current. Send it
  // back to pending so it folds what is actually on disk now.
  for (const n of run.nodes) {
    if (n.stage === 'reduce' && n.state === 'done' && n.deps.includes(gate)) {
      n.state = 'pending';
      n.result = null;
      // mergeOnto refuses done -> pending unless `reopened` outruns the disk copy, which is
      // how it keeps one broker from undoing another's progress. This is the same deliberate
      // reopen autoRejudge makes, so it says so the same way; without the bump the reset is
      // written and silently merged away, and the fold stays stale.
      n.reopened = (n.reopened || 0) + 1;
    }
  }
  // A goal gate that REJECTED is a different case: it ran, and its verdict is evidence. The
  // retried subgoal will pass or fail on its own, but nothing re-judged the whole - the old
  // gate stayed `failed`, the report stayed behind it, and the run wedged with the fix in
  // place. Open a fresh goal-gate ROUND (every judge, not just the one whose deps happen to
  // name this gate) over the live subgoal gates, carrying the rejection as feedback, and move
  // the report behind it. The old round stays, as every failed attempt does.
  // Matched on `after` as well as `deps` since `reduce` began carrying the data edge: a goal
  // gate over a multi-subgoal run now depends on the fold and keeps the subgoal gates as
  // order-only edges, so a deps-only lookup found no stale round and silently opened none -
  // the retried subgoal rebuilt the tree and nothing re-judged it.
  const staleRounds = [...new Set(
    run.nodes
      .filter((n) => n.stage === 'gate' && n.subgoal_id === null && !n.final
        && (n.deps.includes(gate) || (n.after || []).includes(gate)))
      .map((n) => goalRoundOf(n.node_id))
      .filter((r) => r != null),
  )];
  for (const round of staleRounds) {
    const siblings = goalGateSiblings(run, round);
    if (siblings.some((s) => s.state === 'pending' || s.state === 'running')) continue; // still live, not stale
    const rejecting = siblings.filter((s) => s.state === 'failed');
    if (!rejecting.length) continue; // the round accepted; nothing stale to replace
    const fb = rejecting
      .flatMap((old) => [old.result && old.result.reason, ...((old.result && old.result.gaps) || [])])
      .filter(Boolean).join('\n- ');
    const { ids: fresh } = pushGoalGateRound(run, siblings[0].deps.slice(), { feedback: fb, supersedes: siblings.map((s) => s.node_id), ...((siblings[0].after || []).length ? { after: siblings[0].after.slice() } : {}) }, run.goal_judges || siblings.length);
    const oldIds = new Set(siblings.map((s) => s.node_id));
    for (const n of run.nodes) {
      if (!n.after || !n.after.some((d) => oldIds.has(d))) continue;
      n.after = [...new Set([...n.after.filter((d) => !oldIds.has(d)), ...fresh])];
    }
  }
  return { run: saveRun(run), attempt, reason: '', rollback };
}

// A critique that rejects the spec has nowhere to go otherwise: team_retry only knows
// subgoals, so the run would dead-end holding a spec everyone agrees is wrong. Redo
// setgoal with the critique's problems, and discard the subgoal graph the old spec
// produced - a new spec may decompose differently.
export function retrySpec(run, feedback) {
  // A parent_shaped run has no setgoal/critique to redo - its "spec" IS the one subgoal the
  // parent already shaped. A caller that asks for a spec-level retry anyway (autoReassign's
  // twice-rejected-for-the-same-reason escalation, or a bare team_retry({run_id})) gets the
  // one retry this run actually has: a fresh attempt of that subgoal's chain.
  if (run.parent_shaped) {
    const sg = run.spec && Array.isArray(run.spec.subgoals) ? run.spec.subgoals[0] : null;
    if (sg) return retrySubgoal(run, sg.id, feedback);
  }
  const priors = run.nodes.filter((n) => n.stage === 'setgoal');
  const attempt = priors.length + 1;
  if (attempt > run.max_retries + 1) {
    const dead = run.nodes.filter((n) => (n.stage === 'setgoal' || n.stage === 'critique') && n.state === 'failed' && !n.final);
    const unreachable = dead.flatMap((n) => settleFailure(run, n));
    return { run: saveRun(run), attempt: null, reason: 'retry budget exhausted', unreachable };
  }

  for (const n of run.nodes) {
    // `repair` joins the run-level stages retired here: escalation discards the
    // subgoal graph a rejected spec produced, and a pending repair over that graph's
    // goal gate has nothing left to fix. A repair already RUNNING cannot be retired -
    // its commits are already in the tree, and it stays in the graph as evidence of
    // what was tried, exactly like a retried subgoal's superseded attempt.
    if (n.stage === 'setgoal' || n.stage === 'critique' || n.subgoal_id || n.stage === 'report'
      || n.stage === 'repair' || (n.stage === 'gate' && n.subgoal_id === null)) {
      if (n.state === 'pending' || n.state === 'failed') {
        n.state = 'skipped';
        n.result = n.result || { stage_ok: false, reason: `superseded by spec attempt ${attempt}` };
      }
    }
  }
  run.spec = null;

  const sg = `setgoal:${attempt}`;
  const cr = `critique:${attempt}`;
  run.nodes.push(node(sg, 'setgoal', ['plan'], { attempt, feedback: feedback || '' }));
  run.nodes.push(node(cr, 'critique', [sg], { attempt }));
  return { run: saveRun(run), attempt, reason: '' };
}

// An order-only dep is satisfied once it can no longer change: it finished, was retired,
// can never run, or failed with no retry left. A plain `failed` is not settled - the
// orchestrator may still retry it, and the report must not run ahead of that.
function settled(dep) {
  return dep.state === 'done' || dep.state === 'skipped' || dep.state === 'unreachable'
    || (dep.state === 'failed' && dep.final === true);
}

// Which deps still hold this node back, by kind. Empty means runnable.
export function unmetDeps(run, n) {
  const data = n.deps.filter((d) => (getNode(run, d) || {}).state !== 'done');
  const order = (n.after || []).filter((d) => { const dep = getNode(run, d); return !dep || !settled(dep); });
  return [...data, ...order];
}

function depsSatisfied(run, n) {
  return unmetDeps(run, n).length === 0;
}

export function readyNodes(run) {
  return run.nodes.filter((n) => n.state === 'pending' && depsSatisfied(run, n));
}

// A human-pinned node that has just become ready parks here instead of ever being offered to a
// driver: docs/plans/2026-09-17-teams-team-v0.13.0.md §0.1 fixes `waiting_human` as a node
// state, not a vendor, and §0.3 fixes human OUT of the routing pool entirely - the only way in
// is this pin (`node.assignment.executor === 'human'`, written by the spec's own `assignee`
// field via applyHumanPin, or by tm_assign at runtime). Nothing in this engine polls a model for
// a node in this state: the MAIN session's tm_inbox is the only reader, and a human's own
// tm_submit (taskmanager.mjs) is the only writer that ever clears it. Same shape as
// settleFailure - a pure mutation over run.nodes, called at the one place readiness is computed
// for a driver (broker.mjs's team_next), not hidden inside readyNodes itself so a caller that
// only wants to READ readiness (tickets.mjs, runState below) never mutates by accident.
export function promoteWaitingHuman(run) {
  const touched = [];
  for (const n of run.nodes) {
    if (n.state !== 'pending') continue;
    if (!n.assignment || n.assignment.executor !== 'human') continue;
    if (unmetDeps(run, n).length) continue;
    n.state = 'waiting_human';
    n.waiting_since = Date.now();
    touched.push(n);
  }
  return touched;
}

// gate:human (D2 Task 4, docs/plans/2026-09-23-teams-reducer-human-rollback.md §1): a
// configurable human approval gate over a judging stage, set with the team option
// `human_gates: ['critique', 'gate', 'gate:goal', ...]` (run.human_gates, threaded the same way
// run.interactive is - teamconfig.mjs, task.child_opts, createRun). Only a VERDICT-bearing
// judging stage can be gated this way - one whose contract already reduces to a single
// accept/reject boolean the engine can act on (HUMAN_GATE_VERDICT_FIELD below); an authoring
// stage (implement, draft, shape's own package proposal) has no such field and is left alone
// even if named in human_gates by mistake.
//
// A gated node never reaches a driver: the human's own accept/reject IS the node's result,
// submitted through the exact same tm_submit({key, payload}) path a pinned author stage uses,
// so every downstream hook that already reads a stage's result (autoReassign's retry, shape's
// expandPackages, a package's own accept feeding the manager) keeps working unmodified - a
// human's verdict and a model's verdict are the same shape once they land on the node.
export const HUMAN_GATE_VERDICT_FIELD = { gate: 'accept', critique: 'sound', accept: 'accept', integrate: 'verified' };

// gate:goal is `stage: 'gate'` with `subgoal_id: null` on both the child-run graph
// (expandSubgoals' pushGoalGateRound) and the manager graph (taskmanager.mjs's own
// pushGoalGateRound) - composeTaskPrompt already tells the two apart this same way (by
// node_id prefix, not by stage) to pick the right CONTRACT text, so this reuses that test
// rather than inventing a second one.
export function humanGateIdentity(n) {
  return n.node_id.startsWith('gate:goal') ? 'gate:goal' : n.stage;
}

export function humanGateVerdictField(n) {
  return humanGateIdentity(n) === 'gate:goal' ? 'accept' : (HUMAN_GATE_VERDICT_FIELD[n.stage] || null);
}

// The default result for a human_gates node when nobody is watching (run.interactive is
// false): auto-pass, recorded as decided-for-you rather than left to block a run nobody can
// unblock. Mirrors applyHumanPin's own non-interactive default (dispatch instead of park) in
// spirit, but a gate has no AI fallback to dispatch to - the whole point of naming a stage in
// human_gates is that a person, not a model, judges it - so the only non-blocking default is
// to pass it, exactly as an ungated run would if nobody had configured a gate here at all.
export function autoPassHumanGateResult(n) {
  const field = humanGateVerdictField(n);
  return {
    stage_ok: true,
    ...(field ? { [field]: true } : {}),
    // match_pct/attacks only matter to a 'gate'/'gate:goal' node (nodeSucceeded's own floor and
    // no-attacks-no-pass checks, broker.mjs) - harmless extra fields on critique/accept/integrate.
    ...(field === 'accept' ? { match_pct: 100, attacks: ['gate:human: not interactive, auto-passed - no invocation was made'] } : {}),
    checks: ['human_gates named this stage but the run is not interactive - auto-passed'],
    gaps: [],
    reason: 'auto-passed (decided for you, not interactive)',
    evidence: 'gate:human default: a non-interactive run cannot block on a person, so it passes',
  };
}

// Parks a human_gates node in waiting_human (interactive) or marks it for the caller to
// auto-pass (not interactive) the moment it becomes ready - the same "called at the one place
// readiness is computed for a driver" seam promoteWaitingHuman documents above, but kept as its
// own function rather than folded into it: promoteWaitingHuman's pin is written by someone
// upstream (a spec, tm_assign) before this runs, while a human_gates pin is decided HERE, from
// team config, the first time the node is seen - `human_gate_seen` marks that decision made so
// a later poll (this runs on every team_next) never re-decides a node already parked or
// auto-passed. Works over any run-shaped object with `.nodes`/`.human_gates`/`.interactive` -
// task.json (the manager graph) qualifies exactly as a graph.mjs run does.
export function promoteHumanGates(run) {
  const gates = new Set(run.human_gates || []);
  const parked = [];
  const autoPass = [];
  if (!gates.size) return { parked, autoPass };
  for (const n of run.nodes) {
    if (n.state !== 'pending' || n.human_gate_seen) continue;
    if (!humanGateVerdictField(n)) continue;
    if (!gates.has(humanGateIdentity(n))) continue;
    if (unmetDeps(run, n).length) continue;
    n.human_gate_seen = true;
    n.human_gate = true;
    if (run.interactive) {
      n.assignment = { executor: 'human', vendor: 'human', who: null, reason: 'human_gates (team config)' };
      n.state = 'waiting_human';
      n.waiting_since = Date.now();
      parked.push(n);
    } else {
      n.auto_decided_pin = {
        by: 'auto',
        reason: `${humanGateIdentity(n)} is in human_gates but this run is not interactive - auto-passed instead of parking`,
        at: Date.now(),
      };
      autoPass.push(n);
    }
  }
  return { parked, autoPass };
}

// The human's own accept/reject, in the same shape a driver's JSON would have been. `gaps`
// rides straight into the retry path unchanged - a rejected `gate`/`gate:goal` already reads
// `result.gaps` to brief the next attempt, so a human's reasons reach it exactly the way a
// model gate's own gaps[] would, with no separate wiring needed.
export function humanGateResultFromPayload(n, payload) {
  const field = humanGateVerdictField(n);
  const p = payload && typeof payload === 'object' ? payload : {};
  const accept = p.accept === true;
  const reason = (typeof p.reason === 'string' && p.reason) || (accept ? 'approved by a person (gate:human)' : 'rejected by a person (gate:human)');
  return {
    stage_ok: true,
    ...(field ? { [field]: accept } : {}),
    ...(field === 'accept' ? { match_pct: accept ? 100 : 0, attacks: [`gate:human: ${reason}`] } : {}),
    checks: [`human accept/reject: ${reason}`],
    gaps: Array.isArray(p.gaps) ? p.gaps : [],
    observations: [],
    reason,
    evidence: 'gate:human: a person judged this node directly, not a model',
  };
}

// The public shape of goal-gate consensus, trimmed of internal bookkeeping
// (`routing_failure` stays out - it means "not decided yet", not a verdict).
function publicGoalVerdict(c) {
  if (!c || !c.settled) return null;
  return { accept: c.accept, match_pct: c.match_pct, judges: c.judges, gaps: c.gaps, spec_drift: c.spec_drift };
}

export function runState(run) {
  const counts = { pending: 0, running: 0, done: 0, failed: 0, skipped: 0, unreachable: 0, waiting_human: 0 };
  for (const n of run.nodes) counts[n.state] = (counts[n.state] || 0) + 1;

  // The most recently SETTLED goal-gate round's consensus, once one exists - surfaced
  // here so a caller reading run state does not have to re-derive it from the node
  // list. "most recent" skips a newer round a repair already opened but that has not
  // finished judging yet - that round has no verdict of its own to report, and the
  // prior one's is still the honest answer to "did the run's goal gate accept".
  const rounds = [...new Set(
    run.nodes
      .filter((n) => n.stage === 'gate' && n.subgoal_id === null)
      .map((n) => goalRoundOf(n.node_id))
      .filter((r) => r != null),
  )].sort((a, b) => b - a);
  let goalVerdict = null;
  for (const r of rounds) {
    const c = goalConsensus(run, r);
    if (c && c.settled) { goalVerdict = publicGoalVerdict(c); break; }
  }
  const withVerdict = (s) => (goalVerdict ? { ...s, goal_verdict: goalVerdict } : s);

  // A parent_shaped run has no gate:goal and no report node (§3 of docs/plans/
  // 2026-09-21-teams-server-owns-the-loop.md) - it IS the one subgoal's chain, so its
  // terminal gate stands in for both: done means complete, and the ordinary blocked/running
  // reads below still apply to everything short of that.
  if (run.parent_shaped) {
    const terminal = parentShapedTerminal(run);
    if (terminal && terminal.state === 'done') return withVerdict({ state: 'complete', counts });
    // Checked exactly where `blocked` would otherwise fire, not before it: readyNodes() already
    // excludes a waiting_human node (it left 'pending' the moment promoteWaitingHuman parked
    // it), so without this a run with NOTHING ELSE ready reads exactly like a genuine deadlock -
    // the sizing document's own §4.2 risk. A sibling subgoal still being offered or worked is a
    // different fact - the run is still `running`, same as it would be blocked on nothing at
    // all; only the "otherwise blocked" case gets the more honest word. See graph.mjs's
    // promoteWaitingHuman for who sets the node state this reads.
    if (!readyNodes(run).length && !counts.running && run.nodes.some((n) => n.state === 'waiting_human')) {
      return withVerdict({ state: 'waiting_human', counts });
    }
    if (run.routing_blocked && !counts.running) return withVerdict({ state: 'blocked', counts });
    if (!readyNodes(run).length && !counts.running) return withVerdict({ state: 'blocked', counts });
    return withVerdict({ state: 'running', counts });
  }

  // Only a finished report means the run finished. Deciding on "nothing pending" once
  // let a spec retry that rebuilt no nodes report itself complete having implemented
  // nothing - the worst kind of failure, because it looks like success.
  const reports = run.nodes.filter((n) => n.stage === 'report');
  if (reports.some((n) => n.state === 'done')) {
    // `complete` says the graph terminated normally; on its own it does not say the run
    // delivered. A report is also written over a settled failure - a retry budget ran out,
    // settleFailure released everything downstream as unreachable, and the report says plainly
    // what did not ship (idol-pm-1, 2026-09-22: three shaping attempts, zero packages
    // dispatched, and every machine-readable surface above the prose reading success). `settled`
    // carries that distinction without changing the state string, so no caller switching on
    // 'complete' flips behaviour while every surface that wants the truth can ask for it. The
    // ticket layer's SETTLED is the same fact, named for a board.
    const settled = counts.unreachable > 0;
    return withVerdict(settled ? { state: 'complete', settled: true, counts } : { state: 'complete', counts });
  }
  // Same reuse the parent_shaped branch above relies on - tickets.mjs's epicTicketState and
  // taskmanager.mjs's task-level runState(task) call this same function (task.json is itself a
  // "run" with a .nodes array), so this one branch fixes both levels at once. Gated on "nothing
  // else ready or running" for the same reason the parent_shaped branch is: a sibling subgoal
  // still moving means the run is still `running`, not waiting on anything as a whole.
  if (!readyNodes(run).length && !counts.running && run.nodes.some((n) => n.state === 'waiting_human')) {
    return withVerdict({ state: 'waiting_human', counts });
  }
  if (run.routing_blocked && !counts.running) return withVerdict({ state: 'blocked', counts });
  // Blocked means nothing can proceed - not merely that nothing is pending. A node
  // waiting on a dependency that failed is still pending and still stuck.
  if (!readyNodes(run).length && !counts.running) return withVerdict({ state: 'blocked', counts });
  return withVerdict({ state: 'running', counts });
}

// What a node needs to know to be executed, assembled from what the graph already
// holds. The orchestrator should not have to remember any of this itself.
export function nodeBriefing(run, n) {
  // Prose only was not enough. A gate briefed with a handoff and a one-line summary
  // correctly rejected the work as undemonstrated: "no raw output or exit status was
  // provided". The checks the executor ran, the commands the adapter observed, and the
  // files it touched are the evidence - withholding them and then asking for proof is
  // the same mistake as briefing critique without the subgoals.
  // A subgoal gate depends only on that subgoal's test node, so briefing it from deps
  // alone showed it the verification and hid the implementation it was judging. Give a
  // gate the whole attempt it is ruling on.
  const inScope = (x) => {
    if (n.deps.includes(x.node_id) || (n.after || []).includes(x.node_id)) return true;
    return n.stage === 'gate'
      && n.subgoal_id
      && x.subgoal_id === n.subgoal_id
      && (x.attempt || 1) === (n.attempt || 1)
      && x.node_id !== n.node_id;
  };
  const upstream = run.nodes
    .filter((x) => inScope(x) && x.result)
    .map((x) => ({
      node_id: x.node_id,
      stage: x.stage,
      state: x.state,
      handoff: x.result.handoff || '',
      // A person's answers on an `ask` card. Carried explicitly because none of the ordinary
      // fields hold them - a decision is not a handoff, a check or a changed file - and the
      // stage below (draft) exists to write the answer down.
      decisions: Array.isArray(x.result.decisions) ? x.result.decisions : [],
      evidence: x.result.evidence || '',
      checks: x.result.checks || [],
      // An execute node's own deliverable when verified:false (prompts.mjs's execute contract):
      // this is what a QA subgoal's own gate must see to judge whether the case set was run and
      // reported, not just its checks[] summary of pass/fail per case.
      defects: Array.isArray(x.result.defects) ? x.result.defects : [],
      // A defect implement/test found OUTSIDE this package's own scope, in an upstream package
      // it deps on (prompts.mjs's UPSTREAM_DEFECT_CONTRACT) - this package's own gate must see
      // every one of them to carry them through into its own "upstream_defects", the same way it
      // already carries an execute node's `defects` through for a QA subgoal.
      upstream_defects: Array.isArray(x.result.upstream_defects) ? x.result.upstream_defects : [],
      changed_files: x.result.changed_files || [],
      changed_files_verified: x.result.changed_files_verified,
      verified: x.result.verified,
      commands: (x.result.event_evidence && x.result.event_evidence.commands) || [],
      commands_executed: x.result.event_evidence ? x.result.event_evidence.commands_executed : undefined,
      commands_failed: x.result.event_evidence ? x.result.event_evidence.commands_failed : undefined,
    }));

  // What a person has already decided for this owner, including on attempts this one superseded.
  // A retry rebuilds the chain with fresh deps, so a superseded `ask` node is out of `upstream`'s
  // scope entirely and the new attempt's investigate had no way to know a question was settled -
  // idol-beta-ask1 (2026-09-25) re-raised six of them, two word for word. openAsk drops the exact
  // repeats; this is what stops the rewordings, by telling the stage that writes the questions.
  const priorDecisions = answeredDecisions(run)
    .filter((d) => !(n.stage === 'ask' && (n.questions || []).some((q) => (q.question || q.unknown) === d.question)));

  const sg = run.spec && n.subgoal_id
    ? (run.spec.subgoals || []).find((s) => String(s.id) === String(n.subgoal_id))
    : null;

  // A node that judges the spec as a whole - critique, the goal gate, report - must see
  // the subgoals. Briefing it with only the goal made critique complain that the
  // decomposition "references U1 and U2 without defining them": it was being asked to
  // review a document half of which was withheld.
  const specWide = !n.subgoal_id && run.spec ? run.spec.subgoals || [] : null;

  // The goal gate and the report judge the run as a whole, but their direct deps are
  // only the subgoal gates - so briefing them with deps alone left the report holding
  // one line of gate evidence and nothing about what was actually built. Give them
  // every finished node, including the failures: "what was not done and why" cannot be
  // written from a list of successes.
  // By stage, not by id: after a spec retry the live report is `report:N`, and matching
  // the bare name left that report briefed with nothing but its order-only upstream.
  // repair joins this branch (Step 9): it fixes across the tree at the seams a rejected
  // goal gate found, not one subgoal's slice, so it needs the same whole-run view the
  // goal gate itself gets - plus, via `prior_feedback` below (n.feedback, set when
  // repair is opened), the rejecting round's reason and gaps.
  const wholeRun = n.stage === 'report' || n.node_id.startsWith('gate:goal') || n.stage === 'repair'
    ? run.nodes
        .filter((x) => x.result && x.node_id !== n.node_id)
        .map((x) => ({
          node_id: x.node_id,
          stage: x.stage,
          state: x.state,
          vendor: x.vendor || null,
          handoff: x.result.handoff || '',
          evidence: x.result.evidence || '',
          checks: x.result.checks || [],
          // Same reasoning as upstream's own `defects` above - the report and the goal gate
          // both read every finished node here (not just deps), so an execute node's defects
          // must be visible in this list too, not only to the subgoal gate beside it.
          defects: Array.isArray(x.result.defects) ? x.result.defects : [],
          upstream_defects: Array.isArray(x.result.upstream_defects) ? x.result.upstream_defects : [],
          changed_files: x.result.changed_files || [],
          changed_files_verified: x.result.changed_files_verified,
          verified: x.result.verified,
          accept: x.result.accept,
          sound: x.result.sound,
          match_pct: x.result.match_pct,
          // A gate's gaps, or a critique's blocking defects and problems: whatever the
          // judging node said was wrong. The report cannot explain a dead spec otherwise.
          gaps: x.result.gaps || [...(x.result.blocking || []), ...(x.result.problems || [])],
          reason: x.result.reason || x.result.verification_error || '',
        }))
    : null;

  // A setgoal retry's feedback is one flat string by the time it reaches this node -
  // retrySpec joined it from whichever node rejected the prior attempt. That collapses two
  // different situations: a critique that rejected the spec on its merits (blocking/problems),
  // and a setgoal draft that validateSpec itself threw out before any judgment happened
  // (spec_problems). Only the second is the structural-validation failure the degenerate-spec
  // diagnosis in prompts.mjs is for, so recover it here from the actual prior setgoal attempt's
  // result rather than guessing from the joined string.
  const priorSetgoal = n.stage === 'setgoal' && (n.attempt || 1) > 1
    ? run.nodes.find((x) => x.stage === 'setgoal' && (x.attempt || 1) === (n.attempt || 1) - 1)
    : null;
  const specProblems = priorSetgoal && priorSetgoal.result && Array.isArray(priorSetgoal.result.spec_problems)
    && priorSetgoal.result.spec_problems.length
    ? priorSetgoal.result.spec_problems
    : null;

  // The deterministic sibling write-scope check (item 2): shown to the fold itself and to the
  // goal gate that judges behind it, so a collision or an undeclared writer is visible before
  // either has to trust the `reduce` LLM pass's own prose reading of the same disk state.
  const writeScope = (n.stage === 'reduce' || (n.stage === 'gate' && n.subgoal_id == null))
    ? computeWriteScope(run, n)
    : null;

  return {
    run_id: run.run_id,
    node_id: n.node_id,
    stage: n.stage,
    attempt: n.attempt,
    cwd: run.cwd,
    request: run.request,
    context: run.context,
    flow: run.flow || 'auto',
    flow_chosen: flowOf(run),
    default_kind: defaultKind(run),
    mixed: run.mixed !== false,
    size: run.size || null,
    goal: run.spec ? run.spec.goal : null,
    goal_acceptance: run.spec ? run.spec.acceptance || [] : [],
    subgoal: sg || null,
    subgoals: specWide,
    whole_run: wholeRun,
    prior_feedback: n.feedback || '',
    spec_problems: specProblems,
    upstream,
    prior_decisions: priorDecisions,
    // Non-interactive only: questions nobody will ever answer, each decided by its recommended
    // (first) option. code-sprint-S2's PLAN wrote them as open questions with owners, and its
    // gate rejected three rounds at 93-95 because the validation matrix then asserted behaviour
    // the same document called unresolved - a contradiction no revise could close while the
    // questions stayed open and unanswerable. Shown to authoring stages, not to investigate
    // (which decides what is open) or ask.
    default_decisions: !run.interactive && ['draft', 'revise', 'implement', 'cases'].includes(n.stage)
      ? (run.unasked || []).filter((u) => u && u.question && ((Array.isArray(u.options) && u.options.length) || u.decided != null))
        .map((u) => ({ question: u.question, chose: u.decided != null ? (typeof u.decided === 'string' ? u.decided : JSON.stringify(u.decided)) : String((u.options[0] && (u.options[0].option || u.options[0])) || ''), owner: u.owner || null, asked_under: u.subgoal_id || null }))
        .filter((d, i, all) => d.chose && all.findIndex((x) => x.question === d.question) === i)
      : [],
    write_scope: writeScope,
    reasoning_stage: REASONING_STAGES.has(n.stage),
  };
}
