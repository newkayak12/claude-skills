// The STORY page's data (`view.mjs --once --format story --task <id> --story <Pn>`) and the STORY report's
// (`--format story-report`): one payload each, built here and printed as JSON by view-once.mjs, which also
// formats both as text for a client with no pane. Labels travel as keys and numbers (a FLOW node is its
// stage key, a state is a state word); only what a person or model wrote (a reason, a title) is text.
//
// storyPayload is pure over the collected model (view-collect.mjs) plus the facts handed in (workers from
// the floor, the driver streams' participants); the reads - a stream parsed once per mtime and size -
// are participantsOf below. Workers come from the floor's workers[] only: no stall rule lives here.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { storyReportSections, renderStory } from '../../mcp/docs.mjs';
import { docPaths } from '../../mcp/tickets.mjs';
import { cardsOf } from './view-summary.mjs';
import { nodeState, mergeStates } from './view-stages.mjs';
import { statSig } from './view-index.mjs';

// The FLOW of a STORY's child run, in order. A document run's draft and review sit where implement and test do.
export const FLOW = ['plan', 'setgoal', 'critique', 'implement', 'test', 'gate'];
const FLOW_OF = { plan: 'plan', setgoal: 'setgoal', critique: 'critique', implement: 'implement', draft: 'implement', test: 'test', review: 'test', gate: 'gate', 'gate:goal': 'gate' };
const REPORT_KEYS = ['result', 'verdict', 'files', 'decisions', 'left', 'seeLog'];

const attemptOf = (id) => {
  const n = Number(String(id ?? '').split(':')[2]);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clip = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// ---------- participants: the subagents a STORY's driver started ----------

const parsedStreams = new Map();
const streamName = (name) => name.replace(/(\.restart\d+)?\.stream\.jsonl$/, '').replace(/_\d+$/, '');

// The Agent/Task tool calls of one driver stream: [{ id, kind, model, done }], `done` once its tool_result came
// back. Parsed once per mtime and size of the file.
function agentsOfStream(path) {
  const sig = statSig(path);
  const hit = parsedStreams.get(path);
  if (hit && hit.sig === sig && sig !== null) return hit.agents;
  const calls = new Map();
  let text = '';
  try { text = readFileSync(path, 'utf8'); } catch { /* a stream that vanished has no agents */ }
  for (const line of text.split('\n')) {
    if (!line.includes('tool_use') && !line.includes('tool_result')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const content = e && e.message && Array.isArray(e.message.content) ? e.message.content : [];
    for (const c of content) {
      if (e.type === 'assistant' && c && c.type === 'tool_use' && (c.name === 'Task' || c.name === 'Agent')) {
        const i = c.input || {};
        calls.set(c.id, { id: c.id, kind: String(i.subagent_type || 'agent'), model: String(i.model || e.message.model || '') || null, done: false });
      } else if (e.type === 'user' && c && c.type === 'tool_result' && calls.has(c.tool_use_id)) calls.get(c.tool_use_id).done = true;
    }
  }
  const agents = [...calls.values()];
  parsedStreams.set(path, { sig, agents });
  return agents;
}

const tally = (list) => {
  const by = new Map();
  for (const a of list) {
    const k = `${a.kind}\0${a.model ?? ''}`;
    const row = by.get(k) || { kind: a.kind, model: a.model ?? null, n: 0 };
    row.n += 1;
    by.set(k, row);
  }
  return [...by.values()].sort((a, b) => b.n - a.n || a.kind.localeCompare(b.kind));
};

// Participants of STORY `pkgId`: cumulative and live subagents by kind and model from its drivers' streams
// (drivers/dispatch_<Pn>_<k>[.restartN].stream.jsonl under `taskDir`). `live` = its driver is working now:
// only then do unanswered calls count as live. No stream, or none with a subagent call: the child run's own nodes
// (executor and model, running = live) answer instead, and source says so.
export function participantsOf(taskDir, pkgId, childNodes, { live = false } = {}) {
  let files = [];
  try { files = readdirSync(join(taskDir, 'drivers')).filter((n) => n.endsWith('.stream.jsonl') && streamName(n) === `dispatch_${pkgId}`); } catch { /* no drivers dir */ }
  const agents = files.flatMap((n) => agentsOfStream(join(taskDir, 'drivers', n)));
  if (agents.length) return { source: 'stream', total: tally(agents), live: live ? tally(agents.filter((a) => !a.done)) : [] };
  const nodes = (childNodes || []).filter((n) => n.state !== 'skipped' && (n.executor || n.model));
  const as = (n) => ({ kind: String(n.executor || 'agent'), model: n.model || null });
  return { source: nodes.length ? 'nodes' : 'none', total: tally(nodes.map(as)), live: tally(nodes.filter((n) => n.state === 'running').map(as)) };
}

// ---------- the STORY payload ----------

const cardOf = (m, pkgId) => {
  const mine = cardsOf(m).filter((x) => String(x.c.id).split(':')[0] === String(pkgId));
  return mine.length ? mine[mine.length - 1] : null;
};

// facts: { participants, workers } (the floor's workers[] of this STORY and the judge, as floorOf built them).
// null when the task has no such STORY.
export function storyPayload(m, pkgId, facts = {}) {
  const found = cardOf(m, pkgId);
  if (!found) return null;
  const { c, state } = found;
  const nodes = ((c.child && c.child.nodes) || []).filter((n) => n.state !== 'skipped');
  const stageOf = (n) => FLOW_OF[n.stage] || null;
  const flowNodes = nodes.filter(stageOf);
  const attempts = flowNodes.map((n) => attemptOf(n.node_id)).filter(Boolean);
  const running = flowNodes.filter((n) => n.state === 'running' || n.state === 'waiting_human').map((n) => attemptOf(n.node_id)).filter(Boolean);
  const current = running.length ? Math.max(...running) : (attempts.length ? Math.max(...attempts) : null);
  const inTry = (n) => { const a = attemptOf(n.node_id); return a === null || a === current; };

  // FLOW: one state per stage over the current try's nodes ('pending' for a stage with none)
  const flow = FLOW.map((key) => {
    const st = mergeStates(flowNodes.filter((n) => stageOf(n) === key && inTry(n)).map((n) => nodeState(n.state)));
    return { key, state: st || 'pending' };
  });
  const tryNodes = flowNodes.filter(inTry);
  const progress = {
    try_done: tryNodes.filter((n) => n.state === 'done').length, try_total: tryNodes.length,
    total_done: flowNodes.filter((n) => n.state === 'done').length, total_all: flowNodes.length,
  };

  // the attempt-by-node grid: a run-level node (no attempt in its id) sits in attempt 1
  const threshold = num(m.telemetry && m.telemetry.goal_threshold);
  const last = attempts.length ? Math.max(...attempts) : 0;
  const grid = { stages: FLOW, attempts: [] };
  for (let a = 1; a <= last; a++) {
    const cells = {};
    for (const key of FLOW) {
      const ns = flowNodes.filter((n) => stageOf(n) === key && (attemptOf(n.node_id) ?? 1) === a);
      if (!ns.length) { cells[key] = null; continue; }
      const st = mergeStates(ns.map((n) => nodeState(n.state)));
      const bad = ns.find((n) => n.state === 'failed' || n.state === 'blocked');
      const judged = ns.find((n) => num(n.match_pct) !== null);
      cells[key] = { state: st, ...(judged ? { score: judged.match_pct, threshold } : {}), ...(bad && bad.reason ? { reason: clip(bad.reason) } : {}) };
    }
    grid.attempts.push({ attempt: a, cells });
  }

  const id = String(c.id).split(':')[0];
  return {
    task_id: m.task_id, story: id, key: c.ticket_key || null, title: c.title || '', state,
    attempt: Number.isInteger(c.attempt) ? c.attempt : null,
    flow, progress, grid,
    participants: facts.participants || { source: 'none', total: [], live: [] },
    workers: facts.workers || [],
    log: facts.log || [],
  };
}

// ---------- the STORY report payload ----------

// { task_id, story, finished, text, sections }. `raw` is task.json parsed. text is the STORY's doc as the engine
// wrote it (<docs_dir>/E-xxxxxxxx/40-stories/<Pn>.md), the same file a client with no pane reads; finished:false
// until the accept node is done, and then the text is empty (nothing is faked). A finished STORY whose file is
// gone is rendered from the same data. sections: [{ key, lines }] over the keys in REPORT_KEYS.
export function storyReportPayload(raw, pkgId, { read = readFileSync } = {}) {
  const id = String(pkgId);
  const out = { task_id: String((raw && (raw.run_id || raw.task_id)) || ''), story: id, finished: false, text: '', sections: [] };
  if (!raw || !Array.isArray(raw.nodes) || !raw.spec || !(raw.spec.packages || []).some((p) => String(p.id) === id)) return out;
  const { finished, sections } = storyReportSections(raw, id);
  out.finished = finished;
  out.sections = sections.filter((s) => REPORT_KEYS.includes(s.key));
  // the verdict as numbers (score, threshold, attempt, max; tests is the word pass|fail), so a pane parses no key=value line
  const kv = Object.fromEntries(((out.sections.find((s) => s.key === 'verdict') || {}).lines || []).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const n = (v) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  if (out.sections.some((s) => s.key === 'verdict' && s.lines.length > 0)) {
    out.verdict = { score: n(kv.score), threshold: n(kv.threshold), attempt: n(kv.attempt), max: n(kv.max), ...(kv.tests ? { tests: kv.tests } : {}) };
  }
  if (!finished) return out;
  try { out.text = String(read(docPaths(raw).story(id), 'utf8')); } catch {
    try { out.text = renderStory(raw, id); } catch { out.text = ''; }
  }
  return out;
}

// ---------- text, for a client with no pane (English, as the engine writes it) ----------

export function storyText(p) {
  if (!p) return 'no such STORY\n';
  const L = [`${p.key || p.story}  ${p.title}  ${p.state}${p.attempt ? `  attempt ${p.attempt}` : ''}`];
  L.push(`flow: ${p.flow.map((f) => `${f.key}:${f.state}`).join(' ')}`);
  L.push(`nodes: this try ${p.progress.try_done}/${p.progress.try_total} · total ${p.progress.total_done}/${p.progress.total_all}`);
  const ag = (r) => (r.length ? r.map((x) => `${x.n} ${x.kind}${x.model ? `/${x.model}` : ''}`).join(', ') : 'none');
  L.push(`participants (${p.participants.source}): total ${ag(p.participants.total)} · live ${ag(p.participants.live)}`);
  for (const a of p.grid.attempts) {
    L.push(`attempt ${a.attempt}: ${FLOW.map((k) => { const c = a.cells[k]; return c ? `${k}:${c.state}${c.score != null ? ` ${c.score}/${c.threshold ?? '?'}` : ''}${c.reason ? ` "${c.reason}"` : ''}` : `${k}:-`; }).join(' ')}`);
  }
  for (const w of p.workers) L.push(`worker ${w.id}: ${w.state}${Number.isInteger(w.minutes) ? ` ${w.minutes}m` : ''}`);
  return L.join('\n') + '\n';
}

export function storyReportText(p) {
  if (!p.finished) return `${p.story}: not available yet (appears after the gate passes)\n`;
  return p.text.endsWith('\n') ? p.text : p.text + '\n';
}
