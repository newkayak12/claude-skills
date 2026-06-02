#!/usr/bin/env bash
# test-gc-scan.sh — 엔트로피 스캐너 hermetic self-test (#011).
#   거짓음성 0: planted dead-link + relic-dir + dup-parser 를 정확히 탐지
#   거짓양성 0: 코드스팬 안 ](...)·실존 링크·clean fixture 는 안 잡음
#   fixpoint: high-confidence 제거 후 --high-confidence-only exit 0
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCAN="$HERE/gc-scan.py"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $1"; exit 1; }

# ---- 합성 fixture ----
P="$TMP/proj"; mkdir -p "$P/plugin/harness/foo" "$P/plugin/harness/scripts" "$P/docs"
# GP-1 relic 후보: foo/ 는 README만, canonical plugin/harness/foo 에 코드
echo "x=1" > "$P/plugin/harness/foo/code.py"
echo "# foo readme" > "$P/foo_dummy" ; rm "$P/foo_dummy"
mkdir -p "$P/foo"; echo "# foo (relic 후보)" > "$P/foo/README.md"
# GP-2: live 문서에 dead link + 실존 link + 코드스팬 안 가짜 link
echo "real" > "$P/docs/target.md"
cat > "$P/docs/doc.md" <<'MD'
# doc
- 살아있는 링크: [ok](./target.md)
- 죽은 링크: [bad](./nope.md)
- 코드스팬(무시돼야): `[x](./alsobad.md)` 는 네비 링크 아님
- 외부(무시): [site](https://example.com)
MD
# GP-3 dup-registry: l0-parser 두 멤버 존재 → watch
echo "def parse_l0(): pass" > "$P/plugin/harness/scripts/ruleslib.py"
echo "def parse_rules(): pass" > "$P/plugin/harness/scripts/rules-load.py"

# ========== 전체 리포트 ==========
OUT="$(python3 "$SCAN" --root "$P" 2>&1)" || fail "scan exit != 0"
# GP-2 거짓음성 0: nope.md 가 high 로 잡혀야
echo "$OUT" | grep -q "GP-2/high.*nope.md" || fail "dead link nope.md 미탐지(거짓음성)"
# GP-2 거짓양성 0: 코드스팬 안 alsobad.md 는 안 잡혀야
echo "$OUT" | grep -q "alsobad.md" && fail "코드스팬 안 링크가 잡힘(거짓양성 — _strip_code 회귀)"
# GP-2 거짓양성 0: 실존 target.md 는 안 잡혀야
echo "$OUT" | grep -q "target.md" && fail "실존 링크 target.md 가 dead 로 잡힘(거짓양성)"
# GP-1 은 watch 여야 (high 아님 — #011 강등 회귀 방지)
echo "$OUT" | grep -q "GP-1/watch.*foo/" || fail "relic 후보 foo/ 가 GP-1/watch 로 안 잡힘"
echo "$OUT" | grep -q "GP-1/high" && fail "GP-1 이 high 로 잡힘(#011 강등 회귀)"
# GP-3 dup-group watch (2 멤버)
echo "$OUT" | grep -q "GP-3/watch.*l0-parser" || fail "dup-group l0-parser watch 미탐지"

# ========== fixpoint 게이트 (B4 의 핵심: high 잔존 시 exit 2) ==========
if python3 "$SCAN" --root "$P" --high-confidence-only >/dev/null 2>&1; then
  fail "high-confidence(nope.md) 잔존인데 --high-confidence-only 가 exit 0 (게이트 무력)"
fi
# 죽은 링크 수선 → fixpoint 도달, exit 0
python3 - "$P/docs/doc.md" <<'PY'
import sys, re
p = sys.argv[1]
t = open(p, encoding="utf-8").read().replace("[bad](./nope.md)", "[fixed](./target.md)")
open(p, "w", encoding="utf-8").write(t)
PY
python3 "$SCAN" --root "$P" --high-confidence-only >/dev/null 2>&1 || fail "수선 후에도 fixpoint(exit 0) 미도달"

# ========== clean fixture: 엔트로피 0 ==========
C="$TMP/clean"; mkdir -p "$C/docs"; echo "ok" > "$C/docs/a.md"; echo "- [x](./a.md)" > "$C/docs/b.md"
CO="$(python3 "$SCAN" --root "$C" 2>&1)"
echo "$CO" | grep -q "high-confidence: 0" || fail "clean fixture 에서 high-confidence != 0(거짓양성)"
python3 "$SCAN" --root "$C" --high-confidence-only >/dev/null 2>&1 || fail "clean fixture fixpoint exit != 0"

echo "gc-scan self-test: PASS"
