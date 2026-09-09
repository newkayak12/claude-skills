# S1 — order lifecycle (create → pay → verify)
Actor: fresh user   Namespace: s1-<run id>

| Step | Request | Capture | Assert |
|------|---------|---------|--------|
| 1 | POST /users {email: s1-<run id>@test.io, password: pw} | email | 201 |
| 2 | POST /auth/login {email, password} | token | 200, token present |
| 3 | POST /orders {items:[{sku:SKU-1,qty:2}]} · bearer token | order_id | 201, status = CREATED, total = 2000 |
| 4 | GET /orders/{order_id} · bearer token | — | 200, status = CREATED |
| 5 | POST /orders/{order_id}/pay · bearer token | — | 200, status = PAID |
| 6 | GET /orders/{order_id} · bearer token | — | 200, status = PAID |
Cleanup: DELETE /orders/{order_id} · bearer token (user has no delete — namespace is the cleanup)
