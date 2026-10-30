// Pure builder behind the teams pane's Dashboard tab: the summarize() task (view-summary.mjs) becomes
// one plain model the terminal draws as Ink, and one SVG document desktop, mobile and vscode draw.
// No fs, no clock of its own (`now` is passed); every field the pane shows is decided here.

const STAGE_LABEL = { plan: 'Plan', build: 'Build', integrate: 'Integrate', qa: 'QA', gate: 'Gate', report: 'Report' };
const LANES = ['running', 'you', 'pending', 'done'];
const LANE_LABEL = { running: 'In progress', you: 'Needs you', pending: 'Up next', done: 'Done' };
const LANE_MAX = 5;
const ACTIVITY_MAX = 6;

const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Each work card in one lane: a card parked on a person is `you` whatever its own state; a failed
// card stays in progress with `failed` set, so the board shows it where the work stopped.
export function lanesOf(task) {
  const waiting = new Set(((task.you && task.you.cards) || []).map((c) => c.title));
  const lanes = Object.fromEntries(LANES.map((k) => [k, []]));
  for (const w of task.work || []) {
    const lane = waiting.has(w.title) ? 'you' : w.state === 'failed' ? 'running' : (lanes[w.state] ? w.state : 'pending');
    lanes[lane].push({ title: w.title, kind: w.kind, failed: w.state === 'failed', reason: w.reason || null });
  }
  return LANES.map((key) => ({ key, label: LANE_LABEL[key], count: lanes[key].length, cards: lanes[key].slice(0, LANE_MAX), more: Math.max(0, lanes[key].length - LANE_MAX) }));
}

// The run's numbers (view-summary.mjs metrics()) as plain fields; null when the task carries none.
function runOf(mt) {
  if (!mt) return null;
  const dr = mt.drivers || {};
  return {
    budget: mt.budget || null,
    drivers: { live: dr.live ?? null, cap: dr.cap ?? null, stalled: dr.stalled || [] },
    denials: mt.denials || 0,
    out_of_retries: mt.out_of_retries || [],
    defects: { filed: (mt.defects && mt.defects.filed) || 0, dropped: (mt.defects && mt.defects.dropped) || 0 },
    scoped_out: (mt.scoped_out || []).length,
  };
}
const storiesOf = (mt) => ((mt && mt.stories) || []).map((s) => ({
  id: s.id, attempt: s.attempt || 0, max_attempts: s.max_attempts ?? null, judge: s.judge || null,
  cost_usd: s.cost_usd || 0, retry_cost_usd: s.retry_cost_usd || 0, wall_ms: s.wall_ms || 0, out_of_retries: !!s.out_of_retries,
}));

export function dashboardModel(task, { now = Date.now(), drivers = null } = {}) {
  if (!task) return null;
  // a stopped EPIC (cancelled, failed, blocked) has no stage at work: the one it stopped in reads failed
  const stopped = ['cancelled', 'failed', 'blocked'].includes(task.state);
  const stages = (task.stages || []).map((s, i) => ({ n: i + 1, key: s.key, label: STAGE_LABEL[s.key] || s.key, state: stopped && s.state === 'running' ? 'failed' : s.state }));
  const doneStages = stages.filter((s) => s.state === 'done').length;
  const pct = stages.length ? Math.round((doneStages / stages.length) * 100) : 0;
  const packages = (task.work || []).filter((w) => w.kind === 'package' || w.kind === 'defect').map((w) => ({ title: w.title, state: w.state }));
  const waiting = (task.you && task.you.cards) || [];
  const tiles = [
    { key: 'progress', label: 'Progress', value: `${pct}%`, sub: `${doneStages}/${stages.length} stages` },
    { key: 'stories', label: 'Stories', value: `${task.done}/${task.total}`, sub: 'accepted' },
    { key: 'cost', label: 'Cost', value: usd(task.cost && task.cost.usd), sub: `${(task.cost && task.cost.turns) || 0} turns` },
    { key: 'waiting', label: 'Needs you', value: String(waiting.length), sub: waiting.length ? 'waiting' : 'nothing', alert: waiting.length > 0 },
  ];
  if (drivers !== null) tiles.push({ key: 'drivers', label: 'Drivers', value: String(drivers), sub: 'live' });
  const activity = (task.log || []).slice(-ACTIVITY_MAX).reverse().map((l) => ({ time: l.time, kind: l.kind, subject: l.subject }));
  const nowLine = !stopped && task.now && task.now.kind && task.now.kind !== 'idle' ? [STAGE_LABEL[task.now.kind] || task.now.kind, task.now.subject].filter(Boolean).join(' · ') : '';
  return {
    key: task.key, title: task.title, state: task.state, pct, now: nowLine,
    stages, packages, lanes: lanesOf(task), tiles, activity,
    run: runOf(task.metrics), stories: storiesOf(task.metrics),
    waiting: waiting.map((c) => ({ who: c.who, title: c.title, question: c.question })),
    at: now,
  };
}

// ---- the run's numbers as lines: the text board and the SVG print the same strings ---------------
const REASON_MAX = 60;
const STORY_LINES_MAX = 12;

function wall(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

// One STORY: id, attempt n/max, judge score vs threshold and its reason, cost with the retry spend
// apart, wall time. A part with no data is left out, never printed as a blank or a NaN.
const SEP = '  ·  ';
function storyParts(s) {
  const head = [s.id, `attempt ${s.attempt}${s.max_attempts != null ? `/${s.max_attempts}` : ''}`];
  let judge = null;
  const j = s.judge;
  if (j && Number.isFinite(j.score)) {
    // a reject at or above the threshold shows the judged node's own gap in place of the reason
    const text = j.gap ? `own gap: ${j.gap}` : (j.reason || '');
    const reason = text.length > REASON_MAX ? `${text.slice(0, REASON_MAX - 1)}…` : text;
    judge = `judge ${j.score}${Number.isFinite(j.threshold) ? ` vs ${j.threshold}` : ''}${reason ? ` — ${reason}` : ''}`;
  }
  const tail = [];
  if (s.cost_usd > 0 || s.retry_cost_usd > 0) tail.push(`cost ${usd(s.cost_usd)}${s.retry_cost_usd > 0 ? ` + retry ${usd(s.retry_cost_usd)}` : ''}`);
  if (s.wall_ms > 0) tail.push(`wall ${wall(s.wall_ms)}`);
  if (s.out_of_retries) tail.push('out of retries');
  return { head, judge, tail };
}

export function storyLine(s) {
  const { head, judge, tail } = storyParts(s);
  return [...head, ...(judge ? [judge] : []), ...tail].join(SEP);
}

// The task-level lines: budget, drivers live/cap and stalled, denials, out of retries, defects, scoped out.
export function runLines(run) {
  if (!run) return [];
  const a = [];
  if (run.budget) a.push(`Budget ${usd(run.budget.spent_usd)} of ${usd(run.budget.limit_usd)}`);
  const d = run.drivers;
  if (d.live != null) a.push(`Drivers ${d.live}${d.cap != null ? `/${d.cap}` : ''} live`);
  if (d.stalled.length) a.push(`Stalled ${d.stalled.map((x) => `${x.id || 'run'} ${x.minutes}m`).join(', ')}`);
  const b = [`Denials ${run.denials}`, `Defects filed ${run.defects.filed} · dropped ${run.defects.dropped}`];
  if (run.out_of_retries.length) b.push(`Out of retries ${run.out_of_retries.join(', ')}`);
  if (run.scoped_out) b.push(`Scoped out ${run.scoped_out}`);
  return [a.join('  ·  '), b.join('  ·  ')].filter(Boolean);
}

const storiesShown = (model) => (model.stories || []).slice(0, STORY_LINES_MAX);
const storiesMore = (model) => Math.max(0, (model.stories || []).length - STORY_LINES_MAX);

export function storyLines(model) {
  const lines = storiesShown(model).map(storyLine);
  if (storiesMore(model)) lines.push(`+${storiesMore(model)} more`);
  return lines;
}

// The SVG's rows, narrower than a line of text: a STORY's judge and reason sit on a second row.
function svgRows(model) {
  const rows = runLines(model.run).map((t) => ({ t, dim: true }));
  for (const s of storiesShown(model)) {
    const { head, judge, tail } = storyParts(s);
    rows.push({ t: [...head, ...tail].join(SEP) });
    if (judge) rows.push({ t: `↳ ${judge}`, dim: true });
  }
  if (storiesMore(model)) rows.push({ t: `+${storiesMore(model)} more`, dim: true });
  return rows;
}

// ---- SVG ----------------------------------------------------------------------------------------
// One palette that reads on a light and a dark host: the frame paints its own dark ground.
const C = {
  bg: '#0f1115', panel: '#171a21', line: '#2a2f3a', text: '#e6e8ee', dim: '#8a92a3', faint: '#4a5161',
  done: '#3fb950', running: '#d97757', failed: '#f85149', pending: '#4a5161', you: '#e3b341', accent: '#d97757',
};
const STATE_COLOR = { done: C.done, running: C.running, failed: C.failed, pending: C.pending, blocked: C.failed };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// approximate cut for a proportional face: ~0.58em per Latin char, 1em per wide glyph
export function fit(s, px, size) {
  const str = String(s ?? '');
  let w = 0;
  let out = '';
  for (const ch of str) {
    const cw = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch) ? size : size * 0.58;
    if (w + cw > px) return out.replace(/\s+$/, '') + '…';
    w += cw;
    out += ch;
  }
  return out;
}

const text = (x, y, s, { size = 12, fill = C.text, weight = 400, anchor = 'start', mono = false } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}"${mono ? ' font-family="ui-monospace,SFMono-Regular,Menlo,monospace"' : ''}>${esc(s)}</text>`;
const rect = (x, y, w, h, { fill = C.panel, stroke = C.line, r = 10, sw = 1, dash = '' } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

export const SVG_WIDTH = 720;

export function dashboardSvg(model) {
  if (!model) return '';
  const W = SVG_WIDTH;
  const P = 20;
  const parts = [];
  let y = P;

  // header: key, title, state chip, progress bar
  const chipColor = STATE_COLOR[model.state] || (model.state === 'complete' ? C.done : model.state === 'waiting_human' ? C.you : C.running);
  parts.push(text(P, y + 14, model.key, { size: 12, fill: C.dim, weight: 600, mono: true }));
  parts.push(text(P, y + 36, fit(model.title, W - 2 * P - 120, 17), { size: 17, weight: 700 }));
  parts.push(rect(W - P - 104, y + 2, 104, 24, { fill: 'none', stroke: chipColor, r: 12 }));
  parts.push(text(W - P - 52, y + 18, String(model.state).replace('_', ' ').toUpperCase(), { size: 11, fill: chipColor, weight: 700, anchor: 'middle' }));
  y += 50;
  parts.push(rect(P, y, W - 2 * P, 6, { fill: C.line, stroke: 'none', r: 3 }));
  parts.push(rect(P, y, Math.max(6, ((W - 2 * P) * model.pct) / 100), 6, { fill: C.accent, stroke: 'none', r: 3 }));
  if (model.now) parts.push(text(P, y + 24, fit(`▸ ${model.now}`, W - 2 * P, 12), { size: 12, fill: C.dim }));
  y += model.now ? 38 : 20;

  // metric tiles
  const tn = model.tiles.length;
  const tg = 10;
  const tw = (W - 2 * P - tg * (tn - 1)) / tn;
  model.tiles.forEach((t, i) => {
    const x = P + i * (tw + tg);
    parts.push(rect(x, y, tw, 72, { stroke: t.alert ? C.you : C.line }));
    parts.push(text(x + 14, y + 22, t.label.toUpperCase(), { size: 10, fill: C.dim, weight: 600 }));
    parts.push(text(x + 14, y + 50, t.value, { size: 24, fill: t.alert ? C.you : C.text, weight: 700 }));
    parts.push(text(x + 14, y + 64, t.sub, { size: 10, fill: C.faint }));
  });
  y += 92;

  // numbered stage pipeline; Build fans out to its packages and folds back into Integrate
  parts.push(text(P, y + 4, 'PIPELINE', { size: 10, fill: C.dim, weight: 600 }));
  y += 16;
  const sn = model.stages.length;
  const sg = 18;
  const sw = (W - 2 * P - sg * (sn - 1)) / sn;
  const sh = 54;
  const pk = model.packages.slice(0, 6);
  const fanH = pk.length ? 22 + pk.length * 26 : 0;
  model.stages.forEach((s, i) => {
    const x = P + i * (sw + sg);
    const col = STATE_COLOR[s.state] || C.pending;
    const active = s.state === 'running';
    parts.push(rect(x, y, sw, sh, { fill: active ? '#22191a' : C.panel, stroke: col, sw: active ? 2 : 1, dash: s.state === 'pending' ? '4 3' : '' }));
    parts.push(`<circle cx="${x + 16}" cy="${y + 18}" r="9" fill="${s.state === 'pending' ? 'none' : col}" stroke="${col}"/>`);
    parts.push(text(x + 16, y + 22, s.state === 'done' ? '✓' : String(s.n), { size: 10, fill: s.state === 'pending' ? C.dim : C.bg, weight: 700, anchor: 'middle' }));
    parts.push(text(x + 32, y + 22, s.label, { size: 12, weight: 600, fill: s.state === 'pending' ? C.dim : C.text }));
    parts.push(text(x + 12, y + 42, s.state, { size: 10, fill: col }));
    if (i < sn - 1) {
      const nx = x + sw;
      const ncol = model.stages[i + 1].state === 'pending' ? C.faint : C.done;
      parts.push(`<line x1="${nx + 2}" y1="${y + sh / 2}" x2="${nx + sg - 2}" y2="${y + sh / 2}" stroke="${ncol}" stroke-width="2"/>`);
    }
  });
  const bi = model.stages.findIndex((s) => s.key === 'build');
  const ii = model.stages.findIndex((s) => s.key === 'integrate');
  if (pk.length && bi >= 0) {
    // a bus down from Build, one branch per package, a bus up into Integrate: right-angle lines only
    const bx = P + bi * (sw + sg) + sw / 2;
    const ix = ii >= 0 ? P + ii * (sw + sg) + sw / 2 : bx;
    const x1 = bx + 16;
    const x2 = Math.min(W - P - 18, P + Math.min(sn, Math.max(ii, bi) + 3) * (sw + sg) - sg - 18);
    const rx = x2 + 10;
    const top = y + sh;
    const cys = pk.map((_, k) => top + 22 + k * 26 + 10);
    const last = cys[cys.length - 1];
    const doneAll = pk.every((p) => p.state === 'done');
    parts.push(`<path d="M${bx} ${top} V${last}" fill="none" stroke="${C.faint}" stroke-width="1.5"/>`);
    parts.push(`<path d="M${rx} ${last} V${top + 10} H${ix} V${top}" fill="none" stroke="${doneAll ? C.done : C.faint}" stroke-width="1.5"/>`);
    pk.forEach((p, k) => {
      const col = STATE_COLOR[p.state] || C.pending;
      const cy = cys[k];
      parts.push(`<path d="M${bx} ${cy} H${x1}" stroke="${C.faint}" stroke-width="1.5"/>`);
      parts.push(`<path d="M${x2} ${cy} H${rx}" stroke="${p.state === 'done' ? C.done : C.faint}" stroke-width="1.5"/>`);
      parts.push(rect(x1, cy - 10, x2 - x1, 20, { fill: C.panel, stroke: col, r: 6 }));
      parts.push(`<circle cx="${x1 + 12}" cy="${cy}" r="4" fill="${col}"/>`);
      parts.push(text(x1 + 22, cy + 4, fit(p.title, x2 - x1 - 32, 11), { size: 11, fill: p.state === 'pending' ? C.dim : C.text }));
    });
    if (model.packages.length > pk.length) parts.push(text(x1, last + 26, `+${model.packages.length - pk.length} more`, { size: 10, fill: C.dim }));
  }
  y += sh + (fanH ? fanH + 12 : 20);

  // kanban: four lanes
  parts.push(text(P, y + 4, 'STORIES', { size: 10, fill: C.dim, weight: 600 }));
  y += 14;
  const kg = 10;
  const kw = (W - 2 * P - kg * 3) / 4;
  const rows = Math.max(1, ...model.lanes.map((l) => l.cards.length + (l.more ? 1 : 0)));
  const kh = 34 + rows * 30;
  model.lanes.forEach((l, i) => {
    const x = P + i * (kw + kg);
    const col = l.key === 'you' ? C.you : l.key === 'done' ? C.done : l.key === 'running' ? C.running : C.dim;
    parts.push(rect(x, y, kw, kh, { fill: '#13161c' }));
    parts.push(`<circle cx="${x + 14}" cy="${y + 17}" r="4" fill="${col}"/>`);
    parts.push(text(x + 24, y + 21, l.label, { size: 11, weight: 600 }));
    parts.push(text(x + kw - 12, y + 21, String(l.count), { size: 11, fill: C.dim, anchor: 'end' }));
    l.cards.forEach((c, j) => {
      const cy = y + 32 + j * 30;
      parts.push(rect(x + 8, cy, kw - 16, 24, { fill: C.panel, stroke: c.failed ? C.failed : C.line, r: 6 }));
      parts.push(text(x + 16, cy + 16, fit(`${c.failed ? '✕ ' : ''}${c.title}`, kw - 36, 11), { size: 11, fill: c.failed ? C.failed : C.text }));
    });
    if (l.more) parts.push(text(x + 16, y + 32 + l.cards.length * 30 + 14, `+${l.more} more`, { size: 10, fill: C.dim }));
  });
  y += kh + 20;

  // the run's numbers: task-level lines, then one line per STORY (the same strings the text board prints)
  const numbers = svgRows(model);
  if (numbers.length) {
    parts.push(text(P, y + 4, 'NUMBERS', { size: 10, fill: C.dim, weight: 600 }));
    y += 12;
    numbers.forEach((r, i) => parts.push(text(P, y + 6 + i * 18 + 12, fit(r.t, W - 2 * P, 11), { size: 11, fill: r.dim ? C.dim : C.text })));
    y += 12 + numbers.length * 18;
  }

  // needs-you then activity
  if (model.waiting.length) {
    model.waiting.slice(0, 3).forEach((w) => {
      parts.push(rect(P, y, W - 2 * P, 28, { fill: '#221d10', stroke: C.you, r: 8 }));
      parts.push(text(P + 12, y + 18, fit(`⚑ ${w.title}${w.question ? ` — ${w.question}` : ''}`, W - 2 * P - 24, 12), { size: 12, fill: C.you }));
      y += 34;
    });
    y += 6;
  }
  parts.push(text(P, y + 4, 'ACTIVITY', { size: 10, fill: C.dim, weight: 600 }));
  y += 12;
  const acts = model.activity.length ? model.activity : [{ time: '', kind: '', subject: 'nothing yet' }];
  acts.forEach((a, i) => {
    const ay = y + 6 + i * 22;
    const col = a.kind === 'failed' ? C.failed : a.kind === 'passed' || a.kind === 'finished' || a.kind === 'integrated' ? C.done : a.kind === 'waiting' ? C.you : C.dim;
    parts.push(text(P, ay + 12, a.time, { size: 11, fill: C.faint, mono: true }));
    parts.push(`<circle cx="${P + 52}" cy="${ay + 8}" r="3.5" fill="${col}"/>`);
    parts.push(text(P + 64, ay + 12, a.kind, { size: 11, fill: col, weight: 600 }));
    parts.push(text(P + 150, ay + 12, fit(a.subject, W - 2 * P - 150, 11), { size: 11 }));
  });
  y += 12 + acts.length * 22 + P;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${y}" width="${W}" height="${y}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif">`
    + `<rect width="${W}" height="${y}" rx="14" fill="${C.bg}"/>${parts.join('')}</svg>`;
}

export function dashboardAlt(model) {
  if (!model) return 'no task';
  const st = model.stages.map((s) => `${s.label} ${s.state}`).join(', ');
  return `${model.key} ${model.title}: ${model.state}, ${model.pct}% — ${st}`;
}

// ---- text ---------------------------------------------------------------------------------------
// The board as a few plain lines: what /teams-status answers where no pane is drawn (the Claude app
// over Remote Control gets the command's text only). No column alignment: a phone sets it proportional.
const MARK_GLYPH = { done: '✔', running: '◉', pending: '○', failed: '✘' };

export function dashboardText(model) {
  if (!model) return '';
  const bar = (n) => '▰'.repeat(Math.round(n / 10)) + '▱'.repeat(10 - Math.round(n / 10));
  const lane = (k) => model.lanes.find((l) => l.key === k);
  const titles = (l) => l.cards.map((c) => `${c.failed ? '✘ ' : ''}${c.title}`).join(' · ') + (l.more ? ` · +${l.more}` : '');
  const out = [
    `${model.key}  ${model.title}`,
    `${String(model.state).replace('_', ' ').toUpperCase()}  ${bar(model.pct)} ${model.pct}%`,
  ];
  if (model.now) out.push(`▸ ${model.now}`);
  out.push(model.tiles.map((t) => `${t.label} ${t.value}`).join('  ·  '));
  out.push('', model.stages.map((s) => `${MARK_GLYPH[s.state] || '○'} ${s.label}`).join(' → '));
  for (const w of model.waiting) out.push(`⚑ ${w.title}${w.question ? ` — ${w.question}` : ''}`);
  out.push('');
  for (const k of ['running', 'you', 'pending', 'done']) {
    const l = lane(k);
    if (l && l.count) out.push(`${l.label} ${l.count}: ${titles(l)}`);
  }
  const numbers = [...runLines(model.run), ...storyLines(model)];
  if (numbers.length) out.push('', ...numbers);
  if (model.activity.length) {
    out.push('', 'Recent');
    for (const a of model.activity.slice(0, 4)) out.push(`${a.time}  ${a.kind}  ${a.subject ?? ''}`.trimEnd());
  }
  return out.join('\n') + '\n';
}
