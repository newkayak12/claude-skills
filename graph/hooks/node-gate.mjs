#!/usr/bin/env node
// PreToolUse (matcher Skill): a graph node (worker process, HARNESS_NODE=1) must not open a run.
// Denies an entry-skill call only then; everything else exits 0 at once. Fails open.
// Below the NODE block: a write to a gated path outside a run is denied (PreToolUse Write/Edit/Bash).
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';

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

try {
  if (process.env.HARNESS_NODE === '1') {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const entry = entryCall(input);
    if (nodeKind(input) && entry) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `${entry}: ${SUBAGENT_STOP} ${SUBAGENT_NOTE}` },
      }));
    }
  }
} catch {
  /* fail open */
}

// ---- write check: a gated path (.claude/harness-gate.json) outside a run is denied ----
// Path and Bash analysis come from the exported helpers of harness/hooks/goal-gate.mjs, loaded
// at run time; absent or failing, the check exits 0. Inside a run (HARNESS_NODE=1 above) it is skipped.
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'Bash']);
const SKEW_MS = 60 * 1000;
const CONFIG = ['.claude', 'harness-gate.json'];

// The Codex apply_patch payload names its files on "*** Add/Update/Delete File:" and "*** Move to:" lines.
const patchTargets = (command, cwd) => [...String(command || '').matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)]
  .map((m) => resolve(cwd, m[1].trim()));

const openNode = (root, now, windowMs) => {
  try {
    const open = JSON.parse(readFileSync(join(root, '.harness-run', 'broker', 'open-nodes.json'), 'utf8'));
    return Object.values(open).some((n) => {
      const ts = Number(n && n.opened_at) || 0;
      return ts > 0 && ts <= now + SKEW_MS && now - ts <= windowMs;
    });
  } catch {
    return false;
  }
};

// Root-relative "/path" of target t, retrying through realpath (/tmp -> /private/tmp).
const relOf = (gate, base, t) => {
  const direct = gate.gatedRel(base, t);
  if (direct != null) return direct;
  try {
    let head = t;
    const tail = [];
    while (!existsSync(head) && dirname(head) !== head) { tail.unshift(basename(head)); head = dirname(head); }
    return gate.gatedRel(realpathSync(base), join(realpathSync(head), ...tail));
  } catch {
    return null;
  }
};

async function writeCheck() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const tool = String(input?.tool_name || '');
  if (!WRITE_TOOLS.has(tool)) return;
  const cwd = input.cwd || process.cwd();
  const ti = input.tool_input || {};
  const gate = await import('../../harness/hooks/goal-gate.mjs');
  let targets = [];
  if (tool === 'Bash') targets = gate.bashWriteTargets(ti.command, cwd);
  else if (tool === 'apply_patch') targets = patchTargets(ti.command, cwd);
  else if (ti.file_path || ti.notebook_path) targets = [resolve(cwd, String(ti.file_path || ti.notebook_path))];

  const now = Date.now();
  const hits = [];
  for (const t of targets) {
    const found = gate.findRoot(t);
    if (!found) continue;
    const root = typeof found === 'string' ? found : found.root;
    const cfg = JSON.parse(readFileSync(join(root, ...CONFIG), 'utf8'));
    const patterns = (cfg.patterns || []).map((p) => new RegExp(p, 'i'));
    const windowMs = (Number(cfg.window_hours) > 0 ? Number(cfg.window_hours) : 2) * 60 * 60 * 1000;
    const rel = relOf(gate, typeof found === 'string' ? found : found.worktree, t);
    if (!gate.isGated(rel, patterns)) continue;
    if (openNode(root, now, windowMs)) return;
    hits.push({ rel, rule: patterns.find((re) => re.test(rel))?.source || 'the gate\'s own files' });
  }
  if (!hits.length) return;
  const named = hits.slice(0, 3).map((h) => `${h.rel} (rule ${h.rule})`).join(', ');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `${named} is gated by .claude/harness-gate.json and no graph node is open. ` +
        'Open a graph run (graph_open) and let a node write it; a mention in text does not. ' + SUBAGENT_NOTE,
    },
  }));
}

try {
  if (process.env.HARNESS_NODE !== '1') await writeCheck();
} catch {
  /* fail open */
}
process.exit(0);
