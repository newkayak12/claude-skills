---
name: agent-task-decomposer
description: >-
  Use when a task is too large or ambiguous to hand to a single agent without first defining
  clear subtask boundaries.
  Triggers on: "큰 작업 분해해줘", "에이전트 분리해줘", "subtask로 나눠줘", "task decomposition",
  "이 작업 어떻게 나눠야 해?", "agent에게 어떻게 전달해?", "병렬 작업 계획 잡아줘".
  Best for: multi-agent orchestration planning, producing subtask definitions with prompts.
  Not for: executing already-defined tasks (use dispatching-parallel-agents for that).
scenarios:
  - "이 큰 기능 여러 에이전트로 나눠서 처리해줘"
  - "작업이 너무 크고 모호해서 subtask로 분해해줘"
  - "Help me decompose this feature into agent-ready tasks"
  - "에이전트한테 어떤 프롬프트로 전달할지 정리해줘"
  - "의존성 있는 작업들 어떻게 나눠야 해?"
  - "How should I split this into parallel and sequential agent work?"
compatibility:
  recommended:
    - sequential-thinking  # enforces Steps 1-5 in order, prevents skipping dependency mapping
  optional:
    - think-tool           # reasoning about context isolation and subtask boundary quality
  remote_mcp_note: >-
    sequential-thinking이 있으면 task 파악 → subtask 경계 → 의존성 매핑 → context 분리 → 프롬프트 작성
    순서를 올바르게 강제할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
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
