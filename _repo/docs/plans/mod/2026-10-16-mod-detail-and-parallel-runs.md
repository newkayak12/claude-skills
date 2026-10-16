# Mod detail and parallel runs — DRAFT for approval

> Backlog card 31 (main), with 29's "Design first" section. Rules: `.claude/rules/mod.md`, `repo.md`.
> Status: draft, no code. Approval → one card per mod (§4), each gated by live shots against §3.

**User's words this answers.** "전체적으로 mod가 더 디테일해야할거 같아 일단 있다 그 이상 이하도 아니게보인다"
(2026-10-15) · "각 스킬에 특화되도록 사용자 친화적으로!" · "실제 사용 유아이같이 고도로 발달하고 사람이
보기좋게가 가장 중요 정보도 다 표현하고" (2026-10-16) · "팀즈 하네스 그래프 병렬 실행 시 모드 어떻게 그릴지 고민하기".

**What every pane answers, in this order, in its own skill's words:** (1) what it is doing *now* — stage
and the latest driver step; (2) the last verdict and its top finding; (3) how far — done of total; (4) how
long and how much; (5) what comes next, and whether anything waits on *you*. A field no file records is
added to the engine, never inferred in the tsx (mod rule "parse or decide: no").

## 0. Today

| Mod | Reads | Shows | Missing (seen) |
|---|---|---|---|
| harness `harness/hooks/mod.tsx` | newest live `.harness-run/<slug>/` of this worktree: `manifest.json`, `01-plan.md`, `02-goal-spec.json`, `02-critique.json`, `subgoals/<id>/{impl,test,gate}-<n>.json`, `result.json`, `04-goal-gate.json`, `05-report.md`; band also counts `.harness-run/broker/runs/*.json` | title, stage rail, subgoal flow with gate rejects, `▶ Now` sentence, `—` agent, time since last file change, gate rules | critique rounds (`02-critique.r<n>.json` ignored), finding count/severity, what the stage is doing, start time, cost, next step; one run only; band draws graph's row too |
| teams `teams/hooks/mod.tsx` | `view.mjs --once --format status|summary|teams|events|decisions|report` over `~/.harness/tasks/<id>/` | EPIC title, `state · day · done/total`, stage rail, per-team cards with node/agent/elapsed, You line, cost total, Decisions/Log/Report tabs, end card | driver's current step (27), per-STORY cost (27), S task reads `blocked · 0/0` (28), multi-item title (28), one task only (29) |
| graph `graph/hooks/mod.tsx` | newest `.harness-run/broker/runs/<id>.json` | title, run id, active nodes with agent and elapsed, flow with attempts and reject reasons, gates done/total | latest step, cost, run start, owner (teams package runs live in `<pkg cwd>/.teams_output/broker/runs/`, so they never show here), no band of its own, one run only |
| session `session/hooks/{mod,memo,guard}.tsx` | `$.store` notes, guard ring, ledger, board | status line (task, agents, children, denials, cost), board, retro, memo pane, denials pane | memo pane cannot close (30); memo pane does not say whether notes went out with this conversation or which are stale |

## 1. Per mod: what a person reads at a glance

`have` = a file field exists today; `add` = the named engine adds it (part of that mod's card).

### harness — plan, critique, subgoals

| Person reads | Source | |
|---|---|---|
| Title | `manifest.request` first line | have |
| Stage, as a rail that shows a loop ("SetGoal again") | file presence as `scanRun`; rounds from `02-critique.r<n>.json` | have |
| What it is doing now ("SetGoal is rewriting the spec after critique rejected it") and round *n of max* | `now.json` `{stage, doing, round, since}` written at each stage step by `harness/engine/fallback.md` / `pipeline.js`; `manifest.max_retries` | add / have |
| Last step ("edited the goal spec — split …") | `now.json.last_step` (one line, ≤120 chars) | add |
| Last verdict + top finding, counts by severity | `02-critique.json` `sound`, `problems[]` — severity today is a text prefix ("Nit:") → `problems[].severity` | have / add |
| Subgoal and goal-gate verdicts | `gate-<n>.json` `{pass, reason, gaps}`, `04-goal-gate.json` `{match_pct, pass}` | have |
| Progress | `result.json.passed` of spec subgoals | have |
| Elapsed / cost | `manifest.started_at` / `now.json.cost_usd` (teams-driven S run: teams drivercost) | add |
| Next / waits on you | `now.json.next`, `now.json.waiting` (e.g. spec approval) | add |

### teams — EPIC, STORY, cards

| Person reads | Source | |
|---|---|---|
| EPIC key + title, "— N items" for a backlog | `SummaryTask.key/title`; `task.requests.length` → `summary.items` | have / add (28) |
| Stage rail; an S task shows its harness stages | `SummaryTask.stages`; S: `task.s_run` → its run's stages, skipped nodes read skipped, not blocked | have / add (28) |
| Now sentence | `SummaryTask.now {kind, subject}` | have |
| Per STORY: node now, try *n of max*, agent, elapsed | `TeamsView` cards `now {node, agent, elapsed_ms}`; try/max from the child run (`nodes[].child.{cwd,run_id}` → `.teams_output/broker/runs/<id>.json`) | have / add |
| Per STORY: doing now (driver's latest step) | last rendered line of `drivers/<node>.stream.jsonl` via `tasklog.mjs readLogTail(…,1)` → `NowLine.doing` | add (27) |
| Per STORY cost; EPIC cost | `drivercost.mjs` per stream → `card.cost_usd`; `SummaryTask.cost` | add (27) / have |
| Last verdict + reason | newest verdict in `decisionsView` → `summary.last_verdict {card, node, verdict, score, reason}` | add |
| Done/total STORYs; "not split yet" while planning | `SummaryTask.done/total` + stage | have |
| You | `SummaryTask.you {count, items}` | have |
| Next | first pending stage; a pending STORY's `deps` ("waits for P1, P2") | have |

### graph — nodes

| Person reads | Source | |
|---|---|---|
| Title, run id, owner ("under E-3f9a21c0 / P2") | `request`, `run_id`; `owner {task_id, key}` set when teams spawns the run | have / add |
| Active node, subgoal, try *n of max*, agent, elapsed | `nodes[]` `state/stage/subgoal_id/attempt`, `max_retries`, `agentOf`, `started_at` | have |
| Last step | `nodes[].last_step` written by `team_submit`/broker on each progress report; under teams the STORY's `doing` | add |
| Verdict + reason; feedback carried into a retry | `nodes[].result {stage_ok, reason, match_pct}`, `feedback` | have |
| Gates done/total, goal gate % | as `status.ts` | have |
| Elapsed / cost | `created_at` / `cost_usd` on the run | add |
| Next / waits | pending node whose `deps` are done; `routing_blocked`, `unavailable_vendors` → "waiting: vendor capacity" | have |

### session — memo, guards

| Person reads | Source | |
|---|---|---|
| Notes by scope, age, stale hint | `$.store` notes `{text, ts}`, `ageHint` | have |
| Whether notes went out with this conversation, size of cap | memo inject hook's own state → `memo.sentAt`; `visible().cut` | add (mod-owned state) / have |
| Guard mode, stops this session, each with rule and source | guard ring `Denial {ts, tool, call, reason, source}`, `guard_mode` | have |
| What waits on you | an open guard confirm | have |

Session holds no run; its "stage/verdict/progress" are memo-sent and the last guard stop. Runs stay in the board's runs column, which links to the owning plugin's pane.

## 2. Parallel runs (card 29)

**Recommendation: one pane per plugin, each with its own run switcher; one band row per plugin; teams owns
what it spawns.** Not one shared "Runs" pane.

Why:
1. *Skill language.* A shared pane flattens EPIC/STORY, plan/critique/subgoal and nodes into one generic list —
   the layout the user asked us not to build.
2. *Rules.* "One pane per plugin" and "never required": a shared pane lives in one plugin and reads the other
   two's files, so removing that plugin removes everyone's detail. Today's harness band already draws graph's
   row; this moves it home.
3. *Cross-session overview exists.* The session board's runs column already lists harness/graph/teams runs
   per session; it stays the overview and gains nothing new here.

**Ownership and nesting.**
- A teams L EPIC owns its packages: each STORY is its own worktree with one graph run
  (`nodes[].child.{cwd,run_id}`). The teams pane shows them as STORY rows with their node now (§3);
  they never appear as separate graph runs. An S task owns its single harness/graph run (`task.s_run`).
- The graph run file gets `owner`; the graph pane and band skip owned runs unless opened from a STORY
  (Enter → Decisions; `g` on a STORY opens the graph pane on that run, title tagged "under E-…/P2").
- A standalone harness run or graph run (no owner) shows in its own pane.

**Run list.** Each engine's non-mod readout lists every open run first (`view.mjs --once --format summary`
returns all running tasks of this cwd; harness `fallback-check.mjs --list`; graph `broker runs --list`
or equivalent) — the pane renders that list; the CLI is the non-mod way to read it (compat-claude).

**Which run a pane opens on.** The one that waits on you; else the one with a reject since you last looked;
else the most recently changed. `◀ [ ] ▶` and "run 1 of 2" in the header; the tab row's right side names
the other run and its stage.

**Band.** At most one row per plugin; each row leads with its own most urgent run, in the same order (waits
on you › rejected or failed › most recently changed), then `+N` for the rest. A `⚑` marks a row that waits
on you. Plugins cannot order each other's rows (render chain), so urgency is carried by the `⚑` and the row's
first words, not by position. Graph draws its own row (moved out of harness); an owned graph run adds no row.

**Keys** (pane focused; the band takes clicks only): `[` / `]` previous / next run · `1`–`4` tabs (as today) ·
`↑↓` pick a STORY or subgoal · `Enter` its decisions / gate verdicts · `g` (teams) open the STORY's graph
run · `q`, `Esc`, the command again close.

## 3. Mockups

Fictional demo data. Each is what the shot must match (card 31 Bar); a field marked `add` above is shown
as it will read once the engine writes it.

### harness · 190

```text
╭─ Harness ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Add CSV export to the reports page                                                                                                 running · 1h 12m · $3.40 · run 1 of 2 ◀ [ ] ▶ · q close │
│                                                                                                                                                                                            │
│ ▶ Now   SetGoal is rewriting the spec — critique round 1 rejected it (4 major, 1 nit)                                                                      round 2 of 3 · 6m in this stage │
│         last step: edited the goal spec — split "export button" into two subgoals                                                                                                  12s ago │
│ ⚑ You   nothing needed · next: critique round 2 judges the new spec, then 3 subgoals are built                                                                                             │
│                                                                                                                                                                                            │
│ ✔ Plan ━━ ✔ SetGoal ━━ ✘ Critique ━━ ● SetGoal again ┄┄ ○ Critique ┄┄ ○ Subgoals 0/3 ┄┄ ○ Goal gate ┄┄ ○ Report                                                    subgoals 0/3 ────────── │
│                                                                                                                                                                                            │
│ Critique round 1 · rejected · 4 major, 1 nit                                                                                                                                               │
│   1  major  "export button" has no check that a file actually downloads — the acceptance cannot be tested                                                                                  │
│   2  major  the large-report subgoal edits the auth middleware, outside the plan                                                                                                           │
│      +2 major, 1 nit · Findings (3)                                                                                                                                                        │
│                                                                                                                                                                                            │
│ ● Now (1)   Flow (2)   Findings (3)   Gate rules (4)                                                                                            other run: fix-date-filter · Implement 2/4 │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

### harness · 110

```text
╭─ Harness ──────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Add CSV export to the reports page                                   running · 1h 12m · $3.40 · 1/2 ◀▶ · q │
│                                                                                                            │
│ ▶ SetGoal rewrites the spec — critique rejected it (4 major)                                round 2/3 · 6m │
│   last: split "export button" into two subgoals                                                        12s │
│ ⚑ nothing needed · next: critique round 2                                                                  │
│                                                                                                            │
│ ✔ Plan ━ ✔ SetGoal ━ ✘ Critique ━ ● SetGoal ┄ ○ Critique ┄ ○ Subgoals 0/3 ┄ ○ Gate ┄ ○ Report              │
│                                                                                                            │
│ Critique r1 · rejected · 4 major, 1 nit                                                                    │
│   1 major  "export button": no check that a file downloads                                                 │
│   2 major  large-report subgoal edits auth middleware                                                      │
│     +2 major, 1 nit · Findings (3)                                                                         │
│                                                                                                            │
│ ● Now 1  Flow 2  Findings 3  Rules 4                                                                +1 run │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

### teams · 190

```text
╭─ Teams ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ E-3f9a21c0  Billing settings revamp — 3 items                                                                            running · day 1 · 2h 05m · $11.80 · EPIC 1 of 2 ◀ [ ] ▶ · q close │
│                                                                                                                                                                                            │
│ ▶ Now   Build — 2 STORYs working, 1 waits for P1 and P2                                                                                                                                    │
│ ⚑ You   1 question from P2: "Keep the legacy invoice PDF route?" — answer in Decisions (2) or /teams:inbox                                                                                 │
│                                                                                                                                                                                            │
│ ✔ Plan ━━ ● Build ┄┄ ○ Integrate ┄┄ ○ QA ┄┄ ○ Final gate ┄┄ ○ Report                                                                                   STORYs 1/4 ━━━━━━────────────────── │
│                                                                                                                                                                                            │
│    STORY                                    node now (its own worktree)             doing now                                              time     cost                                   │
│ ✔  P1  API contract for billing settings    done · goal gate 96%                                                                            18m    $1.10                                   │
│ ●  P2  Settings form and validation         implement s2 · try 2 of 3 · sonnet      editing src/settings/form.ts — currency field        9m 40s    $2.35                                   │
│       ↳ gate rejected try 1: currency field accepts negative values                                                                                                                        │
│ ●  P3  Invoice email template               test s1 · try 1 · sonnet                running npm test -- invoice                          4m 02s    $0.90                                   │
│ ○  P4  Migration for plan tiers             waits for P1, P2                                                                                                                               │
│                                                                                                                                                                                            │
│ Last verdict   P2 gate · rejected · 62% · currency field accepts negative values                                                                                                           │
│                                                                                                                                                                                            │
│ ● Teams (1)   Decisions (2)   Log (3)   Report (4)                                                      ↑↓ pick a STORY · Enter its decisions · other EPIC: E-91b07d2e Search filters · QA │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

### teams · 110

```text
╭─ Teams ────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ E-3f9a21c0  Billing settings revamp — 3 items                       running · 2h 05m · $11.80 · 1/2 ◀▶ · q │
│                                                                                                            │
│ ▶ Build — 2 STORYs working, 1 waits                                                                        │
│ ⚑ 1 question from P2: "Keep the legacy invoice PDF route?"                                                 │
│                                                                                                            │
│ ✔ Plan ━ ● Build ┄ ○ Integrate ┄ ○ QA ┄ ○ Gate ┄ ○ Report                                       STORYs 1/4 │
│                                                                                                            │
│ ✔ P1 API contract for billing settings · gate 96%                                               18m  $1.10 │
│ ● P2 Settings form and validation · implement s2 · try 2/3                                       9m  $2.35 │
│      editing src/settings/form.ts — currency field                                                         │
│      ↳ try 1 rejected: currency field accepts negative values                                              │
│ ● P3 Invoice email template · test s1 · try 1                                                    4m  $0.90 │
│      running npm test -- invoice                                                                           │
│ ○ P4 Migration for plan tiers · waits for P1, P2                                                           │
│                                                                                                            │
│ ● Teams 1  Decisions 2  Log 3  Report 4                                                 ↑↓ Enter · +1 EPIC │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

### graph · 190

```text
╭─ Graph ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Rate-limit the public search API                                                                                               run 7c1e09ab · running · 34m · $2.10 · run 1 of 1 · q close │
│                                                                                                                                                                                            │
│ ▶ Now   gate is judging s2 "token bucket per API key" · try 2 · codex·gpt-5                                                                                                         1m 10s │
│         last step: ran scripts/check-limits.sh — 14 of 14 cases pass                                                                                                               20s ago │
│ ⚑ You   nothing needed · next: s3 "429 response body" starts when s2 passes · retries left: 2                                                                                              │
│                                                                                                                                                                                            │
│ Nodes                                                                                                                                   gates 2/5 ━━━━━━━━━━──────────────── · goal gate — │
│   ✔ plan  claude·opus 2m    ✔ setgoal  claude·opus 3m    ✔ critique  sound, 0 findings  1m                                                                                                 │
│   s1  Config for limits          ✔ implement → ✔ test → ✔ gate                 try 1   sonnet    6m                                                                                        │
│   s2  Token bucket per API key   ✔ implement → ✔ test → ● gate                 try 2   codex     9m                                                                                        │
│         ↳ try 1 rejected: bucket refills per request, not per second                                                                                                                       │
│   s3  429 response body          ○ implement   ○ test   ○ gate                 waits for s2                                                                                                │
│   ○ goal gate   ○ report                                                                                                                                                                   │
│                                                                                                                                                                                            │
│ ● Flow (1)   Detail (2)                                                                                                                                                                    │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

### graph · 110

```text
╭─ Graph ────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Rate-limit the public search API                                      7c1e09ab · running · 34m · $2.10 · q │
│                                                                                                            │
│ ▶ gate judges s2 "token bucket per API key" · try 2 · codex                                         1m 10s │
│   last: check-limits.sh — 14/14 pass                                                                   20s │
│ ⚑ nothing needed · next: s3 after s2 passes                                                                │
│                                                                                                            │
│ ✔ plan ━ ✔ setgoal ━ ✔ critique ━ ● subgoals ┄ ○ goal gate ┄ ○ report                            gates 2/5 │
│   s1 Config for limits          ✔ impl ✔ test ✔ gate                                                 try 1 │
│   s2 Token bucket per API key   ✔ impl ✔ test ● gate                                                 try 2 │
│        ↳ try 1: refills per request, not per second                                                        │
│   s3 429 response body          ○ impl ○ test ○ gate                                              waits s2 │
│                                                                                                            │
│ ● Flow 1  Detail 2                                                                                         │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

### session memo · 190 and 110 (guard pane: same frame, one row per stop)

```text
╭─ Memo ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ 5 notes ride along in this project                                                                                            sent with this conversation at 14:02 · 3.1 of 8 KB · q close │
│                                                                                                                                                                                            │
│ This project (3)                                                                                                                                                                           │
│   1  Use pnpm, not npm, in every package                                                                                                                                        2 days old │
│   2  The staging DB is read-only on Fridays                                                                                                                            9 days old · stale? │
│   3  Demo data stays fictional — no real customers                                                                                                                                   today │
│ Every project (2)                                                                                                                                                                          │
│   4  Reply in Korean; code and commits in English                                                                                                                              3 weeks old │
│   5  Ask before pushing to main                                                                                                                                                3 weeks old │
│                                                                                                                                                                                            │
│ /memo add <text> · /memo rm <n> · /memo clear                                                                                                                     Esc or q or /memo closes │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

```text
╭─ Memo ─────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ 5 notes · sent with this conversation 14:02                                                   3.1/8 KB · q │
│   1 Use pnpm, not npm, in every package                                                       project · 2d │
│   2 The staging DB is read-only on Fridays                                             project · 9d stale? │
│   4 Reply in Korean; code and commits in English                                                  all · 3w │
│   +2 more · /memo add · /memo rm <n>                                                                       │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Guard ────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ guard: confirm mode · 3 stopped this session                                                             q │
│ ✘ rm -rf ./build ../shared — deletes outside this repo                                       14:21 · guard │
│ ✘ write .env.production — secret path                                                        13:58 · guard │
│ ✘ git push --force origin main — you declined                                             13:40 · declined │
│ Enter on a row: copy an allow rule                                                                 Esc · q │
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

### band · 190, three plugins with runs (graph run here is standalone)

```text
⚑ teams   E-3f9a21c0 Billing settings revamp · Build · P2 asks a question · P3 testing · STORYs 1/4 ━━━━──────                                                        [answer] [board] +1 EPIC
  harness csv-export · SetGoal rewriting the spec after critique rejected it (4 major) · round 2 of 3 · 6m                                                                       [open] +1 run
  graph   7c1e09ab Rate-limit the public search API · gate on s2 · try 2 · gates 2/5 ━━━━──────                                                                                         [open]
```

### band · 110

```text
⚑ teams  E-3f9a21c0 · Build · P2 asks a question · 1/4                                             [answer] +1
  harness csv-export · SetGoal again (critique: 4 major)                                             [open] +1
  graph  7c1e09ab · gate s2 try 2 · 2/5                                                                 [open]
```

### band — the detailed one is the band (user, 2026-10-16)

User: "band 좋은데 더 자세한게 나음 https://github.com/scrothers/statusline 같이 미리에셋을 가지고 있든 하면 어떄",
then: "고른다기 보다는 저렇게 디테일하게 mod를 만들고 공을 들이자는거야". Not a preset switch: every mod is
built with that statusline's level of detail and polish. The one-row bands above are superseded.

- **Three rows per leading run,** each answering one question: *what is it doing and does it wait on me* /
  *how far along* / *what has it cost and what came back last*. Other open runs show as `+N`.
- **Segments with a priority.** Each row is a list of segments; under width pressure the lowest drop first
  until the row fits. The run name and `⚑` never drop, only truncate with `…`.
- **Theme follows Claude Code's dark/light setting;** icon set with a Nerd Font glyph and a plain fallback.
- **`demo` per mod.** A command renders fixture scenarios (`minimal`, `full`, `parallel`, `narrow`) with no
  live run — used for the README shots and the 190/110 width check.

At 110:

```text
⚑ teams  E-3f9a21c0 Billing settings revamp · P2 asks: "Keep the legacy invoice PDF route?"   [answer] +1
         ✔Plan ━ ●Build ┄ ○Integrate ┄ ○QA ┄ ○Gate   STORYs ✔P1 ●P2 try 2/3 ●P3 ○P4   1/4
         2h 05m · $11.80 · last: P1 gate 96% · P2 try 1 rejected (negative currency)
  harness csv-export · SetGoal rewriting the spec · critique round 2/3 rejected (4 major)      [open] +1
         ✔Plan ━ ✔Critique ━ ●SetGoal ┄ ○Implement ┄ ○Verify ┄ ○Report   subgoals 0/5
         6m · top finding: "no check for empty CSV"
```

### teams Floor — watching the team work (user, 2026-10-16)

User: "https://github.com/pixel-agents-hq/pixel-agents 이런 느낌으로 서로 협업하느널 봤으면 좋겠어 좀;;
더 구체적이고 자세하게 사용자는 알 수 있도록", and "teams 여러개 돌렸을 때 대응 안되어 있는거 같고".

Then: "저걸 하라는게 아니라 저렇게 좀 이쁘게 사용자를 고려해서 쓰는 사람 친화적으로 하자고". The
references (statusline, pixel-agents) are the bar for care and friendliness, not features to copy: no
pixel art, no web office. What carries over is that a person can see who is doing what and how the
workers hand work to each other, drawn with care.

And: "저건 뭘하는지 눈에 캐릭터로 보이잖아 그런 직관적인걸 원하는거야 UIUX를 고려하자고". Then: "캐릭터눈 딱히 크게 필요는 없긴 한뎅" — no faces. **The rule for every mod (harness, teams,
graph, session): a glance, not a read.** Each worker's state is one icon and one colour (a spinner while
it acts), so a person knows what is happening before reading a word; the text beside it is the detail.
Same icons across mods:

```text
 ✎ editing    ⌕ reading    ▸ running a command    … thinking    ⚖ judging
 ✔ accepted   ✘ rejected, retrying    ◌ idle / waits    ⚑ waits on you
```

Floor at 110:

```text
  ✔ PLAN      done · 4 STORYs                                                        $1.20
  ✎ P2        editing form.ts — currency field · try 2/3                       9m    $2.35
    └ ⌕ sub   reading schema.ts
  ▸ P3        npm test -- invoice · 12 ✔ 1 ✘                                    4m    $0.90
  ◌ P4        waits for P1, P2
  ⚑ P2        asks you: "Keep the legacy invoice PDF route?"                   [answer]
  P1 ──✔──▶ P4  contract handed over       gate ──✘──▶ P2  negative currency accepted
```

Every mod card adds a UI/UX pass before it is done: show the person the `demo` render first, and fix
what they cannot read at a glance. The pieces below are the first draft of that:

- **Floor tab in the teams pane (Ink).** One desk per worker of the EPIC — PLAN, each package driver
  (P1…Pn), its subagents, QA, the gate judge. Each desk: a character glyph that changes with the action
  (✍ editing, 📖 reading, ▶ running a command, 💭 thinking, 💤 idle, ⚑ waiting on you), the current action
  in plain words with its file or command, try n/max, elapsed and cost. Between desks, the hand-offs
  as they happen: "P1 → P2  API contract accepted (gate 96%)", "gate → P2  rejected: negative currency",
  "P2 ⚑ you  Keep the legacy invoice PDF route?". The last few hand-offs stay as a short feed.
- **Several EPICs at once.** The pane's header lists every open EPIC of this checkout (`E-59a16f4f ●
  E-e4aa64a3 ●`), `[` / `]` switch, and the Floor can show all open EPICs' desks grouped by EPIC.
  Seen 2026-10-16: `view.mjs --once` lists two open EPICs but the pane follows one; tasks from 9 days ago
  still read `IN_PROGRESS` with no live driver — a dead task must read stalled/abandoned, not running.

Data: every desk comes from files the engine already writes — `drivers/*.stream.jsonl` (`tool_use`
name + input path/command → action; `parent_task_id` → subagent desks), `ledger.jsonl` (accept/reject/
fold → hand-offs), ask cards (→ ⚑). The parsing lives in `view.mjs` (node, tested), exposed as a
`floor` block in `--once --format summary`; the mod only draws it.

Floor at 110:

```text
╭─ Teams ─ E-3f9a21c0 ● Billing settings revamp   E-7c20aa11 ○ Search rate limit ──────── [ ] · 1-4 · q ─╮
│ Floor                                                                       2h 05m · $11.80 · 1/4 STORYs │
│                                                                                                         │
│  ✔ PLAN        done · 4 STORYs, 7 cards                                                         $1.20   │
│  ✍ P2 builder  editing src/settings/form.ts — currency field · try 2/3                     9m  $2.35   │
│     └ 📖 sub    reading src/settings/schema.ts                                                         │
│  ▶ P3 builder  npm test -- invoice  (12 passed, 1 failing)                                  4m  $0.90   │
│  💤 P4 builder  waits for P1, P2                                                                        │
│  ⚖ gate        judging P1 — done, 96% ✔                                                       $0.40   │
│                                                                                                         │
│  hand-offs                                                                                              │
│  17:42  gate → P2   rejected try 1: currency field accepts negative values                              │
│  17:40  P1 → P4    API contract accepted (gate 96%) — P4 still waits for P2                             │
│  17:38  P2 ⚑ you    "Keep the legacy invoice PDF route?"                                    [answer]    │
│                                                                                                         │
│ ● Floor 1  STORYs 2  Decisions 3  Log 4                                                                 │
╰─────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

## 4. Cards

**Fold-ins.** 27 → teams card (doing now, per-STORY elapsed/cost; the "driver per agent-list entry" ask becomes
the STORY rows, since drivers are `claude -p` children the agent list cannot show). 28 → teams card. 29 → split
into the three run cards (switcher, band `+N`, CLI lists all), then closed. 30 stays its own fix; the session
card depends on it.

Every card: engine field first with its node/python test, then the mod; `claude plugin test .` count reported;
seen live in tmux at 190 and 110 against §3; README/KOR shot per changed surface (mod.md "A UI change is done").
The band is the three-row one ("the detailed one is the band"), segments drop by priority, theme follows
dark/light, and a `demo` fixture renders `minimal`/`full`/`parallel`/`narrow` without a live run.

- **H. harness pane says what the run is doing.** Acceptance: engine writes `now.json` (`stage, doing, round,
  last_step, next, waiting, cost_usd`) and `manifest.started_at`, critique `problems[].severity`; the pane draws
  §3 harness (Now/last step/You lines, loop on the rail, round *n of max*, findings by severity, all critique
  rounds in Findings); `[`/`]` switch between two open runs of this worktree; the band shows harness runs only
  (graph row removed); `fallback-check.mjs --list` prints both runs; test with a rejected-critique fixture.
- **T. teams pane shows every STORY at work.** Acceptance: `view.mjs --once --format summary` lists all running
  tasks of the cwd and adds `items`, `last_verdict`, per-card `doing`, `cost_usd`, try/max from the child run;
  an S task with a live driver reads running with its harness stages (28's fixture); the pane draws §3 teams;
  `[`/`]` switch EPICs; `g` opens a STORY's graph run; band leads with ⚑ when anything waits; view tests cover
  two tasks, an L EPIC with three packages, and an S task.
- **G. graph pane: own band, owned runs, last step.** Acceptance: broker writes `owner`, `created_at`,
  `cost_usd`, `nodes[].last_step`; graph mod draws its own band row and skips owned runs; pane draws §3 graph
  with `[`/`]` over two standalone runs and the "under E-…/P2" tag when opened from teams; broker tests cover
  the new fields.
- **S. session memo and guard read as live state.** Depends on 30. Acceptance: memo pane shows scope, age,
  stale hint, sent-with-this-conversation time and size vs cap (§3 memo); guard pane lists stops with rule and
  source; both toggle by command, Esc, q; pane tests cover each.

## 5. Open questions

1. Per-plugin panes with a teams-owns-its-runs rule (recommended), or one shared "Runs" pane after all?
2. Graph gets its own band row, taken out of the harness band — agreed?
3. A standalone harness fallback run spends the session's own budget: show the session-cost delta since
   `started_at` as its cost, or `—`?
4. Critique severity as a new `problems[].severity` field changes the critique contract (harness + teams
   critique nodes) — approve, or keep counting the text prefix in the engine?
5. Keys `[` / `]` for runs and `g` for a STORY's graph run — fine, or another pair?
6. Session: is memo + guard the right "at a glance", or should the session band also carry the board's
   cross-session run count?

Taken 2026-10-16 as the recommended answers (the user approved the direction from the mockups, not each
question; any can be reopened): 1 per-plugin panes, teams owns its runs; 2 graph gets its own
band row; 3 `—`; 4 add `problems[].severity`; 5 `[` / `]` and `g`; 6 memo + guard only. No preset switch.
