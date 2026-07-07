#!/usr/bin/env bash
# 완전 hermetic — tmp cwd 에 합성 cycles/ 를 만들어 실제 cycles 를 건드리지 않는다.
# (실제 active 사이클이 있어도 SKIP 없이 항상 본문 실행 — #007 close-runtime 사각 해소)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BR="python3 $HERE/bar-register.py"
RR="python3 $HERE/review-register.py"
RC="python3 $HERE/ratchet-check.py"
CC="python3 $HERE/close-cycle.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP" || exit 1
mkdir -p cycles
fail=0

mk_axis_cycle() {  # $1=cid $2=axis $3=value $4=direction  (열린 상태, B1 1개)
  local cid="$1"
  rm -rf "cycles/$cid"; mkdir -p "cycles/$cid"
  : > "cycles/$cid/bar.jsonl"; : > "cycles/$cid/review.jsonl"
  $BR register --cycle "$cid" --id B1 --stage test --criterion c --measure m \
      --axis "$2" --value "$3" --direction "$4" >/dev/null
}

# prior: coverage>=80 (higher_better), pass 리뷰 결박 + closed
mk_axis_cycle 20260101-prior coverage 80 higher_better
$RR register --cycle 20260101-prior --id R1 --criterion-id B1 --verdict pass \
    --evidence e --reviewer t >/dev/null
printf '{"cycle_id":"20260101-prior","status":"closed"}\n' > cycles/20260101-prior/metrics.json

# floor 가 coverage=80 노출
$RC floor 2>/dev/null | grep -q 'coverage.*80' || { echo "FAIL floor: coverage 80 미노출"; fail=1; }

# 1) 회귀 70<80 → check exit 2
mk_axis_cycle _cur coverage 70 higher_better
if $RC check --cycle _cur >/dev/null 2>&1; then echo "FAIL 1: 회귀(70<80) check 통과됨"; fail=1; fi

# 2) 동률 80=80 → exit 0 (단조 *비감소* 허용)
mk_axis_cycle _cur coverage 80 higher_better
$RC check --cycle _cur >/dev/null 2>&1 || { echo "FAIL 2: 동률(80) 차단됨"; fail=1; }

# 3) 개선 90>80 → exit 0
mk_axis_cycle _cur coverage 90 higher_better
$RC check --cycle _cur >/dev/null 2>&1 || { echo "FAIL 3: 개선(90) 차단됨"; fail=1; }

# 4) 미선언 축(latency) → coverage 검사 안 함 → exit 0 (오탐 0)
mk_axis_cycle _cur latency 100 lower_better
$RC check --cycle _cur >/dev/null 2>&1 || { echo "FAIL 4: 무관 축인데 false block"; fail=1; }

# 5) direction 뒤집기 (coverage 를 lower_better 로) → 차단 exit 2
mk_axis_cycle _cur coverage 999 lower_better
if $RC check --cycle _cur >/dev/null 2>&1; then echo "FAIL 5: direction 뒤집기 통과됨"; fail=1; fi

# 6) close 통합 — active cycle 이 회귀(70) → close exit 2 + symlink 보존
rm -rf cycles/_close; mkdir -p cycles/_close
: > cycles/_close/bar.jsonl; : > cycles/_close/review.jsonl; : > cycles/_close/blackbox.jsonl
printf '{"cycle_id":"_close","status":"active"}\n' > cycles/_close/metrics.json
$BR register --cycle _close --id B1 --stage test --criterion c --measure m \
    --axis coverage --value 70 --direction higher_better >/dev/null
$RR register --cycle _close --id R1 --criterion-id B1 --verdict pass --evidence e --reviewer t >/dev/null
ln -sfn _close cycles/active
if $CC >/dev/null 2>&1; then echo "FAIL 6: ratchet 회귀인데 close 됨"; fail=1; fi
[ -L cycles/active ] || { echo "FAIL 6: 차단인데 symlink 사라짐"; fail=1; }

# 7) 같은 축 더 나은 값(80) 추가 잠금 → best-of 로 floor 충족 → close exit 0
$BR register --cycle _close --id B2 --stage test --criterion c2 --measure m2 \
    --axis coverage --value 80 --direction higher_better >/dev/null
$RR register --cycle _close --id R2 --criterion-id B2 --verdict pass --evidence e --reviewer t >/dev/null
$CC >/dev/null 2>&1 || { echo "FAIL 7: 80 으로 올렸는데 close 안 됨"; fail=1; }
[ -L cycles/active ] && { echo "FAIL 7: 통과인데 symlink 남음"; fail=1; }

# 8) lower_better 회귀 (#013c rank1 — mechanism-count/inject-tokens 축의 실효 teeth)
#    floor: mechcount=27 (lower_better, pass+closed). 값이 *오르면* 회귀여야 한다.
mk_axis_cycle 20260102-lb mechcount 27 lower_better
$RR register --cycle 20260102-lb --id R1 --criterion-id B1 --verdict pass \
    --evidence e --reviewer t >/dev/null
printf '{"cycle_id":"20260102-lb","status":"closed"}\n' > cycles/20260102-lb/metrics.json
$RC floor 2>/dev/null | grep -q 'mechcount.*27.*lower_better' || { echo "FAIL 8a: mechcount floor 미노출"; fail=1; }

mk_axis_cycle _cur mechcount 28 lower_better   # 28>27 = 빼기없는 더하기 → 차단
if $RC check --cycle _cur >/dev/null 2>&1; then echo "FAIL 8b: lower_better 회귀(28>27) 통과됨"; fail=1; fi

# 9) lower_better 동률(27) → 단조 비감소 허용 → exit 0
mk_axis_cycle _cur mechcount 27 lower_better
$RC check --cycle _cur >/dev/null 2>&1 || { echo "FAIL 9: lower_better 동률(27) 차단됨"; fail=1; }

# 10) lower_better 개선(26<27) → exit 0 (은퇴/경량화 방향)
mk_axis_cycle _cur mechcount 26 lower_better
$RC check --cycle _cur >/dev/null 2>&1 || { echo "FAIL 10: lower_better 개선(26) 차단됨"; fail=1; }

# 11) accept-new-baseline (F3): floor mechcount=27. 일반 28 은 회귀 차단(8b)이지만
#     --baseline-reset 선언은 *의도된 신규 baseline* → 회귀로 막지 않음(exit 0).
rm -rf cycles/_cur; mkdir -p cycles/_cur
: > cycles/_cur/bar.jsonl; : > cycles/_cur/review.jsonl
$BR register --cycle _cur --id B1 --stage test --criterion c --measure m \
    --axis mechcount --value 28 --direction lower_better --baseline-reset >/dev/null
$RC check --cycle _cur >/dev/null 2>&1 || { echo "FAIL 11: baseline-reset(28) 가 회귀로 차단됨"; fail=1; }

# 12) reset 바가 *closed+pass* 면 floor 가 신규 baseline(28)으로 *대체*(27 watermark 무시)
$RR register --cycle _cur --id R1 --criterion-id B1 --verdict pass --evidence e --reviewer t >/dev/null
printf '{"cycle_id":"_cur","status":"closed","closed_at":"2026-02-01T00:00:00+00:00"}\n' > cycles/_cur/metrics.json
$RC floor 2>/dev/null | grep -q 'mechcount.*28.*baseline-reset' || { echo "FAIL 12: reset 후 floor 가 28[baseline-reset]로 대체 안 됨"; fail=1; }

# 13) reset 후 floor=28 가 권위 → 일반(비-reset) 28 은 이제 통과(case 8b 와 대조:
#     reset 전엔 같은 28 이 차단됐다 → floor 가 27→28 로 *옮겨졌음*을 입증)
mk_axis_cycle _cur2 mechcount 28 lower_better
$RC check --cycle _cur2 >/dev/null 2>&1 || { echo "FAIL 13: reset 후 floor(28)인데 일반 28 이 차단됨"; fail=1; }

# 14) 그래도 29 는 차단 — reset 은 ratchet 을 끄는 게 아니라 baseline 만 옮긴다
mk_axis_cycle _cur3 mechcount 29 lower_better
if $RC check --cycle _cur3 >/dev/null 2>&1; then echo "FAIL 14: reset 후 29 가 통과됨(baseline 만 옮겨야)"; fail=1; fi

# ── H7: watermark tamper-evidence (닫힌 사이클 손상 → floor 안 내려감/차단) ────────────
# 청정 prior(coverage=80, closed+pass)와 회귀하는 현재(70)를 새로 세팅.
rm -rf cycles/20260101-prior cycles/_cur cycles/_cur2 cycles/_cur3 cycles/_close
mk_axis_cycle 20260101-prior coverage 80 higher_better
$RR register --cycle 20260101-prior --id R1 --criterion-id B1 --verdict pass --evidence e --reviewer t >/dev/null
printf '{"cycle_id":"20260101-prior","status":"closed","closed_at":"2026-01-01T00:00:00+00:00"}\n' > cycles/20260101-prior/metrics.json
mk_axis_cycle _cur coverage 70 higher_better   # 70<80 = 회귀

# H7a) review.jsonl 통째 비우기 → pass-결박 소실. 체인은 (공백=유효) 통과하지만 close-time
#      불변식이 깨져 tamper 탐지 → floor 가 *조용히* 안 내려가고 현재(70)는 여전히 차단.
: > cycles/20260101-prior/review.jsonl
if $RC check --cycle _cur >/dev/null 2>&1; then echo "FAIL H7a: review 비우기로 floor 리셋되어 회귀(70) 통과됨"; fail=1; fi

# H7b) bar.jsonl 값 위조(80→999) → 체인 깨짐 → 위조 floor 채택 안 함 + 차단 유지.
mk_axis_cycle 20260101-prior coverage 80 higher_better
$RR register --cycle 20260101-prior --id R1 --criterion-id B1 --verdict pass --evidence e --reviewer t >/dev/null
printf '{"cycle_id":"20260101-prior","status":"closed","closed_at":"2026-01-01T00:00:00+00:00"}\n' > cycles/20260101-prior/metrics.json
python3 - <<'PY'
import json
p="cycles/20260101-prior/bar.jsonl"
L=[json.loads(x) for x in open(p) if x.strip()]; L[0]["value"]=999.0
open(p,"w").write("\n".join(json.dumps(x,ensure_ascii=False) for x in L)+"\n")
PY
if $RC check --cycle _cur >/dev/null 2>&1; then echo "FAIL H7b: bar 값 위조(999)가 floor 로 채택되어 70 통과됨"; fail=1; fi

# H7c) close 통합 — 청정한 active(coverage 85)인데 prior 가 손상됨 → close 차단 + symlink 보존.
rm -rf cycles/_close; mk_axis_cycle _close coverage 85 higher_better
$RR register --cycle _close --id R1 --criterion-id B1 --verdict pass --evidence e --reviewer t >/dev/null
printf '{"cycle_id":"_close","status":"active"}\n' > cycles/_close/metrics.json
: > cycles/_close/blackbox.jsonl
ln -sfn _close cycles/active
if $CC >/dev/null 2>&1; then echo "FAIL H7c: prior 손상인데 close 됨"; fail=1; fi
[ -L cycles/active ] || { echo "FAIL H7c: 차단인데 symlink 사라짐"; fail=1; }
rm -f cycles/active

# H7d) 손상 복구(정상 재기록) 시 false-positive 없음 — 정직한 개선(90)은 통과해야.
mk_axis_cycle 20260101-prior coverage 80 higher_better
$RR register --cycle 20260101-prior --id R1 --criterion-id B1 --verdict pass --evidence e --reviewer t >/dev/null
printf '{"cycle_id":"20260101-prior","status":"closed","closed_at":"2026-01-01T00:00:00+00:00"}\n' > cycles/20260101-prior/metrics.json
mk_axis_cycle _cur coverage 90 higher_better
$RC check --cycle _cur >/dev/null 2>&1 || { echo "FAIL H7d: 복구 후 정직한 개선(90)이 false block"; fail=1; }

# ── H6: ratchet opt-out 가시화 (측정축 0개로 닫히면 blackbox 에 흔적) ──────────────────
# 축 메타 없는 바(자유텍스트) → 측정축 0개 → close 시 ratchet-opt-out 기록(축 강제 X).
rm -rf cycles/_optout; mkdir -p cycles/_optout
: > cycles/_optout/bar.jsonl; : > cycles/_optout/review.jsonl; : > cycles/_optout/blackbox.jsonl
printf '{"cycle_id":"_optout","status":"active"}\n' > cycles/_optout/metrics.json
$BR register --cycle _optout --id B1 --stage test --criterion c --measure m >/dev/null   # --axis 없음
$RR register --cycle _optout --id R1 --criterion-id B1 --verdict pass --evidence e --reviewer t >/dev/null
ln -sfn _optout cycles/active
$CC >/dev/null 2>&1 || { echo "FAIL H6a: 축 없는 사이클 close 실패"; fail=1; }
grep -q '"kind": "ratchet-opt-out"' cycles/_optout/blackbox.jsonl || { echo "FAIL H6a: opt-out 미기록"; fail=1; }
grep -q '"cycle": "_optout"' cycles/_optout/blackbox.jsonl || { echo "FAIL H6a: opt-out cycle 필드 누락"; fail=1; }
rm -f cycles/active

# H6b) 멱등 — 헬퍼를 다시 호출해도(close 재시도 모사) opt-out 은 1건 유지.
HERE_PY="$HERE" python3 - <<'PY'
import os, sys
sys.path.insert(0, os.environ["HERE_PY"])
import ratchetlib
from pathlib import Path
ratchetlib.record_opt_out_if_no_axes(Path("cycles/_optout"), "_optout")  # 2회차
PY
n=$(grep -c '"kind": "ratchet-opt-out"' cycles/_optout/blackbox.jsonl)
[ "$n" = "1" ] || { echo "FAIL H6b: opt-out 중복 기록 (n=$n, want 1)"; fail=1; }

# H6c) 축이 *있는* 사이클은 opt-out 안 남김(=ratchet 대상이라 흔적 불필요).
rm -rf cycles/_withaxis; mk_axis_cycle _withaxis coverage 95 higher_better
$RR register --cycle _withaxis --id R1 --criterion-id B1 --verdict pass --evidence e --reviewer t >/dev/null
: > cycles/_withaxis/blackbox.jsonl
printf '{"cycle_id":"_withaxis","status":"active"}\n' > cycles/_withaxis/metrics.json
ln -sfn _withaxis cycles/active
$CC >/dev/null 2>&1 || { echo "FAIL H6c: 축 있는 사이클 close 실패"; fail=1; }
if grep -q '"kind": "ratchet-opt-out"' cycles/_withaxis/blackbox.jsonl; then echo "FAIL H6c: 축 있는데 opt-out 기록됨"; fail=1; fi
rm -f cycles/active

[ $fail -eq 0 ] && echo "ratchet-check self-test: PASS"
exit $fail
