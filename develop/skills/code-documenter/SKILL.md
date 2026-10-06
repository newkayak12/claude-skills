---
name: code-documenter
description: >-
  Use when code or an API lacks docs. Triggers on: "주석/독스트링 달아줘", "Swagger 문서 만들어줘", "문서 사이트 만들어줘", "add JSDoc",
  "generate OpenAPI spec", "write a README tutorial". Not for doc planning.
scenarios:
  - "Our codebase has no documentation and new engineers can't understand it"
  - "Generate API documentation from this undocumented codebase"
  - "Write inline comments and a README for this legacy module"
  - "코드베이스에 문서가 없어서 신규 입사자들이 이해를 못 해"
  - "이 모듈에 대한 API 문서를 생성해줘"
compatibility:
  recommended: []
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 문서 커버리지 전략과 정보 구조 설계를 더 체계적으로 검토합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
license: MIT
metadata:
  version: "1.1.0"
  domain: documentation
  triggers: docstrings, KDoc, JSDoc, OpenAPI, Swagger, README, changelog, tutorials, doc site, API reference
  role: documentation specialist
  output-format: documented source and docs
  related-skills: documentation-strategy, frontend-developer
---

# Code Documenter

## When to Use / When Not to Use

**Use when:**
- Functions and classes lack docstrings, JSDoc, or KDoc
- An existing API needs an OpenAPI/Swagger spec
- The project needs a documentation site (Docusaurus, MkDocs, VitePress)
- Writing tutorials, user guides, or troubleshooting docs

**Do not use when:**
- You need architectural decision documentation (use `write:plans` (ADR format))
- You need a documentation strategy plan (use `documentation-strategy`)

## Process

1. **Discover** — Ask which doc format the user wants and what to leave out. If they have no preference, read the repo for an established convention; with none present, use Google style for Python and JSDoc for TypeScript/JS.
2. **Detect** — Determine the language and framework in use
3. **Analyze** — List public functions, classes, and API endpoints that have no docs yet
4. **Document** — Write every target in the one chosen format
5. **Validate** — Make sure each code example in the docs builds or runs:
   - Python: `pytest --doctest-modules` (or run doctest on a single module)
   - TypeScript/JavaScript: `tsc --noEmit`
   - OpenAPI: lint the spec with `npx @redocly/cli lint`
6. **Report** — Produce a coverage summary, flagging files under 70% function coverage and any API endpoint short of 100%.

## Output Template

| Task | Output |
|------|--------|
| Code documentation | Documented files + coverage report |
| API docs | OpenAPI spec + portal configuration |
| Doc site | Site config + content structure + build instructions |
| Guides/Tutorials | Structured markdown with examples |

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Detects existing docstring conventions | Confirm the format preference |
| Generates docstrings/JSDoc from function signatures | Review for accuracy against real behavior |
| Drafts OpenAPI spec from route handlers | Validate request/response examples against live API |
| Configures doc site structure | Provide content for tutorials and guides |
| Runs validation commands and reports coverage | Address files below the 70% coverage gate |

## Quick-Reference Examples

### Python (Google style)
```python
def find_order(order_id: int, include_cancelled: bool = False) -> Order:
    """Look up one order by its id.

    Args:
        order_id: Primary key of the order.
        include_cancelled: Also match orders that were cancelled.

    Returns:
        The matching order.

    Raises:
        OrderNotFoundError: If no order has this id.
    """
```

### KDoc (Kotlin)
```kotlin
/**
 * Lists a customer's orders, newest first.
 *
 * @param customerId owner of the orders
 * @param page zero-based page index
 * @return the requested page; empty when the customer has no orders
 * @throws CustomerNotFoundException if [customerId] is unknown
 */
fun listOrders(customerId: Long, page: Int = 0): Page<Order>
```

### TSDoc/JSDoc (TypeScript)
```typescript
/**
 * Lists the orders of a customer, newest first.
 *
 * @param customerId - Owner of the orders.
 * @param page - Zero-based page index.
 * @returns A page of orders; empty when there are none.
 * @throws CustomerNotFoundError When the customer does not exist.
 */
async function listOrders(customerId: string, page = 0): Promise<OrderPage> { /* ... */ }
```

## Reference Guide

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Docstrings / KDoc / JSDoc | `references/docstring-conventions.md` | Choosing or applying a doc-comment style |
| Framework API docs | `references/framework-api-docs.md` | springdoc, FastAPI, DRF, NestJS, Express |
| OpenAPI and portals | `references/openapi-and-portals.md` | Components, security schemes, Swagger UI/Redoc, non-REST protocols |
| Coverage | `references/coverage-reports.md` | Measuring coverage and writing the report |
| Doc sites | `references/doc-site-generators.md` | Docusaurus, MkDocs, VitePress, versioning, CI checks |
| Tutorials and guides | `references/tutorial-structure.md` | Tutorials, how-tos, troubleshooting, FAQs |

## Constraints

**MUST DO:**
- Settle the comment format first, by asking or by reading existing code
- Cover every public function and class
- State parameter types, meanings, and the exceptions raised
- Execute or compile every example that appears in the docs
- Finish with a coverage report

**MUST NOT DO:**
- Guess the docstring format
- Publish examples that are wrong or were never run
- Leave out error and exception behaviour
- Write long prose for trivial getters and setters

## Related Skills

- `write:plans` (ADR format) — for documenting architectural decisions
- `documentation-strategy` — for planning a documentation system
- `code-documenter` + `frontend-developer` — generate JSDoc alongside React component builds
