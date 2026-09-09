# CI entry point — `tests/scenarios/ci.sh`

The director writes this file once. It runs every spec through the `scenario-actor` skill with
`claude -p`, in parallel, merges the result JSONs into JUnit, and exits non-zero on any failure.
Locally the director runs it twice against one server process; CI runs it once per job.

Needs: `claude` on PATH (`npm i -g @anthropic-ai/claude-code`), `ANTHROPIC_API_KEY`, the
`develop` plugin installed (or `CLAUDE_ARGS="--plugin-dir /path/to/develop"`), `BASE_URL`.

```bash
#!/usr/bin/env bash
# tests/scenarios/ci.sh — run every s*.spec.md through the scenario-actor skill (claude -p).
# env: BASE_URL (required) · SCENARIO_RESULTS · ACTOR_MODEL (haiku) · ACTOR_PARALLEL (4)
#      ACTOR_BUDGET_USD (per spec, 1.00) · CLAUDE_ARGS (extra flags, e.g. --plugin-dir)
set -uo pipefail
cd "$(dirname "$0")"
: "${BASE_URL:?set BASE_URL, e.g. BASE_URL=http://localhost:8080}"
export BASE_URL SCENARIO_RESULTS="${SCENARIO_RESULTS:-$PWD/results}"
mkdir -p "$SCENARIO_RESULTS"
export ACTOR_MODEL="${ACTOR_MODEL:-haiku}" ACTOR_BUDGET_USD="${ACTOR_BUDGET_USD:-1.00}" CLAUDE_ARGS="${CLAUDE_ARGS:-}"
specs=(s*.spec.md); [ -e "${specs[0]}" ] || { echo "no s*.spec.md here"; exit 2; }

run_one() {
  local spec=$1 id lid
  id=$(echo "$spec" | sed -E 's/^(s[0-9]+)_.*/\1/' | tr a-z A-Z); lid=$(echo "$id" | tr A-Z a-z)
  rm -f "$SCENARIO_RESULTS/$lid.json"
  # shellcheck disable=SC2086
  claude -p "/develop:scenario-actor spec=$PWD/$spec BASE_URL=$BASE_URL results=$SCENARIO_RESULTS" \
    --model "$ACTOR_MODEL" --max-budget-usd "$ACTOR_BUDGET_USD" \
    --output-format json --no-session-persistence \
    --allowedTools Bash Read Write Edit $CLAUDE_ARGS \
    < /dev/null > "$SCENARIO_RESULTS/$lid.claude.json" 2> "$SCENARIO_RESULTS/$lid.stderr"
  [ -f "$SCENARIO_RESULTS/$lid.json" ] || printf '{"id":"%s","flow":"%s","status":"fail_server","steps":[],"probed":[],"docs_mismatch":[],"cleanup":"","verdict":"actor returned no result json (see %s.stderr)","duration_ms":0}\n' \
      "$id" "$spec" "$lid" > "$SCENARIO_RESULTS/$lid.json"
}
export -f run_one
printf '%s\n' "${specs[@]}" | xargs -P "${ACTOR_PARALLEL:-4}" -I{} bash -c 'run_one "$1"' _ {}

python3 - "$SCENARIO_RESULTS" <<'PY'
import glob, json, os, sys, xml.sax.saxutils as X
d = sys.argv[1]
rs = [json.load(open(f)) for f in sorted(glob.glob(f"{d}/s*.json")) if not f.endswith(".claude.json")]
cost = 0.0
for f in glob.glob(f"{d}/*.claude.json"):
    try: cost += json.load(open(f)).get("total_cost_usd", 0) or 0
    except Exception: pass
fails = [r for r in rs if r["status"] != "pass"]
tc = []
for r in rs:
    body = ""
    if r["status"] != "pass":
        log = f"{d}/{r['id'].lower()}.log"
        tail = open(log).read()[-2000:] if os.path.exists(log) else ""
        body = f'<failure message={X.quoteattr(r["status"] + ": " + r.get("verdict", ""))}>{X.escape(tail)}</failure>'
    tc.append(f'<testcase classname="scenarios" name={X.quoteattr(r["id"] + " " + r["flow"])} time="{r.get("duration_ms", 0) / 1000:.3f}">{body}</testcase>')
open(f"{d}/junit.xml", "w").write(f'<?xml version="1.0"?>\n<testsuite name="scenarios" tests="{len(rs)}" failures="{len(fails)}">\n' + "\n".join(tc) + "\n</testsuite>\n")
for r in rs:
    print(f'  {r["id"]:<4} {r["status"]:<12} {r["flow"]}' + (f'  ← {r["verdict"]}' if r["status"] != "pass" else ""))
print(f'Run: {len(rs) - len(fails)} passed, {len(fails)} failed  (actor cost ${cost:.2f}, {d}/junit.xml)')
sys.exit(1 if fails or not rs else 0)
PY
```

Two runs on one process (what the director does after the actors return):

```bash
BASE_URL=http://localhost:8080 tests/scenarios/ci.sh   # Run 1
BASE_URL=http://localhost:8080 tests/scenarios/ci.sh   # Run 2 — same numbers or it is a cleanup gap
```

## GitHub Actions

```yaml
# .github/workflows/scenarios.yml
name: scenarios
on: [pull_request]
jobs:
  scenarios:
    runs-on: ubuntu-latest
    env:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      BASE_URL: http://localhost:8080
      ACTOR_MODEL: haiku            # bench: haiku = sonnet on verdicts at half the cost; set sonnet for long flows
    steps:
      - uses: actions/checkout@v4
      - run: ./start-server.sh &          # whatever boots the API
      - run: for i in $(seq 30); do curl -sf "$BASE_URL/health" && break; sleep 1; done
      - run: npm i -g @anthropic-ai/claude-code && claude plugin marketplace add newkayak12/claude-skills && claude plugin install develop@newkayak12-claude-skills
      - run: tests/scenarios/ci.sh
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: scenario-results, path: tests/scenarios/results/ }
      - uses: mikepenz/action-junit-report@v4
        if: always()
        with: { report_paths: tests/scenarios/results/junit.xml }
```

`< /dev/null` matters: `claude -p` reads a prompt from stdin when stdin is not a terminal, so under
`xargs`, a CI step, or a nested Claude Code session it would otherwise wait for EOF forever.

Cost guard: `ACTOR_BUDGET_USD` caps each actor's spend (a capped actor writes no JSON, so `ci.sh`
records it as `fail_server` with a pointer to its stderr). A spec that blows a dollar is too long —
split the flow.
