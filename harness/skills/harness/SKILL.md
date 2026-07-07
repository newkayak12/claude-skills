---
name: harness
description: >-
  Use when a substantial request risks a repetitive or below-threshold answer on one
  pass. Triggers on: "이거 제대로 해줘", "검증까지 해서", "goal 나눠서 처리해줘", "하네스
  돌려줘", "run the harness", "do this properly with verification", "break this into
  subgoals". Authors a goal-spec, runs the fixed decompose→act→independent-check→loop
  engine (separate judge, no self-eval), reports. Not for trivial edits or Q&A.
scenarios:
  - "이거 대충 말고 제대로, 검증까지 해서 처리해줘"
  - "goal 나눠서 서브에이전트로 돌리고 결과만 보고해줘"
  - "Do this properly — decompose it and independently verify each part"
  - "Run the harness on this: break it into subgoals and check each one"
compatibility:
  optional:
    - think-tool          # goal-spec 저작 시 acceptance 기준 정제
    - sequential-thinking # 요청 분해 → subgoal 도출을 단계별로
related:
  - goals
  - plan
  - review
---

# harness — goal-spec → fixed engine → report

The harness exists to **raise the floor**, not the ceiling: force reasoning through
decompose → act → **independent** check → loop so repetition and weak answers get filtered
out. Quality ceiling still follows the model — that's fine, not the harness's job.

Two layers:
- **Baked flow** (`engine/pipeline.js`) — model-independent. Always: separate judge, bounded retry.
- **Authoring** (you, at planning time) — turn the request into a `goal-spec`.

## Process

1. **Hear the request → author the goal-spec.** Decompose the goal into independent subgoals;
   write acceptance criteria *derived from the goal* for each (the judge only knows these).
   Schema + rules: `harness/goal-spec.md`. This authoring is the lever — spend the thinking here.
2. **Pick B or A.**
   - **B (default):** run the fixed engine with your spec as data:
     `Workflow({ scriptPath: "harness/engine/pipeline.js", args: <goal-spec> })`
   - **A (special):** if control flow is bespoke (tournament, staged escalation), author a
     one-off Workflow from `templates/` instead.
3. **Report only.** Relay the engine's `all_passed` / `failed[]` / per-subgoal results to the
   user. Eval and retry already happened inside the engine — the user steps back from them.

## What Claude does
- Authors the goal-spec (the one place real thinking goes).
- Invokes the engine (B) or a bespoke script (A).
- Relays the final report; surfaces any `failed[]` honestly.

## What you do
- State the request and its bar. Receive the final report.
- (Optional) watch progress via `/workflows` — visible process is nice-to-have, not required.

## Related
- `harness/goal-spec.md` — schema + authoring rules
- `harness/engine/pipeline.js` — the fixed engine
- `harness/templates/` — A-style bespoke pipelines + reference
- Enforcement (making this fire deterministically via hook/skill) is deferred — see `_deprecated/harness-v0` for prior hook experiments.
