---
name: architecture-designer
description: >-
  Use when designing or documenting system architecture — topology, trade-offs,
  ADRs, database choice ("시스템 아키텍처 설계해줘", "ADR 써줘", "design this system").
license: MIT
metadata:
  version: "1.3.0"
scenarios:
  - "design a system architecture for this product"
  - "should we use microservices or a monolith?"
  - "write an ADR for this technology choice"
  - "시스템 아키텍처 설계해줘"
  - "마이크로서비스 vs 모놀리스 어떻게 선택해?"
  - "이 아키텍처 결정에 대한 ADR 써줘"
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 아키텍처 패턴 트레이드오프 분석과 ADR 작성이 더 정확해집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Architecture Designer

Acts as a senior architect: shapes system topology, weighs patterns against constraints, and records the reasoning behind each choice.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Designing new system topology from scratch | Internal layer dependency rule (use clean-architecture) |
| Choosing between monolith, modular monolith, microservices | Domain modeling with bounded contexts (use domain-driven-design) |
| Writing ADRs for major technology choices | Coding implementation (use spring-boot-engineer, kotlin-specialist) |
| Reviewing existing architecture for scalability | |

## Process

1. **Understand requirements** — Collect what the system must do, how well it must do it, and what limits apply. Confirm nothing is missing before moving on.
2. **Identify patterns** — Map the requirements onto candidate shapes from the Reference Guide. Use think-tool to weigh trade-offs explicitly when two or more patterns plausibly fit.
3. **Design** — Draft the architecture, write down what each choice costs, and draw it: Mermaid inline in a document; a figure that is opened, shared or printed goes through `write:diagram`. You place every node - layout is part of the argument.
4. **Document** — Record every key decision as an ADR.
5. **Review** — Walk stakeholders through it. If it does not hold up, go back to step 3 with their feedback written down.

## Reference Guide

| Topic | Reference | Read when |
|-------|-----------|-----------|
| System shape | `references/architecture-patterns.md` | Deciding between monolith, modular monolith, services, events |
| ADR | `references/adr-template.md` | Recording a decision |
| Design document | `references/system-design.md` | Writing the full design up |
| Datastore | `references/database-selection.md` | Picking a database |
| Quality targets | `references/nfr-checklist.md` | Turning non-functional wishes into measurable targets |

## Constraints

**MUST DO**
- Capture each significant decision in an ADR
- State non-functional requirements up front
- Weigh costs alongside benefits
- Design for the ways it will fail
- Account for the operational burden
- Get stakeholder review before calling it final

**MUST NOT DO**
- Build for scale nobody has asked for
- Pick a technology without comparing options
- Overlook running costs
- Start designing before requirements are understood
- Leave security out

## Output Template

A design delivers:
1. Requirements recap, functional and non-functional
2. Overview diagram: Mermaid inline in a markdown doc; a figure that will be opened, shared or printed through `write:diagram` (its `.json` source alongside)
3. Key decisions and what they trade away (ADR format — see `references/adr-template.md`)
4. Technology picks, each with its reason
5. Risks and how to contain them

### Example diagram (Mermaid)

```mermaid
graph TD
    App["Mobile / web app"] --> Edge["Edge gateway"]
    Edge --> Billing["Billing service"]
    Edge --> Catalog["Catalog service"]
    Catalog --> Store[("Catalog store, PostgreSQL")]
    Catalog --> Bus["Event bus, Kafka"]
    Bus --> Mailer["Email sender"]
```

For a worked ADR example and full template, see `references/adr-template.md`.

## Distributed Topology (microservices)

Before splitting, check prerequisites: CI/CD per service, container orchestration, distributed tracing, at least 2 independent squads, clear domain ownership. Mostly absent → modular monolith first; partly met → extract one pilot service.

If proceeding, the ADR's Service Inventory lists service, responsibility, data owned, communication, SLA. Defaults:
- Each service owns a private database; no shared schema.
- Async (events/outbox) for slow work or work spanning aggregates; sync only for query/command pairs, at most 3 hops in a user-facing path.
- Every remote call states timeout, retry budget, failure behaviour, and sits behind a circuit breaker.
- One correlation ID traced across every service; health/readiness probes and a canary or blue-green plan.

To check where the cuts fall, use `develop:service-boundary-validator`.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Produces architecture diagrams (Mermaid inline, or a checked figure through `write:diagram`) and component descriptions | Share requirements and constraints |
| Writes ADRs with alternatives and trade-offs | Validate with domain experts and stakeholders |
| Evaluates technology options with rationale | Make final technology decisions |
| Identifies risks and mitigation strategies | Confirm operational capacity for chosen approach |

## Related Skills

- `develop:clean-architecture` — internal layer dependencies and dependency rule
- `develop:domain-driven-design` — domain modeling and bounded contexts
- `develop:service-boundary-validator` — where to cut services and whether boundaries hold
- `write:plans` (ADR format) — writing individual Architecture Decision Records
- `write:diagram` — drawing the design as a checked SVG + PNG figure or interactive HTML
