---
name: clean-code
description: >-
  Use when reviewing, refactoring, or writing code that others need to read and maintain — any code that is hard to understand, has grown too long, or whose intent is not immediately clear.
  Triggers on: "리팩토링", "코드 가독성", "clean code", "code review", "코드 품질", "refactor", "hard to read", "code smell", "technical debt", "네이밍", "함수가 너무 길어".
  Best for: PR code reviews, refactoring legacy code, naming and function design guidance.
  Not for: system architecture decisions (use clean-architecture); domain modeling (use domain-driven-design).
license: MIT
metadata:
  author: wondelai
  version: "1.0.0"
scenarios:
  - "review this code for quality"
  - "refactor this function — it's too long"
  - "how should I name this variable?"
  - "이 코드 리팩토링해줘"
  - "코드 가독성이 너무 낮아"
  - "함수가 너무 길고 복잡해"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 코드 스멜 탐지와 리팩토링 우선순위 판단이 더 정확해집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Clean Code Framework

A disciplined approach to writing code that communicates intent, minimizes surprises, and welcomes change.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Code review or PR feedback | Architectural layer decisions (use clean-architecture) |
| Refactoring legacy code | Domain modeling (use domain-driven-design) |
| Writing new code that others will maintain | Performance optimization (profile first) |
| Naming variables, functions, classes | Infrastructure or deployment config |

## Process

1. **Score the code** — Rate 0–10 based on the framework below; state the score explicitly
2. **Identify smells** — List specific violations by category (names, functions, comments, errors, tests)
3. **Prioritize** — Address highest-impact issues first (usually names and function size)
4. **Refactor** — Apply targeted fixes with before/after examples
5. **Verify** — Confirm tests still pass; re-score

## Scoring

**Goal: 10/10.** Rate code 0–10 based on adherence to the principles below.

- **9–10:** Names reveal intent, functions small and focused, error handling consistent, tests clean and comprehensive
- **7–8:** Mostly clean with minor naming ambiguities or a few long functions
- **5–6:** Mixed quality — some good patterns alongside unclear names or duplicated logic
- **3–4:** Significant readability issues — long functions, misleading names, poor or missing tests
- **1–2:** Code works but is nearly unreadable — magic numbers, cryptic abbreviations, no tests

## The Clean Code Framework

### 1. Meaningful Names

Names should reveal intent, avoid disinformation, and make the code read like prose.

| Context | Pattern | Example |
|---------|---------|---------|
| Variables | Intention-revealing name | `elapsedTimeInDays` not `d` |
| Booleans | Predicate phrasing | `isActive`, `hasPermission`, `canEdit` |
| Functions | Verb + noun describing action | `calculateMonthlyRevenue()` not `calc()` |
| Classes | Noun describing responsibility | `InvoiceGenerator` not `InvoiceManager` |
| Constants | Searchable, all-caps with context | `MAX_RETRY_ATTEMPTS = 3` not `3` inline |
| Collections | Plural nouns or descriptive phrases | `activeUsers` not `list` or `data` |

See: [references/naming-conventions.md](references/naming-conventions.md)

### 2. Functions

Functions should be small (4–6 lines ideal), do one thing, and operate at a single level of abstraction.

| Context | Pattern | Example |
|---------|---------|---------|
| Long function | Extract into named steps | `validateInput(); transformData(); saveRecord();` |
| Flag argument | Split into two functions | `renderForPrint()` and `renderForScreen()` not `render(isPrint)` |
| Deep nesting | Extract inner blocks | Move nested `if`/`for` bodies into named functions |
| Multiple returns | Guard clauses at top | Early return for error cases, single happy path |
| Many arguments | Introduce parameter object | `new DateRange(start, end)` not `report(start, end, format, locale)` |

See: [references/functions-and-methods.md](references/functions-and-methods.md)

### 3. Comments and Formatting

A comment is a failure to express yourself in code. Comments should explain *why*, never *what*.

| Context | Pattern | Example |
|---------|---------|---------|
| Explaining "what" | Replace with better name | Rename `// check if eligible` to `isEligible()` |
| Explaining "why" | Keep as comment | `// RFC 7231 requires this header for proxies` |
| Commented-out code | Delete it | Trust version control to remember |
| File organization | Newspaper metaphor | High-level functions at top, details below |
| Team formatting | Agree on rules once | Use automated formatters (Prettier, Black, gofmt) |

See: [references/comments-formatting.md](references/comments-formatting.md)

### 4. Error Handling

Use exceptions rather than return codes, provide context with every exception, and never return or pass null.

| Context | Pattern | Example |
|---------|---------|---------|
| Null returns | Return empty collection or Optional | `return Collections.emptyList()` not `return null` |
| Error codes | Replace with exceptions | `throw new InsufficientFundsException(balance, amount)` |
| Third-party APIs | Wrap with adapter | `PortfolioService` wraps vendor API, translates exceptions |
| Special cases | Null Object pattern | `GuestUser` with default behavior instead of null checks |

See: [references/error-handling.md](references/error-handling.md)

### 5. Unit Testing

Tests are first-class code — clean, readable, maintained with the same discipline as production code.

| Context | Pattern | Example |
|---------|---------|---------|
| Test structure | Arrange-Act-Assert | Setup, execute, verify — clearly separated |
| Test naming | Scenario + expected behavior | `shouldRejectExpiredToken` not `test1` |
| Flaky tests | Remove external dependencies | Mock time, network, file system |
| Test readability | Domain-specific helpers | `assertThatInvoice(inv).isPaidInFull()` |

See: [references/testing-principles.md](references/testing-principles.md)

### 6. Code Smells and Heuristics

| Context | Pattern | Example |
|---------|---------|---------|
| Duplication | Extract shared logic | Common validation → `validateEmail()` helper |
| Long parameter list | Introduce parameter object | `SearchCriteria` groups related params |
| Feature envy | Move method to data's class | `order.calculateTotal()` not `calculator.total(order)` |
| Dead code | Delete it | Remove unused functions, unreachable branches |
| Magic numbers | Named constants | `MAX_LOGIN_ATTEMPTS = 5` not bare `5` |

See: [references/code-smells.md](references/code-smells.md)

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Can you understand each function without reading its body? | Names don't reveal intent | Rename functions to describe what they do |
| Are all functions under 20 lines? | Functions do too many things | Extract sub-operations into named helpers |
| Are there zero commented-out code blocks? | Dead code creating confusion | Delete them — version control has history |
| Is error handling separate from business logic? | Try-catch cluttering main flow | Extract error handling; use exceptions not return codes |
| Does every class have a single responsibility? | Classes accumulate unrelated duties | Split into focused classes with clear names |
| Is there a test for every public method? | No safety net for changes | Add tests before making further changes |
| Are magic numbers replaced with named constants? | Intent hidden behind raw values | Extract constants with descriptive names |

## Output Template

When reviewing code, provide:
1. Score (0–10) with justification
2. Top 3–5 issues by category
3. Before/after code snippets for each fix
4. Improved score after fixes applied

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Scores the code and lists specific violations | Share the code or PR diff |
| Produces before/after refactoring examples | Confirm business intent behind unclear code |
| Suggests better names with reasoning | Apply fixes and run tests |
| Identifies test coverage gaps | Merge after teammate review |

## Reference Files

- [naming-conventions.md](references/naming-conventions.md)
- [functions-and-methods.md](references/functions-and-methods.md)
- [comments-formatting.md](references/comments-formatting.md)
- [error-handling.md](references/error-handling.md)
- [testing-principles.md](references/testing-principles.md)
- [code-smells.md](references/code-smells.md)

## Related Skills

- `develop:clean-architecture` — architectural layer structure and dependency rule
- `develop:domain-driven-design` — domain modeling and ubiquitous language
- `develop:test-master` — comprehensive test generation
- `develop:test-driven-development` — test-first workflow
