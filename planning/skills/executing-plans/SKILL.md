---
name: executing-plans
description: >-
  Use when a written implementation plan is about to be run — critically review
  it, set each step's pass bar, then route to the right executor. Triggers: "계획
  실행해줘", "plan 실행", "이 계획 검토하고 진행", "execute this plan", "plan 리뷰하고 가자", "실행 전에
  기준 잡아줘".
scenarios:
  - "이 구현 계획 그대로 진행해도 될지 보고 실행 붙여줘"
  - "Plan 파일 있는데 실행 전에 검토하고 기준 잡아줘"
  - "Execute this implementation plan step by step"
  - "계획대로 가기 전에 갭 없는지 확인하고 각 단계 통과 기준 정해줘"
  - "Review this plan and kick off the work"
  - "이 plan 실행 준비 됐는지 확인하고 넘겨줘"
compatibility:
  recommended:
    - sequential-thinking  # plan coherence + dependency-gap review before hand-off
  optional:
    - think-tool           # pin each step's pass bar (verify-level) before routing
  remote_mcp_note: >-
    sequential-thinking이 있으면 plan의 일관성·의존성 갭을 실행자에게 넘기기 전에 체계적으로
    검토할 수 있습니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Executing Plans

## Overview

A plan is a set of intentions written against an assumed state. Handing it
straight to an executor skips the two things that decide whether it succeeds:
**is the plan still sound**, and **what does "done" mean for each step**. This
skill is the pre-flight gate between a plan and its execution — it does not run
the steps itself. It reviews the plan critically, fixes or stops on defects,
stamps a pass bar on every step, then routes the work to the executor that fits.

**Core principle:** nothing gets executed until the plan is proven sound and each
step carries an explicit pass bar. This is the harness *SetGoal + QualityGate*
brought down to a single session — where the six-stage engine derives acceptance
criteria and gates on them automatically, here you do it by hand before dispatch.

## The Iron Law

```
NO HAND-OFF WITHOUT A CLEAN PLAN AND A STATED PASS BAR PER STEP
```

If the plan has an unresolved gap, or a step has no observable "done" condition,
it is not ready to execute — resolve it or stop and ask. Never route a broken
plan downstream.

## The Gate

```
0. LOAD     Read the plan in full. Do not skim into execution.
1. REVIEW   Critically review before anything runs:
            → gaps (a step depends on something no prior step produces)
            → ambiguity (a step you couldn't hand to someone else as-is)
            → drift (a precondition the plan assumes no longer holds)
            Any of these → STOP, raise it, don't hand off. (sequential-thinking)
2. GATE     For each step, state its QualityGate level = the pass bar:
            the observable check that proves that step is done. No bar → stand
            one up before routing. (verify-level; see verification-before-completion)
3. HAND-OFF Route execution — this skill does not execute:
            → steps are independent → agents:dispatching-parallel-agents
            → steps are sequential/dependent → agents:subagent-driven-development
            Each step's done-verdict is settled against its step-2 bar by
            completion:verification-before-completion, not the executor's word.
```

## 1. REVIEW — what makes a plan unfit to execute

Read the plan as an adversary, not an implementer. Three defects block hand-off:

| Defect | Symptom | Action |
|--------|---------|--------|
| Gap | Step N needs an artifact/decision no earlier step yields | STOP — the plan is incomplete |
| Ambiguity | You couldn't dispatch the step to a stranger without guessing | STOP — pin the intent first |
| Drift | The plan assumes a state (file, API, schema) that changed | STOP — the plan is stale |

If none are present, the plan is fit. Note any assumptions you *accepted* so the
executor inherits them.

## 2. GATE — a pass bar per step

Every step gets one observable check that proves it's done — the same discipline
as `completion:verification-before-completion`, applied ahead of time:

- *"Add endpoint X"* → bar = a request to X returns the specified shape, exit 0.
- *"Fix the failing test"* → bar = that test now passes AND fails without the change.
- *"Refactor module Y"* → bar = full suite still green, no behavior diff.

A step whose bar you cannot state is a step you cannot verify — treat that as a
REVIEW defect (ambiguity) and stop. The bars travel with the plan to the executor.

## 3. HAND-OFF — route, don't run

This skill's output is a **gated plan** (reviewed, bars attached) plus a routing
decision. It never edits code itself.

```
independent steps (no shared files, no causal order)
    → agents:dispatching-parallel-agents   (fan out, one persona-matched agent per step)

sequential / dependent steps
    → agents:subagent-driven-development    (one fresh subagent per step, in order)
```

Default when unsure: sequential. A wrong parallel call costs more than running in
order would have. Whichever executor runs it, each step is closed out against its
step-2 bar via `completion:verification-before-completion`.

## When to STOP and ask

- The plan has a gap, ambiguity, or drift you can't resolve yourself.
- A step has no statable pass bar.
- The plan's assumed state no longer matches reality.
- The partner updates the plan mid-review → return to REVIEW from the top.

**Ask rather than guess. Never hand a broken plan to an executor.**

## Red flags — stop

- Skimming the plan and starting to route before REVIEW is done.
- Handing off a step whose "done" you can't describe as a check.
- Assuming the plan's preconditions still hold without looking.
- Picking parallel execution to feel fast when the steps are actually dependent.

## What Claude does / What you do

- **Claude:** loads and adversarially reviews the plan, states a pass bar per step,
  stops on any defect, and routes fit plans to the matching executor.
- **You:** supply the plan and any missing pass bar; confirm accepted assumptions
  when the plan is ambiguous rather than blocking.

## Related

- `write:writing-plans` — produces the plan this skill gates (upstream).
- `agents:dispatching-parallel-agents` — executor for independent steps (downstream).
- `agents:subagent-driven-development` — executor for sequential/dependent steps.
- `completion:verification-before-completion` — settles each step's done-verdict
  against the bar set here.
- `harness:harness` — the six-stage engine; this skill is the solo counterpart of
  its SetGoal + QualityGate stages.

## Bottom line

Review the plan until it's sound, stamp a pass bar on every step, then route it to
the executor that fits — and never before. Gating is the whole job; execution
belongs to someone else.
