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

# Test Master

Testing specialist covering functional, performance, and security checks, from case specs through execution and reporting.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Need to create tests from scratch | Already doing TDD (use test-driven-development) |
| Auditing test coverage | Debugging a specific flaky test (use flaky-test-analyzer) |
| Writing a formal test plan | Just need a code review |
| Adding tests to untested legacy code | |
| A test-case writing step needs case specs (Reference mode) | |

## Modes

| | Full (interactive) | Reference (headless) |
|---|---|---|
| When | A person asks for tests, a plan, or an audit | A test-case writing step consults this skill — e.g. teams qa `cases`, clean-code implement mode's tests-first step — or the caller says "cases only" / no one is there to answer |
| Steps | 1 → 5 below | 1, 2, then 3R; stop |
| Writes | test code, results, report | one case-spec file at the caller's path ([case-spec.md](references/case-spec.md)) |
| Runs tests / coverage | yes | no — nothing is executed, no results or percentages claimed |
| Asks the user | to confirm scope and edge cases | never — open points go under Assumptions |

Unsure? Invoked by a pipeline or another skill's step, or nobody can answer → Reference mode. If the caller defines its own return shape, write the case file at its path and return that shape.

## Process

If sequential-thinking is available, invoke it for steps 1–2 before writing any test code: explicitly complete "Define scope" and "Create strategy" as separate sequential steps, passing each step's output as input to the next. This prevents generating test files before the testing type, framework, and coverage targets are confirmed.

1. **Define scope** — Decide what is under test and which testing types apply (Reference mode: work from the stated acceptance/spec, not the implementation; read code solely for endpoint and field names)
2. **Create strategy** — Decide how each testing type applies: functional, performance, security

3R. **Reference mode: write case specs, then stop** — per [case-spec.md](references/case-spec.md): each case has id, behavior, level, precondition/input, expected result, and the acceptance it covers; happy plus error/edge/boundary per behavior; a coverage map from every acceptance to its cases; unresolved points as Assumptions. Do not write test code, run tests, or ask.

3. **Write tests** (Full from here) — Author the tests using exact assertions (example further down)
4. **Execute** — Run the tests and gather the outcomes
   - On failure: sort it as a real assertion miss or an environment/flakiness issue, fix the underlying cause, run again
   - Flaky results: with think-tool available, use it to trace the failure chain before settling on a diagnosis; look for order coupling and async timing, then stabilize or retry narrowly
5. **Report** — Write up findings with a severity each and concrete fixes
   - Check the coverage targets before closing and name any gap

## Quick-Start Example

A small Kotlin/JUnit 5 test showing the patterns this skill expects:

```kotlin
class DiscountTest {
    @Test
    fun `premium customers get ten percent off`() {
        val total = discount(price = 100, tier = Tier.PREMIUM)
        assertEquals(90, total)          // exact value, not just non-null
    }

    @Test
    fun `negative price is rejected`() {
        val ex = assertThrows<IllegalArgumentException> { discount(-1, Tier.STANDARD) }
        assertEquals("price must be non-negative", ex.message)
    }
}
```

The same shape carries over to any other framework.

## Reference Guide

Read the file that matches the task:

| Subject | File | Open When |
|-------|-----------|-----------|
| Unit tests | `references/unit-testing.md` | JUnit/MockK idioms, test doubles, parametrized boundary cases |
| Integration | `references/integration-testing.md` | Spring test slices, Testcontainers, persistence behaviour |
| E2E | `references/e2e-testing.md` | Picking user journeys; keeping browser tests stable |
| Load and speed | `references/performance-testing.md` | k6; shaping load, stress, spike and soak runs |
| Security | `references/security-testing.md` | Authentication, authorization and input-validation checklist |
| Reporting | `references/test-reports.md` | Report layout, writing a finding, severity scale |
| QA Practice | `references/qa-methodology.md` | Plans, design techniques, defects, shift-left, quality gates |
| Automation | `references/automation.md` | Structure, reliability, scaling, CI layout, team practice |
| Test-First | `references/tdd-cycle.md` | Red-green-refactor discipline, bug-fix flow |
| Test Smells | `references/test-smells.md` | Test review, mock misuse, brittle or hollow tests |
| Case Spec | `references/case-spec.md` | Reference mode: case-file shape, derivation rules |

## Constraints

**MUST DO**
- Cover happy paths and also error/edge cases such as empty input, null, and boundary values
- Replace external dependencies with doubles; unit tests never hit real APIs or databases
- Title every test with a plain sentence describing the behaviour verified
- Assert exact outcomes (`assertEquals(90, total)`), not mere truthiness
- Run the suite in CI/CD; record coverage gaps and close them (Full mode — Reference mode documents uncovered acceptance under "Not covered" instead)
- Give every case a specific expected result and the acceptance it covers (both modes)

**MUST NOT**
- Omit failure paths, e.g. exercising only the success side of a try/catch
- Feed production data into tests; build fixtures or factories instead
- Write tests that depend on run order; each must run on its own
- Ignore flakiness; isolate the test and repair it instead of rerunning until it passes
- Couple tests to internals such as which private calls happen; verify what an observer can see

## Output Template

**Full mode** — for a test plan, deliver:
1. Scope and approach
2. Test cases, each with its expected outcome
3. Analysis of coverage
4. Findings, each rated Critical/High/Medium/Low
5. Specific fixes to apply

**Reference mode** — one file at the caller's path, shape in [case-spec.md](references/case-spec.md): `Status: specified, not run`; case table `id | behavior | kind | level | precondition / input | expected result | acceptance covered`; Coverage (acceptance → case ids); Assumptions; Not covered. Checkable: every row has a concrete expected result, every acceptance has ≥1 case or a Not-covered reason, no run results.

## What Claude Does / What You Do

Full (interactive) rows; Reference mode is the last row.

| Claude | You |
|--------|-----|
| Generates test scaffolding and assertions | Confirm test scope and edge cases |
| Identifies coverage gaps from existing code | Run tests and share failure output |
| Writes test plan structure | Validate that tests match business intent |
| Suggests mocking strategies | Integrate tests into CI/CD pipeline |
| Reference (headless): writes the case-spec file from the acceptance, records assumptions instead of asking | Nothing during the step — the next step (run / implement) executes the cases and overturns a wrong assumption |

## Related Skills

- `develop:test-driven-development` — TDD workflow (red-green-refactor cycle); turns Reference-mode cases into failing tests
- `develop:scenario-director` — multi-step HTTP scenario specs + catalog (its own reference mode)
- `develop:flaky-test-analyzer` — diagnose intermittent test failures
- `develop:clean-code` — test code quality and readability
