# Mod guard pack and denial log (plugin `session`, Bundle B) — design

Status: design only, awaiting approval (CLAUDE.md "Design Changes": plan, setgoal, critique, approve, then implement).
Governing docs: `plan/mod/README.md` (shared rules 1-6), `plan/mod/01-gate-heredoc-fix.md` (Bash false-positive lessons), `mods/KOR.md`.

## Context

`mods` holds repo-specific guards for claude-skills (running-script, worktree, push/bump confirm, model guard). Brainstorming with the
user chose a new standalone plugin `session` usable in any repo by any Claude Code user. Bundle A (session pane) is designed
separately; Bundle B is (3) a dangerous-command guard pack and (4) a denial log pane. API checked against the 2.1.293 types.

## Problem

A user running Claude Code in any repo has no cheap, low-noise safety net against a few irreversible commands, and no place to see
what was blocked and why.

## Design

### Components (all in one hooks module, state in `$.state`, history in `$.store`)

1. **Guard hooks.** One `tool.call` hook on Bash and one on Write/Edit. Each classifies the call into a rule id and an action.
2. **Verdict observer.** A `tool.check` hook that only calls `next(e)`, and records a deny verdict (reason, native rule) into the log.
   It never changes the verdict, except the mod-allowlist step below.
3. **Mod allowlist.** A list of exact call shapes (tool + normalized command prefix or path) the person has approved. The observer
   turns the engine's `ask` into `allow` for these. It never turns a `deny` into anything.
4. **Denial log.** Ring buffer in `$.store` (cap about 200, survives sessions), mirrored to a `$.state` atom for drawing.
5. **Pane + `/session-denials` command.** Lists entries newest first: time, tool, short call text, reason, source (guard pack / native
   rule / person declined). Per entry buttons: Allow once more (adds to the mod allowlist), Copy rule (shows the native rule text).
6. **Status line + toast.** Status line shows the denial count of this session; a toast fires on each guard deny (interactive only).
7. **userConfig.** `guard_mode` (`confirm` default, `deny`, `off`), `guard_extra_protected_branches`, `guard_secret_paths`
   (extra), `log_enabled`. Rows live in `/config`; the mod reads them through `options` and never writes them.

### Rule set (described, not spelled)

| Rule id | Triggers on | Default action |
|---|---|---|
| recursive-delete | `rm` with recursive+force on a target that is root, home, the repo root, a parent of cwd, or a glob at those levels. Ordinary `rm -rf build/` or `node_modules` is NOT matched | confirm |
| force-push-protected | `git push` with a force flag (incl. force-with-lease) whose target branch is main/master/trunk/default or a configured protected branch; a bare force push counts when the current branch is protected | confirm |
| hard-reset | `git reset --hard` (to anything), and `git clean` with force plus directories | confirm |
| secret-write | Write/Edit whose path is a dotenv file (not `.env.example/.sample/.template`), a private key or keystore file, a credentials/token file under known dot-directories; or whose content contains a private-key block or a known-shape token | confirm |
| running-script | Edit/Write to a `.sh/.bash` file a live process is reading (moved from `mods`, generalized) | deny (cheap, no ambiguity) |
| worktree-dirty-remove | `git worktree remove` with force on a worktree that has uncommitted changes (moved from `mods`) | deny |

Parsing rules (lessons of plan 01): classify only the executable positions of the command (split on `;`, `&&`, `||`, pipes, `$(...)`);
never scan heredoc bodies or quoted arguments of read-only commands (`grep`, `echo`, `git commit -m/-F`); a heredoc is code only when it
feeds a shell or interpreter. Unparseable or ambiguous commands pass (fail open), because a guard that blocks work gets uninstalled.

### Decision flow

```
tool.call (guard) -> no rule match            -> next(e)           (native permission flow unchanged)
                  -> match, guard_mode=off    -> next(e)
                  -> match, deny-class rule   -> {deny: reason + how to proceed}   (log, toast, status)
                  -> match, confirm-class:
                       interactive surface    -> $.ui.ask(Run / Cancel); Run -> next(e); else {deny} + log "person declined"
                       headless (-p)          -> {deny: reason}      (nobody to ask; safe default)
```

- **Why ask in `tool.call`, not return `ask` from `tool.check`:** `tool.check`'s `ask` is settled by the session mode (auto
  classifier, headless host, bypass). Under bypass it is likely auto-allowed, which would silently void the guard. The in-hook
  `$.ui.ask` shows regardless of mode, so the guard works in default, acceptEdits, plan and bypassPermissions alike.
  (To verify in the spike.)
- **bypassPermissions:** `tool.call` hooks run before the mode, so denies and confirms still apply. Intended: bypass means "no native
  prompts", not "no safety net". `guard_mode=off` is the escape hatch; the README states this plainly.
- **Headless:** `$.ui.ask` rejects under `-p`. Confirm-class rules become deny with a reason naming the config key to change.
  Agent runs (teams/harness adapters) therefore never hang, and never delete or force-push silently.
- **Subagents:** the hook sees calls from every loop (`agentId`), same rules; the log records the agent id.
- **Allowlist hit:** a call matching a mod-allowlist entry skips the confirm (not deny-class rules).

### Data flow for the denial log

1. Sources: (a) the guard hooks (reason known); (b) `tool.check` verdict `deny` from native rules/modes/other hooks (reason, `rule`
   known); (c) person declined a guard confirm. A native permission dialog the person answers "No" shows as an `ask` verdict, not a
   deny, so it is NOT observable (see blockers); only (a)-(c) are logged.
2. Entry = id, timestamp, tool, redacted call text (secret values and token-shaped strings masked before storing; content of
   Write/Edit never stored, only the path), reason, source, native rule if any, agent id.
3. Append to `$.state` atom (pane redraws) and `$.store` (persist, capped). `session.start` hydrates the atom from `$.store`.
4. Pane Allow button: appends a normalized shape to the mod allowlist in `$.store`, then toasts "allowed for <shape>; native settings
   unchanged". Copy rule button: shows the suggested native rule string (`Bash(prefix:*)`) with the instruction to add it via
   `/permissions`.

### Error handling

- Every guard registration has `.catch` that fails OPEN (shared rule 3) for confirm-class rules; the two deny-class rules also fail open
  (their loss is low-impact). A broken module must never block a session.
- `pgrep`/`git` helper failures pass. `$.store` write failure drops the log entry, never the guard decision.
- Pane/toast/status code runs only when `$.session.surfaces()` is non-empty (shared rule 2).

## Feasibility and native overlap

| Wish | API verdict |
|---|---|
| Block/ask before a call, any mode | Yes: `tool.call` deny and `$.ui.ask`. |
| Add a rule to the native allowlist (settings `permissions.allow`) | **No.** `$.settings.read` is read-only; `$.config.set` only edits `/config` rows incl. the mod's own `userConfig`. No settings writer. The mod keeps its OWN allowlist and shows the native rule text for the person to add via `/permissions`. |
| Log native permission denials | Partly: `tool.check` shows deny verdicts with `reason` and `rule`. A person's "No" in the native dialog is not reported. |
| Ask in headless | No (`$.ui.ask` rejects); fall back to deny. |
| `ask` verdict honored under bypass | Unverified; avoided by design. |

Overlap with native: `/permissions` already lists rules (not denials) and edits them; native `deny` rules can express `Bash(rm -rf:*)` but
cannot do semantics (target is home vs `build/`), content scanning, or an interactive confirm. The pack is the semantic layer; the log
pane is new (native has no denial history). The mod allowlist deliberately does NOT replace `/permissions`.

## What moves out of `mods`

| `mods` item | Fate |
|---|---|
| Running-script guard | moves to `session` (general), deleted from `mods` |
| Worktree remove guard | moves to `session` (general), deleted from `mods` |
| Push/bump confirm (any push, `patch-*.mjs`) | stays in `mods` (claude-skills rules); the general case (force push to protected) is new in `session` |
| Agent model guard, skill toast, harness band, fetch reminder, README/KOR toast, `claude -p` count | stay in `mods` |

If both plugins are installed during the transition, the duplicate guard would ask twice: `mods` bump removes its two guards in the same
release (shared rule 5: bump version, README + KOR both).

## Testing (`claude plugin test`)

- Positive corpus, one per rule, in both phrasing styles (flags split/combined, `-C dir`, `&&` chains, `sudo` prefix).
- **False-positive corpus (must pass untouched):** `rm -rf node_modules build dist .next target`; `rm -rf ./tmp/x`; `git push` (non-force),
  `git push --force` on a feature branch, `git push origin feature:feature`; `git reset --soft/--mixed`; `git reset --hard` inside a heredoc
  body or `echo`/`grep`/`git commit -m` argument; `cat > notes.md <<'EOF'` with a body mentioning `.env`; Write to `.env.example`;
  Edit to `docs/env.md`; Read of `.env` (reads are out of scope); a markdown doc containing a private-key header in prose in a
  fenced example (decision pending, see open questions); `grep -r "rm -rf" .`; `ps`/`pgrep` mentioning a script path.
- Mode matrix: default, bypassPermissions, and no-surface (headless) for each confirm rule; allowlist hit; `guard_mode` off/deny.
- Log: entry redaction (no token text, no write content), cap eviction, hydrate after reload, pane lists newest first.
- `claude plugin validate` and `tsc -p` clean; module loads with the guards' `.catch` present.

## Done-criteria

1. Every positive-corpus case is stopped (confirm or deny) in default and bypass modes; headless gives a deny with a reason.
2. Zero hits on the false-positive corpus; unparseable input passes.
3. Denial pane shows guard denials and native `deny` verdicts with reason; entries contain no secret text.
4. No call writes any settings file; allowlist lives in `$.store` only.
5. `mods` no longer contains the two moved guards; both READMEs/KORs and versions updated together.
6. Spike results recorded for: `$.ui.ask` under bypass, `tool.check` `ask` under bypass, `tool.check` firing in headless.

## Critique

- **False positives (the key risk).** Mitigations: executable-position parsing, explicit safe-target list, fail open, a per-rule
  `guard_mode`, an allowlist for repeated approvals, and a corpus that gates release. Residual: `rm -rf "$VAR/"` with an unknown
  variable cannot be resolved; treated as match only if the literal target is dangerous, otherwise passes.
- **False negatives accepted.** `python -c`, `find -delete`, `dd`, aliases and scripts calling `rm` are not covered; this is a net for
  common slips, not a sandbox. The README must say so, or users will over-trust it.
- **Native overlap.** `permissions.deny` covers fixed prefixes; users who already have those rules get no benefit, only the log. The
  value is semantics plus the confirm. If the spike shows native `ask` rules suffice for rm and reset, drop those two rules (YAGNI).
- **Allowlist drift.** A mod-private allowlist is invisible to `/permissions` and can surprise users. Mitigated by showing it in the
  pane with per-entry remove; still a second source of truth. Alternative: no allowlist, only Copy rule (simpler, less magical).
- **YAGNI.** Cut candidates if scope must shrink: userConfig extras (protected branches, secret paths), status line, Allow button
  (keep Copy rule). Keep guards + log + redaction.
- **Secret-content scanning** adds regex-like heuristics and a false-positive surface (docs, test fixtures); path rules alone catch most.

## Open questions

1. Confirm vs deny default for headless runs launched by teams/harness: deny is safe but may stall an agent; acceptable?
2. Content scanning for secrets: ship in v1 (more coverage, more false positives) or paths only?
3. Keep the mod allowlist, or ship only "Copy rule" because the mod cannot write settings?
4. Should the guard apply to subagent loops by default, or only the main loop?
5. Is the log in `$.store` (cross-session, per user) acceptable privacy-wise, or session-only?
6. Plugin name `session` shared with Bundle A: one module or two modules in one plugin (guard lifecycle independent of the pane)?

## Decisions (2026-10-08, approved in brainstorming)

- Ships as a module inside the `session` plugin.
- v1 has `Copy rule` only; the mod-private allowlist (`Allow`) is deferred.
- v1 secret detection is path-only (`.env*`, key files); content scanning is deferred.
- Headless: confirm-class rules deny with a reason, as designed.
- `$.ui.ask` under bypass-permissions is verified in the shared Task 0 spike before any rule ships.
- Build order: 3rd of four.
