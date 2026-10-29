# Enforcement — who checks each rule

| Rule | Anchor | Enforcement |
|---|---|---|
| Every change is checked against `_repo/coding-guidelines.md` | repo.md § Intro | prose only |
| Think Before Coding: a behaviour change starts with the user's approval before `tm_open`; unclear or several readings, ask before editing | repo.md § Intro table | prose only |
| Simplicity First: no new skill when one can be split or extended; no new top-level directory unless a plugin; no option nobody asked for | repo.md § Intro table | prose only |
| Surgical Changes: stage explicit paths; fixes land unbumped; no unrelated tidy-ups (Read/Edit/Write only is the row under maintaining.md § Agents working in the repo) | repo.md § Intro table | prose only |
| Goal-Driven Execution: done = the checks in `maintaining.md` with counts, plus one real run for a behaviour change | repo.md § Intro table | prose only |
| A behaviour change is a card on `_repo/docs/backlog.md`, taken into a Sprint, closed by the Sprint's report | repo.md § Design changes | prose only |
| A Sprint opens with `tm_open` and `size: "L"` | repo.md § Design changes | prose only |
| The person's approval of the cards and decisions comes before `tm_open`; no code before approval (plan, setgoal and critique run inside the Sprint) | repo.md § Design changes | prose only for the approval; teams/hooks/dispatch-gate.mjs (teams plugin hook) denies writes to the paths in `.claude/teams-dispatch.json` until a task is open |
| Before changing plugin behaviour: 1. plan, citing the governing design doc | repo.md § Design changes | teams/mcp/graph.mjs (teams engine: `plan` stage) |
| Before changing plugin behaviour: 2. setgoal, checkable done-criteria | repo.md § Design changes | teams/mcp/graph.mjs (teams engine: `setgoal` stage) |
| Before changing plugin behaviour: 3. critique against the doc's principles inside the Sprint | repo.md § Design changes | teams/mcp/graph.mjs (teams engine: `critique` stage) |
| Before changing plugin behaviour: 4. implement, then gate: show the result against the done-criteria | repo.md § Design changes | teams/mcp/graph.mjs (teams engine: `gate` stage) |
| Never remove a stage, a gate, or a principle for cost or simplicity without the user's approval | repo.md § Design changes | prose only |
| `<plugin>/` top level holds one plugin (`.claude-plugin/plugin.json`, `skills/`, `hooks/`, README.md + KOR.md), never notes, plans, reports | repo.md § Layout | validate_plugins.py (pre-commit + CI) checks the manifest, skills and version; the "never holds" part is prose only |
| `_repo/docs/plans/` holds dated design docs, never code | repo.md § Layout | prose only |
| `_repo/hooks/` holds git hooks, never plugin code | repo.md § Layout | prose only |
| `_repo/scripts/` holds repo-wide checks, never plugin code | repo.md § Layout | prose only |
| `_repo/deprecated/` holds a README only, never files of retired items | repo.md § Layout | prose only |
| `.claude/` holds this repo's own hook, teams config and rules, never plugin code | repo.md § Layout | prose only |
| `tmp/` is gitignored scratch, never anything to keep | repo.md § Layout | .gitignore (git) ignores it; "nothing to keep" is prose only |
| `.harness-run/` is gitignored, written by a teams size-S pass | repo.md § Layout | .gitignore (git) |
| A new top-level directory is a new plugin, or it does not exist (also maintaining.md § Leaving it clean, item 5) | repo.md § Layout | teams/mcp/layout-guard.mjs (teams engine: refuses staged new top-level dirs in a package commit); prose only in a plain session |
| A note worth keeping goes in `_repo/docs/`; one that isn't is not written to the repo | repo.md § Layout | prose only |
| Always run `validate_plugins.py` before a commit | maintaining.md § Checks before a commit | _repo/hooks/pre-commit (git hook; only when a SKILL.md, plugin.json or marketplace.json is staged) and validate_plugins.py (CI) |
| Always run `check-copies.mjs` before a commit | maintaining.md § Checks before a commit | check-copies.mjs (CI); not in pre-commit |
| Then run the checks of the plugin you touched (the Touched/Run table) | maintaining.md § Checks before a commit | prose only |
| Paths in `.claude/teams-dispatch.json` are denied to the driving session until a task is open (`tm_open`) | maintaining.md § Checks before a commit | teams/hooks/dispatch-gate.mjs (teams plugin hook) |
| Report the counts you saw; "tests pass" without a number is not a check | maintaining.md § Checks before a commit | prose only |
| Releases are batched: fixes land on main without a bump; one bump per plugin per batch, one README/KOR status line per plugin per batch | maintaining.md § Versions and release | prose only |
| A batch bump touches `plugin.json` and its `.claude-plugin/marketplace.json` entry (and `.codex-plugin/`); patch for a fix, minor for new behaviour, major for a breaking rename | maintaining.md § Versions and release | validate_plugins.py (pre-commit + CI) warns when the marketplace and plugin.json versions differ and errors when the Codex manifest name or version differs; the level is prose only |
| README.md and KOR.md move together in the same commit | maintaining.md § Versions and release | repo-rules.mjs (warning): a `git commit` with a staged `*/README.md` and no staged KOR.md beside it gets a systemMessage |
| Bump tools are maintainer tools: `patch-harness.mjs` and `teams/skills/patch/patch.mjs` (dry-run first); minor/major by hand | maintaining.md § Versions and release | repo-rules.mjs: denies both bump scripts while a teams task holds the repo |
| Remote is `origin`: `git pull --rebase origin main`, then `git push origin main` | maintaining.md § Versions and release | prose only |
| Set `git config core.hooksPath _repo/hooks` so installed copies stay current; a plugin change Codex should see needs a version bump | maintaining.md § Versions and release | _repo/hooks/post-commit and post-merge (git hooks) run `_repo/scripts/sync-codex.mjs`; setting hooksPath is prose only |
| Marketplace version and tag move only when the user asks | maintaining.md § Versions and release | prose only |
| Marketplace level: patch = any plugin bump or doc change; minor = a plugin added; major = a plugin removed or renamed, or a layout break | maintaining.md § Versions and release | prose only |
| Marketplace steps: fetch, bump `metadata.version`, commit, push, tag `v<version>` on that commit, push the tag; tag only commits on origin/main | maintaining.md § Versions and release | prose only |
| Never move, delete, or re-point a pushed tag unless the user asks | maintaining.md § Versions and release | prose only |
| An agent that edits repo files runs in its own worktree; only one agent commits in a working tree at a time | maintaining.md § Agents working in the repo | prose only |
| Every commit is authored `newkayak12 <newkayak12@gmail.com>`; the `Co-Authored-By: Claude` trailer is allowed | maintaining.md § Agents working in the repo | prose only |
| Every subagent call names its model (`sonnet` for build, `opus` for plan/judge) | maintaining.md § Agents working in the repo | prose only |
| Everyone edits files with Read/Edit/Write, not shell scripts (sed, python, heredocs); Bash is for git, checks and tests (also repo.md § Intro table, Surgical Changes) | maintaining.md § Agents working in the repo | repo-rules.mjs, Claude Code only, not Codex (hook; Codex sessions are not covered): refuses a Bash command that writes a repo file in place (sed -i, perl -i, inline python/node file write, cat/echo/tee/heredoc redirect to a repo path), with a message naming Read/Edit/Write; the refusal covers only this repo (a target whose git common dir equals the hook's own, linked worktrees included; a git repo elsewhere, or a failed lookup, passes); reads, stdout pipes and writes under tmp/, the scratchpad or /tmp pass |
| Never script around the dispatch gate; a blocked orchestrating session opens a teams task; a subagent or teams node never opens one, it stops and reports to its caller | maintaining.md § Agents working in the repo | prose only; teams/hooks/dispatch-gate.mjs (teams plugin hook) is the gate itself |
| Stage explicit paths, never `git add -A` at the root while another task has changes | maintaining.md § Agents working in the repo | prose only |
| At most 2 teams EPICs and 1 background Agent per session; count live drivers before opening another | maintaining.md § Agents working in the repo | prose only |
| Reap in the same step you take the result: cherry-pick, then remove the worktree and branch; `tm_clean` a merged EPIC; end with no driver, daemon or judge in `ps` and `git worktree list` showing only main | maintaining.md § Agents working in the repo | prose only |
| Work lost to a deleted worktree or branch: `git fsck --unreachable`, pin to a `rescue/<task>` branch first | maintaining.md § Agents working in the repo | prose only |
| A bench measures a skill, not its output: run it only up to the stage the change affects, compare blind, fix the skill | maintaining.md § Benches and experiments | prose only |
| Blind means: arms anonymized, judge on a different model tier than the authors, each judgment tied to the done criteria | maintaining.md § Benches and experiments | prose only |
| Bench output lives in `tmp/` and is deleted when the result is recorded | maintaining.md § Benches and experiments | prose only; `tmp/` is ignored by .gitignore (git) |
| Docker in a bench: unique names, no host ports, tear down by exact name; never `prune` anything | maintaining.md § Benches and experiments | prose only |
| Leaving it clean 1: `git status` is clean and `main` equals `origin/main` | maintaining.md § Leaving it clean | prose only (repo-rules.mjs shows a systemMessage at session start when origin/main is ahead) |
| Leaving it clean 2: every teams task you opened has finished and its report is written; a held task refuses `git push` and the bump tools | maintaining.md § Leaving it clean | repo-rules.mjs: denies `git push` and the bump scripts while a teams task holds the repo; _repo/hooks/pre-push (git hook) refuses the push for Codex and a plain terminal; `--no-verify` and bump scripts outside Claude Code are not covered |
| Leaving it clean 3: no containers, volumes, or background processes you started are left running | maintaining.md § Leaving it clean | prose only |
| Leaving it clean 4: `tmp/` holds nothing you are done with | maintaining.md § Leaving it clean | prose only |
| A skill owns the artifacts (files, ledgers, run records) as the source of truth | skill.md § What a skill owns | prose only |
| Enforcement a person must not skip is in a form every client sees (engine check, MCP refusal, plain command hook) | skill.md § What a skill owns | prose only |
| Parsing and decisions live in node/python with their own tests, never only in prose | skill.md § What a skill owns | prose only |
| A skill does not draw UI, wait on a pane, or depend on a mod being installed | skill.md § What a skill does not do | prose only |
| A skill does not leave out a record a viewer would need; the engine writes that field | skill.md § What a skill does not do | prose only |
| Every skill starts from `_repo/coding-guidelines.md`; apply it when a skill is created or next edited, no mass rewrite | skill.md § Writing one | prose only |
| teams-mounted skills stay frozen until teams decides | skill.md § Writing one | prose only; check-skeleton.mjs (report only) lists them apart |
| `description` starts with `Use when` | skill.md § Writing one | validate_plugins.py (pre-commit + CI): accepts "Use when", "Use before", "Use after", "Apply when" |
| `scenarios`: EN + KR variants, 2-3 each | skill.md § Writing one | validate_plugins.py (pre-commit + CI) requires the field only; the variants and their count are prose only |
| Sections: Process → Output Template → What Claude Does / What You Do → Related Skills | skill.md § Writing one | check-skeleton.mjs (report only: missing sections, lines over 200); validate_plugins.py (pre-commit + CI) requires the What Claude Does section, its Claude/You table, and its place before Related Skills |
| No background explanations; target 70% of the current average length | skill.md § Writing one | prose only |
| No new skill when an existing one can be split or extended | skill.md § Writing one | prose only |
| A behaviour change needs one real run before it is done | skill.md § Writing one | prose only |
| A mod opens one pane per plugin, by `/<name>-status` or its band line; it closes on Esc, q and the command again | mod.md § What a mod owns | prose only |
| A mod does not hold the source of truth; it reads the files a skill writes and never writes them | mod.md § What a mod does not do | prose only |
| A mod does not parse or decide; testable logic lives in node and the mod renders what it returns | mod.md § What a mod does not do | prose only |
| A mod does not decide an outcome a skill owns, or be the only enforcement of a rule | mod.md § What a mod does not do | prose only |
| Mod rule 1, never required: removing the `modules` line leaves the plugin fully working | mod.md § Rules | prose only; validate_plugins.py (pre-commit + CI) checks only that a plugin with hook `modules` has a Codex `hooks/codex.json` without them |
| Mod rule 2, interactive only: timers, panes, bands and toasts start only when `(await $.session.surfaces()).length > 0` | mod.md § Rules | prose only |
| Mod rule 3, guards fail open: every `tool.call` guard has `.catch(($, e, next) => next(e))` | mod.md § Rules | prose only |
| Mod rule 4, state in `$.state`, declared in `types/index.d.ts` | mod.md § Rules | prose only |
| Mod rule 5, release with the plugin: a mod change bumps that plugin and its README/KOR | mod.md § Rules | prose only |
| Mod rule 6, plugin files via `$.plugin.root`, not `CLAUDE_PLUGIN_ROOT` | mod.md § Rules | prose only |
| Mod rule 7, UI is Ink: anything a person reads is a `ui.render` tree; a command's `{ text }` is the headless answer only | mod.md § Rules | prose only |
| Mod rule 8, every surface: every pane, band, card and toast draws on `terminal`, `desktop`, `mobile` and `vscode` | mod.md § Rules | prose only |
| Test a mod with `cd <plugin> && claude plugin test .` and one live session where the pane opens and closes | mod.md § Rules | prose only |
| UI done 0: a person reads it at a glance, and the demo render is shown to the user and approved before the card closes | mod.md § A UI change is done when | prose only |
| UI done 1: do not claim a UI done without a live look: seen live in tmux with `claude --plugin-dir ./<plugin>`, opened by its command and band line, closed by Esc, q and the command again | mod.md § A UI change is done when | prose only |
| UI done 1b: `claude plugin test` mounts each changed surface on all four surfaces; at least one live look in the Claude app or Desktop | mod.md § A UI change is done when | prose only |
| UI done 2: not broken at any width; capture at 190 and 110 columns and fix before shipping | mod.md § A UI change is done when | prose only |
| UI done 3: shot for the README with `mod-shot.py`, one image per changed surface, demo data fictional and generic | mod.md § A UI change is done when | prose only |
| UI done 4: README.md and KOR.md show each image with one or two lines on its feedback | mod.md § A UI change is done when | prose only; repo-rules.mjs (warning) covers only a README staged without its KOR.md |
| Mods need Claude Code 2.1.292+; everything else in a plugin works on builds without it | compat-claude.md § Older Claude Code builds | prose only |
| A plugin's function never depends on its mod; removing `modules` loses only the surface | compat-claude.md § Older Claude Code builds | prose only (same rule as mod.md rule 1) |
| A gate or deny a person must not skip is a command hook, an MCP refusal, or an engine check, not only a mod `tool.call` guard | compat-claude.md § Older Claude Code builds | prose only |
| Every status a mod shows has a non-mod way to read it (a CLI, an MCP tool, the run files) | compat-claude.md § Older Claude Code builds | prose only |
| A mod API change is checked with `claude plugin validate` and `claude plugin test`; a behaviour-changing hook is also tried once without the mod | compat-claude.md § Older Claude Code builds | prose only |
| Do not solve a Codex parse error by silently dropping a Claude hook, gate, skill, or MCP capability; keep Claude-only syntax (hook `modules`) out of `.codex-plugin/`; adapt Codex payloads at the boundary; verify both clients | compat-codex.md § Codex | validate_plugins.py (pre-commit + CI) errors when hook `modules` lack `hooks/codex.json` or it contains `modules`; the rest is prose only |
| A compatibility change is complete only when the Claude tests stay green and a real Codex invocation proves the equivalent path | compat-codex.md § Codex | prose only |
| A batch bump also moves `<plugin>/.codex-plugin/` versions where present | compat-codex.md § Codex | validate_plugins.py (pre-commit + CI): errors when the Codex manifest name or version differs from plugin.json |
| Keep `harness/engine/pipeline.js` isolated; do not change it for Codex-only behaviour unless the task asks for a shared provider abstraction | compat-codex.md § Harness paths | prose only |
| Inside a Codex session do not delegate harness stages back to `codex`, the adapter, or the runner; run the contract with native tools | compat-codex.md § Inside a Codex session | prose only |
| Codex gets the push hold from git: `git config core.hooksPath _repo/hooks` | compat-codex.md § Inside a Codex session | _repo/hooks/pre-push (git hook) runs `repo-rules.mjs prepush` |
| Nothing found is left in chat: `_repo/docs/backlog.md` is the one list of work not yet done | backlog.md § Intro | prose only |
| Write a card the moment one of the four events comes up, then keep working | backlog.md § What goes on it, without being asked | prose only |
| Not a card: what is fixed in the same session, one-session chatter, secrets | backlog.md § What goes on it, without being asked | prose only |
| A card has the shape: numbered bold title, Why, Acceptance | backlog.md § Card shape | prose only |
| Search the list first; add to an existing card instead of a near-duplicate | backlog.md § Card shape | prose only |
| Group cards under a `###` heading by area; frozen items go under `## Frozen`, never pulled | backlog.md § Card shape | prose only |
| A behaviour-change card needs the checks for the touched plugin in `maintaining.md`, counts reported, plus one real run | backlog.md § What a card needs to be done | prose only |
| A skeleton or wording edit needs checks only: `validate_plugins.py`, `check-copies.mjs`, and `check-skeleton.mjs` for a SKILL.md's shape | backlog.md § What a card needs to be done | validate_plugins.py (pre-commit + CI) and check-copies.mjs (CI); check-skeleton.mjs is report only |
| Rewording a description's trigger is a behaviour change unless a routing probe is run | backlog.md § What a card needs to be done | prose only |
| Sprint 1: take cards from the top into `tm_open({requests})` with `size: "L"` and `context_from` the prior Sprint | backlog.md § Sprint loop | prose only |
| Sprint 2: write the EPIC key next to the cards it took | backlog.md § Sprint loop | prose only |
| Sprint 3: at close, delete shipped cards, put `carryover_candidates` back on top, commit the backlog | backlog.md § Sprint loop | prose only |

One row per rule in the other seven rule files (bullet, numbered item, or must/never table row). A
rule stated in two files has one row, anchored in one and cited in the Rule cell. Enforcement is a
hook in `.claude/hooks/repo-rules.mjs`, a check in `_repo/scripts/`, a git hook in `_repo/hooks/`, a
teams engine check, `prose only`, or a concrete enforcer with its kind in parentheses. Git hooks run
after `git config core.hooksPath _repo/hooks`.

## Decided in card 90 (Sprint brainstorm), not yet stated in a rule file

No rule file states this rule, so it has no `file § section` anchor; it is not counted against any
rule file. When a rule file gains the statement, move the row up and anchor it. Like the Read/Edit/Write row
above, it is enforced by a refusal in `repo-rules.mjs`.

| Rule | Anchor | Enforcement |
|---|---|---|
| `rm` with a bare unquoted `$VAR` is refused: an unquoted `$NAME` or `${NAME}` without `:?` as an argument of `rm` | card 90 / Sprint brainstorm (no rule file yet) | repo-rules.mjs hook (Claude Code only, not Codex): denies a simple command whose first word is `rm` with an unquoted `$NAME` or `${NAME}` (no `:?`) argument; quoted, guarded, `$(cmd)`, `$1`/`$@`, `find -exec`, `xargs` and text inside a quoted string pass |
