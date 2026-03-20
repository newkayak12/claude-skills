---
name: agent-task-decomposer
description: |
  Decomposes a complex task into agent-ready subtasks and writes an optimized prompt for each one.
  Use this skill the moment a task feels too large, ambiguous, or entangled to hand to a single agent.
  Trigger on: "태스크 분해", "task decomposition", "에이전트 프롬프트", "prompt 개선",
  "이 작업 어떻게 나눠", "프롬프트 최적화", "복잡한 작업 분리".
  Do not just think about decomposition — produce the full breakdown with prompts immediately.
---

# Agent Task Decomposer

## Why This Matters

A bad decomposition wastes more time than no decomposition. Agents given vague scope explore endlessly, duplicate work, or step on each other's outputs. A good decomposition defines crisp boundaries so each agent can succeed independently without needing to ask clarifying questions mid-run.

Prompt quality is equally important. An agent that receives an underspecified prompt will make assumptions — and those assumptions are invisible until the output lands wrong. Writing precise, constraint-bearing prompts upfront eliminates the most common failure mode in agentic workflows.

---

**MCP instruction:** If `sequential-thinking` is available, use it to work through Steps 1-5 in order. The most common failure is jumping from task identification (Step 1) to prompt writing (Step 5) without completing dependency mapping (Step 3) — this produces prompts that assume context the subtask agent won't have.

## Step 1 — Understand the Full Task

Before decomposing anything, map the complete task:

- What is the final deliverable? (artifact, action, decision, or analysis)
- What information is already available vs. must be discovered?
- What are the hard constraints? (scope limits, forbidden actions, output format requirements)
- Who or what consumes the output?

If these are unclear, ask one focused question before proceeding. Do not decompose an ambiguous task — decompose a clear one.

---

## Step 2 — Identify Natural Subtask Boundaries

Subtasks should split along one or more of these seams:

| Seam type | Example |
|-----------|---------|
| **Domain** | Auth logic vs. payment logic vs. notification logic |
| **Artifact** | Research output vs. implementation vs. test suite |
| **Phase** | Data collection → analysis → recommendation |
| **Component** | Frontend module A vs. backend service B |

Good subtask boundaries have:
- A single, stateable goal
- Clear inputs it receives at start
- Clear outputs it produces at end
- No dependency on another subtask's in-progress work

Bad subtask boundaries have:
- Shared mutable state
- Implicit assumptions about ordering
- Overlapping file sets between agents

---

## Step 3 — Dependency Mapping

Draw the dependency graph (even mentally) before assigning subtasks to agents.

```
Independent subtasks  → can run in parallel (use dispatching-parallel-agents)
Sequential subtasks   → one agent hands off to the next
Mixed graph           → parallelize the independent layers, sequence the rest
```

Mark explicitly:
- Which subtasks can start immediately with available context
- Which subtasks are blocked until another subtask completes
- What the handoff artifact looks like between dependent stages

---

## Step 4 — Context Isolation Per Subtask

Each subtask must carry everything the agent needs to execute it — the agent will not have access to the conversation history or other agents' reasoning.

Include in each subtask's context:
- Relevant background (the minimal slice the agent needs, not the entire problem)
- Explicit file paths, API names, or data schemas it will touch
- What it must NOT do (scope guard)
- Any constraints that would otherwise be assumed away

Resist the urge to share everything. Agents with too much irrelevant context lose focus. Give only what this specific task requires.

---

## Step 5 — Write an Optimized Prompt for Each Subtask

**Parallelization note:** Step 5 is fully parallelizable after Step 4 is complete — each subtask's context is now isolated and independent. If running as an agent, dispatch all subtask prompt generation simultaneously.

Every optimized prompt must have five elements:

### 1. Concrete Goal
One sentence. What does "done" look like?
- Weak: "Improve the login flow"
- Strong: "Rewrite the `authenticateUser` function in `src/auth/session.ts` to return a typed `AuthResult` instead of throwing exceptions"

### 2. Explicit Inputs
List what the agent starts with: file paths, data, prior output, environment facts.

### 3. Hard Constraints
What the agent must not do:
- "Do not modify any file outside `src/auth/`"
- "Do not add new dependencies"
- "Preserve the existing API surface — only change internals"

### 4. Output Format
Exactly what the agent returns:
- "Return: a summary of root cause + list of files changed"
- "Return: the completed function with inline comments explaining each decision"
- "Return: a markdown table with columns: endpoint, current behavior, proposed change"

### 5. Verification Step
How the agent confirms success before returning:
- "Run `npm test src/auth` and confirm all tests pass"
- "Confirm the output JSON matches the schema in `docs/schema.json`"
- "Check that no import in `src/auth/` references `src/payment/`"

---

## Output Structure

Produce this format for every decomposition:

```
## Task Overview
[One paragraph: what the full task is, what the final deliverable is]

## Dependency Graph
[Diagram or bullet list showing which subtasks depend on which]

## Subtask N: [Name]
**Runs:** [immediately / after Subtask X completes]
**Input:** [what it receives]
**Output:** [what it produces]

### Optimized Prompt
[Full prompt text — ready to paste into an agent, no editing required]
```

---

## Granularity Calibration

| Task size | Target subtask count |
|-----------|----------------------|
| 30-min task | 1–2 subtasks |
| Half-day task | 3–5 subtasks |
| Multi-day task | 5–10 subtasks, each half-day or less |

If a subtask still feels too large, apply the same decomposition process recursively.
If a subtask feels trivially small, merge it with an adjacent one — but only if they share the same agent and the same file scope.

---

## Common Mistakes to Avoid

**Decomposing before clarifying the goal.** A precise decomposition of a fuzzy task produces precise confusion.

**Overlapping file ownership.** Two subtasks writing to the same file in parallel produce merge conflicts or silently overwrite each other's work. Assign one owner per file.

**Missing the output contract.** Agents that do not know their expected output format produce output in whatever format felt natural. Define it explicitly.

**Prompts without constraints.** Unconstrained agents refactor, rename, reorganize, and expand scope. Constraints are not optional polish — they are the fence that keeps the agent on task.

**Too many subtasks with fine-grained dependencies.** A sequential chain of 10 small subtasks gains nothing from decomposition and loses parallelism. Merge sequential steps that belong to the same agent.
