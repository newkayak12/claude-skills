// write:diagram - TrueType reading and subsetting with node: builtins only.
// A figure embeds only the glyphs its text uses (plus every component a composite glyph is built
// from - Hangul syllables are jamo composites), and the checker measures text with the same
// advance widths the browser will use (kerning and ligatures are switched off in the SVG).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
const cache = new Map();

export function loadFont(weight = 'Regular') {
  if (!cache.has(weight)) cache.set(weight, parseFont(readFileSync(join(FONTS, `NanumGothic-${weight}.ttf`))));
  return cache.get(weight);
}

export function parseFont(buf) {
  const tables = new Map();
  for (let i = 0, n = buf.readUInt16BE(4); i < n; i++) {
    const r = 12 + 16 * i, off = buf.readUInt32BE(r + 8);
    tables.set(buf.toString('latin1', r, r + 4), buf.subarray(off, off + buf.readUInt32BE(r + 12)));
  }
  const head = tables.get('head'), hhea = tables.get('hhea'), hmtx = tables.get('hmtx'), loca = tables.get('loca');
  const numGlyphs = tables.get('maxp').readUInt16BE(4);
  const numHM = hhea.readUInt16BE(34), longLoca = head.readInt16BE(50) === 1;
  const advances = new Uint16Array(numGlyphs), lsbs = new Int16Array(numGlyphs), offsets = new Uint32Array(numGlyphs + 1);
  for (let g = 0; g < numGlyphs; g++) {
    advances[g] = g < numHM ? hmtx.readUInt16BE(4 * g) : advances[numHM - 1];
    lsbs[g] = g < numHM ? hmtx.readInt16BE(4 * g + 2) : hmtx.readInt16BE(4 * numHM + 2 * (g - numHM));
  }
  for (let g = 0; g <= numGlyphs; g++) offsets[g] = longLoca ? loca.readUInt32BE(4 * g) : loca.readUInt16BE(2 * g) * 2;
  return {
    tables, numGlyphs, advances, lsbs, offsets, glyf: tables.get('glyf'), cmap: parseCmap(tables.get('cmap')),
    unitsPerEm: head.readUInt16BE(18), ascender: hhea.readInt16BE(4), descender: hhea.readInt16BE(6),
  };
}

function parseCmap(t) {
  const subs = [];
  for (let i = 0, n = t.readUInt16BE(2); i < n; i++) {
    const r = 4 + 8 * i;
    subs.push({ pid: t.readUInt16BE(r), eid: t.readUInt16BE(r + 2), off: t.readUInt32BE(r + 4) });
  }
  const pick = subs.find((s) => s.pid === 3 && s.eid === 10 && t.readUInt16BE(s.off) === 12)
    || subs.find((s) => (s.pid === 3 && s.eid === 1) || s.pid === 0);
  const map = new Map();
  const o = pick.off;
  if (t.readUInt16BE(o) === 12) {
    for (let i = 0, n = t.readUInt32BE(o + 12); i < n; i++) {
      const r = o + 16 + 12 * i, start = t.readUInt32BE(r), end = t.readUInt32BE(r + 4), g0 = t.readUInt32BE(r + 8);
      for (let c = start; c <= end; c++) map.set(c, g0 + c - start);
    }
    return map;
  }
  const segX2 = t.readUInt16BE(o + 6), ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
  for (let s = 0; s < segX2; s += 2) {
    const end = t.readUInt16BE(ends + s), start = t.readUInt16BE(starts + s), delta = t.readUInt16BE(deltas + s), ro = t.readUInt16BE(ranges + s);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let g = ro ? t.readUInt16BE(ranges + s + ro + 2 * (c - start)) : c;
      if (ro && g === 0) continue;
      g = (g + delta) & 0xffff;
      if (g) map.set(c, g);
    }
  }
  return map;
}

const glyphData = (font, g) => font.glyf.subarray(font.offsets[g], font.offsets[g + 1]);

// Component records of a composite glyph: the child glyph id, where that id sits, and the record's bytes.
function components(data) {
  if (data.length < 10 || data.readInt16BE(0) >= 0) return null;
  const out = [];
  let o = 10, flags;
  do {
    flags = data.readUInt16BE(o);
    const start = o;
    o += 4 + (flags & 0x0001 ? 4 : 2);
    if (flags & 0x0008) o += 2; else if (flags & 0x0040) o += 4; else if (flags & 0x0080) o += 8;
    out.push({ gid: data.readUInt16BE(start + 2), at: start + 2, start, end: o });
  } while (flags & 0x0020);
  const instr = flags & 0x0100 ? data.subarray(o + 2, o + 2 + data.readUInt16BE(o)) : Buffer.alloc(0);
  return { list: out, instr };
}

// Every glyph the given glyphs need, composites expanded recursively; .notdef (0) is not included.
export function glyphClosure(font, gids) {
  const seen = new Set();
  const stack = gids.filter((g) => g > 0);
  while (stack.length) {
    const g = stack.pop();
    if (seen.has(g)) continue;
    seen.add(g);
    const comp = components(glyphData(font, g));
    if (comp) for (const c of comp.list) if (c.gid > 0 && !seen.has(c.gid)) stack.push(c.gid);
  }
  return seen;
}

// A glyph as geometry: contours and points of a simple glyph, or the component records (minus the
// glyph id) with each child flattened. Equal outlines mean the subset draws what the original draws.
export function outline(font, g) {
  const data = glyphData(font, g);
  if (!data.length) return { empty: true };
  const comp = components(data);
  if (comp) {
    return {
      components: comp.list.map((c) => ({ record: Buffer.concat([data.subarray(c.start, c.at), data.subarray(c.at + 2, c.end)]).toString('hex'), child: outline(font, c.gid) })),
      instructions: comp.instr.toString('hex'),
    };
  }
  const n = data.readInt16BE(0);
  const endPts = [];
  for (let i = 0; i < n; i++) endPts.push(data.readUInt16BE(10 + 2 * i));
  const count = endPts.length ? endPts[n - 1] + 1 : 0;
  let o = 10 + 2 * n;
  o += 2 + data.readUInt16BE(o);
  const flags = [];
  while (flags.length < count) {
    const f = data[o++];
    flags.push(f);
    if (f & 8) for (let r = data[o++]; r > 0; r--) flags.push(f);
  }
  const coords = (short, same) => {
    let v = 0;
    return flags.map((f) => {
      if (f & short) { const d = data[o++]; v += f & same ? d : -d; } else if (!(f & same)) { v += data.readInt16BE(o); o += 2; }
      return v;
    });
  };
  const xs = coords(2, 16), ys = coords(4, 32);
  return { endPts, points: flags.map((f, i) => [xs[i], ys[i], f & 1]) };
}

export const measure = (font, text, px) => {
  let w = 0;
  for (const ch of String(text)) w += font.advances[font.cmap.get(ch.codePointAt(0)) || 0];
  return (w / font.unitsPerEm) * px;
};

export const missingChars = (font, text) => [...new Set(String(text))].filter((ch) => !font.cmap.get(ch.codePointAt(0)));

// ---------- writing ----------

const pad4 = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);

function checksum(b) {
  const p = pad4(b);
  let s = 0;
  for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0;
  return s;
}

function cmapFormat4(pairs) {
  const segs = [];
  for (const [c, g] of pairs) {
    const last = segs[segs.length - 1];
    if (last && c === last.end + 1 && g === last.g0 + (c - last.start)) last.end = c;
    else segs.push({ start: c, end: c, g0: g });
  }
  segs.push({ start: 0xffff, end: 0xffff, g0: 0 });
  const n = segs.length, sr = 2 * 2 ** Math.floor(Math.log2(n));
  const len = 16 + 8 * n;
  const b = Buffer.alloc(len);
  b.writeUInt16BE(4, 0); b.writeUInt16BE(len, 2); b.writeUInt16BE(0, 4); b.writeUInt16BE(2 * n, 6);
  b.writeUInt16BE(sr, 8); b.writeUInt16BE(Math.log2(sr / 2), 10); b.writeUInt16BE(2 * n - sr, 12);
  segs.forEach((s, i) => {
    b.writeUInt16BE(s.end, 14 + 2 * i);
    b.writeUInt16BE(s.start, 16 + 2 * n + 2 * i);
    b.writeUInt16BE(s.start === 0xffff ? 1 : (s.g0 - s.start) & 0xffff, 16 + 4 * n + 2 * i);
  });
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0, 0); head.writeUInt16BE(1, 2); head.writeUInt16BE(3, 4); head.writeUInt16BE(1, 6); head.writeUInt32BE(12, 8);
  return Buffer.concat([head, b]);
}

// A standalone TrueType font holding .notdef, the glyphs `text` maps to and their components,
// renumbered; tables that index glyphs are rebuilt, shaping/signature tables are dropped.
export function subsetFont(font, text) {
  const chars = [...new Set(String(text))].map((c) => c.codePointAt(0)).filter((c) => c <= 0xfffe && font.cmap.get(c)).sort((a, b) => a - b);
  const keep = [0, ...[...glyphClosure(font, chars.map((c) => font.cmap.get(c)))].sort((a, b) => a - b)];
  const newId = new Map(keep.map((g, i) => [g, i]));
  const glyphs = [], loca = Buffer.alloc(4 * (keep.length + 1)), hmtx = Buffer.alloc(4 * keep.length);
  let off = 0;
  keep.forEach((g, i) => {
    const data = Buffer.from(glyphData(font, g));
    const comp = components(data);
    if (comp) for (const c of comp.list) data.writeUInt16BE(newId.get(c.gid), c.at);
    const padded = pad4(data);
    glyphs.push(padded);
    loca.writeUInt32BE(off, 4 * i);
    off += padded.length;
    hmtx.writeUInt16BE(font.advances[g], 4 * i);
    hmtx.writeInt16BE(font.lsbs[g], 4 * i + 2);
  });
  loca.writeUInt32BE(off, 4 * keep.length);
  const copy = (tag) => Buffer.from(font.tables.get(tag));
  const head = copy('head'); head.writeUInt32BE(0, 8); head.writeInt16BE(1, 50);
  const hhea = copy('hhea'); hhea.writeUInt16BE(keep.length, 34);
  const maxp = copy('maxp'); maxp.writeUInt16BE(keep.length, 4);
  const post = Buffer.from(font.tables.get('post').subarray(0, 32)); post.writeUInt32BE(0x00030000, 0);
  const out = new Map([
    ['head', head], ['hhea', hhea], ['maxp', maxp], ['post', post], ['hmtx', hmtx], ['loca', loca],
    ['glyf', Buffer.concat(glyphs)], ['cmap', cmapFormat4(chars.map((c) => [c, newId.get(font.cmap.get(c))]))],
  ]);
  for (const tag of ['OS/2', 'name', 'cvt ', 'fpgm', 'prep']) if (font.tables.has(tag)) out.set(tag, copy(tag));
  const tags = [...out.keys()].sort();
  const n = tags.length, sr = 16 * 2 ** Math.floor(Math.log2(n));
  const dir = Buffer.alloc(12 + 16 * n);
  dir.writeUInt32BE(0x00010000, 0); dir.writeUInt16BE(n, 4); dir.writeUInt16BE(sr, 6);
  dir.writeUInt16BE(Math.log2(sr / 16), 8); dir.writeUInt16BE(n * 16 - sr, 10);
  let at = dir.length;
  const body = [];
  tags.forEach((tag, i) => {
    const t = out.get(tag), r = 12 + 16 * i;
    dir.write(tag, r, 'latin1');
    dir.writeUInt32BE(checksum(t), r + 4);
    dir.writeUInt32BE(at, r + 8);
    dir.writeUInt32BE(t.length, r + 12);
    body.push(pad4(t));
    at += pad4(t).length;
  });
  const file = Buffer.concat([dir, ...body]);
  const headAt = dir.readUInt32BE(12 + 16 * tags.indexOf('head') + 8);
  file.writeUInt32BE((0xb1b0afba - checksum(file)) >>> 0, headAt + 8);
  return file;
}
