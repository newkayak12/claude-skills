#!/usr/bin/env node
// PreToolUse (matcher Skill): a graph node (worker process, HARNESS_NODE=1) must not open a run.
// Denies an entry-skill call only then; everything else exits 0 at once. Fails open.
import { readFileSync } from 'node:fs';

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
process.exit(0);
