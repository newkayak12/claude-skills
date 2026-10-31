// write:diagram - the IR, its HTML renderer (shared with teams/mcp/diagram.mjs) and the static
// figure path (figure.mjs + font.mjs): self-contained SVG with an embedded NanumGothic subset + 2x PNG.
//   node --test write/skills/diagram/scripts/test-diagram.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as diagram from './diagram.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, '..');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const blocks = (file) => [...readFileSync(join(SKILL, 'references', file), 'utf8').matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
const scratch = () => mkdtempSync(join(tmpdir(), 'diagram-test-'));

// ---------- S1: the split keeps the HTML path byte-identical ----------

// render() HTML of each diagram-ir.md example, produced by the 5557180 script
// (develop/skills/architecture-designer/scripts/diagram.mjs before the split).
const BASELINE = {
  architecture: '8815a965f14b9166e3e82410e97121d1365cbb7f98fefec0824ee1b1e478c6de', // sha256
  sequence: '5c5776eb69831faff64e89e588dc6400165a28d80cff9da8022e4c9899f7738a', // sha256
};

test('render() HTML for every diagram-ir.md example is byte-identical to the pre-split script', () => {
  const irs = blocks('diagram-ir.md');
  assert.deepEqual(irs.map((ir) => ir.type), ['architecture', 'sequence']);
  for (const ir of irs) assert.equal(sha256(diagram.render(ir)), BASELINE[ir.type], ir.type);
});

test('diagram.mjs keeps its exports and its only static imports are node: builtins', () => {
  for (const k of ['TYPES', 'NODE_KINDS', 'EDGE_STYLES', 'validate', 'render', 'renderToFile']) assert.ok(k in diagram, k);
  assert.deepEqual(diagram.TYPES, ['architecture', 'dataflow', 'workflow', 'lifecycle', 'sequence']);
  const src = readFileSync(join(HERE, 'diagram.mjs'), 'utf8');
  const imports = src.split('\n').filter((l) => /^import /.test(l));
  assert.ok(imports.length > 0);
  for (const l of imports) assert.match(l, /from 'node:/, l);
  assert.match(src.split('\n').slice(0, 20).join('\n'), /write:diagram/);
  assert.match(src, /teams\/mcp\/diagram\.mjs/);
});

test('diagram.mjs alone in an empty directory validates and renders (the teams copy\'s situation)', async () => {
  const dir = scratch();
  try {
    copyFileSync(join(HERE, 'diagram.mjs'), join(dir, 'diagram.mjs'));
    const m = await import(pathToFileURL(join(dir, 'diagram.mjs')).href);
    const ir = blocks('diagram-ir.md')[0];
    assert.deepEqual(m.validate(ir), []);
    assert.match(m.render(ir), /<svg class="d"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- S2: font subset (font.mjs) ----------

test('subset round-trip: parses back, maps every character, glyph count = 1 + closure exactly, < 30 KB', async () => {
  const { loadFont, parseFont, subsetFont, glyphClosure } = await import('./font.mjs');
  const full = loadFont('Regular');
  const text = '한글 B-tree 페이지 16KB 값';
  const buf = subsetFont(full, text);
  const sub = parseFont(buf);
  const chars = [...new Set(text)];
  for (const c of chars) assert.ok(sub.cmap.get(c.codePointAt(0)) > 0, `subset maps ${c}`);
  const closure = glyphClosure(full, chars.map((c) => full.cmap.get(c.codePointAt(0))));
  assert.ok(!closure.has(0));
  assert.equal(sub.numGlyphs, 1 + closure.size);
  assert.ok(buf.length < 30 * 1024, `subset is ${buf.length} bytes`);
});

test('subset glyphs flatten to the same outlines and advances as the original (composite indices remapped)', async () => {
  const { loadFont, parseFont, subsetFont, outline, glyphClosure } = await import('./font.mjs');
  for (const weight of ['Regular', 'Bold']) {
    const full = loadFont(weight);
    // NanumGothic draws the 2,350 KS X 1001 syllables as simple glyphs and the other 8,822 as jamo
    // composites (갂 갃 갅 ... 똠); both kinds, sharing jamo, plus Latin, digits and punctuation.
    const text = '각간갇갈감갑값 한국어 페이지 값값 잠금 대기 B+tree (PK) 0-9:% 갂갃갅갆갋갌갍갎갏갘갞갟 똠똡';
    const sub = parseFont(subsetFont(full, text));
    let composites = 0;
    for (const c of new Set(text)) {
      const a = full.cmap.get(c.codePointAt(0)), b = sub.cmap.get(c.codePointAt(0));
      const oa = outline(full, a);
      if (oa.components) composites++;
      assert.deepEqual(outline(sub, b), oa, `${weight} ${c}`);
      assert.equal(sub.advances[b], full.advances[a], `${weight} advance of ${c}`);
    }
    assert.ok(composites >= 10, `${weight}: the string exercises composite glyphs (${composites})`);
    const gids = [...new Set(text)].map((c) => full.cmap.get(c.codePointAt(0)));
    assert.equal(sub.numGlyphs, 1 + glyphClosure(full, gids).size);
    assert.ok(glyphClosure(full, gids).size > new Set(gids).size, 'the closure adds the composites\' jamo components');
  }
});

// ---------- S2: the static path (figure.mjs) ----------

const fig = await import('./figure.mjs');
const BROWSER = fig.findBrowser();
const needsBrowser = { skip: !BROWSER && 'no Chrome-family browser (set CHROME=)' };
const CLI = join(HERE, 'diagram.mjs');
const { spawnSync } = await import('node:child_process');
const cli = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const svgSize = (svg) => svg.match(/<svg[^>]* width="(\d+)" height="(\d+)"/).slice(1).map(Number);

const KO_ARCH = {
  type: 'architecture', title: '주문 조회 경로',
  nodes: [
    { id: 'app', label: '웹 브라우저', kind: 'actor', row: 0, col: 0 },
    { id: 'api', label: '주문 API', sublabel: 'Node 22', row: 0, col: 1 },
    { id: 'db', label: 'PostgreSQL', kind: 'store', row: 1, col: 0 },
    { id: 'cache', label: 'Redis 캐시', kind: 'store', row: 1, col: 1 },
  ],
  edges: [
    { from: 'app', to: 'api', label: '조회' },
    { from: 'api', to: 'cache', label: '캐시 조회' },
    { from: 'api', to: 'db', label: '미스: SELECT', style: 'fail' },
    { from: 'db', to: 'cache', label: '채움', style: 'data' },
  ],
};
const ARCH3 = {
  type: 'architecture', title: '세 열 구성',
  nodes: [
    { id: 'a', label: '클라이언트', kind: 'actor', row: 0, col: 0 },
    { id: 'b', label: 'API 서버', row: 0, col: 1 },
    { id: 'c', label: 'MySQL 8.4', kind: 'store', row: 0, col: 2 },
  ],
  edges: [{ from: 'a', to: 'b', label: '요청' }, { from: 'b', to: 'c', label: '쿼리' }],
};
const SEQ4 = {
  type: 'sequence', title: '주문 트랜잭션',
  participants: [{ id: 'app', label: '앱', kind: 'actor' }, { id: 'api', label: '주문 API' }, { id: 'db', label: 'MySQL', kind: 'store' }, { id: 'mq', label: '메시지 큐', kind: 'queue' }],
  messages: [
    { from: 'app', to: 'api', label: 'POST /orders' },
    { from: 'api', to: 'db', label: 'BEGIN; INSERT' },
    { from: 'db', to: 'api', label: 'COMMIT 완료' },
    { from: 'api', to: 'mq', label: '주문 생성 이벤트', style: 'async' },
    { from: 'api', to: 'app', label: '201 Created' },
  ],
};

const T = (id, x, y, w, h, extra = {}) => ({ id, kind: 'text', text: id, size: 13, box: { x, y, w, h }, ...extra });
const B = (id, x, y, w, h, extra = {}) => ({ id, kind: 'shape', box: { x, y, w, h }, ...extra });
const E = (id, points, extra = {}) => ({ id, kind: 'edge', points, ...extra });
const CLEAN = [
  B('n1', 10, 10, 100, 40), T('label1', 20, 22, 60, 15, { owner: 'n1', within: 'n1', room: 80 }),
  B('n2', 200, 10, 100, 40), T('label2', 210, 22, 60, 15, { owner: 'n2', within: 'n2', room: 80 }),
  E('e1', [[114, 30], [196, 30]], { from: 'n1', to: 'n2' }), T('elabel', 130, 10, 40, 14, { owner: 'e1', room: 70 }),
  B('g', 0, 0, 320, 60, { container: true }),
];
const geo = (items) => fig.checkGeometry(items, { W: 320, H: 120, printWidth: 552 });

test('checkGeometry passes a clean item list', () => assert.deepEqual(geo(CLEAN), []));

test('checkGeometry (a) refuses a text overflowing the box it labels', () => {
  const errs = geo([...CLEAN.filter((i) => i.id !== 'label1'), T('label1', 20, 22, 95, 15, { owner: 'n1', within: 'n1' })]);
  assert.ok(errs.some((e) => /"label1" overflows its box n1/.test(e)), errs.join('\n'));
});

test('checkGeometry (b) refuses two text boxes that intersect', () => {
  const errs = geo([...CLEAN, T('other', 140, 15, 40, 14)]);
  assert.ok(errs.some((e) => /"elabel" and "other" overlap/.test(e)), errs.join('\n'));
});

test('checkGeometry (c) refuses a text over a shape it does not belong to', () => {
  const errs = geo([...CLEAN, T('stray', 205, 40, 30, 14)]);
  assert.ok(errs.some((e) => /"stray" sits over n2/.test(e)), errs.join('\n'));
});

test('checkGeometry (d) refuses an edge crossing a box that is not its endpoint', () => {
  const errs = geo([...CLEAN, B('n3', 140, 80, 40, 30), E('e2', [[60, 50], [60, 95], [250, 95], [250, 50]], { from: 'n1', to: 'n2' })]);
  assert.ok(errs.some((e) => /edge e2 passes through n3/.test(e)), errs.join('\n'));
});

test('checkGeometry (e) refuses anything outside the viewBox', () => {
  const errs = geo([...CLEAN, B('far', 300, 100, 40, 30)]);
  assert.ok(errs.some((e) => /far runs outside the figure/.test(e)), errs.join('\n'));
});

test('checkGeometry (f) refuses a label that would be cut with an ellipsis', () => {
  const errs = geo([...CLEAN.filter((i) => i.id !== 'elabel'), T('elabel', 120, 10, 76, 14, { owner: 'e1', room: 70 })]);
  assert.ok(errs.some((e) => /"elabel" needs 76 px but has 70 px/.test(e)), errs.join('\n'));
});

test('checkGeometry (g) refuses text printing below 7.5 pt at the 552 px book width', () => {
  const errs = fig.checkGeometry(CLEAN.map((i) => ({ ...i })), { W: 800, H: 120, printWidth: 552 });
  assert.ok(errs.some((e) => /prints at 6\.7 pt/.test(e)), errs.join('\n'));
  assert.deepEqual(fig.checkGeometry(CLEAN, { W: 552, H: 120, printWidth: 552 }), []);
});

test('checkGeometry (h) refuses an edge or arrowhead running over a text that is not its own label', () => {
  const errs = geo([...CLEAN, E('e3', [[150, 5], [150, 70]], { from: 'g', to: 'g' })]);
  assert.ok(errs.some((e) => /edge e3 runs over the text "elabel"/.test(e)), errs.join('\n'));
});

test('static palette: fills used together differ by >= 15 L*, every edge style has its own dash pattern', () => {
  const L = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
  };
  const fills = Object.values(fig.PALETTE.fills);
  assert.ok(fills.length >= 4);
  for (let i = 0; i < fills.length; i++) for (let j = i + 1; j < fills.length; j++)
    assert.ok(Math.abs(L(fills[i]) - L(fills[j])) >= 15, `${fills[i]} vs ${fills[j]}: ${L(fills[i]).toFixed(1)} / ${L(fills[j]).toFixed(1)}`);
  const dashes = Object.values(fig.PALETTE.edges).map((s) => s.dash);
  assert.equal(new Set(dashes).size, dashes.length);
});

// ---- colour roles (card 100): a light set and a dark set, text on every fill >= 4.5:1 ----
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const wcag = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const lstar = (hex) => { const y = lum(hex); return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y; };
const roleNames = ['cause', 'wait', 'release', 'context'];

test('colour roles: a light and a dark set each name lane hues A blue and B teal, cause, wait, release, context and a three-step ramp', () => {
  assert.deepEqual(Object.keys(fig.ROLES).sort(), ['dark', 'light']);
  for (const mode of ['light', 'dark']) {
    const set = fig.ROLES[mode];
    assert.equal(set.lanes.length, 2, `${mode} lanes`);
    assert.equal(set.ramp.length, 3, `${mode} ramp`);
    for (const r of [...set.lanes, ...roleNames.map((n) => set[n])]) for (const k of ['fill', 'stroke', 'ink']) assert.match(r[k], /^#[0-9a-f]{6}$/, `${mode} ${k}`);
    const hue = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; return mx === r ? (60 * (((g - b) / d) % 6) + 360) % 360 : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4); };
    assert.ok(hue(set.lanes[0].stroke) > 205 && hue(set.lanes[0].stroke) < 240, `${mode} lane A is blue`);
    assert.ok(hue(set.lanes[1].stroke) > 160 && hue(set.lanes[1].stroke) < 185, `${mode} lane B is teal`);
    assert.ok(hue(set.release.stroke) > 100 && hue(set.release.stroke) < 160, `${mode} release is green`);
    assert.ok(hue(set.wait.stroke) > 35 && hue(set.wait.stroke) < 50, `${mode} wait is amber`);
    assert.ok(hue(set.cause.stroke) < 15 || hue(set.cause.stroke) > 340, `${mode} cause is amber-red`);
  }
});

test('colour roles: text on every role fill and ramp step is >= 4.5:1, every stroke >= 3:1 on the surface, in both sets', () => {
  for (const mode of ['light', 'dark']) {
    const set = fig.ROLES[mode];
    for (const [name, r] of [['laneA', set.lanes[0]], ['laneB', set.lanes[1]], ...roleNames.map((n) => [n, set[n]])]) {
      assert.ok(wcag(r.ink, r.fill) >= 4.5, `${mode} ${name}: ink ${r.ink} on ${r.fill} is ${wcag(r.ink, r.fill).toFixed(2)}`);
      assert.ok(wcag(r.stroke, set.surface) >= 3, `${mode} ${name}: stroke ${r.stroke} on ${set.surface} is ${wcag(r.stroke, set.surface).toFixed(2)}`);
    }
    for (const n of [1, 2, 3, 4, 7, 12]) fig.rampSteps(mode, n).forEach((s, i) => assert.ok(wcag(s.ink, s.fill) >= 4.5, `${mode} ramp of ${n}, step ${i}: ${s.ink} on ${s.fill} is ${wcag(s.ink, s.fill).toFixed(2)}`));
    assert.ok(wcag(set.ink, set.surface) >= 4.5 && wcag(set.muted, set.surface) >= 4.5, `${mode} ink and muted text on the surface`);
  }
});

test('colour roles: the ramp runs strongest to lightest, a chain longer than three is interpolated between the same ends, three fills differ by >= 15 L*', () => {
  for (const mode of ['light', 'dark']) {
    const set = fig.ROLES[mode], dist = (s) => Math.abs(lstar(s.fill) - lstar(set.surface));
    const three = fig.rampSteps(mode, 3);
    assert.deepEqual(three.map((s) => s.fill), set.ramp.map((s) => s.fill));
    for (const n of [2, 3, 5, 9]) {
      const steps = fig.rampSteps(mode, n);
      assert.equal(steps.length, n);
      assert.equal(steps[0].fill, set.ramp[0].fill, 'the first step is the strongest ramp end');
      for (let i = 1; i < n; i++) assert.ok(dist(steps[i]) < dist(steps[i - 1]) - 1e-6, `${mode} n=${n}: step ${i} is lighter than step ${i - 1}`);
    }
    assert.equal(new Set(fig.rampSteps(mode, 9).map((s) => s.fill)).size, 9, 'interpolated steps are all different');
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(Math.abs(lstar(three[i].fill) - lstar(three[j].fill)) >= 15, `${mode} ramp ${i} vs ${j}`);
  }
});

test('colour roles: laneRole takes the lane hue by lane order and wraps past the second lane', () => {
  for (const mode of ['light', 'dark']) {
    assert.equal(fig.laneRole(mode, 0), fig.ROLES[mode].lanes[0]);
    assert.equal(fig.laneRole(mode, 1), fig.ROLES[mode].lanes[1]);
    assert.equal(fig.laneRole(mode, 2), fig.ROLES[mode].lanes[0]);
  }
});

test('a character NanumGothic lacks is refused at check time, naming it, and nothing is written', () => {
  const ir = { ...ARCH3, nodes: ARCH3.nodes.map((n) => (n.id === 'a' ? { ...n, label: '클라이언트 🙂' } : n)) };
  const errs = fig.checkFigure(ir);
  assert.ok(errs.some((e) => /🙂 \(U\+1F642\)/.test(e)), errs.join('\n'));
  const dir = scratch();
  try {
    const r = fig.writeFigure(ir, join(dir, 'x'));
    assert.equal(r.code, 1);
    assert.ok(!existsSync(join(dir, 'x.svg')) && !existsSync(join(dir, 'x.png')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('old types on the static path: Korean 2-column architecture, 3-column architecture and a 4-lane sequence pass unedited', () => {
  for (const ir of [KO_ARCH, ARCH3, SEQ4]) assert.deepEqual(fig.checkFigure(ir), [], ir.title);
  const wide = { ...ARCH3, nodes: [...ARCH3.nodes, { id: 'd', label: '복제본', kind: 'store', row: 0, col: 3 }], edges: [...ARCH3.edges, { from: 'c', to: 'd', label: '복제' }] };
  assert.ok(fig.checkFigure(wide).some((e) => /pt at the 552 px book width/.test(e)), 'four columns print too small');
});

test('figure CLI writes a self-contained SVG and a 2x PNG rasterized through an <img>', needsBrowser, () => {
  const dir = scratch();
  try {
    const irPath = join(dir, 'ko.json');
    writeFileSync(irPath, JSON.stringify(KO_ARCH));
    const r = cli(['figure', irPath, join(dir, 'ko')]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const svg = readFileSync(join(dir, 'ko.svg'), 'utf8');
    assert.match(svg, /@font-face\{font-family:'FigNanum'[^}]*data:font\/ttf;base64,/);
    assert.match(svg, /text\{font-family:'FigNanum'/);
    assert.doesNotMatch(svg, /font-family="(?!FigNanum)/);
    assert.doesNotMatch(svg, /<script|var\(--|href="http|url\((https?:|file:)/);
    assert.match(svg, /주문 API/);
    const [w, h] = svgSize(svg);
    assert.deepEqual(fig.pngSize(readFileSync(join(dir, 'ko.png'))), [2 * w, 2 * h]);
    const page = fig.rasterPage(join(dir, 'ko.svg'), w, h);
    assert.match(page, new RegExp(`<img src="${pathToFileURL(join(dir, 'ko.svg')).href}"`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('font-load proof: the PNG differs from the same SVG with its @font-face rules removed', needsBrowser, () => {
  const dir = scratch();
  try {
    assert.equal(fig.writeFigure(KO_ARCH, join(dir, 'a')).code, 0);
    const svg = readFileSync(join(dir, 'a.svg'), 'utf8');
    const stripped = svg.replace(/@font-face\{[^}]*\}/g, '');
    assert.notEqual(stripped, svg);
    writeFileSync(join(dir, 'b.svg'), stripped);
    const [w, h] = svgSize(svg);
    assert.equal(fig.rasterize(join(dir, 'b.svg'), w, h, join(dir, 'b.png')).code, 0);
    assert.notDeepEqual(fig.pngPixels(readFileSync(join(dir, 'a.png'))), fig.pngPixels(readFileSync(join(dir, 'b.png'))));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('pixel identity: the subset renders exactly like the full NanumGothic (Regular and Bold)', needsBrowser, async () => {
  const { loadFont, subsetFont } = await import('./font.mjs');
  const text = '한글 페이지 잠금 대기 갂갃갅갆 똠똡 B-tree 16KB (PK) 0-9:%';
  const dir = scratch();
  try {
    for (const weight of ['Regular', 'Bold']) {
      const full = readFileSync(join(SKILL, '..', 'tech-book', 'assets', 'fonts', `NanumGothic-${weight}.ttf`));
      const shots = [full, subsetFont(loadFont(weight), text)].map((font, i) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="40" viewBox="0 0 420 40"><style>@font-face{font-family:'F';src:url(data:font/ttf;base64,${font.toString('base64')}) format('truetype')}text{font-family:'F';font-kerning:none;font-variant-ligatures:none}</style><rect width="420" height="40" fill="#fff"/><text x="6" y="26" font-size="16">${text}</text></svg>`;
        const p = join(dir, `${weight}-${i}`);
        writeFileSync(`${p}.svg`, svg);
        assert.equal(fig.rasterize(`${p}.svg`, 420, 40, `${p}.png`).code, 0);
        return fig.pngPixels(readFileSync(`${p}.png`));
      });
      assert.ok(shots[0].equals(shots[1]), `${weight}: subset and full font render different pixels`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a refused figure writes neither file and leaves the previous good pair untouched', needsBrowser, () => {
  const dir = scratch();
  try {
    const base = join(dir, 'f');
    assert.equal(fig.writeFigure(KO_ARCH, base).code, 0);
    const before = [readFileSync(`${base}.svg`), readFileSync(`${base}.png`)].map(sha256);
    const bad = { ...KO_ARCH, nodes: KO_ARCH.nodes.map((n) => (n.id === 'app' ? { ...n, label: '아주 긴 이름을 가진 웹 브라우저 클라이언트 애플리케이션' } : n)) };
    const r = fig.writeFigure(bad, base);
    assert.equal(r.code, 1, r.msg);
    assert.deepEqual([readFileSync(`${base}.svg`), readFileSync(`${base}.png`)].map(sha256), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A node script standing in for Chrome: --dump-dom answers the viewport probe with the window minus a frame
// of (fw, fh) px (a full Chrome keeps 87 px of height; `fixedH` pins the viewport height whatever the window),
// --screenshot writes an RGB PNG of the window x 2 whose row i is filled with i % 256.
function fakeBrowser(dir, { fw = 0, fh = 0, fixedH = 0 } = {}) {
  const p = join(dir, `fake-chrome-${fw}-${fh}-${fixedH}`);
  writeFileSync(p, `#!${process.execPath}
const { writeFileSync } = require('node:fs'), z = require('node:zlib');
const a = process.argv.slice(2), [w, h] = a.find((x) => x.startsWith('--window-size=')).slice(14).split(',').map(Number);
if (a.includes('--dump-dom')) { console.log('<html><body>VP ' + (w - ${fw}) + 'x' + (${fixedH} || h - ${fh}) + '</body></html>'); process.exit(0); }
const shot = a.find((x) => x.startsWith('--screenshot='));
if (!shot) process.exit(1);
const W = 2 * w, H = 2 * h, rows = [];
for (let y = 0; y < H; y++) rows.push(Buffer.concat([Buffer.from([0]), Buffer.alloc(W * 3, y % 256)]));
const chunk = (t, d) => { const n = Buffer.alloc(4); n.writeUInt32BE(d.length); const b = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(z.crc32(b)); return Buffer.concat([n, b, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(shot.slice(13), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]));
`, { mode: 0o755 });
  return p;
}

test('rasterize: a viewport shorter than the window (full Chrome) is compensated, the PNG is exactly 2W x 2H with every row', () => {
  const dir = scratch();
  try {
    const out = join(dir, 'o.png');
    const r = fig.rasterize(join(dir, 'x.svg'), 300, 200, out, { CHROME: fakeBrowser(dir, { fh: 87 }) });
    assert.equal(r.code, 0, r.msg);
    const png = readFileSync(out);
    assert.deepEqual(fig.pngSize(png), [600, 400]);
    const raw = fig.pngPixels(png), stride = 1 + 600 * 3;
    assert.equal(raw.length, 400 * stride);
    assert.equal(raw[399 * stride + 1], 399 % 256, 'the last row is the figure\'s last row, not blank');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rasterize: a normal viewport passes unchanged; a viewport that cannot be enlarged is refused naming it, leaving no PNG', () => {
  const dir = scratch();
  try {
    const out = join(dir, 'o.png');
    assert.equal(fig.rasterize(join(dir, 'x.svg'), 300, 200, out, { CHROME: fakeBrowser(dir) }).code, 0);
    assert.deepEqual(fig.pngSize(readFileSync(out)), [600, 400]);
    rmSync(out);
    for (const [name, opts] of [['pinned height', { fixedH: 120 }], ['narrow width', { fw: 40 }]]) {
      const r = fig.rasterize(join(dir, 'x.svg'), 300, 200, out, { CHROME: fakeBrowser(dir, opts) });
      assert.equal(r.code, 1, name);
      assert.match(r.msg, /viewport is \d+x\d+ for a \d+x\d+ window/, name);
      assert.ok(!existsSync(out), `${name}: no PNG left`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rasterize with the real browser: a figure taller than a full Chrome\'s frame keeps its last rows (2W x 2H)', needsBrowser, () => {
  const dir = scratch();
  try {
    const r = fig.writeFigure(LOCKWAIT, join(dir, 't'));
    assert.equal(r.code, 0, r.msg);
    const [w, h] = svgSize(readFileSync(join(dir, 't.svg'), 'utf8'));
    const png = readFileSync(join(dir, 't.png'));
    assert.deepEqual(fig.pngSize(png), [2 * w, 2 * h]);
    const raw = fig.pngPixels(png), stride = 1 + 2 * w * (png[25] === 6 ? 4 : 3);
    // the rows a full Chrome used to leave blank: below the 87 px its frame takes off the window
    assert.ok(raw.subarray(2 * (h - 87) * stride).some((b, i) => i % stride !== 0 && b !== 255), 'the rows below the old crop line are not all white');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no browser: the SVG is written, the PNG is not, exit 3 with a CHROME= hint', () => {
  const dir = scratch();
  try {
    const irPath = join(dir, 'ko.json');
    writeFileSync(irPath, JSON.stringify(KO_ARCH));
    const r = cli(['figure', irPath, join(dir, 'ko')], { CHROME: '/nonexistent' });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stdout, /CHROME=/);
    assert.ok(existsSync(join(dir, 'ko.svg')) && !existsSync(join(dir, 'ko.png')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- S3: the book types ----------

// A passing IR: checkFigure is clean, and (browser present) figure writes an SVG that embeds the
// font and carries the Korean label, plus its PNG.
function expectPass(ir, korean, opts) {
  assert.deepEqual(fig.checkFigure(ir, opts), [], ir.title);
  if (!BROWSER) return null;
  const dir = scratch();
  try {
    const r = fig.writeFigure(ir, join(dir, 'f'), opts);
    assert.equal(r.code, 0, r.msg);
    const svg = readFileSync(join(dir, 'f.svg'), 'utf8');
    assert.match(svg, /data:font\/ttf;base64,/);
    assert.ok(svg.includes(korean), `svg holds ${korean}`);
    const [w, h] = svgSize(svg);
    assert.deepEqual(fig.pngSize(readFileSync(join(dir, 'f.png'))), [2 * w, 2 * h]);
    return svg;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
// A refused IR: every pattern matches a repair line, and nothing is written.
function expectRefused(ir, patterns, opts) {
  const errs = fig.checkFigure(ir, opts);
  for (const re of [].concat(patterns)) assert.ok(errs.some((e) => re.test(e)), `${re} not in:\n${errs.join('\n')}`);
  const dir = scratch();
  try {
    assert.equal(fig.writeFigure(ir, join(dir, 'f'), opts).code, 1);
    assert.deepEqual([existsSync(join(dir, 'f.svg')), existsSync(join(dir, 'f.png'))], [false, false]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const edit = (ir, fn) => { const c = clone(ir); fn(c); return c; };

// layout

const LAYOUT = {
  type: 'layout', title: 'InnoDB 페이지 구조', scale: 'schematic', claim: ['dir'],
  strips: [
    { id: 'page', label: '16KB 페이지', cells: [
      { id: 'fh', label: 'File Header', sublabel: '38 B', kind: 'meta' },
      { id: 'ph', label: 'Page Header', sublabel: '56 B', kind: 'meta' },
      { id: 'is', label: 'Infimum Supremum', sublabel: '26 B', kind: 'meta' },
      { id: 'rec', label: '사용자 레코드', kind: 'data' },
      { id: 'free', label: '빈 공간', kind: 'free' },
      { id: 'dir', label: '페이지 디렉터리', kind: 'meta' },
      { id: 'ft', label: 'File Trailer', sublabel: '8 B', kind: 'meta' },
    ] },
  ],
  pointers: [{ from: 'dir', to: 'rec', label: '슬롯이 레코드를 가리킴' }],
  marks: [{ strip: 'page', at: 'rec', label: '레코드 시작' }, { strip: 'page', at: 'dir', label: '디렉터리 시작' }],
};
const LAYOUT_BYTES = {
  type: 'layout', title: '행 헤더 바이트', scale: 'bytes', unit: 'B', claim: ['trx'],
  strips: [{ id: 'row', label: '행', total: 40, cells: [{ id: 'h', label: '헤더', size: 10 }, { id: 'trx', label: 'DB_TRX_ID', size: 12 }, { id: 'roll', label: 'ROLL_PTR', size: 18 }] }],
  marks: [{ strip: 'row', at: 10, label: '10' }, { strip: 'row', at: 22, label: '22' }],
};

test('layout passes: a schematic page (stamped not to scale) and a bytes strip drawn to size', () => {
  const svg = expectPass(LAYOUT, '사용자');
  if (svg) assert.match(svg, /축척 아님/);
  const bytes = expectPass(LAYOUT_BYTES, '헤더');
  if (bytes) assert.doesNotMatch(bytes, /축척 아님/);
});

test('layout refuses: bytes cell without size, sizes not summing to total, a bytes cell narrower than its label', () => {
  expectRefused(edit(LAYOUT_BYTES, (ir) => { delete ir.strips[0].cells[0].size; }), /cell h: give it a "size"/);
  expectRefused(edit(LAYOUT_BYTES, (ir) => { ir.strips[0].total = 48; }), /cell sizes sum to 40 but "total" is 48 - 8 B are missing/);
  expectRefused(edit(LAYOUT_BYTES, (ir) => { ir.strips[0].total = 400; ir.strips[0].cells[2].size = 378; }), /cell h is \d+ px wide at this scale but its label needs \d+ px - set "scale" to "schematic"/);
});

test('layout refuses: marks out of order, pointer to an unknown cell or without label, more than 4 strips', () => {
  expectRefused(edit(LAYOUT, (ir) => { ir.marks.reverse(); }), /marks of strip page are out of order/);
  expectRefused(edit(LAYOUT, (ir) => { ir.pointers[0].to = 'nope'; }), /pointers\[0\]: "to" must name a cell id \(got "nope"\)/);
  expectRefused(edit(LAYOUT, (ir) => { delete ir.pointers[0].label; }), /pointers\[0\]: add a "label"/);
  expectRefused(edit(LAYOUT, (ir) => { for (let i = 0; i < 4; i++) ir.strips.push({ id: `s${i}`, label: `s${i}`, cells: [{ id: `c${i}`, label: 'x' }] }); }), /5 strips .* keep it to 4/);
});

// tree

const BTREE = {
  type: 'tree', title: 'B-tree 탐색', ordered: true, roots: ['r'], claim: ['b'],
  nodes: [
    { id: 'r', keys: [20, 40], kind: 'internal' },
    { id: 'a', parent: 'r', keys: [5, 10], kind: 'leaf' },
    { id: 'b', parent: 'r', keys: [20, 30], kind: 'leaf' },
    { id: 'c', parent: 'r', keys: [40, 50], kind: 'leaf' },
  ],
  links: [{ from: 'a', to: 'b', both: true }, { from: 'b', to: 'c', both: true }],
};
const TWO_TREES = {
  type: 'tree', title: '보조 인덱스에서 클러스터드 인덱스로', ordered: true, roots: ['s', 'p'], claim: ['s1'],
  nodes: [
    { id: 's', label: '보조 인덱스 (name, id)', keys: [['kim', 7], ['park', 3]], kind: 'internal' },
    { id: 's1', parent: 's', keys: [['kim', 7], ['lee', 12]], kind: 'leaf' },
    { id: 's2', parent: 's', keys: [['park', 3], ['yoo', 9]], kind: 'leaf' },
    { id: 'p', label: '클러스터드 인덱스 (id)', keys: [1, 8], kind: 'internal' },
    { id: 'p1', parent: 'p', keys: [1, 3, 7], kind: 'leaf' },
    { id: 'p2', parent: 'p', keys: [8, 9, 12], kind: 'leaf' },
  ],
  links: [{ from: 's1', to: 'p', label: 'PK로 다시 찾기', style: 'async' }],
};
const PLAN = {
  type: 'tree', title: '실행 계획', ordered: false, roots: ['join'], claim: ['c'],
  nodes: [
    { id: 'join', label: 'Nested loop', kind: 'op' },
    { id: 'o', parent: 'join', label: 'orders 범위 스캔', kind: 'op' },
    { id: 'c', parent: 'join', label: 'customer PK 조회', kind: 'op' },
  ],
};

test('tree passes: a B-tree, a two-tree clustered + secondary figure with composite keys, and a plan tree', () => {
  expectPass(BTREE, 'B-tree 탐색');
  expectPass(TWO_TREES, 'PK로 다시 찾기');
  expectPass(PLAN, '범위 스캔');
});

test('tree refuses roots and shape: unlisted parentless node, zero roots, > 2 trees, unlabelled cross-tree link, unknown parent, cycle, depth > 6, > 7 on a level', () => {
  expectRefused(edit(BTREE, (ir) => { delete ir.nodes[1].parent; }), /node a has no parent but is not in "roots"/);
  expectRefused(edit(PLAN, (ir) => { ir.roots = []; }), /list the root node ids in "roots"/);
  expectRefused(edit(PLAN, (ir) => { ir.roots = ['join', 'o', 'c']; delete ir.nodes[1].parent; delete ir.nodes[2].parent; }), /at most 2 trees/);
  expectRefused(edit(TWO_TREES, (ir) => { delete ir.links[0].label; }), /links\[0\]: a link between two trees needs a "label"/);
  expectRefused(edit(PLAN, (ir) => { ir.nodes[1].parent = 'ghost'; }), /node o: "parent" must name a node id \(got "ghost"\)/);
  expectRefused(edit(PLAN, (ir) => { ir.nodes.push({ id: 'x', parent: 'y', label: 'x' }, { id: 'y', parent: 'x', label: 'y' }); }), /node x is in a parent cycle/);
  expectRefused(edit(PLAN, (ir) => { for (let i = 0; i < 5; i++) ir.nodes.push({ id: `d${i}`, parent: i ? `d${i - 1}` : 'o', label: `d${i}` }); }), /7 levels deep - keep it to 6/);
  expectRefused(edit(PLAN, (ir) => { for (let i = 0; i < 6; i++) ir.nodes.push({ id: `w${i}`, parent: 'join', label: `w${i}` }); }), /level 2 of tree join shows 8 nodes - keep it to 7/);
});

test('tree refuses ordered keys: not ascending, wrong key count, a child key outside its range (names child, key, bound), mixed kinds', () => {
  expectRefused(edit(BTREE, (ir) => { ir.nodes[1].keys = [10, 5]; }), /node a: keys are not ascending \(10 before 5\)/);
  expectRefused(edit(BTREE, (ir) => { ir.nodes[0].keys = [20]; }), /node r has 3 children but 1 keys - give it 2 \(separators\) or 3/);
  expectRefused(edit(BTREE, (ir) => { ir.nodes[2].keys = [20, 45]; }), /child b of r: key 45 is not < 40 \(its upper bound\)/);
  expectRefused(edit(BTREE, (ir) => { ir.nodes[3].keys = ['x', 'y']; }), /tree r mixes key kinds/);
  // InnoDB min-key pointers: n keys for n children, child i holds [k(i), k(i+1))
  expectPass(edit(BTREE, (ir) => { ir.nodes[0].keys = [5, 20, 40]; }), 'B-tree 탐색');
  expectRefused(edit(BTREE, (ir) => { ir.nodes[0].keys = [6, 20, 40]; }), /child a of r: key 5 is not >= 6 \(its lower bound\)/);
  expectRefused(edit(BTREE, (ir) => { ir.links[0] = { from: 'b', to: 'a' }; }), /leaf link b -> a runs right to left/);
});

// timeline

const LOCKWAIT = {
  type: 'timeline', title: '같은 재고 행을 두 세션이 갱신', claim: ['B@t3'], lanes: [{ id: 'A', label: '세션 A' }, { id: 'B', label: '세션 B' }],
  steps: [
    { t: 1, lane: 'A', label: 'BEGIN', kind: 'stmt' },
    { t: 1, lane: 'B', label: 'BEGIN', kind: 'stmt' },
    { t: 2, lane: 'A', label: 'UPDATE stock … id=1', kind: 'stmt' },
    { t: 3, lane: 'B', label: 'UPDATE stock … id=1', kind: 'stmt' },
    { t: 5, lane: 'A', label: 'COMMIT', kind: 'commit' },
    { t: 5, lane: 'B', label: '갱신 완료', kind: 'note' },
    { t: 6, lane: 'B', label: 'COMMIT', kind: 'commit' },
  ],
  waits: [{ lane: 'B', from: 3, until: 5, on: 'A', label: 'id=1 행 X 잠금 대기' }],
};
const DEADLOCK = {
  type: 'timeline', title: '교착 상태', claim: ['B@t6'], lanes: [{ id: 'A', label: '세션 A' }, { id: 'B', label: '세션 B' }],
  steps: [
    { t: 1, lane: 'A', label: 'UPDATE … id=1', kind: 'stmt' },
    { t: 2, lane: 'B', label: 'UPDATE … id=2', kind: 'stmt' },
    { t: 3, lane: 'A', label: 'UPDATE … id=2', kind: 'stmt' },
    { t: 4, lane: 'B', label: 'UPDATE … id=1', kind: 'stmt' },
    { t: 6, lane: 'B', label: 'ERROR 1213 Deadlock', kind: 'error' },
    { t: 7, lane: 'A', label: '갱신 완료', kind: 'note' },
  ],
  waits: [
    { lane: 'A', from: 3, until: 6, on: 'B', label: 'id=2 X 잠금 대기' },
    { lane: 'B', from: 4, until: 6, on: 'A', label: 'id=1 X 잠금 대기' },
  ],
};

test('timeline passes: a row-lock wait released by COMMIT, and a deadlock with its victim\'s error', () => {
  expectPass(LOCKWAIT, '잠금 대기');
  expectPass(DEADLOCK, '교착 상태');
});

test('timeline refuses: two steps at one (lane, t), a step inside a wait, a bad until, a wait cycle without deadlock, an unlabelled wait, a wait not from a stmt', () => {
  expectRefused(edit(LOCKWAIT, (ir) => { ir.steps.push({ t: 2, lane: 'A', label: 'SELECT 1', kind: 'stmt' }); }), /lane A has two steps at t=2/);
  expectRefused(edit(LOCKWAIT, (ir) => { ir.steps.push({ t: 4, lane: 'B', label: 'SELECT 1', kind: 'stmt' }); }), /lane B has a step at t=4 while it waits \(t=3\.\.5\)/);
  expectRefused(edit(LOCKWAIT, (ir) => { ir.waits[0].until = 6; }), /waits\[0\]: at t=6 lane A neither commits, rolls back nor errors, and lane B does not error/);
  expectRefused(edit(DEADLOCK, (ir) => { ir.steps[4].label = 'ERROR 1205 timeout'; }), /waits form a cycle \(A -> B -> A\)/);
  expectRefused(edit(LOCKWAIT, (ir) => { delete ir.waits[0].label; }), /waits\[0\]: add a "label"/);
  expectRefused(edit(LOCKWAIT, (ir) => { ir.waits[0].from = 1; ir.steps[0].kind = 'note'; ir.waits[0].lane = 'A'; ir.waits[0].on = 'B'; ir.waits[0].until = 6; }), /waits\[0\]: "from" t=1 must be a stmt step of lane A/);
});

// claim, holder, resume

// LOCKWAIT with the cause edge (A took the lock at t2) and the outcome after the wait.
const CAUSE = edit(LOCKWAIT, (ir) => {
  ir.claim = ['A@t2', 'B@t3'];
  ir.waits[0].holder = 2;
  ir.waits[0].resume = 'UPDATE 재개 · 0행';
});

test('claim: a book-type IR with no claim, an empty claim or an unknown claim id is refused with one repair line', () => {
  for (const ir of [LAYOUT, BTREE, LOCKWAIT, ER, CHART]) {
    const none = edit(ir, (c) => { delete c.claim; });
    assert.equal(fig.checkFigure(none).length, 1, ir.type);
    expectRefused(none, /add a top-level "claim"/);
    const empty = edit(ir, (c) => { c.claim = []; });
    assert.equal(fig.checkFigure(empty).length, 1, ir.type);
    expectRefused(empty, /"claim" is empty/);
    const bad = edit(ir, (c) => { c.claim = [...c.claim, 'nope']; });
    assert.equal(fig.checkFigure(bad).length, 1, ir.type);
    expectRefused(bad, /"claim" names "nope", which is no element of this/);
  }
  expectRefused(edit(LOCKWAIT, (c) => { c.claim = ['A@4']; }), /"claim" names "A@4"/);
  assert.deepEqual(fig.checkFigure(edit(LOCKWAIT, (c) => { c.claim = ['A@t5']; })), []);
});

test('claim: the check lives in figure.mjs - the grid types and diagram.mjs validate() need no claim', () => {
  assert.deepEqual(fig.checkFigure(STORE), []);
  assert.deepEqual(diagram.validate(KO_ARCH), []);
});

test('claim: elements in the claim draw in the accent fill with the heavy stroke, the rest stay muted', () => {
  const ACC = fig.PALETTE.fills.accent;
  const fills = (ir) => [...fig.renderFigure(ir).svg.matchAll(/<rect [^>]*fill="([^"]+)"[^>]*stroke-width="([^"]+)"/g)].filter((m) => m[1] === ACC).map((m) => m[2]);
  for (const ir of [LAYOUT, BTREE, PLAN, LOCKWAIT, BARS]) {
    const w = fills(ir);
    assert.ok(w.length >= 1, `${ir.type}: accent drawn`);
    assert.ok(w.every((x) => x === '2.5'), `${ir.type}: accent carries the heavy stroke`);
  }
  assert.ok(fig.renderFigure(ER).svg.includes(`fill="${ACC}"`));
  assert.ok(fig.renderFigure(CHART).svg.includes(`fill="${ACC}"`));
  assert.equal(fig.renderFigure(edit(LOCKWAIT, (c) => { c.claim = ['A@t1']; })).svg.split(`fill="${ACC}"`).length - 1, 1);
});

test('timeline refuses a holder that is not a stmt of the "on" lane, and a resume with no step after until', () => {
  expectPass(CAUSE, 'UPDATE 재개');
  expectRefused(edit(CAUSE, (ir) => { ir.waits[0].holder = 5; }), /waits\[0\]: "holder" t=5 must be a stmt step of lane A/);
  expectRefused(edit(CAUSE, (ir) => { ir.waits[0].holder = 9; }), /waits\[0\]: "holder" t=9 must be a stmt step of lane A/);
  expectRefused(edit(CAUSE, (ir) => { ir.waits[0].holder = 3; }), /waits\[0\]: "holder" t=3 must be a stmt step of lane A/);
  const noStep = edit(CAUSE, (ir) => { ir.steps = ir.steps.filter((s) => !(s.lane === 'B' && s.t > 5)); });
  assert.equal(fig.checkFigure(noStep).length, 1);
  expectRefused(noStep, /waits\[0\]: "resume" needs a step of lane B after t=5/);
});

test('timeline with a cause edge passes check; the svg has the accent line, the wait span and the resume text as given', () => {
  assert.deepEqual(fig.checkFigure(CAUSE), []);
  const { svg } = fig.renderFigure(CAUSE);
  const its = itemsOf(CAUSE);
  const cause = its.find((i) => i.id === 'cause 0'), span = its.find((i) => i.id === 'wait 0');
  assert.ok(cause && span);
  assert.equal(cause.from, 'step A@2');
  assert.equal(cause.to, 'step B@3');
  // card 100 U2: the cause edge is drawn in the cause role (amber-red), no longer the navy accent
  assert.ok(svg.includes(`stroke="${fig.ROLES.light.cause.stroke}" stroke-width="2.5" marker-end="url(#arrow-accent)"`));
  const from = its.find((i) => i.id === 'step B@3').box, resumeBox = its.find((i) => i.id === 'step B@6').box;
  assert.ok(span.box.h > 40 && Math.abs(span.box.y - (from.y + from.h)) < 0.5, 'the span runs down from the waiting statement');
  assert.ok(Math.abs(span.box.y + span.box.h - resumeBox.y) < 0.5, 'the span ends at the resume step (this wait names a resume)');
  assert.ok(svg.includes('>UPDATE 재개 · 0행</text>'));
  const rs = its.find((i) => i.kind === 'text' && i.text === 'UPDATE 재개 · 0행'), next = its.find((i) => i.id === 'step B@6').box;
  assert.ok(rs.box.x >= next.x + next.w && rs.box.y < next.y + next.h && rs.box.y + rs.box.h > next.y, 'drawn beside the resume step');
  // without holder and resume nothing is drawn for them
  const plain = fig.renderFigure(edit(CAUSE, (ir) => { delete ir.waits[0].holder; delete ir.waits[0].resume; })).svg;
  assert.ok(!plain.includes('arrow-accent') && !plain.includes('UPDATE 재개'));
});

// card 100: the cause edge through the lane gap, the span ending at the release box, the resume note

// Steps in both lanes sit in the rows between the holder (A@2) and the waiter (B@6).
const GAPPED = {
  type: 'timeline', title: '사이 행이 있는 잠금 대기', claim: ['A@t2', 'B@t6'], lanes: [{ id: 'A', label: '세션 A' }, { id: 'B', label: '세션 B' }],
  steps: [
    { t: 1, lane: 'A', label: 'BEGIN', kind: 'stmt' },
    { t: 1, lane: 'B', label: 'BEGIN', kind: 'stmt' },
    { t: 2, lane: 'A', label: 'UPDATE stock … id=1', kind: 'stmt' },
    { t: 3, lane: 'A', label: 'INSERT audit', kind: 'stmt' },
    { t: 3, lane: 'B', label: 'SELECT stock', kind: 'stmt' },
    { t: 4, lane: 'A', label: 'INSERT item', kind: 'stmt' },
    { t: 5, lane: 'B', label: 'INSERT log', kind: 'stmt' },
    { t: 6, lane: 'B', label: 'UPDATE stock … id=1', kind: 'stmt' },
    { t: 8, lane: 'A', label: 'COMMIT', kind: 'commit' },
    { t: 9, lane: 'B', label: 'COMMIT', kind: 'commit' },
  ],
  waits: [{ lane: 'B', from: 6, until: 8, on: 'A', holder: 2, label: 'id=1 행 X 잠금 대기' }],
};
// Two waits of B on A: both cause edges run through the one gap between lanes A and B.
const TWO_CAUSES = {
  type: 'timeline', title: '두 번 기다리는 세션 B', claim: ['A@t1', 'B@t6'], lanes: [{ id: 'A', label: '세션 A' }, { id: 'B', label: '세션 B' }],
  steps: [
    { t: 1, lane: 'A', label: 'UPDATE a', kind: 'stmt' },
    { t: 2, lane: 'B', label: 'UPDATE a', kind: 'stmt' },
    { t: 4, lane: 'A', label: 'COMMIT', kind: 'commit' },
    { t: 5, lane: 'A', label: 'UPDATE b', kind: 'stmt' },
    { t: 6, lane: 'B', label: 'UPDATE b', kind: 'stmt' },
    { t: 8, lane: 'A', label: 'COMMIT', kind: 'commit' },
    { t: 9, lane: 'B', label: 'COMMIT', kind: 'commit' },
  ],
  waits: [
    { lane: 'B', from: 2, until: 4, on: 'A', holder: 1, label: 'a 행 대기' },
    { lane: 'B', from: 6, until: 8, on: 'A', holder: 5, label: 'b 행 대기' },
  ],
};
// The rebuilt figure of card 100 (fig-13-1): a long resume note beside B's resume step.
const FIG131 = {
  type: 'timeline', title: '같은 재고 행을 갱신하는 두 세션: B는 A의 커밋까지 기다린다', claim: ['A@t4', 'B@t7', 'B@t10'],
  lanes: [{ id: 'A', label: '세션 A' }, { id: 'B', label: '세션 B' }],
  steps: [
    { t: 1, lane: 'A', label: 'START TRANSACTION', kind: 'stmt' },
    { t: 1, lane: 'B', label: 'START TRANSACTION', kind: 'stmt' },
    { t: 2, lane: 'B', label: 'SELECT 재고 → 2', kind: 'stmt' },
    { t: 3, lane: 'A', label: '주문 2002 삽입', kind: 'stmt' },
    { t: 4, lane: 'A', label: 'UPDATE 205 · X 잠금 획득', kind: 'stmt' },
    { t: 5, lane: 'A', label: '2002 항목 삽입', kind: 'stmt' },
    { t: 6, lane: 'B', label: '주문 2003 삽입', kind: 'stmt' },
    { t: 7, lane: 'B', label: 'UPDATE 205 (-2)', kind: 'stmt' },
    { t: 9, lane: 'A', label: 'COMMIT', kind: 'commit' },
    { t: 10, lane: 'B', label: 'UPDATE 재개 · 0행 (3.41 s)', kind: 'stmt' },
    { t: 11, lane: 'B', label: 'ROW_COUNT() → 0', kind: 'stmt' },
    { t: 12, lane: 'B', label: 'SELECT 재고 → 2', kind: 'stmt' },
    { t: 13, lane: 'B', label: 'ROLLBACK', kind: 'rollback' },
  ],
  waits: [{ lane: 'B', from: 7, until: 9, on: 'A', holder: 4, label: '205 행 X 잠금 대기', resume: 'A가 커밋한 재고로는 조건에 맞는 행이 없다' }],
};

// Does an axis-parallel or slanted segment p-q run through the inside of box b?
const hitsBox = (p, q, b, m = 1) => {
  for (let k = 0; k <= 200; k++) {
    const x = p[0] + ((q[0] - p[0]) * k) / 200, y = p[1] + ((q[1] - p[1]) * k) / 200;
    if (x > b.x + m && x < b.x + b.w - m && y > b.y + m && y < b.y + b.h - m) return true;
  }
  return false;
};

test('timeline cause edge: a right-angle polyline through the lane gap, crossing no step box, with steps in the rows between', () => {
  assert.deepEqual(fig.checkFigure(GAPPED), []);
  const its = itemsOf(GAPPED), cause = its.find((i) => i.id === 'cause 0');
  const p = cause.points;
  assert.equal(p.length, 4, 'out of the holder, down the gap, into the waiter');
  assert.equal(p[0][1], p[1][1], 'first leg is horizontal');
  assert.equal(p[1][0], p[2][0], 'second leg is vertical, down the gap');
  assert.equal(p[2][1], p[3][1], 'last leg is horizontal');
  assert.ok(p[2][1] > p[1][1], 'runs down from the holder row to the waiter row');
  const hb = its.find((i) => i.id === 'step A@2').box, wb = its.find((i) => i.id === 'step B@6').box;
  assert.ok(Math.abs(p[0][0] - (hb.x + hb.w)) < 4 && p[0][1] > hb.y && p[0][1] < hb.y + hb.h, 'leaves the holder box by its side');
  assert.ok(Math.abs(p[3][0] - wb.x) < 4 && p[3][1] > wb.y && p[3][1] < wb.y + wb.h, 'enters the waiter box by its side');
  const steps = its.filter((i) => /^step /.test(i.id) && i.kind === 'shape');
  assert.ok(steps.some((s) => s.box.y > hb.y + hb.h && s.box.y < wb.y), 'there are steps in the rows between holder and waiter');
  for (const [a, b] of [[p[0], p[1]], [p[1], p[2]], [p[2], p[3]]]) for (const s of steps) {
    if (s.id === 'step A@2' || s.id === 'step B@6') continue;
    assert.ok(!hitsBox(a, b, s.box), `the cause edge crosses ${s.id}`);
  }
  const gapL = Math.max(...steps.filter((s) => /^step A@[2-6]$/.test(s.id)).map((s) => s.box.x + s.box.w));
  const gapR = Math.min(...steps.filter((s) => /^step B@[3-6]$/.test(s.id)).map((s) => s.box.x));
  assert.ok(p[1][0] >= gapL && p[1][0] <= gapR, `the vertical leg x=${p[1][0]} lies in the gap ${gapL}..${gapR}`);
});

test('timeline cause edges that share one lane gap each get their own x', () => {
  assert.deepEqual(fig.checkFigure(TWO_CAUSES), []);
  const its = itemsOf(TWO_CAUSES), a = its.find((i) => i.id === 'cause 0').points, b = its.find((i) => i.id === 'cause 1').points;
  assert.equal(a.length, 4);
  assert.equal(b.length, 4);
  assert.ok(Math.abs(a[1][0] - b[1][0]) >= 3, `vertical legs at ${a[1][0]} and ${b[1][0]}`);
});

// Holders A@1 and A@2 with stmt labels about 255 px wide: the lane gap is a few px, so both edges used to run down x=337.
const NARROW_LABEL = 'UPDATE stock SET qty = qty - 1 WHERE id = ';
const NARROW = {
  type: 'timeline', title: 'narrow lane gap', claim: ['A@t1', 'B@t7'], lanes: [{ id: 'A', label: 'Session A' }, { id: 'B', label: 'Session B' }],
  steps: [
    { t: 1, lane: 'A', label: `${NARROW_LABEL}1`, kind: 'stmt' },
    { t: 2, lane: 'A', label: `${NARROW_LABEL}2`, kind: 'stmt' },
    { t: 3, lane: 'B', label: `${NARROW_LABEL}3`, kind: 'stmt' },
    { t: 5, lane: 'A', label: 'ROLLBACK', kind: 'rollback' },
    { t: 7, lane: 'B', label: `${NARROW_LABEL}4`, kind: 'stmt' },
    { t: 9, lane: 'A', label: 'COMMIT', kind: 'commit' },
  ],
  waits: [
    { lane: 'B', from: 3, until: 5, on: 'A', holder: 1, label: 'row 1 lock wait' },
    { lane: 'B', from: 7, until: 9, on: 'A', holder: 2, label: 'row 2 lock wait' },
  ],
};

test('timeline cause edges in a lane gap too narrow for the spread still run at distinct x, clear of every step box', () => {
  const its = itemsOf(NARROW), a = its.find((i) => i.id === 'cause 0').points, b = its.find((i) => i.id === 'cause 1').points;
  const wide = its.filter((i) => /^step /.test(i.id) && i.kind === 'shape').map((i) => i.box.w);
  assert.ok(Math.max(...wide) > 255, 'the stmt boxes are about 255 px wide, so the gap between the lanes is narrow');
  assert.ok(Math.abs(a[1][0] - b[1][0]) >= 3, `vertical legs at ${a[1][0]} and ${b[1][0]}`);
  const steps = its.filter((i) => /^step /.test(i.id) && i.kind === 'shape');
  for (const p of [a, b]) for (const s of steps) {
    if (s.id === 'step A@1' || s.id === 'step A@2' || s.id === 'step B@3' || s.id === 'step B@7') {
      assert.ok(!hitsBox(p[1], p[2], s.box), `a vertical leg runs through ${s.id}`);
    }
  }
  assert.deepEqual(fig.checkFigure(NARROW), []);
});

test('checkGeometry refuses two cause edges that run along the same line', () => {
  const edge = (id, x, y = 10) => ({ id, kind: 'edge', exclusive: true, points: [[x - 20, y], [x, y], [x, y + 70], [x + 20, y + 70]] });
  assert.deepEqual(geo([edge('cause 0', 100), edge('cause 1', 103, 20)]), []);
  assert.ok(geo([edge('cause 0', 100), edge('cause 1', 100.4, 20)]).some((e) => /cause 0 and cause 1 run along the same line/.test(e)));
  // lines that merely cross, or that only touch end to end, are not the same line
  const cross = { id: 'cause 2', kind: 'edge', exclusive: true, points: [[60, 40], [140, 40]] };
  assert.deepEqual(geo([edge('cause 0', 100), cross]), []);
});

test('timeline refuses a holder on a lane that is not next to the waiter,and a holder at or below the waiter\'s from row', () => {
  const three = edit(GAPPED, (ir) => {
    ir.lanes.push({ id: 'C', label: '세션 C' });
    ir.waits[0].lane = 'C'; ir.waits[0].on = 'A'; ir.claim = ['A@t2', 'C@t6'];
    ir.steps = ir.steps.filter((s) => s.lane !== 'B' || s.t === 1).concat([{ t: 6, lane: 'C', label: 'UPDATE stock … id=1', kind: 'stmt' }]);
  });
  expectRefused(three, /waits\[0\]: "holder" needs lane A and lane C to be adjacent/);
  expectPass(edit(three, (ir) => { delete ir.waits[0].holder; }), '세션 C');
  const same = edit(GAPPED, (ir) => { ir.steps.push({ t: 7, lane: 'A', label: 'UPDATE stock … id=2', kind: 'stmt' }); ir.waits[0].holder = 7; });
  expectRefused(same, /waits\[0\]: "holder" t=7 must come before "from" t=6/);
  const equal = edit(GAPPED, (ir) => { ir.steps.push({ t: 6, lane: 'A', label: 'UPDATE stock … id=2', kind: 'stmt' }); ir.waits[0].holder = 6; });
  expectRefused(equal, /waits\[0\]: "holder" t=6 must come before "from" t=6/);
});

test('timeline wait span ends at the top edge of the release step box, or the waiter\'s own box when the on lane has none', () => {
  for (const ir of [GAPPED, FIG131, TWO_CAUSES]) {
    const its = itemsOf(ir);
    ir.waits.forEach((w, i) => {
      // card 100: a wait that names a resume runs on to the resume step's top (the first step of the waiter after until)
      const span = its.find((x) => x.id === `wait ${i}`), resume = w.resume ? ir.steps.filter((s) => s.lane === w.lane && s.t > w.until).sort((a, b) => a.t - b.t)[0] : null;
      const rel = its.find((x) => x.id === (resume ? `step ${resume.lane}@${resume.t}` : `step ${w.on}@${w.until}`)).box;
      assert.ok(Math.abs(span.box.y + span.box.h - rel.y) < 0.01, `${ir.title}: wait ${i} ends at ${span.box.y + span.box.h}, release top is ${rel.y}`);
    });
  }
  // the waiter's own box wins nothing when the release box exists, even where the waiter has a taller step at until
  const own = edit(GAPPED, (ir) => { ir.steps.push({ t: 8, lane: 'B', label: '갱신을 마치고 나서 남기는 아주 긴 메모 한 줄을 두 줄로 나눠 적는다', kind: 'note' }); });
  const o = itemsOf(own), rel = o.find((x) => x.id === 'step A@8').box;
  assert.ok(Math.abs(o.find((x) => x.id === 'wait 0').box.y + o.find((x) => x.id === 'wait 0').box.h - rel.y) < 0.01);
  // a timeout: lane A has no step at until, so the span ends at the waiter's own error box
  const timeout = edit(GAPPED, (ir) => {
    ir.steps = ir.steps.filter((s) => !(s.lane === 'A' && s.t === 8));
    ir.steps = ir.steps.filter((s) => !(s.lane === 'B' && s.t === 9)).concat([{ t: 8, lane: 'B', label: 'ERROR 1205 시간 초과', kind: 'error' }]);
    ir.claim = ['A@t2', 'B@t8'];
  });
  assert.deepEqual(fig.checkFigure(timeout), []);
  const t = itemsOf(timeout), eb = t.find((x) => x.id === 'step B@8').box, sp = t.find((x) => x.id === 'wait 0').box;
  assert.ok(Math.abs(sp.y + sp.h - eb.y) < 0.01, `ends at ${sp.y + sp.h}, own box top ${eb.y}`);
});

test('timeline resume note: drawn right of its step, and no other step label in the lanes wraps when it fits on one line', () => {
  assert.deepEqual(fig.checkFigure(FIG131), []);
  const its = itemsOf(FIG131), LW0 = (640 - 48 - 34) / 2;
  for (const s of FIG131.steps) {
    const texts = its.filter((i) => i.kind === 'text' && i.owner === `step ${s.lane}@${s.t}`);
    assert.equal(texts.length, 1, `${s.lane}@t${s.t} "${s.label}" wrapped into ${texts.length} lines`);
    assert.ok(texts[0].box.w <= LW0 - 24, 'a label that fits the un-narrowed lane');
  }
  const note = its.find((i) => i.kind === 'text' && i.owner === 'wait 0' && i.text.startsWith('A가')), rs = its.find((i) => i.id === 'step B@10').box;
  assert.ok(note && note.box.x >= rs.x + rs.w, 'the note starts right of its step');
  const lines = its.filter((i) => i.kind === 'text' && i.owner === 'wait 0' && /커밋|조건|없다|재고로/.test(i.text) && i.box.x >= rs.x + rs.w);
  assert.ok(lines.length >= 1 && lines.every((l) => l.box.y < rs.y + 3 * 20 + rs.h), 'the note stays in the resume step\'s rows');
  // the other lane keeps its un-narrowed width: its header is centred on the plain lane middle
  const la = its.find((i) => i.id === 'lane A').box;
  assert.ok(Math.abs(la.x + la.w / 2 - (24 + 34 + LW0 / 2)) < 0.6, `lane A header centre ${la.x + la.w / 2}`);
});

// card 100: a short resume note in a 4-lane timeline whose resume lane has a full-width step box
const FOUR_LANES = {
  type: 'timeline', title: '네 세션이 같은 재고 행을 갱신한다', claim: ['A@t2', 'B@t5'],
  lanes: [{ id: 'A', label: '세션 A' }, { id: 'B', label: '세션 B' }, { id: 'C', label: '세션 C' }, { id: 'D', label: '세션 D' }],
  steps: [
    { t: 1, lane: 'A', label: 'START TRANSACTION', kind: 'stmt' },
    { t: 2, lane: 'A', label: 'UPDATE 재고 SET 수량 = 수량 - 2', kind: 'stmt' },
    { t: 3, lane: 'B', label: 'START TRANSACTION', kind: 'stmt' },
    { t: 4, lane: 'C', label: 'SELECT 재고 → 2', kind: 'stmt' },
    { t: 5, lane: 'B', label: 'UPDATE 재고 SET 수량 = 수량 - 2', kind: 'stmt' },
    { t: 7, lane: 'A', label: 'COMMIT', kind: 'commit' },
    { t: 8, lane: 'B', label: 'UPDATE 재고 SET 수량 = 수량 - 2', kind: 'stmt' },
    { t: 9, lane: 'D', label: 'SELECT 재고 → 0', kind: 'stmt' },
  ],
  waits: [{ lane: 'B', from: 5, until: 7, on: 'A', label: '205 행 X 잠금 대기', resume: 'UPDATE 재개 · 0행' }],
};

test('timeline 4 lanes: a short resume note beside a full-width step is drawn right of it, with no per-word refusal', () => {
  assert.deepEqual(fig.checkFigure(FOUR_LANES), []);
  const its = itemsOf(FOUR_LANES), rs = its.find((i) => i.id === 'step B@8').box;
  const note = its.filter((i) => i.kind === 'text' && i.owner === 'wait 0' && /재개|0행|UPDATE/.test(i.text));
  assert.ok(note.length >= 1 && note.every((t) => t.box.x >= rs.x + rs.w), 'the note is right of its step');
  // all lanes keep the same width: the other lane headers stay on their plain lane middles
  const LW0 = (640 - 48 - 34) / 4;
  [0, 2, 3].forEach((k) => { const h = its.find((i) => i.id === `lane ${'ABCD'[k]}`).box; assert.ok(Math.abs(h.x + h.w / 2 - (24 + 34 + k * LW0 + LW0 / 2)) < 0.6, `lane ${'ABCD'[k]}`); });
});

test('timeline 4 lanes: when the note cannot run on past its lane either, check gives one message that names the resume note', () => {
  const blocked = edit(FOUR_LANES, (ir) => { ir.steps.push({ t: 8, lane: 'C', label: 'SELECT 재고 → 0', kind: 'stmt' }); });
  const errs = fig.checkFigure(blocked);
  assert.equal(errs.length, 1, errs.join('\n'));
  assert.match(errs[0], /the resume note "UPDATE 재개 · 0행" needs \d+ px but has \d+ px/);
});

// er

const ER = {
  type: 'er', title: '주문 스키마', level: 'physical', claim: ['item'],
  entities: [
    { id: 'customer', label: '고객', row: 0, col: 0, attrs: [{ name: 'id', type: 'BIGINT', pk: true }, { name: 'name', type: 'VARCHAR(50)' }] },
    { id: 'orders', label: '주문', row: 0, col: 1, attrs: [{ name: 'id', type: 'BIGINT', pk: true }, { name: 'customer_id', type: 'BIGINT', fk: 'customer.id' }, { name: 'ordered_at', type: 'DATETIME' }] },
    { id: 'item', label: '주문 항목', row: 0, col: 2, attrs: [{ name: 'order_id', type: 'BIGINT', pk: true, fk: 'orders.id' }, { name: 'book_id', type: 'BIGINT', pk: true, fk: 'book.id' }, { name: 'qty', type: 'INT' }] },
    { id: 'book', label: '도서', row: 1, col: 2, attrs: [{ name: 'id', type: 'BIGINT', pk: true }, { name: 'title', type: 'VARCHAR(200)' }, { name: 'stock', type: 'INT' }] },
  ],
  rels: [
    { from: 'customer', to: 'orders', card: '1:N', label: '주문한다' },
    { from: 'orders', to: 'item', card: '1:N', label: '담는다' },
    { from: 'book', to: 'item', card: '1:N' },
  ],
};

test('er passes: a physical order schema with a junction entity and crow\'s-foot relations', () => {
  expectPass(ER, '주문 항목');
});

test('er refuses: no pk, fk to a missing or non-key target, physical N:M, fk on the 1-side, > 12 attrs, two in one cell, an island', () => {
  expectRefused(edit(ER, (ir) => { ir.entities[0].attrs[0].pk = false; }), /entity customer: mark its primary key/);
  expectRefused(edit(ER, (ir) => { ir.entities[1].attrs[1].fk = 'client.id'; }), /"fk" names client\.id, which does not exist/);
  expectRefused(edit(ER, (ir) => { ir.entities[1].attrs[1].fk = 'customer.name'; }), /"fk" points at customer\.name, which is not a key/);
  expectRefused(edit(ER, (ir) => { ir.rels.push({ from: 'customer', to: 'book', card: 'N:M' }); }), /rels\[3\]: a physical model has no N:M - add a junction entity/);
  expectRefused(edit(ER, (ir) => { ir.rels[0] = { from: 'orders', to: 'customer', card: '1:N' }; }), /the foreign key orders\.customer_id sits on the 1 side of orders 1:N customer/);
  expectRefused(edit(ER, (ir) => { for (let i = 0; i < 11; i++) ir.entities[0].attrs.push({ name: `c${i}` }); }), /entity customer has 13 attributes - keep it to 12/);
  expectRefused(edit(ER, (ir) => { ir.entities[3].row = 0; ir.entities[3].col = 1; }), /entities orders and book both sit at row 0, col 1/);
  expectRefused(edit(ER, (ir) => { ir.entities.push({ id: 'log', label: '로그', row: 1, col: 0, attrs: [{ name: 'id', pk: true }] }); }), /entity log has no relation/);
});

test('er: a logical model may draw N:M directly; the same relation at physical level is refused', () => {
  const ir = {
    type: 'er', title: '저자와 도서', level: 'logical', claim: ['author'],
    entities: [
      { id: 'author', label: '저자', row: 0, col: 0, attrs: [{ name: '저자 번호', pk: true }, { name: '이름' }] },
      { id: 'book', label: '도서', row: 0, col: 1, attrs: [{ name: 'ISBN', pk: true }, { name: '제목' }] },
    ],
    rels: [{ from: 'author', to: 'book', card: 'N:M', label: '쓴다' }],
  };
  expectPass(ir, '쓴다');
  expectRefused(edit(ir, (c) => { c.level = 'physical'; }), /a physical model has no N:M/);
});

// chart

const CHART = {
  type: 'chart', title: '인덱스 전후 응답 시간', mark: 'dot', illustrative: true, claim: ['runs'],
  x: { label: '조건', categories: ['인덱스 전', '인덱스 후'] },
  y: { label: '응답 시간', unit: 'ms' },
  series: [{ id: 'runs', label: '5회 반복', points: [
    { x: '인덱스 전', y: 120 }, { x: '인덱스 전', y: 131 }, { x: '인덱스 전', y: 118 }, { x: '인덱스 전', y: 140 }, { x: '인덱스 전', y: 125 },
    { x: '인덱스 후', y: 12.3 }, { x: '인덱스 후', y: 11.8 }, { x: '인덱스 후', y: 13.1 }, { x: '인덱스 후', y: 12.0 }, { x: '인덱스 후', y: 12.6 },
  ] }],
};
const BARS = {
  type: 'chart', title: '버퍼 풀 적중률', mark: 'bar', illustrative: true, claim: ['hit'],
  x: { label: '설정', categories: ['128MB', '1GB'] }, y: { label: '적중률', unit: '%' },
  series: [{ id: 'hit', label: '적중률', points: [{ x: '128MB', y: 71, lo: 68, hi: 74 }, { x: '1GB', y: 97, lo: 96, hi: 98 }] }],
};

test('chart passes: an illustrative dot chart (stamped, median drawn by the renderer) and a bar chart from 0', () => {
  const svg = expectPass(CHART, '응답 시간');
  if (svg) { assert.match(svg, /예시 값/); assert.match(svg, /중앙값 12\.3/); assert.match(svg, /중앙값 125/); }
  expectPass(BARS, '적중률');
});

test('chart reads its source: a plotted y must be a number in the file, compared numerically (12.3 = 12.30)', () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'runs.csv'), 'run,before_ms,after_ms\n1,120,12.30\n2,131,11.80\n3,118,13.10\n4,140,12.00\n5,125,12.60\n');
    const ir = edit(CHART, (c) => { delete c.illustrative; c.source = 'runs.csv'; });
    const svg = expectPass(ir, '응답 시간', { baseDir: dir });
    if (svg) assert.doesNotMatch(svg, /예시 값/);
    expectRefused(edit(ir, (c) => { c.series[0].points[5].y = 12.7; }), /series runs: y 12\.7 is not a number in runs\.csv/, { baseDir: dir });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('chart refuses: no y unit, bar not from 0, lo/hi not bracketing y, > 6 series, no source and not illustrative, a supplied median', () => {
  expectRefused(edit(CHART, (c) => { delete c.y.unit; }), /y: give the axis a "unit"/);
  expectRefused(edit(BARS, (c) => { c.y.min = 50; }), /a bar chart's y axis starts at 0 \(got min 50\)/);
  expectRefused(edit(BARS, (c) => { c.series[0].points[0].lo = 72; }), /series hit, x 128MB: lo\/hi \(72\.\.74\) must bracket y \(71\)/);
  expectRefused(edit(BARS, (c) => { for (let i = 0; i < 6; i++) c.series.push({ id: `s${i}`, label: `s${i}`, points: [{ x: '1GB', y: 50 }] }); }), /7 series .* keep it to 6/);
  expectRefused(edit(CHART, (c) => { delete c.illustrative; }), /set "source" .* or "illustrative": true/);
  expectRefused(edit(CHART, (c) => { c.series[0].median = 12; }), /series runs: drop "median"/);
});

test('figures.md: every example passes check and figure', () => {
  const irs = blocks('figures.md');
  assert.deepEqual([...new Set(irs.map((ir) => ir.type))].sort(), ['chart', 'er', 'layout', 'timeline', 'tree']);
  for (const ir of irs) expectPass(ir, ir.title);
});

test('the CLI reaches the book types: check and render go through figure.mjs; validate() still knows only the five', () => {
  const dir = scratch();
  try {
    const p = join(dir, 'l.json');
    writeFileSync(p, JSON.stringify(LAYOUT));
    assert.equal(cli(['check', p]).stdout, 'ok\n');
    const r = cli(['render', p, join(dir, 'l.html')]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(readFileSync(join(dir, 'l.html'), 'utf8'), /<svg xmlns[\s\S]*사용자/);
    writeFileSync(p, JSON.stringify(edit(LAYOUT, (ir) => { ir.marks.reverse(); })));
    const bad = cli(['check', p]);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /out of order/);
    assert.match(diagram.validate(LAYOUT)[0], /set "type" to one of architecture, dataflow, workflow, lifecycle, sequence/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------- S5: fixes from the MySQL real run (friction.md) ----------

const itemsOf = (ir, opts) => fig.figureItems(ir, opts);

test('checkGeometry (h) also refuses a label crossing its own line', () => {
  const e = E('e1', [[0, 0], [100, 60]]), t = T('lbl', 40, 20, 30, 14, { owner: 'e1' });
  assert.ok(geo([e, t]).some((m) => /edge e1 runs over the text "lbl"/.test(m)), geo([e, t]).join('\n'));
});

test('a diagonal edge label sits beside its line, off it (tree cross-link, grid edge)', () => {
  const its = itemsOf(TWO_TREES);
  const link = its.find((i) => i.id === 'link 0'), lbl = its.find((i) => i.kind === 'text' && i.owner === 'link 0');
  assert.ok(link && lbl);
  assert.deepEqual(fig.checkGeometry([link, lbl], { W: 4000, H: 4000, printWidth: 4000 }), []);
  const grid = { type: 'architecture', title: '대각선', nodes: [{ id: 'a', label: 'A', row: 0, col: 0 }, { id: 'b', label: 'B', row: 1, col: 1 }, { id: 'c', label: 'C', row: 2, col: 0 }], edges: [{ from: 'a', to: 'b', label: 'PK 1042' }, { from: 'b', to: 'c', label: '다시 탐색' }] };
  assert.deepEqual(fig.checkFigure(grid), []);
});

const STORE = {
  type: 'architecture', title: '저장소',
  nodes: [{ id: 'app', label: '앱', row: 0, col: 0 }, { id: 'db', label: '공유 메모리', sublabel: 'shared_buffers · WAL', kind: 'store', row: 0, col: 1 }],
  edges: [{ from: 'app', to: 'db' }],
};

test('a store\'s text sits below the cylinder\'s top arc, and the check sees the arc', () => {
  assert.deepEqual(fig.checkFigure(STORE), []);
  const its = itemsOf(STORE);
  const arcs = its.filter((i) => i.kind === 'edge' && i.owner === 'db');
  assert.ok(arcs.length, 'the cylinder arc is a checked line');
  const texts = its.filter((i) => i.kind === 'text' && i.owner === 'db');
  assert.equal(texts.length, 2);
  assert.deepEqual(fig.checkGeometry([...arcs, ...texts], { W: 4000, H: 4000, printWidth: 4000 }), []);
  expectRefused(edit(STORE, (c) => { c.nodes[1].label = '아주 긴 저장소 이름이 두 줄로'; }), /runs over the text/);
});

test('timeline: the lifeline is checked as a line and does not run through a note\'s text', () => {
  const its = itemsOf(LOCKWAIT);
  const life = its.filter((i) => i.kind === 'edge' && /^lifeline B/.test(i.id));
  assert.ok(life.length, 'lane B\'s lifeline is a checked line');
  const note = its.find((i) => i.kind === 'text' && i.text === '갱신 완료');
  assert.deepEqual(fig.checkGeometry([...life, note], { W: 4000, H: 4000, printWidth: 4000 }), []);
  assert.deepEqual(fig.checkFigure(LOCKWAIT), []);
});

test('style layer: a timeline svg has one rx, two shape stroke widths and three text sizes at most; the accent is the darkest fill', () => {
  const { svg } = fig.renderFigure(DEADLOCK);
  const rects = [...svg.matchAll(/<rect [^>]*\/>/g)].map((m) => m[0]).filter((r) => /stroke-width=/.test(r));
  assert.ok(rects.length >= 4);
  assert.equal(new Set(rects.map((r) => /rx="([^"]+)"/.exec(r)[1])).size, 1);
  assert.equal(new Set(rects.map((r) => /stroke-width="([^"]+)"/.exec(r)[1])).size, 2);
  const sizes = new Set([...svg.matchAll(/<text [^>]*font-size="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(sizes.size <= 3, [...sizes].join(','));
  const Y = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((a, v, k) => a + v * [0.2126, 0.7152, 0.0722][k], 0);
  const { accent, ...rest } = fig.PALETTE.fills;
  assert.ok(Object.values(rest).every((h) => Y(h) > Y(accent)), 'accent is the darkest fill');
});

test('style layer: every figure type draws well-formed attributes and one rx on all rects that carry one', () => {
  for (const ir of [DEADLOCK, LAYOUT, BTREE, ER, CHART, BARS, PLAN, KO_ARCH]) {
    const { svg } = fig.renderFigure(ir);
    assert.ok(!/"[a-z-]+="/.test(svg.replace(/>[^<]*</g, '><')), `${ir.type}: attribute glued to the previous one`);
    const rx = new Set([...svg.matchAll(/<rect [^>]*\brx="([^"]+)"/g)].map((m) => m[1]));
    assert.ok(rx.size <= 1, `${ir.type}: rx ${[...rx].join(',')}`);
  }
});

test('style layer: timeline steps and lane headers are sized to their text, never the lane width', () => {
  const ir = edit(LOCKWAIT, (c) => { c.steps[2].label = 'UPDATE stock SET qty = qty - 1'; c.steps[3].label = 'UPDATE'; });
  const its = itemsOf(ir), LW = (640 - 48 - 34) / 2;
  const w = (id) => its.find((i) => i.id === id).box.w;
  const long = w('step A@2'), short = w('step B@3');
  assert.ok(long > short + 20, `${long} vs ${short}`);
  for (const i of its.filter((i) => /^(step|lane) /.test(i.id) && i.box)) assert.ok(i.box.w < LW, `${i.id} is ${i.box.w} wide`);
  assert.ok(w('lane A') < LW - 12);
});

test('chart: a median label that would clip at the right edge goes left (2 series x 3 categories)', () => {
  const ir = {
    type: 'chart', title: '읽기와 쓰기', mark: 'dot', illustrative: true, claim: ['write'],
    x: { label: '변형', categories: ['A1 인덱스 없음', 'B 인덱스', 'A2 인덱스 없음'] }, y: { label: '실행 시간', unit: 'µs', min: 0 },
    series: [
      { id: 'read', label: '읽기', points: [{ x: 'A1 인덱스 없음', y: 1630, lo: 1609, hi: 1662 }, { x: 'B 인덱스', y: 764, lo: 751, hi: 844 }, { x: 'A2 인덱스 없음', y: 1509, lo: 1505, hi: 1534 }] },
      { id: 'write', label: '쓰기', points: [{ x: 'A1 인덱스 없음', y: 4673, lo: 4506, hi: 5080 }, { x: 'B 인덱스', y: 5376, lo: 5010, hi: 5542 }, { x: 'A2 인덱스 없음', y: 4125, lo: 3766, hi: 4307 }] },
    ],
  };
  assert.deepEqual(fig.checkFigure(ir), []);
  const t = itemsOf(ir).find((i) => i.kind === 'text' && i.text === '중앙값 4125');
  assert.ok(t.box.x + t.box.w <= 600 - 24);
});

test('legend renames the style keys; a key no edge uses, or an empty label, is refused', () => {
  const ir = edit(KO_ARCH, (c) => { c.legend = { sync: '요청', fail: '미스', data: '채움' }; });
  assert.deepEqual(fig.checkFigure(ir), []);
  const { svg } = fig.renderFigure(ir);
  for (const s of ['요청', '미스', '채움']) assert.ok(svg.includes(`>${s}</text>`), s);
  assert.doesNotMatch(svg, />(sync|fail|data)<\/text>/);
  assert.match(diagram.render(ir), /<\/svg>요청<\/span>/);
  expectRefused(edit(KO_ARCH, (c) => { c.legend = { async: '붙음' }; }), /legend: "async" is not a style any edge uses/);
  expectRefused(edit(KO_ARCH, (c) => { c.legend = { sync: '' }; }), /legend\.sync: give it a label/);
});

// er: per-end optionality (card "<end>:<end>", end = 1 | 0..1 | 0..* | 1..*) and the UK marker

const ER_OPT = {
  type: 'er', title: '서점 다중성', level: 'logical', claim: ['book'],
  entities: [
    { id: 'customer', label: '고객', row: 0, col: 0, attrs: [{ name: '고객번호', pk: true }, { name: '이메일', unique: true }] },
    { id: 'order', label: '주문', row: 0, col: 1, attrs: [{ name: '주문번호', pk: true }, { name: '고객번호', fk: 'customer.고객번호' }] },
    { id: 'item', label: '주문항목', row: 0, col: 2, attrs: [{ name: '주문번호', pk: true, fk: 'order.주문번호' }, { name: '도서번호', pk: true, fk: 'book.도서번호' }] },
    { id: 'stock', label: '재고', row: 1, col: 1, attrs: [{ name: '도서번호', pk: true, fk: 'book.도서번호' }] },
    { id: 'book', label: '도서', row: 1, col: 2, attrs: [{ name: '도서번호', pk: true }] },
  ],
  rels: [
    { from: 'customer', to: 'order', card: '1:0..*', label: '제출한다' },
    { from: 'order', to: 'item', card: '1:1..*', label: '가진다' },
    { from: 'book', to: 'item', card: '1:0..*' },
    { from: 'book', to: 'stock', card: '1:0..1', label: '재고 기록' },
  ],
};
// the marks drawn at one end of a relation, by part (bar, circle, foot), with their distance from the entity
function endMarks(its, rel, ent) {
  const box = its.find((i) => i.kind === 'shape' && i.id === ent).box;
  const cx = (b) => [b.x + b.w / 2, b.y + b.h / 2];
  const gap = (b) => { const [x, y] = cx(b); return Math.hypot(Math.max(box.x - x, 0, x - box.x - box.w), Math.max(box.y - y, 0, y - box.y - box.h)); };
  return its.filter((i) => i.kind === 'shape' && i.mark && i.id.startsWith(`end ${rel} ${ent} `))
    .map((i) => ({ part: i.id.split(' ').pop().replace(/\d+$/, ''), d: gap(i.box), box: i.box }));
}
const parts = (ms) => ms.map((m) => m.part).sort().join(',');

test('er draws crow\'s-foot optionality per end: || = 1, o| = 0..1, |< = 1..*, o< = 0..* (circle outermost)', () => {
  assert.deepEqual(fig.checkFigure(ER_OPT), []);
  const its = itemsOf(ER_OPT);
  const at = (rel, ent) => endMarks(its, rel, ent);
  assert.equal(parts(at('rel customer-order', 'customer')), 'bar,bar');
  assert.equal(parts(at('rel customer-order', 'order')), 'circle,foot');
  assert.equal(parts(at('rel order-item', 'item')), 'bar,foot');
  assert.equal(parts(at('rel book-stock', 'stock')), 'bar,circle');
  assert.equal(parts(at('rel book-stock', 'book')), 'bar,bar');
  for (const [rel, ent] of [['rel customer-order', 'order'], ['rel book-stock', 'stock'], ['rel book-item', 'item']]) {
    const ms = at(rel, ent), circle = ms.find((m) => m.part === 'circle'), inner = ms.find((m) => m.part !== 'circle');
    assert.ok(circle.d > inner.d + 3, `${rel} at ${ent}: the circle sits outside the bar/foot (${circle.d} vs ${inner.d})`);
    assert.ok(circle.d < 30, `${rel} at ${ent}: the circle stays at its own end`);
  }
  const marks = its.filter((i) => i.kind === 'shape' && i.mark && i.id.startsWith('end ')), texts = its.filter((i) => i.kind === 'text');
  for (const m of marks) for (const t of texts) {
    const o = m.box.x < t.box.x + t.box.w && t.box.x < m.box.x + m.box.w && m.box.y < t.box.y + t.box.h && t.box.y < m.box.y + m.box.h;
    assert.ok(!o, `${m.id} overlaps "${t.text}"`);
  }
});

test('er: a label on a crow\'s-foot mark is refused (the marks are checked shapes)', () => {
  const its = itemsOf(ER_OPT), c = its.find((i) => i.id === 'end rel customer-order order circle');
  assert.ok(c);
  const errs = fig.checkGeometry([c, T('lbl', c.box.x, c.box.y, 20, 14, { owner: 'rel customer-order' })], { W: 4000, H: 4000, printWidth: 4000 });
  assert.ok(errs.some((e) => /"lbl" sits over end rel customer-order order circle/.test(e)), errs.join('\n'));
});

test('er: legacy 1:1 / 1:N / N:M draw as before (|| and a bare foot, no circle)', () => {
  const its = itemsOf(ER);
  assert.equal(parts(endMarks(its, 'rel customer-orders', 'customer')), 'bar,bar');
  assert.equal(parts(endMarks(its, 'rel customer-orders', 'orders')), 'foot');
});

test('er: unique: true prints a UK marker on the attribute', () => {
  const its = itemsOf(ER_OPT);
  const uk = its.find((i) => i.kind === 'text' && i.text === 'UK' && i.owner === 'customer');
  const email = its.find((i) => i.kind === 'text' && i.text === '이메일');
  assert.ok(uk && email && Math.abs(uk.box.y - email.box.y) < 3 && uk.box.x + uk.box.w <= email.box.x);
});

test('er refuses: an unknown end, an optional/many N:M at physical level, an fk on the 1 side with new ends', () => {
  expectRefused(edit(ER_OPT, (ir) => { ir.rels[0].card = '1:2..*'; }), /rels\[0\]: set "card" to .*0\.\.1/);
  expectRefused(edit(ER_OPT, (ir) => { ir.level = 'physical'; ir.rels.push({ from: 'customer', to: 'book', card: '0..*:1..*' }); }), /rels\[4\]: a physical model has no N:M/);
  expectRefused(edit(ER_OPT, (ir) => { ir.rels[0] = { from: 'order', to: 'customer', card: '1:0..*' }; }), /the foreign key order\.고객번호 sits on the 1 side of order 1:0\.\.\* customer/);
});

// card 100 U2: the wait band reaches the resume step; a green release edge runs from the holder's release to it
const RELEASED = edit(GAPPED, (ir) => { ir.waits[0].resume = 'UPDATE 재개'; });

test('timeline: an amber wait band runs from the blocked step to the resume step; the cause edge is the cause red', () => {
  assert.deepEqual(fig.checkFigure(RELEASED), []);
  const L = fig.ROLES.light, { svg } = fig.renderFigure(RELEASED), its = itemsOf(RELEASED);
  const band = its.find((i) => i.id === 'wait 0'), from = its.find((i) => i.id === 'step B@6').box, resume = its.find((i) => i.id === 'step B@9').box;
  assert.ok(svg.includes(`fill="${L.wait.fill}" stroke="${L.wait.stroke}"`), 'the band is drawn in the wait role');
  assert.ok(Math.abs(band.box.y - (from.y + from.h)) < 0.5, 'starts under the blocked step');
  assert.ok(Math.abs(band.box.y + band.box.h - resume.y) < 0.5, `ends at the resume step's top (${band.box.y + band.box.h} vs ${resume.y})`);
  assert.ok(svg.includes(`stroke="${L.cause.stroke}" stroke-width="2.5" marker-end="url(#arrow-accent)"`), 'the cause edge keeps the cause colour');
});

test('timeline: a green release edge runs from the holder\'s release step to the resume step, derived from waits.until; none without a resume', () => {
  const L = fig.ROLES.light, its = itemsOf(RELEASED), rel = its.find((i) => i.id === 'release 0');
  assert.ok(rel, 'a release edge exists');
  assert.equal(rel.from, 'step A@8');
  assert.equal(rel.to, 'step B@9');
  const a = its.find((i) => i.id === 'step A@8').box, b = its.find((i) => i.id === 'step B@9').box, p = rel.points;
  assert.ok(Math.abs(p[0][0] - (a.x + a.w)) < 4 && p[0][1] > a.y && p[0][1] < a.y + a.h, 'leaves the holder\'s release step by its side');
  assert.ok(Math.abs(p[p.length - 1][0] - b.x) < 4 && p[p.length - 1][1] > b.y && p[p.length - 1][1] < b.y + b.h, 'enters the resume step by its side');
  assert.ok(fig.renderFigure(RELEASED).svg.includes(`stroke="${L.release.stroke}"`), 'drawn in the release role');
  assert.ok(!itemsOf(GAPPED).some((i) => i.id === 'release 0'), 'no resume, no release edge');
  assert.deepEqual(fig.checkFigure(FIG131), []);
});

// card 100 U3: the record chain - the first strip is current and strongest, older strips lighten; a pointer takes its source field's hue
const CHAIN = {
  type: 'layout', title: 'A row points at its older versions', scale: 'schematic', claim: ['r_rp'],
  strips: [
    { id: 'row', label: 'Current row', cells: [{ id: 'r_pk', label: 'id 205' }, { id: 'r_rp', label: 'ROLL_PTR', kind: 'meta' }, { id: 'r_q', label: 'qty' }] },
    { id: 'u1', label: 'Undo 1', cells: [{ id: 'u1_trx', label: 'prev TRX', kind: 'meta' }, { id: 'u1_rp', label: 'prev PTR', kind: 'meta' }] },
    { id: 'u2', label: 'Undo 2', cells: [{ id: 'u2_trx', label: 'prev TRX', kind: 'meta' }, { id: 'u2_q', label: 'qty' }] },
  ],
  pointers: [{ from: 'r_rp', to: 'u1_trx', label: 'roll pointer' }, { from: 'u1_rp', to: 'u2_trx', label: 'older version' }],
};
const rectOf = (svg, box) => {
  const m = svg.match(new RegExp(`<rect x="${+box.x.toFixed(1)}" y="${+box.y.toFixed(1)}"[^>]*?fill="([^"]+)" stroke="([^"]+)"`));
  assert.ok(m, `no rect at ${box.x},${box.y}`);
  return { fill: m[1], stroke: m[2] };
};
const pathStroke = (svg, p) => {
  const m = svg.match(new RegExp(`<path d="M${+p[0][0].toFixed(1)} ${+p[0][1].toFixed(1)}[^"]*"[^>]*?stroke="([^"]+)"`));
  assert.ok(m, 'no path at the pointer start');
  return m[1];
};

test('layout record chain: the first strip has the strongest fill, later strips lighten along the ramp', () => {
  assert.deepEqual(fig.checkFigure(CHAIN), []);
  const { svg } = fig.renderFigure(CHAIN), its = itemsOf(CHAIN), steps = fig.rampSteps('light', 3);
  const fillOf = (id) => rectOf(svg, its.find((i) => i.id === id).box).fill;
  assert.equal(fillOf('r_pk'), steps[0].fill);
  assert.equal(fillOf('u1_trx'), steps[1].fill);
  assert.equal(fillOf('u2_trx'), steps[2].fill);
  const dist = (h) => Math.abs(lstar(h) - lstar('#ffffff'));
  assert.ok(dist(fillOf('r_pk')) > dist(fillOf('u1_trx')) && dist(fillOf('u1_trx')) > dist(fillOf('u2_trx')), 'strongest to lightest');
  for (const [id, strip] of [['r_pk', 0], ['u1_trx', 1], ['u2_trx', 2]]) assert.ok(wcag(steps[strip].ink, fillOf(id)) >= 4.5, `${id} ink`);
  assert.ok(svg.includes(`fill="${steps[0].ink}"`), 'the current strip draws its text in the ramp ink');
});

test('layout record chain: a pointer edge and its arrowhead take the hue of the field it leaves, not the neutral line', () => {
  const { svg } = fig.renderFigure(CHAIN), its = itemsOf(CHAIN);
  for (const e of its.filter((i) => i.kind === 'edge')) {
    const src = rectOf(svg, its.find((i) => i.id === e.from).box), stroke = pathStroke(svg, e.points);
    assert.notEqual(stroke, fig.PALETTE.line, `${e.id} is not the neutral line colour`);
    assert.equal(stroke, src.stroke, `${e.id} stroke equals its source field's stroke`);
    assert.ok(svg.includes(`fill="${stroke}"`), 'an arrowhead in the same hue');
  }
});

test('layout record chain: a chain of four strips (the most a layout holds) interpolates the ramp, still strongest first', () => {
  const ir = edit(CHAIN, (c) => { c.strips.push({ id: 'u3', label: 'Undo 3', cells: [{ id: 'u3_a', label: 'qty' }] }); });
  const { svg } = fig.renderFigure(ir), its = itemsOf(ir), steps = fig.rampSteps('light', 4);
  ['r_pk', 'u1_trx', 'u2_trx', 'u3_a'].forEach((id, i) => assert.equal(rectOf(svg, its.find((x) => x.id === id).box).fill, steps[i].fill, id));
});

// card 100 U4: check tests every line of a wrapped resume note, and refuses a backward cause edge whose gap is too narrow for the spread
test('checkGeometry refuses a cause edge through the second line of a wrapped resume note, not only the first', () => {
  const line = (id, y) => ({ id, kind: 'text', text: id, box: { x: 150, y, w: 100, h: 12 }, size: 11, owner: 'wait 0', what: 'the resume note', room: 120 });
  const items = (x) => [line('first line', 40), line('second line', 56), { id: 'cause 0', kind: 'edge', points: [[x, 20], [x, 90]], exclusive: true }];
  assert.deepEqual(geo(items(100)), [], 'an edge left of the note is clean');
  const errs = geo(items(200));
  assert.ok(errs.some((e) => /edge cause 0 runs over the text the resume note "first line"/.test(e)), 'first line refused');
  assert.ok(errs.some((e) => /edge cause 0 runs over the text the resume note "second line"/.test(e)), 'second line refused');
  const only2 = geo([line('first line', 40), line('second line', 56), { id: 'cause 0', kind: 'edge', points: [[200, 55], [200, 90]], exclusive: true }]);
  assert.ok(only2.some((e) => /"second line"/.test(e)) && !only2.some((e) => /"first line"/.test(e)), 'an edge reaching only the second line is refused for it');
});

const BACK_LABEL = 'UPDATE stock SET qty = qty - 1 WHERE id = ';
const backward = (label) => ({
  type: 'timeline', title: 'backward cause edges', claim: ['H@t1', 'W@t3'], lanes: [{ id: 'W', label: 'Session W' }, { id: 'H', label: 'Session H' }],
  steps: [
    { t: 1, lane: 'H', label: `${label}1`, kind: 'stmt' },
    { t: 2, lane: 'H', label: `${label}2`, kind: 'stmt' },
    { t: 3, lane: 'W', label: `${label}3`, kind: 'stmt' },
    { t: 5, lane: 'H', label: 'ROLLBACK', kind: 'rollback' },
    { t: 7, lane: 'W', label: `${label}4`, kind: 'stmt' },
    { t: 9, lane: 'H', label: 'COMMIT', kind: 'commit' },
  ],
  waits: [
    { lane: 'W', from: 3, until: 5, on: 'H', holder: 1, label: 'row 1 lock wait' },
    { lane: 'W', from: 7, until: 9, on: 'H', holder: 2, label: 'row 2 lock wait' },
  ],
});
test('timeline: two backward cause edges (waiter left of holder) in a gap too narrow for the spread are refused with a repair line', () => {
  assert.deepEqual(fig.checkFigure(backward('UPDATE stock SET qty = ')), [], 'a wide gap stays clean');
  const errs = fig.checkFigure(backward(BACK_LABEL));
  assert.ok(errs.some((e) => /cause edges/.test(e) && /narrow/.test(e) && /shorten|reorder/.test(e)), `refused with a repair line, got ${JSON.stringify(errs)}`);
  const fwd = backward(BACK_LABEL); fwd.lanes.reverse();
  assert.deepEqual(fig.checkFigure(fwd), [], 'the forward case is unchanged (NARROW at :763 keeps its fan-out)');
});

// card 100 U1 rework: lane hues are drawn (by lane order), and the release edge exists for every lane arrangement
test('timeline: lane A is drawn in the blue lane role and lane B in the teal one - header and steps, read from the svg', () => {
  for (const ir of [GAPPED, RELEASED, FIG131]) {
    assert.deepEqual(fig.checkFigure(ir), []);
    const { svg } = fig.renderFigure(ir), its = itemsOf(ir), L = [fig.laneRole('light', 0), fig.laneRole('light', 1)];
    assert.notEqual(L[0].fill, L[1].fill);
    ir.lanes.forEach((lane, k) => {
      const head = rectOf(svg, its.find((i) => i.id === `lane ${lane.id}`).box);
      assert.deepEqual(head, { fill: L[k].fill, stroke: L[k].stroke }, `${ir.title}: lane ${lane.id} header`);
      const plain = ir.steps.filter((s) => s.lane === lane.id && s.kind === 'stmt' && !ir.claim.includes(`${s.lane}@t${s.t}`));
      assert.ok(plain.length >= 1, 'there is a plain statement step to read');
      for (const s of plain) assert.deepEqual(rectOf(svg, its.find((i) => i.id === `step ${s.lane}@${s.t}`).box), { fill: L[k].fill, stroke: L[k].stroke }, `${ir.title}: step ${s.lane}@${s.t}`);
    });
  }
});

test('timeline: lane hues follow lane order, not the lane id (lanes listed B then A put B in blue)', () => {
  const ir = edit(RELEASED, (c) => { c.lanes.reverse(); });
  const { svg } = fig.renderFigure(ir), its = itemsOf(ir);
  assert.equal(rectOf(svg, its.find((i) => i.id === 'lane B').box).fill, fig.laneRole('light', 0).fill);
  assert.equal(rectOf(svg, its.find((i) => i.id === 'lane A').box).fill, fig.laneRole('light', 1).fill);
});

// one release edge, green, from the on lane's step at "until" to the step the waiter resumes at
const lane3 = (order) => order.map((id) => ({ id, label: id === 'M' ? '세션 M' : `세션 ${id}` }));
const RIGHT_FAR = {
  type: 'timeline', title: '떨어진 두 세션', claim: ['A@t2', 'B@t6'], lanes: lane3(['A', 'M', 'B']),
  steps: [
    { t: 1, lane: 'A', label: 'BEGIN', kind: 'stmt' }, { t: 1, lane: 'B', label: 'BEGIN', kind: 'stmt' },
    { t: 2, lane: 'A', label: 'UPDATE stock', kind: 'stmt' }, { t: 3, lane: 'M', label: 'SELECT 1', kind: 'stmt' },
    { t: 6, lane: 'B', label: 'UPDATE stock', kind: 'stmt' },
    { t: 8, lane: 'A', label: 'COMMIT', kind: 'commit' }, { t: 9, lane: 'B', label: 'COMMIT', kind: 'commit' },
  ],
  waits: [{ lane: 'B', from: 6, until: 8, on: 'A', label: '행 잠금 대기', resume: 'UPDATE 재개' }],
};
const reversed = (ir) => edit(ir, (c) => { c.lanes.reverse(); });
const LEFT_ADJ = reversed(RELEASED);
const LEFT_FAR = reversed(RIGHT_FAR);
const MIDDLE_BUSY = edit(RIGHT_FAR, (c) => { c.steps.push({ t: 8, lane: 'M', label: 'SELECT 2', kind: 'stmt' }); });

const releaseOf = (ir) => {
  const its = itemsOf(ir), w = ir.waits[0], rs = ir.steps.filter((s) => s.lane === w.lane && s.t > w.until).sort((a, b) => a.t - b.t)[0];
  const edges = its.filter((i) => i.kind === 'edge' && /^release /.test(i.id));
  assert.equal(edges.length, 1, 'exactly one release edge');
  assert.equal(edges[0].from, `step ${w.on}@${w.until}`);
  assert.equal(edges[0].to, `step ${rs.lane}@${rs.t}`);
  return { e: edges[0], a: its.find((i) => i.id === edges[0].from).box, b: its.find((i) => i.id === edges[0].to).box, its };
};
const onSide = (p, box, side) => (side === 'right' ? Math.abs(p[0] - (box.x + box.w)) < 4 : side === 'left' ? Math.abs(p[0] - box.x) < 4 : false) && p[1] > box.y && p[1] < box.y + box.h;

test('timeline release edge: waiter right of the holder, adjacent and not adjacent - leaves the holder\'s right side, enters the resume step\'s left side, green', () => {
  for (const ir of [RELEASED, RIGHT_FAR]) {
    assert.deepEqual(fig.checkFigure(ir), [], ir.title);
    const { e, a, b } = releaseOf(ir), p = e.points;
    assert.ok(onSide(p[0], a, 'right'), `${ir.title}: leaves the holder's release step by its right side`);
    assert.ok(onSide(p[p.length - 1], b, 'left'), `${ir.title}: enters the resume step by its left side`);
    assert.ok(fig.renderFigure(ir).svg.includes(`stroke="${fig.ROLES.light.release.stroke}"`), 'green');
  }
});

test('timeline release edge: waiter left of the holder, adjacent and not adjacent - leaves the holder\'s left side, lands on the resume step\'s top clear of its note', () => {
  for (const ir of [LEFT_ADJ, LEFT_FAR]) {
    assert.deepEqual(fig.checkFigure(ir), [], ir.title);
    const { e, a, b, its } = releaseOf(ir), p = e.points, last = p[p.length - 1];
    assert.ok(onSide(p[0], a, 'left'), `${ir.title}: leaves the holder's release step by its left side`);
    assert.ok(Math.abs(last[1] - b.y) < 4 && last[0] > b.x && last[0] < b.x + b.w, `${ir.title}: lands on the top edge of the resume step (${last} vs ${JSON.stringify(b)})`);
    assert.ok(last[0] === p[p.length - 2][0] && last[1] > p[p.length - 2][1] + 8, 'the last leg is vertical and runs down into the box');
    const note = its.filter((i) => i.kind === 'text' && i.what === 'the resume note');
    assert.ok(note.length >= 1, 'the note is drawn');
    assert.ok(fig.renderFigure(ir).svg.includes(`stroke="${fig.ROLES.light.release.stroke}"`), 'green');
  }
});

test('timeline release edge: a release edge with no clear route is refused by check, naming the step in the way and a repair', () => {
  const errs = fig.checkFigure(MIDDLE_BUSY);
  assert.ok(errs.some((e) => /release 0 passes through step M@8/.test(e) && /move/.test(e)), `refused, got ${JSON.stringify(errs)}`);
  assert.deepEqual(fig.checkFigure(RIGHT_FAR), [], 'the same figure with a free middle lane is clean');
});

// ---- card 100 U2: the dark SVG variant - the light SVG with every colour swapped for its dark-set counterpart ----
const hexesOf = (svg) => [...svg.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
const attrsOf = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
// every text with the fill of the last rect drawn under its anchor (null when none: the page), as the SVG paints it
function textOnFills(svg) {
  const rects = [], out = [];
  for (const m of svg.matchAll(/<(rect|text)\b([^>]*)>/g)) {
    const a = attrsOf(m[2]);
    if (m[1] === 'rect') { if (a.x != null && a.y != null && /^#/.test(a.fill || '')) rects.push({ x: +a.x, y: +a.y, w: +a.width, h: +a.height, fill: a.fill }); continue; }
    const px = +a.x + (a['text-anchor'] === 'end' ? -2 : a['text-anchor'] === 'middle' ? 0 : 2), py = +a.y - 4;
    const under = [...rects].reverse().find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
    out.push({ ink: a.fill, fill: under ? under.fill : null, x: +a.x, y: +a.y });
  }
  return out;
}
const CHAIN4 = edit(CHAIN, (c) => { c.strips.push({ id: 'u3', label: 'Undo 3', cells: [{ id: 'u3_a', label: 'qty' }] }); });
const DARK_PLAN = [['timeline', FIG131], ['timeline released', RELEASED], ['timeline left', LEFT_FAR], ['record chain', CHAIN], ['record four', CHAIN4], ['layout', LAYOUT], ['btree', BTREE], ['architecture', ARCH3], ['sequence', SEQ4], ['er', ER], ['chart', CHART], ['bars', BARS], ['store', STORE]];
const LIGHT_SHA = ['4e8c7a38200cf11bd1d02bcbcfbaedf6e30952f6db305ea55f92852c8874a5f9', '701144cd4c5cb9904d6e635b34e8654522acf4a3d2189abfdfdb7858301937f7', '9129400a099be1b721ef13650f59f3c4923430081c27fe5769206c6cebb3a6d5']; // taken at b725ac1b, before the dark variant

test('dark map: every light hex the renderers draw maps to one dark-set hex, no two light hexes share one, and no light hex is a dark value', () => {
  const m = fig.DARK_HEX, keys = Object.keys(m), vals = Object.values(m);
  assert.ok(keys.length >= 28, `${keys.length} hexes mapped`);
  assert.equal(new Set(vals).size, vals.length, 'one-to-one');
  assert.ok(keys.every((k) => /^#[0-9a-f]{6}$/.test(k)) && vals.every((v) => /^#[0-9a-f]{6}$/.test(v)));
  assert.ok(vals.every((v) => !(v in m)), 'no dark value is itself a light hex');
  const L = fig.ROLES.light, D = fig.ROLES.dark;
  const pair = (l, d, what) => assert.equal(m[l], d, `${what}: ${l} -> ${d}`);
  pair(L.surface, D.surface, 'surface'); pair(L.ink, D.ink, 'ink'); pair(L.muted, D.muted, 'muted');
  L.lanes.forEach((r, i) => { for (const k of ['stroke', 'fill']) pair(r[k], D.lanes[i][k], `lane ${i} ${k}`); });
  for (const n of ['cause', 'wait', 'release', 'context']) for (const k of ['stroke', 'fill']) pair(L[n][k], D[n][k], `${n} ${k}`);
  L.ramp.forEach((r, i) => pair(r.fill, D.ramp[i].fill, `ramp ${i}`));
  fig.rampSteps('light', 4).forEach((s, i) => pair(s.fill, fig.rampSteps('dark', 4)[i].fill, `ramp of 4, step ${i}`)); // a layout holds at most 4 strips
  for (const k of Object.keys(fig.PALETTE.fills)) assert.ok(fig.PALETTE.fills[k] in m, `PALETTE.fills.${k}`);
  for (const k of Object.keys(fig.PALETTE.edges)) assert.ok(fig.PALETTE.edges[k].color in m, `PALETTE.edges.${k}`);
});

test('dark svg: for every figure type the dark variant draws only dark-set hexes, none of the light set, and keeps the light structure', () => {
  const dv = new Set([...Object.values(fig.DARK_HEX), ...fig.DARK_INKS]);
  for (const [name, ir] of DARK_PLAN) {
    assert.deepEqual(fig.checkFigure(ir), [], name);
    const { svg } = fig.renderFigure(ir), dark = fig.darkSvg(svg);
    assert.notEqual(dark, svg, `${name}: the dark variant differs`);
    assert.deepEqual([...new Set(hexesOf(dark).filter((h) => !dv.has(h)))], [], `${name}: hexes that are not in the dark set`);
    assert.deepEqual([...new Set(hexesOf(dark).filter((h) => h in fig.DARK_HEX))], [], `${name}: a light-set hex is left`);
    assert.equal(dark.replace(/#[0-9a-f]{6}/gi, '#'), svg.replace(/#[0-9a-f]{6}/gi, '#'), `${name}: same shapes, same text, only the colours changed`);
  }
});

test('dark svg: text on every fill it sits on is >= 4.5:1, including the record strips and the dark ramp', () => {
  for (const [name, ir] of DARK_PLAN) {
    const pairs = textOnFills(fig.darkSvg(fig.renderFigure(ir).svg));
    assert.ok(pairs.length > 0, name);
    for (const p of pairs) {
      const back = p.fill || fig.ROLES.dark.surface;
      assert.ok(wcag(p.ink, back) >= 4.5, `${name}: text at ${p.x},${p.y} ${p.ink} on ${back} is ${wcag(p.ink, back).toFixed(2)}`);
    }
  }
});

test('dark svg: the timeline draws lane A in the dark blue lane role and lane B in the dark teal one, and the other roles in their dark values', () => {
  const D = fig.ROLES.dark, { svg } = fig.renderFigure(RELEASED), dark = fig.darkSvg(svg), its = itemsOf(RELEASED);
  const a = rectOf(dark, its.find((i) => i.id === 'lane A').box), b = rectOf(dark, its.find((i) => i.id === 'lane B').box);
  assert.deepEqual(a, { fill: D.lanes[0].fill, stroke: D.lanes[0].stroke });
  assert.deepEqual(b, { fill: D.lanes[1].fill, stroke: D.lanes[1].stroke });
  assert.notEqual(a.fill, b.fill);
  assert.ok(dark.includes(`fill="${D.wait.fill}" stroke="${D.wait.stroke}"`), 'the wait band in the dark wait role');
  assert.ok(dark.includes(`stroke="${D.cause.stroke}" stroke-width="2.5"`), 'the cause edge in the dark cause role');
  assert.ok(dark.includes(`stroke="${D.release.stroke}"`), 'the release edge in the dark release role');
  assert.ok(dark.includes(`<rect width="${svg.match(/ width="(\d+)"/)[1]}" height="${svg.match(/ height="(\d+)"/)[1]}" fill="${D.surface}"/>`), 'the page is the dark surface');
});

test('dark svg: the record chain runs strongest to lightest on the dark side too, and a pointer takes its source field\'s dark hue', () => {
  const D = fig.ROLES.dark, dark = fig.darkSvg(fig.renderFigure(CHAIN).svg), its = itemsOf(CHAIN), steps = fig.rampSteps('dark', 3);
  const fillOf = (id) => rectOf(dark, its.find((i) => i.id === id).box);
  assert.equal(fillOf('r_pk').fill, steps[0].fill); assert.equal(fillOf('u1_trx').fill, steps[1].fill); assert.equal(fillOf('u2_trx').fill, steps[2].fill);
  const dist = (h) => Math.abs(lstar(h) - lstar(D.surface));
  assert.ok(dist(steps[0].fill) > dist(steps[1].fill) && dist(steps[1].fill) > dist(steps[2].fill), 'strongest to lightest against the dark surface');
  for (const e of its.filter((i) => i.kind === 'edge')) assert.equal(pathStroke(dark, e.points), fillOf(e.from).stroke, `${e.id} in its source field's dark hue`);
});

test('dark svg: the light output is byte-identical to before (sha256 of the light SVG of three figures)', () => {
  assert.deepEqual([FIG131, CHAIN, ARCH3].map((ir) => sha256(fig.renderFigure(ir).svg)), LIGHT_SHA);
});

test('writeFigure writes <base>.dark.svg beside the light pair; it is the dark substitution of the light file; a refused figure writes none', needsBrowser, () => {
  const dir = scratch();
  try {
    const r = fig.writeFigure(RELEASED, join(dir, 'f'));
    assert.equal(r.code, 0, r.msg);
    assert.ok(existsSync(join(dir, 'f.dark.svg')), 'f.dark.svg exists');
    const light = readFileSync(join(dir, 'f.svg'), 'utf8');
    assert.equal(light, fig.renderFigure(RELEASED).svg, 'the light file is the light render, unchanged');
    assert.equal(readFileSync(join(dir, 'f.dark.svg'), 'utf8'), fig.darkSvg(light));
    assert.ok(/f\.dark\.svg/.test(r.msg), 'the message names it');
    const bad = fig.writeFigure({ ...ARCH3, nodes: ARCH3.nodes.map((n) => (n.id === 'a' ? { ...n, label: '클라이언트 🙂' } : n)) }, join(dir, 'g'));
    assert.equal(bad.code, 1);
    assert.ok(!existsSync(join(dir, 'g.dark.svg')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
