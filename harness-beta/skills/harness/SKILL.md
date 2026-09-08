---
name: harness
description: >-
  Use when explicitly running the beta harness where Claude chooses Agent Team
  or Dynamic Workflow for a substantial request. Not the stable harness.
effort: high
scenarios:
  - "Run this through the beta harness and let Claude choose the orchestration path"
  - "Agent Team과 Dynamic Workflow 중 맞는 쪽을 골라서 하네스 돌려줘"
  - "harness beta로 검증까지 해서 처리해줘"
compatibility:
  optional:
    - dynamic-workflow
    - agent-team
related:
  - codex-control
---

# harness beta — AI-routed Claude orchestration

This beta keeps the stable harness contract but changes path selection. When Claude is the
active orchestrator, classify the request first and choose exactly one of **Agent Team** or
**Dynamic Workflow**. Do not ask the user to choose unless the user explicitly wants control.

This plugin is intentionally separate from `harness`. Invoke it as `harness-beta:harness`.
Installing it does not alter the stable plugin or its project-owned governance files.

## Select the route before doing work

An explicit user choice wins. Otherwise inspect runtime availability, then ask one short,
read-only Opus selector agent to classify the raw request. The selector must not edit files,
plan the implementation in detail, or start either engine. Ask for this shape:

```json
{
  "route": "agent_team | dynamic_workflow",
  "reason": "one sentence",
  "signals": ["observed request property"]
}
```

Give the selector these decision rules:

- Prefer **Agent Team** when the request likely contains two or more independent work units,
  benefits from isolated role contexts, or needs adaptive repository/tool exploration.
- Prefer **Dynamic Workflow** when strict ordering, repeatable control flow, auditability, or
  bounded retries are the dominant concern, or when the request needs a bespoke tournament,
  judge panel, staged escalation, per-finding refuters, or loop-until-dry flow.
- If the evidence is mixed or weak, choose **Agent Team**.

Availability is authoritative:

- Agent Team unavailable and Workflow available -> Dynamic Workflow.
- Workflow unavailable and role-separated agents available -> Agent Team.
- Neither available -> report the beta harness unavailable; do not collapse judge and actor.

Before execution, tell the user `BETA route: <route> — <reason>`. Record the same decision in
the Workflow `route_selection` argument or the Agent Team `manifest.json`. Never run both routes
for one request and never switch merely because a gate rejected the work.

The beta does not auto-select the graph MCP. Use `graph:orchestrate` only when the user explicitly
requests the graph path.

## Dynamic Workflow route

For the ordinary six-stage flow run:

```js
Workflow({
  scriptPath: "<harness-beta plugin root>/engine/pipeline.js",
  args: {
    request: "<raw request>",
    context: "<optional constraints>",
    max_retries: 2,
    codex_provider: "off",
    route_selection: { route: "dynamic_workflow", reason: "<selector reason>" }
  }
})
```

Use `templates/meta-skeleton.js` only when the selector identified a control flow the fixed
pipeline cannot express. Keep judge != actor, model/provider pins, bounded loops, deterministic
Test evidence, and the goal-level `match_pct >= 90` gate.

## Agent Team route

Read and follow [`../../engine/fallback.md`](../../engine/fallback.md), even when Workflow is
available. The selector decision is the authorization to use that beta path. Form the declared
roles before Plan, keep the lead thin, exchange stage payloads through run-directory files, and
finish only when `fallback-check.mjs` prints `COMPLETE`.

Independent subgoals may run as a parallel wave only when their dependencies are satisfied and
their file ownership/checks are disjoint. Otherwise serialize them.

## Provider and orchestrator boundaries

Claude owns route selection. `codex_provider` remains `off` unless the user opts into `auto` or
`required`; when enabled, only Implement/Test provider routing changes, not the selected engine.

If the active orchestrator is Codex, do not recursively call Codex adapters or runners. Follow
the repository `AGENTS.md` contract and execute Plan -> SetGoal -> Implement -> Test ->
QualityGate -> Report with native Codex tools.

## Report

Relay the selected engine's final report honestly, including route, failed subgoals, degraded
provider fallbacks, and a failing goal gate. Label the result **beta** so it cannot be confused
with the stable harness path.
