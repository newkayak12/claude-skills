#!/usr/bin/env bash
# test-rule-inject.sh — hermetic self-test for rule-inject.py (SessionStart 자동주입).
# 컨벤션: test-active-symlink-guard.sh. 단 이 hook 은 stdout *주입*형이라 내용을 검사한다.
#
# 계약 변경(review/2026-06-03 CA-10/PF-10): SessionStart 는 이제 *전량 effective* 가 아니라
# `effective --dynamic`(invariant L0 + L1)만 쏜다. 단계별 정적 L0 default(R-CD 코딩 룰 등)는
# stage-inject.py(PreToolUse, 단계 진입)가 *코딩이 시작될 때* 재주입한다 → 기능 보존.
# 그래서 핵심 검증은:
#   (a) invariant L0(R-PG/R-DoD/R-DD/R-AI) + L1 이 주입됨, 그 슬라이스 안 룰 누락 0.
#   (b) 슬림화: 정적 L0 default(R-CD 코딩 룰)는 *여기엔 없다* + 카운트가 45→~20 로 떨어짐.
#       (단 코딩 룰은 stage-inject 가 단계에서 커버 — 이 테스트가 그 reachability 도 확인.)
#   (c) 포맷이 1줄/룰(인라인 layer)로 압축됨 — verbose `_layer:` 줄 부재.
# populated L0(export 컨텍스트)로 빌드해 친다 — draft 는 L0=0이라 vacuous.
set -u
cd "$(dirname "$0")" || exit 1   # hooks 디렉토리
fail=0
note() { echo "  - $1"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
python3 "../scripts/harness-export.py" --dest "$TMP/h" >/dev/null 2>&1 \
  || { echo "FAIL: harness-export 실패 — 테스트 전제(populated L0) 불가"; exit 1; }
EXP="$TMP/h"; HOOK="$EXP/hooks/rule-inject.py"; MERGE="$EXP/scripts/rules-merge.py"
STAGEHOOK="$EXP/hooks/stage-inject.py"

mk_l1() { # $1 = HARNESS_HOME 부모 (그 아래 .harness/user-rules.md 생성)
  mkdir -p "$1/.harness"
  cat > "$1/.harness/user-rules.md" <<'EOF'
# L1 User Rules
## R-TEST-A01: 합성 룰 A
Layer: L1
Scope: default
Stage: *
## R-TEST-B01: 합성 룰 B
Layer: L1
Scope: default
Stage: *
EOF
}

# ── 1) L1 있음: BOUNDARY + L1 두 룰 + invariant L0 + exit 0 ──
H1="$TMP/u1"; mk_l1 "$H1"
out="$(HARNESS_HOME="$H1/.harness" python3 "$HOOK" 2>/dev/null)"; rc=$?
[ "$rc" -eq 0 ] || { note "FAIL: exit=$rc (기대 0)"; fail=1; }
echo "$out" | grep -q "항상-켜둘 룰 자동 주입" || { note "FAIL: BOUNDARY 경계문구 없음"; fail=1; }
echo "$out" | grep -q "강제는 게이트" || { note "FAIL: 주입≠강제 경계 문구 없음 (B3)"; fail=1; }
echo "$out" | grep -q "R-TEST-A01" || { note "FAIL: L1 룰 A 미주입"; fail=1; }
echo "$out" | grep -q "R-TEST-B01" || { note "FAIL: L1 룰 B 미주입"; fail=1; }
echo "$out" | grep -qE "R-PG01|R-AI01" || { note "FAIL: invariant L0 미주입"; fail=1; }

# ── 2) 슬림화(--dynamic): invariant L0 + L1 만, 그 슬라이스 안 룰 누락 0 ──
inj_n="$(echo "$out" | grep -c '^## R-')"
dyn_n="$(HARNESS_HOME="$H1/.harness" python3 "$MERGE" effective --dynamic 2>/dev/null | grep -c '^## R-')"
full_n="$(HARNESS_HOME="$H1/.harness" python3 "$MERGE" effective 2>/dev/null | grep -c '^## R-')"
[ "$full_n" -gt 40 ] || { note "FAIL: 전량 effective $full_n (≤40) — populated L0 아님, 테스트 vacuous"; fail=1; }
[ "$inj_n" -eq "$dyn_n" ] || { note "FAIL: 주입($inj_n) ≠ --dynamic($dyn_n) — 슬림 슬라이스 룰 누락"; fail=1; }
# 슬림화 실증: dynamic < full (정적 default 가 빠졌다)
[ "$dyn_n" -lt "$full_n" ] || { note "FAIL: --dynamic($dyn_n) 이 전량($full_n) 과 같음 — 슬림 안 됨"; fail=1; }
# 카운트가 45→~20 로 의미있게 떨어짐 (대략 invariant+L1 ≈ 22 이하)
[ "$inj_n" -le 25 ] || { note "FAIL: SessionStart 주입 $inj_n (>25) — 슬림 미흡(45 근처)"; fail=1; }

# ── 3) 슬라이싱 정확성: 정적 L0 default(R-CD 코딩 룰)는 SessionStart 에 *없어야* ──
echo "$out" | grep -qE "^## R-CD0[0-9]" && { note "FAIL: 코딩 룰(R-CD*)이 SessionStart 에 있음 — 슬림 안 됨"; fail=1; }

# ── 4) 기능 보존(가장 중요): 빠진 코딩 룰이 stage-inject 로 *여전히 도달* ──
# SessionStart 에서 빠진 R-CD 가 단계 진입(stage-inject)에서 주입되는지 확인.
ev='{"session_id":"rs-1","tool_name":"Edit","tool_input":{"file_path":"/tmp/x.py"}}'
stage_out="$(printf '%s' "$ev" | HARNESS_HOME="$H1/.harness" python3 "$STAGEHOOK" 2>/dev/null)"
echo "$stage_out" | grep -q "R-CD0" \
  || { note "FAIL: 코딩 룰(R-CD*)이 stage-inject 로도 도달 안 함 — 기능저해!"; fail=1; }

# ── 5) 포맷 압축(비-vacuous): 1줄/룰(인라인 layer), verbose `_layer:` 줄 부재 ──
echo "$out" | grep -qE "^## R-AI01 \(L0!\): " || { note "FAIL: 인라인 layer 포맷 아님 — 압축 회귀(verbose 복귀?)"; fail=1; }
echo "$out" | grep -q "^_layer:" && { note "FAIL: verbose '_layer:' 줄 존재 — 포맷 미압축"; fail=1; }
body_lines="$(echo "$out" | grep -c '^## R-')"
[ "$body_lines" -eq "$inj_n" ] || { note "FAIL: 룰 본문 줄 수 불일치(압축 깨짐)"; fail=1; }

# ── 6) 빈 L1: dynamic L0(invariant) compact 주입 + L1 누출 없음 + exit 0 + 크래시 없음 ──
H0="$TMP/u0"; mkdir -p "$H0/.harness"
out0="$(HARNESS_HOME="$H0/.harness" python3 "$HOOK" 2>/dev/null)"; rc0=$?
[ "$rc0" -eq 0 ] || { note "FAIL: 빈 L1 exit=$rc0 (기대 0)"; fail=1; }
echo "$out0" | grep -q "R-TEST" && { note "FAIL: 빈 L1 인데 다른 유저 L1 룰 누출"; fail=1; }
echo "$out0" | grep -qE "^## R-PG01 \(L0!\): " || { note "FAIL: 빈 L1 인데 invariant 포맷 깨짐/누락"; fail=1; }

[ $fail -eq 0 ] && echo "rule-inject self-test: PASS (slim=dynamic inj=$inj_n<full=$full_n, R-CD 는 stage-inject 로 도달=기능보존, compact 1줄/룰)"
exit $fail
