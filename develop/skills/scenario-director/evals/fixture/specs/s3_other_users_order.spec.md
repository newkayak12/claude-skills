# S3 — 남의 주문 (from scenarios.md › "남의 주문")
Actors: owner = fresh user, other = bob@test.io (seed)   Namespace: s3-<run id>

| Step | Request | Capture | Assert |
|------|---------|---------|--------|
| 1 | POST /users {email: s3-<run id>@test.io, password: pw} (added) | — | 201 |
| 2 | POST /auth/login {owner} (added) | owner_token | 200 |
| 3 | POST /orders {items:[{sku:SKU-1,qty:1}]} · bearer owner_token | order_id | 201, status = CREATED |
| 4 | POST /auth/login {bob@test.io, pw-bob} (added: second actor) | bob_token | 200 |
| 5 | GET /orders/{order_id} · bearer bob_token | — | [확인 필요: docs say 403 — "안 보여야 함"] |
| 6 | POST /orders/{order_id}/pay · bearer bob_token | — | [확인 필요: docs say 403 — "안 됨"] |
| 7 | GET /orders/{order_id} · bearer owner_token | — | 200, status = CREATED (steps 5–6 changed nothing) |
Cleanup: DELETE /orders/{order_id} · bearer owner_token
