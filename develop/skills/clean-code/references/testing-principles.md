# Tests as Production Code

A test suite you cannot read or trust gets deleted or ignored. Hold tests to the same
standard as the code they protect: clear names, no duplication, one idea each.

## Write the test first

1. **Red:** write a failing test for the next small behaviour and watch it fail for the
   reason you predicted.
2. **Green:** write the least code that passes.
3. **Refactor:** clean both code and tests while everything stays green.

Cycles are minutes long. The payoff is a design shaped by callers and a regression net
that already exists when you refactor.

## Shape of a readable test

Three visible phases, in order:

```kotlin
@Test
fun `expired coupon is rejected`() {
    // given
    val coupon = aCoupon(expiresOn = today.minusDays(1))
    // when
    val result = checkout.apply(coupon, cart)
    // then
    assertThat(result).isEqualTo(CouponResult.Expired)
}
```

- Hide setup noise behind builders or helpers named in the domain (`aCoupon`, `anOrder`),
  so the test shows only the data that matters to the case.
- Custom assertions (`assertThat(invoice).isPaidInFull()`) turn mechanics into statements.
- Build the helper layer once; do not paste 20 lines of construction into each test.

## One idea per test

Several asserts are fine when they describe one outcome (all fields of a returned value).
Split the test when it checks two unrelated behaviours, because a failure then does not
say which one broke.

## Qualities that make a suite trustworthy

| Quality | Meaning | Typical violation |
|---------|---------|-------------------|
| Fast | Runs in milliseconds so it runs constantly | Real network or full context start in a unit test |
| Isolated | No order dependence, no shared mutable state | Test B relies on rows test A inserted |
| Repeatable | Same result in any environment | Reads wall-clock time, random values, local files |
| Self-checking | Pass or fail without a human reading output | `println` instead of an assertion |
| Timely | Written with, not long after, the code | Tests bolted on at the end |

Stabilising tests: inject a `Clock`; seed randomness; use Testcontainers for PostgreSQL
instead of sharing a developer database; reset state in setup rather than relying on
cleanup.

## Naming

State scenario and expected outcome so a failure reads like a sentence:
`rejects expired token`, `retries twice then surfaces timeout`. Kotlin backtick names suit
this. Avoid `test1`, `works`, or the method name alone.

## Parameterised tests and data

When only inputs differ, use a parameterised test (JUnit 5 `@ParameterizedTest` with
`@CsvSource` or `@MethodSource`) instead of copy-pasted bodies. Keep the table of cases
visible; it documents the rule.

## Cover the edges deliberately

- Boundaries: zero, one, many; just below, at, and just above a limit; empty and maximum
  size; first and last element.
- Error paths: for each typed failure the code promises, a test that triggers it and
  asserts the type and message content.
- Absence: the nullable or empty case, not only the populated one.

## Tests as documentation

A new teammate should be able to learn what the module guarantees by reading its test
names. If the tests only mirror the implementation line by line, they will break on every
refactor and prove nothing; test behaviour through the public surface.

## Review checklist

1. Could this test fail? (Delete the implementation line: does it go red?)
2. Is the setup limited to what the case needs?
3. Does it depend on time, order, network or shared data?
4. Does the name describe behaviour rather than a method?
5. Is each public behaviour named in the acceptance covered?
