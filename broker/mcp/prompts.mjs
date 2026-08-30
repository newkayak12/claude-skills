// prompts.mjs - the broker composes every node prompt from graph state.
//
// This is deliberate. If the orchestrator had to write the prompt, it would first have
// to hold the goal-spec, the upstream handoffs, and the prior rejection feedback in its
// own context - and that context grows with every node, which is exactly what makes a
// long loop impossible. The graph already holds all of it, so the broker writes the
// prompt and the orchestrator never sees the payload.

import { REASONING_STAGES } from './graph.mjs';

const CONTRACT = {
  plan: `Return JSON: {"plan": "<the decomposition>", "handoff": "<what the next node needs>", "evidence": "<how you checked the request is actually satisfiable here>"}`,
  setgoal: `Return JSON: {"spec": {"goal": "...", "acceptance": ["goal-level criteria"], "subgoals": [{"id": "U1", "title": "...", "persona": "...", "acceptance": ["subgoal criteria"], "test": ["deterministic checks"], "deps": []}]}, "handoff": "...", "evidence": "..."}
Every acceptance criterion must be checkable by a command or a file inspection. Reject your own vague criteria before returning.
Every subgoal must be a unit of WORK that changes files. Verification is not a subgoal: express it as that subgoal's test[] entries, which run as its own Test node. A subgoal whose only job is to check something already built has nothing for its Implement node to do and can only fail.`,
  critique: `Return JSON: {"sound": true|false, "blocking": ["..."], "problems": ["..."], "handoff": "...", "evidence": "..."}
Look for: wrong decomposition, unfalsifiable acceptance, a missing subgoal the goal needs, fake dependencies, unverifiable test entries, criteria that hinge on whole-repo state, and aspirational thresholds written as hard pass/fail bars.
Set sound=false ONLY for defects in "blocking": something that makes the work impossible to do or impossible to verify as specified. Everything else goes in "problems" - it is carried into the next node as advice and does not stop the run.
A spec you would merely improve is not a spec you should reject. Wording you would tighten, a check you would add, a scope note you would sharpen: those are problems, not blockers. An unbounded refutation always finds something, and a gate nothing can pass is not a gate - it is a dead end.`,
  implement: `Return JSON: {"stage_ok": true|false, "handoff": "<paths, names, interfaces the dependent work needs>", "changed_files": ["..."], "checks": ["what you ran and what it printed"], "evidence": "..."}
stage_ok=false when required work or checks could not run. Do not report a file as changed unless you changed it.`,
  test: `Return JSON: {"stage_ok": true|false, "verified": true|false, "checks": ["command -> observed output"], "evidence": "..."}
stage_ok=false means a required check could not run at all (sandbox, missing tool). verified=false with stage_ok=true means the checks ran and found a genuine failure. Do not edit implementation files. Do not trust the implement narrative - run the checks or inspect the artifacts yourself.`,
  gate: `Return JSON: {"stage_ok": true, "accept": true|false, "match_pct": 0-100, "gaps": ["what is missing or wrong"], "reason": "...", "evidence": "..."}
You are the judge, not the actor. Judge only what the evidence below shows. Absent evidence is a gap, not a pass.`,
  report: `Return JSON: {"stage_ok": true, "handoff": "<the final report>", "evidence": "..."}
Synthesize from the node results below only. State plainly what was not done and why.`,
};

function bullets(list) {
  return (list || []).map((x) => `- ${x}`).join('\n') || '- (none)';
}

export function composePrompt(run, n, briefing) {
  const lines = [];
  lines.push(`# ${n.stage} node ${n.node_id}`);
  lines.push('');
  lines.push(`Working directory: ${run.cwd}`);
  lines.push(`Every command you run and every file you touch must be inside it.`);
  lines.push('');

  if (REASONING_STAGES.has(n.stage)) {
    lines.push(`This is a reasoning node. Do not modify project files.`);
    lines.push('');
  }

  lines.push(`## Request`);
  lines.push(run.request);
  if (run.context) {
    lines.push('');
    lines.push(`## Context from the requester`);
    lines.push(run.context);
  }

  if (briefing.goal) {
    lines.push('');
    lines.push(`## Goal`);
    lines.push(briefing.goal);
    lines.push('');
    lines.push(`## Goal-level acceptance`);
    lines.push(bullets(briefing.goal_acceptance));
  }

  if (briefing.subgoal) {
    const sg = briefing.subgoal;
    lines.push('');
    lines.push(`## Subgoal ${sg.id} — ${sg.title}`);
    if (sg.persona) lines.push(`Act as: ${sg.persona}`);
    lines.push('');
    lines.push(`### Acceptance`);
    lines.push(bullets(sg.acceptance));
    if ((sg.test || []).length) {
      lines.push('');
      lines.push(`### Checks`);
      lines.push(bullets(sg.test));
    }
  }

  if (briefing.subgoals && briefing.subgoals.length) {
    lines.push('');
    lines.push(`## Subgoals in the spec`);
    for (const sg of briefing.subgoals) {
      lines.push(`### ${sg.id} — ${sg.title}`);
      if ((sg.deps || []).length) lines.push(`Depends on: ${sg.deps.join(', ')}`);
      lines.push(`Acceptance:`);
      lines.push(bullets(sg.acceptance));
      if ((sg.test || []).length) {
        lines.push(`Checks:`);
        lines.push(bullets(sg.test));
      }
      lines.push('');
    }
  }

  if (briefing.whole_run && briefing.whole_run.length) {
    lines.push('');
    lines.push(`## Every node in this run`);
    lines.push(`Judge from these facts. A node that failed or was skipped is part of the outcome.`);
    for (const x of briefing.whole_run) {
      const verdict = [
        x.state,
        x.vendor ? `vendor=${x.vendor}` : '',
        x.verified === undefined ? '' : `verified=${x.verified}`,
        x.accept === undefined ? '' : `accept=${x.accept}`,
        x.match_pct === undefined ? '' : `match=${x.match_pct}%`,
        x.changed_files_verified === undefined || x.changed_files_verified === null
          ? ''
          : `files_verified=${x.changed_files_verified}`,
      ].filter(Boolean).join(' ');
      lines.push(`### ${x.node_id} (${x.stage}) — ${verdict}`);
      if (x.changed_files.length) lines.push(`Changed: ${x.changed_files.join(', ')}`);
      if (x.checks.length) lines.push(`Checks:\n${bullets(x.checks)}`);
      if (x.handoff) lines.push(x.handoff);
      if (x.evidence) lines.push(`Evidence: ${x.evidence}`);
      if (x.gaps.length) lines.push(`Gaps:\n${bullets(x.gaps)}`);
      if (x.reason) lines.push(`Reason: ${x.reason}`);
      lines.push('');
    }
  }

  if (briefing.upstream.length) {
    lines.push('');
    lines.push(`## Completed upstream nodes`);
    for (const u of briefing.upstream) {
      lines.push(`### ${u.node_id} (${u.stage})`);
      if (u.handoff) lines.push(u.handoff);
      if (u.evidence) lines.push(`Evidence: ${u.evidence}`);
      lines.push('');
    }
  }

  if (briefing.prior_feedback) {
    lines.push('');
    lines.push(`## Previous attempt was rejected — fix this`);
    lines.push(briefing.prior_feedback);
  }

  lines.push('');
  lines.push(`## Required output`);
  lines.push(CONTRACT[n.stage] || CONTRACT.implement);
  lines.push('');
  lines.push(`Return that JSON object and nothing else.`);
  return lines.join('\n');
}
