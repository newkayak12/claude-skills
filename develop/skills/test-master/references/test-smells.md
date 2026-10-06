# Test Smells

Use when reviewing tests, or when a suite is brittle, slow, or green while bugs ship. Core test: does this test fail if the real behavior breaks, and only then?

## 1. Asserting on the double

Symptom: the assertion checks that a mock exists or returns what you stubbed.
```kotlin
every { repo.find(1) } returns user
assertEquals(user, repo.find(1))      // tests MockK
```
Fix: assert on what the subject produced from that input. If you only can assert on the mock, test the real collaborator or drop the test.

## 2. Test-only members in production code

Symptom: `resetForTest()`, a public setter, or an `internal` flag added so tests can reach state.
Fix: expose the behavior through the normal API, or move cleanup helpers into test sources/fixtures. Production types should not know tests exist.

## 3. Mocking what you do not understand

Symptom: a mock added "to make it fast" removes a side effect the test actually relies on (a write, an event, a validation).
Fix: first run with the real thing and note what it does. Then replace the slowest, outermost call only, preserving the effects the scenario needs.

## 4. Partial test data

Symptom: a stub or fixture contains only the fields the test reads. Code downstream reads another field, gets null, and passes in tests but fails in production.
Fix: build fixtures to the full shape of the real type (a builder with valid defaults, or a captured real payload). Check the contract, not just the fields you remember.

## 5. Integration as afterthought

Symptom: "implemented, tests to follow", and then never.
Fix: testing is part of the change. Do not mark it finished until its tests exist and pass.

## More smells

| Smell | Sign | Fix |
|---|---|---|
| Order dependence | passes alone, fails in suite | each test builds its own state |
| Overspecified | breaks on refactor with same behavior | assert outcomes, not call sequences |
| Giant arrange | 40 lines of setup | builder, or the unit has too many dependencies |
| Conditional logic | `if`/loops inside the test | split into cases; use parametrization |
| Real clock/network | intermittent failures | inject clock; stub remote |
| Assertion-free | only checks "no exception" | assert result or state |

## Quick review questions

- What defect would make this test fail? Name it.
- If I replaced the implementation with a different correct one, would it still pass?
- Would I trust a green run?
