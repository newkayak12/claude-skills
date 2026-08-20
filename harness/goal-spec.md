# goal-spec — the data SetGoal authors and the engine runs

In v1.1 the goal-spec is **authored inside the engine** by the SetGoal stage (pinned Opus),
then adversarially critiqued and revised once, before execution. You normally pass a raw
request — not a spec. This document defines the schema (for reading run outputs, and for
A-mode/manual authoring) and the authoring rules the SetGoal stage follows.

## Schema

```jsonc
{
  "goal": "the north star for this request — one sentence",
  "acceptance": [
    "goal-level criteria — judged by the final QualityGate over the assembled whole"
  ],
  "subgoals": [
    {
      "id": "s1",                      // stable id, referenced by deps
      "title": "what this unit produces",
      "persona": "optional executor role (e.g. 'senior Kotlin engineer')",
      "skills": ["develop:kotlin-specialist"],  // repo skills the executor MUST invoke
      "implement_provider": "codex",     // optional: try Codex CLI bridge for Implement
      "test_provider": "codex",          // optional fallback/runner hint
      "acceptance": [                  // what the QualityGate judge checks
        "concrete, checkable criterion"
      ],
      "test": [                        // what the Test agent EXECUTES (commands / concrete checks)
        "./gradlew test --tests SomeTest"
      ],
      "deps": []                       // ids that must finish first (omit/[] = no deps)
    }
  ],
  "max_retries": 2                     // per-subgoal Implement↔Test↔QualityGate loop cap
}
```

## Authoring rules (what SetGoal is held to)

1. **acceptance is derived from the goal, per request.** No fixed rubric; vague acceptance
   = worthless gate.
2. **test[] must be executable without trusting the executor** — commands to run, files to
   inspect. This is what makes the Test stage deterministic evidence, not narrative review.
3. **skills[] maps repository skills** (develop:*, think:*, write:*, pm:*, …) the executor
   invokes before working. 1–3 per subgoal; none is acceptable for generic work.
4. **subgoals are divide-and-conquer.** deps only for real ordering; independent subgoals
   run in parallel. Trivial request = one subgoal.
5. **check ≠ act.** Test and QualityGate agents are always separate from the executor.
6. **provider fields are CLI-bridge hints, not Workflow provider abstraction.** In the
   Workflow path, `implement_provider: "codex"` tells the Sonnet Implement agent to try the
   local `codex` CLI through `engine/codex-exec-adapter.mjs`, then turn the result into the
   normal `HANDOFF`; if Codex is unavailable or fails, the same Sonnet agent falls back to
   implementing directly. In Workflow-less runs, `implement_provider` / `test_provider` may
   route stages to separate `codex exec --json` processes when `RUN/providers.json` shows
   Codex is ready.

## How it runs

```
Workflow({ scriptPath: "harness/engine/pipeline.js",
           args: { request: "<raw request>", context: "<optional>", max_retries: 2,
                   codex_provider: "auto" } })
```

Stages (model-pinned): Plan(opus) → SetGoal(opus, +critic) → per subgoal
Implement(sonnet) → Test(sonnet) → QualityGate(opus) looped up to max_retries →
goal-level QualityGate(opus, quantified `match_pct`, pass requires >= 90%, repair-and-regate
loop up to max_retries) → Report(sonnet). With `codex_provider: "auto"` (the default),
code-oriented Implement subgoals may first use the local Codex CLI bridge from inside the
Sonnet Implement agent; use `codex_provider: "off"` to force plain Sonnet implementation.
Returns `{ goal, codex_provider, spec, all_passed,
failed[], goal_gate, results[], report }`.

## When to use A instead

B (raw request + fixed engine) is the default. When a request needs **custom control flow**
the engine can't express (tournaments, staged escalation, bespoke verification topology),
author a one-off Workflow script instead — see `templates/`.
