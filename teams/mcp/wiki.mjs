#!/usr/bin/env node
// wiki.mjs - teams-wiki: a project wiki that survives the session, as a stdio MCP server.
//
// Design: _repo/docs/plans/2026-10-07-teams-wiki-memory.md (1단계). The md files under
// <root>/.teams_wiki/<space>/<slug>.md are the source of truth - git-tracked, human-editable.
// .index.sqlite (FTS5 word + trigram index, [[link]] graph) is a disposable by-product: every tool
// call re-indexes md files whose (mtimeMs, size) changed, so deleting it just means a rebuild.
// Search is keyword only - no vectors, no model, no network. Korean follows knowledge's approach
// (2-syllable prefix, particle strip, trigram), copied here, never imported across plugins.
// Two stores behind one interface: fts5 (node:sqlite + FTS5, the index above) and scan (no sqlite:
// every call reads the md files and ranks in JS, never creating .index.sqlite). The query tokenizers,
// the RRF fuse and its id tie-break are shared; scan mirrors FTS5's document-side rules (unicode61:
// underscore separates, case + diacritics folded, 'x*' prefix; trigram: case-folded substring) with a
// JS bm25 (k1 1.2, b 0.75, title 8 / tags 3 / body 1). Known difference: scan's fold strips only
// U+0300-036F marks and lower-cases with JS rules, SQLite's folding tables are wider.
//
// No tool writes a page: wiki_propose drops a file in _proposed/, only wiki_accept turns it into a
// page (and wiki_reject files it under _rejected/ with the reason). Accept/reject run under a lock
// dir (.teams_wiki/.lock, owner.json {pid, at}) like store.mjs: stolen only from a dead owner,
// a timeout throws - there is never an unlocked write. md files are written tmp + rename.
//
// node:sqlite is probed synchronously with process.getBuiltinModule?.() plus an in-memory FTS5 +
// trigram create; undefined, any throw, or no FTS5 (22.12's SQLite has none) selects scan mode.
// WIKI_FORCE_SCAN=1 forces scan (tests). Node 18 syntax and APIs only. callToolSync is the core;
// callTool is its async wrapper. The stdio loop runs only when this file is the entry point.

import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isEntryPoint } from './pluginroots.mjs';

const SERVER = { name: 'teams-wiki', version: '0.1.0' };
const DEFAULT_PROTOCOL = '2024-11-05';
const RRF_K = 60;
const HOLD_MS = Number(process.env.WIKI_TEST_HOLD_MS) || 0; // tests only: widens the INDEX.md read-to-write window
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

let root = process.cwd();
let lockTimeoutMs = Number(process.env.WIKI_LOCK_TIMEOUT_MS) || 10000;
let db = null;
let sqlite; // undefined = not probed yet; then { mode: 'fts5', DatabaseSync } or { mode: 'scan', error? }

export function setRoot(dir) { close(); root = resolve(dir); }
export function setLockTimeout(ms) { lockTimeoutMs = ms; }
export function close() { if (db) { try { db.close(); } catch { /* already closed */ } db = null; } }

const wikiDir = () => join(root, '.teams_wiki');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ---------- runtime ----------

function support() {
  if (process.env.WIKI_FORCE_SCAN === '1') return { mode: 'scan' };
  if (sqlite) return sqlite;
  sqlite = { mode: 'scan' };
  try {
    const m = process.getBuiltinModule?.('node:sqlite');
    if (m && m.DatabaseSync) {
      const probe = new m.DatabaseSync(':memory:');
      try {
        probe.exec("CREATE VIRTUAL TABLE t USING fts5(x); CREATE VIRTUAL TABLE u USING fts5(x, tokenize='trigram')");
      } finally { probe.close(); }
      sqlite = { mode: 'fts5', DatabaseSync: m.DatabaseSync };
    }
  } catch (e) { sqlite = { mode: 'scan', error: String((e && e.message) || e) }; }
  return sqlite;
}

export async function sqliteSupport() {
  const s = support();
  return s.mode === 'fts5' ? { ok: true, mode: 'fts5' } : { ok: false, mode: 'scan', ...(s.error ? { error: s.error } : {}) };
}

// ---------- md files ----------

function parseValue(v) {
  v = v.trim();
  if (v === '' || v === 'null') return null;
  if (v[0] === '"' || v[0] === '[') {
    try { return JSON.parse(v); } catch { /* hand-edited: fall through */ }
    if (v[0] === '[') return v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  return v;
}

function parseMd(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { fm: {}, body: text };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = parseValue(line.slice(i + 1));
  }
  return { fm, body: m[2] };
}

const PAGE_KEYS = ['title', 'space', 'tags', 'source', 'updated', 'status', 'superseded_by'];
function renderMd(fm, body, keys = Object.keys(fm)) {
  const lines = keys.filter((k) => fm[k] !== undefined).map((k) => `${k}: ${JSON.stringify(fm[k] ?? null)}`);
  return `---\n${lines.join('\n')}\n---\n${body.replace(/^\n+/, '')}`;
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

const pagePath = (id) => join(wikiDir(), `${id}.md`);
const readMd = (path) => parseMd(readFileSync(path, 'utf8'));

function summaryOf(body) {
  const line = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || '';
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

function linksOf(body) {
  const out = new Set();
  for (const m of body.matchAll(/\[\[([^\[\]\n|#]+?)\]\]/g)) out.add(m[1].trim().replace(/\.md$/, ''));
  return [...out];
}

// Pages on disk in sorted path order: <space>/<slug>.md, skipping dot and underscore dirs.
function walkPages() {
  const out = [];
  if (!existsSync(wikiDir())) return out;
  for (const space of readdirSync(wikiDir()).sort()) {
    if (space[0] === '.' || space[0] === '_') continue;
    const dir = join(wikiDir(), space);
    let st; try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.md')) continue;
      const path = join(dir, f);
      const s = statSync(path);
      out.push({ id: `${space}/${f.slice(0, -3)}`, space, path, mtime: s.mtimeMs, size: s.size });
    }
  }
  return out;
}

function ensureWiki() {
  mkdirSync(wikiDir(), { recursive: true });
  const gi = join(wikiDir(), '.gitignore');
  if (!existsSync(gi)) writeAtomic(gi, '.index.sqlite*\n.lock*\n');
}

// ---------- lock ----------

const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

function ownerOf(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')); } catch { return null; }
}

// Whether the lock may be taken from its owner: a dead pid, or no owner.json for over 2 s (a writer
// killed between mkdir and the owner write). Stealers serialise on `.lock.steal` and re-judge inside it.
function stealable(dir) {
  const o = ownerOf(dir);
  if (o) return !pidAlive(o.pid);
  try { return Date.now() - statSync(dir).mtimeMs > 2000; } catch { return false; }
}

function steal(lockDir) {
  const guard = `${lockDir}.steal`;
  try { mkdirSync(guard); } catch {
    try { if (Date.now() - statSync(guard).mtimeMs > 10000) rmSync(guard, { recursive: true, force: true }); } catch { /* gone */ }
    return;
  }
  try { if (stealable(lockDir)) rmSync(lockDir, { recursive: true, force: true }); }
  finally { rmSync(guard, { recursive: true, force: true }); }
}

function withLock(fn) {
  ensureWiki();
  const lockDir = join(wikiDir(), '.lock');
  const deadline = Date.now() + lockTimeoutMs;
  for (;;) {
    try { mkdirSync(lockDir); break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (stealable(lockDir)) { steal(lockDir); continue; }
    if (Date.now() > deadline) throw new Error(`wiki lock timeout after ${lockTimeoutMs} ms on ${lockDir}`);
    sleep(20);
  }
  const token = randomUUID();
  try {
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token }));
    return fn();
  } finally {
    // release only our own lock: a stalled holder whose lock was stolen must not delete the stealer's
    const o = ownerOf(lockDir);
    if (o && o.token === token) rmSync(lockDir, { recursive: true, force: true });
  }
}

// ---------- index ----------

function openDb() {
  if (db) return db;
  ensureWiki();
  const d = new (support().DatabaseSync)(join(wikiDir(), '.index.sqlite'));
  d.exec('PRAGMA busy_timeout = 10000');
  d.exec('PRAGMA journal_mode = WAL');
  d.exec(`
    CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, space TEXT, title TEXT, tags TEXT, status TEXT,
      superseded_by TEXT, updated TEXT, mtime REAL, size INTEGER, summary TEXT, body TEXT);
    CREATE TABLE IF NOT EXISTS links (from_id TEXT, to_id TEXT, PRIMARY KEY (from_id, to_id));
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(id UNINDEXED, title, tags, body);
    CREATE VIRTUAL TABLE IF NOT EXISTS pages_trgm USING fts5(id UNINDEXED, title, tags, body, tokenize='trigram');
  `);
  db = d;
  return d;
}

function dropPage(d, id) {
  d.prepare('DELETE FROM pages WHERE id = ?').run(id);
  d.prepare('DELETE FROM links WHERE from_id = ?').run(id);
  d.prepare('DELETE FROM pages_fts WHERE id = ?').run(id);
  d.prepare('DELETE FROM pages_trgm WHERE id = ?').run(id);
}

// One page row, from the md file; both stores hold exactly this shape.
function rowOf(f) {
  const { fm, body } = readMd(f.path);
  const tags = Array.isArray(fm.tags) ? fm.tags.join(' ') : String(fm.tags || '');
  return {
    id: f.id, space: f.space, title: fm.title || f.id.split('/')[1], tags, status: fm.status || 'accepted',
    superseded_by: fm.superseded_by || null, updated: fm.updated || '', mtime: f.mtime, size: f.size, summary: summaryOf(body), body,
  };
}

function indexPage(d, f) {
  const r = rowOf(f);
  dropPage(d, f.id);
  d.prepare('INSERT INTO pages VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    r.id, r.space, r.title, r.tags, r.status, r.superseded_by, r.updated, r.mtime, r.size, r.summary, r.body);
  for (const t of ['pages_fts', 'pages_trgm']) d.prepare(`INSERT INTO ${t} (id, title, tags, body) VALUES (?,?,?,?)`).run(r.id, r.title, r.tags, r.body);
  for (const to of linksOf(r.body)) d.prepare('INSERT OR IGNORE INTO links VALUES (?,?)').run(r.id, to);
}

// Re-index what changed since the last call; returns how many pages were touched.
function sync(d) {
  const files = walkPages();
  d.exec('BEGIN IMMEDIATE');
  try {
    const known = new Map(d.prepare('SELECT id, mtime, size FROM pages').all().map((r) => [r.id, r]));
    let n = 0;
    for (const f of files) {
      const k = known.get(f.id);
      known.delete(f.id);
      if (k && k.mtime === f.mtime && k.size === f.size) continue;
      indexPage(d, f); n++;
    }
    for (const id of known.keys()) { dropPage(d, id); n++; }
    if (n) d.prepare("INSERT OR REPLACE INTO meta VALUES ('indexed_at', ?)").run(new Date().toISOString());
    d.exec('COMMIT');
    return n;
  } catch (e) { d.exec('ROLLBACK'); throw e; }
}

// ---------- search (Korean: copied from knowledge/scripts/sqlite-knowledge.mjs) ----------

const PARTICLES = ['에서는', '에서', '으로', '에게', '까지', '부터', '와', '과', '을', '를', '이', '가', '은', '는', '의', '에', '로', '도', '만']
  .sort((a, b) => b.length - a.length);
const HANGUL = /^\p{Script=Hangul}+$/u;
const words = (text) => [...new Set((String(text).toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []))];

function koreanForms(token) {
  if (!HANGUL.test(token)) return [token];
  const p = PARTICLES.find((x) => token.endsWith(x) && [...token].length - [...x].length >= 2);
  return p ? [token, token.slice(0, -p.length)] : [token];
}
const wordTokens = (q) => [...new Set(words(q).flatMap((t) => (HANGUL.test(t)
  ? koreanForms(t).filter((f) => [...f].length >= 2).map((f) => `${f}*`) : [t])))].slice(0, 24);
const trigramTokens = (q) => [...new Set(words(q).flatMap(koreanForms))].filter((t) => [...t].length >= 3).slice(0, 24);
const matchExpr = (tokens) => tokens.map((t) => {
  const prefix = t.endsWith('*');
  return `"${(prefix ? t.slice(0, -1) : t).replaceAll('"', '""')}"${prefix ? '*' : ''}`;
}).join(' OR ');

function ftsIds(d, table, tokens, space, includeSuperseded) {
  if (!tokens.length) return [];
  const sql = `SELECT ${table}.id AS id FROM ${table} JOIN pages p ON p.id = ${table}.id
    WHERE ${table} MATCH ? ${space ? 'AND p.space = ?' : ''} ${includeSuperseded ? '' : "AND p.status = 'accepted'"}
    ORDER BY bm25(${table}, 0, 8, 3, 1), ${table}.id LIMIT 50`;
  return d.prepare(sql).all(...[matchExpr(tokens), ...(space ? [space] : [])]).map((r) => r.id);
}

// ---------- stores: { mode, sync, indexedAt, page, pages, links, rank } ----------

function ftsStore(d) {
  const all = (sql) => d.prepare(sql).all().map((r) => ({ ...r }));
  return {
    mode: 'fts5',
    sync: () => sync(d),
    indexedAt: () => { const r = d.prepare("SELECT v FROM meta WHERE k = 'indexed_at'").get(); return r ? r.v : null; },
    page: (id) => d.prepare('SELECT * FROM pages WHERE id = ?').get(id),
    pages: () => all('SELECT * FROM pages ORDER BY id'),
    links: (f = {}) => {
      const col = f.from !== undefined ? 'from_id' : f.to !== undefined ? 'to_id' : null;
      return d.prepare(`SELECT from_id AS "from", to_id AS "to" FROM links${col ? ` WHERE ${col} = ?` : ''} ORDER BY from_id, to_id`)
        .all(...(col ? [f.from !== undefined ? f.from : f.to] : [])).map((r) => ({ ...r }));
    },
    rank: (kind, tokens, space, includeSuperseded) => ftsIds(d, kind === 'word' ? 'pages_fts' : 'pages_trgm', tokens, space, includeSuperseded),
  };
}

// FTS5 document side, in JS: case + diacritic fold, tokens = runs of letters/digits (underscore splits).
const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
const docTokens = (s) => fold(s).match(/[\p{L}\p{N}]+/gu) || [];
const K1 = 1.2, B = 0.75, WEIGHTS = [8, 3, 1]; // title, tags, body: bm25(t, 0, 8, 3, 1)
const SCAN_KINDS = {
  word: { // a query token is a phrase of doc tokens; 'x*' makes the last one a prefix
    prep: docTokens, len: (toks) => toks.length,
    phrase: (t) => ({ parts: docTokens(t.endsWith('*') ? t.slice(0, -1) : t), star: t.endsWith('*') }),
    count: (toks, { parts, star }) => {
      let n = 0;
      for (let i = 0; parts.length && i + parts.length <= toks.length; i++) {
        if (parts.every((p, j) => (star && j === parts.length - 1 ? toks[i + j].startsWith(p) : toks[i + j] === p))) n++;
      }
      return n;
    },
  },
  trgm: { // case-folded substring
    prep: (s) => String(s).toLowerCase(), len: (s) => Math.max(0, [...s].length - 2),
    phrase: (t) => t.toLowerCase(), count: (s, p) => s.split(p).length - 1,
  },
};

function scanRank(rows, kind, tokens, space, includeSuperseded) {
  const k = SCAN_KINDS[kind];
  const phrases = tokens.map(k.phrase);
  if (!phrases.length || !rows.length) return [];
  const docs = rows.map((r) => {
    const cols = [r.title, r.tags, r.body].map(k.prep);
    return { r, cols, dl: cols.reduce((n, c) => n + k.len(c), 0) };
  });
  const avg = docs.reduce((n, d) => n + d.dl, 0) / docs.length || 1;
  const scores = new Map();
  for (const p of phrases) {
    const tf = docs.map((d) => d.cols.map((c) => k.count(c, p)));
    const n = tf.filter((cs) => cs.some(Boolean)).length;
    const idf = Math.max(Math.log((docs.length - n + 0.5) / (n + 0.5)), 1e-6);
    docs.forEach((d, i) => tf[i].forEach((f, c) => {
      if (f) scores.set(d.r.id, (scores.get(d.r.id) || 0) + WEIGHTS[c] * idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * d.dl / avg)));
    }));
  }
  return docs.filter((d) => scores.has(d.r.id) && (!space || d.r.space === space) && (includeSuperseded || d.r.status === 'accepted'))
    .sort((a, b) => scores.get(b.r.id) - scores.get(a.r.id) || (a.r.id < b.r.id ? -1 : 1)).slice(0, 50).map((d) => d.r.id);
}

function scanStore() {
  const rows = walkPages().map(rowOf).sort((a, b) => (a.id < b.id ? -1 : 1));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const links = rows.flatMap((r) => linksOf(r.body).map((to) => ({ from: r.id, to })))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1));
  return {
    mode: 'scan', sync: () => 0, indexedAt: () => null,
    page: (id) => byId.get(id), pages: () => rows,
    links: (f = {}) => links.filter((l) => (f.from === undefined || l.from === f.from) && (f.to === undefined || l.to === f.to)),
    rank: (kind, tokens, space, includeSuperseded) => scanRank(rows, kind, tokens, space, includeSuperseded),
  };
}

const openStore = () => (support().mode === 'fts5' ? ftsStore(openDb()) : scanStore());

// Word and trigram rank lists fused by RRF; ties break on id so a rebuilt index orders identically.
function fuse(lists) {
  const score = new Map();
  for (const [ids, w] of lists) ids.forEach((id, i) => score.set(id, (score.get(id) || 0) + w / (RRF_K + i + 1)));
  return [...score].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
}

function searchIds(store, query, { space, includeSuperseded = false } = {}) {
  return fuse([
    [store.rank('word', wordTokens(query), space, includeSuperseded), 0.7],
    [store.rank('trgm', trigramTokens(query), space, includeSuperseded), 0.3],
  ]);
}

function snippet(body, query) {
  const text = body.replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const at = words(query).flatMap(koreanForms).map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] || 0;
  const start = Math.max(0, at - 50);
  return `${start ? '…' : ''}${text.slice(start, start + 160)}${start + 160 < text.length ? '…' : ''}`;
}

// ---------- tools ----------

const titled = (store, id) => { const p = store.page(id); return p ? { id, title: p.title } : { id, title: null, missing: true }; };
const linksFrom = (store, id) => store.links({ from: id }).map((l) => l.to);

function checkName(label, v) {
  if (typeof v !== 'string' || !NAME.test(v) || /\.md$/i.test(v)) throw new Error(`${label} must be letters/digits/._- , start with a letter or digit, and not end in .md`);
  return v;
}
function checkId(id) {
  const [space, slug, ...rest] = String(id).split('/');
  if (rest.length || !slug) throw new Error(`id must be <space>/<slug>, got ${JSON.stringify(id)}`);
  checkName('space', space); checkName('slug', slug);
  return id;
}
function checkPid(pid) {
  if (typeof pid !== 'string' || !/^[\w-]+$/.test(pid)) throw new Error('invalid proposal_id');
  return pid;
}

function renderIndex() {
  const lines = walkPages().map((f) => ({ f, ...readMd(f.path) }))
    .filter((p) => (p.fm.status || 'accepted') === 'accepted')
    .map((p) => `[[${p.f.id}]] — ${summaryOf(p.body)}`);
  if (HOLD_MS) sleep(HOLD_MS);
  writeAtomic(join(wikiDir(), 'INDEX.md'), `# Wiki index\n\n${lines.join('\n')}\n`);
}

function lineDiff(oldBody, newBody) {
  const a = oldBody.split('\n'), b = newBody.split('\n');
  const inA = new Set(a), inB = new Set(b);
  return [...a.filter((l) => !inB.has(l)).map((l) => `- ${l}`), ...b.filter((l) => !inA.has(l)).map((l) => `+ ${l}`)].join('\n');
}

// Linkless + a similar accepted page (title tokens mostly shared with a top-5 hit) = an orphan in the making.
function isolated(store, { id, title, body }) {
  if (linksOf(body).length) return [];
  const qt = words(title).filter((t) => [...t].length >= 2);
  if (!qt.length) return [];
  return searchIds(store, title).slice(0, 5).filter((other) => {
    if (other === id) return false;
    const t = store.page(other).title.toLowerCase();
    return qt.filter((q) => koreanForms(q).some((f) => t.includes(f))).length / qt.length >= 0.5;
  });
}

const TOOL_IMPL = {
  wiki_search(store, a) {
    const ids = searchIds(store, String(a.query || ''), { space: a.space, includeSuperseded: !!a.include_superseded });
    return {
      results: ids.slice(0, a.k > 0 ? a.k : 5).map((id) => {
        const p = store.page(id);
        return { id, title: p.title, snippet: snippet(p.body, a.query), status: p.status };
      }),
    };
  },
  wiki_get(store, a) {
    if (!store.page(checkId(a.id))) throw new Error(`no such page: ${a.id}`);
    const { fm, body } = readMd(pagePath(a.id));
    return {
      id: a.id, frontmatter: fm, body,
      links_out: linksFrom(store, a.id).map((to) => titled(store, to)),
      backlinks: store.links({ to: a.id }).map((l) => titled(store, l.from)),
    };
  },
  wiki_resume(store, a) {
    const logs = store.pages().filter((p) => p.space === 'log' && p.status === 'accepted')
      .sort((x, y) => (x.updated < y.updated ? 1 : x.updated > y.updated ? -1 : x.id < y.id ? 1 : -1))
      .slice(0, a.k > 0 ? a.k : 3);
    return {
      pages: logs.map((l) => ({
        id: l.id, title: l.title, updated: l.updated, body: l.body,
        links: linksFrom(store, l.id).map((to) => {
          const p = store.page(to);
          return p ? { id: p.id, title: p.title, summary: p.summary } : { id: to, missing: true };
        }),
      })),
    };
  },
  wiki_list(store, a) {
    const out = {};
    for (const r of store.pages().filter((p) => !a.space || p.space === a.space)) (out[r.space] ||= []).push({ id: r.id, title: r.title, status: r.status });
    return out;
  },
  wiki_propose(store, a) {
    const space = checkName('space', a.space), slug = checkName('slug', a.slug);
    for (const k of ['title', 'body', 'source']) if (typeof a[k] !== 'string' || !a[k].trim()) throw new Error(`${k} is required`);
    const id = `${space}/${slug}`;
    if (a.supersedes) {
      const old = store.page(checkId(a.supersedes));
      if (!old || old.status !== 'accepted') throw new Error(`supersedes: no accepted page ${a.supersedes}`);
    }
    const pid = `p-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const path = join(wikiDir(), '_proposed', `${pid}.md`);
    writeAtomic(path, renderMd({
      title: a.title, space, slug, tags: a.tags || [], source: a.source, supersedes: a.supersedes || null,
      proposed_at: new Date().toISOString(),
    }, a.body));
    const existing = store.page(id);
    const similar = isolated(store, { id, title: a.title, body: a.body });
    return {
      proposal_id: pid, path, id,
      diff: existing ? lineDiff(existing.body, a.body) : null,
      warnings: similar.length ? [{ type: 'isolated', similar, message: 'no [[links]] in the body but similar pages exist' }] : [],
    };
  },
  wiki_accept(store, a) {
    const pid = checkPid(a.proposal_id);
    return withLock(() => {
      const src = join(wikiDir(), '_proposed', `${pid}.md`);
      if (!existsSync(src)) throw new Error(`no such proposal (already accepted or rejected?): ${pid}`);
      const { fm, body } = readMd(src);
      const id = `${checkName('space', fm.space)}/${checkName('slug', fm.slug)}`;
      const now = new Date().toISOString();
      const oldPath = fm.supersedes && fm.supersedes !== id ? pagePath(checkId(fm.supersedes)) : null;
      if (oldPath && !existsSync(oldPath)) throw new Error(`supersedes: page ${fm.supersedes} is gone`);
      writeAtomic(pagePath(id), renderMd({
        title: fm.title, space: fm.space, tags: fm.tags || [], source: fm.source, updated: now, status: 'accepted', superseded_by: null,
      }, body, PAGE_KEYS));
      if (oldPath) {
        const old = readMd(oldPath);
        writeAtomic(oldPath, renderMd({ ...old.fm, updated: now, status: 'superseded', superseded_by: id }, old.body, PAGE_KEYS));
      }
      rmSync(src);
      const out = { accepted: pid, id, superseded: oldPath ? fm.supersedes : null };
      try { renderIndex(); store.sync(); } catch (e) {
        // the md files are the source; INDEX.md and the index rebuild on the next call
        out.warnings = [{ type: 'index', message: `page written, index update failed (rebuilds next call): ${(e && e.message) || e}` }];
      }
      return out;
    });
  },
  wiki_reject(store, a) {
    const pid = checkPid(a.proposal_id);
    if (typeof a.reason !== 'string' || !a.reason.trim()) throw new Error('reason is required');
    withLock(() => {
      const src = join(wikiDir(), '_proposed', `${pid}.md`);
      if (!existsSync(src)) throw new Error(`no such proposal: ${pid}`);
      const { fm, body } = readMd(src);
      writeAtomic(join(wikiDir(), '_rejected', `${pid}.md`), renderMd({ ...fm, rejected_at: new Date().toISOString(), reason: a.reason }, body));
      rmSync(src);
    });
    return { rejected: pid, reason: a.reason };
  },
  wiki_status(store, a, reindexed) {
    const proposals = existsSync(join(wikiDir(), '_proposed'))
      ? readdirSync(join(wikiDir(), '_proposed')).filter((f) => f.endsWith('.md')).length : 0;
    const pages = store.pages();
    const have = new Set(pages.map((p) => p.id));
    return {
      mode: store.mode,
      pages: pages.length,
      proposals,
      index: store.mode === 'fts5' ? { indexed_at: store.indexedAt(), reindexed } : null,
      broken_links: store.links().filter((l) => !have.has(l.to)),
    };
  },
};

const str = (description) => ({ type: 'string', description });
const obj = (properties, required = []) => ({ type: 'object', properties, required });
export const TOOLS = [
  ['wiki_search', 'Keyword search (FTS5, or an md scan without it; Korean + English). Returns id, title, snippet, status. Superseded pages are excluded unless include_superseded.',
    obj({ query: str('search text'), space: str('limit to a space'), k: { type: 'number' }, include_superseded: { type: 'boolean' } }, ['query'])],
  ['wiki_get', 'Full page plus outgoing links and backlinks (id + title).', obj({ id: str('<space>/<slug>') }, ['id'])],
  ['wiki_resume', 'Session start: the k most recent log/* pages with their 1-hop linked pages.', obj({ k: { type: 'number' } })],
  ['wiki_list', 'Pages grouped by space.', obj({ space: str('limit to a space') })],
  ['wiki_propose', 'Write a proposal to _proposed/ (never a page). Returns proposal_id, diff vs the existing page, isolation warnings.',
    obj({ space: str('space'), slug: str('slug'), title: str('title'), body: str('md body; link pages with [[space/slug]]'), source: str('who/what produced it, e.g. an EPIC id'),
      tags: { type: 'array', items: { type: 'string' } }, supersedes: str('id of an accepted page this replaces') }, ['space', 'slug', 'title', 'body', 'source'])],
  ['wiki_accept', 'Turn a proposal into a page (re-index, INDEX.md, mark superseded page).', obj({ proposal_id: str('from wiki_propose') }, ['proposal_id'])],
  ['wiki_reject', 'Move a proposal to _rejected/ with the reason.', obj({ proposal_id: str('from wiki_propose'), reason: str('why') }, ['proposal_id', 'reason'])],
  ['wiki_status', 'Page count, pending proposals, index freshness, broken [[links]].', obj({})],
].map(([name, description, inputSchema]) => ({ name, description, inputSchema }));

export function callToolSync(name, args) {
  const fn = TOOL_IMPL[name];
  if (!fn) throw new Error(`unknown tool: ${name}`);
  const store = openStore();
  const reindexed = store.sync();
  return fn(store, args || {}, reindexed);
}

export async function callTool(name, args) { return callToolSync(name, args); }

// ---------- stdio JSON-RPC (pattern of taskmanager.mjs) ----------

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: params && typeof params.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } }, serverInfo: SERVER,
      });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call':
      try {
        const out = await callTool(params && params.name, params && params.arguments);
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: String((e && e.message) || e) }], isError: true });
      }
    default:
      if (typeof id === 'undefined') return null;
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
  }
}

if (isEntryPoint(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  if (i >= 0 && process.argv[i + 1]) setRoot(process.argv[i + 1]);
  let buf = '';
  let queue = Promise.resolve(); // replies keep request order
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      queue = queue.then(async () => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }
        let out;
        try { out = await handle(msg); } catch (e) {
          out = typeof msg.id === 'undefined' ? null : { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String((e && e.message) || e) } };
        }
        if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
      });
    }
  });
  process.stdin.on('end', () => { queue.then(() => process.exit(0)); });
}
