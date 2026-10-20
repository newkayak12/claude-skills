#!/usr/bin/env node
// Mechanical half of the material store (material/<id>/ per item + material/index.md).
// Project root = cwd. Writes only under <cwd>/material/. Every subcommand prints exactly one
// JSON object on stdout; bad usage exits 1 with {"error": "..."}.
//
//   node material.mjs id      --source S --title T
//   node material.mjs match   --id I --source S --title T
//   node material.mjs init    --id I --source S --title T [--period P --role R --tags G --status X]
//   node material.mjs index
//   node material.mjs log     --id I --note N [--status X]
//   node material.mjs foreign
//
// Matching is detection by string difference only (normalised: NFC, trimmed, case-folded,
// whitespace-collapsed). It is NOT semantic: a renamed episode is only seen as "same source,
// different title", and the same episode under two sources as "same title, different source".
// Both are reported "ambiguous" and never resolved here; the caller asks the user.
import fs from 'node:fs';
import path from 'node:path';

const PARTS = ['meta.md', 'problem.md', 'decision.md', 'result.md', 'learned.md', 'gaps.md', 'history.md'];
const STATUSES = ['raw', 'shaped', 'written', 'rendered', 'reviewed'];
const FLAGS = new Set(['id', 'source', 'title', 'period', 'role', 'tags', 'note', 'status']);
const ID_RE = /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u;
const MAT = path.resolve(process.cwd(), 'material');

const fail = (msg) => { throw new Error(msg); };
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const slug = (s) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
const norm = (s) => String(s ?? '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');

function need(a, ...names) {
  for (const n of names) if (!one(a[n])) fail(`missing --${n}`);
}
function needId(a) {
  need(a, 'id');
  if (!ID_RE.test(a.id)) fail(`invalid id: ${a.id}`);
}
function needStatus(s) {
  if (!STATUSES.includes(s)) fail(`invalid status: ${s} (one of ${STATUSES.join('|')})`);
}
function today() {
  const env = process.env.MATERIAL_DATE;
  if (env) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(env)) fail('MATERIAL_DATE must be YYYY-MM-DD');
    return env;
  }
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The only write path: stays under material/, also through symlinks.
function safeWrite(rel, data, flag = 'w') {
  const full = path.resolve(MAT, rel);
  const r = path.relative(MAT, full);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) fail('path outside material/');
  fs.mkdirSync(MAT, { recursive: true });
  const realRoot = fs.realpathSync(MAT);
  let anchor = full;
  while (!lstat(anchor)) anchor = path.dirname(anchor);
  let real;
  try { real = fs.realpathSync(anchor); } catch { fail('path outside material/'); }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) fail('path outside material/');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data, { flag });
}
function lstat(p) {
  try { return fs.lstatSync(p); } catch { return null; }
}

function readMeta(dir) {
  let text;
  try { text = fs.readFileSync(path.join(dir, 'meta.md'), 'utf8'); } catch { return null; }
  const m = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    const x = /^([a-z]+):[ \t]*(.*)$/.exec(line);
    if (x && !(x[1] in m)) m[x[1]] = x[2].trim();
  }
  return m;
}
function itemDirs() {
  try {
    return fs.readdirSync(MAT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch { return []; }
}
function folderItems() {
  const items = [], skipped = [];
  for (const name of itemDirs()) {
    const m = readMeta(path.join(MAT, name));
    if (m && m.title) items.push({ id: name, title: m.title, status: m.status || '', source: m.source || '' });
    else skipped.push(name);
  }
  return { items, skipped };
}
const cell = (s) => String(s).replace(/\|/g, '\\|');
function indexItems() {
  let text;
  try { text = fs.readFileSync(path.join(MAT, 'index.md'), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const c = line.split(/(?<!\\)\|/).slice(1, -1).map((s) => s.trim().replace(/\\\|/g, '|'));
    if (c.length < 4 || c[0] === 'id' || /^:?-+:?$/.test(c[0])) continue;
    out.push({ id: c[0], title: c[1], status: c[2], source: c[3] });
  }
  return out;
}

const cmd = {
  id(a) {
    need(a, 'source', 'title');
    const s = slug(a.source), t = slug(a.title);
    if (!s || !t) fail('source and title must contain letters or digits');
    return { id: `${s}--${t}` };
  },

  match(a) {
    needId(a);
    need(a, 'source', 'title');
    const all = new Map();
    for (const it of [...indexItems(), ...folderItems().items]) all.set(it.id, it);
    const src = norm(a.source), ttl = norm(a.title);
    const same = [], other = [];
    for (const it of all.values()) {
      const sameSrc = norm(it.source) === src, sameTtl = norm(it.title) === ttl;
      const c = (reason) => ({ id: it.id, title: it.title, source: it.source, reason });
      if (sameSrc && sameTtl) same.push(c('same source and title'));
      else if (sameTtl) other.push(c('same title, different source'));
      else if (sameSrc) other.push(c('same source, different title'));
      else if (it.id === a.id) other.push(c('same id, different source and title'));
    }
    if (same.length) return { result: 'same', candidates: same };
    if (other.length) return { result: 'ambiguous', candidates: other };
    return { result: 'new', candidates: [] };
  },

  init(a) {
    needId(a);
    need(a, 'title', 'source');
    const status = a.status ?? 'raw';
    needStatus(status);
    if (lstat(path.join(MAT, a.id))) return { result: 'exists', id: a.id };
    const meta = [
      '# 메타', '',
      `title: ${one(a.title)}`, `status: ${status}`, `source: ${one(a.source)}`,
      `period: ${one(a.period)}`.trimEnd(), `role: ${one(a.role)}`.trimEnd(), `tags: ${one(a.tags)}`.trimEnd(), '',
    ].join('\n');
    const result = [
      '# 결과', '',
      '| number | evidence source | label |', '|---|---|---|', '| | | |', '',
      '- number: 단위나 퍼센트가 붙은 수치 하나당 한 줄.',
      '- evidence source: 건네받은 자료 안의 인용(파일 + 제목 또는 줄 범위).',
      '- label: 사용자가 직접 말했을 뿐 자료에 근거가 없으면 `user-stated`.',
      '- 근거가 전혀 없는 수치는 evidence source 칸에 `근거 없음`이라고 적는다.', '',
    ].join('\n');
    const heads = { 'problem.md': '문제', 'decision.md': '결정', 'learned.md': '배운 점', 'gaps.md': '빈칸 (질문)' };
    const body = {
      'meta.md': meta,
      'result.md': result,
      'history.md': `# 이력\n\n- ${today()}: created (status: ${status})\n`,
    };
    for (const p of PARTS) safeWrite(`${a.id}/${p}`, body[p] ?? `# ${heads[p]}\n\n`, 'wx');
    return { result: 'created', id: a.id };
  },

  index() {
    const { items, skipped } = folderItems();
    const rows = items.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    const lines = ['# 글감 목록', '', '| id | title | status | source |', '|---|---|---|---|'];
    for (const r of rows) lines.push(`| ${[r.id, r.title, r.status, r.source].map(cell).join(' | ')} |`);
    safeWrite('index.md', lines.join('\n') + '\n');
    return { rows, skipped };
  },

  log(a) {
    needId(a);
    need(a, 'note');
    if (a.status !== undefined) needStatus(a.status);
    const dir = path.join(MAT, a.id);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`unknown id: ${a.id}`);
    let line = `- ${today()}: ${one(a.note)}`;
    let metaText;
    if (a.status !== undefined) {
      try { metaText = fs.readFileSync(path.join(dir, 'meta.md'), 'utf8'); } catch { fail(`no meta.md for ${a.id}`); }
      const m = /^status:[ \t]*(.*)$/m.exec(metaText);
      if (!m) fail(`no status line in meta.md of ${a.id}`);
      line += ` (status: ${m[1].trim()} -> ${a.status})`;
      metaText = metaText.replace(/^status:.*$/m, `status: ${a.status}`);
    }
    const hist = path.join(dir, 'history.md');
    let prev = '';
    try { prev = fs.readFileSync(hist, 'utf8'); } catch { /* new history */ }
    safeWrite(`${a.id}/history.md`, (prev && !prev.endsWith('\n') ? '\n' : '') + line + '\n', 'a');
    if (metaText !== undefined) safeWrite(`${a.id}/meta.md`, metaText);
    return { result: 'logged', id: a.id, line };
  },

  foreign() {
    const found = [];
    const walk = (dir, rel) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else found.push(r);
      }
    };
    walk(MAT, '');
    const own = (r) => r === 'index.md' || (/^[^/]+\/[^/]+$/.test(r) && PARTS.includes(r.split('/')[1]));
    return { foreign: found.filter((r) => !own(r)).sort() };
  },
};

function parse(argv) {
  const a = Object.create(null);
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!k.startsWith('--') || !FLAGS.has(k.slice(2))) fail(`unknown argument: ${k}`);
    if (i + 1 >= argv.length) fail(`missing value for ${k}`);
    a[k.slice(2)] = argv[i + 1];
  }
  return a;
}

try {
  const [sub, ...rest] = process.argv.slice(2);
  if (!Object.hasOwn(cmd, sub ?? '')) fail(`unknown subcommand: ${sub ?? ''} (id|match|init|index|log|foreign)`);
  process.stdout.write(JSON.stringify(cmd[sub](parse(rest))) + '\n');
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e.message }) + '\n');
  process.exitCode = 1;
}
