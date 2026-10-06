---
name: chaos-engineer
description: >-
  Use when you want to test whether a system survives real failures. Triggers on: "장애 주입 테스트", "game day 준비", "pod
  죽여보고 싶어", "chaos experiment", "kill a pod in staging", "simulate zone outage". Not for active incidents.
scenarios:
  - "I want to run a chaos experiment on our Kubernetes cluster to test pod failure resilience"
  - "Help me plan a game day exercise to test our system's failure tolerance"
  - "Design a blast radius controlled fault injection for our microservices"
  - "카오스 테스트로 시스템 복원력을 검증하고 싶어"
  - "게임 데이 실험 설계를 도와줘"
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
  version: "1.1.0"
  area: resilience
  keywords: fault injection, game day, blast radius, steady-state hypothesis, Chaos Mesh, Litmus
  kind: specialist
  produces: experiment docs and injection code
  see-also: sre-engineer, microservices-architect, circuit-breaker-tuner
---

# Chaos Engineer

## When to Use / When Not to Use

**Use when:**
- You want to run deliberate, bounded failure experiments ahead of real outages
- A team game day needs planning
- Blast-radius limits or pipeline-based chaos checks need building
- Experiment results should turn into resilience fixes

**Do not use when:**
- Responding to an active incident (use `sre-engineer` or `incident-response-playbook`)
- No monitoring stack exists — steady state cannot be verified without metrics

## Process

1. **System Analysis** — Chart the components, what each depends on, the paths users rely on, and how each part can fail. Check that metrics collection (Prometheus, Datadog, or similar) is live first; without observability a failure test only causes damage.
2. **Experiment Design** — State the hypothesis, the normal-behaviour metrics, how far the fault may reach, and what stops it
3. **Execute Chaos** — Inject the fault under observation, with a scripted way back
4. **Learn & Improve** — Record what was found, fix weaknesses, close monitoring gaps
5. **Automate** — Put recurring experiments into the delivery pipeline so resilience is rechecked continuously

## Safety Checklist

Enforce on every experiment:

- **Baseline before fault** — measure the steady-state metrics and confirm they are stable before anything is injected
- **Smallest scope first** — begin with the narrowest blast radius; widen only after the previous size confirmed the hypothesis
- **Abort in 30 s or less** — the stop path is scripted and rehearsed before the experiment starts
- **One variable** — inject a single failure condition per run
- **Production needs a net** — anything customer-facing must already have breakers, flags, or canary isolation in place
- **Finish with a write-up** — every run closes with a short report and one or more tracked fixes

## Output Template

For each experiment, provide:
1. Design document: hypothesis, normal-behaviour metrics, scope of impact
2. Injection scripts or manifests
3. Dashboards and alert rules covering the experiment window
4. Rollback procedure (scripted, ≤ 30s)
5. Findings summary with proposed fixes

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Drafts hypothesis and steady-state definition | Confirm the hypothesis reflects real business risk |
| Generates Litmus, toxiproxy, or Chaos Monkey config | Run experiments in your environment |
| Designs blast radius controls | Verify blast radius is acceptable before starting |
| Writes rollback scripts | Test rollback works before the experiment begins |
| Templates the learning summary | Fill in actual findings and assign follow-up tickets |

## Reference Guide

| Need | File | Open when |
|------|------|-----------|
| Experiment sheet | `references/experiment-design.md` | writing the claim, scope rungs, abort triggers |
| Host and cloud faults | `references/infrastructure-chaos.md` | network, dependency, resource, zone, DNS, certificate faults |
| Cluster faults | `references/kubernetes-chaos.md` | pod, node, partition, autoscaling faults |
| Tooling | `references/chaos-tools.md` | picking a tool, random-kill scripts, pipeline gates |
| Game days | `references/game-days.md` | running a supervised session |
| Write-up | `references/post-mortem.md` | report after a game day or real incident |

## Example: Pod Kill Experiment (Chaos Mesh)

```yaml
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: orders-pod-kill
  namespace: staging
spec:
  action: pod-kill
  mode: fixed-percent
  value: "33"            # at most a third of matching pods
  selector:
    namespaces: [staging]
    labelSelectors:
      app: orders
```

`pod-kill` is one-shot: deleting the resource does not bring pods back, so cap the blast radius (`value`, selector) up front. For a fault that is held for a period and is undone on deletion, use `pod-failure` with `duration`. For any irreversible fault, write the manual recovery step (reschedule, restore, redeploy) before you start.

For network latency (toxiproxy) and Chaos Monkey examples, see `references/chaos-tools.md`.

## Related Skills

- `sre-engineer` — SLO definition, error budgets, incident response
- `microservices-architect` — resilience pattern design for distributed systems
- `circuit-breaker-tuner` — configure failure thresholds before running chaos experiments
