#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cd "$TMP" || exit 1
CID=_tmp-close
ROOT="cycles/$CID"
BR="python3 $HERE/bar-register.py"
RR="python3 $HERE/review-register.py"
CC="python3 $HERE/close-cycle.py"

setup() {
  rm -rf "$ROOT"; mkdir -p "$ROOT"
  : > "$ROOT/bar.jsonl"; : > "$ROOT/review.jsonl"; : > "$ROOT/blackbox.jsonl"
  printf '{"cycle_id":"%s","status":"active"}\n' "$CID" > "$ROOT/metrics.json"
  ln -sfn "$CID" cycles/active
}
fail=0

# A: 바 있고 리뷰 없음 → 차단(exit 2), symlink 보존
setup
$BR register --cycle $CID --id B1 --criterion c1 --stage test --measure m1 >/dev/null
if $CC >/dev/null 2>&1; then echo "FAIL A: 리뷰 없는데 close 됨"; fail=1; fi
[ -L cycles/active ] || { echo "FAIL A: symlink 사라짐"; fail=1; }

# B: pass 리뷰 등록 → 통과(exit 0), symlink 해제, metrics closed
$RR register --cycle $CID --id R1 --criterion-id B1 --verdict pass --evidence ok --reviewer t >/dev/null
$CC >/dev/null 2>&1 || { echo "FAIL B: 충족했는데 close 안 됨"; fail=1; }
[ -L cycles/active ] && { echo "FAIL B: symlink 남아있음"; fail=1; }
grep -q '"status": "closed"' "$ROOT/metrics.json" || { echo "FAIL B: metrics status!=closed"; fail=1; }

# C: 바 없음 → 차단(exit 2)
setup
if $CC >/dev/null 2>&1; then echo "FAIL C: 바 없는데 close 됨"; fail=1; fi

# D: --force 인데 --adr 없음 → 차단(exit 2), symlink 보존 (게이트 우회는 ADR 결박 필수)
setup
$BR register --cycle $CID --id B1 --criterion c1 --stage test --measure m1 >/dev/null
if $CC --force >/dev/null 2>&1; then echo "FAIL D: --adr 없는 --force 가 close 됨"; fail=1; fi
[ -L cycles/active ] || { echo "FAIL D: 차단인데 symlink 사라짐"; fail=1; }

# E: --force --adr <존재파일> → close(exit 0) + blackbox 에 force-close 기록(adr 결박)
echo "bypass rationale" > "$TMP/adr.md"
$CC --force --adr "$TMP/adr.md" >/dev/null 2>&1 || { echo "FAIL E: --force --adr 인데 close 안 됨"; fail=1; }
[ -L cycles/active ] && { echo "FAIL E: force-close 후 symlink 남음"; fail=1; }
grep -q '"kind": "force-close"' "$ROOT/blackbox.jsonl" || { echo "FAIL E: blackbox force-close 미기록"; fail=1; }
grep -q 'adr.md' "$ROOT/blackbox.jsonl" || { echo "FAIL E: blackbox adr 경로 미기록"; fail=1; }

rm -rf "$ROOT"; rm -f cycles/active
[ $fail -eq 0 ] && echo "close-cycle self-test: PASS"
exit $fail
