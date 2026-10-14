// Pure builders behind `view.mjs --once --format teams|decisions` (the /teams-status pane,
// _repo/docs/plans/2026-10-14-mod-status-panes-design.md). No fs: view.mjs hands in the
// collectTask() model, the raw task.json and the ledger lines.
import { cardState } from './view-summary.mjs';

const agentOf = (n) => (n && n.executor ? (n.model ? `${n.executor}·${n.model}` : n.executor) : null);
const clip = (s, n = 300) => String(s == null ? '' : s).slice(0, n);
const items = (v) => (Array.isArray(v) ? v.slice(0, 5).map((x) => clip(typeof x === 'object' && x ? (x.text || x.title || JSON.stringify(x)) : x, 200)) : []);

// What a card is doing right now: its judge, its child run's running node, or a wait on a person.
function cardNow(c) {
  const live = (n) => n && (n.state === 'running' || n.state === 'waiting_human' || n.judging_since);
  if (live(c.accept)) return { node: c.accept.state === 'waiting_human' ? 'waiting' : 'accept', agent: agentOf(c.accept), since: c.accept.judging_since || c.accept.started_at || c.accept.waiting_since || null };
  if (!live(c.dispatch)) return null;
  const inner = ((c.child && c.child.nodes) || []).find((n) => n.state === 'running' || n.state === 'waiting_human');
  if (inner) return { node: inner.state === 'waiting_human' ? 'waiting' : inner.stage, agent: agentOf(inner), since: inner.started_at || inner.waiting_since || null };
  return { node: c.dispatch.state === 'waiting_human' ? 'waiting' : 'dispatch', agent: agentOf(c.dispatch), since: c.dispatch.started_at || null };
}

function teamOf(p, kind) {
  if (kind === 'qa' || kind === 'audit') return kind;
  return p.phase === 'planning' ? 'planning' : 'develop';
}

const TEAMS = ['planning', 'develop', 'qa', 'audit'];

// { now: [{team, key, node, agent, elapsed_ms}], teams: [{team, cards: [{id, key, title, state, mark, now}]}] }
export function teamsView(model, { now = Date.now() } = {}) {
  const m = model || {};
  const rows = Object.fromEntries(TEAMS.map((t) => [t, []]));
  const lines = [];
  const ms = (since) => (since ? Math.max(0, now - since) : null);
  const add = (c, kind) => {
    const team = teamOf(c, kind);
    const at = cardNow(c);
    const key = c.ticket_key || String(c.id);
    const mark = cardState(c);
    // a finished QA/audit round shares its ticket with the next round; its own state is DONE
    const state = mark === 'done' ? 'DONE' : c.ticket_state || c.state || null;
    rows[team].push({
      id: String(c.id), key, title: c.title || '', state, mark,
      now: at ? { node: at.node, agent: at.agent, elapsed_ms: ms(at.since) } : null,
    });
    if (at) lines.push({ team, key, node: at.node, agent: at.agent, elapsed_ms: ms(at.since) });
  };
  for (const p of m.packages || []) add(p, 'package');
  for (const r of (m.qa && m.qa.rounds) || []) add(r, 'qa');
  for (const r of (m.audit && m.audit.rounds) || []) add(r, 'audit');
  // The EPIC's own nodes (size, shape, critique, integrate, gate, report) and a size-S run's nodes.
  const epic = (m.ticket && m.ticket.key) || String(m.task_id || '');
  for (const n of [...(m.manager_stages || []), ...((m.s_run && m.s_run.nodes) || [])]) {
    if (n.state !== 'running' && n.state !== 'waiting_human' && !n.judging_since) continue;
    lines.push({ team: 'epic', key: epic, node: n.state === 'waiting_human' ? 'waiting' : n.node_id, agent: agentOf(n), elapsed_ms: ms(n.judging_since || n.started_at || n.waiting_since) });
  }
  return { now: lines, teams: TEAMS.filter((t) => rows[t].length).map((t) => ({ team: t, cards: rows[t] })) };
}

// The card a ledger line or node belongs to: its subgoal/package, a key's second segment, or a
// dispatch/accept node id's second segment.
function cardOf(e) {
  if (e.subgoal_id) return String(e.subgoal_id);
  if (e.package_id) return String(e.package_id);
  if (e.key) return String(e.key).split('/')[1] || null;
  const [stage, sub] = String(e.node_id || '').split(':');
  return (stage === 'dispatch' || stage === 'accept') && sub ? sub : null;
}

const hhmm = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const FILED = new Set(['defects_filed', 'tm_file', 'daemon_defects_filed', 'daemon_upstream_defects_filed']);
const PROPOSALS = new Set(['size', 'shape', 'areas', 'brainstorm']);

function proposalText(n) {
  const r = (n && n.result) || {};
  if (Array.isArray(r.packages)) return clip(r.packages.map((p) => `${p.id} ${p.title || ''}`.trim()).join('; '));
  if (Array.isArray(r.areas)) return clip(r.areas.map((a) => (a && (a.title || a.id)) || String(a)).join('; '));
  if (r.size) return clip(`size ${r.size}${r.flow ? ` · ${r.flow}` : ''}`);
  return clip(r.handoff || r.reason || '');
}

// A filed defect's evidence: the brief fileDefects wrote ("Evidence:\n...").
const evidenceOf = (p) => clip(((String((p && p.brief) || '').split('Evidence:\n')[1]) || '').trim());

// Timeline of who proposed, who judged and why, retries, defects, a person's answers and the
// task's decisions. `card` narrows it to one card (a package id; a round's ":n" is ignored).
export function decisionsView(task, ledger, { card = null } = {}) {
  const t = task || {};
  const nodes = new Map((t.nodes || []).map((n) => [n.node_id, n]));
  const pkgs = new Map(((t.spec && t.spec.packages) || []).map((p) => [String(p.id), p]));
  const out = [];
  const lastVerdict = new Map();
  const filedSeen = new Set();
  for (const e of ledger || []) {
    if (!e || typeof e !== 'object') continue;
    const base = { ts: e.ts || null, time: e.ts ? hhmm(e.ts) : null, card: cardOf(e), node: e.node_id || null };
    if (e.event === 'verdict') {
      const v = { ...base, kind: 'verdict', actor: e.actor || null, verdict: e.verdict || null, score: e.score ?? null, reason: e.reason || null };
      lastVerdict.set(e.node_id, v);
      out.push(v);
    } else if (e.event === 'node_finish' && PROPOSALS.has(e.stage) && e.state === 'done') {
      const n = nodes.get(e.node_id);
      out.push({ ...base, kind: 'proposal', actor: agentOf(n && { executor: n.vendor || n.executor, model: n.model }), text: proposalText(n) });
    } else if (e.event === 'daemon_retry_opened' || e.event === 'daemon_retry_settled') {
      out.push({ ...base, kind: 'retry', node: e.failed_node || null, attempt: e.attempt || null, opened: e.event === 'daemon_retry_opened', reason: clip(e.reason) || null });
    } else if (e.event === 'daemon_rejudge') {
      out.push({ ...base, kind: 'rejudge', attempt: e.attempt || null, reason: clip(e.reason) || null });
    } else if (e.event === 'plan_integrate_replan' || e.event === 'plan_integrate_resplit') {
      const what = e.event === 'plan_integrate_resplit' ? `resplit${e.attempt ? ` → areas:${e.attempt}` : ''}` : `replan ${(e.opened || []).join(', ')}`;
      out.push({ ...base, kind: 'resplit', reason: clip(what.trim()) });
    } else if (FILED.has(e.event)) {
      // fileDefects' own defects_filed line and its callers' lines name the same ids: one entry each
      for (const id of e.filed || []) {
        if (filedSeen.has(String(id))) continue;
        filedSeen.add(String(id));
        const p = pkgs.get(String(id));
        out.push({ ...base, card: String(id), kind: 'defect', filed_by: (p && p.reporter) || e.reporter || (e.event === 'tm_file' ? 'user' : null), title: clip(p && p.title, 200) || String(id), evidence: evidenceOf(p) || null, from: e.package_id || null });
      }
    } else if (e.event === 'tm_submit_human') {
      out.push({ ...base, kind: 'answer', actor: 'human', text: clip(e.answer) || null });
    }
  }
  // The newest verdict of a node still holds its result: its blocking/problems/gaps join it.
  for (const [id, v] of lastVerdict) {
    const r = (nodes.get(id) && nodes.get(id).result) || {};
    for (const k of ['blocking', 'problems', 'gaps']) if (items(r[k]).length) v[k] = items(r[k]);
  }
  for (const d of t.decisions || []) {
    if (!d || !d.question) continue;
    out.push({ ts: null, time: null, card: null, node: null, kind: 'decision', actor: d.owner || null, text: clip(`${d.question}: ${d.chose}`), reason: d.because ? clip(d.because) : null, decided_in: d.decided_in || null });
  }
  out.sort((a, b) => (a.ts == null) - (b.ts == null) || (a.ts || 0) - (b.ts || 0));
  const want = card ? String(card).split(':')[0] : null;
  return { card: want, entries: want ? out.filter((x) => x.card === want) : out };
}
