# Retrospective — sessionstart-verify-sensor

> 사이클 종료 시 작성. dev-tool / self-user. #002 F2의 짝 Sensor 후속.

## 가설 결과

| 가설 | 결과 | 근거 |
|---|---|---|
| **H1** — SessionStart hook이 active 사이클 chain을 verify해 세션 밖 변조를 탐지·경고 | **지지** | self-test 3/3 — intact→확인, no-active→silent, tampered→경고(hash mismatch 상세) |

## 무엇을 배웠나

- **Sensor는 짝으로 완성된다.** PreToolUse(#002, 세션 내 *차단*) + SessionStart(#003, 세션 밖 *탐지*)가 함께 `CV-1`의 더 넓은 면을 막는다. #002 retro의 "하나로 완전하다 가정 금지"를 실제로 메움.
- **차단 vs 탐지의 자리가 다르다.** 도구 호출은 *차단* 가능(PreToolUse), 세션 시작은 *차단 불가*라 *경고*만. 이벤트 성격이 Sensor의 형태(block/warn)를 결정한다 — Böckeler의 feedforward/feedback 구분과 일치.

## 놀란 것 (예측 vs 실제)

- 예측대로 작동. 놀란 점은 *적음* — #002에서 hook 패턴(stdin/exit/fail-open, 스키마 테스트)을 이미 확립해 재사용이 매끄러웠다. *도구가 도구를 빠르게 만든다* (Böckeler Steering Loop: agent로 harness를 짓기).

## 다음에 바꿀 것

- 없음 큰 것. 테스트 시 *실제 사이클을 건드리지 않고 scratch로 변조→복원* 패턴이 잘 작동 — 유지.

## 인계 (살림 / 의심 / 버림)

- **살림**: `active-cycle-verify.py`, 짝 Sensor(차단+탐지) 설계 원칙, scratch-tamper 테스트 패턴
- **의심**: 세션 밖 변조를 *탐지*는 하나 *복구*는 수동 — 자동 복구/롤백은 아직 없음. tampered 후 사용자가 경고를 무시하면? (black box 대면에 의존)
- **버림**: 없음

## 어긴 룰 / Anti-pattern (black box 대면)

`blackbox.jsonl` 비어 있음 — override/skip/강행 0건. invariant 위반 0건. 가설 chain intact.

## 다음 사이클 큐

1. **(GOAL 앞단)** marketplace 등록 + `harness:install` 온보딩 + interactive user-rule(L1) — *설치해서 쓰는* 경로
2. **(옵션 2)** deploy kill-check Sensor — metrics 자동 갱신과 묶어서
3. **(H1 측정 — #001 인계)** 다음 실제 프로젝트에서 `harness:cycle` 호출 여부 black box 기록
