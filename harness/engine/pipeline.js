export const meta = {
  name: 'harness-engine',
  description: 'Six-stage Plan→SetGoal→Implement→Test→QualityGate→Report engine over a raw request',
  phases: [
    { title: 'Plan', detail: 'decompose request, map repo skills', model: 'opus' },
    { title: 'SetGoal', detail: 'author goal-spec + adversarial critic', model: 'opus' },
    { title: 'Implement', detail: 'executor per subgoal, invokes mapped skills', model: 'sonnet' },
    { title: 'Test', detail: 'independent deterministic verification', model: 'sonnet' },
    { title: 'QualityGate', detail: 'adversarial judge per subgoal + goal-level gate', model: 'opus' },
    { title: 'Report', detail: 'synthesize final report', model: 'sonnet' },
  ],
}

// args = { request: string, context?: string, max_retries?: number }
// Six baked stages, model-pinned so the flow holds regardless of the main-session model:
//   Plan(opus) → SetGoal(opus, +critic) → per subgoal [Implement(sonnet) → Test(sonnet)
//   → QualityGate(opus)] looped up to max_retries → goal-level QualityGate(opus) → Report(sonnet).

let req = args
if (typeof req === 'string') {
  try { req = JSON.parse(req) } catch { req = {} }
}
req = req || {}
if (!req.request) throw new Error('harness-engine: args.request (raw request string) is required')
const MAX = Number.isInteger(req.max_retries) ? req.max_retries : 2
const ctxNote = req.context ? `\nContext from the requester:\n${req.context}` : ''

const SPEC = {
  type: 'object',
  properties: {
    goal: { type: 'string' },
    acceptance: { type: 'array', items: { type: 'string' } },
    subgoals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          persona: { type: 'string' },
          skills: { type: 'array', items: { type: 'string' } },
          acceptance: { type: 'array', items: { type: 'string' } },
          test: { type: 'array', items: { type: 'string' } },
          deps: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'acceptance'],
      },
    },
  },
  required: ['goal', 'acceptance', 'subgoals'],
}

const CRITIQUE = {
  type: 'object',
  properties: {
    sound: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: ['sound'],
}

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

const GOAL_MATCH_THRESHOLD = 90 // user decision: goal-level gate requires >= 90% match

const GOAL_VERDICT = {
  type: 'object',
  properties: {
    match_pct: { type: 'number', minimum: 0, maximum: 100 },
    reason: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['match_pct', 'reason'],
}

// ---- Stage 1: Plan (opus) ----
phase('Plan')
const plan = await agent(
  `You are planning how to fulfil this request. Do NOT do the work.\n` +
  `Request: ${req.request}${ctxNote}\n\n` +
  `Produce a short plan: (1) decomposition into independent units of work, ` +
  `(2) real ordering dependencies only, (3) for each unit, which of this repository's ` +
  `skills fit (plugins: develop:*, think:*, write:*, pm:*, cognition:*, agents:*, skill:*) ` +
  `and what executor persona fits, (4) how each unit can be deterministically verified ` +
  `(commands to run, files to inspect), (5) if the project defines .claude/conventions/**, ` +
  `Read the relevant ones and list the rules that must constrain this work. ` +
  `Be concrete; this plan feeds spec authoring.`,
  { label: 'plan', phase: 'Plan', model: 'opus' })

// ---- Stage 2: SetGoal (opus) — author spec, then adversarial critic, then one revision ----
phase('SetGoal')
const specPrompt =
  `Turn this plan into a goal-spec (JSON per schema).\nRequest: ${req.request}${ctxNote}\n\nPlan:\n${plan}\n\n` +
  `Rules: acceptance criteria are derived from the goal and concretely checkable — the judge ` +
  `only knows what you write. subgoals are divide-and-conquer; deps only for real ordering. ` +
  `skills[] lists 1-3 repository skill names the executor must invoke. test[] lists shell ` +
  `commands or concrete checks a verifier can execute without trusting the executor. ` +
  `Fold any project convention rules the plan surfaced into subgoal acceptance and test entries. ` +
  `Keep it small — a trivial request is one subgoal.`
let spec = await agent(specPrompt, { label: 'setgoal', phase: 'SetGoal', model: 'opus', schema: SPEC })

const critique = await agent(
  `Adversarially critique this goal-spec. You did NOT write it. Refute: wrong decomposition, ` +
  `vague/unfalsifiable acceptance, missing subgoal the goal needs, fake dependencies, ` +
  `unverifiable test[] entries, skill mappings that don't fit.\n` +
  `Request: ${req.request}\n\nSpec:\n${JSON.stringify(spec, null, 2)}\n\n` +
  `sound=true only if the spec would survive an independent review.`,
  { label: 'critic', phase: 'SetGoal', model: 'opus', schema: CRITIQUE })

if (critique && !critique.sound) {
  log(`spec critique found ${((critique.problems || []).length) || 'unspecified'} problems — revising once`)
  spec = await agent(
    specPrompt + `\n\nA previous draft was rejected by an independent critic. Fix these problems:\n` +
    (critique.problems || []).map(p => `- ${p}`).join('\n') +
    `\n\nPrevious draft:\n${JSON.stringify(spec, null, 2)}`,
    { label: 'setgoal:rev', phase: 'SetGoal', model: 'opus', schema: SPEC })
}

const subgoals = spec.subgoals || []
const RETRIES = Number.isInteger(spec.max_retries) ? spec.max_retries : MAX

// Extract the executor's structured handoff for downstream subgoals (1500-char budget).
function handoffOf(work) {
  const s = String(work || '')
  const m = s.match(/HANDOFF:\s*([\s\S]+)$/)
  return (m ? m[1] : s).trim().slice(0, 1500)
}

// ---- Stages 3-5 per subgoal: Implement → Test → QualityGate, looped ----
async function runSubgoal(sg, upstream) {
  const ctx = upstream.length
    ? `\nCompleted dependencies (handoffs):\n${upstream.map(u => `- ${u.id} (${u.title}):\n${u.handoff}`).join('\n')}`
    : ''
  const persona = sg.persona ? ` Act as: ${sg.persona}.` : ''
  const skills = (sg.skills || []).length
    ? `\nBefore working, invoke each of these skills with the Skill tool and follow them: ` +
      `${sg.skills.join(', ')}. If the Skill tool is unavailable, Read the skill's SKILL.md instead.`
    : ''
  const accept = (sg.acceptance || []).map(a => `- ${a}`).join('\n')
  const tests = (sg.test || []).map(t => `- ${t}`).join('\n')

  let work = null, evidence = null, verdict = null, attempt = 0
  let feedback = ''
  while (attempt <= RETRIES) {
    attempt++
    work = await agent(
      `Goal: ${spec.goal}\nSubgoal "${sg.title}".${persona}${skills}\n` +
      `If the project defines .claude/conventions/**, Read the ones relevant to your files and follow them.\n` +
      `Acceptance criteria:\n${accept}${ctx}` +
      (feedback ? `\n\nPrevious attempt was rejected. Fix:\n${feedback}` : '') +
      `\n\nEnd your reply with a section starting exactly with "HANDOFF:" — max 1500 chars — ` +
      `stating what you produced (paths, names, interfaces) for dependent work to build on.`,
      { label: `impl:${sg.id}:${attempt}`, phase: 'Implement', model: 'sonnet' })

    evidence = await agent(
      `Independently verify subgoal "${sg.title}". Do NOT trust the executor's narrative — ` +
      `verify deterministically: run the checks below with Bash, Read the files the executor ` +
      `claims to have produced or changed, and record what you actually observed.\n` +
      `Checks:\n${tests || '- (none specified) inspect the claimed artifacts directly'}\n\n` +
      `Executor's account:\n${work}\n\n` +
      `verified=true only if every check you ran actually passed and claimed artifacts exist.`,
      { label: `test:${sg.id}:${attempt}`, phase: 'Test', model: 'sonnet', schema: EVIDENCE })

    verdict = await agent(
      `Judge subgoal "${sg.title}" against its acceptance criteria. You did NOT produce it — ` +
      `be adversarial. Weigh the independent test evidence over the executor's account.\n` +
      `Acceptance:\n${accept}\n\nIndependent test evidence (verified=${evidence && evidence.verified}):\n` +
      `${evidence ? evidence.evidence : 'none'}\n\nExecutor's account:\n${work}\n\n` +
      `pass=true only if every criterion is genuinely met AND the evidence supports it.`,
      { label: `gate:${sg.id}:${attempt}`, phase: 'QualityGate', model: 'opus', schema: VERDICT })

    if (verdict && verdict.pass) break
    feedback =
      ((verdict && (verdict.reason + (verdict.gaps ? '\n' + verdict.gaps.map(g => `- ${g}`).join('\n') : ''))) || 'unspecified') +
      (evidence && !evidence.verified ? `\nTest evidence: ${evidence.evidence}` : '')
  }

  return {
    id: sg.id,
    title: sg.title,
    passed: !!(verdict && verdict.pass),
    attempts: attempt,
    handoff: handoffOf(work),
    work,
    evidence,
    verdict,
  }
}

// Dependency waves: run all subgoals whose deps are done, in parallel, until none remain.
const done = new Map()
const pending = new Map(subgoals.map(s => [s.id, s]))
let guard = 0
while (pending.size && guard++ < subgoals.length + 1) {
  const ready = [...pending.values()].filter(s => (s.deps || []).every(d => done.has(d)))
  if (!ready.length) {
    log(`unsatisfiable deps for: ${[...pending.keys()].join(', ')} — running remaining without them`)
    ready.push(...pending.values())
  }
  const wave = await parallel(ready.map(s => () =>
    runSubgoal(s, (s.deps || []).map(d => done.get(d)).filter(Boolean))))
  for (const r of wave.filter(Boolean)) {
    done.set(r.id, r)
    pending.delete(r.id)
  }
}

const results = [...done.values()]
const failed = results.filter(r => !r.passed)
log(`${results.length - failed.length}/${results.length} subgoals passed`)

// ---- Stage 5b: goal-level QualityGate (opus) — quantified match_pct, threshold 90%, ----
// ---- looped: below-threshold gaps get one repair pass per remaining retry ----
function goalPrompt(extra) {
  return `All subgoals have been judged individually. Now judge the ASSEMBLED WHOLE against the ` +
    `goal-level acceptance criteria. Be adversarial: subgoals passing individually does not ` +
    `mean the goal is met. Score match_pct = your honest estimate (0-100) of how fully the ` +
    `assembled result satisfies every goal-level acceptance criterion — not an average of ` +
    `subgoal pass/fail, a holistic judgment of the whole against the goal.\n` +
    `Goal: ${spec.goal}\nGoal-level acceptance:\n` +
    (spec.acceptance || []).map(a => `- ${a}`).join('\n') +
    `\n\nSubgoal outcomes:\n` +
    results.map(r => `- ${r.id} "${r.title}": ${r.passed ? 'PASS' : 'FAIL'} — ${r.handoff}`).join('\n') +
    (extra || '')
}

let goalGate = await agent(goalPrompt(), { label: 'gate:goal:1', phase: 'QualityGate', model: 'opus', schema: GOAL_VERDICT })
let goalAttempt = 1
while ((!goalGate || goalGate.match_pct < GOAL_MATCH_THRESHOLD) && goalAttempt <= RETRIES) {
  goalAttempt++
  log(`goal-level match ${goalGate ? goalGate.match_pct : 0}% < ${GOAL_MATCH_THRESHOLD}% — repair pass ${goalAttempt}`)
  const repair = await agent(
    `The assembled result scored ${goalGate ? goalGate.match_pct : 0}% against the goal (threshold ${GOAL_MATCH_THRESHOLD}%). ` +
    `Address these gaps directly — do not restate the plan, produce the missing/fixed work:\n` +
    (goalGate && goalGate.gaps ? goalGate.gaps.map(g => `- ${g}`).join('\n') : goalGate ? goalGate.reason : 'no verdict') +
    `\n\nGoal: ${spec.goal}\nSubgoal outcomes so far:\n` +
    results.map(r => `- ${r.id} "${r.title}": ${r.handoff}`).join('\n') +
    `\n\nEnd with a "HANDOFF:" section (max 1500 chars) describing what you fixed.`,
    { label: `repair:goal:${goalAttempt}`, phase: 'Implement', model: 'sonnet' })
  results.push({ id: `repair-${goalAttempt}`, title: 'goal-level repair', passed: null, attempts: 1, handoff: handoffOf(repair), work: repair, evidence: null, verdict: null })
  goalGate = await agent(
    goalPrompt(`\n\nRepair pass applied:\n${handoffOf(repair)}`),
    { label: `gate:goal:${goalAttempt}`, phase: 'QualityGate', model: 'opus', schema: GOAL_VERDICT })
}
goalGate = { ...goalGate, pass: !!(goalGate && goalGate.match_pct >= GOAL_MATCH_THRESHOLD) }

// ---- Stage 6: Report (sonnet) ----
phase('Report')
const report = await agent(
  `Write the final report for this harness run, for the requester. Be honest about failures.\n` +
  `Request: ${req.request}\nGoal: ${spec.goal}\n` +
  `Goal-level gate: ${goalGate && goalGate.pass ? 'PASS' : 'FAIL'} (match ${goalGate ? goalGate.match_pct : 0}%, threshold ${GOAL_MATCH_THRESHOLD}%) — ${goalGate ? goalGate.reason : 'no verdict'}\n` +
  `Subgoals:\n` +
  results.map(r =>
    `- ${r.id} "${r.title}": ${r.passed ? 'PASS' : 'FAIL'} (${r.attempts} attempt(s))\n` +
    `  handoff: ${r.handoff}\n  verdict: ${r.verdict ? r.verdict.reason : 'none'}`).join('\n') +
  `\n\nStructure: outcome first (did the goal pass), then per-subgoal summary, then any ` +
  `failures with reasons and what remains. Plain prose, no invented claims.`,
  { label: 'report', phase: 'Report', model: 'sonnet' })

return {
  goal: spec.goal,
  spec,
  all_passed: failed.length === 0 && !!(goalGate && goalGate.pass),
  failed: failed.map(r => ({ id: r.id, title: r.title, reason: r.verdict && r.verdict.reason })),
  goal_gate: goalGate,
  results: results.map(r => ({ id: r.id, title: r.title, passed: r.passed, attempts: r.attempts, handoff: r.handoff, verdict: r.verdict, evidence: r.evidence })),
  report,
}
