# Cards 40–43: who owns each boundary (2026-10-20)

E-cec6daae planned cards 43 S, 40 H, 42 G and 41 T as four PRDs and stopped at plan-integrate:
the PRDs disagreed at three boundaries, and each fix landed on both sides. These rulings settle
them; where a PRD below says otherwise, this page wins.

| PRD | Card | File |
|---|---|---|
| F1 | 43 S session memo and guard | `2026-10-18-f1-session-memo-guard-prd.md` |
| F2 | 40 H harness pane | `2026-10-18-f2-harness-pane-prd.md` |
| F3 | 42 G graph pane | `2026-10-18-f3-graph-pane-prd.md` |
| F4 | 41 T teams pane | `2026-10-18-f4-teams-pane-prd.md` |

## Rulings

1. **Harness status line `graph Implement(n)` count** — F2 alone removes it (countStages/stageStatus
   in `harness/hooks/mod.tsx`, its `mod.test.ts` cases, harness README/KOR). F3 drops its copy
   (F3-US-7) and only relies on it being gone.
2. **`owner {task_id,key}` from teams to graph runs** — F4 alone writes it: the one pass-through in
   `teams/mcp/taskmanager.mjs`. F3 drops its copy (F3-US-8) and only reads `owner`; a run without
   `owner` is graph-owned.
3. **teams → graph hand-off** — the contract is F3's pinned command
   `/graph-status open <run-file> <owner-key>`. F4's `g` key calls exactly that, enabled only when
   the run file exists.
4. **`[` and `]`** — stop at the ends in every pane (no wrap): F2, F3 and F4 alike.

## Order

F1 has no dependency. F2 and F4 own the shared changes, so they land before F3; F3 builds on both.
