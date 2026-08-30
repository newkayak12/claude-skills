// graph.mjs - the harness flow as a persisted node graph.
//
// The broker owns WHICH nodes exist, in what order, and who may execute each one.
// It does not own what happens inside a node - that is the model's job, whichever
// vendor gets assigned. Splitting it this way is the point: the flow stops being
// something each orchestrator re-improvises in prose and becomes state on disk that
// survives a restart and can be read by a hook.
//
// Runs live at <cwd>/.harness-run/broker/runs/<run_id>.json.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const STAGES = [
  'plan',      // decompose the raw request
  'setgoal',   // turn the plan into a goal-spec
  'critique',  // adversarial pass over the goal-spec (judge != author)
  'implement', // per subgoal
  'test',      // per subgoal, verification-only
  'gate',      // per subgoal, then once at goal level (judge != actor)
  'report',    // synthesize from the ledger
];

// Stages whose work is reasoning rather than file mutation. They are still routed and
// still adjudicated, but a claimed file list is not what makes them true, so the
// worktree cross-check has nothing to contradict.
export const REASONING_STAGES = new Set(['plan', 'setgoal', 'critique', 'gate', 'report']);

function runsDir(cwd) {
  return join(cwd, '.harness-run', 'broker', 'runs');
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
    if (cur && cur.state !== 'pending' && n.state === 'pending') continue;
    byId.set(n.node_id, n);
  }
  return { ...fresh, ...mine, nodes: [...byId.values()] };
}

export function saveRun(run) {
  mkdirSync(runsDir(run.cwd), { recursive: true });
  const lock = acquire(run.cwd, run.run_id);
  try {
    const merged = mergeOnto(loadRun(run.cwd, run.run_id), run);
    writeFileSync(runPath(run.cwd, run.run_id), JSON.stringify(merged, null, 2) + '\n');
    // Keep the caller's object consistent with what was written.
    run.nodes = merged.nodes;
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

function node(id, stage, deps, extra) {
  return {
    node_id: id,
    stage,
    deps: deps || [],
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
  }
  for (const sg of subgoals) {
    const id = sg && sg.id != null ? String(sg.id) : '';
    for (const d of (sg && sg.deps) || []) {
      const dep = String(d);
      if (dep === id) problems.push(`subgoal ${id} depends on itself`);
      else if (!ids.has(dep)) problems.push(`subgoal ${id} depends on ${dep}, which is not in the spec`);
    }
  }

  // A cycle deadlocks exactly like a dangling dep, and is just as silent.
  const edges = new Map(subgoals.map((sg) => [String(sg.id), ((sg.deps || []).map(String)).filter((d) => ids.has(d))]));
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
    const impl = `implement:${id}:${round}`;
    const test = `test:${id}:${round}`;
    const gate = `gate:${id}:${round}`;
    run.nodes.push(node(impl, 'implement', [critiqueDep, ...deps], { subgoal_id: id, attempt: round }));
    run.nodes.push(node(test, 'test', [impl], { subgoal_id: id, attempt: round }));
    run.nodes.push(node(gate, 'gate', [test], { subgoal_id: id, attempt: round }));
    gateIds.push(gate);
  }
  const goalGate = `gate:goal:${nextIndex(run, 'gate:goal')}`;
  const reportId = round === 1 ? 'report' : `report:${round}`;
  run.nodes.push(node(goalGate, 'gate', gateIds, { subgoal_id: null }));
  run.nodes.push(node(reportId, 'report', [goalGate]));
  return saveRun(run);
}

// A rejected subgoal gets a fresh attempt rather than a retried node: the old attempt
// stays in the graph as evidence of what was tried and why it failed.
export function retrySubgoal(run, subgoalId, feedback) {
  const prior = run.nodes.filter((n) => n.subgoal_id === subgoalId && n.stage === 'gate');
  const attempt = prior.length + 1;
  if (attempt > run.max_retries + 1) return { run: saveRun(run), attempt: null, reason: 'retry budget exhausted' };

  const impl = `implement:${subgoalId}:${attempt}`;
  const test = `test:${subgoalId}:${attempt}`;
  const gate = `gate:${subgoalId}:${attempt}`;
  const prevGate = `gate:${subgoalId}:${attempt - 1}`;

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
  const first = run.nodes.find((x) => x.subgoal_id === subgoalId && x.stage === 'implement');
  const baseDeps = first ? first.deps.slice() : ['critique'];

  run.nodes.push(node(impl, 'implement', baseDeps, { subgoal_id: subgoalId, attempt, feedback: feedback || '' }));
  run.nodes.push(node(test, 'test', [impl], { subgoal_id: subgoalId, attempt }));
  run.nodes.push(node(gate, 'gate', [test], { subgoal_id: subgoalId, attempt }));

  // Anything that waited on the old attempt's gate must wait on the new one.
  for (const n of run.nodes) {
    if (n.node_id === gate) continue;
    n.deps = n.deps.map((d) => (d === prevGate ? gate : d));
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
  if (attempt > run.max_retries + 1) return { run: saveRun(run), attempt: null, reason: 'retry budget exhausted' };

  for (const n of run.nodes) {
    if (n.stage === 'setgoal' || n.stage === 'critique' || n.subgoal_id || n.node_id === 'gate:goal:1' || n.node_id === 'report') {
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

function depsSatisfied(run, n) {
  return n.deps.every((d) => {
    const dep = getNode(run, d);
    return dep && dep.state === 'done';
  });
}

export function readyNodes(run) {
  return run.nodes.filter((n) => n.state === 'pending' && depsSatisfied(run, n));
}

export function runState(run) {
  const counts = { pending: 0, running: 0, done: 0, failed: 0, skipped: 0 };
  for (const n of run.nodes) counts[n.state] = (counts[n.state] || 0) + 1;

  // Only a finished report means the run finished. Deciding on "nothing pending" once
  // let a spec retry that rebuilt no nodes report itself complete having implemented
  // nothing - the worst kind of failure, because it looks like success.
  const reports = run.nodes.filter((n) => n.stage === 'report');
  if (reports.some((n) => n.state === 'done')) return { state: 'complete', counts };
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
    if (n.deps.includes(x.node_id)) return true;
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
  const wholeRun = n.node_id === 'report' || n.node_id.startsWith('gate:goal')
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
          match_pct: x.result.match_pct,
          gaps: x.result.gaps || [],
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
