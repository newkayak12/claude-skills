---
name: executing-plans
description: >-
  Use when a written plan is about to be run: review it, set each step's pass bar, route to an executor. Triggers: "계획 실행해줘", "plan 실행", "execute this plan", "plan 리뷰하고 가자", "실행 전에 기준 잡아줘". Not for writing the plan; use write:plans.
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

The pre-flight gate between a written plan and its execution: a gate, not an executor — it never edits code.
It reviews the plan, stops on defects, stamps a pass bar on every step, then routes the work. Gating is the whole job.

**Core principle:** nothing executes until the plan is sound and each step carries an explicit pass bar. This is the harness *SetGoal + QualityGate* brought down to one session, done by hand before dispatch.

## The Iron Law

```
NO HAND-OFF WITHOUT A CLEAN PLAN AND A STATED PASS BAR PER STEP
```

An unresolved gap, or a step with no observable "done" condition, means the plan is not ready: resolve it or stop and ask. Never route a broken plan downstream.

## Process

### 0. LOAD

Read the plan in full. Do not skim into execution.

### 1. REVIEW

Read the plan as an adversary, not an implementer (use sequential-thinking if available). Three defects block hand-off:

| Defect | Symptom | Action |
|--------|---------|--------|
| Gap | Step N needs an artifact or decision no earlier step yields | STOP: the plan is incomplete |
| Ambiguity | You couldn't dispatch the step to a stranger without guessing | STOP: pin the intent first |
| Drift | The plan assumes a state (file, API, schema) that changed | STOP: the plan is stale |

Any defect: STOP, raise it, do not hand off. A detail you can fill with a conventional default (a helper's usual semantics, a test's obvious cases) is not ambiguity: accept it, list it as an accepted assumption, and go on. Ambiguity is what you would have to guess at. A file, artifact or decision that no step creates and the plan does not say exists is a gap, never an accepted assumption. If none, the plan is fit; note the assumptions you *accepted* so the executor inherits them.

### 2. GATE

Every step gets one observable check that proves it is done (its QualityGate level), the same discipline as `completion:verification-before-completion`, applied ahead of time:

- *"Add endpoint X"*: bar = a request to X returns the specified shape, exit 0.
- *"Fix the failing test"*: bar = that test now passes AND fails without the change.
- *"Refactor module Y"*: bar = full suite still green, no behavior diff.

If the plan gives no bar, stand one up yourself before routing. Only a step whose bar you still cannot state cannot be verified: treat it as a REVIEW ambiguity defect and stop. The bars travel with the plan to the executor.

### 3. HAND-OFF

Route, don't run. Sort steps by dependency into ordered layers, then route each layer:

```
2+ steps in the layer, no shared files, no causal order
    → agents:dispatching-parallel-agents   (one persona-matched agent per step)

every other step (sequential / dependent)
    → agents:subagent-driven-development   (one fresh subagent per step, in plan order)
```

- A layer starts only after the previous layer's steps meet their step-2 bars.
- Each step's done-verdict is settled against its step-2 bar by `completion:verification-before-completion`, not the executor's word.
- Default when unsure: sequential. A wrong parallel call costs more than running in order would have.

## Output Template

Gated plan (after a clean review):

```
Gated plan: <plan name or path>
| Step | Pass bar | Layer | Executor | Accepted assumptions |
|------|----------|-------|----------|----------------------|
| 1 <step> | <observable check> | 1 | agents:dispatching-parallel-agents | <none or list> |
Routing: <layer -> executor, in order>; done-verdict: completion:verification-before-completion
Accepted assumptions: <per step, or none>
```

STOP report (any defect, nothing routed):

```
STOP: nothing routed
| Defect kind (gap / ambiguity / drift / bar unstatable) | Step | What is needed |
|------------------------------------------------|------|----------------|
```

## When to STOP and ask

- The plan has a gap, ambiguity, or drift you can't resolve yourself.
- A step has no statable pass bar, even after you tried to stand one up.
- The plan's assumed state no longer matches reality.
- The partner updates the plan mid-review: return to REVIEW from the top.

**Ask rather than guess. Never hand a broken plan to an executor.**

## Red flags — stop

- Skimming the plan and starting to route before REVIEW is done.
- Handing off a step whose "done" you can't describe as a check.
- Assuming the plan's preconditions still hold without looking.
- Picking parallel execution to feel fast when the steps are actually dependent.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Loads and adversarially reviews the plan | Supply the plan |
| States a pass bar per step | Supply any missing pass bar |
| Stops on any defect | Confirm accepted assumptions when the plan is ambiguous |
| Routes fit plans to the matching executor | Approve the routing |

## Related Skills

- `write:plans`: produces the plan this skill gates (upstream).
- `agents:dispatching-parallel-agents`: executor for a layer's independent steps (downstream).
- `agents:subagent-driven-development`: executor for sequential/dependent steps, in plan order.
- `completion:verification-before-completion`: settles each step's done-verdict against the bar set here.
- `harness:harness`: the six-stage engine; this skill is the solo counterpart of its SetGoal + QualityGate stages.
