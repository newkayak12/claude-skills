# graph + harness into teams — Implementation Plan

> Produced by write:plans. Owner for execution routing: planning:executing-plans; in this repo the
> tasks run as teams Sprints (`.claude/rules/backlog.md`). Steps use checkbox (`- [ ]`) syntax.
> Code is written by the Sprint nodes, so tasks name files, interfaces and pass bars, not code.

**Goal:** teams becomes the long-term home of the harness procedure and the graph engine; harness
and graph stay as stable plugins for back-compat. **Architecture:** a `graph-harness` branch folds
harness's procedure into graph; a seeded, repeated-run bench judges it against graph per axis; the
winner replaces teams' forked engine on a `teams-graph` branch; harness and graph then freeze.
**Tech Stack:** node (graph broker MCP, harness engine scripts), `node --test`, the teams bench
(`teams/scripts/bench/`).

---

## Decisions this plan rests on (2026-10-17, user)

- "결과적으로 하위호환을 위해서 harness, graph를 두지만 (stable) 장기적인 방향은 teams";
  "harness, graph는 각자 다른 자신들의 방향을 찾는게 맞을거 같다".
- graph exists because harness needed to block on `codex exec` (split 2026-08-30): "harness에서
  codex-integration을 꿈꾸다 실패해서 분화시킨게 graph".
- Step 2 is judged per axis with repeated runs (debate log
  `.claude/brainstorming/graph-harness-eval.jsonl`, finalist F2): "여러 번 돌려보는게 맞을거 같음".

## Facts surveyed

- `teams/mcp/graph.mjs` (2066 lines) and `broker.mjs` (2448) are a superset fork of
  `graph/mcp/graph.mjs` (588) and `broker.mjs` (1687): 50+ exports only in teams (flows/kinds, human
  gates, decisions, goal consensus, repair, write scope), none only in graph.
- harness has what graph lacks: multi-round critique with `problems[].severity`, `now.json`
  progress and `--list` (`harness/engine/fallback-check.mjs`), the goal gate
  (`harness/hooks/goal-gate.mjs`), Codex delegation (`harness/engine/codex-exec-adapter.mjs`),
  Workflow (`pipeline.js`) and fallback paths.
- A bench already exists: `teams/scripts/bench/` (arms `beta`/`betas`/`skills`/`stable`/`none`,
  fixtures incl. `seam`, `trap`, scorer `score.mjs`, harvester `harvest.mjs`).

---

### Task 1: graph-harness branch and worktree
**Files:** none changed; branch `graph-harness` from main, worktree outside the main checkout.
**Interfaces:** produces the branch every later task commits to.
**Blocked by:** none
**Pass bar:** `git worktree list` shows the worktree on `graph-harness`; graph and harness test
suites pass there at main's counts (graph 161/0/1, harness 39/39, goal-gate all passed).

- [ ] create branch + worktree → run both suites → record counts in the task report

### Task 2: critique rounds with severity in graph
**Files:** modify `graph/mcp/graph.mjs`, `graph/mcp/broker.mjs`, `graph/mcp/prompts.mjs`;
test `graph/scripts/test-broker.mjs`.
**Interfaces:** produces critique nodes `critique:N` carrying `problems[].severity`
(blocker/major/minor/nit) and a `max_critique_rounds` limit — the same contract harness's
`fallback-check.mjs --show --json` returns.
**Blocked by:** Task 1
**Pass bar:** a broker test with a rejected-then-accepted critique fixture yields two critique
rounds with severities and stops at the round limit.

- [ ] failing broker test → implement → pass → commit

### Task 3: progress record (`now.json`) and run list in graph
**Files:** modify `graph/mcp/broker.mjs`, `graph/mcp/store.mjs`; test `graph/scripts/test-store.mjs`.
**Interfaces:** produces per-run `now` (stage, doing, round, last_step, next, waiting, cost_usd) and
`runs --list` ordered waits-on-you → newest failure → newest change.
**Blocked by:** Task 1
**Pass bar:** store tests assert every `now` field and the list order on a two-run fixture.

- [ ] failing test → implement → pass → commit

### Task 4: goal gate and Codex delegation reachable from graph
**Files:** modify `graph/mcp/routing.mjs`, `graph/hooks/node-gate.mjs`; reuse
`harness/engine/codex-exec-adapter.mjs` by import, not copy; test `graph/scripts/test-routing.mjs`,
`graph/scripts/test-node-gate.mjs`.
**Interfaces:** consumes Task 2's critique contract; produces a gate verdict per run and a Codex
route that degrades to Claude with `providers.ready=false` recorded (auth 401 today).
**Blocked by:** Tasks 2, 3
**Pass bar:** routing test shows Codex unavailable → Claude fallback with the reason recorded;
node-gate test denies a gated write outside a run and allows it inside one.

- [ ] failing tests → implement → pass → commit

### Task 5: bench axes and seeded problem set (pre-registered)
**Files:** create `teams/scripts/bench/requests/gh-*.txt`, fixtures under
`teams/scripts/bench/fixtures/`, and `teams/scripts/bench/AXES.md` (axes, rubric, minimum effect
size) — written and committed before any arm runs.
**Interfaces:** produces the axis list and ≥3 seeded problems per axis consumed by Task 6.
Axes (from teams user pain): verified output (hidden tests), defect caught before implement,
recovery keeps accepted work (stranded package), tool-denied handled as blocked, red baseline not
charged to the change, cross-area seam settled, progress visible, decisions surfaced, cost and
time. Codex delegation: listed, marked unmeasured while auth fails.
**Blocked by:** none (parallel with Tasks 1–4)
**Pass bar:** `AXES.md` committed with a hash recorded before Task 6's first run; every axis has ≥3
problems, each with a hidden check.

- [ ] write axes and rubric → build fixtures → commit → record hash

### Task 6: run graph vs graph+harness, repeated, blind
**Files:** modify `teams/scripts/bench/bench.sh` (arm `graph-harness`), `score.mjs`; output in
`tmp/` only.
**Interfaces:** consumes Tasks 4 and 5; produces `tmp/bench/<date>/` raw runs and a per-axis table.
**Blocked by:** Tasks 4, 5
**Pass bar:** each problem × arm run 3 times; arms anonymized before judging; judge on Opus
(authors Sonnet); a table per axis with win/tie/loss, min/median/max and "below minimum effect"
where it applies; no total score.

- [ ] add arm → dry-run one problem → full run → judge blind → table

### Task 7: strengthen graph+harness on its weak axes
**Files:** whichever Task 6 names; each fix with its own test.
**Interfaces:** consumes Task 6's table.
**Blocked by:** Task 6
**Pass bar:** every axis where graph+harness lost is either re-run and no longer lost, or recorded
as accepted with the reason; report written (`05-report`-style section in the Sprint report).

- [ ] per weak axis: failing test → fix → re-run that axis 3× → record

### Task 8: teams-graph branch — replace teams' forked engine
**Files:** branch `teams-graph`; replace `teams/mcp/graph.mjs`, `teams/mcp/broker.mjs` with the
graph+harness engine plus the teams-only exports (flows/kinds, human gates, decisions, goal
consensus, repair, write scope) re-homed as teams layers.
**Interfaces:** consumes Task 7's engine; produces one engine, no fork.
**Blocked by:** Task 7
**Pass bar:** `node --test teams/scripts/test-*.mjs` at main's count or higher with no new failures;
one real size-L Sprint on a bench fixture completes with integrate and goal gate.

- [ ] expand (import graph engine beside the fork) → migrate callers → contract (delete fork)

### Task 9: freeze harness and graph as stable
**Files:** `harness/README.md`, `harness/KOR.md`, `graph/README.md`, `graph/KOR.md`,
`.claude/rules/maintaining.md` (a "stable plugins" line).
**Interfaces:** none.
**Blocked by:** Task 8
**Pass bar:** both READMEs (and KOR mirrors) state stable status and point new work to teams;
validator and check-copies pass.

- [ ] reword → checks → commit

## Gap and ambiguity check

- Each task's inputs come from an earlier task (2,3→4; 4,5→6; 6→7; 7→8; 8→9). Task 5 runs in
  parallel with 1–4.
- Open by design: harness's and graph's own future directions ("각자 다른 자신들의 방향") are
  not planned here; each gets its own card after Task 9.
