# teams absorbs harness + graph — design

Follows `2026-10-17-graph-harness-into-teams.md` (card 48, frozen 2026-11-02 after Tasks 2–4 and half of 6).
This replaces its route: no `graph-harness` branch, no bench between graph and graph+harness, no change to
either plugin.

## Decisions (user, 2026-11-04)

- "S 사이즈 harness 실행(내장+codex가 있다면 codex쪽에도 위임(graph)) / L 사이즈부터 teams engine 실행 /
  기존 mod 통합 / 이후 관리포인트는 harness, graph stable로 두고 teams만 유지보수할거임".
- "harness에서 codex-integration만 넣은게 graph고 / 어디서 fire할지 codex, claude 안정한 상태에서
  integration에 위임해서 돌게 한다는 아이디어" — graph is not a second engine to merge; it is harness plus
  one choice: where each node fires.
- Ends the staged engine refactor (analysis 2026-11-04): its targets are folded in where this work touches
  them, not run as their own Sprints.
- harness and graph stay installed and stable, untouched. teams owns its copies from here; they may diverge.

## Shape

| Size | Runs on | Where a node fires |
|---|---|---|
| S | the harness procedure inside teams (plan → setgoal → critique rounds with severity → implement → test → gate → report, `now.json` progress) — the driver no longer loads the harness plugin | per node: Codex when the provider probe says it is ready for that stage, else Claude; the reason is recorded on the node |
| L and up | the teams engine, as today | the same per-node choice, the same probe |

- One provider probe and one routing rule, in teams (`teams/mcp/routing.mjs` already holds the routing; the
  probe is what `providers.json` records today: available, ready, reachable, implement, test, reason).
  A provider that turns unready mid-run moves the next node to the other, recorded; never a silent switch.
- The S result is read the way it is now (goal gate + report), from teams' own run files.

## Mods

One teams pane (the F1 page stack of `mod/2026-11-04-teams-pane-panels.md` § 확정안) draws S and L runs.
An S run is an EPIC whose rows are its subgoals; its STORY detail carries what the harness pane showed
(Now, Flow, Findings, Gate rules), and a finding opens to its full text (user, 2026-11-04, on a cut
critique line: "내가 왜 리젝됐는지 눌러서 확인도 안되네"). The harness and graph mods stay in their plugins,
unchanged; teams does not depend on them.

## Order

1. Land the two running tasks (E-0ad41780 socket, E-6ff25a30 test isolation).
2. Sprint: S on the built-in harness procedure with per-node fire routing; drop the harness plugin from the
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
