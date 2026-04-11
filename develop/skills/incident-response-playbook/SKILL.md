---
name: incident-response-playbook
effort: high
description: >-
  Guides the developer-side incident lifecycle from triage through mitigation to
  blameless RCA — with severity classification, Slack update templates,
  escalation paths, and a structured post-mortem format. Use when a production
  issue is active or...
scenarios:
  - "We just had a production outage and need a structured incident response process"
  - "Help me create an on-call runbook for database failures"
  - "Design an incident response playbook for our SRE team"
  - "프로덕션 장애가 발생했는데 대응 프로세스가 없어"
  - "온콜 런북과 인시던트 대응 플레이북을 만들어줘"
compatibility:
  recommended:
    - sequential-thinking
    - think-tool
  optional: []
  remote_mcp_note: >-
    sequential-thinking은 탐지 → 트리아지 → 완화 → RCA 단계를 순서대로 진행할 때 유용합니다.
    think-tool은 장애 원인 분석과 우선순위 판단에 활용됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS classify severity before any other action — severity drives escalation and communication cadence.
- ALWAYS separate mitigation (restore service) from investigation (find root cause) — do not block one on the other.
- NEVER assign blame to individuals in post-mortems — focus on systemic factors.
- NEVER skip the timeline reconstruction step in RCA; gaps in the timeline are often the cause.


# Incident Response Playbook

Speed matters. Clarity matters more. Blame solves nothing.

---

## Incident Lifecycle

```
Detect → Triage → Communicate → Mitigate → Resolve → Learn
```

Each phase has a clear exit condition. Do not skip phases under pressure.

---

## Severity Classification

| Severity | Definition | Response Time | Example |
|----------|-----------|---------------|---------|
| **P0** | Full service down; all users affected; revenue/data at risk | Immediate — page on-call now | Checkout API 100% error rate |
| **P1** | Major feature broken; significant user subset affected | < 15 min | Payment processing failing for 30% of users |
| **P2** | Degraded performance or partial feature failure | < 1 hour | Search latency 10x normal; some timeouts |
| **P3** | Minor issue; workaround available; low user impact | Next business day | Dashboard chart missing for 5% of users |

**Escalate up, not down.** When in doubt, treat as higher severity.

---

## Phase 1 — Detect

Sources of detection (in order of reliability):
1. Automated alert (PagerDuty, OpsGenie, CloudWatch alarm)
2. Synthetic monitor / uptime check failure
3. User report via support ticket or social media
4. Team member notices in logs or dashboard

**First action on detection**: open an incident channel immediately, even if you're still diagnosing.

---

## Phase 2 — Triage (target: < 5 min for P0/P1)

Answer these questions fast:

1. **What is broken?** (service, endpoint, feature)
2. **Who is affected?** (all users / subset / internal only)
3. **When did it start?** (check deploy history, config changes, upstream alerts)
4. **What changed recently?** (deployments, feature flags, infra changes, dependency updates)
5. **What is the blast radius?** (data corruption? revenue loss? SLA breach?)

**Triage output**: severity classification + incident commander assigned.


---

## Phase 3 — Communicate

### Rule: communicate before you know the answer.
Silence is worse than "we're investigating." Update every 15–30 min for P0/P1.

### Internal Slack Update Template

```
[P0] <Service> - <Brief description>
Status: Investigating / Identified / Mitigating / Resolved
Impact: <Who is affected and how>
Start time: <HH:MM UTC>
Last update: <HH:MM UTC>
IC: @<incident-commander>
Bridge: <link to war room>
Next update: <HH:MM UTC>
```

### Status Page Update Template

```
Investigating: We are aware of an issue affecting <service/feature>.
Our team is actively investigating. We will provide an update by <time>.

Identified: We have identified the cause of the issue affecting <service/feature>.
We are working on a fix and expect resolution by <time>.

Resolved: The issue affecting <service/feature> has been resolved as of <time>.
All systems are operating normally. An RCA will be published within 48 hours.
```

**What NOT to say publicly**: internal system names, specific error messages that reveal architecture, speculation about cause before confirmed.

---

## Phase 4 — Mitigate

Goal: **reduce user impact now**, even if the root cause isn't fully understood.

Common mitigation actions (fastest to slowest):

| Action | When to Use | Risk |
|--------|-------------|------|
| Rollback last deployment | Issue started after deploy | Low if rollback is clean |
| Disable feature flag | Feature-specific failure | Low |
| Increase replica count / scale out | Overload / capacity issue | Medium (cost) |
| Enable circuit breaker / shed load | Cascading failure risk | Medium (some users see errors) |
| Redirect traffic to healthy region | Regional failure | Medium (requires DNS/LB change) |
| Restore from backup | Data loss / corruption | High — requires validation |

**Mitigation ≠ Fix.** Document that mitigation is a temporary measure. The real fix comes after the incident.

---

## Phase 5 — Resolve

Exit criteria for "Resolved":
- [ ] Error rate back to baseline
- [ ] Latency back to baseline
- [ ] All monitors green
- [ ] No new alerts firing
- [ ] Affected users notified (if required)
- [ ] Incident channel archived or closed

---

## Phase 6 — Learn (RCA / Post-Mortem)

Target: publish RCA within 48–72 hours for P0/P1.

### RCA Template

```markdown
## Incident RCA: <Title>

**Date**: YYYY-MM-DD
**Duration**: X hours Y minutes
**Severity**: P0 / P1 / P2
**Services Affected**: <list>
**Author(s)**: <names>
**Status**: Draft / Final

---

### Summary
One paragraph. What happened, what was the user impact, how was it resolved.

### Timeline
| Time (UTC) | Event |
|------------|-------|
| HH:MM | Alert fired / issue first detected |
| HH:MM | On-call paged |
| HH:MM | Triage complete; P0 declared |
| HH:MM | Root cause identified |
| HH:MM | Mitigation applied |
| HH:MM | Incident resolved |

### Root Cause
Specific, technical explanation. Not "human error" — explain what made the error possible.

### Contributing Factors
- Factor 1 (e.g., no alerting on X metric)
- Factor 2 (e.g., runbook for this scenario was missing)
- Factor 3 (e.g., deploy pipeline did not catch Y in staging)

### What Went Well
- ...

### Action Items
| Item | Owner | Due Date | Priority |
|------|-------|----------|----------|
| Add alert for X | @person | YYYY-MM-DD | High |
| Update runbook for Y scenario | @person | YYYY-MM-DD | Medium |
| Add canary deploy for Z service | @person | YYYY-MM-DD | High |
```

### Blameless Culture

**Document**: what systems failed, what processes were missing, what made the failure possible.

**Avoid**: naming individuals as the cause, language like "engineer forgot to", "someone accidentally".

**Reframe**: "The deploy pipeline did not have a canary stage that would have caught this" instead of "Alice pushed bad code."

People make mistakes. Systems should make mistakes hard to cause and easy to detect.

---

## Incident Commander Checklist

- [ ] Severity declared
- [ ] Incident channel opened
- [ ] Responders assigned (IC, tech lead, comms)
- [ ] First communication sent (internal + external if needed)
- [ ] Mitigation action identified and being executed
- [ ] 15–30 min update cadence established
- [ ] Resolution confirmed across all metrics
- [ ] RCA scheduled

---

## Escalation Paths

| Situation | Escalate To |
|-----------|-------------|
| DB corruption, query issues, slow DB | [`../database-optimizer/SKILL.md`](../database-optimizer/SKILL.md) |
| Performance degradation, high CPU/memory | [`../performance-profiling-optimization/SKILL.md`](../performance-profiling-optimization/SKILL.md) |
| Observability gaps, SLO/alerting setup | [`../sre-engineer/SKILL.md`](../sre-engineer/SKILL.md) |
| Understanding failure modes before they happen | [`../chaos-engineer/SKILL.md`](../chaos-engineer/SKILL.md) |
| Writing and storing the RCA | [`../documentation-strategy/SKILL.md`](../documentation-strategy/SKILL.md) |
| Product-level retrospective on why the incident happened (hypothesis/feature decision) | `pm:post-launch-retrospective` skill — that skill owns product hypothesis validation; this skill owns technical RCA |
