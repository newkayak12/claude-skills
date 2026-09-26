// Plain-text tree rendering of the collect() model - for terminals and CI logs. The HTML page
// (view.mjs) renders the SAME model; this file only turns it into indented lines.

const STATE_MARK = {
  pending: '.', running: '>', done: 'v', failed: 'x', skipped: '-', blocked: '!',
  complete: 'v', missing: '?', unknown: '?', waiting_human: 'H',
  // 'unreachable' (graph.mjs's settleFailure - a node downstream of a failure with no retry
  // left, released so the run can still settle instead of hanging pending forever) used to fall
  // through to the same '?' as missing/unknown - indistinguishable from "collect() could not
  // read this" on the strip. Its own glyph so a person scanning marks can tell "will never run
  // because something upstream died" from "unknown" at a glance.
  unreachable: 'u',
};

function mark(state) { return STATE_MARK[state] || '?'; }

function fmtMs(ms) {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}m${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function fmtUsd(n) { return typeof n === 'number' ? `$${n.toFixed(2)}` : ''; }

function line(indent, text) { return '  '.repeat(indent) + text; }

// fileDefects() (taskmanager.mjs) is the only thing that writes a multi-line brief (a filed
// defect's brief is "Title: ...\nSeverity: ...\nEvidence:\n...", not a sentence) - every other
// caller's brief is one line already, so line(indent, text) alone worked until a defect STORY's
// own brief hit this path. Indents every line, not just the first: this is the deep per-task
// tree (--task <id> / a package's own subtree), which already prints full multi-line detail
// elsewhere (a node's `reason:`, a QA/audit round's defect/unmet titles) - clipping only the
// brief would hide the one thing (severity, evidence) those other fields do not carry.
function indentBlock(indent, text) {
  return String(text).split('\n').map((l) => line(indent, l)).join('\n');
}

// storyLinks (tickets.mjs), compacted onto one optional line per package card: "blocked by"/
// "blocks" name a sibling STORY id plus its OWN current ticket state (not just that a dep
// exists - whether it has actually cleared), "implements" names the PRD user stories this
// package satisfies. `filed_by` is deliberately left out of this line - the package header
// line already prints it as "[filed by X]" (see renderModelBody below); repeating it here
// would be the same fact twice on the same card. Empty string (never a line with nothing on
// it) when a package has none of these - an ordinary, unblocked, unrelated package with no PRD
// story renders no extra line at all.
function formatLinksLine(links) {
  if (!links) return '';
  const bits = [];
  if (links.blocked_by && links.blocked_by.length) {
    bits.push(`blocked by ${links.blocked_by.map((l) => `${l.id} (${l.state})`).join(', ')}`);
  }
  if (links.blocks && links.blocks.length) {
    bits.push(`blocks ${links.blocks.map((l) => `${l.id} (${l.state})`).join(', ')}`);
  }
  if (links.implements && links.implements.length) {
    bits.push(`implements ${links.implements.join(', ')}`);
  }
  return bits.join(' · ');
}

function renderNode(n, indent, out) {
  const bits = [`[${mark(n.state)}] ${n.node_id}`, `(${n.stage})`];
  if (n.elapsed_ms != null) bits.push(fmtMs(n.elapsed_ms));
  if (n.verdict !== undefined) bits.push(`verdict=${n.verdict}`);
  if (n.match_pct !== undefined) bits.push(`match=${n.match_pct}%`);
  out.push(line(indent, bits.join(' ')));
  if (n.reason) out.push(line(indent + 1, `reason: ${n.reason}`));
  if (n.gaps && n.gaps.length) out.push(line(indent + 1, `gaps: ${n.gaps.join('; ')}`));
  // waiting_elapsed_ms (view-collect.mjs's nodeSummary) - the one timestamp a node parked
  // straight from 'pending' into waiting_human ever gets, since it never ran (started_at stays
  // null). "how long has this been sitting" is the whole point of showing it at all.
  if (n.waiting_elapsed_ms != null) out.push(line(indent + 1, `waiting: ${fmtMs(n.waiting_elapsed_ms)}`));
}

// storyBlockedReason (tickets.mjs), rendered as one line: which of the five kinds of "why" this
// STORY is stuck on, plus whatever detail that kind carries (the dep node ids, a restart count,
// or how long it has been parked) - the "why is it waiting" the pipeline/tickets view had no
// answer for beyond the bare ticket state.
const BLOCKED_REASON_LABEL = {
  unmet_deps: 'unmet deps',
  upstream_defect: 'waiting on a fix it filed against an upstream package',
  capacity: 'waiting on provider capacity',
  restart_exhausted: 'driver restart budget exhausted',
  human_wait: 'waiting on a human',
};

function formatBlockedReason(br) {
  if (!br) return '';
  const bits = [BLOCKED_REASON_LABEL[br.reason] || br.reason];
  if (br.reason === 'unmet_deps' && br.node_ids && br.node_ids.length) bits.push(`(${br.node_ids.join(', ')})`);
  if (br.reason === 'upstream_defect' && br.upstream && br.upstream.length) bits.push(`(${br.upstream.join(', ')})`);
  if (br.reason === 'restart_exhausted' && br.restarts != null) bits.push(`(${br.restarts} restart${br.restarts === 1 ? '' : 's'})`);
  if (br.elapsed_ms != null) bits.push(`(${fmtMs(br.elapsed_ms)})`);
  return bits.join(' ');
}

function renderChild(child, indent, out) {
  if (!child) return;
  if (child.missing) {
    out.push(line(indent, `child run ${child.run_id}: NO FILE at ${child.cwd}`));
    return;
  }
  out.push(line(indent, `child ${child.run_id} [${child.state}] ${child.cwd}`));
  for (const n of child.nodes || []) renderNode(n, indent + 1, out);
  for (const nested of child.nested || []) {
    out.push(line(indent + 1, `nested task ${nested.task_id} at ${nested.tasks_dir}`));
    renderModelBody(nested, indent + 2, out);
  }
}

function renderModelBody(m, indent, out) {
  if (m.error) { out.push(line(indent, `ERROR: ${m.error}`)); return; }
  out.push(line(indent, `state=${m.state} size=${m.size || '?'} flow=${m.flow || '?'} cost=${fmtUsd(m.cost && m.cost.usd)} turns=${m.cost && m.cost.turns} elapsed=${fmtMs(m.elapsed_ms)}`));
  if (m.budget) {
    const b = m.budget;
    const bits = [];
    if (b.budget_usd != null) bits.push(`budget ${fmtUsd(b.spend_usd)}/${fmtUsd(b.budget_usd)} (${Math.round(b.budget_pct * 100)}%)`);
    if (b.timebox_minutes != null) bits.push(`timebox ${Math.round(b.elapsed_minutes)}/${b.timebox_minutes}m (${Math.round(b.timebox_pct * 100)}%)`);
    if (b.stopped) bits.push(`STOPPED${b.stopped.skipped_packages.length ? ` - not done: ${b.stopped.skipped_packages.join(', ')}` : ''}`);
    else if (b.warned) bits.push('WARN 80%');
    out.push(line(indent, bits.join(' · ')));
  }
  if (m.daemon) out.push(line(indent, `daemon pid=${m.daemon.pid} alive=${m.daemon.alive} restarts=${m.daemon.restarts}${m.daemon.exhausted ? ' EXHAUSTED' : ''}`));
  if (m.s_run) {
    out.push(line(indent, 'S run:'));
    for (const n of m.s_run.nodes || []) renderNode(n, indent + 1, out);
    return;
  }
  out.push(line(indent, 'manager pipeline:'));
  for (const n of m.manager_stages || []) renderNode(n, indent + 1, out);
  out.push(line(indent, 'packages:'));
  for (const p of m.packages || []) {
    out.push(line(indent + 1, `${p.id}${p.title ? ' - ' + p.title : ''}${p.phase ? ` (${p.phase})` : ''}${p.reporter ? ` [filed by ${p.reporter}]` : ''}`));
    const linksLine = formatLinksLine(p.links);
    if (linksLine) out.push(line(indent + 2, linksLine));
    const blockedLine = formatBlockedReason(p.blocked_reason);
    if (blockedLine) out.push(line(indent + 2, `blocked: ${blockedLine}`));
    if (p.brief) out.push(indentBlock(indent + 2, p.brief));
    if (p.dispatch) renderNode(p.dispatch, indent + 2, out);
    if (p.accept) renderNode(p.accept, indent + 2, out);
    if (p.dispatch && p.dispatch.node_id && p.child) renderChild(p.child, indent + 2, out);
  }
  renderPhaseRounds(m.qa, 'QA', indent, out);
  renderPhaseRounds(m.audit, 'AUDIT', indent, out);
}

// The QA and planning-audit phase-Teams (§2/§3): a fixed package (task.qa_pkg / task.audit_pkg)
// that can be dispatched more than once - one round per defect/unmet-story cycle, capped by
// qa_rounds. Printed as its own section, not folded into "packages:", because a round is not a
// develop STORY: it has no title of its own worth repeating per round, and what a person needs
// from it - round number, state, how many defects/unmet stories it found - is different from
// what a package needs (title, brief, deps).
function renderPhaseRounds(phase, label, indent, out) {
  if (!phase || !phase.rounds.length) return;
  out.push(line(indent, `${label}:`));
  for (const r of phase.rounds) {
    const bits = [`[${mark(r.state)}] ${label}:${r.round}`];
    if (r.defects_count != null) bits.push(`defects=${r.defects_count}`);
    if (r.unmet_count != null) bits.push(`unmet=${r.unmet_count}`);
    out.push(line(indent + 1, bits.join(' ')));
    if (r.defect_titles && r.defect_titles.length) out.push(line(indent + 2, `defects: ${r.defect_titles.join('; ')}`));
    if (r.unmet_titles && r.unmet_titles.length) out.push(line(indent + 2, `unmet: ${r.unmet_titles.join('; ')}`));
    if (r.dispatch) renderNode(r.dispatch, indent + 2, out);
    if (r.accept) renderNode(r.accept, indent + 2, out);
    if (r.dispatch && r.dispatch.node_id && r.child) renderChild(r.child, indent + 2, out);
  }
}

export function renderText(model) {
  const out = [];
  out.push(`task ${model.task_id}`);
  if (model.request) out.push(`request: ${model.request.length > 300 ? model.request.slice(0, 300) + '...' : model.request}`);
  renderModelBody(model, 0, out);
  if (model.events && model.events.length) {
    out.push('recent events:');
    for (const e of model.events) {
      const ts = e.ts ? new Date(e.ts).toISOString() : '?';
      const { ts: _t, event, ...rest } = e;
      out.push(line(1, `${ts} ${event} ${JSON.stringify(rest)}`));
    }
  }
  return out.join('\n') + '\n';
}

function fmtTime(ts) { return ts ? new Date(ts).toISOString() : '?'; }

// ---------- TICKET view: a JIRA-like board for one task ----------
//
// Every card this draws is a package already collected by packageModel() (view-collect.mjs) -
// an ordinary STORY (model.packages) or the LATEST round of a QA/audit phase-Team package
// (model.qa.rounds / model.audit.rounds). Earlier QA/audit rounds are history, not a live board
// column - storyTicketState (which ticket_state carries) always reads the latest attempt for a
// subgoal_id anyway, so a stale round would just repeat the same state as a duplicate card.
function boardCards(m) {
  const cards = (m.packages || []).slice();
  if (m.qa && m.qa.rounds.length) cards.push(m.qa.rounds[m.qa.rounds.length - 1]);
  if (m.audit && m.audit.rounds.length) cards.push(m.audit.rounds[m.audit.rounds.length - 1]);
  return cards;
}

// The full set storyTicketState (tickets.mjs) can return, in the order its own workflow diagram
// draws them (§4) - "show only non-empty columns" (the spec) is done by the caller skipping an
// empty list, not by shrinking this order, so the columns that DO appear are always in the same
// left-to-right sequence run to run.
const TICKET_STATE_ORDER = [
  'BACKLOG', 'READY', 'IN_PROGRESS', 'WAITING_HUMAN', 'WAITING_CAPACITY',
  'IN_REVIEW', 'DONE', 'REJECTED', 'BLOCKED', 'CANCELLED', 'UNREACHABLE',
];

function renderTicketCard(c, indent, out) {
  const role = c.phase || 'develop';
  const head = [`[${c.ticket_key || c.id}]`, c.id, c.title ? `- ${c.title}` : '', `(${role})`].filter(Boolean).join(' ');
  out.push(line(indent, head));
  const bits = [];
  if (c.reporter) bits.push(`filed by ${c.reporter}`);
  if (c.attempt != null) bits.push(`attempt=${c.attempt}`);
  if (c.deps && c.deps.length) bits.push(`deps=${c.deps.join(',')}`);
  if (bits.length) out.push(line(indent + 1, bits.join(' ')));
  if (c.links && c.links.implements && c.links.implements.length) out.push(line(indent + 1, `implements ${c.links.implements.join(', ')}`));
  // enables[]: not a field any package carries today (grep the repo - it does not exist yet),
  // but the spec asks for it "if present" - defensive, not a new field this file invents.
  if (c.links && Array.isArray(c.links.enables) && c.links.enables.length) out.push(line(indent + 1, `enables ${c.links.enables.join(', ')}`));
  const blockedLine = formatBlockedReason(c.blocked_reason);
  if (blockedLine) out.push(line(indent + 1, `blocked: ${blockedLine}`));
  // The clear human marker the spec asks for: either the ticket state itself is WAITING_HUMAN
  // (storyTicketState, tickets.mjs) or a STORY-level pin (pkg.assignee) is set even before any
  // node has actually parked - both read off packageModel's own `assignee`/`ticket_state`.
  if (c.ticket_state === 'WAITING_HUMAN' || c.assignee) {
    out.push(line(indent + 1, `>>> WAITING ON HUMAN${c.assignee ? `: ${c.assignee}` : ''} <<<`));
  }
  const tasks = c.child && c.child.tasks;
  if (tasks && tasks.length) {
    out.push(line(indent + 1, 'tasks:'));
    for (const t of tasks) out.push(line(indent + 2, `[${t.state}] ${t.key}${t.title ? ' - ' + t.title : ''}`));
  }
}

// tickets.mjs's own flowMetrics(), one summary line: WIP, throughput (done count and a per-day
// rate), mean Work Item Age of everything still open, and the mean cycle/lead time of whatever
// has reached DONE so far. Any field flowMetrics could not compute yet (an empty board.jsonl, or
// nothing has reached DONE) prints '?'/is left off rather than a misleading 0.
function formatFlowMetricsLine(fm) {
  const bits = [`WIP=${fm.wip}`];
  const perDay = fm.throughput.per_day != null ? fm.throughput.per_day.toFixed(2) : '?';
  bits.push(`throughput=${perDay}/day (${fm.throughput.done} done)`);
  if (fm.mean_work_item_age_ms != null) bits.push(`mean age=${fmtMs(fm.mean_work_item_age_ms)}`);
  if (fm.cycle_time_ms.mean != null) bits.push(`cycle=${fmtMs(fm.cycle_time_ms.mean)}`);
  if (fm.lead_time_ms.mean != null) bits.push(`lead=${fmtMs(fm.lead_time_ms.mean)}`);
  return bits.join('  ');
}

export function renderTicketsText(model) {
  const out = [];
  if (model.error) { out.push(`task ${model.task_id}`, `ERROR: ${model.error}`); return out.join('\n') + '\n'; }
  const t = model.ticket || {};
  out.push(`${t.key || model.task_id}  ${t.state || '?'}${t.phase ? ' · ' + t.phase : ''}  ${t.title || ''}`);
  if (model.request) out.push(`request: ${model.request.length > 300 ? model.request.slice(0, 300) + '...' : model.request}`);
  if (model.flow_metrics) out.push(formatFlowMetricsLine(model.flow_metrics));
  const columns = {};
  for (const c of boardCards(model)) {
    const st = c.ticket_state || 'BACKLOG';
    (columns[st] = columns[st] || []).push(c);
  }
  for (const st of TICKET_STATE_ORDER) {
    const list = columns[st];
    if (!list || !list.length) continue;
    out.push('', `${st}:`);
    for (const c of list) renderTicketCard(c, 1, out);
  }
  return out.join('\n') + '\n';
}

// ---------- RESOURCE view: the team hierarchy as it is actually resourced right now ----------
//
// TaskLeader (task.daemon) -> one Team per STORY (a package's own child run - worktree, branch,
// TeamLeader = the child's driver) -> workers per TASK (the child run's own chain nodes, each
// with executor/vendor/model/state/timing - nodeSummary already carries all of it). Every field
// this reads already exists on the SAME collect() model the pipeline view renders; nothing here
// re-derives liveness, cost, or state a second way.
function renderTeam(label, teamLike, indent, out) {
  out.push(line(indent, `Team ${label}`));
  if (!teamLike) { out.push(line(indent + 1, '(not dispatched yet - no worktree)')); return; }
  if (teamLike.missing) { out.push(line(indent + 1, `child run file missing at ${teamLike.cwd}`)); return; }
  // packageModel() (view-collect.mjs) falls back to the latest earlier attempt's own child/cost
  // when the CURRENT attempt has not opened a worktree yet - say so plainly, so this never reads
  // as the live attempt's own team.
  if (teamLike.retry_pending) {
    out.push(line(indent + 1, `(retry pending - showing attempt ${teamLike.retry_pending_attempt}'s worktree/cost, a new one has not opened yet)`));
  }
  out.push(line(indent + 1, `worktree: ${teamLike.cwd}${teamLike.branch ? ` (${teamLike.branch})` : ''}`));
  const d = teamLike.driver;
  if (d) {
    const cost = d.cost ? ` cost=${fmtUsd(d.cost.cost_usd)} turns=${d.cost.turns}` : '';
    out.push(line(indent + 1, `TeamLeader pid=${d.pid} alive=${d.alive} restarts=${d.restarts}${cost}`));
  }
  if (teamLike.waiting_capacity) {
    const elapsed = teamLike.waiting_capacity.elapsed_ms != null ? ` (${fmtMs(teamLike.waiting_capacity.elapsed_ms)})` : '';
    out.push(line(indent + 1, `waiting_capacity: ${teamLike.waiting_capacity.reason || ''}${elapsed}`));
  }
  const nodes = teamLike.nodes || [];
  if (nodes.length) {
    out.push(line(indent + 1, 'workers:'));
    for (const n of nodes) {
      const bits = [`[${mark(n.state)}] ${n.node_id}`, `(${n.stage})`];
      if (n.executor) bits.push(`executor=${n.executor}`);
      if (n.model) bits.push(`model=${n.model}`);
      if (n.elapsed_ms != null) bits.push(fmtMs(n.elapsed_ms));
      if (n.assignee) bits.push(`human=${n.assignee}`);
      if (n.waiting_elapsed_ms != null) bits.push(`waiting=${fmtMs(n.waiting_elapsed_ms)}`);
      out.push(line(indent + 2, bits.join(' ')));
    }
  }
  for (const nested of teamLike.nested || []) {
    out.push(line(indent + 1, `nested task ${nested.task_id} at ${nested.tasks_dir}`));
    renderResourcesBody(nested, indent + 2, out);
  }
}

function renderResourcesBody(m, indent, out) {
  if (m.error) { out.push(line(indent, `ERROR: ${m.error}`)); return; }
  const d = m.daemon;
  out.push(line(indent, 'TaskLeader'));
  out.push(line(indent + 1, d
    ? `pid=${d.pid} alive=${d.alive} started=${fmtTime(d.started_at)} restarts=${d.restarts}${d.exhausted ? ' EXHAUSTED' : ''}`
    : '(no daemon - driven by hand or an MCP client)'));
  if (m.s_run) { renderTeam('S', m.s_run, indent, out); return; }
  for (const p of m.packages || []) renderTeam(`${p.id}${p.title ? ' - ' + p.title : ''}`, p.child, indent, out);
  for (const r of (m.qa && m.qa.rounds) || []) renderTeam(`QA:${r.round}`, r.child, indent, out);
  for (const r of (m.audit && m.audit.rounds) || []) renderTeam(`AUDIT:${r.round}`, r.child, indent, out);
}

export function renderResourcesText(model) {
  const out = [`task ${model.task_id}`];
  renderResourcesBody(model, 0, out);
  return out.join('\n') + '\n';
}

// One card per EPIC: the key + a derived title as the headline (a raw UUID and the engine's
// internal run state are not something a person can act on - see view-collect.mjs's listTasks()
// for where epic_key/title/state/phase/stories/open_defects come from and why). The full task_id
// stays on the second line, in the one spot a person needing `--task <uuid>` will look, never as
// the headline.
function statusLabel(r) { return r.phase ? `${r.state} · ${r.phase}` : r.state; }

function storiesLabel(r) {
  return r.stories_total == null ? null : `stories ${r.stories_done}/${r.stories_total} done`;
}

export function renderIndexText(rows, tasksDir) {
  const out = [`tasks under ${tasksDir}:`];
  if (!rows.length) { out.push('  (none)'); return out.join('\n') + '\n'; }
  for (const r of rows) {
    if (r.error) { out.push(`  ${r.epic_key}  ERROR: ${r.error}  (task ${r.task_id})`); continue; }
    out.push(`  ${r.epic_key}  ${statusLabel(r)}  ${r.title}`);
    const bits = [`task=${r.task_id}`, `size=${r.size || '?'}`];
    const stories = storiesLabel(r);
    if (stories) bits.push(stories);
    if (r.open_defects) bits.push(`open defects=${r.open_defects}`);
    bits.push(`cost=${fmtUsd(r.cost_usd)}`, `elapsed=${fmtMs(r.elapsed_ms)}`);
    out.push(`    ${bits.join('  ')}`);
  }
  return out.join('\n') + '\n';
}
