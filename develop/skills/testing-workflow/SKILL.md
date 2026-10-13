---
name: testing-workflow
description: >-
  Use when someone wants to build a complete, stable test suite from scratch —
  starting with TDD discipline, moving into coverage strategy, and ending with
  flaky test elimination. Triggers on: "testing workflow", "테스트 전체 프로세스", "TDD부터
  커버리지까지".
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

3 steps: write first → strategize coverage → stabilize CI. Each step is a sub-skill; this skill only sequences them and checks the hand-off.

**Not for** one test on already-covered code, consistent (non-flaky) failures — those are bugs (`bug-diagnoser`) — or a one-off unit test request (`test-master`).

## Standing Mandates

- NEVER mark a step done on a claim. Each step closes with its count line (below) taken from a run or a file, not from memory. (Scar: "tests added" with none executed.)
- NEVER start Step 3 before Step 2's gap list exists, and NEVER fix a flaky test by re-running it.
- Goal: all three step lines filled, or each skipped step carries its Skip-if reason; stop there.

## Steps

```
[1] test-driven-development → [2] test-master → [3] flaky-test-analyzer
```

| Step | Skill | Input | Done when | Skip if |
|---|---|---|---|---|
| 1 | `test-driven-development` | requirements / acceptance criteria | every new behavior has a RED Evidence Record and a passing test; no production code before a failing test | throwaway prototype, or tests added to untested code (go to 2) |
| 2 | `test-master` | the module from Step 1, or existing code | coverage gap report, test plan with severities, cases for uncovered paths | targets already met and a current plan exists |
| 3 | `flaky-test-analyzer` | failing CI logs / known flaky tests from Step 2 | root cause per flaky test, fix, one prevention rule | CI passes consistently with no re-run workarounds |

Joining mid-process: "커버리지부터" → Step 2; "flaky test만" → Step 3; a matching Skip-if moves on to the next step.

## Output Template

```
## Testing workflow — <scope>
Verdict: <stable | N open items>
Step 1 TDD: 6 behaviors · 6 RED records · 6 green  (or: skipped — <reason>)
Step 2 Coverage: line 62% → 81% · 7 gaps found · 5 closed · 2 open (<ids>)
Step 3 Flaky: 4 flaky · 4 root-caused · 3 fixed · 1 quarantined (<ticket>)
CI: 20 isolated reruns of each fixed test · 20/20 green
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Writes failing tests and minimal code (Step 1) | Confirm the test pins the right behavior |
| Gap analysis and test plan (Step 2) | Provide test files and coverage reports |
| Root cause and fix per flaky test (Step 3) | Run each failing test 20 times in isolation; wire the fixes and CI |

## Related Skills

- `develop:test-driven-development`, `develop:test-master`, `develop:flaky-test-analyzer` — the three steps
- Before: `develop:architecture-workflow` (architecture still open)
- After: `develop:performance-profiling-optimization` (suite green and stable)
