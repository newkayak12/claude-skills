---
name: testing-workflow
description: >-
  Use when someone wants to build a complete, stable test suite from scratch —
  starting with TDD discipline, moving into coverage strategy, and ending with
  flaky test elimination. Triggers on: "testing workflow", "테스트 전체 프로세스", "TDD부터
  커버리지까지", "full
type: workflow
theme: engineering
scenarios:
  - "testing workflow 전체 돌려줘"
  - "TDD부터 커버리지 전략까지 단계별로 해보자"
  - "full test cycle from scratch"
  - "CI 테스트 안정화 프로세스 시작"
  - "테스트 체계 제대로 잡고 싶어"
  - "flaky test 포함해서 전체 테스트 전략 짜줘"
estimated_time: "2-8 hours (full), 30-120 min per step"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool은 RED 단계 실패 검증과 커버리지 갭 분석에서 특히 유효합니다.
    sequential-thinking은 flaky test 트리아지 순서를 강제해 원인 건너뜀을 방지합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Testing Workflow

3-step test quality process: write first → strategize coverage → stabilize CI.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Starting a new feature with no tests | Adding a single test to already-covered code |
| Test suite exists but has no coverage strategy | Consistent (non-flaky) test failures — those are bugs |
| CI is failing intermittently due to flaky tests | Quick one-off unit test request |

---

## Workflow Overview

```
[1] Test-Driven Development
     Write failing test → minimal code → refactor
        ↓
[2] Test Coverage Strategy
     Audit coverage gaps → test pyramid → test plan
        ↓
[3] Flaky Test Elimination
     Triage → root cause → fix → CI hardening
```

---

## Steps

### Step 1 — Test-Driven Development
**Skill:** `test-driven-development`
**Goal:** Drive new feature implementation through failing tests first; enforce red-green-refactor discipline
**Input:** Feature requirements or acceptance criteria
**Output:** Passing test suite built test-first; implementation with no production code written before a failing test
**Skip if:** Feature is a throwaway prototype or you are adding tests to existing untested code (go to Step 2)

> "Step 1 시작" 또는 "TDD로 이 기능 개발해줘"

---

### Step 2 — Test Coverage Strategy
**Skill:** `test-master`
**Goal:** Audit coverage gaps, define the test pyramid, produce a formal test plan covering unit, integration, E2E, performance, and security tiers
**Input:** Codebase or module from Step 1 (or existing code if skipping Step 1)
**Output:** Coverage gap report, test plan with severity ratings, scaffolded test cases for uncovered paths
**Skip if:** Coverage targets are already met and a current test plan exists

> "Step 2 시작" 또는 "테스트 커버리지 분석하고 전략 잡아줘"

---

### Step 3 — Flaky Test Elimination
**Skill:** `flaky-test-analyzer`
**Goal:** Diagnose and fix intermittent failures in CI; apply prevention rules to the whole suite
**Input:** Failing CI run logs or list of known flaky tests from Step 2
**Output:** Root cause per flaky test, concrete fix (code + CI config), prevention rule added to suite guidelines
**Skip if:** All tests pass consistently in CI with no re-run workarounds

> "Step 3 시작" 또는 "flaky test 원인 찾고 고쳐줘"

---

## State Tracking

어느 단계에 있는지 알려주면 바로 합류합니다:
- "커버리지부터" → Step 2로 직행
- "flaky test만 봐줘" → Step 3로 직행
- Skip 조건에 해당하면 자동으로 다음 단계로 안내

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Writes failing tests with clear names (Step 1) | Confirm the test tests the right behavior |
| Writes minimal passing implementation (Step 1) | Run tests and verify pass/fail as expected |
| Coverage gap analysis, test plan scaffolding (Step 2) | Provide existing test files and coverage reports |
| Flakiness root cause + fix patterns (Step 3) | Run the failing test 20 times in isolation to confirm |
| CI config recommendations (Step 3) | Wire fixes and configure CI pipeline |

## Related Skills

- Individual skills: `develop:test-driven-development`, `develop:test-master`, `develop:flaky-test-analyzer`
- Before: `develop:dev-quality-workflow` (if you want the full dev cycle including architecture and docs)
- After: `develop:performance-profiling-optimization` (once the test suite is green and stable)
