# harness

A lightweight reasoning floor. Not a quality maximizer — a filter that removes **repetition**
and **below-threshold answers** by forcing every substantial request through:

```
decompose → act → independent check → loop
```

## How it works

1. **You author a goal-spec** (declarative data) — the goal, per-subgoal acceptance criteria,
   and dependencies. See [`goal-spec.md`](goal-spec.md). This is the only place real thinking goes.
2. **A fixed engine replays it** ([`engine/pipeline.js`](engine/pipeline.js)) — each subgoal is
   executed by one subagent and judged by a **separate** subagent (never self-eval), with bounded
   retry, running independent subgoals in parallel.
3. **You get a report.** Eval and retry happen inside the engine; you step back from them.

Two layers: the **baked flow** is model-independent (holds at low effort / weaker models); the
**authoring** captures strong reasoning once and replays it cheaply. Quality ceiling still follows
the model — by design.

## B vs A
- **B (default):** goal-spec + the fixed engine. `Workflow({ scriptPath: "harness/engine/pipeline.js", args: <goal-spec> })`
- **A (special):** bespoke Workflow for custom control flow — see [`templates/`](templates/).

## Status
- v1.0.0 — rebuilt lightweight (5 files) from the v0 harness (~60 files, archived at `_deprecated/harness-v0`, tag `harness-v0`).
- Enforcement (making the harness fire deterministically via hook/skill) is **deferred** — v0's hook experiments had adverse effects.

Entry point: [`SKILL.md`](SKILL.md).
