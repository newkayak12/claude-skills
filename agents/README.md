# agents

**English** · [한국어](KOR.md)

Skills for handing work to other agents instead of doing it all in one context. The three cover
the sequence that multi-agent work actually follows: cut a large, vague task into subtasks with
clear boundaries and ready-to-paste prompts; fan independent jobs out concurrently, each on the
persona it calls for; or walk a written plan task by task with a fresh subagent per task and a
two-stage review after each. What they share is a stance — an agent only succeeds when its scope,
inputs, constraints, and output shape are stated up front, and its "done" is settled by evidence
rather than its own summary.

## Install & Uninstall

```bash
/plugin install agents@newkayak12-claude-skills
/plugin uninstall agents@newkayak12-claude-skills
```

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Split one big or fuzzy task into agent-ready subtasks with written prompts | `agent-task-decomposer` |
| Run several unrelated jobs at once, each on a matching specialist | `dispatching-parallel-agents` |
| Execute a plan task by task, fresh subagent + review each time | `subagent-driven-development` |

## Skills

### `agent-task-decomposer`

Turns a task that is too large or too vague for one agent into bounded subtasks, then writes the
prompt for each. It maps the full task, cuts along a real seam (domain, artifact, phase, or
component), draws the dependency graph, isolates the context each subtask needs, and only then
writes prompts. It refuses to decompose an ambiguous task — it asks one focused question first,
because a precise decomposition of a fuzzy goal produces precise confusion.

```
This "add team workspaces" feature is too big to hand to one agent. Break it into
subtasks with dependencies mapped, and write the prompt for each one.
```

Every generated prompt carries five elements — concrete goal, explicit inputs, hard constraints,
output format, verification step — and the decomposition is emitted as:

```
## Task Overview
## Dependency Graph
## Subtask N: [Name]
**Runs:** [immediately / after Subtask X completes]
**Input:** …  **Output:** …
### Optimized Prompt
```

Granularity guide: a 30-minute task is 1–2 subtasks, a half-day task 3–5, a multi-day task 5–10
with each half a day or less.

### `dispatching-parallel-agents`

A job allocator for 2+ independent jobs: it fans them out concurrently and mounts the best-fit
persona on each — SQL work to a database optimizer, a flaky test to a flaky-test analyst, a UI bug
to a frontend agent, no clean match to general-purpose. Not for related jobs where fixing one may
fix another, jobs that need full system state to understand, or agents that would edit the same
files — investigate those together instead. It is horizontal fan-out of unrelated jobs, the
opposite axis from the harness's fixed vertical stages over one goal.

```
Three separate things are broken: a p99 regression on GET /orders, the cart badge not
updating after remove, and agent-tool-abort.test.ts failing on timing. Different causes,
different files — dispatch them in parallel to matching specialists.
```

The gate: `0. INDEPENDENCE` (no shared files, no causal link) → `1. ALLOCATE` (job signal →
persona) → `2. DISPATCH` (isolated agents, in parallel) → `3. GATHER` (conflict check, full
re-run, verdict via `completion:verification-before-completion`). Persona matching is dynamic —
match on the job's dominant signal, not a fixed registry.

### `subagent-driven-development`

Executes an implementation plan in the current session: one fresh subagent per task, then a spec
compliance reviewer and a code quality reviewer dispatched in the same turn, with the task marked
done only when both pass in the same round. Use it when you have a plan, the tasks are mostly
independent, and you want to stay in this session; use `planning:executing-plans` when you need a
separately gated session, and manual execution when the tasks are tightly coupled or there is no
plan yet.

```
Here's the plan in docs/plans/workspace-invites.md. Run it task by task with a fresh
subagent each time and two-stage review, and don't move on until both reviewers pass.
```

Bundled prompt templates: `implementer-prompt.md`, `spec-reviewer-prompt.md`,
`code-quality-reviewer-prompt.md`. Implementers report one of four statuses, each handled
differently:

| Status | Handling |
|---|---|
| `DONE` | Proceed to review |
| `DONE_WITH_CONCERNS` | Read concerns; fix if they touch correctness or scope, else note and review |
| `NEEDS_CONTEXT` | Supply the missing information, re-dispatch the same prompt |
| `BLOCKED` | Change something — more context, stronger model, smaller task, or surface the plan gap. Never retry unchanged |

Re-review routing: spec issues → both reviewers re-run; spec already passed with quality issues
left → only the quality reviewer re-runs. Never start on `main`/`master` without consent, never
dispatch two implementers in parallel, never let a self-review stand in for a review.

**Harness-aware dual mode.** `subagent-driven-development` is written to run two ways: standalone
as above, and as an executor the harness's SetGoal stage can optionally map onto a subgoal
(`harness:harness` → "Optional skill integrations"). Nothing is pre-wired — the harness runs
without it, and it runs without the harness.

## Related plugins

- `planning:executing-plans` — gates a plan and routes it to one of these two executors.
- `completion:verification-before-completion` — settles every "done" claim with isolated evidence.
- `harness:harness` — fixed vertical stages over one goal; these skills are the horizontal axis.

---
