# templates — bespoke Workflow starting points (Modes M and A)

**B is the default** (raw request + the fixed engine, `../engine/pipeline.js`: Plan→SetGoal→
Implement→Test→QualityGate→Report — the engine plans and authors the goal-spec itself, you
don't). Reach for a bespoke script only when the control flow itself is the problem —
something the six fixed stages can't express.

## When a bespoke script earns its cost
- **Tournament / judge-panel:** generate N competing attempts, score, synthesize the winner.
- **Staged escalation:** cheap pass first, escalate only failures to a heavier lens.
- **Bespoke verification topology:** per-finding adversarial refuters, loop-until-dry discovery.

## Mode M (generated) — `meta-skeleton.js`
The harness skill generates the script itself: copy `meta-skeleton.js`, rewrite only the
`[META]` Work block to the control flow the request needs, run via
`Workflow({ scriptPath, args: { request } })`. The skeleton's five contract points
(judge ≠ actor, model pins, bounded loops, deterministic Test, goal-level `match_pct >= 90`
gate) stay verbatim — they are what keeps a generated pipeline a *harness* rather than an
unguarded one-off.

## Mode A (manual)
Author a self-contained Workflow script yourself (see the Workflow tool contract), then run
it. Same spirit: **the judge is always a separate agent from the actor** — never self-eval.

## Reference (do not follow — read for ideas only)
- `gajae-pipeline.js` from v0 (git tag `harness-v0`, at
  `harness/scripts/workflow-templates/`): per-goal Planner→Critic→[Executor↔Verifier]×3.
  Useful as a shape reference; B now runs a fixed 6-stage pipeline too, but with a
  different verdict model: per-subgoal boolean `pass` plus a goal-level `match_pct`
  gate (>= 90 to pass), not this file's fixed 3-boolean verdict.
