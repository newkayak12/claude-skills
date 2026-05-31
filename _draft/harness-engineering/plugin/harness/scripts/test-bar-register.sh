#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../../.." || exit 1   # harness-engineering 루트로
CID=_tmp-barreg
rm -rf "cycles/$CID"; mkdir -p "cycles/$CID"; : > "cycles/$CID/bar.jsonl"
R="python3 plugin/harness/scripts/bar-register.py"
$R register --cycle $CID --id B1 --criterion "gate2 정량 충족" --stage test --measure "self-test N/N" \
  && $R register --cycle $CID --id B2 --criterion "리뷰 지적 0" --stage close --measure "blackbox 0건" \
  && $R verify --cycle $CID \
  && $R list --cycle $CID
rc=$?
rm -rf "cycles/$CID"
[ $rc -eq 0 ] && echo "bar-register self-test: PASS"
exit $rc
