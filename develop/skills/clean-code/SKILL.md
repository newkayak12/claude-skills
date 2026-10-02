---
name: clean-code
description: >-
  Use when a diff needs a quality-gate verdict, code needs review or refactoring, or a
  requirement needs implementing cleanly. Triggers: "코드 리뷰", "품질 게이트", "리팩토링",
  "코드 가독성", "어떻게 구현해?", "clean code", "code review", "implement this cleanly".
license: MIT
metadata:
  author: wondelai
  version: "2.0.0"
scenarios:
  - "quality gate: does this diff meet the acceptance criteria?"
  - "refactor this function — it's too long"
  - "how should I implement this requirement cleanly?"
  - "이 PR 품질 게이트 통과 가능한지 봐줘"
  - "이 코드 리팩토링해줘"
  - "이 요구사항 어떻게 구현하면 깔끔할까?"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 코드 스멜 탐지와 리팩토링 우선순위 판단이 더 정확해집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Clean Code

Code that communicates intent, minimizes surprises, and welcomes change — judged in gate
mode, written in implement mode, against the same six dimensions.

## Mode Map

Pick the mode from the stage you were called in and the output the caller asks for.

| Mode | Chosen when | Interactive | Headless (teams / harness stage) |
|------|-------------|-------------|----------------------------------|
| **Gate / review** | stage is `gate`, `review` or `critique`; asked to judge or review a diff; or the required output asks for a verdict (`accept`, `pass`, `verified`) | Findings table + verdict, before/after snippets for each fix | Judge only; fill the caller's verdict fields per Process G5; edit nothing; ask nothing |
| **Implement** | stage is `implement`; asked how to build a stated requirement; or the required output asks for `changed_files` | Present the ordered steps, then write the code if asked | Follow the steps and edit the files; return what the caller asks (e.g. `changed_files`, `checks`); ask nothing |

- A refactor request is implement mode with "behaviour unchanged" as the requirement: pin
  current behaviour with tests (step I2), then restructure.
- A caller's required output always overrides this skill's Output Template. When nobody
  can answer, an open point becomes a recorded assumption, never a question.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Quality gate or PR review of a diff | Architectural layer decisions (use clean-architecture) |
| Refactoring legacy code | Domain modeling (use domain-driven-design) |
| Implementing a stated requirement others will maintain | Performance optimization (profile first) |
| Naming variables, functions, classes | Infrastructure or deployment config |

## The Six Dimensions

Names · Functions · Comments & formatting · Error handling · Unit tests · Smells. Patterns,
examples and the quick diagnostic: [references/review-framework.md](references/review-framework.md).
Severity rubric and worked examples of both modes: [references/modes.md](references/modes.md).

## Process

### Gate / review mode

1. **G1 Fix the bar.** List the acceptance items you judge against (from the caller, the
   PR, or the request). None supplied → blocking is reserved for correctness defects; say so.
2. **G2 Read the diff, dimension by dimension.** For each of the six dimensions, check the
   changed lines and the code they call. Read every comment the change added: one that
   states behaviour the code does not have is a finding. Run any check you can run (tests,
   linters) and keep what it printed.
3. **G3 Record findings.** One row per defect: `file:line`, dimension, severity
   (blocking / major / minor — rubric in references/modes.md), verdict `fail`, the
   acceptance item it threatens (required when blocking), and the concrete fix. A dimension
   checked clean gets one `pass` row with its line range. Unclear intent → a finding
   `assumption: … — what would settle it`, blocking if an acceptance item turns on it.
4. **G4 Verdict.** FAIL iff any blocking finding; otherwise PASS, majors and minors listed.
   A 0–10 score is never the verdict.
5. **G5 Map onto the caller's contract** when one is given (teams `gate`: `accept`,
   `match_pct`, `checks`, `gaps`, `observations`, `reason`):
   - each blocking finding → one `gaps[]` entry
     `"<id> <file>:<line> — <severity> — threatens <acceptance> — <fix>"`;
   - each major/minor finding → one `observations[]` entry in the same shape;
   - `accept: false` iff any blocking finding;
   - every other required field is still filled as the caller defines it — `match_pct`
     (0–100, share of acceptance met), `checks` (what you ran or read → what it showed),
     `reason`, `evidence`. Dropping the 0–10 score is not a reason to drop or zero them.
6. **G6 Interactive only:** add before/after snippets for each fix; give a 0–10 score only
   if asked (rubric in references/review-framework.md).

### Implement mode

Each step names what it leaves in the tree. Worked example: references/modes.md.

1. **I1 Pin the requirement.** List the behaviours, the acceptance items and the error
   cases. Ambiguity → write the assumption into the handoff. *Leaves:* case list +
   assumptions (handoff / notes).
2. **I2 Cases first.** Derive cases with expected results (`develop:test-master` reference
   mode) and write the test file FIRST, before any implementation file — even when no test
   runner is available here; the test file is still the first artifact. Where a runner
   applies, run them and watch them fail for the predicted reason
   (`develop:test-driven-development`); otherwise leave the RED proof to the test stage.
   *Leaves:* test file path + test names, RED output (or "not run").
3. **I3 Structure.** Decide the file/module and the public surface — only what the
   requirement names is exported; one responsibility per module. *Leaves:* paths + exported
   symbols.
4. **I4 Names.** Domain words from the requirement; predicates for booleans; named
   constants for every literal with meaning. *Leaves:* symbol names.
5. **I5 Function boundaries.** One thing per function, one level of abstraction, under ~20
   lines, ≤3 parameters, no flag arguments, guard clauses for errors. *Leaves:* function list.
6. **I6 Error handling.** Typed errors carrying context; no null returns, no empty catch,
   no silent default; wrap third-party calls. *Leaves:* error type(s) + a test asserting each.
7. **I7 GREEN, then tidy.** Make the tests pass; remove duplication, magic numbers and
   "what" comments. *Leaves:* passing test output.
8. **I8 Self-gate.** Run gate mode G2–G4 over your own diff; fix every blocking and major
   finding. *Leaves:* no blocking findings.

In an implement **stage** these steps are how you do the work: edit the files, then return
the caller's shape (`changed_files` = files you actually changed, `checks` = test output).
Returning the steps instead of the code is a failed stage.

## Output Template

Used when no caller fixes the output shape (inside a contract, Process G5 / the implement
stage note apply instead).

**Gate / review**

| ID | file:line | Dimension | Severity | Verdict | Threatens | Fix |
|----|-----------|-----------|----------|---------|-----------|-----|
| F1 | path:line | errors | blocking | fail | A2 … | … |
| P1 | path:start-end | names | — | pass | — | — |

Verdict: PASS | FAIL — `<n>` blocking (`<ids>`); assumptions: `<list or none>`.

**Implement**

| # | Step | What to do | Leaves in tree (path / symbol / test) | Check |
|---|------|------------|----------------------------------------|-------|
| I1 | Pin requirement | … | … | every acceptance item has a case |

Then: files changed, test command → output.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| **Gate, headless:** judges the diff, records findings with file:line, fills the caller's verdict fields; asks nothing | — |
| **Gate, interactive:** same findings + verdict, before/after snippets, a score only if asked | Share the diff and acceptance; confirm business intent behind code flagged `assumption` |
| **Implement, headless:** follows I1–I8, edits files, returns `changed_files` + checks; asks nothing | — |
| **Implement, interactive:** presents the steps, then writes the code and tests | State the requirement; approve the steps; merge after review |

## Reference Files

- [review-framework.md](references/review-framework.md) — six dimensions, quick diagnostic, optional score
- [modes.md](references/modes.md) — severity rubric, finding/gaps examples, implement walkthrough
- [naming-conventions.md](references/naming-conventions.md)
- [functions-and-methods.md](references/functions-and-methods.md)
- [comments-formatting.md](references/comments-formatting.md)
- [error-handling.md](references/error-handling.md)
- [testing-principles.md](references/testing-principles.md)
- [code-smells.md](references/code-smells.md)

## Related Skills

- `develop:test-master` — case lists with expected results (reference mode) for step I2
- `develop:test-driven-development` — the RED proof for step I2
- `develop:clean-architecture` — architectural layer structure and dependency rule
- `develop:domain-driven-design` — domain modeling and ubiquitous language
