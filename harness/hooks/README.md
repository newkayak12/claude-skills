# harness hooks — opt-in PreToolUse gate

Denies `Write|Edit|MultiEdit|NotebookEdit` on gated paths unless the harness has been
engaged in the session (or a recent subagent marker exists). **Opt-in per project**: the
gate does nothing until the project creates `.claude/harness-gate.json`:

```json
{ "patterns": ["src/.*\\.kt$"], "window_hours": 2 }
```

- `patterns` — JS regexes matched against the `/`-normalized `file_path`.
- `window_hours` — parallel-subagent marker window (default 2).

Design rules (from v0's failed hook experiments): PreToolUse only, fail-open on every
error/ambiguity, deny only edit tools on opted-in paths, deny message teaches recovery.
Known accepted holes (this is a nudge, not security): transcript-regex engagement is
sticky per session and spoofable by mention; any session's marker within the window
passes all sessions; `Bash` file edits bypass the gate. Markers live in
`.claude/.harness-markers/` — add it to the project's `.gitignore`.
