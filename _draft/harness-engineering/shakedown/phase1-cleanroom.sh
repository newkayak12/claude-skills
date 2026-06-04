#!/usr/bin/env bash
# Phase 1 — Clean-room 설치 + 이음새 직접 검증
# repo 밖처럼 ./harness(export)를 임시 디렉터리에 "설치"하고, claude 런타임이 보낼
# stdin을 hook에 직접 먹여 발화 계약을 확인한다. repo는 read-only(temp에만 씀).
# 사용:  bash shakedown/phase1-cleanroom.sh
set -u
ROOT=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d); export HOME="$TMP/home"; mkdir -p "$HOME"
cp -r "$ROOT/harness" "$TMP/plugin"; export CLAUDE_PLUGIN_ROOT="$TMP/plugin"
fail=0

echo "=== S1: clean-room install ==="
command -v python3 >/dev/null && echo "✓ python3" || { echo "✗ python3 없음 — STOP"; exit 1; }
python3 "$CLAUDE_PLUGIN_ROOT/scripts/user-rules-init.py" init \
  --lang "Python 3.12 / FastAPI" --pointer-python "pyproject.toml" --wip "1" >/dev/null 2>&1
if [ -f "$HOME/.harness/user-rules.md" ]; then echo "✓ S1 user-rules 생성"; else echo "✗ S1 FAIL"; fail=1; fi

echo; echo "=== S3a: SessionStart rule-inject (invariant+L1 only, R-CD 부재) ==="
echo '{}' | python3 "$CLAUDE_PLUGIN_ROOT/hooks/rule-inject.py" > "$TMP/sess.txt" 2>&1
echo "  크기: $(wc -l < "$TMP/sess.txt") 줄 / $(wc -c < "$TMP/sess.txt") chars (≈ $(($(wc -c < "$TMP/sess.txt")/4)) tok)"
grep -q 'R-CD' "$TMP/sess.txt" && { echo "✗ S3a FAIL — 코딩룰이 SessionStart에 샜다"; fail=1; } || echo "✓ S3a R-CD 부재(=stage로 이관)"
grep -qE 'R-(PG|DoD|DD|AI)' "$TMP/sess.txt" && echo "✓ S3a invariant 존재" || { echo "✗ S3a invariant 누락"; fail=1; }

echo; echo "=== S3b: 첫 Edit → stage-inject (R-CD 도착 via additionalContext) ==="
echo '{"session_id":"shake","tool_name":"Edit","tool_input":{"file_path":"x.py"}}' \
  | python3 "$CLAUDE_PLUGIN_ROOT/hooks/stage-inject.py" > "$TMP/stage.txt" 2>&1
grep -q 'R-CD' "$TMP/stage.txt" && echo "✓ S3b R-CD 코딩 진입 시 도착(기능보존)" || { echo "✗ S3b FAIL — 코딩룰 미도달=기능저해"; fail=1; }
python3 -c "import json;d=json.load(open('$TMP/stage.txt'));print('  additionalContext:', 'OK' if d.get('hookSpecificOutput',{}).get('additionalContext') else 'MISSING')" 2>/dev/null \
  || { echo "  ✗ stage 출력이 JSON 아님"; fail=1; }

echo; rm -rf "$TMP"; echo "✓ clean-room 흔적 제거"
echo; [ "$fail" -eq 0 ] && echo "🟢 Phase 1 PASS — Phase 2(라이브 세션)로 진행" || echo "🔴 Phase 1 FAIL — 라이브 세션 전에 고칠 것"
exit $fail
