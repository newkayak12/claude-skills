# S2 — 취소된 주문 결제 시도 (from scenarios.md › "취소된 주문 결제 시도")
Actor: fresh user   Namespace: s2-<run id>

| Step | Request | Capture | Assert |
|------|---------|---------|--------|
| 1 | POST /users {email: s2-<run id>@test.io, password: pw} (added: needed for auth) | — | 201 |
| 2 | POST /auth/login {email, password} (added: needed for auth) | token | 200 |
| 3 | POST /orders {items:[{sku:SKU-2,qty:2}]} · bearer token | order_id | 201, status = CREATED, total = 5000 |
| 4 | POST /orders/{order_id}/cancel · bearer token | — | 200, status = CANCELLED |
| 5 | POST /orders/{order_id}/pay · bearer token | — | [확인 필요: "막혀야 함" — send it, record the code and message] |
| 6 | GET /orders/{order_id} · bearer token | — | 200, status = CANCELLED (step 5 changed nothing) |
Cleanup: DELETE /orders/{order_id} · bearer token
