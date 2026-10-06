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

# Clean Architecture Framework

Keep the rules that earn the business its money free of imports from the tools that deliver them: web stack, datastore, messaging.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Designing layer boundaries for a new service | Code-level naming and function size (use clean-code) |
| Business logic is coupled to HTTP or ORM | Domain modeling with bounded contexts (use domain-driven-design) |
| Swap database or framework is too hard | Simple scripts or prototypes |
| Writing testable use cases | |

## Process

1. **Assess current state** — Score the architecture 0–10; identify dependency rule violations
2. **Draw concentric circles** — innermost Entities, then Use Cases, then Interface Adapters, outermost Frameworks/Drivers
3. **Identify violations** — Find import arrows pointing outward; list them
4. **Apply Dependency Inversion** — Define interfaces in inner circles; implementations in outer circles
5. **Validate** — Confirm business logic tests run with no framework imports

### Seam Discipline (before step 4 adds a port)

- **Deletion test**: delete the module in your head. Complexity vanishes → it was a pass-through; remove it. Complexity reappears across callers → it earns its place.
- **Adapter rule**: one adapter → keep it concrete; the seam is hypothetical. A second adapter (real, or a test fake you actually need) → introduce the port.
- **The interface is the test surface**: tests cross the same seam callers do. If a test must reach past it, the module is the wrong shape.

## Scoring

**Goal: 10/10.** Rate architecture 0–10. A 10/10 means every business rule can be exercised in a test with nothing else running.

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

| Principle | Core Rule | Common Violation |
|-----------|-----------|-----------------|
| SRP | One reason to change | `Employee` handles pay, reporting, and persistence |
| OCP | New behaviour arrives as new classes, existing ones stay untouched | Another `if` branch per new variant |
| LSP | Subtypes usable through base type | `Square extends Rectangle` breaks `setWidth()` contract |
| ISP | Don't force clients to depend on unused methods | Fat interface forces importing unneeded methods |
| DIP | High-level modules depend on abstractions | `OrderService` imports `StripeClient` directly |

See: [references/components-and-solid.md](references/components-and-solid.md)

### 6. Boundary Strength and Humble Objects

- **Full boundary**: one interface per direction (input port plus output port)
- **Partial boundary**: strategy or facade pattern
- **Humble Object**: split behavior at a boundary — testable logic separate from hard-to-test infrastructure

See: [references/boundary-strength.md](references/boundary-strength.md)

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Do the rule tests pass with neither datastore nor server up? | Rules are entangled with infrastructure | Extract entities and use cases behind interfaces |
| Does every import point toward the center? | The dependency rule is broken | Introduce interfaces; invert the offending dependency |
| Could the datastore change with the rules left alone? | Persistence leaking inward | Implement Repository pattern |
| Do use cases ignore how requests arrive? | Use Cases know about HTTP | Remove delivery-specific types; use plain DTOs |
| Is the framework kept in the outer ring? | The framework dictates your structure | Hide framework calls behind your own interfaces |

## Output Template

When designing or reviewing an architecture, provide:
1. Score (0–10) with justification
2. Dependency violations found (import path + direction)
3. Refactoring plan (interfaces to extract, classes to move)
4. Before/after diagram (Mermaid or ASCII)

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

- `develop:clean-code` — code-level quality within each layer
- `develop:domain-driven-design` — domain modeling and bounded contexts
- `develop:architecture-designer` — structural and deployment-level decisions
