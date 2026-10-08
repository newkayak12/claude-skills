// reportPayload(): the pure builder behind `view.mjs --once --format report` (the teams-live mod's
// Report tab and end-of-run card). Takes a task.json object, resolves its report paths with
// docPaths (so a custom docs_dir works), and returns one plain-JSON payload. Every read failure
// becomes null; nothing here throws.
import { readFileSync, statSync } from 'node:fs';
import { docPaths } from '../../mcp/tickets.mjs';
import { runState } from '../../mcp/graph.mjs';

export const REPORT_CAP = 20000;
const MAX_ITEMS = 3;

const lineCount = (s) => s.split('\n').length;

// Cap at REPORT_CAP chars on a line boundary. more_lines = original lines - kept lines.
function capText(full) {
  if (full.length <= REPORT_CAP) return { text: full, truncated: false, more_lines: 0 };
  let text = full.slice(0, REPORT_CAP);
  const cut = text.lastIndexOf('\n');
  if (cut > 0) text = text.slice(0, cut);
  return { text, truncated: true, more_lines: Math.max(0, lineCount(full.replace(/\n$/, '')) - lineCount(text)) };
}

// The bullets of a `## <heading>` section of a report.
function sectionBullets(text, heading) {
  const out = [];
  let on = false;
  for (const line of text.split('\n')) {
    if (/^## /.test(line)) { on = line.trim() === `## ${heading}`; continue; }
    const m = on && line.match(/^- (.+)$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

// Field names as renderRetro (mcp/docs.mjs buildRetro) writes them: next_backlog.unaccepted_packages
// {id,title,reason}, unresolved_defects {title}, open_questions {question}. A missing field adds nothing.
function retroItems(retro) {
  const nb = (retro && retro.next_backlog) || {};
  const list = (v) => (Array.isArray(v) ? v : []);
  const items = [];
  for (const p of list(nb.unaccepted_packages)) {
    const name = p && (p.title || p.id);
    if (name) items.push(p.reason ? `${name}: ${p.reason}` : String(name));
  }
  for (const d of list(nb.unresolved_defects)) if (d && d.title) items.push(String(d.title));
  for (const q of list(nb.open_questions)) if (q && q.question) items.push(String(q.question));
  return items;
}

export function reportPayload(task, { read = readFileSync, stat = statSync } = {}) {
  const t = task || {};
  const task_id = String(t.run_id || t.task_id || '');
  let verdict = 'running';
  let failed = 0;
  let path = '';
  let paths = null;
  try {
    const rs = runState({ nodes: Array.isArray(t.nodes) ? t.nodes : [] });
    verdict = rs.state === 'complete' ? 'finished' : rs.state === 'running' || rs.state === 'waiting_human' ? 'running' : 'blocked';
    failed = (rs.counts && rs.counts.failed) || 0;
  } catch { /* an unreadable graph reads as running with no failures */ }
  try {
    paths = docPaths(t);
    path = paths.report;
  } catch { /* no cwd or run_id: no path */ }

  let report = null;
  let full = null;
  let retro = null;
  if (paths) {
    try {
      full = String(read(paths.report, 'utf8'));
      report = { ...capText(full), mtime: Number(stat(paths.report).mtimeMs) || 0 };
    } catch { full = null; report = null; }
    try { retro = JSON.parse(String(read(paths.retro, 'utf8'))); } catch { retro = null; }
    if (retro === null || typeof retro !== 'object') retro = null;
  }

  let all = [];
  if (verdict === 'blocked' && full !== null) all = sectionBullets(full, 'What would move it');
  if (all.length === 0 && retro) all = retroItems(retro);
  return {
    task_id, verdict, failed,
    needs: { items: all.slice(0, MAX_ITEMS), more: Math.max(0, all.length - MAX_ITEMS) },
    path, report, retro,
  };
}
