---
name: work
description: >-
  Use to implement one approved harness plan slice. Triggers on: "harness work",
  "하네스 work", "승인된 slice 구현", "work 1.1", "plan대로 구현".
  Requires active cycle current_phase=implementation and a plan slice.
scenarios:
  - "harness-work W1"
  - "승인된 첫 slice 구현해줘"
  - "plan.md 기준으로 W2만 작업해줘"
---

# Harness Work — Approved Slice → Verified Change

목표: planning phase에서 승인된 plan 산출물의 slice 하나만 구현한다. 계획 밖 작업, opportunistic refactor, 관련 없는 파일 수정은 하지 않는다.

## Preconditions

1. active cycle이 있어야 한다.
2. phase가 `implementation`이어야 한다.
   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/phase-advance.py --show
   ```
3. design/planning phase의 산출물을 읽는다 — `cycles/active/metrics.json`의 `phase_gates`(design·planning)에 evidence로 등록된 파일들이 SSOT다. 고정 파일명은 없다(phase-advance 시 지정된 경로).
4. 사용자가 지정한 slice ID가 plan 산출물에 있어야 한다. 없으면 STOP — planning phase로 돌아가 plan을 갱신한다 (`harness:cycle` Step 6 / `phase-advance.py planning`).

## Flow

1. 작업할 slice ID와 범위를 재진술한다.
2. 파일을 읽고 최소 변경 계획을 세운다.
3. 필요한 테스트를 먼저 확인하거나 추가한다. TDD가 가능한 경우 실패 테스트를 먼저 둔다.
4. slice 범위 안에서만 코드 변경한다.
5. 검증 명령을 실행한다. 실행 못 하면 이유를 기록한다.
6. `cycles/active/activity.log`에 slice, 변경 요약, 검증 결과를 append한다.

## Guardrails

- plan 밖 파일을 만져야 하면 STOP하고 plan update를 제안한다.
- architecture/model/API decision이 새로 발견되면 STOP — planning phase로 돌아가 design/plan 산출물을 갱신한다 (`harness:cycle` Step 6 / `phase-advance.py planning`).
- 테스트 실패를 남긴 채 완료라고 하지 않는다. 실패가 의도적이면 plan/review에 명시한다.

## What Claude Does

- 승인된 slice만 구현한다.
- 검증 결과를 사용자에게 짧게 보고한다.
- 다음 단계로 `harness:review`를 제안한다.

