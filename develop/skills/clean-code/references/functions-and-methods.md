# Functions and Methods

## Size and purpose

A function earns its place by doing one nameable job. Test: can you describe it in one
sentence without "and"? Another test: can you extract a chunk whose name is not just a
rephrasing of its body? If yes, the function has more than one job.

Aim for a handful of lines; treat anything beyond about twenty as a prompt to look for a
seam, not as an absolute law. Deep nesting and long bodies hide the same problem.

```kotlin
// three jobs tangled together
fun register(form: SignupForm) {
    require(form.email.contains("@") && form.password.length >= 12)
    val user = User(form.email, encoder.encode(form.password))
    users.save(user)
    mailer.send(user.email, "Welcome!")
}

// orchestration reads like an outline
fun register(form: SignupForm) {
    validate(form)
    val user = users.save(newUser(form))
    sendWelcome(user)
}
```

## One level of abstraction

Within a body, every statement should sit at the same altitude. Mixing
`orders.confirm()` with byte-level string building forces the reader to shift gears.
Write high-level functions that call lower-level ones, so the file reads top to bottom
from policy to detail.

## Parameters

| Count | Guidance |
|-------|----------|
| 0–1 | Ideal; one parameter is a question about it or a transformation of it |
| 2 | Fine when the pair is natural (`Point(x, y)`); watch for order confusion |
| 3 | Consider a type, or Kotlin named arguments |
| 4+ | Group into a data class |

Further rules:
- **No flag parameters.** `send(msg, urgent = true)` announces two behaviours; give each a
  name (`sendUrgent`, `sendNormal`) or model the variation as a type.
- **No output parameters.** Return the result; mutate only the receiver if you must.
- Kotlin default arguments are fine for optional configuration, not for switching logic.

## Commands and queries

A function should either change state or report on it. A `checkAndSet(...): Boolean`
forces readers to guess which effect matters. Split it, or return a typed result.

## Hidden side effects

Warning signs: a getter that writes to a cache, a `validate` that normalizes input, an
initializer that opens a connection. If the effect is intended, put it in the name
(`loadAndCache`) or move it to the caller.

## Control flow

- Guard clauses at the top remove whole indentation levels: reject bad input early, leave
  one straight happy path. Kotlin's `?: return`, `require`, `check` suit this.
- Prefer expression bodies and `when` for mapping; avoid `break`/`continue` tangles inside
  deep loops, and extract the loop body instead.

## Duplication

Duplicated logic means each fix must be remembered N times. Extract on the third
occurrence rather than the second, so you can see what actually varies; extracting too
early produces a function with flags. Duplication includes near-duplicates: same
algorithm, different types or constants.

## Ordering in a file

Put the public entry points first and the helpers they use beneath, ordered by first use.
Keep related functions close; a reader should rarely scroll far to find a callee.

## Anti-patterns to flag

- A function whose name needs "and"/"or".
- Parameter lists that always travel together across calls.
- Boolean returns that mean different things at different call sites.
- Methods that only forward to another object (middle man) with no added value.
- Mutating arguments in place without saying so.
