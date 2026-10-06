# Naming

A name is a small contract: it promises what a thing is or does. Review names by asking
what a newcomer would guess, then checking the guess against the code.

## What a good name does

- States purpose and, where relevant, unit or state: `timeoutMillis`, `pendingOrders`.
- Costs nothing to read aloud and nothing to search for. Single letters and cryptic
  abbreviations fail both; a lone `5` in code cannot be found, `MAX_PAGE_SIZE` can.
- Uses one word per concept across the codebase. If fetching is `find` in one repository
  and `load` in another, readers wonder whether they differ.
- Uses the vocabulary of the business where the concept is a business one, and the
  vocabulary of computing (queue, visitor, adapter) where it is technical.

```kotlin
// opaque
fun proc(l: List<Array<Int>>, f: Int): List<Array<Int>> = l.filter { it[0] == f }

// the same logic, readable
fun ticketsWithStatus(tickets: List<Ticket>, status: TicketStatus) =
    tickets.filter { it.status == status }
```

## Names that mislead

| Trap | Why it hurts | Better |
|------|--------------|--------|
| `accountList` holding a `Set` | Type claim is false | `accounts` |
| `l`, `O`, `1` lookalikes | Visually confusable | any longer word |
| Near-identical `userData` / `userInfo` | No visible difference in meaning | name by the difference, or merge |
| Number suffixes `a1`, `a2` | Says nothing | `source`, `target` |
| Noise words `Manager`, `Processor`, `Info` | Add length, not meaning | pick the real responsibility |

## Shapes by construct

- **Classes and types:** nouns. A class whose best name is a verb phrase is usually a
  function in disguise.
- **Functions:** verbs. Query-style accessors may be nouns (`balance()`); predicates begin
  with `is`, `has`, `can`, `should`.
- **Kotlin specifics:** properties are nouns without `get`; a Boolean property reads
  `isActive`; a factory is `of`/`from`/`create`; extension functions read naturally at the
  call site (`order.totalWithTax()`).
- **Scope sets length:** a loop index in a three-line lambda can be `i`; a field visible
  across a module needs a full name.

## Conventions per language

| Language | Types | Functions / variables | Constants |
|----------|-------|-----------------------|-----------|
| Kotlin / Java | `PascalCase` | `camelCase` | `UPPER_SNAKE_CASE` |
| Python | `PascalCase` | `snake_case` | `UPPER_SNAKE_CASE` |
| TypeScript | `PascalCase` | `camelCase` | `UPPER_SNAKE_CASE` or `camelCase`, per team |
| Go | exported start uppercase | short, mixedCaps | mixedCaps |

Follow the project's existing convention over this table.

## Rename checklist

1. Could a reader outside the team guess the purpose?
2. Does the name still tell the truth after the last refactor?
3. Is the same idea named the same way elsewhere?
4. Can it be found by a text search without hundreds of false hits?
5. Does the rename touch tests, docs and config keys that echo the old name?
