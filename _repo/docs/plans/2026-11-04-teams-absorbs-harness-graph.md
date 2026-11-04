# teams absorbs harness + graph — design

Follows `2026-10-17-graph-harness-into-teams.md` (card 48, frozen 2026-11-02 after Tasks 2–4 and half of 6).
This replaces its route: no `graph-harness` branch, no bench between graph and graph+harness, no change to
either plugin.

## Decisions (user, 2026-11-04)

- "S 사이즈 harness 실행(내장+codex가 있다면 codex쪽에도 위임(graph)) / L 사이즈부터 teams engine 실행 /
  기존 mod 통합 / 이후 관리포인트는 harness, graph stable로 두고 teams만 유지보수할거임".
- "harness에서 codex-integration만 넣은게 graph고 / 어디서 fire할지 codex, claude 안정한 상태에서
  integration에 위임해서 돌게 한다는 아이디어", "graph 자체가 이거일텐데 하네스 플로우에" — graph *is* the
  harness flow with per-node firing on Codex or Claude. teams already carries a superset fork of it
  (`teams/mcp/graph.mjs`, `broker.mjs`), so S runs as one graph run on that fork: no harness copy, no
  second engine.
- Ends the staged engine refactor (analysis 2026-11-04): its targets are folded in where this work touches
  them, not run as their own Sprints.
- harness and graph stay installed and stable, untouched. teams owns its copies from here; they may diverge.

## Shape

teams is one flow, and inside it a chain of harness runs (user, 2026-11-04: "teams가 받고 요건 분석하고 작게
나누고 목표 세우고 각 dev 등에 맡기고 처리(harness), qa처리(harness)", "dev도 dev1, 2, 3 여러 개 뜰 수도
있고", "teams는 요건을 분해하고 EPIC, STORY화해서 기획부터 쭉 하는 하나의 통합 플로우니까 내부적으로는
harness의 연속이고"):

```
request → teams: 요건 분석 → EPIC / STORY 분해 → 목표
            ├─ dev1  STORY ─┐
            ├─ dev2  STORY ─┼─ each one harness run (graph run, per-node Codex/Claude)
            ├─ dev3  STORY ─┘
            ├─ integrate
            └─ QA            ─  one harness run per QA card
small work (S): the same harness run, once, with no decomposition around it
```

So there is one unit of work — a harness run on teams' graph fork — and teams decides how many, in what
order, and with what goal. S is not a different engine; it is that unit with no EPIC/STORY layer.

Two layers, named apart: the **manager** (`taskmanager.mjs`: size, planning, EPIC/STORY, integrate, QA
cards) and the **run** (`graph.mjs` + `broker.mjs`: one harness flow, nodes fired on Codex or Claude). S uses
the run only, never the manager (user: "S는 team 엔진 안쓸거야 graph(harness나 마찬가지지)").

Today S leaves teams: `harnessPrompt` (`taskmanager.mjs`, `HARNESS_SKILLS = ['graph:orchestrate',
'harness:harness']`) tells a driver to use the graph plugin's MCP, else the harness plugin's Agent Team
fallback; the driver loads only the harness plugin, so both S tasks of 2026-11-04 ran `route: fallback`.
That dependency comes inside ("이 fallback으로 외부로 의존성을 돌리는걸 안으로 가져올거고"), and the
cleanup covers every tie from teams to the two plugins ("정리 작업을 전체적으로"): the S prompt and
`HARNESS_SKILLS`, the harness plugin dir on drivers, skill mounts of `graph:*` / `harness:*`, the
teams ↔ harness pairs in `check-copies.mjs`, and docs/README lines that send teams users to either plugin.
Done when `grep -rn "graph:orchestrate\|harness:harness\|plugins/cache/.*/\(harness\|graph\)/" teams`
finds nothing outside tests that assert the absence.

| Size | Runs on | Where a node fires |
|---|---|---|
| S | one graph run on teams' own broker: the harness flow (plan → setgoal → critique rounds with severity → implement → test → gate → report, `now.json` progress), what card 48 Tasks 2–4 put into graph brought into the fork where it lacks them; the driver no longer loads the harness plugin (`harnessrun.mjs` already reads a `route: 'graph'` pointer) | per node: Codex when the provider probe says it is ready for that stage, else Claude; the reason is recorded on the node |
| L and up | teams decomposes (planning → EPIC/STORY → goals), then each STORY (dev1…devN, in parallel) and each QA card is one harness run of the same kind as S; teams integrates between them | the same per-node choice, the same probe |

- One provider probe and one routing rule, in teams (`teams/mcp/routing.mjs` already holds the routing; the
  probe is what `providers.json` records today: available, ready, reachable, implement, test, reason).
  A provider that turns unready mid-run moves the next node to the other, recorded; never a silent switch.
- The S result is read the way it is now (goal gate + report), from teams' own run files.

## Where a run fires

| Host | Run goes to |
|---|---|
| Claude only | DW (the Workflow tool, harness's `pipeline.js` route) |
| Codex ready | teams' broker MCP, each node on Codex or Claude by the probe |

User, 2026-11-04: "claude만 있으면 DW를 쓸거고 codex가 있으면 별도 MCP로 위임해서 각각 맞게 호출하겠지".
Condition: the DW route writes the same run files as the broker route (`now.json`, critique rounds,
`04-goal-gate.json`, `05-report.md`) — today's S prompt forbids Workflow because it left no goal-gate
verdict on disk; the manager and the pane read one contract, whichever route ran.

## One entry

The person no longer picks harness, graph or teams (user: "내가 harness, graph, teams를 쓸지 안골라도
되고"). They hand the request to teams; size decides S (one run) or L (decomposition), and the probe decides
where each run fires. The routing tables that send people to `harness:harness` or `graph:orchestrate`
for new work (this repo's `CLAUDE.md` Workflow Entry Points, teams skills) point to teams only.

Figures: `images/teams-before.png` (S leaves teams today) · `images/teams-after.png` (one run unit, one
fire choice, one file contract, one pane); sources `images/teams-{before,after}.json`.

## Mods

One teams pane (the F1 page stack of `mod/2026-11-04-teams-pane-panels.md` § 확정안) draws S and L runs.
An S run is an EPIC whose rows are its subgoals; its STORY detail carries what the harness pane showed
(Now, Flow, Findings, Gate rules), and a finding opens to its full text (user, 2026-11-04, on a cut
critique line: "내가 왜 리젝됐는지 눌러서 확인도 안되네"). The harness and graph mods stay in their plugins,
unchanged; teams does not depend on them.

## Order

1. Land the two running tasks (E-0ad41780 socket, E-6ff25a30 test isolation).
2. Sprint: S as one graph run on teams' broker with per-node fire routing; drop the harness plugin from the
   S driver; the copy checks in `_repo/scripts/check-copies.mjs` that tie teams to harness (ROUTE/NODE
   blocks) become teams-only.
3. Sprint: the pane (card 125 pane scope + viewer URL removal) drawing S and L.

## Done when

- An S task runs with no harness plugin dir on its driver (`ps` / task.json command), and its report and
  goal gate are read from teams' run files.
- With Codex ready, an implement/test node fires on Codex; with Codex unready, the same node fires on
  Claude and the node records why. Both seen in one real run each.
- `node --test teams/scripts/test-*.mjs` at the pre-change count or higher with 0 failures;
  `claude plugin test` in teams; `harness/` and `graph/` show no diff.
- The pane shows an S run's findings in full on ⏎, at 190 and 110 columns, approved on the demo render.
