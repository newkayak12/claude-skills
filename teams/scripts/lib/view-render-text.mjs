// Plain-text tree rendering of the collect() model - for terminals and CI logs. The HTML page
// (view.mjs) renders the SAME model; this file only turns it into indented lines.

const STATE_MARK = {
  pending: '.', running: '>', done: 'v', failed: 'x', skipped: '-', blocked: '!',
  complete: 'v', missing: '?', unknown: '?',
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
