# order-api (fixture)
Run: `python3 server.py 8765` (stdlib only). Registration: POST /users (email unique, 409 on duplicate, no delete). Seed users: alice@test.io / pw-alice, bob@test.io / pw-bob. SKUs: SKU-1 (1000), SKU-2 (2500).
Routes: see docstring in server.py. Orders are per-user; state machine CREATED → PAID | CANCELLED; PAID cannot be cancelled.
Access rules: requests without a token → 401. Reading or mutating another user's order → 403 Forbidden.
