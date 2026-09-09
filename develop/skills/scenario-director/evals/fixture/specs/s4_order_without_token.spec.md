# S4 — 로그인 안 하고 주문 (from scenarios.md › "로그인 안 하고 주문")
Actor: none   Namespace: s4-<run id>

| Step | Request | Capture | Assert |
|------|---------|---------|--------|
| 1 | POST /orders {items:[{sku:SKU-1,qty:1}]} · no Authorization header | — | [확인 필요: "거부" — send it, record the code] |
| 2 | POST /orders {items:[{sku:SKU-1,qty:1}]} · Authorization: Bearer s4-<run id>-bogus | — | [확인 필요: bad token — send it, record the code] |
Cleanup: none — no resource is created when the request is refused (nothing to verify by GET: no list endpoint)
