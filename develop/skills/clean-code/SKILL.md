---
name: clean-code
description: >-
  Use when a diff, branch or PR needs review or a gate verdict, code needs refactoring, or a
  requirement needs implementing cleanly. Triggers: "코드 리뷰", "이 브랜치 리뷰해줘", "PR 리뷰",
  "리팩토링", "어떻게 구현해?", "review this branch", "code review".
license: MIT
metadata:
  version: "2.1.0"
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

## Standing Mandates

- NEVER judge a diff by taste or by the diff alone. The bar is the acceptance list — the caller's, else the spec the
  change claims (G1). Probe: a commit closing an issue that put retries out of scope added retries; 0/2 reviews that
  read only the diff flagged it, 2/2 after reading the issue first.
- In an implement stage, code and tests in the tree are the output; returning the steps instead is a failed stage.

Goal: every finding carries `file:line`, severity and a fix; the verdict line recounts to the blocking rows; implement
leaves a test file written before the code and its output.

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

**Not for** layer or dependency-rule decisions (`develop:clean-architecture`); domain modelling
(`develop:domain-driven-design`); security review (`develop:security-auditor`); performance work
(`develop:performance-profiling-optimization` — profile first); matching the user's own style (`develop:like-my-code`).

## The Six Dimensions

Names · Functions · Comments & formatting · Error handling · Unit tests · Smells. Patterns,
examples and the quick diagnostic: [references/review-framework.md](references/review-framework.md).
Severity rubric and worked examples of both modes: [references/modes.md](references/modes.md).

## Process

### Gate / review mode

1. **G1 Fix the bar.** List the acceptance items you judge against (from the caller, the
   PR, or the request). None supplied → blocking is reserved for correctness defects; say so.
   Interactive with no caller acceptance: look up the spec the change claims — issue refs in
   commit messages (Closes/Fixes #N, ticket keys), a spec/plan path the user names, a docs/
   file matching the issue number or branch name. Read it; its items become the acceptance
   list and its out-of-scope lines count too. None found or the ref dangles → say so in the
   output and continue as above; never ask. Caller-supplied acceptance or headless: skip the
   lookup, read nothing beyond the diff.
2. **G2 Read the diff, dimension by dimension.** For each of the six dimensions, check the
   changed lines and the code they call. Read every comment the change added: one that
   states behaviour the code does not have is a finding. Run any check you can run (tests,
   linters) and keep what it printed.
3. **G3 Record findings.** One row per defect: `file:line`, dimension, severity
   (blocking / major / minor — rubric in references/modes.md), verdict `fail`, the
   acceptance item it threatens (required when blocking), and the concrete fix. A dimension
   checked clean gets one `pass` row with its line range. Unclear intent → a finding
   `assumption: … — what would settle it`, blocking if an acceptance item turns on it.
   Scope finding: a changed behaviour no spec item asks for, or one the spec puts out of
   scope — quote the spec line; blocking if the spec explicitly excludes it, major otherwise.
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

In an implement **stage**: edit the files, then return the caller's shape (`changed_files` =
files you actually changed, `checks` = test output).

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

[review-framework.md](references/review-framework.md) (dimensions, diagnostic, optional score) ·
[modes.md](references/modes.md) (severity rubric, worked examples) · per dimension: naming-conventions,
functions-and-methods, comments-formatting, error-handling, testing-principles, code-smells (all in `references/`).

## Related Skills

- `develop:test-master` — case lists with expected results (reference mode) for step I2
- `develop:test-driven-development` — the RED proof for step I2
- `develop:clean-architecture` — architectural layer structure and dependency rule
- `develop:domain-driven-design` — domain modeling and ubiquitous language
