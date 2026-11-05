// broker-routing.mjs - run lookup (knownCwds, mustFindRun, abandoned-node reclaim, the human
// hand-off drain) and routing (which vendor, model and sandbox a node runs on). Cut out of
// broker.mjs (card 128). knownCwds, activeNodes and STALE_AFTER_MS have this module as their one
// owner; the tool handlers import them from here. Imports broker-vendors, broker-independence and
// graph.mjs, never the tools module.

import { resolve } from 'node:path';
import { selectModel, rankCandidates, authorIdentities, demoteAuthors, demoteExecutors } from './routing.mjs';
import {
  REASONING_STAGES,
  loadRun,
  saveRun,
  findRun,
  getNode,
  stagePolicy,
  applyPinAction,
  applyStoryPin,
  drainHumanActions,
} from './graph.mjs';
import { AUTO_CANDIDATES, loadVendors, probe, record, syncOpenNodes } from './broker-vendors.mjs';
import { reviewerModel, submitResult } from './broker-independence.mjs';

// ---------- run lookup ----------

export const knownCwds = new Set();

// team_run is synchronous: while a node runs, the call is held open by the process that
// started it. So a node marked `running` that this process did not start, and that has
// been sitting long enough, belongs to a broker that died - it is not in flight, it is
// abandoned. Without reclaiming it the run wedges forever: team_next offers nothing and
// team_run refuses the node as already running.
export const activeNodes = new Set();
const STALE_AFTER_MS = Number(process.env.BROKER_STALE_AFTER_MS) > 0
  ? Number(process.env.BROKER_STALE_AFTER_MS)
  : 10 * 60 * 1000;

export function reclaimAbandoned(run) {
  let reclaimed = 0;
  for (const n of run.nodes) {
    if (n.state !== 'running') continue;
    const key = `${run.run_id}:${n.node_id}`;
    if (activeNodes.has(key)) continue;
    if (Date.now() - (n.started_at || 0) < STALE_AFTER_MS) continue;
    n.state = 'failed';
    n.result = {
      stage_ok: false,
      reason: 'abandoned: the broker executing this node exited before it finished',
    };
    reclaimed++;
  }
  if (reclaimed) {
    saveRun(run);
    syncOpenNodes(run);
    record(run.cwd, { event: 'node_reclaimed', run_id: run.run_id, count: reclaimed });
  }
  return reclaimed;
}


// Which model a fresh native agent is asked for. `model` is a tier or an id; the host's
// native_models are ids or aliases. Same string, then the host's own model, then a
// declared model that names the same tier ("sonnet" ~ "claude-sonnet-5"); otherwise the
// host model as a marked fallback. null only when the host declared nothing usable.
export function resolveNativeModel(run, model) {
  const list = Array.isArray(run.native_models) ? run.native_models.map(String) : null;
  if (!list || !model) return { model, fallback: false };
  if (model === run.host_model || list.includes(model)) return { model, fallback: false };
  const want = String(model).toLowerCase();
  const tier = (want.match(/(sonnet|opus|haiku|fable|astra|mini|sol|nano)/) || [])[1] || want;
  const hit = list.find((m) => m.toLowerCase().includes(want)) || list.find((m) => m.toLowerCase().includes(tier));
  if (hit) return { model: hit, fallback: false };
  if (run.host_model) return { model: run.host_model, fallback: true };
  return null;
}

export function mustFindRun(a) {
  if (a.cwd) knownCwds.add(resolve(String(a.cwd)));
  const cwd = a.cwd ? resolve(String(a.cwd)) : null;
  const run = (cwd && loadRun(cwd, String(a.run_id))) || findRun(String(a.run_id), knownCwds);
  if (!run) throw new Error(`unknown run ${a.run_id} - pass cwd, or call team_open first`);
  knownCwds.add(run.cwd);
  // Every entry point below funnels through here, so this is "the next step" a queued human
  // pin/submission (tm_assign, tm_submit({key}) - taskmanager.mjs) takes to become real: drained
  // and applied before anything else about this run is read. team_next is the common case - its
  // own promoteWaitingHuman (in toolGraphNext, broker-tools.mjs) is what parks a freshly-pinned
  // card, right after a pin ingested here sets its assignment.
  ingestHandoff(run);
  return run;
}

// See graph.mjs's queueHumanAction/drainHumanActions for why this queue exists at all instead
// of the manager writing the child run directly (the 0.27.3 bug this replaces). Applies each
// action through the exact functions tm_assign/tm_submit's own read-only preview already ran -
// applyPinAction for a pin, computeSubmitResult+finishNode for a submission - so a human's
// report gets the identical worktree cross-check and autoReassign retry/escalate path any other
// executor's does, not a second implementation of either.
export function ingestHandoff(run) {
  const queue = drainHumanActions(run.cwd, run.run_id);
  if (!queue.length) return;
  let touched = false;
  for (const action of queue) {
    if (action.kind === 'pin') {
      if (applyPinAction(run, action)) touched = true;
    } else if (action.kind === 'story_pin') {
      if (applyStoryPin(run, action)) touched = true;
    } else if (action.kind === 'submit') {
      const n = getNode(run, action.node_id);
      if (!n || n.state !== 'waiting_human') continue; // already resolved (or stale), nothing to apply
      if (action.answered_at) n.answered_at = action.answered_at;
      submitResult(run, n, action.payload, 'human');
      touched = true;
    }
  }
  // finishNode (called by submitResult) already saves; a pin-only queue does not touch saveRun
  // anywhere else, so it needs its own here.
  if (touched) saveRun(run);
}

// ---------- routing ----------

export async function route(run, node) {
  if (node.assignment && !(run.unavailable_vendors || {})[node.assignment.executor]) return node.assignment;
  const stage = node.stage;
  const pol = stagePolicy(run, node);
  const vendors = loadVendors(run.cwd);
  const want = String(pol.vendor || 'auto').toLowerCase();
  const balanced = run.allocation === 'balanced';
  const isSelf = ['self', 'off', 'none'].includes(want) || (!balanced && want === 'claude');
  // 'human' never enters the automatic candidate pool, even if a caller's own policy names it
  // (team_open({candidates: ['human', 'claude']}) among them) - §0.3 of _repo/docs/plans/2026-09-17-
  // teams-team-v0.13.0.md fixes this: the only way a node goes to a human is the pin
  // (node.assignment, honored by this function's early return above), never a ranked choice.
  // vendors[name] already has no 'human' entry, so ranking never PICKED it either - this is
  // belt and suspenders, not a bug fix, and keeps it that way on purpose.
  const order = (isSelf
    ? []
    : want === 'auto'
      ? (pol.candidates || (balanced ? ['claude', 'codex'] : AUTO_CANDIDATES(run.host_vendor)))
      : [want]).filter((v) => v !== 'human');

  const attempts = [];
  // Author != judge under either allocation (m3): the balanced ranking only discounted the
  // author, and the ordered one never looked - critique ran on setgoal's own vendor. A judging
  // node's author goes last; it still runs there when nothing else is ready.
  const predictModel = (name) => (balanced ? selectModel(run, node, name, pol.model) : pol.model) || null;
  const ranked = demoteExecutors(demoteAuthors(balanced && want === 'auto' ? rankCandidates(run, node, order)
    : order.map(vendor => ({ vendor, reason: 'explicit vendor/candidate order' })), authorIdentities(run, node), predictModel), node.avoid_executors);
  for (const candidate of ranked) {
    const name = candidate.vendor;
    if ((run.unavailable_vendors || {})[name]) {
      attempts.push({ vendor: name, ready: false, reason: run.unavailable_vendors[name] });
      continue;
    }
    const model = balanced ? selectModel(run, node, name, pol.model) : pol.model;
    if (balanced && name === run.host_vendor) {
      // native_models declares actual model selection capability, independently from the
      // driving conversation's model. The defaults name a tier ("sonnet"); the host names
      // ids ("claude-sonnet-5") or aliases - resolve one against the other before refusing.
      // The host's own model is selectable by definition: a fresh native agent with no
      // model override inherits it. A tier the host did not declare at all falls back to
      // that model, and the reason says so - visible substitution, never a silent one, and
      // never a dead run over a naming mismatch.
      const resolved = resolveNativeModel(run, model);
      if (!resolved) {
        attempts.push({ vendor: name, ready: false, reason: `native host cannot select model ${model}` });
        continue;
      }
      const base = resolved.fallback ? `${candidate.reason}; model ${model} not in native_models, host model used` : candidate.reason;
      const rev = reviewerModel(run, node, resolved.model);
      return { vendor: 'self', executor: name, sandbox: null, model: rev.model, reason: `${base}${rev.note}`, attempts };
    }
    if (name === 'codex' && (run.host_vendor === 'codex' || process.env.CODEX_THREAD_ID)) {
      attempts.push({ vendor: name, ready: false, reason: 'Codex hosts must use native agents; nested Codex CLI is disabled' });
      continue;
    }
    const v = vendors[name];
    if (!v) {
      attempts.push({ vendor: name, ready: false, reason: `unknown vendor "${name}"` });
      continue;
    }
    // A reasoning node writes nothing, so it does not need a writable sandbox.
    const sandbox = REASONING_STAGES.has(stage)
      ? (Array.isArray(v.sandboxes) && v.sandboxes.includes('read-only') ? 'read-only' : pol.sandbox || v.default_sandbox)
      : pol.sandbox || v.default_sandbox || 'workspace-write';
    if (Array.isArray(v.sandboxes) && !v.sandboxes.includes(sandbox)) {
      attempts.push({ vendor: name, ready: false, reason: `vendor "${name}" does not support sandbox ${sandbox}` });
      continue;
    }
    const p = await probe(name, v, run.cwd, sandbox, model);
    const usable = REASONING_STAGES.has(stage) ? p.reachable : p.ready;
    // Spent capacity is recorded on the run so the operator sees why the vendor dropped
    // out, the run stops re-probing it, and team_retry({reset_capacity:true}) is the way back.
    if (!usable && p.quota) {
      run.unavailable_vendors = { ...(run.unavailable_vendors || {}), [name]: p.reason || 'usage capacity exhausted at probe' };
      saveRun(run);
    }
    attempts.push({ vendor: name, ready: usable, reason: usable ? '' : p.reason });
    if (usable) return { vendor: name, executor: name, sandbox, model, reason: candidate.reason, attempts };
  }
  // "auto" degrades to self; a named vendor does not - silent degradation is what lets
  // a graph lie about who did the work.
  return { vendor: isSelf || (!balanced && want === 'auto') ? 'self' : 'vendor-failure', sandbox: null, model: pol.model, attempts };
}
