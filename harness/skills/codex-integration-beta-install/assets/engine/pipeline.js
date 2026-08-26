export const meta = {
  name: 'harness-engine',
  description: 'Six-stage Plan→SetGoal→Implement→Test→QualityGate→Report engine over a raw request',
  phases: [
    { title: 'Plan', detail: 'decompose request, map repo skills', model: 'opus' },
    { title: 'SetGoal', detail: 'author goal-spec + adversarial critic', model: 'opus' },
    { title: 'Implement', detail: 'provider-routed executor per subgoal; Codex first when delegated', model: 'provider' },
    { title: 'Test', detail: 'provider-routed deterministic verification; Codex first when delegated', model: 'provider' },
    { title: 'QualityGate', detail: 'adversarial judge per subgoal + goal-level gate', model: 'opus' },
    { title: 'Report', detail: 'synthesize final report from stage facts', model: 'sonnet' },
  ],
}

// args = { request: string, context?: string, max_retries?: number,
//          codex_provider?: 'auto'|'required'|'off', codex_add_dirs?: string[] }
// Six baked stages, model-pinned so the flow holds regardless of the main-session model:
//   Plan(opus) → SetGoal(opus, +critic) → per subgoal [Implement(provider-routed)
//   → Test(provider-routed) → QualityGate(opus)] looped up to max_retries
//   → goal-level QualityGate(opus) → Report(sonnet).

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
const codexProviderRequired = ['required', 'require', 'must', 'strict'].includes(codexProvider)
const codexAdapterPath = String(req.codex_adapter_path || req.codexAdapterPath || '').trim()
const codexAddDirs = Array.isArray(req.codex_add_dirs)
  ? req.codex_add_dirs.map(String).map(s => s.trim()).filter(Boolean)
  : []
let providerResolution = null

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

const CODEX_IMPLEMENT_NODE = {
  type: 'object',
  properties: {
    node_id: { type: 'string' },
    provider: { type: 'string', enum: ['codex'] },
    transport_ok: { type: 'boolean' },
    stage_ok: { type: 'boolean' },
    handoff: { type: 'string' },
    changed_files: { type: 'array', items: { type: 'string' } },
    checks: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
    artifacts: { type: 'array', items: { type: 'string' } },
  },
  required: ['node_id', 'provider', 'transport_ok', 'stage_ok', 'handoff', 'changed_files', 'checks', 'evidence', 'artifacts'],
}

const CODEX_PROVIDER_RESOLUTION = {
  type: 'object',
  properties: {
    node_id: { type: 'string' },
    provider: { type: 'string', enum: ['codex'] },
    ready: { type: 'boolean' },
    adapter_path: { type: 'string' },
    evidence: { type: 'string' },
    artifacts: { type: 'array', items: { type: 'string' } },
  },
  required: ['node_id', 'provider', 'ready', 'adapter_path', 'evidence', 'artifacts'],
}

const CODEX_TEST_NODE = {
  type: 'object',
  properties: {
    node_id: { type: 'string' },
    provider: { type: 'string', enum: ['codex'] },
    transport_ok: { type: 'boolean' },
    stage_ok: { type: 'boolean' },
    verified: { type: 'boolean' },
    checks: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
    artifacts: { type: 'array', items: { type: 'string' } },
  },
  required: ['node_id', 'provider', 'transport_ok', 'stage_ok', 'verified', 'checks', 'evidence', 'artifacts'],
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
    ? `Provider routing is graph-level, not part of the goal-spec: every Implement and Test ` +
      `stage is scheduled as a Codex provider node. Sonnet is not the actor unless that node ` +
      `fails and ${codexProviderRequired ? 'this run forbids fallback' : 'the explicit fallback edge is taken'}. `
    : `codex_provider is off, so Implement and Test use Sonnet nodes. `) +
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

function codexAddDirArgs() {
  return codexAddDirs.map(dir => ` --add-dir ${JSON.stringify(dir)}`).join('')
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
    `beside its plugin-root pipeline.js, and testing that file. If no adapter exists, treat ` +
    `Codex routing as unavailable and follow the fallback/required rule below.\n` +
    `${explicit ? '4' : '3'}. Run detection with that adapter only if ADAPTER is set: ` +
    `node "$ADAPTER" --detect --cwd "$PWD" --output ${dir}/providers.json\n`
  )
}

function stageProvider() {
  if (!codexDelegationEnabled) return 'sonnet'
  if (providerResolution && providerResolution.ready) return 'codex'
  return codexProviderRequired ? 'provider-failure' : 'sonnet-fallback'
}

function codexProviderResolutionInstructions() {
  const dir = `.harness-run/workflow-codex/provider`
  return (
    `You are a provider-resolution node, not an Implement or Test actor. Resolve the adapter and ` +
    `probe Codex exactly once for this Workflow run. Do not edit project files.\n\n` +
    codexAdapterPrelude(dir) +
    `Read ${dir}/providers.json. Return node_id="provider:resolve:codex", provider="codex", ` +
    `ready from codex.ready, the resolved adapter's absolute path, concise evidence, and artifacts ` +
    `containing ${dir}/providers.json. If no adapter exists, return ready=false and an empty ` +
    `adapter_path. Do not retry and do not fall back inside this node.`
  )
}

function codexResolvedAdapterPrelude(dir) {
  return (
    `1. Use Bash to create ${dir}/.\n` +
    `2. Use the already-resolved adapter at ${JSON.stringify((providerResolution && providerResolution.adapter_path) || '')}. ` +
    `Do not run detection again and do not locate a different adapter.\n`
  )
}

function codexImplementBridgeInstructions(sg, attempt, accept, ctx, feedback) {
  const part = `${safeRunPart(sg.id)}-${attempt}`
  const dir = `.harness-run/workflow-codex/${part}/implement`
  const nodeId = `implement:${sg.id}:${attempt}:codex`
  return (
    `You are the transport controller for provider node ${nodeId}. You are not the implementation ` +
    `actor and must not implement, inspect, or repair the subgoal yourself. Your only work is to ` +
    `resolve the adapter, invoke Codex, read its structured report, and return this node's state.\n\n` +
    codexResolvedAdapterPrelude(dir) +
    `3. Write ${dir}/prompt.md with the full implementation request: ` +
    `goal, subgoal title, persona, required skills, project conventions to follow, acceptance criteria, ` +
    `completed-dependency handoffs, and prior rejection feedback if present.\n` +
    `The Codex prompt must require the exact implement stage JSON contract: stage_ok=false when ` +
    `required work or checks could not run; otherwise include handoff, changed_files, checks, and evidence.\n` +
    `4. Run the resolved adapter: node ${JSON.stringify((providerResolution && providerResolution.adapter_path) || '')} ` +
    `--stage implement --cwd "$PWD" --prompt-file ${dir}/prompt.md ` +
    `--events-output ${dir}/codex.events.jsonl --output ${dir}/codex.json --sandbox workspace-write` +
    `${codexAddDirArgs()}\n` +
    `5. Read ${dir}/codex.json and copy transport_ok plus result fields into the required node schema. ` +
    `Set node_id=${JSON.stringify(nodeId)}, provider="codex", and artifacts to the existing prompt, report, and event paths under ` +
    `${dir}. If detection, transport, schema validation, or stage execution fails, return ` +
    `stage_ok=false with the exact failure evidence. Never fall back or do stage work in this node.\n` +
    `\nGoal for the Codex prompt: ${spec.goal}\n` +
    `Subgoal for the Codex prompt: ${sg.id} — ${sg.title}\n` +
    (sg.persona ? `Persona for the Codex prompt: ${sg.persona}\n` : '') +
    ((sg.skills || []).length ? `Skills/conventions to mention in the Codex prompt: ${(sg.skills || []).join(', ')}\n` : '') +
    `Acceptance criteria for the Codex prompt:\n${accept}${ctx}` +
    (feedback ? `\nPrior rejection feedback for the Codex prompt:\n${feedback}` : '')
  )
}

function codexTestBridgeInstructions(sg, attempt, tests, work) {
  const part = `${safeRunPart(sg.id)}-${attempt}`
  const dir = `.harness-run/workflow-codex/${part}/test`
  const nodeId = `test:${sg.id}:${attempt}:codex`
  return (
    `You are the transport controller for provider node ${nodeId}. You are not the verifier and ` +
    `must not run checks, inspect implementation files, edit code, or repair failures yourself. ` +
    `Resolve the adapter, invoke a separate Codex process, read its structured report, and return ` +
    `this node's state.\n\n` +
    codexResolvedAdapterPrelude(dir) +
    `3. Write ${dir}/prompt.md with a verification-only request. The prompt ` +
    `must forbid trusting the Implement narrative, require running or inspecting the checks below, ` +
    `and ask Codex to report observed commands, files, outputs, and pass/fail evidence. Do not ask ` +
    `Codex to modify implementation code. The Codex prompt must require stage_ok=false if any required ` +
    `check could not run because of sandbox/tooling; verified=false with stage_ok=true means checks ran ` +
    `and found a genuine acceptance failure.\n` +
    `4. Run the resolved adapter: node ${JSON.stringify((providerResolution && providerResolution.adapter_path) || '')} ` +
    `--stage test --cwd "$PWD" --prompt-file ${dir}/prompt.md ` +
    `--events-output ${dir}/codex.events.jsonl --output ${dir}/codex.json --sandbox workspace-write` +
    `${codexAddDirArgs()}\n` +
    `5. Read ${dir}/codex.json and copy transport_ok plus result fields into the required node schema. ` +
    `Set node_id=${JSON.stringify(nodeId)}, provider="codex", and artifacts to the existing prompt, report, and event paths under ` +
    `${dir}. If detection, transport, schema validation, or stage execution fails, return stage_ok=false ` +
    `and verified=false with exact evidence. Never fall back or do Test work in this node.\n` +
    `Goal for the Codex prompt: ${spec.goal}\n` +
    `Subgoal for the Codex prompt: ${sg.id} — ${sg.title}\n` +
    `Checks for the Codex prompt:\n${tests || '- (none specified) inspect the claimed artifacts directly'}\n\n` +
    `Executor account for context only:\n${work}`
  )
}

function sonnetImplementInstructions(sg, accept, ctx, feedback, persona, skills) {
  return (
    `Goal: ${spec.goal}\nSubgoal "${sg.title}".${persona}${skills}\n` +
    `If the project defines .claude/conventions/**, Read the ones relevant to your files and follow them.\n` +
    `Acceptance criteria:\n${accept}${ctx}` +
    (feedback ? `\n\nPrevious attempt was rejected. Fix:\n${feedback}` : '') +
    `\n\nEnd your reply with a section starting exactly with "HANDOFF:" — max 1500 chars — ` +
    `stating what you produced (paths, names, interfaces) for dependent work to build on.`
  )
}

function sonnetTestInstructions(sg, tests, work) {
  return (
    mountSkill('completion:verification-before-completion', 'evidence before assertions, always') +
    `\nIndependently verify subgoal "${sg.title}". Do NOT trust the executor's narrative — ` +
    `verify deterministically: run the checks below with Bash, Read the files the executor ` +
    `claims to have produced or changed, and record what you actually observed.\n` +
    `Checks:\n${tests || '- (none specified) inspect the claimed artifacts directly'}\n\n` +
    `Executor's account:\n${work}\n\n` +
    `verified=true only if every check you ran actually passed and claimed artifacts exist.`
  )
}

function codexGoalRepairInstructions(goalGate, goalAttempt) {
  const dir = `.harness-run/workflow-codex/goal-repair-${goalAttempt}/implement`
  const nodeId = `implement:goal-repair:${goalAttempt}:codex`
  const gaps = goalGate && goalGate.gaps
    ? goalGate.gaps.map(g => `- ${g}`).join('\n')
    : goalGate ? goalGate.reason : 'no verdict'
  return (
    `You are the transport controller for provider node ${nodeId}. You are not the repair actor. ` +
    `Resolve the adapter, invoke Codex, read its structured report, and return node state only.\n\n` +
    codexResolvedAdapterPrelude(dir) +
    `3. Write ${dir}/prompt.md with a concrete repair request containing ` +
    `the goal, the goal-gate score/reason/gaps below, and the subgoal handoffs. Ask Codex to ` +
    `produce the missing/fixed work, not a plan.\n` +
    `Require the exact implement stage JSON contract from Codex. ` +
    `4. Run the resolved adapter: node ${JSON.stringify((providerResolution && providerResolution.adapter_path) || '')} ` +
    `--stage implement --cwd "$PWD" --prompt-file ${dir}/prompt.md ` +
    `--events-output ${dir}/codex.events.jsonl --output ${dir}/codex.json --sandbox workspace-write` +
    `${codexAddDirArgs()}\n` +
    `5. Read ${dir}/codex.json and return the required Codex Implement node schema with ` +
    `node_id=${JSON.stringify(nodeId)}, provider="codex", and artifacts under ${dir}. On any ` +
    `provider or stage failure return stage_ok=false with exact evidence. Never fall back or repair directly.\n` +
    `\nGoal: ${spec.goal}\nGoal-level gaps to repair:\n${gaps}\n\nSubgoal handoffs:\n` +
    results.map(r => `- ${r.id} "${r.title}": ${r.handoff}`).join('\n') +
    `\n\nEnd with a "HANDOFF:" section (max 1500 chars) describing what changed.`
  )
}

function codexGoalRepairTestInstructions(repair, goalAttempt) {
  const dir = `.harness-run/workflow-codex/goal-repair-${goalAttempt}/test`
  const nodeId = `test:goal-repair:${goalAttempt}:codex`
  const checks = subgoals.flatMap(sg => sg.test || []).map(check => `- ${check}`).join('\n')
  return (
    `You are the transport controller for provider node ${nodeId}. You are not the verifier. ` +
    `Resolve the adapter, invoke a separate Codex process, read its structured report, and return node state only.\n\n` +
    codexResolvedAdapterPrelude(dir) +
    `3. Write ${dir}/prompt.md with a verification-only request. It must ` +
    `forbid edits and require fresh evidence for the goal-level criteria and applicable checks below. ` +
    `Require stage_ok=false when required checks cannot run; verified=false with stage_ok=true only ` +
    `when completed checks find a genuine failure.\n` +
    `4. Run the resolved adapter: node ${JSON.stringify((providerResolution && providerResolution.adapter_path) || '')} ` +
    `--stage test --cwd "$PWD" --prompt-file ${dir}/prompt.md ` +
    `--events-output ${dir}/codex.events.jsonl --output ${dir}/codex.json --sandbox workspace-write` +
    `${codexAddDirArgs()}\n` +
    `5. Read ${dir}/codex.json and return the required Codex Test node schema with ` +
    `node_id=${JSON.stringify(nodeId)}, provider="codex", and artifacts under ${dir}. On any ` +
    `provider or stage failure return stage_ok=false and verified=false. Never fall back or verify directly.\n` +
    `Goal: ${spec.goal}\nGoal-level acceptance:\n` +
    (spec.acceptance || []).map(item => `- ${item}`).join('\n') +
    `\nChecks:\n${checks || '- Inspect the assembled artifacts against every goal-level criterion.'}\n` +
    `Repair account for context only:\n${repair}`
  )
}

function sonnetGoalRepairInstructions(goalGate) {
  return (
    `The assembled result scored ${goalGate ? goalGate.match_pct : 0}% against the goal (threshold ${GOAL_MATCH_THRESHOLD}%). ` +
    `Address these gaps directly — do not restate the plan, produce the missing/fixed work:\n` +
    (goalGate && goalGate.gaps ? goalGate.gaps.map(g => `- ${g}`).join('\n') : goalGate ? goalGate.reason : 'no verdict') +
    `\n\nGoal: ${spec.goal}\nSubgoal outcomes so far:\n` +
    results.map(r => `- ${r.id} "${r.title}": ${r.handoff}`).join('\n') +
    `\n\nEnd with a "HANDOFF:" section (max 1500 chars) describing what you fixed.`
  )
}

const providerNodes = []
if (codexDelegationEnabled) {
  providerResolution = await agent(
    codexProviderResolutionInstructions(),
    {
      label: 'node:provider:resolve:codex',
      phase: 'Implement',
      model: 'sonnet',
      schema: CODEX_PROVIDER_RESOLUTION,
    })
  providerNodes.push({
    ...providerResolution,
    kind: 'provider-resolution',
    state: providerResolution && providerResolution.ready ? 'succeeded' : 'failed',
  })
} else {
  providerResolution = { provider: 'codex', ready: false, adapter_path: '', evidence: 'codex_provider=off', artifacts: [] }
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
    const implementProvider = stageProvider()
    if (implementProvider === 'codex') {
      const node = await agent(
        codexImplementBridgeInstructions(sg, attempt, accept, ctx, feedback),
        {
          label: `node:impl:${sg.id}:${attempt}:codex`,
          phase: 'Implement',
          model: 'sonnet',
          schema: CODEX_IMPLEMENT_NODE,
        })
      providerNodes.push({ ...node, kind: 'implement', state: node && node.stage_ok ? 'succeeded' : 'failed' })
      if (node && node.stage_ok) {
        work = `HANDOFF:\n${node.handoff}\n\nCodex checks:\n${(node.checks || []).join('\n')}\n${node.evidence}`
      } else if (codexProviderRequired) {
        work = `HANDOFF:\nPROVIDER_FAILURE: Codex Implement node failed. ${(node && node.evidence) || 'No structured provider evidence.'}`
      } else {
        work = await agent(
          sonnetImplementInstructions(sg, accept, ctx,
            `${feedback ? `${feedback}\n` : ''}DEGRADED: Codex Implement node failed. ${(node && node.evidence) || 'No structured provider evidence.'}`,
            persona, skills),
          { label: `impl:${sg.id}:${attempt}:sonnet-fallback`, phase: 'Implement', model: 'sonnet' })
      }
    } else if (implementProvider === 'provider-failure') {
      work = `HANDOFF:\nPROVIDER_FAILURE: Codex provider resolution failed and codex_provider=required. ${providerResolution.evidence}`
    } else {
      const fallback = implementProvider === 'sonnet-fallback'
      work = await agent(
        sonnetImplementInstructions(
          sg, accept, ctx,
          `${feedback}${fallback ? `${feedback ? '\n' : ''}DEGRADED: Codex provider unavailable. ${providerResolution.evidence}` : ''}`,
          persona, skills),
        {
          label: fallback ? `impl:${sg.id}:${attempt}:sonnet-fallback` : `impl:${sg.id}:${attempt}:sonnet`,
          phase: 'Implement',
          model: 'sonnet',
        })
    }

    const testProvider = stageProvider()
    if (testProvider === 'codex') {
      const node = await agent(
        codexTestBridgeInstructions(sg, attempt, tests, work),
        {
          label: `node:test:${sg.id}:${attempt}:codex`,
          phase: 'Test',
          model: 'sonnet',
          schema: CODEX_TEST_NODE,
        })
      providerNodes.push({ ...node, kind: 'test', state: node && node.stage_ok ? 'succeeded' : 'failed' })
      if (node && node.stage_ok) {
        evidence = { verified: !!node.verified, checks: node.checks || [], evidence: node.evidence }
      } else if (codexProviderRequired) {
        evidence = {
          verified: false,
          checks: (node && node.checks) || [],
          evidence: `PROVIDER_FAILURE: Codex Test node failed. ${(node && node.evidence) || 'No structured provider evidence.'}`,
        }
      } else {
        evidence = await agent(
          sonnetTestInstructions(sg, tests,
            `${work}\n\nDEGRADED: Codex Test node failed. ${(node && node.evidence) || 'No structured provider evidence.'}`),
          {
            label: `test:${sg.id}:${attempt}:sonnet-fallback`,
            phase: 'Test',
            model: 'sonnet',
            schema: EVIDENCE,
          })
      }
    } else if (testProvider === 'provider-failure') {
      evidence = {
        verified: false,
        checks: [],
        evidence: `PROVIDER_FAILURE: Codex provider resolution failed and codex_provider=required. ${providerResolution.evidence}`,
      }
    } else {
      const fallback = testProvider === 'sonnet-fallback'
      evidence = await agent(
        sonnetTestInstructions(sg, tests,
          `${work}${fallback ? `\n\nDEGRADED: Codex provider unavailable. ${providerResolution.evidence}` : ''}`),
        {
          label: fallback ? `test:${sg.id}:${attempt}:sonnet-fallback` : `test:${sg.id}:${attempt}:sonnet`,
          phase: 'Test',
          model: 'sonnet',
          schema: EVIDENCE,
        })
    }

    const judged = await agent(
      mountSkill('think:devils-advocate', 'it structures the strongest objections') +
      `\nJudge subgoal "${sg.title}" against its acceptance criteria. You did NOT produce it. ` +
      `This is a read-only reasoning node: do not run commands, inspect additional files, edit code, ` +
      `or repair the work. Judge only the supplied evidence.\n` +
      `Acceptance:\n${accept}\n\nIndependent test evidence:\n` +
      `${JSON.stringify(evidence, null, 2)}\n\nExecutor's account:\n${work}\n\n` +
      `pass=true only if every criterion is genuinely met AND verified=true.`,
      { label: `gate:${sg.id}:${attempt}`, phase: 'QualityGate', model: 'opus', schema: VERDICT })

    verdict = evidence && evidence.verified
      ? judged
      : {
          ...judged,
          pass: false,
          reason: `Test node did not verify the subgoal. ${(judged && judged.reason) || ''}`.trim(),
          gaps: [...((judged && judged.gaps) || []), 'Independent Test evidence has verified=false.'],
        }

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
    `mean the goal is met. This is a read-only reasoning node: do not run commands, inspect ` +
    `additional files, edit code, or repair the work. Judge only the supplied evidence. ` +
    `Score match_pct = your honest estimate (0-100) of how fully the ` +
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
  const repairProvider = stageProvider()
  let repair = null
  if (repairProvider === 'codex') {
    const node = await agent(
      codexGoalRepairInstructions(goalGate, goalAttempt),
      {
        label: `node:repair:goal:${goalAttempt}:codex`,
        phase: 'Implement',
        model: 'sonnet',
        schema: CODEX_IMPLEMENT_NODE,
      })
    providerNodes.push({ ...node, kind: 'implement', state: node && node.stage_ok ? 'succeeded' : 'failed' })
    if (node && node.stage_ok) {
      repair = `HANDOFF:\n${node.handoff}\n\nCodex checks:\n${(node.checks || []).join('\n')}\n${node.evidence}`
    } else if (codexProviderRequired) {
      repair = `HANDOFF:\nPROVIDER_FAILURE: Codex goal-repair node failed. ${(node && node.evidence) || 'No structured provider evidence.'}`
    } else {
      repair = await agent(
        sonnetGoalRepairInstructions(goalGate) +
          `\n\nDEGRADED: Codex goal-repair node failed. ${(node && node.evidence) || 'No structured provider evidence.'}`,
        { label: `repair:goal:${goalAttempt}:sonnet-fallback`, phase: 'Implement', model: 'sonnet' })
    }
  } else if (repairProvider === 'provider-failure') {
    repair = `HANDOFF:\nPROVIDER_FAILURE: Codex provider resolution failed and codex_provider=required. ${providerResolution.evidence}`
  } else {
    const fallback = repairProvider === 'sonnet-fallback'
    repair = await agent(
      sonnetGoalRepairInstructions(goalGate) +
        (fallback ? `\n\nDEGRADED: Codex provider unavailable. ${providerResolution.evidence}` : ''),
      {
        label: fallback ? `repair:goal:${goalAttempt}:sonnet-fallback` : `repair:goal:${goalAttempt}:sonnet`,
        phase: 'Implement',
        model: 'sonnet',
      })
  }

  let repairEvidence = null
  if (repairProvider === 'codex') {
    const node = await agent(
      codexGoalRepairTestInstructions(repair, goalAttempt),
      {
        label: `node:test:goal-repair:${goalAttempt}:codex`,
        phase: 'Test',
        model: 'sonnet',
        schema: CODEX_TEST_NODE,
      })
    providerNodes.push({ ...node, kind: 'test', state: node && node.stage_ok ? 'succeeded' : 'failed' })
    if (node && node.stage_ok) {
      repairEvidence = { verified: !!node.verified, checks: node.checks || [], evidence: node.evidence }
    } else if (codexProviderRequired) {
      repairEvidence = {
        verified: false,
        checks: (node && node.checks) || [],
        evidence: `PROVIDER_FAILURE: Codex goal-repair Test node failed. ${(node && node.evidence) || 'No structured provider evidence.'}`,
      }
    } else {
      repairEvidence = await agent(
        sonnetTestInstructions(
          { title: 'goal-level repair' },
          subgoals.flatMap(sg => sg.test || []).map(check => `- ${check}`).join('\n'),
          `${repair}\n\nDEGRADED: Codex goal-repair Test node failed. ${(node && node.evidence) || 'No structured provider evidence.'}`),
        { label: `test:goal-repair:${goalAttempt}:sonnet-fallback`, phase: 'Test', model: 'sonnet', schema: EVIDENCE })
    }
  } else if (repairProvider === 'provider-failure') {
    repairEvidence = {
      verified: false,
      checks: [],
      evidence: `PROVIDER_FAILURE: Codex provider resolution failed and codex_provider=required. ${providerResolution.evidence}`,
    }
  } else {
    const fallback = repairProvider === 'sonnet-fallback'
    repairEvidence = await agent(
      sonnetTestInstructions(
        { title: 'goal-level repair' },
        subgoals.flatMap(sg => sg.test || []).map(check => `- ${check}`).join('\n'),
        `${repair}${fallback ? `\n\nDEGRADED: Codex provider unavailable. ${providerResolution.evidence}` : ''}`),
      {
        label: fallback ? `test:goal-repair:${goalAttempt}:sonnet-fallback` : `test:goal-repair:${goalAttempt}:sonnet`,
        phase: 'Test',
        model: 'sonnet',
        schema: EVIDENCE,
      })
  }

  results.push({ id: `repair-${goalAttempt}`, title: 'goal-level repair', passed: null, attempts: 1, handoff: handoffOf(repair), work: repair, evidence: repairEvidence, verdict: null })
  goalGate = await agent(
    goalPrompt(`\n\nRepair pass applied:\n${handoffOf(repair)}\n\nRepair Test evidence:\n${JSON.stringify(repairEvidence, null, 2)}`),
    { label: `gate:goal:${goalAttempt}`, phase: 'QualityGate', model: 'opus', schema: GOAL_VERDICT })
  if (!repairEvidence || !repairEvidence.verified) {
    goalGate = {
      ...goalGate,
      match_pct: Math.min((goalGate && goalGate.match_pct) || 0, GOAL_MATCH_THRESHOLD - 1),
      reason: `Goal repair was not independently verified. ${(goalGate && goalGate.reason) || ''}`.trim(),
      gaps: [...((goalGate && goalGate.gaps) || []), 'Goal-repair Test evidence has verified=false.'],
    }
  }
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
  provider_nodes: providerNodes,
  results: results.map(r => ({ id: r.id, title: r.title, passed: r.passed, attempts: r.attempts, handoff: r.handoff, verdict: r.verdict, evidence: r.evidence })),
  report,
}
