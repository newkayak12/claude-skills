# Retrospective — metrics honesty session count

> 사이클 종료 시 작성. dev-tool / self-user. 큐 2번(deploy kill-check Sensor)의 선행작업.

## 가설 결과

| 가설 | 결과 | 근거 |
|---|---|---|
| **H1** — kill-check를 세션 카운트 기반으로 바꾸고 SessionStart hook이 session_count를 자동 증가시키면, kill-check가 항상-0(거짓 OK) 없이 실제 데이터로 판정한다 | **지지** | self-test 8/8 — startup→+1, resume/compact/clear→미증가, kill-check soft(>appetite)/hard(>2×)/reentry(≥3) 정확 발동 |

## 무엇을 배웠나

- **측정 가능성이 강제 가능성을 정의한다.** budget$를 kill 지표에서 *드롭*한 건 후퇴가 아니라 정직이다. 하네스가 *관측 못 하는* 신호로 kill을 판정하면 항상-0 = 거짓 OK Sensor가 된다 — `#003`에서 경계한 "거짓말하는 경보기"의 다른 얼굴. `13 §3` Computational/Inferential 경계가 *무엇을 자동 강제할지*를 직접 결정함을 실증.
- **문제 재정의가 절반을 녹인다.** "metrics 자동 갱신"을 *저장한 값을 background로 갱신*으로 보면 writer·race·drift 문제. *작업 세션을 이벤트로 카운트*(SessionStart마다 +1)로 보면 단조증가라 그 문제가 통째로 사라짐. 솔로 dev 단위를 wall-clock→세션으로 바꾼 게 핵심.

## 놀란 것 (예측 vs 실제)

- 놀란 점 *적음* — #002/#003 hook 골격(stdin/exit/fail-open) 재사용. SessionStart의 `source` 필드로 startup만 카운트하는 게 깔끔하게 떨어짐(resume/compact/clear = 연속). *도구가 도구를 빠르게 짓는다* 또 확인.
- 예상 못 한 것: cycle-init이 #004를 *구 스키마*로 낳아서 자신을 마이그레이션해야 했음(F1). dogfood가 스키마 전환 비용을 즉시 노출.

## 다음에 바꿀 것

- reentry_count 자동화(F3)는 *게이트 계측*이 필요 — SessionStart로는 못 잡음. 별도 사이클. 지금은 정직하게 "Inferential·수동"으로 명시.
- scratch-tamper 테스트 패턴(#003에서 확립) 또 유효 — 유지.

## 인계 (살림 / 의심 / 버림)

- **살림**: `session-counter.py`(Computational Sensor), session-count kill 모델, **"측정 가능성 = 강제 가능성"** 원칙, cycle-init 신스키마
- **의심**: `appetite_sessions`를 사람이 *정확히* 설정해야 함(틀리면 kill 오발동) — Inferential 입력 의존. reentry_count 여전히 수동
- **버림**: `time_spent_hours`·`budget_spent_pct` 필드(구 스키마), wall-clock 시간 기반 kill 로직, `parse_time_budget_weeks`

## 어긴 룰 / Anti-pattern (black box 대면)

`blackbox.jsonl` 비어 있음 — override/skip/강행 0건. invariant 위반 0건. 가설 chain intact. 스코프(kill-check 정직화만)를 지킴 — Sensor wiring은 #005로 미룸(appetite 초과 안 함).

## 다음 사이클 큐

1. **(#005 — 이제 unblocked)** deploy kill-check Sensor wiring — UserPromptSubmit('배포' 키워드) → kill-check exit 2면 차단. metrics 정직화(#004)로 선행조건 해소됨.
2. **(GOAL 앞단)** marketplace 등록 + `harness:install` 온보딩 + interactive user-rule(L1)
3. **(reentry 자동화)** 게이트 재진입 계측 — F3. 별도 사이클.
4. **(H1 측정 — #001 인계)** 다음 실제 프로젝트에서 `harness:cycle` 호출 여부 black box 기록
