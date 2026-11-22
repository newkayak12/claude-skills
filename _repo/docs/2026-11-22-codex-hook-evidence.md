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

## Plugin MCP servers: `${PLUGIN_ROOT}` is not expanded

Codex passes MCP `args` literally: a logging `node` first on `PATH` saw
`argv=[--no-warnings ${PLUGIN_ROOT}/servers/knowledge-mcp.mjs]`, cwd the session folder, no
`PLUGIN_ROOT` in env → `MODULE_NOT_FOUND`. teams and graph-engineering were UNAVAILABLE the same way.
The docs (developers.openai.com plugins build page) document `${PLUGIN_ROOT}` for hooks only.

What works: a relative script path plus `"cwd": "."`, which Codex resolves against the plugin root.
The server then runs in the plugin folder, and Codex gives it the session folder neither as env nor as
MCP roots (the client's initialize declares no `roots`); only each `tools/call` carries it, in
`params._meta["x-codex-turn-metadata"].workspaces` (keys are folder paths).

- knowledge: `knowledge-mcp.mjs` uses that per-call workspace unless `--root` or `CLAUDE_PROJECT_DIR`
  fixes the root (test red before the fix). Live: `knowledge_status` reports `<session>/knowledge-system`.
- teams: relative path + `cwd`; live `tm_status` answers. Its wiki root is still `process.cwd()` (card).
- aws, database (no Codex manifest before): live, all 5 servers list their tools.
- graph: same defect; graph is frozen, so not changed (card).

## teams `apply_patch` under real Codex

Fixture with `.claude/teams-dispatch.json` `{"paths":["src/**"],"min_chars":10}`, teams hooks trusted via `/hooks`:

- Deny: `apply_patch` adding `src/app.js` → `hook: PreToolUse Blocked`, "teams: src/app.js is under
  dispatch control, and no task is open for this project."; `src/` stays empty.
- Allow + record: with `TEAMS_OWN_WRITES`/`TEAMS_OWN_RUN` set, `apply_patch` adding `docs/notes.txt` →
  `PostToolUse Completed`, and the writes file holds `{"run_id":"t1","node_id":"S","path":"docs/notes.txt"}`.
