# teams: no sub-EPIC — too-big work carries into the next Sprint

> Decided by the user, 2026-09-28 ("서브 에픽이 어딨어 … agile 안해봄? / 스프린트", approved "고").
> Supersedes: `2026-09-17-teams-team.md` §2 "STORY를 L로 재면 sub-EPIC을 연다 … `max_depth`",
> its §7/§8b sub-EPIC rows, and `2026-09-28-teams-sub-epic.md` (never implemented).
> Keeps: every principle in `2026-09-28-teams-cards-everywhere.md`.

## Why

Agile has Initiative → Epic → Story → Subtask, and time is the Sprint. There is no Epic inside
an Epic. A story too big for one Sprint is split into more stories, or carried into the next
Sprint — not nested.

## What changes

| # | Change |
|---|---|
| S1 | The sub-EPIC plan is withdrawn; the 09-17 fractal-nesting rule is marked superseded. |
| S2 | `max_depth` is retired: a team.json that still sets it gets a deprecation note (not "unknown key"); `task.depth`, `child_opts.depth` and `run.depth` are removed. |
| S3 | The retro's Next backlog names the user stories the Sprint did not ship (`unfinished_stories`: implemented by no accepted package, or never integrated). The next Sprint's `tm_open({context_from})` folds them into its context and returns `carryover_candidates` (unshipped backlog items + unfinished stories). Nothing is added to `requests` on its own — the person chooses. |

## Done when

- No code reads `max_depth` or `depth` for nesting; setting `max_depth` yields a deprecation note.
- `retro.json` always has `next_backlog.unfinished_stories` (possibly empty).
- A follow-up `tm_open({context_from})` returns `carryover_candidates` and leaves `requests` as given.
- Tests cover S2 and S3; no test deleted.
