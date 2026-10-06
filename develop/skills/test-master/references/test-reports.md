# Writing the Test Report

A report lets a reader decide: ship, fix first, or investigate. Lead with the verdict, then evidence.

## Skeleton

1. **Verdict** -- one line: ready / ready with conditions / not ready, and the main reason.
2. **Scope** -- what was tested (build, environment, date), what was left out and why.
3. **Results** -- counts by level (passed / failed / skipped / blocked) and notable trends versus the last run.
4. **Findings** -- ordered by severity, each in the form below.
5. **Coverage** -- numbers plus the specific untested areas that matter; a percentage alone says little.
6. **Recommendations** -- concrete next actions with an owner.
7. **Performance** -- measured values against targets, if run.

## Finding format

```
[HIGH] Refund is accepted twice for one payment
Where:     POST /refunds, payment-service 2.4.1
Steps:     1. pay order 1001  2. POST /refunds twice with the same payment id
Expected:  second call -> 409 ALREADY_REFUNDED
Actual:    201 both times; ledger shows two credits
Impact:    customers can be over-refunded
Evidence:  request/response log, test RefundIdempotencyIT
Fix hint:  unique constraint on (payment_id) in refunds; check inside the transaction
```

## Severity

| Level | Meaning | Release effect |
|---|---|---|
| Critical | data loss, security breach, or core flow unusable for everyone | blocks |
| High | major feature broken or wrong money/data, no workaround | blocks unless waived by the owner |
| Medium | feature impaired but a workaround exists | schedule |
| Low | cosmetic or rare edge | backlog |

Rate by user and business impact, not by how hard the fix is.

## Honesty rules

- Report what ran; mark everything else "not run".
- Separate confirmed defects from suspicions.
- Quote exact values, not "slow" or "wrong".
