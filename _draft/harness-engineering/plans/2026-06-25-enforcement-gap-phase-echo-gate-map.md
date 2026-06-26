# Enforcement-gap 보완 — phase-echo hook + gate-map script

> **For agentic workers:** REQUIRED: superpowers:test-driven-development 을 각 태스크에 적용 — 실패 테스트 작성 → 실패 확인 → 최소 구현 → 통과 확인 → 커밋. 대상 디렉토리: repo 루트 `harness/`.

Status: approved (2026-06-25) — design 섹션별 사용자 승인 완료
Scope: 기존 `harness/skills/{install,cycle,plan,work,review}` 와 phase/cycle 머시너리는 **변경하지 않음**. 이 작업은 hook 1개 + script 1개 *추가* + cycle SKILL.md Step 2 한 줄 연동.

## 1. Problem

2026-06-23 실사용 피드백(`feedback/feedback-processed.md`)에서 게이트 4건이 보고됐다:
#1 게이트 질문 한 군씩 느림, #2 Exploration Kill 강제 확정, #4 Phase 전환 미가이드, #8 PDCA Verify 공백.

대조 결과 **4건 모두 이미 플러그인에 반영**돼 있었다 — #4·#8 은 `phase-advance.py`(adjacency·evidence·collaborative `--confirm-user`/H2) 와 `cycle-init.py`(`phase_gates`) 로 메커니즘까지, #1·#2 는 `cycle/SKILL.md` prose 로. 그런데도 06-23 세션(v0.3.9·design-checkpoint *이후*)에서 같은 마찰을 또 겪었다.

→ 이건 **누락 기능이 아니라 강제/채택 갭** (`feedback-processed.md` #5·#9 "룰 실질적 미강제", 구조적 한계). `stage-inject.py` 가 명문화한 원칙: *주입 ≠ 강제, soft 안내*. 진짜 hard-enforce 는 PreToolUse 도구 게이트만 가능하고, 대화 행동(#1·#2·"다음 단계 자동 제안")은 hook 으로 막을 도구 호출 경계가 없다.

이 갭을 *완전히* 닫을 수는 없다(정직한 한계). 대신 마찰이 실제로 일어나는 *지점*에 두 가지 forcing 표면을 더한다.

## 2. Decisions

1. **#4·#7 재발 → in-flow phase 환기 hook (`phase-echo.py`)**: active cycle 이 있고 `current_phase` 가 직전 주입과 *달라졌을 때만* UserPromptSubmit 에서 현재 phase·게이트·다음 단계를 컨텍스트에 주입. 발화 주기 = **phase 전환 시점만** (사용자 선택 — 스팸 최소). soft only(차단 아님), `stage-inject` 와 동일 철학.
2. **#1·#2 재발 → 게이트 배치입력 매퍼 (`gate-map.py`)**: AI 가 context-dump 를 A~E 로 *의미 매핑*(LLM 역할) → 스크립트가 **완성도 검증 + 누락만 렌더 + 매트릭스/defer 규칙 결정적 적용**. NLP 안 함 — 매핑은 AI, 결정 규칙은 코드. 특히 Exploration Kill defer 예외를 코드로 고정(#2).
3. **연동**: `cycle/SKILL.md` Step 2 에 "context-dump 받으면 `gate-map.py` 호출" 한 줄 추가(현재 prose 만 → 도구 호출로 경화). hook 은 `hooks.json` 에 UserPromptSubmit 블록 신설.
4. **범위 밖(YAGNI)**: `gate-map.py` 자연어 파싱 금지. phase-echo 차단 금지. 두 컴포넌트는 기존 메커니즘(`phase-advance.py` 게이트)을 *대체하지 않고 보완*만 한다.

## 3. 정직한 한계 (구현·문서에 반영)

- **phase-echo 는 안내일 뿐**. AI 가 무시할 수 있다 — `phase-advance.py` 게이트만이 evidence/confirm 을 실제 강제. hook 은 "기억 의존 대신 플로우 내부 도달"만 개선.
- **gate-map 은 매핑을 검증 못 한다**. AI 가 dump 를 잘못 매핑하면 스크립트는 알 수 없다. 강제하는 건 "어느 그룹이 비었나 + Exploration defer 규칙"의 *결정적 산출*뿐.
- **session_id 없으면 de-dup 불가** — `stage-inject` 와 동일. 그 경우에도 1회 주입은 한다.

## 4. Codebase Survey (그대로 모방)

- `harness/hooks/stage-inject.py` — **phase-echo 의 정본**. `find_script`, `harness_home()`, `marker_path`(session_id sha256[:16]), `already_injected`/`mark_injected`(fail-open), de-dup 마커. phase-echo 는 이 구조를 따르되 ① 이벤트가 UserPromptSubmit(plain stdout 주입, JSON additionalContext 아님) ② 마커가 "주입된 phase 값"을 저장(단순 존재가 아니라 *값 비교*).
- `harness/hooks/active-cycle-verify.py` — active 해소(`os.readlink`), `current_phase` 가 metrics.json 에 있음. cycle 디렉토리 탐색 패턴.
- `harness/scripts/phase-advance.py` — `PHASES`, `_active_dir()`, metrics `phase_gates`/`current_phase` 읽기. phase-echo 가 게이트 요건 텍스트를 만들 때 `phase_gates[cur]` 의 `type`(solo/collaborative) 참조.
- `harness/scripts/cycle-init.py` — gate group 정의(A~E)와 매트릭스가 cycle SKILL Step 2/3 에 있음. gate-map 의 그룹 키·defer 규칙은 SKILL 과 일치시킨다.
- `harness/scripts/bar-register.py` — argparse/subcommand·exit 코드 관례(gate-map 도 따름).
- `harness/scripts/test-*.sh` — self-test 관례: `cd "$(dirname "$0")/../.."`(repo 루트), tmp 사이클 생성→실행→`rm -rf`→`PASS` 출력.
- `harness/hooks/hooks.json` — UserPromptSubmit 키가 아직 없음 → 신설.

## 5. File Structure

**신규 (NEW):**

| 파일 | 책임 |
|---|---|
| `harness/hooks/phase-echo.py` | UserPromptSubmit hook. active cycle 의 `current_phase` 가 직전 주입과 다르면 phase 인식(현 phase·gate type·떠나기 요건·다음 phase·auto-propose nudge) plain stdout 주입. 같으면 no-op. fail-open. |
| `harness/hooks/test-phase-echo.sh` | phase-echo self-test (전환 시 주입 / 동일 phase no-op / active 없음 no-op / 깨진 JSON fail-open). |
| `harness/scripts/gate-map.py` | 게이트 배치입력 매퍼/검증기. `--type` + `--a..--e` 받아 ✓/✗ 렌더 + 누락만 질문 리스트 + 매트릭스 pre-verdict(Exploration Kill defer 규칙 포함). |
| `harness/scripts/test-gate-map.sh` | gate-map self-test (전부 채움→proceed / C Kill 누락+exploration→defer / C Kill 누락+product→STOP / A 누락→ask-missing). |

**수정 (MODIFIED):**

| 파일 | 변경 |
|---|---|
| `harness/hooks/hooks.json` | `UserPromptSubmit` 키 신설 → phase-echo 1블록. |
| `harness/skills/cycle/SKILL.md` | Step 2 context-dump shortcut 에 "`gate-map.py` 호출" 한 줄 + Step 6 에 phase-echo 존재 명시(선택). |
| `harness/hooks/README.md` | phase-echo 섹션 신설(역할/주기=전환 시만/soft/fail-open). |

## 6. Chunk 1: gate-map.py (배치입력 매퍼)

### Task 1.1 — test-gate-map.sh 작성 (실패)

- [ ] `harness/scripts/test-gate-map.sh` 생성:

```bash
#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../.." || exit 1   # repo 루트
G="python3 harness/scripts/gate-map.py"
fail=0

# 1) 전부 채움 + product → proceed 힌트, 누락 0
out=$($G --type product --a "users can't X" --b "fits prior" --c "2주, kill=no signal" --d "5 interviews" --e "real motive") || { echo "FAIL: 정상 실행"; fail=1; }
echo "$out" | grep -q "MISSING: none" || { echo "FAIL: 누락 없어야 함"; fail=1; }

# 2) C 의 Kill 누락 + exploration → defer 허용
out=$($G --type exploration --a "learn X" --c "2주 time budget")
echo "$out" | grep -qi "defer" || { echo "FAIL: exploration kill defer 안내 없음"; fail=1; }

# 3) C 의 Kill 누락 + product → STOP
out=$($G --type product --a "users can't X" --c "2주 time budget")
echo "$out" | grep -qi "STOP" || { echo "FAIL: product kill 누락인데 STOP 아님"; fail=1; }

# 4) A 누락 → ask-missing 에 A 포함
out=$($G --type product --b "fits" --c "2주, kill=x" --d "5 interviews" --e "motive")
echo "$out" | grep -q "A\." || { echo "FAIL: 누락 A 질문 안 나옴"; fail=1; }

[ $fail -eq 0 ] && echo "gate-map self-test: PASS"
exit $fail
```

- [ ] `chmod +x harness/scripts/test-gate-map.sh`

### Task 1.2 — 실패 확인
- [ ] `bash harness/scripts/test-gate-map.sh` → gate-map.py 없어 실패.

### Task 1.3 — gate-map.py 구현 (§7 코드)
### Task 1.4 — 통과 확인
- [ ] `bash harness/scripts/test-gate-map.sh` → PASS, exit 0.

### Task 1.5 — 커밋
- [ ] `feat(harness): gate-map.py — batch gate input mapper (#feedback-1/2)` + 트레일러.

## 7. Chunk 2: phase-echo.py (in-flow 환기 hook)

### Task 2.1 — test-phase-echo.sh 작성 (실패)

- [ ] `harness/hooks/test-phase-echo.sh` 생성:

```bash
#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../.." || exit 1   # repo 루트
H="python3 harness/hooks/phase-echo.py"
export HARNESS_HOME="$(mktemp -d)"
fail=0

# 실제 active 있으면 clobber 위험 — SKIP
if [ -L cycles/active ]; then echo "SKIP: 실제 active 존재"; rm -rf "$HARNESS_HOME"; exit 0; fi

CID=_tmp-phaseecho
rm -rf "cycles/$CID"; mkdir -p "cycles/$CID"
printf '{"current_phase":"design","phase_gates":{"design":{"type":"collaborative"}}}\n' > "cycles/$CID/metrics.json"
ln -sfn "$CID" cycles/active
SID='{"session_id":"s1"}'

# 1) 첫 호출(design) → 주입(현 phase 언급)
out=$(echo "$SID" | $H)
echo "$out" | grep -qi "design" || { echo "FAIL: 첫 주입에 design 없음"; fail=1; }

# 2) 같은 phase 재호출 → no-op (무출력)
out=$(echo "$SID" | $H)
[ -z "$out" ] || { echo "FAIL: 동일 phase 인데 재주입됨"; fail=1; }

# 3) phase 변경(planning) → 다시 주입
printf '{"current_phase":"planning","phase_gates":{"planning":{"type":"collaborative"}}}\n' > "cycles/$CID/metrics.json"
out=$(echo "$SID" | $H)
echo "$out" | grep -qi "planning" || { echo "FAIL: phase 변경인데 주입 안 됨"; fail=1; }

# 4) 깨진 JSON → fail-open (무출력, exit 0)
echo 'not json' | $H >/dev/null 2>&1 || { echo "FAIL: 깨진 JSON 에서 비-0 exit"; fail=1; }

# 5) active 없음 → no-op
rm -f cycles/active
out=$(echo "$SID" | $H)
[ -z "$out" ] || { echo "FAIL: active 없는데 출력함"; fail=1; }

rm -rf "cycles/$CID" "$HARNESS_HOME"
[ $fail -eq 0 ] && echo "phase-echo self-test: PASS"
exit $fail
```

- [ ] `chmod +x harness/hooks/test-phase-echo.sh`

### Task 2.2 — 실패 확인
- [ ] `bash harness/hooks/test-phase-echo.sh` → 실패.

### Task 2.3 — phase-echo.py 구현 (§8 코드)
### Task 2.4 — 통과 확인
- [ ] `bash harness/hooks/test-phase-echo.sh` → PASS.

### Task 2.5 — hooks.json wiring
- [ ] `harness/hooks/hooks.json` 에 `UserPromptSubmit` 키 추가:

```json
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-echo.py"
          }
        ]
      }
    ]
```

- [ ] `python3 -c "import json; json.load(open('harness/hooks/hooks.json'))"` → OK.

### Task 2.6 — 커밋
- [ ] `feat(harness): phase-echo.py — in-flow phase reminder (#feedback-4/7)` + 트레일러.

## 8. Chunk 3: 연동 + 문서 + 버전

### Task 3.1 — cycle SKILL.md 연동
- [ ] Step 2 context-dump shortcut bullet 에 "`gate-map.py --type <t> --a.. --e` 로 매핑·누락 산출" 추가.
- [ ] Step 6 에 "phase 전환 시 `phase-echo` hook 이 현재 phase·다음 단계를 환기" 한 줄(선택).

### Task 3.2 — hooks/README.md
- [ ] phase-echo 섹션 신설: 역할(in-flow phase 환기), 주기(phase 전환 시만, session×phase de-dup), soft only, fail-open, 한계(주입≠강제).

### Task 3.3 — 전체 self-test 회귀 + 버전 bump
- [ ] 신규 2종 + 기존 핵심 self-test PASS.
- [ ] `.claude-plugin/marketplace.json` harness version patch bump + description 한 줄, `harness/README.md` 갱신 (INSTRUCT.md 워크플로우).
- [ ] 커밋: `feat(harness): vX.Y.Z — enforcement-gap (phase-echo + gate-map)` + 트레일러.

## 9. Self-test 요약

| 스크립트 | 커버 |
|---|---|
| `test-gate-map.sh` | 전부채움→누락0 / exploration kill 누락→defer / product kill 누락→STOP / A 누락→ask-missing |
| `test-phase-echo.sh` | 전환 시 주입 / 동일 phase no-op / phase 변경 재주입 / 깨진 JSON fail-open / active 없음 no-op |

**DRY/YAGNI/TDD:** phase-echo 는 stage-inject 의 session/marker 로직 패턴 재사용. gate-map 은 NLP 재구현 없이 결정 규칙만. 강제 불가능한 대화 행동은 한계로 명문화.
