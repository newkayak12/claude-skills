#!/usr/bin/env bash
# smoke.sh — verifies the fixture's two traps. Exit 1 on any mismatch.
set -uo pipefail
cd "$(dirname "$0")"
PORT=${1:-8799}; fail=0
chk(){ [ "$2" = "$3" ] && echo "ok   $1 -> $2" || { echo "FAIL $1 -> got $2 want $3"; fail=1; }; }
code(){ curl -sS -o /dev/null -w '%{http_code}' "$@"; }
start(){ python3 server.py "$PORT" $1 >/dev/null 2>&1 & PID=$!; for i in 1 2 3 4 5 6 7 8 9 10; do curl -s "http://127.0.0.1:$PORT/" >/dev/null 2>&1 && break; sleep 0.2; done; }
stop(){ kill $PID 2>/dev/null; wait $PID 2>/dev/null; }
B="http://127.0.0.1:$PORT"; J='-H Content-Type:application/json'
flow(){ # registers a fresh user, creates + cancels an order, sets TOK/OID
  E="smoke-$RANDOM@test.io"
  curl -sS -o /dev/null $J -d "{\"email\":\"$E\",\"password\":\"pw\"}" "$B/users"
  TOK=$(curl -sS $J -d "{\"email\":\"$E\",\"password\":\"pw\"}" "$B/auth/login" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
  OID=$(curl -sS $J -H "Authorization: Bearer $TOK" -d '{"items":[{"sku":"SKU-1","qty":1}]}' "$B/orders" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
  curl -sS -o /dev/null -X POST -H "Authorization: Bearer $TOK" "$B/orders/$OID/cancel"
}
start ""; flow
chk "healthy: pay from CANCELLED"    "$(code -X POST -H "Authorization: Bearer $TOK" "$B/orders/$OID/pay")" 409
BOB=$(curl -sS $J -d '{"email":"bob@test.io","password":"pw-bob"}' "$B/auth/login" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
chk "healthy: bob reads alice-like order (docs say 403)" "$(code -H "Authorization: Bearer $BOB" "$B/orders/$OID")" 404
stop
start "--bug"; flow
chk "--bug: pay from CANCELLED"      "$(code -X POST -H "Authorization: Bearer $TOK" "$B/orders/$OID/pay")" 200
stop
exit $fail
