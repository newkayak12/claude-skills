# templates — A (bespoke Workflow) starting points

**B is the default** (declarative goal-spec + `../engine/pipeline.js`). Reach for A only when
the control flow itself is the problem — something the generic decompose→act→check→loop engine
can't express.

## When A earns its cost
- **Tournament / judge-panel:** generate N competing attempts, score, synthesize the winner.
- **Staged escalation:** cheap pass first, escalate only failures to a heavier lens.
- **Bespoke verification topology:** per-finding adversarial refuters, loop-until-dry discovery.

## How
Author a self-contained Workflow script (see the Workflow tool contract), then run it. Keep the
same spirit as B: **the judge is always a separate agent from the actor** — never self-eval.

## Reference (do not follow — read for ideas only)
- `../../_deprecated/harness-v0/scripts/workflow-templates/gajae-pipeline.js`
  Per-goal Planner→Critic→[Executor↔Verifier]×3. Useful as a shape reference; we deliberately
  dropped its fixed 3-boolean verdict and hardcoded phases in favor of goal-derived acceptance.
