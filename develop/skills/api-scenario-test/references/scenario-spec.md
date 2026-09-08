# Scenario spec

One file per flow, written before the runner code. The spec is what a reviewer reads; the runner
is what CI runs. Keep them in the same directory so a diff to one shows the other.

## Shape

```markdown
# S2 — pay twice is refused
Actor: alice (test account)   Namespace: s2-<run id>

| Step | Request | Capture | Assert |
|------|---------|---------|--------|
| 1 | POST /auth/login {email, password} | token | 200, token present |
| 2 | POST /orders {items:[{sku:SKU-1,qty:1}]} · bearer token | order_id | 201, status = CREATED |
| 3 | POST /orders/{order_id}/pay | — | 200, status = PAID |
| 4 | POST /orders/{order_id}/pay | — | 409, error contains "cannot pay" |
| 5 | GET /orders/{order_id} | — | 200, status = PAID (step 4 changed nothing) |
Cleanup: DELETE /orders/{order_id} (finally)
```

Rules the shape enforces:

- **Capture column is the chain.** Every step after login captures or uses something. A step
  that neither captures nor uses a captured value is a smoke test in the wrong file.
- **Assert names fields, not bodies.** `status = PAID`, `total = 2000`, `id present`. Never
  "body equals {...}".
- **Refusal steps assert the code and the message fragment** the server actually returns —
  copy it from a real response, don't paraphrase.
- **A verify step follows every refusal.** Step 5 proves the rejected request had no side
  effect; without it the 409 could mask a half-applied write.
- **Cleanup is declared** and runs in a finally block, through the API, with the captured id.
  If the API has no delete, the namespace prefix is the cleanup — say so in the spec.

## Flow selection checklist

For each resource in the state map:

| Ask | Yields |
|-----|--------|
| What is the longest happy path? | S1 lifecycle |
| For each transition, what state must it refuse from? | one refusal flow per transition |
| Who else could hold the id? | cross-user flow: other user → 404/403 |
| What does the entry endpoint reject? | input flow: empty, unknown reference, wrong type → 400 |
| What happens with no / bad token on each mutating route? | auth flow: 401 on each |

Skip a row only with a reason written in the spec directory's README ("no delete — retention
policy", "single-tenant — no cross-user").

## Naming and isolation

- Scenario id `S<n>` + one-line intent in the title.
- Namespace = `<scenario id>-<run id>` where run id is a timestamp or UUID fragment, applied to
  every user-visible string the scenario creates (names, emails, external refs). Two runs of the
  same suite must be able to overlap on one server.
- One actor per scenario unless the flow is about two actors; second actor is a second login,
  never a shared token.
