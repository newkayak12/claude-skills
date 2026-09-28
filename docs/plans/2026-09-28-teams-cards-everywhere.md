# teams: every phase runs on cards, every team runs the full harness

> Decided by the user, 2026-09-28. Supersedes: `2026-09-17-teams-team.md` §A "develop만 package"
> and its "`roles`로 planning/qa를 끄면 그 단계가 생기지 않는다(하위 호환)";
> `2026-09-21-teams-server-owns-the-loop.md` §3 (chain-only child runs).
> Keeps: `2026-09-17-teams-team.md` §2 fractal rule and "분할은 두 번, 기준이 다르다".

## Principles (fixed — changing any of these needs the user's approval first)

1. **6 phases inside 6 phases.** The EPIC runs plan → setgoal → critique → execute → quality gate →
   report, and so does every card inside it: planning, develop and QA alike. No team runs a
   chain without its own plan/setgoal/critique and gate:goal/report.
2. **A gate after every stage; the author never judges its own work.**
3. **Split twice, by different criteria.** Planning splits by feature (user stories); `shape`
   groups those stories by ownership into develop cards.
4. **Planning always produces its deliverables.** No setting and no request size skips them.
5. **Work is carried on cards.** Planning, develop and QA work each appear as STORY cards on the
   board, run in parallel where their deps allow.

## What changes

| # | Change | Principle |
|---|---|---|
| C1 | Develop cards run the full harness (revert of 09-21 §3); the card's `plan` is a build plan for that card, not a re-split | 1 |
| C2 | The EPIC's plan stage splits the request into feature areas; each area becomes a planning card (`PLAN/F1`, `PLAN/F2`, …) running the full harness in parallel | 1, 5 |
| C3 | Each planning card delivers its PRD section: goal, scope and non-goals, user stories with acceptance criteria, open questions | 4 |
| C4 | A planning integrate merges the cards into one `10-prd.md` and judges it: story-id collisions, contradictions between features, a feature the request names but no card covers | 2, 4 |
| C5 | `roles.planning: false` is refused (recorded as a note); `true` / `'light'` / `'auto'` remain | 4 |
| C6 | A size-S request also gets planning: one planning card before its run, so `10-prd.md` and `user_stories[]` always exist | 4 |
| C7 | QA splits the same way: one QA card per feature area (or per user-story group) on the integrated tree, running the full harness in parallel; their defects file fix STORYs as today | 1, 5 |

## Done when

- Any task, any size, any `team.json`: the task dir has `10-prd.md` and at least one user story.
- The board shows one planning card per feature area and one QA card per feature area.
- Every card's child run contains plan → setgoal → critique before its chain and gate:goal → report after it.
- `shape` still maps user stories to develop cards (`implements[]` must cover every story).
- Existing tests converted to the new shape, not deleted; new tests cover each row above.
