# Runners

Pick by what the repo already runs; add a stack only when there is none. Base URL, credentials,
and port come from environment variables in every runner — a literal `localhost:8080` in a test
is a finding.

| Repo has | Runner | Run |
|----------|--------|-----|
| Gradle/Maven, JUnit | RestAssured + JUnit 5 | `BASE_URL=… ./gradlew test --tests '*Scenario*'` |
| pytest | pytest + httpx | `BASE_URL=… pytest tests/scenarios -q` |
| Vitest/Jest | Vitest + `fetch` | `BASE_URL=… npx vitest run tests/scenarios` |
| none of the above | curl + bash (below) | `BASE_URL=… tests/scenarios/run.sh` |
| curl runner too slow to read | Hurl (needs the binary) | `hurl --variable base_url=… --test tests/scenarios/*.hurl` |

## curl + bash (the default when the repo has no test stack)

curl is on every machine the server is; nothing to install, and the log is the evidence. Three
files: `lib.sh` (helpers), one `s<n>_<flow>.sh` per scenario, `run.sh` (runs the set twice).

```bash
#!/usr/bin/env bash
# tests/scenarios/lib.sh — curl scenario runner helpers. Source from each s*.sh.
set -euo pipefail
: "${BASE_URL:?set BASE_URL, e.g. BASE_URL=http://localhost:8080}"
RUN_ID="${RUN_ID:-$(date +%s%N | tail -c 7)}"
_LOG="${SCENARIO_LOG:-/dev/null}"
_CLEANUP=()

# req METHOD PATH [JSON_BODY] [extra curl args...] -> sets $CODE and $BODY, logs the pair
req() {
  local m=$1 p=$2 body=${3:-}; shift; shift; [ $# -gt 0 ] && shift
  local out
  if [ -n "$body" ]; then
    out=$(curl -sS -X "$m" "$BASE_URL$p" -H 'Content-Type: application/json' -d "$body" "$@" -w '\n%{http_code}')
  else
    out=$(curl -sS -X "$m" "$BASE_URL$p" "$@" -w '\n%{http_code}')
  fi
  CODE=${out##*$'\n'}; BODY=${out%$'\n'*}
  printf '%s %s %s\n  -> %s %s\n' "$m" "$p" "$body" "$CODE" "$BODY" >> "$_LOG"
}
# json FIELD  -> value of a top-level field from $BODY (python3 is everywhere jq isn't)
json() { printf '%s' "$BODY" | python3 -c 'import sys,json;print(json.load(sys.stdin).get(sys.argv[1],""))' "$1"; }
# expect CODE [FIELD VALUE] -> fail the step with request/response evidence
expect() {
  local want=$1; shift
  if [ "$CODE" != "$want" ]; then echo "  FAIL step $STEP: expected $want, got $CODE  body=$BODY"; return 1; fi
  if [ $# -ge 2 ]; then local got; got=$(json "$1"); [ "$got" = "$2" ] || { echo "  FAIL step $STEP: $1 expected '$2', got '$got'  body=$BODY"; return 1; }; fi
}
contains() { case "$BODY" in *"$1"*) ;; *) echo "  FAIL step $STEP: body lacks '$1'  body=$BODY"; return 1;; esac; }
step() { STEP=$1; }
# defer "cmd" -> run at exit regardless of failure (cleanup through the API)
defer() { _CLEANUP+=("$1"); }
_run_cleanup() { local c; for c in "${_CLEANUP[@]:-}"; do [ -n "$c" ] && eval "$c" >/dev/null 2>&1 || true; done; }
trap _run_cleanup EXIT
```

```bash
#!/usr/bin/env bash
# S2 — pay twice is refused
source "$(dirname "$0")/lib.sh"
EMAIL="s2-$RUN_ID@test.io"
step 1; req POST /users "{\"email\":\"$EMAIL\",\"password\":\"pw\"}";        expect 201
step 2; req POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"pw\"}";   expect 200
TOKEN=$(json token); AUTH=(-H "Authorization: Bearer $TOKEN")
step 3; req POST /orders '{"items":[{"sku":"SKU-1","qty":1}]}' "${AUTH[@]}"; expect 201 status CREATED
ORDER=$(json id); defer "req DELETE /orders/$ORDER '' ${AUTH[*]@Q}"
step 4; req POST /orders/$ORDER/pay '' "${AUTH[@]}";                         expect 200 status PAID
step 5; req POST /orders/$ORDER/pay '' "${AUTH[@]}";                         expect 409; contains "cannot pay"
step 6; req GET  /orders/$ORDER '' "${AUTH[@]}";                             expect 200 status PAID
echo "PASS S2 pay twice is refused"
```

```bash
#!/usr/bin/env bash
# Runs every s*.sh twice against the same server; prints one summary line per run.
set -uo pipefail
cd "$(dirname "$0")"
for run in 1 2; do
  export RUN_ID="$(date +%s%N | tail -c 7)"; pass=0; fail=0
  for s in s*.sh; do if bash "$s"; then pass=$((pass+1)); else fail=$((fail+1)); echo "  ^ $s"; fi; done
  echo "Run $run ($RUN_ID): $pass passed, $fail failed"
done
```

What this shape guarantees: `req` records every request/response pair to `SCENARIO_LOG`; `expect`
fails a step with the body in the message; `defer` registers cleanup that runs on exit even after
a failed step (the `finally` Hurl lacks); `RUN_ID` namespaces every string the scenario creates and
changes between run 1 and run 2. Field access uses `python3 -c` because jq is not everywhere; swap
in `jq -r .field` when it is.

## pytest + httpx (the reference shape)

```python
# tests/scenarios/conftest.py
import os, uuid, httpx, pytest

BASE = os.environ["BASE_URL"]

@pytest.fixture
def run_id():
    return uuid.uuid4().hex[:6]

@pytest.fixture
def client():
    with httpx.Client(base_url=BASE, timeout=5) as c:
        yield c

def login(client, email, password):
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}
```

```python
# tests/scenarios/test_s2_pay_twice.py
from conftest import login

def test_s2_pay_twice_is_refused(client, run_id):
    h = login(client, "alice@test.io", "pw-alice")                       # step 1
    order_id = None
    try:
        r = client.post("/orders", json={"items": [{"sku": "SKU-1", "qty": 1}]}, headers=h)
        assert r.status_code == 201, r.text                               # step 2
        order_id = r.json()["id"]
        assert r.json()["status"] == "CREATED"

        r = client.post(f"/orders/{order_id}/pay", headers=h)
        assert (r.status_code, r.json()["status"]) == (200, "PAID"), r.text   # step 3

        r = client.post(f"/orders/{order_id}/pay", headers=h)
        assert r.status_code == 409, r.text                               # step 4
        assert "cannot pay" in r.json()["error"]

        r = client.get(f"/orders/{order_id}", headers=h)
        assert r.json()["status"] == "PAID"                               # step 5: no side effect
    finally:
        if order_id:
            client.delete(f"/orders/{order_id}", headers=h)
```

Every runner keeps this shape: login helper, capture into a local, assert with the response
text in the message, cleanup in `finally` with the captured id.

## RestAssured (JVM)

```kotlin
// src/test/kotlin/scenarios/S2PayTwiceScenarioTest.kt
class S2PayTwiceScenarioTest {
    private val base = System.getenv("BASE_URL") ?: error("BASE_URL not set")

    @Test
    fun `S2 pay twice is refused`() {
        val token = given().baseUri(base).contentType(JSON)
            .body("""{"email":"alice@test.io","password":"pw-alice"}""")
            .post("/auth/login").then().statusCode(200).extract().path<String>("token")
        val auth = given().baseUri(base).header("Authorization", "Bearer $token").contentType(JSON)

        val orderId = auth.body("""{"items":[{"sku":"SKU-1","qty":1}]}""")
            .post("/orders").then().statusCode(201).body("status", equalTo("CREATED"))
            .extract().path<String>("id")
        try {
            auth.post("/orders/$orderId/pay").then().statusCode(200).body("status", equalTo("PAID"))
            auth.post("/orders/$orderId/pay").then().statusCode(409).body("error", containsString("cannot pay"))
            auth.get("/orders/$orderId").then().body("status", equalTo("PAID"))
        } finally {
            auth.delete("/orders/$orderId")
        }
    }
}
```

## Hurl (alternative to curl when the binary is available)

```hurl
# tests/scenarios/s2_pay_twice.hurl
POST {{base_url}}/auth/login
{"email":"alice@test.io","password":"pw-alice"}
HTTP 200
[Captures]
token: jsonpath "$.token"

POST {{base_url}}/orders
Authorization: Bearer {{token}}
{"items":[{"sku":"SKU-1","qty":1}]}
HTTP 201
[Captures]
order_id: jsonpath "$.id"
[Asserts]
jsonpath "$.status" == "CREATED"

POST {{base_url}}/orders/{{order_id}}/pay
Authorization: Bearer {{token}}
HTTP 200

POST {{base_url}}/orders/{{order_id}}/pay
Authorization: Bearer {{token}}
HTTP 409
[Asserts]
jsonpath "$.error" contains "cannot pay"

GET {{base_url}}/orders/{{order_id}}
Authorization: Bearer {{token}}
HTTP 200
[Asserts]
jsonpath "$.status" == "PAID"

DELETE {{base_url}}/orders/{{order_id}}
Authorization: Bearer {{token}}
HTTP 204
```

Hurl has no `finally`; cleanup is the last entry and a failed assert stops before it. Use the
namespace prefix as the real cleanup and say so in the spec README.

## Running twice

```
BASE_URL=http://localhost:8080 pytest tests/scenarios -q   # run 1
BASE_URL=http://localhost:8080 pytest tests/scenarios -q   # run 2, same server process
```

Run 2 failing where run 1 passed means a scenario left state behind: a fixed email, a
non-namespaced name with a uniqueness constraint, a cleanup that didn't run. The fix is in the
namespace or the finally block, not in restarting the server before CI.
