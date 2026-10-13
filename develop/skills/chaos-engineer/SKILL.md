---
name: chaos-engineer
description: >-
  Use when you want to test whether a system survives real failures. Triggers on: "장애 주입 테스트", "game day 준비", "pod
  죽여보고 싶어", "chaos experiment", "kill a pod in staging", "simulate zone outage". Not for active incidents.
scenarios:
  - "I want to run a chaos experiment on our Kubernetes cluster to test pod failure resilience"
  - "Help me plan a game day exercise to test our system's failure tolerance"
  - "Design a blast-radius-controlled fault injection for our microservices"
  - "카오스 테스트로 시스템 복원력을 검증하고 싶어"
  - "게임 데이 실험 설계를 도와줘"
  - "스테이징에서 pod 하나 죽여보고 싶은데 어떻게 안전하게 해?"
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
  see-also: sre-engineer, architecture-designer, circuit-breaker-tuner
---

## Standing Mandates

- NEVER design an experiment without a steady-state metric that is live now. With no observability, a failure test only
  causes damage and proves nothing; if there is none, stop and say so.
- NEVER inject before the abort path is written and the user has rehearsed it. A fault with no scripted way back turns
  an experiment into an incident.
- NEVER widen the blast radius in the same run. Start at the narrowest scope; widen only after the previous size
  confirmed the hypothesis, otherwise a failure cannot be traced to one cause.
- NEVER inject two faults in one run: the result could not say which one broke the system.
- NEVER invent a missing fact (dependencies, current SLO, existing breakers). Mark `[확인 필요: ○○]`; an experiment
  built on a guessed topology tests the guess.
- Goal: every experiment has a hypothesis, a live steady-state metric, a scope, an abort trigger and a scripted abort of
  30 s or less; the closing tally recounts to the experiment sheets.

# Chaos Engineer

**Not for** an active incident (`develop:incident-response-playbook`), SLO or alert setup (`develop:sre-engineer`),
or tuning the breaker itself (`develop:circuit-breaker-tuner`).

## Process

1. **System analysis** — chart components, dependencies, user-critical paths, how each can fail. Read the repo,
   manifests and dashboards first. Confirm metrics collection (Prometheus, Datadog or similar) is live.
2. **Experiment design** — hypothesis, normal-behaviour metrics, how far the fault may reach, what stops it. Fill
   `references/experiment-design.md`.
3. **Execute** — user runs it; inject under observation with the scripted way back at hand.
4. **Learn** — record what was found, fix weaknesses, close monitoring gaps; every run ends with a write-up and one or
   more tracked fixes (`references/post-mortem.md`).
5. **Automate** — put recurring experiments into the delivery pipeline.
6. **Recount** — count experiments, the ones with all five fields, and the findings; fix the tally if the sheets differ.

## Safety Checklist

Enforce on every experiment:

- **Baseline before fault** — measure the steady-state metrics and confirm they are stable before anything is injected
- **Smallest scope first** — narrowest blast radius first
- **Abort in 30 s or less** — the stop path is scripted and rehearsed before the experiment starts
- **One variable** — a single failure condition per run
- **Production needs a net** — anything customer-facing must already have breakers, flags, or canary isolation in place;
  without them a bounded test can still reach users
- **Finish with a write-up** — short report, tracked fixes

## Output Template

```
## Experiment — <title> (<env>)

Hypothesis: <when X fails, Y stays within Z>
Steady state: <metric, normal range, live? yes/no>
Scope: <rung> · Abort trigger: <condition> · Abort script: <command> (<s> s)
Injection: <manifest or script>
Result: confirmed / refuted / aborted — <metric reading>
Fixes: <tracked item, owner>
Gaps: [확인 필요: ○○] ...

<n> experiments · <c> confirmed · <r> refuted · <a> aborted · <g> gaps
```

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

- `develop:sre-engineer` — SLO definition, error budgets, alerting
- `develop:incident-response-playbook` — when the failure is real and active
- `develop:architecture-designer` — resilience pattern design for distributed systems
- `develop:circuit-breaker-tuner` — configure failure thresholds before running chaos experiments
