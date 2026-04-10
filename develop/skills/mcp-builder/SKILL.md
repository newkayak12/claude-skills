---
name: mcp-builder
description: >-
  Use when someone wants to expose an external service or API as a tool an LLM
  can call — building an MCP server from scratch, designing tool schemas,
  handling auth, or structuring resources and prompts. Triggers on: "build an
  MCP server", "MCP tool",
scenarios:
  - "I want to expose our internal API as an MCP server for Claude to use"
  - "Build an MCP tool that lets Claude query our database directly"
  - "Help me create an MCP server with tools for our development workflow"
  - "사내 API를 Claude가 쓸 수 있는 MCP 서버로 만들어줘"
  - "MCP 서버를 만들어서 Claude가 DB를 직접 조회하게 하고 싶어"
compatibility:
  recommended: []
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 tool granularity 설계와 API coverage vs. workflow tool 트레이드오프를
    더 체계적으로 평가합니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
license: Complete terms in LICENSE.txt
---

# MCP Server Development Guide

## When to Use / When Not to Use

**Use when:**
- Building an MCP server to expose an external service or API to LLMs
- Designing tool schemas with Zod (TypeScript) or Pydantic (Python)
- Handling auth, pagination, and structured tool responses
- Creating evaluation pairs for MCP server quality testing

**Do not use when:**
- Building a CLI tool without MCP protocol (use `cli-developer`)
- Building a general REST API wrapper (use `spring-boot-engineer` or similar)

## Process

### Phase 1: Research and Planning

1. **Understand MCP design principles** — Balance API coverage vs. workflow tools; use consistent action-oriented naming (`github_create_issue`, not `create`)
2. **Study MCP protocol** — Review `https://modelcontextprotocol.io/sitemap.xml` for transport mechanisms, tool/resource/prompt definitions
3. **Load framework docs** — TypeScript SDK (`typescript-sdk/main/README.md`) or Python SDK (`python-sdk/main/README.md`)
4. **Plan tool inventory** — Prioritize comprehensive API coverage; list endpoints starting with the most common operations

### Phase 2: Implementation

1. **Set up project structure** — See `reference/node_mcp_server.md` (TypeScript) or `reference/python_mcp_server.md` (Python)
2. **Build core infrastructure** — API client with auth, error handling helpers, response formatting, pagination support
3. **Implement tools** — For each tool: input schema (Zod/Pydantic), output schema with `structuredContent`, annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), actionable error messages
4. **Transport** — Streamable HTTP (stateless JSON) for remote servers; stdio for local servers

### Phase 3: Review and Test

Gate checklist before proceeding to Phase 4:
- [ ] Build compiles (`npm run build` or `python -m py_compile`)
- [ ] All tools use `registerTool` (TS) or `@mcp.tool` decorator (Python) — no deprecated patterns
- [ ] Every tool has all four annotations
- [ ] Schemas use `.strict()` (TS) or `extra='forbid'` (Python)
- [ ] List tools return pagination metadata (`has_more`, `next_offset`)
- [ ] All error messages include actionable next steps
- [ ] No `any` types in TypeScript
- [ ] Response sizes are bounded (character-limit truncation for large payloads)

### Phase 4: Create Evaluations

Delegate to `agents/evaluation-creator.md` with the tool list and service description. The agent generates 10 verified QA pairs and produces a valid `evaluation.xml`.

## Output Template

For each MCP server, provide:
1. Project structure and `package.json` / `pyproject.toml`
2. API client with auth handling
3. Tool implementations with schemas and annotations
4. Test commands (MCP Inspector)
5. Evaluation QA pairs

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Designs tool naming and schema structure | Provide API documentation and auth credentials |
| Generates Zod/Pydantic schemas with annotations | Run the build and test with MCP Inspector |
| Implements pagination and error handling patterns | Validate tool behavior against your real API |
| Reviews for DRY violations and type coverage | Deploy and register with MCP clients |
| Delegates evaluation creation to evaluation-creator agent | Review and approve the evaluation QA pairs |

## Recommended Stack

- **Language**: TypeScript (broad usage, static typing, good LLM code generation)
- **Transport**: Streamable HTTP for remote; stdio for local
- **Schemas**: Zod (TypeScript), Pydantic (Python)

## Reference Files

| Reference | Purpose |
|-----------|---------|
| `reference/mcp_best_practices.md` | Core MCP design guidelines |
| `reference/node_mcp_server.md` | TypeScript patterns and project setup |
| `reference/python_mcp_server.md` | Python/FastMCP patterns |
| `reference/evaluation.md` | Evaluation format and scoring |

## Related Skills

- `cli-developer` — for CLI wrappers around MCP tools
- `code-documenter` — for documenting tool schemas and API reference
- `claude-api` — for integrating MCP servers with Claude API
