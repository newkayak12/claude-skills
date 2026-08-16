# Codex Instructions

This repository is primarily a Claude Code skill/plugin repository, but it is also safe to
work on with Codex.

## Repository Shape

- Skills live under `<plugin>/skills/<skill-name>/SKILL.md`.
- Plugin manifests live at `<plugin>/.claude-plugin/plugin.json`.
- The marketplace manifest lives at `.claude-plugin/marketplace.json`.
- The harness plugin lives under `harness/`.

## Harness Paths

- Claude Workflow path: `harness/engine/pipeline.js`
- Claude Workflow-less fallback instructions: `harness/engine/fallback.md`
- Codex CLI adapter used by fallback: `harness/engine/codex-exec-adapter.mjs`
- Codex-only runner: `harness/engine/codex-runner.mjs`

Keep the Claude Workflow path isolated. Do not change `pipeline.js` for Codex-only behavior
unless the task explicitly asks for a shared provider abstraction.

## Validation

After plugin or skill changes, run:

```sh
python3 scripts/validate_plugins.py
```

For harness engine script changes, also run:

```sh
node --check harness/engine/codex-exec-adapter.mjs
node --check harness/engine/codex-runner.mjs
node --check harness/engine/fallback-check.mjs
```

## Versioning

When changing plugin behavior, bump the affected plugin version in:

- `<plugin>/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`

For harness changes, also add a concise entry at the top of `harness/README.md` under
`## Status`.
