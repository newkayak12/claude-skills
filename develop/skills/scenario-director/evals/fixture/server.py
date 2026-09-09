"""Tiny order API for scenario-test evals. stdlib only.
POST /users {email,password} -> 201 | 409 if email exists (no delete — retention)
POST /auth/login {email,password} -> {token}
POST /orders {items:[{sku,qty}]} -> 201 {id,status:"CREATED",total}
GET  /orders/{id} -> 200 | 404
POST /orders/{id}/pay -> 200 {status:"PAID"} | 409 if not CREATED  (--bug: also allowed from CANCELLED)
POST /orders/{id}/cancel -> 200 {status:"CANCELLED"} | 409 if PAID
DELETE /orders/{id} -> 204 (test cleanup)
All /orders require Authorization: Bearer <token>; orders are per-user (another user's id -> 404).
Run: python3 server.py [port] [--bug]   --bug plants a state-machine defect for mutation checks.
"""
import json, sys, uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

USERS = {"alice@test.io": "pw-alice", "bob@test.io": "pw-bob"}
PRICES = {"SKU-1": 1000, "SKU-2": 2500}
TOKENS, ORDERS = {}, {}
BUG = "--bug" in sys.argv  # eval mutation switch: pay allowed from CANCELLED

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body=None):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if body is not None: self.wfile.write(json.dumps(body).encode())
    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")
    def _user(self):
        a = self.headers.get("Authorization", "")
        return TOKENS.get(a[7:]) if a.startswith("Bearer ") else None
    def do_POST(self):
        p = self.path.rstrip("/").split("/")
        if self.path == "/users":
            b = self._body()
            if not b.get("email") or not b.get("password"): return self._send(400, {"error": "email and password required"})
            if b["email"] in USERS: return self._send(409, {"error": "email already registered"})
            USERS[b["email"]] = b["password"]; return self._send(201, {"email": b["email"]})
        if self.path == "/auth/login":
            b = self._body()
            if USERS.get(b.get("email")) != b.get("password"): return self._send(401, {"error": "bad credentials"})
            t = uuid.uuid4().hex; TOKENS[t] = b["email"]; return self._send(200, {"token": t})
        u = self._user()
        if not u: return self._send(401, {"error": "unauthorized"})
        if self.path == "/orders":
            b = self._body(); items = b.get("items") or []
            if not items: return self._send(400, {"error": "items required"})
            try: total = sum(PRICES[i["sku"]] * int(i["qty"]) for i in items)
            except (KeyError, TypeError, ValueError): return self._send(400, {"error": "unknown sku"})
            oid = uuid.uuid4().hex[:8]
            ORDERS[oid] = {"id": oid, "owner": u, "status": "CREATED", "total": total, "items": items}
            return self._send(201, {k: v for k, v in ORDERS[oid].items() if k != "owner"})
        if len(p) == 4 and p[1] == "orders" and p[3] in ("pay", "cancel"):
            o = ORDERS.get(p[2])
            if not o or o["owner"] != u: return self._send(404, {"error": "not found"})
            if p[3] == "pay":
                if o["status"] != "CREATED" and not (BUG and o["status"] == "CANCELLED"):
                    return self._send(409, {"error": f"cannot pay from {o['status']}"})
                o["status"] = "PAID"
            else:
                if o["status"] == "PAID": return self._send(409, {"error": "paid orders cannot be cancelled"})
                o["status"] = "CANCELLED"
            return self._send(200, {"id": o["id"], "status": o["status"]})
        self._send(404, {"error": "no route"})
    def do_GET(self):
        u = self._user()
        if not u: return self._send(401, {"error": "unauthorized"})
        p = self.path.rstrip("/").split("/")
        if len(p) == 3 and p[1] == "orders":
            o = ORDERS.get(p[2])
            if not o or o["owner"] != u: return self._send(404, {"error": "not found"})
            return self._send(200, {k: v for k, v in o.items() if k != "owner"})
        self._send(404, {"error": "no route"})
    def do_DELETE(self):
        u = self._user()
        if not u: return self._send(401, {"error": "unauthorized"})
        p = self.path.rstrip("/").split("/")
        if len(p) == 3 and p[1] == "orders" and p[2] in ORDERS and ORDERS[p[2]]["owner"] == u:
            del ORDERS[p[2]]; return self._send(204)
        self._send(404, {"error": "not found"})

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8765
    print(f"order-api on :{port}", flush=True)
    HTTPServer(("127.0.0.1", port), H).serve_forever()
