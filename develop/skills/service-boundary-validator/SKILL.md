---
name: service-boundary-validator
description: >-
  Use when checking if services can really split or deploy alone. Triggers on: "서비스 쪼개도 될까?", "결합도 너무 높은 것 같아", "DB
  공유 문제 없나?", "distributed monolith", "validate this service boundary", "split or merge".
scenarios:
  - "Should this feature be a new microservice or stay in the existing service?"
  - "Validate whether our proposed service split makes sense or creates too much coupling"
  - "Help me decide if this domain logic belongs in service A or service B"
  - "이 기능을 새 서비스로 분리해야 할지 기존 서비스에 넣어야 할지 모르겠어"
  - "서비스 경계가 맞게 나뉘어져 있는지 검토해줘"
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional: []
  remote_mcp_note: >-
    think-tool이 있으면 커플링 패턴과 팀 토폴로지 정렬을 더 깊이 분석합니다.
    sequential-thinking은 커플링 분석 → 데이터 소유권 → 팀 정렬 → 권고 순서를 강제합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER recommend a split or merge before the data-ownership audit is done. Skipping it is the failure that ships a
  distributed monolith: two services split on paper still write the same tables.
- NEVER cut a boundary because a noun looks like a service. A cut needs its own team, its own data, and an independent
  deploy; otherwise it stays a module.
- A fact you were not shown (who writes this table, which team owns it, call counts) is `[확인 필요: ○○]`, never guessed.
  A verdict resting on one is `provisional`.
- Goal: every service gets a verdict from the five tests with the failing test numbered, and the closing tally
  recounts to the verdict lines.

# Service Boundary Validator

Checks whether existing or proposed service cuts hold: can each deploy alone, own its data, and fail without taking
the others down.

**Not for** designing topology from scratch (`develop:architecture-designer`, which owns the Distributed Topology
choice), discovering contexts (`develop:event-storming`, `develop:domain-driven-design`), or fixing a transaction
across services (`develop:transaction-boundary-reviewer`).

## Process

1. **Coupling.** Map synchronous call graphs, shared databases, bidirectional dependencies. Read the code or config
   before asking.
2. **Data ownership.** Per entity: who creates, reads, updates, deletes. The creator owns it; any other writer is a violation.
3. **Team alignment.** One owning team per service? Missing → `[확인 필요: owner]`.
4. **Tests and verdict.** Run the five tests, then merge / split / convert to async / fix ownership.

With `sequential-thinking`, take steps 1–4 in order.

## The 5 Tests

1. Deploys independently, no coordination with other services
2. One team owns it without ongoing negotiation
3. Its data is exclusively its own: no other service writes its tables
4. Its domain language does not shift meaning at the boundary
5. Its failure degrades, but does not break, others

Any fail → the boundary is suspect.

## Red Flags

- **Shared database** — two services write one schema, or one reads the other's tables. Fix: access only through the owner's API.
- **Chatty calls** — more than 3 synchronous hops in a user-facing path. Fix: merge if always called together; async events; BFF at the edge.
- **Bidirectional dependency** — A calls B and B calls A. Fix: pick the authority direction; events for the way back.
- **Deployment coupling** — "Can we deploy A on Monday and B the next Friday?" No → implicit shared contract.

## Split or Keep

Split when owners, deploy frequency, scaling needs, or ubiquitous language differ. Keep together when they always
change or are called together, one team owns both, the split would share a database or need a distributed transaction.

## Where to Cut

- Start from bounded contexts (`domain-driven-design`); each candidate solely owns its data, publishes an explicit API contract, and ships on its own.
- No team of its own, no independent deploy, or no prerequisites (CI/CD, orchestration, tracing) → keep it a module in a modular monolith.

## Output Template

```
## Boundary check — <system>

Service: <name> · Owner: <team | [확인 필요: owner]>
Data owned: <tables/entities> · Read from others: <entity → owner, access method>
Sync dependencies: <service → purpose → async possible?> · Events: <published → consumers | consumed ← publisher>
Tests: 1 ✓/✗ · 2 ✓/✗ · 3 ✓/✗ · 4 ✓/✗ · 5 ✓/✗
Red flags: <specific coupling, with file or call evidence>
Verdict: merge | split | convert to async | fix ownership | keep — <one line citing the failing test number>

<n> services checked · <k> pass all five · <m> verdicts provisional
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Analyzes call graph and shared-database patterns, applies the five tests | Provide the dependency diagram and confirm who accesses which tables |
| Drafts the verdict per service | Validate against team structure; make the split or merge decision |

## Related Skills

- `develop:architecture-designer` — design the topology and communication once boundaries hold
- `develop:event-storming` — discover bounded contexts to inform boundary decisions
- `develop:transaction-boundary-reviewer` — fix cross-service transaction anti-patterns
- `write:plans` (ADR format) — document the split or merge decision
