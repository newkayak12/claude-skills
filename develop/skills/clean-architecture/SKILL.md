---
name: clean-architecture
description: >-
  Use when designing layered architectures, separating concerns across
  boundaries, implementing ports and adapters, or when business logic is leaking
  into frameworks and the codebase feels tangled. Triggers on: "의존성 규칙", "레이어
  아키텍처", "clean
license: MIT
metadata:
  author: wondelai
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

A disciplined approach to structuring software so that business rules remain independent of frameworks, databases, and delivery mechanisms.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Designing layer boundaries for a new service | Code-level naming and function size (use clean-code) |
| Business logic is coupled to HTTP or ORM | Domain modeling with bounded contexts (use domain-driven-design) |
| Swap database or framework is too hard | Simple scripts or prototypes |
| Writing testable use cases | |

## Process

1. **Assess current state** — Score the architecture 0–10; identify dependency rule violations
2. **Draw concentric circles** — Entities → Use Cases → Interface Adapters → Frameworks/Drivers
3. **Identify violations** — Find import arrows pointing outward; list them
4. **Apply Dependency Inversion** — Define interfaces in inner circles; implementations in outer circles
5. **Validate** — Confirm business logic tests run with no framework imports

## Scoring

**Goal: 10/10.** Rate architecture 0–10. A 10/10 means business rules can be tested with no database, web server, or framework present.

## The Clean Architecture Framework

### 1. Dependency Rule and Concentric Circles

Source code dependencies always point inward. Nothing in an inner circle can know anything about an outer circle.

| Context | Pattern | Example |
|---------|---------|---------|
| Layer direction | Inner circles define interfaces; outer circles implement them | `UserRepository` interface in Use Cases; `PostgresUserRepository` in Adapters |
| Data crossing | DTOs or simple structs cross boundaries, not ORM entities | Use Case returns `UserResponse` DTO, not an ActiveRecord model |
| Framework isolation | Wrap framework calls behind interfaces | `EmailSender` interface hides whether you use SendGrid or SES |
| Database independence | Repository pattern abstracts persistence | Business logic calls `repo.save(user)`, never raw SQL |

See: [references/dependency-rule.md](references/dependency-rule.md)

### 2. Entities and Use Cases

- **Entities** encapsulate enterprise-wide business rules; no framework dependencies
- **Use Cases** contain application-specific rules; orchestrate Entities; accept Request Models and return Response Models

| Context | Pattern | Example |
|---------|---------|---------|
| Entity design | Encapsulate rules with no framework dependencies | `Order.calculateTotal()` knows nothing about HTTP |
| Use Case boundary | Define Input Port and Output Port interfaces | `CreateOrderInput` interface; `CreateOrderOutput` interface |
| Request/Response | Simple data structures cross the boundary | `CreateOrderRequest { items, customerId }` — no ORM models |
| Single responsibility | One Use Case per application operation | `PlaceOrder`, `CancelOrder`, `RefundOrder` as separate classes |

See: [references/entities-use-cases.md](references/entities-use-cases.md)

### 3. Interface Adapters and Frameworks

Interface Adapters convert data between Use Cases and external agencies. Frameworks belong in the outermost circle.

| Context | Pattern | Example |
|---------|---------|---------|
| Controller | Translates delivery mechanism to Use Case input | `OrderController.create(req)` builds `CreateOrderRequest` |
| Presenter | Translates Use Case output to view model | `OrderPresenter.present(response)` formats data for JSON |
| Gateway | Implements repository interface using a specific DB | `SqlOrderRepository implements OrderRepository` |
| Plugin architecture | Main component wires dependencies at startup | `main()` instantiates concrete classes and injects them |

See: [references/adapters-frameworks.md](references/adapters-frameworks.md)

### 4. Component Principles

- **REP**: classes in a component should be releasable together
- **CCP**: classes that change for the same reason belong in the same component
- **ADP**: no cycles in the component dependency graph
- **SDP**: depend in the direction of stability

See: [references/component-principles.md](references/component-principles.md)

### 5. SOLID Principles

| Principle | Core Rule | Common Violation |
|-----------|-----------|-----------------|
| SRP | One reason to change | `Employee` handles pay, reporting, and persistence |
| OCP | Extend by adding new code, not modifying existing | Adding `if` branches for new types |
| LSP | Subtypes usable through base type | `Square extends Rectangle` breaks `setWidth()` contract |
| ISP | Don't force clients to depend on unused methods | Fat interface forces importing unneeded methods |
| DIP | High-level modules depend on abstractions | `OrderService` imports `StripeClient` directly |

See: [references/solid-principles.md](references/solid-principles.md)

### 6. Boundaries and Boundary Anatomy

- **Full boundary**: reciprocal interfaces on both sides (Input Port + Output Port)
- **Partial boundary**: strategy or facade pattern
- **Humble Object**: split behavior at a boundary — testable logic separate from hard-to-test infrastructure

See: [references/boundaries.md](references/boundaries.md)

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Can you test business rules without a database or web server? | Business rules coupled to infrastructure | Extract entities and use cases behind interfaces |
| Do source code dependencies point inward on every import? | Dependency Rule violated | Introduce interfaces; invert the offending dependency |
| Can you swap the database without changing business logic? | Persistence leaking inward | Implement Repository pattern |
| Are Use Cases independent of the delivery mechanism? | Use Cases know about HTTP | Remove delivery-specific types; use plain DTOs |
| Is the framework confined to the outermost circle? | Framework is your architecture | Wrap framework calls behind interfaces |

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

- [dependency-rule.md](references/dependency-rule.md)
- [entities-use-cases.md](references/entities-use-cases.md)
- [adapters-frameworks.md](references/adapters-frameworks.md)
- [component-principles.md](references/component-principles.md)
- [solid-principles.md](references/solid-principles.md)
- [boundaries.md](references/boundaries.md)

## Related Skills

- `develop:clean-code` — code-level quality within each layer
- `develop:domain-driven-design` — domain modeling and bounded contexts
- `develop:architecture-designer` — structural and deployment-level decisions
