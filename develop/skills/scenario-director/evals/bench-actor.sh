#!/usr/bin/env bash
# bench-actor.sh <model> <runs> [outdir] — actor reliability at CI level.
# Each run: fresh copies of fixture/specs → ci.sh vs healthy server, then ci.sh vs --bug server.
# Prints one row per run and per-run detail files under outdir.
set -uo pipefail
source "$(dirname "$0")/lib.sh"
MODEL=${1:?model}; RUNS=${2:-3}; OUT=${3:-$EVALS_DIR/results/actor-$MODEL-$(date +%m%d-%H%M)}; mkdir -p "$OUT"
export CLAUDE_ARGS="--setting-sources project --plugin-dir $REPO_DIR/develop"
export ACTOR_MODEL=$MODEL ACTOR_PARALLEL=4
echo "model=$MODEL runs=$RUNS out=$OUT"
printf '%-4s %-8s %-9s %-9s %-9s %-9s %-7s %-6s\n' run healthy S2probed S3docs404 bugCaught falsePass cost sec
for r in $(seq "$RUNS"); do
  W="$OUT/run$r"; mkdir -p "$W/tests/scenarios"; cp "$FIXTURE"/specs/*.spec.md "$W/tests/scenarios/"; extract_ci "$W/tests/scenarios/ci.sh"
  P=$(free_port); start_server "$P" || exit 1; export BASE_URL="http://127.0.0.1:$P"
  t0=$(date +%s)
  (cd "$W" && SCENARIO_RESULTS="$W/tests/scenarios/results" tests/scenarios/ci.sh > "$W/healthy.out" 2>&1); healthy=$(grep -o 'Run: [0-9]* passed, [0-9]* failed' "$W/healthy.out" | sed 's/Run: //;s/ passed, /\//;s/ failed//')
  stop_server
  # traps
  s2probed=$(grep -c '409.*(probed)' "$W/tests/scenarios/s2_pay_after_cancel.spec.md")
  s3docs=$( { grep -q '404' "$W/tests/scenarios/s3_other_users_order.spec.md" && grep -q 'server 404\|probed' "$W/tests/scenarios/s3_other_users_order.spec.md"; } && echo 1 || echo 0)
  # mutation: same (now probed) specs vs --bug server
  P=$(free_port); start_server "$P" --bug || exit 1; export BASE_URL="http://127.0.0.1:$P"
  (cd "$W" && SCENARIO_RESULTS="$W/tests/scenarios/results-bug" tests/scenarios/ci.sh > "$W/bug.out" 2>&1)
  stop_server
  bug=$(grep -E '^\s+S2\s+fail_server' "$W/bug.out" >/dev/null && echo 1 || echo 0)
  falsepass=$(grep -E '^\s+S2\s+pass' "$W/bug.out" >/dev/null && echo 1 || echo 0)
  cost=$(python3 - "$W" <<'PY'
import glob,json,sys
c=0
for f in glob.glob(sys.argv[1]+"/tests/scenarios/results*/*.claude.json"):
    try: c+=json.load(open(f)).get("total_cost_usd",0) or 0
    except Exception: pass
print(f"{c:.2f}")
PY
)
  printf '%-4s %-8s %-9s %-9s %-9s %-9s %-7s %-6s\n' "$r" "${healthy:-ERR}" "$s2probed" "$s3docs" "$bug" "$falsepass" "$cost" "$(( $(date +%s) - t0 ))" | tee -a "$OUT/table.txt"
done
