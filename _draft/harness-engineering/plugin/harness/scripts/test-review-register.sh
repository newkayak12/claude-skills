#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cd "$TMP" || exit 1
CID=_tmp-reviewreg
rm -rf "cycles/$CID"; mkdir -p "cycles/$CID"; : > "cycles/$CID/bar.jsonl"
BR="python3 $HERE/bar-register.py"
RR="python3 $HERE/review-register.py"
fail=0

# 바 2개 등록 (리뷰 대상)
$BR register --cycle $CID --id B1 --criterion "c1" --stage test  --measure "m1" >/dev/null
$BR register --cycle $CID --id B2 --criterion "c2" --stage close --measure "m2" >/dev/null

# 1) 정상 등록(bar-hash 자동 해소) + verify + list
$RR register --cycle $CID --id R1 --criterion-id B1 --verdict pass \
   --evidence "self-test" --reviewer "subagent:test" >/dev/null \
  && $RR verify --cycle $CID >/dev/null \
  && $RR list --cycle $CID >/dev/null \
  || { echo "FAIL: 정상 등록/verify/list"; fail=1; }

# 2) 존재하지 않는 criterion-id 거부 (exit != 0)
if $RR register --cycle $CID --id RX --criterion-id BX --verdict pass \
     --evidence x --reviewer y >/dev/null 2>&1; then
  echo "FAIL: 없는 criterion-id 가 통과됨"; fail=1
fi

# 3) bar_hash 결박 — review.bar_hash == bar[B1].hash
BH=$(python3 -c "import json;print([json.loads(l)['hash'] for l in open('cycles/$CID/bar.jsonl') if l.strip() and json.loads(l)['id']=='B1'][0])")
RH=$(python3 -c "import json;print([json.loads(l)['bar_hash'] for l in open('cycles/$CID/review.jsonl') if l.strip() and json.loads(l)['criterion_id']=='B1'][0])")
[ "$BH" = "$RH" ] || { echo "FAIL: bar_hash 결박 불일치"; fail=1; }

rm -rf "cycles/$CID"
[ $fail -eq 0 ] && echo "review-register self-test: PASS"
exit $fail
