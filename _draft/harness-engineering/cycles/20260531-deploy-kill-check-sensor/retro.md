# Retrospective — deploy kill-check sensor

> 사이클 종료 시 작성. dev-tool / self-user. TODO Now 1번(#005), #004 선행조건 해소의 후속.

## 가설 결과

| 가설 | 결과 | 근거 |
|---|---|---|
| **H1** — UserPromptSubmit hook이 deploy 키워드를 감지해 kill-check를 돌리고, Hard면 차단(exit2)/Soft면 경고/그 외 통과 | **지지** | self-test 7/7 — non-deploy·ok·soft·hard·no-active·영문키워드·JSON실패 모두 기대대로 |

## 무엇을 배웠나

- **이벤트의 성격이 Sensor의 권한을 정한다.** PreToolUse·UserPromptSubmit 은 *차단 가능*(exit 2), SessionStart 는 *경고만*. 같은 kill-check 로직이라도 *어느 이벤트에 거느냐*가 "막을 수 있나"를 결정. Böckeler feedforward/feedback 구분의 실무 귀결.
- **Soft 를 차단하지 않은 게 설계의 핵심.** Hard=자동종료(차단), Soft=재평가(사람 결정). 코드가 *판단을 빼앗지 않는다* — `13 §3` Computational(차단)/Inferential(결정) 경계를 exit 코드 매핑으로 구현(F1).
- **#004 가 #005 를 진짜로 풀었다.** metrics 정직화(session_count 자동)가 없었으면 이 Sensor 는 항상-ok 거짓 통과. 선행작업이 *실제로* 후속을 가능케 함을 dogfood 로 확인.

## 놀란 것 (예측 vs 실제)

- 놀란 점 *적음* — kill-check subprocess 호출(#003 verify 패턴)·fail-open·stdin JSON 골격을 또 재사용. 4번째 hook이라 거의 조립. *도구가 도구를 빠르게 짓는다* 누적 확인.
- 예상대로 키워드 오탐 우려(F2) 있었으나, "Hard 차단은 active hard-kill 상태에서만 추가 발동 + fail-open" 이라 실해가 작다고 판단.

## 다음에 바꿀 것

- 없음 큰 것. 키워드 셋은 필요 시 user-rule(L1)로 확장 여지 — 지금은 하드코딩으로 충분.

## 인계 (살림 / 의심 / 버림)

- **살림**: `deploy-kill-check.py`, exit-코드↔hook-행동 매핑 패턴, "Soft는 차단 안 함" 원칙, Sensor→script subprocess 골격
- **의심**: deploy 키워드 오탐(F2) — 정밀 의도판정은 안 함(Inferential 과함). hook은 실제 `claude` 설치 환경에서의 통합 테스트는 아직(스키마 self-test만)
- **버림**: 없음

## 어긴 룰 / Anti-pattern (black box 대면)

`blackbox.jsonl` 비어 있음 — override/skip/강행 0건. invariant 위반 0건. 가설 chain intact. 스코프(hook+wiring+self-test) 준수, appetite 1세션 이내.

## 다음 사이클 큐

1. **(GOAL 앞단)** marketplace 등록 + `harness:install` 온보딩 + interactive user-rule(L1) — *설치해서 쓰는* 경로. 이제 내부 Sensor 3종(차단·탐지·배포차단) 갖췄으니 설치 경로로 전환 자연스러움.
2. **(reentry 자동화)** 게이트 재진입 계측 — #004 F3.
3. **(H1 측정 — #001 인계)** 다음 실제 프로젝트에서 `harness:cycle` 호출 여부 black box 기록.
4. **(통합 테스트)** 실제 플러그인 설치 환경에서 hook 3종 end-to-end 검증(#005 의심).
