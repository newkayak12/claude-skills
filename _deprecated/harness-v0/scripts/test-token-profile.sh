#!/usr/bin/env bash
# test-token-profile.sh — inject-tokens 측정의 *결정론*과 *축 신뢰성 문서화*를 검증.
# (#008 ratchet lock 의 전제: 잠그는 값이 결정론적이어야 floor 가 거짓 정밀도로 안 돈다 — rank0)
# token-profile.py 자체가 hermetic export 로 자급자족하므로 별도 fixture 불필요.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TP="python3 $HERE/token-profile.py"
SRC="$HERE/token-profile.py"
fail=0

# 1) 결정론 — --baseline 2회 연속 동일값 (ratchet 회귀판정의 신뢰원)
v1="$($TP --baseline 2>/dev/null)"
v2="$($TP --baseline 2>/dev/null)"
if [ -z "$v1" ] || ! [[ "$v1" =~ ^[0-9]+$ ]]; then
  echo "FAIL 1a: --baseline 가 정수 아님 ('$v1')"; fail=1
fi
if [ "$v1" != "$v2" ]; then
  echo "FAIL 1b: --baseline 비결정론 ($v1 != $v2)"; fail=1
fi

# 2) 단조성/상대축 문서화 — lock 의 근거가 docstring 에 명시돼야(GP-4 self-stale 방지)
grep -q "상대 ratchet 축" "$SRC" || { echo "FAIL 2a: docstring 에 '상대 ratchet 축' 명시 없음"; fail=1; }
grep -q "단조" "$SRC"          || { echo "FAIL 2b: docstring 에 '단조'(monotonic) 명시 없음"; fail=1; }
grep -q "결정론" "$SRC"        || { echo "FAIL 2c: docstring 에 '결정론'(deterministic) 명시 없음"; fail=1; }

# 3) 실토크나이저를 *안 쓰는* 이유가 명시돼야(다음 사이클이 같은 권고를 재제기하지 않도록)
grep -q "실토크나이저" "$SRC" || { echo "FAIL 3: 실토크나이저 비채택 근거 문서화 없음"; fail=1; }

if [ "$fail" = 0 ]; then
  echo "PASS test-token-profile.sh — baseline=$v1 (결정론) · 축 신뢰성 문서화 확인"
else
  echo "FAILED ($fail)"
fi
exit $fail
