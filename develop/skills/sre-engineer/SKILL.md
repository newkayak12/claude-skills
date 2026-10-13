---
name: sre-engineer
description: >-
  Use when setting up production reliability practices. Triggers on: "SLO 정하고 싶어", "에러 버짓", "알람 피로", "반복 작업(toil)
  줄이기", "golden signals dashboard", "burn-rate alert". Not for active incidents or chaos tests.
scenarios:
  - "Define SLOs and error budgets for our user-facing API services"
  - "Help me set up observability with metrics, logs, and distributed tracing"
  - "Our pager is noisy — fix the alerting with burn-rate alerts"
  - "SLO와 에러 버짓을 정의하고 싶어"
  - "모니터링과 분산 트레이싱 전략을 수립해줘"
  - "알람이 너무 많이 울려서 피로해, 정리해줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 SLO 목표 설정의 비즈니스 임팩트와 트레이드오프를 더 깊이 분석합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
license: MIT
metadata:
  version: "1.1.0"
  domain: devops
  triggers: SRE, SLO, SLI, error budget, burn rate, toil, on-call, alert fatigue, golden signals
---

## Standing Mandates

- NEVER pick an SLO target the user has not confirmed. A target Claude chose alone is a guess that alert rules then
  enforce; confirm it before any alert rule is written.
- NEVER state an SLO as an adjective ("highly available"). It is a number with a window, because only a number can be
  burned down and recounted.
- NEVER page on a condition that has no runbook. The page wakes a person who then has nothing to do.
- NEVER invent a missing fact (traffic, current error rate, stack). Write `[확인 필요: ○○]` and stop at that point;
  an SLO built on a made-up baseline is wrong from day one.
- Goal: every SLO has a number, a window, a user-impact sentence and a confirmed target, and every page-level alert has
  a runbook line; the closing tally recounts to the SLO and alert tables.

# SRE Engineer

**Not for** an active incident or postmortem (`develop:incident-response-playbook`), failure-injection experiments
(`develop:chaos-engineer`), or provisioning infrastructure (IaC skills).

## Process

1. **Identify the observability stack** — Prometheus/Kubernetes, Datadog, CloudWatch, New Relic. Examples default to
   Prometheus/Kubernetes; do not emit config for a stack you have not confirmed.
2. **Assess reliability** — read the architecture, any SLOs in place, past incidents, current toil. Read the repo and
   configs before asking anything they answer.
3. **Define SLOs** — pick SLIs that reflect user experience, then a target for each. Mark unknown traffic or error
   rates `[확인 필요: ○○]`.
4. **Verify alignment** — the user confirms each target. Do not move past this step until they have said yes; what
   downtime is acceptable is the user's decision, not Claude's.
5. **Implement monitoring** — golden-signal dashboards (latency, traffic, errors, saturation per service) and
   burn-rate alerts over a long and a short window. Worked budget math and a fast-burn rule:
   `references/slo-and-budgets.md`. Fire each alert once and see the page arrive; an alert never seen firing is an
   assumption. Telemetry rules (correlation ID, label cardinality, no secrets in logs): `references/monitoring-alerting.md`.
6. **Automate toil** — find repeated manual work, measure it, script it. A recurring task left manual needs a stated
   reason.
7. **Test resilience** — hand failure experiments to `develop:chaos-engineer`; check recovery against RTO and RPO.
8. **Recount** — count SLOs, page-level alerts and runbook lines; fix the tally line if they differ from the tables.

## Output Template

```
## SRE plan — <service> (<observability stack>)

| SLI | Measured how | Target | Window | User impact if missed | Confirmed |
|-----|--------------|--------|--------|-----------------------|-----------|

| Alert | Condition (long/short window) | Severity | Runbook |
|-------|-------------------------------|----------|---------|

Toil: <task> — <hours/week> — <automation or reason it stays manual>
Gaps: [확인 필요: ○○] ...

<n> SLOs (<c> confirmed) · <a> alerts (<r> with runbook) · <g> gaps
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Drafts SLO targets from service type and traffic patterns | Confirm targets reflect actual user expectations |
| Generates Prometheus alert rules with burn-rate windows | Configure in your monitoring stack |
| Writes error budget calculation and burn-rate thresholds | Approve the error budget policy |
| Creates toil automation scripts | Test and deploy automation safely |
| Templates runbooks with remediation steps | Fill in environment-specific details |

## Reference Guide

| Topic | File | Read when |
|---|---|---|
| SLO/SLI and budgets | `references/slo-and-budgets.md` | Defining SLOs, error budgets, burn rates, policy, worked examples |
| Monitoring | `references/monitoring-alerting.md` | Four signals, what to page on, runbooks, dashboards, telemetry rules |
| Toil and capacity | `references/toil-and-capacity.md` | Toil reduction, forecasting growth, scaling decisions |
| Incidents | `references/incidents.md` | Postmortems, severity, resilience drills |

Runbook format for alerts: `develop:incident-response-playbook`; a short skeleton is in `references/monitoring-alerting.md`.

## Related Skills

- `develop:chaos-engineer` — design and run failure experiments
- `develop:circuit-breaker-tuner` — reduce error budget consumption from cascading failures
- `develop:database-optimizer` — improve DB golden signals (latency, saturation)
- `develop:incident-response-playbook` — structured response when SLO is burning fast
