---
name: sprint
description: >-
  Use when running a backlog as one boxed Sprint (budget/timebox, daily board, report, retro).
  Triggers: "스프린트 돌려줘", "run this as a sprint", "sprint this backlog", "다음 스프린트로
  이어가줘". Not for one request with no backlog/budget/timebox — use `orchestrate`.
scenarios:
  - "Open this backlog as a two-week sprint with a $40 budget"
  - "Show me where today's sprint stands"
  - "Close this sprint and start the next one with what's left over"
  - "이 백로그를 이번 스프린트로 열어줘, 예산은 40달러, 타임박스는 2주야"
  - "오늘 스프린트 현황 보여줘"
  - "이번 스프린트 마무리하고 남은 걸로 다음 스프린트 열어줘"
compatibility:
  required:
    - task-manager
related:
  - orchestrate
  - board
  - inbox
  - plan
---

# sprint — one Sprint of the task manager, start to close

A Sprint is `tm_open` plus four things the task manager already has, run in the order the Scrum
Guide names them: a bounded backlog (`requests`), a box on cost and time (`budget_usd` /
`timebox_minutes`), a daily look (`tm_board`/the viewer), a review against what actually shipped
(the report), and a retro that is not thrown away (`retro.json`, read back in by the next
Sprint's own `tm_open`). This skill is thin on purpose: every one of those five pieces already
exists as its own tool or field — nothing here is new mechanism, only the order to call it in.

## Process

0. **Brainstorm (optional) → `decisions`.** Before `tm_open`, while the user is here: read the
   project and the backlog first, then ask one question at a time - only what the user alone can
   answer (what they want, what to leave out, A or B), each with your recommendation. A backlog
   whose items already state their acceptance needs one or two confirmations, not an interview.
   Pass what was settled as `tm_open({decisions: [{question, chose, because?}]})`; every package
   reads them as rules. If the user skips it, the engine brainstorms from the backlog itself (a
   `brainstorm` node after size) and the report leads with what it decided on its own.
1. **Sprint Planning → `tm_open`.** Collect the Sprint's backlog as `requests: [...]` (priority =
   array order, item 0 highest — a single-item Sprint still works, but then `request` alone is
   simpler and unchanged). Set `budget_usd` and/or `timebox_minutes` to the Sprint's own box —
   neither is required, but a Sprint with no box is not really timeboxed. A backlog of two or
   more items with a box is pinned size L without measuring: the box stops by leaving the
   lowest-priority packages undispatched, and a one-run (S) task has no packages to leave. Set `interactive: true`
   if a person is actually around to answer an `ask` card during the Sprint; leave it `false` (the
   default) for a Sprint nobody is watching in real time — it still records what it would have
   asked (`tm_inbox`'s `decided`), which the retro surfaces either way. If this Sprint continues
   work a prior one left unfinished, add `context_from: "<prior task_id or E-xxxxxxxx>"` — see
   step 5.
   Planning always runs, on cards: the plan stage splits the backlog by feature area (each area
   names the backlog items it covers), one planning card per area writes that area's PRD
   section, and `plan-integrate` merges them before `shape`. `roles.planning` (default `'auto'`)
   picks each card's chain: a backlog whose items already state their acceptance (numbered items
   plus an `Acceptance for every item:` block, or `requests[].acceptance` / `shared_acceptance`)
   runs light (investigate → template-fill → gate, each card handed only its own items); anything
   else runs full (investigate → draft → revise → gate). Pass `'light'` or `true` to force either.
   `false` is refused with a note - investigate is what corrects wrong premises and uneven
   criteria, and no setting skips it.
2. **Confirm the plan.** Read back `tm_status({task_id})`'s `team.opts` (budget_usd,
   timebox_minutes, roles) and, once shape has run, `tm_status`'s `shape` block (max_parallel_width,
   fully_serial, bloated) — the same signals `critique` itself judges the shape against. This is
   the sprint's one planning checkpoint; nothing here blocks the daemon, which is already driving.
3. **Daily → `tm_board`/the viewer.** Call `tm_board({task_id})` for the STORY kanban, or point
   the human at `node teams/scripts/view.mjs --task <task_id>` for a live view — this skill makes
   no decisions here, it only points at the existing read-only tools (see `board`). If
   `tm_status`'s `budget` field shows `warn: true`, say so plainly (80% spent/elapsed); if
   `over: true`, say what `budget_stopped.skipped_packages` already lists — the daemon has
   already stopped opening new packages and reintegrated over what accepted, nothing to do but
   report it.
4. **Review → the report.** Once `tm_status` reads `complete` (or `blocked` with nothing left to
   drive), read the report doc (`tm_docs({task_id})` → `80-report.md`) — the human-facing account
   of what shipped, worth reading over what the daemon merely logged.
5. **Retro → `retro.json` → the next Sprint's context.** The same report stage already wrote
   `retro.json` beside `80-report.md` (docs.mjs's `renderRetro`): what failed and why, retries,
   defects left (`retrospective`), and backlog items not shipped / user stories not shipped
   (`unfinished_stories`) / unaccepted packages / unresolved defects / open questions nobody
   answered (`next_backlog`). Work too big for this Sprint is not nested into a sub-EPIC - it
   carries into the next Sprint. Do not re-derive any of this by hand — read the file, or let
   the next Sprint do it for you: `tm_open({..., context_from: "<this task_id>"})` folds it
   straight into the new task's `context` (`priorRetroContext`, taskmanager.mjs). The next
   Sprint's own `requests` still has to be written in the team's own words — `context_from` hands
   over what happened, not a ready-made backlog. `tm_open` returns `carryover_candidates` (the
   unshipped backlog items and user stories).
6. **Next Sprint — you pick, the person may override.** You (the session that opened the Sprint)
   are the loop: write the next `requests` from `carryover_candidates` in priority order, add each
   open question marked "(contradicts: …)" as a planning item (a package found a settled decision
   cannot hold), open it with `context_from`, and tell the person what you picked. A person
   steps in only by choice. Stop, and say why, when nothing carries over or two Sprints in a row
   shipped nothing.

## Output Template

```
Sprint E-a1b2c3d4 — budget $40 (62% spent) · timebox 14d (40% elapsed)

Backlog (priority order):
0. <highest-priority item>
1. <next item>
...

Board:
| key | role | state | tasks | last verdict |
|-----|------|-------|-------|--------------|
| ... |      |       |       |              |

Report: <80-report.md handoff, one paragraph>

Retrospective:
- What failed and why: ...
- Retries: ...
- Defects left: ...

Next backlog (carries into context_from):
- Unaccepted packages: ...
- Unresolved defects: ...
- Open questions: ...
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Offers the brainstorm (step 0) and passes what was settled as `decisions` | Say the backlog in your own words (`requests`, priority order) |
| Opens the task with `requests`/`budget_usd`/`timebox_minutes`/`interactive` set from what you actually said — never invents a budget or timebox | Say the box you want it held to (`budget_usd`/`timebox_minutes`) |
| Reads `tm_board`/`tm_status` for the daily check; names a budget warning or stop plainly | Decide whether anyone is around to answer an `ask` card (`interactive`) |
| Reads the report and `retro.json` at close, not raw node state; on a follow-up Sprint passes `context_from` | Read the retro and decide what of "Next backlog" becomes the next Sprint's `requests` |

## Related Skills

- `orchestrate` — the general single-request path this skill specializes for a boxed,
  reviewed, retro'd backlog
- `board` — the daily kanban/status call this skill's step 3 reuses verbatim
- `inbox` — a Sprint run with `interactive: true` parks decisions here; check it during the
  daily look
- `plan` — for a Sprint whose backlog itself needs planning/PRD work before shape can split it
  (`roles.planning`)
