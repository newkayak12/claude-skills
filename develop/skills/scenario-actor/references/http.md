# HTTP by hand — shapes the actor uses

The actor is the runner. These are the three shapes it repeats: a curl call that yields code and
body, a log line per pair, and the result JSON the director and CI read. No test framework.

## curl

```bash
: "${BASE_URL:?}"                                   # never a literal host in a command
RUN="s2-$(date +%s%N | tail -c 7)"                  # namespace for every created string
R="${SCENARIO_RESULTS:-tests/scenarios/results}"; mkdir -p "$R"; LOG="$R/s2.log"; : > "$LOG"

# one request → CODE, BODY, MS
t0=$(date +%s%N)
out=$(curl -sS -X POST "$BASE_URL/orders" \
      -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
      -d '{"items":[{"sku":"SKU-1","qty":1}]}' -w '\n%{http_code}')
CODE=${out##*$'\n'}; BODY=${out%$'\n'*}; MS=$(( ($(date +%s%N) - t0) / 1000000 ))

# capture a field (python3 is everywhere jq isn't)
ORDER=$(printf '%s' "$BODY" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
```

Assert by comparing `CODE` and one field at a time; for a refusal also check the body contains
the message fragment. Print the pair on a mismatch — the pair is the evidence.

## Log line (one pair per step, appended as you go)

```
[S2 step 3] POST /orders body={"items":[{"sku":"SKU-1","qty":1}]} auth=Bearer **** (5ms)
  -> 201 {"id":"c91e","status":"CREATED","total":1000}
```

Rules: tokens, passwords, cookies masked as `****` (`sed 's/Bearer [^" ]*/Bearer ****/g'`);
body truncated at 500 chars; probes logged as `[S2 probe step 5]`; cleanup as `[S2 cleanup]`.

## Result JSON — `results/s<n>.json`

```json
{
  "id": "S2",
  "flow": "pay twice is refused",
  "status": "pass",
  "steps": [
    {"n": 1, "method": "POST", "path": "/users", "code": 201, "ms": 4},
    {"n": 5, "method": "POST", "path": "/orders/c91e/pay", "code": 409, "ms": 3}
  ],
  "probed": [{"step": 5, "code": 409, "message": "cannot pay from PAID"}],
  "docs_mismatch": [{"step": 3, "docs": 403, "server": 404}],
  "cleanup": "DELETE /orders/c91e -> 204",
  "verdict": "",
  "duration_ms": 41
}
```

`status` ∈ `pass` · `fail_spec` (spec was wrong and the one re-run still failed) · `fail_server`
(server violates the rule, or 5xx, or a refusal had a side effect). `verdict` holds the rule and
the deciding step for a failure, or the cleanup note when the API has no delete. `probed` and
`docs_mismatch` may be empty arrays, never absent. `steps` lists every step actually sent.

## JUnit mapping (done by `ci.sh`, not the actor)

One `<testcase name="S2 pay twice is refused" time="0.041">` per JSON; `fail_*` becomes
`<failure message="fail_server: <verdict>">` with the log's tail as text.
