---
key: E-aaaaaaaa
state: DONE
source: task.json@33
---

# Planning

2 planning card(s), one per feature area, each running the full harness in its own worktree; the planning integrate merges their sections into [the PRD](./10-prd.md) and judges it.

| card | area | state |
|---|---|---|
| PLAN-F1 | module a | DONE |
| PLAN-F2 | module b | DONE |

## PLAN-F1 — module a

state: DONE

run: plan1 at /wt/PLAN-F1

### Last verdict
accept: true · match_pct: 95

Checks:
- PRD reviewed -> covers the request

Gaps:
- (none)

## PLAN-F2 — module b

state: DONE

run: plan2 at /wt/PLAN-F2

### Last verdict
accept: true · match_pct: 94

Checks:
- PRD reviewed -> covers the request

Gaps:
- (none)

## Planning integrate

- plan-integrate:1: done · accept=true
