---
name: writing-plans
description: >-
  Use when a task is large enough that diving in without a plan leads to
  rework. Triggers: "구현 계획 써줘", "implementation plan", "코딩 전에 계획 잡아줘",
  "migration plan", "plan before coding", "스텝별로 정리해줘", "리팩토링 계획".
scenarios:
  - "이 기능 구현 계획 작성해줘"
  - "DB 마이그레이션 단계별로 계획 잡아줘"
  - "Create an implementation plan for this new service"
  - "리팩토링 어떻게 단계별로 나눠야 해?"
  - "I need a step-by-step plan before I start coding this"
  - "의존성 있는 작업들 어떻게 순서 잡아?"
compatibility:
  optional:
    - sequential-thinking  # tracking dependency chains across many tasks
    - think-tool           # judging whether a step is genuinely unambiguous
  remote_mcp_note: >-
    sequential-thinking이 있으면 작업 간 의존성 사슬이 복잡한 계획의 갭을 더 체계적으로
    찾을 수 있습니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Writing Plans

## Overview

This skill only produces plans — it never runs them. The gap check and
ambiguity check `planning:executing-plans` would otherwise run at hand-off
get done here instead, at production time: every step gets an observable
check stamped on it before the plan counts as finished, in the same
pass-bar vocabulary that skill's QualityGate judges against. Staleness/
drift stays out of scope on purpose — a fact about *when* execution
happens, not how the plan was written — so `planning:executing-plans` owns
that check at hand-off. A clean gap/ambiguity pass here claims nothing
about drift.

**Announce at start:** "I'm using the writing-plans skill to create the
implementation plan."

**Save plans to:** `docs/plans/YYYY-MM-DD-<feature-name>.md` (a stated user
preference overrides this default).

## Process

1. **Scope check.** One plan, one subsystem — split multi-subsystem specs first.
2. **Survey, then structure.** Read entry points, tests, and the nearest
   analogue before inventing file paths; lock which files are touched and
   what each owns.
3. **Right-size the tasks.** One testable deliverable per task, 2-5 minute
   steps: test → fail → implement → pass → commit.
4. **Gap check, in-line.** Confirm each thing a task consumes was produced
   by an earlier task — the defect `planning:executing-plans` screens for;
   catch it before it ships.
5. **Ambiguity check, in-line.** Read each step as a stranger would; if
   they'd guess, resolve it now.
6. **Stamp a pass bar per step.** The one observable check proving the step
   is done ("that test now passes", "the endpoint returns 429"). No
   statable bar means the step isn't finished — go back.
7. **Self-review.** Scan for placeholders ("TBD", "similar to Task N") and
   keep names/signatures consistent across tasks.

## Output Template

```markdown
# [Feature Name] Implementation Plan

> Produced by write:writing-plans. Owner for execution routing:
> planning:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** [one sentence] **Architecture:** [2-3 sentences]
**Tech Stack:** [key libraries]
---
```

**Per task:**

```markdown
### Task N: [Component]
**Files:** create/modify/test — exact paths.
**Interfaces:** consumes [earlier tasks' signatures] / produces [names
  later tasks rely on].
**Pass bar:** [the observable check from Process step 6]

- [ ] 1: failing test (full code) → 2: confirm it fails → 3: minimal
  implementation (full code) → 4: confirm it passes → 5: commit
```

No placeholders where real content belongs: no "TBD", no "similar to Task
N" without the actual code, no reference to a type or function no earlier
task defines.

## Dual-Mode

| Mode | Produces | Consumed by |
|---|---|---|
| Solo | Plan doc above, pass bar per step | `completion:verification-before-completion` |
| Harness-engaged | SetGoal goal-spec — subgoals with `acceptance[]`/`test[]` | The harness QualityGate, subgoal then goal-level |

**Compact SetGoal example** (≤3 subgoals, ≤6 acceptance criteria total):

```jsonc
{
  "goal": "Add rate limiting to the public API",
  "acceptance": ["All public endpoints reject over-limit requests with 429"],
  "subgoals": [{
    "id": "s1",
    "title": "Token-bucket limiter middleware",
    "skills": ["develop:spring-boot-engineer"],
    "acceptance": [
      "Requests over the configured rate return 429",
      "Requests under the rate pass through unchanged"
    ],
    "test": ["./gradlew test --tests RateLimiterTest"],
    "deps": []
  }],
  "max_retries": 2
}
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Surveys the codebase, locks file structure, right-sizes tasks | Confirm the subsystem boundary at scope check |
| Runs gap/ambiguity checks in-line, stamps a pass bar per step | Flag any task that still reads ambiguous |
| Builds the SetGoal goal-spec directly in harness mode | Route the finished plan onward |

## Related

- `planning:executing-plans` — owns execution routing and the
  staleness/drift check this skill leaves out on purpose (downstream).
- `agents:subagent-driven-development` — likely executor once
  executing-plans routes a sequential/dependent plan.
- `completion:verification-before-completion` — settles each step's
  done-verdict against the pass bar stamped here, in solo mode.
- `harness:harness` — the six-stage engine this skill's harness-mode
  output feeds directly as a goal-spec.
