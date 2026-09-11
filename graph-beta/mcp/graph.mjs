// graph.mjs - the harness flow as a persisted node graph.
//
// The broker owns WHICH nodes exist, in what order, and who may execute each one.
// It does not own what happens inside a node - that is the model's job, whichever
// vendor gets assigned. Splitting it this way is the point: the flow stops being
// something each orchestrator re-improvises in prose and becomes state on disk that
// survives a restart and can be read by a hook.
//
// Runs live at <cwd>/.harness-run/broker-beta/runs/<run_id>.json.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const STAGES = [
  'plan',      // decompose the raw request
  'setgoal',   // turn the plan into a goal-spec
  'critique',  // adversarial pass over the goal-spec (judge != author)
  'implement', // per code subgoal
  'test',      // per code subgoal, verification-only
  'draft',     // per document subgoal
  'review',    // per document subgoal, reader's pass (reviewer != author)
  'gate',      // per subgoal, then once at goal level (judge != actor)
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
export const KINDS = {
  subgoal: { chain: ['implement', 'test', 'gate'], reasoning: [] },
  document: { chain: ['draft', 'review', 'gate'], reasoning: ['review'] },
};
export const DEFAULT_KIND = 'subgoal';

export function kindOf(sg) {
  return sg && sg.kind != null ? String(sg.kind) : DEFAULT_KIND;
}

// Stages whose work is reasoning rather than file mutation. They are still routed and
// still adjudicated, but a claimed file list is not what makes them true, so the
// worktree cross-check has nothing to contradict. The run-level stages are fixed; the
// per-subgoal ones come from the kind table so a new kind cannot forget to declare them.
const BASE_REASONING = ['plan', 'setgoal', 'critique', 'gate', 'report'];
export const REASONING_STAGES = new Set([
  ...BASE_REASONING,
  ...Object.values(KINDS).flatMap((k) => k.reasoning || []),
]);

// The field that carries a judging node's verdict. stage_ok on these nodes means only
// "the judging itself worked"; the verdict must be present and affirmative for the node
// to count as done. A stage absent here has no verdict beyond stage_ok.
export const VERDICT_FIELD = { gate: 'accept', critique: 'sound', test: 'verified', review: 'verified' };

// The stage a kind's chain opens with - the one whose author a later stage must not be.
export function authorStage(kind) {
  return (KINDS[kind] || KINDS[DEFAULT_KIND]).chain[0];
}

// The kind of the subgoal a node belongs to, from the run's spec. Run-level nodes have none.
export function nodeKind(run, n) {
  if (!n || !n.subgoal_id || !run.spec) return null;
  const sg = (run.spec.subgoals || []).find((s) => String(s.id) === String(n.subgoal_id));
  return sg ? kindOf(sg) : null;
}

function runsDir(cwd) {
  return join(cwd, '.harness-run', 'broker-beta', 'runs');
}

function runPath(cwd, runId) {
  return join(runsDir(cwd), runId + '.json');
}

// A run file is read-modify-written by every mutation, and a node can be held open for
// minutes while a vendor works. Two brokers on one run therefore raced: the slow one's
// stale snapshot overwrote a node the fast one had already finished and reported `done`
// to its client. The work had happened; only the record vanished.
//
// mkdir is atomic on every filesystem we care about, so it is the lock.
const LOCK_STALE_MS = 30 * 1000;

function lockPath(cwd, runId) {
  return runPath(cwd, runId) + '.lock';
}

function acquire(cwd, runId) {
  const lock = lockPath(cwd, runId);
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
    if (cur && cur.state !== 'pending' && n.state === 'pending' && !recoveringOwnExecution) continue;
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
  mkdirSync(runsDir(run.cwd), { recursive: true });
  const lock = acquire(run.cwd, run.run_id);
  try {
    const merged = mergeOnto(loadRun(run.cwd, run.run_id), run);
    writeFileSync(runPath(run.cwd, run.run_id), JSON.stringify(merged, null, 2) + '\n');
    // Keep the caller's object consistent with what was written.
    run.nodes = merged.nodes;
    run.capacity_epoch = merged.capacity_epoch || 0;
    run.unavailable_vendors = merged.unavailable_vendors || {};
    return run;
  } finally {
    release(lock);
  }
}

export function loadRun(cwd, runId) {
  try {
    return JSON.parse(readFileSync(runPath(cwd, runId), 'utf8'));
  } catch {
    return null;
  }
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
function node(id, stage, deps, extra) {
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
    // one vendor was chosen once at graph_open and used for plan, implement and report
    // alike, while `model` existed only as an argument the caller had to remember on
    // every single graph_run. Policy makes that a property of the run instead.
    policy: opts.policy && typeof opts.policy === 'object' ? opts.policy : {},
    candidates: opts.candidates || null,
    sandbox: opts.sandbox || null,
    isolated: opts.isolated === true,
    max_retries: Number.isInteger(opts.max_retries) ? opts.max_retries : 2,
    created_at: Date.now(),
    spec: null,
    nodes: [
      node('plan', 'plan', []),
      node('setgoal', 'setgoal', ['plan']),
      node('critique', 'critique', ['setgoal']),
    ],
  };
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
  return {
    vendor: entry.vendor === undefined ? run.vendor : entry.vendor,
    candidates: entry.candidates === undefined ? run.candidates : entry.candidates,
    sandbox: entry.sandbox === undefined ? run.sandbox : entry.sandbox,
    model: entry.model === undefined ? (run.model || null) : entry.model,
  };
}

export function getNode(run, nodeId) {
  return run.nodes.find((n) => n.node_id === nodeId) || null;
}

// A malformed spec does not fail loudly on its own - it fails as a deadlock much later,
// which is far harder to read. Each of these was observed: a setgoal that returned no
// spec left the graph at three nodes; a spec with zero subgoals made the goal gate
// immediately ready over no work at all; a dep naming a subgoal that does not exist left
// its node waiting on a gate that could never be created.
export function validateSpec(spec) {
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
function nextIndex(run, prefix) {
  return run.nodes.filter((n) => n.node_id === prefix || n.node_id.startsWith(prefix + ':')).length + 1;
}

// One attempt of one subgoal: the kind's chain, wired head to tail. Returns the gate id.
function pushChain(run, kind, subgoalId, attempt, headDeps, headAfter, headExtra) {
  const { chain } = KINDS[kind] || KINDS[DEFAULT_KIND];
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
    gateIds.push(pushChain(run, kindOf(sg), id, round, [critiqueDep, ...deps], after, {}));
  }
  const goalGate = `gate:goal:${nextIndex(run, 'gate:goal')}`;
  const reportId = round === 1 ? 'report' : `report:${round}`;
  run.nodes.push(node(goalGate, 'gate', gateIds, { subgoal_id: null }));
  // Order-only: the report waits for the goal gate to be settled, not to pass. A run
  // whose subgoal ran out of retries used to end `blocked` with the passing subgoals'
  // work never reported - partial success was simply lost.
  run.nodes.push(node(reportId, 'report', [], { after: [goalGate] }));
  return saveRun(run);
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

  // The new attempt starts from the same upstream the first attempt had, not from the
  // attempt that just failed.
  const headStage = (KINDS[kind] || KINDS[DEFAULT_KIND]).chain[0];
  const first = run.nodes.find((x) => x.subgoal_id === subgoalId && x.stage === headStage);
  const baseDeps = first ? first.deps.slice() : ['critique'];
  const baseAfter = first ? (first.after || []).slice() : [];

  const gate = pushChain(run, kind, subgoalId, attempt, baseDeps, baseAfter, { feedback: feedback || '' });

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
  return { run: saveRun(run), attempt, reason: '' };
}

// A critique that rejects the spec has nowhere to go otherwise: graph_retry only knows
// subgoals, so the run would dead-end holding a spec everyone agrees is wrong. Redo
// setgoal with the critique's problems, and discard the subgoal graph the old spec
// produced - a new spec may decompose differently.
export function retrySpec(run, feedback) {
  const priors = run.nodes.filter((n) => n.stage === 'setgoal');
  const attempt = priors.length + 1;
  if (attempt > run.max_retries + 1) {
    const dead = run.nodes.filter((n) => (n.stage === 'setgoal' || n.stage === 'critique') && n.state === 'failed' && !n.final);
    const unreachable = dead.flatMap((n) => settleFailure(run, n));
    return { run: saveRun(run), attempt: null, reason: 'retry budget exhausted', unreachable };
  }

  for (const n of run.nodes) {
    if (n.stage === 'setgoal' || n.stage === 'critique' || n.subgoal_id || n.stage === 'report' || (n.stage === 'gate' && n.subgoal_id === null)) {
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

export function runState(run) {
  const counts = { pending: 0, running: 0, done: 0, failed: 0, skipped: 0, unreachable: 0 };
  for (const n of run.nodes) counts[n.state] = (counts[n.state] || 0) + 1;

  // Only a finished report means the run finished. Deciding on "nothing pending" once
  // let a spec retry that rebuilt no nodes report itself complete having implemented
  // nothing - the worst kind of failure, because it looks like success.
  const reports = run.nodes.filter((n) => n.stage === 'report');
  if (reports.some((n) => n.state === 'done')) return { state: 'complete', counts };
  if (run.routing_blocked && !counts.running) return { state: 'blocked', counts };
  // Blocked means nothing can proceed - not merely that nothing is pending. A node
  // waiting on a dependency that failed is still pending and still stuck.
  if (!readyNodes(run).length && !counts.running) return { state: 'blocked', counts };
  return { state: 'running', counts };
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
      evidence: x.result.evidence || '',
      checks: x.result.checks || [],
      changed_files: x.result.changed_files || [],
      changed_files_verified: x.result.changed_files_verified,
      verified: x.result.verified,
      commands: (x.result.event_evidence && x.result.event_evidence.commands) || [],
      commands_executed: x.result.event_evidence ? x.result.event_evidence.commands_executed : undefined,
      commands_failed: x.result.event_evidence ? x.result.event_evidence.commands_failed : undefined,
    }));

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
  const wholeRun = n.stage === 'report' || n.node_id.startsWith('gate:goal')
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

  return {
    run_id: run.run_id,
    node_id: n.node_id,
    stage: n.stage,
    attempt: n.attempt,
    cwd: run.cwd,
    request: run.request,
    context: run.context,
    goal: run.spec ? run.spec.goal : null,
    goal_acceptance: run.spec ? run.spec.acceptance || [] : [],
    subgoal: sg || null,
    subgoals: specWide,
    whole_run: wholeRun,
    prior_feedback: n.feedback || '',
    upstream,
    reasoning_stage: REASONING_STAGES.has(n.stage),
  };
}
