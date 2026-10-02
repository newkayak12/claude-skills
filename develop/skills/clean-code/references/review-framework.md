# Review Framework — the six dimensions, quick diagnostic, optional score

The dimensions both modes use. Gate mode checks a diff against them; implement mode
writes code that would pass them. Deep dives live in the per-dimension files linked
under each table.

## 1. Meaningful Names

Names should reveal intent, avoid disinformation, and make the code read like prose.

| Context | Pattern | Example |
|---------|---------|---------|
| Variables | Intention-revealing name | `elapsedTimeInDays` not `d` |
| Booleans | Predicate phrasing | `isActive`, `hasPermission`, `canEdit` |
| Functions | Verb + noun describing action | `calculateMonthlyRevenue()` not `calc()` |
| Classes | Noun describing responsibility | `InvoiceGenerator` not `InvoiceManager` |
| Constants | Searchable, all-caps with context | `MAX_RETRY_ATTEMPTS = 3` not `3` inline |
| Collections | Plural nouns or descriptive phrases | `activeUsers` not `list` or `data` |

See: [naming-conventions.md](naming-conventions.md)

## 2. Functions

Functions should be small (4–6 lines ideal, under 20 as a hard look), do one thing, and
operate at a single level of abstraction.

| Context | Pattern | Example |
|---------|---------|---------|
| Long function | Extract into named steps | `validateInput(); transformData(); saveRecord();` |
| Flag argument | Split into two functions | `renderForPrint()` and `renderForScreen()` not `render(isPrint)` |
| Deep nesting | Extract inner blocks | Move nested `if`/`for` bodies into named functions |
| Multiple returns | Guard clauses at top | Early return for error cases, single happy path |
| Many arguments | Introduce parameter object | `new DateRange(start, end)` not `report(start, end, format, locale)` |

See: [functions-and-methods.md](functions-and-methods.md)

## 3. Comments and Formatting

A comment is a failure to express yourself in code. Comments explain *why*, never *what*.
A comment that states a behaviour the code does not have is a defect, not a style issue.

| Context | Pattern | Example |
|---------|---------|---------|
| Explaining "what" | Replace with better name | Rename `// check if eligible` to `isEligible()` |
| Explaining "why" | Keep as comment | `// RFC 7231 requires this header for proxies` |
| Commented-out code | Delete it | Trust version control to remember |
| File organization | Newspaper metaphor | High-level functions at top, details below |
| Team formatting | Agree on rules once | Use automated formatters (Prettier, Black, gofmt) |

See: [comments-formatting.md](comments-formatting.md)

## 4. Error Handling

Use exceptions rather than return codes, provide context with every exception, and never
return or pass null.

| Context | Pattern | Example |
|---------|---------|---------|
| Null returns | Return empty collection or Optional | `return Collections.emptyList()` not `return null` |
| Error codes | Replace with exceptions | `throw new InsufficientFundsException(balance, amount)` |
| Swallowed errors | Never an empty catch | `catch (e) {}` hides the failure from the caller |
| Third-party APIs | Wrap with adapter | `PortfolioService` wraps vendor API, translates exceptions |
| Special cases | Null Object pattern | `GuestUser` with default behavior instead of null checks |

See: [error-handling.md](error-handling.md)

## 5. Unit Testing

Tests are first-class code — clean, readable, maintained with the same discipline as
production code.

| Context | Pattern | Example |
|---------|---------|---------|
| Test structure | Arrange-Act-Assert | Setup, execute, verify — clearly separated |
| Test naming | Scenario + expected behavior | `shouldRejectExpiredToken` not `test1` |
| Flaky tests | Remove external dependencies | Mock time, network, file system |
| Test readability | Domain-specific helpers | `assertThatInvoice(inv).isPaidInFull()` |

See: [testing-principles.md](testing-principles.md)

## 6. Code Smells and Heuristics

| Context | Pattern | Example |
|---------|---------|---------|
| Duplication | Extract shared logic | Common validation → `validateEmail()` helper |
| Long parameter list | Introduce parameter object | `SearchCriteria` groups related params |
| Feature envy | Move method to data's class | `order.calculateTotal()` not `calculator.total(order)` |
| Dead code | Delete it | Remove unused functions, unreachable branches |
| Magic numbers | Named constants | `MAX_LOGIN_ATTEMPTS = 5` not bare `5` |

See: [code-smells.md](code-smells.md)

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Can you understand each function without reading its body? | Names don't reveal intent | Rename functions to describe what they do |
| Are all functions under 20 lines? | Functions do too many things | Extract sub-operations into named helpers |
| Are there zero commented-out code blocks? | Dead code creating confusion | Delete them — version control has history |
| Is error handling separate from business logic? | Try-catch cluttering main flow | Extract error handling; use exceptions not return codes |
| Does every class have a single responsibility? | Classes accumulate unrelated duties | Split into focused classes with clear names |
| Is there a test for every public method? | No safety net for changes | Add tests before making further changes |
| Are magic numbers replaced with named constants? | Intent hidden behind raw values | Extract constants with descriptive names |

## Optional 0–10 Score (interactive aside only)

Give it only when a person asks for a score. It is never the verdict and never replaces
the findings table; inside a caller with its own fields (e.g. `match_pct`) fill those as
the caller defines them and leave this score out.

- **9–10:** Names reveal intent, functions small and focused, error handling consistent, tests clean and comprehensive
- **7–8:** Mostly clean with minor naming ambiguities or a few long functions
- **5–6:** Mixed quality — some good patterns alongside unclear names or duplicated logic
- **3–4:** Significant readability issues — long functions, misleading names, poor or missing tests
- **1–2:** Code works but is nearly unreadable — magic numbers, cryptic abbreviations, no tests
