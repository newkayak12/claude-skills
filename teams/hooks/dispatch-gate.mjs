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
// Opt in per project with .claude/teams-dispatch.json. No file, no gate.
//   {"paths": ["src/**", "packages/**"], "min_chars": 400, "allow": ["**/*.test.*"]}
// Every field is optional: no "paths" gates everything under the project, "min_chars"
// lets small edits through, "allow" exempts paths outside the gate.
//
// Fails open on every error, every ambiguity, every unreadable file. A hook that blocks
// a session because it could not parse its own config is worse than no hook.
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
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

// Engaged means a task for THIS project is still open, or a run in this project moved recently -
// not that some task ever ran on this machine. The old test (any file under ~/.harness/tasks)
// was true forever after a machine's first task, and the gate never fired again.
const RUN_FRESH_MS = 2 * 60 * 60 * 1000;
function samePath(p) { try { return realpathSync(p); } catch { return resolve(p); } }
function taskOpenFor(cwd, tasksRoot) {
  let ids = [];
  try { ids = readdirSync(tasksRoot); } catch { return false; }
  const here = samePath(cwd);
  for (const id of ids) {
    let task;
    try { task = JSON.parse(readFileSync(join(tasksRoot, id, 'task.json'), 'utf8')); } catch { continue; }
    if (!task || samePath(String(task.cwd || '')) !== here) continue;
    let ledger = '';
    try { ledger = readFileSync(join(tasksRoot, id, 'ledger.jsonl'), 'utf8'); } catch { /* no ledger yet: just opened */ }
    const last = ledger.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
      .filter((e) => e.event === 'daemon_done' || e.event === 'tm_open' || e.event === 'tm_retry' || e.event === 'daemon_spawned').pop();
    if (!last || last.event !== 'daemon_done') return true;
  }
  return false;
}

function harnessEngaged(cwd) {
  const tasksRoot = process.env.HARNESS_TASKS_DIR
    ? resolve(process.env.HARNESS_TASKS_DIR)
    : join(process.env.HOME || '', '.harness', 'tasks');
  if (taskOpenFor(cwd, tasksRoot)) return true;
  try {
    const runs = join(cwd, '.teams_output', 'broker', 'runs');
    const now = Date.now();
    for (const f of readdirSync(runs)) if (now - statSync(join(runs, f)).mtimeMs <= RUN_FRESH_MS) return true;
  } catch {
    /* no runs here */
  }
  // The harness plugin's own gate writes .claude/.harness-markers/<session> (content Date.now())
  // while it is engaged; a recent one means its nodes are the ones writing here.
  try {
    const dir = join(cwd, '.claude', '.harness-markers');
    const now = Date.now();
    for (const f of readdirSync(dir)) {
      const ts = parseInt(readFileSync(join(dir, f), 'utf8'), 10) || 0;
      if (now - ts <= RUN_FRESH_MS) return true;
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

function patchTargets(command) {
  return [...String(command || '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim());
}

function sizeOf(input) {
  const i = input || {};
  if (typeof i.content === 'string') return i.content.length;
  if (typeof i.new_string === 'string') return i.new_string.length;
  if (Array.isArray(i.edits)) return i.edits.reduce((n, e) => n + String(e?.new_string || '').length, 0);
  if (typeof i.command === 'string' && /^\*\*\* (?:Begin Patch|Add|Update|Delete) File:/m.test(i.command)) {
    return i.command.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .reduce((n, line) => n + line.slice(1).length, 0);
  }
  return Infinity; // unknown size is not a reason to let something through
}

// ROUTE-BEGIN (byte-identical in harness/hooks/goal-gate.mjs and teams/hooks/dispatch-gate.mjs; _repo/scripts/check-copies.mjs)
// The routing paragraph when teams and harness or graph are both installed in dir, else ''.
// Any error gives '': the caller keeps its own message.
function routeText(dir) {
  try {
    const json = (f) => {
      try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
    };
    const has = (f) => json(join(dir, f)) !== null;
    const harness = has('.claude/harness-gate.json');
    const teams = has('.claude/teams-dispatch.json');
    const on = (f) => json(f)?.enabledPlugins?.['graph@newkayak12-claude-skills'] === true;
    const graph = Boolean(json(join(dir, '.mcp.json'))?.mcpServers?.['graph-engineering']) ||
      on(join(dir, '.claude', 'settings.json')) || on(join(process.env.HOME || '~', '.claude', 'settings.json'));
    if (!teams || !(harness || graph)) return '';
    const simple = graph ? 'graph:orchestrate' : 'harness:harness';
    return `This project also dispatches through ${['teams', harness && 'harness', graph && 'graph'].filter(Boolean).join(' + ')}; route by the kind of work.\n` +
      `  - Simple development (a code change with its tests, one area) -> Skill({skill: "${simple}"})\n` +
      `  - A spec document, planning, QA, several areas, or unsure -> Skill({skill: "teams:orchestrate", args: "<the user's request>"})\n`;
  } catch {
    return '';
  }
}
// ROUTE-END

// NODE-BEGIN (byte-identical in harness/hooks/goal-gate.mjs, teams/hooks/dispatch-gate.mjs and graph/hooks/node-gate.mjs; _repo/scripts/check-copies.mjs)
// A run node (a subagent: hook input has agent_id; a graph/teams worker process: HARNESS_NODE=1)
// must never open a run again. These are the skills that open one.
const ENTRY_SKILL_RE = /^(?:(?:harness:)?harness|graph:orchestrate|teams:(?:orchestrate|develop|sprint|document|plan|qa))$/;
const ENTRY_MCP_RE = /(?:^|__)(graph_open|tm_open|tm_run)$/;
const entryCall = (input) => {
  const tool = String(input?.tool_name || '');
  const skill = tool === 'Skill' ? input?.tool_input?.skill : null;
  if (typeof skill === 'string' && ENTRY_SKILL_RE.test(skill)) return `Skill ${skill}`;
  return ENTRY_MCP_RE.test(tool) ? tool : '';
};
const SUBAGENT_NOTE = 'A subagent that sees this must not invoke the harness again — stop and report to its caller.';
const SUBAGENT_STOP = 'You are inside a run. Do not invoke the harness skill, graph, teams, Workflow or open a run. ' +
  'Stop and report this block (file + reason) to your caller.';
// 'node' (HARNESS_NODE=1), 'agent' (agent_id), or '' (a main session)
const nodeKind = (input) => (process.env.HARNESS_NODE === '1' ? 'node' : input && typeof input.agent_id === 'string' && input.agent_id !== '' ? 'agent' : '');
// NODE-END

function main() {
  let hook;
  try {
    hook = JSON.parse(read(0));
  } catch {
    return ALLOW;
  }
  const cwd = hook.cwd || process.cwd();
  const kind = nodeKind(hook);
  const entry = entryCall(hook);
  if (entry && !kind) {
    return ALLOW;
  }
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(join(cwd, '.claude', 'teams-dispatch.json'), 'utf8'));
  } catch {
    // no opt-in, or unreadable config: no gate - except a worker process, which is never to open a run
    if (entry && kind === 'node') {
      process.stderr.write(`${entry}: ${SUBAGENT_STOP}\n`);
      return DENY;
    }
    return ALLOW;
  }
  if (!cfg || typeof cfg !== 'object') return ALLOW;
  if (entry) {
    process.stderr.write(`${entry}: ${SUBAGENT_STOP}\n`);
    return DENY;
  }

  const files = hook.tool_name === 'apply_patch'
    ? patchTargets(hook.tool_input && hook.tool_input.command)
    : [targetOf(hook.tool_input)].filter(Boolean);
  if (!files.length) return ALLOW;
  let rels;
  try {
    rels = files.map((file) => relative(cwd, resolve(cwd, file)).split(sep).join('/'))
      .filter((rel) => rel && !rel.startsWith('..'));
  } catch {
    return ALLOW;
  }
  if (!rels.length) return ALLOW; // outside the project is not ours to gate
  // Never gate the harness's own state, or a file inside a package worktree: that is node
  // work by definition.
  rels = rels.filter((rel) => !rel.startsWith('.harness-run/') && !rel.startsWith('.teams_output/') &&
    !rel.startsWith('.harness-tasks/') && !rel.startsWith('.claude/'));
  if (!rels.length) return ALLOW;

  const allow = Array.isArray(cfg.allow) ? cfg.allow : [];
  rels = rels.filter((rel) => !allow.some((p) => matches(p, rel)));
  if (!rels.length) return ALLOW;
  const paths = Array.isArray(cfg.paths) && cfg.paths.length ? cfg.paths : ['**'];
  const rel = rels.find((candidate) => paths.some((p) => matches(p, candidate)));
  if (!rel) return ALLOW;

  const min = Number.isFinite(cfg.min_chars) ? cfg.min_chars : 0;
  if (sizeOf(hook.tool_input) < min) return ALLOW;

  if (harnessEngaged(cwd)) return ALLOW; // nodes are running; they are the ones writing

  // The instruction is a skill, not a bare tm_open: the entry skill is what sizes the request,
  // picks the flow, drives the run and ends with its report - a bare tm_open skips all of that.
  if (kind) {
    process.stderr.write(`teams: ${rel} is under dispatch control and no task is open. ${SUBAGENT_STOP}\n`);
    return DENY;
  }
  const routed = routeText(cwd);
  process.stderr.write(
    `teams: ${rel} is under dispatch control, and no task is open for this project.\n` +
      `This session dispatches the work; a node writes it. Do not write this file. ` +
      (routed
        ? `${routed}Use the user's request, in their words, as args.\n`
        : `Invoke the teams entry skill now with the user's request, in their words:\n` +
          `  Skill({skill: "teams:orchestrate", args: "<the user's request>"})\n`) +
      `  - a backlog, a budget or a timebox -> Skill({skill: "teams:sprint", ...}) instead\n` +
      `The skill opens the task (tm_open) and drives it: a small request runs as one graph, a large one as packages with their own worktrees,\n` +
      `each change gated, reviewed by a different identity, and committed on its own branch.\n` +
      `To edit directly instead, remove .claude/teams-dispatch.json or add "${rel}" to its "allow".\n${SUBAGENT_NOTE}\n`,
  );
  return DENY;
}

process.exit(main());
