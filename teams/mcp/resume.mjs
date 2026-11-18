// Where an ended task stopped, and the notice a blocked stop leaves in the ledger (card 129 items
// 5-7). Pure reads of the task graph: no taskmanager import, so drivers, handlers and the daemon
// can all use it without an import cycle.

const PACKAGE = new Set(['dispatch', 'accept']);
const SHAPE = new Set(['shape', 'critique']);
const AREAS = new Set(['areas', 'areas-critique']);

// The node a blocked graph stopped on: the last failed node that is not final, not superseded and
// (for a package) belongs to its subgoal's latest attempt. route says which retry continues it:
// 'package' (dispatch/accept), 'repair' (integrate), 'shape', 'areas'. null when nothing failed.
export function blockedNode(task) {
  const nodes = (task && task.nodes) || [];
  const replaced = new Set(nodes.map((n) => n.supersedes).filter(Boolean));
  const latest = new Map();
  for (const n of nodes) {
    if (!PACKAGE.has(n.stage)) continue;
    latest.set(n.subgoal_id, Math.max(latest.get(n.subgoal_id) || 1, n.attempt || 1));
  }
  let found = null;
  for (const n of nodes) {
    if (n.state !== 'failed' || n.final) continue;
    if (n.result && n.result.superseded_by) continue;
    let route = null;
    if (PACKAGE.has(n.stage)) route = (n.attempt || 1) === latest.get(n.subgoal_id) ? 'package' : null;
    else if (n.stage === 'integrate') route = replaced.has(n.node_id) ? null : 'repair';
    else if (SHAPE.has(n.stage)) route = 'shape';
    else if (AREAS.has(n.stage)) route = 'areas';
    if (route) found = { node: n, route };
  }
  return found;
}

// The ledger event for a stop: only a blocked one needs a person's attention, so only it gets
// one. state and reason come from the caller's taskState() read.
export function stopNotice(task, state, reason) {
  if (state !== 'blocked') return null;
  const at = blockedNode(task);
  return {
    event: 'notify', kind: 'task_blocked', task_id: task.run_id,
    reason: reason ? String(reason).slice(0, 300) : null,
    ...(at ? { node_id: at.node.node_id } : {}),
  };
}
