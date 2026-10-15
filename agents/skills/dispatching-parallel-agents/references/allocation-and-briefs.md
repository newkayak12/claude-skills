# Allocation and briefs

Detail for steps 1 (ALLOCATE) and 2 (DISPATCH) of `SKILL.md`.

## Persona matching

Read the job, extract its dominant signal (language, layer, failure type, artifact),
and pick the persona whose specialty covers it. Match *dynamically* on the signal —
the table below is illustration, not a closed list. Whatever specialist agents your
environment exposes, route to the closest one; when nothing fits, use
`general-purpose`.

| Job signal | Persona to mount |
|------------|------------------|
| Kotlin / JVM code change | kotlin-specialist |
| Slow query, index, N+1, connection pool | sql-pro / database-optimizer |
| Frontend UI / component / styling bug | frontend-developer |
| Flaky / intermittently failing test | flaky-test-analyzer |
| Code quality / readability review | clean-code reviewer |
| Infra / deploy / SRE incident | sre / operations specialist |
| No clean specialty match | general-purpose |

The value is the **method**: signal → specialist. A generalist can do any one job,
but the persona-matched agent brings the right defaults, vocabulary, and failure
instincts, so its output needs less correction on gather.

## Dispatch example

```
# All run at once — one persona-matched agent per independent job
Agent(subagent_type=flaky-test-analyzer, isolation="worktree", prompt="Fix agent-tool-abort.test.ts — 3 timing failures …")
Agent(subagent_type=database-optimizer,  isolation="worktree", prompt="Cut p99 on GET /orders — slow query, see EXPLAIN …")
Agent(subagent_type=frontend-developer,  isolation="worktree", prompt="Fix cart badge not updating after remove …")
```

## Example brief

```markdown
You are a flaky-test-analyzer. Fix the 3 failing tests in
src/agents/agent-tool-abort.test.ts:

1. "should abort tool with partial output capture" — expects 'interrupted at' in message
2. "should handle mixed completed and aborted tools" — fast tool aborted instead of completed
3. "should properly track pendingToolCount" — expects 3 results but gets 0

These look like timing/race issues. Your task:
1. Read the test file; understand what each test verifies.
2. Find the root cause — timing vs a real bug.
3. Fix by replacing arbitrary timeouts with event-based waiting; fix the abort
   implementation if it's a real bug; adjust expectations only if behavior changed.

Do NOT just increase timeouts, and do NOT touch other test files.
Return: root cause + exactly what you changed.
```
