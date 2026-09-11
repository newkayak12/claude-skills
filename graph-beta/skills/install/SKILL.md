---
name: install
description: >-
  Use when installing, connecting, or verifying the graph-beta-engineering MCP for a
  Claude Code project. Not for running a graph; use graph-beta:orchestrate.
scenarios:
  - "graph-beta-engineering MCP를 이 프로젝트에 연결해줘"
  - "graph-beta:install로 그래프 실행 환경을 확인해줘"
  - "Install the graph engine for this Claude Code project"
  - "Verify that the graph MCP is connected and exposes its tools"
compatibility:
  required:
    - node-18+
related:
  - orchestrate
  - harness
---

# install — connect the existing graph engine

Connect the graph engine already shipped by this plugin. Do not copy, regenerate, or
fork the engine: `mcp/broker.mjs`, `mcp/graph.mjs`, `mcp/prompts.mjs`, and the bundled
Codex adapter remain plugin-owned and are updated with the `graph-beta` plugin.

## Install modes

Prefer the marketplace plugin. Its `.mcp.json` already registers the
`graph-beta-engineering` stdio server, so installation should not add project files. Ask the
user to install or update `graph-beta@newkayak12-claude-skills`, reload Claude Code if needed,
then verify that `graph_open`, `graph_next`, `graph_run`, `graph_submit`, `graph_retry`,
and `graph_status` are available, and - from the second server the plugin registers,
`task-manager` - `tm_open`, `tm_next`, `tm_submit`, `tm_retry`, `tm_status`.

Use a project-local connection only when the user explicitly wants to run from a source
checkout instead of the marketplace plugin. Merge this entry into the target project's
existing `.mcp.json`; preserve every unrelated server and use an absolute path:

```json
{
  "mcpServers": {
    "graph-beta-engineering": {
      "command": "node",
      "args": ["/absolute/path/to/graph-beta/mcp/broker.mjs"]
    },
    "task-manager": {
      "command": "node",
      "args": ["/absolute/path/to/graph-beta/mcp/taskmanager.mjs"]
    }
  }
}
```

The task manager keeps its state under `~/.harness/tasks/` (override with `HARNESS_TASKS_DIR`),
never under a project. It needs the project to be a git repository: each package of a large
request runs in its own `git worktree` branched from HEAD.

Do not use `${CLAUDE_PLUGIN_ROOT}` in a project-owned `.mcp.json`; that variable belongs
to the plugin's own manifest. Do not register both marketplace and project-local copies,
because two servers exposing the same `graph_*` tools make routing ambiguous.

## Verification

1. Confirm `node --version` is 18 or newer.
2. Validate the selected server path exists when using project-local mode.
3. After Claude Code reloads the MCP configuration, confirm all six `graph_*` tools and all
   five `tm_*` tools are present. Tool discovery is the install gate; do not open a real run
   just to test setup.
4. If a later run uses a named vendor, verify that vendor separately. The
   `graph-beta:orchestrate` skill uses balanced allocation: reasoning prefers the driving
   host/model, Implement/Test prefer the other vendor's efficient model. It declares
   `host_vendor`, `host_model`, and supported `native_models`; external executors pass
   readiness checks. Fable/Astra require explicit model requests. Verify that role
   isolation is available before running work; an MCP
   connection alone does not provide new AI sessions. Both hosts use explicit task
   working directories and shared artifact paths supplied by the orchestration loop.
   Optional named vendor policies forward the selected model into readiness probes;
   a failed probe blocks the node. A bare direct
   `graph_open({vendor: "auto"})` call still stays on `self`; a named vendor fails instead
   of silently degrading.

Report which mode is active, which files changed, whether a reload is still required,
and the observed tool list. Installation ends there; use `graph-beta:orchestrate` to run work.

## Related

- `orchestrate` — drive a request through the connected graph
- `harness:harness` — the six-stage reasoning contract represented by the graph
- `../../.mcp.json` — plugin-owned MCP registration
