---
name: microservices-architect
description: >-
  Use when someone needs to design or evaluate a distributed system — decomposing a
  monolith, defining service boundaries with DDD, choosing between sync and async
  communication, or planning resilience and observability.
  Triggers on: "microservices design", "decompose the monolith", "service boundaries",
  "distributed system architecture", "saga pattern", "CQRS", "event sourcing",
  "마이크로서비스 설계", "모놀리스 분해", "서비스 경계 설계", "분산 시스템".
  Best for: architecture decisions, service decomposition, resilience pattern selection.
  Not for: implementation code — use spring-boot-engineer for coding microservices.
scenarios:
  - "Design a microservices architecture for our e-commerce monolith migration"
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
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: api-architecture
  triggers: microservices, service mesh, distributed systems, service boundaries, domain-driven design, event sourcing, CQRS, saga pattern, Kubernetes microservices, Istio, distributed tracing
  role: architect
  scope: system-design
  output-format: architecture
  related-skills: devops-engineer, kubernetes-specialist, graphql-architect, architecture-designer, monitoring-expert
---

# Microservices Architect

Senior distributed systems architect specializing in cloud-native microservices, resilience patterns, and operational excellence.

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

1. **Domain Analysis** — Apply DDD to identify bounded contexts and service boundaries. Validation: each candidate service owns its data exclusively, has a clear public API contract, and can be deployed independently.
2. **Communication Design** — Choose sync/async patterns. Validation: long-running or cross-aggregate operations use async messaging; only query/command pairs with sub-100ms SLA use sync calls.
3. **Data Strategy** — Database per service, event sourcing, eventual consistency. Validation: no shared database schema exists between services.
4. **Resilience** — Circuit breakers, retries, timeouts, bulkheads, fallbacks. Validation: every external call has an explicit timeout, retry budget, and degradation path.
5. **Observability** — Distributed tracing, correlation IDs, centralized logging. Validation: a single request traceable end-to-end by correlation ID.
6. **Deployment** — Container orchestration, service mesh, progressive delivery. Validation: health and readiness probes defined; canary or blue-green strategy documented.

## Output Template

Structure output as an Architecture Decision Record (ADR):

**Context:** System state and scope.

**Decision:** Chosen service boundaries with rationale — why these bounded contexts and not alternatives.

**Consequences:** Trade-offs accepted.

**Service Inventory:**

| Service | Responsibility | Data Owned | Communication | SLA |
|---|---|---|---|---|

**Additionally provide:**
1. Service boundary diagram with bounded contexts
2. Communication patterns (sync/async, protocols)
3. Data ownership and consistency model
4. Resilience patterns per integration point
5. Deployment and infrastructure requirements

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
|-------|-----------|-----------|
| Service Boundaries | `references/decomposition.md` | Monolith decomposition, bounded contexts |
| Communication | `references/communication.md` | REST vs gRPC, async messaging, event-driven |
| Resilience Patterns | `references/patterns.md` | Circuit breakers, bulkhead, retry, health checks |
| Data Management | `references/data.md` | Database per service, Saga, Event Sourcing, CQRS |
| Observability | `references/observability.md` | Distributed tracing, correlation IDs, metrics |

## Constraints

**MUST DO:**
- Apply DDD for service boundaries
- Use database per service pattern
- Implement circuit breakers for external calls
- Add correlation IDs to all requests
- Use async communication for cross-aggregate operations

**MUST NOT DO:**
- Share databases between services
- Use synchronous calls for long-running operations
- Create chatty service interfaces (> 3 sync hops in user-facing request path)
- Deploy without observability

## Related Skills

- `service-boundary-validator` — validate proposed boundaries for distributed monolith patterns
- `event-storming` — discover bounded contexts before designing services
- `spring-boot-engineer` — implement the services after architecture is defined
- `adr-writer` — document the architectural decisions
