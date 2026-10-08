// wikibridge.mjs - the task engine's synchronous door into teams-wiki (wiki.mjs), in-process.
//
// Design: _repo/docs/plans/2026-10-07-teams-wiki-memory.md (2단계). The wiki root is always
// task.cwd - never a node/worktree cwd, never process.cwd() - so every call is setRoot -> call ->
// close. Nothing here throws: a wiki failure comes back as {error} (or an empty resume) and the
// EPIC carries on. Reads never create a wiki (no .teams_wiki -> nothing); only writeLog writes.
// Every function is synchronous (callToolSync); the engine calls them from createTask and
// after the report node commits, neither of which can await.

import { statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { callToolSync, setRoot, close, wikiMode } from './wiki.mjs';
import { epicKey, docPaths } from './tickets.mjs';
import { buildRetro, shippedPackages } from './docs.mjs';

const RESUME_K = 3;
const RESUME_CHARS = 2400;
const BODY_CHARS = 4000;

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const msg = (e) => String((e && e.message) || e);
const cap = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// setRoot -> call -> close, never throwing. wiki.mjs keeps its root in a module global, so the
// root is set on every call, not once.
function withWiki(cwd, fn) {
  try {
    setRoot(cwd);
    return fn((name, args) => callToolSync(name, args));
  } catch (e) {
    return { error: msg(e) };
  } finally {
    try { close(); } catch { /* nothing open */ }
  }
}

// 'fts5' | 'scan' - what tm_status shows.
export function mode() {
  try { return wikiMode(); } catch { return 'scan'; }
}

const summary = (body) => {
  const line = String(body).split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.startsWith('---'));
  return cap(oneLine(line || ''), 200);
};

// The k most recent accepted log pages with their 1-hop links, as a context block for a new task.
// {text: '', ids: []} when there is no wiki, no log page, or the wiki fails.
export function resumeContext(cwd) {
  const none = { text: '', ids: [] };
  if (!isDir(join(cwd, '.teams_wiki'))) return none;
  const out = withWiki(cwd, (call) => call('wiki_resume', { k: RESUME_K }));
  if (out.error || !Array.isArray(out.pages) || !out.pages.length) return none;
  const L = ['## Project memory (teams wiki)', ''];
  for (const p of out.pages) {
    L.push(`- [[${p.id}]] ${p.title}: ${summary(p.body)}`);
    for (const l of p.links) L.push(`  - links [[${l.id}]]${l.title ? ` ${l.title}` : ''}${l.summary ? `: ${cap(oneLine(l.summary), 120)}` : ''}`);
  }
  L.push('', 'Cite pages by id ([[space/slug]]) when you rely on them.');
  return { text: cap(L.join('\n'), RESUME_CHARS), ids: out.pages.map((p) => p.id) };
}

// The package ids this task shipped, in task.spec.packages order (docs.mjs shippedPackages).
function shippedList(task) {
  let unaccepted = [];
  try { unaccepted = buildRetro(task).next_backlog.unaccepted_packages; } catch { /* a task without a full graph */ }
  const set = shippedPackages(task, unaccepted);
  return ((task.spec && task.spec.packages) || []).filter((p) => set.has(String(p.id)));
}

// The log page of a task: a pure function of task.json (the slug date is task.created_at, not the
// clock). Shipped work only - what was decided or left open is not the engine's to state.
export function logPage(task) {
  const day = Number.isFinite(task.created_at) ? new Date(task.created_at).toISOString().slice(0, 10) : '0000-00-00';
  const key = epicKey(task.run_id);
  const request = oneLine(task.request);
  const shipped = shippedList(task);
  const L = [`Request: ${cap(request, 400)}`];
  if (shipped.length) L.push('', '## Shipped', ...shipped.map((p) => `- ${p.id}: ${oneLine(p.title)}`));
  const resumed = (task.wiki && task.wiki.resumed) || [];
  if (resumed.length) L.push('', '## Resumed from', ...resumed.map((id) => `- [[${id}]]`));
  const d = docPaths(task);
  L.push('', '## Docs', `- PRD: ${relative(task.cwd, d.prd)}`, `- Report: ${relative(task.cwd, d.report)}`);
  return {
    space: 'log', slug: `${day}-${key}`, title: `${key}: ${cap(request, 80)}`,
    body: cap(L.join('\n'), BODY_CHARS), source: task.run_id,
    shipped: shipped.map((p) => String(p.id)),
  };
}

// Writes the log page with wiki_write (same id = update). Nothing shipped -> skipped, before any
// wiki file access. -> {id, path (relative to task.cwd), status: 'written', shipped} | {status: 'skipped'} | {status: 'error', error}
export function writeLog(task) {
  try {
    const { shipped, ...page } = logPage(task);
    if (!shipped.length) return { status: 'skipped' };
    if (!isDir(task.cwd)) return { status: 'error', error: 'cwd missing' };
    const out = withWiki(task.cwd, (call) => call('wiki_write', page));
    if (out.error) return { status: 'error', error: out.error };
    return { id: out.id, path: relative(task.cwd, out.path), status: 'written', shipped };
  } catch (e) { return { status: 'error', error: msg(e) }; }
}

// The ids logPage would list as shipped - what the engine compares with task.wiki.log.shipped.
export const shippedIds = (task) => shippedList(task).map((p) => String(p.id));
