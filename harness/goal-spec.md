# goal-spec — the declarative data the engine runs (B)

The harness is **one fixed engine** (`engine/pipeline.js`) driven by **one piece of data
you author at planning time**: the goal-spec. Intelligence lives in *authoring the spec once*
(strong orchestrator); the engine *replays* it cheaply, so the flow holds even at low
effort / weaker models. Quality ceiling still follows the model — that is unavoidable and
not the harness's job. The harness's job: filter out **repetition** and **below-threshold
answers** by forcing decompose → act → independent-check → loop.

## Schema

```jsonc
{
  "goal": "the north star for this request — one sentence",
  "acceptance": [
    "goal-level criteria the whole result is judged against"
  ],
  "subgoals": [
    {
      "id": "s1",                      // stable id, referenced by deps
      "title": "what this unit produces",
      "persona": "optional role for the executor (e.g. 'kotlin-specialist')",
      "acceptance": [                  // what the INDEPENDENT judge checks — derived from the goal
        "concrete, checkable criterion",
        "another criterion"
      ],
      "deps": []                       // ids that must finish first (omit/[] = no deps)
    }
  ],
  "max_retries": 2                     // per-subgoal act↔check loop cap (default 2)
}
```

## Rules for authoring (this is the lever — get it right)

1. **acceptance is derived from the goal, per request.** No fixed rubric. The judge only
   knows what you write here — vague acceptance = worthless check.
2. **subgoals are divide-and-conquer of the goal.** Independent units. Use `deps` only for
   real ordering; independent subgoals run in parallel.
3. **Keep it small.** If a request is trivial, one subgoal is fine. Don't manufacture phases.
4. **check ≠ act.** The engine always sends work to a *separate* judge subagent — never let
   the executor grade itself.

## How it runs

`harness/SKILL.md` tells the assistant to author a spec, then invoke the engine with it:

```
Workflow({ scriptPath: "harness/engine/pipeline.js", args: <goal-spec> })
```

The engine runs dependency waves (parallel where possible), loops each subgoal act↔check up
to `max_retries`, and returns a report: `all_passed`, `failed[]`, and per-subgoal results.
You relay the report to the user — they step back from eval/retry.

## When to use A instead

B (this spec + fixed engine) is the default. When a request needs **custom control flow**
the generic engine can't express (tournaments, staged escalation, bespoke verification
topology), author a one-off Workflow script instead — see `templates/`.
