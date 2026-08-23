---
name: codex-control
description: >-
  Use when a harness stage must delegate Implement or Test work to local Codex CLI
  from plugin, repo-local, or embedded installs.
scenarios:
  - "Harness Implement stage needs to run Codex from plugin mode"
  - "Harness Test stage needs a Codex verification-only pass"
  - "Resolve codex-exec-adapter.mjs before falling back to Claude"
compatibility:
  optional: []
related:
  - harness
---

# codex-control

Resolve and run the harness Codex CLI bridge without assuming the project embedded
`.claude/harness/**`.

## Adapter Resolution

Use the first existing `codex-exec-adapter.mjs` path:

1. Explicit `codex_adapter_path` from the Workflow args, when provided.
2. Project-local repo layout: `harness/engine/codex-exec-adapter.mjs`.
3. Embedded install layout: `.claude/harness/engine/codex-exec-adapter.mjs`.
4. Plugin-mode layout: read the project's `CLAUDE.md` Harness block, find the
   `Workflow({ scriptPath: "<harness plugin root>/engine/pipeline.js", ... })`
   example, and derive `<harness plugin root>/engine/codex-exec-adapter.mjs`.

If none exists, record that Codex was unavailable and continue through the normal
Claude/Sonnet path.

## Run Contract

- Always run `node "$ADAPTER" --detect --cwd "$PWD" --output <providers.json>` before
  asking Codex to implement or verify.
- Use a separate Codex process for Implement and Test.
- Implement may use `--sandbox workspace-write`.
- Test prompts must be verification-only: do not ask Codex to change implementation
  files, and do not trust the Implement narrative without command/file evidence.
- After Codex returns, read the adapter JSON and produce the normal harness artifact
  shape expected by the current stage.
