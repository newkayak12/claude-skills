#!/usr/bin/env bash
# test-user-rules-init.sh — L1 user-rules 생성기 포맷 + 멱등 (B4).
# hermetic: HARNESS_HOME=tmp 로 실제 ~/.harness 오염 0.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
INIT="$HERE/user-rules-init.py"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HARNESS_HOME="$TMP/.harness"
RF="$HARNESS_HOME/user-rules.md"
fail() { echo "FAIL: $1"; exit 1; }

# --- 최초 생성 + frontmatter 포맷 ---
python3 "$INIT" init --lang "Python 3.12 / FastAPI" --pointer-python "pyproject.toml" --wip "1" \
  >/dev/null 2>&1 || fail "init exit != 0"
[ -f "$RF" ] || fail "user-rules.md 생성 안 됨"
grep -q "# L1 User Rules" "$RF"        || fail "헤더 누락"
grep -q "R-USER-LANG01" "$RF"          || fail "lang 룰 누락"
grep -q "Pointer: pyproject.toml" "$RF" || fail "pointer(스타일=설정파일경로) 누락"
grep -q "^Layer: L1" "$RF"             || fail "frontmatter Layer 누락"
grep -q "^Scope: default" "$RF"        || fail "frontmatter Scope 누락"

# --- JVM 계열 + 범용 포인터 플래그 (Kotlin/Java/--pointer) ---
TMP2="$(mktemp -d)"; export HARNESS_HOME="$TMP2/.harness"; RF2="$HARNESS_HOME/user-rules.md"
python3 "$INIT" init --lang "Kotlin 2.0 / Spring Boot" \
  --pointer-kotlin "detekt.yml" --pointer-java "checkstyle.xml" \
  --pointer go ".golangci.yml" --pointer rust "rustfmt.toml" \
  >/dev/null 2>&1 || fail "JVM/범용 포인터 init exit != 0"
grep -q "R-USER-FMT-KT" "$RF2"             || fail "kotlin 룰 누락"
grep -q "Pointer: detekt.yml" "$RF2"       || fail "kotlin pointer 누락"
grep -q "R-USER-FMT-JV" "$RF2"             || fail "java 룰 누락"
grep -q "Pointer: checkstyle.xml" "$RF2"   || fail "java pointer 누락"
grep -q "R-USER-FMT-GO" "$RF2"             || fail "범용(go) 룰 누락"
grep -q "Pointer: .golangci.yml" "$RF2"    || fail "범용(go) pointer 누락"
grep -q "R-USER-FMT-RUST" "$RF2"           || fail "범용(rust) 룰 누락"
export HARNESS_HOME="$TMP/.harness"  # 이후 테스트는 원래 hermetic dir 로 복귀

# --- 멱등: 재-init 은 거부(덮어쓰기 금지) ---
BEFORE="$(cat "$RF")"
if python3 "$INIT" init --lang "다른값" >/dev/null 2>&1; then
  fail "기존 파일에 재-init 이 허용됨 (멱등 위반, 데이터 파괴)"
fi
[ "$(cat "$RF")" = "$BEFORE" ] || fail "거부됐는데 내용이 바뀜"

# --- --force 는 .bak 백업 후 재생성 ---
python3 "$INIT" init --lang "Go 1.22" --force >/dev/null 2>&1 || fail "--force exit != 0"
[ -f "$RF.bak" ] || fail "--force 인데 .bak 백업 없음"
grep -q "Go 1.22" "$RF" || fail "--force 후 새 내용 없음"

# --- add: 룰 추가 + 중복 id 거부 ---
python3 "$INIT" add --id R-USER-DDD01 --title "DDD 4-layer 선호" --why "기본 아키텍처" \
  >/dev/null 2>&1 || fail "add exit != 0"
grep -q "R-USER-DDD01" "$RF" || fail "add 한 룰 없음"
if python3 "$INIT" add --id R-USER-DDD01 --title "중복" >/dev/null 2>&1; then
  fail "중복 id add 가 허용됨 (멱등 위반)"
fi
# 중복 거부 후에도 룰은 1번만
[ "$(grep -c 'R-USER-DDD01' "$RF")" -eq 1 ] || fail "중복 거부됐는데 룰이 2번 들어감"

# --- show 동작 ---
python3 "$INIT" show 2>/dev/null | grep -q "R-USER-DDD01" || fail "show 출력에 룰 없음"

echo "user-rules-init self-test: PASS"
