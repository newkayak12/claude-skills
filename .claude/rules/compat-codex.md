# Codex

Claude Code is the reference implementation; supported Codex overlays preserve the same
functional behaviour.

- Do not solve a Codex parse error by silently dropping a Claude hook, gate, skill, or MCP
  capability. Keep Claude-only syntax (hook `modules`) out of Codex configuration
  (`<plugin>/.codex-plugin/`), adapt Codex tool payloads at the boundary, and verify both clients
  independently.
- A compatibility change is complete only when the Claude tests stay green and a real Codex
  invocation proves the equivalent allow/deny or success/failure path; parsing alone is not enough.
- A batch bump also moves `<plugin>/.codex-plugin/` versions where present.

## Harness paths
- Claude Workflow path: `harness/engine/pipeline.js` — keep it isolated; do not change it for
  Codex-only behaviour unless the task asks for a shared provider abstraction.
- Workflow-less fallback: `harness/engine/fallback.md`.
- Codex CLI adapter used by Claude fallback/delegation: `harness/engine/codex-exec-adapter.mjs`.
- Legacy/external runner: `harness/engine/codex-runner.mjs`.

## Inside a Codex session
Do not delegate harness stages back to `codex`, the adapter, or the runner. Run the contract with
native tools: plan → acceptance and checks → implement → verify with fresh commands → gate against
the acceptance → report honestly. Codex gets the push hold from git: `git config core.hooksPath _repo/hooks`.
