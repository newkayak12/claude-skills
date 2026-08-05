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

## Modes
- **B (default):** raw request + the fixed engine.
- **M (meta):** the harness *generates* a bespoke Workflow when the request needs control
  flow the fixed stages can't express (tournament, escalation, loop-until-dry) — it copies
  [`templates/meta-skeleton.js`](templates/meta-skeleton.js), rewrites only the `[META]`
  Work block, and runs it. The skeleton's contract (judge ≠ actor, model pins, bounded
  loops, deterministic Test, goal-level gate) stays verbatim.
- **A (manual):** you author the bespoke Workflow yourself — see [`templates/`](templates/).

## Installing into a project

Marketplace install alone enforces nothing. Run the **`install` skill**
([`skills/install/SKILL.md`](skills/install/SKILL.md)) from the target project to make
governance ambient — it scaffolds project-owned copies (never overwrites existing files):

- `.claude/harness-gate.json` — activates the edit gate on confirmed path patterns
- `.claude/hooks/goal-gate.mjs` + a merged `.claude/settings.json` PreToolUse entry —
  the self-contained gate hook, committed so it enforces team-wide without depending on
  the plugin install (engine still lives in the plugin — see the install skill's gap note)
- `.claude/conventions/{coding,verification,boundaries}.md` — default ruleset the engine
  reads (SetGoal → acceptance/test, Implement → follows)
- a fenced `## Harness` section appended to the project's `CLAUDE.md`
- `.claude/.harness-markers/` in `.gitignore`

The project owns the copies afterward; the plugin never manages them again.

## Status
- v1.11.0 — **re-introduced** the Workflow-less fallback ([`engine/fallback.md`](engine/fallback.md)),
  redesigned to fix what sank v1.9.0. No transcript sentinel and no edit-gate coupling (those
  false-positived on quoted occurrences). Instead: the six stages run as **fresh per-stage Agent
  subagents** that exchange work through files in a **run directory**, so the orchestrator stays a
  thin dispatcher and a long run can't pollute its context; completion is an **objective, resumable
  check** ([`engine/fallback-check.mjs`](engine/fallback-check.mjs)) that names any missing or
  degenerate stage artifact. Selected only when the Workflow tool is absent; `pipeline.js` (Workflow
  path) unchanged. Honest ceiling: still fail-open — the check makes a skipped stage detectable,
  not impossible.
- v1.10.0 — removed the original Workflow-less fallback: its sentinel was a plain documented string
  that leaked into transcripts and false-positived Workflow-capable sessions.
- v1.9.0 — (superseded) first Workflow-less fallback attempt via the Agent tool + a sentinel gate.
- v1.8.0 — `install.mjs` gains a `refresh: true` mode: after a plugin version bump it
  re-copies only the plugin-owned files (`goal-gate.mjs`, embedded `.claude/harness/**`),
  reporting `refreshed`/`unchanged`, and never touches user-owned files (gate, conventions,
  CLAUDE.md, settings.json). Default stays non-destructive. Corrects the earlier inaccurate
  "re-run to refresh" note (a plain re-run keeps everything).
- v1.7.0 — Planner now mounts `agents:agent-task-decomposer` with a systems-analyst persona
  (crisp, dependency-mapped, independently-verifiable units); Report gains an honest
  status-reporter persona (sonnet unchanged). Standalone embedding's static-skill set updated
  to three (decomposer + devils-advocate + verification-before-completion).
- v1.6.0 — `install` delegates its deterministic file work (gate write, hook copy +
  `.claude/settings.json` merge, standalone embedding, `.gitignore`) to
  [`skills/install/install.mjs`](skills/install/install.mjs); the skill keeps only
  judgment/dialogue. Idempotent JSON merge (never clobbers existing hooks, leaves
  unparseable settings untouched). Skill descriptions front-loaded for trigger matching.
- v1.5.0 — `install` now embeds the gate hook into the project: copies the self-contained
  `goal-gate.mjs` to `.claude/hooks/` and merges a PreToolUse entry into committed
  `.claude/settings.json`, so enforcement is project-owned (no plugin dependency for the
  gate). Idempotent merge. It also **asks whether to embed the engine + statically-referenced
  skills into `.claude/harness/`** for plugin-less environments (air-gapped/CI) — opt-in,
  with the dynamic-`skills[]` boundary called out (SetGoal picks those from the whole
  catalogue and they can't be pre-enumerated).
- v1.4.0 — Mode M: the harness generates request-shaped bespoke Workflows from
  `templates/meta-skeleton.js` (contract-preserving meta-scripts).
- v1.2.0 — `install` skill: per-project scaffolding (gate + conventions + CLAUDE.md section).
- v1.1.0 — six-stage engine; restores separate Plan/SetGoal/Test stages, spec critic,
  goal-level gate, and structured handoffs on top of the v1.0.0 lightweight rebuild
  (v0 preserved in git history at tag `harness-v0`; its situational rulesets were
  recycled into the install skill's optional conventions).
- Enforcement: **opt-in PreToolUse gate** ([`hooks/`](hooks/)) — a project lists gated
  paths in `.claude/harness-gate.json`; edits there require harness engagement.
  Fail-open everywhere (v0 lesson); a nudge, not security.

Entry point: [`skills/harness/SKILL.md`](skills/harness/SKILL.md).
