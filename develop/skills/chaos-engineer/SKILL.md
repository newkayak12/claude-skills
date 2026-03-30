---
name: chaos-engineer
description: >-
  Use when someone wants to proactively test whether a distributed system will survive
  real failures — by designing controlled chaos experiments, injecting faults (network
  latency, pod deletion, zone outages), planning a game day exercise, or building
  rollback-safe automation for continuous resilience testing.
  Triggers on: "chaos experiment", "failure injection", "game day", "blast radius",
  "resilience testing", "Chaos Monkey", "Litmus Chaos", "fault injection", "카오스 테스트",
  "장애 주입", "게임 데이".
  Best for: pre-production resilience validation, game day planning, CI/CD chaos pipelines.
  Not for: SLO definition, incident response, or production monitoring setup — use sre-engineer.
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 실험 설계 시 블라스트 반경과 안전 제어를 더 체계적으로 평가합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: devops
  triggers: chaos engineering, resilience testing, failure injection, game day, blast radius, chaos experiment, fault injection, Chaos Monkey, Litmus Chaos, antifragile
  role: specialist
  scope: implementation
  output-format: code
  related-skills: sre-engineer, devops-engineer, kubernetes-specialist
---

# Chaos Engineer

## When to Use / When Not to Use

**Use when:**
- Designing and running controlled failure experiments before production incidents happen
- Planning game day exercises for the team
- Building blast radius controls and CI/CD chaos pipelines
- Improving resilience based on experiment findings

**Do not use when:**
- Responding to an active incident (use `sre-engineer` or `incident-response-playbook`)
- No monitoring stack exists — steady state cannot be verified without metrics

## Process

1. **System Analysis** — Map architecture, dependencies, critical paths, and failure modes. Confirm a monitoring stack (Prometheus, Datadog, or equivalent) exists before proceeding — chaos without observability is just breaking things.
2. **Experiment Design** — Define hypothesis, steady state metrics, blast radius, and safety controls
3. **Execute Chaos** — Run controlled experiments with monitoring and scripted rollback
4. **Learn & Improve** — Document findings, implement fixes, enhance monitoring
5. **Automate** — Integrate chaos testing into CI/CD for continuous resilience

## Safety Checklist

Enforce on every experiment:

- **Steady state first** — define and verify baseline metrics before injecting any failure
- **Blast radius cap** — start with the smallest possible impact scope; expand only after validation
- **Automated rollback ≤ 30 seconds** — abort path must be scripted and tested before the experiment begins
- **Single variable** — change only one failure condition at a time
- **No production without safety nets** — customer-facing environments require circuit breakers, feature flags, or canary isolation
- **Close the loop** — every experiment must produce a written learning summary and at least one tracked improvement

## Output Template

For each experiment, provide:
1. Experiment design document (hypothesis, steady-state metrics, blast radius)
2. Implementation code (failure injection scripts or manifests)
3. Monitoring setup and alert configuration
4. Rollback procedure (scripted, ≤ 30s)
5. Learning summary and improvement recommendations

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Drafts hypothesis and steady-state definition | Confirm the hypothesis reflects real business risk |
| Generates Litmus, toxiproxy, or Chaos Monkey config | Run experiments in your environment |
| Designs blast radius controls | Verify blast radius is acceptable before starting |
| Writes rollback scripts | Test rollback works before the experiment begins |
| Templates the learning summary | Fill in actual findings and assign follow-up tickets |

## Reference Guide

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Experiments | `references/experiment-design.md` | Designing hypothesis, blast radius, rollback |
| Infrastructure | `references/infrastructure-chaos.md` | Server, network, zone, region failures |
| Kubernetes | `references/kubernetes-chaos.md` | Pod, node, Litmus, chaos mesh experiments |
| Tools & Automation | `references/chaos-tools.md` | Chaos Monkey, Gremlin, Pumba, CI/CD integration |
| Game Days | `references/game-days.md` | Planning, executing, learning from game days |
| Post-Mortems | `references/post-mortem.md` | Post-mortem template for game days and unplanned production incidents |

## Example: Pod Failure Experiment (Litmus Chaos)

```yaml
# chaos-pod-delete.yaml
apiVersion: litmuschaos.io/v1alpha1
kind: ChaosEngine
metadata:
  name: my-service-pod-delete
  namespace: production
spec:
  appinfo:
    appns: production
    applabel: "app=my-service"
    appkind: deployment
  engineState: active
  chaosServiceAccount: litmus-admin
  experiments:
    - name: pod-delete
      spec:
        components:
          env:
            - name: TOTAL_CHAOS_DURATION
              value: "60"
            - name: CHAOS_INTERVAL
              value: "20"
            - name: PODS_AFFECTED_PERC
              value: "33"   # max 33% of replicas affected
```

For network latency (toxiproxy) and Chaos Monkey examples, see `references/chaos-tools.md`.

## Related Skills

- `sre-engineer` — SLO definition, error budgets, incident response
- `microservices-architect` — resilience pattern design for distributed systems
- `circuit-breaker-tuner` — configure failure thresholds before running chaos experiments
