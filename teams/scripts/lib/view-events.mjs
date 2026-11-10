// Pure helpers for the teams-status mod: which ledger lines deserve a toast, and the status line.
// No fs - view.mjs reads the ledger and hands the lines in.

import { stageOfNode } from './view-stages.mjs';

const id8 = (taskId) => 'E-' + String(taskId ?? '').replace(/^E-/, '').slice(0, 8);

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
export const hhmm = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const cardLabel = (e) => String(e.subgoal_id ?? (e.key ? String(e.key).split('/')[1] : null) ?? e.node_id ?? '').split(':').slice(0, 2).join(':').replace(/^(?:dispatch|accept|ask):/, '');

// The one table of what a ledger event means. text = the toast line (null = silent); hand = the
// recorded hand-off {from, what, to} the teams pane's Floor feed shows (absent = not a hand-off).
const EVENTS = {
  node_finish: { text: (e, id) => (e.state === 'failed' ? `${id} ${e.node_id} failed${e.attempt > 1 ? ` (attempt ${e.attempt})` : ''}` : null) },
  waiting_human: { text: (e, id) => `${id} needs you: ${e.node_id}`, hand: (e) => ({ from: cardLabel(e), what: 'asks you', what_key: 'handAsks', what_vars: {}, to: 'you', to_key: 'partyYou' }) },
  child_driver_capacity: { text: (e, id) => `${id} paused: provider limit` },
  daemon_done: { text: (e, id) => `${id} finished: ${e.state}` },
  daemon_exhausted: { text: (e, id) => `${id} stopped: daemon restarts used up` },
  upstream_fix_rounds_exhausted: { text: (e, id) => `${id} ${e.package_id}: fix rounds used up` },
  verdict: { hand: (e) => ({ from: e.actor || 'judge', what: `verdict ${e.verdict}`, what_key: 'handVerdict', what_vars: { v: e.verdict }, to: cardLabel(e) }) },
  integrated: { hand: (e) => ({ from: 'integrate', what: `integrated ${e.merged ?? 0}`, what_key: 'handIntegrated', what_vars: { n: e.merged ?? 0 }, to: 'EPIC' }) },
  defects_filed: { hand: (e) => ({ from: e.reporter || 'qa', what: `filed ${(e.filed || []).length} defect(s)`, what_key: 'handFiled', what_vars: { n: (e.filed || []).length }, to: (e.filed || []).join(', ') || 'EPIC' }) },
  // a forwarded answer carries its ask_id and is drawn once, as `answered`
  tm_submit_human: { hand: (e) => { if (e.ask_id) return null; const t = clip(e.answer, 60); return { from: 'you', from_key: 'partyYou', what: t || 'answered', ...(t ? {} : { what_key: 'handAnswered', what_vars: {} }), to: cardLabel(e) }; } },
  asked: { hand: (e) => ({ from: cardLabel(e), what: clip(e.question, 60), to: 'TeamLeader' }) },
  answered: { hand: (e) => { const you = e.by !== 'teamleader'; return { from: you ? 'you' : 'TeamLeader', ...(you ? { from_key: 'partyYou' } : {}), what: clip(e.answer, 60), to: cardLabel(e) }; } },
};

// Ledger lines as events with a numeric ts; a torn last line is skipped.
function parsed(lines) {
  const evs = [];
  for (const line of lines || []) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e && typeof e.ts === 'number') evs.push(e);
  }
  return evs;
}

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
    case 'auto_reshape': return num(x.attempt) ? { text: `retrying as shape:${x.attempt}`, key: 'nextShape', vars: { n: x.attempt } } : null;
    case 'auto_resplit': return num(x.attempt) ? { text: `retrying as areas:${x.attempt}`, key: 'nextAreas', vars: { n: x.attempt } } : null;
    case 'daemon_retry_opened': {
      const n = num(x.attempt) ? x.attempt : (num(nf.attempt) ? nf.attempt : 1) + 1;
      return { text: `retry ${n}/${maxRetries + 1}`, key: 'nextRetry', vars: { n, max: maxRetries + 1 } };
    }
    case 'tm_settle': case 'daemon_retry_settled': return { text: 'gave up', key: 'nextGaveUp', vars: {} };
    case 'waiting_human': return { text: 'needs you', key: 'nextNeedsYou', vars: {} };
    default: return null;
  }
}

// Every key this module can hand over beside its English: a mod looks the words up by key.
export const ENGINE_WORD_KEYS = [
  'nextShape', 'nextAreas', 'nextRetry', 'nextGaveUp', 'nextNeedsYou', 'reasonNone',
  'handAsks', 'handVerdict', 'handIntegrated', 'handFiled', 'handAnswered', 'partyYou',
];

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
  const ns = next ? nextStep(next, nf, Number.isInteger(ctx.maxRetries) ? ctx.maxRetries : 2) : null;
  const next_step = ns ? ns.text : null;
  const severity = next_step === 'needs you' || next_step === 'gave up' ? 'failure' : 'info';
  const has = typeof recorded === 'string' && recorded.trim();
  return { ts, reason: has ? oneLine(recorded) : NO_REASON, ...(has ? {} : { reason_key: 'reasonNone' }), next_step, next_key: ns ? ns.key : null, next_vars: ns ? ns.vars : null, severity };
}

// ctx (optional) switches on the failure story of a failed node_finish: { maxRetries (default 2, graph.mjs),
// reasons: { node_id: result.reason from task.json }, now (ms; default the newest ts in the lines) }.
// Without ctx the ledger is told as before: no reason, no hold.
export function notableEvents(lines, sinceTs, ctx) {
  return notableFromEvents(parsed(lines), sinceTs, ctx);
}

// The same over events already parsed (objects with a numeric ts), for a caller that caches them.
export function notableFromEvents(evs, sinceTs, ctx) {
  const now = ctx ? Math.max(typeof ctx.now === 'number' ? ctx.now : -Infinity, ...evs.map((e) => e.ts)) : null;
  const out = [];
  evs.forEach((e, i) => {
    const base = EVENTS[e.event]?.text?.(e, id8(e.task_id));
    if (!base) return;
    let ts = e.ts;
    let story = {};
    let text = base;
    if (ctx && e.event === 'node_finish') {
      const f = failure(evs, i, ctx, now);
      if (!f) return;
      ts = f.ts;
      // run and node: what the mod names in its toast, so it never parses the text
      story = { node: e.node_id, reason: f.reason, ...(f.reason_key ? { reason_key: f.reason_key } : {}), next_step: f.next_step, next_key: f.next_key, next_vars: f.next_vars, severity: f.severity };
      text = `${base}: ${f.reason}${f.next_step ? ` → ${f.next_step}` : ''}`;
    }
    if (ts <= sinceTs) return;
    // the package and attempt, when the ledger line carries them (absent fields stay absent)
    const pkg = e.subgoal_id ?? e.package_id;
    // the daemon's final state rides on daemon_done, so a consumer maps a field and never the text
    const state = e.event === 'daemon_done' && typeof e.state === 'string' ? { state: e.state } : {};
    const node = e.event === 'waiting_human' && e.node_id != null ? { node: e.node_id } : {};
    out.push({ ts, task_id: e.task_id, kind: e.event, text, ...state, ...node, ...(pkg != null ? { package: String(pkg) } : {}), ...(typeof e.attempt === 'number' ? { attempt: e.attempt } : {}), ...(e.task_id != null || e.event === 'node_finish' ? { run: id8(e.task_id) } : {}), ...story });
  });
  return out.sort((a, b) => a.ts - b.ts);
}

// ---------- recorded hand-offs (the teams pane's Floor feed) ----------
// Only events the ledger records count: a verdict, an integration, filed defects, a person's
// answer, a card waiting on a person. Nothing is inferred; no line, no hand-off.

// The newest `limit` recorded hand-offs, newest first: [{ time, from, what, to }].
export function handoffs(lines, { limit = 5 } = {}) {
  const out = [];
  for (const e of parsed(lines)) {
    const h = EVENTS[e.event]?.hand?.(e);
    if (h) out.push({ ts: e.ts, time: hhmm(e.ts), ...h });
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, limit).map(({ ts, ...h }) => h);
}

// The newest verdict recorded for each card (by subgoal_id): { P1: { verdict, ts, attempt } }.
export function lastVerdicts(lines) {
  const out = {};
  for (const e of parsed(lines)) {
    if (e.event !== 'verdict' || e.subgoal_id == null) continue;
    const id = String(e.subgoal_id);
    if (!out[id] || e.ts >= out[id].ts) out[id] = { verdict: e.verdict ?? null, ts: e.ts, attempt: typeof e.attempt === 'number' ? e.attempt : null };
  }
  return out;
}

// ---------- per-Phase and per-STORY attribution (the teams pane's Phase detail and Log) ----------
// Phases, in run order. A STORY's own nodes and events (dispatch:Pn:k, accept:Pn:k, its key, its
// subgoal_id) belong to Build; a manager node follows stageOfNode; a decision follows decided_in's
// stage, else Plan.
export const PHASES = ['plan', 'build', 'integrate', 'qa', 'gate', 'report'];

const STORY_NODE = /^(?:dispatch|accept):([^:]+):\d+$/;
const storyOfEvent = (e, pkgIds) => {
  const m = String(e.node_id ?? '').match(STORY_NODE);
  if (m) return m[1];
  const key = e.key ? String(e.key).split('/')[1] : null;
  for (const c of [e.subgoal_id, e.package_id, key]) if (c != null && pkgIds.has(String(c))) return String(c);
  return null;
};

// The Phase a ledger event belongs to; null when it names no node and no STORY.
export function phaseOfEvent(e, pkgIds = new Set()) {
  if (storyOfEvent(e, pkgIds)) return 'build';
  const stage = e.node_id != null ? stageOfNode(e.node_id) : null;
  if (stage) return stage;
  return e.event === 'integrated' ? 'integrate' : null;
}

// The recorded hand-offs of each Phase, newest first, `limit` per Phase: { plan: [...], build: [...], ... }.
// Not the EPIC-wide newest five: a Phase's list is its own.
// A Phase hand-off carries what the Phase page draws beside the shared fields, only as recorded:
// story (the card the event names), a verdict's score and reason, and where the verdict sends the
// card (the graph's own flow: an accepted card integrates, a rejected one goes back to its implementer);
// a question is TeamLeader -> you with the question as `reason`.
function phaseExtra(e, phase) {
  const story = phase === 'build' && cardLabel(e) ? { story: cardLabel(e) } : {};
  if (e.event === 'verdict') {
    const reason = typeof e.reason === 'string' && e.reason.trim() ? { reason: clip(e.reason, 120) } : {};
    const flow = e.stage === 'accept' && (e.verdict === 'accept' || e.verdict === 'reject') ? { to_role: e.verdict === 'accept' ? 'integrate' : 'implementer' } : {};
    return { ...story, ...(Number.isFinite(e.score) ? { score: e.score } : {}), ...reason, ...flow };
  }
  if (e.event === 'asked') return { ...story, from: 'TeamLeader', what: '', reason: clip(e.question, 60), to: 'you', to_key: 'partyYou' };
  return story;
}

export function phaseHandoffs(lines, { pkgIds = [], limit = 5 } = {}) {
  const ids = new Set(pkgIds.map(String));
  const out = Object.fromEntries(PHASES.map((p) => [p, []]));
  for (const e of parsed(lines)) {
    const h = EVENTS[e.event]?.hand?.(e);
    const phase = h ? phaseOfEvent(e, ids) : null;
    if (phase && out[phase]) out[phase].push({ ts: e.ts, time: hhmm(e.ts), ...h, ...phaseExtra(e, phase) });
  }
  for (const p of PHASES) out[p] = out[p].sort((a, b) => b.ts - a.ts).slice(0, limit).map(({ ts, ...h }) => h);
  return out;
}

// The Phase a decision (task.decisions entry) belongs to: a STORY id is Build, a node id or a Phase
// name its own stage, anything else (PLAN, EPIC, task, session, none) is Plan.
export function phaseOfDecision(d, pkgIds = []) {
  const at = d && d.decided_in != null ? String(d.decided_in) : '';
  if (new Set(pkgIds.map(String)).has(at)) return 'build';
  const stage = stageOfNode(at) || (PHASES.includes(at.toLowerCase()) ? at.toLowerCase() : null);
  return stage || 'plan';
}

export function phaseDecisions(decisions, pkgIds = []) {
  const out = Object.fromEntries(PHASES.map((p) => [p, []]));
  for (const d of Array.isArray(decisions) ? decisions : []) if (d && d.question) out[phaseOfDecision(d, pkgIds)].push(d);
  return out;
}

// The string-table keys a STORY Log row names (F2.log.* in F4's table); numbers ride in `numbers`.
export const STORY_LOG_KEYS = ['F2.log.criteria', 'F2.log.subgoals', 'F2.log.attemptStart', 'F2.log.attemptCommits', 'F2.log.attemptReject', 'F2.log.approved', 'F2.log.asked'];

const attemptOfNode = (id) => { const n = Number(String(id ?? '').split(':')[2]); return Number.isInteger(n) && n > 0 ? n : null; };

// The Log rows of STORY `pkgId`: ledger events that carry its node ids (dispatch:Pn:k, accept:Pn:k) or its key,
// as { ts, time, node, state, what_key, numbers, note }. A label is a key plus numbers; the note is data as
// written (a reason, a question). ctx: { threshold, criteria (n), subgoals (n), gaps: { <accept node id>: n } } - every
// number the ledger does not carry itself is the caller's, from task.json; absent = the row is not drawn or the
// number is null. Test and commit counts appear only when the event records them (`commits`).
export function storyLog(lines, pkgId, ctx = {}) {
  const id = String(pkgId);
  const rows = [];
  const row = (e, state, what_key, numbers, note = null, node = e.node_id ?? null) => rows.push({ ts: e.ts, time: hhmm(e.ts), node, state, what_key, numbers, note });
  let first = null;
  for (const e of parsed(lines)) {
    const mine = storyOfEvent(e, new Set([id])) === id;
    if (!mine) continue;
    const n = attemptOfNode(e.node_id) ?? (typeof e.attempt === 'number' ? e.attempt : null);
    if (first === null) first = e;
    if (e.event === 'child_driver_spawned' && STORY_NODE.test(String(e.node_id))) row(e, 'running', 'F2.log.attemptStart', { n: n ?? 1 });
    else if (e.event === 'node_finish' && /^dispatch:/.test(String(e.node_id)) && typeof e.commits === 'number') row(e, e.state === 'failed' ? 'failed' : 'done', 'F2.log.attemptCommits', { n: n ?? 1, c: e.commits });
    else if (e.event === 'verdict' && /^accept:/.test(String(e.node_id))) {
      if (e.verdict === 'accept') row(e, 'done', 'F2.log.approved', { gaps: Number.isInteger(ctx.gaps && ctx.gaps[e.node_id]) ? ctx.gaps[e.node_id] : 0 }, e.reason ? clip(e.reason, 120) : null);
      else if (e.verdict === 'reject') row(e, 'failed', 'F2.log.attemptReject', { n: n ?? 1, score: e.score ?? null, threshold: ctx.threshold ?? null }, e.reason ? clip(e.reason, 120) : null);
    } else if (e.event === 'asked') row(e, 'waiting', 'F2.log.asked', { question: clip(e.question, 120) });
  }
  if (first && Number.isInteger(ctx.criteria)) rows.push({ ts: first.ts, time: hhmm(first.ts), node: null, state: 'done', what_key: 'F2.log.criteria', numbers: { n: ctx.criteria }, note: null });
  if (first && Number.isInteger(ctx.subgoals)) rows.push({ ts: first.ts, time: hhmm(first.ts), node: null, state: 'done', what_key: 'F2.log.subgoals', numbers: { n: ctx.subgoals }, note: null });
  // criteria and subgoals first (same ts as the first event), the rest in time order
  const rank = (r) => (r.what_key === 'F2.log.criteria' ? 0 : r.what_key === 'F2.log.subgoals' ? 1 : 2);
  return rows.map((r, i) => [r, i]).sort((a, b) => a[0].ts - b[0].ts || rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([r]) => r);
}

export function statusLine(rows) {
  if (!rows.length) return '';
  return 'teams: ' + rows.map((r) => `${r.id} ${r.done}/${r.total} ${r.current}${r.worktree ? ` @${r.worktree}` : ''}`).join(' · ');
}
