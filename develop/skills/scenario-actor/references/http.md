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

## Headers, custom methods, XML, non-JSON bodies

Not every API is JSON over GET/POST. The same three shapes hold; only the capture changes.

```bash
# response headers → capture ETag (WebDAV/CalDAV, optimistic locking, Location on 201)
out=$(curl -sS -X PUT "$BASE_URL/calendars/$USER/default/$UID.ics" -u "$USER:$APP_PW" \
      -H 'Content-Type: text/calendar' --data-binary @event.ics \
      -D "$R/hdr.tmp" -w '\n%{http_code}')
CODE=${out##*$'\n'}; BODY=${out%$'\n'*}
ETAG=$(grep -i '^etag:' "$R/hdr.tmp" | cut -d' ' -f2- | tr -d '\r')       # capture: header ETag
LOCATION=$(grep -i '^location:' "$R/hdr.tmp" | cut -d' ' -f2- | tr -d '\r')

# custom method + request headers (PROPFIND / REPORT / MKCALENDAR, Depth, If-Match)
out=$(curl -sS -X PROPFIND "$BASE_URL/calendars/$USER/" -u "$USER:$APP_PW" -H 'Depth: 1' \
      -H 'Content-Type: application/xml' --data-binary '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>' \
      -w '\n%{http_code}')                                                   # expect 207

# XML field → capture (python3 xml.etree; namespaces by URI)
HREF=$(printf '%s' "$BODY" | python3 -c '
import sys, xml.etree.ElementTree as ET
ns={"d":"DAV:"}; r=ET.fromstring(sys.stdin.read())
print(r.find(".//d:response/d:href", ns).text)')                             # capture: xml //d:href

# non-JSON body assert: a fragment of text/calendar
case "$BODY" in *"UID:$UID"*) ;; *) echo "FAIL: ics lacks UID:$UID"; esac
```

Auth variants — the spec's `Auth:` line says which; the log masks all of them:

| Auth | curl | Masked in log as |
|------|------|------------------|
| bearer | `-H "Authorization: Bearer $TOKEN"` | `auth=Bearer ****` |
| basic (app password) | `-u "$USER:$APP_PW"` | `auth=Basic ****` |
| cookie session | login with `-c "$R/jar"`, then `-b "$R/jar"`; CSRF token captured from body/header and sent as the header the app names | `cookie=****` |
| API key header | `-H "X-Api-Key: $KEY"` | `x-api-key=****` |

A 207 is a success code for PROPFIND/REPORT; the per-resource status lives inside the XML
(`d:status`), so assert on that element, not only on the 207. A 412 on `If-Match` is the refusal to
test for ETag-guarded writes; the verify step is a GET showing the old body and the old ETag.

Assert by comparing `CODE` and one field at a time; for a refusal also check the body contains
the message fragment. Print the pair on a mismatch — the pair is the evidence.

## Log line (one pair per step, appended as you go)

```
[S2 step 3] POST /orders body={"items":[{"sku":"SKU-1","qty":1}]} auth=Bearer **** (5ms)
  -> 201 {"id":"c91e","status":"CREATED","total":1000}
```

Rules: secrets masked as `****` in both directions — the `Authorization` header (Bearer and Basic), `-u` credentials, cookie jars, API-key headers, and any
`password`, `token`, `access_token`, `refresh_token`, `secret`, `Set-Cookie` value in a request or
response body (`sed -E 's/("(password|token|access_token|refresh_token|secret)": *")[^"]*"/\1****"/g'`).
The captured value still goes into the next request; only the log is masked. Body truncated at
500 chars; probes logged as `[S2 probe step 5]`; cleanup as `[S2 cleanup]`.

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
