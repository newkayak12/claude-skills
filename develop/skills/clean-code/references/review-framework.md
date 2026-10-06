# Review Framework — six dimensions, a fast self-check, an optional score

Gate mode measures a diff against these dimensions; implement mode writes code that would
clear them. Each section ends with the file holding the detail.

## 1. Names

A name should tell the reader what the thing is for without a trip to its definition.

| Kind | Rule of thumb | Example |
|------|---------------|---------|
| Value | Says what it holds, with the unit if any | `daysSinceLastLogin`, not `d` |
| Boolean | Reads as a yes/no question | `isExpired`, `hasRole`, `canRefund` |
| Function | Verb phrase for the effect | `issueRefund()`, not `refund2()` |
| Class | Noun for one responsibility | `InvoiceRenderer`, not `InvoiceHelper` |
| Constant | Named once, greppable | `MAX_RETRIES = 3` |
| Collection | Plural of the element | `overdueInvoices`, not `list1` |

Detail: [naming-conventions.md](naming-conventions.md)

## 2. Functions

Short, one job, one level of detail per body.

| Symptom | Remedy | Example |
|---------|--------|---------|
| Body mixes steps | Extract named steps | `validate(cmd); val order = build(cmd); save(order)` |
| Boolean switch parameter | Two functions | `renderPdf()` / `renderHtml()` instead of `render(pdf: Boolean)` |
| Arrow-shaped nesting | Guard clauses, extract inner blocks | early `return` / `?: return` |
| Long parameter list | Group into a type | `DateRange(from, to)` |

Detail: [functions-and-methods.md](functions-and-methods.md)

## 3. Comments and formatting

Comments carry the reason the code cannot. A comment asserting behaviour the code lacks is
a defect, not a style point.

| Situation | Action |
|-----------|--------|
| Comment restates the code | Delete it, or rename so it is unnecessary |
| Comment records a constraint or trade-off | Keep it |
| Dead code in comments | Delete; history lives in git |
| Style disputes | Settle once in a formatter config (ktlint, spotless) |

Detail: [comments-formatting.md](comments-formatting.md)

## 4. Error handling

Failures must be visible, typed and explained.

| Situation | Action |
|-----------|--------|
| Absent value | Nullable type handled at the edge, or an empty collection; no sentinel `null` crossing layers |
| Failure signalled by a code | Throw or return a typed result |
| `catch` that does nothing | Handle, rethrow with cause, or remove |
| Vendor exception leaking | Translate at the adapter |

Detail: [error-handling.md](error-handling.md)

## 5. Tests

| Situation | Action |
|-----------|--------|
| Layout | given / when / then, visibly separated |
| Name | Scenario plus outcome |
| Flaky | Inject the clock, stub the network, isolate the database |
| Noisy setup | Builders and helpers named after the domain |

Detail: [testing-principles.md](testing-principles.md)

## 6. Smells

| Smell | Remedy |
|-------|--------|
| Copy-paste logic | Extract one shared function |
| Method more interested in another class's data | Move it there |
| Unused code | Delete |
| Unexplained literal | Named constant |

Detail: [code-smells.md](code-smells.md)

## Quick diagnostic

| Ask | If the answer is no |
|-----|---------------------|
| Can each function be understood from its name and signature? | Rename |
| Does each function fit on one screen and do one thing? | Extract |
| Is every comment explaining why? | Delete or rewrite |
| Is the happy path free of error plumbing? | Move error handling out |
| Does each class have one reason to change? | Split |
| Does every public behaviour have a test that can fail? | Add one before editing further |
| Does every literal with meaning have a name? | Extract a constant |

## Optional 0–10 score (interactive aside only)

Give it only when a person asks. It is never the verdict and never replaces the findings
table; inside a caller with its own fields (such as `match_pct`) fill those as the caller
defines them and omit this score.

- **9–10:** intent is obvious everywhere, small focused functions, uniform error handling, strong readable tests
- **7–8:** mostly clean; a few vague names or one or two long functions
- **5–6:** uneven; good patterns beside unclear names or duplicated logic
- **3–4:** hard to read; long functions, misleading names, thin or absent tests
- **1–2:** works but opaque; cryptic abbreviations, magic values, no tests
