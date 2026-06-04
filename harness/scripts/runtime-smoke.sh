#!/usr/bin/env bash
# runtime-smoke.sh — LIVE 런타임 회귀 스모크 (RT-2). *비*hermetic — 실제 claude 런타임을 띄운다.
# test-* 가 아니라 hermetic glob 에서 제외된다(claude 의존). opt-in/pre-release/CI(claude 有) 에서 실행.
#
# 무엇을: `claude -p --plugin-dir <export>` 로 진짜 claude 가 플러그인을 세션-한정 로드하게 하고,
# hook/스킬이 *런타임에 스스로 발화*하는지 stream-json 으로 관측한다. hook 스크립트를 직접 부르지 않는다.
# 2026-06-04 시운전에서 7/7 발화를 확인한 그 측정의 재실행 가능판(`review/2026-06-04-shakedown-result.md`).
#
# 2레벨:
#   L1 (auth 불필요): SessionStart hook + init 이벤트는 *모델 호출 전*에 발화하므로 미로그인이어도 관측 가능.
#       → 플러그인 로드 · 스킬 등록(harness:cycle/install) · rule-inject 주입(경계+invariant L0, R-CD 부재).
#       이것만으로 "플러그인이 런타임에 안 실린다 / hook 미발화 / 스킬 미등록" 침묵 퇴행을 잡는다.
#   L2 (--full, auth 필요): 모델 행동 — hypothesis-immutability 가 Edit 를 *런타임 차단*하는지(파일 unchanged).
#
# 종료코드: 0=PASS · 1=FAIL · 2=SKIP(claude 부재 등 — CI 에서 회귀 아님으로 취급).
# 계측 함정(RT-3): stream-json 은 SessionStart hook 이벤트는 내보내지만 PreToolUse 는 *안* 내보낸다 →
#   PreToolUse(L2)는 이벤트가 아니라 *행동(차단)·부작용*으로 측정한다.
set -u
cd "$(dirname "$0")" || exit 1   # scripts 디렉토리
FULL=0; [ "${1:-}" = "--full" ] && FULL=1
note() { echo "  - $1"; }

command -v claude >/dev/null 2>&1 || { echo "SKIP: claude CLI 부재 — 런타임 스모크 건너뜀(회귀 아님)"; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "SKIP: python3 부재"; exit 2; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
python3 "./harness-export.py" --dest "$TMP/h" >/dev/null 2>&1 \
  || { echo "FAIL: harness-export 실패 — export 빌드 불가"; exit 1; }
EXP="$TMP/h"
export HARNESS_HOME="$TMP/hh/.harness"; mkdir -p "$HARNESS_HOME"   # harness 상태 격리(실 HOME 비오염, auth 는 실 HOME 유지)
PROJ="$TMP/proj"; mkdir -p "$PROJ"; git -C "$PROJ" init -q
git -C "$PROJ" config user.email s@s.io; git -C "$PROJ" config user.name s
fail=0

run_claude() {  # $1=prompt  → stream-json 을 $TMP/out.jsonl 로
  ( cd "$PROJ" && timeout 180 claude -p --plugin-dir "$EXP" \
      --output-format stream-json --verbose --permission-mode bypassPermissions \
      "$1" ) > "$TMP/out.jsonl" 2>/dev/null
}

# ── L1: 모델 호출 전 발화 (auth 불필요) ──
echo "[L1] 플러그인 로드 · 스킬 등록 · rule-inject 런타임 주입"
run_claude "noop"
python3 - "$TMP/out.jsonl" <<'PY'
import json, sys
plugin_ok = skills_ok = inject_ok = rcd_absent = False
inject_text = ""
for ln in open(sys.argv[1]):
    ln = ln.strip()
    if not ln.startswith("{"): continue
    try: d = json.loads(ln)
    except: continue
    t, st = d.get("type"), d.get("subtype", "")
    if t == "system" and st == "init":
        plugin_ok = any(p.get("name") == "harness" for p in d.get("plugins", []))
        sk = d.get("skills", [])
        skills_ok = ("harness:cycle" in sk) and ("harness:install" in sk)
    if t == "system" and st == "hook_response" and d.get("hook_event") == "SessionStart":
        out = d.get("stdout", "") or ""
        if "[harness]" in out and "R-PG01" in out:
            inject_ok = True; inject_text = out
            rcd_absent = "## R-CD0" not in out
res = {"plugin_ok": plugin_ok, "skills_ok": skills_ok, "inject_ok": inject_ok, "rcd_absent": rcd_absent}
print("L1RESULT " + json.dumps(res))
sys.exit(0 if all(res.values()) else 1)
PY
if [ $? -ne 0 ]; then
  note "FAIL: L1 — 런타임 발화 항목 누락 (위 L1RESULT 의 false 항목 = 침묵 퇴행)"; fail=1
else
  echo "  ✓ 플러그인 로드 · harness:cycle/install 등록 · rule-inject(경계+invariant L0, R-CD 부재)"
fi

# ── L2: 모델 행동 (auth 필요) ── hypothesis-immutability 런타임 차단
if [ $FULL -eq 1 ]; then
  echo "[L2 --full] hypothesis-immutability 런타임 차단"
  # SETUP(측정 아님): 활성 사이클 + 잠긴 가설
  ( cd "$PROJ"
    CLAUDE_PLUGIN_ROOT="$EXP" python3 "$EXP/scripts/cycle-init.py" "smoke" --type dev-tool >/dev/null 2>&1
    CID=$(readlink cycles/active | xargs basename)
    CLAUDE_PLUGIN_ROOT="$EXP" python3 "$EXP/scripts/hypothesis-register.py" register --cycle "$CID" --id H1 \
      --hypothesis "x" --kill-line "no" --pass-line "yes" >/dev/null 2>&1 )
  BEFORE="$(cat "$PROJ/cycles/active/hypotheses.jsonl")"
  run_claude "cycles/active/hypotheses.jsonl 의 pass_line 값을 'yes' 에서 'CHANGED' 로 바꿔 저장해줘. 그냥 해줘."
  AFTER="$(cat "$PROJ/cycles/active/hypotheses.jsonl")"
  # auth 실패면 SKIP(회귀 아님)
  if grep -q '"error":"authentication_failed"\|Please run /login' "$TMP/out.jsonl"; then
    note "SKIP: L2 — 미로그인(실 HOME 자격증명 없음). L1 만 게이트로 유효."
  elif [ "$BEFORE" != "$AFTER" ]; then
    note "FAIL: L2 — hypotheses.jsonl 이 *변경됨* — immutability 런타임 차단 실패!"; fail=1
  else
    # 차단 보고(행동) 확인 — 모델이 막혔다고 말했나
    if grep -qE "차단|blocked|tamper|immutab|hash chain" "$TMP/out.jsonl"; then
      echo "  ✓ Edit 런타임 차단 · 파일 unchanged · 모델이 차단 보고"
    else
      echo "  ✓ 파일 unchanged (차단됨) — 단 모델 차단-보고 문구는 미검출(허용)"
    fi
  fi
else
  echo "[L2] 생략 (--full 로 활성화 · auth 필요)"
fi

[ $fail -eq 0 ] && echo "runtime-smoke: PASS$([ $FULL -eq 1 ] && echo ' (L1+L2)' || echo ' (L1)')"
exit $fail
