export const meta = {
  name: 'harness-engine',
  description: 'Fixed decompose→act→independent-check→loop engine driven by a declarative goal-spec (B)',
  phases: [{ title: 'Act' }, { title: 'Check' }],
}

// args = goal-spec (authored at planning time — see harness/goal-spec.md):
// {
//   goal:        string                      // north star for this request
//   acceptance:  string[]                    // goal-level criteria the report is judged against
//   subgoals: [{ id, title, persona?, acceptance: string[], deps?: string[] }]
//   max_retries: number                      // per-subgoal retry cap (default 2)
// }
//
// Baked flow (model-independent): each subgoal is executed by an executor subagent,
// then judged by a SEPARATE judge subagent against its acceptance (no self-eval),
// and retried up to max_retries feeding the judge's reason back. Subgoals run in
// dependency waves — everything with satisfied deps runs in parallel.

const spec = args || {}
const subgoals = spec.subgoals || []
const MAX = Number.isInteger(spec.max_retries) ? spec.max_retries : 2

const VERDICT = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    reason: { type: 'string' },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['pass', 'reason'],
}

// One subgoal: act → check → loop (bounded). Returns a result record.
async function runSubgoal(sg, upstream) {
  const ctx = upstream.length
    ? `\nCompleted dependencies (for context):\n${upstream.map(u => `- ${u.id}: ${u.summary}`).join('\n')}`
    : ''
  const persona = sg.persona ? ` Act as: ${sg.persona}.` : ''
  const accept = (sg.acceptance || []).map(a => `- ${a}`).join('\n')

  let work = null, verdict = null, attempt = 0
  let feedback = ''
  while (attempt <= MAX) {
    attempt++
    work = await agent(
      `Goal: ${spec.goal}\nSubgoal "${sg.title}".${persona}\n` +
      `Acceptance criteria:\n${accept}${ctx}` +
      (feedback ? `\n\nPrevious attempt was rejected. Fix:\n${feedback}` : ''),
      { label: `act:${sg.id}:${attempt}`, phase: 'Act' })

    verdict = await agent(
      `Independently judge this work for subgoal "${sg.title}" against its acceptance criteria. ` +
      `You did NOT produce it — be adversarial.\nAcceptance:\n${accept}\n\nWork:\n${work}\n\n` +
      `Return pass=true only if every criterion is genuinely met.`,
      { label: `check:${sg.id}:${attempt}`, phase: 'Check', schema: VERDICT })

    if (verdict && verdict.pass) break
    feedback = (verdict && (verdict.reason + (verdict.gaps ? '\n' + verdict.gaps.map(g => `- ${g}`).join('\n') : ''))) || 'unspecified'
  }

  return {
    id: sg.id,
    title: sg.title,
    passed: !!(verdict && verdict.pass),
    attempts: attempt,
    summary: work ? String(work).slice(0, 400) : '',
    work,
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

return {
  goal: spec.goal,
  acceptance: spec.acceptance || [],
  all_passed: failed.length === 0,
  failed: failed.map(r => ({ id: r.id, title: r.title, reason: r.verdict && r.verdict.reason })),
  results,
}
