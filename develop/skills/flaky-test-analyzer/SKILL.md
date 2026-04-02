---
name: flaky-test-analyzer
description: >-
  Use when tests pass locally but fail in CI, pass some runs and fail others, or someone
  suspects a test is unreliable but cannot reproduce the failure consistently. Diagnoses
  root causes and provides concrete fixes.
  Triggers on: "flaky test", "intermittent test failure", "passes locally fails in CI",
  "test is non-deterministic", "random test failure", "테스트가 가끔 실패", "간헐적 테스트 오류",
  "CI에서만 실패하는 테스트", "flaky".
  Best for: timing races, shared state pollution, ordering dependencies, CI environment differences.
  Not for: consistently failing tests with a known error (those are bugs, not flakiness).
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

# Flaky Test Analyzer

## When to Use / When Not to Use

**Use when:**
- A test fails intermittently without code changes
- Tests pass locally but fail in CI
- Re-runs are being used as a workaround (treating symptoms, not the cause)

**Do not use when:**
- The test fails consistently — that is a bug, not flakiness
- You need to write new tests (use `test-master` or `test-driven-development`)

## Process

1. **Triage first** — identify the failure category before attempting a fix
2. **Reproduce in isolation** — run only the failing test 20 times
3. **Reproduce with ordering** — run the failing test after each other test in the suite
4. **Add logging** — capture timestamps, thread names, and state snapshots at failure time
5. **Check nondeterministic inputs** — search for `new Date()`, `Math.random()`, `UUID.randomUUID()`, `System.currentTimeMillis()`
6. **Check resource cleanup** — verify `@AfterEach` teardown, unclosed streams, un-stubbed mocks

If `sequential-thinking` is available, use it to work through steps 1–5 in order — skipping triage before fixing is the primary failure mode.

## Output Template

For each flaky test analysis, provide:
1. Failure category (from the triage table below)
2. Root cause diagnosis with evidence
3. Concrete fix (code snippet)
4. Prevention rule for the test suite
5. Recommended CI configuration to catch this class of flakiness earlier

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Identifies failure category from symptom description | Provide the test code and failure log |
| Explains why the root cause causes intermittent failure | Run the test 20 times in isolation to confirm |
| Provides the specific fix pattern (waitFor, Clock injection, etc.) | Implement and verify the fix |
| Suggests `@BeforeEach` / `@AfterEach` cleanup patterns | Apply to the full test suite |
| Recommends CI flags (random ordering, etc.) | Configure CI pipeline |

## Triage: Find the Category First

| Fails When | Category |
|-----------|----------|
| Run repeatedly in isolation | Timing dependency or resource leak |
| Run after specific other tests | Ordering / shared state dependency |
| Run in parallel | Concurrency or shared resource conflict |
| Run on CI but not locally | Environment dependency (clock, timezone, path, env var) |
| Run with real external systems | External dependency (network, DB, third-party API) |
| Passes after a sleep/wait | Timing / async race condition |

## The 5 Flakiness Categories

**1. Timing Dependencies** — Asserts on async work before it completes.
Fix: use `waitFor`/`awaitility`, event-driven signals, or inject a controllable `Clock`. Never use `Thread.sleep`.

**2. Shared State Between Tests** — Tests pollute database, static variables, in-memory caches, or file system.
Fix: reset state in `@BeforeEach`/`@AfterEach`; use `@Transactional` rollback or explicit truncate; prefer instance injection over singletons.

**3. External Dependencies** — Tests call real HTTP APIs, databases, or message queues.
Fix: mock at the boundary (WireMock, Mockito); use Testcontainers for integration tests needing a real DB.

**4. Test Ordering Dependencies** — Test B implicitly relies on state created by Test A.
Fix: self-contained setup per test; run tests in random order (`--randomly-seed=random`).

**5. Concurrency and Parallelism** — Parallel tests share ports, files, or singletons.
Fix: use port 0 (OS-assigned); inject resources so each test gets its own instance.

## Fix Patterns Quick Reference

| Root Cause | Fix |
|-----------|-----|
| Async race condition | Use `waitFor` / `awaitility`; never `Thread.sleep` |
| System clock dependency | Inject `Clock`; use fixed clock in tests |
| Database pollution | `@Transactional` rollback or truncate in `@BeforeEach` |
| Static/singleton state | Reset in `@BeforeEach`/`@AfterEach`; prefer instance injection |
| Real HTTP/DB calls | Mock with WireMock, Mockito, or Testcontainers |
| Ordering dependency | Self-contained setup; run tests in random order |
| Port conflict | Use port 0; never hardcode test ports |
| Timezone sensitivity | Set `TZ=UTC` in CI; use `ZonedDateTime` not `Date` |
| Random data collisions | Use unique test data per run (UUID prefix) |

For category-specific fix code examples, see `references/flaky-fix-patterns.md`.

## Prevention

- Run tests in random order in CI by default
- Quarantine any test that flakes more than 1% of runs
- Never commit a "re-run on failure" workaround without a ticket to fix the root cause
- Fail the build on any `@Disabled` / `@Ignore` without a linked issue

## Related Skills

- `test-master` — writing new tests with built-in flakiness prevention
- `test-driven-development` — TDD patterns that reduce flakiness by design
- `chaos-engineer` — when you want to intentionally test failure behavior
