---
name: review
description: >-
  Use after harness:work to review the implemented slice independently against
  spec/design/plan and verification evidence. Triggers on: "harness review",
  "하네스 리뷰", "work 리뷰", "독립 리뷰", "검증해줘".
scenarios:
  - "harness-review W1"
  - "방금 work 독립 리뷰해줘"
  - "plan/spec 기준으로 변경 검토해줘"
---

# Harness Review — Change → Independent Verdict

목표: 구현자 관점이 아니라 reviewer 관점으로 변경을 검토한다. major finding은 blocker다. 자기 채점으로 close하지 않는다.

## Preconditions

1. active cycle이 있어야 한다.
2. `cycles/active/spec.md`, `cycles/active/design.md`, `cycles/active/plan.md`, `cycles/active/activity.log`를 읽는다.
3. 현재 diff와 검증 결과를 확인한다.

## Review Axes

- Spec alignment: outcome, scope, non-goals, acceptance criteria를 만족하는가?
- Plan alignment: 승인된 slice 밖 변경이 있는가?
- Design alignment: architecture/model/API 결정과 충돌하는가?
- Test quality: 실패해야 할 경우 실패하고, 통과해야 할 경우 통과하는가?
- Regression risk: 기존 동작, migration, observability, rollback 위험은 없는가?

## Flow

1. findings first 형식으로 리뷰한다. blocker를 먼저 쓴다.
2. blocker가 있으면 implementation으로 돌려보낸다.
3. pass 가능한 경우 evidence를 명시한다.
4. bar가 등록되어 있으면 `review-register.py`로 pass/fail verdict를 기록한다.

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/review-register.py register \
  --cycle <cycle-id> --id R1 --criterion-id B1 \
  --verdict pass --evidence "<observed evidence>" --reviewer "harness:review"
```

## What Claude Does

- 구현 요약보다 findings를 먼저 낸다.
- 확인하지 않은 것은 확인했다고 쓰지 않는다.
- pass/fail 근거를 active cycle 산출물과 검증 출력에 묶는다.

