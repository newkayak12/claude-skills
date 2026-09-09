#!/usr/bin/env bash
# bench-director.sh <arm> <runs> [outdir]   arm ∈ noskill | 1.3.0 | 1.4.0 | <path to a develop plugin dir>
# Each run: fresh workspace = fixture server + README + scenarios.md; one `claude -p` director run; score.sh.
set -uo pipefail
source "$(dirname "$0")/lib.sh"
ARM=${1:?arm}; RUNS=${2:-2}; OUT=${3:-$EVALS_DIR/results/director-$ARM-$(date +%m%d-%H%M)}; mkdir -p "$OUT"
MODEL=${DIRECTOR_MODEL:-sonnet}
case "$ARM" in
  noskill) PLUG="" ;;
  1.4.0)   PLUG="--plugin-dir $REPO_DIR/develop" ;;
  1.3.0)   WT="$OUT/wt-1.3.0"; [ -d "$WT" ] || git -C "$REPO_DIR" worktree add -q "$WT" 18d1315; PLUG="--plugin-dir $WT/develop" ;;
  *)       PLUG="--plugin-dir $ARM" ;;
esac
PROMPT='이 백엔드(server.py, README.md)의 API 시나리오 테스트를 수립하고 실행해줘. QA가 쓴 scenarios.md도 있어. 서버는 BASE_URL 환경변수에 떠 있어. 산출물은 tests/ 아래에, 최종 리포트는 REPORT.md에 써줘.'
echo "arm=$ARM runs=$RUNS model=$MODEL out=$OUT"
for r in $(seq "$RUNS"); do
  W="$OUT/run$r"; mkdir -p "$W"; cp "$FIXTURE/server.py" "$FIXTURE/README.md" "$FIXTURE/scenarios.md" "$W/"
  P=$(free_port); start_server "$P" || exit 1; export BASE_URL="http://127.0.0.1:$P"
  t0=$(date +%s)
  # shellcheck disable=SC2086
  (cd "$W" && claude -p "$PROMPT" --model "$MODEL" --output-format json --no-session-persistence \
      --setting-sources project $PLUG --allowedTools Bash Read Write Edit Glob Grep Agent \
      > "$W/director.claude.json" 2> "$W/director.stderr")
  dur=$(( $(date +%s) - t0 )); cost=$(jget "$W/director.claude.json" total_cost_usd)
  stop_server
  # score: static + executed (needs the 1.4.0 actor skill to re-run ci.sh; noskill/1.3.0 arms have no ci.sh → executed criteria 0)
  (cd "$W" && "$EVALS_DIR/score.sh" "$W" "$P") > "$W/score.txt" 2>&1
  printf 'run %s: %s  cost=%s  %ss\n' "$r" "$(grep TOTAL "$W/score.txt")" "$cost" "$dur" | tee -a "$OUT/table.txt"
  grep -v TOTAL "$W/score.txt" | tr '\n' ' ' | tee -a "$OUT/table.txt"; echo | tee -a "$OUT/table.txt"
done
