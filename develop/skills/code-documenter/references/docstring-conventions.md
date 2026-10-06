# Docstring and Doc-Comment Conventions

Pick the dialect the repo already uses. Mixed dialects are worse than a mediocre single one.

## What a doc comment must carry

- One summary sentence in the imperative or third person, ending with a period. It states the contract, not the mechanism.
- Inputs: meaning, units, allowed range, nullability. Types are repeated only where the language does not enforce them.
- Output: what it means, including the "nothing found" case.
- Failure: each exception a caller can reasonably handle, with the trigger condition.
- Side effects, thread-safety, or cost only when a caller would be surprised.

Skip: restating the name (`getName` -> "gets the name"), trivial accessors, private helpers whose body is clearer than any comment.

## Kotlin (KDoc)

```kotlin
/**
 * Reserves [quantity] units of [sku] for [orderId].
 *
 * The reservation expires after [ttl]; an expired reservation is released
 * by the sweeper, not by this call.
 *
 * @param sku stock-keeping unit, e.g. `"SKU-1042"`
 * @param quantity must be positive
 * @return the reservation, or `null` when stock is insufficient
 * @throws IllegalArgumentException if [quantity] is not positive
 * @see Reservation
 */
fun reserve(orderId: OrderId, sku: String, quantity: Int, ttl: Duration): Reservation?
```

- Square brackets link to symbols; Markdown is allowed, no HTML needed.
- Constructor properties are documented with `@property name` in the class comment.
- `@param` for a type parameter is written `@param T ...`.
- Dokka renders KDoc to HTML or Markdown; run it in CI so broken links surface.
- detekt's comments rule set can flag undocumented public classes and functions.

## Java (Javadoc)

Same tag vocabulary (`@param`, `@return`, `@throws`, `{@link Type#member}`). First sentence becomes the index summary, so make it stand alone. Use `{@code ...}` for inline code.

## Python

Three common layouts. Choose one per project.

```python
def charge(account_id: str, cents: int, *, retry: bool = False) -> Receipt:
    """Charge an account and return the receipt.

    Args:
        account_id: Billing account identifier.
        cents: Amount in minor units; must be greater than zero.
        retry: Re-attempt once on a transient gateway error.

    Returns:
        The receipt for the successful charge.

    Raises:
        ValueError: If ``cents`` is not positive.
        GatewayError: If the gateway rejects the charge.
    """
```

| Style | Section markers | Typical home |
|-------|-----------------|--------------|
| Google | `Args:` / `Returns:` / `Raises:` | General application code |
| NumPy | `Parameters` + dashed underline | Scientific libraries |
| Sphinx | `:param x:` / `:returns:` / `:raises E:` | Projects built on Sphinx directives |

Rules: triple double quotes; summary on the first line; blank line before details; documented module, class, public method. Class docstrings describe the object and its constructor arguments; `__init__` gets its own docstring only if its behaviour is non-obvious. Executable examples go in a `Examples:` block using `>>>` so doctest can run them.

## TypeScript / JavaScript

```typescript
/**
 * Splits a cart into shipments grouped by warehouse.
 *
 * @param items - Cart lines; an empty array yields an empty result.
 * @param options - Optional tuning.
 * @returns One shipment per warehouse, ordered by warehouse id.
 * @throws StockError When an item has no warehouse with stock.
 * @example
 * const shipments = splitCart(cart.items);
 */
export function splitCart(items: CartLine[], options?: SplitOptions): Shipment[] { /* ... */ }
```

- In a `.ts` file the compiler already knows the types, so omit `{type}` in tags (TSDoc convention); in plain `.js` JSDoc keep them.
- Document interface members one by one with a short comment above each, mark `@deprecated` with the replacement, use `@typeParam` (TSDoc) for generics.
- For async code state what the promise resolves to and which rejections are expected.

## Verification

| Language | Command |
|----------|---------|
| Python | `python -m doctest module.py`, or `pytest --doctest-modules` |
| TypeScript | `tsc --noEmit` over the examples; `eslint-plugin-jsdoc` for tag hygiene |
| Kotlin | `./gradlew dokkaHtml` (Dokka 1.x; Dokka 2 uses `dokkaGeneratePublicationHtml`) and read the warnings |
