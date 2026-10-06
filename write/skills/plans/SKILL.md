---
name: plans
description: >-
  Use when writing starts from a plan: an implementation plan or ticket breakdown before code, a PRD, design doc or
  RFC, a design review or ADR, a tech blog, or SBI feedback. Triggers: "구현 계획 써줘", "티켓으로 쪼개줘", "PRD 작성", "ADR 써줘".
scenarios:
  - "이 기능 구현 계획 작성해줘"
  - "Create an implementation plan for this new service"
  - "이 기능에 대한 PRD 작성해야 해"
  - "Help me write a design doc for this new service"
  - "Kafka 도입 과정을 기술 블로그로 써줘"
  - "I need to give feedback but don't want it to sound mean"
compatibility:
  optional:
    - sequential-thinking  # tracking dependency chains across many tasks
    - think-tool           # judging whether a step is unambiguous; which document section has most unknowns
  remote_mcp_note: >-
    sequential-thinking이 있으면 작업 간 의존성 사슬이 복잡한 계획의 갭을 더 체계적으로
    찾을 수 있습니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Plans

## Step 0 — Purpose

Ask which format to write — unless the request or briefing already names one.
The implementation plan is the default: a hand-off from `think:brainstorming`,
`planning:executing-plans`, `agents:subagent-driven-development` or the harness gets it
without a question.

| Purpose | Signal | Path |
|---|---|---|
| implementation plan | code/migration/refactor work, breaking a plan or feature into tickets/issues, any plan hand-off | Overview → Process below |
| document | PRD, design doc, RFC, proposal, decision doc, spec — including a teams briefing that names one | `references/document.md` (Stage 3 uses `agents/reader-agent.md`) |
| design review | options still open, reviewers argue alternatives and trade-offs | `references/formats/design-review.md` (fixed 8 sections) |
| ADR | a decision already made, to be recorded | `references/formats/adr.md` (fixed template, `docs/adr/NNNN-*.md`) |
| blog | technical blog, 회고 글, tutorial | `references/document.md` + `references/examples/blog.md` |
| feedback | feedback to a colleague, praise, peer review | `references/examples/sbi.md` (short form, no section loop) |

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

**Announce at start:** "I'm using the plans skill to create the
implementation plan."

**Save plans to:** `docs/plans/YYYY-MM-DD-<feature-name>.md` (a stated user
preference overrides this default).

## Process

1. **Scope check.** One plan, one subsystem — split multi-subsystem specs first.
2. **Survey, then structure.** Read entry points, tests, and the nearest
   analogue before inventing file paths; lock which files are touched and
   what each owns.
3. **Right-size the tasks.** One task is one vertical slice: it leaves one
   behaviour working end to end at a thinner scope — never "all backend, then
   all frontend", because a layer-only task has nothing to demo or test until
   its sibling lands. A wide refactor goes expand → migrate → contract, one task
   each. Inside a task, 2-5 minute steps: test → fail → implement → pass → commit.
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

> Produced by write:plans. Owner for execution routing:
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
**Blocked by:** [Task k, … | none] — the order made explicit, not implied.
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
