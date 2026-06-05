#!/usr/bin/env bash
# test-phase-guard.sh — phase-guard hook + phase-advance + feedback 기록 hermetic self-test (#013b).
#   B1: design/planning + 코드파일 → 차단(exit2); implementation·.md·active없음 → 통과(exit0)
#   B2: phase-advance 인접 전진 허용 + metrics 갱신; 스킵·역행 거부
#   B3: 차단 시 .claude/.feedback/feedback.jsonl 에 구조화 1줄; 기록 실패해도 차단 exit2 불변
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$HERE/../hooks/phase-guard.py"
ADVANCE="$HERE/phase-advance.py"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $1"; exit 1; }

# ---- 합성 fixture: active 사이클 + metrics.json ----
P="$TMP/proj"; CY="20260605-fixture"
mkdir -p "$P/cycles/$CY"
ln -s "$CY" "$P/cycles/active"
write_phase() { echo "{\"current_phase\": \"$1\"}" > "$P/cycles/$CY/metrics.json"; }

# in_dir: fixture 루트를 cwd 로, CLAUDE_PROJECT_DIR 도 거기로(feedback 위치)
run_guard() { # $1=tool $2=file ; stdin JSON 으로 phase-guard 호출, exit code 반환
  ( cd "$P" && CLAUDE_PROJECT_DIR="$P" \
    echo "{\"tool_name\":\"$1\",\"tool_input\":{\"file_path\":\"$2\"}}" \
    | CLAUDE_PROJECT_DIR="$P" python3 "$GUARD" >/dev/null 2>&1 ); echo $?
}

# ========== B1: 차단/통과 매트릭스 ==========
write_phase design
[ "$(run_guard Edit src/app.py)" = "2" ]   || fail "design + .py Edit 가 차단(exit2) 안 됨"
write_phase planning
[ "$(run_guard Write lib/x.kt)" = "2" ]     || fail "planning + .kt Write 가 차단 안 됨"
write_phase design
[ "$(run_guard Edit docs/design.md)" = "0" ] || fail "design + .md 가 통과(exit0) 안 됨(설계문서 차단=거짓양성)"
write_phase implementation
[ "$(run_guard Edit src/app.py)" = "0" ]    || fail "implementation + .py 가 통과 안 됨(거짓양성)"
write_phase design
[ "$(run_guard Read src/app.py)" = "0" ]    || fail "Read(비편집 도구) 가 통과 안 됨"
# active 없음 → 통과
rm "$P/cycles/active"
[ "$(run_guard Edit src/app.py)" = "0" ]    || fail "active 없음인데 차단됨(fail-open 위반)"
ln -s "$CY" "$P/cycles/active"

# ========== B3: feedback 기록 ==========
rm -rf "$P/.claude/.feedback"
write_phase design
RC="$(run_guard Edit src/secret.py)"
[ "$RC" = "2" ] || fail "feedback 케이스에서 차단 exit2 아님"
FB="$P/.claude/.feedback/feedback.jsonl"
[ -f "$FB" ] || fail ".feedback/feedback.jsonl 미생성(B3 기록 실패)"
grep -q '"hook": "phase-guard"' "$FB"   || fail "feedback 에 hook 키 없음"
grep -q '"event":'              "$FB"   || fail "feedback 에 event 키 없음"
grep -q 'secret.py'             "$FB"   || fail "feedback detail 에 파일명 없음"
LINES="$(wc -l < "$FB")"; [ "$LINES" = "1" ] || fail "feedback 1줄 기대, 실제 $LINES"

# B3 fail-soft: feedback 디렉토리를 못 쓰게 해도 차단 exit2 불변
# .feedback 를 파일로 만들어 mkdir 충돌 유발 → 기록 실패하지만 hook 본업은 차단
rm -rf "$P/.claude/.feedback"; mkdir -p "$P/.claude"; : > "$P/.claude/.feedback"
write_phase design
# CLAUDE_PROJECT_DIR 후보 실패 시 cwd 후보로 폴백되므로, cwd 도 같은 $P 라 둘 다 막힘
RC2="$( cd "$P" && CLAUDE_PROJECT_DIR="$P" bash -c \
  'echo "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"a.py\"}}" | python3 "'"$GUARD"'" >/dev/null 2>&1'; echo $? )"
[ "$RC2" = "2" ] || fail "feedback 기록 불가 상황에서 차단 exit2 가 깨짐(fail-soft 위반)"
rm -f "$P/.claude/.feedback"

# ========== B2: phase-advance 전환 ==========
adv() { ( cd "$P" && python3 "$ADVANCE" "$@" >/dev/null 2>&1 ); echo $?; }
cur_phase() { ( cd "$P" && python3 "$ADVANCE" --show 2>/dev/null ); }

write_phase analysis
[ "$(adv design)" = "0" ]        || fail "analysis→design 인접 전진 거부됨"
[ "$(cur_phase)" = "design" ]    || fail "전진 후 current_phase 가 design 아님(갱신 실패)"
[ "$(adv analysis)" != "0" ]     || fail "design→analysis 역행이 허용됨"
write_phase analysis
[ "$(adv implementation)" != "0" ] || fail "analysis→implementation 스킵이 허용됨"
# --force 로 스킵 + blackbox 기록
write_phase analysis
[ "$(adv implementation --force)" = "0" ] || fail "--force 스킵이 거부됨"
[ "$(cur_phase)" = "implementation" ]     || fail "--force 후 phase 갱신 실패"
grep -q '"kind": "phase-force"' "$P/cycles/$CY/blackbox.jsonl" || fail "--force 가 blackbox 에 기록 안 됨"

echo "phase-guard self-test: PASS"
