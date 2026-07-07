export const meta = {
  name: 'gajae-goal-execution',
  description: 'Per-goal Planner→Critic→[Executor↔Verifier]×3 with 3-layer verification',
  phases: [
    { title: 'Plan' }, { title: 'Critique' },
    { title: 'Execute' }, { title: 'Verify' },
  ],
}

// args = { goals: [{id,title,acceptance_criteria,skill_hints}], root: '.claude/harness' }
const MAX = 3
const VERDICT = {
  type: 'object',
  properties: {
    acceptance_ok: { type: 'boolean' },
    plan_adherence_ok: { type: 'boolean' },
    work_product_ok: { type: 'boolean' },
    blocker: { type: 'string' },
  },
  required: ['acceptance_ok', 'plan_adherence_ok', 'work_product_ok'],
}

const results = []
for (const goal of (args.goals || [])) {
  log(`goal ${goal.id}: ${goal.title}`)
  // Plan
  const plan = await agent(
    `Plan execution for goal "${goal.title}". Acceptance: ${JSON.stringify(goal.acceptance_criteria)}. ` +
    `Produce a concrete step list. Do NOT mutate files (planning only).`,
    { label: `plan:${goal.id}`, phase: 'Plan' })

  // Critique (≤3 revise)
  let critique, revisedPlan = plan, round = 0
  do {
    critique = await agent(
      `Devils-advocate review of this plan for "${goal.title}":\n${revisedPlan}\n` +
      `Return APPROVE or REVISE:<reason>. Use think:devils-advocate.`,
      { label: `critique:${goal.id}:${round}`, phase: 'Critique' })
    if (!/REVISE/i.test(critique || '')) break
    revisedPlan = await agent(
      `Revise the plan addressing: ${critique}`,
      { label: `replan:${goal.id}:${round}`, phase: 'Plan' })
    round++
  } while (round < MAX)

  // Execute ↔ Verify loop (≤3)
  let verdict = null, attempt = 0, passed = false
  while (attempt < MAX) {
    attempt++
    const work = await agent(
      `Execute goal "${goal.title}" following this plan:\n${revisedPlan}\n` +
      `Invoke these skills as appropriate: ${JSON.stringify(goal.skill_hints)}. ` +
      `Report what you changed with evidence (paths, commands, output).`,
      { label: `exec:${goal.id}:${attempt}`, phase: 'Execute' })
    verdict = await agent(
      `Independently verify goal "${goal.title}" in 3 layers, each a separate judgment:\n` +
      `(a) acceptance criteria ${JSON.stringify(goal.acceptance_criteria)} satisfied?\n` +
      `(b) plan-adherence: does the actual change match the plan?\n` +
      `(c) work-product: read the artifact itself — is it correct?\n` +
      `Evidence from executor:\n${work}\n` +
      `Use completion:verification-before-completion. Set blocker if any layer fails.`,
      { label: `verify:${goal.id}:${attempt}`, phase: 'Verify', schema: VERDICT })
    passed = verdict && verdict.acceptance_ok && verdict.plan_adherence_ok && verdict.work_product_ok
    if (passed) break
    log(`goal ${goal.id} attempt ${attempt} FAILED: ${verdict?.blocker || 'unspecified'}`)
  }

  results.push({ id: goal.id, passed, attempts: attempt,
                 blocker: passed ? null : (verdict?.blocker || '3 attempts exhausted') })
  if (!passed) {
    log(`🛑 goal ${goal.id} FAILED after ${attempt} attempts — stopping its pipeline, reporting to user`)
  }
}
return results
