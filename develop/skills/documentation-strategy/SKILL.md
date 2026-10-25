---
name: documentation-strategy
effort: high
description: >-
  Use when a team needs a plan for what docs to write. Triggers on: "문서 뭐부터 써야 해?", "온보딩 문서 정리", "런북/ADR 체계", "doc
  coverage map", "documentation audit", "주석/독스트링 달아줘", "OpenAPI 문서 만들어줘".
scenarios:
  - "Our codebase has no docs and new engineers keep asking the same questions repeatedly"
  - "We have documentation but it's scattered across three wikis and no one knows what's current"
  - "Help me build a documentation strategy for our microservices platform"
  - "신규 엔지니어 온보딩이 너무 오래 걸려, 문서화 전략이 필요해"
  - "문서가 분산되어 있고 오래됐어, 체계를 잡아줘"
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional: []
  remote_mcp_note: >-
    think-tool은 문서 우선순위 결정과 coverage gap 분석에 활용됩니다.
    sequential-thinking은 감사 → 우선순위 → 작성 → 검토 흐름을 단계별로 구조화합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS audit existing docs before recommending new ones — redundant docs are worse than none: two copies drift
  apart and readers cannot tell which is current.
- ALWAYS specify audience and maintenance owner for every doc type recommended. A doc with no owner is stale by the
  next release; an owner not in the repo or wiki is `[확인 필요: owner]`, never a guessed name.
- NEVER treat all doc types the same — ADRs, runbooks, and onboarding guides serve different readers in different
  states (an on-call engineer at 2 a.m. cannot read a narrative).
- NEVER recommend creating documentation without a plan for keeping it current: stale docs mislead with false
  confidence.
- NEVER publish a docstring format guess or an example that was not run.

Goal: every recommended doc has an audience, an owner, an update trigger and a place to live; everything audited is
classified keep, update or delete; the closing tally recounts to both lists.

# Documentation Strategy

**Not for** writing one substantial document end to end (`write:spec`, `write:prd`), recording a single decision
(`write:adr`), or running an incident review (`develop:incident-response-playbook`).

## Process

1. Audit what exists (even informal). Don't duplicate; classify each doc keep / update / delete.
2. Identify the highest-pain gap (most asked question, latest incident gap, newest service with no docs).
3. Pick one doc type and write it to the template (`references/templates.md`); name audience, owner, update trigger
   and location (`references/doc-types.md`).
4. Get one reviewer who matches the target audience — not the author.
5. Merge, announce, and add it to the index/README. Add a Documentation checkbox group to the PR template (no docs
   change / updated doc link / new doc link) so the doc stays current.
6. Recount the audited docs (keep / update / delete) and the recommended docs with audience, owner, trigger and
   location; fix the tally if the lists differ.

**Inline docs and API specs** (docstrings, JSDoc/KDoc, OpenAPI, doc site on existing code):
1. Ask which format to use; else read the repo for the convention; else Google style (Python), JSDoc (TS/JS).
2. List public functions, classes and endpoints without docs; write all in the one chosen format, including
   parameters, returns and raised errors.
3. Run every example: `pytest --doctest-modules`, `tsc --noEmit`, `npx @redocly/cli lint` for OpenAPI.
4. Report coverage; flag files under 70% function coverage and any endpoint short of 100%.

## Output Template

```
## Documentation plan — <scope>

Audit: | doc | location | state | keep / update / delete |
Plan:  | doc type | audience | owner | update trigger | location |
Start with: <one doc> — why it is the highest-pain gap
Open: [확인 필요: ○○] ...

Audited <n> (keep <k> · update <u> · delete <d>) · recommended <r> · missing owner <o>
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Audits existing docs before recommending new ones | Point to where current docs live |
| Names audience and maintenance owner per doc type | Confirm the owners |
| Writes the highest-pain missing doc from the template | Pick the doc type to start with |
| Adds the doc to the index/README | Get a reviewer who matches the target audience |

## Reference Guide

| Need | File | Covers |
|------|------|--------|
| Doc types, audience, placement, debt | `references/doc-types.md` | Taxonomy, audience-first questions, docs as code, write/update/delete rules |
| Templates | `references/templates.md` | Architecture Overview, Runbook, Onboarding Guide |

## Related Skills

- `develop:architecture-designer` — architecture docs and ADRs
- `develop:incident-response-playbook` — RCA content to store and maintain
- `write:spec` — drafting one substantial document
- `write:adr` — a single decision
