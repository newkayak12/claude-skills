#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cd "$TMP" || exit 1
CID=_tmp-barreg
rm -rf "cycles/$CID"; mkdir -p "cycles/$CID"; : > "cycles/$CID/bar.jsonl"
R="python3 $HERE/bar-register.py"
fail=0

$R register --cycle $CID --id B1 --criterion "gate2 정량 충족" --stage test --measure "self-test N/N" >/dev/null \
  && $R register --cycle $CID --id B2 --criterion "리뷰 지적 0" --stage close --measure "blackbox 0건" >/dev/null \
  && $R verify --cycle $CID >/dev/null \
  && $R list --cycle $CID >/dev/null \
  || { echo "FAIL: 기본 등록/verify/list"; fail=1; }

# 중복 id 거부 (exit != 0) — 바 낮추기 silent 경로 차단
if $R register --cycle $CID --id B1 --criterion "약하게 재정의" --stage test --measure "낮춘 바" >/dev/null 2>&1; then
  echo "FAIL: 중복 id B1 가 통과됨 (바 낮추기 차단 실패)"; fail=1
fi

rm -rf "cycles/$CID"
[ $fail -eq 0 ] && echo "bar-register self-test: PASS"
exit $fail
