// graph-ready.mjs - readiness: which deps hold a node back, which nodes may run (cut from graph.mjs).
//
// unmetDeps / readyNodes are pure reads; promoteWaitingHuman is the one mutation, parking a
// human-pinned node the moment it is ready. Builds on graph-nodes.mjs (getNode) only.

import { getNode } from './graph-nodes.mjs';

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
  // A report is the run's last word, so it also waits on anything still live. Its `after` is
  // only the goal gate, and a gate made unreachable by one package's settled failure released
  // the report while another package was still running - code-beta-X3 wrote its report and
  // closed the task with dispatch:P2:3's driver still at work. Pending nodes whose own deps are
  // unmet are not waited on: they may never run, and nothing would release the report then.
  const live = n.stage === 'report' && !data.length && !order.length
    ? run.nodes.filter((x) => x !== n && x.stage !== 'report' && (x.state === 'running' || x.state === 'waiting_human'
      || (x.state === 'pending' && !unmetDeps(run, x).length))).map((x) => x.node_id)
    : [];
  return [...data, ...order, ...live];
}

function depsSatisfied(run, n) {
  return unmetDeps(run, n).length === 0;
}

export function readyNodes(run) {
  return run.nodes.filter((n) => n.state === 'pending' && depsSatisfied(run, n));
}

// A human-pinned node that has just become ready parks here instead of ever being offered to a
// driver: _repo/docs/plans/2026-09-17-teams-team-v0.13.0.md §0.1 fixes `waiting_human` as a node
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
