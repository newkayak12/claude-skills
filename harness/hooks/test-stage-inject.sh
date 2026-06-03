#!/usr/bin/env bash
# test-stage-inject.sh — hermetic self-test for stage-inject.py (PreToolUse 단계진입 주입).
# 컨벤션: test-rule-inject.sh. 이 hook 은 PreToolUse 라 stdout 이 *JSON*(additionalContext)이다.
#
# 핵심 검증:
#   (a) code-writing 첫 트리거: R-CD 코딩 룰이 additionalContext 로 주입됨 (기능 보존의 증거).
#   (b) de-dup: 같은 세션 2번째 트리거는 재주입 안 함(주입 JSON 없음 = plain allow).
#   (c) exit 0 always (도구 막지 않음).
#   (d) permissionDecision=allow (차단 아님) + 주입≠강제 경계 문구.
# populated L0(export 컨텍스트)로 빌드해 친다 — draft 는 L0=0이라 vacuous.
set -u
cd "$(dirname "$0")" || exit 1   # hooks 디렉토리
fail=0
note() { echo "  - $1"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
python3 "../scripts/harness-export.py" --dest "$TMP/h" >/dev/null 2>&1 \
  || { echo "FAIL: harness-export 실패 — 테스트 전제(populated L0) 불가"; exit 1; }
EXP="$TMP/h"; HOOK="$EXP/hooks/stage-inject.py"; MERGE="$EXP/scripts/rules-merge.py"

# PreToolUse 이벤트 JSON (session_id + Edit 도구). $1 = session_id.
event() { printf '{"session_id":"%s","tool_name":"Edit","tool_input":{"file_path":"/tmp/x.py"}}' "$1"; }

# 격리된 HARNESS_HOME (마커 파일 + L1 비움). 새 세션마다 새 HOME 으로 de-dup 격리 보장.
HOME0="$TMP/home0"; mkdir -p "$HOME0"

# ── 1) 첫 트리거: JSON 주입 + R-CD 코딩 룰 + exit 0 + allow ──
out="$(event sess-A | HARNESS_HOME="$HOME0" python3 "$HOOK" 2>/dev/null)"; rc=$?
[ "$rc" -eq 0 ] || { note "FAIL: 첫 트리거 exit=$rc (기대 0)"; fail=1; }
echo "$out" | grep -q '"hookEventName": *"PreToolUse"' || { note "FAIL: PreToolUse hookSpecificOutput JSON 아님"; fail=1; }
echo "$out" | grep -q '"permissionDecision": *"allow"' || { note "FAIL: permissionDecision=allow 아님 (차단형이면 안 됨)"; fail=1; }
echo "$out" | grep -q '"additionalContext"' || { note "FAIL: additionalContext 필드 없음 — 주입 경로 깨짐"; fail=1; }
echo "$out" | grep -q "단계 진입 룰 자동 주입" || { note "FAIL: BOUNDARY 경계문구 없음"; fail=1; }
echo "$out" | grep -q "진짜 강제는 게이트" || { note "FAIL: 주입≠강제 경계 문구 없음"; fail=1; }
# 핵심: R-CD 코딩 룰(SessionStart --dynamic 에서 빠지는 룰)이 *여기서* 주입됨 = 기능 보존
echo "$out" | grep -qE "R-CD0[0-9]" || { note "FAIL: 코딩 룰(R-CD*) 미주입 — 기능저해(stage 재주입 실패)"; fail=1; }
# 추가 확인: SOLID/KISS/YAGNI 가 실제로 닿음
echo "$out" | grep -q "R-CD01" || { note "FAIL: R-CD01(SOLID) 미주입"; fail=1; }
echo "$out" | grep -q "R-CD03" || { note "FAIL: R-CD03(YAGNI) 미주입"; fail=1; }

# ── 2) de-dup: 같은 세션 2번째 트리거는 재주입 안 함 ──
out2="$(event sess-A | HARNESS_HOME="$HOME0" python3 "$HOOK" 2>/dev/null)"; rc2=$?
[ "$rc2" -eq 0 ] || { note "FAIL: 2번째 트리거 exit=$rc2 (기대 0)"; fail=1; }
echo "$out2" | grep -q "additionalContext" && { note "FAIL: 같은 세션 재주입(스팸) — de-dup 깨짐"; fail=1; }
[ -z "$(echo "$out2" | tr -d '[:space:]')" ] || { note "FAIL: 2번째 트리거 비-빈 출력 — plain allow 아님: $out2"; fail=1; }

# ── 3) 다른 세션은 다시 주입됨 (de-dup 은 세션-스코프) ──
out3="$(event sess-B | HARNESS_HOME="$HOME0" python3 "$HOOK" 2>/dev/null)"; rc3=$?
[ "$rc3" -eq 0 ] || { note "FAIL: 새 세션 exit=$rc3 (기대 0)"; fail=1; }
echo "$out3" | grep -q "R-CD0" || { note "FAIL: 새 세션인데 재주입 안 됨 — de-dup 이 세션 격리 안 함"; fail=1; }

# ── 4) 마커 파일이 실제로 세션-스코프로 생성됐는지 ──
[ -d "$HOME0/stage-inject" ] || { note "FAIL: stage-inject 마커 디렉토리 미생성 — de-dup 비영속"; fail=1; }
mk_n="$(find "$HOME0/stage-inject" -name 'code-writing.injected' | wc -l)"
[ "$mk_n" -eq 2 ] || { note "FAIL: 마커 수 $mk_n (기대 2: sess-A·sess-B)"; fail=1; }

# ── 5) fail-open: 머지 엔진 부재 → exit 0 + 무주입(도구 안 막음) ──
BADHOOK="$TMP/nomerge/hooks/stage-inject.py"; mkdir -p "$TMP/nomerge/hooks"
cp "$HOOK" "$BADHOOK"   # scripts/ 없는 트리 → find_script None
out5="$(event sess-C | HARNESS_HOME="$TMP/home5" CLAUDE_PLUGIN_ROOT="$TMP/nomerge" python3 "$BADHOOK" 2>/dev/null)"; rc5=$?
[ "$rc5" -eq 0 ] || { note "FAIL: 머지 엔진 부재 exit=$rc5 (기대 0 fail-open)"; fail=1; }
echo "$out5" | grep -q "additionalContext" && { note "FAIL: 머지 엔진 부재인데 주입 발생"; fail=1; }

# ── 6) session_id 없어도 크래시 없이 1회 주입 (de-dup 불가지만 동작) ──
out6="$(printf '{"tool_name":"Write","tool_input":{"file_path":"/tmp/y.py"}}' | HARNESS_HOME="$TMP/home6" python3 "$HOOK" 2>/dev/null)"; rc6=$?
[ "$rc6" -eq 0 ] || { note "FAIL: session_id 없음 exit=$rc6 (기대 0)"; fail=1; }
echo "$out6" | grep -q "R-CD0" || { note "FAIL: session_id 없음인데 주입 실패"; fail=1; }

[ $fail -eq 0 ] && echo "stage-inject self-test: PASS (R-CD 단계주입 OK, de-dup 세션-스코프, allow 非차단, fail-open)"
exit $fail
