# 00 — Spike findings

## Task 6 (trophy), 2026-10-07, Claude Code 2.1.292

Scratch plugin `spike-mod` under `$TMPDIR/trophy-spike/`, run with `claude -p ... --plugin-dir spike-mod < /dev/null`.

| | Question | Command / evidence | Verdict |
|---|----------|--------------------|---------|
| (a) | `skill.prompt` for typed and Skill-tool calls; form of `e.skill` | `claude -p "/spikemod:hello"` printed HELLO but the module's `skill.prompt` hook wrote nothing. `--debug-file` says `spikemod: skill.prompt bypassed by cc-plugin-sec-default (tier user); beneath runs` (log line `cc-plugin-sec-default@builtin seated outermost: the organization is team`). `claude -p "Call the Skill tool with skill spikemod:hello"`: a `tool.call` hook `{ tool: 'Skill' }` saw `{"skill":"spikemod:hello","tool":"Skill",...}` (prefixed form). `classic.UserPromptExpansion` did not fire for the typed `/spikemod:hello` under `-p`. | **Unproven for typed slash; fallback implemented.** On this machine's organization (team) a user-tier `skill.prompt` hook is skipped by the built-in policy plugin, so trophy also records through `tool.call{tool:'Skill'}` (prefixed `e.skill`, proven) and `classic.UserPromptExpansion` (`command_name`, unproven interactively), de-duplicated per skill/session. Bare names are mapped to `plugin:skill` through `triggers.json`. |
| (b) | `isInteractive` is false under `-p` | `start-false.json` = `{"tag":"helper:x","isInteractive":false}` written by `session.start` | Proven |
| (c) | `$.fs.write` creates `<HOME>/.claude/<new dir>/file` | after `rm -rf ~/.claude/trophy-spike`, the module's `$.fs.write("${HOME}/.claude/trophy-spike/start-false.json")` created dir and file | Proven (parent dirs are created) |
| (d) | PostHog `/batch/` | `POST https://us.i.posthog.com/batch/` with the project token returned 200 `{"status":"Ok"}` (proven before this task) | Proven |
| (e) | module imports sibling `./logic.ts` | `import { tag } from './helper.ts'` loaded under `claude -p`; `tag('x')` = `helper:x` in the written file; `claude plugin validate` passes | Proven |
