---
name: install
description: >-
  Use when setting up the harness in a target project — scaffolds the opt-in gate,
  default conventions, and an ambient CLAUDE.md section so harness governance applies
  deterministically per project. Triggers on: "하네스 설치해줘", "이 프로젝트에 하네스
  적용해줘", "harness install", "set up the harness here", "게이트 켜줘", "convention
  스캐폴딩해줘". Idempotent: never overwrites existing project files. Not for running
  the engine itself (use the harness skill / Workflow).
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

Run all steps from the target project root. Every step is **idempotent and
non-destructive** — existing files are never overwritten.

1. **Gate — `.claude/harness-gate.json`**
   - Exists → leave untouched; report its current `patterns` to the user.
   - Missing → inspect the project (languages, source roots) and propose patterns
     (e.g. Kotlin: `"src/.*\\.kt$"`, TS: `"src/.*\\.tsx?$"`). Confirm with the user,
     then copy `templates/harness-gate.json` with the confirmed patterns.
2. **Hook — `.claude/hooks/goal-gate.mjs` + `.claude/settings.json`** (project-owned, committed)
   Makes the gate enforce **without depending on the plugin being installed**.
   - **Script:** copy the plugin's `hooks/goal-gate.mjs` to `.claude/hooks/goal-gate.mjs`
     **only if missing** (it is self-contained — node builtins only). Existing copy →
     leave untouched; report its presence (may have drifted from the plugin version).
   - **Registration — merge into `.claude/settings.json`** (committed, so the whole team
     gets it; never `settings.local.json` here):
     - Missing → create it with the block from `templates/settings-hook.json`.
     - Exists → parse it. If any `hooks.PreToolUse[*].hooks[*].command` already contains
       `goal-gate.mjs`, leave untouched (report "already registered"). Otherwise **append**
       the harness entry to `hooks.PreToolUse` (creating the `hooks`/`PreToolUse` keys if
       absent) — never overwrite existing hooks. On any JSON parse error, do NOT rewrite
       the file: surface it and let the user merge by hand.
   - The command is `node "$CLAUDE_PROJECT_DIR/.claude/hooks/goal-gate.mjs"`; matcher is
     `Write|Edit|MultiEdit|NotebookEdit|Task|Agent` (edit tools are denied when unengaged;
     Task/Agent only refresh parallel-subagent markers).
   - **Note the gap:** the hook denies gated edits and tells the user to engage the
     harness, but the engine (`engine/pipeline.js`) and `harness` skill still live in the
     plugin. If the plugin is absent, the gate blocks with no local way to satisfy it —
     say so in the report.
   - **Double-fire is harmless:** if the plugin's own hook is also active, the gate runs
     twice with identical fail-open/deny behavior; do not try to suppress the plugin one.
3. **Standalone embedding — ASK the user first (optional, off by default)**
   The hook from step 2 is self-contained, but the **engine and the skills it invokes still
   live in the plugin**. For plugin-less environments (air-gapped, CI, a machine that never
   installs the marketplace plugin), ask the user:
   > "이 프로젝트를 플러그인 없이도 하네스가 돌게 만들까요? 엔진·참조 스킬을 `.claude/harness/`로
   > 임베드합니다 (용량↑, 이후 drift 관리 필요)."
   - **No / plugin is present** → skip. The project keeps the step 2 gap (gate blocks, engine
     lives in the plugin). This is the default.
   - **Yes** → copy into project-owned `.claude/harness/` (**only files that are missing**):
     - runtime: `engine/pipeline.js`, `templates/meta-skeleton.js`, `goal-spec.md`
     - the skills the engine **statically** mounts — copy each skill's whole directory:
       `think:devils-advocate` (critic + both judges) and
       `completion:verification-before-completion` (tester)
     - then rewrite the Workflow `scriptPath` in the CLAUDE.md block (step 5) to the embedded
       `.claude/harness/engine/pipeline.js`. Engagement detection still works: the gate's regex
       matches the `harness/engine/pipeline.js` substring in either path.
   - **Hard caveat — say it out loud:** subgoal `skills[]` are chosen **dynamically by SetGoal
     from the entire repo catalogue** (`develop:*`, `pm:*`, `write:*`, …) and cannot be
     enumerated ahead of time. Embedding only guarantees the two static skills above; any
     dynamically-picked skill outside what you embedded will fall back to "Read its SKILL.md"
     and simply be absent in a plugin-less environment. Also `mountMcp` tools
     (sequential-thinking, think-tool, mcp-reasoner) are external and cannot be embedded.
     Offer to also copy a broader skill set the project expects to use, and **list exactly what
     you embedded** so the user knows the boundary.
   - Idempotent: never overwrite an existing embedded file; report which were copied vs. kept.
4. **Conventions — `.claude/conventions/`**
   - Copy each of `templates/conventions/{coding,verification,boundaries}.md` **only if
     that filename is missing**. Existing convention files are kept as-is (even if they
     cover the same topic under a different name — do not dedupe for the user).
   - **Optional rulesets** (`templates/conventions/optional/`): copy only when the
     project matches the trigger stated at the top of each file — `security.md`
     (auth/PII/tokens/secrets), `data.md` (DB schema/migrations/retention),
     `operations.md` (release/SLO/observability). Ask the user when unsure; skip
     silently when clearly irrelevant.
   - Fill the `<!-- fill -->` placeholders you can derive from the project (build/test
     commands, source layout); leave the rest for the user and say which ones remain.
5. **CLAUDE.md — ambient instruction**
   - The block in `templates/claude-md-section.md` is fenced by
     `<!-- harness:begin -->` / `<!-- harness:end -->` markers.
   - CLAUDE.md missing → create it with just this block.
   - Markers already present → leave that block untouched (report the installed
     version); never duplicate it.
   - CLAUDE.md exists without markers → append the block at the end. If existing
     content contradicts it (e.g. "never use hooks/subagents"), do NOT append — surface
     the conflict and let the user decide.
6. **`.gitignore`** — append `.claude/.harness-markers/` if the line is absent
   (create `.gitignore` if missing).
7. **Report** — list created / skipped-existing / needs-user-input items, and remind:
   the gate only blocks `Write|Edit|MultiEdit|NotebookEdit` on the listed patterns and
   is fail-open by design. If the user declined standalone embedding (step 3) and the plugin
   is not installed, flag the engine gap (gate blocks, but nothing local satisfies it); if
   they accepted, list exactly which runtime files + skills were embedded and the dynamic
   `skills[]` boundary from step 3.

## What Claude does
- Detects project shape, proposes gate patterns, copies the self-contained hook +
  registers it in `.claude/settings.json` (merge, never overwrite), **asks whether to embed
  the engine + static skills for plugin-less operation** (step 3), copies missing
  convention templates, fills derivable placeholders, appends the fenced CLAUDE.md block,
  reports honestly (including the plugin-engine gap and the dynamic-skill boundary).

## What you do
- Confirm the gate patterns. Commit `.claude/settings.json`, `.claude/hooks/goal-gate.mjs`,
  and the conventions so the gate applies team-wide. Fill remaining placeholders. Own and
  evolve the copied files — the plugin never touches them again (re-run install to pull a
  newer hook version, or diff `.claude/hooks/goal-gate.mjs` against the plugin yourself).

## Related
- `harness` skill — running the six-stage engine
- `hooks/README.md` — gate semantics and accepted holes
