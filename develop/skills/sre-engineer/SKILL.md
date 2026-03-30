---
name: sre-engineer
description: >-
  Use when someone needs to establish or improve production reliability practices:
  defining SLOs and error budgets, setting up golden-signal alerting and dashboards,
  building incident response runbooks, reducing operational toil through automation,
  or planning capacity.
  Triggers on: "define SLOs", "error budget", "golden signals", "on-call runbook",
  "reduce toil", "capacity planning", "SRE practices", "SLI SLO SLA",
  "SLO 설정", "에러 버짓", "온콜 런북", "골든 시그널 모니터링", "운영 자동화".
  Best for: SLO definition, Prometheus alerting, toil automation, postmortems.
  Not for: chaos experiment design (use chaos-engineer); infrastructure provisioning.
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
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: devops
  triggers: SRE, site reliability, SLO, SLI, error budget, incident management, chaos engineering, toil reduction, on-call, MTTR
  role: specialist
  scope: implementation
  output-format: code
  related-skills: devops-engineer, cloud-architect, kubernetes-specialist
---

# SRE Engineer

## When to Use / When Not to Use

**Use when:**
- Establishing SLOs and error budgets for a service
- Building golden-signal dashboards and multi-window burn-rate alerts
- Writing incident response runbooks with clear remediation steps
- Identifying and automating operational toil
- Planning capacity from traffic forecasts

**Do not use when:**
- Designing chaos experiments (use `chaos-engineer`)
- Provisioning infrastructure (use DevOps/IaC skills)

## Process

0. **Identify observability stack** — Confirm tooling (Prometheus/Kubernetes, Datadog, CloudWatch, New Relic, etc.) before generating any config. All reference examples default to Prometheus/Kubernetes.
1. **Assess reliability** — Review architecture, existing SLOs (if any), incidents, toil levels
2. **Define SLOs** — Identify meaningful SLIs and set appropriate targets
3. **Verify alignment** — Confirm SLO targets with the user before proceeding. Do not proceed past this step without explicit confirmation.
4. **Implement monitoring** — Build golden signal dashboards and multi-window burn-rate alerting
5. **Automate toil** — Identify repetitive tasks and build automation
6. **Test resilience** — Design and execute chaos experiments; verify recovery meets RTO/RPO

## Output Template

For each SRE engagement, provide:
1. SLO definitions with SLI measurements and targets
2. Monitoring/alerting configuration (Prometheus YAML or equivalent)
3. Automation scripts (Python, Go, Terraform)
4. Runbooks with clear remediation steps
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

| Topic | Reference | Load When |
|-------|-----------|-----------|
| SLO/SLI | `references/slo-sli-management.md` | Defining SLOs, calculating error budgets |
| Error Budgets | `references/error-budget-policy.md` | Managing budgets, burn rates, policies |
| Monitoring | `references/monitoring-alerting.md` | Golden signals, alert design, dashboards |
| Automation | `references/automation-toil.md` | Toil reduction patterns |
| Capacity Planning | `references/capacity-planning.md` | Forecasting growth, scaling decisions |
| Incidents | `references/incident-chaos.md` | Incident response, chaos engineering |

## Example: SLO Definition and Error Budget

```
# 99.9% availability SLO over a 30-day window
# Allowed downtime: (1 - 0.999) * 30 * 24 * 60 = 43.2 minutes/month
# Error budget (request-based): 0.001 * total_requests
# 10M requests/month → 10,000 error budget requests
# If 5,000 errors consumed in week 1 → 50% budget burned in 25% of window
# → Trigger error budget policy: freeze non-critical releases
```

## Example: Prometheus Multi-Window Burn Rate Alert

```yaml
groups:
  - name: slo_availability
    rules:
      # Fast burn: 2% budget in 1h (14.4x burn rate)
      - alert: HighErrorBudgetBurn
        expr: |
          (
            sum(rate(http_requests_total{status=~"5.."}[1h]))
            / sum(rate(http_requests_total[1h]))
          ) > 0.014400
          and
          (
            sum(rate(http_requests_total{status=~"5.."}[5m]))
            / sum(rate(http_requests_total[5m]))
          ) > 0.014400
        for: 2m
        labels:
          severity: critical
        annotations:
          runbook: "https://wiki.internal/runbooks/high-error-burn"
```

## Constraints

**MUST DO:**
- Identify the observability stack before generating any config
- Confirm SLO targets with the user before generating alert rules
- Define quantitative SLOs (e.g., 99.9% availability, not "high availability")
- Monitor all four golden signals (latency, traffic, errors, saturation)
- Write blameless postmortems for all incidents
- Measure toil and track reduction progress

**MUST NOT DO:**
- Set SLOs without user impact justification
- Alert on symptoms without actionable runbooks
- Tolerate >50% toil without an automation plan
- Skip postmortems or assign blame
- Implement manual processes for recurring tasks

## Related Skills

- `chaos-engineer` — design and run failure experiments
- `circuit-breaker-tuner` — reduce error budget consumption from cascading failures
- `database-optimizer` — improve DB golden signals (latency, saturation)
- `incident-response-playbook` — structured response when SLO is burning fast
