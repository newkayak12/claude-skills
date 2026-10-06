# 00 — Spike findings (2026-10-07)

Scratch plugin `spike-mod` (outside the repo, under `~/.claude/dev-mods/<session>/`): a
`hooks.json` with `"modules": ["./register.ts"]` plus a `PreToolUse` command hook on Write
(`echo.mjs` appends to `/tmp/spike-cmd.txt`). The module stores what it sees with `$.store`
(`~/.claude/plugins/store/spike-mod_inline-*.json`). Builds on disk: 2.1.284 … 2.1.292 (the
oldest is 2.1.284, not 2.1.289 as the plan assumed).

## 1. Command hooks and a module in one hooks.json — YES

`claude plugin validate spike-mod` → passes, lists both:
`hooks.PreToolUse: … node ${CLAUDE_PLUGIN_ROOT}/hooks/echo.mjs` (warns: quote the placeholder)
and `./register.ts hooks: session.start, tool.call{tool=Write}, command.run{name=spike-view}`.
It also warns `gating hook without .catch` for `tool.call`/`command.run` (shared rule 3).

2.1.292, `claude --plugin-dir spike-mod -p "<Write a file>"`: `/tmp/spike-cmd.txt` got
`cmd hook fired …` AND the store got `moduleSawWrite` → both fired on one Write.
Interactive: one Write → `moduleSawWrite` 23:07:01.487Z and `cmd hook fired` 23:07:01.586Z (module first), toast shown.

## 2. An older build ignores the `modules` key — YES (with one stderr line)

2.1.284, same plugin: `-p "say ok"` → stdout `ok`, exit 0; the Write prompt → file written,
command hook fired. It prints, on **stderr** only (stdout with `2>/dev/null` is just `ok`):

    spike-mod: hooks module not loaded: hooks modules are not turned on for installed plugins
    in this process (early access: set CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 …)

Verdict: README rule 1 holds; no separate `<plugin>-mod` plugin needed. Adapters that read
`claude -p` stdout are unaffected; anything that treats stderr as failure would see the line.

## 3. Headless detection — YES

`claude -p` on 2.1.292: `session.start` stored `surfaces: { n: 0, list: [] }`. So the
`surfaces().length > 0` guard (shared rule 2) turns the mod off in headless runs.
Interactive (hot-reloaded in a terminal session): `surfaces: { n: 1, list: ["terminal"] }`.

## 4. `$.process.run(['node', …])` from a module — YES

From `session.start` (headless, 2.1.292): `node <repo>/teams/scripts/view.mjs --once` →
`exit 0`, first line `tasks under ~/.harness/tasks:`, 221 ms (far under the 30 s default).

Path resolution: **`$.plugin.root`** works (stored the plugin's absolute folder).
`CLAUDE_PLUGIN_ROOT` is **unset** in a `$.process.run` child — don't rely on it.
So `02`'s `VIEW` = `` `${$.plugin.root}/scripts/view.mjs` `` (teams' own copy).
`import.meta.url` not tried (not needed).

## Open

None. `/spike-view` was not typed; §4 already proves `$.process.run` from the module.

## Plan changes

- README "Shared rules": nothing contradicted. Add: resolve plugin files with
  `$.plugin.root`; `CLAUDE_PLUGIN_ROOT` is not in `$.process.run`'s env.
- `02` Task 4: `VIEW` = `${$.plugin.root}/scripts/view.mjs`.
- Builds before 2.1.292 (or with modules off) print one stderr line per run per plugin.

## Task 6 (trophy), 2026-10-07, Claude Code 2.1.292

Scratch plugin `spike-mod` under `$TMPDIR/trophy-spike/`, run with `claude -p ... --plugin-dir spike-mod < /dev/null`.

| | Question | Command / evidence | Verdict |
|---|----------|--------------------|---------|
| (a) | `skill.prompt` for typed and Skill-tool calls; form of `e.skill` | `claude -p "/spikemod:hello"` printed HELLO but the module's `skill.prompt` hook wrote nothing. `--debug-file` says `spikemod: skill.prompt bypassed by cc-plugin-sec-default (tier user); beneath runs` (log line `cc-plugin-sec-default@builtin seated outermost: the organization is team`). `claude -p "Call the Skill tool with skill spikemod:hello"`: a `tool.call` hook `{ tool: 'Skill' }` saw `{"skill":"spikemod:hello","tool":"Skill",...}` (prefixed form). `classic.UserPromptExpansion` did not fire for the typed `/spikemod:hello` under `-p`. | **Unproven for typed slash; fallback implemented.** On this machine's organization (team) a user-tier `skill.prompt` hook is skipped by the built-in policy plugin, so trophy also records through `tool.call{tool:'Skill'}` (prefixed `e.skill`, proven) and `classic.UserPromptExpansion` (`command_name`, unproven interactively), de-duplicated per skill/session. Bare names are mapped to `plugin:skill` through `triggers.json`. |
| (b) | `isInteractive` is false under `-p` | `start-false.json` = `{"tag":"helper:x","isInteractive":false}` written by `session.start` | Proven |
| (c) | `$.fs.write` creates `<HOME>/.claude/<new dir>/file` | after `rm -rf ~/.claude/trophy-spike`, the module's `$.fs.write("${HOME}/.claude/trophy-spike/start-false.json")` created dir and file | Proven (parent dirs are created) |
| (d) | PostHog `/batch/` | `POST https://us.i.posthog.com/batch/` with the project token returned 200 `{"status":"Ok"}` (proven before this task) | Proven |
| (e) | module imports sibling `./logic.ts` | `import { tag } from './helper.ts'` loaded under `claude -p`; `tag('x')` = `helper:x` in the written file; `claude plugin validate` passes | Proven |

### Added during 04-trophy Task 9

| | Question | Evidence | Verdict |
|---|----------|----------|---------|
| (f) | a module can read which plugins' skills the session lists | `session.start` hook calling `$.session.usage({ breakdown: 'summary' })` under `claude -p`: `context.breakdown.skills.skillFrontmatter` had 128 entries, each with `name`, `source`, `pluginName` (e.g. `think`, `develop`) | Proven (non-interactive; same call is used at interactive start) |
| (g) | a module cannot import JSON | `claude plugin validate`: `"../data/x.json" ... is not named like code and was not loaded` | Proven; data files are `.ts` |
