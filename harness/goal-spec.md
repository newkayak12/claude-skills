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
      "implement_provider": "codex",     // optional trace hint; codex_provider controls routing
      "test_provider": "codex",          // optional trace hint; codex_provider controls routing
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
6. **codex_provider controls provider routing.** In the Workflow path, `codex_provider:
   "auto"` / `"required"` means every Implement/Test stage delegates to local Codex CLI through
   a minimal Workflow delegation controller, whether or not `implement_provider: "codex"` /
   `test_provider: "codex"` is present. The provider fields are optional trace hints in the
   goal-spec. The controller exists only because Workflow scripts cannot spawn providers
   directly; it resolves `engine/codex-exec-adapter.mjs`, runs a separate `codex exec --json`
   process, and converts Codex's final message into the normal `HANDOFF` or evidence JSON. On
   Codex success it must not redo the work or verification with Sonnet. With `codex_provider:
   "auto"` a failed Codex route may explicitly degrade to Sonnet fallback; with
   `codex_provider: "required"` it reports provider failure instead of silently doing the work
   in Sonnet. In Workflow-less runs, Codex-ready Implement/Test stages route to separate
   `codex exec --json` processes when `RUN/providers.json` shows Codex is ready. When the active
   orchestrator is Codex itself, ignore these fields and run the harness contract directly; do
   not spawn a nested `codex` process.

## How it runs

```
Workflow({ scriptPath: "harness/engine/pipeline.js",
           args: { request: "<raw request>", context: "<optional>", max_retries: 2,
                   codex_provider: "auto|required|off",
                   codex_adapter_path: "<optional adapter path>" } })
```

Stages: Plan(opus) → SetGoal(opus, +critic) → per subgoal Implement(provider-routed) →
Test(provider-routed) → QualityGate(opus) looped up to max_retries → goal-level
QualityGate(opus, quantified `match_pct`, pass requires >= 90%, repair-and-regate loop up to
max_retries) → Report(sonnet). With `codex_provider: "auto"` (the default), Implement and Test
stages delegate to Codex first and fall back only with an explicit degraded note. With
`codex_provider: "required"`, each Codex route must succeed or the stage fails as provider
failure. Use `codex_provider: "off"` to force plain Sonnet implementation and verification.
Returns `{ goal, codex_provider, spec, all_passed,
failed[], goal_gate, results[], report }`.

## When to use A instead

B (raw request + fixed engine) is the default. When a request needs **custom control flow**
the engine can't express (tournaments, staged escalation, bespoke verification topology),
author a one-off Workflow script instead — see `templates/`.
