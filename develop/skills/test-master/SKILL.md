---
name: test-master
description: >-
  Use when writing, improving, or auditing tests, or writing case specs with expected results from a spec. Triggers: "테스트 작성", "테스트 케이스 작성", "test case writing", "단위 테스트", "커버리지 분석", "test plan", "defect report".
license: MIT
metadata:
  author: https://github.com/Jeffallan
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

Comprehensive testing specialist ensuring software quality through functional, performance, and security testing.

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

1. **Define scope** — Identify what to test and which testing types apply (Reference: from the stated acceptance/spec, not the implementation — code only to name endpoints and fields)
2. **Create strategy** — Plan the test approach across functional, performance, and security perspectives

3R. **Reference mode: write case specs, then stop** — per [case-spec.md](references/case-spec.md): each case has id, behavior, level, precondition/input, expected result, and the acceptance it covers; happy plus error/edge/boundary per behavior; a coverage map from every acceptance to its cases; unresolved points as Assumptions. Do not write test code, run tests, or ask.

3. **Write tests** (Full from here) — Implement tests with proper assertions (see example below)
4. **Execute** — Run tests and collect results
   - If tests fail: classify the failure (assertion error vs. environment/flakiness), fix root cause, re-run
   - If tests are flaky: if think-tool is available, invoke it to reason through the failure chain before committing to a diagnosis; isolate ordering dependencies, check async handling, add retry or stabilization logic
5. **Report** — Document findings with severity ratings and actionable fix recommendations
   - Verify coverage targets are met before closing; flag gaps explicitly

## Quick-Start Example

A minimal Jest unit test illustrating the key patterns this skill enforces:

```js
// Good: meaningful description, specific assertion, isolated dependency
describe('calculateDiscount', () => {
  it('applies 10% discount for premium users', () => {
    const result = calculateDiscount({ price: 100, userTier: 'premium' });
    expect(result).toBe(90); // specific outcome, not just truthy
  });

  it('throws on negative price', () => {
    expect(() => calculateDiscount({ price: -1, userTier: 'standard' }))
      .toThrow('Price must be non-negative');
  });
});
```

Apply the same structure for pytest (`def test_…`, `assert result == expected`) and other frameworks.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Unit Testing | `references/unit-testing.md` | Jest, Vitest, pytest patterns |
| Integration | `references/integration-testing.md` | API testing, Supertest |
| E2E | `references/e2e-testing.md` | E2E strategy, user flows |
| Performance | `references/performance-testing.md` | k6, load testing |
| Security | `references/security-testing.md` | Security test checklist |
| Reports | `references/test-reports.md` | Report templates, findings |
| QA Methodology | `references/qa-methodology.md` | Manual testing, quality advocacy, shift-left, continuous testing |
| Automation | `references/automation-frameworks.md` | Framework patterns, scaling, maintenance strategies |
| Automation Ops | `references/automation-operations.md` | CI/CD setup, team rollout, automation ROI |
| TDD Iron Laws | `references/tdd-iron-laws.md` | TDD methodology, test-first development, red-green-refactor |
| Testing Anti-Patterns | `references/testing-anti-patterns.md` | Test review, mock issues, test quality problems |
| Case Spec | `references/case-spec.md` | Reference mode: case-file shape, derivation rules |

## Constraints

**MUST DO**
- Test happy paths AND error/edge cases (e.g., empty input, null, boundary values)
- Mock external dependencies — never call real APIs or databases in unit tests
- Use meaningful `it('…')` descriptions that read as plain-English specifications
- Assert specific outcomes (`expect(result).toBe(90)`), not just truthiness
- Run tests in CI/CD; document and remediate coverage gaps (Full mode — Reference mode documents uncovered acceptance under "Not covered" instead)
- Give every case a specific expected result and the acceptance it covers (both modes)

**MUST NOT**
- Skip error-path testing (e.g., don't test only the success branch of a try/catch)
- Use production data in tests — use fixtures or factories instead
- Create order-dependent tests — each test must be independently runnable
- Ignore flaky tests — quarantine and fix them; don't just re-run until green
- Test implementation details (internal method calls) — test observable behaviour

## Output Template

**Full mode** — when creating test plans, provide:
1. Test scope and approach
2. Test cases with expected outcomes
3. Coverage analysis
4. Findings with severity (Critical/High/Medium/Low)
5. Specific fix recommendations

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
