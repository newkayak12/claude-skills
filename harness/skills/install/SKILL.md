---
name: install
description: >-
  Use when installing the harness into a project. Triggers on: "하네스 설치해줘", "이
  프로젝트에 하네스 적용해줘", "harness install", "set up the harness here", "게이트
  켜줘", "convention 스캐폴딩해줘". Not for running the engine (use the harness skill).
scenarios:
  - "이 프로젝트에 하네스 설치하고 게이트 켜줘"
  - "convention 기본셋이랑 하네스 규칙 스캐폴딩해줘"
  - "Install the harness into this project"
  - "Set up the harness gate and default conventions here"
compatibility:
  optional: []
related:
  - harness
---

# install — scaffold harness governance into the current project

Installing the plugin from the marketplace enforces nothing by itself. This skill makes
governance **ambient and deterministic** by writing project-owned files (option A: the
project owns and edits its copies; the plugin never manages them afterward).

## Process

The SKILL owns judgment and dialogue; the deterministic file work — gate write, hook copy +
`.claude/settings.json` merge, standalone embedding, `.gitignore` — is delegated to
`install.mjs` so the fiddly, error-prone parts run identically every time. Everything is
idempotent and non-destructive: existing files are never overwritten.

1. **Gather confirmed inputs first (judgment — before running anything).**
   - **Gate patterns:** inspect the project (languages, source roots) and propose patterns
     (Kotlin `"src/.*\\.kt$"`, TS `"src/.*\\.tsx?$"`, …); confirm with the user. If
     `.claude/harness-gate.json` already exists, `install.mjs` keeps it — just report its
     patterns.
   - **Standalone embedding — ASK:** "플러그인 없이도 하네스가 돌게 임베드할까요? (에어갭/CI용,
     용량↑·drift 관리 필요)". Default **No**.
     - The hook is self-contained, but the **engine, Codex CLI adapter/runner, and the skills it invokes live in the
       plugin**. Without embedding, a plugin-less project's gate blocks with no local way to
       satisfy it — say so.
     - If **Yes**: locate the source dirs of the skills the engine **statically** mounts —
       `agents:agent-task-decomposer` (Planner), `think:devils-advocate` (critic + judges),
       and `completion:verification-before-completion` (tester) — and pass them as `{name, src}`.
       Offer to add a broader skill set the project expects to use.
     - **Hard caveat, say it out loud:** subgoal `skills[]` are chosen **dynamically by
       SetGoal from the whole catalogue** and can't be pre-enumerated; embedding guarantees
       only what you pass. MCP tools (sequential-thinking, think-tool, mcp-reasoner) can't be
       embedded at all.

2. **Run `install.mjs` with the confirmed values** (gate + hook + embedding + gitignore — all
   deterministic, idempotent, non-destructive):
   ```
   node "<plugin>/skills/install/install.mjs" '{
     "projectDir": "<abs project root>",
     "gate": { "patterns": ["src/.*\\.kt$"], "window_hours": 2 },
     "embed": { "runtime": true, "skills": [
       { "name": "agent-task-decomposer", "src": "<abs>/agents/skills/agent-task-decomposer" },
       { "name": "devils-advocate", "src": "<abs>/think/skills/devils-advocate" },
       { "name": "verification-before-completion", "src": "<abs>/completion/skills/verification-before-completion" } ] }
   }'
   ```
   Omit `gate` to skip the gate write; omit `embed` to skip embedding. It **always** installs
   the hook (`.claude/hooks/goal-gate.mjs` + a merged `.claude/settings.json` PreToolUse entry
   — never clobbering existing hooks; an unparseable settings.json is left untouched) and the
   `.gitignore` line. **Read the JSON report it prints** (per-action `created`/`kept`/`already`
   /`parse-error`) — that is the source of truth for step 5.

3. **Conventions — `.claude/conventions/`** (judgment, agent-run):
   - Copy each `templates/conventions/{coding,verification,boundaries}.md` **only if missing**
     (do not dedupe topics the user already covers under other names).
   - **Optional rulesets** (`templates/conventions/optional/`): copy only when the project
     matches the trigger at the top of each — `security.md`, `data.md`, `operations.md`. Ask
     when unsure; skip silently when irrelevant.
   - Fill the `<!-- fill -->` placeholders you can derive; name the ones left for the user.

4. **CLAUDE.md — ambient instruction** (judgment, agent-run):
   - Block in `templates/claude-md-section.md`, fenced by `<!-- harness:begin -->` /
     `<!-- harness:end -->`. Missing file → create with just the block. Markers present →
     leave untouched, never duplicate. Exists without markers → append; if existing content
     contradicts it (e.g. "never use hooks/subagents"), do NOT append — surface the conflict.
   - **If you embedded** (step 1), rewrite the Workflow `scriptPath` in the block to
     `.claude/harness/engine/pipeline.js` and `codex_adapter_path` to
     `.claude/harness/engine/codex-exec-adapter.mjs` (the gate's engagement regex still
     matches the `harness/engine/pipeline.js` substring).

5. **Report** — from `install.mjs`'s JSON plus the convention/CLAUDE.md steps: list created /
   kept / needs-user-input. Remind: the gate only blocks `Write|Edit|MultiEdit|NotebookEdit`
   on the listed patterns and is fail-open. If embedding was declined and the plugin is
   absent, flag the engine gap; if accepted, list what was embedded and the dynamic-`skills[]`
   boundary.

## Updating after a plugin version bump

`install.mjs` is **non-destructive by default** — a plain re-run reports every existing file
as `kept` and changes nothing, so it will NOT pull a newer engine/hook on its own. The files
split into two classes:
- **plugin-owned copies** (verbatim of a plugin file): `.claude/hooks/goal-gate.mjs` and, if
  embedded, `.claude/harness/**` (engine, Codex adapter/runner, meta-skeleton, goal-spec, static skills). These
  drift from the plugin on a version bump.
- **user-owned** (the project evolves them): `harness-gate.json`, `conventions/**`, the
  CLAUDE.md block, `settings.json`.

To update: bump the plugin (marketplace), then re-run `install.mjs` with **`"refresh": true`**
and the same `embed` config. It re-copies only the plugin-owned files (reported `refreshed`
or `unchanged`) and never touches user-owned files even with refresh on. Then `git diff` the
plugin-owned copies and commit. In **plugin mode** (no embedding) the only drift-prone file is
`goal-gate.mjs`; in **embedded mode** it also refreshes `.claude/harness/**`.

## What Claude does
- Proposes gate patterns, asks about embedding + resolves skill sources, runs `install.mjs`
  for every deterministic file op, then does conventions + the CLAUDE.md block (judgment), and
  reports honestly from the script's JSON (incl. the plugin-engine gap / dynamic-skill boundary).

## What you do
- Confirm the gate patterns and the embedding choice. Commit `.claude/settings.json`,
  `.claude/hooks/goal-gate.mjs`, any `.claude/harness/` copies, and the conventions so the
  gate applies team-wide. Fill remaining placeholders. Own the copies afterward — after a
  plugin version bump, re-run with `"refresh": true` to pull the newer plugin-owned files
  (see "Updating after a plugin version bump"); your gate/conventions/CLAUDE.md stay put.

## Related
- `install.mjs` — deterministic file ops (gate/hook/embed/gitignore) this skill invokes
- `harness` skill — running the six-stage engine
- `hooks/README.md` — gate semantics and accepted holes
