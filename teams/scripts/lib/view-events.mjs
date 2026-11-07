// Pure helpers for the teams-status mod: which ledger lines deserve a toast, and the status line.
// No fs - view.mjs reads the ledger and hands the lines in.

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

export function statusLine(rows) {
  if (!rows.length) return '';
  return 'teams: ' + rows.map((r) => `${r.id} ${r.done}/${r.total} ${r.current}${r.worktree ? ` @${r.worktree}` : ''}`).join(' · ');
}
