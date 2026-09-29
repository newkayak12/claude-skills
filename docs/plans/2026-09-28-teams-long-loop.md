# teams: L-only long loop; size S goes to the development harness

> The user decided this on 2026-09-28. Their words:
> - "사이즈 유지하지만 이 워크플로 자체는 기본 하네스와 함께 쓸거고 작은 사이즈는 하네스를 쓰는식이 맞을거임 / 이건 롱텀 루핑에 특화되어 있어야 함"
> - "s는 바로 개발 하네스로 넘겨서 claude, codex 참여 처리하면 되니까"
> - "사람은 시키고 결과만 받으면 장땡이지 중간 확인(뷰) 하면 되고"
>
> **Changes, approved by those words:**
> - `2026-09-28-teams-cards-everywhere.md` C6 and its "every task has a PRD" done-criterion: for size S only.
> - `2026-09-28-teams-sprint-not-sub-epic.md` S3 "the person chooses the carry-over": inside a loop the loop chooses, and a person may override from the view or tools.
> - `2026-09-28-teams-adversarial-fixes.md` m4 (the S QA card): withdrawn.
>
> **Keeps:** the S/L sizing, and every principle and gate inside an L Sprint.
>
> Revised after critique (`sound:false`, 10 problems; the L1b/L1c gate problems are moot now that the loop never parks), then again after re-critique (4 problems and 3 notes, all taken; G2b added from this session's own false positive).

> **Roles and scope limit (2026-09-29, the user's decision):**
> - The main session is the **master**: the interface that faces the user. It opens tasks and loops, reports results, and overrides with `tm_loop`.
> - The daemon runs the loop as code. Judgement nodes judge. The role leads (PM / Dev / QA) are the per-STORY child drivers.
> - Organisation is copied by **function, not form**. The only candidates are:
>   - a Dev→PM send-back channel (a `spec_defect` verdict field that retries planning);
>   - per-role judgement criteria for the leads.
> - Those two go in a separate plan. **Nothing beyond them**: no debate rounds, no meetings, no further org mimicry.

> **Revision (2026-09-29, the user's decision): the master is the loop.**
> - Their words: "ㄱ냥 돌리면 롱 루프고 / 이미 계속 세션을 할당하면서 가서 롱 루핑이 될텐데", then "고" to the revision below.
> - Inside a Sprint the daemon already runs long (driver respawn, capacity park/resume). Between Sprints `retro.json` → `tm_open({context_from})` → `carryover_candidates` already exists (`priorRetroContext`). The master opening the next Sprint with those is the loop.
> - **Dropped:** L1, L1a, L1b, L1c, L1d, L2 (loop option, loop file and lock, daemon-side open, loop caps, `tm_loop`, view panel). The master's own judgement and each Sprint's own box bound it.
> - **L3 kept, reworded:** the master picks the carry-over and opens the next Sprint; a person overrides only by choice.
> - **R1 added:** the one real gap. A `contradicts_decision` a Dev package raises in a non-interactive task lands on `task.unasked` (`escalateBlocking`), but `buildRetro` gathered `open_questions` from child runs only, so the next Sprint never saw "the spec is wrong". `buildRetro` now also gathers `task.unasked`, contradictions first, and the context/report show what each contradicts.
> - **The separate Dev→PM plan is dropped:** R1 is its whole function (the next Sprint's planning takes the contradiction). Per-role judgement criteria are shelved with it.
> - S1/S1a/S2 and G1–G4 are unchanged and not yet done.

> **Critique of the remaining scope (2026-09-29, `sound:false`, 9 problems, all taken):**
> - **G2:**
>   - An interpreter or shell anywhere in a simple command counts, not only as its first word. `timeout 5 python3 -c …`, `nice node -e …` and `env python3 - <<EOF` are judged like `python3 -c …`.
>   - `rg --pre`, `rg --pre-glob`, `less -o` and `less --log-file` are not read-only.
>   - Tests are added for `doas`, `stdbuf`, `ionice`, `parallel` and `watch`.
> - **G2b:**
>   - Heredocs are found with the quote-aware scanner. A heredoc that never closes means the whole command is judged as today.
>   - A data heredoc counts its body's paths when its body holds a write verb or a write-capable call. It also counts them when the same command line runs the file it writes (`cat > x.sh <<EOF … EOF; bash x.sh`).
>   - The write-capable list grows: `getattr`, `__builtins__`, `__dict__`, `globals`, `compile`, `Function`, `constructor`.
> - **G3:** a subgoal created while a STORY pin is held takes the run's saved model assignee on release.
> - **S1:**
>   - The driver loads the `graph` and `harness` plugins (`pluginDirArgs` gets `graph:orchestrate` and `harness:harness`), so a real S run is harness-gated. The test asserts both `--plugin-dir` entries.
>   - The driver never writes `task.json`. It writes the run pointer to `<taskDir>/harness-run.json` (`{route, run_id, cwd}` for graph; `{route: "fallback", run_dir}` for the fallback) as soon as the run exists. The manager copies it into `task.harness_run`.
>   - A restarted driver gets an S-specific resume prompt that names the recorded run and never opens a second one.
> - **S1a:**
>   - The manager reads the verdict itself: the graph run file's latest `gate:goal` and `report`, or the fallback run's own `04-goal-gate.json` and `05-report.md`.
>   - The driver's `harness-result.json` is dropped. A self-report is not the harness run's verdict.
> - **Round 2 (`sound:false`, 3 problems, all taken):**
>   - The Workflow route is dropped for the headless S driver: it leaves no goal-gate file on disk.
>   - A pointer is taken only for a run tagged with this task's id and created after the harness run opened. Without a pointer, the manager finds the tagged run itself.
>   - The S rows and SetGoal now say all of the above.
>   - A note is taken too: a data heredoc's body is judged by shell write verbs only, plus the call list when the file it writes is a script or is run later. So a commit message that says "remove" stays allowed.
> - **S2:** a legacy `s_run` whose run never finished and whose driver is dead reads `blocked` ("legacy size-S runs are not restarted"), never `running` forever.

## Plan

### S — size S runs on the development harness

| # | Change |
|---|---|
| S1 | **Who runs it:** the manager spawns one headless driver, using the same `spawnChildDriver` process mechanism packages use, in the project cwd. The driver loads the `graph` and `harness` plugin dirs (`graph:orchestrate`, `harness:harness`). Its prompt runs the development harness on the request (plus context and decisions), with claude and codex taking part.<br>**Route 1:** the `graph` MCP call `graph_open({request, cwd, isolated: false, allocation: "balanced", host_vendor, host_model, native_models})`, driven to its report.<br>**Route 2**, when that MCP is absent: the Agent Team fallback (`harness/engine/fallback.md`), with codex routing through `codex-exec-adapter.mjs`. `auto` falls back to Claude when codex is not ready, and that fallback is recorded as such.<br>The Workflow route is **not** used for a headless S driver, because it leaves no goal-gate verdict on disk.<br>**Tag:** the request passed to `graph_open` starts with `[teams-task <task_id>]`, and a fallback run's `manifest.json` carries `"teams_task": "<task_id>"`.<br>**Pointer:** the driver never writes `task.json`. As soon as its run exists, it writes `<taskDir>/harness-run.json`, either `{route:"graph", run_id, cwd}` or `{route:"fallback", run_dir}`. The manager takes a pointer only when the run it names carries this task's tag and was created after the harness run opened. Without a valid pointer, the manager finds the tagged run itself.<br>**Restart:** a restarted driver gets an S resume prompt that names the recorded (or found) run and forbids opening a second one.<br>The driver writes its final report to `<taskDir>/harness-report.md`. All of this works the same under `tm_run`, the daemon and CI. |
| S1a | **State:** the task state follows the harness run's own verdict, as read by the manager, never the driver's word.<br>**Graph route:** the manager reads the graph run file (`<cwd>/.harness-run/broker/runs/<id>.json`) as JSON; teams never imports `graph/mcp`. The run is finished when its report stage is done, and accepted when its latest `gate:goal` accepted.<br>**Fallback route:** the run is finished when `05-report.md` exists, and accepted when `04-goal-gate.json` has `pass`.<br>**States:** `running` while the driver is alive or will be respawned; `complete` when finished and accepted; `partial` when finished without acceptance; `blocked` when the driver died past its restart budget, unfinished. A usage-limit death parks on `waiting_capacity`, as a package's does. No new state name is added.<br>**Spend:** the S driver's own stream counts toward spend as today; graph run nodes carry no cost of their own.<br>`tm_status`/`tm_next`/`tm_wait` carry `harness: {route, run, report_path}`. |
| S2 | **The teams S machinery goes:** the S planning card, `openSRun`, the S run's own graph, S QA (m4), and `renderSReport`'s run reading.<br>A task already on disk with `s_run` resolves through a **frozen read-only path**: its state comes from its run file only, `s_qa` is ignored, and it is never respawned. A legacy run that never finished, with its driver dead, reads `blocked` ("legacy size-S runs are not restarted").<br>The reader branches (tickets, view, inspect, run.mjs, remove.mjs, bench) stay for such tasks. Their tests switch to legacy fixtures instead of being deleted. |

### L — the long loop

> L1–L2 are **dropped** by the 2026-09-29 revision above; kept here as the design history. L3 and R1 below are what ships.

| # | Change |
|---|---|
| R1 | **Retro carries task-level unasked questions:** `buildRetro`'s `next_backlog.open_questions` = `task.unasked` (contradictions first, each with `contradicts_decision`) + every child run's `unasked`. `priorRetroContext` and `renderRetro` print "(contradicts: …)" beside such a question. |
| L3′ | **Sprint skill step 5:** the master (the session that opened the Sprint) picks the next `requests` from `carryover_candidates` in priority order, treats every open question marked "contradicts" as a planning item for the next Sprint, opens it with `context_from`, and reports the pick. A person overrides only by choice. The master stops when nothing carries over or two Sprints in a row ship nothing, and says why. |

| # | Change (dropped) |
|---|---|
| L1 | **Turning it on:** `tm_open({loop: {...}})` (or team.json `loop`). Each Sprint is a normal L task and is **pinned L** (`size_pin_source: "loop"`), so a Sprint never hands off partway through the loop. |
| L1b | **Who opens the next Sprint:** the finished Sprint's daemon opens it, just before `daemon_done` and only after its report is done. So that a daemon that dies in between cannot stall the loop, `tm_status`/`tm_wait`/`tm_next` on a finished loop Sprint run the same locked open. It takes an exclusive lock on the loop file and does a compare-and-set on `loop.sprints[i].next_task_id`, so there is only ever one opener. The next Sprint is `tm_open` with `context_from` set to the finished task and `requests` set to the carry-over candidates, in priority order. Candidates are `unshipped_requests`, then `unfinished_stories`, then `unaccepted_packages`, then `unresolved_defects`: skipped and never-dispatched work is **included**, so a budget-stopped Sprint loses nothing. `open_questions` ride along as context. The pick is recorded on the loop file as decided-for-you. |
| L1c | **Never parks:** the loop continues whatever `interactive` says. A person steps in only by choice: `tm_loop({loop_id, stop})`, `tm_loop({loop_id, drop: [...], reorder: [...]})`, or the view. These write control fields under the loop lock, and the next opener reads them. Nothing waits on them. Inside a Sprint, `interactive`/`human_gates` are unchanged. |
| L1a | **Stops:** each stop records `loop.stopped = {reason, at}`. The reasons: `backlog_empty` (no candidates); `no_retro` (the Sprint ended without a `retro.json`, e.g. blocked); `max_sprints`; `budget` / `timebox`; `no_progress`, meaning `loop.no_progress_sprints` (default 2) consecutive Sprints shipped nothing (zero shipped stories and zero shipped packages by the retro's own measure); and `stopped_by_person`. |
| L1d | **Budgets:** these live under `loop.*`: `loop.budget_usd`, `loop.timebox_minutes`, `loop.max_sprints`, `loop.no_progress_sprints`. They are separate from a Sprint's own `budget_usd`/`timebox_minutes`. **A bound is guaranteed:** `loop.max_sprints` defaults to 5 when no loop cap is given, so a loop that ships one trivial item every Sprint still ends. Each Sprint's cap is `min(its own cap, what the loop has left)`, and loop spend is the sum of its Sprints' spend. |
| L2 | **Loop file and view:** `<tasksRoot>/loops/<loop_id>.json` is written by atomic rename, only under the loop lock. It lists the Sprints in order, each with task_id, state, shipped/unfinished counts, spend and the backlog picked, plus the stop reason. The view gets a loop panel showing the current Sprint, history, spend against the loop caps and the stop reason. `tm_status` of any Sprint shows its loop. |
| L3 | **Sprint skill:** `teams/skills/sprint/SKILL.md` step 5 changes from "never add them yourself" to: inside a loop the loop picks, and a person overrides with `tm_loop`; outside a loop the person still chooses. |

### G — gate/QualityGate follow-ups (a separate commit)

| # | Defect | Fix |
|---|---|---|
| G1 | A hand-written `.harness-run/broker/open-nodes.json` engages the gate. | Add `^/.harness-run/broker/` to `SELF` in `harness/hooks/goal-gate.mjs`. |
| G2 | `grep -n cp x.mjs` is denied: `WRITE_CMD` matches a verb anywhere. | **Deny by default.** A write verb still matches anywhere. It is exempt only as a plain argument of a known read-only command that owns the whole simple command (`grep`, `rg`, `cat`, `head`, `tail`, `less`, `wc`, `ls`, `echo` with no redirect, `git log`/`show`/`diff`/`status` without `--output`; with `--output=<file>` they write and stay denied, tested). Wrappers of every kind stay denied, known or not: `sudo`, `env`, `nohup`, `xargs`, `find -exec`, `bash -c`, `eval`, `command`, `exec`, `doas`, `stdbuf`, `ionice`, `flock`, `parallel`, `watch`. Tests: `grep -n cp x.mjs` is allowed; `sudo cp`, `xargs rm`, `find -exec rm`, `eval`, `command`, `exec` and `flock` stay denied. |
| G2b | An inline script (a heredoc or `python -c`) that only *mentions* a gated path in text is denied. This session's plan-doc edit hit it. | **Deny by default.** Today's rule stays whenever the script contains any write-capable call (file write/open-for-write, stream, copy/move/replace/remove, `exec*`/`subprocess`/`spawn`/`system`, `shutil`, `os.replace`, and so on). When the script contains no write-capable call, no paths in it count. The narrower real case is a heredoc fed as data (`cat > x <<EOF`): only its redirect target is written. That is judged over the whole pipeline: `cat <<EOF \| bash`/`sh`/`node`/`python` is a script, not data, and stays denied (tested). Tests cover both sides. |
| G3 | Releasing a STORY pin (`teams/mcp/graph.mjs` `applyStoryPin`) drops a model-written assignee. | Save it on pin and restore it on release. |
| G4 | Tests missing. | m1 prefix refusal (fold); M2 retro carries every request; M5 broker path, i.e. a `story_pin` queued while setgoal runs through `runNode` pins the subgoals setgoal's result creates. |

## SetGoal — done when

- **S1/S1a:**
  - A size-S task, judged or pinned, spawns exactly one harness driver in the project cwd.
    - Its prompt names the `graph_open` balanced call with the `[teams-task <id>]` tag, the Agent Team fallback with `teams_task` in the manifest, the pointer path and the report path.
    - Its argv carries `--plugin-dir` for both `graph` and `harness` (tested on `driverArgv`).
  - The task reads `running` while the driver runs, `complete` on a finished run whose goal gate accepted, `partial` on a finished run that did not pass, and `blocked` when the driver died past its budget. Each is tested on both routes, from the run's own files.
  - A pointer is refused when its run lacks this task's tag or was created before the harness run opened. With no pointer, a tagged run is found and used. Both cases are tested.
  - A restarted driver's prompt names the recorded run and says not to open another (tested).
  - No worktree, planning card or teams child run is created.
  - Tested with `HARNESS_TEST_NO_DRIVER` plus a fake driver.
- **S2:**
  - No code path opens an S run.
  - A legacy `s_run` task fixture (with `roles.qa` set and no `s_qa`) reads its run's state and is never respawned.
  - An unfinished legacy `s_run` whose driver is dead reads `blocked` (tested).
  - The reader tests pass on legacy fixtures, and no L test is deleted.
- **G (from the critique):**
  - **G2:** these are denied (tested): `timeout 5 python3 -c …`, `nice node -e …`, `env python3 - <<EOF` with a write call, `rg --pre`, `less -o`, `doas`, `stdbuf`, `ionice`, `parallel`, `watch`.
  - **G2b** (each tested):
    - A quoted `<<EOF` with no closing line does not swallow a later `cp`.
    - A data heredoc counts its paths when its body holds a shell write verb, or when its file is a script or is run later in the line.
    - A data heredoc of plain prose stays allowed, e.g. a commit message saying "remove stale teams/mcp/a.mjs".
  - **G3:** a subgoal created while the pin was held takes the run's model assignee on release (tested).
- **R1:** a test builds a non-interactive task whose `task.unasked` holds a `contradicts_decision` question and a plain one: `open_questions` lists both, the contradiction first with its field, and `priorRetroContext` text shows "contradicts". Fails without the fix.
- **L3′:** sprint step 5 says the master picks and opens; the KOR mirror (if any) follows.
- ~~**L1b/L1c:**~~ (dropped 2026-09-29)
  - With `loop` on, a Sprint whose report is done opens exactly one next Sprint, even when two openers race (tested), pinned L, with `context_from` set and `requests` set to the candidates, skipped packages included.
  - `tm_loop` stop/drop/reorder is applied at the next open.
  - A daemon killed between the report and the open does not stall the loop: `tm_status` opens the next Sprint (tested).
  - Nothing parks.
- ~~**L1a/L1d:**~~ (dropped) each stop reason is tested, a Sprint's cap is `min(own, loop remaining)`, and a loop with no caps stops at `max_sprints` 5.
- ~~**L2:**~~ (dropped) the loop file lists the Sprints in order, the view shows the loop panel, and `tm_status` carries the loop.
- ~~**L3:**~~ (superseded by L3′) the sprint skill text is updated in EN, with its KOR mirror if one exists.
- **G:** each item has a test that fails without the fix.
- **Suite and release:**
  - The full suite passes.
  - teams (and harness for G) README/KOR and configuration docs are updated.
  - The version is bumped and validated.

## Critique (against the principles)

- **Every L Sprint:** unchanged. It runs areas → areas-critique → cards → plan-integrate → shape/critique → develop → integrate → QA → audit → goal gate → report, all gates included.
- **S:** teams' C6 and PRD are withdrawn for S by the user's decision. S is planned and gated by the harness's own six stages (plan → setgoal → critique → implement → test → gate → gate:goal → report), so no gate is lost. Claude and codex both take part through balanced allocation or codex delegation.
- **Loop (revised 2026-09-29):** the master opens each Sprint; every Sprint keeps its own box and every gate, and R1 keeps a Dev's contradiction from being lost between Sprints. No new mechanism, so no new failure mode. The text below is the dropped design's critique.
- **Loop (dropped design):** it spends without a person, which is the user's stated intent. The loop budget, timebox, `max_sprints` and no-progress stops bound it. Every Sprint keeps its own budget and gates, and a person can stop it at any time from the view or `tm_loop`.
