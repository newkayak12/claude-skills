---
name: operations-workflow
description: >-
  Use when preparing a service for production, hardening a flaky system, or
  building lasting operational improvements after an incident. Triggers on:
  "production readiness review", "going to prod", "pre-launch ops check", system
  hardening", "운영 준비",
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

# Operations Workflow

4-phase production operations process: build → observe → harden → respond.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Pre-launch production readiness review | Active incident in progress — use incident-response-playbook directly |
| New service going to prod for the first time | Single-step need — run the individual skill directly |
| System showing recurring production issues | Quick config tweak with no systemic gaps |

---

## Workflow Overview

```
Phase 1: BUILD
  [1] dockerfile-optimizer      ← skip for non-container deployments
        |
        v
Phase 2: OBSERVE
  [2] sre-engineer              ← SLOs, error budgets, golden signals
        |
  [3] performance-profiling-optimization  ← baseline, bottlenecks, fix
        |
        v
Phase 3: HARDEN
  [4] circuit-breaker-tuner     ← downstream resilience, fallbacks
        |
  [5] chaos-engineer            ← run AFTER Step 4 is configured
        |
        v
Phase 4: RESPOND
  [6] incident-response-playbook  ← runbooks, severity matrix, RCA
```

---

## Steps

### Step 1 — Container Image Optimization
**Skill:** `dockerfile-optimizer`
**Goal:** Minimize image size, accelerate CI cache, harden container security
**Input:** Existing Dockerfile and target runtime stack
**Output:** Annotated before/after diff, size delta estimate, security findings
**Skip if:** Service is not containerized (VM, bare-metal, or FaaS)

> "Step 1 시작" 또는 "Dockerfile 최적화해줘"

---

### Step 2 — SLO and Observability Setup
**Skill:** `sre-engineer`
**Goal:** Define SLIs/SLOs, configure golden-signal dashboards, set multi-window burn-rate alerts
**Input:** Service architecture, traffic patterns, business reliability requirements
**Output:** SLO definitions, Prometheus alert rules (or equivalent), error budget policy, runbook stubs
**Skip if:** SLOs are already defined, approved, and alerting is active

> "Step 2 시작" 또는 "SLO와 모니터링 설정해줘"

---

### Step 3 — Performance Baseline and Profiling
**Skill:** `performance-profiling-optimization`
**Goal:** Establish latency/resource baseline, identify bottlenecks, verify fixes with data
**Input:** Running service with P50/P95/P99 metrics; load test or production traffic profile
**Output:** Problem statement, profiler evidence (flame graph), before/after comparison
**Skip if:** Performance is non-critical and P99 is within SLO headroom

> "Step 3 시작" 또는 "성능 프로파일링해줘"

---

### Step 4 — Circuit Breaker Configuration
**Skill:** `circuit-breaker-tuner`
**Goal:** Prevent cascading failures from slow or failing downstream dependencies
**Input:** List of downstream services, their typical latency, and recovery times
**Output:** Resilience4j YAML (or equivalent), fallback methods, bulkhead config, state-change alerts
**Skip if:** Service has no downstream dependencies or all calls are idempotent fire-and-forget

> "Step 4 시작" 또는 "서킷 브레이커 설정해줘"

---

### Step 5 — Chaos Experiments
**Skill:** `chaos-engineer`
**Goal:** Validate that circuit breakers, fallbacks, and SLO alerting hold under real failure conditions
**Input:** Step 4 circuit breaker config; Step 2 monitoring stack confirmed active
**Output:** Experiment design doc (hypothesis, blast radius, rollback), injection scripts, learning summary
**Skip if:** No monitoring stack exists — chaos without observability is undefined

> **Dependency:** Run only after Step 4 is deployed and verified.

> "Step 5 시작" 또는 "카오스 테스트 설계해줘"

---

### Step 6 — Incident Response Playbook
**Skill:** `incident-response-playbook`
**Goal:** Define severity classification, runbooks, escalation paths, and RCA template pre-launch
**Input:** Architecture, failure modes from Steps 4–5, SLO thresholds from Step 2
**Output:** Severity matrix (P0–P3), Slack templates, on-call runbook, RCA template
**Skip if:** Runbooks already exist and cover this service's failure modes

> "Step 6 시작" 또는 "인시던트 플레이북 만들어줘"

---

## State Tracking

어느 단계에 있는지 알려주면 바로 합류합니다: "컨테이너 없어" → Step 2, "SLO 이미 있어" → Step 3, "서킷 브레이커 됐어" → Step 5. Skip 조건에 해당하면 자동으로 다음 단계로 안내합니다.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Dockerfile 8-check analysis, annotated diff | Build and measure before/after image sizes |
| SLO targets, Prometheus alert YAML | Confirm SLOs reflect real user expectations |
| Profiler commands, bottleneck hypothesis, fix options | Run load tests; confirm fix in production |
| Circuit breaker thresholds with rationale, fallback stubs | Test under load; confirm recovery time |
| Chaos experiment design, blast radius controls, rollback scripts | Execute; verify rollback before starting |
| Runbook templates, severity matrix, RCA structure | Fill in environment-specific operational context |

## Related Skills

- Peer: `develop:dev-quality-workflow` (greenfield quality cycle, overlaps at Step 6)
- Before: `develop:architecture-designer` (system boundaries before hardening)
- After: `pm:post-launch-retrospective` (product-level retrospective after an incident)
- Individual: `dockerfile-optimizer`, `sre-engineer`, `performance-profiling-optimization`, `circuit-breaker-tuner`, `chaos-engineer`, `incident-response-playbook`
