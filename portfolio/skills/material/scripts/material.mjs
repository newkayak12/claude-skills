#!/usr/bin/env node
// Mechanical half of the material store (material/<id>/ per item + material/index.md).
// Project root = cwd. Writes only under <cwd>/material/. Every subcommand prints exactly one
// JSON object on stdout; bad usage exits 1 with {"error": "..."}.
//
//   node material.mjs id      --source S --title T
//   node material.mjs match   --id I --source S --title T
//   node material.mjs init    --id I --source S --title T [--period P --role R --tags G]
//   node material.mjs index
//   node material.mjs log     --id I --note N [--add-source S]
//   node material.mjs answer  --id I --question Q --citation C
//   node material.mjs gaps
//   node material.mjs foreign
//
// Step 1 (collection) creates status "raw" and never changes it. A status other than raw
// (init --status, log --status) is reserved for later steps and refused unless the caller
// names the step with --later-step; the step is recorded in history.md.
// A no-op writes nothing: init on an existing id, index with unchanged content, a log note
// already in history.md, an answer already recorded.
//
// Matching is detection by string difference only (normalised: NFC, trimmed, case-folded,
// whitespace-collapsed). It is NOT semantic: a renamed episode is only seen as "same source,
// different title", and the same episode under two sources as "same title, different source".
// Both are reported "ambiguous" and never resolved here; the caller asks the user.
import fs from 'node:fs';
import path from 'node:path';

const PARTS = ['meta.md', 'problem.md', 'decision.md', 'result.md', 'learned.md', 'gaps.md', 'history.md'];
const STATUSES = ['raw', 'shaped', 'written', 'rendered', 'reviewed'];
const FLAGS = new Set(['id', 'source', 'title', 'period', 'role', 'tags', 'note', 'status', 'later-step', 'question', 'citation', 'add-source']);
const ANSWERED = '[답변됨]';
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
// Status is owned by later steps; step 1 never passes it.
function needLaterStep(a) {
  if (!one(a['later-step'])) fail('--status belongs to later steps: pass --later-step <name> (step 1 never changes status)');
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
    if (m && m.title) items.push({ id: name, title: m.title, status: m.status || '', source: m.source || '', also: m.also || '' });
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
    out.push({ id: c[0].replace(/^\[(.+?)\]\(.*\)$/, '$1'), title: c[1], status: c[2], source: c[3] });
  }
  return out;
}

const cmd = {
  id(a) {
    need(a, 'source', 'title');
    let s = slug(a.source);
    const t = slug(a.title);
    if (!s || !t) fail('source and title must contain letters or digits');
    // a source that already ends in the title (`retro.md#검색-지연` + `검색 지연`) does not repeat it
    if (s !== t && s.endsWith(`-${t}`)) s = s.slice(0, -(t.length + 1));
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
      // `also:` holds sources the user already merged into this item (log --add-source)
      const sources = [it.source, ...String(it.also || '').split(';')].map(norm).filter(Boolean);
      const sameSrc = sources.includes(src), sameTtl = norm(it.title) === ttl;
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
    if (status !== 'raw') needLaterStep(a);
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
      '- label: 사용자가 자기 주장이라고 직접 표시한 수치("체감상", "내 기억으로는")만 `user-stated`.',
      '- 자료 안의 근거도 사용자 표시도 없는 수치는 evidence source 칸에 `근거 없음`이라고 적고, gaps.md에 출처를 묻는 질문을 더한다.', '',
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
    for (const r of rows) lines.push(`| ${[`[${r.id}](${encodeURI(r.id)}/meta.md)`, r.title, r.status, r.source].map(cell).join(' | ')} |`);
    const text = lines.join('\n') + '\n';
    let prev = null;
    try { prev = fs.readFileSync(path.join(MAT, 'index.md'), 'utf8'); } catch { /* none yet */ }
    if (prev !== text) safeWrite('index.md', text);
    return { rows, skipped };
  },

  log(a) {
    needId(a);
    need(a, 'note');
    if (a.status !== undefined) { needStatus(a.status); needLaterStep(a); }
    const dir = path.join(MAT, a.id);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`unknown id: ${a.id}`);
    let body = one(a.note);
    let metaText;
    if (a['add-source'] !== undefined) {
      const add = one(a['add-source']);
      if (!add) fail('missing --add-source');
      try { metaText = fs.readFileSync(path.join(dir, 'meta.md'), 'utf8'); } catch { fail(`no meta.md for ${a.id}`); }
      const m = readMeta(dir);
      const known = [m.source, ...String(m.also || '').split(';')].map(norm).filter(Boolean);
      if (!known.includes(norm(add))) {
        const also = [...String(m.also || '').split(';').map(one).filter(Boolean), add].join('; ');
        metaText = /^also:.*$/m.test(metaText)
          ? metaText.replace(/^also:.*$/m, `also: ${also}`)
          : metaText.replace(/^(source:.*)$/m, `$1\nalso: ${also}`);
      }
      body += ` (source added: ${add})`;
    }
    if (a.status !== undefined) {
      metaText ??= (() => { try { return fs.readFileSync(path.join(dir, 'meta.md'), 'utf8'); } catch { return undefined; } })();
      if (metaText === undefined) fail(`no meta.md for ${a.id}`);
      const m = /^status:[ \t]*(.*)$/m.exec(metaText);
      if (!m) fail(`no status line in meta.md of ${a.id}`);
      body += ` (status: ${m[1].trim()} -> ${a.status}; step: ${one(a['later-step'])})`;
      metaText = metaText.replace(/^status:.*$/m, `status: ${a.status}`);
    }
    const hist = path.join(dir, 'history.md');
    let prev = '';
    try { prev = fs.readFileSync(hist, 'utf8'); } catch { /* new history */ }
    // A note already recorded is the same change again: write nothing.
    if (prev.split(/\r?\n/).some((l) => l.replace(/^- \d{4}-\d{2}-\d{2}: /, '') === body && l.startsWith('- '))) {
      return { result: 'unchanged', id: a.id };
    }
    const line = `- ${today()}: ${body}`;
    safeWrite(`${a.id}/history.md`, (prev && !prev.endsWith('\n') ? '\n' : '') + line + '\n', 'a');
    if (metaText !== undefined) safeWrite(`${a.id}/meta.md`, metaText);
    return { result: 'logged', id: a.id, line };
  },

  // Marks an open gaps.md question answered and keeps it visible: the line stays, prefixed
  // [답변됨] and suffixed with the citation of the material that answered it. Never deletes.
  answer(a) {
    needId(a);
    need(a, 'question', 'citation');
    const dir = path.join(MAT, a.id);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`unknown id: ${a.id}`);
    let text;
    try { text = fs.readFileSync(path.join(dir, 'gaps.md'), 'utf8'); } catch { fail(`no gaps.md for ${a.id}`); }
    const q = norm(a.question.replace(/^\s*-\s+/, ''));
    const cite = one(a.citation);
    const lines = text.split('\n');
    const open = [], answered = [];
    lines.forEach((l, i) => {
      if (!l.startsWith('- ')) return;
      const body = l.slice(2);
      if (body.startsWith(ANSWERED + ' ')) {
        const m = /^\[답변됨\] (.*) — 답변: (.*)$/.exec(body.trimEnd());
        if (m && norm(m[1]) === q) answered.push({ i, cite: m[2].trim() });
      } else if (norm(body) === q) open.push(i);
    });
    if (open.length > 1) fail('ambiguous question: more than one open line matches');
    if (open.length === 0) {
      if (answered.some((x) => norm(x.cite) === norm(cite))) return { result: 'unchanged', id: a.id };
      fail(answered.length ? 'question already answered with a different citation' : 'no such open question');
    }
    const line = `- ${ANSWERED} ${one(lines[open[0]].slice(2))} — 답변: ${cite}`;
    lines[open[0]] = line;
    safeWrite(`${a.id}/gaps.md`, lines.join('\n'));
    return { result: 'answered', id: a.id, line };
  },

  // Open questions per item, counted from gaps.md itself: the summary's count comes from here.
  gaps() {
    const items = [];
    for (const { id } of folderItems().items) {
      let text = '';
      try { text = fs.readFileSync(path.join(MAT, id, 'gaps.md'), 'utf8'); } catch { /* none */ }
      const lines = text.split(/\r?\n/).filter((l) => l.startsWith('- '));
      const answered = lines.filter((l) => l.slice(2).startsWith(ANSWERED + ' ')).length;
      items.push({ id, open: lines.length - answered, answered });
    }
    return { open: items.reduce((n, x) => n + x.open, 0), items };
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
  if (!Object.hasOwn(cmd, sub ?? '')) fail(`unknown subcommand: ${sub ?? ''} (id|match|init|index|log|answer|gaps|foreign)`);
  process.stdout.write(JSON.stringify(cmd[sub](parse(rest))) + '\n');
} catch (e) {
  process.stdout.write(JSON.stringify({ error: e.message }) + '\n');
  process.exitCode = 1;
}
