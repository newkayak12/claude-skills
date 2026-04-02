---
name: service-boundary-validator
description: >-
  Use when someone is deciding whether to split a service, suspects their services are
  too tightly coupled to deploy independently, wants to validate a proposed service
  boundary, or is decomposing a monolith and needs to know where to cut.
  Triggers on: "validate service boundary", "are we a distributed monolith",
  "too tightly coupled", "should I split this service", "shared database anti-pattern",
  "서비스 경계 검증", "분산 모놀리스", "서비스 분리", "데이터 소유권 분석".
  Best for: coupling analysis, data ownership audit, split vs. merge decisions.
  Not for: designing new service boundaries from scratch (use microservices-architect or event-storming).
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

# Service Boundary Validator

## When to Use / When Not to Use

**Use when:**
- Evaluating whether services can actually deploy independently
- Suspecting a distributed monolith (coupled services with shared database or chatty sync calls)
- Deciding whether to split or merge services
- Auditing data ownership before a migration

**Do not use when:**
- Designing new boundaries from scratch — run `event-storming` first, then use `microservices-architect`

## Process

1. **Coupling analysis** — Map synchronous call graphs, shared databases, and bidirectional dependencies
2. **Data ownership audit** — For each entity: which service creates, reads, updates, and deletes it?
3. **Team alignment check** — Does each service map to one team? Apply the cognitive load test.
4. **Recommendation** — Merge / split / convert to async / fix ownership

If `sequential-thinking` is available, use it to work through these four steps in order — skipping data ownership analysis before issuing a split recommendation is a high-probability, high-consequence failure.

## Output Template

```
Service: [Name]
Owner Team: [Team name]
Data Owned: [List of tables/entities]
Data Read from Others: [Entity → owning service, access method]
Synchronous Dependencies: [Service → purpose → can it be made async?]
Events Published: [Event name → consumers]
Events Consumed: [Event name → publisher]

Red Flags Found:
- [Specific coupling issue]

Recommendation:
- [Concrete action: merge / split / convert to async / fix ownership]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Analyzes service call graph for chatty patterns | Provide the service dependency diagram or description |
| Identifies shared database anti-patterns | Confirm which services access which tables |
| Applies the 5 boundary tests | Validate against your team structure |
| Runs the split decision framework | Make the final split or merge decision |
| Drafts the coupling analysis report | Fill in actual data ownership from your codebase |

## The 5 Tests for a Well-Placed Boundary

A service boundary is correct only if all five hold:

1. The service can be deployed independently without coordinating with other services
2. A single team can own it without ongoing negotiation with other teams
3. Its data is owned exclusively — no other service writes to its database tables
4. Its domain language is consistent — terms do not shift meaning at the boundary
5. Failure of this service degrades, but does not break, other services

If any fails, the boundary is suspect.

## Red Flags: Distributed Monolith Patterns

### Shared Database

Services A and B both write to the same schema, or A reads B's tables directly via SQL. The database becomes the integration point — schema changes require coordinating both services.

**Fix:** Each service owns its data exclusively. Other services access it only through the owning service's API.

### Chatty APIs (Temporal Coupling)

To complete one user-facing operation, Service A makes 5+ synchronous calls to B, C, D in sequence.

**Threshold:** More than 3 synchronous hops in a user-facing request path is a warning sign.

**Fix options:** Merge if always called together; use async events for non-blocking workflows; BFF/API composition at the edge.

### Bidirectional Dependencies

Service A calls B, and B also calls A. This means deployment order is undefined and neither service is the source of truth.

**Fix:** Identify the natural authority direction. Introduce an event or callback pattern if the consumer needs to communicate back.

### Deployment Coupling

All services must be deployed simultaneously. This reveals implicit shared contracts that change together — no deployment independence exists.

**Diagnosis question:** "Can we deploy Service A on Monday and Service B the following Friday?"

## Split Decision Framework

```
Should service X be split into A and B?

Yes, split if:
  - A and B are owned by different teams
  - A and B have different deployment frequencies
  - A and B have different scaling requirements
  - A and B have clearly distinct ubiquitous language

No, keep together if:
  - A and B always change together
  - A and B are always called together in every operation
  - A and B are owned by the same team with no plans to split
  - Splitting would create a shared database problem
  - The split introduces a distributed transaction requirement
```

## Data Ownership Analysis

```
For each entity E:
  1. Which service creates E? → That service owns E.
  2. Which services read E? → They call the owning service's API or receive events.
  3. Which services update E? → Any service other than the owner is a violation.
  4. Which services delete E? → Same — only the owner deletes.
```

## Quick Checklist

- [ ] Each service has exactly one owning team
- [ ] No service reads another service's database directly
- [ ] Synchronous call chains are ≤ 3 hops for user-facing requests
- [ ] No bidirectional synchronous dependencies
- [ ] Services can be deployed independently
- [ ] Each service's ubiquitous language is internally consistent
- [ ] Data ownership is unambiguous for every entity
- [ ] Cross-service writes use events + outbox, not shared transactions

## Related Skills

- `microservices-architect` — design new service boundaries after validation
- `event-storming` — discover bounded contexts to inform boundary decisions
- `transaction-boundary-reviewer` — fix cross-service transaction anti-patterns
- `adr-writer` — document the split or merge decision
