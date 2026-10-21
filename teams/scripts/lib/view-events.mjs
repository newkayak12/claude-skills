// Pure helpers for the teams-status mod: which ledger lines deserve a toast, and the status line.
// No fs - view.mjs reads the ledger and hands the lines in.

const id8 = (taskId) => 'E-' + String(taskId ?? '').replace(/^E-/, '').slice(0, 8);

// One entry per notable ledger event; null = silent.
const TEXT = {
  node_finish: (e, id) => (e.state === 'failed' ? `${id} ${e.node_id} failed${e.attempt > 1 ? ` (attempt ${e.attempt})` : ''}` : null),
  waiting_human: (e, id) => `${id} needs you: ${e.node_id}`,
  child_driver_capacity: (e, id) => `${id} paused: provider limit`,
  daemon_done: (e, id) => `${id} finished: ${e.state}`,
  daemon_exhausted: (e, id) => `${id} stopped: daemon restarts used up`,
  upstream_fix_rounds_exhausted: (e, id) => `${id} ${e.package_id}: fix rounds used up`,
};

// A failed node_finish waits for the event that says what happens next; past this it is told as it stands.
export const HOLD_MS = 120000;
const REASON_MAX = 120;
const NO_REASON = 'no reason recorded';

const oneLine = (s) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > REASON_MAX ? t.slice(0, REASON_MAX - 1) + '…' : t;
};

// Does ledger event x name failed node n? The writers (teams/mcp/taskmanager.mjs) name it three ways:
// node_id (waiting_human), failed_node (daemon_retry_*), from (auto_reshape, auto_resplit). A tm_settle
// rarely names a node, so it matches by what it did name: its integrate node, its package (package_id or
// packages, against the node's subgoal_id) or, for a shape/areas settle, the stage the target belongs to.
function names(x, n) {
  if (x.node_id === n.node_id || x.failed_node === n.node_id || x.from === n.node_id) return true;
  if (x.event !== 'tm_settle') return false;
  if (x.integrate === n.node_id) return true;
  const pkg = n.subgoal_id == null ? null : String(n.subgoal_id);
  if (x.package_id != null) return pkg !== null && String(x.package_id) === pkg;
  if (Array.isArray(x.packages)) return pkg !== null && x.packages.map(String).includes(pkg);
  if (x.target === 'shape') return n.stage === 'shape' || n.stage === 'critique';
  if (x.target === 'areas') return n.stage === 'areas' || n.stage === 'areas-critique';
  return false;
}

// What the event that follows a failed node_finish says: gave up only on a settle, needs you only on an
// explicit human wait, a retry or reshape is information, anything else is no next step.
function nextStep(x, nf, maxRetries) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v));
  switch (x.event) {
    case 'auto_reshape': return num(x.attempt) ? `retrying as shape:${x.attempt}` : null;
    case 'auto_resplit': return num(x.attempt) ? `retrying as areas:${x.attempt}` : null;
    case 'daemon_retry_opened': {
      const n = num(x.attempt) ? x.attempt : (num(nf.attempt) ? nf.attempt : 1) + 1;
      return `retry ${n}/${maxRetries + 1}`;
    }
    case 'tm_settle': case 'daemon_retry_settled': return 'gave up';
    case 'waiting_human': return 'needs you';
    default: return null;
  }
}

// The failed node_finish at evs[i] as ctx tells it: { ts, reason, next_step, severity }, or null while it is
// still held. ts is the release time: the next-step event's ts, else the node_finish's ts + HOLD_MS. It is a
// function of the ledger alone, so two polls on either side of it see the event once and never twice; only
// whether it is due yet reads `now`.
function failure(evs, i, ctx, now) {
  const nf = evs[i];
  const limit = nf.ts + HOLD_MS;
  const next = evs.slice(i + 1).find((x) => x.ts <= limit && names(x, nf));
  const ts = next ? Math.max(next.ts, nf.ts) : limit;
  if (!next && limit > now) return null;
  let reason;
  for (let k = i - 1; k >= 0 && reason === undefined; k--) {
    const v = evs[k];
    if (v.event === 'verdict' && v.node_id === nf.node_id && (typeof nf.attempt !== 'number' || v.attempt === nf.attempt)) reason = v.reason;
  }
  const recorded = typeof reason === 'string' && reason.trim() ? reason : ctx.reasons?.[nf.node_id];
  const next_step = next ? nextStep(next, nf, Number.isInteger(ctx.maxRetries) ? ctx.maxRetries : 2) : null;
  const severity = next_step === 'needs you' || next_step === 'gave up' ? 'failure' : 'info';
  return { ts, reason: typeof recorded === 'string' && recorded.trim() ? oneLine(recorded) : NO_REASON, next_step, severity };
}

// ctx (optional) switches on the failure story of a failed node_finish: { maxRetries (default 2, graph.mjs),
// reasons: { node_id: result.reason from task.json }, now (ms; default the newest ts in the lines) }.
// Without ctx the ledger is told as before: no reason, no hold.
export function notableEvents(lines, sinceTs, ctx) {
  const evs = [];
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; } // torn last line
    if (e && typeof e.ts === 'number') evs.push(e);
  }
  const now = ctx ? Math.max(typeof ctx.now === 'number' ? ctx.now : -Infinity, ...evs.map((e) => e.ts)) : null;
  const out = [];
  evs.forEach((e, i) => {
    const base = TEXT[e.event]?.(e, id8(e.task_id));
    if (!base) return;
    let ts = e.ts;
    let story = {};
    let text = base;
    if (ctx && e.event === 'node_finish') {
      const f = failure(evs, i, ctx, now);
      if (!f) return;
      ts = f.ts;
      // run and node: what the mod names in its toast, so it never parses the text
      story = { run: id8(e.task_id), node: e.node_id, reason: f.reason, next_step: f.next_step, severity: f.severity };
      text = `${base}: ${f.reason}${f.next_step ? ` → ${f.next_step}` : ''}`;
    }
    if (ts <= sinceTs) return;
    // the package and attempt, when the ledger line carries them (absent fields stay absent)
    const pkg = e.subgoal_id ?? e.package_id;
    // the daemon's final state rides on daemon_done, so a consumer maps a field and never the text
    const state = e.event === 'daemon_done' && typeof e.state === 'string' ? { state: e.state } : {};
    out.push({ ts, task_id: e.task_id, kind: e.event, text, ...state, ...(pkg != null ? { package: String(pkg) } : {}), ...(typeof e.attempt === 'number' ? { attempt: e.attempt } : {}), ...story });
  });
  return out.sort((a, b) => a.ts - b.ts);
}

export function statusLine(rows) {
  if (!rows.length) return '';
  return 'teams: ' + rows.map((r) => `${r.id} ${r.done}/${r.total} ${r.current}`).join(' · ');
}
