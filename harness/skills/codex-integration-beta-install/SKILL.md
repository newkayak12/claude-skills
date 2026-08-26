---
name: codex-integration-beta-install
description: >-
  Install the opt-in Codex provider-node beta beside a stable harness installation. Use when
  a project wants Claude Workflow Implement/Test stages to route through explicit Codex nodes
  without replacing harness:install or the stable harness runtime.
scenarios:
  - "Install the Codex integration beta beside stable harness"
  - "Codex provider-node beta를 기존 harness와 분리해서 설치해줘"
compatibility:
  optional: []
---

# codex-integration-beta-install

Install the experimental runtime at `.claude/harness-codex-beta/`. The stable plugin engine
and any `.claude/harness/` embedded by `harness:install` remain untouched.

## Contract

- This is opt-in. The installed CLAUDE.md block keeps stable harness as the default and selects
  the beta only when the requester explicitly asks for the Codex integration beta.
- The beta resolves Codex once per run, then represents Implement and Test as separate provider
  nodes with structured results. `auto` uses a distinct Sonnet fallback node after provider-node
  failure; `required` fails instead of falling back.
- `transport_ok` means the Codex process completed. `stage_ok` means its structured stage contract
  completed. Test additionally reports `verified`; QualityGate cannot turn `verified=false` into a
  pass and is instructed not to run tools or modify work.
- The runtime is Node-only. Python is not installed or invoked by this beta.

## Install

1. Tell the user this adds a parallel beta runtime and does not upgrade or replace stable harness.
2. Run:

   ```sh
   node "<plugin>/skills/codex-integration-beta-install/install.mjs" '{
     "projectDir": "<absolute project root>"
   }'
   ```

   The installer copies only the beta pipeline and adapter, then adds a separately marked
   CLAUDE.md invocation block. Existing beta-owned files are kept by default.
3. Read the JSON report and list `created`, `kept`, `refreshed`, or `unchanged` actions exactly.
4. If Codex needs write access outside the project sandbox (for example a build cache), add only
   user-approved paths to the Workflow call's `codex_add_dirs` array. Do not broaden the sandbox.

## Refresh

After updating the plugin, rerun with `"refresh": true`. Only files under
`.claude/harness-codex-beta/` are refreshed; the CLAUDE.md block and all stable harness files are
left alone.

## Related

- `install.mjs` — deterministic beta copy and CLAUDE.md block installation
- `assets/engine/pipeline.js` — beta Workflow graph
- `assets/engine/codex-exec-adapter.mjs` — structured Codex stage adapter
