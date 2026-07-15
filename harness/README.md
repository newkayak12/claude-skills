# harness

A lightweight reasoning floor. Not a quality maximizer — a filter that removes
**repetition** and **below-threshold answers** by forcing every substantial request through
six model-pinned stages:

```
Plan(opus) → SetGoal(opus) → Implement(sonnet) → Test(sonnet) → QualityGate(opus, loop) → Report(sonnet)
```

## How it works

1. **You pass a raw request.** `Workflow({ scriptPath: "harness/engine/pipeline.js", args: { request: "..." } })`
2. **The engine plans and authors the goal-spec itself** (Opus, with an adversarial critic
   pass), so spec quality doesn't depend on the main-session model. Schema: [`goal-spec.md`](goal-spec.md).
3. **Each subgoal loops Implement → Test → QualityGate** (bounded by `max_retries`):
   executors invoke this repo's skills; a separate Test agent produces deterministic
   evidence (runs commands, reads artifacts); a separate Opus judge gates on evidence.
4. **A goal-level gate scores the assembled whole against the goal** (0-100 `match_pct`,
   pass requires >= 90%; below threshold triggers a repair pass and re-gate), then a
   Report stage synthesizes.

## B vs A
- **B (default):** raw request + the fixed engine.
- **A (special):** bespoke Workflow for custom control flow — see [`templates/`](templates/).

## Status
- v1.1.0 — six-stage engine; restores separate Plan/SetGoal/Test stages, spec critic,
  goal-level gate, and structured handoffs on top of the v1.0.0 lightweight rebuild
  (v0 archived at `_deprecated/harness-v0`, tag `harness-v0`).
- Enforcement: **opt-in PreToolUse gate** ([`hooks/`](hooks/)) — a project lists gated
  paths in `.claude/harness-gate.json`; edits there require harness engagement.
  Fail-open everywhere (v0 lesson); a nudge, not security.

Entry point: [`skills/harness/SKILL.md`](skills/harness/SKILL.md).
