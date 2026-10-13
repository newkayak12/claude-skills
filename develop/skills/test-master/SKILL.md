---
name: test-master
description: >-
  Use when writing, improving, or auditing tests, or writing case specs with expected results from a spec. Triggers: "테스트 작성", "테스트 케이스 작성", "test case writing", "단위 테스트", "커버리지 분석", "test plan", "defect report".
license: MIT
metadata:
  version: "1.2.0"
  domain: quality
  role: specialist
  scope: testing
  output-format: report
  related-skills: test-driven-development, flaky-test-analyzer
scenarios:
  - "write unit tests for this service"
  - "analyze test coverage"
  - "write the test cases for this spec to qa/cases.md (cases only)"
  - "이 코드에 테스트 추가해줘"
  - "테스트 커버리지 분석해줘"
  - "이 기능 명세로 테스트 케이스만 뽑아서 파일로 써줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 플레이키 실패 원인 추론과 커버리지 갭 분석이 더 정확해집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER write a test whose expected value you took from the code under test. Derive it from the spec or acceptance; read code only for names. (Scar: expectations copied from the implementation pass by construction and pin its bugs.)
- NEVER assert truthiness or non-null where an exact value exists, and never cover only the success side — each behavior gets a happy and an error/edge/boundary case.
- NEVER report a percentage, a pass, or a result you did not run (Reference mode runs nothing). A missing fact is `[확인 필요]` under Assumptions, not a guess.
- NEVER rerun a failing test until it passes; sort it as assertion miss or flakiness and hand flakiness to `flaky-test-analyzer`.
- Goal: every acceptance item maps to at least one case with a concrete expected result, or to a Not-covered reason — Reference mode stops at the case file, Full mode stops when the targets are met or the gap is named.

# Test Master

Tests and case specs from a spec: write, improve, audit, report.

**Not for** red-green-refactor discipline (`test-driven-development`), one intermittent failure (`flaky-test-analyzer`), multi-step HTTP flows against a live server (`scenario-director`), or a code review.

## Modes

| | Full (interactive) | Reference (headless) |
|---|---|---|
| When | A person asks for tests, a plan, or an audit | A pipeline step consults this skill (teams qa `cases`, clean-code implement's tests-first step), or "cases only" / nobody can answer |
| Steps | 1 → 5 | 1, 2, then 3R; stop |
| Writes | test code, results, report | one case-spec file at the caller's path ([case-spec.md](references/case-spec.md)) |
| Runs tests / coverage | yes | no |
| Asks the user | scope and edge cases | never — open points go under Assumptions |

Unsure → Reference mode. If the caller defines its own return shape, write the case file at its path and return that shape.

## Process

With sequential-thinking, complete steps 1 and 2 as separate steps before any test code.

1. **Define scope** — what is under test, which testing types apply (Reference: work from the acceptance, not the implementation).
2. **Create strategy** — how functional, performance, security apply.

3R. **Reference: write case specs, then stop** — per [case-spec.md](references/case-spec.md): id, behavior, level, precondition/input, expected result, acceptance covered; a coverage map from every acceptance to its cases; unresolved points as Assumptions. No test code, no runs, no questions.

3. **Write tests** (Full) — exact assertions, doubles for external dependencies, one plain-sentence title per behavior, no run-order coupling, no production data.
4. **Execute** — run; on failure sort real miss vs environment/flakiness and fix the cause. With think-tool, trace the failure chain before diagnosing.
5. **Report** — findings with severity and a concrete fix each; check coverage targets and name any gap.

## Reference Guide

| Subject | File | Open When |
|---|---|---|
| Unit | `references/unit-testing.md` | JUnit/MockK idioms, doubles, parametrized boundaries |
| Integration | `references/integration-testing.md` | Spring slices, Testcontainers |
| E2E | `references/e2e-testing.md` | Picking journeys; stable browser tests |
| Load | `references/performance-testing.md` | k6 load, stress, spike, soak |
| Security | `references/security-testing.md` | Auth and input-validation checklist |
| Reporting | `references/test-reports.md` | Report layout, finding, severity |
| QA practice | `references/qa-methodology.md` | Plans, design techniques, defects, gates |
| Automation | `references/automation.md` | Structure, CI layout |
| Test-first | `references/tdd-cycle.md` | Red-green-refactor, bug-fix flow |
| Smells | `references/test-smells.md` | Mock misuse, brittle or hollow tests |
| Case spec | `references/case-spec.md` | Reference mode file shape |

## Output Template

**Full mode:**

```
## Test report — <scope>
Verdict: <targets met | N gaps>  ·  Cases: 14 (9 happy, 5 error/edge)  ·  Run: 14 passed, 0 failed
Coverage: line 84% / branch 71% (target 80/70) · uncovered: <file:range>
Findings: 1 Critical, 0 High, 2 Medium, 1 Low
| # | Severity | Finding | Fix |
```

**Reference mode** — one file at the caller's path: `Status: specified, not run`; case table `id | behavior | kind | level | precondition / input | expected result | acceptance covered`; Coverage (acceptance → case ids); Assumptions; Not covered. Closing line: `Cases: N · acceptance covered: X/Y · Not covered: Z · Assumptions: W`. Every row has a concrete expected result; no run results.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Writes scaffolding, assertions, plan structure; finds coverage gaps | Confirm scope and edge cases; validate the tests match business intent |
| Suggests mocking strategies | Run the tests, share failure output, wire CI |
| Reference: writes the case file from the acceptance, records assumptions instead of asking | Nothing during the step — the next step executes the cases and overturns a wrong assumption |

## Related Skills

- `develop:test-driven-development` — red-green-refactor; turns Reference-mode cases into failing tests
- `develop:scenario-director` — multi-step HTTP scenario specs + catalog
- `develop:flaky-test-analyzer` — intermittent failures
- `develop:clean-code` — test code quality and readability
