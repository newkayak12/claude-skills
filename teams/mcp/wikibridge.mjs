// wikibridge.mjs - the task engine's synchronous door into teams-wiki (wiki.mjs), in-process.
//
// Design: _repo/docs/plans/2026-10-07-teams-wiki-memory.md (2단계). The wiki root is always
// task.cwd - never a node/worktree cwd, never process.cwd() - so every call is setRoot -> call ->
// close. Nothing here throws: a wiki failure comes back as {error} (or an empty resume) and the
// EPIC carries on. Reads never create a wiki (no .teams_wiki -> nothing); only proposeLog writes.
// Every function is synchronous (callToolSync); the engine calls them from claim effects and
// createTask, neither of which can await.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { callToolSync, setRoot, close, wikiMode } from './wiki.mjs';
import { epicKey, docPaths } from './tickets.mjs';
import { buildRetro } from './docs.mjs';

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

// The log page a task proposes: a pure function of task.json (the slug date is task.created_at,
// not the clock), so the same task always yields the same bytes.
export function logPage(task) {
  const day = Number.isFinite(task.created_at) ? new Date(task.created_at).toISOString().slice(0, 10) : '0000-00-00';
  const key = epicKey(task.run_id);
  const request = oneLine(task.request);
  let questions = [];
  try { questions = buildRetro(task).next_backlog.open_questions; } catch { /* a task without a full graph has none */ }
  const decisions = (task.decisions || []).map((d) => `- ${oneLine(d.question)} -> ${oneLine(d.chose)}${d.because ? ` (${oneLine(d.because)})` : ''} [${d.owner || d.decided_in || 'task'}]`);
  const L = [`Request: ${cap(request, 400)}`];
  if (decisions.length) L.push('', '## Decisions', ...decisions);
  if (questions.length) L.push('', '## Open questions', ...questions.map((q) => `- ${oneLine(q.question)}`));
  const resumed = (task.wiki && task.wiki.resumed) || [];
  if (resumed.length) L.push('', '## Resumed from', ...resumed.map((id) => `- [[${id}]]`));
  const d = docPaths(task);
  L.push('', '## Docs', `- PRD: ${relative(task.cwd, d.prd)}`, `- Report: ${relative(task.cwd, d.report)}`);
  return {
    space: 'log', slug: `${day}-${key}`, title: `${key}: ${cap(request, 80)}`,
    body: cap(L.join('\n'), BODY_CHARS), source: task.run_id,
  };
}

// An already-proposed log page of this task (a crash between the propose and the engine recording
// it): _proposed/*.md whose frontmatter source and slug match.
function pendingProposal(cwd, page) {
  const dir = join(cwd, '.teams_wiki', '_proposed');
  if (!isDir(dir)) return null;
  const fm = (text, k) => { const m = new RegExp(`^${k}: (.*)$`, 'm').exec(text); try { return m ? JSON.parse(m[1]) : null; } catch { return m && m[1]; } };
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    const text = readFileSync(join(dir, f), 'utf8');
    if (fm(text, 'source') === page.source && fm(text, 'slug') === page.slug) return { proposal_id: f.slice(0, -3), path: join(dir, f) };
  }
  return null;
}

// -> {proposal_id, id, path (relative to task.cwd), reused?} | {error}
export function proposeLog(task) {
  try {
    if (!isDir(task.cwd)) return { error: 'cwd missing' };
    const page = logPage(task);
    const id = `${page.space}/${page.slug}`;
    return withWiki(task.cwd, (call) => {
      const old = pendingProposal(task.cwd, page);
      if (old) return { proposal_id: old.proposal_id, id, path: relative(task.cwd, old.path), reused: true };
      const out = call('wiki_propose', page);
      return { proposal_id: out.proposal_id, id, path: relative(task.cwd, out.path) };
    });
  } catch (e) { return { error: msg(e) }; }
}

// The body of a proposal file as wiki_accept will take it (frontmatter stripped, nothing cut):
// what the goal gate shows its judge. null when the file is gone or unreadable.
export function proposalBody(task, path) {
  try {
    const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/.exec(readFileSync(join(task.cwd, path), 'utf8'));
    return m ? m[1] : null;
  } catch { return null; }
}

// accept -> the page under .teams_wiki/log/; reject -> _rejected/ with a reason (defaulted).
// -> {status: 'accepted'|'rejected', path, reason?} | {error}
export function applyDecision(task, proposalId, accept, reason, by) {
  return withWiki(task.cwd, (call) => {
    if (accept) {
      const out = call('wiki_accept', { proposal_id: proposalId });
      return { status: 'accepted', path: join('.teams_wiki', `${out.id}.md`) };
    }
    const why = oneLine(reason) || `rejected by ${by || 'the gate'}`;
    call('wiki_reject', { proposal_id: proposalId, reason: why });
    return { status: 'rejected', path: join('.teams_wiki', '_rejected', `${proposalId}.md`), reason: why };
  });
}
