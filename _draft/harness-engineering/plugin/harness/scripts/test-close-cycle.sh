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

rm -rf "$ROOT"; rm -f cycles/active
[ $fail -eq 0 ] && echo "close-cycle self-test: PASS"
exit $fail
