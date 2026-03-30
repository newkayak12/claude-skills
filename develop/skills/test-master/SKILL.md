---
name: test-master
description: >-
  Use when someone needs to write, improve, or audit tests — generating unit, integration, E2E, performance, or security tests, analyzing coverage gaps, or producing a test plan or defect report.
  Triggers on: "테스트 작성", "단위 테스트", "커버리지 분석", "test coverage", "write tests", "add tests", "test plan", "QA", "flaky test", "test strategy", "regression test", "shift-left".
  Best for: greenfield test suites, test plan creation, coverage gap analysis.
  Not for: diagnosing non-deterministic flakiness (use flaky-test-analyzer); TDD workflow (use test-driven-development).
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: quality
  role: specialist
  scope: testing
  output-format: report
  related-skills: test-driven-development, flaky-test-analyzer
scenarios:
  - "write unit tests for this service"
  - "analyze test coverage"
  - "generate a test plan"
  - "이 코드에 테스트 추가해줘"
  - "테스트 커버리지 분석해줘"
  - "통합 테스트 어떻게 짜야 해?"
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

## Process

If sequential-thinking is available, invoke it for steps 1–2 before writing any test code: explicitly complete "Define scope" and "Create strategy" as separate sequential steps, passing each step's output as input to the next. This prevents generating test files before the testing type, framework, and coverage targets are confirmed.

1. **Define scope** — Identify what to test and which testing types apply
2. **Create strategy** — Plan the test approach across functional, performance, and security perspectives
3. **Write tests** — Implement tests with proper assertions (see example below)
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

<!-- TDD Iron Laws and Testing Anti-Patterns adapted from obra/superpowers by Jesse Vincent (@obra), MIT License -->

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

## Constraints

**MUST DO**
- Test happy paths AND error/edge cases (e.g., empty input, null, boundary values)
- Mock external dependencies — never call real APIs or databases in unit tests
- Use meaningful `it('…')` descriptions that read as plain-English specifications
- Assert specific outcomes (`expect(result).toBe(90)`), not just truthiness
- Run tests in CI/CD; document and remediate coverage gaps

**MUST NOT**
- Skip error-path testing (e.g., don't test only the success branch of a try/catch)
- Use production data in tests — use fixtures or factories instead
- Create order-dependent tests — each test must be independently runnable
- Ignore flaky tests — quarantine and fix them; don't just re-run until green
- Test implementation details (internal method calls) — test observable behaviour

## Output Template

When creating test plans, provide:
1. Test scope and approach
2. Test cases with expected outcomes
3. Coverage analysis
4. Findings with severity (Critical/High/Medium/Low)
5. Specific fix recommendations

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Generates test scaffolding and assertions | Confirm test scope and edge cases |
| Identifies coverage gaps from existing code | Run tests and share failure output |
| Writes test plan structure | Validate that tests match business intent |
| Suggests mocking strategies | Integrate tests into CI/CD pipeline |

## Related Skills

- `develop:test-driven-development` — TDD workflow (red-green-refactor cycle)
- `develop:flaky-test-analyzer` — diagnose intermittent test failures
- `develop:clean-code` — test code quality and readability
