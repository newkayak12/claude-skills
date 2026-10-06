# 01 — harness gate: stop denying Bash that only mentions a gated path

> Produced by write:plans (2026-10-06). Not a mod: a bug fix in the command hook every client
> runs. Behaviour change of the harness plugin → CLAUDE.md design-change rule applies.

**Goal:** the PreToolUse gate denies a Bash call only when it can write a gated file, not when
a gated path merely appears in data (a heredoc body, a quoted search pattern).
**Architecture:** `harness/hooks/goal-gate.mjs` `bashWriteTargets` (≈:418) collects every
path-like word of the WHOLE command, heredoc bodies included, once `writesNamedPaths` (≈:390)
says the command writes; `heredocWrites` (≈:377) calls a data heredoc writing when its body
merely contains a write verb (`WRITE_CMD` ≈:235: `install`, `patch`, `rm`, `cp`…). The project
copy `.claude/hooks/goal-gate.mjs` is byte-identical and is refreshed by `harness:update`.
**Tech stack:** node:test, `harness/scripts/test-goal-gate.mjs`.

---

## Repro cases (all denied on 2026-10-05/06 in this repo, all should pass)

| id | command shape | why it is not a write of a gated file |
|----|---------------|----------------------------------------|
| R1 | `mkdir -p d && cat > d/request.md <<'EOF'` … body naming `packages/csv/src/record.mjs`, words like `install`/`patch` … `EOF` | the only write is `d/request.md`; the body is prose |
| R2 | `git commit -F - <<'EOF'` … body naming `harness/skills/install/SKILL.md` … `EOF` | commit message is data |
| R3 | `pgrep -af 'teams/mcp/taskmanager.mjs'` and `ps -o pid,cmd -p $(pgrep -f 'teams/mcp/taskmanager.mjs')` | read-only process listing; the path is a search pattern |

## Must still deny (regression guards)

| id | command shape |
|----|---------------|
| K1 | `cat > teams/mcp/x.mjs <<'EOF'` … (redirect target is gated) |
| K2 | `bash <<'EOF'` … `sed -i s/a/b/ teams/mcp/x.mjs` … `EOF` (heredoc feeds a shell) |
| K3 | `node -e "require('fs').writeFileSync('teams/mcp/x.mjs','')"` |
| K4 | `cp a.mjs teams/mcp/x.mjs` |
| K5 | `cat > go.sh <<'EOF'` … `rm teams/mcp/x.mjs` … `EOF` then `bash go.sh` on the same line |

---

### Task 1: Failing tests for R1–R3, guards K1–K5
**Files:** modify `harness/scripts/test-goal-gate.mjs` (add a `describe('data mentions are not writes')`).
**Interfaces:** consumes exported `bashWriteTargets(command, cwd)`; asserts the returned set
contains / does not contain the resolved gated path.
**Pass bar:** R1–R3 fail on HEAD (gated path present in the set), K1–K5 pass on HEAD.

- [ ] 1: write one `test()` per row with the exact command strings above (cwd = a temp dir;
  gated path = `<cwd>/teams/mcp/x.mjs` or the named file) → 2: run
  `node --test harness/scripts/test-goal-gate.mjs` → R1–R3 red, K1–K5 green → 3: commit test only

### Task 2: Data heredocs contribute only their redirect target
**Files:** modify `harness/hooks/goal-gate.mjs` (`heredocWrites`, `bashWriteTargets`).
**Interfaces:** produces the same `bashWriteTargets` signature.
**Pass bar:** R1, R2 pass; K1, K2, K5 still pass.

- [ ] 1: in `bashWriteTargets`, collect `PATHLIKE` words from `head` (bodies cut out) plus the
  bodies of heredocs that feed a shell or an interpreter (`SHELLS`/`INTERP` on `d.line`) —
  not from data heredoc bodies
- [ ] 2: in `heredocWrites`, drop the bare `WRITE_CMD.test(d.body)` branch for data heredocs;
  keep: shell → true; interpreter → body can write; data → its file is code or run later on
  the same line AND body can write (K5)
- [ ] 3: run the file → R1, R2 green, K* green → commit

### Task 3: Read-only commands inside `$(…)` and quoted patterns
**Files:** modify `harness/hooks/goal-gate.mjs` (`readOnly`, `simpleCommands` or `runsOrWrites`).
**Pass bar:** R3 passes; K3, K4 still pass; the whole existing suite stays green.

- [ ] 1: find which branch denies R3 (log `writesNamedPaths` per segment in a scratch run) and
  write the cause into the commit message
- [ ] 2: treat `ps`, `pgrep`, `pkill -0`, `grep`, `ls`, `cat`, `head`, `tail`, `wc` segments — including
  those inside `$(…)` — as read-only; never collect words of a quoted argument to a read-only
  command
- [ ] 3: run `node --test harness/scripts/test-*.mjs` → all green → commit

### Task 4: Ship
**Files:** `.claude/hooks/goal-gate.mjs` (copy), `harness/.claude-plugin/plugin.json`,
`.claude-plugin/marketplace.json`, `harness/README.md`, `harness/KOR.md`.
**Pass bar:** `cmp harness/hooks/goal-gate.mjs .claude/hooks/goal-gate.mjs` silent;
`python3 _repo/scripts/validate_plugins.py` PASSED; R1's exact command run in this repo is not
denied.

- [ ] 1: `node _repo/scripts/patch-harness.mjs` (patch bump + README/KOR status line)
- [ ] 2: copy the gate into `.claude/hooks/` → 3: validator → 4: run R1 live → 5: commit + push
