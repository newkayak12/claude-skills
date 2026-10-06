---
name: deprecation-and-migration
effort: high
description: >-
  Use when dropping, renaming, or retiring a column, table, API, or feature others may use — counts consumers, plans
  expand/contract, recommends deprecate vs keep. Triggers on: "컬럼 지우는 마이그레이션", "이 API 없애자", "drop this column".
scenarios:
  - "Rename users.name to full_name on a live table with 5M rows, no downtime"
  - "We want to delete the /v1/export endpoint — can we just remove it?"
  - "Is it safe to sunset our old notification service, or should we keep it?"
  - "운영 중인 테이블 컬럼을 NOT NULL로 바꾸고 기존 데이터도 채워야 해, 마이그레이션 계획 세워줘"
  - "안 쓰는 것 같은 API인데 지워도 되는지 모르겠어"
compatibility:
  recommended:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 폐기 대 유지 판단과 소비자 영향 분석의 근거를 더 꼼꼼히 따질 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- NEVER plan a single migration that renames or drops in place, and NEVER delete an endpoint, column, or API whose
  consumer count is unknown. During a rollout old and new code run at once; one of them then queries a shape that no
  longer exists, and data is the one thing a reverted deploy cannot restore.
- NEVER set a sunset date while consumers are unverified. A date announced before the count exists is a promise to
  break someone nobody has met. Write `unverified: consumers` and the evidence that would close it.
- ALWAYS count consumers from evidence — access logs, call-site search, dependency graph, a metric — and name the
  source and window. "Nobody uses it" is a belief, not a count.
- NEVER claim a down path works unless it was run. An untested `down` is a rollback that fails at 2 a.m.

Goal: every step is labelled expand, migrate, or contract; consumers are a number with a source or `unverified: consumers`;
each destructive step is alone in its own deploy with a down path that ran; the user has the deprecate-vs-keep call.

# Deprecation and Migration

Turns "remove or replace this" into additive-first steps with counted consumers, and recommends deprecate or keep.

**Not for:** dialect-specific SQL and index syntax (`sql-pro`); whether the writes in one step are atomic
(`transaction-boundary-reviewer`); who should own the data after a service split (`service-boundary-validator`).

## Process

1. **Name the thing and its owner.** What is being removed, who owns it, what replaces it. Owner missing or the thing
   has no commits for 6+ months yet still has callers → name it zombie code (unowned, unremoved) and make assigning an
   owner step 0. Read the repo and git log before asking.
2. **Count consumers.** Search call sites, imports, logs, or metrics; record `<n> consumers — <source>, <window>`.
   Source unreachable → `unverified: consumers`, list the one query that would close it, set no date, and stop at
   step 4's additive work only.
3. **Recommend deprecate or keep.** Weigh consumers × migration cost per consumer against maintenance cost of keeping
   (security patches, on-call, onboarding). Say which and what would overturn it. Advisory is the default; compulsory
   only with a stated reason (security, blocked roadmap) and migration tooling. The user decides.
4. **Plan expand / migrate / contract.** Additive first, destructive last and alone:
   - **Expand** — add the new column, table, endpoint, or index beside the old; old code stays valid. Deploy.
   - **Migrate** — dual-write, then backfill, then switch reads. Backfill in batches off the hot path with a stated
     batch size (e.g. 5,000 rows, sleep between, resumable by primary-key cursor); one `UPDATE` over millions of rows
     holds locks. Deploy and bake between phases.
   - **Contract** — drop or delete only once consumers read 0 for the stated window, in its own later deploy, never
     bundled with a code change.
5. **Prove the down path.** For each step write the `down` and run it on a copy; record the command and result. A
   contract step that cannot be reversed is flagged irreversible and needs the user's explicit go.
6. **Migrate the users.** Churn rule: whoever owns the deprecated thing migrates its users — or ships an adapter so
   they need no change. A deprecation notice alone is not a migration. Track consumers moved per round.
7. **Close.** Remove the old code, tests, docs, flags, and the notice. Zombie code left behind is named in the output.

Bound: if a bake window shows consumers rising instead of falling, stop and report the new count; do not push on.

## Output Template

```
## Deprecation plan — <thing>

Recommendation: deprecate | keep — <one line> (overturned if: <condition>)   Mode: advisory | compulsory — <why>
Consumers: <n> — <source, window>  |  unverified: consumers — <query that closes it>   Sunset: <date> | none set
Owner: <name/team> | zombie code — <evidence>

| # | Phase | Change | Batch size | Down path run | Own deploy |
|---|-------|--------|-----------|---------------|------------|
| 1 | expand | ... | — | <command → result> | yes |

Irreversible steps: <n> (<which>)   Consumers migrated: <moved>/<total>
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Counts consumers from logs and code, names the source | Grant log/metric access; supply consumers the repo can't show |
| Recommends deprecate or keep and what would flip it | Make the call; pick advisory or compulsory |
| Writes phased steps, runs each down path on a copy | Run production deploys and approve irreversible steps |
| Drafts the notice and consumer-by-consumer checklist | Own the sunset date once the count is real |

## Related Skills

- `develop:sql-pro` — the dialect-specific DDL, concurrent index builds, and batch UPDATE syntax.
- `develop:transaction-boundary-reviewer` — dual-write atomicity across a step.
- `develop:service-boundary-validator` — data ownership when the deprecated thing is a service.
- `develop:architecture-designer` — recording the decision as an ADR.
