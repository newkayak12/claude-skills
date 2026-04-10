---
name: domain-driven-design
description: >-
  Use when aligning code structure with business concepts, designing service
  boundaries, or when domain experts and developers cannot agree on what things
  mean. Triggers on: "도메인 모델링", "바운디드 컨텍스트", "DDD", "domain-driven design",
  "bounded context",
license: MIT
metadata:
  author: wondelai
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

# Domain-Driven Design Framework

Framework for tackling software complexity by modeling code around the business domain.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Aligning code structure with business concepts | Architecture layering (use clean-architecture) |
| Defining service boundaries from domain analysis | Service coupling validation (use service-boundary-validator) |
| Domain experts and developers speak different languages | Simple CRUD apps without complex business rules |
| Identifying core domain vs. generic subdomains | |

## Process

1. **Score the model** — Rate 0–10 based on the framework below
2. **Build ubiquitous language** — Collaborate with domain experts; document shared terms
3. **Map bounded contexts** — Identify where language changes; draw context boundaries
4. **Define building blocks** — Classify each object as Entity, Value Object, or Aggregate
5. **Design events and repositories** — Wire causality through Domain Events; abstract persistence
6. **Distill the core domain** — Identify what provides competitive advantage; focus effort there

## Scoring

**Goal: 10/10.** A 10/10 means domain experts can read class names and understand them, aggregates are small, and no anemic domain model exists.

## Framework

### 1. Ubiquitous Language

A shared, rigorous language between developers and domain experts used consistently in conversation, documentation, and code.

| Context | Pattern | Example |
|---------|---------|---------|
| Class naming | Name classes after domain concepts | `LoanApplication`, not `RequestHandler` |
| Method naming | Use verbs the business uses | `policy.underwrite()`, not `policy.process()` |
| Event naming | Past-tense domain actions | `ClaimSubmitted`, not `DataSaved` |
| Module structure | Organize by domain concept | `shipping/`, `billing/`, not `controllers/`, `services/` |
| Code review | Reject technical-only names | Flag `Manager`, `Helper`, `Processor`, `Utils` as naming smells |

See: [references/ubiquitous-language.md](references/ubiquitous-language.md)

### 2. Bounded Contexts and Context Mapping

A bounded context is an explicit boundary within which a particular domain model is defined and applicable.

| Context | Pattern | Example |
|---------|---------|---------|
| Service integration | Anti-Corruption Layer | Translate external API responses into your domain objects at the boundary |
| Team collaboration | Shared Kernel | Two teams co-own a small `Money` value object library |
| Legacy migration | Conformist / ACL | Wrap legacy system behind an adapter that speaks your domain language |
| API design | Open Host Service + Published Language | Expose a well-documented REST API with a canonical schema |
| Module boundaries | Separate packages per context | `myapp.shipping` and `myapp.billing` with explicit translation |

See: [references/bounded-contexts.md](references/bounded-contexts.md)

### 3. Entities, Value Objects, and Aggregates

- **Entity**: identity persists across state changes ("same person even if name changes")
- **Value Object**: defined entirely by attributes; immutable ("$10 bill is interchangeable")
- **Aggregate Root**: single entry point enforcing consistency; reference other aggregates by ID only

| Context | Pattern | Example |
|---------|---------|---------|
| Identity tracking | Entity with ID | `Order` identified by `orderId`, survives state changes |
| Immutable attributes | Value Object | `Address(street, city, zip)` — replace, never mutate |
| Consistency boundary | Aggregate Root | `Order` is root; `OrderLine` items exist only through it |
| Cross-aggregate reference | Reference by ID | `Order` stores `customerId`, not a `Customer` object |

See: [references/building-blocks.md](references/building-blocks.md)

### 4. Domain Events

Domain events capture something that happened in the domain that domain experts care about — named in past tense.

| Context | Pattern | Example |
|---------|---------|---------|
| State transitions | Raise event on domain action | `order.place()` raises `OrderPlaced` event |
| Cross-context integration | Publish integration event | `OrderPlaced` triggers `ShippingLabelRequested` in shipping context |
| Audit trail | Store events as history | Event log: `OrderPlaced` → `PaymentReceived` → `OrderShipped` |
| Eventual consistency | Async event handlers | `InventoryReserved` handler updates stock asynchronously |

See: [references/domain-events.md](references/domain-events.md)

### 5. Repositories and Factories

- **Repository**: provides the illusion of an in-memory collection; hides persistence details
- **Factory**: encapsulates complex object creation; ensures aggregates are always created in valid state

| Context | Pattern | Example |
|---------|---------|---------|
| Data access abstraction | Repository interface | `OrderRepository.findByCustomer(customerId)` in domain layer |
| Complex creation | Factory method | `Order.createFromQuote(quote)` validates and assembles |
| Query encapsulation | Specification | `spec = OverdueBy(days=30); repo.findMatching(spec)` |
| Ports and adapters | Interface in domain, impl in infra | `interface OrderRepository` in domain; `PostgresOrderRepository` in infrastructure |

See: [references/repositories-factories.md](references/repositories-factories.md)

### 6. Strategic Design and Distillation

- **Core Domain**: competitive advantage; invest best developers and deepest modeling here
- **Supporting Subdomain**: necessary but not differentiating; build it, don't over-engineer
- **Generic Subdomain**: commodity; buy or use open-source

| Context | Pattern | Example |
|---------|---------|---------|
| Build vs. buy | Classify subdomain type | Build custom pricing engine (core); use Stripe for payments (generic) |
| Code organization | Separate core from generic | `domain/pricing/` (deep model) vs. `infrastructure/email/` (thin adapter) |

See: [references/strategic-design.md](references/strategic-design.md)

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Technical names instead of domain language | Rename to domain terms: `ClaimAdjudicator`, `PolicyUnderwriter` |
| One model to rule them all | Define bounded contexts; each gets its own model |
| Giant aggregates | Keep aggregates small; reference by ID; accept eventual consistency |
| Anemic domain model (all logic in services) | Move behavior into entities and value objects |
| No Anti-Corruption Layer at integration points | Wrap every external system behind a translation layer |

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Can a domain expert read your class names? | Technical jargon instead of domain language | Rename to ubiquitous language |
| Are bounded context boundaries explicitly defined? | Models bleed across boundaries | Draw a context map; define translation strategies |
| Are aggregates small (one root + minimal cluster)? | Aggregates are large and slow | Break into smaller aggregates; reference by ID |
| Do domain objects contain behavior? | Anemic model; logic scattered in services | Move business rules into entities and value objects |
| Is there an Anti-Corruption Layer at every external integration? | Foreign models pollute your domain | Add a translation layer at each boundary |

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

- [ubiquitous-language.md](references/ubiquitous-language.md)
- [bounded-contexts.md](references/bounded-contexts.md)
- [building-blocks.md](references/building-blocks.md)
- [domain-events.md](references/domain-events.md)
- [repositories-factories.md](references/repositories-factories.md)
- [strategic-design.md](references/strategic-design.md)

## Related Skills

- `develop:clean-architecture` — architecture layers and dependency rule
- `develop:event-storming` — workshop technique to discover domain events collaboratively
- `develop:service-boundary-validator` — validate microservice decomposition
- `develop:microservices-architect` — distributed system design
