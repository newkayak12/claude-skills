---
name: harness
description: >-
  Use when a substantial request risks a repetitive or below-threshold answer on one
  pass. Triggers on: "이거 제대로 해줘", "검증까지 해서", "하네스 돌려줘", "run the
  harness", "do this properly with verification", "6단계로 처리해줘". Runs the fixed
  six-stage engine — Plan(opus) → SetGoal(opus) → Implement(sonnet) → Test(sonnet) →
  QualityGate(opus, loop) → Report(sonnet) — with repo-skill-equipped executors and
  independent deterministic verification. Not for trivial edits or Q&A.
scenarios:
  - "이거 대충 말고 제대로, 검증까지 해서 처리해줘"
  - "하네스 돌려서 단계별로 검증하고 결과만 보고해줘"
  - "Do this properly — plan it, verify each part independently, then report"
  - "Run the harness on this request"
compatibility:
  optional:
    - think-tool          # request 정제 시
related:
  - plan
  - review
---

# harness — six-stage engine: Plan → SetGoal → Implement → Test → QualityGate → Report

The harness raises the **floor**, not the ceiling: every substantial request goes through
six model-pinned stages so repetition and weak answers get filtered out regardless of the
main-session model. Planning and judging are pinned to Opus; execution, testing, and
reporting to Sonnet.

## Process

1. **Pass the raw request to the engine** (B, default):
   `Workflow({ scriptPath: "harness/engine/pipeline.js", args: { request: "<the request>", context: "<optional constraints>", max_retries: 2 } })`
   The engine itself plans, authors + critiques the goal-spec, executes subgoals with
   repo-skill-equipped executors, verifies each deterministically, gates each and the
   assembled whole, and writes the report.
2. **A (special):** bespoke control flow (tournament, staged escalation) → author a
   one-off Workflow from `templates/` instead.
3. **Relay the returned `report` to the user.** Surface `failed[]` and a failing
   `goal_gate` honestly. Eval and retry already happened inside the engine.

## What Claude does
- Phrases `args.request` faithfully (add known constraints via `args.context`).
- Invokes the engine; relays `report`, `all_passed`, `failed[]`, `goal_gate`.

## What you do
- State the request and its bar. Receive the final report.
- (Optional) watch progress via `/workflows` — six phase groups are visible.

## Related
- `harness/goal-spec.md` — spec schema (authored by the SetGoal stage) + authoring rules
- `harness/engine/pipeline.js` — the fixed six-stage engine
- `harness/templates/` — A-style bespoke pipelines + reference
- `harness/hooks/` — opt-in PreToolUse gate: projects list gated paths in `.claude/harness-gate.json`; editing them without engaging the harness is denied (fail-open on any ambiguity).
