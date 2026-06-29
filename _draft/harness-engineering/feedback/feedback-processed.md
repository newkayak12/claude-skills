# Harness Feedback — 처리 기록

- **처리일**: 2026-06-23
- **원본**: harness-cycle.md (상세 피드백)
- **대상**: harness 플러그인 v0.3.8

## 처리 결과

| # | 항목 | 분류 | 처리 |
|---|---|---|---|
| 1 | 게이트 질문 하나씩 너무 느림 | 플러그인 개선 | → 이슈 리포트 |
| 2 | Kill 기준 Exploration에서 강제 확정 | 플러그인 개선 | → 이슈 리포트 |
| 3 | 로드맵 구조화 AI에 떠넘김 | AI 행동 교정 | → 즉시 적용 |
| 4 | Phase 전환 하네스가 가이드 안 함 | 플러그인 개선 | → 이슈 리포트 |
| 5 | 하네스 룰 실질적으로 미강제 | 구조적 한계 | → 메타인지 패턴 보완 |
| 6 | 산출물 채팅에만, docs에 안 씀 | AI 행동 교정 | → 즉시 적용 |
| 7 | AI가 현재 단계 인식 못 함 | AI 행동 교정 | → 즉시 적용 |
| 8 | PDCA Verify/Retrospect 공백 | 플러그인 개선 | → 이슈 리포트 |
| 9 | CLAUDE.md 무시 구조적 원인 | 구조적 한계 | → 메타인지 패턴 보완 |

## feedback.jsonl 블록 이벤트

- target: ~/.claude/statusline-command.sh
- 판정: 버그. phase-guard가 하네스 외부 파일 편집 차단하면 안 됨
- 재현: 이번 세션도 동일 현상 (Python heredoc 내 .md 문자열도 차단됨)
- 처리: 플러그인 이슈 리포트 대상

## AI 행동 교정 (즉시 적용)

- 로드맵: raw 목록 받으면 AI가 의존성/순서/리스크 분석 후 초안 제시
- 산출물: 채팅 출력 \!= 산출물. docs/ 파일로 남겨야 완료
- 단계 인식: 매 작업 전 현재 phase 확인

## 플러그인 이슈 리포트 대상 (5건)

1. [UI] 게이트 배치 입력 — 컨텍스트 한 번에 입력 시 게이트 항목 자동 매핑
2. [Exploration] Kill 기준 defer — Exploration은 사이클 중 확정 예정으로 defer 허용
3. [Phase] Phase 전환 가이드 — 완료 시 체크리스트 + 다음 단계 자동 제안
4. [PDCA] Verify 지원 — Phase 완료 선언 시 AI 자가 점검 후 사용자 verify 요청
5. [Bug] phase-guard 외부 파일 차단 — ~/.claude/ 등 하네스 외부는 대상 제외

## 미결

- 위 5건 이슈 리포트: https://github.com/newkayak12/claude-skills (사용자 직접)

---

# 재평가 (2026-06-29, v0.4.0 대상)

> 위 2026-06-23 기록은 v0.3.8 시점이며 #10(RFC 부풀림)이 누락돼 있었다. 이후 v0.3.11(enforcement-gap)
> 과 v0.4.0(gajae goal/team/verification)이 ship 되어 대부분 항목에 *메커니즘*이 생겼다. 실제
> 코드 기준으로 disposition 을 다시 매긴다. 핵심 통찰: 10개 항목은 10개 문제가 아니라 **"주입 ≠ 강제"
> 한 문제의 10가지 얼굴**이다. 행동을 실제로 묶는 건 ① 차단 hook ② 강제로 읽는 상태 파일
> ③ 분리 컨텍스트의 falsifiable 검증, 셋뿐이다.

## Disposition 재매핑 (코드 검증 완료)

| # | 항목 | 2026-06-23 분류 | 현재 상태 | 근거 (실제 파일/버전) |
|---|---|---|---|---|
| 1 | 게이트 한 개씩 느림 | 이슈 리포트 | ✅ SHIPPED | `gate-map.py` + `test-gate-map.sh` (v0.3.11) — 컨텍스트 한방 입력→게이트 자동 매핑 |
| 2 | Exploration Kill 기준 defer | 이슈 리포트 | ⚠️ OPEN (잔류) | 미구현. 판단 영역이라 코드로 강제 불가 — 아래 "잔류 하드코어" |
| 3 | 로드맵 구조화 AI 떠넘김 | 즉시 적용 | ✅ (행동+스킬) | `planning:roadmap-planning` 스킬 + 즉시적용 행동교정 |
| 4 | Phase 전환 가이드 없음 | 이슈 리포트 | ✅ SHIPPED | `phase-echo.py` hook + `phase-advance.py` (v0.3.11) |
| 5 | 룰 실질 미강제 | 구조적 한계 | 🟡 부분 완화 | gajae 3층 검증으로 Verify 칸을 메움(아래 #8) — 단 강제 자체는 여전히 확률적 |
| 6 | 산출물 채팅에만 | 즉시 적용 | 🟡 부분 | `goal-cycles/<id>/` scaffold + `active-cycle-verify.py` 가 파일 강제. cycle 외 자유작업은 여전히 행동 의존 |
| 7 | 현재 단계 인식 못 함 | 즉시 적용 | ✅ SHIPPED | `phase-echo.py` 가 매 턴 현재 phase echo |
| 8 | PDCA Verify/Retrospect 공백 | 이슈 리포트 | ✅ SHIPPED (Verify) | gajae 3층 AND 검증(별도 Verifier 에이전트 + boolean schema), `run`/`goals`/`interview` 스킬 (v0.4.0). Retrospect→rule-inject 피드백 루프는 여전히 미설계 |
| 9 | CLAUDE.md 무시 구조적 원인 | 구조적 한계 | 🟡 구조 인정 | "주입≠강제"는 못 없앰. 강제 레이어(hook/상태/분리검증)로 *우회*가 정답 — 폐기 대상 아님 |
| 10 | RFC 부풀림 / 필요성 미게이트 | (누락됐었음) | ⚠️ OPEN (잔류) | 증상만 `11-anti-patterns.md:69` 에 문서화. 강제 게이트 없음 — 아래 "잔류 하드코어" |
| jsonl | phase-guard 외부 파일 차단 | 이슈 리포트(Bug) | ✅ FIXED | `phase-guard.py:49-64` — `CLAUDE_PROJECT_DIR`/프로젝트 루트로 스코프, `~/.claude/` 제외 |

## 잔류 하드코어 — 강제로도 안 풀리는 항목 (#2, #10)

이 둘은 *상태*가 아니라 *판단*이라 hook/schema 로 못 묶는다. 강제 레이어의 구조적 사각지대로 인정하고
범위에서 분리한다:

- **#2 Kill 기준 defer**: "언제 확정할지"는 사이클 맥락 판단. defer 허용 자체는 cycle-card TODO 로 가능하나,
  강제는 못 함.
- **#10 필요성 게이트**: "이 RFC 가 표준 관행인가"는 falsifiable boolean 으로 못 떨군다. 필요성 게이트를
  또 *주입된 지시*로 만들면 #9 가 그대로 재발. → 이건 강제가 아니라 *분리 컨텍스트 Critic*(Task 7 의
  cycle Design-phase Critic pass, `da17aa1`)이 "이거 한 줄로 끝날 일 아니냐" 반증하는 쪽이 유일하게
  작동 가능한 경로. 단 Critic 도 LLM 이라 rubber-stamp 위험 — devils-advocate stance + "불확실하면 부풀림으로
  판정" default 가 없으면 형식화됨.

## 검증 레이어의 위험 (낙관 금지)

- hook 은 사용자가 disable 하면 끝 (`permissionDecision=allow` 기본). 강제도 켜둬야 강제.
- Verifier 도 LLM → boolean schema 의 최단경로는 "true 3개 찍고 통과". 반증 default 없으면 검증 형식화.
- #10·#2 는 위 사각지대.

## 다음 액션 — 하네스 자체에 Kill 기준을 걸어라

효능 판단 도구가 편향돼 있다: friction 만 로그하고 silent save 는 안 남으니 "부정 피드백이 쌓인다"는
관측 자체가 biased instrument. cycle 엔 Kill 기준을 걸면서 **하네스 프로젝트엔 Kill 기준이 없다.**
본인 약을 본인이 먹는다:

> v0.4.0 검증 레이어로 실제 cycle N회를 측정 런으로 돌린다. 그래도 사용자가 동일 3대 실패 클래스
> (① collaborative 문서 혼자 작성 ② 산출물 미문서화 ③ RFC 부풀림)를 여전히 수동으로 잡아야 하면
> → 강제형 하네스 thesis falsified. 폐기하거나 급격히 축소.

- [ ] 이슈 리포트 잔여: #2(Kill defer), #10(필요성 게이트) 만 남음 — 나머지는 ship 됨
- [ ] Retrospect → rule-inject 피드백 루프 설계 (#8 의 미완 절반)
- [ ] 하네스 Kill 기준 falsifiable 하게 박고 N-cycle 측정 런 시작 ([H1 validation] 연장선)

