// Pure builder behind `view.mjs --once --format summary` (the teams-status mod's data). Takes the
// collectTask() model and returns a small plain-JSON object a person can read: what is it doing,
// who is it waiting on, how much is left. No fs; no node ids, paths or verdict fields leave here.

import { STAGE_KEYS, stageOfNode, nodeState, mergeStates } from './view-stages.mjs';
import { hhmm } from './view-events.mjs';

const DAY_MS = 86400000;
const HUMAN_STAGE = { plan: 'plan', build: 'build', integrate: 'integration', qa: 'QA', gate: 'final gate', report: 'report' };

// A free-text reason may carry a path or a node id; drop both.
const scrub = (s) => String(s || '').replace(/\S*\/(?:Users|var|tmp)\/\S*/g, '').replace(/\b[\w-]+:[\w-]+(?::\d+)+/g, '').replace(/\s+/g, ' ').trim();

// A node parked on a person (a node state word, not a ledger event).
export const waitingNode = (n) => !!n && n.state === 'waiting_human';

export function cardState(c) {
  const states = [c.accept && c.accept.state, c.dispatch && c.dispatch.state].filter(Boolean);
  if (states.some((s) => s === 'failed' || s === 'blocked')) return 'failed';
  if (c.accept && c.accept.state === 'done') return 'done';
  if (states.some((s) => s === 'running' || s === 'waiting_human')) return 'running';
  if (!states.length && c.ticket_state === 'DONE') return 'done';
  return 'pending';
}

// tm_cancel leaves the node states as they were, so a dispatch that was running still says so; on
// a cancelled task nothing is running, and what was in flight reads as not started.
const idleIfCancelled = (m, s) => (m.state === 'cancelled' && s === 'running' ? 'pending' : s);

export function cardsOf(m) {
  const out = [];
  const add = (c, kind, stage) => out.push({ c, kind, stage, state: idleIfCancelled(m, cardState(c)) });
  for (const p of m.packages || []) {
    if (p.phase === 'planning') add(p, 'plan', 'plan');
    else if (p.origin) add(p, 'defect', 'qa');
    else add(p, 'package', 'build');
  }
  for (const r of (m.qa && m.qa.rounds) || []) add(r, 'qa', 'qa');
  for (const r of (m.audit && m.audit.rounds) || []) add(r, 'audit', 'qa');
  // run order: plan, build cards, QA/audit rounds, then the defects they filed
  const RANK = { plan: 0, package: 1, qa: 2, audit: 2, defect: 3 };
  return out.map((x, i) => [x, i]).sort((a, b) => RANK[a[0].kind] - RANK[b[0].kind] || a[1] - b[1]).map(([x]) => x);
}

function stagesOf(m, cards) {
  const by = Object.fromEntries(STAGE_KEYS.map((k) => [k, []]));
  if (m.harness) {
    // A harness_run task: the run's own stages (view-collect's harnessStages). Its frozen
    // size/shape/critique graph says nothing about them, and `moving` fills nothing. A stage the
    // run has not touched is pending = no evidence, so a later done stage can still backfill it.
    for (const s of m.harness.stages || []) if (by[s.key] && s.state !== 'pending') by[s.key].push(idleIfCancelled(m, s.state));
  } else {
    for (const n of [...(m.manager_stages || []), ...((m.s_run && m.s_run.nodes) || [])]) {
      if (n.state === 'skipped') continue; // a retried node's first attempt: not work
      const k = stageOfNode(n.node_id);
      if (k) by[k].push(idleIfCancelled(m, nodeState(n.state)));
    }
  }
  for (const x of cards) by[x.stage].push(x.state);
  const raw = STAGE_KEYS.map((k) => mergeStates(by[k]));
  const stages = STAGE_KEYS.map((key, i) => {
    let state = raw[i];
    // A stage with nothing in it (no QA configured) reads done once a later stage has moved.
    if (!state) state = raw.slice(i + 1).some((s) => s === 'done' || s === 'running') ? 'done' : 'pending';
    if (m.state === 'complete') state = 'done';
    return { key, state };
  });
  if (m.state === 'running' && !stages.some((s) => s.state === 'running' || s.state === 'failed')) {
    const first = stages.find((s) => s.state !== 'done');
    if (first) first.state = 'running';
  }
  return stages;
}

function waitingOf(m, cards) {
  const items = [];
  for (const { c } of cards) {
    const nodes = [c.dispatch, c.accept, ...((c.child && c.child.nodes) || [])];
    if (nodes.some((n) => n && n.state === 'waiting_human')) items.push(c.title || 'a card');
  }
  for (const n of [...(m.manager_stages || []), ...((m.s_run && m.s_run.nodes) || [])]) {
    if (n.state === 'waiting_human') items.push(HUMAN_STAGE[stageOfNode(n.node_id)] || 'a step');
  }
  for (let i = 0; i < ((m.harness && m.harness.waiting) || 0); i += 1) items.push('a step');
  return items;
}

// Each card waiting on a person with the question it asks (the ask card's text; blank when it has none).
// `who` is the STORY label (E-aaaaaaaa/P2/U1 -> P2), the EPIC key for an EPIC-level card; `since` is
// when the waiting node parked (ms) or null.
const whoOf = (key) => (String(key).split('/')[1] || String(key));
const sinceOf = (nodes) => nodes.map((n) => n.waiting_since).find((t) => typeof t === 'number') || null;
function waitingCards(m, cards) {
  const out = [];
  for (const { c } of cards) {
    const nodes = [c.dispatch, c.accept, ...((c.child && c.child.nodes) || [])].filter((n) => n && n.state === 'waiting_human');
    if (!nodes.length) continue;
    const question = nodes.flatMap((n) => n.questions || [])[0] || '';
    const key = c.ticket_key || String(c.id);
    out.push({ key, title: c.title || 'a card', question, who: whoOf(key), since: sinceOf(nodes) });
  }
  const epic = (m.ticket && m.ticket.key) || '';
  for (const n of [...(m.manager_stages || []), ...((m.s_run && m.s_run.nodes) || [])]) {
    if (n.state === 'waiting_human') out.push({ key: epic, title: HUMAN_STAGE[stageOfNode(n.node_id)] || 'a step', question: (n.questions || [])[0] || '', who: epic, since: sinceOf([n]) });
  }
  for (let i = 0; i < ((m.harness && m.harness.waiting) || 0); i += 1) out.push({ key: epic, title: 'a step', question: '', who: epic, since: null });
  return out;
}

// Everything of this task parked on a person, read from the collected model: package, QA and audit
// cards (dispatch, accept and their child run's nodes), manager stages, the S run, harness graph nodes.
export const waitingCount = (m) => waitingOf(m, cardsOf(m)).length;

function logOf(events, titleOf) {
  const out = [];
  for (const e of events || []) {
    if (!e || typeof e.ts !== 'number') continue;
    const [stage, sub] = String(e.node_id || '').split(':');
    const subject = (stage === 'accept' || stage === 'dispatch') ? (titleOf[sub] || 'a card') : (HUMAN_STAGE[stageOfNode(e.node_id)] || 'the task');
    const finished = e.state === 'done' ? 'passed' : e.state === 'failed' ? 'failed' : null;
    let kind = null;
    if (e.event === 'node_finish' && (stage === 'accept' || stage === 'gate' || stage === 'report')) kind = finished;
    else if (e.event === 'integrated') kind = 'integrated';
    else if (e.event === 'dispatch') kind = 'dispatched';
    else if (e.event === 'waiting_human') kind = 'waiting';
    else if (e.event === 'tm_file') kind = 'filed';
    else if (e.event === 'daemon_done') kind = 'finished';
    if (kind) out.push({ time: hhmm(e.ts), kind, subject: e.event === 'integrated' ? 'integration' : subject });
  }
  return out.slice(-20);
}

const r4 = (x) => Math.round((Number(x) || 0) * 10000) / 10000;
const MIN_MS = 60000;

// The run's numbers for the status board, from the collected model (view-collect's `telemetry`
// plus the cards). Pure: no fs, `now` is injected. A model with no telemetry reads as empty
// numbers, never NaN.
//
//   { max_attempts, threshold, stall_minutes,
//     budget: {limit_usd, spent_usd} | null,          // null when the task sets no budget
//     drivers: {live, cap, stalled: [{id, minutes}]}, // live/cap null when unknown; minutes since progress
//     stories: [{ id, key, title, kind, state, attempt, max_attempts,
//                 judge: {score, threshold, reason} | null,
//                 cost_usd, retry_cost_usd, wall_ms,
//                 stages: [{stage, cost_usd, retry_cost_usd, wall_ms}],
//                 out_of_retries, scoped_out: [{gap, belongs_to}] }],
//     stages: [{stage, cost_usd, retry_cost_usd, wall_ms}],   // task-wide, manager judges included
//     denials: <number>,                                      // manager judges + worker nodes
//     out_of_retries: [id],
//     defects: {filed, dropped, dropped_items}, scoped_out: [{story, gap, belongs_to}] }
//
// cost_usd is the spend of each card's first attempt; every attempt after the first is
// retry_cost_usd, so a retry's price is read apart from the work's.
//
// Out of scope is PARTIAL: only the gaps a judge moved with out_of_scope[] (a node's `scoped_out`)
// are recorded. A defect the QA or audit round judged to be out of scope, or a skipped STORY,
// leaves no such record and is not counted here.
export function metrics(model, { now = Date.now() } = {}) {
  const m = model || {};
  const t = m.telemetry || {};
  const maxAttempts = Number.isInteger(t.max_attempts) ? t.max_attempts : null;
  const threshold = Number.isFinite(t.goal_threshold) ? t.goal_threshold : null;
  const outSet = new Set((t.out_of_retries || []).map(String));

  const byId = new Map();
  for (const { c, kind, stage, state } of cardsOf(m)) {
    const id = String(c.id).split(':')[0];
    let s = byId.get(id);
    if (!s) {
      s = {
        id, key: c.ticket_key || null, title: c.title || '', kind, state, stage, attempt: 0, max_attempts: maxAttempts,
        judge: null, cost_usd: 0, retry_cost_usd: 0, wall_ms: 0, stages: {},
        out_of_retries: outSet.has(id), scoped_out: [],
      };
      byId.set(id, s);
    }
    s.state = state; // the latest round's
    // attempts begun: a dispatch that never started (pending, or unreachable behind a failed
    // dependency) has not begun its attempt, so a never-run STORY reads 0
    const d = c.dispatch;
    const idle = d && !d.started_at && ['pending', 'unreachable', 'skipped'].includes(d.state);
    const begun = (Number(c.attempt) || 0) - (idle ? 1 : 0);
    s.attempt = Math.max(s.attempt, begun, 0);
    for (const e of (c.accept && c.accept.scoped_out) || []) s.scoped_out.push({ gap: e.gap, belongs_to: e.belongs_to });
  }

  const stages = {};
  const add = (bag, stage, row) => {
    const b = bag[stage] || (bag[stage] = { cost_usd: 0, retry_cost_usd: 0, wall_ms: 0 });
    if (row.attempt > 1) b.retry_cost_usd += row.cost_usd; else b.cost_usd += row.cost_usd;
    b.wall_ms += row.duration_ms;
  };
  for (const row of t.spend || []) {
    const s = row.story != null ? byId.get(String(row.story)) : null;
    const stage = row.stage || (s && s.stage) || 'other';
    add(stages, stage, row);
    if (!s) continue;
    add(s.stages, stage, row);
    if (row.attempt > 1) s.retry_cost_usd += row.cost_usd; else s.cost_usd += row.cost_usd;
    s.wall_ms += row.duration_ms;
  }
  const rows = (bag) => Object.entries(bag).map(([stage, b]) => ({ stage, cost_usd: r4(b.cost_usd), retry_cost_usd: r4(b.retry_cost_usd), wall_ms: b.wall_ms }));

  const stories = [...byId.values()].map((s) => {
    const j = (t.judge || {})[s.id];
    const judge = j ? { score: j.score, threshold, reason: scrub(j.reason) || null } : null;
    if (maxAttempts != null) s.attempt = Math.min(s.attempt, maxAttempts);
    const { stage, ...out } = s;
    return { ...out, judge, cost_usd: r4(s.cost_usd), retry_cost_usd: r4(s.retry_cost_usd), stages: rows(s.stages) };
  });

  const limit = Number.isFinite(t.budget_usd) ? t.budget_usd : null;
  const spent = r4(t.spent_usd != null ? t.spent_usd : (m.cost && m.cost.usd));
  const stall = Number.isInteger(t.stall_minutes) ? t.stall_minutes : null;
  const stalled = !stall ? [] : (t.drivers || [])
    .filter((d) => typeof d.progress_at === 'number' && now - d.progress_at >= stall * MIN_MS)
    .map((d) => ({ id: d.story || null, minutes: Math.floor((now - d.progress_at) / MIN_MS) }));
  const den = t.denials || {};
  const dropped = t.defects && Array.isArray(t.defects.dropped) ? t.defects.dropped : [];

  return {
    max_attempts: maxAttempts,
    threshold,
    budget: limit == null ? null : { limit_usd: limit, spent_usd: spent },
    drivers: { live: t.live ? t.live.live : null, cap: t.live ? t.live.cap : null, stalled },
    stall_minutes: stall,
    stories,
    stages: rows(stages),
    denials: (den.judges || 0) + (den.workers || 0),
    out_of_retries: [...outSet],
    defects: {
      filed: new Set(((t.defects && t.defects.filed) || []).map(String)).size,
      dropped: dropped.length,
      dropped_items: dropped.map((d) => ({ id: d.id, title: scrub(d.title), reason: scrub(d.reason) })),
    },
    scoped_out: stories.flatMap((s) => s.scoped_out.map((e) => ({ story: s.id, gap: e.gap, belongs_to: e.belongs_to }))),
  };
}

export function summarize(model, { now = Date.now() } = {}) {
  const m = model;
  const cards = cardsOf(m);
  const stages = stagesOf(m, cards);
  const waiting = waitingOf(m, cards);
  const titleOf = {};
  for (const { c } of cards) titleOf[String(c.id).split(':')[0]] = c.title || 'a card';

  const work = cards.map(({ c, kind, state }) => {
    const failedNode = [c.accept, c.dispatch].find((n) => n && (n.state === 'failed' || n.state === 'blocked'));
    return {
      title: c.title || '', kind, id: kind === 'defect' ? c.id : null, state,
      filed_by: c.origin ? (c.reporter || c.origin) : null,
      reason: state === 'failed' ? (scrub(failedNode && failedNode.reason) || 'failed') : null,
    };
  });
  const done = work.filter((w) => w.state === 'done').length;

  let nowStep = { kind: 'idle', subject: null, detail: null };
  const pick = cards.find((x) => x.state === 'running') || cards.find((x) => x.state === 'failed')
    || cards.find((x) => x.state === 'pending' && x.kind === 'defect');
  if (m.state === 'complete') nowStep = { kind: 'done', subject: null, detail: null };
  else if (m.state === 'cancelled') nowStep = { kind: 'idle', subject: null, detail: null };
  else if (waiting.length) nowStep = { kind: 'answer', subject: waiting[0], detail: null };
  else if (pick) {
    const w = work[cards.indexOf(pick)];
    nowStep = {
      // a card not yet dispatched is next, not being worked
      kind: pick.state === 'pending' ? 'fixnext' : { defect: 'fix', plan: 'plan', package: 'build', qa: 'qa', audit: 'qa' }[pick.kind],
      subject: w.title || null, detail: w.reason || (w.filed_by ? `filed by ${w.filed_by}` : null),
    };
  } else {
    const next = stages.find((s) => s.state !== 'done');
    if (next) nowStep = { kind: next.key, subject: null, detail: null };
  }

  const elapsed = m.elapsed_ms ?? (m.created_at ? now - m.created_at : 0);
  return {
    key: (m.ticket && m.ticket.key) || String(m.task_id || ''),
    slug: (m.ticket && m.ticket.slug) || null,
    title: (m.ticket && m.ticket.title) || String(m.request || '').slice(0, 72),
    state: m.state,
    day: Math.max(1, Math.ceil(elapsed / DAY_MS)),
    done, total: work.length,
    now: nowStep,
    you: { count: waiting.length, items: waiting, cards: waitingCards(m, cards) },
    stages, work,
    cost: { usd: (m.cost && m.cost.usd) || 0, turns: (m.cost && m.cost.turns) || 0 },
    log: logOf(m.events, titleOf),
    metrics: metrics(m, { now }),
  };
}
