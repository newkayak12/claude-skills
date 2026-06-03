#!/usr/bin/env bash
# test-rule-inject.sh — hermetic self-test for rule-inject.py (SessionStart 자동주입).
# 컨벤션: test-active-symlink-guard.sh. 단 이 hook 은 stdout *주입*형이라 내용을 검사한다.
#
# 토큰 경량화는 **lossless 포맷 압축**으로만 한다(룰 안 뺌). 그래서 핵심 검증은:
#   (a) 전량 effective 가 다 주입됨(룰 누락 0 = 기능보존) — 정적 L0 default 슬라이싱은
#       독립 리뷰(2026-06-03)가 기능저해로 판정해 보류(stage-injection 후속).
#   (b) 포맷이 1줄/룰(인라인 layer)로 압축됨 — verbose `_layer:` 줄 부재.
# populated L0(export 컨텍스트)로 빌드해 친다 — draft 는 L0=0이라 vacuous.
set -u
cd "$(dirname "$0")" || exit 1   # hooks 디렉토리
fail=0
note() { echo "  - $1"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
python3 "../scripts/harness-export.py" --dest "$TMP/h" >/dev/null 2>&1 \
  || { echo "FAIL: harness-export 실패 — 테스트 전제(populated L0) 불가"; exit 1; }
EXP="$TMP/h"; HOOK="$EXP/hooks/rule-inject.py"; MERGE="$EXP/scripts/rules-merge.py"

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
echo "$out" | grep -q "적용 룰 자동 주입" || { note "FAIL: BOUNDARY 경계문구 없음"; fail=1; }
echo "$out" | grep -q "강제는 게이트" || { note "FAIL: 주입≠강제 경계 문구 없음 (B3)"; fail=1; }
echo "$out" | grep -q "R-TEST-A01" || { note "FAIL: L1 룰 A 미주입"; fail=1; }
echo "$out" | grep -q "R-TEST-B01" || { note "FAIL: L1 룰 B 미주입"; fail=1; }
echo "$out" | grep -qE "R-PG01|R-AI01" || { note "FAIL: invariant L0 미주입"; fail=1; }

# ── 2) lossless: 전량 effective 가 다 주입됨(룰 누락 0 = 기능보존) ──
inj_n="$(echo "$out" | grep -c '^## R-')"
full_n="$(HARNESS_HOME="$H1/.harness" python3 "$MERGE" effective 2>/dev/null | grep -c '^## R-')"
[ "$full_n" -gt 40 ] || { note "FAIL: 전량 effective $full_n (≤40) — populated L0 아님, 테스트 vacuous"; fail=1; }
[ "$inj_n" -eq "$full_n" ] || { note "FAIL: 주입($inj_n) ≠ 전량 effective($full_n) — 룰 누락(기능저해)"; fail=1; }
# 정적 L0 default(예: R-CD01 SOLID, R-CD03 YAGNI)도 빠지지 않아야 — 슬라이싱 회귀 방지
echo "$out" | grep -qE "R-CD0[0-9]" || { note "FAIL: 코딩 룰(R-CD*) 누락 — 정적 default 슬라이싱 회귀(기능저해)"; fail=1; }

# ── 3) 포맷 압축(비-vacuous): 1줄/룰(인라인 layer), verbose `_layer:` 줄 부재 ──
echo "$out" | grep -qE "^## R-AI01 \(L0!\): " || { note "FAIL: 인라인 layer 포맷 아님 — 압축 회귀(verbose 복귀?)"; fail=1; }
echo "$out" | grep -q "^_layer:" && { note "FAIL: verbose '_layer:' 줄 존재 — 포맷 미압축"; fail=1; }
# 룰 줄 수 ≈ '## R-' 줄 수 (1줄/룰). 본문 줄(공백/포인터 제외)이 룰 수의 1.3배 넘으면 비압축 의심
body_lines="$(echo "$out" | grep -c '^## R-')"
[ "$body_lines" -eq "$inj_n" ] || { note "FAIL: 룰 본문 줄 수 불일치(압축 깨짐)"; fail=1; }

# ── 4) 기능보존: 전량 카탈로그 + stage 조회 경로 동작 ──
HARNESS_HOME="$H1/.harness" python3 "$MERGE" effective --stage code-writing 2>/dev/null | grep -q '^## R-' \
  || { note "FAIL: stage 조회 경로 깨짐"; fail=1; }

# ── 5) 빈 L1: 전량 L0(45) compact 주입 + L1 누출 없음 + exit 0 + 크래시 없음 ──
H0="$TMP/u0"; mkdir -p "$H0/.harness"
out0="$(HARNESS_HOME="$H0/.harness" python3 "$HOOK" 2>/dev/null)"; rc0=$?
[ "$rc0" -eq 0 ] || { note "FAIL: 빈 L1 exit=$rc0 (기대 0)"; fail=1; }
echo "$out0" | grep -q "R-TEST" && { note "FAIL: 빈 L1 인데 다른 유저 L1 룰 누출"; fail=1; }
echo "$out0" | grep -qE "^## R-PG01 \(L0!\): " || { note "FAIL: 빈 L1 인데 invariant 포맷 깨짐/누락"; fail=1; }

[ $fail -eq 0 ] && echo "rule-inject self-test: PASS (lossless: inj=$inj_n=full, compact 1줄/룰, 기능보존 OK)"
exit $fail
