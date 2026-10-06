# Smells and Heuristics

A smell is a surface symptom that often points to a structural weakness. It is a prompt
to look, not an automatic verdict; severity comes from what the smell threatens (see
modes.md).

## Comments

- Stale or false comment: behaviour described does not match the code.
- Redundant comment: repeats an obvious line.
- Commented-out code: delete it.
- Information that belongs elsewhere: change history, ticket narrative, author notes.

## Build and environment

- Building takes several manual steps. A fresh checkout should build with one command
  (`./gradlew build`).
- Running the tests takes several steps. One command should run everything, such as
  `./gradlew test`.

## Functions

| Smell | Why it matters | Usual fix |
|-------|----------------|-----------|
| Too many parameters | Call sites become guesswork | Parameter object |
| Output parameters | Direction of data is unclear | Return the value |
| Flag / selector parameters | Function secretly holds two behaviours | Split by name, or use a type |
| Dead function | Never called, still maintained | Delete |
| Does not do the obvious thing | Surprises callers | Implement the least-astonishing behaviour |

## Design and structure

- **Duplication:** same logic in several places. Extract; if the copies differ slightly,
  find the real parameter. Duplicated `switch`/`when` over the same type points to
  polymorphism or a sealed hierarchy.
- **Mixed abstraction levels:** a method combining policy decisions with byte-level work.
  Separate by altitude.
- **Feature envy:** a method that mostly reads another object's fields belongs there.
- **Obscured intent:** dense expressions, clever one-liners, Hungarian prefixes, magic
  numbers. Rewrite so the intent is the visible part.
- **Wrong place for a responsibility:** a controller computing prices, an entity
  sending e-mail. Move to the layer that owns it.
- **Base class knowing its subclasses**, or derived types leaking up.
- **Inconsistency:** the same task done differently in neighbouring code; pick one and
  follow it.
- **Artificial coupling:** things that do not depend on each other sharing a constant,
  enum or utility class only for convenience.
- **Excess:** speculative generality, unused hooks, dead branches, unneeded abstractions.
- **Overridden safeties:** disabled warnings, suppressed lints, skipped failing tests,
  `@Suppress` without reason, broad `catch`.
- **Boundary neglect:** off-by-one, empty input, overflow, time zones and daylight-saving.
  Every boundary condition needs a test.
- **Shared mutable state** exposed across threads or requests without ownership rules.
- **Train wrecks:** `a.b().c().d()` reaches through structure the caller should not know.
- **Primitive obsession:** raw `String`/`Long` for domain values such as `UserId`; wrap
  them in value classes.
- **Temporal coupling:** calls that must happen in a hidden order; make the order a
  requirement of the types.

## Names and tests

- Names that hide intent, mislead, or break the project's vocabulary.
- Tests: missing for a public behaviour, a test that cannot fail, ignored tests left
  in place, slow suites that nobody runs, assertions on implementation details.

## Using the list in review

1. Note the symptom with `file:line`.
2. Ask what breaks or costs the next change, and name the acceptance item if any.
3. Only then pick severity: correctness or acceptance threat is blocking; ongoing cost
   is major; local readability is minor.
4. Propose the smallest remedy and, for implement mode, avoid introducing the smell in the
   first place by following steps I3 to I6.
