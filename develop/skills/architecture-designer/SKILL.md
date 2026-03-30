---
name: architecture-designer
description: >-
  Use when someone needs to make or document architectural decisions from scratch — choosing between system topologies (monolith vs. microservices), writing ADRs, evaluating scalability trade-offs, or selecting database and infrastructure patterns.
  Triggers on: "시스템 설계", "아키텍처 결정", "architecture design", "system design", "ADR", "monolith vs microservices", "scalability", "기술 스택 선택", "아키텍처 리뷰", "infrastructure pattern".
  Best for: new system architecture design, major technology decisions, architectural review with ADRs.
  Not for: internal layer dependencies and dependency rule (use clean-architecture); domain modeling (use domain-driven-design); coding Spring-based services (use spring-boot-engineer).
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
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
3. **Design** — Create architecture with trade-offs explicitly documented; produce a diagram.
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

## Output Template

When designing architecture, provide:
1. Requirements summary (functional + non-functional)
2. High-level architecture diagram (Mermaid preferred — see example below)
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
| Produces architecture diagrams and component descriptions | Share requirements and constraints |
| Writes ADRs with alternatives and trade-offs | Validate with domain experts and stakeholders |
| Evaluates technology options with rationale | Make final technology decisions |
| Identifies risks and mitigation strategies | Confirm operational capacity for chosen approach |

## Related Skills

- `develop:clean-architecture` — internal layer dependencies and dependency rule
- `develop:domain-driven-design` — domain modeling and bounded contexts
- `develop:microservices-architect` — distributed system decomposition
- `develop:adr-writer` — writing individual Architecture Decision Records
