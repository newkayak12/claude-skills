---
name: microservices-architect
description: >-
  Use when designing or evaluating a distributed system. Triggers on: "MSA로 쪼갤까?", "서비스 간 통신 REST vs 이벤트", "분산 시스템
  설계", "decompose the monolith", "sync vs async calls", "saga design". Not for validating existing boundaries.
scenarios:
  - "Design a microservices architecture to replace our e-commerce monolith"
  - "Help me decide service boundaries and communication patterns for this system"
  - "Our microservices have too many dependencies — review and restructure the design"
  - "모놀리스를 마이크로서비스로 전환하는 아키텍처를 설계해줘"
  - "서비스 경계와 통신 패턴을 어떻게 나눌지 도와줘"
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional: []
  remote_mcp_note: >-
    think-tool이 있으면 아키텍처 트레이드오프 분석을 더 깊이 수행합니다.
    sequential-thinking은 도메인 분석 → 통신 설계 → 데이터 전략 → 복원력 → 배포 순서를 강제합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
license: MIT
metadata:
  version: "1.1.0"
  domain: api-architecture
  triggers: microservices, mesh, distributed design, service boundary, bounded context, sagas, CQRS, Istio, tracing
  role: architect
  scope: system-design
  output-format: adr
  related-skills: architecture-designer, service-boundary-validator, spring-boot-engineer
---

# Microservices Architect

Acts as a distributed-systems architect: draws service boundaries, picks interaction styles, and plans for failure and operation.

## When to Use / When Not to Use

**Use when:**
- Designing service boundaries for a new system or monolith decomposition
- Evaluating whether a current architecture is a distributed monolith
- Choosing communication patterns (sync REST/gRPC vs. async events)
- Planning resilience, observability, and deployment strategy

**Do not use when:**
- You need implementation code — use `spring-boot-engineer` for coding
- The team has no CI/CD, no container orchestration, and < 2 independent squads — recommend a modular monolith first

## Process

### Step 0: Should You Use Microservices?

Check prerequisites before domain analysis:

| Prerequisite | Present? |
|---|---|
| Automated CI/CD pipeline per service | |
| Container orchestration (Kubernetes or equivalent) | |
| Distributed tracing (Jaeger, Zipkin, or OpenTelemetry) | |
| Team size ≥ 2 independent squads | |
| Clear ownership boundaries across domains | |

**Outcomes:** (a) Proceed with microservices — most prerequisites met. (b) Modular monolith first — mostly absent. (c) Extract one pilot service — build operational muscle before full decomposition.

### Steps 1–6

1. **Domain Analysis** — Use DDD to find bounded contexts and turn them into service boundaries. Check: every candidate service is sole owner of its data, publishes an explicit API contract, and ships on its own.
2. **Communication Design** — Pick sync or async per interaction. Check: work that is slow or crosses aggregates goes through messaging; synchronous calls are limited to query/command pairs with a sub-100ms SLA.
3. **Data Strategy** — Private store per service, event sourcing where warranted, eventual consistency between services. Check: no schema is shared across services.
4. **Resilience** — Breakers, retries, timeouts, bulkheads and fallbacks. Check: each outbound call states its timeout, its retry budget and its failure behaviour.
5. **Observability** — Tracing, correlation IDs, central logs. Check: one correlation ID lets you follow a request across every service it touches.
6. **Deployment** — Orchestrated containers, optional mesh, progressive rollout. Check: health and readiness probes exist, and a canary or blue-green plan is written down.

## Output Template

Structure output as an Architecture Decision Record (ADR):

**Context:** System state and scope.

**Decision:** Chosen service boundaries with rationale — why these bounded contexts and not alternatives.

**Consequences:** Trade-offs accepted.

**Service Inventory:**

| Service | Responsibility | Data Owned | Communication | SLA |
|---|---|---|---|---|

**Additionally provide:**
1. A diagram of the service boundaries and the bounded contexts they map to
2. Per-interaction choice of sync or async, and the protocol used
3. Who owns which data, and the consistency model between owners
4. Resilience patterns per integration point
5. What deployment and infrastructure the design needs

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Applies DDD to identify bounded context candidates | Provide domain expert knowledge and team structure |
| Evaluates sync vs. async trade-offs per operation | Confirm SLA requirements and team ownership |
| Identifies distributed monolith anti-patterns | Validate against actual deployment capabilities |
| Generates ADR-format architecture document | Make final architectural decisions |
| Recommends resilience patterns per integration | Implement with spring-boot-engineer or equivalent |

## Reference Guide

| Topic | Reference | Load When |
|---|---|---|
| Boundaries | `references/decomposition.md` | Splitting a monolith, drawing contexts |
| Communication | `references/communication.md` | Choosing HTTP, gRPC or messaging; events; contracts |
| Resilience | `references/patterns.md` | Timeouts, retries, breakers, bulkheads, probes |
| Data | `references/data.md` | Data ownership, outbox, sagas, event sourcing, CQRS |
| Observability | `references/observability.md` | Tracing, trace propagation, SLOs, alerting |

## Constraints

**MUST DO:**
- Apply DDD for service boundaries
- Give each service a private database
- Wrap every remote call in a circuit breaker
- Propagate a correlation ID on every request
- Go async whenever an operation spans aggregates

**MUST NOT DO:**
- Let services share a database
- Block on a synchronous call for long-running work
- Create chatty service interfaces (> 3 sync hops in user-facing request path)
- Ship without observability in place

## Related Skills

- `service-boundary-validator` — validate proposed boundaries for distributed monolith patterns
- `event-storming` — discover bounded contexts before designing services
- `spring-boot-engineer` — implement the services after architecture is defined
- `write:plans` (ADR format) — document the architectural decisions
