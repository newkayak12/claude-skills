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

## Normalizing a hand-written scenario

People write flows as prose or loose lists. Convert, don't reject:

```
사용자가 쓴 것:
  주문 결제 두 번
  - 앨리스로 로그인
  - SKU-1 하나 주문
  - 결제
  - 결제 다시 → 실패해야 함
  - 주문 조회하면 여전히 PAID

스펙으로:
  # S2 — 주문 결제 두 번 (from scenarios.md › "주문 결제 두 번")
  | 1 | POST /auth/login {alice} | token | 200 |
  | 2 | POST /orders {SKU-1 ×1} | order_id | 201, status = CREATED |
  | 3 | POST /orders/{order_id}/pay | — | 200, status = PAID |
  | 4 | POST /orders/{order_id}/pay | — | [확인 필요: 상태 코드] — send it, record what comes back |
  | 5 | GET /orders/{order_id} | — | 200, status = PAID |
```

Rules: the person's title stays; each of their lines becomes at least one row; "실패해야 함" with
no code becomes `[확인 필요]` resolved by sending the request once and recording the real status
and message; a step they skipped (login before "주문") is added and marked `(added: needed for
auth)`; anything the routes don't have is a question back, not an invented endpoint.

## Catalog

`tests/scenarios/CATALOG.md` is the inventory; every flow gets a row when it is found, not when
it is implemented.

```markdown
| # | Flow | Source | Spec | Runner | Last run |
|---|------|--------|------|--------|----------|
| S1 | order lifecycle | generated (state map) | ✓ | ✓ | pass 2026-09-03 |
| S2 | pay twice refused | generated | ✓ | ✓ | pass |
| S7 | refund after partial ship | incident #212 | ✓ | — | — |
| S8 | checkout as seen in prod logs | access log 09-01, 1.2k sessions | — | — | — |
```

A converted collection keeps its origin ("Postman: Orders.postman_collection.json › Pay flow")
so the person who maintains it can find the row. A flow from a log names the sample.

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
