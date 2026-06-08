#!/usr/bin/env bash
# test-runtime-wiring.sh — hermetic self-test for the RUNTIME WIRING CONTRACT.
# 컨벤션: test-rule-inject.sh. claude 불필요(hermetic) — 단 개별 hook 테스트가 *놓치는* 틈을 메운다.
#
# 왜 필요(RT-2): 개별 test-*.sh 는 각 hook/script 를 *단독*으로 친다. 그래서 hook 스크립트를
# 이름만 바꾸고 hooks.json 을 안 고치거나, 스킬 디렉터리/frontmatter 가 깨지면 — 개별 테스트는
# 여전히 PASS 인데 *런타임에선 claude 가 hook/스킬을 못 찾아 조용히 0/7 발화*가 된다(침묵의 퇴행).
# 2026-06-04 시운전(`review/2026-06-04-shakedown-result.md` §런타임)에서 claude -p --plugin-dir 로
# 7/7 런타임 발화를 *한 번* 확인했다. 이 테스트는 그 7/7 을 가능케 하는 **배선 계약**을 매 회귀마다
# 무비용(no-claude)으로 잠근다. 라이브 골드 체크는 `runtime-smoke.sh`(opt-in) 가 별도로 본다.
#
# 검증(배선 계약):
#   W1 hooks.json valid JSON
#   W2 hooks.json 이 참조하는 모든 command 스크립트가 export 에 *실재*(참조↔파일 정합)
#   W3 필수 배선 존재: SessionStart⊇rule-inject · PreToolUse(Edit매처)⊇{hypothesis-immutability,stage-inject,phase-guard}
#      · PreToolUse(Bash매처)⊇{phase-guard,active-symlink-guard}
#   W4 plugin.json valid + name==harness
#   W5 스킬 discoverable: skills/{cycle,install,plan,work,review}/SKILL.md 에 name·description frontmatter 존재
#      (런타임 harness:* 자동트리거의 전제 — 깨지면 스킬이 조용히 사라짐)
#   W6 런타임-등가 주입(hermetic mirror): export 의 rule-inject 가 경계+invariant L0 주입·R-CD 부재
# populated L0(export 컨텍스트)로 빌드해 친다 — draft 는 L0=0이라 vacuous.
set -u
cd "$(dirname "$0")" || exit 1   # scripts 디렉토리
fail=0
note() { echo "  - $1"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
python3 "./harness-export.py" --dest "$TMP/h" >/dev/null 2>&1 \
  || { echo "FAIL: harness-export 실패 — 테스트 전제(populated export) 불가"; exit 1; }
EXP="$TMP/h"

# ── W1–W5: 구조 계약 (python 으로 JSON 정합·discoverability) ──
python3 - "$EXP" <<'PY'
import json, sys, os, re, glob
exp = sys.argv[1]
fail = 0
def bad(m):
    global fail; print(f"  - FAIL: {m}"); fail = 1

# W1 hooks.json valid
hj_path = os.path.join(exp, "hooks", "hooks.json")
try:
    hj = json.load(open(hj_path))
except Exception as e:
    bad(f"hooks.json 파싱 불가 — {e}"); print("WIRING_FAIL"); sys.exit(1)

groups = hj.get("hooks", {})

def cmds(event, matcher_substr=None):
    """event 그룹에서 (matcher 포함 시) command 문자열들을 모은다."""
    out = []
    for g in groups.get(event, []):
        if matcher_substr is not None and matcher_substr not in g.get("matcher", ""):
            continue
        for h in g.get("hooks", []):
            if h.get("type") == "command":
                out.append(h.get("command", ""))
    return out

def scripts_in(cmds_list):
    """command 들에서 ${CLAUDE_PLUGIN_ROOT}/<path> 의 <path> 만 뽑는다."""
    paths = []
    for c in cmds_list:
        for m in re.findall(r'\$\{CLAUDE_PLUGIN_ROOT\}/(\S+)', c):
            paths.append(m)
    return paths

# W2 모든 참조 스크립트 실재
all_cmds = [c for ev in groups for g in groups[ev] for h in g.get("hooks", []) if (c := h.get("command",""))]
for rel in scripts_in(all_cmds):
    if not os.path.isfile(os.path.join(exp, rel)):
        bad(f"hooks.json 참조 스크립트 부재: {rel} (rename 후 hooks.json 미갱신?)")

# W3 필수 배선
ss = scripts_in(cmds("SessionStart"))
if not any(p.endswith("rule-inject.py") for p in ss):
    bad("SessionStart 에 rule-inject.py 미배선 — 룰 자동주입 런타임 사라짐")
edit = scripts_in(cmds("PreToolUse", "Edit"))
for need in ("hypothesis-immutability.py", "stage-inject.py", "phase-guard.py"):
    if not any(p.endswith(need) for p in edit):
        bad(f"PreToolUse(Edit 매처)에 {need} 미배선 — 차단/단계주입 런타임 사라짐")
bash = scripts_in(cmds("PreToolUse", "Bash"))
if not any(p.endswith("phase-guard.py") for p in bash):
    bad("PreToolUse(Bash 매처)에 phase-guard.py 미배선 — Bash 코드생성 우회 차단 사라짐")
if not any(p.endswith("active-symlink-guard.py") for p in bash):
    bad("PreToolUse(Bash 매처)에 active-symlink-guard.py 미배선 — 수동우회 차단 사라짐")

# W4 plugin.json
pj_path = os.path.join(exp, ".claude-plugin", "plugin.json")
try:
    pj = json.load(open(pj_path))
    if pj.get("name") != "harness":
        bad(f"plugin.json name != harness (={pj.get('name')!r})")
except Exception as e:
    bad(f"plugin.json 파싱 불가 — {e}")

# W5 스킬 discoverability
for skill in ("cycle", "install", "plan", "work", "review"):
    sk = os.path.join(exp, "skills", skill, "SKILL.md")
    if not os.path.isfile(sk):
        bad(f"스킬 {skill}/SKILL.md 부재 — harness:{skill} 런타임 트리거 불가"); continue
    head = open(sk, encoding="utf-8").read(2000)
    if not re.search(r'(?m)^name:\s*\S', head):
        bad(f"스킬 {skill}: frontmatter name 누락 — 등록 실패 위험")
    if not re.search(r'(?m)^description:\s*', head):
        bad(f"스킬 {skill}: frontmatter description 누락 — 자동트리거 신뢰도 0")

print("WIRING_FAIL" if fail else "WIRING_OK")
sys.exit(1 if fail else 0)
PY
[ $? -eq 0 ] || fail=1

# ── W6: 런타임-등가 주입 (hermetic mirror of claude SessionStart) ──
HOOK="$EXP/hooks/rule-inject.py"
H0="$TMP/u0"; mkdir -p "$H0/.harness"   # 빈 L1
out="$(HARNESS_HOME="$H0/.harness" python3 "$HOOK" 2>/dev/null)"; rc=$?
[ "$rc" -eq 0 ] || { note "FAIL: rule-inject exit=$rc (기대 0)"; fail=1; }
echo "$out" | grep -q "\[harness\]" \
  || { note "FAIL: SessionStart 경계 문구 부재 — 런타임 주입 인지 불가"; fail=1; }
echo "$out" | grep -qE "^## R-PG01 \(L0!\): " \
  || { note "FAIL: invariant L0(R-PG01) 미주입 — 런타임 룰 도달 실패"; fail=1; }
echo "$out" | grep -qE "^## R-CD0" \
  && { note "FAIL: R-CD 코딩룰이 SessionStart 에 누출 — 계약 위반(stage-inject 몫)"; fail=1; }

[ $fail -eq 0 ] && echo "runtime-wiring self-test: PASS (hooks.json↔파일 정합 · 필수배선 3종 · 스킬 5종 discoverable · 주입계약)"
exit $fail
