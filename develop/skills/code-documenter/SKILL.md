---
name: code-documenter
description: 'Use when code, an API, or a project lacks documentation and needs it created or improved — adding docstrings or JSDoc to functions and classes, generating OpenAPI/Swagger specs from an existing API, building a documentation site, or writing tutorials and user guides. Applies regardless of language or framework; covers both inline code comments and full developer-facing documentation portals.'
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: quality
  triggers: documentation, docstrings, OpenAPI, Swagger, JSDoc, comments, API docs, tutorials, user guides, doc site, README, changelog, CHANGELOG, ADR, architecture decision record
  role: specialist
  scope: implementation
  output-format: code
  related-skills: spec-miner, fullstack-guardian, code-reviewer
---

# Code Documenter

Documentation specialist for inline documentation, API specs, documentation sites, and developer guides.

## When to Use This Skill

Applies to any task involving code documentation, API specs, or developer-facing guides. See the reference table below for specific sub-topics.

## Core Workflow

1. **Discover** - Ask for format preference and exclusions. _Fallback: if the user does not specify a format preference, inspect the existing codebase for docstring or JSDoc style patterns first. If an existing convention is found, match it. If none is found, default to Google style for Python and JSDoc for TypeScript/JavaScript. State the chosen default explicitly before proceeding._
2. **Detect** - Identify language and framework
3. **Analyze** - Find undocumented code
4. **Document** - Apply consistent format
5. **Validate** - Test all code examples compile/run:
   - Python: `python -m doctest file.py` for doctest blocks; `pytest --doctest-modules` for module-wide checks
   - TypeScript/JavaScript: `tsc --noEmit` to confirm typed examples compile
   - OpenAPI: validate spec with `npx @redocly/cli lint openapi.yaml`
   - If validation fails: fix examples and re-validate before proceeding to the Report step
6. **Report** - Generate coverage summary. _Coverage gate: flag any file below 70% function coverage or any API endpoint below 100% coverage as requiring follow-up documentation work — do not silently complete on low-coverage codebases._

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

### NumPy-style Docstring (Python)
```python
def compute_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors.

    Parameters
    ----------
    vec_a : np.ndarray
        First input vector, shape (n,).
    vec_b : np.ndarray
        Second input vector, shape (n,).

    Returns
    -------
    float
        Cosine similarity in the range [-1, 1].

    Raises
    ------
    ValueError
        If vectors have different lengths.
    """
```

### JSDoc (TypeScript)
```typescript
/**
 * Fetches a paginated list of products from the catalog.
 *
 * @param {string} categoryId - The category to filter by.
 * @param {number} [page=1] - Page number (1-indexed).
 * @param {number} [limit=20] - Maximum items per page.
 * @returns {Promise<ProductPage>} Resolves to a page of product records.
 * @throws {NotFoundError} If the category does not exist.
 *
 * @example
 * const page = await fetchProducts('electronics', 2, 10);
 * console.log(page.items);
 */
async function fetchProducts(
  categoryId: string,
  page = 1,
  limit = 20
): Promise<ProductPage> { ... }
```

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Python Docstrings | `references/python-docstrings.md` | Google, NumPy, Sphinx styles |
| TypeScript JSDoc | `references/typescript-jsdoc.md` | JSDoc patterns, TypeScript |
| FastAPI/Django API | `references/api-docs-fastapi-django.md` | Python API documentation |
| NestJS/Express API | `references/api-docs-nestjs-express.md` | Node.js API documentation |
| Coverage Reports | `references/coverage-reports.md` | Generating documentation reports |
| Doc Site Generators | `references/doc-site-generators.md` | Docusaurus, MkDocs, VitePress config |
| Doc Site Infrastructure | `references/doc-site-infrastructure.md` | Search, versioning, testing, performance, analytics |
| OpenAPI Advanced | `references/openapi-advanced.md` | OpenAPI 3.1 reusable components, security schemes |
| API Portals | `references/api-portals.md` | Swagger UI customization, Redoc, Stoplight |
| Multi-Protocol Docs | `references/multi-protocol-docs.md` | GraphQL, AsyncAPI/WebSocket, gRPC, SDK multi-language examples |
| Tutorial Structure | `references/tutorial-structure.md` | Progressive learning paths, step-by-step format, checkpoints |
| Information Architecture | `references/information-architecture.md` | Content hierarchy, navigation, progressive disclosure |
| Troubleshooting & FAQs | `references/troubleshooting-faqs.md` | Problem-solution format, FAQ structure |

## Constraints

### MUST DO
- Ask for format preference before starting
- Detect framework for correct API doc strategy
- Document all public functions/classes
- Include parameter types and descriptions
- Document exceptions/errors
- Test code examples in documentation
- Generate coverage report

### MUST NOT DO
- Assume docstring format without asking
- Apply wrong API doc strategy for framework
- Write inaccurate or untested documentation
- Skip error documentation
- Document obvious getters/setters verbosely
- Create documentation that's hard to maintain

## Output Formats

Depending on the task, provide:
1. **Code Documentation:** Documented files + coverage report
2. **API Docs:** OpenAPI specs + portal configuration
3. **Doc Sites:** Site configuration + content structure + build instructions
4. **Guides/Tutorials:** Structured markdown with examples + diagrams

## Knowledge Reference

Google/NumPy/Sphinx docstrings, JSDoc, OpenAPI 3.0/3.1, AsyncAPI, gRPC/protobuf, FastAPI, Django, NestJS, Express, GraphQL, Docusaurus, MkDocs, VitePress, Swagger UI, Redoc, Stoplight
