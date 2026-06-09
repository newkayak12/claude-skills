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

Goal: implement exactly one slice from the plan artifact approved in the planning phase. Do not do out-of-plan work, opportunistic refactors, or edits to unrelated files.

## Preconditions

1. There must be an active cycle.
2. The phase must be `implementation`.
   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/phase-advance.py --show
   ```
3. Read the design/planning phase artifacts — the files registered as evidence under `phase_gates` (design, planning) in `cycles/active/metrics.json` are the SSOT. There is no fixed filename (use the paths specified at phase-advance time).
4. The slice ID the user specified must exist in the plan artifact. If it does not, STOP — return to the planning phase and update the plan (`harness:cycle` Step 6 / `phase-advance.py planning`).

## Flow

1. Restate the slice ID and scope you will work on.
2. Read the files and form a minimal-change plan.
3. Check for or add the necessary tests first. When TDD is feasible, write a failing test first.
4. Change code only within the slice scope.
5. Run the verification command. If you cannot run it, record the reason.
6. Append the slice, change summary, and verification result to `cycles/active/activity.log`.

## Guardrails

- If you need to touch a file outside the plan, STOP and propose a plan update.
- If a new architecture/model/API decision is discovered, STOP — return to the planning phase and update the design/plan artifacts (`harness:cycle` Step 6 / `phase-advance.py planning`).
- Do not call it complete while leaving a failing test. If the failure is intentional, state it in the plan/review.

## What Claude Does

- Implement only the approved slice.
- Briefly report the verification result to the user.
- Propose `harness:review` as the next step.

