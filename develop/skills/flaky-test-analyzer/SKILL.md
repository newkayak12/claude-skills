---
name: flaky-test-analyzer
description: 'Diagnoses intermittent, non-deterministic test failures — root-causes flakiness from timing races, shared state pollution, external dependencies, test ordering, or CI environment differences, then provides concrete fixes. Use when tests pass locally but fail in CI, pass some runs and fail others, or someone suspects a test is unreliable but cannot reproduce the failure consistently.'
---

# Flaky Test Analyzer

A flaky test is a test that fails intermittently without any change to the code under test. Flaky tests are actively harmful: they erode trust in the test suite, slow CI pipelines with re-runs, and mask real failures. The standard response — "just re-run it" — is the worst response because it normalizes unreliability and hides the root cause.

Every flaky test has a deterministic root cause. This skill provides a systematic process to find it.

If `sequential-thinking` is available, use it to work through Steps 1–5 in order — skipping triage before fixing is the primary failure mode.

## Triage: Find the Category First

Before debugging, identify the failure category. Run the test in isolation, in parallel, in different orders, and on CI. The conditions under which it fails tell you the category.

| Fails When | Category |
|-----------|----------|
| Run repeatedly in isolation | Timing dependency or resource leak |
| Run after specific other tests | Ordering / shared state dependency |
| Run in parallel | Concurrency or shared resource conflict |
| Run on CI but not locally | Environment dependency (clock, timezone, file path, env var) |
| Run with real external systems | External dependency (network, DB, third-party API) |
| Passes consistently after a sleep/wait | Timing / async race condition |

## The 5 Flakiness Categories

For category-specific fix patterns and code examples, read `references/flaky-fix-patterns.md`.

**Category 1: Timing Dependencies** — Test asserts on async work before it completes. Fix: use `waitFor`/`awaitility`, event-driven signals, or inject a controllable `Clock`. Never use `Thread.sleep`.

**Category 2: Shared State Between Tests** — Tests pollute database, static variables, in-memory caches, or file system. Fix: reset state in `@BeforeEach`/`@AfterEach`; use `@Transactional` rollback or explicit truncate; prefer instance injection over singletons.

**Category 3: External Dependencies** — Tests call real HTTP APIs, databases, or message queues. Fix: mock at the boundary (WireMock, Mockito); use Testcontainers for integration tests needing a real DB.

**Category 4: Test Ordering Dependencies** — Test B implicitly relies on state created by Test A. Fix: each test owns its own setup; run tests in random order to detect (`--randomly-seed=random`).

**Category 5: Concurrency and Parallelism** — Parallel tests share ports, files, or singletons. Fix: use port 0 (OS-assigned); inject resources so each test gets its own instance.

## Debugging Process

Follow these steps in order — stop when you find the cause:

1. **Reproduce in isolation.** Run only the failing test 20 times: `mvn -Dtest=MyTest#myMethod test -count=20`. If it flakes in isolation, the cause is internal (timing, nondeterminism, resource leak).

2. **Reproduce with ordering.** Run the failing test after each other test in the suite. When you find the pair that fails, you have the ordering dependency.

3. **Add logging to the failure.** Print timestamps, thread names, and state snapshots at key points. Intermittent failures have intermittent states — the log captures the state at failure time.

4. **Check for nondeterministic inputs.** Search for `new Date()`, `Math.random()`, `UUID.randomUUID()`, or `System.currentTimeMillis()` in the test or code under test. Replace with injected, controllable versions.

5. **Check resource cleanup.** Does each test have a corresponding cleanup? Look for missing `@AfterEach` teardown, unclosed streams, or un-stubbed mocks leaking behavior.

## Fix Patterns Quick Reference

| Root Cause | Fix |
|-----------|-----|
| Async race condition | Use `waitFor` / `awaitility`; never `Thread.sleep` |
| System clock dependency | Inject `Clock`; use fixed clock in tests |
| Database pollution | `@Transactional` rollback or explicit truncate in `@BeforeEach` |
| Static/singleton state | Reset in `@BeforeEach`/`@AfterEach`; prefer instance injection |
| Real HTTP/DB calls | Mock with WireMock, Mockito, or Testcontainers |
| Ordering dependency | Self-contained setup; run tests in random order to detect |
| Port conflict | Use port 0 (OS-assigned); never hardcode test ports |
| Timezone sensitivity | Set `TZ=UTC` in CI; use `ZonedDateTime` not `Date` |
| Random data collisions | Use unique test data per run (e.g., UUID prefix) |

## Prevention

- Run tests in random order in CI by default
- Fail the build on any test that is annotated `@Disabled` or `@Ignore` without a linked issue
- Track flakiness rate per test over time; quarantine any test that flakes more than 1% of runs
- Never commit a "re-run on failure" workaround without simultaneously creating a ticket to fix the root cause
