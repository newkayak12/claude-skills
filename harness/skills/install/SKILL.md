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
2. **Conventions — `.claude/conventions/`**
   - Copy each of `templates/conventions/{coding,verification,boundaries}.md` **only if
     that filename is missing**. Existing convention files are kept as-is (even if they
     cover the same topic under a different name — do not dedupe for the user).
   - Fill the `<!-- fill -->` placeholders you can derive from the project (build/test
     commands, source layout); leave the rest for the user and say which ones remain.
3. **CLAUDE.md — ambient instruction**
   - The block in `templates/claude-md-section.md` is fenced by
     `<!-- harness:begin -->` / `<!-- harness:end -->` markers.
   - CLAUDE.md missing → create it with just this block.
   - Markers already present → leave that block untouched (report the installed
     version); never duplicate it.
   - CLAUDE.md exists without markers → append the block at the end. If existing
     content contradicts it (e.g. "never use hooks/subagents"), do NOT append — surface
     the conflict and let the user decide.
4. **`.gitignore`** — append `.claude/.harness-markers/` if the line is absent
   (create `.gitignore` if missing).
5. **Report** — list created / skipped-existing / needs-user-input items, and remind:
   the gate only blocks `Write|Edit|MultiEdit|NotebookEdit` on the listed patterns and
   is fail-open by design.

## What Claude does
- Detects project shape, proposes gate patterns, copies missing templates, fills
  derivable placeholders, appends the fenced CLAUDE.md block, reports honestly.

## What you do
- Confirm the gate patterns. Fill remaining placeholders. Own and evolve the copied
  conventions — the plugin never touches them again.

## Related
- `harness` skill — running the six-stage engine
- `hooks/README.md` — gate semantics and accepted holes
