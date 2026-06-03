#!/usr/bin/env bash
# test-harness-export.sh — self-contained export smoke (B1) + marketplace 유효성(B2).
# hermetic: export는 tmp dest로 (draft/실 ./harness 오염 0). marketplace 체크만 실 repo 상태 검증.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"          # plugin/harness/scripts
# scripts → harness → plugin → harness-engineering → _draft → claude-skills
HARNESS_ENG="$(cd "$HERE/../../.." && pwd)"
REPO_ROOT="$(cd "$HARNESS_ENG/../.." && pwd)"
EXPORT="$HERE/harness-export.py"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $1"; exit 1; }

DEST="$TMP/harness"

# --- B1: hermetic export + self-containment smoke ---
python3 "$EXPORT" --dest "$DEST" >/dev/null 2>&1 || fail "export exit != 0"

[ -f "$DEST/.claude-plugin/plugin.json" ] || fail "plugin.json 누락"
[ -f "$DEST/06-rules.md" ]               || fail "06-rules.md 평탄화 누락 (rules-load 런타임 의존)"
[ -f "$DEST/skills/install/SKILL.md" ]   || fail "install skill 누락"
[ -f "$DEST/skills/cycle/SKILL.md" ]     || fail "cycle skill 누락"
[ -d "$DEST/situational-rules" ]         || fail "situational-rules 누락"
[ -f "$DEST/README.md" ]                 || fail "생성 README 누락"
grep -q "GENERATED" "$DEST/README.md"    || fail "README에 GENERATED 표기 없음"
# dev 전용은 제외되어야
[ ! -d "$DEST/cycles" ]                  || fail "cycles/ 가 export됨 (dev 전용, 제외 대상)"
[ ! -e "$DEST/TODO.md" ]                 || fail "TODO.md 가 export됨 (dev 전용)"
[ ! -e "$DEST/devils-advocate.md" ]      || fail "devils-advocate.md 가 export됨 (dev 전용)"

# 핵심: 설치 환경처럼 dest 안의 rules-load.py 가 dest/06-rules.md 를 찾는가
python3 "$DEST/scripts/rules-load.py" --list-stages >/dev/null 2>&1 \
  || fail "rules-load.py 가 export dir 안에서 06-rules.md 를 못 찾음 (self-containment 깨짐)"
# non-vacuous: 파일을 찾는 것만으론 부족 — 실제 룰을 파싱하고 *끝까지 출력*해야 함.
# (스트리밍 grep은 print_rule 도중 크래시를 못 잡음 → exit code 를 직접 본다)
ALLOUT="$(python3 "$DEST/scripts/rules-load.py" --all 2>&1)"; RC=$?
[ $RC -eq 0 ] || { echo "$ALLOUT" | tail -4; fail "rules-load.py --all 비정상 종료(exit $RC) — print_rule 등 런타임 깨짐"; }
NRULES="$(printf '%s\n' "$ALLOUT" | grep -cE '^## R-')"
[ "${NRULES:-0}" -gt 5 ] || fail "rules-load.py 파싱 룰 $NRULES 개 (<=5, vacuous/크래시 의심)"
# stage 필터 경로(install 스킬이 광고)도 끝까지 동작해야
python3 "$DEST/scripts/rules-load.py" code-writing >/dev/null 2>&1 \
  || fail "rules-load.py <stage> 필터가 끝까지 동작 안 함"
# #010: rule-merge 엔진도 export 안에서 self-contained 동작 (L0 번들 + 생성 L1 머지)
MH="$TMP/mh/.harness"; HARNESS_HOME="$MH" python3 "$DEST/scripts/user-rules-init.py" \
  init --lang "Py" >/dev/null 2>&1 || fail "export user-rules-init 동작 안 함"
HARNESS_HOME="$MH" python3 "$DEST/scripts/rules-merge.py" effective --stage code-writing >/tmp/mrg 2>&1 \
  || fail "rules-merge.py 가 export dir 안에서 동작 안 함 (self-containment)"
grep -q "R-USER-LANG01" /tmp/mrg || fail "export 머지 결과에 L1 룰 없음 (L1 미적용)"
grep -qE "R-USER-LANG01 \(L1\)" /tmp/mrg || fail "export 머지 provenance 누락"

# --- 멱등: 같은 dest 재-export (마커 있으니 허용) ---
python3 "$EXPORT" --dest "$DEST" >/dev/null 2>&1 || fail "재-export(멱등) exit != 0"

# --- 안전: 비어있지 않고 마커 없는 dir 로의 export 는 거부 ---
GUARD="$TMP/guard"; mkdir -p "$GUARD"; echo x > "$GUARD/keep.txt"
if python3 "$EXPORT" --dest "$GUARD" >/dev/null 2>&1; then
  fail "마커 없는 비어있지않은 dir 에 export 가 허용됨 (임의 삭제 위험)"
fi
[ -f "$GUARD/keep.txt" ] || fail "거부됐는데 guard 파일이 사라짐"

# --- B2: marketplace.json 유효성 (실 repo 상태) ---
python3 - "$REPO_ROOT" <<'PY' || exit 1
import json, sys
from pathlib import Path
repo = Path(sys.argv[1])
mp = repo / ".claude-plugin" / "marketplace.json"
d = json.loads(mp.read_text(encoding="utf-8"))          # valid JSON
entry = next((p for p in d["plugins"] if p.get("name") == "harness"), None)
if entry is None:
    print("FAIL: marketplace.json 에 harness peer 엔트리 없음"); sys.exit(1)
src = (repo / entry["source"]).resolve()
if not (src / ".claude-plugin" / "plugin.json").exists():
    print(f"FAIL: source 경로에 plugin.json 없음: {src}"); sys.exit(1)
print("marketplace harness 엔트리 OK:", entry["source"])
PY

echo "harness-export self-test: PASS"
