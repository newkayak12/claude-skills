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

// args = { request: string, context?: string, max_retries?: number, codex_provider?: 'auto'|'off' }
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
const codexProvider = String(req.codex_provider || req.codex_mode || 'auto').toLowerCase()
const codexDelegationEnabled = !['off', 'false', 'none', 'claude', 'sonnet'].includes(codexProvider)
const codexAdapterPath = String(req.codex_adapter_path || req.codexAdapterPath || '').trim()

const SPEC = {
  type: 'object',
  properties: {
    goal: { type: 'string' },
    acceptance: {
      type: 'array',
      items: { type: 'string' },
      description: 'GOAL-LEVEL criteria for the whole assembled result — required at the top level, distinct from each subgoal\'s own acceptance array below. Do not omit this even when every subgoal already has its own acceptance[].',
    },
    subgoals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          persona: { type: 'string' },
          skills: { type: 'array', items: { type: 'string' } },
          acceptance: {
            type: 'array',
            items: { type: 'string' },
            description: 'SUBGOAL-LEVEL criteria for this one unit of work only — distinct from the goal-level acceptance array at the root.',
          },
          implement_provider: {
            type: 'string',
            enum: ['codex'],
            description: 'Optional trace hint: "codex" means this subgoal is suitable for the Workflow Implement Codex CLI bridge.',
          },
          test_provider: {
            type: 'string',
            enum: ['codex'],
            description: 'Optional trace hint: "codex" means this subgoal is suitable for the Workflow Test Codex CLI bridge.',
          },
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
// Stage-mounted repo skills / MCP tools. Skills load via the Skill tool (SKILL.md Read
// as fallback); MCP tools resolve via ToolSearch and are skipped silently if absent.
const mountSkill = (name, why) =>
  `\nFirst invoke the skill "${name}" with the Skill tool and follow it — ${why}. ` +
  `If the Skill tool is unavailable, Read that skill's SKILL.md instead.`
const mountMcp = (tool, why) =>
  `\nIf the ${tool} MCP tool is available (locate via ToolSearch), use it to ${why}; ` +
  `if unavailable, proceed without it.`

const plan = await agent(
  mountSkill('agents:agent-task-decomposer', 'it enforces crisp subtask boundaries, ' +
    'dependency mapping, and context-isolated agent-ready units — exactly what this plan needs') +
  `\nAct as a systems analyst decomposing work into crisp, independently-verifiable, ` +
  `dependency-mapped units. You are planning how to fulfil this request. Do NOT do the work.\n` +
  `Request: ${req.request}${ctxNote}\n\n` +
  `Produce a short plan: (1) decomposition into independent units of work, ` +
  `(2) real ordering dependencies only, (3) for each unit, which of this repository's ` +
  `skills fit (plugins: develop:*, think:*, write:*, pm:*, cognition:*, agents:*, ` +
  `planning:*, completion:*, skill:*) ` +
  `and what executor persona fits, (4) how each unit can be deterministically verified ` +
  `(commands to run, files to inspect), (5) if the project defines .claude/conventions/**, ` +
  `Read the relevant ones and list the rules that must constrain this work. ` +
  `Be concrete; this plan feeds spec authoring.` +
  mountMcp('sequential-thinking', 'work through the decomposition step by step'),
  { label: 'plan', phase: 'Plan', model: 'opus' })

// ---- Stage 2: SetGoal (opus) — author spec, then adversarial critic, then one revision ----
phase('SetGoal')
const specPrompt =
  `Turn this plan into a goal-spec (JSON per schema).\nRequest: ${req.request}${ctxNote}\n\nPlan:\n${plan}\n\n` +
  `Rules: acceptance criteria are derived from the goal and concretely checkable — the judge ` +
  `only knows what you write. subgoals are divide-and-conquer; deps only for real ordering. ` +
  `skills[] lists 1-3 repository skill names the executor must invoke. test[] lists shell ` +
  `commands or concrete checks a verifier can execute without trusting the executor. ` +
  (codexDelegationEnabled
    ? `For code-editing, repository-inspection, build/test, and refactor subgoals, set ` +
      `"implement_provider":"codex" and "test_provider":"codex" as trace hints; the Workflow ` +
      `Implement and Test Sonnet agents will try the local Codex CLI bridge before falling back ` +
      `to direct Sonnet work. Do not set them for writing-only, planning-only, or product/strategy subgoals. `
    : `Do not set provider fields; codex_provider is off for this run. `) +
  `Fold any project convention rules the plan surfaced into subgoal acceptance and test entries. ` +
  `Keep it small — a trivial request is one subgoal.\n` +
  `Two hard rules on acceptance/test criteria: (a) each criterion checks THIS unit's own ` +
  `artifacts — named files it produces, its outputs, its interfaces — never global or shared ` +
  `repository state (whole-repo "git diff/status shows N files", aggregate repo-wide test counts). ` +
  `Such state is mutable by anything running concurrently, so no single subgoal can satisfy it ` +
  `deterministically and the gate becomes unwinnable. (b) An aspirational or arbitrary-threshold ` +
  `target (a chosen % reduction, a subjective quality word like "elegant"/"clean") is NOT a hard ` +
  `pass/fail bar — either restate it as something concretely met-or-not, or mark it explicitly as ` +
  `a soft goal the judge should weigh but not fail the unit on. The judge treats every listed ` +
  `acceptance entry as hard, so do not list a target you cannot deterministically verify.` +
  mountMcp('think-tool', 'refine each acceptance criterion until it is concretely checkable')
let spec = await agent(specPrompt, { label: 'setgoal', phase: 'SetGoal', model: 'opus', schema: SPEC })

const critique = await agent(
  mountSkill('think:devils-advocate', 'it structures the strongest objections') +
  `\nAdversarially critique this goal-spec. You did NOT write it. Refute: wrong decomposition, ` +
  `vague/unfalsifiable acceptance, missing subgoal the goal needs, fake dependencies, ` +
  `unverifiable test[] entries, skill mappings that don't fit. Flag two unwinnable-gate patterns ` +
  `specifically: (1) any acceptance/test criterion that hinges on global or shared repository state ` +
  `(whole-repo git diff/status, aggregate repo-wide counts) instead of the subgoal's own artifacts — ` +
  `concurrent work makes these non-deterministic and impossible to satisfy; (2) any aspirational or ` +
  `arbitrary-threshold target (a chosen % reduction, subjective quality adjectives) written as a hard ` +
  `pass/fail bar rather than a soft, judge-weighed goal — these never converge.\n` +
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

function isDegenerateSpec(s) {
  if (!s || !Array.isArray(s.subgoals) || s.subgoals.length === 0) return true
  if (!Array.isArray(s.acceptance) || s.acceptance.length === 0) return true
  if (String(s.goal || '').trim().length < 8) return true
  return s.subgoals.some(sg => String(sg.title || '').trim().length < 4 || !((sg.acceptance || []).length))
}

if (isDegenerateSpec(spec)) {
  log('SetGoal produced a degenerate/placeholder spec — one corrective re-author pass')
  spec = await agent(
    specPrompt +
    `\n\nA previous attempt collapsed into a placeholder/degenerate spec (minimal goal text, a ` +
    `trivial single subgoal, or missing/empty top-level acceptance). This typically happens when ` +
    `StructuredOutput validation fails on a large, substantively correct draft — commonly because the ` +
    `top-level "acceptance" field (GOAL-LEVEL criteria, distinct from each subgoal's own "acceptance" ` +
    `array) was omitted — and the response shrinks the payload to "isolate the issue" instead of fixing ` +
    `the one missing/invalid field. Do not shrink scope to recover from a validation error: identify ` +
    `exactly which field the schema is complaining about and resubmit the FULL substantive spec with ` +
    `only that field corrected. The spec must actually address the original request, not be a placeholder.`,
    { label: 'setgoal:degenerate-retry', phase: 'SetGoal', model: 'opus', schema: SPEC })
}

const subgoals = spec.subgoals || []
const RETRIES = Number.isInteger(spec.max_retries) ? spec.max_retries : MAX

// Extract the executor's structured handoff for downstream subgoals (1500-char budget).
function handoffOf(work) {
  const s = String(work || '')
  const m = s.match(/HANDOFF:\s*([\s\S]+)$/)
  return (m ? m[1] : s).trim().slice(0, 1500)
}

// Normalized signature of a rejection (sorted gaps + reason). Two consecutive failing attempts
// with the same signature mean the repair made no progress — abort early instead of burning the
// rest of the bounded RETRIES budget re-attempting an identical gap. Still capped by RETRIES.
function rejectionSig(v) {
  if (!v) return null
  const norm = x => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const gaps = (v.gaps || []).map(norm).filter(Boolean).sort()
  return JSON.stringify([gaps, norm(v.reason)])
}

function safeRunPart(value) {
  return String(value || 'subgoal').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'subgoal'
}

function codexAdapterPrelude(dir) {
  const explicit = codexAdapterPath
    ? `2. First test the explicit adapter path from Workflow args: ${JSON.stringify(codexAdapterPath)}. ` +
      `If it exists, set ADAPTER to that exact path.\n`
    : ''
  return (
    mountSkill('harness:codex-control', 'resolve the Codex CLI adapter across plugin, repo-local, and embedded installs') +
    `\n1. Use Bash to create ${dir}/.\n` +
    explicit +
    `${explicit ? '3' : '2'}. If ADAPTER is still unset, locate it with Bash: prefer ` +
    `harness/engine/codex-exec-adapter.mjs; if absent try ` +
    `.claude/harness/engine/codex-exec-adapter.mjs; if absent follow the codex-control ` +
    `plugin-mode fallback by reading CLAUDE.md's Harness block, deriving the adapter path ` +
    `beside its plugin-root pipeline.js, and testing that file. If no adapter exists, skip ` +
    `Codex and continue directly.\n` +
    `${explicit ? '4' : '3'}. Run detection with that adapter only if ADAPTER is set: ` +
    `node "$ADAPTER" --detect --cwd "$PWD" --output ${dir}/providers.json\n`
  )
}

function codexImplementBridgeInstructions(sg, attempt, accept, ctx, feedback) {
  if (!codexDelegationEnabled) return ''
  const part = `${safeRunPart(sg.id)}-${attempt}`
  const dir = `.harness-run/workflow-codex/${part}/implement`
  return (
    `\n\nCodex CLI bridge is enabled for this Implement subgoal. You are still the Sonnet ` +
    `Implement agent, but first try to delegate the actual code/repo work to local Codex CLI:\n` +
    codexAdapterPrelude(dir) +
    `4. If detection succeeds, write ${dir}/prompt.md with the full implementation request: ` +
    `goal, subgoal title, persona, required skills, project conventions to follow, acceptance criteria, ` +
    `completed-dependency handoffs, and prior rejection feedback if present.\n` +
    `5. Run: node "$ADAPTER" --cwd "$PWD" --prompt-file ${dir}/prompt.md ` +
    `--events-output ${dir}/codex.events.jsonl --output ${dir}/codex.json --sandbox workspace-write\n` +
    `6. Read ${dir}/codex.json. If ok=true, inspect last_message and any changed files needed to ` +
    `understand the result, then produce your normal concise HANDOFF from that result. If Codex is ` +
    `unavailable or exits non-zero, state that in your working notes and implement the subgoal yourself ` +
    `with the normal tools.\n` +
    `7. Never skip the final HANDOFF. Mention the Codex artifact paths if Codex ran.\n` +
    `Acceptance criteria for the Codex prompt:\n${accept}${ctx}` +
    (feedback ? `\nPrior rejection feedback for the Codex prompt:\n${feedback}` : '')
  )
}

function codexTestBridgeInstructions(sg, attempt, tests, work) {
  if (!codexDelegationEnabled) return ''
  const part = `${safeRunPart(sg.id)}-${attempt}`
  const dir = `.harness-run/workflow-codex/${part}/test`
  return (
    `\n\nCodex CLI bridge is enabled for this Test subgoal. You are still the independent ` +
    `Sonnet Test agent, but first try to delegate deterministic verification to local Codex CLI:\n` +
    codexAdapterPrelude(dir) +
    `4. If detection succeeds, write ${dir}/prompt.md with a verification-only request. The prompt ` +
    `must forbid trusting the Implement narrative, require running or inspecting the checks below, ` +
    `and ask Codex to report observed commands, files, outputs, and pass/fail evidence. Do not ask ` +
    `Codex to modify implementation code.\n` +
    `5. Run: node "$ADAPTER" --cwd "$PWD" --prompt-file ${dir}/prompt.md ` +
    `--events-output ${dir}/codex.events.jsonl --output ${dir}/codex.json --sandbox workspace-write\n` +
    `6. Read ${dir}/codex.json. If ok=true, use last_message plus any direct Bash/Read checks you ` +
    `need to produce the required evidence JSON. If Codex is unavailable or exits non-zero, state ` +
    `that in evidence and verify directly with Bash/Read.\n` +
    `7. Never trust the executor account without independent evidence. Mention the Codex artifact ` +
    `paths if Codex ran.\n` +
    `Checks for the Codex prompt:\n${tests || '- (none specified) inspect the claimed artifacts directly'}\n\n` +
    `Executor account for context only:\n${work}`
  )
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
  let feedback = '', prevSig = null, stalled = false
  while (attempt <= RETRIES) {
    attempt++
    work = await agent(
      `Goal: ${spec.goal}\nSubgoal "${sg.title}".${persona}${skills}\n` +
      `If the project defines .claude/conventions/**, Read the ones relevant to your files and follow them.\n` +
      `Acceptance criteria:\n${accept}${ctx}` +
      (feedback ? `\n\nPrevious attempt was rejected. Fix:\n${feedback}` : '') +
      codexImplementBridgeInstructions(sg, attempt, accept, ctx, feedback) +
      `\n\nEnd your reply with a section starting exactly with "HANDOFF:" — max 1500 chars — ` +
      `stating what you produced (paths, names, interfaces) for dependent work to build on.`,
      { label: `impl:${sg.id}:${attempt}`, phase: 'Implement', model: 'sonnet' })

    evidence = await agent(
      mountSkill('completion:verification-before-completion', 'evidence before assertions, always') +
      `\nIndependently verify subgoal "${sg.title}". Do NOT trust the executor's narrative — ` +
      `verify deterministically: run the checks below with Bash, Read the files the executor ` +
      `claims to have produced or changed, and record what you actually observed.\n` +
      `Checks:\n${tests || '- (none specified) inspect the claimed artifacts directly'}\n\n` +
      `Executor's account:\n${work}\n\n` +
      codexTestBridgeInstructions(sg, attempt, tests, work) +
      `\n\n` +
      `verified=true only if every check you ran actually passed and claimed artifacts exist.`,
      { label: `test:${sg.id}:${attempt}`, phase: 'Test', model: 'sonnet', schema: EVIDENCE })

    verdict = await agent(
      mountSkill('think:devils-advocate', 'it structures the strongest objections') +
      `\nJudge subgoal "${sg.title}" against its acceptance criteria. You did NOT produce it — ` +
      `be adversarial. Weigh the independent test evidence over the executor's account.\n` +
      `Acceptance:\n${accept}\n\nIndependent test evidence (verified=${evidence && evidence.verified}):\n` +
      `${evidence ? evidence.evidence : 'none'}\n\nExecutor's account:\n${work}\n\n` +
      `pass=true only if every criterion is genuinely met AND the evidence supports it.`,
      { label: `gate:${sg.id}:${attempt}`, phase: 'QualityGate', model: 'opus', schema: VERDICT })

    if (verdict && verdict.pass) break
    const sig = rejectionSig(verdict)
    if (sig && sig === prevSig) {
      stalled = true
      log(`subgoal "${sg.title}" stalled — attempt ${attempt} repeated the previous attempt's gaps; aborting early (cap ${RETRIES})`)
      break
    }
    prevSig = sig
    feedback =
      ((verdict && (verdict.reason + (verdict.gaps ? '\n' + verdict.gaps.map(g => `- ${g}`).join('\n') : ''))) || 'unspecified') +
      (evidence && !evidence.verified ? `\nTest evidence: ${evidence.evidence}` : '')
  }

  return {
    id: sg.id,
    title: sg.title,
    passed: !!(verdict && verdict.pass),
    attempts: attempt,
    stalled,
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
  return mountSkill('think:devils-advocate', 'it structures the strongest objections') +
    mountMcp('mcp-reasoner', 'weigh the competing pass/fail readings before scoring') +
    `\nAll subgoals have been judged individually. Now judge the ASSEMBLED WHOLE against the ` +
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
let prevGoalSig = rejectionSig(goalGate)
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
  const sig = rejectionSig(goalGate)
  if (goalGate && goalGate.match_pct < GOAL_MATCH_THRESHOLD && sig && sig === prevGoalSig) {
    log(`goal-level repair stalled — repair pass ${goalAttempt} left the same gaps; aborting early (cap ${RETRIES})`)
    break
  }
  prevGoalSig = sig
}
goalGate = { ...goalGate, pass: !!(goalGate && goalGate.match_pct >= GOAL_MATCH_THRESHOLD) }

// ---- Stage 6: Report (sonnet) ----
phase('Report')
const report = await agent(
  `Act as an engineering status reporter: outcome-first, honest about failures, no invented ` +
  `claims — report only what the stages actually produced.\n` +
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
  codex_provider: codexDelegationEnabled ? codexProvider : 'off',
  spec,
  all_passed: failed.length === 0 && !!(goalGate && goalGate.pass),
  failed: failed.map(r => ({ id: r.id, title: r.title, reason: r.verdict && r.verdict.reason })),
  goal_gate: goalGate,
  results: results.map(r => ({ id: r.id, title: r.title, passed: r.passed, attempts: r.attempts, handoff: r.handoff, verdict: r.verdict, evidence: r.evidence })),
  report,
}
