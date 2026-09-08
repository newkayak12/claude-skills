export const meta = {
  name: 'harness-meta-CHANGEME',
  description: 'CHANGEME: one line on what this bespoke pipeline does',
  phases: [
    { title: 'Plan', detail: 'CHANGEME', model: 'opus' },
    { title: 'Work', detail: 'CHANGEME — your bespoke provider-routed control flow lives here', model: 'provider' },
    { title: 'QualityGate', detail: 'independent adversarial judge + goal-level gate', model: 'opus' },
    { title: 'Report', detail: 'synthesize final report', model: 'sonnet' },
  ],
}

// meta-skeleton — starting point for harness Mode M (generated bespoke Workflows).
//
// THE CONTRACT (every generated script keeps all five; the control flow between
// them is what you are free to redesign):
//   1. judge ≠ actor        — the agent that judges work never produced it
//   2. model/provider pins  — planning/judging: 'opus'; execution/testing: provider-routed;
//                             reporting: 'sonnet'
//   3. bounded loops        — every retry/discovery loop has a hard counter; no while(true)
//   4. deterministic Test   — a separate agent verifies with Bash/Read evidence,
//                             never by trusting the actor's narrative
//   5. goal-level gate      — before Report, one Opus judge scores the assembled whole
//                             (match_pct 0-100, threshold 90) against goal-level acceptance
//
// Workflow-script rules: plain JS (no TS), no Date.now()/Math.random()/new Date(),
// no fs/Node APIs. args arrives verbatim; top-level return is the result.

let req = args
if (typeof req === 'string') { try { req = JSON.parse(req) } catch { req = {} } }
req = req || {}
if (!req.request) throw new Error('meta: args.request is required')
const MAX = Number.isInteger(req.max_retries) ? req.max_retries : 2
const GOAL_MATCH_THRESHOLD = 90

const mountSkill = (name, why) =>
  `\nFirst invoke the skill "${name}" with the Skill tool and follow it — ${why}. ` +
  `If the Skill tool is unavailable, Read that skill's SKILL.md instead.`
const mountMcp = (tool, why) =>
  `\nIf the ${tool} MCP tool is available (locate via ToolSearch), use it to ${why}; ` +
  `if unavailable, proceed without it.`

// Signature of a rejection (sorted gaps + reason). Two consecutive failing attempts with the
// same signature mean the repair made no progress — break early instead of burning the rest of
// the bounded budget on an identical gap. Any bespoke loop that retries should reuse this.
const rejectionSig = v => v ? JSON.stringify([
  (v.gaps || []).map(g => String(g).toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean).sort(),
  String(v.reason || '').toLowerCase().replace(/\s+/g, ' ').trim(),
]) : null

const EVIDENCE = {
  type: 'object',
  properties: {
    verified: { type: 'boolean' },
    checks: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
  },
  required: ['verified', 'evidence'],
}
const VERDICT = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    reason: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['pass', 'reason'],
}
const GOAL_VERDICT = {
  type: 'object',
  properties: {
    match_pct: { type: 'number', minimum: 0, maximum: 100 },
    reason: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['match_pct', 'reason'],
}

// ---- Plan (opus) — keep: cheap, and it anchors acceptance criteria for the gate ----
phase('Plan')
const plan = await agent(
  `Plan how to fulfil this request; do NOT do the work.\nRequest: ${req.request}\n` +
  `List: units of work, goal-level acceptance criteria (concretely checkable), and per-unit ` +
  `deterministic checks (commands/files). If .claude/conventions/** exists, fold its rules in.\n` +
  `Acceptance criteria must check each unit's OWN artifacts (named files/outputs/interfaces), ` +
  `never whole-repo state (git diff/status, aggregate counts) — concurrent work makes those ` +
  `unwinnable — and any arbitrary-% or subjective-quality target is a soft goal, not a hard bar.` +
  mountMcp('sequential-thinking', 'work through the decomposition step by step'),
  { label: 'plan', phase: 'Plan', model: 'opus' })

// ---- Work — [META] REPLACE THIS BLOCK with the bespoke control flow the request needs ----
// (tournament / staged escalation / loop-until-dry / per-finding refuters / …).
// The default below is a single bounded implement→test→judge loop; keep its *shape*
// (actor, then independent evidence, then independent verdict) inside whatever flow you build.
phase('Work')
let work = null, evidence = null, verdict = null, feedback = '', attempt = 0, prevSig = null
while (attempt <= MAX) {
  attempt++
  work = await agent(
    `Do the work for: ${req.request}\nPlan:\n${plan}` +
    (feedback ? `\n\nPrevious attempt rejected. Fix:\n${feedback}` : '') +
    `\n\nEnd with a "HANDOFF:" section (max 1500 chars): paths, names, interfaces produced.`,
    { label: `work:${attempt}`, phase: 'Work', model: 'sonnet' })

  evidence = await agent(
    mountSkill('completion:verification-before-completion', 'evidence before assertions, always') +
    `\nIndependently verify with Bash/Read; do NOT trust the narrative.\n` +
    `Actor's account:\n${work}\n\nverified=true only if checks actually passed and artifacts exist.`,
    { label: `test:${attempt}`, phase: 'Work', model: 'sonnet', schema: EVIDENCE })

  verdict = await agent(
    mountSkill('think:devils-advocate', 'it structures the strongest objections') +
    `\nJudge the work against the plan's acceptance criteria. You did NOT produce it.\n` +
    `Plan:\n${plan}\n\nEvidence (verified=${evidence && evidence.verified}):\n` +
    `${evidence ? evidence.evidence : 'none'}\n\nActor's account:\n${work}`,
    { label: `gate:${attempt}`, phase: 'QualityGate', model: 'opus', schema: VERDICT })

  if (verdict && verdict.pass) break
  const sig = rejectionSig(verdict)
  if (sig && sig === prevSig) break  // no-progress: same gaps as last attempt — stop early (still capped by MAX)
  prevSig = sig
  feedback = (verdict && (verdict.reason + '\n' + (verdict.gaps || []).map(g => `- ${g}`).join('\n'))) || 'unspecified'
}
// ---- end [META] block ----

// ---- Goal-level gate (opus) — keep verbatim in every generated script ----
const goalGate0 = await agent(
  mountSkill('think:devils-advocate', 'it structures the strongest objections') +
  `\nJudge the ASSEMBLED WHOLE against the goal-level acceptance criteria from the plan. ` +
  `Score match_pct (0-100) as an honest holistic estimate, not an average.\n` +
  `Request: ${req.request}\nPlan:\n${plan}\n\nFinal work:\n${work}`,
  { label: 'gate:goal', phase: 'QualityGate', model: 'opus', schema: GOAL_VERDICT })
const goalGate = { ...goalGate0, pass: !!(goalGate0 && goalGate0.match_pct >= GOAL_MATCH_THRESHOLD) }

// ---- Report (sonnet) — keep: honest, outcome-first ----
phase('Report')
const report = await agent(
  `Write the final report for the requester. Outcome first, failures honestly, no invented claims.\n` +
  `Request: ${req.request}\nGoal gate: ${goalGate.pass ? 'PASS' : 'FAIL'} ` +
  `(match ${goalGate.match_pct || 0}%, threshold ${GOAL_MATCH_THRESHOLD}%) — ${goalGate.reason || 'no verdict'}\n` +
  `Work summary:\n${String(work || '').slice(0, 3000)}`,
  { label: 'report', phase: 'Report', model: 'sonnet' })

return { all_passed: !!(verdict && verdict.pass && goalGate.pass), goal_gate: goalGate, report }
