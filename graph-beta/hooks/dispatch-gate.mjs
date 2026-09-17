#!/usr/bin/env node
// PreToolUse: the driving session dispatches work, it does not do the work.
//
// The bench measured the shape this enforces. A session driving the harness well shows
// `top-level edits 0` - every file it changed, a node changed. A session that starts
// editing the project itself has stopped orchestrating and is doing the work inline,
// which is how the manager's whole reason for existing gets skipped and how the driving
// session's context grows (measured: 507k tokens over 331 turns, ~55% of a task's cost).
//
// So: before any task or run is open, a gated write is denied with the instruction to
// open one. Once the harness is engaged every write passes - nodes have to write, and
// telling a node's fresh agent it may not write would brick the run.
//
// Opt in per project with .claude/graph-beta-dispatch.json. No file, no gate.
//   {"paths": ["src/**", "packages/**"], "min_chars": 400, "allow": ["**/*.test.*"]}
// Every field is optional: no "paths" gates everything under the project, "min_chars"
// lets small edits through, "allow" exempts paths outside the gate.
//
// Fails open on every error, every ambiguity, every unreadable file. A hook that blocks
// a session because it could not parse its own config is worse than no hook.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ALLOW = 0;
const DENY = 2;

function read(stream) {
  try {
    return readFileSync(stream, 'utf8');
  } catch {
    return '';
  }
}

// A glob with * (within a segment), ** (across segments) and ? - enough for path lists,
// and a plain prefix match when someone writes a bare directory name.
function matches(pattern, path) {
  const p = String(pattern);
  if (!/[*?]/.test(p)) return path === p || path.startsWith(p.replace(/\/+$/, '') + '/');
  const rx = p
    .split('**')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
    .join('.*');
  try {
    return new RegExp(`^${rx}$`).test(path);
  } catch {
    return false;
  }
}

// Any task or run file on disk means the harness is engaged and its nodes are working.
function harnessEngaged(cwd) {
  const tasksRoot = process.env.HARNESS_TASKS_DIR
    ? resolve(process.env.HARNESS_TASKS_DIR)
    : join(process.env.HOME || '', '.harness', 'tasks');
  for (const dir of [tasksRoot, join(cwd, '.harness-run', 'broker-beta', 'runs')]) {
    try {
      if (existsSync(dir) && readdirSync(dir).length) return true;
    } catch {
      /* unreadable is not engaged */
    }
  }
  // The harness plugin's own gate writes .claude/.harness-markers/<session> (content Date.now())
  // while it is engaged; a recent one means its nodes are the ones writing here.
  try {
    const dir = join(cwd, '.claude', '.harness-markers');
    const now = Date.now();
    for (const f of readdirSync(dir)) {
      const ts = parseInt(readFileSync(join(dir, f), 'utf8'), 10) || 0;
      if (now - ts <= 2 * 60 * 60 * 1000) return true;
    }
  } catch {
    /* no markers dir: not engaged this way */
  }
  return false;
}

function targetOf(input) {
  const i = input || {};
  return i.file_path || i.notebook_path || i.path || '';
}

function sizeOf(input) {
  const i = input || {};
  if (typeof i.content === 'string') return i.content.length;
  if (typeof i.new_string === 'string') return i.new_string.length;
  if (Array.isArray(i.edits)) return i.edits.reduce((n, e) => n + String(e?.new_string || '').length, 0);
  return Infinity; // unknown size is not a reason to let something through
}

function main() {
  let hook;
  try {
    hook = JSON.parse(read(0));
  } catch {
    return ALLOW;
  }
  const cwd = hook.cwd || process.cwd();
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(join(cwd, '.claude', 'graph-beta-dispatch.json'), 'utf8'));
  } catch {
    return ALLOW; // no opt-in, or unreadable config: no gate
  }
  if (!cfg || typeof cfg !== 'object') return ALLOW;

  const file = targetOf(hook.tool_input);
  if (!file) return ALLOW;
  let rel;
  try {
    rel = relative(cwd, resolve(cwd, file)).split(sep).join('/');
  } catch {
    return ALLOW;
  }
  if (!rel || rel.startsWith('..')) return ALLOW; // outside the project is not ours to gate
  // Never gate the harness's own state, or a file inside a package worktree: that is node
  // work by definition.
  if (rel.startsWith('.harness-run/') || rel.startsWith('.harness-tasks/') || rel.startsWith('.claude/')) return ALLOW;

  const allow = Array.isArray(cfg.allow) ? cfg.allow : [];
  if (allow.some((p) => matches(p, rel))) return ALLOW;
  const paths = Array.isArray(cfg.paths) && cfg.paths.length ? cfg.paths : ['**'];
  if (!paths.some((p) => matches(p, rel))) return ALLOW;

  const min = Number.isFinite(cfg.min_chars) ? cfg.min_chars : 0;
  if (sizeOf(hook.tool_input) < min) return ALLOW;

  if (harnessEngaged(cwd)) return ALLOW; // nodes are running; they are the ones writing

  process.stderr.write(
    `graph-beta: ${rel} is under dispatch control, and no task or run is open yet.\n` +
      `This session drives the work, it does not do the work: open one first and let a node write this.\n` +
      `  tm_open({request: "<the user's request, in their words>", cwd: "${cwd}"})\n` +
      `tm_open sizes the request itself - a small one comes straight back as a single graph run to drive,\n` +
      `a large one becomes packages with their own worktrees. Either way the writing happens in a node,\n` +
      `where it is gated, reviewed by a different identity, and committed on its own branch.\n` +
      `To edit directly instead, remove .claude/graph-beta-dispatch.json or add "${rel}" to its "allow".\n`,
  );
  return DENY;
}

process.exit(main());
