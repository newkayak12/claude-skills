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
import { mode, resumeContext, logPage, proposeLog, applyDecision } from '../mcp/wikibridge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'wikibridge-test-'));
process.on('exit', () => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best-effort */ } });

let seq = 0;
const dir = () => { const d = join(TMP, `d${++seq}`); mkdirSync(d, { recursive: true }); return d; };
const taskIn = (cwd, extra = {}) => ({
  run_id: '0123456789abcdef', cwd, request: 'Add a wiki\nsecond line', created_at: Date.UTC(2026, 9, 7, 23, 59),
  decisions: [{ question: 'Which store?', chose: 'md files', because: 'git-tracked', owner: 'requester' }], nodes: [], ...extra,
});
const proposed = (cwd) => (existsSync(join(cwd, '.teams_wiki', '_proposed')) ? readdirSync(join(cwd, '.teams_wiki', '_proposed')) : []);
// An accepted log page, made the way the wiki makes one.
function seedLog(task, extra = {}) {
  const r = proposeLog({ ...task, ...extra });
  assert.ok(!r.error, r.error);
  assert.equal(applyDecision(task, r.proposal_id, true).status, 'accepted');
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
    const r = proposeLog(t);
    assert.ok(!r.error, r.error);
    assert.equal(proposed(task).length, 1);
    assert.equal(applyDecision(t, r.proposal_id, true).status, 'accepted');
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

test('never throws: .teams_wiki is a regular file -> {error} from every write path', () => {
  const cwd = dir();
  writeFileSync(join(cwd, '.teams_wiki'), 'x');
  const t = taskIn(cwd);
  assert.ok(proposeLog(t).error);
  assert.ok(applyDecision(t, 'p-nope', true).error);
  assert.ok(applyDecision(t, 'p-nope', false, 'r').error);
  assert.ok(proposeLog(taskIn(join(cwd, 'missing'))).error, 'a cwd that does not exist is an error, not a mkdir');
  assert.equal(existsSync(join(cwd, 'missing')), false);
  assert.ok(proposeLog({}).error, 'a malformed task is an error too');
});

test('logPage: pure function of task.json, date from created_at, valid slug, capped body', () => {
  const t = taskIn(dir(), { wiki: { resumed: ['log/2026-01-01-E-aaaaaaaa'] } });
  const a = logPage(t);
  assert.deepEqual(logPage(JSON.parse(JSON.stringify(t))), a);
  assert.equal(a.slug, '2026-10-07-E-01234567');
  assert.equal(a.space, 'log');
  assert.equal(a.source, t.run_id);
  assert.match(a.slug, /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u);
  assert.match(a.body, /Request: Add a wiki second line/);
  assert.match(a.body, /Which store\? -> md files \(git-tracked\) \[requester\]/);
  assert.match(a.body, /\[\[log\/2026-01-01-E-aaaaaaaa\]\]/);
  assert.match(a.body, /10-prd\.md/);
  assert.match(a.body, /80-report\.md/);
  assert.ok(!a.body.includes(t.cwd), 'doc paths are relative, never absolute');
  const huge = logPage(taskIn(dir(), { request: 'x'.repeat(50000), decisions: Array.from({ length: 500 }, (_, i) => ({ question: `q${i}`, chose: 'y'.repeat(50) })) }));
  assert.ok(huge.body.length <= 4000);
});

test('reuse: a pending proposal of the same task and slug is returned, not proposed again', () => {
  const cwd = dir();
  const t = taskIn(cwd);
  const first = proposeLog(t);
  const again = proposeLog(t); // the engine crashed before recording `first`
  assert.equal(again.proposal_id, first.proposal_id);
  assert.equal(again.reused, true);
  assert.equal(proposed(cwd).length, 1);
  const other = proposeLog(taskIn(cwd, { run_id: 'fedcba9876543210' }));
  assert.notEqual(other.proposal_id, first.proposal_id, 'another task is not a reuse');
  assert.equal(proposed(cwd).length, 2);
});

test('decision: accept moves the proposal to log/<slug>.md; reject files it under _rejected with a reason', () => {
  const cwd = dir();
  const t = taskIn(cwd);
  const p = proposeLog(t);
  const acc = applyDecision(t, p.proposal_id, true, null, 'gate:goal:1');
  assert.equal(acc.status, 'accepted');
  assert.equal(acc.path, join('.teams_wiki', 'log', `${logPage(t).slug}.md`));
  assert.equal(proposed(cwd).length, 0);
  const t2 = taskIn(cwd, { run_id: 'fedcba9876543210' });
  const p2 = proposeLog(t2);
  const rej = applyDecision(t2, p2.proposal_id, false, '', 'gate:goal:1');
  assert.equal(rej.status, 'rejected');
  assert.ok(rej.reason.trim());
  assert.ok(existsSync(join(cwd, rej.path)));
  assert.match(readFileSync(join(cwd, rej.path), 'utf8'), /reason:/);
  const t3 = taskIn(cwd, { run_id: '1111111111111111' });
  assert.equal(applyDecision(t3, proposeLog(t3).proposal_id, false, 'duplicate of E-0123').reason, 'duplicate of E-0123');
});

test('wikibridge.mjs imports only node:*, wiki, tickets, docs; all sync', () => {
  const src = readFileSync(join(HERE, '..', 'mcp', 'wikibridge.mjs'), 'utf8');
  const from = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(from.filter((f) => !f.startsWith('node:')).sort(), ['./docs.mjs', './tickets.mjs', './wiki.mjs']);
  assert.doesNotMatch(src, /\basync\b|await |fetch\(|node:(http|https|net|dns|tls)/);
});
