#!/usr/bin/env bash
# test-rules-merge.sh — L0+L1 머지 엔진 (B1 override+provenance · B2 invariant 보호 ·
# B3 same-layer 비해석 · B4 user-rules-init 라운드트립). hermetic 합성 fixture.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
MERGE="$HERE/rules-merge.py"
INIT="$HERE/user-rules-init.py"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $1"; exit 1; }

# --- 합성 L0 (06-rules.md 카탈로그 구조: 섹션 로딩시점 + (필수) invariant + H3 룰) ---
L0="$TMP/06-rules.md"
cat > "$L0" <<'MD'
## 1. 코드 원칙
**로딩 시점**: `code-writing`
### R-CD01: SOLID (L0)
- body
### R-CD02: KISS (L0)
- body

## 2. 아키텍처
**로딩 시점**: `architecture`
### R-AR01: SoC (L0)
- body

## 3. 프로세스 게이트 (필수)
**로딩 시점**: `always`
### R-PG01: WIP=1 (L0 invariant)
- body
MD
# rules-merge 는 L0 를 <plugin>/06-rules.md 에서 찾음 → tmp plugin 레이아웃 구성
PLUG="$TMP/plug"; mkdir -p "$PLUG/scripts"
cp "$HERE/ruleslib.py" "$PLUG/scripts/"; cp "$MERGE" "$PLUG/scripts/rules-merge.py"
cp "$L0" "$PLUG/06-rules.md"
M="python3 $PLUG/scripts/rules-merge.py"

# --- L1 (per-rule): R-CD01 동일 id override + R-PG01 을 Overrides(invariant) + 신규 룰 ---
L1="$TMP/user-rules.md"
cat > "$L1" <<'MD'
## R-CD01: SOLID 내스타일 (L1)
Layer: L1
Scope: default
Stage: code-writing
Why: 내 코드 스타일

## R-USER-WIP: WIP=2
Layer: L1
Scope: default
Stage: *
Overrides: R-PG01
Why: 사용자 기본

## R-USER-LANG: Python 3.12
Layer: L1
Scope: default
Stage: *
Why: 기본 스택
MD

# ========== B1: override(같은 id) + provenance ==========
EFF="$($M effective --stage code-writing --l1 "$L1" 2>&1)" || fail "effective exit != 0"
echo "$EFF" | grep -q "R-CD01" || fail "R-CD01 effective 누락"
# R-CD01 의 provenance 가 L1 이어야 (L1>L0 승) — 비-vacuous: L0 버전이 아닌 L1 버전
# (포맷: 한 줄 '## R-CD01 (L1): title' — provenance 가 인라인 paren)
echo "$EFF" | grep -q "^## R-CD01 (L1):" || fail "R-CD01 provenance 가 L1 아님 (override 안 됨 = vacuous)"
echo "$EFF" | grep -q "^## R-CD01 (L1): SOLID 내스타일" || fail "effective 가 L0 R-CD01 을 그대로 둠 (override 실패)"
# 신규 L1 룰 provenance
echo "$EFF" | grep -q "R-USER-LANG" || fail "L1 신규 룰(wildcard) 머지 누락"
# stage 필터: architecture 전용 R-AR01 은 code-writing effective 에 없어야
echo "$EFF" | grep -q "R-AR01" && fail "stage 필터 실패 (R-AR01 가 code-writing 에 샘)"
# 충돌 리포트에 overridden 기록
$M conflicts --l1 "$L1" 2>&1 | grep -q "overridden: R-CD01@L0" || fail "override 충돌 리포트 누락"

# ========== B2: invariant 보호 ==========
# R-USER-WIP 가 R-PG01(invariant) override 시도 → 보호. effective 에 R-PG01 유지, R-USER-WIP 거부
EFFALL="$($M effective --l1 "$L1" 2>&1)" || fail "effective(all) exit != 0"
# 포맷: invariant 는 한 줄 '## R-PG01 (L0!): ...' 의 '!' 마커
echo "$EFFALL" | grep -q "^## R-PG01 (L0!):" || fail "invariant R-PG01 effective 누락/태그 없음"
echo "$EFFALL" | grep -q "R-USER-WIP" && fail "invariant override 시도(R-USER-WIP)가 거부 안 되고 살아있음"
$M conflicts --l1 "$L1" 2>&1 | grep -q "invariant_protected: R-PG01" || fail "invariant_protected 충돌 리포트 누락"

# ========== B3: same-layer 같은 id → 차단(비해석) ==========
L1DUP="$TMP/dup.md"
cat > "$L1DUP" <<'MD'
## R-DUP: 첫번째
Layer: L1
Stage: *
Why: a

## R-DUP: 두번째
Layer: L1
Stage: *
Why: b
MD
if $M effective --l1 "$L1DUP" >/dev/null 2>&1; then
  fail "same-layer 중복 id 인데 effective 가 exit 0 (자동선택 = AP-26 위반)"
fi
$M conflicts --l1 "$L1DUP" 2>&1 | grep -q "same_layer_dup: R-DUP" || fail "same_layer_dup 리포트 누락"

# ========== B4: user-rules-init 라운드트립 + stage 어휘 일치(F1) + WIP 투명 거부(F2) ==========
export HARNESS_HOME="$TMP/.harness"
UR="$HARNESS_HOME/user-rules.md"
python3 "$INIT" init --lang "Python 3.12 / FastAPI" --pointer-python "pyproject.toml" --wip "1" \
  >/dev/null 2>&1 || fail "user-rules-init exit != 0"
RT="$($M effective --l1 "$UR" 2>&1)" || fail "라운드트립 effective exit != 0"
echo "$RT" | grep -q "R-USER-LANG01" || fail "init 생성 lang 룰을 엔진이 파싱 못함 (포맷 SSOT 깨짐)"
echo "$RT" | grep -q "R-USER-FMT-PY"  || fail "init 생성 pointer 룰 파싱 누락"
echo "$RT" | grep -q "R-USER-LANG01 (L1)" || fail "라운드트립 provenance L1 아님"
# F1: 생성 FMT 룰은 code-writing 어휘(L0 vocab) → stage-filtered load 에서 *살아야* 한다 (Micro 죽음 회귀 방지)
$M effective --stage code-writing --l1 "$UR" 2>&1 | grep -q "R-USER-FMT-PY" \
  || fail "init 생성 FMT 룰이 --stage code-writing 에서 안 잡힘 (stage 어휘 불일치 = 죽은 룰)"
# F2: WIP 룰은 additive(거짓 Overrides 금지) → effective 에 살아있고, override_target_missing 같은
#     허위 충돌도 없어야 (R-PG01 같은 틀린 타깃 안 씀)
echo "$RT" | grep -q "R-USER-WIP01" || fail "additive WIP 룰이 effective 에서 사라짐"
$M conflicts --l1 "$UR" 2>&1 | grep -q "override_target_missing" \
  && fail "생성 룰이 없는 타깃을 override 시도 (거짓 Overrides — F2 미해소)"

echo "rules-merge self-test: PASS"
