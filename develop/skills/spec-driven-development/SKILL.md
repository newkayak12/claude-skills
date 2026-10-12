---
name: spec-driven-development
description: >-
  Use when a feature should be specified before it is coded — stories, acceptance criteria, tasks, a
  per-criterion check. Triggers: "스펙 먼저", "명세부터 쓰고 구현", "수용 기준 먼저", "spec first",
  "spec-driven development".
license: MIT
metadata:
  version: "1.1.0"
scenarios:
  - "write the spec and acceptance criteria first, then implement"
  - "let's do spec-driven development on this feature"
  - "check that every acceptance criterion is actually met"
  - "스펙부터 쓰고 구현하자"
  - "수용 기준 먼저 정하고 코드 짜줘"
  - "명세 항목별로 구현이 맞는지 검증해줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 수용 기준의 누락과 모호함을 더 잘 잡습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER start coding because the request "looks clear". Code written without a spec leaves nothing to count
  against: unrequested changes and missing behaviour both pass unnoticed (teams bench: with no spec, `scope_match`
  could not even be measured). Write the spec first, get it approved, then code.
- A fact the request does not give is marked `[확인 필요: <fact>]`, never guessed; a guessed rule ships as code.
- Code that needs behaviour the spec lacks stops until the spec is amended and re-approved. Never amend the spec
  to match code already written.

Goal: every AC-n traces to a US-n, a task and a piece of evidence, and every change outside the spec is listed.

# Spec-Driven Development

One flow from request to proof: spec, design, tasks, code, then a check of each criterion against evidence.

**Not for** an implementation plan or ticket breakdown alone (`write:plans`); the test-first loop itself
(`develop:test-driven-development`); choosing topology or datastore (`develop:architecture-designer`); running the
work through the multi-agent graph (`teams:develop`). A one-line fix → say so and skip.

## Process

1. **Specify.** Read the code and docs first; ask one line at most. Write `spec.md`: problem, `US-n` stories,
   `AC-n` criteria in Given/When/Then (each cites its `US-n`), out of scope, `[확인 필요]` items. Before the gate,
   sweep for criteria the request implies but never states — inputs that must count as the same (case, whitespace,
   encoding), resource bounds (growth, retention), behaviour while a state holds — each becomes an AC or a
   `[확인 필요]` (bench: a spec without the sweep let `Bob`/`bob` each get their own lockout counter). **Gate:** show
   the spec and wait for approval. No design or code before it.
2. **Design.** `design.md`: interface contracts, data model, decisions in one line each. Every item names the
   `AC-n` it serves; an item serving none is cut.
3. **Tasks.** `tasks.md`: one task per AC (or a tight group), each with its failing test first and its IDs. Order by
   dependency.
4. **Implement.** Take tasks in order. A needed change the spec lacks goes spec first (amend, re-approve), then code.
   Anything already changed outside the spec is logged, not hidden.
5. **Verify.** For each `AC-n`, run the check and record the test name or output. An AC with no evidence is
   unfinished. List every out-of-spec change. Then write the tally.

Templates: `references/templates.md`. Store under `specs/<feature>/`, or where the project already keeps specs.

## Output Template

Per step, the file named above. The closing report is only what follows — design.md and tasks.md stay files,
never pasted:

| AC | Story | Task | Evidence (test name / output) | Status |
|---|---|---|---|---|
| AC-1 | US-1 | T1 | `rejects expired token` — pass | met |
| AC-2 | US-1 | T2 | — | unmet |

Out-of-spec changes: file — what changed — why — spec amended? (or "none"). Open: each `[확인 필요: …]` with who
can answer.

Tally: `<n>` stories · `<m>` AC, `<k>` met with evidence · `<j>` out-of-spec changes · `<o>` open facts.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Drafts spec, design and tasks from code and your words | Approve or amend the spec before anything is built |
| Marks missing facts, never fills them | Answer each `[확인 필요]` |
| Amends the spec before any out-of-spec code | Approve amendments |
| Runs each AC check and reports evidence | Decide whether an unmet AC blocks release |

## Related Skills

- `develop:test-driven-development` — the red-green loop each task runs
- `write:spec` — turn an already-settled conversation into a spec with no interview
- `write:plans` — plan or ticket breakdown when only that is needed
- `teams:develop` — run the approved spec through the multi-agent graph
