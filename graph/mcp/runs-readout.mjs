// Row builder for `broker.mjs runs --list/--show`. Pure: no stdin, no exit, no argv, no write.
// broker.mjs and test-broker.mjs import it; nothing here starts the MCP loop.
//
// Row shape (missing values are null, except created_at, which keeps the string 'unknown'):
//   id8, state, owner, created_at, cost_usd, running      the older fields, unchanged
//   run_id, file (absolute), request (first line, … when cut), max_retries
//   last_change (ISO), last_change_ms, age_ms, open, stalled   from the run file's mtime
//   routing_blocked, unavailable_vendors ({} when none)
//   subgoals [{id,title}], last_step, acting, rejects
//   nodes [{node_id,stage,subgoal_id,state,attempt,agent,started_at,finished_at,reason,feedback,last_step}]

import { runState } from './graph.mjs';

export const STALL_AFTER_MS = 2 * 60 * 60 * 1000;
export const OPEN_UNDER_MS = 12 * 60 * 60 * 1000;
const REQUEST_MAX = 120;

// A run file without created_at is of unknown age; no reader invents or writes one.
export function createdAtOf(run) {
  return Number.isFinite(run.created_at) ? new Date(run.created_at).toISOString() : 'unknown';
}

const orNull = (v) => (v === undefined || v === '' ? null : v);

function firstLine(text) {
  const line = String(text || '').split('\n')[0];
  return line.length > REQUEST_MAX ? line.slice(0, REQUEST_MAX - 1) + '…' : line;
}

function nodeRow(n) {
  const agent = n.executor ? (n.model ? `${n.executor}·${n.model}` : n.executor) : null;
  return {
    node_id: n.node_id,
    stage: n.stage,
    subgoal_id: orNull(n.subgoal_id),
    state: n.state,
    attempt: Number.isFinite(n.attempt) ? n.attempt : null,
    agent,
    started_at: Number.isFinite(n.started_at) ? n.started_at : null,
    finished_at: Number.isFinite(n.finished_at) ? n.finished_at : null,
    reason: orNull(n.result && n.result.reason),
    feedback: orNull(n.feedback),
    last_step: orNull(n.last_step),
  };
}

// file: absolute run-file path; mtimeMs: its mtime; now: injected for tests.
export function runRow(run, { file, mtimeMs, now = Date.now() }) {
  const nodes = Array.isArray(run.nodes) ? run.nodes : [];
  const view = { ...run, nodes };
  const state = runState(view).state;
  const running = nodes.find((n) => n.state === 'running');
  const finished = nodes
    .filter((n) => (n.state === 'done' || n.state === 'failed') && n.last_step)
    .sort((x, y) => (y.finished_at || 0) - (x.finished_at || 0))[0];
  const lastStep = finished ? finished.last_step : null;
  const ageMs = Math.max(0, now - mtimeMs);
  const open = state !== 'complete' && ageMs < OPEN_UNDER_MS;
  const runId = String(run.run_id || '');
  return {
    id8: runId.slice(0, 8),
    state,
    owner: run.owner || null,
    created_at: createdAtOf(run),
    cost_usd: Number.isFinite(run.cost_usd) ? run.cost_usd : null,
    running: running ? { node_id: running.node_id, last_step: running.last_step || lastStep || null } : null,
    run_id: runId,
    file,
    request: firstLine(String(run.request || '').replace(/^\[teams-task [^\]]*\]\s*/, '')),
    max_retries: Number.isFinite(run.max_retries) ? run.max_retries : null,
    last_change: new Date(mtimeMs).toISOString(),
    last_change_ms: mtimeMs,
    age_ms: ageMs,
    open,
    stalled: open && ageMs >= STALL_AFTER_MS,
    routing_blocked: Boolean(run.routing_blocked),
    unavailable_vendors: run.unavailable_vendors || {},
    subgoals: ((run.spec && run.spec.subgoals) || []).map((s) => ({ id: s.id, title: s.title || '' })),
    last_step: lastStep,
    acting: Boolean(running),
    rejects: nodes.filter((n) => n.state === 'failed').length,
    nodes: nodes.map(nodeRow),
  };
}
