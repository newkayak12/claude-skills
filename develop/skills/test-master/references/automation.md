# Test Automation: Structure, Scale, Operation

## Deciding what to automate

Automate checks that are repeated often, stable in behavior, deterministic, and costly to run by hand (regression, data-heavy, cross-environment). Keep manual: one-off checks, fast-changing UI, judgment-based review (look and feel, exploratory).

Rough payback: (manual minutes per run x runs per period) versus (build + upkeep time). If it will not pay back within a few release cycles, skip it.

## Structure that survives change

- **Page / screen objects**: one class per screen with intent-named methods (`checkout.payWith(card)`); selectors live only there, so a UI change is a one-file fix.
- **Screenplay style**: actors perform tasks built from interactions; good when many roles share flows.
- **Data-driven**: same test body, table of inputs.
- **Keyword-driven**: non-programmers compose cases from named actions; costs a keyword layer to maintain, so adopt only with that audience.
- **Model-based**: derive paths from a state model to explore combinations; worth it for stateful workflows.

Keep assertions in tests, not in page objects, and keep test data builders separate from both.

## Reliability

- Wait on conditions, never on time.
- Isolate data per test; generate unique values.
- Retry only the specific idempotent step known to be transiently flaky, and log every retry. Blanket whole-test retries hide defects.
- "Self-healing" locators that guess replacements can mask real regressions; prefer stable test ids and fail loudly.
- Quarantine a flaky test immediately (tagged, run separately, owner and deadline) so it stops training people to ignore red.

## Scale

- Run tests in parallel with independent data and no shared mutable fixtures.
- Shard across workers by historical duration so shards finish together.
- Run fast tiers first and stop early; run slow tiers on merge or nightly.
- Reuse containers/browsers per worker; reset state rather than rebuild.
- Run only the tests affected by a change when impact data is available, with the full suite on a schedule.

## Pipeline layout

| Stage | Runs | Budget |
|---|---|---|
| Pull request | compile, unit, slice/integration, lint, scan | minutes |
| Merge | adds contract and smoke E2E on a deployed build | tens of minutes |
| Nightly | full E2E, performance, soak, dependency scan | hours |

Publish JUnit XML and traces as build artifacts; report trends (duration, failures, flake rate) not only today's result.

## Team practice

Review test code like production code: intent-revealing names, no duplication of setup, no sleeps, assertions that can fail, data cleaned up. Pair newcomers on a first test, keep a short written convention, and give the suite an owner.
