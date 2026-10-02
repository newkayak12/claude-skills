# Case Spec (Reference Mode)

The file a test-case writing step gets back. Cases only — nobody runs anything here; a later step
(qa `execute`, an implementer's RED step) runs them.

## Where cases come from

1. **The stated acceptance / feature spec first.** Every acceptance criterion and every rule in the
   spec becomes at least one case. A case is one behavior a user or an attacker could hit, not one
   line of implementation.
2. **Code only for names.** Read routes, handlers, or signatures only to spell endpoints, fields,
   status codes, and function names correctly. Do not add, drop, or reshape a case because of what the
   implementation happens to do — that tests the code against itself.
3. **Unknowns become assumptions, not questions.** If the spec does not say what happens (e.g. which
   status code, whether the limit itself is allowed), pick the most defensible reading, write the case against
   it, and list it under Assumptions so the reader can overturn it.

## Per behavior, at least

| Kind | What it pins |
|------|--------------|
| happy | the stated success outcome, with the exact value/status/state change |
| error | each refusal the spec names (invalid, unauthorized, not found, conflict, expired, ...) |
| edge / boundary | empty, null, zero, max, exactly-at-limit and one-past-limit, repeat/duplicate, concurrency where the spec implies uniqueness |

## File shape

```markdown
# Cases — <feature>

Source: <spec / acceptance path or "acceptance in the caller's context">
Status: specified, not run

| id | behavior | kind | level | precondition / input | expected result | acceptance covered |
|----|----------|------|-------|----------------------|-----------------|--------------------|
| C1 | transfer within balance | happy | integration | account A balance 500; POST /transfers {from: A, to: B, amount: 200} | 201; A = 300, B += 200 | A1 |
| C2 | transfer above balance | error | integration | A balance 500; amount 501 | 422 INSUFFICIENT_FUNDS; both balances unchanged | A2 |
| C3 | transfer of exactly the balance | boundary | unit | balance 500, amount 500 (ledger repo mocked) | accepted; A = 0 | A2 (assumption 1) |

## Coverage
| acceptance | cases |
|------------|-------|
| A1 | C1 |
| A2 | C2, C3 |

## Assumptions
1. Spec does not say whether amount == balance is allowed -> allowed (only "above balance" is refused)

## Not covered
- <behavior deliberately left out, and why> (or "none")
```

## Rules the file must pass

- Every row has a concrete expected result (value, status, state change, or exact error) — never
  "works", "handles correctly", or "appropriate error".
- Every acceptance criterion appears in Coverage with at least one case id; an acceptance with no case
  is listed under Not covered with the reason.
- Each behavior has a happy row and at least one error or edge/boundary row.
- `level` is one of unit / integration / E2E / performance / security; mock-vs-real follows the
  skill's MUST DO (unit cases name the external dependency they mock).
- Ids are stable (`C1..Cn`) so a run step can report "C4 -> failed".
- No pass/fail results, coverage percentages, or "tests added" claims — nothing ran.
