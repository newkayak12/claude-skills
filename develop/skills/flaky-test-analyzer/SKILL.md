---
name: flaky-test-analyzer
description: >-
  Use when tests pass locally but fail in CI, pass some runs and fail others, or
  someone suspects a test is unreliable but cannot reproduce the failure
  consistently. Diagnoses root causes and provides concrete fixes. Triggers on:
  "flaky test".
scenarios:
  - "Our tests pass locally but randomly fail in CI — I need to fix these flaky tests"
  - "Help me diagnose why this test fails intermittently with a race condition"
  - "CI pipeline keeps red because of non-deterministic test failures"
  - "로컬에선 통과하는 테스트가 CI에서 랜덤으로 실패해"
  - "간헐적으로 실패하는 테스트 원인을 찾아줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 간헐적 실패의 근본 원인을 더 체계적으로 추론합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER fix before the category is named from evidence (a run count, a log line, an ordering), and NEVER propose a re-run, retry, or `sleep` as the fix. (Scar: re-run workarounds hide the cause and the failure rate climbs back.)
- NEVER call a failure flaky until it has passed and failed on the same code. A consistent failure is a bug, not flakiness.
- A cause you have not reproduced is `[unconfirmed]` with the run that would confirm it — never stated as the cause.
- Goal: one named category, one evidenced root cause, one fix, one prevention rule per test; stop at 20 isolated runs per hypothesis and report the pass/fail counts you have.

# Flaky Test Analyzer

Diagnose intermittent test failures by category, prove the cause, fix it.

**Not for** consistent failures (`bug-diagnoser`), new tests (`test-master`, `test-driven-development`), or deliberate failure injection (`chaos-engineer`).

## Process

1. **Triage first** — name the failure category from the table below before any fix.
2. **Reproduce in isolation** — run only the failing test 20 times; record passes/fails.
3. **Reproduce with ordering** — run it after each other test in the suite.
4. **Add logging** — timestamps, thread names, state snapshots at failure time.
5. **Check nondeterministic inputs** — `new Date()`, `Math.random()`, `UUID.randomUUID()`, `System.currentTimeMillis()`.
6. **Check cleanup** — `@AfterEach` teardown, unclosed streams, un-stubbed mocks.

With `sequential-thinking`, take steps 1–5 in order: skipping triage is the main failure mode.

## Triage

| Fails when | Category | Fix |
|---|---|---|
| Run repeatedly in isolation; passes after a sleep | 1 Timing / async race | `waitFor` / awaitility, event signals, injected `Clock`; never `Thread.sleep` |
| Run after specific other tests | 2 Shared state / ordering | reset in `@BeforeEach`/`@AfterEach`, `@Transactional` rollback or truncate, instance injection; random order (`--randomly-seed=random`) |
| Run with real external systems | 3 External dependency | mock at the boundary (WireMock, Mockito); Testcontainers when a real DB is needed |
| Run in parallel | 4 Concurrency | port 0, per-test resources, no shared singletons |
| CI but not locally | 5 Environment (clock, timezone, path, env var) | `TZ=UTC` in CI, `ZonedDateTime` not `Date`, unique data per run (UUID prefix) |

Code-level examples per category: `references/flaky-fix-patterns.md`.

## Prevention

- Random test order in CI by default.
- Quarantine a test that flakes in more than 1% of runs.
- No "re-run on failure" workaround without a ticket for the root cause.
- No `@Disabled` / `@Ignore` without a linked issue.

## Output Template

```
## Flaky analysis — <test>
Verdict: <root-caused | unconfirmed>  ·  Category: <1–5 name>  ·  Isolation: 7/20 failed · Ordered after <X>: 20/20 failed
Root cause: <evidence: log line / ordering / env diff>
Fix: <code snippet>  ·  Verified: 20/20 passed after fix | not yet run [unconfirmed]
Prevention rule: <one line>
CI config to catch this class earlier: <flag / setting>
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Names the category from the symptoms and logs; explains why the cause is intermittent | Provide the test code and failure log |
| Gives the fix pattern and cleanup/CI-flag recommendations | Run the test 20 times in isolation to confirm; apply the fix to the suite; configure CI |

## Related Skills

- `develop:test-master` — new tests with flakiness prevention built in
- `develop:test-driven-development` — TDD patterns that reduce flakiness by design
- `develop:chaos-engineer` — intentional failure testing
- `develop:bug-diagnoser` — failures that are consistent
