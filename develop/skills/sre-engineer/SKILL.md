---
name: sre-engineer
description: >-
  Use when setting up production reliability practices. Triggers on: "SLO 정하고 싶어", "에러 버짓", "알람 피로", "반복 작업(toil)
  줄이기", "golden signals dashboard", "burn-rate alert". Not for active incidents or chaos tests.
scenarios:
  - "Define SLOs and error budgets for our user-facing API services"
  - "Help me set up observability with metrics, logs, and distributed tracing"
  - "Design an on-call rotation and alerting strategy for our platform team"
  - "SLO와 에러 버짓을 정의하고 싶어"
  - "모니터링과 분산 트레이싱 전략을 수립해줘"
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

# SRE Engineer

## When to Use / When Not to Use

**Use when:**
- Establishing SLOs and error budgets for a service
- Building dashboards around the four golden signals, plus burn-rate alerts over paired windows
- Writing runbooks that tell on-call what to do
- Identifying and automating operational toil
- Planning capacity from traffic forecasts

**Do not use when:**
- Planning failure-injection experiments (use `chaos-engineer`)
- Provisioning infrastructure (use DevOps/IaC skills)

## Process

0. **Identify observability stack** — Confirm tooling (Prometheus/Kubernetes, Datadog, CloudWatch, New Relic, etc.) before generating any config. All reference examples default to Prometheus/Kubernetes.
1. **Assess reliability** — Look at the architecture, any SLOs already in place, past incidents and how much toil the team carries
2. **Define SLOs** — Choose SLIs that reflect user experience, then set a target for each
3. **Verify alignment** — Get the user to confirm the SLO targets. Do not move past this step until they have explicitly said yes.
4. **Implement monitoring** — Create golden-signal dashboards and burn-rate alerts that use a long and a short window
5. **Automate toil** — Find the repeated manual work and script it away
6. **Test resilience** — Plan and run failure experiments, then check that recovery stays within RTO and RPO

## Output Template

For each SRE engagement, provide:
1. SLO definitions: each SLI, how it is measured, and its target
2. Monitoring and alerting configuration, as Prometheus YAML or the equivalent
3. Automation scripts for the toil identified (Kotlin, Python, Go, or Terraform)
4. Runbooks whose steps end in a concrete remediation
5. Brief note on reliability impact

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
| SLO/SLI and budgets | `references/slo-and-budgets.md` | Defining SLOs, error budgets, burn rates, policy |
| Monitoring | `references/monitoring-alerting.md` | Four signals, what to page on, runbooks, dashboards |
| Toil and capacity | `references/toil-and-capacity.md` | Toil reduction, forecasting growth, scaling decisions |
| Incidents | `references/incidents.md` | Postmortems, severity, resilience drills |

## Telemetry Rules

- **Carry one correlation ID across services** (propagate the trace/request ID in headers and every log line) — without it a request cannot be followed across hops, so the cause stays a guess.
- **Bound label cardinality** — every distinct label combination is its own time series; user IDs, URLs, or request IDs as labels blow up storage and query cost. Keep labels to small fixed sets.
- **Never log secrets, tokens, or full PII** — logs are copied to many systems with weaker access control and long retention; mask or drop them at the source.
- **Verify the alert actually fires** — fire it once (inject the condition or lower the threshold) and see the page arrive; an alert never seen firing is an assumption, not a safeguard.

Runbook format for alerts: see `incident-response-playbook`; a short skeleton is in `references/monitoring-alerting.md`.

## Example: SLO Definition and Error Budget

```
# Objective: 99.9% success ratio, 30-day rolling window
# Budget in time:     0.001 x 43,200 min = 43.2 min
# Budget in requests: 0.001 x 10M requests = 10,000 failures
# 5,000 failures in week one = half the budget gone with 75% of the window left
# -> the error budget policy kicks in: hold non-critical releases
```

## Example: Fast-Burn Alert Rule

```yaml
groups:
  - name: availability_slo
    rules:
      # Fast burn: 14.4x sustainable rate (2% of the 30-day budget in one hour)
      - alert: ErrorBudgetFastBurn
        expr: |
          (
            sum(rate(http_server_requests_seconds_count{status=~"5.."}[1h]))
            / sum(rate(http_server_requests_seconds_count[1h]))
          ) > (0.001 * 14.4)
          and
          (
            sum(rate(http_server_requests_seconds_count{status=~"5.."}[5m]))
            / sum(rate(http_server_requests_seconds_count[5m]))
          ) > (0.001 * 14.4)
        labels:
          severity: page
        for: 2m
        annotations:
          runbook: "runbook link for this alert"
```

## Constraints

**MUST DO:**
- Identify the observability stack before generating any config
- Confirm SLO targets with the user before generating alert rules
- State every SLO as a number with a window, never as an adjective
- Cover latency, traffic, errors and saturation for each service
- Run a blameless postmortem after every incident
- Measure toil and report how it trends

**MUST NOT DO:**
- Pick an SLO target with no stated user impact
- Page on a condition that has no runbook
- Tolerate >50% toil without an automation plan
- Skip a postmortem, or write one that names a culprit
- Leave a recurring task as a manual procedure

## Related Skills

- `chaos-engineer` — design and run failure experiments
- `circuit-breaker-tuner` — reduce error budget consumption from cascading failures
- `database-optimizer` — improve DB golden signals (latency, saturation)
- `incident-response-playbook` — structured response when SLO is burning fast
