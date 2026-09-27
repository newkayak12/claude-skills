---
name: architecture-designer
description: >-
  Use when designing or documenting system architecture — topology, trade-offs,
  ADRs, database choice — or drawing it as a shareable interactive diagram
  ("아키텍처 그려줘", "시퀀스 다이어그램", "diagram this system").
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.2.0"
  domain: api-architecture
  role: expert
  scope: design
  output-format: document
scenarios:
  - "design a system architecture for this product"
  - "should we use microservices or a monolith?"
  - "write an ADR for this technology choice"
  - "시스템 아키텍처 설계해줘"
  - "마이크로서비스 vs 모놀리스 어떻게 선택해?"
  - "이 아키텍처 결정에 대한 ADR 써줘"
  - "diagram a web request: browser, API, Redis cache, Postgres on a miss"
  - "이 결제 흐름을 시퀀스 다이어그램으로 그려서 공유할 수 있게 해줘"
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

Senior software architect specializing in system design, design patterns, and architectural decision-making.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Designing new system topology from scratch | Internal layer dependency rule (use clean-architecture) |
| Choosing between monolith, modular monolith, microservices | Domain modeling with bounded contexts (use domain-driven-design) |
| Writing ADRs for major technology choices | Coding implementation (use spring-boot-engineer, kotlin-specialist) |
| Reviewing existing architecture for scalability | |

## Process

1. **Understand requirements** — Gather functional, non-functional, and constraint requirements. Verify full requirements coverage before proceeding.
2. **Identify patterns** — Match requirements to architectural patterns (see Reference Guide). Use think-tool to weigh trade-offs explicitly when two or more patterns plausibly fit.
3. **Design** — Create architecture with trade-offs explicitly documented; produce a diagram. For one a person will open or share, write the diagram IR (`references/diagram-ir.md`), run `node scripts/diagram.mjs check`, apply every repair it prints, then `render` to one HTML file. You place every node - layout is part of the argument.
4. **Document** — Write ADRs for all key decisions.
5. **Review** — Validate with stakeholders. If review fails, return to step 3 with recorded feedback.

## Reference Guide

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Architecture Patterns | `references/architecture-patterns.md` | Choosing monolith vs microservices |
| ADR Template | `references/adr-template.md` | Documenting decisions |
| System Design | `references/system-design.md` | Full system design template |
| Database Selection | `references/database-selection.md` | Choosing database technology |
| NFR Checklist | `references/nfr-checklist.md` | Gathering non-functional requirements |
| Diagram IR | `references/diagram-ir.md` | Drawing a system as an interactive, shareable HTML diagram |

## Constraints

**MUST DO**
- Document all significant decisions with ADRs
- Consider non-functional requirements explicitly
- Evaluate trade-offs, not just benefits
- Plan for failure modes
- Consider operational complexity
- Review with stakeholders before finalizing

**MUST NOT DO**
- Over-engineer for hypothetical scale
- Choose technology without evaluating alternatives
- Ignore operational costs
- Design without understanding requirements
- Skip security considerations
- Hand over a diagram HTML that `scripts/diagram.mjs check` has not passed

## Output Template

When designing architecture, provide:
1. Requirements summary (functional + non-functional)
2. High-level architecture diagram — Mermaid inline in a markdown doc; the IR + `diagram.mjs render` HTML (and its `.json` source) when it will be opened or shared
3. Key decisions with trade-offs (ADR format — see `references/adr-template.md`)
4. Technology recommendations with rationale
5. Risks and mitigation strategies

### Architecture Diagram (Mermaid)

```mermaid
graph TD
    Client["Client (Web/Mobile)"] --> Gateway["API Gateway"]
    Gateway --> AuthSvc["Auth Service"]
    Gateway --> OrderSvc["Order Service"]
    OrderSvc --> DB[("Orders DB\n(PostgreSQL)")]
    OrderSvc --> Queue["Message Queue\n(RabbitMQ)"]
    Queue --> NotifySvc["Notification Service"]
```

For a worked ADR example and full template, see `references/adr-template.md`.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Produces architecture diagrams (Mermaid, or a validated interactive HTML) and component descriptions | Share requirements and constraints |
| Writes ADRs with alternatives and trade-offs | Validate with domain experts and stakeholders |
| Evaluates technology options with rationale | Make final technology decisions |
| Identifies risks and mitigation strategies | Confirm operational capacity for chosen approach |

## Related Skills

- `develop:clean-architecture` — internal layer dependencies and dependency rule
- `develop:domain-driven-design` — domain modeling and bounded contexts
- `develop:microservices-architect` — distributed system decomposition
- `technique-write:adr-writer` — writing individual Architecture Decision Records
