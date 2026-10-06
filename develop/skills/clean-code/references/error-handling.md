# Error Handling

Error paths are code that runs on the worst day. Keep them explicit, typed and out of the
way of the main logic.

## Report failure through types, not codes

Return codes (`-1`, `false`, `null`) force each caller to remember a check, and a forgotten
check silently continues with bad state. Prefer an exception, or a sealed result when the
failure is an expected outcome rather than an exceptional one.

```kotlin
sealed interface Withdrawal {
    data class Done(val newBalance: Money) : Withdrawal
    data class Refused(val shortBy: Money) : Withdrawal
}

fun withdraw(account: Account, amount: Money): Withdrawal =
    if (account.balance < amount) Withdrawal.Refused(amount - account.balance)
    else Withdrawal.Done(account.debit(amount))
```

Rule of thumb: expected business outcomes (insufficient funds, validation failure) are
good as sealed results; broken invariants and infrastructure faults are exceptions.

## Checked vs unchecked

Kotlin has no checked exceptions, and that matches modern Java practice: forcing every
intermediate layer to declare or catch a low-level failure couples signatures to
implementation details. Use unchecked exceptions and document which ones a function may
throw.

## Say what happened

An exception message should let someone fix the problem without a debugger:
- the operation that failed,
- the identifying inputs (id, key, state), never secrets,
- the cause, attached as the `cause` argument so the original stack is kept.

```kotlin
class OrderNotFound(val orderId: Long) :
    RuntimeException("Order $orderId not found")

class PaymentGatewayUnavailable(cause: Throwable) :
    RuntimeException("Payment gateway call failed", cause)
```

## Translate at the boundary

Do not let vendor or framework exceptions climb through your domain. Wrap the client in
an adapter that catches the library's several failure types and throws one or two types
shaped around what your caller can do about it (retry, show a message, give up). In Spring
Boot, centralise the final translation to HTTP in one `@RestControllerAdvice` rather than
scattering try/catch in controllers.

## Absence

- Do not return `null` to mean "error" or "empty". A function that may return nothing
  says so in its type (`User?`) and callers handle it at once.
- For collections, return an empty list.
- When a "no result" case has real behaviour (a guest with default permissions), a special
  case object removes the conditional entirely.
- Avoid passing `null` as an argument. Kotlin non-null types make this the default; at
  Java interop edges, validate once and convert.

## Catch discipline

| Pattern | Verdict |
|---------|---------|
| `catch (e: Exception) { }` | Swallowed failure; never acceptable on a path someone depends on |
| `catch` then log then rethrow, at every layer | Duplicate noise; log once where it is handled |
| `catch (e: Exception)` around a big block | Narrow to the code that can fail and the type you can handle |
| `finally` or `use {}` for cleanup | Required for resources; prefer `use` for `Closeable` |
| Catching `Throwable` / `CancellationException` | Rethrow cancellation; do not trap it in coroutines |

Good shape: a `try` block that holds only the risky call, followed by handling that either
recovers meaningfully or rethrows with context. Resource-bearing code is easier to reason
about if you write the cleanup first.

## Review checklist

1. Can any failure vanish without a trace?
2. Is every thrown error typed and informative, with its cause preserved?
3. Does any `null` cross a layer boundary as an error signal?
4. Are vendor exception types visible outside their adapter?
5. Is there a test for each error path the acceptance names?
