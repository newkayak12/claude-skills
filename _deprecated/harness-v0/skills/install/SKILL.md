---
name: install
description: >-
  Use when the user has just installed the harness plugin and is running it for
  the first time, or asks to set up / onboard / configure harness. Triggers on:
  "harness 설치했어", "harness:install", "온보딩 해줘", "user-rule 설정", "처음
  설정", "set up harness", "onboard me", "configure harness", "first run". Runs
  interactive L1 user-rule setup (writes ~/.harness/user-rules.md) and explains
  what the harness loads when.
scenarios:
  - "harness 방금 깔았어 — 초기 설정 도와줘"
  - "user-rule 어떻게 정해? 온보딩 해줘"
  - "I just installed harness, set me up"
  - "Configure my harness defaults"
  - "harness 처음 실행이야"
compatibility:
  optional:
    - sequential-thinking   # 한 질문씩 온보딩을 단계적으로 진행
related:
  - cycle
  - rule-layering
---

# Harness Install — First-Run Onboarding

Does two things: **(A) scaffold the current project under harness** (vendor into `.claude/` — per-project, ambient),
**(B) build L1 user-rules conversationally** (user-global defaults). Also explains *when the harness loads what*.
**Writing files manually is not the default path** (GOAL §3.2) — this skill asks, the scripts write.

## Step 0: Preflight — `python3` (first, pure-shell)

Every harness hook and script depends on the `python3` interpreter. **Without it, every SessionStart
hook fails each session and all skill commands break** — the hook itself is python3, so it can't even degrade gracefully.
So check first with a pure-shell check that *doesn't go through python3*.

```bash
command -v python3 >/dev/null 2>&1 \
  && echo "✓ python3 OK: $(command -v python3)" \
  || echo "🛑 python3 not found — the harness requires python3 on PATH. Install/alias it and retry. (macOS: Xcode CLT / Linux: package manager / Windows: install from python.org and confirm 'python3' is runnable — if only 'python' exists, hooks can't find it)"
```

If `python3 not found` appears, **STOP** — guide the user to install python3 and halt onboarding. Nothing below matters until this passes.

## Step 0.5: Version-drift check (*before* re-vendor, required)

The plugin does *not* auto-update via `git push` — the installed version is frozen until an explicit update.
Reporting only "already installed" and stopping leaves a real-world defect where the user *keeps working on an old
version (missing gate/security fixes)* (#015). So compare the version at *three points* first and surface it — **informational, not a rejection**.

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/version-doctor.py --project "$CLAUDE_PROJECT_DIR"
```

The three points read: **running plugin** (the cache version this skill runs from) · **marketplace listing** (the latest
the local clone knows) · **project vendoring** (`.claude/harness/`). Report the verdict **verbatim to the user**:

- **Global plugin stale** (running < marketplace): `/plugin` menu → harness **update** comes *first*. Only then can
  the Step A re-vendor put the new version into the project (if global is old, re-vendoring still yields the old version).
- **Marketplace not listed / unknown**: the local clone predates the harness addition → `/plugin marketplace update <mp>` then recheck.
- **Vendoring stale** (vendored < running): resolved by the Step A re-vendor (run right below).
- The marketplace clone can lag behind origin (offline-comparison limit), so add that the user should **always refresh
  the clone with `/plugin marketplace update`** before confirming the real latest.

If the global plugin is stale, *state that fact* — guide the update path — then *continue* with Step A (re-vendor)
(aligning the project to at least the currently-running version). It's fail-open, so a failed check never blocks onboarding.

## Step A: scaffold/refresh the project under harness (core delivery — first install *and* update)

> This is the substance of "just use it and it automatically operates under the harness." Not the global plugin, but
> vendoring the harness into *this project's `.claude/`*, so `.claude/` autoload gives you per-project + ambient governance.

**This step *always runs first*, whether first install or update.** If you `update` the plugin from the marketplace,
only the *global* version is new and this project's vendoring is *still the old version* — you must re-vendor for the new version to reach the project.

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/project-install.py --project "$CLAUDE_PROJECT_DIR" --dry-run  # check plan/version
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/project-install.py --project "$CLAUDE_PROJECT_DIR"            # run
```

Idempotent + **version-aware** — it compares the vendor-marker version against the source version and *reports*
`new install vX` / `already latest vX` / `upgrade vX→vY` (informational, not a rejection — re-vendors as a refresh even on the same version). It creates
`.claude/harness/` (payload) + `.claude/settings.json` (hooks, relative to `$CLAUDE_PROJECT_DIR`) + `.claude/CLAUDE.md` (cycle discipline),
or *merges while preserving existing content*. It never erases existing user content. After install/refresh it takes effect **from that project's next session**.

> vendoring = a *pinned version* committed into and traveling with the repo. **Applying an update = re-running `harness:install`
> in that project (this Step A re-vendor)** is the only path — updating the global plugin alone never reaches the project.

The vendor location and the hook paths are **derived from one subdir (SSOT)** so they can't diverge — a divergence (payload in one place, hooks pointing at another) made *every* PreToolUse hook fire on a missing file and `exit 2`, blocking **all** tools into an unrecoverable deadlock (real-world defect). The installer now (a) **auto-detects an existing vendored layout** (e.g. `.claude/v1/harness`) and re-vendors *there* instead of forking a second `.claude/harness`, overridable with `--dest-subdir`, and (b) **verifies every hook command points at a file that exists** after writing settings — pruning stale harness hooks (and warning on broken user hooks) so a divergence surfaces as a loud install message, not a runtime brick.

## Step 1: L1 user-rules — if already present, skip *only this step* (not a full STOP)

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/user-rules-init.py path   # check path
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/user-rules-init.py show   # print content if present
```

If already present, **skip only the user-rules steps (Step 2–3)** — show the content, ask "do you want to *add* a rule?",
and move on. Don't overwrite (idempotent). **Don't halt the whole onboarding** — Step A (project re-vendor) already ran, and
on update that's the whole point. Ending here with "already installed" terminates *without the new version reaching the project* (real-world defect).

## Step 2: One question at a time — collect L1 defaults

All *optional*. Don't dump them all at once, ask one by one. Skip if unknown (`add` later).

1. **Preferred language/stack?** (e.g. "Python 3.12 / FastAPI", "TypeScript / Next.js", "Kotlin 2.0 / Spring Boot")
2. **Code style** — *the config file path, not the content* (§5, AP-29). Python → `pyproject.toml`? JS → `biome.json`? Kotlin → `detekt.yml`? Java → `checkstyle.xml`? Other languages → generic `--pointer <name> <path>`.
3. **Default WIP** — L0 Default is WIP=1. Keep it? Adjust?

> Don't take code style *as words* ("4 spaces"). It drifts. Take only the **toolchain config file location** — the harness only verifies *the config exists*.

## Step 2.5: First explain *where* files are created (before creation, required)

Before writing files in the next step, state where they get created — otherwise you get the confusion "I thought it would be created inside the project" (real-world feedback).

- **L1 user-rules → `~/.harness/user-rules.md` (home directory, global)**: applies to *all of this user's projects*. This is what you're creating now.
- **L2 project-rules → inside the project**: agreed and created in that project only, *on first cycle entry* (GOAL §2 step 4). Not now.

Nail down in one line that even if CWD is the project directory, L1 is created in home. *Show* the actual path with the `path` command, then proceed.

## Step 3: Create user-rules

Call with the collected answers (flag only the items provided):

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/user-rules-init.py init \
  --lang "Kotlin 2.0 / Spring Boot" \
  --pointer-kotlin "detekt.yml" \
  --pointer-java "checkstyle.xml" \
  --wip "1"
```

Pointer flags: `--pointer-python` · `--pointer-js` · `--pointer-kotlin` · `--pointer-java`. For other languages/tools, the generic `--pointer <name> <path>` (repeatable):

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/user-rules-init.py init \
  --lang "Go 1.22" --pointer go ".golangci.yml" --pointer sql "sqlfluff.cfg"
```

→ creates `~/.harness/user-rules.md` (12-rule-layering frontmatter). To add one rule later:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/user-rules-init.py add \
  --id R-USER-DDD01 --title "prefer DDD 4-layer" --layer L1 --scope default \
  --why "default architecture for new projects"
```

`init` refuses if the file exists (idempotent); recreate only with `--force` (after a `.bak` backup). `add` also refuses a duplicate id.

The generated L1 rules are **auto-injected by the `rule-inject` hook at every session start** — no manual command needed. (See the Step 4 table for the auto-injection mechanism.)

## Step 4: Explain "when does what load" (GOAL §3.3 / CA-1)

*State* to the user — how the AI operates after install:

| When | Load/trigger | What |
|---|---|---|
| **Session start (auto)** | hook `rule-inject` | **Auto-inject always-on rules (invariant L0 + L1) into context** — only rules valid throughout the session regardless of stage (R-PG process gates, R-DoD, R-DD, R-AI + the L1 user-rules you just made). Per-stage coding/architecture rules are excluded (↓ covered by the stage-entry hook). 1 line/rule compression (**lossless** — zero rule omissions within the slice). ≈**385 tokens** (vs 620 full, by deferring static defaults to stages). *Injection ≠ enforcement*. |
| **Stage entry (auto)** | hook `stage-inject` (PreToolUse) | **Auto-inject that stage's rules *the moment the stage begins*.** Starting to write code (Edit/Write tool call) = entering `code-writing` → R-CD coding rules (SOLID/KISS/YAGNI/…) injected *right then* (~309 tokens). Once per session per stage (de-dup). Extends defense from the session *boundary* into the *flow* (CA-10). `permissionDecision=allow` — doesn't block tools, *injection ≠ enforcement*. |
| Session start | hook `active-cycle-verify` | integrity check of the in-progress cycle |
| New cycle start | `harness:cycle` | pre-cycle entry gate → on pass, `cycle-init.py` scaffold |
| Per work stage (manual, granular) | `rules-merge.py effective --stage <stage>` | when you want to narrow to just a specific stage's effective rules (manual lookup beyond auto-injection). Invariant-protected; conflicts via `conflicts`. (L2/L3 to follow) |
| Hypothesis/quality-bar registration | hook `hypothesis-immutability` | `hypotheses.jsonl`/`bar.jsonl` tamper-evident lock (#006) |
| Cycle close | `close-cycle.py` | per-bar independent review (#007) + cross-cycle ratchet (#008) gate |

> Auto-injection now splits into *two moments* (resolving independent review CA-10). **SessionStart** (`rule-inject`) is *always-on* rules only (invariant L0 + L1) — ≈385 tokens (vs 620 full). **Stage entry** (`stage-inject`, PreToolUse) re-injects that stage's rules (R-CD coding rules etc., ~309 tokens) *right then*, at the moment code-writing starts (Edit/Write). **No functional loss**: every coding rule from the old full-injection *still reaches the model intact* — just at *the moment coding actually starts* rather than at session start. Net effect: session-start tokens ↓ **AND** defense extends from boundary into the *flow* (even if rules scroll out in a long session, they re-reach at each stage entry). Both are *injection ≠ enforcement* (enforcement comes from gates/blocking hooks).

## Step 5: Suggest the next action

Tell the user "you can now start your first cycle with `harness:cycle`." Per-project L2 rules are agreed on first cycle entry (GOAL §2 step 4).

## What Claude Does
- At Step 0, `python3` pure-shell preflight — if absent, STOP and guide installation (so the hook doesn't die)
- **At Step 0.5, version-drift check via `version-doctor.py`** — compare the 3 points running plugin / marketplace listing / vendoring; if stale, state it and guide the update path (not a rejection). Does *not silently end* with "already installed"
- Step A (project re-vendor) *always runs first*, whether first install or update — does not STOP at "already installed" (the point of update)
- At Step 1, check for existing user-rules — if present, skip *only the user-rules steps* (just ask whether to add) and continue onboarding
- Collect L1 defaults one question at a time (don't dump all at once)
- Take code style only as a *config file path* (refuse content — AP-29). JVM family via `--pointer-kotlin/--pointer-java`, others via generic `--pointer <name> <path>`
- **State the L1 (global `~/.harness/`) vs L2 (inside project) difference *before* creating files** (Step 2.5)
- Idempotent creation via `user-rules-init.py`, state "when does what load" in a table

## What You Do
- Answer language/stack, style config file, WIP default (skip if unknown)
- Manage code style via toolchain config files (don't write it as words)
- First cycle via `harness:cycle`

## Related Skills
- `harness:cycle` — first cycle entry gate
- `12-rule-layering.md` — L1/L2/L3 layer structure
