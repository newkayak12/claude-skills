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

# Domain-Driven Design

Keep the code shaped like the business so intricate rules remain readable.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Making code mirror business concepts | Architecture layering (use clean-architecture) |
| Defining service boundaries from domain analysis | Service coupling validation (use service-boundary-validator) |
| Experts and engineers name the same thing differently | Simple CRUD apps without complex business rules |
| Identifying core domain vs. generic subdomains | |

## Process

1. **Score the model** — Rate 0–10 based on the framework below
2. **Build ubiquitous language** — Collaborate with domain experts; document shared terms
3. **Map bounded contexts** — Identify where language changes; draw context boundaries
4. **Define building blocks** — Classify each object as Entity, Value Object, or Aggregate
5. **Design events and repositories** — Wire causality through Domain Events; abstract persistence
6. **Distill the core domain** — Identify what provides competitive advantage; focus effort there

## Scoring

**Target: 10/10.** Full marks: an expert can read the class names and recognise them, aggregates stay small, and nothing is an anemic model.

## Framework

### 1. Ubiquitous language

One precise vocabulary that developers and domain experts both use in speech, documents and source code.

| Situation | Pattern | Example |
|---|---|---|
| Class naming | Name classes after domain concepts | `LoanApplication`, not `RequestHandler` |
| Method naming | Use verbs the business uses | `policy.underwrite()`, not `policy.process()` |
| Event naming | Past-tense domain actions | `ClaimSubmitted`, not `DataSaved` |
| Packages | Group by business capability | `shipping/` and `billing/` rather than `controllers/` and `services/` |
| Review | Push back on purely technical names | `Manager`, `Helper`, `Processor`, `Utils` signal an unnamed concept |

Details: `references/ubiquitous-language.md`

### 2. Bounded contexts, context maps

A bounded context marks the region where one particular model, with its own vocabulary, is valid.

| Situation | Pattern | Example |
|---|---|---|
| Calling an outside system | Anti-Corruption Layer | Map the vendor's payload into your own types at the edge |
| Team collaboration | Shared Kernel | Two teams co-own a small `Money` value object library |
| Replacing a legacy system | Conformist or ACL | An adapter exposes the old system in your own terms |
| Many downstream consumers | Open Host Service + Published Language | One versioned API, documented, with a shared schema |
| Module boundaries | Separate packages per context | `myapp.shipping` and `myapp.billing` with explicit translation |

Details: `references/bounded-contexts.md`

### 3. Entities, value objects, aggregates

- **Entity**: identity persists across state changes ("same person even if name changes")
- **Value Object**: defined entirely by attributes; immutable ("$10 bill is interchangeable")
- **Aggregate Root**: the one door into a cluster; guards its invariants and points to other aggregates by id

| Situation | Pattern | Example |
|---|---|---|
| Tracked over time | Entity with id | `Order` keeps its `orderId` through every status change |
| Group of attributes | Value object | `Address(street, city, zip)` gets replaced wholesale, never modified in place |
| Consistency boundary | Aggregate root | `OrderLine` is reached only via its `Order` |
| Cross-aggregate reference | Reference by ID | `Order` stores `customerId`, not a `Customer` object |

Details: `references/building-blocks.md`

### 4. Domain Events

A domain event states a business-relevant fact that has already happened, named in the past tense.

| Situation | Pattern | Example |
|---|---|---|
| Status changes | Aggregate records an event | `order.place()` yields `OrderPlaced` |
| Crossing contexts | Integration event | Billing publishes `InvoicePaid`; shipping reacts by scheduling a pickup |
| Audit trail | Store events as history | Event log: `OrderPlaced` → `PaymentReceived` → `OrderShipped` |
| Eventual consistency | Asynchronous subscribers | An `InventoryReserved` subscriber adjusts stock later |

Details: `references/domain-events.md`

### 5. Repositories and factories

- **Repository**: makes stored aggregates look like a collection and conceals the storage
- **Factory**: encapsulates complex object creation; ensures aggregates are always created in valid state

| Situation | Pattern | Example |
|---|---|---|
| Loading aggregates | Repository interface | `OrderRepository.findOpenFor(customerId)` declared in the domain |
| Non-trivial construction | Factory method | `Order.fromQuote(quote)` checks inputs and builds a valid order |
| Reusable selection rule | Specification | `Overdue(30).and(HighValue)` reused for validation and lookup |
| Ports and adapters | Contract in the domain, implementation outside | `OrderRepository` interface lives in domain; `PostgresOrderRepository` lives in infrastructure |

Details: `references/repositories-factories.md`

### 6. Strategic design, distillation

- **Core Domain**: the competitive edge; assign your strongest people and deepest modeling
- **Supporting Subdomain**: necessary but not differentiating; build it plainly, no gold-plating
- **Generic Subdomain**: commodity; purchase or adopt open source

| Situation | Pattern | Example |
|---|---|---|
| Make or buy | Classify the subdomain | Pricing engine is built (core); card processing is bought (generic) |
| Code layout | Keep core apart from generic | `domain/pricing/` holds the rich model; `infrastructure/email/` is a thin adapter |

Details: `references/strategic-design.md`

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Names taken from the framework | Use business terms such as `ClaimAdjudicator` |
| A single model for the whole company | Split into contexts, each with its own model |
| Oversized aggregates | Shrink them, link by id, tolerate eventual consistency |
| Rules live in services over a hollow model | Move the rules onto entities and value objects |
| External systems called directly | Put each behind a translating adapter |

## Quick Diagnostic

| Check | When the answer is no | Action |
|---|---|---|
| Would an expert recognise your class names? | Names are engineering jargon | Rename using the shared vocabulary |
| Are the context borders written down? | Models leak into each other | Draw a context map and choose a relationship pattern per border |
| Does each aggregate hold only what one invariant needs? | Large aggregates, contention | Split and refer by id |
| Do domain objects carry the rules? | Anemic model; logic sits in services | Relocate rules onto the objects |
| Does every external integration go through a translation layer? | Outside models seep into the domain | Introduce an anti-corruption layer per integration |

## Output Template

When modeling a domain, provide:
1. Bounded context map with context names and relationships
2. Ubiquitous language glossary (key terms per context)
3. Aggregate definitions with invariants and state transitions
4. Domain event list (past tense, with publishers and consumers)

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Drafts bounded context boundaries from domain description | Validate with domain experts |
| Classifies objects as Entity / Value Object / Aggregate | Confirm business invariants |
| Generates domain event names and flow | Review with product team |
| Writes repository interface signatures | Implement in infrastructure layer |

## Reference Files

- `references/ubiquitous-language.md`
- `references/bounded-contexts.md`
- `references/building-blocks.md`
- `references/domain-events.md`
- `references/repositories-factories.md`
- `references/strategic-design.md`

## Related Skills

- `develop:clean-architecture` — architecture layers and dependency rule
- `develop:event-storming` — workshop technique to discover domain events collaboratively
- `develop:service-boundary-validator` — validate microservice decomposition
- `develop:microservices-architect` — distributed system design
