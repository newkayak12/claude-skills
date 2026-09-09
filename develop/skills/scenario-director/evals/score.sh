#!/usr/bin/env bash
# score.sh <workdir> <port-used-in-run> — 12 criteria on what a director run left behind.
# Static (9): spec · ci_env · no_hardcode · cleanup · namespace · run_twice · no_mock · no_runner_code · docs_not_copied
# Executed (3, skip with SCORE_EXECUTE=0): executed · mutation_caught · pairs
set -uo pipefail
source "$(dirname "$0")/lib.sh"
D=$1; P=${2:-0}; T=$D/tests/scenarios; pass=0
c(){ echo "$1:$2"; pass=$((pass+$2)); }
specs(){ find "$T" -maxdepth 1 -name 's*.spec.md' 2>/dev/null; }
code(){ find "$D/tests" \( -name '*.py' -o -name '*.kt' -o -name '*.hurl' -o -name '*.ts' -o -name '*.js' -o -name '*.sh' \) -not -name ci.sh 2>/dev/null | grep -v __pycache__; }
nspec=$(specs | wc -l | tr -d ' ')
c spec           $([ "$nspec" -ge 1 ] && echo 1 || echo 0)
c ci_env         $([ -f "$T/ci.sh" ] && grep -q 'BASE_URL' "$T/ci.sh" && echo 1 || echo 0)
c no_hardcode    $([ $(cat "$T"/ci.sh $(specs) 2>/dev/null | grep -c "localhost:$P\|127.0.0.1:$P") -eq 0 ] && echo 1 || echo 0)
c cleanup        $([ "$nspec" -ge 1 ] && [ $(specs | xargs grep -L '^Cleanup:' 2>/dev/null | wc -l) -eq 0 ] && echo 1 || echo 0)
c namespace      $([ "$nspec" -ge 1 ] && [ $(specs | xargs grep -Li 'namespace' 2>/dev/null | wc -l) -eq 0 ] && echo 1 || echo 0)
c run_twice      $(grep -qiE 'run 1.*[0-9]+ passed' "$D/REPORT.md" 2>/dev/null && grep -qiE 'run 2.*[0-9]+ passed' "$D/REPORT.md" && echo 1 || echo 0)
c no_mock        $([ $(grep -rl 'mock\|Mock' "$D/tests" 2>/dev/null | wc -l) -eq 0 ] && echo 1 || echo 0)
c no_runner_code $([ $(code | wc -l) -eq 0 ] && echo 1 || echo 0)
# README says 403 for another user's order; the server returns 404. Copying the docs = 0.
has404=$(specs | xargs grep -l '404' 2>/dev/null | wc -l | tr -d ' ')
bare403=$(specs | xargs grep -l '403' 2>/dev/null | xargs -r grep -L 'server 404\|probed' 2>/dev/null | wc -l | tr -d ' ')
c docs_not_copied $([ "$has404" -ge 1 ] && [ "$bare403" -eq 0 ] && echo 1 || echo 0)
if [ "${SCORE_EXECUTE:-1}" = 1 ] && [ -f "$T/ci.sh" ] && [ "$nspec" -ge 1 ]; then
  export CLAUDE_ARGS="${CLAUDE_ARGS:---setting-sources project --plugin-dir $REPO_DIR/develop}" ACTOR_MODEL="${ACTOR_MODEL:-haiku}"
  SP=$(free_port); start_server "$SP"; BASE_URL="http://127.0.0.1:$SP" SCENARIO_RESULTS="$D/score-results" "$T/ci.sh" > "$D/score-healthy.out" 2>&1; ex=$?; stop_server
  c executed       $([ $ex -eq 0 ] && grep -q 'Run: [0-9]* passed, 0 failed' "$D/score-healthy.out" && echo 1 || echo 0)
  SP=$(free_port); start_server "$SP" --bug; BASE_URL="http://127.0.0.1:$SP" SCENARIO_RESULTS="$D/score-results-bug" "$T/ci.sh" > "$D/score-bug.out" 2>&1; stop_server
  c mutation_caught $(grep -q 'fail_server' "$D/score-bug.out" && echo 1 || echo 0)
  c pairs          $(python3 - "$D/score-results" "$nspec" <<'PY'
import glob,json,os,sys
d,n=sys.argv[1],int(sys.argv[2]); js=[f for f in glob.glob(d+"/s*.json") if not f.endswith(".claude.json")]
ok = len(js)>=n and all(len(json.load(open(f)).get("steps",[]))>=1 and os.path.exists(f[:-5]+".log") and "->" in open(f[:-5]+".log").read() for f in js)
print(1 if ok else 0)
PY
)
else
  for k in executed mutation_caught pairs; do c $k 0; done
fi
echo "TOTAL:$pass/12"
