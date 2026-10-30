// write:diagram - the static path: a checked IR becomes one self-contained SVG (light palette
// resolved, NanumGothic subset embedded as a data-URI @font-face, no script, no external reference)
// and a PNG rasterized from it at 2x through an <img>, the way a book page loads it.
//
// Every renderer emits, next to its SVG, a geometry record per text, shape and edge; checkGeometry()
// measures them with the font's real advance widths and refuses what a reader would trip over.
// Nothing is written for a refused figure, and a refusal never replaces the last good pair.

import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve, delimiter } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { inflateSync, deflateSync, crc32 } from 'node:zlib';
import { TYPES, validate } from './diagram.mjs';
import { loadFont, measure, missingChars, subsetFont } from './font.mjs';

export const PRINT_WIDTH = 552; // CSS px of text width on the book page (146 mm)
const MIN_PT = 7.5;

// Fills that appear together differ by >= 15 L* so a grayscale print keeps them apart; every edge
// style differs by its dash pattern, not only by colour.
export const PALETTE = {
  ink: '#1f1f1c', muted: '#55544e', line: '#34332f', paper: '#ffffff',
  fills: { paper: '#ffffff', soft: '#c9d1dc', mid: '#98a5b8', strong: '#6c7a90', accent: '#2a3447' },
  edges: {
    sync: { dash: 'none', color: '#34332f' },
    async: { dash: '7 4', color: '#34332f' },
    data: { dash: '12 3 2 3', color: '#1e6b47' },
    fail: { dash: '2 3', color: '#b03d0a' },
  },
};
// The style layer: one corner radius, two stroke weights, a three-size type scale. The claim's
// elements take the accent role (darkest fill, heavy stroke, light text); the rest stays muted.
const RX = 6;
const SW_LIGHT = 1.25, SW_HEAVY = 2.5;
const TITLE = 15, SIZE = 13, SUB = 12.5, LINE_H = 16;
const ON_ACCENT = '#ffffff';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = (n) => +n.toFixed(1);

// ---------- canvas: SVG parts + geometry records ----------

class Canvas {
  constructor() { this.parts = []; this.items = []; this.used = { Regular: '', Bold: '' }; this.defs = new Set(); this.n = 0; this.accent = new Set(); }
  // (x, y) is the baseline anchor. owner: what the text labels; within: the shape it must fit
  // inside; room: the width it may take before it would have to be cut.
  text(str, x, y, o = {}) {
    const s = String(str), size = o.size || SIZE, weight = o.bold ? 'Bold' : 'Regular', font = loadFont(weight);
    const w = measure(font, s, size), asc = (font.ascender / font.unitsPerEm) * size, desc = (-font.descender / font.unitsPerEm) * size;
    const anchor = o.anchor || 'start';
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    const box = { x: x0, y: y - asc, w, h: asc + desc };
    this.items.push({ id: o.id || `text${this.n++}`, kind: 'text', text: s, size, box, owner: o.owner, within: o.within, room: o.room, what: o.what });
    this.used[weight] += s;
    this.parts.push(`<text x="${f1(x)}" y="${f1(y)}" font-size="${size}"${o.bold ? ' font-weight="700"' : ''}${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''} fill="${o.fill || PALETTE.ink}"${o.halo ? ' stroke="#ffffff" stroke-width="4" paint-order="stroke"' : ''}>${esc(s)}</text>`);
    return box;
  }
  width(str, o = {}) { return measure(loadFont(o.bold ? 'Bold' : 'Regular'), String(str), o.size || SIZE); }
  shape(svg, box, o = {}) { this.parts.push(svg); this.items.push({ id: o.id || `shape${this.n++}`, kind: 'shape', box, owner: o.owner, container: o.container, mark: o.mark }); }
  edge(svg, points, o = {}) { this.parts.push(svg); this.items.push({ id: o.id || `edge${this.n++}`, kind: 'edge', points, from: o.from, to: o.to, owner: o.owner, hint: o.hint, exclusive: o.exclusive }); }
  guide(svg) { this.parts.push(svg); }
  // Lines of at most `room` px, broken at spaces or slashes; past `max` lines the rest stays on the
  // last line, so it overflows and the checker names it instead of the renderer cutting it.
  wrap(str, room, max = 2, o = {}) {
    const raw = [];
    for (const word of String(str).split(/(?<=[\s/])/)) {
      const cur = raw[raw.length - 1];
      if (cur != null && this.width((cur + word).trim(), o) <= room) raw[raw.length - 1] = cur + word;
      else raw.push(word);
    }
    const lines = raw.length > max ? [...raw.slice(0, max - 1), raw.slice(max - 1).join('')] : raw;
    return lines.map((l) => l.trim()).filter(Boolean);
  }
  marker(style) {
    const e = PALETTE.edges[style] || PALETTE.edges.sync;
    this.defs.add(`<marker id="arrow-${style}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${e.color}"/></marker>`);
    return `url(#arrow-${style})`;
  }
  // A line (or polyline) in an edge style, with an arrowhead at its end (and start when both).
  path(points, style = 'sync', o = {}) {
    const e = PALETTE.edges[style] || PALETTE.edges.sync, m = this.marker(style);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${f1(p[0])} ${f1(p[1])}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${e.color}" stroke-width="${o.width || SW_LIGHT}"${e.dash !== 'none' ? ` stroke-dasharray="${e.dash}"` : ''}${o.head === false ? '' : ` marker-end="${m}"`}${o.both ? ` marker-start="${m}"` : ''}/>`;
  }
}

// ---------- geometry check ----------

const overlap = (a, b, m = 0.5) => a.x + m < b.x + b.w && b.x + m < a.x + a.w && a.y + m < b.y + b.h && b.y + m < a.y + a.h;
const contains = (outer, inner, m = 0.5) => inner.x >= outer.x - m && inner.y >= outer.y - m && inner.x + inner.w <= outer.x + outer.w + m && inner.y + inner.h <= outer.y + outer.h + m;
function bbox(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
// Does segment p-q pass through the inside of box b (shrunk by m so touching is not crossing)?
function crosses(p, q, b, m = 1) {
  const x0 = b.x + m, y0 = b.y + m, x1 = b.x + b.w - m, y1 = b.y + b.h - m;
  if (x1 <= x0 || y1 <= y0) return false;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  let t0 = 0, t1 = 1;
  for (const [pp, qq] of [[-dx, p[0] - x0], [dx, x1 - p[0]], [-dy, p[1] - y0], [dy, y1 - p[1]]]) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const r = qq / pp;
    if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 < t1;
}
const segments = (pts) => pts.slice(1).map((q, i) => [pts[i], q]);

// items: {id, kind: text|shape|edge, box|points, owner, within?, room?, size?, container?, mark?, from?, to?}
// Rules: (a) text outside the box it labels, (b) two texts overlapping, (c) text over a shape it does
// not belong to, (d) edge through a box that is not its end, (e) outside the viewBox, (f) a label wider
// than its room (it would be cut with ...), (g) smallest text below 7.5 pt at the book width,
// (h) edge or arrowhead over any text - its own label included (a label sits beside its line, not on it).
export function checkGeometry(items, { W, H, printWidth = PRINT_WIDTH }) {
  const errs = [];
  const name = (i) => (i.kind === 'text' ? `${i.what ? `${i.what} ` : ''}"${i.text}"` : i.id);
  const byId = new Map(items.filter((i) => i.kind === 'shape').map((i) => [i.id, i]));
  const texts = items.filter((i) => i.kind === 'text'), shapes = items.filter((i) => i.kind === 'shape' && !i.container), edges = items.filter((i) => i.kind === 'edge');
  for (const it of items) {
    const b = it.box || bbox(it.points);
    if (b.x < -0.5 || b.y < -0.5 || b.x + b.w > W + 0.5 || b.y + b.h > H + 0.5) errs.push(`${name(it)} runs outside the figure (${W}x${H}) - shorten it or move it in`);
  }
  if (texts.length) {
    const scale = Math.min(1, printWidth / W), small = Math.min(...texts.map((t) => t.size));
    const pt = small * scale * 0.75;
    if (pt < MIN_PT - 1e-9) errs.push(`the smallest text prints at ${pt.toFixed(1)} pt at the ${printWidth} px book width (the figure is ${W} px wide) - use fewer columns, lanes or cells, or split the figure, so it is at most ${Math.floor((small * 0.75 * printWidth) / MIN_PT)} px wide`);
  }
  for (const t of texts) {
    if (t.room != null && t.box.w > t.room + 0.5) errs.push(`${name(t)} needs ${Math.ceil(t.box.w)} px but has ${Math.floor(t.room)} px - shorten it (it would be cut with …) or give it more room`);
    const box = t.within && byId.get(t.within);
    if (box && !contains(box.box, t.box)) errs.push(`${name(t)} overflows its box ${t.within} - shorten it or put the rest in "note"`);
  }
  // A named text (the resume note) that is already refused for its width is not refused again for what it
  // runs over: that is the same fault, and one message names it.
  const moot = (t) => t.what && t.room != null && t.box.w > t.room + 0.5;
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++)
    if (!moot(texts[i]) && !moot(texts[j]) && overlap(texts[i].box, texts[j].box)) errs.push(`${name(texts[i])} and ${name(texts[j])} overlap - move one or shorten it`);
  for (const t of texts) for (const s of shapes)
    if (!moot(t) && s.id !== t.owner && s.id !== t.within && overlap(t.box, s.box)) errs.push(`${name(t)} sits over ${s.id} - move the text or the shape`);
  for (const e of edges) {
    const segs = segments(e.points);
    for (const s of shapes) {
      if (s.mark || s.id === e.from || s.id === e.to || s.id === e.owner) continue;
      if (segs.some(([p, q]) => crosses(p, q, s.box))) errs.push(`edge ${e.id} passes through ${s.id} - move ${s.id} off the line, or move an end so the line runs clear`);
    }
    for (const t of texts)
      if (!moot(t) && segs.some(([p, q]) => crosses(p, q, t.box))) errs.push(`edge ${e.id} runs over the text ${name(t)} - ${e.hint || 'move the text or the line'}`);
  }
  // (i) two edges that own their line (cause edges) never run along the same straight stretch.
  const own = edges.filter((e) => e.exclusive);
  const along = (s, t) => [0, 1].some((k) => Math.abs(s[0][k] - s[1][k]) < 0.5 && Math.abs(t[0][k] - t[1][k]) < 0.5 && Math.abs(s[0][k] - t[0][k]) < 1
    && Math.min(Math.max(s[0][1 - k], s[1][1 - k]), Math.max(t[0][1 - k], t[1][1 - k])) - Math.max(Math.min(s[0][1 - k], s[1][1 - k]), Math.min(t[0][1 - k], t[1][1 - k])) > 1);
  for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++)
    if (segments(own[i].points).some((s) => segments(own[j].points).some((t) => along(s, t)))) errs.push(`edge ${own[i].id} and ${own[j].id} run along the same line - move an end so each edge has its own x`);
  return [...new Set(errs)];
}

// ---------- the five grid/sequence types, sized for the printed page ----------

const PADX = 24, TOP = 44;

function title(c, ir, W, stamp) {
  let room = W - 2 * PADX;
  if (stamp) {
    const sb = c.text(stamp, W - PADX, 26, { anchor: 'end', size: SUB, fill: PALETTE.muted, owner: 'stamp' });
    room -= sb.w + 12;
  }
  c.text(ir.title, PADX, 26, { bold: true, size: TITLE, owner: 'title', room });
}

// One entry per edge style, named by ir.legend[style] when the author renamed it; one style, no legend.
function legend(c, styles, y, names = {}) {
  if (styles.length < 2) return 0;
  let x = PADX;
  for (const s of styles) {
    c.guide(c.path([[x, y - 4], [x + 30, y - 4]], s, { head: false }));
    const b = c.text(names[s] || s, x + 36, y, { fill: PALETTE.muted, owner: 'legend' });
    x = b.x + b.w + 18;
  }
  return 26;
}

const GRID = { CW: 210, CH: 104, NW: 158, NH: 56 };

const STORE_RY = 8;
// The cylinder's two visible curves as polylines: the front of the top ellipse and the bottom one.
function storeArcs(x, y, w, h, ry = STORE_RY) {
  const arc = (cy) => Array.from({ length: 17 }, (_, i) => { const a = (Math.PI * i) / 16; return [x + w / 2 - (w / 2) * Math.cos(a), cy + ry * Math.sin(a)]; });
  return [arc(y + ry), arc(y + h - ry)];
}

function nodeShape(kind, x, y, w, h) {
  const st = `fill="${PALETTE.fills.paper}" stroke="${PALETTE.line}" stroke-width="${SW_LIGHT}"`;
  if (kind === 'store') {
    const ry = STORE_RY;
    return `<path d="M${x} ${y + ry} a${w / 2} ${ry} 0 0 1 ${w} 0 v${h - 2 * ry} a${w / 2} ${ry} 0 0 1 ${-w} 0 z" ${st}/><path d="M${x} ${y + ry} a${w / 2} ${ry} 0 0 0 ${w} 0" fill="none" stroke="${PALETTE.line}" stroke-width="${SW_LIGHT}"/>`;
  }
  if (kind === 'decision') return `<path d="M${x + w / 2} ${y - 6} L${x + w + 8} ${y + h / 2} L${x + w / 2} ${y + h + 6} L${x - 8} ${y + h / 2} Z" ${st}/>`;
  if (kind === 'queue') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${RX}" ${st}/><path d="M${x + w - 14} ${y} v${h} M${x + w - 24} ${y} v${h}" stroke="${PALETTE.line}" stroke-width="${SW_LIGHT}"/>`;
  if (kind === 'actor' || kind === 'state') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${RX}" ${st}/>`;
  if (kind === 'external') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${RX}" ${st} stroke-dasharray="5 4"/>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${RX}" ${st}/>`;
}

// The point where the line from a box's centre toward (tx, ty) leaves the box (plus a gap).
export function exitPoint(box, tx, ty, gap = 4) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const s = Math.min((box.w / 2 + gap) / Math.abs(dx || 1e-9), (box.h / 2 + gap) / Math.abs(dy || 1e-9));
  return [cx + dx * s, cy + dy * s];
}

// Label of a straight edge: above a level line, right of an upright one. A diagonal one gets the
// nearest of six spots that clear the line by `gap` - either side along its normal, above, below,
// left, right of the midpoint - skipping a spot that lands on one of `boxes` (the nodes).
function edgeLabel(c, label, s, t, id, sideRoom, gap = 4, boxes = []) {
  if (!label) return;
  const dx = t[0] - s[0], dy = t[1] - s[1], mx = (s[0] + t[0]) / 2, my = (s[1] + t[1]) / 2, len = Math.hypot(dx, dy);
  const room = Math.abs(dx) >= Math.abs(dy) ? len - 8 : sideRoom;
  if (Math.abs(dy) < 1) return c.text(label, mx, my - gap - 4, { anchor: 'middle', owner: id, room, halo: true });
  if (Math.abs(dx) < 1) return c.text(label, mx + gap + 3, my + 4, { owner: id, room, halo: true });
  const font = loadFont('Regular'), asc = (font.ascender / font.unitsPerEm) * SIZE, desc = (-font.descender / font.unitsPerEm) * SIZE;
  const w = c.width(label), h = asc + desc, nx = -dy / len, ny = dx / len;
  const dn = Math.abs(nx) * w / 2 + Math.abs(ny) * h / 2 + gap, dv = (w / 2) * Math.abs(dy / dx) + h / 2 + gap, dh = (h / 2) * Math.abs(dx / dy) + w / 2 + gap;
  const spots = [[nx * dn, ny * dn, dn], [-nx * dn, -ny * dn, dn], [0, -dv, dv], [0, dv, dv], [dh, 0, dh], [-dh, 0, dh]]
    .map(([ox, oy, d], k) => ({ x: mx + ox, y: my + oy, d, k })).sort((p, q) => p.d - q.d || p.k - q.k);
  const at = (p) => ({ x: p.x - w / 2, y: p.y - h / 2, w, h });
  const spot = spots.find((p) => !boxes.some((b) => overlap(at(p), b))) || spots[0];
  return c.text(label, spot.x, spot.y + asc - h / 2, { anchor: 'middle', owner: id, room, halo: true });
}

function staticGrid(ir, c) {
  const { CW, CH, NW, NH } = GRID;
  const rows = Math.max(...ir.nodes.map((n) => n.row)) + 1, cols = Math.max(...ir.nodes.map((n) => n.col)) + 1;
  const W = cols * CW + PADX * 2;
  title(c, ir, W);
  const box = (n) => ({ x: PADX + n.col * CW + (CW - NW) / 2, y: TOP + 16 + n.row * CH + (CH - NH) / 2, w: NW, h: NH });
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  for (const g of ir.groups || []) {
    const bs = g.nodes.map((m) => box(byId.get(m)));
    const x0 = Math.min(...bs.map((b) => b.x)) - 14, y0 = Math.min(...bs.map((b) => b.y)) - 26;
    const x1 = Math.max(...bs.map((b) => b.x + b.w)) + 14, y1 = Math.max(...bs.map((b) => b.y + b.h)) + 12;
    c.shape(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="${RX}" fill="${PALETTE.fills.soft}" stroke="${PALETTE.muted}" stroke-width="${SW_LIGHT}" stroke-dasharray="4 4"/>`, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { id: `group ${g.id}`, container: true });
    c.text(g.label, x0 + 10, y0 + 17, { bold: true, fill: PALETTE.muted, owner: `group ${g.id}`, room: x1 - x0 - 20 });
  }
  const styles = [];
  for (const e of ir.edges || []) {
    const a = box(byId.get(e.from)), b = box(byId.get(e.to));
    const s = exitPoint(a, b.x + NW / 2, b.y + NH / 2), t = exitPoint(b, a.x + NW / 2, a.y + NH / 2);
    const style = e.style || 'sync', id = `edge ${e.from}->${e.to}`;
    if (!styles.includes(style)) styles.push(style);
    c.edge(c.path([s, t], style), [s, t], { id, from: e.from, to: e.to });
    edgeLabel(c, e.label, s, t, id, CW / 2 - 12, 4, ir.nodes.map(box));
  }
  for (const n of ir.nodes) {
    const b = box(n);
    c.shape(nodeShape(n.kind || 'service', b.x, b.y, b.w, b.h), b, { id: n.id });
    // a store's text is centred in the body below the top arc, and both arcs are checked as lines
    const store = n.kind === 'store', bodyY = store ? b.y + 2 * STORE_RY : b.y, bodyH = b.h - (bodyY - b.y);
    if (store) storeArcs(b.x, b.y, b.w, b.h).forEach((pts, k) => c.items.push({ id: `${n.id} ${k ? 'bottom' : 'top'} arc`, kind: 'edge', points: pts, from: n.id, to: n.id, owner: n.id, hint: `shorten the label of ${n.id} to one line or drop its sublabel - a store's text sits below its top arc` }));
    const lines = c.wrap(n.label, NW - 16, 2, { bold: true });
    const all = [...lines.map((t) => ({ t, sub: false })), ...(n.sublabel ? [{ t: n.sublabel, sub: true }] : [])];
    const top = bodyY + bodyH / 2 - ((all.length - 1) * LINE_H) / 2 + 5;
    all.forEach((l, i) => c.text(l.t, b.x + NW / 2, top + i * LINE_H, { anchor: 'middle', bold: !l.sub, fill: l.sub ? PALETTE.muted : PALETTE.ink, owner: n.id, within: n.id, room: NW - 12 }));
  }
  const H0 = TOP + 16 + rows * CH;
  return { W, H: H0 + legend(c, styles, H0 + 8, ir.legend) + 8 };
}

function staticSequence(ir, c) {
  const LW = 140, PH = 34, STEP = 38, ps = ir.participants, ms = ir.messages;
  const W = ps.length * LW + PADX * 2;
  title(c, ir, W);
  const xOf = new Map(ps.map((p, i) => [p.id, PADX + i * LW + LW / 2]));
  const y0 = TOP + 4, firstY = y0 + PH + 34;
  const H0 = firstY + (ms.length - 1) * STEP + 26;
  for (const p of ps) {
    const x = xOf.get(p.id), b = { x: x - (LW - 12) / 2, y: y0, w: LW - 12, h: PH };
    c.shape(nodeShape(p.kind === 'store' || p.kind === 'queue' || p.kind === 'decision' ? 'service' : p.kind || 'service', b.x, b.y, b.w, b.h), b, { id: p.id });
    c.text(p.label, x, y0 + PH / 2 + 5, { anchor: 'middle', bold: true, owner: p.id, within: p.id, room: b.w - 12 });
    c.guide(`<line x1="${x}" y1="${y0 + PH}" x2="${x}" y2="${H0}" stroke="${PALETTE.muted}" stroke-dasharray="3 5"/>`);
  }
  const styles = [];
  ms.forEach((m, i) => {
    const y = firstY + i * STEP, x1 = xOf.get(m.from), x2 = xOf.get(m.to), style = m.style || 'sync', id = `message ${i + 1}`;
    if (!styles.includes(style)) styles.push(style);
    if (x1 === x2) {
      const pts = [[x1, y - 8], [x1 + 34, y - 8], [x1 + 34, y + 8], [x1 + 4, y + 8]];
      c.edge(c.path(pts, style), pts, { id, from: m.from, to: m.to });
      c.text(`${i + 1}. ${m.label}`, x1 + 40, y + 4, { owner: id, room: W - PADX - x1 - 40, halo: true });
    } else {
      const pts = [[x1, y], [x2 + (x2 > x1 ? -3 : 3), y]];
      c.edge(c.path(pts, style), pts, { id, from: m.from, to: m.to });
      c.text(`${i + 1}. ${m.label}`, (x1 + x2) / 2, y - 7, { anchor: 'middle', owner: id, room: Math.max(Math.abs(x2 - x1), LW) - 8, halo: true });
    }
  });
  return { W, H: H0 + legend(c, styles, H0 + 14, ir.legend) + 10 };
}

// ---------- the book types (layout, tree, timeline, er, chart) register here ----------

export const BOOK_TYPES = {};

const ID = /^[A-Za-z][A-Za-z0-9_.:-]{0,39}$/;
const isStr = (s) => typeof s === 'string' && s.trim().length > 0;
const num = (v) => Number(+v.toFixed(2)).toString();
const commonErrs = (ir) => (isStr(ir.title) ? [] : ['give the figure a "title"']);
function ids(list, what, errs, all = new Set()) {
  list.forEach((x, i) => {
    if (!x || !ID.test(String(x.id || ''))) errs.push(`${what}[${i}]: give it an "id" of letters, digits, _ . : - (starting with a letter)`);
    else if (all.has(x.id)) errs.push(`${what}[${i}]: id "${x.id}" is used twice - rename one`);
    else all.add(x.id);
  });
  return all;
}

// ----- layout: stacked strips of cells (page layout, row + undo record), pointers, offset marks -----

const CELL_KINDS = ['data', 'meta', 'free', 'focus'];
const cellFill = (k) => ({ meta: PALETTE.fills.soft, focus: PALETTE.fills.mid }[k] || PALETTE.fills.paper);

BOOK_TYPES.layout = {
  validate(ir) {
    const errs = commonErrs(ir);
    if (!['bytes', 'schematic'].includes(ir.scale)) errs.push('set "scale" to "bytes" (cells drawn to size) or "schematic" (stamped not to scale)');
    const strips = Array.isArray(ir.strips) ? ir.strips : [];
    if (!strips.length) errs.push('add at least one entry to "strips"');
    if (strips.length > 4) errs.push(`split the figure: ${strips.length} strips is more than one picture holds - keep it to 4`);
    const sids = ids(strips, 'strips', errs);
    const cells = new Map();
    let count = 0;
    strips.forEach((s) => {
      if (!s) return;
      if (!isStr(s.label)) errs.push(`strip ${s.id}: add a "label"`);
      const cs = Array.isArray(s.cells) ? s.cells : [];
      if (!cs.length) errs.push(`strip ${s.id}: add at least one entry to "cells"`);
      count += cs.length;
      const before = new Set(cells.keys());
      ids(cs, `strip ${s.id} cells`, errs, new Set([...before, ...sids]));
      cs.forEach((c) => {
        if (!c || !c.id) return;
        cells.set(c.id, s.id);
        if (!isStr(c.label)) errs.push(`cell ${c.id}: add a "label"`);
        if (c.kind != null && !CELL_KINDS.includes(c.kind)) errs.push(`cell ${c.id}: set "kind" to one of ${CELL_KINDS.join(', ')} or leave it out`);
        if (ir.scale === 'bytes' && !(typeof c.size === 'number' && c.size > 0)) errs.push(`cell ${c.id}: give it a "size" - scale "bytes" draws every cell to size (or set "scale" to "schematic")`);
      });
      if (ir.scale === 'bytes' && cs.every((c) => c && typeof c.size === 'number' && c.size > 0)) {
        const sum = cs.reduce((a, c) => a + c.size, 0);
        if (typeof s.total !== 'number') errs.push(`strip ${s.id}: set "total" (the strip's size) so the cells can be checked against it`);
        else if (sum !== s.total) errs.push(`strip ${s.id}: cell sizes sum to ${sum} but "total" is ${s.total} - ${Math.abs(s.total - sum)} ${ir.unit || 'B'} are ${sum < s.total ? 'missing; add the cell that holds them' : 'too many'} or fix a size`);
      }
    });
    if (count > 24) errs.push(`split the figure: ${count} cells - keep it to 24`);
    (ir.pointers || []).forEach((p, i) => {
      if (!p || !cells.has(p.from)) errs.push(`pointers[${i}]: "from" must name a cell id (got ${JSON.stringify(p && p.from)})`);
      if (!p || !cells.has(p.to)) errs.push(`pointers[${i}]: "to" must name a cell id (got ${JSON.stringify(p && p.to)})`);
      if (!p || !isStr(p.label)) errs.push(`pointers[${i}]: add a "label" - say what the pointer holds`);
    });
    const byStrip = new Map();
    (ir.marks || []).forEach((m, i) => {
      const s = m && strips.find((x) => x && x.id === m.strip);
      if (!s) { errs.push(`marks[${i}]: "strip" must name a strip id (got ${JSON.stringify(m && m.strip)})`); return; }
      if (!isStr(m.label)) errs.push(`marks[${i}]: add a "label"`);
      const cs = s.cells || [];
      let at = null;
      if (typeof m.at === 'number') {
        if (ir.scale !== 'bytes') errs.push(`marks[${i}]: a number "at" needs scale "bytes" - in a schematic, name the cell the mark starts`);
        else if (m.at < 0 || m.at > s.total) errs.push(`marks[${i}]: "at" ${m.at} is outside strip ${s.id} (0-${s.total})`);
        else at = m.at;
      } else {
        const k = cs.findIndex((c) => c && c.id === m.at);
        if (k < 0) errs.push(`marks[${i}]: "at" must be an offset or a cell id of strip ${s.id} (got ${JSON.stringify(m.at)})`);
        else at = ir.scale === 'bytes' ? cs.slice(0, k).reduce((a, c) => a + (c.size || 0), 0) : k;
      }
      if (at == null) return;
      const prev = byStrip.get(s.id);
      if (prev && at < prev.at) errs.push(`marks of strip ${s.id} are out of order: "${m.label}" comes before "${prev.label}" - list marks in offset order`);
      byStrip.set(s.id, { at, label: m.label });
    });
    return errs;
  },
  render(ir, c) {
    const W = 640, LBL = 96, x0 = PADX + LBL, CWD = W - PADX - x0, bytes = ir.scale === 'bytes';
    title(c, ir, W, bytes ? null : '축척 아님 (not to scale)');
    const strips = ir.strips, idx = new Map(), box = new Map(), errs = [];
    strips.forEach((s, i) => s.cells.forEach((cell) => idx.set(cell.id, i)));
    const ptrs = (ir.pointers || []).map((p, i) => ({ ...p, i, a: idx.get(p.from), b: idx.get(p.to) }));
    const lanes = strips.map(() => 0);
    for (const p of ptrs) { p.gap = Math.min(p.a, p.b); p.lane = lanes[p.gap]++; }
    const bottoms = [];
    let y = TOP + 6;
    strips.forEach((s, i) => {
      const marks = (ir.marks || []).filter((m) => m.strip === s.id);
      if (marks.length) y += 28;
      const subOf = (cell) => cell.sublabel || (bytes ? `${cell.size} ${ir.unit || 'B'}` : '');
      let widths;
      if (bytes) widths = s.cells.map((cell) => (cell.size / s.total) * CWD);
      else {
        const nat = s.cells.map((cell) => Math.min(150, Math.max(44, c.width(cell.label) + 16, subOf(cell) ? c.width(subOf(cell), { size: SUB }) + 16 : 0)));
        const sum = nat.reduce((a, b) => a + b, 0);
        widths = nat.map((w) => (w * CWD) / sum);
      }
      const lines = s.cells.map((cell, k) => c.wrap(cell.label, widths[k] - 8, 2));
      s.cells.forEach((cell, k) => {
        const need = Math.max(...lines[k].map((l) => c.width(l))) + 8;
        if (bytes && widths[k] < need) errs.push(`cell ${cell.id} is ${Math.floor(widths[k])} px wide at this scale but its label needs ${Math.ceil(need)} px - set "scale" to "schematic" or shorten the label`);
      });
      const nl = Math.max(...s.cells.map((cell, k) => lines[k].length + (subOf(cell) ? 1 : 0)));
      const h = Math.max(42, nl * 15 + 16);
      const sl = c.wrap(s.label, LBL - 14, 2, { bold: true });
      const slAll = [...sl.map((t) => ({ t, bold: true })), ...(bytes && s.total ? [{ t: `${s.total} ${ir.unit || 'B'}`, bold: false }] : [])];
      slAll.forEach((l, k) => c.text(l.t, PADX, y + h / 2 - ((slAll.length - 1) * 16) / 2 + 5 + k * 16, { bold: l.bold, fill: l.bold ? PALETTE.ink : PALETTE.muted, owner: `strip ${s.id}`, room: LBL - 12 }));
      let x = x0;
      s.cells.forEach((cell, k) => {
        const w = widths[k], b = { x, y, w, h }, hot = c.accent.has(cell.id) || c.accent.has(s.id);
        box.set(cell.id, b);
        c.shape(`<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${h}" rx="${RX}" fill="${hot ? PALETTE.fills.accent : cellFill(cell.kind)}" stroke="${PALETTE.line}" stroke-width="${hot ? SW_HEAVY : SW_LIGHT}"${cell.kind === 'free' ? ' stroke-dasharray="4 3"' : ''}/>`, b, { id: cell.id });
        const all = [...lines[k].map((t) => ({ t, sub: false })), ...(subOf(cell) ? [{ t: subOf(cell), sub: true }] : [])];
        const top = y + h / 2 - ((all.length - 1) * 15) / 2 + 5;
        all.forEach((l, j) => c.text(l.t, x + w / 2, top + j * 15, { anchor: 'middle', size: l.sub ? SUB : SIZE, fill: hot ? ON_ACCENT : l.sub ? PALETTE.muted : PALETTE.ink, owner: cell.id, within: cell.id, room: w - 4 }));
        x += w;
      });
      for (const m of marks) {
        const mx = typeof m.at === 'number' ? x0 + (m.at / s.total) * CWD : box.get(m.at).x;
        c.guide(`<path d="M${f1(mx)} ${y - 8} v8" stroke="${PALETTE.ink}" stroke-width="${SW_HEAVY}"/>`);
        c.text(m.label, mx, y - 12, { anchor: 'middle', size: SUB, fill: PALETTE.muted, owner: `mark ${m.label}` });
      }
      y += h;
      bottoms[i] = y;
      y += (lanes[i] ? 10 + lanes[i] * 32 : 0) + 22;
    });
    if (errs.length) return { errs };
    for (const p of ptrs) {
      const A = box.get(p.from), B = box.get(p.to), id = `pointer ${p.from}->${p.to}`;
      const ax = A.x + A.w / 2, bx = B.x + B.w / 2, ly = bottoms[p.gap] + 14 + p.lane * 32;
      const aEdge = p.a > p.b ? A.y : A.y + A.h, bEdge = p.b > p.a ? B.y - 2 : B.y + B.h + 2;
      const pts = Math.abs(ax - bx) < 2 && p.a !== p.b ? [[ax, aEdge], [bx, bEdge]] : [[ax, aEdge], [ax, ly], [bx, ly], [bx, bEdge]];
      c.edge(c.path(pts, 'sync'), pts, { id, from: p.from, to: p.to });
      if (pts.length === 2) c.text(p.label, ax + 6, (aEdge + bEdge) / 2 + 4, { size: SUB, owner: id, halo: true });
      else c.text(p.label, (ax + bx) / 2, ly + 15, { anchor: 'middle', size: SUB, owner: id, halo: true });
    }
    return { W, H: y - 10 };
  },
};

// ----- tree: B-tree (ordered keys) or plan tree (labels); at most two trees, stacked -----

const keyKind = (k) => (Array.isArray(k) ? 'array' : typeof k);
function cmpKey(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const r = cmpKey(a[i], b[i]); if (r) return r; }
    return a.length - b.length;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
const fmtKey = (k) => (Array.isArray(k) ? `(${k.map(fmtKey).join(', ')})` : String(k));

function treeShape(ir) {
  const byId = new Map(ir.nodes.map((n) => [n.id, n]));
  const kids = new Map(ir.nodes.map((n) => [n.id, []]));
  for (const n of ir.nodes) if (n.parent != null && kids.has(n.parent)) kids.get(n.parent).push(n);
  const rootOf = new Map(), depth = new Map();
  const walk = (n, r, d) => { rootOf.set(n.id, r); depth.set(n.id, d); for (const k of kids.get(n.id)) walk(k, r, d + 1); };
  for (const r of ir.roots || []) if (byId.has(r) && byId.get(r).parent == null) walk(byId.get(r), r, 1);
  return { byId, kids, rootOf, depth };
}

BOOK_TYPES.tree = {
  validate(ir) {
    const errs = commonErrs(ir);
    const nodes = Array.isArray(ir.nodes) ? ir.nodes : [];
    if (!nodes.length) return [...errs, 'add at least one entry to "nodes"'];
    ids(nodes, 'nodes', errs);
    if (errs.length) return errs;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const roots = Array.isArray(ir.roots) ? ir.roots : [];
    if (!roots.length) errs.push('list the root node ids in "roots" (one per tree, at most 2)');
    if (roots.length > 2) errs.push(`a figure holds at most 2 trees - split it ("roots" has ${roots.length})`);
    for (const r of roots) {
      if (!byId.has(r)) errs.push(`roots: "${r}" is not a node id`);
      else if (byId.get(r).parent != null) errs.push(`roots: ${r} has a parent - a root has none`);
    }
    for (const n of nodes) {
      if (n.parent != null && !byId.has(n.parent)) errs.push(`node ${n.id}: "parent" must name a node id (got ${JSON.stringify(n.parent)})`);
      if (n.parent == null && !roots.includes(n.id)) errs.push(`node ${n.id} has no parent but is not in "roots" - give it a parent or list it as a root`);
      if (!n.ellipsis && !ir.ordered && !isStr(n.label)) errs.push(`node ${n.id}: add a "label"`);
      if (!n.ellipsis && ir.ordered && !(Array.isArray(n.keys) && n.keys.length)) errs.push(`node ${n.id}: give it "keys" - an ordered tree shows every node's keys`);
    }
    for (const n of nodes) {
      const seen = new Set([n.id]);
      for (let p = byId.get(n.parent); p; p = byId.get(p.parent)) {
        if (seen.has(p.id)) { errs.push(`node ${n.id} is in a parent cycle - a tree has no cycles`); break; }
        seen.add(p.id);
      }
    }
    if (errs.length) return errs;
    const { kids, rootOf, depth } = treeShape(ir);
    for (const r of roots) {
      const members = nodes.filter((n) => rootOf.get(n.id) === r);
      const levels = new Map();
      for (const n of members) levels.set(depth.get(n.id), (levels.get(depth.get(n.id)) || 0) + 1);
      const deep = Math.max(...levels.keys());
      if (deep > 6) errs.push(`tree ${r} is ${deep} levels deep - keep it to 6 (cut levels with an ellipsis node or split)`);
      for (const [d, k] of levels) if (k > 7) errs.push(`level ${d} of tree ${r} shows ${k} nodes - keep it to 7: replace the middle ones with one {"ellipsis": true} node`);
      if (!ir.ordered) continue;
      const kinds = new Set(members.filter((n) => !n.ellipsis).flatMap((n) => n.keys.map(keyKind)));
      if (kinds.size > 1) { errs.push(`tree ${r} mixes key kinds (${[...kinds].join(' and ')}) - use one kind (arrays for composite keys)`); continue; }
      for (const n of members) {
        if (n.ellipsis) continue;
        for (let i = 1; i < n.keys.length; i++) if (cmpKey(n.keys[i - 1], n.keys[i]) >= 0) { errs.push(`node ${n.id}: keys are not ascending (${fmtKey(n.keys[i - 1])} before ${fmtKey(n.keys[i])})`); break; }
      }
      // Ranges: n-1 keys = separators (child i in [k(i-1), k(i))), n keys = each child's minimum (child i in [k(i), k(i+1))).
      const check = (n, lo, hi) => {
        const cs = kids.get(n.id);
        if (!cs.length || n.ellipsis) return;
        const k = n.keys, sep = k.length === cs.length - 1;
        if (!sep && k.length !== cs.length) { errs.push(`node ${n.id} has ${cs.length} children but ${k.length} keys - give it ${cs.length - 1} (separators) or ${cs.length} (each child's smallest key)`); return; }
        cs.forEach((ch, i) => {
          const clo = sep ? (i ? k[i - 1] : lo) : k[i], chi = sep ? (i < k.length ? k[i] : hi) : (i + 1 < k.length ? k[i + 1] : hi);
          if (!ch.ellipsis) for (const key of ch.keys) {
            if (clo != null && cmpKey(key, clo) < 0) { errs.push(`child ${ch.id} of ${n.id}: key ${fmtKey(key)} is not >= ${fmtKey(clo)} (its lower bound)`); break; }
            if (chi != null && cmpKey(key, chi) >= 0) { errs.push(`child ${ch.id} of ${n.id}: key ${fmtKey(key)} is not < ${fmtKey(chi)} (its upper bound)`); break; }
          }
          check(ch, clo, chi);
        });
      };
      check(byId.get(r), null, null);
    }
    (ir.links || []).forEach((l, i) => {
      if (!l || !byId.has(l.from) || !byId.has(l.to)) { errs.push(`links[${i}]: "from" and "to" must name node ids`); return; }
      if (l.style != null && !Object.keys(PALETTE.edges).includes(l.style)) errs.push(`links[${i}]: set "style" to one of ${Object.keys(PALETTE.edges).join(', ')} or leave it out`);
      if (rootOf.get(l.from) !== rootOf.get(l.to)) { if (!isStr(l.label)) errs.push(`links[${i}]: a link between two trees needs a "label" - say what the jump does`); return; }
      if (depth.get(l.from) !== depth.get(l.to)) { errs.push(`links[${i}]: inside one tree a link joins two nodes on one level (leaf siblings); parent lines come from "parent"`); return; }
      const level = nodes.filter((n) => rootOf.get(n.id) === rootOf.get(l.from) && depth.get(n.id) === depth.get(l.from));
      if (ir.ordered && order(level, kids, byId).indexOf(l.from) > order(level, kids, byId).indexOf(l.to)) errs.push(`links[${i}]: leaf link ${l.from} -> ${l.to} runs right to left - leaves link left to right (set "both": true for a doubly linked list)`);
    });
    return errs;
  },
  render(ir, c) {
    const { byId, kids, rootOf, depth } = treeShape(ir);
    const size = new Map();
    for (const n of ir.nodes) {
      if (n.ellipsis) { size.set(n.id, { w: 40, h: 30, keys: [] }); continue; }
      if (ir.ordered) {
        let keys = n.keys.map((k) => Math.max(28, c.width(fmtKey(k)) + 14));
        const kw = keys.reduce((a, b) => a + b, 0), lw = n.label ? c.width(n.label, { size: SUB }) + 16 : 0;
        if (lw > kw) keys = keys.map((w) => (w * lw) / kw); // a wider label stretches the key cells, not the margins
        size.set(n.id, { w: Math.max(kw, lw), h: 30 + (n.label ? 22 : 0), keys });
      } else {
        const lines = c.wrap(n.label, 150, 2, { bold: n.kind === 'op' });
        const w = Math.max(...lines.map((l) => c.width(l, { bold: n.kind === 'op' })), n.sublabel ? c.width(n.sublabel) : 0) + 22;
        size.set(n.id, { w: Math.max(56, w), h: (lines.length + (n.sublabel ? 1 : 0)) * 16 + 14, lines });
      }
    }
    const GAP = 30, LV = 48, sw = new Map();
    const span = (n) => {
      const cs = kids.get(n.id);
      const ch = cs.reduce((a, k) => a + span(k), 0) + GAP * Math.max(0, cs.length - 1);
      sw.set(n.id, Math.max(size.get(n.id).w, ch));
      return sw.get(n.id);
    };
    for (const r of ir.roots) span(byId.get(r));
    const contentW = Math.max(...ir.roots.map((r) => sw.get(r)));
    const W = Math.max(contentW + 2 * PADX, c.width(ir.title, { bold: true, size: TITLE }) + 2 * PADX);
    title(c, ir, W);
    const pos = new Map();
    let top = TOP + 10;
    for (const r of ir.roots) {
      const members = ir.nodes.filter((n) => rootOf.get(n.id) === r);
      const maxD = Math.max(...members.map((n) => depth.get(n.id)));
      const levelH = [];
      for (let d = 1; d <= maxD; d++) levelH[d] = Math.max(...members.filter((n) => depth.get(n.id) === d).map((n) => size.get(n.id).h));
      const levelY = [];
      levelY[1] = top;
      for (let d = 2; d <= maxD; d++) levelY[d] = levelY[d - 1] + levelH[d - 1] + LV;
      const place = (n, left) => {
        const cs = kids.get(n.id), s = size.get(n.id);
        const chW = cs.reduce((a, k) => a + sw.get(k.id), 0) + GAP * Math.max(0, cs.length - 1);
        let x = left + (sw.get(n.id) - chW) / 2;
        for (const k of cs) { place(k, x); x += sw.get(k.id) + GAP; }
        const cx = cs.length ? (pos.get(cs[0].id).x + pos.get(cs[cs.length - 1].id).x + pos.get(cs[cs.length - 1].id).w) / 2 : left + sw.get(n.id) / 2;
        pos.set(n.id, { x: cx - s.w / 2, y: levelY[depth.get(n.id)] + (levelH[depth.get(n.id)] - s.h) / 2, w: s.w, h: s.h });
      };
      place(byId.get(r), (W - sw.get(r)) / 2);
      top = levelY[maxD] + levelH[maxD] + 46;
    }
    // parent -> child lines, from the key boundary (separators) or under the key (min-keys)
    for (const n of ir.nodes) {
      const cs = kids.get(n.id), p = pos.get(n.id), s = size.get(n.id);
      cs.forEach((ch, i) => {
        let ax = p.x + p.w / 2;
        if (ir.ordered && !n.ellipsis) {
          const kx = [p.x + (p.w - s.keys.reduce((a, b) => a + b, 0)) / 2];
          s.keys.forEach((w) => kx.push(kx[kx.length - 1] + w));
          ax = n.keys.length === cs.length - 1 ? kx[i] : (kx[i] + kx[i + 1]) / 2;
        }
        const q = pos.get(ch.id), pts = [[ax, p.y + p.h], [q.x + q.w / 2, q.y]];
        c.edge(`<path d="M${f1(pts[0][0])} ${f1(pts[0][1])} L${f1(pts[1][0])} ${f1(pts[1][1])}" stroke="${PALETTE.line}" stroke-width="${SW_LIGHT}" fill="none"/>`, pts, { id: `line ${n.id}->${ch.id}`, from: n.id, to: ch.id });
      });
    }
    for (const n of ir.nodes) {
      const p = pos.get(n.id), s = size.get(n.id);
      const hot = c.accent.has(n.id), ink = hot ? ON_ACCENT : PALETTE.ink, rule = hot ? ON_ACCENT : PALETTE.line;
      const fill = hot ? PALETTE.fills.accent : n.kind === 'internal' ? PALETTE.fills.soft : PALETTE.fills.paper;
      if (n.ellipsis) {
        c.shape(`<rect x="${f1(p.x)}" y="${f1(p.y)}" width="${p.w}" height="${p.h}" rx="${RX}" fill="${PALETTE.fills.paper}" stroke="${PALETTE.muted}" stroke-width="${SW_LIGHT}" stroke-dasharray="3 3"/>`, p, { id: n.id });
        c.text('…', p.x + p.w / 2, p.y + p.h / 2 + 5, { anchor: 'middle', owner: n.id, within: n.id });
        continue;
      }
      let svg = `<rect x="${f1(p.x)}" y="${f1(p.y)}" width="${f1(p.w)}" height="${p.h}" rx="${RX}" fill="${fill}" stroke="${PALETTE.line}" stroke-width="${hot ? SW_HEAVY : SW_LIGHT}"/>`;
      if (ir.ordered) {
        const ky = p.y + (n.label ? 22 : 0);
        let kx = p.x + (p.w - s.keys.reduce((a, b) => a + b, 0)) / 2;
        if (n.label) svg += `<path d="M${f1(p.x)} ${f1(ky)} h${f1(p.w)}" stroke="${rule}" stroke-width="${SW_LIGHT}"/>`;
        s.keys.forEach((w, i) => { if (i) svg += `<path d="M${f1(kx)} ${f1(ky)} v30" stroke="${rule}" stroke-width="${SW_LIGHT}"/>`; kx += w; });
        c.shape(svg, p, { id: n.id });
        if (n.label) c.text(n.label, p.x + p.w / 2, p.y + 16, { anchor: 'middle', size: SUB, fill: hot ? ON_ACCENT : PALETTE.muted, owner: n.id, within: n.id });
        kx = p.x + (p.w - s.keys.reduce((a, b) => a + b, 0)) / 2;
        n.keys.forEach((k, i) => { c.text(fmtKey(k), kx + s.keys[i] / 2, ky + 20, { anchor: 'middle', fill: ink, owner: n.id, within: n.id }); kx += s.keys[i]; });
      } else {
        c.shape(svg, p, { id: n.id });
        const all = [...s.lines.map((t) => ({ t, sub: false })), ...(n.sublabel ? [{ t: n.sublabel, sub: true }] : [])];
        all.forEach((l, i) => c.text(l.t, p.x + p.w / 2, p.y + 21 + i * 16, { anchor: 'middle', bold: !l.sub && n.kind === 'op', fill: hot ? ON_ACCENT : l.sub ? PALETTE.muted : PALETTE.ink, owner: n.id, within: n.id, room: p.w - 8 }));
      }
    }
    for (const [i, l] of (ir.links || []).entries()) {
      const A = pos.get(l.from), B = pos.get(l.to), id = `link ${i}`, style = l.style || (rootOf.get(l.from) !== rootOf.get(l.to) ? 'async' : 'sync');
      const sibling = rootOf.get(l.from) === rootOf.get(l.to);
      const pts = sibling ? [[A.x + A.w + 2, A.y + A.h / 2], [B.x - 2, B.y + B.h / 2]]
        : [exitPoint(A, B.x + B.w / 2, B.y + B.h / 2, 2), exitPoint(B, A.x + A.w / 2, A.y + A.h / 2, 2)];
      c.edge(c.path(pts, style, { both: l.both }), pts, { id, from: l.from, to: l.to });
      if (l.label) edgeLabel(c, l.label, pts[0], pts[1], id, 220, 4, [...pos.values()]);
    }
    return { W, H: top - 30 };
  },
};
// Left-to-right order of a level's nodes: the order a depth-first walk meets them.
function order(level, kids, byId) {
  const roots = new Set(level.map((n) => n.id)), out = [];
  const top = [...byId.values()].filter((n) => n.parent == null);
  const walk = (n) => { if (roots.has(n.id)) out.push(n.id); for (const k of kids.get(n.id)) walk(k); };
  top.forEach(walk);
  return out;
}

// ----- timeline: 1-4 sessions over discrete steps, lock waits between them -----

const CAUSE_SEP = 3; // least px between the vertical legs of two cause edges in one lane gap
const STEP_KINDS = ['stmt', 'wait', 'commit', 'rollback', 'error', 'note'];

BOOK_TYPES.timeline = {
  validate(ir) {
    const errs = commonErrs(ir);
    const lanes = Array.isArray(ir.lanes) ? ir.lanes : [];
    if (lanes.length < 1 || lanes.length > 4) errs.push(`a timeline holds 1-4 lanes (got ${lanes.length}) - split it`);
    const lids = ids(lanes, 'lanes', errs);
    lanes.forEach((l) => { if (l && !isStr(l.label)) errs.push(`lane ${l.id}: add a "label"`); });
    const steps = Array.isArray(ir.steps) ? ir.steps : [];
    if (!steps.length) errs.push('add at least one entry to "steps"');
    const at = new Map();
    steps.forEach((s, i) => {
      if (!s || !lids.has(s.lane)) { errs.push(`steps[${i}]: "lane" must name a lane id (got ${JSON.stringify(s && s.lane)})`); return; }
      if (!Number.isInteger(s.t) || s.t < 0 || s.t > 40) errs.push(`steps[${i}]: set "t" to a whole number 0-40`);
      if (!isStr(s.label)) errs.push(`steps[${i}]: add a "label"`);
      if (!STEP_KINDS.includes(s.kind)) errs.push(`steps[${i}]: set "kind" to one of ${STEP_KINDS.join(', ')}`);
      const k = `${s.lane}@${s.t}`;
      if (at.has(k)) errs.push(`lane ${s.lane} has two steps at t=${s.t} - one lane does one thing at a time; move one`);
      else at.set(k, s);
    });
    const waits = Array.isArray(ir.waits) ? ir.waits : [];
    const edges = [];
    waits.forEach((w, i) => {
      if (!w || !lids.has(w.lane) || !lids.has(w.on) || w.lane === w.on) { errs.push(`waits[${i}]: "lane" (who waits) and "on" (who holds the lock) must name two different lanes`); return; }
      if (!isStr(w.label)) errs.push(`waits[${i}]: add a "label" - name the lock and the row (e.g. "X lock on stock id=1")`);
      if (!Number.isInteger(w.from) || !Number.isInteger(w.until) || w.until <= w.from) { errs.push(`waits[${i}]: set "from" and "until" to steps, until after from`); return; }
      const start = at.get(`${w.lane}@${w.from}`);
      if (!start || start.kind !== 'stmt') errs.push(`waits[${i}]: "from" t=${w.from} must be a stmt step of lane ${w.lane} - a session blocks on a statement it issued`);
      const rel = at.get(`${w.on}@${w.until}`), own = at.get(`${w.lane}@${w.until}`);
      if (!(rel && ['commit', 'rollback', 'error'].includes(rel.kind)) && !(own && own.kind === 'error')) errs.push(`waits[${i}]: at t=${w.until} lane ${w.on} neither commits, rolls back nor errors, and lane ${w.lane} does not error - end the wait where the lock is released (or where the waiter times out)`);
      if (w.until - w.from < 2) errs.push(`waits[${i}]: the wait t=${w.from}..${w.until} leaves no empty step to draw it in - leave at least one t between "from" and "until"`);
      for (const s of steps) if (s && s.lane === w.lane && s.t > w.from && s.t < w.until) errs.push(`lane ${w.lane} has a step at t=${s.t} while it waits (t=${w.from}..${w.until}) - a blocked session runs nothing; move the step after the wait`);
      if (w.holder != null) {
        const hs = at.get(`${w.on}@${w.holder}`);
        if (!hs || hs.kind !== 'stmt') errs.push(`waits[${i}]: "holder" t=${JSON.stringify(w.holder)} must be a stmt step of lane ${w.on} - the statement where ${w.on} took the lock`);
        else if (w.holder >= w.from) errs.push(`waits[${i}]: "holder" t=${w.holder} must come before "from" t=${w.from} - ${w.on} takes the lock before ${w.lane} asks for it`);
        if (Math.abs(lanes.findIndex((l) => l && l.id === w.on) - lanes.findIndex((l) => l && l.id === w.lane)) !== 1) errs.push(`waits[${i}]: "holder" needs lane ${w.on} and lane ${w.lane} to be adjacent - the cause edge runs through the gap between two neighbouring lanes; reorder "lanes" or drop "holder"`);
      }
      if (w.resume != null) {
        if (!isStr(w.resume)) errs.push(`waits[${i}]: "resume" must be the text to draw at the resume step`);
        else if (!steps.some((s) => s && s.lane === w.lane && s.t > w.until)) errs.push(`waits[${i}]: "resume" needs a step of lane ${w.lane} after t=${w.until} to draw it beside - add that step or drop "resume"`);
      }
      edges.push([w.lane, w.on]);
    });
    // a cycle of waits is a deadlock: one lane in it must show the error that ends it
    const next = new Map();
    for (const [a, b] of edges) next.set(a, [...(next.get(a) || []), b]);
    const reported = new Set();
    const dfs = (n, path) => {
      for (const m of next.get(n) || []) {
        const k = path.indexOf(m);
        if (k >= 0) {
          const cyc = path.slice(k);
          const key = [...cyc].sort().join();
          if (reported.has(key)) continue;
          reported.add(key);
          const ok = steps.some((s) => s && cyc.includes(s.lane) && s.kind === 'error' && /deadlock|교착/i.test(s.label || ''));
          if (!ok) errs.push(`waits form a cycle (${[...cyc, m].join(' -> ')}) but no lane in it has an error step naming the deadlock - add the victim's error (e.g. "ERROR 1213 Deadlock")`);
        } else dfs(m, [...path, m]);
      }
    };
    for (const l of lids) dfs(l, [l]);
    return errs;
  },
  render(ir, c) {
    // Every lane is LW wide and every step label wraps at LW - 24: a resume note never narrows a text.
    const W = 640, TW = 34, n = ir.lanes.length;
    const LW = (W - 2 * PADX - TW) / n;
    title(c, ir, W);
    const colX = new Map(ir.lanes.map((l, i) => [l.id, PADX + TW + i * LW]));
    const ts = ir.steps.map((s) => s.t), t0 = Math.min(...ts), t1 = Math.max(...ts, ...(ir.waits || []).map((w) => w.until));
    const stepAt = new Map(ir.steps.map((s) => [`${s.lane}@${s.t}`, s]));
    const isBold = (s) => s.kind === 'commit' || s.kind === 'error';
    const lines = new Map(ir.steps.map((s) => [`${s.lane}@${s.t}`, c.wrap(s.label, LW - 24, 2, { bold: isBold(s) })]));
    const boxW = new Map(ir.steps.map((s) => { const k = `${s.lane}@${s.t}`; return [k, Math.max(...lines.get(k).map((l) => c.width(l, { bold: isBold(s) }))) + 16]; }));
    const waitLines = (ir.waits || []).map((w) => c.wrap(w.label, LW - 48, 2, { size: SUB }));
    // A resume note sits right of its step. When it does not fit beside a centred lifeline, only that
    // lane's lifeline moves left (as far as its widest box allows) and the note wraps in what is left.
    const cxOf = new Map(ir.lanes.map((l) => [l.id, colX.get(l.id) + LW / 2]));
    const resumeStep = (w) => ir.steps.filter((s) => s.lane === w.lane && s.t > w.until).sort((a, b) => a.t - b.t)[0];
    const noteLines = new Map(), noteRoom = new Map();
    // How far right a note of lane l may run: the left edge of the nearest lane to its right that has a step,
    // a wait span or a cause edge in the note's row, else the figure's edge.
    const spillTo = (l, w) => {
      const k = ir.lanes.indexOf(l), tr = resumeStep(w).t;
      let lim = W - 8;
      for (let j = k + 1; j < n; j++) {
        const id = ir.lanes[j].id;
        const busy = stepAt.has(`${id}@${tr}`) || (ir.waits || []).some((o) => (o.lane === id && o.from <= tr && tr <= o.until) || (o.holder != null && (o.lane === id || o.on === id) && o.holder <= tr && tr <= o.from));
        if (busy) lim = Math.min(lim, colX.get(id));
      }
      return lim;
    };
    for (const l of ir.lanes) {
      const rws = (ir.waits || []).map((w, i) => [w, i]).filter(([w]) => w.resume && w.lane === l.id);
      if (!rws.length) continue;
      const x = colX.get(l.id), right = x + LW;
      const reach = ([w]) => { const rs = resumeStep(w); return boxW.get(`${rs.lane}@${rs.t}`) / 2 + 8; };
      if (!rws.every((rw) => right - (cxOf.get(l.id) + reach(rw)) - 4 >= c.width(rw[0].resume, { size: SUB }))) {
        const half = Math.max(...ir.steps.filter((s) => s.lane === l.id).map((s) => boxW.get(`${s.lane}@${s.t}`) / 2), Math.min(LW - 12, c.width(l.label, { bold: true }) + 24) / 2) + 4;
        cxOf.set(l.id, x + Math.min(LW / 2, half));
      }
      for (const rw of rws) {
        const [w, i] = rw, wrapIn = (room) => c.wrap(w.resume, room, 3, { size: SUB }), tooWide = (ls, room) => ls.some((ln) => c.width(ln, { size: SUB }) > room + 0.5);
        let room = right - (cxOf.get(l.id) + reach(rw)) - 4, nl = wrapIn(room);
        if (tooWide(nl, room)) {
          // A word of the note does not fit in the lane: let it run on past the lane's edge up to the next
          // lane's first item in these rows (default - revisit), else draw it as one line, so check names
          // the note once instead of one message per word.
          room = Math.max(room, spillTo(l, w) - (cxOf.get(l.id) + reach(rw)) - 4);
          nl = wrapIn(room);
          if (tooWide(nl, room)) nl = [w.resume];
        }
        noteLines.set(i, nl);
        noteRoom.set(i, room);
      }
    }
    const rowH = new Map();
    for (let t = t0; t <= t1; t++) {
      let h = 26;
      for (const l of ir.lanes) { const ls = lines.get(`${l.id}@${t}`); if (ls) h = Math.max(h, ls.length * 16 + 12); }
      (ir.waits || []).forEach((w, i) => {
        if (t === w.from + 1) h = Math.max(h, waitLines[i].length * 16 + 10);
        if (w.resume && t === resumeStep(w).t) h = Math.max(h, noteLines.get(i).length * 16 + 12);
      });
      rowH.set(t, h + 10);
    }
    const hy = TOP + 4, rowY = new Map();
    let y = hy + 30 + 12;
    for (let t = t0; t <= t1; t++) { rowY.set(t, y); y += rowH.get(t); }
    for (const l of ir.lanes) {
      const x = cxOf.get(l.id), hw = Math.min(LW - 12, c.width(l.label, { bold: true }) + 24), b = { x: x - hw / 2, y: hy, w: hw, h: 30 };
      c.shape(`<rect x="${f1(b.x)}" y="${b.y}" width="${f1(b.w)}" height="30" rx="${RX}" fill="${PALETTE.fills.soft}" stroke="${PALETTE.line}" stroke-width="${SW_LIGHT}"/>`, b, { id: `lane ${l.id}` });
      c.text(l.label, x, hy + 20, { anchor: 'middle', bold: true, owner: `lane ${l.id}`, within: `lane ${l.id}`, room: LW - 20 });
    }
    const lifeAt = c.parts.length;
    for (let t = t0; t <= t1; t++) c.text(`t${t}`, PADX, rowY.get(t) + rowH.get(t) / 2 + 4, { size: SUB, fill: PALETTE.muted, owner: 'time' });
    const boxOf = new Map();
    for (const s of ir.steps) {
      const k = `${s.lane}@${s.t}`, ls = lines.get(k), cx = cxOf.get(s.lane), h = ls.length * 16 + 10;
      const id = `step ${k}`, bold = isBold(s), hot = c.accent.has(`${s.lane}@t${s.t}`);
      const w = boxW.get(k);
      const b = { x: cx - w / 2, y: rowY.get(s.t) + (rowH.get(s.t) - h) / 2, w, h };
      boxOf.set(k, b);
      if (s.kind !== 'note') {
        const fill = hot ? PALETTE.fills.accent : { commit: PALETTE.fills.soft, rollback: PALETTE.fills.soft, error: PALETTE.fills.mid }[s.kind] || PALETTE.fills.paper;
        const dash = s.kind === 'rollback' || s.kind === 'wait' ? ' stroke-dasharray="4 3"' : '';
        c.shape(`<rect x="${f1(b.x)}" y="${f1(b.y)}" width="${f1(b.w)}" height="${h}" rx="${RX}" fill="${fill}" stroke="${PALETTE.line}" stroke-width="${hot || s.kind === 'error' ? SW_HEAVY : SW_LIGHT}"${dash}/>`, b, { id });
      } else c.shape('', b, { id, container: true });
      ls.forEach((l, i) => c.text(l, b.x + b.w / 2, b.y + 17 + i * 16, { anchor: 'middle', bold, fill: hot ? ON_ACCENT : s.kind === 'note' ? PALETTE.muted : PALETTE.ink, owner: id, within: id, room: b.w - 8 }));
    }
    (ir.waits || []).forEach((w, i) => {
      const from = boxOf.get(`${w.lane}@${w.from}`), x = from.x + 8, end = boxOf.get(`${w.on}@${w.until}`) || boxOf.get(`${w.lane}@${w.until}`), BW = 12;
      const y1 = from.y + from.h, y2 = end ? end.y : rowY.get(w.until) + 4, id = `wait ${i}`;
      // the wait is a filled span from its statement down to the top edge of the step that releases it
      // (the on lane's step at until, else the waiter's own), with no connector
      c.shape(`<rect x="${f1(x)}" y="${f1(y1)}" width="${BW}" height="${f1(y2 - y1)}" rx="${RX}" fill="${PALETTE.fills.soft}" stroke="${PALETTE.edges.fail.color}" stroke-width="${SW_LIGHT}"/>`, { x, y: y1, w: BW, h: y2 - y1 }, { id });
      const ry = rowY.get(w.from + 1);
      waitLines[i].forEach((l, j) => c.text(l, x + BW + 6, ry + 17 + j * 16, { size: SUB, fill: PALETTE.edges.fail.color, owner: id, room: LW - 42 }));
      if (w.resume) {
        const rs = resumeStep(w), rb = boxOf.get(`${rs.lane}@${rs.t}`), rx0 = rb.x + rb.w + 8, nl = noteLines.get(i);
        nl.forEach((l, j) => c.text(l, rx0, rb.y + rb.h / 2 + 4 - (nl.length - 1) * 8 + j * 16, { size: SUB, owner: id, room: noteRoom.get(i), what: 'the resume note' }));
      }
    });
    // A cause edge is a right-angle polyline in the gap between the holder's lane and the waiter's lane
    // (validate keeps them neighbours): out of the holder box's side, down the gap, into the waiter's side.
    // The gap is what is free between the two lanes' items over the rows the edges span; each edge of one
    // gap takes its own x in it, the arrowhead's side leaving room for the head.
    const gaps = new Map();
    (ir.waits || []).forEach((w, i) => {
      if (w.holder == null) return;
      const k = Math.min(ir.lanes.findIndex((l) => l.id === w.on), ir.lanes.findIndex((l) => l.id === w.lane));
      gaps.set(k, [...(gaps.get(k) || []), i]);
    });
    for (const [k, idx] of gaps) {
      const left = ir.lanes[k].id, right = ir.lanes[k + 1].id;
      const ends = idx.flatMap((i) => [boxOf.get(`${ir.waits[i].on}@${ir.waits[i].holder}`), boxOf.get(`${ir.waits[i].lane}@${ir.waits[i].from}`)]);
      const y0 = Math.min(...ends.map((b) => b.y)), y1 = Math.max(...ends.map((b) => b.y + b.h));
      const seen = c.items.filter((it) => it.box && it.kind !== 'edge' && !String(it.id).startsWith('lane ') && it.box.y < y1 && it.box.y + it.box.h > y0);
      const inLane = (it, id) => { const m = it.box.x + it.box.w / 2; return m >= colX.get(id) && m < colX.get(id) + LW; };
      const xl = Math.max(...seen.filter((it) => inLane(it, left)).map((it) => it.box.x + it.box.w));
      const xr = Math.min(...seen.filter((it) => inLane(it, right)).map((it) => it.box.x));
      idx.forEach((i, j) => {
        const w = ir.waits[i], hb = boxOf.get(`${w.on}@${w.holder}`), from = boxOf.get(`${w.lane}@${w.from}`), toRight = w.lane === right;
        const lo = toRight ? xl + 4 : xl + 20, hi = toRight ? xr - 20 : xr - 4;
        // When the free stretch cannot give each edge CAUSE_SEP, the edges fan out CAUSE_SEP apart around
        // the middle of the gap; if that leaves the gap, the edge crosses a step box and check says so.
        const narrow = (hi - lo) / (idx.length + 1) < CAUSE_SEP;
        const gx = narrow ? (xl + xr) / 2 + (j - (idx.length - 1) / 2) * CAUSE_SEP : lo + ((hi - lo) * (j + 1)) / (idx.length + 1), yh = hb.y + hb.h / 2, yw = from.y + from.h / 2;
        const pts = [[toRight ? hb.x + hb.w : hb.x, yh], [gx, yh], [gx, yw], [toRight ? from.x - 2 : from.x + from.w + 2, yw]];
        c.defs.add(`<marker id="arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${PALETTE.fills.accent}"/></marker>`);
        c.edge(`<path d="${pts.map((p, q) => `${q ? 'L' : 'M'}${f1(p[0])} ${f1(p[1])}`).join(' ')}" fill="none" stroke="${PALETTE.fills.accent}" stroke-width="${SW_HEAVY}" marker-end="url(#arrow-accent)"/>`, pts, { exclusive: true, id: `cause ${i}`, from: `step ${w.on}@${w.holder}`, to: `step ${w.lane}@${w.from}` });
      });
    }
    // Each lane's dotted lifeline stops 3 px short of every step box and text it would run through
    // (a note has no box, so this is what keeps its text clear), and every piece is a checked line.
    const life = [];
    for (const l of ir.lanes) {
      const lx = cxOf.get(l.id);
      const cuts = c.items.filter((it) => it.box && !String(it.id).startsWith('lane ') && it.id !== 'plot' && it.box.x < lx && it.box.x + it.box.w > lx)
        .map((it) => [it.box.y - 3, it.box.y + it.box.h + 3]).sort((a, b) => a[0] - b[0]);
      let from = hy + 30, k = 0;
      const piece = (to) => {
        if (to - from < 4) return;
        const pts = [[lx, from], [lx, to]];
        life.push(`<line x1="${f1(lx)}" y1="${f1(from)}" x2="${f1(lx)}" y2="${f1(to)}" stroke="${PALETTE.fills.mid}" stroke-dasharray="2 4"/>`);
        c.items.push({ id: `lifeline ${l.id}#${k++}`, kind: 'edge', points: pts, from: `lane ${l.id}`, hint: 'move the text off the lane\'s lifeline' });
      };
      for (const [a, b] of cuts) { if (a > from) piece(a); from = Math.max(from, b); }
      piece(y);
    }
    c.parts.splice(lifeAt, 0, ...life);
    return { W, H: y + 8 };
  },
};

// ----- er: entities on an author-placed grid, crow's-foot relations -----

const CARDS = ['1:1', '1:N', 'N:1', 'N:M'];
// Per-end multiplicity, from-end:to-end, each drawn in crow's-foot notation at its own entity.
const ENDS = ['1', '0..1', '0..*', '1..*'];
const cardOk = (card) => CARDS.includes(card) || (typeof card === 'string' && card.split(':').length === 2 && card.split(':').every((e) => ENDS.includes(e)));
const isMany = (end) => end === 'N' || end === 'M' || end.endsWith('*');

BOOK_TYPES.er = {
  validate(ir) {
    const errs = commonErrs(ir);
    if (!['logical', 'physical'].includes(ir.level)) errs.push('set "level" to "logical" or "physical"');
    const ents = Array.isArray(ir.entities) ? ir.entities : [];
    if (!ents.length) return [...errs, 'add at least one entry to "entities"'];
    ids(ents, 'entities', errs);
    const byId = new Map(ents.filter((e) => e && e.id).map((e) => [e.id, e]));
    const cells = new Map();
    for (const e of ents) {
      if (!e || !e.id) continue;
      if (!isStr(e.label)) errs.push(`entity ${e.id}: add a "label"`);
      if (!Number.isInteger(e.row) || e.row < 0 || e.row > 6 || !Number.isInteger(e.col) || e.col < 0 || e.col > 4) errs.push(`entity ${e.id}: set "row" (0-6) and "col" (0-4) - you choose where it sits`);
      else {
        const k = `${e.row},${e.col}`;
        if (cells.has(k)) errs.push(`entities ${cells.get(k)} and ${e.id} both sit at row ${e.row}, col ${e.col} - move one to a free cell`);
        else cells.set(k, e.id);
      }
      const attrs = Array.isArray(e.attrs) ? e.attrs : [];
      if (attrs.length > 12) errs.push(`entity ${e.id} has ${attrs.length} attributes - keep it to 12 (split the entity or show only the ones the point needs)`);
      if (!attrs.some((a) => a && a.pk)) errs.push(`entity ${e.id}: mark its primary key ("pk": true on an attr)`);
      attrs.forEach((a, i) => { if (!a || !isStr(a.name)) errs.push(`entity ${e.id} attrs[${i}]: add a "name"`); });
    }
    for (const e of ents) for (const a of (e && e.attrs) || []) {
      if (!a || a.fk == null) continue;
      const m = /^([^.]+)\.(.+)$/.exec(String(a.fk));
      const t = m && byId.get(m[1]), ta = t && (t.attrs || []).find((x) => x && x.name === m[2]);
      if (!m) errs.push(`entity ${e.id} attr ${a.name}: "fk" must be "entity.attr" (got ${JSON.stringify(a.fk)})`);
      else if (!ta) errs.push(`entity ${e.id} attr ${a.name}: "fk" names ${a.fk}, which does not exist`);
      else if (!ta.pk && !ta.unique) errs.push(`entity ${e.id} attr ${a.name}: "fk" points at ${a.fk}, which is not a key - point it at ${m[1]}'s primary key (or mark ${m[2]} "unique")`);
    }
    const linked = new Set();
    const fkTo = (from, to) => ((byId.get(from) || {}).attrs || []).find((a) => a && String(a.fk || '').startsWith(`${to}.`));
    (ir.rels || []).forEach((r, i) => {
      if (!r || !byId.has(r.from) || !byId.has(r.to)) { errs.push(`rels[${i}]: "from" and "to" must name entity ids`); return; }
      linked.add(r.from); linked.add(r.to);
      if (!cardOk(r.card)) { errs.push(`rels[${i}]: set "card" to one of ${CARDS.join(', ')}, or "<from end>:<to end>" with each end one of ${ENDS.join(', ')} (e.g. "1:0..*")`); return; }
      const [mA, mB] = r.card.split(':').map(isMany);
      if (mA && mB && ir.level === 'physical') errs.push(`rels[${i}]: a physical model has no N:M - add a junction entity with two N:1 relations`);
      const [one, many] = !mA && mB ? [r.from, r.to] : mA && !mB ? [r.to, r.from] : [];
      const wrong = one && fkTo(one, many);
      if (wrong && !fkTo(many, one)) errs.push(`rels[${i}]: the foreign key ${one}.${wrong.name} sits on the 1 side of ${r.from} ${r.card} ${r.to} - it belongs on ${many} (the N side)`);
    });
    if (ents.length > 1) for (const id of byId.keys()) if (!linked.has(id)) errs.push(`entity ${id} has no relation - connect it or drop it`);
    return errs;
  },
  render(ir, c) {
    const HEAD = 28, ROW = 20, GX = 62, GY = 54;
    const marker = (a) => [a.pk && 'PK', a.fk && 'FK', a.unique && !a.pk && 'UK'].filter(Boolean).join(' ');
    const typeOf = (a) => [a.type, a.nullable ? 'NULL' : ''].filter(Boolean).join(' ');
    const dims = new Map();
    for (const e of ir.entities) {
      const mw = Math.max(0, ...e.attrs.map((a) => (marker(a) ? c.width(marker(a), { bold: true }) + 8 : 0)));
      const aw = Math.max(...e.attrs.map((a) => c.width(a.name) + (typeOf(a) ? c.width(typeOf(a)) + 14 : 0)));
      dims.set(e.id, { mw, w: Math.max(110, c.width(e.label, { bold: true }) + 24, mw + aw + 18), h: HEAD + e.attrs.length * ROW + 6 });
    }
    const cols = Math.max(...ir.entities.map((e) => e.col)) + 1, rows = Math.max(...ir.entities.map((e) => e.row)) + 1;
    const colW = Array.from({ length: cols }, (_, k) => Math.max(0, ...ir.entities.filter((e) => e.col === k).map((e) => dims.get(e.id).w)));
    const rowH = Array.from({ length: rows }, (_, k) => Math.max(0, ...ir.entities.filter((e) => e.row === k).map((e) => dims.get(e.id).h)));
    const colX = [PADX], rowY = [TOP + 14];
    for (let k = 1; k < cols; k++) colX[k] = colX[k - 1] + colW[k - 1] + GX;
    for (let k = 1; k < rows; k++) rowY[k] = rowY[k - 1] + rowH[k - 1] + GY;
    const W = Math.max(colX[cols - 1] + colW[cols - 1] + PADX, c.width(ir.title, { bold: true, size: TITLE }) + 2 * PADX);
    title(c, ir, W);
    const box = new Map(ir.entities.map((e) => {
      const d = dims.get(e.id);
      return [e.id, { x: colX[e.col] + (colW[e.col] - d.w) / 2, y: rowY[e.row], w: d.w, h: d.h }];
    }));
    for (const r of ir.rels || []) {
      const A = box.get(r.from), B = box.get(r.to), id = `rel ${r.from}-${r.to}`;
      // boxes that share a band of rows (or columns) get a straight line through the middle of that band
      const oy0 = Math.max(A.y, B.y), oy1 = Math.min(A.y + A.h, B.y + B.h), ox0 = Math.max(A.x, B.x), ox1 = Math.min(A.x + A.w, B.x + B.w);
      let s, t;
      if (oy1 - oy0 > 20 && (A.x + A.w <= B.x || B.x + B.w <= A.x)) { const y = (oy0 + oy1) / 2, ab = A.x < B.x; s = [ab ? A.x + A.w : A.x, y]; t = [ab ? B.x : B.x + B.w, y]; }
      else if (ox1 - ox0 > 20 && (A.y + A.h <= B.y || B.y + B.h <= A.y)) { const x = (ox0 + ox1) / 2, ab = A.y < B.y; s = [x, ab ? A.y + A.h : A.y]; t = [x, ab ? B.y : B.y + B.h]; }
      else { s = exitPoint(A, B.x + B.w / 2, B.y + B.h / 2, 0); t = exitPoint(B, A.x + A.w / 2, A.y + A.h / 2, 0); }
      c.edge(`<path d="M${f1(s[0])} ${f1(s[1])} L${f1(t[0])} ${f1(t[1])}" stroke="${PALETTE.line}" stroke-width="${SW_LIGHT}" fill="none"/>`, [s, t], { id, from: r.from, to: r.to });
      const [endA, endB] = r.card.split(':');
      for (const [p, q, end, ent] of [[s, t, endA, r.from], [t, s, endB, r.to]]) {
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]), ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len, px = -uy, py = ux;
        const at = (d, k) => [p[0] + ux * d + px * k, p[1] + uy * d + py * k];
        // every mark is a checked shape (a label on it is refused); ids: end <rel> <entity> bar|bar2|foot|circle
        const mark = (part, pts) => { const b = bbox(pts); c.items.push({ id: `end ${id} ${ent} ${part}`, kind: 'shape', box: { x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 }, mark: true }); };
        const barD = (d) => `M${f1(at(d, 7)[0])} ${f1(at(d, 7)[1])} L${f1(at(d, -7)[0])} ${f1(at(d, -7)[1])}`;
        const many = isMany(end), optional = end.startsWith('0..');
        if (many) {
          const ax = p[0] + ux * 14, ay = p[1] + uy * 14;
          c.guide(`<path d="M${f1(ax)} ${f1(ay)} L${f1(p[0] + px * 8)} ${f1(p[1] + py * 8)} M${f1(ax)} ${f1(ay)} L${f1(p[0])} ${f1(p[1])} M${f1(ax)} ${f1(ay)} L${f1(p[0] - px * 8)} ${f1(p[1] - py * 8)}" stroke="${PALETTE.line}" stroke-width="${SW_LIGHT}" fill="none"/>`);
          mark('foot', [at(0, 8), at(0, -8), at(14, 0)]);
          if (end === '1..*') { c.guide(`<path d="${barD(19)}" stroke="${PALETTE.line}" stroke-width="${SW_LIGHT}" fill="none"/>`); mark('bar', [at(19, 7), at(19, -7)]); }
        } else if (optional) {
          c.guide(`<path d="${barD(7)}" stroke="${PALETTE.line}" stroke-width="${SW_LIGHT}" fill="none"/>`);
          mark('bar', [at(7, 7), at(7, -7)]);
        } else {
          c.guide(`<path d="${barD(7)} ${barD(12)}" stroke="${PALETTE.line}" stroke-width="${SW_LIGHT}" fill="none"/>`);
          mark('bar1', [at(7, 7), at(7, -7)]); mark('bar2', [at(12, 7), at(12, -7)]);
        }
        if (optional) {
          const d = many ? 20.5 : 17, [cx, cy] = at(d, 0);
          c.guide(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="4.5" fill="${PALETTE.paper}" stroke="${PALETTE.line}" stroke-width="${SW_LIGHT}"/>`);
          mark('circle', [at(d - 4.5, 4.5), at(d + 4.5, -4.5)]);
        }
      }
      if (r.label) edgeLabel(c, r.label, s, t, id, GX + 40, 9, [...box.values()]);
    }
    for (const e of ir.entities) {
      const b = box.get(e.id), d = dims.get(e.id), hot = c.accent.has(e.id);
      c.shape(`<rect x="${f1(b.x)}" y="${b.y}" width="${f1(b.w)}" height="${b.h}" rx="${RX}" fill="${PALETTE.fills.paper}" stroke="${PALETTE.line}" stroke-width="${hot ? SW_HEAVY : SW_LIGHT}"/><path d="M${f1(b.x + 0.7)} ${b.y + 0.7} h${f1(b.w - 1.4)} v${HEAD - 0.7} h${f1(-(b.w - 1.4))} z" fill="${hot ? PALETTE.fills.accent : PALETTE.fills.soft}"/><path d="M${f1(b.x)} ${b.y + HEAD} h${f1(b.w)}" stroke="${PALETTE.line}" stroke-width="${SW_LIGHT}"/>`, b, { id: e.id });
      c.text(e.label, b.x + b.w / 2, b.y + 19, { anchor: 'middle', bold: true, fill: hot ? ON_ACCENT : PALETTE.ink, owner: e.id, within: e.id, room: b.w - 12 });
      e.attrs.forEach((a, k) => {
        const ay = b.y + HEAD + 15 + k * ROW;
        if (marker(a)) c.text(marker(a), b.x + 8, ay, { bold: true, fill: PALETTE.muted, owner: e.id, within: e.id });
        c.text(a.name, b.x + 8 + d.mw, ay, { owner: e.id, within: e.id });
        if (typeOf(a)) c.text(typeOf(a), b.x + b.w - 8, ay, { anchor: 'end', fill: PALETTE.muted, owner: e.id, within: e.id });
      });
    }
    return { W, H: rowY[rows - 1] + rowH[rows - 1] + 18 };
  },
};

// ----- chart: bar / line / dot, every value from a source file or stamped illustrative -----

const MARKS = ['bar', 'line', 'dot'];
const SERIES_FILLS = [PALETTE.fills.paper, PALETTE.fills.soft, PALETTE.fills.mid, PALETTE.fills.strong, 'url(#hatch)', 'url(#dots)'];
const SERIES_DASH = ['none', '7 4', '2 3', '12 3 2 3', '4 2', '10 5'];
function markerSvg(k, x, y, r = 4.2, hot = false) {
  const st = `fill="${hot ? PALETTE.fills.accent : k % 2 ? PALETTE.fills.paper : PALETTE.ink}" stroke="${PALETTE.ink}" stroke-width="${hot ? SW_HEAVY : SW_LIGHT}"`;
  switch (k % 6) {
    case 0: case 1: return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" ${st}/>`;
    case 2: case 3: return `<rect x="${f1(x - r)}" y="${f1(y - r)}" width="${2 * r}" height="${2 * r}" ${st}/>`;
    default: return `<path d="M${f1(x)} ${f1(y - r - 1)} L${f1(x + r + 1)} ${f1(y + r)} L${f1(x - r - 1)} ${f1(y + r)} Z" ${st}/>`;
  }
}
function niceStep(range) {
  const raw = range / 5, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

BOOK_TYPES.chart = {
  validate(ir, opts = {}) {
    const errs = commonErrs(ir);
    if (!MARKS.includes(ir.mark)) errs.push(`set "mark" to one of ${MARKS.join(', ')}`);
    const x = ir.x || {}, y = ir.y || {};
    if (!isStr(y.label)) errs.push('y: give the axis a "label"');
    if (!isStr(y.unit)) errs.push('y: give the axis a "unit" (ms, rows, %, ...) - a number without a unit says nothing');
    if (!isStr(x.label)) errs.push('x: give the axis a "label"');
    const cats = Array.isArray(x.categories) ? x.categories : null;
    if ((ir.mark === 'bar' || ir.mark === 'dot') && !(cats && cats.length)) errs.push(`x: a ${ir.mark} chart needs "categories"`);
    if (ir.mark === 'line' && !cats && !isStr(x.unit)) errs.push('x: a line chart needs "categories" or a numeric axis with a "unit"');
    if (ir.mark === 'bar' && y.min != null && y.min !== 0) errs.push(`a bar chart's y axis starts at 0 (got min ${y.min}) - a bar cut at another value lies about ratios; use mark "dot" or "line"`);
    const series = Array.isArray(ir.series) ? ir.series : [];
    if (!series.length) errs.push('add at least one entry to "series"');
    if (series.length > 6) errs.push(`${series.length} series is more than a reader tells apart - keep it to 6`);
    ids(series, 'series', errs);
    let nums = null;
    if (ir.source != null) {
      try {
        const text = readFileSync(resolve(opts.baseDir || process.cwd(), String(ir.source)), 'utf8');
        nums = (text.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) || []).map(Number);
      } catch (e) { errs.push(`"source" ${ir.source} cannot be read (${e.code || e.message}) - point it at the raw data file, relative to the IR`); }
    } else if (ir.illustrative !== true) errs.push('set "source" (the raw data file the values come from) or "illustrative": true (the figure is then stamped 예시 값)');
    for (const s of series) {
      if (!s) continue;
      if (!isStr(s.label)) errs.push(`series ${s.id}: add a "label"`);
      if ('median' in s) errs.push(`series ${s.id}: drop "median" - the dot chart draws the median from the points`);
      const pts = Array.isArray(s.points) ? s.points : [];
      if (!pts.length) errs.push(`series ${s.id}: add "points"`);
      for (const p of pts) {
        if (!p || typeof p.y !== 'number') { errs.push(`series ${s.id}: every point needs a number "y"`); continue; }
        if ('median' in p) errs.push(`series ${s.id}: drop "median" - the dot chart draws the median from the points`);
        if (cats ? !cats.includes(p.x) : typeof p.x !== 'number') errs.push(`series ${s.id}: x ${JSON.stringify(p.x)} is not ${cats ? 'one of x.categories' : 'a number'}`);
        if ((p.lo != null || p.hi != null) && !(typeof p.lo === 'number' && typeof p.hi === 'number' && p.lo <= p.y && p.y <= p.hi)) errs.push(`series ${s.id}, x ${p.x}: lo/hi (${p.lo}..${p.hi}) must bracket y (${p.y})`);
        if (nums && !nums.some((v) => Math.abs(v - p.y) <= 1e-9 * Math.max(1, Math.abs(v)))) errs.push(`series ${s.id}: y ${p.y} is not a number in ${ir.source} - plot measured values only`);
      }
    }
    return [...new Set(errs)];
  },
  render(ir, c) {
    const W = 600, H = 380, cats = ir.x.categories || null, series = ir.series;
    title(c, ir, W, ir.illustrative ? '예시 값 (illustrative)' : null);
    c.defs.add(`<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#ffffff"/><path d="M0 0 V6" stroke="${PALETTE.ink}" stroke-width="${SW_LIGHT}"/></pattern><pattern id="dots" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#ffffff"/><circle cx="3" cy="3" r="1.2" fill="${PALETTE.ink}"/></pattern>`);
    // legend
    let lx = PADX;
    series.forEach((s, k) => {
      const ly = 54;
      const hot = c.accent.has(s.id);
      if (ir.mark === 'bar') c.guide(`<rect x="${lx}" y="${ly - 10}" width="14" height="12" rx="${RX}" fill="${hot ? PALETTE.fills.accent : SERIES_FILLS[k]}" stroke="${PALETTE.ink}" stroke-width="${hot ? SW_HEAVY : SW_LIGHT}"/>`);
      else c.guide((ir.mark === 'line' ? `<path d="M${lx - 2} ${ly - 4} h18" stroke="${PALETTE.ink}" stroke-width="${hot ? SW_HEAVY : SW_LIGHT}"${SERIES_DASH[k] !== 'none' ? ` stroke-dasharray="${SERIES_DASH[k]}"` : ''}/>` : '') + markerSvg(k, lx + 7, ly - 4, 4.2, hot));
      const b = c.text(s.label, lx + 20, ly, { owner: 'legend' });
      lx = b.x + b.w + 18;
    });
    const all = series.flatMap((s) => s.points.flatMap((p) => [p.y, p.lo, p.hi].filter((v) => typeof v === 'number')));
    let lo = ir.mark === 'bar' ? 0 : ir.y.min ?? Math.min(...all), hi = ir.y.max ?? Math.max(...all);
    if (hi === lo) hi = lo + 1;
    const step = niceStep(hi - lo);
    if (ir.mark !== 'bar') lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 1e6; v += step) ticks.push(+v.toFixed(10));
    const tw = Math.max(...ticks.map((v) => c.width(num(v), { size: SUB })));
    const left = PADX + tw + 10, right = W - PADX, top = 96, bottom = H - 58;
    const Y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
    c.shape('', { x: left, y: top, w: right - left, h: bottom - top }, { id: 'plot', container: true });
    for (const v of ticks) {
      c.guide(`<path d="M${left} ${f1(Y(v))} H${right}" stroke="#e3e6ea" stroke-width="${SW_LIGHT}"/>`);
      c.text(num(v), left - 6, Y(v) + 4, { anchor: 'end', size: SUB, fill: PALETTE.muted, owner: 'axis' });
    }
    c.guide(`<path d="M${left} ${top - 6} V${bottom} H${right}" stroke="${PALETTE.ink}" stroke-width="${SW_LIGHT}" fill="none"/>`);
    c.text(`${ir.y.label} (${ir.y.unit})`, left - tw - 10, top - 14, { size: SUB, fill: PALETTE.muted, owner: 'axis' });
    let X;
    if (cats) {
      const band = (right - left) / cats.length;
      X = (v) => left + band * (cats.indexOf(v) + 0.5);
      cats.forEach((v) => c.text(String(v), X(v), bottom + 20, { anchor: 'middle', owner: 'axis', room: band - 6 }));
      X.band = band;
    } else {
      const xs = series.flatMap((s) => s.points.map((p) => p.x)), x0 = Math.min(...xs), x1 = Math.max(...xs) === x0 ? x0 + 1 : Math.max(...xs);
      X = (v) => left + 12 + ((v - x0) / (x1 - x0)) * (right - left - 24);
      const xs2 = niceStep(x1 - x0);
      for (let v = Math.ceil(x0 / xs2) * xs2; v <= x1 + xs2 / 1e6; v += xs2) c.text(num(v), X(v), bottom + 20, { anchor: 'middle', size: SUB, fill: PALETTE.muted, owner: 'axis' });
      X.band = 60;
    }
    c.text(ir.x.unit ? `${ir.x.label} (${ir.x.unit})` : ir.x.label, (left + right) / 2, bottom + 44, { anchor: 'middle', size: SUB, fill: PALETTE.muted, owner: 'axis' });
    const errBar = (x, p, owner) => {
      if (p.lo == null) return;
      const pts = [[x, Y(p.hi)], [x, Y(p.lo)]];
      c.edge(`<path d="M${f1(x)} ${f1(Y(p.hi))} V${f1(Y(p.lo))} M${f1(x - 5)} ${f1(Y(p.hi))} h10 M${f1(x - 5)} ${f1(Y(p.lo))} h10" stroke="${PALETTE.ink}" stroke-width="${SW_LIGHT}" fill="none"/>`, pts, { id: `range ${owner}`, from: owner, to: owner });
    };
    const ns = series.length;
    series.forEach((s, k) => {
      const hot = c.accent.has(s.id);
      if (ir.mark === 'bar') {
        const bw = Math.min(40, (X.band * 0.7) / ns);
        for (const p of s.points) {
          const x = X(p.x) + (k - (ns - 1) / 2) * bw, id = `bar ${s.id}@${p.x}`, b = { x: x - bw / 2, y: Y(p.y), w: bw, h: bottom - Y(p.y) };
          c.shape(`<rect x="${f1(b.x)}" y="${f1(b.y)}" width="${f1(bw)}" height="${f1(b.h)}" rx="${RX}" fill="${hot ? PALETTE.fills.accent : SERIES_FILLS[k]}" stroke="${PALETTE.ink}" stroke-width="${hot ? SW_HEAVY : SW_LIGHT}"/>`, b, { id });
          errBar(x, p, id);
        }
      } else if (ir.mark === 'line') {
        const pts = s.points.map((p) => [X(p.x), Y(p.y)]);
        c.edge(`<path d="${pts.map((q, i) => `${i ? 'L' : 'M'}${f1(q[0])} ${f1(q[1])}`).join(' ')}" fill="none" stroke="${PALETTE.ink}" stroke-width="${hot ? SW_HEAVY : SW_LIGHT}"${SERIES_DASH[k] !== 'none' ? ` stroke-dasharray="${SERIES_DASH[k]}"` : ''}/>`, pts, { id: `line ${s.id}`, owner: s.id });
        s.points.forEach((p, i) => {
          const id = `point ${s.id}@${p.x}`;
          c.shape(markerSvg(k, pts[i][0], pts[i][1], 4.2, hot), { x: pts[i][0] - 5, y: pts[i][1] - 5, w: 10, h: 10 }, { id, mark: true });
          errBar(pts[i][0], p, id);
        });
      } else {
        const off = (k - (ns - 1) / 2) * Math.min(56, X.band / (ns + 1));
        for (const cat of cats) {
          const ps = s.points.filter((p) => p.x === cat);
          if (!ps.length) continue;
          const cx = X(cat) + off;
          ps.forEach((p, j) => {
            const x = cx + (j - (ps.length - 1) / 2) * 9, id = `point ${s.id}@${cat}#${j}`;
            c.shape(markerSvg(k, x, Y(p.y), 3.6, hot), { x: x - 4, y: Y(p.y) - 4, w: 8, h: 8 }, { id, mark: true });
            errBar(x, p, id);
          });
          // the median is the renderer's, computed from the plotted points
          const v = ps.map((p) => p.y).sort((a, b) => a - b), m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
          const half = ((ps.length - 1) / 2) * 9 + 9, id = `median ${s.id}@${cat}`, pts = [[cx - half, Y(m)], [cx + half, Y(m)]];
          c.edge(`<path d="M${f1(cx - half)} ${f1(Y(m))} H${f1(cx + half)}" stroke="${PALETTE.ink}" stroke-width="${SW_HEAVY}"/>`, pts, { id, owner: s.id });
          // right of the median line, or left of it when the right side would run past the plot
          const ml = `중앙값 ${num(m)}`, left2 = cx + half + 6 + c.width(ml, { size: SUB }) > right;
          c.text(ml, left2 ? cx - half - 6 : cx + half + 6, Y(m) + 4, { size: SUB, owner: id, halo: true, anchor: left2 ? 'end' : 'start' });
        }
      }
    });
    return { W, H };
  },
};

// ---------- claim: the elements the figure's point rests on, drawn in the accent ----------

// The ids a claim may name, per book type (the IR already passed the type's own validate).
const CLAIM_IDS = {
  layout: (ir) => ir.strips.flatMap((s) => [s.id, ...s.cells.map((c) => c.id)]),
  tree: (ir) => ir.nodes.map((n) => n.id),
  timeline: (ir) => ir.steps.map((s) => `${s.lane}@t${s.t}`),
  er: (ir) => ir.entities.map((e) => e.id),
  chart: (ir) => ir.series.map((s) => s.id),
};
function claimErrs(ir, known) {
  const e = 'e.g. ' + JSON.stringify(known[0]);
  if (!Array.isArray(ir.claim)) return [`add a top-level "claim": the ids of the elements the caption's point rests on (${e}) - the figure draws them in the accent`];
  if (!ir.claim.length) return [`"claim" is empty - list the ids of the elements the caption's point rests on (${e})`];
  const bad = ir.claim.filter((id) => !known.includes(id));
  return bad.length ? [`"claim" names ${bad.map((id) => JSON.stringify(id)).join(', ')}, which ${bad.length > 1 ? 'are' : 'is'} no element of this ${ir.type} - use ids like ${known.slice(0, 3).map((id) => JSON.stringify(id)).join(', ')}`] : [];
}
// The refusal sits here, not in diagram.mjs validate(): teams imports that one.
for (const [type, t] of Object.entries(BOOK_TYPES)) {
  const own = t.validate;
  t.validate = (ir, opts) => { const errs = own(ir, opts); return errs.length ? errs : claimErrs(ir, CLAIM_IDS[type](ir)); };
}

// ---------- build: validate -> lay out -> measure ----------

function build(ir, opts = {}) {
  if (!ir || typeof ir !== 'object' || Array.isArray(ir)) return { errs: ['the IR must be a JSON object'] };
  const book = BOOK_TYPES[ir.type];
  if (!TYPES.includes(ir.type) && !book) return { errs: [`set "type" to one of ${[...TYPES, ...Object.keys(BOOK_TYPES)].join(', ')} (got ${JSON.stringify(ir.type)})`] };
  const errs = book ? book.validate(ir, opts) : validate(ir);
  if (errs.length) return { errs };
  const c = new Canvas();
  if (book) c.accent = new Set(ir.claim);
  const laid = book ? book.render(ir, c, opts) : ir.type === 'sequence' ? staticSequence(ir, c) : staticGrid(ir, c);
  if (laid.errs && laid.errs.length) return { errs: laid.errs };
  const W = Math.ceil(laid.W), H = Math.ceil(laid.H);
  const out = [];
  for (const t of c.items.filter((i) => i.kind === 'text')) {
    const miss = missingChars(loadFont('Regular'), t.text);
    if (miss.length) out.push(`"${t.text}" uses ${miss.map((ch) => `${ch} (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`).join(', ')}, which NanumGothic does not have - replace it`);
  }
  out.push(...checkGeometry(c.items, { W, H }));
  return { errs: out, c, W, H };
}

export const checkFigure = (ir, opts) => build(ir, opts).errs;
// The laid-out geometry records (texts, shapes, edges) the check measures; null for an IR that does not validate.
export const figureItems = (ir, opts) => { const b = build(ir, opts); return b.c ? b.c.items : null; };

function toSvg(ir, { c, W, H }) {
  const faces = ['Regular', 'Bold'].filter((w) => c.used[w]).map((w) =>
    `@font-face{font-family:'FigNanum';font-weight:${w === 'Bold' ? 700 : 400};src:url(data:font/ttf;base64,${subsetFont(loadFont(w), c.used[w]).toString('base64')}) format('truetype')}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ir.title)}">
<style>${faces}text{font-family:'FigNanum';font-kerning:none;font-variant-ligatures:none}</style>
<defs>${[...c.defs].join('')}</defs>
<rect width="${W}" height="${H}" fill="${PALETTE.paper}"/>
${c.parts.join('\n')}
</svg>
`;
}

export function renderFigure(ir, opts) {
  const b = build(ir, opts);
  if (b.errs.length) throw new Error(`figure does not pass the check:\n- ${b.errs.join('\n- ')}`);
  return { svg: toSvg(ir, b), W: b.W, H: b.H };
}

function atomicWrite(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

// The HTML page for a book type: the same static SVG, inline.
export function renderFigureHtmlToFile(ir, outPath, opts) {
  const { svg } = renderFigure(ir, opts);
  atomicWrite(outPath, `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ir.title)}</title>
<style>body{margin:0;background:#ffffff;padding:16px}svg{display:block;max-width:100%;height:auto;margin:0 auto}</style></head><body>
${svg}</body></html>\n`);
  return outPath;
}

// ---------- PNG: headless Chrome screenshots an <img> of the SVG ----------

function findIn(dir, names, depth) {
  if (depth < 0 || !existsSync(dir)) return null;
  for (const e of readdirSync(dir).sort().reverse()) {
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isFile() && names.includes(e)) return p;
    if (st.isDirectory()) { const hit = findIn(p, names, depth - 1); if (hit) return hit; }
  }
  return null;
}

// CHROME set -> that path only. Otherwise macOS app bundles, PATH, then Playwright's browser cache
// (the same order as write:tech-book's render-pdf, copied rather than imported across plugins).
export function findBrowser(env = process.env) {
  if (env.CHROME) return existsSync(env.CHROME) ? env.CHROME : null;
  const home = homedir();
  const apps = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Chromium.app/Contents/MacOS/Chromium', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  for (const root of ['/Applications', join(home, 'Applications')])
    for (const a of apps) if (existsSync(join(root, a))) return join(root, a);
  for (const dir of (env.PATH || '').split(delimiter))
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'])
      if (dir && existsSync(join(dir, n))) return join(dir, n);
  for (const cache of [join(home, '.cache', 'ms-playwright'), join(home, 'Library', 'Caches', 'ms-playwright')]) {
    const hit = findIn(cache, ['headless_shell', 'chrome-headless-shell', 'chrome', 'Chromium'], 4);
    if (hit) return hit;
  }
  return null;
}

export const rasterPage = (svgPath, W, H) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#ffffff}img{display:block}</style></head><body><img src="${pathToFileURL(resolve(svgPath)).href}" width="${W}" height="${H}"></body></html>`;

export function pngSize(buf) { return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; }

// The inflated IDAT stream: equal bytes mean equal pixels (one encoder, deterministic filters).
export function pngPixels(buf) {
  const chunks = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8);
    if (type === 'IDAT') chunks.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  return inflateSync(Buffer.concat(chunks));
}

// A full Chrome's headless window keeps some of --window-size for its own frame (measured: Chromium 140
// gives a 640x376 window a 640x289 viewport), so the page is laid out short and the rows below the viewport
// come out blank while the PNG still has the window's size. The viewport is probed, never assumed.
const probePage = '<!doctype html><body><script>document.body.textContent="VP "+innerWidth+"x"+innerHeight</script>';

function probeViewport(browser, dir, w, h) {
  const page = join(dir, 'probe.html');
  writeFileSync(page, probePage);
  const r = spawnSync(browser, ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
    `--window-size=${w},${h}`, '--force-device-scale-factor=2', '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8', timeout: 60000 });
  const m = /VP (\d+)x(\d+)/.exec(r.stdout || '');
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const pngChunk = (type, data) => {
  const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
};

// The first `rows` pixel rows of an 8-bit RGB/RGBA non-interlaced PNG (a row's filter looks only up and left,
// so dropping the bottom rows keeps the rest valid), or null for any other PNG.
function cropPngRows(buf, rows) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), depth = buf[24], color = buf[25], interlace = buf[28];
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0 || rows > h) return null;
  const raw = pngPixels(buf), stride = 1 + w * (color === 2 ? 3 : 4);
  if (raw.length !== h * stride) return null;
  const ihdr = Buffer.from(buf.subarray(16, 29)); ihdr.writeUInt32BE(rows, 4);
  return Buffer.concat([buf.subarray(0, 8), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw.subarray(0, rows * stride))), pngChunk('IEND', Buffer.alloc(0))]);
}

export function rasterize(svgPath, W, H, pngPath, env = process.env) {
  const browser = findBrowser(env);
  if (!browser) return { code: 3, msg: 'no Chrome-family browser found - set CHROME=<path to Chrome/Chromium/Edge> to write the PNG' };
  const dir = mkdtempSync(join(tmpdir(), 'figure-'));
  try {
    const page = join(dir, 'page.html'), shot = join(dir, 'shot.png');
    writeFileSync(page, rasterPage(svgPath, W, H));
    // The window is enlarged by the viewport's shortfall (the extra bottom rows are cropped below), then
    // probed again: a viewport still under W x H would crop the figure, so it is refused.
    let [ww, wh] = [W, H];
    const vp = probeViewport(browser, dir, W, H);
    if (!vp) return { code: 1, msg: `cannot probe the viewport of ${browser}: the page script did not run, so a cropped figure cannot be ruled out` };
    if (vp[0] < W || vp[1] < H) {
      if (vp[0] < W) return { code: 1, msg: `viewport is ${vp[0]}x${vp[1]} for a ${W}x${H} window (${browser}): narrower than the figure, so the PNG would be cropped` };
      wh = H + (H - vp[1]);
      const vp2 = probeViewport(browser, dir, ww, wh);
      if (!vp2 || vp2[0] < W || vp2[1] < H) return { code: 1, msg: `viewport is ${vp2 ? vp2.join('x') : 'unknown'} for a ${ww}x${wh} window (${browser}): smaller than the ${W}x${H} figure, so the PNG would be cropped` };
    }
    const r = spawnSync(browser, ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
      `--screenshot=${shot}`, `--window-size=${ww},${wh}`, '--force-device-scale-factor=2', '--default-background-color=ffffffff', pathToFileURL(page).href],
    { encoding: 'utf8', timeout: 120000 });
    if (!existsSync(shot)) return { code: 1, msg: `screenshot failed (${browser}): ${(r.stderr || r.error?.message || '').trim().slice(-400)}` };
    let png = readFileSync(shot);
    const [pw, ph] = pngSize(png);
    if (wh !== H && pw === 2 * ww && ph === 2 * wh) png = cropPngRows(png, 2 * H) || png;
    const [cw, ch] = pngSize(png);
    if (cw !== 2 * W || ch !== 2 * H) return { code: 1, msg: `screenshot is ${pw}x${ph}, expected ${2 * W}x${2 * H}` };
    atomicWrite(pngPath, png);
    return { code: 0, msg: `ok ${pngPath}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// <base>.svg + <base>.png, or nothing: a refused figure leaves the previous pair as it was.
export function writeFigure(ir, base, opts = {}) {
  const b = build(ir, opts);
  if (b.errs.length) return { code: 1, msg: b.errs.map((e) => `- ${e}`).join('\n') };
  const svgPath = `${base}.svg`, pngPath = `${base}.png`;
  atomicWrite(svgPath, toSvg(ir, b));
  rmSync(pngPath, { force: true }); // a stale PNG must not pass for this SVG
  const r = rasterize(svgPath, b.W, b.H, pngPath, opts.env || process.env);
  if (r.code) return { code: r.code, msg: `${svgPath} written; ${r.msg}` };
  return { code: 0, msg: `ok ${svgPath} ${pngPath} (${b.W}x${b.H}, PNG ${2 * b.W}x${2 * b.H}) - now Read the PNG` };
}

