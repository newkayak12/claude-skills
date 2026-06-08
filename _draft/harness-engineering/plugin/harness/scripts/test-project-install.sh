#!/usr/bin/env bash
# test-project-install.sh — 프로젝트 .claude/ vendoring 설치(P0 delivery)의 hermetic 검증.
#
# #014b: *프로덕션 경로*로 검증한다 — dogfood(plugin/harness/scripts)는 평탄화돼 있지 않아
# (06-rules.md 가 draft 루트에 있음) 설치기를 그대로 돌리면 self-contained 가 아니다. 그 사각이
# #014 F5(게이트가 broken 산출물 pass)의 원인이었다. 그래서 먼저 harness-export 로 *빌드된
# harness/*(= 프로덕션 설치 레이아웃, 평탄화)를 만들고, project-install --from <built> 로 벤더링한다.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
fail=0

# ── 0) 프로덕션 빌드 — harness-export 로 평탄화 페이로드 생성 (설치기는 여기서 복사) ─────────
BUILT="$(mktemp -d)/harness"
python3 "$HERE/harness-export.py" --dest "$BUILT" >/dev/null 2>&1 \
  || { echo "FAIL 0: harness-export 빌드 실패"; echo "FAILED (1)"; exit 1; }
PI="python3 $BUILT/scripts/project-install.py --from $BUILT"

# ── 0a) 글로벌 플러그인에 installer 포함 — skill Step A 해결 (B3) ──────────────
[ -f "$BUILT/scripts/project-install.py" ] \
  || { echo "FAIL 0a: 빌드된 harness/ 에 project-install.py 없음(skill Step A file-not-found)"; fail=1; }
# build/maintainer 도구는 계속 부재
[ ! -f "$BUILT/scripts/harness-export.py" ] || { echo "FAIL 0b: harness-export.py 가 페이로드에 잔존"; fail=1; }
[ ! -f "$BUILT/scripts/gc-scan.py" ]        || { echo "FAIL 0c: gc-scan.py 가 페이로드에 잔존"; fail=1; }
[ ! -f "$BUILT/scripts/test-project-install.sh" ] || { echo "FAIL 0d: test-project-install.sh 잔존"; fail=1; }
# 빌드 산출물은 평탄화 self-contained (06-rules.md 가 루트에)
[ -f "$BUILT/06-rules.md" ] || { echo "FAIL 0e: 빌드된 harness/ 가 평탄화 self-contained 아님(06-rules.md 없음)"; fail=1; }

# ── 1) 빈 프로젝트 설치 → 구조 + settings 치환 ───────────────────────────────
P1="$(mktemp -d)"
$PI --project "$P1" >/dev/null 2>&1 || { echo "FAIL 1: install 비정상 종료"; fail=1; }
[ -d "$P1/.claude/harness/hooks" ]   || { echo "FAIL 1a: .claude/harness/hooks 없음"; fail=1; }
[ -d "$P1/.claude/harness/scripts" ] || { echo "FAIL 1b: .claude/harness/scripts 없음"; fail=1; }
python3 -c "import json;json.load(open('$P1/.claude/settings.json'))" 2>/dev/null \
  || { echo "FAIL 1c: settings.json 유효 JSON 아님"; fail=1; }
python3 -c "
import json;s=json.load(open('$P1/.claude/settings.json'))['hooks']
assert 'PreToolUse' in s and 'SessionStart' in s, 'event 누락'
cmds=[h['command'] for blocks in s.values() for b in blocks for h in b['hooks']]
assert all('\$CLAUDE_PROJECT_DIR/.claude/harness' in c for c in cmds), 'PLUGIN_ROOT 치환 안 됨'
assert not any('CLAUDE_PLUGIN_ROOT' in c for c in cmds), 'PLUGIN_ROOT 잔존'
" 2>/dev/null || { echo "FAIL 1d: settings hooks 스키마/치환 위반"; fail=1; }

# ── 1.5) 벤더링 페이로드 self-containment (B2 핵심) ───────────────────────────
#   런타임 필수는 있고, build/maintainer/installer 도구는 *대상 프로젝트엔* 없어야.
VH="$P1/.claude/harness"
[ -f "$VH/06-rules.md" ]                 || { echo "FAIL 1.5a: 벤더링에 06-rules.md 없음(rules-load 깨짐)"; fail=1; }
[ -f "$VH/hooks/hooks.json" ]            || { echo "FAIL 1.5b: 벤더링에 hooks.json 없음"; fail=1; }
[ -f "$VH/scripts/cycle-init.py" ]      || { echo "FAIL 1.5c: 벤더링에 cycle-init.py 없음"; fail=1; }
[ ! -f "$VH/scripts/project-install.py" ]   || { echo "FAIL 1.5d: 벤더링에 installer 잔존(불필요)"; fail=1; }
[ ! -f "$VH/scripts/harness-export.py" ]    || { echo "FAIL 1.5e: 벤더링에 harness-export 잔존"; fail=1; }
[ ! -f "$VH/scripts/gc-scan.py" ]           || { echo "FAIL 1.5f: 벤더링에 gc-scan 잔존"; fail=1; }

# ── 2) 벤더링 hook 이 CLAUDE_PLUGIN_ROOT 없이 자급 동작 (exit 0) ──────────────
(
  cd "$P1" || exit 1
  export CLAUDE_PROJECT_DIR="$P1"; unset CLAUDE_PLUGIN_ROOT
  echo '{}' | python3 "$P1/.claude/harness/hooks/active-cycle-verify.py" >/dev/null 2>&1 \
    || { echo "FAIL 2a: active-cycle-verify 비정상(script 자급 실패?)"; exit 3; }
  # rule-inject 는 06-rules.md 를 자급 해석해야 — vendored 평탄화 페이로드의 핵심 자급 증거
  echo '{}' | python3 "$P1/.claude/harness/hooks/rule-inject.py" >/dev/null 2>&1 \
    || { echo "FAIL 2c: rule-inject 비정상(06-rules.md 자급 해석 실패?)"; exit 3; }
  echo '{"tool_name":"Edit","tool_input":{"file_path":"x.py"}}' \
    | python3 "$P1/.claude/harness/hooks/phase-guard.py" >/dev/null 2>&1
  rc=$?
  [ "$rc" = "2" ] || { echo "FAIL 2b: phase-guard no active 코드 차단 실패(exit=$rc, 기대 2)"; exit 3; }
  echo '{"tool_name":"Edit","tool_input":{"file_path":"notes/todo.md"}}' \
    | python3 "$P1/.claude/harness/hooks/phase-guard.py" >/dev/null 2>&1 \
    || { echo "FAIL 2c: phase-guard no active 일반 문서 오탐 차단"; exit 3; }
) || fail=1

# ── 3) ambient governance — CLAUDE.md 계약 (B3) ──────────────────────────────
grep -q "harness:begin" "$P1/.claude/CLAUDE.md"  || { echo "FAIL 3a: CLAUDE.md marker 없음"; fail=1; }
grep -q "WIP=1" "$P1/.claude/CLAUDE.md"          || { echo "FAIL 3b: WIP=1 계약 없음"; fail=1; }
grep -q "작업 = 사이클" "$P1/.claude/CLAUDE.md"  || { echo "FAIL 3c: 사이클 규율 없음"; fail=1; }
grep -q "게이트" "$P1/.claude/CLAUDE.md"         || { echo "FAIL 3d: 게이트 언급 없음"; fail=1; }

# ── 4) 멱등 — 재설치 시 command 추가 0 ───────────────────────────────────────
$PI --project "$P1" 2>&1 | grep -q "+0 command" || { echo "FAIL 4: 재설치 멱등 아님(+0 아님)"; fail=1; }
rm -rf "$P1"

# ── 5) 보존 — 기존 settings.json 사용자 키/hook 보존 + 하네스 hook 추가 ───────
P2="$(mktemp -d)"; mkdir -p "$P2/.claude"
cat > "$P2/.claude/settings.json" <<'JSON'
{ "model": "opus", "hooks": { "PreToolUse": [ { "matcher": "Bash",
  "hooks": [ { "type": "command", "command": "python3 my-user-hook.py" } ] } ] } }
JSON
$PI --project "$P2" >/dev/null 2>&1
python3 -c "
import json;s=json.load(open('$P2/.claude/settings.json'))
assert s.get('model')=='opus', '사용자 키 model 소실'
cmds=[h['command'] for b in s['hooks']['PreToolUse'] for h in b['hooks']]
assert 'python3 my-user-hook.py' in cmds, '사용자 hook 소실'
assert any('phase-guard.py' in c for c in cmds), '하네스 hook 미추가'
" 2>/dev/null || { echo "FAIL 5: 기존 settings 병합 보존 실패"; fail=1; }

# ── 6) 보존 — 기존 CLAUDE.md 내용 보존 + 블록 추가 ────────────────────────────
printf '# My Project\n\n사용자 고유 지침입니다.\n' > "$P2/.claude/CLAUDE.md"
$PI --project "$P2" >/dev/null 2>&1
grep -q "사용자 고유 지침입니다" "$P2/.claude/CLAUDE.md" || { echo "FAIL 6a: 기존 CLAUDE.md 내용 소실"; fail=1; }
grep -q "harness:begin" "$P2/.claude/CLAUDE.md"          || { echo "FAIL 6b: governance 블록 미추가"; fail=1; }
# 재설치 시 블록 1개만(중복 누적 방지)
[ "$(grep -c 'harness:begin' "$P2/.claude/CLAUDE.md")" = "1" ] || { echo "FAIL 6c: governance 블록 중복 누적"; fail=1; }
rm -rf "$P2"

# ── 8) 버전 인식 재-벤더 (update UX, N=0 fix) — 거부 아닌 정보성 ───────────────
P4="$(mktemp -d)"
$PI --project "$P4" 2>&1 | grep -q "신규 설치 v" || { echo "FAIL 8a: 신규 설치 버전 라벨 없음"; fail=1; }
python3 -c "import json;v=json.load(open('$P4/.claude/harness/.harness-vendored'));assert v.get('version'),'no version'" 2>/dev/null \
  || { echo "FAIL 8b: 벤더 마커에 version 미기록"; fail=1; }
# 같은 버전 재실행 → '이미 최신'(거부 아님)
$PI --project "$P4" 2>&1 | grep -q "이미 최신 v" || { echo "FAIL 8c: 동일버전 재-벤더가 '이미 최신' 아님"; fail=1; }
# 구형 plain-text 마커 → '버전 미상' 으로 재-벤더(하위호환, 거부 아님)
printf 'old plain marker\n' > "$P4/.claude/harness/.harness-vendored"
$PI --project "$P4" 2>&1 | grep -q "버전 미상" || { echo "FAIL 8d: 구형 마커가 '버전 미상' 재-벤더 아님"; fail=1; }
# 옛 버전 마커 → '업그레이드' 라벨
python3 -c "import json;open('$P4/.claude/harness/.harness-vendored','w').write(json.dumps({'version':'0.0.1'}))"
$PI --project "$P4" 2>&1 | grep -q "업그레이드 v0.0.1 →" || { echo "FAIL 8e: 옛 버전 마커가 '업그레이드' 라벨 아님"; fail=1; }
rm -rf "$P4"

# ── 7) 평탄화 안 된 소스 거부 — dogfood(plugin/harness)는 06-rules.md 없어 즉시 거부 ──
P3="$(mktemp -d)"
if python3 "$HERE/project-install.py" --project "$P3" >/dev/null 2>&1; then
  echo "FAIL 7: 평탄화 안 된 소스(plugin/harness)인데 거부하지 않음(F5 재발 위험)"; fail=1
fi
rm -rf "$P3" "$(dirname "$BUILT")"

if [ "$fail" = 0 ]; then
  echo "PASS test-project-install.sh — 프로덕션경로·self-containment·자급hook·멱등·보존·거부 전부 확인"
else
  echo "FAILED ($fail)"
fi
exit $fail
