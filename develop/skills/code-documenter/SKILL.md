---
name: code-documenter
description: >-
  Use when code, an API, or a project lacks documentation and needs it created
  or improved — adding docstrings or JSDoc to functions and classes, generating
  OpenAPI/ Swagger specs from an existing API, building a documentation site, or
  writing...
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
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: quality
  triggers: documentation, docstrings, OpenAPI, Swagger, JSDoc, comments, API docs, tutorials, user guides, doc site, README, changelog
  role: specialist
  scope: implementation
  output-format: code
  related-skills: spec-miner, fullstack-guardian, code-reviewer
---

# Code Documenter

## When to Use / When Not to Use

**Use when:**
- Functions and classes lack docstrings, JSDoc, or KDoc
- An existing API needs an OpenAPI/Swagger spec
- The project needs a documentation site (Docusaurus, MkDocs, VitePress)
- Writing tutorials, user guides, or troubleshooting docs

**Do not use when:**
- You need architectural decision documentation (use `adr-writer`)
- You need a documentation strategy plan (use `documentation-strategy`)

## Process

1. **Discover** — Ask for format preference and exclusions. If unspecified, inspect the codebase for existing conventions first; default to Google style (Python) or JSDoc (TypeScript/JS) if none found.
2. **Detect** — Identify language and framework
3. **Analyze** — Find undocumented public functions, classes, and API endpoints
4. **Document** — Apply consistent format across all targets
5. **Validate** — Test all code examples compile/run:
   - Python: `python -m doctest file.py` or `pytest --doctest-modules`
   - TypeScript/JavaScript: `tsc --noEmit`
   - OpenAPI: `npx @redocly/cli lint openapi.yaml`
6. **Report** — Generate coverage summary. Flag any file below 70% function coverage or any API endpoint below 100% coverage.

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

### Google-style Docstring (Python)
```python
def fetch_user(user_id: int, active_only: bool = True) -> dict:
    """Fetch a single user record by ID.

    Args:
        user_id: Unique identifier for the user.
        active_only: When True, raise an error for inactive users.

    Returns:
        A dict containing user fields (id, name, email, created_at).

    Raises:
        ValueError: If user_id is not a positive integer.
        UserNotFoundError: If no matching user exists.
    """
```

### JSDoc (TypeScript)
```typescript
/**
 * Fetches a paginated list of products from the catalog.
 *
 * @param {string} categoryId - The category to filter by.
 * @param {number} [page=1] - Page number (1-indexed).
 * @returns {Promise<ProductPage>} Resolves to a page of product records.
 * @throws {NotFoundError} If the category does not exist.
 */
async function fetchProducts(categoryId: string, page = 1): Promise<ProductPage> { ... }
```

## Reference Guide

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Python Docstrings | `references/python-docstrings.md` | Google, NumPy, Sphinx styles |
| TypeScript JSDoc | `references/typescript-jsdoc.md` | JSDoc patterns, TypeScript |
| FastAPI/Django API | `references/api-docs-fastapi-django.md` | Python API documentation |
| NestJS/Express API | `references/api-docs-nestjs-express.md` | Node.js API documentation |
| Coverage Reports | `references/coverage-reports.md` | Generating documentation reports |
| Doc Site Generators | `references/doc-site-generators.md` | Docusaurus, MkDocs, VitePress config |
| OpenAPI Advanced | `references/openapi-advanced.md` | Reusable components, security schemes |
| Tutorial Structure | `references/tutorial-structure.md` | Progressive learning paths |

## Constraints

**MUST DO:**
- Ask for format preference before starting (or detect from existing code)
- Document all public functions and classes
- Include parameter types, descriptions, and exception docs
- Test all code examples in documentation
- Generate a coverage report

**MUST NOT DO:**
- Assume docstring format without asking or detecting
- Write inaccurate or untested documentation examples
- Skip exception/error documentation
- Document obvious getters/setters verbosely

## Related Skills

- `adr-writer` — for documenting architectural decisions
- `documentation-strategy` — for planning a documentation system
- `code-documenter` + `frontend-developer` — generate JSDoc alongside React component builds
