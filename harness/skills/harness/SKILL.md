---
name: harness
description: >-
  Use when a substantial request needs verified, non-repetitive output.
  Triggers on: "이거 제대로 해줘", "검증까지 해서", "하네스 돌려줘", "run the harness",
  "do this properly with verification", "6단계로 처리해줘", "메타스크립트로".
  Not for trivial edits or Q&A.
scenarios:
  - "이거 대충 말고 제대로, 검증까지 해서 처리해줘"
  - "하네스 돌려서 단계별로 검증하고 결과만 보고해줘"
  - "하네스 메타스크립트로 이 요청에 맞는 파이프라인 만들어서 돌려줘"
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
   - **If the Workflow tool is unavailable** (plain Agent SDK, some harnesses, CI): do NOT
     skip the engine — follow [`engine/fallback.md`](../../engine/fallback.md) instead. It
     runs the identical six stages via the Agent tool as a **strictly-ordered subgoal
     checklist**, emitting the `[HARNESS-FALLBACK-ORCHESTRATOR]` sentinel first so gated
     edits are forced through Implement subagents. When Workflow IS available, ignore
     fallback.md entirely — the pipeline.js path above is unchanged.
2. **M (meta):** when the fixed six stages can't express the control flow the request
   needs — tournament/judge-panel, staged escalation, loop-until-dry discovery,
   per-finding refuters — or the user explicitly asks ("메타스크립트로", "커스텀
   파이프라인으로"), **generate the pipeline instead of using the fixed one**:
   1. Copy `templates/meta-skeleton.js` into the scratchpad and rewrite ONLY the
      `[META]` Work block (and `meta`) to the control flow the request needs.
   2. Keep the skeleton's five contract points verbatim: judge ≠ actor; model pins
      (plan/judge=opus, execute/test/report=sonnet); every loop bounded; deterministic
      Test agent (Bash/Read evidence, never the actor's narrative); goal-level
      `match_pct >= 90` gate before Report.
   3. Run it: `Workflow({ scriptPath: "<scratchpad>/meta-<slug>.js", args: { request, context?, max_retries? } })`.
   Default to B when in doubt — M earns its cost only when the control flow itself is
   the problem.
3. **A (manual):** the user hands you a ready-made bespoke script → run it as-is.
4. **Relay the returned `report` to the user.** Surface `failed[]` and a failing
   `goal_gate` honestly. Eval and retry already happened inside the engine.

## What Claude does
- Phrases `args.request` faithfully (add known constraints via `args.context`).
- Invokes the engine; relays `report`, `all_passed`, `failed[]`, `goal_gate`.

## What you do
- State the request and its bar. Receive the final report.
- (Optional) watch progress via `/workflows` — six phase groups are visible.

## Related
- `harness/goal-spec.md` — spec schema (authored by the SetGoal stage) + authoring rules
- `harness/engine/pipeline.js` — the fixed six-stage engine (Workflow path)
- `harness/engine/fallback.md` — Workflow-less fallback: same six stages via the Agent tool, strictly-ordered checklist, actor-boundary enforced
- `harness/templates/meta-skeleton.js` — Mode M starting point (contract + `[META]` block)
- `harness/templates/` — bespoke-pipeline reference
- `harness/hooks/` — opt-in PreToolUse gate: projects list gated paths in `.claude/harness-gate.json`; editing them without engaging the harness is denied (fail-open on any ambiguity).
