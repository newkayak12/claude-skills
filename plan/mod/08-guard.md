# 08 — session: dangerous-command guard pack and denial log

> Produced by write:plans (2026-10-08) from `_repo/docs/plans/2026-10-08-mod-guard-design.md` (approved,
> incl. its "Decisions" section). Owner for execution routing: planning:executing-plans. Steps use
> checkbox (`- [ ]`) syntax. Design-change rule (CLAUDE.md) applies: this is the plan stage.

**Goal:** in any repo, a person running Claude Code is stopped (confirm or deny) before a few
irreversible commands and secret-file writes, and can see what was blocked and why.
**Architecture:** one module `session/hooks/guard.tsx`, listed in `session/hooks/hooks.json`
`modules` next to 07's pane module. Pure logic in `guard-logic.ts` (command classifier, path rules,
redaction, ring buffer); the module wires one Bash `tool.call` hook, one Write/Edit `tool.call`
hook, a `tool.check` observer, the denial pane and `/session-denials`. Confirm-class rules ask with
`$.ui.ask` inside `tool.call` (so bypass cannot void them); no surface -> deny with a reason.
**Tech stack:** hooks module API 2.1.293, `$.ui.ask`, `$.process.run`, `$.store`, `$.state`,
`claude plugin validate|test`, `tsc -p`. Testkit pattern from `diag/hooks/testkit.ts`
(memoryStore, sessionAt), extending 07's `session/hooks/testkit.ts` (never imported by the module).

---

## Decisions fixed (design "Decisions"; do not reopen)

- v1 has **Copy rule only**: no mod allowlist, no Allow button; the mod writes no settings file.
- v1 secret detection is **path-only** (`.env*` minus `.example/.sample/.template`, private key /
  keystore files, credentials/token files under known dot-dirs). No content scanning.
- Headless (`surfaces()` empty): confirm-class rules **deny with a reason** naming `guard_mode`.
- Deny-class: running-script, worktree-dirty-remove. Confirm-class: recursive-delete,
  force-push-protected, hard-reset, secret-write. `guard_mode`: `confirm` (default) | `deny` | `off`.
- Every hook ends `.catch(($, e, next) => next(e))`: a broken guard fails OPEN. Unparseable input passes.
- Parsing (plan 01 lessons): classify only executable positions (split on `;` `&&` `||` `|` `$(...)`);
  never scan heredoc bodies or quoted args of read-only commands (`grep`, `echo`, `git commit -m/-F`);
  a heredoc is code only when it feeds a shell/interpreter. Wrappers `sudo`, `env`, `git -C d` unwrap.
- Stays in `mods`: push/bump confirm, agent model guard, README/KOR toast. Moves: running-script,
  worktree guard (`mods/hooks/mod.tsx`, Tasks 6 then 10).
- Shared spike `plan/mod/05-spike-2.md` Task 3 (S3: `$.ui.ask` under bypass / default / headless)
  gates every confirm task. **Fallback if S3 = NO** (ask hidden or rejected under bypass): in the
  failing mode confirm-class rules deny with a reason (same path as headless); if it fails in default
  mode too, all four confirm rules ship as deny-class and the pack still works. Task 2 encodes the
  S3 answer in one function, `askOrDeny`, so the fallback is a one-place change.
- Native overlap check (design Critique): if 05-spike-2 shows native `ask` rules cover `rm`/`reset`,
  drop those two rule tasks (3 and 5 reduce to nothing) and say so in the findings.

## File structure

| Path | Owns |
|------|------|
| `session/hooks/guard.tsx` (new) | `register`: hooks, command, pane, status/toast, `.catch` on each |
| `session/hooks/guard-logic.ts` (new) | `splitCommands`, `classify`, `secretPath`, `redact`, `pushRing`, `Verdict` types |
| `session/hooks/guard-*.test.ts` (new) | per-task tests; `guard-fp.test.ts` is the release gate |
| `session/hooks/testkit.ts` (modify; created by 07 Task 1) | memoryStore, sessionAt, `ask` mock (Run / Cancel / reject) |
| `session/hooks/hooks.json` (modify) | append `./guard.tsx` to `modules` |
| `session/.claude-plugin/plugin.json` (modify) | `userConfig`: `guard_mode`, `guard_extra_protected_branches`, `guard_secret_paths`, `log_enabled` |
| `session/types/index.d.ts` (modify) | `PluginState['session'].guard = { denials: Denial[] }` |
| `mods/hooks/mod.tsx`, `mod.test.ts` (modify, Task 10) | remove the two moved guards |
| `session/README.md`, `KOR.md`, `mods/README.md`, `KOR.md` (modify, Task 11) | docs |

## Data shapes

```ts
type Verdict = { rule: string; action: 'confirm' | 'deny'; reason: string } | undefined
type Denial = { id: string; ts: number; tool: string; call: string /* redacted; Write/Edit = path only */;
  reason: string; source: 'guard' | 'native' | 'declined'; nativeRule?: string; agentId?: string }
// $.store 'session.denials': Denial[] (cap 200, newest last); $.state mirror for drawing
```

---

### Task 1: Guard module skeleton, parser, mode matrix harness
**Files:** create `guard.tsx`, `guard-logic.ts`, `guard-skeleton.test.ts`; modify `testkit.ts` (add the `ask` mock), `hooks.json`, `plugin.json`, `types/index.d.ts`.
**Interfaces:** `splitCommands(cmd) → { argv: string[] }[]` (executable positions only, heredoc and quoted-arg bodies excluded unless the heredoc feeds `sh|bash|zsh|python|node`); `classify(argv[], cwd, opts) → Verdict` returns `undefined` for now; `register` adds a Bash and a Write/Edit `tool.call` hook that call `classify` and always `next(e)`.
**Blocked by:** 07 skeleton task (plugin.json, hooks.json `modules`, types, tsconfig exist).
**Pass bar:** `claude plugin validate session` lists both `tool.call` hooks; `tsc -p session` clean; tests: splitter cases `a && rm -rf x; b | c $(d)` -> 4 argv lists, `cat <<'EOF' ... rm -rf / ... EOF` -> only `cat`, `bash <<'EOF' ... rm x ... EOF` -> includes the body's `rm`, unterminated quote -> `[]`; a throwing `classify` returns `next(e)`'s value.
- [ ] 1: tests (red) -> 2: implement -> 3: green -> 4: commit

### Task 2: Decision flow + first rule end to end — recursive-delete
**Files:** modify `guard.tsx`, `guard-logic.ts`; create `guard-rm.test.ts`.
**Interfaces:** `askOrDeny($, v, e)`: `guard_mode=off` -> `next(e)`; deny-class -> `{ deny: reason }`; confirm-class + surfaces -> `$.ui.ask('Run `<cmd, 120>`?', ['Run','Cancel'])` (rejection = Cancel); Run -> `next(e)`; else `{ deny: 'session: the person declined (<rule>).' }`; no surfaces or `guard_mode=deny` -> `{ deny: '<reason> Set guard_mode=off in /config to allow.' }`. Rule `recursive-delete`: `rm` with recursive+force (`-rf`, `-fr`, `-r -f`, `--recursive --force`, after `sudo`) whose target resolves to `/`, `~`, `$HOME`, the repo root, a parent of cwd, or a glob at those (`/*`, `~/*`).
**Blocked by:** Task 1; **05-spike-2 Task 3 (S3)** — apply the fallback above if NO.
**Pass bar:** positives (named `RM-1..`): `rm -rf /`, `rm -rf ~`, `rm -fr $HOME/`, `sudo rm -r -f ..`, `rm --recursive --force "$PWD/.."`, `cd x && rm -rf /*`. Matrix per positive: default and bypass -> ask shown, Run passes, Cancel denies; headless -> deny with the `guard_mode` hint and 0 asks; `guard_mode=deny` -> deny; `off` -> passes. Negatives live in Task 9's file but these three run here: `rm -rf node_modules build dist .next target`, `rm -rf ./tmp/x`, `grep -r "rm -rf" .` all pass.
- [ ] 1: tests (red) -> 2: implement -> 3: green -> 4: commit

### Task 3: force-push-protected
**Files:** modify `guard-logic.ts`; create `guard-push.test.ts`.
**Interfaces:** rule on `git push` with `-f`, `--force`, `--force-with-lease[=…]`, `+branch` refspec; protected = main, master, trunk, the remote default branch (`git symbolic-ref refs/remotes/origin/HEAD`, failure = ignore), plus `guard_extra_protected_branches`. A bare force push counts when `git branch --show-current` is protected. Handles `git -C dir`.
**Blocked by:** Task 2.
**Pass bar:** positives `FP-1..` (`git push -f origin main`, `git push --force-with-lease origin HEAD:master`, `git push origin +main`, bare `git push -f` on main, `git -C ../r push --force origin trunk`, extra branch `release` from config) stop in default+bypass and deny headless. Passes: `git push`, `git push origin feature:feature`, `git push --force origin feature`, bare `git push -f` on a feature branch; helper `git` failure passes.
- [ ] 1: tests (red) -> 2: implement -> 3: green -> 4: commit

### Task 4: hard-reset (+ git clean -fd)
**Files:** modify `guard-logic.ts`; create `guard-reset.test.ts`.
**Interfaces:** rule on `git reset --hard [any]` and `git clean` with force and directories (`-fd`, `-df`, `-f -d`, `-fdx`); `-n`/`--dry-run` passes.
**Blocked by:** Task 2.
**Pass bar:** positives `RS-1..` (`git reset --hard`, `git reset --hard HEAD~3`, `git -C x reset --hard origin/main && make`, `git clean -fdx`) stop in default+bypass, deny headless. Passes: `git reset --soft HEAD~1`, `--mixed`, `git reset HEAD file`, `git clean -n`, `git clean -f` (files only), `echo "git reset --hard"`, `git commit -m "reset --hard"`, a `cat <<'EOF'` body containing it.
- [ ] 1: tests (red) -> 2: implement -> 3: green -> 4: commit

### Task 5: secret-write (path-only)
**Files:** modify `guard.tsx`, `guard-logic.ts`; create `guard-secret.test.ts`.
**Interfaces:** `secretPath(path, extra[]) → boolean` for Write/Edit `file_path`: basename `.env`, `.env.*` except `.example|.sample|.template`; `*.pem|*.key|*.p12|*.pfx|*.jks|*.keystore|id_rsa|id_ed25519`; `credentials|token(s)(.json)?` under `.aws .ssh .gnupg .config/gcloud .kube .docker`; plus `guard_secret_paths` globs. Content is never read. Reads are out of scope (hook is Write/Edit only).
**Blocked by:** Task 2.
**Pass bar:** positives `SC-1..` (`.env`, `app/.env.production`, `~/.aws/credentials`, `deploy.pem`, `.ssh/id_ed25519`, extra glob `secrets/**`) stop in default+bypass, deny headless, and a Write whose content holds `-----BEGIN PRIVATE KEY-----` to `docs/x.md` PASSES (path-only). Passes: `.env.example`, `.env.sample`, `.env.template`, `docs/env.md`, `src/environment.ts`, `notes.md` Edit.
- [ ] 1: tests (red) -> 2: implement -> 3: green -> 4: commit

### Task 6: Moved guards (copy into session; mods untouched)
**Files:** modify `guard.tsx`, `guard-logic.ts`; create `guard-moved.test.ts`.
**Interfaces:** deny-class `running-script` (Edit/Write to `.sh|.bash` while `pgrep -f <path>` returns pids; generalized message without the `mods:` prefix) and `worktree-dirty-remove` (`git worktree remove` with `--force|-f`, target `git status --porcelain` non-empty; `-C` resolved against cwd). Port the behaviour and every case of `mods/hooks/mod.test.ts` `.sh guard` and `worktree guard` (pgrep hit/miss/throw, non-script, `-C` relative, status failure passes, no `--force` runs no status).
**Blocked by:** Task 2 (deny path only; needs no S3).
**Pass bar:** all ported cases green against session; deny reason names pid / dirty files and says how to proceed; deny holds under `guard_mode=confirm` and `deny`, passes under `off`. Until Task 10 both plugins deny the same call: acceptable only on this unreleased branch.
- [ ] 1: copy tests (red) -> 2: implement -> 3: green -> 4: commit

### Task 7: Denial log (ring buffer, redaction, observer)
**Files:** modify `guard.tsx`, `guard-logic.ts`, `types/index.d.ts`; create `guard-log.test.ts`.
**Interfaces:** `redact(call)` masks token-shaped strings (`ghp_`, `sk-`, `AKIA`, `xox`, `Bearer …`), `KEY=value` pairs and URL userinfo; Write/Edit records the path only. `pushRing(list, d, 200)`. Every guard deny/decline calls `record(source:'guard'|'declined')`; a `tool.check` hook that only `return next(e)` (never alters the verdict) records `deny` verdicts as `source:'native'` with `reason` and `rule`. `session.start` hydrates `$.state` from `$.store`; `log_enabled=false` records nothing. Store write failure drops the entry, never the decision. Observer in headless depends on 05-spike-2's "tool.check fires in headless" finding; if NO it runs interactive-only and the README says so.
**Blocked by:** Tasks 2, 6; 05-spike-2 (tool.check in headless).
**Pass bar:** a guard deny stores one entry (id, ts, tool, redacted call, reason, source, agentId); a native deny verdict stores `nativeRule`; fixture calls with `ghp_abc123…` and `API_KEY=hunter2` leave neither string in `$.store` JSON; Write content never appears; 201st entry evicts the oldest; reload re-hydrates; broken store -> verdict unchanged; observer returns exactly `next(e)`'s value.
- [ ] 1: tests (red) -> 2: implement -> 3: green -> 4: commit

### Task 8: Pane, `/session-denials`, Copy rule, status, toast
**Files:** modify `guard.tsx`; create `guard-pane.test.ts`.
**Interfaces:** `$.command.register('session-denials')` opens pane `guard-denials`: entries newest first (time, tool, short call, reason, source label guard / native / declined), per-entry `[Copy rule]` shows `Bash(<prefix>:*)` (or `Write(<path>)`) with "add it via /permissions" — no settings write, no allowlist. Status line `guard: N denied` (this session); toast on each guard deny; all UI runs only when `surfaces()` is non-empty.
**Blocked by:** Task 7.
**Pass bar:** UI test looped over `['terminal','desktop']`: empty log draws "no denials"; 3 seeded entries draw newest first with source labels; `[Copy rule]` on a `git reset --hard` entry draws `Bash(git reset:*)` text; headless: no toast, no status, no open; grep of `session/hooks/guard*.ts*` finds no `settings` write call and no `Allow` button.
- [ ] 1: tests (red) -> 2: implement -> 3: green -> 4: commit

### Task 9: False-positive corpus — release gate
**Files:** create `session/hooks/guard-fp.test.ts` (one named `test('FP-n: …')` per case, table-driven, run through the real `register` in default, bypass and headless).
**Interfaces:** consumes `register`; every case asserts `next(e)`'s value comes back unchanged, 0 asks, 0 store writes.
**Blocked by:** Tasks 2-6 (7 and 8 optional).
**Pass bar:** the design's full list is present and green: FP-1 `rm -rf node_modules build dist .next target`; FP-2 `rm -rf ./tmp/x`; FP-3 `git push`; FP-4 `git push --force` on a feature branch; FP-5 `git push origin feature:feature`; FP-6 `git reset --soft/--mixed`; FP-7 `git reset --hard` inside a heredoc body, `echo`, `grep`, `git commit -m`; FP-8 `cat > notes.md <<'EOF'` with a body naming `.env`; FP-9 Write `.env.example`; FP-10 Edit `docs/env.md`; FP-11 Read `.env`; FP-12 `grep -r "rm -rf" .`; FP-13 `ps`/`pgrep -f deploy.sh`; FP-14 Write of a markdown file holding a private-key header in a fenced example (path-only decision: passes); FP-15 unparseable (`rm -rf "$(`) passes; FP-16 `rm -rf "$VAR/"` with unknown variable passes. A mutation check: removing the heredoc exclusion in `splitCommands` turns FP-7/FP-8 red. `claude plugin test session` runs this file and a red case fails the release.
- [ ] 1: write the corpus (add cases found in Tasks 2-6) -> 2: run, fix classifier only for real misses -> 3: mutation check -> 4: commit

### Task 10: Contract step — remove the moved guards from mods
**Files:** modify `mods/hooks/mod.tsx` (delete the running-script block, the worktree block, `words`/`resolve` if then unused), `mods/hooks/mod.test.ts` (delete their tests), `.claude-plugin/marketplace.json` (mods version).
**Interfaces:** `mods` keeps push/bump ask, agent model guard, skill toast, harness band, fetch reminder, README/KOR toast, `claude -p` count.
**Blocked by:** Task 6 and Task 9 green; the `session` plugin is listed in `marketplace.json` (07 release task).
**Pass bar:** `claude plugin test mods` and `tsc -p mods` green with the remaining tests unchanged; grep for `pgrep` and `worktree remove` in `mods/hooks/` returns nothing; with both plugins loaded one `git worktree remove --force` on a dirty tree yields exactly one deny.
- [ ] 1: delete code and tests -> 2: checks -> 3: two-plugin manual check -> 4: commit

### Task 11: Docs (bump and push ON HOLD)
**Files:** modify `session/README.md`, `session/KOR.md` (guard section: rule table, modes, bypass behaviour "bypass means no native prompts, not no safety net; `guard_mode=off` is the escape hatch", headless deny, path-only secrets, **not a sandbox**: `python -c`, `find -delete`, `dd`, aliases and scripts are not covered, denial log scope: a person's "No" in a native dialog is not logged, privacy: log in `$.store`, redacted), `mods/README.md`, `mods/KOR.md` (the two guards moved to session), `plan/mod/README.md` (row 8). English and Korean change together.
**Blocked by:** Tasks 1-10.
**Pass bar:** both README/KOR pairs mention the same rules; `python3 _repo/scripts/validate_plugins.py` PASSED; `claude plugin validate|test session mods`, `tsc -p session` clean. Version bump in `marketplace.json` for session/mods and `git push` wait for the user (hold); commit only.
- [ ] 1: docs -> 2: all checks -> 3: commit (no push, no bump)

---

## Gap check (design done-criteria -> tasks)

| Done-criterion | Covered by |
|---|---|
| 1 every positive stopped default+bypass, headless denies with reason | 2-5 matrices |
| 2 zero FP hits, unparseable passes | 9 (+1 splitter) |
| 3 pane shows guard + native denies, no secret text | 7, 8 |
| 4 no settings write | 8 grep; Decisions (no allowlist) |
| 5 mods lost the two guards; docs + versions together | 10, 11 (bump held) |
| 6 spike results | S3 + tool.check-headless in 05-spike-2; `tool.check ask` under bypass is unused by design |

Open gaps: (1) `05-spike-2.md` is written in parallel; Task numbering "Task 3 = S3" is assumed and the tool.check-in-headless question must exist there. (2) 07's exact `modules` file and pane id naming are assumed. (3) Open question 1 (headless deny may stall teams/harness agents) is accepted per Decisions but untested against a real teams run. (4) Subagent scope (design Q4) defaults to all loops, recorded via `agentId`; not separately decided.
