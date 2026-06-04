# 시운전 Metascript — 첫 clean-room End-to-End 가동

> **목적**: GOAL §2 흐름 `[1]설치 → [7]회고`를 *한 번* 실제로 돌려, 빌드 green이 아니라
> **기계장치가 실제로 발화하는지**를 본다. 이건 *측정*이지 빌드가 아니다 — H1(`harness:cycle`이
> 실제 호출되나)·#005(실제 claude 환경 hook 통합)의 첫 닫힘.
>
> **왜 지금까지 안 닫혔나**: 모든 테스트가 hermetic self-test고, dogfood는 항상 repo 안에서
> 하네스를 *다 아는* 채 돈다(CV-1). 시운전 = 그 두 편향을 *동시에* 벗는 첫 가동.
>
> 작성 2026-06-04 · 상태 스냅샷: self-test 12/12 PASS · plugin `harness ./harness 0.2.0` 등록 ·
> draft↔export 06-rules 동기화 · 2-tier 주입(SessionStart `rule-inject` + PreToolUse `stage-inject`).

---

## 시운전 성공 기준 (이 metascript 자신의 Gate — GOAL §3 제약 1–5 사상)

| Gate | 무엇이 발화해야 | 관측 방법 | 통과 조건 |
|---|---|---|---|
| **S1 설치** | clean-room copy 설치 + python3 preflight + `user-rules.md` 생성 | Phase 1 | 산출물 존재, STOP 없음 |
| **S2 대화 초기화** | install 스킬이 *대화로* L1 생성(수동 파일 작성 아님) | Phase 2 | `~/.harness/user-rules.md`가 답변에서 나옴 |
| **S3 AI 작동** | SessionStart `rule-inject`(invariant+L1, ~385tok, R-CD **부재**) · 첫 Edit에 `stage-inject`(R-CD **도착**) | Phase 1 직접 호출 + Phase 2 black box | 두 시점 출력이 계약대로 |
| **S4 단계 적용** | `cycle-init` scaffold · `hypothesis-immutability` tamper 차단 · `close-cycle` 무리뷰 차단 · ratchet 회귀 차단 | Phase 2 | 각 게이트가 *막아야 할 때 막음* |
| **S5 사이클 가치** | 1 사이클 후 "도움 됐다" 말할 수 있나 | Phase 3 회고 | 정직한 yes/no + 근거 |

> 한 줄이라도 **SILENT(발화 안 함)** 또는 **FAILED**면 시운전은 *실패가 아니라 발견* — Phase 3에서
> TODO/devils-advocate로 적재한다. null 결과를 정직히 기록(PF-8 교훈).

---

## Phase 0 — 출하 가능 preflight  ✅ (2026-06-04 green)

빌드가 *애초에 설치 가능한가*. 이미 통과 — 시운전 전 재실행으로 회귀만 막는다.

```bash
cd _draft/harness-engineering/plugin/harness
for t in scripts/test-*.sh hooks/test-*.sh; do bash "$t" >/dev/null 2>&1 && echo "PASS $t" || echo "FAIL $t"; done
python3 -c "import json;json.load(open('.claude-plugin/plugin.json'));json.load(open('hooks/hooks.json'))" && echo "JSON OK"
diff -q ../../06-rules.md ../../../../harness/06-rules.md >/dev/null && echo "export 동기화" || echo "⚠ export drift — 재export 필요"
```

- [x] self-test 12/12 PASS · plugin/hooks JSON valid · export 동기화
- **⚠ 함정(TODO 79–88행)**: 위 self-test는 **draft**에서 돈다 → draft엔 `06-rules.md`(L0)가 없어
  주입 테스트가 *vacuous로 통과*(0<45 자명). **주입 계약은 반드시 export(`./harness`)에서 검증** → Phase 1.

---

## Phase 1 — Clean-room 설치 + 이음새 직접 검증  ⬅ **지금 실행 가능 (가장 빠른 de-risk)**

repo 밖처럼 `./harness`(export)를 임시 디렉터리에 *설치*하고, claude 런타임이 보낼 stdin을 직접
hook에 먹여 출력을 확인한다. claude 런타임 자체는 못 가짜내지만 **hook script의 발화 계약**은 여기서 닫는다.

```bash
ROOT=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d); export HOME="$TMP/home"; mkdir -p "$HOME"
cp -r "$ROOT/harness" "$TMP/plugin"; export CLAUDE_PLUGIN_ROOT="$TMP/plugin"

# S1: install 스킬 Step0–3 재현 (수동 아님 — 스크립트가 씀)
command -v python3 >/dev/null && echo "✓ python3"
python3 "$CLAUDE_PLUGIN_ROOT/scripts/user-rules-init.py" path
python3 "$CLAUDE_PLUGIN_ROOT/scripts/user-rules-init.py" init --lang "Python 3.12 / FastAPI" --pointer-python "pyproject.toml" --wip "1"
test -f "$HOME/.harness/user-rules.md" && echo "✓ S1 user-rules 생성" || echo "✗ S1 FAIL"

# S3a: SessionStart rule-inject — invariant+L1 만, R-CD 코딩룰 부재, ~385tok
echo '{}' | python3 "$CLAUDE_PLUGIN_ROOT/hooks/rule-inject.py" | tee "$TMP/sess.txt"
grep -q 'R-CD' "$TMP/sess.txt" && echo "✗ S3a FAIL — 코딩룰이 SessionStart에 샜다" || echo "✓ S3a R-CD 부재(=stage로 이관)"

# S3b: 첫 Edit = code-writing 진입 → stage-inject가 R-CD 주입 (additionalContext JSON)
echo '{"session_id":"shake","tool_name":"Edit","tool_input":{"file_path":"x.py"}}' \
  | python3 "$CLAUDE_PLUGIN_ROOT/hooks/stage-inject.py" | tee "$TMP/stage.txt"
grep -q 'R-CD' "$TMP/stage.txt" && echo "✓ S3b R-CD 코딩 진입 시 도착" || echo "✗ S3b FAIL — 코딩룰 미도달=기능저해"
```

체크:
- [ ] S1 — `user-rules.md` 생성, python3 preflight 통과
- [ ] S3a — SessionStart 출력에 invariant(R-PG/R-DoD/…) 있고 **R-CD 없음**, 토큰 ≈385
- [ ] S3b — stage-inject가 `hookSpecificOutput.additionalContext`로 **R-CD 도착** (기능보존 증명)
- [ ] 정리: `rm -rf "$TMP"` (clean-room은 흔적 없이)

> 여기서 빨강이 뜨면 **Phase 2(라이브 세션) 들어가기 전에** 고친다 — 라이브 세션 한 번이 비싸다.

---

## Phase 2 — 라이브 micro-cycle  ⬅ **사용자가 실제 claude 세션에서 구동 (시운전 본체)**

진짜 claude가 hook을 발화시키는 유일한 경로. *throwaway 토이 프로젝트* 하나에 1 사이클.
과제는 **작고 진짜**여야 한다(PF-8식 YAGNI 함정 불필요 — 이번 과녁은 "품질"이 아니라 "발화").

권장 토이: `GET /health` 1개 FastAPI 엔드포인트 + 테스트 1개. (인터페이스 명확, 검증 즉시, boring=원칙7)

순서 (각 단계 뒤 **black box**에 발화/침묵 기록):
1. 새 빈 디렉터리에서 claude 실행 → harness 플러그인 로드. **세션 시작 시 `rule-inject` 출력 보이나?**
2. `harness:install` → 대화로 user-rules 설정. **수동 파일작성 아닌 대화 흐름인가? (S2)**
3. `harness:cycle` → pre-cycle 게이트 → `cycle-init` scaffold. **`cycles/<id>/` 생겼나?**
4. 가설 등록 → 첫 Edit 시 **`stage-inject` R-CD 도착하나? (S3b 라이브)**
5. 가설 파일 *수동 변조 시도* → **`hypothesis-immutability`가 막나? (S4)**
6. 구현 → 테스트 → `close-cycle`. 리뷰 없이 닫기 시도 → **차단되나? ratchet 회귀 시도 → 차단되나?**
7. 독립 리뷰(doer≠reviewer) 통과 후 close → retro.

**Black box 기록표** (Phase 3 입력):

| 기계장치 | 기대 | 관측: FIRED / SILENT / BLOCKED-OK / FAILED |
|---|---|---|
| rule-inject (SessionStart) | invariant+L1 주입 | |
| stage-inject (첫 Edit) | R-CD 주입 | |
| hypothesis-immutability | 변조 차단 | |
| active-symlink-guard | rm 차단 | |
| cycle-init | scaffold 생성 | |
| close-cycle 리뷰 게이트 | 무리뷰 차단 | |
| ratchet | 회귀 축 차단 | |

---

## Phase 3 — Black box 대면 + 적재 (CV-1 해소 지점)

1. Phase 2 기록표를 *그대로* 직시 — 기대와 다른 행이 **진짜 발견**(원칙3 자기비판).
2. SILENT/FAILED 각각 → `TODO.md`(🔬 측정 대기 / 🩹 Watch) 또는 `devils-advocate.md`(CA/PF) 1줄 적재.
3. S5 정직 평가: "1 사이클 끝낸 내가 도움받았나?" — yes면 근거, no면 *어느 단계가 마찰이었나*.
4. 이 metascript 자체를 갱신(시운전도 사이클이다 — retro가 다음 시운전을 싸게 만든다).

> **정직성 잠금**: +발화한 것만 +로 적는다. "다 잘 됐다"는 PF-8 R5 역효과(증거 없는 PASS)의 재현.
> 발화 로그/스크린샷 없는 FIRED 주장 금지.

---

## 가장 빠른 경로 (요약)

```
Phase 0 ✅ 이미 green
   │
Phase 1 ⬅ 지금 바로 실행 — clean-room에서 이음새 빨강 잡기 (라이브 세션 낭비 전에)
   │
Phase 2 ⬅ 사용자가 실제 세션 1회 — 유일한 hook 발화 경로
   │
Phase 3 ── black box 직시 → TODO/devils 적재 → metascript 갱신
```

**비용**: Phase 1 = 수 분(지금). Phase 2 = 라이브 세션 1회(불가축약). Phase 3 = 기록.
**산출**: H1·#005 첫 데이터 + clean-room 재현 절차(이후 모델 교체·릴리스마다 재사용).
