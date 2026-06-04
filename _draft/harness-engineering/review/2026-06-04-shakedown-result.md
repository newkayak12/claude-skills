# 시운전 결과 — 첫 통합 micro-cycle (격리 구동)

> 2026-06-04 · metascript `review/2026-06-04-shakedown-metascript.md` Phase 2 실행 결과.
> **환경 주의(정직성)**: 이 구동은 *실제 claude 런타임이 hook을 발화시킨* 라이브 세션이 **아니다**.
> harness가 활성 플러그인으로 설치된 환경이 아니라, 격리된 temp 프로젝트에서 harness 스크립트·hook을
> **직접 호출**했다(완전 격리: 별도 HOME·git root·`CLAUDE_PLUGIN_ROOT`, dev repo 오염 0).
> 따라서 이건 **스크립트 통합층의 첫 end-to-end 실측**이지, H1(claude가 실제로 hook을 발화/스킬을 호출하나)의
> 측정은 아니다. 그 결정적 질문은 여전히 **미측정** — 진짜 플러그인 설치 + 라이브 세션 필요(Phase 2 본체).

## BLACKBOX (run1 + run2 합본)

| 기계장치 | 기대 | 관측 | 트리거 | 근거 |
|---|---|---|---|---|
| rule-inject (SessionStart) | invariant+L1, R-CD 부재 | **FIRED** / 런타임 SILENT | 직접호출 | `20 effective dynamic`; 이 세션 시작엔 `[harness]` 경계 미출현(미설치) |
| stage-inject (첫 Edit) | R-CD 코딩룰 도착 | **FIRED** / 런타임 미검증 | 직접호출 | `25 effective stage: code-writing`, additionalContext OK |
| cycle-init | scaffold + active | **FIRED** | 직접호출 | `cycles/<id>/` 생성 + `active` symlink + WIP 점검 통과 |
| hypothesis-immutability | 변조 차단 | **BLOCKED-OK** | 직접호출 | verify `hash mismatch — TAMPERED` 탐지 + PreToolUse hook `exit 2` |
| close-cycle 리뷰 게이트 | 무리뷰 차단 | **BLOCKED-OK** | 직접호출(run2) | 무리뷰 `exit 2`(B1 미채점 명시) → 리뷰 후 `exit 0` happy-path + black-box 대면 실행 |
| ratchet | 회귀 축 차단 | **BLOCKED-OK** | 직접호출(run2) | cycle1 watermark `test-coverage 80` vs cycle2 `70` → check·close 모두 `exit 2` |
| active-symlink-guard | rm 차단 | **NOT-EXERCISED** | — | 이번 미구동(Phase1 self-test엔 포함) |

## 발견 (FINDINGS)

- **F1 — 결정적 질문 미측정(런타임 발화)**: 모든 hook을 *직접 호출*로 발화시켰다. claude 런타임이
  SessionStart/PreToolUse에 실제로 이들을 부르는지, `harness:cycle`/`harness:install` 스킬이 실제 트리거되는지는
  여전히 미측정. → **H1·#005 본체는 진짜 플러그인 설치 + 라이브 세션 1회로만 닫힘.** (이 세션엔 harness 미설치.)
- **F2 — runner 방법론 버그(run1)**: 변조 주입을 안 되돌린 채 close로 진입 → close의 *무결성 게이트*가
  먼저 트립해 *리뷰 게이트·happy-path*가 가려짐(confound). run2에서 분리해 해소. *교훈: tamper 테스트와
  gate 테스트는 별 사이클로.* metascript에 반영.
- **F3 — 테스트 증거 부재**: temp 환경에 `pytest`/`fastapi` 미설치 → 토이 과제의 *진짜 green 증거* 못 만듦.
  harness 게이트는 앱 없이도 검증됐지만, S5("가치") 주장은 *실행 로그* 없이는 약함(PF-8 R5 교훈과 동일축).
  → 라이브 Phase 2는 pytest 있는 환경에서.
- **F4 — active-symlink-guard 미구동**: 이번 시나리오에 rm 경로 없었음. 다음 run에 포함.

## 정직 평가 (S5)

- **스크립트 통합층**: **YES (강)** — cycle-init→가설/바 잠금→변조차단→리뷰 게이트→ratchet→정상 close가
  처음으로 *연결된 한 흐름*으로 돌았고, 막아야 할 4지점에서 전부 `exit 2`로 막혔다. 지금까진 스크립트별
  hermetic self-test뿐이었던 것의 통합 확인.
- **진짜 시운전 질문(런타임/스킬 호출)**: **NULL** — 미측정. 이건 실패가 아니라 *아직 안 한 것*. Phase 2 본체 대기.

## 다음 (Phase 3 적재)

- [x] ~~TODO 🔬: "H1·#005 — hook *런타임* 발화·스킬 호출 관측" (F1)~~ → **아래 §런타임 측정에서 CLOSED**
- [ ] metascript 갱신: tamper 테스트 ↔ gate 테스트 별 사이클 분리 + active-symlink-guard rm 케이스 추가 (F2·F4)
- [ ] 라이브 Phase 2는 `pytest` 설치 환경에서 — 토이 과제 실행 로그를 증거로 (F3)

---

## 런타임 측정 — 헤드리스 claude (F1 CLOSED) · 2026-06-04 추가

> **방법 돌파**: 인터랙티브 `/plugin install` 없이 **`claude -p --plugin-dir <harness> --output-format stream-json --verbose`** 로
> *실제 claude 런타임*이 플러그인을 세션-한정 로드하고 **hook을 스스로 발화·스킬을 스스로 트리거**하게 했다. hook 스크립트를
> 직접 부르지 않았다 — claude가 부른 것. 격리 HOME에 자격증명만 복사(`~/.claude/.credentials.json`), 나머지 완전 격리(temp proj).
> 이것이 F1(H1·#005)의 *진짜* 측정. 이전 격리구동(직접호출)과 달리 런타임 발화를 관측.

### RUNTIME BLACKBOX

| 기계장치 | 격리(직접호출) | **런타임(claude -p)** | 증거 | 일치 |
|---|---|---|---|---|
| rule-inject (SessionStart) | FIRED | **FIRED** | `hook_response` 에 invariant L0+L1 20개·**R-CD 부재**(계약대로) 그대로 주입 | ✅ |
| active-cycle-verify (SessionStart) | — | **FIRED** | 활성 사이클 존재 시 `active cycle '…': hypothesi…' 검증` 출력 | ✅ |
| session-counter (SessionStart) | — | **FIRED** | `active cycle '…': session 2` 누적 | ✅ |
| `harness:install` 스킬 자동트리거 | (해당없음) | **FIRED** | "초기 설정 도와줘" → `Skill skill=harness:install` 자동호출 → Step0·1 점검 후 질문1개 | ✅ |
| `harness:cycle` 스킬 자동트리거 | (해당없음) | **FIRED** | "새 사이클 시작" → `Skill skill=harness:cycle` → WIP체크→게이트 Step1·2 *한 군씩* 진행 | ✅ |
| stage-inject (PreToolUse Edit/Write) | FIRED | **FIRED** | 부작용 마커 `~/.harness/stage-inject/<session>/code-writing.injected` ×2(세션별) | ✅ |
| hypothesis-immutability (PreToolUse) | BLOCKED-OK | **BLOCKED-OK** | claude가 `hypotheses.jsonl` Edit 시도 → 차단됨 보고("tamper-evident hash chain…AP-06") · 파일 unchanged · `chain intact` | ✅ |

**7/7 런타임 열 일치.** 격리에서 통합층으로 본 것이 *실제 claude 런타임에서도 그대로* 발화·차단됐다.

### 런타임 발견 (RT-FINDINGS)

- **RT-1 — F1 CLOSED**: hook 3종(SessionStart)·PreToolUse 차단·스킬 2종 자동트리거가 *런타임*에 전부 확인. **하네스는 실제 claude 세션에서 작동한다.** H1·#005 본체 닫힘.
- **RT-2 — `--plugin-dir`는 재사용 가능한 시운전 하니스**: `/plugin install` 인터랙션 없이 헤드리스로 런타임 발화를 측정하는 표준 경로. CI 회귀 게이트로 승격 가능(회귀 시 hook 미발화 즉시 탐지). → **2026-06-04 DONE**: 2티어 게이트로 굳힘.
  - **티어1 `scripts/test-runtime-wiring.sh`** (hermetic, no-claude, 글로브 합류 12→13): 개별 hook 테스트가 놓치는 *배선 계약* 잠금 — hooks.json↔파일시스템 정합(W2), 필수배선 3종(W3: SessionStart⊇rule-inject·PreToolUse(Edit)⊇{immutability,stage-inject}·Bash⊇symlink-guard), 스킬 2종 discoverability(W5: frontmatter name/desc), 런타임-등가 주입(W6). 음성테스트 2건(hooks.json 깨진참조·스킬 frontmatter 제거) 정확히 FAIL → 비-vacuous.
  - **티어2 `scripts/runtime-smoke.sh`** (라이브 `claude -p --plugin-dir`, opt-in, glob 제외): L1(auth 불필요 — 모델 호출 *전* 발화: 플러그인 로드·스킬 등록·rule-inject 주입) PASS, L2(`--full`, auth 필요 — immutability 런타임 차단: 파일 unchanged+모델 차단보고) PASS. 종료코드 0/1/2(SKIP=claude 부재).
  - 효과: 오늘 1회 관측한 7/7 런타임 발화가 *매 회귀마다* 무비용으로 잠긴다. hook rename·export drift·스킬 깨짐 같은 침묵 퇴행을 hermetic 티어1이, 진짜 런타임 발화를 라이브 티어2가 본다.
- **RT-3 — 계측 함정(중요)**: stream-json은 **SessionStart hook 이벤트는 내보내지만 PreToolUse hook 이벤트는 안 내보낸다.** PreToolUse는 *이벤트 부재로 미발화를 추론하면 오판* — 반드시 **부작용(마커)·행동(차단 보고)** 으로 측정할 것. (실제로 3a에서 한 번 오판했다 정정.)
- **RT-4 — 미소진**: Go 경로 scaffold·close 게이트는 런타임에서 *대화 다턴*이라 단일 `-p`로 안 닿음 — 스크립트층에선 이미 BLOCKED-OK 확인됨(위 §BLACKBOX). 잔여 위험 낮음.

### 정직 평가 갱신 (S5)

- **스크립트 통합층**: YES(강) — 변동 없음.
- **진짜 시운전 질문(런타임/스킬 호출)**: 이전 **NULL** → **YES(강)**. 7/7 런타임 발화. 격리 직접호출 ≠ 측정이라던 자기 제약을 `--plugin-dir` 헤드리스로 우회해 *진짜 런타임*을 봤다.
