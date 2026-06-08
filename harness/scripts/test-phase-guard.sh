#!/usr/bin/env bash
# test-phase-guard.sh — phase-guard hook + phase-advance + feedback 기록 hermetic self-test (#013b, H1/H2).
#   B1: active 없음/analysis/design/planning + 코드파일 → 차단(exit2); tech decision doc은 active 없음에서 차단
#   B2: phase-advance 인접 전진 허용 + metrics 갱신; 스킵·역행 거부
#   B3: 차단 시 .claude/.feedback/feedback.jsonl 에 구조화 1줄; 기록 실패해도 차단 exit2 불변
#   B4: 새 phase_gates 는 evidence/user-confirm 없이는 전진 차단 + H2 confirmation-note 강제
#   H1: phase-guard 는 metrics.json 이 아니라 *검증된 phase.jsonl chain* 에서 phase 도출
#       → metrics 직접편집 위조·체인 손상으로 게이트 우회 불가
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$HERE/../hooks/phase-guard.py"
ADVANCE="$HERE/phase-advance.py"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $1"; exit 1; }

# ---- 합성 fixture: active 사이클 ----
P="$TMP/proj"; CY="20260605-fixture"
mkdir -p "$P/cycles/$CY" "$P/docs"
ln -s "$CY" "$P/cycles/active"
CHAIN="$P/cycles/$CY/phase.jsonl"
META="$P/cycles/$CY/metrics.json"

# seed_chain: target phase 까지 도달하는 *유효 hash chain* 을 phase.jsonl 에 생성.
#   $1 = target phase ; $2 = met|empty (pre-code 게이트 evidence/confirm 충족 여부)
# metrics.current_phase 도 함께 써서 "metrics 와 chain 이 일치하는 정상 상태" 를 만든다.
seed_chain() {
  python3 - "$HERE" "$P/cycles/$CY" "$1" "${2:-empty}" <<'PY'
import sys, json
from pathlib import Path
sys.path.insert(0, sys.argv[1])  # scripts/ (chainlog)
import chainlog
cdir = Path(sys.argv[2]); target = sys.argv[3]; mode = sys.argv[4]
PHASES = ["analysis", "design", "planning", "implementation", "validation"]
COLLAB = {"design", "planning"}
EV = {"analysis": ["docs/analysis.md"], "design": ["docs/design.md"], "planning": ["docs/plan.md"]}
chain = cdir / "phase.jsonl"
chain.write_text("", encoding="utf-8")  # reset
for i in range(PHASES.index(target)):
    cur, nxt = PHASES[i], PHASES[i + 1]
    met = (mode == "met")
    chainlog.append_entry(chain, {
        "id": f"{cur}->{nxt}", "from": cur, "to": nxt, "completed_phase": cur,
        "evidence": EV.get(cur, []) if met else [],
        "user_confirmed": True if (met or cur not in COLLAB) else False,
        "collaborative": cur in COLLAB,
        "confirmation_note": "test 합의" if (met and cur in COLLAB) else None,
        "gate_forced": False,
    })
(cdir / "metrics.json").write_text(json.dumps({"current_phase": target}, ensure_ascii=False), encoding="utf-8")
PY
}

run_guard() { # $1=tool $2=file → exit code
  ( cd "$P" && echo "{\"tool_name\":\"$1\",\"tool_input\":{\"file_path\":\"$2\"}}" \
    | CLAUDE_PROJECT_DIR="$P" python3 "$GUARD" >/dev/null 2>&1 ); echo $?
}
run_bash_guard() { # $1=command → exit code
  ( cd "$P" && python3 -c 'import json,sys; print(json.dumps({"tool_name":"Bash","tool_input":{"command":sys.argv[1]}}))' "$1" \
    | CLAUDE_PROJECT_DIR="$P" python3 "$GUARD" >/dev/null 2>&1 ); echo $?
}

# 게이트 충족 케이스용 evidence 파일
echo a > "$P/docs/analysis.md"; echo d > "$P/docs/design.md"; echo p > "$P/docs/plan.md"

# ========== B1: 차단/통과 매트릭스 (chain 기반) ==========
seed_chain analysis
[ "$(run_guard Edit src/app.py)" = "2" ]   || fail "analysis + .py Edit 가 차단(exit2) 안 됨"
seed_chain design
[ "$(run_guard Edit src/app.py)" = "2" ]   || fail "design + .py Edit 가 차단(exit2) 안 됨"
seed_chain planning
[ "$(run_guard Write lib/x.kt)" = "2" ]     || fail "planning + .kt Write 가 차단 안 됨"
seed_chain planning
[ "$(run_bash_guard "cat > src/app.py")" = "2" ] || fail "planning + Bash redirection .py 가 차단 안 됨"
seed_chain planning
[ "$(run_bash_guard "pytest src/app.py")" = "0" ] || fail "planning + Bash read/test 명령이 오탐 차단됨"
seed_chain design
[ "$(run_guard Edit docs/design.md)" = "0" ] || fail "design + 평문 .md 가 통과 안 됨(설계문서 차단=거짓양성)"
seed_chain implementation empty
[ "$(run_guard Edit src/app.py)" = "2" ]    || fail "implementation 이지만 pre-code gate 미충족인데 .py 가 허용됨"
seed_chain implementation met
[ "$(run_guard Edit src/app.py)" = "0" ]    || fail "implementation + pre-code gate 충족인데 .py 가 통과 안 됨"
seed_chain design
[ "$(run_guard Read src/app.py)" = "0" ]    || fail "Read(비편집 도구) 가 통과 안 됨"

# active 없음 → 차단
rm "$P/cycles/active"
[ "$(run_guard Edit src/app.py)" = "2" ]    || fail "active 없음인데 코드 변경이 허용됨"
[ "$(run_guard Edit notes/todo.md)" = "0" ] || fail "active 없음 + 일반 .md 문서 작업이 오탐 차단됨"
[ "$(run_guard Edit docs/architecture.md)" = "2" ] || fail "active 없음 + architecture 문서가 허용됨"
[ "$(run_guard Edit docs/adr/0001-choice.md)" = "2" ] || fail "active 없음 + ADR 문서가 허용됨"
[ "$(run_bash_guard "cat > docs/design-doc.md")" = "2" ] || fail "active 없음 + Bash design-doc 생성이 허용됨"
ln -s "$CY" "$P/cycles/active"
seed_chain design
[ "$(run_guard Edit docs/architecture.md)" = "0" ] || fail "active cycle 내부 tech decision doc 이 오탐 차단됨"

# ========== H1: metrics 위조·체인 손상으로 게이트 우회 불가 ==========
# (a) metrics.json 을 implementation + 충족 게이트로 위조하되 chain 은 analysis(빈 체인) → 여전히 차단
seed_chain analysis
python3 - "$META" <<'PY'
import json, sys
p = sys.argv[1]; m = json.load(open(p))
m["current_phase"] = "implementation"
m["phase_gates"] = {
    "analysis": {"type": "solo", "evidence": ["docs/analysis.md"], "user_confirmed": True},
    "design": {"type": "collaborative", "evidence": ["docs/design.md"], "user_confirmed": True},
    "planning": {"type": "collaborative", "evidence": ["docs/plan.md"], "user_confirmed": True},
}
json.dump(m, open(p, "w"), ensure_ascii=False)
PY
[ "$(run_guard Edit src/app.py)" = "2" ] || fail "H1: metrics 직접편집 위조(implementation+게이트)로 코드가 허용됨 — 게이트 우회!"

# (b) 유효 chain(implementation met) 을 만들고 마지막 라인 hash 를 깨뜨림 → tampered 전면차단
seed_chain implementation met
python3 - "$CHAIN" <<'PY'
import sys
p = sys.argv[1]
lines = open(p, encoding="utf-8").read().splitlines()
lines[-1] = lines[-1].replace('"hash": "', '"hash": "deadbeef')  # hash 변조
open(p, "w", encoding="utf-8").write("\n".join(lines) + "\n")
PY
[ "$(run_guard Edit src/app.py)" = "2" ]      || fail "H1: 체인 hash 변조 상태인데 코드가 허용됨"
[ "$(run_guard Edit docs/architecture.md)" = "2" ] || fail "H1: 체인 변조 상태인데 tech-doc 이 허용됨(전면차단 위반)"

# (c) chain 파일 삭제(우회 시도) → 코드 계속 차단
seed_chain implementation met
rm -f "$CHAIN"
[ "$(run_guard Edit src/app.py)" = "2" ] || fail "H1: phase.jsonl 삭제로 코드가 허용됨"

# ========== B3: feedback 기록 ==========
rm -rf "$P/.claude/.feedback"
seed_chain design
RC="$(run_guard Edit src/secret.py)"
[ "$RC" = "2" ] || fail "feedback 케이스에서 차단 exit2 아님"
FB="$P/.claude/.feedback/feedback.jsonl"
[ -f "$FB" ] || fail ".feedback/feedback.jsonl 미생성(B3 기록 실패)"
grep -q '"hook": "phase-guard"' "$FB"   || fail "feedback 에 hook 키 없음"
grep -q '"event":'              "$FB"   || fail "feedback 에 event 키 없음"
grep -q 'secret.py'             "$FB"   || fail "feedback detail 에 파일명 없음"
LINES="$(wc -l < "$FB" | tr -d '[:space:]')"; [ "$LINES" = "1" ] || fail "feedback 1줄 기대, 실제 $LINES"

# B3 fail-soft: feedback 디렉토리를 못 쓰게 해도 차단 exit2 불변
rm -rf "$P/.claude/.feedback"; mkdir -p "$P/.claude"; : > "$P/.claude/.feedback"
seed_chain design
RC2="$( cd "$P" && CLAUDE_PROJECT_DIR="$P" bash -c \
  'echo "{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\"a.py\"}}" | python3 "'"$GUARD"'" >/dev/null 2>&1'; echo $? )"
[ "$RC2" = "2" ] || fail "feedback 기록 불가 상황에서 차단 exit2 가 깨짐(fail-soft 위반)"
rm -f "$P/.claude/.feedback"

# ========== B2: phase-advance 전환 ==========
adv() { ( cd "$P" && python3 "$ADVANCE" "$@" >/dev/null 2>&1 ); echo $?; }
cur_phase() { ( cd "$P" && python3 "$ADVANCE" --show 2>/dev/null ); }

: > "$CHAIN"  # chain 리셋(B1/H1 잔여 제거)
echo '{"current_phase": "analysis"}' > "$META"
[ "$(adv design)" = "0" ]        || fail "analysis→design 인접 전진 거부됨"
[ "$(cur_phase)" = "design" ]    || fail "전진 후 current_phase 가 design 아님(갱신 실패)"
[ "$(adv analysis)" != "0" ]     || fail "design→analysis 역행이 허용됨"
echo '{"current_phase": "analysis"}' > "$META"
[ "$(adv implementation)" != "0" ] || fail "analysis→implementation 스킵이 허용됨"
echo '{"current_phase": "analysis"}' > "$META"
[ "$(adv implementation --force)" = "0" ] || fail "--force 스킵이 거부됨"
[ "$(cur_phase)" = "implementation" ]     || fail "--force 후 phase 갱신 실패"
grep -q '"kind": "phase-force"' "$P/cycles/$CY/blackbox.jsonl" || fail "--force 가 blackbox 에 기록 안 됨"
# 전진은 phase.jsonl chain 에도 append 되어야 한다 (H1 기록자)
grep -q '"completed_phase"' "$CHAIN" || fail "phase-advance 가 phase.jsonl chain 에 기록 안 함"

# ========== B4: phase_gates evidence/confirm + H2 confirmation-note 강제 ==========
: > "$CHAIN"
python3 - "$META" <<'PY'
import json, sys
p = sys.argv[1]
json.dump({
  "current_phase": "analysis",
  "phase_gates": {
    "analysis": {"type": "solo", "evidence": [], "user_confirmed": True},
    "design": {"type": "collaborative", "evidence": [], "user_confirmed": False},
    "planning": {"type": "collaborative", "evidence": [], "user_confirmed": False},
    "implementation": {"type": "solo", "evidence": [], "user_confirmed": True},
    "validation": {"type": "solo", "evidence": [], "user_confirmed": True},
  },
}, open(p, "w"), ensure_ascii=False)
PY
[ "$(adv design)" != "0" ] || fail "phase_gates 있는데 evidence 없이 analysis→design 이 허용됨"
echo "# analysis" > "$P/docs/analysis.md"
[ "$(adv design --evidence docs/analysis.md)" = "0" ] || fail "evidence 있는 analysis→design 이 거부됨"
[ "$(cur_phase)" = "design" ] || fail "evidence 전진 후 current_phase 가 design 아님"
echo "# design" > "$P/docs/design.md"
[ "$(adv planning --evidence docs/design.md)" != "0" ] || fail "collaborative design 이 confirm 없이 전진 허용됨"
# H2: collaborative confirm 에는 --confirmation-note 필수
[ "$(adv planning --evidence docs/design.md --confirm-user)" != "0" ] || fail "H2: confirmation-note 없는 --confirm-user 가 허용됨"
[ "$(adv planning --evidence docs/design.md --confirm-user --confirmation-note "design v2 §3 승인")" = "0" ] || fail "note 있는 design→planning 이 거부됨"
# note 가 chain 에 감사 기록으로 박혀야 한다
grep -q 'design v2' "$CHAIN" || fail "H2: confirmation-note 가 phase.jsonl chain 에 기록 안 됨"

echo "phase-guard self-test: PASS"
