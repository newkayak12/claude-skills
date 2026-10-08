---
name: install
description: >-
  Use when installing, connecting, or verifying the graph-engineering MCP for a
  Claude Code project. Not for running a graph; use graph:orchestrate.
scenarios:
  - "graph-engineering MCP를 이 프로젝트에 연결해줘"
  - "graph:install로 그래프 실행 환경을 확인해줘"
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
Codex adapter remain plugin-owned and are updated with the `graph` plugin.

## Install modes

Prefer the marketplace plugin. Its `.mcp.json` already registers the
`graph-engineering` stdio server, so installation should not add project files (on request only, `.claude/conventions/`; see below). Ask the
user to install or update `graph@newkayak12-claude-skills`, reload Claude Code if needed,
then verify that `graph_open`, `graph_next`, `graph_run`, `graph_submit`, `graph_retry`,
and `graph_status` are available.

Use a project-local connection only when the user explicitly wants to run from a source
checkout instead of the marketplace plugin. Merge this entry into the target project's
existing `.mcp.json`; preserve every unrelated server and use an absolute path:

```json
{
  "mcpServers": {
    "graph-engineering": {
      "command": "node",
      "args": ["/absolute/path/to/graph/mcp/broker.mjs"]
    }
  }
}
```

Do not use `${CLAUDE_PLUGIN_ROOT}` in a project-owned `.mcp.json`; that variable belongs
to the plugin's own manifest. Do not register both marketplace and project-local copies,
because two servers exposing the same `graph_*` tools make routing ambiguous.

## Reference project conventions (optional)

Ask: "Do you have a reference project whose code style graph nodes should follow?"
Default **No**. If yes and `develop:like-my-code` is available, run it with target
`.claude/conventions/` (creating `coding.md` / `boundaries.md` from the template
headings when missing). If the `develop` plugin is absent, skip this step and print
`/plugin install develop@newkayak12-claude-skills`; never fail the install over it.

The graph broker injects one instruction into every plan, setgoal, implement, and test
node prompt, regardless of vendor: read the relevant `.claude/conventions/**` files and
follow them (setgoal folds them into `acceptance[]`).

## Verification

1. Confirm `node --version` is 18 or newer.
2. Validate the selected server path exists when using project-local mode.
3. After Claude Code reloads the MCP configuration, confirm all six `graph_*` tools are
   present. Tool discovery is the install gate; do not open a real run just to test setup.
4. If a later run uses a named vendor, verify that vendor separately. The
   `graph:orchestrate` skill uses balanced allocation: reasoning prefers the driving
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
the observed tool list, and the reference-project outcome (ran / declined / skipped: develop absent). Installation ends there; use `graph:orchestrate` to run work.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Verifies the `graph_*` tools are available, or merges the project-local `.mcp.json` entry | Installs or updates `graph@newkayak12-claude-skills` and reloads Claude Code |
| Asks the reference-project question (default No); runs `develop:like-my-code` into `.claude/conventions/` when yes | Answers it, or installs `develop@newkayak12-claude-skills` first |
| Never copies or forks the engine; avoids double registration | Chooses project-local mode only when running from a source checkout |

## Related

- `orchestrate` — drive a request through the connected graph
- `develop:like-my-code` — writes the `.claude/conventions/` files the broker tells nodes to follow
- `harness:harness` — the six-stage reasoning contract represented by the graph
- `../../.mcp.json` — plugin-owned MCP registration
