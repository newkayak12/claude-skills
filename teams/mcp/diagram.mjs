#!/usr/bin/env node
// develop:architecture-designer - a typed diagram IR, validated before anything is drawn, rendered to one
// self-contained HTML file (inline SVG, no scripts from anywhere else, no dependencies).
//
//   node diagram.mjs check  <ir.json>              -> exit 0 and "ok", or exit 1 and one repair per line
//   node diagram.mjs render <ir.json> <out.html>   -> checks first; writes out.html only when it passes
//
// The layout is the author's, not a solver's: every node names its own grid cell (row, col) in
// a grid diagram, and a sequence diagram's order is its message order. What this file checks is
// that the picture is well-formed and readable - it never moves anything.
//
// A copy of this file lives at teams/mcp/diagram.mjs (teams imports it at runtime and cannot
// reach another plugin's directory). teams/scripts/test-diagram.mjs fails when the two differ.

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TYPES = ['architecture', 'dataflow', 'workflow', 'lifecycle', 'sequence'];
export const NODE_KINDS = ['actor', 'service', 'store', 'queue', 'external', 'step', 'state', 'decision', 'package'];
export const EDGE_STYLES = ['sync', 'async', 'data', 'fail'];
const MAX_NODES = 40;
const MAX_LABEL = 48;
const ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,39}$/;

// Every problem is phrased as the repair that removes it, so an author (a person, or the model
// that wrote the IR) can apply it without reading this file.
export function validate(ir) {
  const errs = [];
  if (!ir || typeof ir !== 'object' || Array.isArray(ir)) return ['the IR must be a JSON object'];
  if (!TYPES.includes(ir.type)) errs.push(`set "type" to one of ${TYPES.join(', ')} (got ${JSON.stringify(ir.type)})`);
  if (typeof ir.title !== 'string' || !ir.title.trim()) errs.push('give the diagram a "title"');
  const label = (where, s) => {
    if (typeof s !== 'string' || !s.trim()) errs.push(`${where}: add a "label"`);
    else if (s.length > MAX_LABEL) errs.push(`${where}: shorten the label to ${MAX_LABEL} characters or fewer (it is ${s.length}); put the rest in "note"`);
  };
  if (ir.type === 'sequence') {
    const ps = Array.isArray(ir.participants) ? ir.participants : [];
    const ms = Array.isArray(ir.messages) ? ir.messages : [];
    if (ps.length < 2) errs.push('a sequence needs at least two "participants"');
    if (!ms.length) errs.push('a sequence needs at least one entry in "messages"');
    const ids = new Set();
    ps.forEach((p, i) => {
      const where = `participants[${i}]`;
      if (!p || !ID.test(String(p.id || ''))) errs.push(`${where}: give it an "id" of letters, digits, _ . : - (starting with a letter)`);
      else if (ids.has(p.id)) errs.push(`${where}: id "${p.id}" is used twice - rename one`);
      else ids.add(p.id);
      label(`participant ${p && p.id || i}`, p && p.label);
      if (p && p.kind != null && !NODE_KINDS.includes(p.kind)) errs.push(`participant ${p.id}: set "kind" to one of ${NODE_KINDS.join(', ')} or leave it out`);
    });
    ms.forEach((m, i) => {
      const where = `messages[${i}]`;
      if (!m || !ids.has(m.from)) errs.push(`${where}: "from" must name a participant id (got ${JSON.stringify(m && m.from)})`);
      if (!m || !ids.has(m.to)) errs.push(`${where}: "to" must name a participant id (got ${JSON.stringify(m && m.to)})`);
      label(where, m && m.label);
      if (m && m.style != null && !EDGE_STYLES.includes(m.style)) errs.push(`${where}: set "style" to one of ${EDGE_STYLES.join(', ')} or leave it out`);
    });
    if (ms.length > 60) errs.push(`split the sequence: ${ms.length} messages is more than one reader follows (keep it to 60)`);
    return errs;
  }
  const nodes = Array.isArray(ir.nodes) ? ir.nodes : [];
  const edges = Array.isArray(ir.edges) ? ir.edges : [];
  if (!nodes.length) errs.push('add at least one entry to "nodes"');
  if (nodes.length > MAX_NODES) errs.push(`split the diagram: ${nodes.length} nodes is more than one picture holds (keep it to ${MAX_NODES})`);
  const byId = new Map();
  const cells = new Map();
  nodes.forEach((n, i) => {
    const where = `nodes[${i}]`;
    if (!n || !ID.test(String(n.id || ''))) { errs.push(`${where}: give it an "id" of letters, digits, _ . : - (starting with a letter)`); return; }
    if (byId.has(n.id)) { errs.push(`${where}: id "${n.id}" is used twice - rename one`); return; }
    byId.set(n.id, n);
    label(`node ${n.id}`, n.label);
    if (n.kind != null && !NODE_KINDS.includes(n.kind)) errs.push(`node ${n.id}: set "kind" to one of ${NODE_KINDS.join(', ')} or leave it out`);
    if (!Number.isInteger(n.row) || n.row < 0 || n.row > 20) errs.push(`node ${n.id}: set "row" to a whole number 0-20 - you choose where it sits`);
    if (!Number.isInteger(n.col) || n.col < 0 || n.col > 12) errs.push(`node ${n.id}: set "col" to a whole number 0-12 - you choose where it sits`);
    if (Number.isInteger(n.row) && Number.isInteger(n.col)) {
      const k = `${n.row},${n.col}`;
      if (cells.has(k)) errs.push(`nodes ${cells.get(k)} and ${n.id} both sit at row ${n.row}, col ${n.col} - move one to a free cell`);
      else cells.set(k, n.id);
    }
  });
  const linked = new Set();
  edges.forEach((e, i) => {
    const where = `edges[${i}]`;
    if (!e || !byId.has(e.from)) errs.push(`${where}: "from" must name a node id (got ${JSON.stringify(e && e.from)})`);
    if (!e || !byId.has(e.to)) errs.push(`${where}: "to" must name a node id (got ${JSON.stringify(e && e.to)})`);
    if (e && e.from === e.to && byId.has(e.from)) errs.push(`${where}: a node pointing at itself (${e.from}) reads as nothing - draw it as a note, or give the loop its own step`);
    if (e && e.label != null && (typeof e.label !== 'string' || e.label.length > MAX_LABEL)) errs.push(`${where}: keep the edge label a string of ${MAX_LABEL} characters or fewer`);
    if (e && e.style != null && !EDGE_STYLES.includes(e.style)) errs.push(`${where}: set "style" to one of ${EDGE_STYLES.join(', ')} or leave it out`);
    if (e) { linked.add(e.from); linked.add(e.to); }
  });
  if (nodes.length > 1) {
    for (const id of byId.keys()) if (!linked.has(id)) errs.push(`node ${id} has no edge - connect it or drop it; an island says nothing about the system`);
  }
  // A boundary is drawn as the box around its members' cells. A node that is not a member but
  // sits inside that box would read as belonging to it.
  const groups = Array.isArray(ir.groups) ? ir.groups : [];
  const member = new Map();
  groups.forEach((g, i) => {
    const where = `groups[${i}]`;
    if (!g || !ID.test(String(g.id || ''))) { errs.push(`${where}: give it an "id"`); return; }
    label(`group ${g.id}`, g.label);
    const ms = Array.isArray(g.nodes) ? g.nodes : [];
    if (!ms.length) errs.push(`group ${g.id}: list its member node ids in "nodes"`);
    for (const m of ms) {
      if (!byId.has(m)) errs.push(`group ${g.id}: "${m}" is not a node id`);
      else if (member.has(m)) errs.push(`node ${m} is in both group ${member.get(m)} and group ${g.id} - a node sits in one boundary`);
      else member.set(m, g.id);
    }
    const placed = ms.map((m) => byId.get(m)).filter((n) => n && Number.isInteger(n.row) && Number.isInteger(n.col));
    if (!placed.length) return;
    const r0 = Math.min(...placed.map((n) => n.row)), r1 = Math.max(...placed.map((n) => n.row));
    const c0 = Math.min(...placed.map((n) => n.col)), c1 = Math.max(...placed.map((n) => n.col));
    for (const n of byId.values()) {
      if (ms.includes(n.id) || !Number.isInteger(n.row) || !Number.isInteger(n.col)) continue;
      if (n.row >= r0 && n.row <= r1 && n.col >= c0 && n.col <= c1) errs.push(`node ${n.id} (row ${n.row}, col ${n.col}) sits inside group ${g.id}'s box (rows ${r0}-${r1}, cols ${c0}-${c1}) but is not a member - move it out or add it to the group`);
    }
  });
  return errs;
}

// ---------- rendering ----------

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CW = 290, CH = 124, NW = 188, NH = 64, PAD = 40;

// Up to two lines of at most ~24 characters, broken at spaces or slashes; what does not fit is
// cut with an ellipsis (the full label stays in the node's hover title).
function wrap(label, width = 24) {
  const words = String(label).split(/(?<=[\s/])/);
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if ((cur + w).trim().length <= width || !cur) lines[lines.length - 1] = cur + w;
    else lines.push(w);
  }
  const out = lines.map((l) => l.trim()).filter(Boolean);
  if (out.length > 2) out.splice(2, out.length - 2, '');
  return out.map((l, i) => (l.length > width ? `${l.slice(0, width - 1)}…` : l) + (i === 1 && lines.length > 2 ? '…' : '')).filter(Boolean);
}

function shape(n, x, y) {
  const w = NW, h = NH, k = n.kind || 'service';
  if (k === 'store') {
    const ry = 9;
    return `<path class="shape" d="M${x} ${y + ry} a${w / 2} ${ry} 0 0 1 ${w} 0 v${h - 2 * ry} a${w / 2} ${ry} 0 0 1 ${-w} 0 z"/><path class="shape-line" d="M${x} ${y + ry} a${w / 2} ${ry} 0 0 0 ${w} 0"/>`;
  }
  if (k === 'decision') return `<path class="shape" d="M${x + w / 2} ${y - 6} L${x + w + 8} ${y + h / 2} L${x + w / 2} ${y + h + 6} L${x - 8} ${y + h / 2} Z"/>`;
  if (k === 'queue') return `<rect class="shape" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/><path class="shape-line" d="M${x + w - 18} ${y} v${h} M${x + w - 30} ${y} v${h}"/>`;
  if (k === 'actor' || k === 'state') return `<rect class="shape" x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>`;
  if (k === 'external') return `<rect class="shape dashed" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>`;
  return `<rect class="shape" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/>`;
}

// The point where the line from a box's centre toward (tx, ty) leaves the box.
function exit(cx, cy, tx, ty) {
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const sx = (NW / 2 + 4) / Math.abs(dx || 1e-9), sy = (NH / 2 + 4) / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

function renderGrid(ir) {
  const nodes = ir.nodes;
  const rows = Math.max(...nodes.map((n) => n.row)) + 1, cols = Math.max(...nodes.map((n) => n.col)) + 1;
  const W = cols * CW + PAD * 2, H = rows * CH + PAD * 2 + 20;
  const at = (n) => ({ x: PAD + n.col * CW + (CW - NW) / 2, y: PAD + 20 + n.row * CH + (CH - NH) / 2 });
  const center = (n) => { const p = at(n); return [p.x + NW / 2, p.y + NH / 2]; };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = [];
  for (const g of ir.groups || []) {
    const ms = g.nodes.map((m) => byId.get(m));
    const x0 = Math.min(...ms.map((n) => at(n).x)) - 16, y0 = Math.min(...ms.map((n) => at(n).y)) - 26;
    const x1 = Math.max(...ms.map((n) => at(n).x)) + NW + 16, y1 = Math.max(...ms.map((n) => at(n).y)) + NH + 14;
    out.push(`<g class="group"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="10"/><text x="${x0 + 10}" y="${y0 + 16}">${esc(g.label)}</text></g>`);
  }
  (ir.edges || []).forEach((e, i) => {
    const a = byId.get(e.from), b = byId.get(e.to);
    const [ax, ay] = center(a), [bx, by] = center(b);
    const [sx, sy] = exit(ax, ay, bx, by), [tx, ty] = exit(bx, by, ax, ay);
    const style = e.style || 'sync';
    out.push(`<g class="edge ${style}" data-from="${esc(e.from)}" data-to="${esc(e.to)}"><line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" marker-end="url(#arrow-${style})"/>`
      + (e.label ? `<text x="${((sx + tx) / 2).toFixed(1)}" y="${((sy + ty) / 2 - 6).toFixed(1)}" text-anchor="middle">${esc(e.label)}</text>` : '') + `</g>`);
    void i;
  });
  for (const n of nodes) {
    const { x, y } = at(n);
    const lines = wrap(n.label);
    const all = [...lines.map((t) => ({ t, sub: false })), ...(n.sublabel ? [{ t: wrap(n.sublabel, 30)[0], sub: true }] : [])];
    const top = y + NH / 2 - ((all.length - 1) * 15) / 2 + 5;
    const texts = all.map((l, i) => `<text${l.sub ? ' class="sub"' : ''} x="${x + NW / 2}" y="${(top + i * 15).toFixed(1)}" text-anchor="middle">${esc(l.t)}</text>`).join('');
    const title = [n.label, n.note].filter(Boolean).join(' - ');
    out.push(`<g class="node kind-${esc(n.kind || 'service')}" data-id="${esc(n.id)}" tabindex="0">${shape(n, x, y)}${texts}<title>${esc(title)}</title></g>`);
  }
  return { W, H, body: out.join('\n') };
}

function renderSequence(ir) {
  const ps = ir.participants, ms = ir.messages;
  const LW = 180, TOP = 70, STEP = 46;
  const W = ps.length * LW + PAD * 2, H = TOP + ms.length * STEP + 60;
  const xOf = new Map(ps.map((p, i) => [p.id, PAD + i * LW + LW / 2]));
  const out = [];
  for (const p of ps) {
    const x = xOf.get(p.id);
    out.push(`<g class="node kind-${esc(p.kind || 'service')}" data-id="${esc(p.id)}" tabindex="0"><rect class="shape" x="${x - 74}" y="20" width="148" height="36" rx="8"/><text x="${x}" y="43" text-anchor="middle">${esc(p.label)}</text>${p.note ? `<title>${esc(p.note)}</title>` : ''}</g>`);
    out.push(`<line class="lifeline" x1="${x}" y1="56" x2="${x}" y2="${H - 20}"/>`);
  }
  ms.forEach((m, i) => {
    const y = TOP + 20 + i * STEP;
    const x1 = xOf.get(m.from), x2 = xOf.get(m.to);
    const style = m.style || 'sync';
    if (x1 === x2) {
      out.push(`<g class="edge ${style}" data-from="${esc(m.from)}" data-to="${esc(m.to)}"><path d="M${x1} ${y} h40 v18 h-36" fill="none" marker-end="url(#arrow-${style})"/><text x="${x1 + 46}" y="${y + 12}">${esc(m.label)}</text></g>`);
    } else {
      out.push(`<g class="edge ${style}" data-from="${esc(m.from)}" data-to="${esc(m.to)}"><line x1="${x1}" y1="${y}" x2="${x2 + (x2 > x1 ? -4 : 4)}" y2="${y}" marker-end="url(#arrow-${style})"/><text x="${(x1 + x2) / 2}" y="${y - 7}" text-anchor="middle">${i + 1}. ${esc(m.label)}</text></g>`);
    }
  });
  return { W, H, body: out.join('\n') };
}

export function render(ir) {
  const errs = validate(ir);
  if (errs.length) throw new Error(`diagram IR does not validate:\n- ${errs.join('\n- ')}`);
  const { W, H, body } = ir.type === 'sequence' ? renderSequence(ir) : renderGrid(ir);
  const markers = EDGE_STYLES.map((s) => `<marker id="arrow-${s}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="head ${s}" d="M0 0 L10 5 L0 10 z"/></marker>`).join('');
  const legend = [...new Set((ir.type === 'sequence' ? ir.messages : ir.edges || []).map((e) => e.style || 'sync'))]
    .map((s) => `<span class="lg ${s}"><svg width="28" height="10"><line x1="0" y1="5" x2="28" y2="5"/></svg>${s}</span>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(ir.title)}</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6a64;--box:#ffffff;--line:#3b3a36;--accent:#2f6fdb;--data:#1f8a5b;--fail:#c2410c;--group:#e9e6de}
@media (prefers-color-scheme:dark){:root{--bg:#171714;--fg:#ecebe6;--muted:#9a988f;--box:#22221e;--line:#cfcdc4;--accent:#7aa7ff;--data:#4cc38a;--fail:#fb923c;--group:#2c2b26}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:16px 16px 4px;max-width:1200px;margin:0 auto}h1{font-size:18px;margin:0 0 4px}p.desc{margin:0;color:var(--muted)}
.wrap{overflow:auto;padding:8px 16px 24px;max-width:100%}svg.d{display:block;margin:0 auto;max-width:100%;height:auto}
.shape{fill:var(--box);stroke:var(--line);stroke-width:1.4}.shape.dashed{stroke-dasharray:5 4}.shape-line{fill:none;stroke:var(--line);stroke-width:1.2}
.node text{fill:var(--fg);font-size:13px;font-weight:600}.node text.sub{font-weight:400;font-size:11px;fill:var(--muted)}
.node:focus{outline:none}.node:focus .shape,.node.on .shape{stroke:var(--accent);stroke-width:2.4}
.edge line,.edge path{stroke:var(--line);stroke-width:1.4;fill:none}.edge text{fill:var(--muted);font-size:11px;paint-order:stroke;stroke:var(--bg);stroke-width:4px}
.edge.async line,.edge.async path{stroke-dasharray:6 4}.edge.data line,.edge.data path{stroke:var(--data)}.edge.fail line,.edge.fail path{stroke:var(--fail);stroke-dasharray:3 3}
.edge.on line,.edge.on path{stroke:var(--accent);stroke-width:2.4}.edge.dim{opacity:.18}.node.dim{opacity:.35}
.head{fill:var(--line)}.head.data{fill:var(--data)}.head.fail{fill:var(--fail)}
.group rect{fill:var(--group);stroke:var(--muted);stroke-dasharray:4 4;opacity:.7}.group text{fill:var(--muted);font-size:12px;font-weight:600}
.lifeline{stroke:var(--muted);stroke-dasharray:3 5}
.legend{display:flex;gap:14px;flex-wrap:wrap;color:var(--muted);font-size:12px;padding:0 16px;max-width:1200px;margin:0 auto}
.lg svg line{stroke:var(--line);stroke-width:1.6}.lg.async svg line{stroke-dasharray:6 4}.lg.data svg line{stroke:var(--data)}.lg.fail svg line{stroke:var(--fail);stroke-dasharray:3 3}
</style></head><body>
<header><h1>${esc(ir.title)}</h1>${ir.description ? `<p class="desc">${esc(ir.description)}</p>` : ''}</header>
<div class="legend">${legend}</div>
<div class="wrap"><svg class="d" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(ir.title)}"><defs>${markers}</defs>
${body}
</svg></div>
<script>
// Hover or focus a node: its own edges light up, everything else steps back.
(function(){var s=document.querySelector('svg.d');if(!s)return;var ns=s.querySelectorAll('.node'),es=s.querySelectorAll('.edge');
function on(id){var near={};near[id]=1;es.forEach(function(e){var hit=e.dataset.from===id||e.dataset.to===id;e.classList.toggle('on',hit);e.classList.toggle('dim',!hit);if(hit){near[e.dataset.from]=1;near[e.dataset.to]=1}});ns.forEach(function(n){n.classList.toggle('dim',!near[n.dataset.id]);n.classList.toggle('on',n.dataset.id===id)})}
function off(){es.forEach(function(e){e.classList.remove('on','dim')});ns.forEach(function(n){n.classList.remove('on','dim')})}
ns.forEach(function(n){n.addEventListener('mouseenter',function(){on(n.dataset.id)});n.addEventListener('focus',function(){on(n.dataset.id)});n.addEventListener('mouseleave',off);n.addEventListener('blur',off)})})();
</script>
</body></html>
`;
}

// Writes only a passing render, and atomically: a reader never sees half a file, and a failed
// revision never replaces the last good one.
export function renderToFile(ir, outPath) {
  const html = render(ir);
  const tmp = `${outPath}.${process.pid}.tmp`;
  writeFileSync(tmp, html);
  renameSync(tmp, outPath);
  return outPath;
}

function main(argv) {
  const [cmd, input, out] = argv;
  if (!['check', 'render'].includes(cmd) || !input || (cmd === 'render' && !out)) {
    process.stderr.write('usage: diagram.mjs check <ir.json> | render <ir.json> <out.html>\n');
    return 2;
  }
  let ir;
  try { ir = JSON.parse(readFileSync(input, 'utf8')); } catch (e) { process.stdout.write(`the IR is not readable JSON: ${e.message}\n`); return 1; }
  const errs = validate(ir);
  if (errs.length) { process.stdout.write(errs.map((e) => `- ${e}`).join('\n') + '\n'); return 1; }
  if (cmd === 'check') { process.stdout.write('ok\n'); return 0; }
  renderToFile(ir, out);
  process.stdout.write(`ok ${out}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main(process.argv.slice(2));
