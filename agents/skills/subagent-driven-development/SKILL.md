---
name: subagent-driven-development
description: >-
  Use when running a plan's tasks sequentially in plan order, a fresh subagent
  per task. Triggers on: "계획 실행해줘", "서브에이전트로 구현해줘", "subagent-driven",
  "plan 실행", "태스크별로 에이전트 배포해줘", "두 단계 리뷰로 구현", "현재 세션에서 계획 실행".
scenarios:
  - "이 구현 계획 서브에이전트로 실행해줘"
  - "각 태스크마다 새 에이전트로 구현하고 리뷰해줘"
  - "Execute this plan with fresh subagents per task"
  - "두 단계 리뷰(spec + 품질)로 구현해줘"
  - "계획 있는데 현재 세션에서 에이전트로 실행해줘"
  - "Implement each task with subagent + review cycle"
compatibility:
  recommended:
    - sequential-thinking  # orchestration planning, per-task model selection reasoning
  optional:
    - think-tool           # per-task complexity assessment and BLOCKED status diagnosis
  remote_mcp_note: >-
    think-tool이 있으면 각 태스크 실행 전 복잡도와 숨겨진 의존성을 평가할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Subagent-Driven Development

Execute plan by dispatching a fresh subagent per task, one task at a time in plan order, with spec and code-quality reviewers dispatched together after each; both must pass.

**Core principle:** Fresh subagent per task + spec and quality reviewers dispatched in parallel, both must pass = high quality, fast iteration

## When to Use

Use this skill when all three conditions are met:
- You have an implementation plan with defined tasks
- The tasks are sequential or dependent and run one at a time in plan order
- You want to stay in the current session

`planning:executing-plans` gates the plan and routes its sequential/dependent steps here. Use manual execution when you don't yet have a plan.

## The Process

```dot
digraph process {
    rankdir=TB;

    subgraph cluster_per_task {
        label="Per Task";
        "Dispatch implementer subagent (./implementer-prompt.md)" [shape=box];
        "Implementer subagent asks questions?" [shape=diamond];
        "Answer questions, provide context" [shape=box];
        "Implementer subagent implements, tests, commits, self-reviews" [shape=box];
        "Dispatch spec + quality reviewers IN PARALLEL (./spec-reviewer-prompt.md + ./code-quality-reviewer-prompt.md)" [shape=box];
        "Both reviewers pass? (wait for both)" [shape=diamond];
        "Implementer subagent fixes combined findings" [shape=box];
        "Mark task complete in task list" [shape=box];
    }

    "Read plan, extract all tasks with full text, note context, create task list" [shape=box];
    "More tasks remain?" [shape=diamond];
    "Dispatch final code reviewer subagent for entire implementation" [shape=box];
    "Finalize branch: full tests + commit + PR/merge" [shape=box style=filled fillcolor=lightgreen];

    "Read plan, extract all tasks with full text, note context, create task list" -> "Dispatch implementer subagent (./implementer-prompt.md)";
    "Dispatch implementer subagent (./implementer-prompt.md)" -> "Implementer subagent asks questions?";
    "Implementer subagent asks questions?" -> "Answer questions, provide context" [label="yes"];
    "Answer questions, provide context" -> "Dispatch implementer subagent (./implementer-prompt.md)";
    "Implementer subagent asks questions?" -> "Implementer subagent implements, tests, commits, self-reviews" [label="no"];
    "Implementer subagent implements, tests, commits, self-reviews" -> "Dispatch spec + quality reviewers IN PARALLEL (./spec-reviewer-prompt.md + ./code-quality-reviewer-prompt.md)";
    "Dispatch spec + quality reviewers IN PARALLEL (./spec-reviewer-prompt.md + ./code-quality-reviewer-prompt.md)" -> "Both reviewers pass? (wait for both)";
    "Both reviewers pass? (wait for both)" -> "Implementer subagent fixes combined findings" [label="no"];
    "Implementer subagent fixes combined findings" -> "Dispatch spec + quality reviewers IN PARALLEL (./spec-reviewer-prompt.md + ./code-quality-reviewer-prompt.md)" [label="re-review"];
    "Both reviewers pass? (wait for both)" -> "Mark task complete in task list" [label="yes"];
    "Mark task complete in task list" -> "More tasks remain?";
    "More tasks remain?" -> "Dispatch implementer subagent (./implementer-prompt.md)" [label="yes"];
    "More tasks remain?" -> "Dispatch final code reviewer subagent for entire implementation" [label="no"];
    "Dispatch final code reviewer subagent for entire implementation" -> "Finalize branch: full tests + commit + PR/merge";
}
```

**Parallel review note:** After each implementation task, dispatch the spec-reviewer and code-quality-reviewer in the **same turn** — both are read-only and have no dependency on each other's output. Wait for both to complete, then act on their combined findings.

**Re-review routing after fixes:** After any fix (spec gaps or quality issues), the implementer fixes, then re-dispatch **both** reviewers in the same turn. Fixes for one can affect the other, so no reviewer is skipped.

Only mark the task complete when both spec and quality reviewers have passed in the same review round.

## Model Selection

If think-tool is available, invoke it before dispatching the implementer for each task: reason about task complexity, hidden dependencies between files, and which model tier is appropriate. This turns the narrative guidance below into an auditable per-task decision.

Use the least powerful model that can handle each role to conserve cost and increase speed.

**Mechanical implementation tasks** (isolated functions, clear specs, 1-2 files): use a fast, cheap model. Most implementation tasks are mechanical when the plan is well-specified.

**Integration and judgment tasks** (multi-file coordination, pattern matching, debugging): use a standard model.

**Architecture, design, and review tasks**: use the most capable available model.

**Task complexity signals:**
- Touches 1-2 files with a complete spec → cheap model
- Touches multiple files with integration concerns → standard model
- Requires design judgment or broad codebase understanding → most capable model

## Handling Implementer Status

Implementer subagents report one of four statuses. Handle each appropriately:

**DONE:** Dispatch spec + code-quality reviewers in parallel.

**DONE_WITH_CONCERNS:** Read the concerns first — if they touch correctness or scope, address before review; if they're observations only (e.g., "file is getting large"), note and proceed to review. If think-tool is available and the concerns are ambiguous, invoke it to reason: does this touch correctness or scope, and what is the right action?

**NEEDS_CONTEXT:** Provide the missing information and re-dispatch with the same prompt + new context.

**BLOCKED:** Something must change before retrying. If think-tool is available, invoke it before deciding how to proceed — reason over: what specifically blocked the subagent, whether the plan has a gap, whether model escalation vs. task decomposition is the right remedy, and what context to add on re-dispatch. Then: provide more context and re-dispatch, escalate to a more capable model, break the task into smaller pieces, or surface to the human if the plan itself is wrong. Never retry the same model with the same inputs.

**Never** ignore an escalation or force the same model to retry without changes. If the implementer said it's stuck, something needs to change.

## Prompt Templates

- `./implementer-prompt.md` - Dispatch implementer subagent
- `./spec-reviewer-prompt.md` - Dispatch spec compliance reviewer subagent
- `./code-quality-reviewer-prompt.md` - Dispatch code quality reviewer subagent

## Example Workflow

See `references/example-workflow.md` for a full concrete trace. For context on why this approach works better than alternatives, see `references/rationale.md`.

## Red Flags

**Never:**
- Start implementation on main/master branch without explicit user consent
- Skip reviews (spec compliance OR code quality)
- Proceed with unfixed issues
- Dispatch multiple implementation subagents in parallel (conflicts)
- Reorder tasks, or start a task before the task it depends on has passed review
- Make subagent read plan file (provide full text instead)
- Skip scene-setting context (subagent needs to understand where task fits)
- Ignore subagent questions (answer before letting them proceed)
- Accept "close enough" on spec compliance (spec reviewer found issues = not done)
- Skip review loops (reviewer found issues = implementer fixes = review again)
- Let implementer self-review replace actual review (both are needed)
- **Act on only one review result while the other is still running** — wait for both, then decide
- Move to next task while either review has open issues

**If subagent asks questions:**
- Answer clearly and completely
- Provide additional context if needed
- Don't rush them into implementation

**If reviewer finds issues:**
- Implementer (same subagent) fixes them
- Reviewer reviews again
- Repeat until approved
- Don't skip the re-review

**If subagent fails task:**
- Dispatch fix subagent with specific instructions
- Don't try to fix manually (context pollution)

## Integration

**Before dispatching (do these yourself):**
- **Isolated workspace** — start on a dedicated branch or worktree, never `main`/`master`, so task commits don't land on a shared branch. Set this up manually; there is no separate skill for it here.
- **`write:plans`** — produces the plan this skill executes.

**During execution:**
- **`develop:test-driven-development`** — each dispatched subagent drives its task test-first.
- **Code review** — reviewer subagents use the bundled `./spec-reviewer-prompt.md` and `./code-quality-reviewer-prompt.md` templates; no external review skill is required.

**Finishing:** after the final reviewer passes, close the branch yourself — run the full test suite, commit, then open a PR or merge per the repo's flow — and settle the done-verdict with **`completion:verification-before-completion`**.

**Upstream:** **`planning:executing-plans`** — gates the plan and routes its sequential/dependent steps to this skill.

**Harness mode:** `harness:harness` may map this skill as an Implement-subgoal executor. Nothing changes in the loop above; the plan arrives as a SetGoal goal-spec and the final reviewer verdict feeds the harness QualityGate instead of your own done-check. Opt-in per run, never pre-wired.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Dispatches a fresh subagent per task | Supply the implementation plan |
| Runs spec and code-quality review in parallel after each task | Set up the isolated branch or worktree |
| Handles implementer status such as BLOCKED | Decide on blocked tasks Claude can't resolve |
| Settles the done-verdict via `completion:verification-before-completion` | Close the branch: PR or merge per the repo's flow |
