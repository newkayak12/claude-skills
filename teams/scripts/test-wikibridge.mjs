#!/usr/bin/env node
// test-wikibridge.mjs - teams/mcp/wikibridge.mjs: the task engine's in-process door into teams-wiki.
// Design: _repo/docs/plans/2026-10-07-teams-wiki-memory.md (2단계).
//
//   node --test teams/scripts/test-wikibridge.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setRoot } from '../mcp/wiki.mjs';
import { mode, resumeContext, logPage, writeLog, shippedIds } from '../mcp/wikibridge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'wikibridge-test-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ } });

let seq = 0;
const dir = () => { const d = join(TMP, `d${++seq}`); mkdirSync(d, { recursive: true }); return d; };
const pkg = (id, title) => ({ id, title, flow: 'develop', deps: [], touches: [] });
// A task whose final integrate is done and holds P1 and P2 (both accepted); P3 is accepted but not merged.
const taskIn = (cwd, extra = {}) => ({
  run_id: '0123456789abcdef', cwd, request: 'Add a wiki\nsecond line', created_at: Date.UTC(2026, 9, 7, 23, 59),
  decisions: [{ question: 'Which store?', chose: 'md files', because: 'git-tracked', owner: 'requester' }],
  spec: { acceptance: [], packages: [pkg('P1', 'first  package'), pkg('P2', 'second'), pkg('P3', 'unmerged')] },
  nodes: [
    { node_id: 'integrate:1', stage: 'integrate', state: 'done', deps: [], integration: { merged: [{ package: 'P1' }, { package: 'P2' }] } },
    ...['P1', 'P2', 'P3'].map((id) => ({ node_id: `accept:${id}:1`, stage: 'accept', subgoal_id: id, state: 'done', deps: [], result: { accept: true } })),
  ],
  ...extra,
});
const noneShipped = (cwd) => taskIn(cwd, { nodes: [] });
const pageFile = (cwd, id) => join(cwd, '.teams_wiki', `${id}.md`);
// A written log page, the way the engine writes one.
function seedLog(task) {
  const r = writeLog(task);
  assert.equal(r.status, 'written', r.error);
  return r;
}

test('mode reports fts5 or scan', () => {
  assert.ok(['fts5', 'scan'].includes(mode()));
});

test('root: every call lands under task.cwd, whatever process.cwd() and wiki.mjs last used', () => {
  const task = dir(), other = dir(), start = process.cwd();
  process.chdir(other);
  try {
    setRoot(other); // a stale root elsewhere
    const t = taskIn(task);
    assert.equal(writeLog(t).status, 'written');
    assert.ok(existsSync(join(task, '.teams_wiki', 'log', `${logPage(t).slug}.md`)));
    assert.ok(resumeContext(task).ids.length);
    assert.deepEqual(readdirSync(other), [], 'nothing created under the other directory');
  } finally { process.chdir(start); }
});

test('resume: no .teams_wiki, no log page, or a failing wiki -> empty, and nothing is created', () => {
  const none = dir();
  assert.deepEqual(resumeContext(none), { text: '', ids: [] });
  assert.deepEqual(readdirSync(none), []);
  const noLog = dir();
  mkdirSync(join(noLog, '.teams_wiki', '_proposed'), { recursive: true });
  assert.deepEqual(resumeContext(noLog), { text: '', ids: [] });
  const broken = dir();
  writeFileSync(join(broken, '.teams_wiki'), 'not a directory');
  assert.deepEqual(resumeContext(broken), { text: '', ids: [] });
});

test('resume: a log page gives a bounded block with id, title, summary and the cite line', () => {
  const cwd = dir();
  const t = taskIn(cwd);
  seedLog(t);
  const r = resumeContext(cwd);
  const page = logPage(t);
  assert.deepEqual(r.ids, [`log/${page.slug}`]);
  assert.match(r.text, new RegExp(`\\[\\[log/${page.slug}\\]\\]`));
  assert.match(r.text, /Add a wiki/);
  assert.match(r.text, /Cite pages by id/);
  assert.ok(r.text.length <= 2400);
});

test('never throws: .teams_wiki is a regular file -> status error from writeLog, no throw', () => {
  const cwd = dir();
  writeFileSync(join(cwd, '.teams_wiki'), 'x');
  assert.equal(writeLog(taskIn(cwd)).status, 'error');
  assert.equal(writeLog(taskIn(join(cwd, 'missing'))).status, 'error', 'a cwd that does not exist is an error, not a mkdir');
  assert.equal(existsSync(join(cwd, 'missing')), false);
  assert.equal(writeLog({}).status, 'error', 'a malformed task is an error, not a throw');
});

test('logPage: Request + Shipped (spec order, id: title) + Resumed from + Docs; no Decisions, no Open questions; pure, capped', () => {
  const t = taskIn(dir(), { wiki: { resumed: ['log/2026-01-01-E-aaaaaaaa'] } });
  const a = logPage(t);
  assert.deepEqual(logPage(JSON.parse(JSON.stringify(t))), a);
  assert.equal(a.slug, '2026-10-07-E-01234567');
  assert.equal(a.space, 'log');
  assert.equal(a.source, t.run_id);
  assert.match(a.slug, /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u);
  assert.match(a.body, /Request: Add a wiki second line/);
  assert.match(a.body, /## Shipped\n- P1: first package\n- P2: second\n\n## Resumed from/);
  assert.doesNotMatch(a.body, /P3|## Decisions|## Open questions|Which store/);
  assert.match(a.body, /\[\[log\/2026-01-01-E-aaaaaaaa\]\]/);
  assert.match(a.body, /10-prd\.md/);
  assert.match(a.body, /80-report\.md/);
  assert.ok(!a.body.includes(t.cwd), 'doc paths are relative, never absolute');
  assert.deepEqual(shippedIds(t), ['P1', 'P2']);
  const huge = logPage(taskIn(dir(), { request: 'x'.repeat(50000) }));
  assert.ok(huge.body.length <= 4000);
});

test('writeLog: wiki_write saves the page directly (no _proposed), and the same task again updates it in place', () => {
  const cwd = dir();
  const t = taskIn(cwd);
  const r = writeLog(t);
  assert.deepEqual({ ...r, path: undefined }, { id: `log/${logPage(t).slug}`, path: undefined, status: 'written', shipped: ['P1', 'P2'] });
  assert.equal(r.path, join('.teams_wiki', 'log', `${logPage(t).slug}.md`));
  assert.equal(existsSync(pageFile(cwd, r.id)), true);
  assert.equal(existsSync(join(cwd, '.teams_wiki', '_proposed')) && readdirSync(join(cwd, '.teams_wiki', '_proposed')).length, false);
  assert.match(readFileSync(pageFile(cwd, r.id), 'utf8'), /- P1: first package/);
  const again = writeLog(taskIn(cwd, { spec: { packages: [pkg('P1', 'first'), pkg('P2', 'second'), pkg('P3', 'x')] } }));
  assert.equal(again.id, r.id);
  assert.match(readFileSync(pageFile(cwd, r.id), 'utf8'), /- P1: first\n/);
  assert.equal(readdirSync(join(cwd, '.teams_wiki', 'log')).filter((f) => f.endsWith('.md')).length, 1);
});

test('writeLog: nothing shipped -> skipped, and no wiki file is touched (not even a missing wiki is created)', () => {
  const cwd = dir();
  assert.deepEqual(writeLog(noneShipped(cwd)), { status: 'skipped' });
  assert.equal(existsSync(join(cwd, '.teams_wiki')), false);
  writeFileSync(join(cwd, '.teams_wiki'), 'x');
  assert.deepEqual(writeLog(noneShipped(cwd)), { status: 'skipped' }, 'skipped before any wiki access, so no error either');
});

test('wikibridge.mjs imports only node:*, wiki, tickets, docs; all sync', () => {
  const src = readFileSync(join(HERE, '..', 'mcp', 'wikibridge.mjs'), 'utf8');
  const from = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(from.filter((f) => !f.startsWith('node:')).sort(), ['./docs.mjs', './tickets.mjs', './wiki.mjs']);
  assert.doesNotMatch(src, /\basync\b|await |fetch\(|node:(http|https|net|dns|tls)/);
});
