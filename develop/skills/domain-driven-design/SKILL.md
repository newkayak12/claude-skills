---
name: domain-driven-design
description: >-
  Use when aligning code structure with business concepts, designing service
  boundaries, or when domain experts and developers cannot agree on what things
  mean. Triggers on: "도메인 모델링", "바운디드 컨텍스트", "DDD", "domain-driven design",
  "bounded context".
license: MIT
metadata:
  version: "1.0.1"
scenarios:
  - "help me model this business domain"
  - "how do I define bounded contexts for this system?"
  - "what's the difference between entity and value object?"
  - "도메인 모델 설계해줘"
  - "바운디드 컨텍스트 어떻게 나눠야 해?"
  - "도메인 전문가와 개발자 언어가 달라서 문제야"
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 바운디드 컨텍스트 경계 결정과 컨텍스트 매핑 트레이드오프 분석이 더 정확해집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER draw a context boundary from a noun list. A border goes where a term changes meaning, and the map quotes both
  meanings. Contexts cut per noun (`Customer`, `Order`, `Product`) become entity services that call each other on
  every request — the coupling stays, now over the network, and `develop:service-boundary-validator` then finds it.
- A business rule nobody stated is marked `[확인 필요: <rule>]`, never invented; an invented invariant ships as code.

Goal: every context on the map cites the term whose meaning changes at its border, every aggregate names the invariant
it guards, and the closing tally recounts to the tables.

# Domain-Driven Design

Keeps the code shaped like the business: shared words, explicit borders, small aggregates that guard real rules.

**Not for** layering or the dependency rule (`develop:clean-architecture`); checking whether existing service cuts hold
(`develop:service-boundary-validator`); topology, ADRs, datastore choice (`develop:architecture-designer`); running a
discovery workshop from nothing (`develop:event-storming`). Plain CRUD with no rules → say so and stop.

## Process

1. **Read before asking.** Collect the vocabulary already in the code, docs, tickets and the user's words. Ask at most
   one line, only for what none of them answers.
2. **Language.** List each key term with its meaning per speaker or module. A term with two meanings is a border
   candidate; a technical name (`Manager`, `Helper`, `Processor`) marks an unnamed concept. Detail:
   `references/ubiquitous-language.md`.
3. **Contexts.** Draw a border at each meaning change, name the relationship on each edge (ACL, Shared Kernel,
   Conformist, Open Host / Published Language) and classify each context core / supporting / generic. Detail:
   `references/bounded-contexts.md`, `references/strategic-design.md`.
4. **Aggregates.** Per context: entities vs value objects, then aggregates sized to one invariant each, referencing
   other aggregates by id. An aggregate with no invariant to name is not one — fold it or drop it. Detail:
   `references/building-blocks.md`.
5. **Events and persistence.** Past-tense events each aggregate emits, with consumers; repository interfaces in the
   domain, factories where construction can fail. Detail: `references/domain-events.md`,
   `references/repositories-factories.md`.
6. **Check.** Recount: contexts without a quoted term, aggregates without an invariant, rules left in services over a
   hollow model, outside systems reached without translation. Fix or list each; then write the tally.

## Output Template

**Context map** — Mermaid or a table: context, type (core/supporting/generic), edges with relationship pattern.

| Context | Border term | Meaning here | Meaning across the border |
|---|---|---|---|
| Billing | "account" | payer with a balance | Identity: login credentials |

| Context | Aggregate | Invariant it guards | Events emitted → consumer |
|---|---|---|---|
| Ordering | Order | total = Σ lines; no lines after `placed` | `OrderPlaced` → Billing |

Glossary: term — definition, per context. Open: each `[확인 필요: …]` with who can answer.

Tally: `<n>` contexts (core `<a>` / supporting `<b>` / generic `<c>`) · `<m>` aggregates, `<m>` with an invariant ·
`<k>` open rules.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Extracts terms from code and docs, draws borders where meanings split | Confirm each meaning with a domain expert |
| Sizes aggregates to named invariants; marks unstated rules | Supply or reject each `[확인 필요]` rule |
| Names events, consumers and repository interfaces | Decide which context is core and where effort goes |

## Related Skills

- `develop:event-storming` — discover events and terms with the team before modelling
- `develop:service-boundary-validator` — test whether the drawn borders survive as service cuts
- `develop:clean-architecture` — layers and the dependency rule inside a context
- `develop:architecture-designer` — topology and ADRs once the contexts are set
