// mounts.mjs - stage-mounted skills and MCP tools for the graph engine's own stages.
//
// taskmanager.mjs's STAGE_SKILLS pins method to the manager's own stages (shape, critique,
// accept, integrate, gate:goal) via tm_open({skills}). The graph engine that every size-S
// request actually runs had no counterpart at all: plan, critique, test, review and every
// gate ran on their contract alone. This is that mechanism, restored for the engine.
//
// It sits next to, not instead of, the two skills mechanisms graph.mjs and prompts.mjs
// already have:
//   - KINDS.skills (graph.mjs) picks method by what a subgoal IS (subgoal vs document).
//   - a spec's own sg.skills (setgoal) picks method by what a subgoal NEEDS.
// Both of those render inside composePrompt's `## Subgoal` block, only for a node that
// belongs to a subgoal chain. Stage-mounted skills are orthogonal: they pin method to the
// STAGE regardless of what kind of work is running through it or what the spec asked for,
// which is why plan, critique and gate:goal - none of which ever has a subgoal - get one
// here for the first time.
//
// MCP mounts are the same idea for tools rather than skills: a stage may be offered a
// specific MCP tool (sequential-thinking for plan, think-tool for setgoal, mcp-reasoner
// for the goal gate) to reason with. Advisory only - a tool that is not connected is
// skipped in silence, never searched for and never blocking.

import { SKILL_METHOD_DISCLAIMER } from './prompts.mjs';

// Keyed the same way taskmanager's STAGE_SKILLS is: by stage name, with `gate:goal` split
// out from the plain per-subgoal `gate` so a caller can override the goal gate without
// touching every subgoal gate. Both default to the same skill here, on purpose - the
// original pipeline.js pinned "every subgoal gate and the goal gate" to one skill.
const GRAPH_STAGE_SKILLS = {
  plan: ['agents:agent-task-decomposer'],
  critique: ['think:devils-advocate'],
  gate: ['think:devils-advocate'],
  'gate:goal': ['think:devils-advocate'],
  test: ['completion:verification-before-completion'],
  review: ['think:devils-advocate'],
};

// Advisory MCP tools offered per stage. `use` is the one-line reason given in the prompt;
// plain strings are accepted too and get a generic reason.
const GRAPH_STAGE_MOUNTS = {
  plan: [{ tool: 'mcp__sequential-thinking__sequentialthinking', use: 'stepping through the decomposition before you answer' }],
  setgoal: [{ tool: 'mcp__think-tool__think', use: 'reasoning through the acceptance criteria and subgoal shape before you answer' }],
  'gate:goal': [{ tool: 'mcp__mcp-reasoner__mcp-reasoner', use: 'weighing the evidence for and against acceptance before you answer' }],
  // draft is shared with the document kind - this stage name, not the planning kind alone, is
  // what the mechanism keys on, so a document draft gets the same advisory mount too. That is
  // a side effect of the design doc's plan (§3) asking for it on planning's draft specifically;
  // harmless, since a mount is advisory and skipped in silence when unconnected.
  draft: [{ tool: 'mcp__think-tool__think', use: 'reasoning through the problem framing and requirements before you write' }],
  cases: [{ tool: 'mcp__sequential-thinking__sequentialthinking', use: 'stepping through the behaviors a user or an attacker could hit before you write the case set' }],
};

function stageKey(n) {
  return n.node_id.startsWith('gate:goal') ? 'gate:goal' : n.stage;
}

// team_open({skills: {...}}) merges over the defaults, keyed the same way; skills: false
// turns the whole mechanism off. Array.isArray, not a truthiness check, so an override that
// names one stage does not also blank out every other stage's default.
export function graphStageSkills(run, n) {
  if (run.skills === false) return [];
  const key = stageKey(n);
  const override = run.skills && typeof run.skills === 'object' ? run.skills[key] : undefined;
  const list = Array.isArray(override) ? override : GRAPH_STAGE_SKILLS[key];
  return (list || []).map(String).filter(Boolean);
}

function normalizeMount(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return { tool: entry, use: "this stage's reasoning" };
  if (entry.tool) return { tool: String(entry.tool), use: String(entry.use || "this stage's reasoning") };
  return null;
}

// Same off/override switch as graphStageSkills, for team_open({mounts: {...}}).
export function graphStageMounts(run, n) {
  if (run.mounts === false) return [];
  const key = stageKey(n);
  const override = run.mounts && typeof run.mounts === 'object' ? run.mounts[key] : undefined;
  const list = Array.isArray(override) ? override : GRAPH_STAGE_MOUNTS[key];
  return (list || []).map(normalizeMount).filter(Boolean);
}

function bulletList(list) {
  return list.map((x) => `- ${x}`).join('\n');
}

// Everything composePrompt appends for this node: a `## Method` block for stage-mounted
// skills, then a `## Tools` block for stage-mounted MCP tools. Either half is omitted when
// there is nothing to mount. Returns '' when neither applies.
export function mountBlock(run, n) {
  const lines = [];
  const skills = graphStageSkills(run, n);
  if (skills.length) {
    lines.push('');
    lines.push('## Method');
    lines.push('Load each of these that is available, then work the way it says:');
    lines.push(bulletList(skills));
    lines.push('Invoke it through the Skill tool. If the Skill tool is not available here, read the skill\'s own SKILL.md directly and follow it instead.');
    lines.push(SKILL_METHOD_DISCLAIMER);
  }
  const mounted = graphStageMounts(run, n);
  if (mounted.length) {
    lines.push('');
    lines.push('## Tools');
    for (const m of mounted) {
      lines.push(`If the MCP tool \`${m.tool}\` is available, use it for ${m.use}. If it is not connected, continue without it - do not search for it, and do not ask for it to be added.`);
    }
  }
  return lines.join('\n');
}
