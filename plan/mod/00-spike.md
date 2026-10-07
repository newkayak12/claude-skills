# 00 — Spike: prove what every mod here rests on

> Produced by write:plans (2026-10-06). Throwaway code; only the findings file is kept.

**Goal:** answer four yes/no questions with evidence before any plugin ships a `modules` line.
**Architecture:** one scratch plugin `spike-mod` outside the repo
(`~/.claude/dev-mods/<session>/spike-mod/` or a scratch dir loaded with `--plugin-dir`), plus
a copy of `teams/hooks/hooks.json` with a `modules` line added.
**Output:** `plan/mod/00-spike-findings.md` — each question, the command run, what it printed,
the verdict.

---

### Task 1: A plugin can carry command hooks and a module in one hooks.json
**Files:** scratch `spike-mod/.claude-plugin/plugin.json`, `spike-mod/hooks/hooks.json`,
`spike-mod/hooks/register.ts`, `spike-mod/hooks/echo.mjs`.
**Pass bar:** `claude plugin validate spike-mod` reports the module's hooks AND the command
hook; in a `--plugin-dir spike-mod` session one Write fires both (the command hook writes
`/tmp/spike-cmd.txt`, the module shows a toast).

- [ ] 1: write `hooks.json` = `{ "modules": ["./register.ts"], "hooks": { "PreToolUse": [{ "matcher": "Write", "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/hooks/echo.mjs" }] }] } }`
- [ ] 2: `register.ts`: `on('tool.call', { tool: 'Write' }, async ($, e, next) => { $.ui.toast('module saw Write'); return next(e) })`
- [ ] 3: `claude plugin validate` → record output
- [ ] 4: run one Write in a `--plugin-dir` session → both effects observed, recorded

### Task 2: An older Claude Code ignores the `modules` key
**Files:** none new; uses Task 1's plugin.
**Pass bar:** on the oldest build still in `~/.local/share/claude/versions/` (2.1.289 today),
`claude --plugin-dir spike-mod -p "say ok"` exits 0, prints `ok`, and the command hook still
fires on a Write. If it errors, record the message — then every mod must live in a separate
`<plugin>-mod` plugin instead (README rule 1 changes).

- [ ] 1: run with the old binary by path → record stdout/stderr/exit
- [ ] 2: same with a Write prompt → `/tmp/spike-cmd.txt` exists

### Task 3: Headless detection
**Files:** `spike-mod/hooks/register.ts`.
**Pass bar:** `session.start` writes `(await $.session.surfaces()).length` to
`$.store` key `surfaces`; interactive session records ≥ 1, `claude -p` records 0 (read back
with a second interactive session or `claude plugin test`).

- [ ] 1: add the hook → 2: run both modes → 3: record both values

### Task 4: `$.process.run(['node', ...])` works from an installed plugin's module
**Files:** `spike-mod/hooks/register.ts`.
**Pass bar:** a `/spike-view` command answers `{ text }` with the first line of
`node <repo>/teams/scripts/view.mjs --once` and its `exitCode` 0, within the 30 s default
timeout, with `CLAUDE_PLUGIN_ROOT`-relative path resolution recorded (how the module finds its
own plugin folder: env var, `import.meta.url`, or `$` API — record which works).

- [ ] 1: register the command → 2: run it → 3: record output and the path method that worked

### Task 5: Write the findings
**Files:** create `plan/mod/00-spike-findings.md`.
**Pass bar:** four sections, each with command, output excerpt, verdict; README.md "Shared
rules" updated if Task 2 or 3 contradicts them.

- [ ] 1: write → 2: re-read `02-*.md` and `03-*.md` and fix any step that relied on a disproved assumption

---

### Task 6: trophy facts (added by 04-trophy.md)
**Files:** scratch `spike-mod` (outside the repo); findings in `00-spike-findings.md` "Task 6".
**Pass bar:** a "Task 6" section answering each, with the command and output:
(a) `skill.prompt` fires for a typed `/think:brainstorming` and for a model Skill-tool call, and the exact `e.skill` value in each;
(b) `session.start` `isInteractive` is `false` under `claude -p`;
(c) `$.fs.write` can create `<HOME>/.claude/trophy/profile.json` (HOME via `$.env.get`);
(d) `$.http.fetch('https://us.i.posthog.com/batch/', { method: 'POST', ... })` returns 200;
(e) a module can `import` a sibling `./logic.ts`.

- [ ] 1: append → 2: run in scratch → 3: record → 4: commit
