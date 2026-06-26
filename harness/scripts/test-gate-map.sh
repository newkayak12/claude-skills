#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../.." || exit 1   # repo 루트
G="python3 harness/scripts/gate-map.py"
fail=0

# 1) 전부 채움 + product → 누락 0
out=$($G --type product --a "users can't X" --b "fits prior" --c "2주, kill=no signal" --d "5 interviews" --e "real motive") || { echo "FAIL: 정상 실행"; fail=1; }
echo "$out" | grep -q "MISSING: none" || { echo "FAIL: 누락 없어야 함"; fail=1; }

# 2) C 의 Kill 누락 + exploration → defer 허용
out=$($G --type exploration --a "learn X" --c "2주 time budget")
echo "$out" | grep -qi "defer" || { echo "FAIL: exploration kill defer 안내 없음"; fail=1; }

# 3) C 의 Kill 누락 + product → STOP
out=$($G --type product --a "users can't X" --c "2주 time budget")
echo "$out" | grep -qi "STOP" || { echo "FAIL: product kill 누락인데 STOP 아님"; fail=1; }

# 4) A 누락 → ask-missing 에 A 포함
out=$($G --type product --b "fits" --c "2주, kill=x" --d "5 interviews" --e "motive")
echo "$out" | grep -q "A\." || { echo "FAIL: 누락 A 질문 안 나옴"; fail=1; }

[ $fail -eq 0 ] && echo "gate-map self-test: PASS"
exit $fail
