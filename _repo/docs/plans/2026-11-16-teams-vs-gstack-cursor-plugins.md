# teams measured against gstack and cursor/plugins (card 133)

Date: 2026-11-16. Asked by the user on 2026-11-10: "https://github.com/garrytan/gstack,
https://github.com/cursor/plugins 분석 Fable5.2로 + teams와 대조(Fable5.2) 및 리포트 작성(Opus 5.5)".

- Analysis and contrast: one Fable 5.2 subagent per repo, read-only, nothing executed or installed.
- Report: Opus 5.5.
- Pinned commits:
  - gstack `8c3c39b5220f7fb0c53af5362863a2377f756279` (2026-11-16, VERSION 1.99.5.0)
  - cursor/plugins `bf0c7cd80abdbf7fe47b634978a7d1b4071f71a7` (2026-11-14)
  - teams 0.63.0 at claude-skills `4e00cd32`
- Paths: gstack and cursor/plugins paths are relative to their pinned commits; teams paths are relative to this repo.
- gstack was read through its docs and SKILL files, not its `bin/` and `lib/` code, so its claims are what it documents, not verified behaviour.
- Borrowed ideas below are ideas only. No code or text is to be copied.

## 1. What each is

| | gstack | cursor/plugins | teams |
|---|---|---|---|
| What | A skill pack: one agent plays a role-based "virtual engineering team" (CEO, eng manager, designer, reviewer, QA, security, release). "All slash commands, all Markdown" (`README.md:3`). Sprint order is Think → Plan → Build → Review → Test → Ship → Reflect (`README.md:142-146`). | A marketplace of 139 Cursor plugins (`.cursor-plugin/marketplace.json`). The relevant ones: `orchestrate` (a bun CLI spawning a tree of cloud agents from `plan.json`), `pstack` (prose playbooks), and `thermos`, `advisor`, `ralph-loop`, `continual-learning`, `cursor-team-kit`. | An engine that runs a request as an EPIC of STORY cards in a fixed graph of stages, with a judge after each stage (`teams/README.md:66-116`; `_repo/docs/plans/2026-09-28-teams-cards-everywhere.md:11-14`). |
| Loop owner | The session or a parent agent. The only daemon is a browser server (`ARCHITECTURE.md:74`, `:540`: no MCP). | orchestrate: a foreground `run` heartbeat with a 3600 s runtime and a planned restart (`orchestrate/scripts/core/loop.ts:9-11`, `:92-97`). | A detached daemon per task with no model in the loop (`teams/mcp/daemon.mjs:1-24`). |
| Truth | A plan file, a run directory (`run.json`, `attempts.jsonl`, `spend.json`, `gate.json`, `decisions.jsonl`) and `TODOS.md` (`autoplan/DRIVER.md:117-124`). | `plan.json`, `state.json`, `handoffs/*.md`, synced to git (`orchestrate/references/planner.md:148`). | `task.json` and `ledger.jsonl`. |

## 2. Contrast by area

| Area | gstack | cursor/plugins | teams | Verdict for teams |
|---|---|---|---|---|
| Stages and gates | `/autoplan` runs CEO → Design → DX → Eng, with an outside voice from another model family per phase (`autoplan/DRIVER.md:27-30`). Mechanical and taste decisions are auto-decided; User Challenges never are (`autoplan/SKILL.md:292-308`). One final human gate (`:618-633`). Code review blocks only on CRITICAL, two rounds at most, and "the cap approves nothing" (`docs/review-policy.md:11-26`, `:93-99`). | There is no fixed pipeline. The planner replans from handoffs (`references/handoffs.md:185-194`). An optional verifier must run the code and grades its evidence in five levels (`prompts/verifier.md:22-49`). pstack: a non-author verifier from another model family, one verdict per head SHA (`playbooks/orchestrate.md:13`, `:19`). | Fixed graph enforced by the engine. Goal gate threshold 90. `gateintegrity.mjs` catches weakened tests; `basefail.mjs` catches failures already on the base commit. | **Keep.** **Adapt:** a blocking floor for fix rounds (gstack), and an evidence grade on verdicts (cursor). |
| Task model | No hierarchy; a lane plus its PR in the crew layer (`crew/docs/captain.md:44-47`). | A recursive planner → worker / verifier tree. Task fields include `pathsAllowed`, `pathsForbidden`, `maxAttempts` and `measurements` (`orchestrate/scripts/schemas.ts:112-157`). | Initiative > EPIC > STORY > TASK. Work is split by feature, then by ownership. Integration branch with repair packages. | **Keep.** A per-package forbidden-paths list is a possible small addition (unchecked whether `shape` already has one). |
| Drivers and parallelism | Crew lanes work on disjoint files. Merge trains run one gate on the train head, bisect a red train, and rebuild at most once (`crew/docs/captain.md:553-584`). | Cloud agents, each in its own clone. Spawns retry 3 times; idle is flagged at 5 minutes and escalated at 30. A dead worker's failure is classified cap-hit / oom / network-drop / tool-error / unknown, each with its own retry (`references/handoffs.md:23-67`). Prose: "start with one unit" (`playbooks/orchestrate.md:14`). | Daemon, one `claude -p` driver per package in its own worktree, AIMD width, machine-wide live cap of 4, stall and restart handling. Quota is the only driver death classified (`teams/mcp/routing.mjs:6-22`). | **Take:** retry by cause. Card 129 (open as E-bf0570ac) covers task-level failure kinds; this goes further to the driver-death cause. **Take:** a canary package before fan-out. **Adapt:** bisect a red integration before opening a repair. |
| Human asks | Reply grammar bound to a gate revision (`rec`, `rec except …`). Owner's words recorded verbatim with who relayed them. Earlier answers carry forward. Lettered options with the recommendation first (`autoplan/DRIVER.md:108-115`, `:33`, `:41`; `crew/docs/captain.md:682-696`). | Workers never ask. pstack asks only for product or irreversible calls; if an experiment can answer the question, run it (`principle-never-block-on-the-human/SKILL.md:11-15`). `ketchup` lists every waiting call with pick, evidence and risk, decidable from the reply alone. | `waiting_human`, `ask`, `human_gates`, `ask_timeout`, STORY → TeamLeader asks (`teams/mcp/storyask.mjs`). Non-interactive runs auto-decide and list it under `decided`. | **Take:** decision classes. A decision that changes the user's stated direction is never auto-decided silently. **Adapt:** card text that can be answered in one reply, with the recommendation first, and an "experiment first" filter before raising an ask. |
| Status UI | None live. Printed lines, an ASCII dashboard, and a `DIGEST.md` with the age of each item (`crew/docs/captain.md:714-720`). | CLI inspect commands and an optional Slack thread mirror (`planner.md:42-44`). | Band, status line, `/teams-status` pane, end-of-run card, toasts, push. `view.mjs --once` works without the mod. | **Keep.** **Adapt (small):** show the age of each card's last event. |
| Cost and budget | Admission cap: used + reservations + unknown + projection + tail reserve must fit before each step (`docs/ship-budget.md:11-24`). Cost lines on gates. A cap raise journals who approved it and their words (`:253-257`). Runaway detection (`runaway-stopper`). Context bill of the skill tree. | No spend cap in orchestrate. A pstack preset shifts every role's effort with one knob (`setup-pstack/SKILL.md:30-37`). | `budget_usd` / `timebox_minutes`: warn at 80%, stop dispatch at 100%, grace window, kill. Model per stage (card 130, `teams/mcp/nodelaunch.mjs:37-40`). | **Take:** admission before dispatch, with a reserve for integrate, QA and report. Today the stop trips after the money is spent: E-066abb46 spent $48.39 of $25. **Adapt:** one effort preset knob; cost lines on human cards. |
| Install and config | `git clone` + `./setup` (Bun). Global hooks. `gstack-config`. Per-repo `.gstack/*.json`. | Schema'd manifest. Per-plugin `variables` (a JSON Schema for user-supplied values). Per-client minimum versions. One generated Claude Code tree, which CI fails on drift (`.github/workflows/validate-plugins.yml:31-32`). | Marketplace plugin, Node only. `teams:install` optional. Precedence default < `team.json` < `tm_open`. | **Keep.** A generated Codex overlay is worth it only if the hand-kept one starts to drift. |
| Handoffs and evidence | A READY handoff is pinned to the full head SHA with a receipt, and lists every claim the lane did not check itself (`crew/docs/captain.md:419-437`). | `show-me-your-work`: an append-only decision trail audited against the transcript, then an "Attention" section from another model family (`show-me-your-work/SKILL.md:13-74`). `interrogate` keeps only findings a run proves. | Verdict ledger, `decided`, report node. `repro_unverified` exists for defects only. | **Take:** an `Unverified:` line in every handoff and report. **Adapt:** an "Attention" pass over the verdict ledger; proof-required QA defects. |
| Learning | One lesson per report, made into a rule or tool fix (`crew/docs/captain.md:753-767`). Flaky ledger (`:722-742`). | `continual-learning` mines transcripts into AGENTS.md from a stop hook. | `retro.json` via `context_from`; wiki. | **Adapt:** one required lesson in the report, proposed to the wiki. Carry flaky names from `basefail` into `retro.json`. |
| Pause | — | Andon: raise with a reason to stop new spawns tree-wide; clear to resume (`planner.md:131-142`). | `tm_cancel` (final) and the budget stop. No resumable hold found (not checked exhaustively). | **Take:** a resumable hold with a reason. |

**Not worth taking** (both analyses agree):
- Stop-hook loops (gstack skill gates, ralph-loop): teams moved the loop into a daemon.
- Merge trains, deploy and canary releases: teams never merges into the user's branch.
- Free-form planner trees, arena-style duplicate authorship, multi-host template generation and question tuning: they conflict with a teams principle or add cost for no gain here.
- The Slack mirror: high cost for one user; push already covers time away from the terminal.
- Explicit-only invocation: approval before `tm_open` already guards cost.

## 3. Side findings

- `teams/skills/orchestrate/SKILL.md:49` says `max_parallel_teams` defaults to `2` (citing `teamconfig.mjs:22`), while `teams/README.md:292` says `"auto"`. Unverified which is right.

## 4. What teams could take — for the user to choose

Ranked by value for cost. Nothing is filed as a card until the user picks.

| # | Idea | From | Value | Cost | Overlap |
|---|---|---|---|---|---|
| 1 | **Admission before dispatch.** Do not open a package whose projected cost (a prior from earlier packages) plus a reserve for integrate, QA and report exceeds the headroom. | gstack | High | Medium (`taskmanager-budget.mjs`, `drivercost.mjs`) | card 130 F3 (budget holds) |
| 2 | **Evidence grade on verdicts.** live-run / test-only / build-only / blocked-by-environment / failed, beside `match_pct`. An environment block never consumes a retry as if the work were wrong. | cursor | High | Medium | card 129 (failure kinds) |
| 3 | **Retry by cause** for a dead driver: narrower scope after a context or memory death, same brief after a network drop, another model after a tool error, otherwise settle. | cursor | High | Medium | card 129 |
| 4 | **`Unverified:` line** in every package handoff and in the report (what was not checked first-hand, or `none`). | gstack | High | Low | — |
| 5 | **Decision classes** for non-interactive runs: mechanical / taste / changes-direction. The last never defaults silently; taste decisions lead the report with the rejected alternative. | gstack | High | Medium | — |
| 6 | **Canary package** through accept before fanning out a wide shape. | cursor | Medium-high | Low-medium | — |
| 7 | **Blocking floor and proof-required defects** in QA and audit: only blockers file fix STORYs after round 1, and a defect counts only with the command and its output. | both | Medium-high | Low-medium | card 129 (identical retries) |
| 8 | **Resumable hold** with a reason: stop new dispatch, record who and why, resume. | cursor | Medium | Low-medium | — |
| 9 | **Human cards answerable in one reply.** Lettered options, recommendation first, spend/cap/headroom shown, one word for "take all", owner's words journaled on cap raises. | both | Medium | Low | — |
| 10 | **"Attention" pass.** A judge on another tier lists verdicts with weak evidence at the top of `80-report.md`. | cursor | Medium | Medium | — |
| 11 | **One lesson per report**, proposed into the wiki. | gstack | Medium | Low-medium | — |
| 12 | **One effort preset knob** that shifts every stage's model or effort a step. | cursor | Medium | Low | card 130 model per stage |
| 13 | **Bisect a red integration** before opening a repair package. | gstack | Medium on wide EPICs | Medium-high | — |
| 14 | Small: the age of each card's last event on the board, flaky names into `retro.json`, a prompt bill per stage, idle gaps longer than the cache lifetime. | gstack | Low-medium | Low | — |
