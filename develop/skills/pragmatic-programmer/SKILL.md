---
name: pragmatic-programmer
description: >-
  Use when reflecting on engineering practices, identifying systemic problems in a codebase, deciding how to approach technical debt, or asking what a pragmatic engineer would do in a given situation.
  Triggers on: "DRY 원칙", "기술 부채", "pragmatic programmer", "engineering practices", "technical debt", "tracer bullet", "orthogonality", "broken window", "코드베이스 전반적인 문제", "estimation", "설계 원칙".
  Best for: engineering practice retrospectives, architectural principle violations, codebase health assessments.
  Not for: code-level naming and function design (use clean-code); system architecture decisions (use architecture-designer).
license: MIT
metadata:
  author: wondelai
  version: "1.0.0"
scenarios:
  - "what engineering principles should guide this codebase?"
  - "we have a lot of technical debt — where do we start?"
  - "how do I estimate this project properly?"
  - "DRY 원칙을 어떻게 적용해야 해?"
  - "기술 부채 어디서부터 해결해야 할지 모르겠어"
  - "설계 원칙 관점에서 이 코드베이스 리뷰해줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 DRY 위반과 직교성 문제 분석이 더 정확해집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# The Pragmatic Programmer Framework

A systems-level approach to software craftsmanship. Apply when designing systems, reviewing architecture, writing code, or advising on engineering culture.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Engineering practice retrospectives | Code-level naming (use clean-code) |
| Diagnosing codebase health across multiple principles | Architecture structural decisions (use architecture-designer) |
| Discussing technical debt strategy | Domain modeling (use domain-driven-design) |
| Project estimation and knowledge portfolio | |

## Process

1. **Score the codebase** — Rate 0–10 against the seven principles below
2. **Identify the top violations** — Focus on the highest-impact problems first
3. **Prioritize remediation** — Broken windows first; then DRY and orthogonality issues
4. **Apply targeted fixes** — One principle at a time; measure before and after
5. **Establish habits** — Document decisions, estimate with ranges, invest in learning

## Scoring

**Goal: 10/10.** Rate 0–10; a 10/10 means every piece of knowledge has one authoritative source, changes in one module don't surprise other modules, and the team can reverse decisions quickly.

## The Seven Principles

### 1. DRY (Don't Repeat Yourself)

Every piece of **knowledge** must have a single, unambiguous, authoritative representation. DRY is about knowledge, not code — two identical blocks serving different business rules are NOT duplication.

| Context | Pattern | Example |
|---------|---------|---------|
| Config values | Single source of truth | Define DB connection in one env file, reference everywhere |
| Validation rules | Shared schema | Use JSON Schema or Zod schema for both client and server |
| API contracts | Generate from spec | OpenAPI spec generates types, docs, and client code |
| Business logic | Domain module | Tax calculation in one module, not scattered across controllers |

See: [references/dry-orthogonality.md](references/dry-orthogonality.md)

### 2. Orthogonality

Two components are orthogonal if changes in one do not affect the other.

| Context | Pattern | Example |
|---------|---------|---------|
| Architecture | Layered separation | Controller → Service → Repository, each replaceable |
| Dependencies | Dependency injection | Pass a `Notifier` interface, not a `SlackClient` concrete class |
| Testing | Isolated unit tests | Test business logic without database, network, or filesystem |
| Deployment | Independent services | Deploy auth service without redeploying payment service |

See: [references/dry-orthogonality.md](references/dry-orthogonality.md)

### 3. Tracer Bullets and Prototypes

- **Tracer bullet**: thin but complete end-to-end path through the system — production code, you keep it
- **Prototype**: focused exploration of a single risky aspect — throwaway, you discard it

| Context | Pattern | Example |
|---------|---------|---------|
| New project | Vertical slice | Build one feature end-to-end: button → API → DB → response |
| Uncertain tech | Spike prototype | Test if WebSocket performance is sufficient before committing |
| Microservice | Walking skeleton | Deploy a hello-world service through the full CI/CD pipeline |

See: [references/tracer-bullets.md](references/tracer-bullets.md)

### 4. Design by Contract and Assertive Programming

Define preconditions (what must be true before), postconditions (what is guaranteed after), and invariants (what is always true). When a contract is violated, fail immediately and loudly.

| Context | Pattern | Example |
|---------|---------|---------|
| Function entry | Precondition guard | `assert age >= 0, "Age cannot be negative"` |
| Class state | Invariant validation | `validate!` method called after every state mutation |
| API boundary | Schema validation | Validate request body against schema before processing |

See: [references/contracts-assertions.md](references/contracts-assertions.md)

### 5. The Broken Window Theory

One broken window — a hack, a poor decision, a TODO that was never fixed — starts the rot. Don't leave broken windows unrepaired.

| Context | Pattern | Example |
|---------|---------|---------|
| Legacy code | Board up windows | Wrap bad code in a clean interface before adding features |
| Code review | Zero-tolerance for new debt | Reject PRs that add `// TODO: fix later` without a ticket |
| Tech debt | Debt budget | Allocate 20% of each sprint to fixing broken windows |

See: [references/broken-windows.md](references/broken-windows.md)

### 6. Reversibility and Flexibility

There are no final decisions. Build systems that make it easy to change your mind about databases, frameworks, vendors, and architecture.

| Context | Pattern | Example |
|---------|---------|---------|
| Database | Repository pattern | Business logic calls `repo.save(user)`, not `pg.query(...)` |
| External API | Adapter/wrapper | `PaymentGateway` interface wraps Stripe; swap to Braintree later |
| Feature flags | Runtime toggles | New checkout flow behind a flag, rollback in seconds |

See: [references/reversibility.md](references/reversibility.md)

### 7. Estimation and Knowledge Portfolio

Learn to estimate reliably with ranges. Manage your learning like a financial portfolio: invest regularly, diversify, and rebalance.

| Context | Pattern | Example |
|---------|---------|---------|
| Sprint planning | Range estimates | "3–5 days" with confidence level, not a single number |
| New technology | Time-boxed spike | "I'll spend 2 days evaluating; then I can estimate properly" |
| Career growth | Portfolio diversification | Mix of depth (expertise) and breadth (adjacent skills) |

See: [references/estimation-portfolio.md](references/estimation-portfolio.md)

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| DRY-ing similar-looking code that serves different purposes | Only DRY knowledge, not coincidental code similarity |
| Skipping tracer bullets and building layer-by-layer | Build one thin vertical slice first |
| Ignoring broken windows "because we'll refactor later" | Fix immediately or board up with a tracked ticket |
| Estimates as single-point commitments | Always give ranges with confidence levels |
| Assertions removed in production "for performance" | Keep critical assertions; benchmark before removing any |

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Can I change the database without touching business logic? | Orthogonality violation | Introduce repository/adapter pattern |
| Is every business rule defined in exactly one place? | DRY violation | Identify the authoritative source and remove duplicates |
| Do my estimates include ranges and confidence levels? | Estimation problem | Switch to PERT or range-based estimates |
| Can I roll back this deployment in under 5 minutes? | Reversibility gap | Add feature flags and blue-green deploys |

## Output Template

When auditing a codebase, provide:
1. Score (0–10) per principle with examples of violations
2. Top 3 highest-impact improvements
3. Prioritized remediation plan with effort estimates

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Scores codebase against seven principles | Share codebase or specific code sections |
| Identifies broken windows with specific examples | Prioritize which debt to tackle first |
| Produces range-based effort estimates | Validate estimates with team knowledge |
| Suggests tracer bullet slice definition | Build and demo the vertical slice |

## Reference Files

- [references/dry-orthogonality.md](references/dry-orthogonality.md)
- [references/tracer-bullets.md](references/tracer-bullets.md)
- [references/contracts-assertions.md](references/contracts-assertions.md)
- [references/broken-windows.md](references/broken-windows.md)
- [references/reversibility.md](references/reversibility.md)
- [references/estimation-portfolio.md](references/estimation-portfolio.md)

## Related Skills

- `develop:clean-code` — code-level quality principles
- `develop:clean-architecture` — architectural structure and dependency rule
- `develop:architecture-designer` — structural and deployment-level decisions
