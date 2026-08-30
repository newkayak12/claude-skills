---
name: harness
description: >-
  Use when a substantial request needs verified, non-repetitive output. Triggers
  on: "이거 제대로 해줘", "검증까지 해서", "하네스 돌려줘", "run the harness", "do this properly
  with verification", "6단계로 처리해줘", "메타스크립트로". Not for trivial edits or Q&A.
scenarios:
  - "이거 대충 말고 제대로, 검증까지 해서 처리해줘"
  - "하네스 돌려서 단계별로 검증하고 결과만 보고해줘"
  - "하네스 메타스크립트로 이 요청에 맞는 파이프라인 만들어서 돌려줘"
  - "Do this properly — plan it, verify each part independently, then report"
  - "Run the harness on this request"
compatibility:
  optional:
    - think-tool          # request 정제 시
related:
  - plan
  - review
  - install
  - remove
  - patch
---

# harness — six-stage engine: Plan → SetGoal → Implement → Test → QualityGate → Report

The harness raises the **floor**, not the ceiling: every substantial request goes through
six staged roles so repetition and weak answers get filtered out regardless of the
main-session model. Planning and judging are pinned to Opus. Code/repo execution and
deterministic verification are provider-routed: when `codex_provider` is enabled, every
Implement/Test stage delegates to Codex by default. `implement_provider: "codex"` /
`test_provider: "codex"` are trace hints, not prerequisites. Sonnet is then only a thin
Workflow controller/fallback/report role, not the actor.

## Process

1. **Pass the raw request to the engine** (B, default):
   `Workflow({ scriptPath: "harness/engine/pipeline.js", args: { request: "<the request>", context: "<optional constraints>", max_retries: 2, codex_provider: "auto" } })`
   The engine itself plans, authors + critiques the goal-spec, executes subgoals with
   repo-skill-equipped executors, verifies each deterministically, gates each and the
   assembled whole, and writes the report.
   - In the Workflow path, `codex_provider: "auto"` / `"required"` makes Codex the default
     route for every Implement/Test stage. A minimal Sonnet controller invokes
     `harness:codex-control`, resolves `engine/codex-exec-adapter.mjs`, and runs a separate
     local Codex CLI process. On success it only converts Codex output into the normal
     `HANDOFF` or evidence JSON. With
     `codex_provider: "auto"` a failed route may explicitly degrade to Sonnet fallback; required
     mode reports provider failure instead. Use `codex_provider: "off"` to force plain Sonnet
     implementation and verification.
   - **If Dynamic Workflow (DW) is off or the Workflow tool is unavailable** (plain Agent SDK,
     some harnesses, CI): do NOT skip the engine — follow
     [`engine/fallback.md`](../../engine/fallback.md) instead. First form a role-isolated
     **Agent Team** with a thin team lead and separate Plan, SetGoal/Critic, Implement, Test,
     QualityGate, and Report teammates. Teammates exchange work through files in a run
     directory (not the lead's context), and `engine/fallback-check.mjs` remains the objective
     done-signal. Use the runtime's team primitive when available; otherwise explicitly compose
     the same logical team from role-separated agents. When Workflow IS available, ignore
     fallback.md — the pipeline.js path above is unchanged.
     In fallback mode only, the run auto-detects a local `codex` CLI; when ready, Implement/Test
     subgoals route to separate `codex exec --json` processes while Claude keeps Plan, SetGoal,
     QualityGate, and Report.
   - **If the active orchestrator is Codex itself**: do not call `codex`, `codex-exec-adapter.mjs`,
     or `codex-runner.mjs` recursively. Follow the repository `AGENTS.md` contract and perform
     Plan → SetGoal → Implement → Test → QualityGate → Report directly with native Codex tools.
2. **M (meta):** when the fixed six stages can't express the control flow the request
   needs — tournament/judge-panel, staged escalation, loop-until-dry discovery,
   per-finding refuters — or the user explicitly asks ("메타스크립트로", "커스텀
   파이프라인으로"), **generate the pipeline instead of using the fixed one**:
   1. Copy `templates/meta-skeleton.js` into the scratchpad and rewrite ONLY the
      `[META]` Work block (and `meta`) to the control flow the request needs.
   2. Keep the skeleton's five contract points verbatim: judge ≠ actor; model/provider pins
      (plan/judge=opus, execute/test=provider-routed, report=sonnet); every loop bounded; deterministic
      Test agent (Bash/Read evidence, never the actor's narrative); goal-level
      `match_pct >= 90` gate before Report.
   3. Run it: `Workflow({ scriptPath: "<scratchpad>/meta-<slug>.js", args: { request, context?, max_retries? } })`.
   Default to B when in doubt — M earns its cost only when the control flow itself is
   the problem.
3. **A (manual):** the user hands you a ready-made bespoke script → run it as-is.
4. **Relay the returned `report` to the user.** Surface `failed[]` and a failing
   `goal_gate` honestly. Eval and retry already happened inside the engine.

## What Claude does
- Phrases `args.request` faithfully (add known constraints via `args.context`).
- Invokes the engine; relays `report`, `all_passed`, `failed[]`, `goal_gate`.

## What you do
- State the request and its bar. Receive the final report.
- (Optional) watch progress via `/workflows` — six phase groups are visible.

## Optional skill integrations

The engine statically mounts three skills — `agents:agent-task-decomposer` (Plan),
`think:devils-advocate` (SetGoal critic + QualityGate), `completion:verification-before-completion`
(Test). Codex-enabled Implement/Test stages also mount `harness:codex-control` to resolve the
CLI adapter across plugin, repo-local, and embedded installs. Beyond those, SetGoal MAY
**optionally** map the repo's harness-aware skills — each
rewritten dual-mode to run standalone AND as a harness executor — into subgoals when the task
fits. None is required; the harness runs without them and each also works on its own:

- `write:writing-plans` — produce a gate-ready plan / goal-spec-shaped decomposition.
- `planning:executing-plans` — pre-flight plan gate + executor routing.
- `agents:subagent-driven-development` — fresh-subagent-per-task execution with two-stage review.
- `develop:test-driven-development` — drive an Implement subgoal test-first (evidence gate).
- `write:writing-skills` — author a convention-compliant skill; its pressure test can back a QualityGate.
- `agents:dispatching-parallel-agents` — allocate independent work across best-fit personas.
- `think:brainstorming` — diverge/converge before a spec when the request is under-specified.

These are opt-in: SetGoal picks them by relevance from the whole catalogue, so they need no
pre-wiring, and using none of them is a valid run.

## Related
- `harness/goal-spec.md` — spec schema (authored by the SetGoal stage) + authoring rules
- `harness/skills/codex-control/SKILL.md` — adapter discovery contract for Codex CLI delegation
- `harness/engine/pipeline.js` — the fixed six-stage engine (Workflow path)
- `harness/engine/fallback.md` — DW-off/Workflow-less fallback: same six stages via a role-isolated Agent Team sharing state through a run directory
- `harness/engine/fallback-check.mjs` — deterministic completion check for a fallback run (the objective done-signal)
- `harness/engine/codex-exec-adapter.mjs` — CLI bridge that detects Codex and captures `codex exec --json` events for Claude-orchestrated Workflow Implement/Test delegation and fallback runs
- `harness/engine/codex-runner.mjs` — legacy/external automation runner; active Codex sessions should not invoke it recursively
- `harness/templates/meta-skeleton.js` — Mode M starting point (contract + `[META]` block)
- `harness/templates/` — bespoke-pipeline reference
- `harness/hooks/` — opt-in PreToolUse gate: projects list gated paths in `.claude/harness-gate.json`; editing them without engaging the harness is denied (fail-open on any ambiguity).
- `harness/skills/install/` — project scaffolding; `remove/` reverses it and `patch/`
  prepares synchronized patch-version metadata.
