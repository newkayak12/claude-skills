#!/usr/bin/env node
// test-wiki.mjs - teams/mcp/wiki.mjs: md-backed project wiki with a disposable FTS5 index.
//
// Every test name starts with the Done-when 1단계 bullet it proves (DW1..DW10, design doc
// _repo/docs/plans/2026-10-07-teams-wiki-memory.md section 3); the tests after DW10 pin the
// contract details (freshness, lock steal/timeout, reject). DW7 (no network/model) is a source
// scan here and a grep in the harness gate. FTS tests need node:sqlite + FTS5 (Node 24+) and skip
// elsewhere; the stdio smoke (DW9) and the runtime guard (DW10) always run.
//
//   node --test teams/scripts/test-wiki.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WIKI = join(HERE, '..', 'mcp', 'wiki.mjs');
const wiki = await import(WIKI);
const FTS5 = (await wiki.sqliteSupport()).ok;
const TMP = mkdtempSync(join(tmpdir(), 'wiki-test-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ } });

let seq = 0;
function fresh() {
  const root = join(TMP, `r${++seq}`);
  mkdirSync(root, { recursive: true });
  wiki.setRoot(root);
  wiki.setLockTimeout(10000);
  return root;
}
const call = (name, args) => wiki.callTool(name, args);
const wd = (root) => join(root, '.teams_wiki');
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

async function accept(space, slug, title, body, extra = {}) {
  const p = await call('wiki_propose', { space, slug, title, body, source: 'test', ...extra });
  await call('wiki_accept', { proposal_id: p.proposal_id });
  return `${space}/${slug}`;
}
const ids = async (query, extra = {}) => (await call('wiki_search', { query, ...extra })).results.map((r) => r.id);

const FLOW = ['payments', 'flow', '결제 승인 흐름', '결제 승인 요청은 게이트웨이로 전달된다. Idempotency keys prevent duplicate charges.'];
async function seed() {
  const target = await accept(...FLOW);
  await accept('shipping', 'flow', '배송 흐름', '배송 승인 요청은 물류로 전달된다. Tracking numbers per parcel. Extra charges for express.');
  await accept('auth', 'login', '로그인 정책', '세션 토큰을 발급한다. Refresh tokens rotate.');
  return target;
}

test.after(() => wiki.close());

// ---------- DW1 ----------

test('DW1 ko and en keyword queries rank the target first; a distractor-only query does not', { skip: !FTS5 }, async () => {
  fresh();
  const target = await seed();
  assert.equal((await ids('결제를'))[0], target);
  assert.equal((await ids('idempotency charges'))[0], target);
  const only = await ids('tracking');
  assert.equal(only[0], 'shipping/flow');
  assert.notEqual(only[0], target);
});

// ---------- DW2 ----------

test('DW2 superseded page leaves default search, points at the new page, INDEX.md lists only the new', { skip: !FTS5 }, async () => {
  const root = fresh();
  const old = await accept('payments', 'v1', '결제 v1', '구버전 결제 절차 legacyterm');
  const next = await accept('payments', 'v2', '결제 v2', '신버전 결제 절차 modernterm', { supersedes: old });
  const got = await call('wiki_get', { id: old });
  assert.equal(got.frontmatter.status, 'superseded');
  assert.equal(got.frontmatter.superseded_by, next);
  assert.ok(!(await ids('legacyterm')).includes(old));
  assert.ok((await ids('legacyterm', { include_superseded: true })).includes(old));
  const index = readFileSync(join(wd(root), 'INDEX.md'), 'utf8');
  assert.ok(index.includes('[[payments/v2]] — 신버전 결제 절차 modernterm'));
  assert.ok(!index.includes('[[payments/v1]]'));
});

// ---------- DW3 ----------

test('DW3 deleting .index.sqlite rebuilds the same ordered results', { skip: !FTS5 }, async () => {
  const root = fresh();
  await seed();
  // equal-score pair inserted b-then-a: only the id tie-break keeps a before b after a sorted rebuild
  await accept('tie', 'b', 'Tie', 'tiebreakterm shared text');
  await accept('tie', 'a', 'Tie', 'tiebreakterm shared text');
  const queries = ['결제를', 'idempotency charges', '승인 요청', 'charges', 'tiebreakterm'];
  const before = [];
  for (const q of queries) before.push(await ids(q));
  assert.ok(before.every((r) => r.length >= 1) && before.some((r) => r.length >= 2));
  wiki.close();
  for (const f of readdirSync(wd(root)).filter((n) => n.startsWith('.index.sqlite'))) rmSync(join(wd(root), f));
  assert.ok(!existsSync(join(wd(root), '.index.sqlite')));
  const after = [];
  after.push(await ids(queries[0]));
  assert.ok(existsSync(join(wd(root), '.index.sqlite')));
  for (const q of queries.slice(1)) after.push(await ids(q));
  assert.deepEqual(before[4], ['tie/a', 'tie/b']);
  assert.deepEqual(after, before);
});

// ---------- DW4 ----------

test('DW4 [[links]] fill the links table, backlinks come back from wiki_get, broken links show in wiki_status', { skip: !FTS5 }, async () => {
  const root = fresh();
  await accept('x', 'b', 'Page B', 'target page');
  await accept('x', 'a', 'Page A', 'see [[x/b]] and [[x/missing]]');
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(join(wd(root), '.index.sqlite'));
  assert.ok(raw.prepare("SELECT 1 FROM links WHERE from_id = 'x/a' AND to_id = 'x/b'").get());
  raw.close();
  assert.deepEqual((await call('wiki_get', { id: 'x/b' })).backlinks.map((l) => l.id), ['x/a']);
  assert.deepEqual((await call('wiki_get', { id: 'x/a' })).links_out.map((l) => l.id), ['x/b', 'x/missing']);
  assert.deepEqual((await call('wiki_status', {})).broken_links, [{ from: 'x/a', to: 'x/missing' }]);
});

// ---------- DW5 ----------

test('DW5 wiki_resume returns the newest log pages with their 1-hop linked pages', { skip: !FTS5 }, async () => {
  fresh();
  await accept('decisions', 'pay', '결제 결정', '게이트웨이를 쓴다.');
  await accept('log', '2026-10-06-e1', 'EPIC 1 log', '첫 세션. [[decisions/pay]] 결정.');
  sleepMs(5);
  await accept('log', '2026-10-07-e2', 'EPIC 2 log', '둘째 세션. [[decisions/pay]] 이어받음.');
  const one = await call('wiki_resume', { k: 1 });
  assert.deepEqual(one.pages.map((p) => p.id), ['log/2026-10-07-e2']);
  assert.deepEqual(one.pages[0].links.map((l) => [l.id, l.title]), [['decisions/pay', '결제 결정']]);
  assert.deepEqual((await call('wiki_resume', {})).pages.map((p) => p.id), ['log/2026-10-07-e2', 'log/2026-10-06-e1']);
});

// ---------- DW6 ----------

test('DW6 a linkless proposal similar to an existing page gets an isolated warning', { skip: !FTS5 }, async () => {
  fresh();
  const target = await seed();
  const isolated = (r) => r.warnings.filter((w) => w.type === 'isolated');
  const bare = await call('wiki_propose', { space: 'payments', slug: 'overview', title: '결제 승인 흐름 개요', body: '개요 문서.', source: 't' });
  assert.ok(isolated(bare)[0].similar.includes(target));
  const linked = await call('wiki_propose', { space: 'payments', slug: 'overview', title: '결제 승인 흐름 개요', body: `개요 문서. [[${target}]]`, source: 't' });
  assert.equal(isolated(linked).length, 0);
  // weak FTS hits (body 'express' in shipping/flow, title 정책 in auth/login) but below the title-similarity rule
  const other = await call('wiki_propose', { space: 'hr', slug: 'plan', title: 'Express 요금 정책', body: 'Headcount.', source: 't' });
  assert.ok((await ids('Express 요금 정책')).length >= 1);
  assert.equal(isolated(other).length, 0);
});

// ---------- DW7 ----------

test('DW7 wiki.mjs has no network or model call and imports only node:* and ./pluginroots.mjs', () => {
  const src = readFileSync(WIKI, 'utf8');
  assert.doesNotMatch(src, /node:(http|https|net|dns|tls)|fetch\(|ollama|embedding/i);
  const specs = [...src.matchAll(/^import[\s\S]*?from '([^']+)'/gm)].map((m) => m[1]);
  assert.ok(specs.length > 0);
  for (const s of specs) assert.ok(s.startsWith('node:') || s === './pluginroots.mjs', s);
});

// ---------- DW8 ----------

const CHILD = `
import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [root, go, ready, args] = process.argv.slice(1);
const w = await import(pathToFileURL(process.env.WIKI_LIB).href);
w.setRoot(root);
const { mine, shared } = JSON.parse(args);
await w.callTool('wiki_status', {});
writeFileSync(ready, '');
while (!existsSync(go)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
for (const p of mine) await w.callTool('wiki_accept', { proposal_id: p });
let sharedResult = 'ok';
try { await w.callTool('wiki_accept', { proposal_id: shared }); } catch { sharedResult = 'err'; }
w.close();
console.log(JSON.stringify({ shared: sharedResult }));
`;

function runChild(root, go, name, mine, shared, hold = 0) {
  const ready = join(TMP, `${name}.ready`);
  const child = spawn(process.execPath, ['--input-type=module', '-e', CHILD, root, go, ready, JSON.stringify({ mine, shared })],
    { env: { ...process.env, WIKI_LIB: WIKI, WIKI_TEST_HOLD_MS: String(hold) } });
  let out = '', err = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { err += c; });
  const done = new Promise((res) => child.on('exit', (code) => res({ code, out, err })));
  return { ready, done };
}

test('DW8 two processes accepting concurrently leave md and index intact; a shared proposal is accepted once', { skip: !FTS5 }, async () => {
  const root = fresh();
  const mk = async (i) => (await call('wiki_propose', { space: 'c', slug: `p${i}`, title: `Page ${i}`, body: `body of uniqterm${i}x`, source: 't' })).proposal_id;
  // c1 gets one proposal and a long read-to-write window on INDEX.md; c2 accepts the other nine meanwhile.
  // Without the lock c1 writes its stale INDEX.md last and the other pages vanish from it.
  const a = [await mk(0)], b = [];
  for (let i = 1; i < 10; i++) b.push(await mk(i));
  const shared = (await call('wiki_propose', { space: 'c', slug: 'shared', title: 'Shared', body: 'uniqtermshared body', source: 't' })).proposal_id;
  wiki.close();
  const go = join(TMP, 'go-dw8');
  const c1 = runChild(root, go, 'c1', a, shared, 600);
  const c2 = runChild(root, go, 'c2', b, shared);
  while (!existsSync(c1.ready) || !existsSync(c2.ready)) await new Promise((r) => setTimeout(r, 10));
  writeFileSync(go, '');
  const results = await Promise.all([c1.done, c2.done]);
  for (const r of results) assert.equal(r.code, 0, r.err);
  const outcomes = results.map((r) => JSON.parse(r.out.trim()).shared).sort();
  assert.deepEqual(outcomes, ['err', 'ok']);
  const list = await call('wiki_list', { space: 'c' });
  assert.equal(list.c.length, 11);
  const index = readFileSync(join(wd(root), 'INDEX.md'), 'utf8');
  for (const p of list.c) {
    assert.equal(index.split(`[[${p.id}]]`).length - 1, 1, p.id);
    assert.ok((await call('wiki_get', { id: p.id })).frontmatter.title);
  }
  for (let i = 0; i < 10; i++) assert.deepEqual(await ids(`uniqterm${i}x`), [`c/p${i}`]);
  assert.deepEqual(await ids('uniqtermshared'), ['c/shared']);
  assert.ok(!existsSync(join(wd(root), '.lock')));
});

// ---------- DW9 / DW10 ----------

function rpc(root, requests) {
  const r = spawnSync(process.execPath, [WIKI, '--root', root], {
    input: requests.map((q) => JSON.stringify(q)).join('\n') + '\n', encoding: 'utf8', timeout: 30000,
  });
  return r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('DW9 stdio: initialize + tools/list returns exactly the 8 tools', () => {
  const out = rpc(fresh(), [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]);
  assert.equal(out[0].result.serverInfo.name, 'teams-wiki');
  assert.deepEqual(out[1].result.tools.map((t) => t.name).sort(), [
    'wiki_accept', 'wiki_get', 'wiki_list', 'wiki_propose', 'wiki_reject', 'wiki_resume', 'wiki_search', 'wiki_status',
  ]);
});

test('DW10 runtime guard: wiki_status is a clear Node 24 error without FTS5, a normal result with it', () => {
  const out = rpc(fresh(), [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'wiki_status', arguments: {} } }]);
  const res = out[0].result;
  if (FTS5) {
    assert.equal(res.isError, false);
    assert.equal(res.structuredContent.pages, 0);
  } else {
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /Node 24\+ \(or a Node 22\/23 build whose SQLite includes FTS5\)/);
  }
});

// ---------- contract details ----------

test('freshness: a direct md edit with a later mtime is re-indexed', { skip: !FTS5 }, async () => {
  const root = fresh();
  const id = await accept('n', 'edit', 'Editable', 'contains alphaterm here');
  assert.deepEqual(await ids('alphaterm'), [id]);
  const path = join(wd(root), `${id}.md`);
  writeFileSync(path, readFileSync(path, 'utf8').replace('alphaterm', 'betaterm'));
  const later = new Date(Date.now() + 5000);
  utimesSync(path, later, later);
  assert.deepEqual(await ids('betaterm'), [id]);
  assert.deepEqual(await ids('alphaterm'), []);
  rmSync(path);
  assert.deepEqual(await ids('betaterm'), []);
  assert.equal((await call('wiki_list', {})).n, undefined);
});

test('lock: a lock owned by a dead pid is stolen', { skip: !FTS5 }, async () => {
  const root = fresh();
  const p = await call('wiki_propose', { space: 'l', slug: 's', title: 'Steal', body: 'text', source: 't' });
  const child = spawn(process.execPath, ['-e', '']);
  const pid = child.pid;
  await new Promise((r) => child.on('exit', r));
  mkdirSync(join(wd(root), '.lock'));
  writeFileSync(join(wd(root), '.lock', 'owner.json'), JSON.stringify({ pid, at: new Date().toISOString() }));
  await call('wiki_accept', { proposal_id: p.proposal_id });
  assert.ok(existsSync(join(wd(root), 'l', 's.md')));
  assert.ok(!existsSync(join(wd(root), '.lock')));
});

test('lock: a live owner makes accept time out without touching page, INDEX.md or the proposal', { skip: !FTS5 }, async () => {
  const root = fresh();
  await accept('k', 'first', 'First', 'first page');
  const indexBefore = readFileSync(join(wd(root), 'INDEX.md'), 'utf8');
  const p = await call('wiki_propose', { space: 'k', slug: 'second', title: 'Second', body: 'second page', source: 't' });
  mkdirSync(join(wd(root), '.lock'));
  writeFileSync(join(wd(root), '.lock', 'owner.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  wiki.setLockTimeout(300);
  try {
    await assert.rejects(call('wiki_accept', { proposal_id: p.proposal_id }), /lock timeout/);
  } finally { rmSync(join(wd(root), '.lock'), { recursive: true, force: true }); wiki.setLockTimeout(10000); }
  assert.ok(!existsSync(join(wd(root), 'k', 'second.md')));
  assert.equal(readFileSync(join(wd(root), 'INDEX.md'), 'utf8'), indexBefore);
  assert.ok(existsSync(join(wd(root), '_proposed', `${p.proposal_id}.md`)));
});

test('wiki_reject moves the proposal to _rejected/ with the reason', { skip: !FTS5 }, async () => {
  const root = fresh();
  const p = await call('wiki_propose', { space: 'r', slug: 'no', title: 'Nope', body: 'text', source: 't' });
  await call('wiki_reject', { proposal_id: p.proposal_id, reason: 'duplicates r/yes' });
  assert.ok(!existsSync(join(wd(root), '_proposed', `${p.proposal_id}.md`)));
  assert.match(readFileSync(join(wd(root), '_rejected', `${p.proposal_id}.md`), 'utf8'), /reason: "duplicates r\/yes"/);
  assert.ok(!existsSync(join(wd(root), 'r', 'no.md')));
  assert.match(readFileSync(join(wd(root), '.gitignore'), 'utf8'), /\.index\.sqlite\*[\s\S]*\.lock\*/);
});

test('accept: an index failure after the md write is a warning, not an error', { skip: !FTS5 }, async () => {
  const root = fresh();
  const p = await call('wiki_propose', { space: 'w', slug: 'p', title: 'Warn', body: 'text', source: 't' });
  mkdirSync(join(wd(root), 'INDEX.md')); // a directory where the file goes: renderIndex's rename fails
  const out = await call('wiki_accept', { proposal_id: p.proposal_id });
  assert.equal(out.id, 'w/p');
  assert.equal(out.warnings[0].type, 'index');
  assert.ok(existsSync(join(wd(root), 'w', 'p.md')));
  rmSync(join(wd(root), 'INDEX.md'), { recursive: true });
  assert.deepEqual(await ids('text'), ['w/p']);
});

test('slug and space ending in .md are rejected', { skip: !FTS5 }, async () => {
  fresh();
  await assert.rejects(call('wiki_propose', { space: 's', slug: 'x.md', title: 'T', body: 'b', source: 't' }), /not end in \.md/);
  await assert.rejects(call('wiki_propose', { space: 's.md', slug: 'x', title: 'T', body: 'b', source: 't' }), /not end in \.md/);
});
