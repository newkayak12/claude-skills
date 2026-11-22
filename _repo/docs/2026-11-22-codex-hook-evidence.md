# Codex hook failures: evidence (card 172)

2026-11-22 · codex-cli 0.170.0 · follows [the handoff](2026-11-21-codex-hook-handoff.md).
Every run used a disposable `CODEX_HOME` in the session scratchpad (auth copied, the real `~/.codex` untouched),
`codex exec --dangerously-bypass-approvals-and-sandbox`, in a throwaway fixture.

## "hook exited with code 127": cause confirmed

Owner: the Claude-only trophy SessionStart hook, shipped to Codex by every plugin without a Codex
overlay (agents, cognition, completion, develop, planning, portfolio, skill, write, knowledge; enabled in
the user's Codex: agents, completion, develop).

```json
{ "type": "command", "command": "sh", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/ensure-trophy.sh"] }
```

Codex drops `args`. It runs bare `sh` and writes the hook JSON to its stdin, so `sh` reads the JSON as a
script: `{"session_id":…}: not found`, exit 127. Captured with a logging `sh` first on `PATH`, develop
2.2.0 installed from `HEAD` (before the overlays):

```text
hook: SessionStart
hook: SessionStart Failed
argc=0 argv=[]
stdin={"session_id":"01a201f3-…","transcript_path":"…/sessions/2026/…
rc=127
```

A wrong path would give exit 2 (`sh: cannot open`), not 127.

## "plugin contents changed; hook approval required": attribution inferred

Codex keys a plugin hook's trust by `<plugin>:<hooks file>:<event>:<i>:<j>` with `trusted_hash` and, for
plugins, `trusted_content_hash`. The user's `~/.codex/config.toml` holds entries for
`agents`, `completion` and `develop` `…:hooks/hooks.json:session_start:0:0`; `agents` and `develop` carry a
`trusted_content_hash`. A cache refresh that changes plugin content asks again. Which two plugins prompted
is **unknown** (no client log records it); agents and develop are the likely pair. With the overlays the
trophy hook is gone from Codex, so these three entries no longer apply.

## After the fix

develop, agents, completion and knowledge installed from the working tree:

- `/hooks`: SessionStart installed 0; PostToolUse 1 (knowledge, "New hook - review required"), trusted
  through the TUI's own review.
- TUI session: `apply_patch` appended a line to `knowledge-system/notes/a.md`; the hook wrote
  `_knowledge/reports/delta-checks.jsonl` (`"file":"notes/a.md"`, `missing_frontmatter:["sources"]`).
- Fresh `codex exec`, same bytes: no review prompt, `hook: PostToolUse Completed`, a second delta line.

## Not done here

- teams `apply_patch` allow/deny under real Codex (F3-US-1): not run.
- `knowledge-local` MCP fails to start in Codex ("initialize response: connection closed"), while the
  server answers `initialize` when run by hand: separate card.
