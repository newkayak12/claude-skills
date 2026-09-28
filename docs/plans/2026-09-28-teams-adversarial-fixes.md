# teams + harness gate: fixes from the adversarial verification (2026-09-28)

> Approved by the user, 2026-09-28 ("전체. 이거 teams를 계속 사용하기 어려운 수준에 머물러 있어서").
> Governing docs: `2026-09-28-teams-cards-everywhere.md` (principles 1-5, C1-C7),
> `2026-09-28-teams-sprint-not-sub-epic.md` (S1-S3), `harness/hooks/README.md` (gate design rules).
> Nothing here removes a stage, a gate or a principle. G and M4 add gates.

## Plan

### Gate (harness `goal-gate.mjs` and this repo's copy)

| # | Defect | Change |
|---|---|---|
| G1 | The deny message holds the unlock string, so a retry passes. Mentioning the engine path anywhere also unlocks | Engagement comes only from a record, never from transcript text: (a) a `tool_use` block in the transcript — `Workflow` with `scriptPath` ending `harness/engine/pipeline.js`, or an MCP tool ending `graph_open`, `tm_open` or `tm_run`; (b) an open broker node; (c) an open fallback run (below); (d) a marker (teams `engage.mjs`). The deny message names no string that would count. |
| G2 | Config is read from the hook's `cwd`, so `cd` into a subdir, or a worktree without the config, is ungated. Unanchored patterns also gate `/tmp` | The root is the nearest ancestor of the target file that holds `.claude/harness-gate.json`, else `CLAUDE_PROJECT_DIR`. Only files inside the root are gated. Patterns match `/`+root-relative path, case-insensitive. |
| G3 | The gate's own config, hook, settings and markers are not gated | Those paths are always gated, whatever `patterns` says. |
| G4 | Bash edits bypass the gate | Bash is inspected: redirects, `tee`, `sed -i`/`perl -i`, `cp`/`mv`/`rm`/`install`/`truncate`/`dd of=`, and inline scripts (`node -e`, `python -c`, heredocs) that name a gated path are denied unless engaged. A heuristic: the remaining holes are listed in the README. |
| G5 | A marker with a future timestamp never expires. A hand-written broker ledger engages | Markers and ledger timestamps more than 60s in the future are ignored. Writes to them are gated by G3/G4. |
| G6 | `.harness-run/` and `.claude/settings.local.json` are not gitignored. The patterns miss `.cjs`/`.MJS`/`skill.md` | Add both to `.gitignore` (repo and `install.mjs`). Patterns become `\.[cm]?js$` (case-insensitive via G2). Install adds `Bash` to the hook matcher. |

A fallback run is open (G1c) when all of the following hold:
- `.harness-run/<slug>/` has `manifest.json`, a non-empty `01-plan.md`, a `02-goal-spec.json` that parses with at least one subgoal, and `02-critique.json`.
- It has no `05-report.md`.
- It changed within `window_hours`.

So an edit needs plan, setgoal and critique on disk first, as `CLAUDE.md`'s Design Changes rule already requires.

### teams — majors

| # | Defect | Change |
|---|---|---|
| M2 | A planning failure ends blocked with no report, no retro and sometimes no PRD. Triggers: `areas` exhausted, a planning card exhausted, or `plan-integrate` exhausted | Once a planning-phase node fails for good and no packages exist, the task closes to a report: every pending node is skipped and a `report` node opens, as the budget `before_shape` path already does. `task.planning_failed` records `{node_id, reason}`. The report and retro say that planning failed and why, and whether a PRD exists. The whole backlog carries forward. |
| M3 | A QA card that exhausts its retries makes the goal gate unreachable. Its siblings' defects are then neither filed nor listed | A QA card that failed for good counts as settled in `settleQaRound`. The siblings' defects are filed (or recorded as unresolved past the cap). The goal gate is rewired onto the remaining QA accepts, or onto the integrate, and restored to `pending` if it was marked unreachable. `task.qa_not_run` names the dead card and the goal gate's prompt shows it. |
| M4 | A bad `areas` split can't be detected or undone. `human_gates: ['plan-integrate']` is ignored | **New gate `areas-critique`** after `areas` (principle 2: a gate after every stage). It checks the split for coverage, overlap and granularity. A refusal re-splits (`retryAreas`, same budget). Planning cards wait on it. **`plan-integrate` may return `resplit`**: its cards are retired (kept as evidence, dropped from the PRD, stories and QA) and a new `areas` attempt runs. `areas-critique` and `plan-integrate` join `HUMAN_GATE_VERDICT_FIELD`. |
| M5 | A STORY pin made while the child's setgoal runs is lost | `applyStoryPin` also pins subgoals that already exist. The broker drains the pin queue when it reloads a run after a vendor call. |
| M6 | A size-S task never writes `retro.json` | The S report path writes `retro.json` too. Its stories count as shipped when the S run completed without being settled and its goal gate accepted. |
| M7 | A story two packages implement counts as shipped when only one is accepted | A story ships only when every package implementing it is accepted and integrated. |
| M8 | Any done integrate counts, even one superseded or followed by a failure. A package accepted after the last integrate also counts | Only the latest integrate that is not superseded counts, and it must be `done`. A package counts only if its accept is among that integrate's deps. |

### teams — minors

| # | Change |
|---|---|
| m1 | A planning card with no PRD text is refused. So is a story with no acceptance, or one whose id lacks the card's `F<n>-US-` prefix. |
| m2 | A budget stop before shape settles running planning dispatches (grace applies), as a stop after shape does. |
| m3 | Author ≠ judge under ordered allocation: `critique` never gets the vendor@model that ran `setgoal`, and `gate:goal` never gets the one that ran implement or draft. |
| m4 | Size S gets a QA card over the S run's working tree. Done-when #2 of the cards doc becomes true for S. |
| m5 | The misleading test name at `test-taskmanager.mjs:916` is renamed. A `tm_open` test is added for story carry-over candidates, which now keep `card`. |
| m6 | `runlog.mjs`: planning, QA and audit cost buckets roll up by phase, and the id regex accepts `-`. |
| m7 | `qaCards` on a resumed old task names its card `QA-F1`, not `QA-PLAN`. |
| m8 | `tm_ticket`'s error lists the cards. Shape may not name a package `PLAN-*`, `QA-*` or `AUDIT*`. |
| m9 | `foldChild` ignores a skipped (superseded) `gate:goal`. |
| m10 | `planAuthorIdentity` returns every card's author. |
| m11 | Package ids compare as strings in retro and carry-over. A `null` story is dropped, not given the id "null". |
| m12 | Every package kind gets the verbatim-acceptance `package` block: repair, planning, QA, audit, defect and upstream-fix. It claims a manager critique only where one ran. |

## SetGoal — done when

- **G1:** a transcript that contains the deny text or the engine path as prose does not engage. A `Workflow` `tool_use` of `pipeline.js`, an open fallback run and a live broker node each engage. Covered by a new `harness/scripts/test-goal-gate.mjs`.
- **G2–G5:**
  - A subdir cwd and a nested root are gated.
  - `/tmp/x.mjs` is not gated.
  - Editing `.claude/harness-gate.json` or `settings.json` while not engaged is denied.
  - `echo x > teams/mcp/a.mjs`, `sed -i` and `node -e "writeFileSync('…mjs')"` are denied. `node teams/scripts/test-x.mjs` is allowed.
  - A future-dated marker does not engage.
- **M2:** an `areas`, planning-card or `plan-integrate` exhaustion ends with `80-report.md` and `retro.json` written, with `next_backlog` carrying every request. Tested for each of the three causes. The existing blocked-outcome test is updated to assert the report instead of `blocked`; its scenario is kept.
- **M3:** one QA card exhausted and a sibling with defects means the sibling's defects are filed and the goal gate runs. Tested.
- **M4:**
  - `areas-critique` exists behind every `areas` attempt, and a refusal re-splits.
  - A `plan-integrate` `resplit` retires the cards and opens `areas:N+1`; new cards get fresh ids and no second `shape` node appears.
  - `human_gates` accepts `areas-critique` and `plan-integrate`.
  - Each is tested.
- **M5–M8:** one test each, reproducing the verifier's scenario.
- **m1–m12:** one test each where behaviour changes (m5's rename excepted).
- **Suite and release:**
  - The full suite passes, allowing only the known flakes #126/#127, which must pass on rerun. No test is deleted.
  - Golden docs change only in the intended lines.
  - `README.md` and `KOR.md` (teams, harness) and `CHANGELOG` are updated.
  - Bumps pass `validate_plugins.py`.

## Critique (against the principles)

- **P1, 6 phases inside 6 phases:** unchanged. `areas-critique` is a manager-graph gate, not a new phase.
- **P2, a gate after every stage and author ≠ judge:** strengthened.
  - M4 closes the one ungated stage (`areas`).
  - m3 enforces author ≠ judge where ordered allocation broke it.
  - M3 keeps the goal gate reachable instead of dropping it.
- **P3, split twice:** unchanged. A re-split re-runs the first split; it does not add a third.
- **P4, planning deliverables always produced:**
  - M2 makes a failed planning phase still produce a report and retro, and the PRD when any card finished.
  - m1 stops an empty PRD passing as one.
- **P5, work on cards:**
  - m4 gives S its QA card.
  - m12 gives every card the same acceptance block.
- **Sprint (S3):** M6–M8 make carry-over correct. The person still chooses.
- **Risks:**
  - M4 retiring cards touches every `planningPkgs` reader. Mitigation: a raw accessor for id allocation, and a live one for everything else.
  - G4 is heuristic. Its holes are documented, not hidden.
  - m4 (S QA) runs QA over an uncommitted working tree. The QA card reads that tree and writes nothing to it.

## Revision after critique (critic verdict `sound:false`, 14 problems — all taken)

| Item | Revised mechanism |
|---|---|
| G1(c) | An open fallback run also needs `02-critique.json` with `sound === true`, no older than `02-goal-spec.json`. The README lists the remaining hole: a session can write its own run files. |
| G1(a) | A `tool_use` counts only if its `tool_result` is not an error and it falls within `window_hours`. |
| G2 | When no config ancestor exists, the root is resolved through `git rev-parse --git-common-dir`, so a sibling worktree of a gated repo is gated. The ledger and markers are read from that root. |
| G4 | README design rule amended: "deny edit tools, and Bash commands that write gated paths". It stays fail-open. `git checkout/restore/apply/stash` and `patch` that name a gated path are denied too. What remains a hole is listed. |
| G6 | `Bash` goes into the matcher in `harness/hooks/hooks.json`, `harness/skills/install/templates/settings-hook.json` and `.claude/settings.json`. `remove.mjs` undoes the new `.gitignore` lines. Done-when gains `cmp harness/hooks/goal-gate.mjs .claude/hooks/goal-gate.mjs`. |
| M2 | The close path waits until nothing runs. It treats `unreachable` and `pending` alike, skipping them with reason `planning failed`. It writes `10-prd.md` with `renderPrd` itself whenever at least one card accepted. |
| M3 | Called from the exhaustion path, not only a QA accept. It restores the whole set `settleFailure` made unreachable behind the goal gate (the goal gate and the report) to `pending`. |
| M4 retire | `planning_pkgs` stays raw, with `retired: true` on the retired cards. So `phaseOfId`, the board, tickets and id allocation are unchanged. Only the PRD, stories, QA and shape-coverage readers skip retired cards (`livePlanningPkgs`). |
| M4 resplit | A resplit `plan-integrate` is marked failed (`resplit`), not done, so shape never becomes ready. `areas:N+1` expands with `withShape:false`: a new `plan-integrate` supersedes the old one, and shape's deps are rewired to it. The card-opening guard becomes "no live card". |
| M4 areas-critique | Cards open only after `areas-critique` accepts. A refusal is a failed critique: `retryAreas` treats a failed critique like a failed split and settles both when exhausted, which triggers M2. Routing keeps the critic's vendor@model away from the `areas` author (m3's rule). The human verdict is `sound`: false → re-split. A human `plan-integrate` refusal may carry `resplit: true` in its payload. |
| M8 | A package ships if its accept is in the transitive dep closure of the latest non-superseded integrate, and that integrate is done. This covers repair and defect-fix reintegrates. |
| m4 | When the S run completes: `git stash create` snapshots the working tree without touching it, and a worktree opened on that commit is the QA card's tree. Its defects go to `task.unresolved_defects`, since S has no packages to file fixes onto. The S report lists them. The report waits on the QA card. |
| m10 | `planAuthorIdentity` returns an array. `reviewIndependence` and the audit caller are updated and tested. |
| SetGoal | Golden files: `80-report.md` and `retro.json` under `teams/scripts/fixtures/golden/`. Expected hunks: the new report/retro lines only (checked by reading `git diff` of those two files). Added criteria: G5 ledger test, G6 matcher and gitignore tests in `test-lifecycle.mjs`, and a hook-copy `cmp`. |
