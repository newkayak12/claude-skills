# Unit Tests on the JVM

A unit test exercises one class's decisions with every collaborator that crosses a process boundary replaced. It should run in milliseconds and need no Spring context.

## Shape of a test (Kotlin, JUnit 5, MockK)

```kotlin
class InvoiceServiceTest {
    private val rates = mockk<TaxRateClient>()
    private val sut = InvoiceService(rates)

    @Test
    fun `adds regional tax to the net total`() {
        every { rates.rateFor("KR") } returns BigDecimal("0.10")

        val invoice = sut.issue(net = BigDecimal("200.00"), region = "KR")

        assertEquals(BigDecimal("220.00"), invoice.gross)
    }

    @Test
    fun `rejects a negative net amount`() {
        val ex = assertThrows<IllegalArgumentException> { sut.issue(BigDecimal("-1"), "KR") }
        assertEquals("net must be >= 0", ex.message)
    }
}
```

Conventions that keep suites readable:
- Name the behavior, not the method: the backtick title is a sentence a product owner could confirm.
- Arrange / act / assert in three visible blocks; one act per test.
- Construct the subject by hand (`InvoiceService(rates)`); constructor injection makes `@SpringBootTest` unnecessary here.
- Compare values with the narrowest assertion (`assertEquals` on the money amount, not `assertNotNull`).

## Parametrized boundaries

Use one table for the same rule at several inputs:

```kotlin
@ParameterizedTest
@CsvSource("0,false", "1,true", "99,true", "100,false")
fun `quantity must be within 1 until 100`(qty: Int, ok: Boolean) =
    assertEquals(ok, OrderLine.isValidQuantity(qty))
```

Pick values on each side of every boundary, plus the empty / null / zero case.

## Test doubles, by purpose

| Double | Use it to | Watch out for |
|---|---|---|
| Stub (`every { } returns`) | feed the subject an indirect input | stubbing calls the subject never makes |
| Mock (`verify`) | confirm an outgoing command happened (send mail, publish event) | verifying queries -- that pins implementation |
| Fake (in-memory repository) | keep state across calls in a small collaborator | a fake that drifts from the real contract |

Prefer a fake or a real value object over a mock when the collaborator is cheap and deterministic. Mock only what you own at an architectural seam; wrap third-party clients behind your own interface first.

## Time, randomness, ids

Inject `Clock`, an id generator, or a random source. Tests then set them to fixed values instead of sleeping or asserting "roughly now".

## Layout

- Mirror the production package; the test class is named `<Subject>Test`.
- Shared builders live in a `fixtures` package (`anOrder().withLines(2).build()`), with defaults that are valid so each test overrides only what it is about.
- Do not share mutable state between tests; JUnit creates a fresh instance per test method by default, so initialise fields instead of using static ones.
