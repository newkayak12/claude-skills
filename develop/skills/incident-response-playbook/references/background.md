# Background

Moved from SKILL.md; content unchanged.

## Detection sources

Sources of detection (in order of reliability):
1. Automated alert (PagerDuty, OpsGenie, CloudWatch alarm)
2. Synthetic monitor / uptime check failure
3. User report via support ticket or social media
4. Team member notices in logs or dashboard

## Common mitigation actions

Common mitigation actions (fastest to slowest):

| Action | When to Use | Risk |
|--------|-------------|------|
| Rollback last deployment | Issue started after deploy | Low if rollback is clean |
| Disable feature flag | Feature-specific failure | Low |
| Increase replica count / scale out | Overload / capacity issue | Medium (cost) |
| Enable circuit breaker / shed load | Cascading failure risk | Medium (some users see errors) |
| Redirect traffic to healthy region | Regional failure | Medium (requires DNS/LB change) |
| Restore from backup | Data loss / corruption | High — requires validation |

## Blameless culture

**Document**: what systems failed, what processes were missing, what made the failure possible.

**Avoid**: naming individuals as the cause, language like "engineer forgot to", "someone accidentally".

**Reframe**: "The deploy pipeline did not have a canary stage that would have caught this" instead of "Alice pushed bad code."

People make mistakes. Systems should make mistakes hard to cause and easy to detect.

## Incident commander checklist

- [ ] Severity declared
- [ ] Incident channel opened
- [ ] Responders assigned (IC, tech lead, comms)
- [ ] First communication sent (internal + external if needed)
- [ ] Mitigation action identified and being executed
- [ ] 15–30 min update cadence established
- [ ] Resolution confirmed across all metrics
- [ ] RCA scheduled
- [ ] Runbook used in this incident refreshed
