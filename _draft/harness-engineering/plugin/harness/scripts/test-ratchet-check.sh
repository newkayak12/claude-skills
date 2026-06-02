#!/usr/bin/env bash
# 완전 hermetic — tmp cwd 에 합성 cycles/ 를 만들어 실제 cycles 를 건드리지 않는다.
# (실제 active 사이클이 있어도 SKIP 없이 항상 본문 실행 — #007 close-runtime 사각 해소)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BR="python3 $HERE/bar-register.py"
RR="python3 $HERE/review-register.py"
RC="python3 $HERE/ratchet-check.py"
CC="python3 $HERE/close-cycle.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP" || exit 1
mkdir -p cycles
fail=0

mk_axis_cycle() {  # $1=cid $2=axis $3=value $4=direction  (열린 상태, B1 1개)
  local cid="$1"
  rm -rf "cycles/$cid"; mkdir -p "cycles/$cid"
  : > "cycles/$cid/bar.jsonl"; : > "cycles/$cid/review.jsonl"
  $BR register --cycle "$cid" --id B1 --stage test --criterion c --measure m \
      --axis "$2" --value "$3" --direction "$4" >/dev/null
}

# prior: coverage>=80 (higher_better), pass 리뷰 결박 + closed
mk_axis_cycle 20260101-prior coverage 80 higher_better
$RR register --cycle 20260101-prior --id R1 --criterion-id B1 --verdict pass \
    --evidence e --reviewer t >/dev/null
printf '{"cycle_id":"20260101-prior","status":"closed"}\n' > cycles/20260101-prior/metrics.json

# floor 가 coverage=80 노출
$RC floor 2>/dev/null | grep -q 'coverage.*80' || { echo "FAIL floor: coverage 80 미노출"; fail=1; }

# 1) 회귀 70<80 → check exit 2
mk_axis_cycle _cur coverage 70 higher_better
if $RC check --cycle _cur >/dev/null 2>&1; then echo "FAIL 1: 회귀(70<80) check 통과됨"; fail=1; fi

# 2) 동률 80=80 → exit 0 (단조 *비감소* 허용)
mk_axis_cycle _cur coverage 80 higher_better
$RC check --cycle _cur >/dev/null 2>&1 || { echo "FAIL 2: 동률(80) 차단됨"; fail=1; }

# 3) 개선 90>80 → exit 0
mk_axis_cycle _cur coverage 90 higher_better
$RC check --cycle _cur >/dev/null 2>&1 || { echo "FAIL 3: 개선(90) 차단됨"; fail=1; }

# 4) 미선언 축(latency) → coverage 검사 안 함 → exit 0 (오탐 0)
mk_axis_cycle _cur latency 100 lower_better
$RC check --cycle _cur >/dev/null 2>&1 || { echo "FAIL 4: 무관 축인데 false block"; fail=1; }

# 5) direction 뒤집기 (coverage 를 lower_better 로) → 차단 exit 2
mk_axis_cycle _cur coverage 999 lower_better
if $RC check --cycle _cur >/dev/null 2>&1; then echo "FAIL 5: direction 뒤집기 통과됨"; fail=1; fi

# 6) close 통합 — active cycle 이 회귀(70) → close exit 2 + symlink 보존
rm -rf cycles/_close; mkdir -p cycles/_close
: > cycles/_close/bar.jsonl; : > cycles/_close/review.jsonl; : > cycles/_close/blackbox.jsonl
printf '{"cycle_id":"_close","status":"active"}\n' > cycles/_close/metrics.json
$BR register --cycle _close --id B1 --stage test --criterion c --measure m \
    --axis coverage --value 70 --direction higher_better >/dev/null
$RR register --cycle _close --id R1 --criterion-id B1 --verdict pass --evidence e --reviewer t >/dev/null
ln -sfn _close cycles/active
if $CC >/dev/null 2>&1; then echo "FAIL 6: ratchet 회귀인데 close 됨"; fail=1; fi
[ -L cycles/active ] || { echo "FAIL 6: 차단인데 symlink 사라짐"; fail=1; }

# 7) 같은 축 더 나은 값(80) 추가 잠금 → best-of 로 floor 충족 → close exit 0
$BR register --cycle _close --id B2 --stage test --criterion c2 --measure m2 \
    --axis coverage --value 80 --direction higher_better >/dev/null
$RR register --cycle _close --id R2 --criterion-id B2 --verdict pass --evidence e --reviewer t >/dev/null
$CC >/dev/null 2>&1 || { echo "FAIL 7: 80 으로 올렸는데 close 안 됨"; fail=1; }
[ -L cycles/active ] && { echo "FAIL 7: 통과인데 symlink 남음"; fail=1; }

[ $fail -eq 0 ] && echo "ratchet-check self-test: PASS"
exit $fail
