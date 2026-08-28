# harness

A lightweight reasoning floor. Not a quality maximizer — a filter that removes
**repetition** and **below-threshold answers** by forcing every substantial request through
six staged roles:

```
Plan(opus) → SetGoal(opus) → Implement(Codex when enabled) → Test(Codex when enabled) → QualityGate(opus, loop) → Report(sonnet)
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
- **DW-off fallback:** when Dynamic Workflow is disabled or the Workflow tool is absent, form a
  role-isolated Agent Team and run the same six roles through the file-backed fallback contract.
  The team lead only coordinates; Implement, Test, and QualityGate remain separate teammates.
- **M (meta):** the harness *generates* a bespoke Workflow when the request needs control
  flow the fixed stages can't express (tournament, escalation, loop-until-dry) — it copies
  [`templates/meta-skeleton.js`](templates/meta-skeleton.js), rewrites only the `[META]`
  Work block, and runs it. The skeleton's contract (judge ≠ actor, provider routing,
  bounded loops, deterministic Test, goal-level gate) stays verbatim.
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
- v1.19.0 — **DW-off Agent Team fallback**: when Dynamic Workflow is disabled or the Workflow
  tool is absent, the fallback now explicitly requires a role-isolated Agent Team. A thin team
  lead declares Plan, SetGoal/Critic, Implement, Test, QualityGate, and Report ownership in the
  run manifest; teammates exchange only file paths through the run directory, and actor/judge
  separation remains mandatory. Native team primitives are preferred, with an explicit logical
  team of role-separated agents as the portable equivalent. `pipeline.js` is unchanged.
- v1.18.0 — **Codex-first Implement/Test routing**: `codex_provider: "auto"` / `"required"`
  now routes every Workflow Implement/Test stage through the Codex controller by default.
  `implement_provider: "codex"` and `test_provider: "codex"` remain optional trace hints in the
  goal-spec, but missing fields no longer keep a subgoal on Sonnet. This makes the graph shape
  explicit: Claude plans, sets goals, judges, and reports; Codex owns leaf implementation and
  deterministic verification whenever the local CLI route is available. Fallback mode documents
  the same default-provider rule when `RUN/providers.json` says Codex is ready.
- v1.17.0 — **Workflow Codex provider routing semantics**: `implement_provider: "codex"` and
  `test_provider: "codex"` now mean runtime delegation, not trace hints. The Workflow path still
  uses a tiny Sonnet controller because Workflow scripts cannot spawn providers directly, but that
  controller only resolves the adapter, invokes Codex, and converts Codex output into the normal
  handoff/evidence shape. On Codex success it must not redo implementation or verification with
  Sonnet. `codex_provider: "auto"` allows an explicit degraded Sonnet fallback; required mode
  reports provider failure instead of silently falling back. Goal-level repairs also
  prefer the Codex route when delegation is enabled.
- v1.16.2 — **Codex session compatibility boundary**: added `AGENTS.md` guidance that an
  active Codex session must run the harness contract directly with native Codex tools, not
  recurse through `codex`, `codex-exec-adapter.mjs`, or `codex-runner.mjs`. The Codex CLI
  adapter remains only for Claude-orchestrated Workflow/fallback delegation and external
  automation. The Claude Workflow path (`engine/pipeline.js`) is unchanged.
- v1.16.1 — **Codex plugin-mode adapter discovery**: added `harness:codex-control` and
  mounted it in Workflow Implement/Test Codex delegation. `pipeline.js` now honors an explicit
  `args.codex_adapter_path` before repo-local and embedded paths, then uses the skill's
  plugin-mode fallback to derive the adapter beside the plugin-root `pipeline.js` referenced
  from the project's Harness block. The install template now includes `codex_adapter_path` in
  the plugin-mode Workflow example, so non-embedded projects can use Codex without symlinks or
  copying `.claude/harness/**`.
- v1.16.0 — **Workflow Implement/Test Codex delegation**: when `codex_provider` is not off,
  the fixed `pipeline.js` path now has both Sonnet Implement and Sonnet Test agents try the
  local Codex CLI bridge at the start of their stages. Implement uses Codex for code/repo work
  before emitting the normal `HANDOFF`; Test uses a separate Codex call for verification-only
  evidence before producing the normal evidence JSON. Both stages fall back to direct Sonnet
  work if the adapter or Codex CLI is unavailable or returns non-zero.
- v1.15.0 — **Workflow Implement Codex bridge**: the fixed `pipeline.js` path can now keep
  Implement as a Sonnet stage while letting that Sonnet agent call the local Codex CLI through
  `engine/codex-exec-adapter.mjs`. SetGoal may mark code-oriented subgoals with
  `implement_provider: "codex"` when `codex_provider` is not off; the Implement agent runs
  detection, invokes `codex exec --json`, reads the result, and emits the normal `HANDOFF`.
  If Codex is unavailable or fails, the same Sonnet agent falls back to direct implementation.
- v1.14.0 — **Codex solo runner**: added `engine/codex-runner.mjs`, a Codex-only harness
  entrypoint that reproduces the file-artifact fallback contract without touching the Claude
  Workflow path. It runs Plan, SetGoal, Implement, Test, QualityGate, and Report as separate
  `codex exec --json` stages, writes the same `.harness-run/<slug>/` artifacts checked by
  `fallback-check.mjs`, and keeps `pipeline.js` unchanged. Added root `AGENTS.md` so Codex can
  work in this repo without relying on `CLAUDE.md`.
- v1.13.0 — **fallback Codex CLI provider spike promoted**: Workflow-less fallback runs now
  have a documented CLI straight-control path for Codex. At run open, the fallback may call
  `engine/codex-exec-adapter.mjs --detect` to write provider readiness; SetGoal can then mark
  code-oriented subgoals with `implement_provider: "codex"` / `test_provider: "codex"`.
  Implement and Test stay separate `codex exec --json` processes, with JSONL event artifacts
  plus final summary JSON, and Claude still owns Plan, SetGoal, QualityGate, and Report.
  `pipeline.js` remained Claude Workflow-native in this release; v1.15.0 adds a Sonnet-driven
  CLI bridge for Implement, still not a native Workflow provider abstraction.
- v1.12.1 — **Plan skill-namespace hint fix**: the Plan stage's `skills fit (plugins: …)` hint
  in `engine/pipeline.js` now includes `planning:*` and `completion:*`, so the optional executor
  the docs recommend (`planning:executing-plans`) and the statically-mounted
  `completion:verification-before-completion` are actually surfaced to the SetGoal author. Prompt
  hint only — no control-flow change. (Design notes for an upcoming SetGoal review-checkpoint +
  per-subgoal parallel authoring live in `_draft/graph-engineering/`.)
- v1.12.0 — **loop-convergence hardening** (all three execution paths: `pipeline.js`,
  `templates/meta-skeleton.js`, `engine/fallback.md`). SetGoal authoring + the spec critic now
  reject two unwinnable-gate patterns that could burn the whole retry budget without ever passing:
  (1) acceptance/test criteria keyed to **global/shared repo state** (whole-repo `git diff/status`,
  aggregate counts) instead of the subgoal's own artifacts — concurrent work makes those
  non-deterministic; (2) **aspirational / arbitrary-threshold** targets (a chosen % reduction,
  subjective quality words) written as hard pass/fail bars. And both the per-subgoal and goal-level
  QualityGate loops gain a **no-progress early stop**: if a repair attempt reproduces the previous
  attempt's exact gaps/reason, the loop breaks early instead of spending the rest of its
  `max_retries` on an identical gap (still hard-capped by `max_retries` — only exits sooner).
- v1.11.1 — documented the **optional** harness-aware skill integrations: SetGoal may map the
  repo's dual-mode cluster-B skills (`writing-plans`, `executing-plans`, `subagent-driven-development`,
  `test-driven-development`, `writing-skills`, `dispatching-parallel-agents`, `brainstorming`) as
  subgoal executors when the task fits — none required, each also runs standalone. See the harness
  skill's "Optional skill integrations".
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
