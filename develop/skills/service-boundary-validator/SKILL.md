---
name: service-boundary-validator
description: |
  Microservice boundary validation specialist — evaluates service decomposition using DDD and Team Topology principles, identifies distributed monolith patterns, shared database anti-patterns, and excessive coupling. Use when the user mentions "서비스 경계", "service boundary", "마이크로서비스 분리", "어디서 잘라야", "서비스 설계 검토", "bounded context", or is asking whether to split a service, how to decompose a monolith, or why services are too tightly coupled. Trigger this skill even if the user just says "서비스가 너무 얽혀 있어" or "should I split this into two services?" without using DDD terminology.
---

# Service Boundary Validator

The hardest problem in microservices is not building individual services — it is deciding where to cut them. A boundary drawn in the wrong place creates a distributed monolith: you have the operational complexity of microservices and none of the independence benefits. This skill applies DDD bounded context analysis and Team Topology principles to evaluate whether a service boundary is well-placed.

If `sequential-thinking` is available, use it — skipping data ownership analysis before issuing a split recommendation is a high-probability, high-consequence failure. Work through: (1) coupling analysis → (2) data ownership → (3) team alignment → (4) recommendation.

## The Test for a Well-Placed Boundary

A service boundary is correct if, and only if:

1. **The service can be deployed independently** without coordinating with other services.
2. **A single team can own it** without requiring ongoing negotiation with other teams.
3. **Its data is owned exclusively** — no other service writes to its database tables.
4. **Its domain language is consistent** — terms do not shift meaning at the boundary.
5. **Failure of this service degrades, but does not break, other services.**

If any of these five conditions fails, the boundary is suspect.

## Red Flags: Distributed Monolith Patterns

### 1. Shared Database

**What it looks like:** Service A and Service B both write to the same database schema, or Service A reads Service B's tables directly via SQL.

**Why it is fatal:** The database becomes the integration point. You cannot deploy Service A without verifying Service B is compatible with the schema change. You cannot optimize Service B's data model without auditing all of Service A's queries. The services are logically coupled at the data layer despite being "separate" services.

**Fix:** Each service owns its data exclusively. Other services access it only through the owning service's API. If two services share a database because they need to join tables, that is a signal they may belong in the same service.

```
# Wrong
OrderService ──reads──→ ┐
                        ├── shared_db (orders, inventory, payments tables)
InventoryService ────→  ┘

# Right
OrderService ──HTTP──→ InventoryService (owns inventory data)
OrderService ──HTTP──→ PaymentService (owns payment data)
```

### 2. Chatty APIs (Temporal Coupling)

**What it looks like:** To complete one user-facing operation, Service A makes 5+ synchronous HTTP calls to Services B, C, D in sequence before responding.

**Why it is dangerous:** The P99 latency of the entire chain is the sum of each service's latency plus network overhead. Availability compounds: if each service is 99.9% available, three synchronous calls produce 99.7% availability. Every service in the chain must be healthy for any operation to succeed.

**Diagnosis:**
- Map the call graph for your top 10 operations
- Count synchronous cross-service calls per operation
- More than 3 synchronous hops in a user-facing request path is a warning sign

**Fix options:**
- **Merge services** if they are always called together and owned by the same team
- **Async event-driven integration** for non-blocking workflows
- **API composition / BFF** pattern at the edge to aggregate, not buried in service-to-service calls
- **Data denormalization** — replicate the data you need locally (eventual consistency)

### 3. Bidirectional Dependencies

**What it looks like:** Service A calls Service B, and Service B also calls Service A.

**Why it is a design smell:** Bidirectional dependencies make deployment order undefined and make it impossible to reason about which service is the source of truth. In practice, this means the services belong in one service or one of them is doing the wrong thing.

**Fix:** Identify which direction is the natural authority relationship. The service that owns the data should not call the service that consumes it. Introduce an event or callback pattern if the consumer needs to communicate back.

### 4. Distributed Monolith Deployment

**What it looks like:** All services must be deployed simultaneously, or deployment of one service always requires deploying others.

**Why it reveals the problem:** This means the services have implicit shared contracts (API versions, database schemas, message formats) that change together. The microservice architecture provides no deployment independence.

**Diagnosis question:** "Can we deploy Service A on Monday and Service B the following Friday?" If no, the boundary is wrong or the API versioning strategy is broken.

## Bounded Context Alignment

A bounded context is the DDD unit that maps most naturally to a microservice. Each context has its own ubiquitous language — the same word may mean different things in different contexts, and that is correct.

**Alignment signals (boundary is correct):**
- Domain experts for this context form a coherent group who share vocabulary
- The context's model does not leak into adjacent contexts
- Events crossing the boundary are integration events, not internal domain events
- A new team member can understand this context without understanding adjacent contexts

**Misalignment signals (boundary is wrong):**
- You constantly need to explain "in this service, 'customer' means X, but in that service it means Y for the same actual customer"
- Domain experts cannot agree on service ownership — multiple teams claim the same concept
- The service's core entity (e.g., `Order`) appears in many other services' databases

## Team Topology Alignment

Conways' Law states that system architecture mirrors the communication structure of the teams that build it. Use this deliberately.

| Team Type | Service Type | Boundary Principle |
|-----------|-------------|-------------------|
| Stream-aligned | Business capability service | Owns a bounded context end-to-end |
| Platform | Shared infrastructure service | Provides capabilities with well-defined APIs |
| Enabling | Temporary accelerator | Not a permanent runtime service |
| Complicated-subsystem | Specialist service (ML, codec) | Justified by rare expertise requirement |

**Cognitive load test:** A stream-aligned team should be able to understand, test, deploy, and operate their services without requiring help from other teams more than a few times per quarter. If they need daily coordination, the boundary is wrong.

## Data Ownership Analysis

For each piece of data, ask: "Which service is the single source of truth?"

```
For each entity E:
  1. Which service creates E? → That service owns E.
  2. Which services read E? → They should call the owning service's API or receive events.
  3. Which services update E? → Any service other than the owner is a violation.
  4. Which services delete E? → Same as update — only the owner should delete.
```

If multiple services create or update the same logical entity, you have a data ownership conflict. Resolve by:
- Assigning clear ownership to one service
- Splitting the entity into two distinct entities owned by different services
- Merging the services if they are inseparable

## Splitting Decision Framework

Use this when evaluating whether to split a service or keep it together:

```
Should service X be split into A and B?

Yes, split if:
  - A and B are owned by different teams
  - A and B have different deployment frequencies
  - A and B have different scaling requirements
  - A and B have clearly distinct domains with different ubiquitous language
  - A and B can fail independently

No, keep together if:
  - A and B always change together
  - A and B are always called together in every operation
  - A and B are owned by the same team with no plans to split
  - Splitting would create a shared database problem
  - The split introduces a distributed transaction requirement
```

## Coupling Analysis Output Template

When reviewing a service architecture, produce:

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

## Quick Checklist

- [ ] Each service has exactly one owning team
- [ ] No service reads another service's database directly
- [ ] Synchronous call chains are ≤ 3 hops for user-facing requests
- [ ] No bidirectional synchronous dependencies between services
- [ ] Services can be deployed independently (test: deploy one without the other)
- [ ] Each service's ubiquitous language is internally consistent
- [ ] Data ownership is unambiguous for every entity
- [ ] Cross-service writes use events + outbox, not shared transactions
