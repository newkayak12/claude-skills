---
name: clean-architecture
description: >-
  Use when designing layered architectures, separating concerns across
  boundaries, implementing ports and adapters, or when business logic is leaking
  into frameworks and the codebase feels tangled. Triggers on: "의존성 규칙", "레이어
  아키텍처".
license: MIT
metadata:
  version: "1.0.0"
scenarios:
  - "design a clean architecture for this service"
  - "my business logic is leaking into the web layer"
  - "how do I implement ports and adapters?"
  - "클린 아키텍처 적용해줘"
  - "의존성이 잘못된 방향으로 흘러가고 있어"
  - "비즈니스 로직이 컨트롤러에 너무 많이 들어가 있어"
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 의존성 방향 위반과 경계 설계 트레이드오프 분석이 더 정확해집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER add a port, layer, or interface "for flexibility". One adapter keeps the seam concrete; a port needs a second
  real adapter or a test fake you actually use. (Scar: single-implementation interfaces everywhere make a CRUD service
  five files per change.)
- NEVER score from impressions. Every point off the score cites a violating import (`file:line`, direction) you read.
- A fact you were not shown (module layout, which layer a class sits in) is `[확인 필요: ○○]`, never inferred; a score resting on one is `provisional`.
- Goal: the score recounts to the listed violations, and step 5 is checked (rule tests run with no framework import) or marked `[확인 필요]`.

# Clean Architecture Framework

Keep the rules that earn the business its money free of imports from the tools that deliver them: web stack, datastore, messaging.

**Not for** code-level naming and function size (`develop:clean-code`), bounded contexts and aggregates
(`develop:domain-driven-design`), topology and deployment (`develop:architecture-designer`), ranking refactor targets
in a live repo (`develop:architecture-review`), or simple scripts and prototypes.

## Process

1. **Assess current state** — Read the imports; list dependency rule violations; score 0–10
2. **Draw concentric circles** — innermost Entities, then Use Cases, then Interface Adapters, outermost Frameworks/Drivers
3. **Identify violations** — Find import arrows pointing outward; list them
4. **Apply Dependency Inversion** — Define interfaces in inner circles; implementations in outer circles
5. **Validate** — Confirm business logic tests run with no framework imports

### Seam Discipline (before step 4 adds a port)

- **Deletion test**: delete the module in your head. Complexity vanishes → it was a pass-through; remove it. Complexity reappears across callers → it earns its place.
- **Adapter rule**: one adapter → keep it concrete; the seam is hypothetical. A second adapter (real, or a test fake you actually need) → introduce the port.
- **The interface is the test surface**: tests cross the same seam callers do. If a test must reach past it, the module is the wrong shape.

## Scoring

Rate 0–10. A 10 means every business rule can be exercised in a test with nothing else running.

## The Clean Architecture Framework

### 1. Dependency Rule and the Rings

Imports run toward the middle only. A class in an inner ring has no knowledge that any outer ring exists.

| Context | Pattern | Example |
|---------|---------|---------|
| Layer direction | The inner ring declares the contract; the outer ring fulfils it | `UserRepository` declared with the use cases; `PostgresUserRepository` lives in adapters |
| Data crossing | Plain data holders travel between rings; persistence-mapped objects stay outside | Use case answers with a `UserResponse`, never the table-mapped class |
| Framework isolation | Put framework calls behind your own interface | `EmailSender` interface hides whether you use SendGrid or SES |
| Database independence | A repository hides how data is stored | rules call `repo.save(user)` and never see SQL |

See: [references/dependency-direction.md](references/dependency-direction.md)

### 2. Entities and Use Cases

- **Entities** hold the rules that apply company-wide and import no framework
- **Use Cases** hold rules specific to one application operation, drive the entities, take a request model in and hand a response model back

| Context | Pattern | Example |
|---------|---------|---------|
| Entity design | Encapsulate rules with no framework dependencies | `Order.calculateTotal()` knows nothing about HTTP |
| Use Case boundary | Declare an input port and an output port | `CreateOrderInput` interface; `CreateOrderOutput` interface |
| Request/Response | Dumb value objects carry input and output | `CreateOrderRequest { items, customerId }`, free of persistence types |
| Single responsibility | A class per application operation | `PlaceOrder`, `CancelOrder`, `RefundOrder` kept apart |

See: [references/use-cases-and-adapters.md](references/use-cases-and-adapters.md)

### 3. Adapters and Frameworks

Adapters translate between the use cases' data shapes and whatever the outside world speaks. Frameworks sit in the outermost ring.

| Context | Pattern | Example |
|---------|---------|---------|
| Controller | Turns an incoming call into the use case's input | `OrderController.create(req)` assembles a `CreateOrderRequest` |
| Presenter | Shapes the use case's answer for display | `OrderPresenter.present(response)` prepares the JSON payload |
| Gateway | Implements repository interface using a specific DB | `SqlOrderRepository implements OrderRepository` |
| Plugin architecture | Main component wires dependencies at startup | `main()` instantiates concrete classes and injects them |

See: [references/use-cases-and-adapters.md](references/use-cases-and-adapters.md)

### 4. Component Principles

- **REP**: what ships as one unit should also be reusable as one unit
- **CCP**: group classes that a single kind of change will touch
- **ADP**: the module graph stays free of loops
- **SDP**: point dependencies at the modules that change less

See: [references/components-and-solid.md](references/components-and-solid.md)

### 5. SOLID Principles

SRP, OCP, LSP, ISP, DIP, with traps and checks in the reference. Typical DIP break: `OrderService` imports `StripeClient` directly.

See: [references/components-and-solid.md](references/components-and-solid.md)

### 6. Boundary Strength and Humble Objects

- **Full boundary**: one interface per direction (input port plus output port)
- **Partial boundary**: strategy or facade pattern
- **Humble Object**: split behavior at a boundary — testable logic separate from hard-to-test infrastructure

See: [references/boundary-strength.md](references/boundary-strength.md)

## Quick Diagnostic

Any "no" is a violation row: rule tests need neither datastore nor server · every import points inward · the datastore
can change with the rules untouched · use cases ignore how requests arrive · the framework stays in the outer ring.

## Output Template

```
## Clean architecture — <service or path>

Score: <n>/10 — <one line citing the violations below>
Violations: <# · importer → imported (file:line) · direction> ...
Plan: <interface to extract / class to move, per violation #>
Diagram: before/after (Mermaid or ASCII)

<v> violations · <p> ports proposed · <u> facts [확인 필요]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Draws the concentric circle diagram | Share existing module structure |
| Identifies dependency rule violations | Confirm business rules and domain entities |
| Defines interface contracts at each boundary | Implement concrete classes in outer circles |
| Writes Use Case input/output DTOs | Wire dependencies in Main/composition root |

## Reference Files

- [dependency-direction.md](references/dependency-direction.md)
- [use-cases-and-adapters.md](references/use-cases-and-adapters.md)
- [components-and-solid.md](references/components-and-solid.md)
- [boundary-strength.md](references/boundary-strength.md)

## Related Skills

- `develop:architecture-review` — rank which tangled modules to deepen first, from git history
- `develop:clean-code` — code-level quality within each layer
- `develop:domain-driven-design` — domain modeling and bounded contexts
- `develop:architecture-designer` — structural and deployment-level decisions
