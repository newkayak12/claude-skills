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

Goal: review the change from a reviewer's perspective, not the implementer's. A major finding is a blocker. Do not close via self-grading.

## Preconditions

1. There must be an active cycle.
2. Read the design/planning phase artifacts (the files registered as `phase_gates` evidence in `cycles/active/metrics.json` = SSOT) and `cycles/active/activity.log`.
3. Check the current diff and verification results.

## Review Axes

- Spec alignment: does it satisfy outcome, scope, non-goals, and acceptance criteria?
- Plan alignment: are there changes outside the approved slice?
- Design alignment: does it conflict with architecture/model/API decisions?
- Test quality: does it fail when it should fail and pass when it should pass?
- Regression risk: any risk to existing behavior, migration, observability, or rollback?

## Flow

1. Review in findings-first format. Write blockers first.
2. If there is a blocker, send it back to implementation.
3. When a pass is possible, state the evidence explicitly.
4. If a bar is registered, record the pass/fail verdict with `review-register.py`.

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/review-register.py register \
  --cycle <cycle-id> --id R1 --criterion-id B1 \
  --verdict pass --evidence "<observed evidence>" --reviewer "harness:review"
```

## What Claude Does

- Lead with findings rather than an implementation summary.
- Do not claim something was verified if it was not.
- Tie the pass/fail rationale to active cycle artifacts and verification output.

