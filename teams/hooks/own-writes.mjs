#!/usr/bin/env node
// PostToolUse: a size-S run records the files its own session writes.
//
// The engine sets TEAMS_OWN_WRITES=<abs checkout>/.harness-run/writes/<task id>.jsonl and
// TEAMS_OWN_RUN=<task id> on that driver only. Without them this hook does nothing, so another
// run on the same checkout (or a plain session) never records here. One line per write:
//   {ts, run_id, node_id, path}   node_id 'S', or 'S:<agent_id>' from a subagent
// path is relative to the checkout root, or absolute when outside it.
//
// Fails open on every error: always exit 0, never print.
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

function realOf(p) {
  // The file may not exist (a deleted patch target): resolve its nearest existing ancestor.
  let rest = '';
  let cur = resolve(p);
  for (;;) {
    try { return join(realpathSync(cur), rest); } catch { /* climb */ }
    const up = dirname(cur);
    if (up === cur) return resolve(p);
    rest = join(cur.slice(up.length + 1), rest);
    cur = up;
  }
}

function patchTargets(command) {
  return [...String(command || '').matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)].map((m) => m[1].trim());
}

function targetsOf(hook) {
  const input = hook.tool_input || {};
  if (hook.tool_name === 'apply_patch') return patchTargets(input.command);
  return [input.file_path || input.notebook_path].filter(Boolean);
}

function main() {
  const out = process.env.TEAMS_OWN_WRITES;
  const runId = process.env.TEAMS_OWN_RUN;
  if (!out || !runId) return;
  const norm = out.split(sep).join('/');
  if (!isAbsolute(out) || !out.endsWith('.jsonl') || !norm.includes('/.harness-run/writes/')) return;

  const hook = JSON.parse(readFileSync(0, 'utf8'));
  const root = realOf(dirname(dirname(dirname(out))));
  const cwd = typeof hook.cwd === 'string' && hook.cwd ? hook.cwd : root;
  const nodeId = typeof hook.agent_id === 'string' && hook.agent_id !== '' ? `S:${hook.agent_id}` : 'S';

  const lines = [];
  for (const target of targetsOf(hook)) {
    const abs = realOf(resolve(cwd, String(target)));
    const rel = relative(root, abs).split(sep).join('/');
    const inside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    if (inside && (rel === '.harness-run' || rel.startsWith('.harness-run/'))) continue;
    lines.push(JSON.stringify({ ts: new Date().toISOString(), run_id: runId, node_id: nodeId, path: inside ? rel : abs }));
  }
  if (!lines.length) return;
  mkdirSync(dirname(out), { recursive: true });
  appendFileSync(out, lines.join('\n') + '\n');
}

try {
  main();
} catch {
  /* fail open */
}
process.exit(0);
