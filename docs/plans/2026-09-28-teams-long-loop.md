# teams: L-only long loop; size S goes to the development harness

> The user decided this on 2026-09-28. Their words:
> - "사이즈 유지하지만 이 워크플로 자체는 기본 하네스와 함께 쓸거고 작은 사이즈는 하네스를 쓰는식이 맞을거임 / 이건 롱텀 루핑에 특화되어 있어야 함"
> - "s는 바로 개발 하네스로 넘겨서 claude, codex 참여 처리하면 되니까"
>
> - **Changes:** `2026-09-28-teams-cards-everywhere.md` C6 ("a size-S task is planned too"), for S only. `2026-09-28-teams-adversarial-fixes.md` m4 (the S QA card) is withdrawn.
> - **Keeps:** the S/L sizing, and every principle for L tasks.
> - **Pending the user's decision:** L1b and L1c.

## Plan

| # | Change |
|---|---|
| S1 | **Size S hands off to the development harness.** When `size` returns S (or `tm_open({size:"S"})`), teams opens no planning card, no S run and no QA. The task closes as `handed_off`. It returns a handoff: the request, context and decisions, plus the harness call to make. That call is the `graph` MCP `graph_open({request, cwd, allocation: "balanced", host_vendor, host_model})` when connected, otherwise the `harness` skill Workflow with `codex_provider: "auto"`. In both, claude and codex participate. The `teams` entry skill relays it and runs the harness. |
| S2 | **Remove the S machinery.** This covers `openSRun`, S planning, `toolNextSRun`, the S driver and daemon branch, `renderSReport` and S QA (m4). An old task already holding an `s_run` still resolves its state read-only, so nothing on disk breaks. The docs drop the S paths. |
| L1 | **Sprint auto-continuation (the long loop).** When a Sprint's report is done and `loop` is on (`tm_open({loop: {...}})` / team.json), the manager opens the next Sprint itself: `context_from` is the finished task and `requests` is chosen per L1b. |
| L1a | **Stop conditions:** no carry-over left; the loop's total `budget_usd` / `timebox_minutes` spent; `max_sprints` reached; no progress (the same unfinished story carried N Sprints running, default 2); a person stops it (`tm_loop({stop})`). The loop records why it stopped. |
| L1b | **Who picks the next backlog** (pending). Options: (a) every candidate, in priority order; (b) the top N; (c) a person approves between Sprints (a `human_gates`-style card, auto-passed with (a) when not interactive). |
| L1c | **Default between Sprints** (pending). Proposed: non-interactive continues automatically; interactive parks at the gate. |
| L2 | **A loop ledger:** `loop.json` beside the tasks lists Sprints in order, each with task_id, state, shipped/unfinished counts and spend. `tm_status` shows it. |
| G | **Gate follow-ups from QualityGate:** gate writes to the broker ledger (`.harness-run/broker/`); a write verb counts only in command position (`grep cp x.mjs` is a read); releasing a STORY pin restores a model-written assignee. Add tests for the m1 prefix rule, M2 request carry-over, and M5's broker path. |

## SetGoal — done when

- **S1:** a size-S task (judged or pinned) ends `handed_off`. Its reply carries the graph and harness calls with claude and codex participating. No worktree, child run or driver is created.
- **S2:**
  - No code path opens an S run.
  - An old `s_run` task still reports its state.
  - The S tests are replaced by handoff tests; no L test is deleted.
- **L1/L1a:** with `loop` on, a Sprint whose retro has unfinished stories opens the next Sprint with `context_from`. Each stop condition is tested and records its reason.
- **L2:** `loop.json` lists the Sprints in order, and `tm_status` shows it.
- **G:** each follow-up has a test that fails without the fix.
- **Suite and release:**
  - The full suite passes.
  - README/KOR (teams) and configuration docs are updated.
  - The version is bumped and validated.

## Critique (against the principles)

- **P1–P5 for L:** unchanged. Every L Sprint still runs areas → areas-critique → cards → plan-integrate → shape/critique → develop → integrate → QA → audit → goal gate → report.
- **C6 for S:** withdrawn by the user's decision. S is planned and gated by the harness's own six stages (plan → setgoal → critique → …), so no gate is lost. The teams PRD artifact is lost for S, and that loss is accepted.
- **L1:** an automatic loop could spend without a person. The budget, timebox, `max_sprints` and no-progress stops bound it, and each Sprint keeps its own gates.
