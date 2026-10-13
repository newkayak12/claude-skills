---
name: operations-workflow
description: >-
  Use when preparing a service for production, hardening a flaky system, or
  building lasting operational improvements after an incident. Triggers on:
  "production readiness review", "going to prod", "pre-launch ops check",
  "system hardening", "운영 준비".
type: workflow
theme: operations
scenarios:
  - "Run a full production readiness review before we launch next week"
  - "New microservice going to prod — walk me through the full ops setup"
  - "System has been flaky in production, help me harden it end-to-end"
  - "프로덕션 출시 전 운영 준비 전체 점검해줘"
  - "새 서비스 처음 배포하는데 운영 셋업 단계별로 가보자"
  - "장애 반복되는 서비스 안정화 프로세스 전체 돌려줘"
estimated_time: "4-16 hours (full), 1-3 hours per step"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool은 SLO 설정, 서킷 브레이커 임계값, 카오스 블라스트 반경 분석에 유효합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER mark a step done on Claude's own say-so. Each step skill returns its verdict; relay it verbatim and never grade
  its output yourself, because the pass that produced the work cannot judge it.
- NEVER restate a step skill's method here; invoke it by name. Two copies of one method drift apart.
- NEVER skip a step on a hunch. A skip needs the step's Skip-if evidence, quoted.
- NEVER run Step 5 (chaos) before Step 4 is deployed and Step 2's monitoring is confirmed live; a failure test with no
  breaker or no metrics only causes damage.
- NEVER supply a missing input (SLOs, downstream list, recovery times). Mark `[확인 필요: ○○]`; the step blocks there.
- Goal: each step run, skipped with evidence, or blocked with its missing input, one step per turn unless the user
  asks to continue, and the closing tally recounts to the step lines.

# Operations Workflow

4-phase production operations process: build, observe, harden, respond.

**Not for** an active incident (`develop:incident-response-playbook` directly) or a single-step need (run that skill
directly).

## Steps

| # | Phase | Skill | Input | Output | Skip if |
|---|-------|-------|-------|--------|---------|
| 1 | Build | `develop:dockerfile-optimizer` | Dockerfile, target runtime stack | Annotated before/after diff, size delta, security findings | Service is not containerized (VM, bare-metal, FaaS) |
| 2 | Observe | `develop:sre-engineer` | Architecture, traffic patterns, reliability requirements | SLO definitions, burn-rate alert rules, error budget policy, runbook stubs | SLOs already defined, approved, alerting active |
| 3 | Observe | `develop:performance-profiling-optimization` | Running service with P50/P95/P99 metrics; load test or production traffic profile | One-line problem statement, profiler evidence, before/after comparison | Performance non-critical and P99 within SLO headroom |
| 4 | Harden | `develop:circuit-breaker-tuner` | Downstream list, typical latency, recovery times | Resilience4j config (or equivalent), fallbacks, bulkhead, state-change alerts | No downstream dependencies, or all calls idempotent fire-and-forget |
| 5 | Harden | `develop:chaos-engineer` | Step 4 config deployed; Step 2 monitoring live | Experiment design (hypothesis, blast radius, rollback), injection scripts, learning summary | No monitoring stack exists |
| 6 | Respond | `develop:incident-response-playbook` | Architecture, failure modes from Steps 4-5, SLO thresholds from Step 2 | Severity matrix (P0-P3), comms templates, on-call runbook, RCA template | Runbooks already exist and cover this service's failure modes |

Start prompts: "Step N 시작" or name the skill. Say where you are and the run joins there ("컨테이너 없어" -> Step 2,
"SLO 이미 있어" -> Step 3, "서킷 브레이커 됐어" -> Step 5). Step 6's RCA flags product-decision root causes to the
feature owner (see that skill).
Before sending, recount the tally against the step lines; fix the header if they differ.

## Output Template

```
## Operations workflow — <service>

| Step | Skill | Status (done / skipped: <Skip-if evidence> / blocked: [확인 필요: ○○]) | Finding |
|------|-------|-----|---------|

Next: <step N, or "complete">
<d> done · <s> skipped · <b> blocked
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Runs each step skill and carries its output to the next | Supply each step's inputs and decide skips |
| Flags a missing input before the step runs | Confirm SLOs reflect real user expectations |
| Drafts SLOs, thresholds, experiments, runbooks | Build and measure images; run load tests; test breakers under load |
| Keeps the tally | Execute chaos experiments (verify rollback first); fill in environment-specific context |

## Related Skills

- Before: `develop:architecture-designer` (system boundaries before hardening)
- Adjacent: `develop:clean-code` (code review gate for the changes these steps produce)
- Individual: `develop:dockerfile-optimizer`, `develop:sre-engineer`, `develop:performance-profiling-optimization`, `develop:circuit-breaker-tuner`, `develop:chaos-engineer`, `develop:incident-response-playbook`
