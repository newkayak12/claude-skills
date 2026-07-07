#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../.." || exit 1   # repo 루트
H="python3 harness/hooks/phase-echo.py"
export HARNESS_HOME="$(mktemp -d)"
fail=0

# 실제 active 있으면 clobber 위험 — SKIP
if [ -L cycles/active ]; then echo "SKIP: 실제 active 존재"; rm -rf "$HARNESS_HOME"; exit 0; fi

CID=_tmp-phaseecho
rm -rf "cycles/$CID"; mkdir -p "cycles/$CID"
printf '{"current_phase":"design","phase_gates":{"design":{"type":"collaborative"}}}\n' > "cycles/$CID/metrics.json"
ln -sfn "$CID" cycles/active
SID='{"session_id":"s1"}'

# 1) 첫 호출(design) → 주입(현 phase 언급)
out=$(echo "$SID" | $H)
echo "$out" | grep -qi "design" || { echo "FAIL: 첫 주입에 design 없음"; fail=1; }

# 2) 같은 phase 재호출 → no-op (무출력)
out=$(echo "$SID" | $H)
[ -z "$out" ] || { echo "FAIL: 동일 phase 인데 재주입됨"; fail=1; }

# 3) phase 변경(planning) → 다시 주입
printf '{"current_phase":"planning","phase_gates":{"planning":{"type":"collaborative"}}}\n' > "cycles/$CID/metrics.json"
out=$(echo "$SID" | $H)
echo "$out" | grep -qi "planning" || { echo "FAIL: phase 변경인데 주입 안 됨"; fail=1; }

# 4) 깨진 JSON → fail-open (무출력, exit 0)
echo 'not json' | $H >/dev/null 2>&1 || { echo "FAIL: 깨진 JSON 에서 비-0 exit"; fail=1; }

# 5) active 없음 → no-op
rm -f cycles/active
out=$(echo "$SID" | $H)
[ -z "$out" ] || { echo "FAIL: active 없는데 출력함"; fail=1; }

rm -rf "cycles/$CID" "$HARNESS_HOME"
[ $fail -eq 0 ] && echo "phase-echo self-test: PASS"
exit $fail
