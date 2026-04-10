---
name: dev-quality-workflow
description: >-
  Use when starting a new feature or system from scratch and wanting to follow a
  full quality engineering process — from architecture through to incident
  readiness. Triggers on: "dev quality process", "새 기능 처음부터 제대로", "개발 품질 전체",
  "full dev cycle",
type: workflow
theme: engineering
scenarios:
  - "dev workflow 전체 돌려줘"
  - "새 기능 처음부터 제대로 해보자"
  - "full engineering quality cycle"
  - "개발 품질 프로세스 시작"
estimated_time: "1-3 days (full), 1-4 hours per step"
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool은 architecture와 DDD 설계 단계에서 특히 유효합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Dev Quality Workflow

6-step engineering quality process: design → domain → test → performance → docs → operations.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| Greenfield feature or system | Quick bug fix |
| Major refactor affecting multiple layers | Iterating on existing working code |
| Onboarding a new technology | Single-file or single-function change |

---

## Workflow Overview

```
[1] Architecture Design
        ↓
[2] Domain Modeling (DDD)
        ↓
[3] Test-Driven Development
        ↓
[4] Performance Profiling
        ↓
[5] Documentation
        ↓
[6] Incident Readiness
```

---

## Steps

### Step 1 — Architecture Design
**Skill:** `architecture-designer`
**Goal:** Define system boundaries, component responsibilities, key decisions
**Output:** Architecture diagram, ADR list, complexity classification
**Skip if:** Architecture already documented and approved

> "Step 1 시작" 또는 "architecture 설계해줘"

---

### Step 2 — Domain-Driven Design
**Skill:** `domain-driven-design`
**Goal:** Model the domain with bounded contexts, aggregates, domain events
**Input:** Architecture from Step 1
**Output:** Domain model, context map, ubiquitous language glossary
**Skip if:** Domain is well-understood and team has shared model

> "Step 2 시작" 또는 "DDD 모델링해줘"

---

### Step 3 — Test-Driven Development
**Skill:** `test-driven-development`
**Goal:** Write failing tests first, then implement to make them pass
**Input:** Domain model + acceptance criteria
**Output:** Test suite (unit + integration), implementation meeting tests
**Skip if:** Exploratory spike — validate concept first, then TDD

> "Step 3 시작" 또는 "TDD로 개발해줘"

---

### Step 4 — Performance Profiling & Optimization
**Skill:** `performance-profiling-optimization`
**Goal:** Identify bottlenecks, set SLOs, apply targeted optimizations
**Input:** Working implementation from Step 3
**Output:** Performance baseline, hotspot analysis, optimization plan
**Skip if:** Performance is non-critical for this feature

> "Step 4 시작" 또는 "performance 확인해줘"

---

### Step 5 — Documentation Strategy
**Skill:** `documentation-strategy`
**Goal:** Plan and write the right docs for the right audience
**Input:** Architecture, domain model, APIs from Steps 1-4
**Output:** Doc taxonomy, architecture overview, runbook, onboarding guide
**Skip if:** Internal tool with a single maintainer

> "Step 5 시작" 또는 "문서화 전략 잡아줘"

---

### Step 6 — Incident Response Playbook
**Skill:** `incident-response-playbook`
**Goal:** Define runbooks, alert thresholds, on-call procedures before going live
**Input:** System architecture + known failure modes
**Output:** Runbook, alert config, severity matrix, escalation path
**Skip if:** Feature is behind a feature flag with zero external traffic initially

> "Step 6 시작" 또는 "incident playbook 만들어줘"

---

## State Tracking

어느 단계에 있는지 알려주면 바로 합류합니다:
- "DDD부터" → Step 2 바로 시작
- "이미 구현됨, 성능만 봐줘" → Step 4로 직행

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Architecture diagrams, ADR drafts | Business context and constraints |
| Domain model, context map | Domain expert validation |
| Test scaffolding, red-green cycle | Run tests, fix compile errors |
| Performance analysis, optimization options | Load test with real traffic patterns |
| Doc templates, runbook drafts | Tribal knowledge, operational context |

## Related Skills

- Peer: `develop:microservices-architect`, `develop:event-storming`, `develop:clean-architecture`
- Before: `think:deep-thinking-workflow` (for design decisions)
- After: `pm:roadmap-communication` (when shipping)
