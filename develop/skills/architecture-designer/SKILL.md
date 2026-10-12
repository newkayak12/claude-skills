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

## Standing Mandates

- NEVER propose a shape more distributed than the stated constraints force. Start at the first row of
  `references/architecture-patterns.md` and name the constraint behind every step down. Services split without
  per-service CI/CD, tracing and independent teams keep the coupling and add the network: a distributed monolith that
  costs more to run and change than the monolith it replaced.
- A requirement nobody stated (load, latency, retention, team count) is marked `[확인 필요: …]`, never assumed; a
  design built on a guessed number is defended by nothing.

Goal: every non-functional requirement carries a number or a `[확인 필요]`, every step away from a single deployable
names its forcing constraint, every key decision has an ADR, and the closing tally recounts to them.

# Architecture Designer

Shapes system topology, weighs each choice against the constraints that force it, and records why.

**Not for** layering inside one deployable (`develop:clean-architecture`); bounded contexts and aggregates
(`develop:domain-driven-design`); checking whether existing service cuts hold (`develop:service-boundary-validator`);
reviewing shallow modules in code that exists (`develop:architecture-review`); implementation code
(`develop:spring-boot-engineer`, `develop:kotlin-specialist`).

## Process

1. **Requirements.** Read the repo, docs and request first; then list functional needs and each quality target as a
   number (`references/nfr-checklist.md`). Ask at most one line; mark the rest `[확인 필요]` and proceed.
2. **Shape.** Walk `references/architecture-patterns.md` from the top. Stop at the first row the constraints allow;
   each step down cites the requirement that forces it. Two rows still fit → weigh them in one table (cost, failure
   mode, operational load) instead of picking silently.
3. **Distributed gate** (only if step 2 reached services). Check the prerequisites: CI/CD per service, container
   orchestration, distributed tracing, two or more independent teams, clear domain ownership. Mostly absent →
   modular monolith; partly met → extract one pilot service. Going ahead, the design fixes:
   - a Service Inventory: service, responsibility, data owned, communication, SLA — each service owns a private
     database, no shared schema;
   - async (events/outbox) for slow or cross-aggregate work; sync only for query/command pairs, ≤ 3 hops on a
     user-facing path;
   - per remote call: timeout, retry budget, failure behaviour, circuit breaker;
   - one correlation ID across services, health/readiness probes, a canary or blue-green plan.
4. **Datastores.** Per store, the access pattern that picks it (`references/database-selection.md`).
5. **Draw.** Mermaid inline in a document; a figure that will be opened, shared or printed goes through
   `write:diagram`. You place every node — layout is part of the argument.
6. **Record.** One ADR per key decision with the options weighed and what it gives up (`references/adr-template.md`);
   the full write-up follows `references/system-design.md`.
7. **Check.** Recount the tally against the tables; a decision without an ADR or a step down without a constraint goes
   back to step 2 or 6. The user's review is the last step — their objections reopen step 2.

## Output Template

1. **Requirements** — functional list; NFR table: quality, target number or `[확인 필요]`, source.
2. **Shape** — chosen row and, for each step past the first, `<step> ← <requirement id>`. Services: the Service
   Inventory and the distributed-gate result.
3. **Diagram** — Mermaid, or a `write:diagram` figure with its `.json` source.
4. **Decisions** — ADR list: id, decision, rejected options, cost.
5. **Risks** — risk, trigger, containment.

Tally: shape `<row>` · NFRs `<x>/<y>` with numbers · ADRs `<n>` · open `[확인 필요]` `<k>` · risks `<r>`.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Turns requirements into numbered targets; marks the missing ones | Supply the numbers and the team/ops facts |
| Picks the least distributed shape the constraints allow, with the trail | Make the final technology call |
| Writes ADRs, the diagram and the risk list | Review with stakeholders; confirm you can operate it |

## Related Skills

- `develop:domain-driven-design` — the contexts this topology should follow
- `develop:service-boundary-validator` — where to cut services and whether the cuts hold
- `develop:clean-architecture` — layers inside each deployable
- `write:plans` — a standalone ADR or design-review document
- `write:diagram` — the design as a checked SVG + PNG figure or interactive HTML
