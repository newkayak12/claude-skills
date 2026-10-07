#!/usr/bin/env node
// wiki.mjs - teams-wiki: a project wiki that survives the session, as a stdio MCP server.
//
// Design: _repo/docs/plans/2026-10-07-teams-wiki-memory.md (1단계). The md files under
// <root>/.teams_wiki/<space>/<slug>.md are the source of truth - git-tracked, human-editable.
// .index.sqlite (FTS5 word + trigram index, [[link]] graph) is a disposable by-product: every tool
// call re-indexes md files whose (mtimeMs, size) changed, so deleting it just means a rebuild.
// Search is FTS5 only - no vectors, no model, no network. Korean follows knowledge's approach
// (2-syllable prefix, particle strip, trigram), copied here, never imported across plugins.
//
// No tool writes a page: wiki_propose drops a file in _proposed/, only wiki_accept turns it into a
// page (and wiki_reject files it under _rejected/ with the reason). Accept/reject run under a lock
// dir (.teams_wiki/.lock, owner.json {pid, at}) like store.mjs: stolen only from a dead owner,
// a timeout throws - there is never an unlocked write. md files are written tmp + rename.
//
// node:sqlite is loaded lazily (guarded dynamic import) so initialize/tools/list work on any Node.
// A runtime without node:sqlite + FTS5 (22.12's SQLite has no FTS5) answers every wiki_* call with
// one clear error. The stdio loop runs only when this file is the entry point; tests import it.

import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isEntryPoint } from './pluginroots.mjs';

const SERVER = { name: 'teams-wiki', version: '0.1.0' };
const DEFAULT_PROTOCOL = '2024-11-05';
const RUNTIME_HINT = 'teams-wiki needs node:sqlite with FTS5: Node 24+ (or a Node 22/23 build whose SQLite includes FTS5).';
const RRF_K = 60;
const HOLD_MS = Number(process.env.WIKI_TEST_HOLD_MS) || 0; // tests only: widens the INDEX.md read-to-write window
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

let root = process.cwd();
let lockTimeoutMs = Number(process.env.WIKI_LOCK_TIMEOUT_MS) || 10000;
let db = null;
let sqlite; // undefined = not probed yet; then { DatabaseSync } or { error }

export function setRoot(dir) { close(); root = resolve(dir); }
export function setLockTimeout(ms) { lockTimeoutMs = ms; }
export function close() { if (db) { try { db.close(); } catch { /* already closed */ } db = null; } }

const wikiDir = () => join(root, '.teams_wiki');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ---------- runtime ----------

export async function sqliteSupport() {
  if (sqlite) return sqlite.error ? { ok: false, error: sqlite.error } : { ok: true };
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const probe = new DatabaseSync(':memory:');
    try {
      probe.exec("CREATE VIRTUAL TABLE t USING fts5(x); CREATE VIRTUAL TABLE u USING fts5(x, tokenize='trigram')");
    } finally { probe.close(); }
    sqlite = { DatabaseSync };
    return { ok: true };
  } catch (e) {
    sqlite = { error: `${RUNTIME_HINT} Running ${process.version}: ${(e && e.message) || e}` };
    return { ok: false, error: sqlite.error };
  }
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

async function openDb() {
  if (db) return db;
  const sup = await sqliteSupport();
  if (!sup.ok) throw new Error(sup.error);
  ensureWiki();
  const d = new sqlite.DatabaseSync(join(wikiDir(), '.index.sqlite'));
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

function indexPage(d, f) {
  const { fm, body } = readMd(f.path);
  const title = fm.title || f.id.split('/')[1];
  const tags = Array.isArray(fm.tags) ? fm.tags.join(' ') : String(fm.tags || '');
  dropPage(d, f.id);
  d.prepare('INSERT INTO pages VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    f.id, f.space, title, tags, fm.status || 'accepted', fm.superseded_by || null, fm.updated || '',
    f.mtime, f.size, summaryOf(body), body);
  for (const t of ['pages_fts', 'pages_trgm']) d.prepare(`INSERT INTO ${t} (id, title, tags, body) VALUES (?,?,?,?)`).run(f.id, title, tags, body);
  for (const to of linksOf(body)) d.prepare('INSERT OR IGNORE INTO links VALUES (?,?)').run(f.id, to);
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

// Word and trigram rank lists fused by RRF; ties break on id so a rebuilt index orders identically.
function searchIds(d, query, { space, includeSuperseded = false } = {}) {
  const score = new Map();
  const add = (ids, w) => ids.forEach((id, i) => score.set(id, (score.get(id) || 0) + w / (RRF_K + i + 1)));
  add(ftsIds(d, 'pages_fts', wordTokens(query), space, includeSuperseded), 0.7);
  add(ftsIds(d, 'pages_trgm', trigramTokens(query), space, includeSuperseded), 0.3);
  return [...score].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
}

function snippet(body, query) {
  const text = body.replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const at = words(query).flatMap(koreanForms).map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] || 0;
  const start = Math.max(0, at - 50);
  return `${start ? '…' : ''}${text.slice(start, start + 160)}${start + 160 < text.length ? '…' : ''}`;
}

// ---------- tools ----------

const page = (d, id) => d.prepare('SELECT * FROM pages WHERE id = ?').get(id);
const titled = (d, id) => { const p = page(d, id); return p ? { id, title: p.title } : { id, title: null, missing: true }; };

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
function isolated(d, { id, title, body }) {
  if (linksOf(body).length) return [];
  const qt = words(title).filter((t) => [...t].length >= 2);
  if (!qt.length) return [];
  return searchIds(d, title).slice(0, 5).filter((other) => {
    if (other === id) return false;
    const t = page(d, other).title.toLowerCase();
    return qt.filter((q) => koreanForms(q).some((f) => t.includes(f))).length / qt.length >= 0.5;
  });
}

const TOOL_IMPL = {
  wiki_search(d, a) {
    const ids = searchIds(d, String(a.query || ''), { space: a.space, includeSuperseded: !!a.include_superseded });
    return {
      results: ids.slice(0, a.k > 0 ? a.k : 5).map((id) => {
        const p = page(d, id);
        return { id, title: p.title, snippet: snippet(p.body, a.query), status: p.status };
      }),
    };
  },
  wiki_get(d, a) {
    const p = page(d, checkId(a.id));
    if (!p) throw new Error(`no such page: ${a.id}`);
    const { fm, body } = readMd(pagePath(a.id));
    return {
      id: a.id, frontmatter: fm, body,
      links_out: d.prepare('SELECT to_id FROM links WHERE from_id = ? ORDER BY to_id').all(a.id).map((r) => titled(d, r.to_id)),
      backlinks: d.prepare('SELECT from_id FROM links WHERE to_id = ? ORDER BY from_id').all(a.id).map((r) => titled(d, r.from_id)),
    };
  },
  wiki_resume(d, a) {
    const logs = d.prepare("SELECT id, title, updated, body FROM pages WHERE space = 'log' AND status = 'accepted' ORDER BY updated DESC, id DESC LIMIT ?")
      .all(a.k > 0 ? a.k : 3);
    return {
      pages: logs.map((l) => ({
        ...l,
        links: d.prepare('SELECT to_id FROM links WHERE from_id = ? ORDER BY to_id').all(l.id).map((r) => {
          const p = page(d, r.to_id);
          return p ? { id: p.id, title: p.title, summary: p.summary } : { id: r.to_id, missing: true };
        }),
      })),
    };
  },
  wiki_list(d, a) {
    const rows = d.prepare(`SELECT id, space, title, status FROM pages ${a.space ? 'WHERE space = ?' : ''} ORDER BY id`)
      .all(...(a.space ? [a.space] : []));
    const out = {};
    for (const r of rows) (out[r.space] ||= []).push({ id: r.id, title: r.title, status: r.status });
    return out;
  },
  wiki_propose(d, a) {
    const space = checkName('space', a.space), slug = checkName('slug', a.slug);
    for (const k of ['title', 'body', 'source']) if (typeof a[k] !== 'string' || !a[k].trim()) throw new Error(`${k} is required`);
    const id = `${space}/${slug}`;
    if (a.supersedes) {
      const old = page(d, checkId(a.supersedes));
      if (!old || old.status !== 'accepted') throw new Error(`supersedes: no accepted page ${a.supersedes}`);
    }
    const pid = `p-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const path = join(wikiDir(), '_proposed', `${pid}.md`);
    writeAtomic(path, renderMd({
      title: a.title, space, slug, tags: a.tags || [], source: a.source, supersedes: a.supersedes || null,
      proposed_at: new Date().toISOString(),
    }, a.body));
    const existing = page(d, id);
    const similar = isolated(d, { id, title: a.title, body: a.body });
    return {
      proposal_id: pid, path, id,
      diff: existing ? lineDiff(existing.body, a.body) : null,
      warnings: similar.length ? [{ type: 'isolated', similar, message: 'no [[links]] in the body but similar pages exist' }] : [],
    };
  },
  wiki_accept(d, a) {
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
      try { renderIndex(); sync(d); } catch (e) {
        // the md files are the source; INDEX.md and the index rebuild on the next call
        out.warnings = [{ type: 'index', message: `page written, index update failed (rebuilds next call): ${(e && e.message) || e}` }];
      }
      return out;
    });
  },
  wiki_reject(d, a) {
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
  wiki_status(d, a, reindexed) {
    const proposals = existsSync(join(wikiDir(), '_proposed'))
      ? readdirSync(join(wikiDir(), '_proposed')).filter((f) => f.endsWith('.md')).length : 0;
    const at = d.prepare("SELECT v FROM meta WHERE k = 'indexed_at'").get();
    return {
      pages: d.prepare('SELECT COUNT(*) AS n FROM pages').get().n,
      proposals,
      index: { indexed_at: at ? at.v : null, reindexed },
      broken_links: d.prepare('SELECT from_id AS "from", to_id AS "to" FROM links WHERE to_id NOT IN (SELECT id FROM pages) ORDER BY from_id, to_id').all().map((r) => ({ ...r })),
    };
  },
};

const str = (description) => ({ type: 'string', description });
const obj = (properties, required = []) => ({ type: 'object', properties, required });
export const TOOLS = [
  ['wiki_search', 'FTS5 search (Korean + English). Returns id, title, snippet, status. Superseded pages are excluded unless include_superseded.',
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

export async function callTool(name, args) {
  const fn = TOOL_IMPL[name];
  if (!fn) throw new Error(`unknown tool: ${name}`);
  const d = await openDb();
  const reindexed = sync(d);
  return fn(d, args || {}, reindexed);
}

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
