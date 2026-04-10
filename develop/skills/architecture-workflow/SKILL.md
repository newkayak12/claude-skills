---
name: architecture-workflow
description: >-
  Use when designing a system from scratch, evaluating a monolith-to-MSA migration,
  or needing a structured end-to-end architecture process from domain discovery to documentation.
  Triggers on: "system architecture from scratch", "architecture workflow", "monolith to microservices plan",
  "greenfield system design", "아키텍처 전체 프로세스", "시스템 설계 처음부터", "모놀리스 분해 계획", "아키텍처 워크플로우".
  Best for: system redesign, new product architecture, monolith-to-MSA evaluation, greenfield system design.
  Not for: single-skill tasks (use individual skills directly); quick refactors within an existing service.
type: workflow
theme: architecture
scenarios:
  - "Design a full architecture for our new e-commerce platform from domain events to ADRs"
  - "We need to evaluate whether to break our monolith into microservices — walk me through the process"
  - "Greenfield system design: take me from domain modeling through to architecture decisions"
  - "처음부터 아키텍처 전체 프로세스 진행해줘"
  - "모놀리스를 마이크로서비스로 전환할지 평가하고 설계까지 해줘"
  - "새 시스템 도메인 모델링부터 ADR 작성까지 단계별로 가보자"
estimated_time: "1-3 days (full), 2-6 hours per step"
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool은 서비스 경계 결정, 아키텍처 트레이드오프 분석, ADR 작성에서 특히 유효합니다.
    sequential-thinking은 각 단계 간 컨텍스트를 유지하며 순서를 강제합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Architecture Workflow

7-step process: domain discovery → modeling → boundary validation → layering → component design → distribution → documentation.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| New product or system from scratch | Single-skill task — use the individual skill directly |
| Monolith-to-MSA evaluation or system redesign | Iterating inside an existing stable architecture |
| Greenfield design needing structured decisions | Quick refactor within one service |

---

## Workflow Overview

```
[1] Event Storming          ← optional if domain is well-understood
        ↓
[2] Domain-Driven Design
        ↓
[3] Service Boundary Validator
        ↓
[4] Clean Architecture
        ↓
[5] Architecture Designer
        ↓
[6] Microservices Architect ← optional if staying on monolith
        ↓
[7] ADR Writer              ← always last
```

---

## Steps

### Step 1 — Event Storming
**Skill:** `event-storming`
**Goal:** Discover bounded contexts, domain events, and aggregates through a structured workshop
**Input:** Business domain description, stakeholder knowledge
**Output:** Bounded context map, domain event timeline, aggregate candidates, hotspot list
**Skip if:** Domain is well-modeled, ubiquitous language established, bounded contexts documented
> "Step 1 시작" 또는 "이벤트 스토밍 워크샵 진행해줘"

---

### Step 2 — Domain-Driven Design
**Skill:** `domain-driven-design`
**Goal:** Formalize bounded contexts, aggregates, and ubiquitous language into a rigorous domain model
**Input:** Bounded context candidates from Step 1 (or existing domain knowledge)
**Output:** Context map, ubiquitous language glossary, aggregate definitions with invariants, domain event list
**Skip if:** Full DDD model already exists and is validated by domain experts
> "Step 2 시작" 또는 "DDD 도메인 모델링 해줘"

---

### Step 3 — Service Boundary Validation
**Skill:** `service-boundary-validator`
**Goal:** Validate proposed boundaries for coupling, data ownership conflicts, and distributed monolith patterns
**Input:** Domain model and bounded contexts from Step 2
**Output:** Coupling analysis report, data ownership map, split/merge/keep recommendation per boundary
**Skip if:** Building a new monolith with no decomposition planned in the next 12 months
> "Step 3 시작" 또는 "서비스 경계 검증해줘"

---

### Step 4 — Clean Architecture
**Skill:** `clean-architecture`
**Goal:** Define internal layer structure, dependency rules, and ports-and-adapters boundaries per service
**Input:** Validated service boundaries from Step 3
**Output:** Concentric layer diagram, dependency rule score (0–10), interface contracts, refactoring plan
**Skip if:** Services are stateless functions with trivial internal logic (≤ 2 layers needed)
> "Step 4 시작" 또는 "클린 아키텍처 레이어 설계해줘"

---

### Step 5 — Architecture Design
**Skill:** `architecture-designer`
**Goal:** Define full system topology, technology selections, NFRs, risks, and ADR candidates
**Input:** Domain model, validated boundaries, and layer structure from Steps 2–4
**Output:** System architecture diagram, technology recommendations, NFR coverage, risk list
**Skip if:** Technology stack and system topology are already decided and approved
> "Step 5 시작" 또는 "시스템 아키텍처 설계해줘"

---

### Step 6 — Microservices Architecture (optional)
**Skill:** `microservices-architect`
**Goal:** Design distributed communication, data strategy, resilience patterns, and deployment topology
**Input:** System architecture and validated service boundaries from Steps 3 and 5
**Output:** Service inventory, sync/async communication map, database-per-service strategy, observability plan
**Skip if:** Staying on a monolith or modular monolith — proceed directly to Step 7
> "Step 6 시작" 또는 "마이크로서비스 아키텍처 설계해줘"

---

### Step 7 — ADR Documentation
**Skill:** `adr-writer`
**Goal:** Record all significant decisions with context, alternatives considered, and honest trade-offs
**Input:** Decisions from Steps 1–6 (boundaries, tech choices, communication patterns, layer design)
**Output:** One ADR per decision in `docs/adr/`, numbered sequentially, status set
**Skip if:** Never — always document decisions before implementation begins
> "Step 7 시작" 또는 "ADR 작성해줘"

---

## State Tracking

어느 단계에 있는지 알려주면 바로 합류합니다:
- "도메인은 이미 정리됨, Step 3부터" → service boundary validation으로 직행
- "모놀리스 유지, 내부 설계만" → Steps 4–5–7 (Step 6 건너뜀)
- "이미 MSA, ADR만" → Step 7로 직행

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Facilitates event storming, identifies bounded context candidates | Provide domain experts, validate business language |
| Drafts domain model, aggregate definitions, context map | Confirm invariants and ubiquitous language with the team |
| Runs coupling analysis and applies the 5 boundary tests | Provide service dependency data and team ownership |
| Draws layer diagrams, flags dependency rule violations | Confirm which layers hold the most business logic |
| Produces architecture diagrams, technology recommendations | Make final technology and topology decisions |
| Designs resilience patterns and service communication map | Confirm SLA requirements and operational capacity |
| Writes ADRs with alternatives and consequences | Approve wording, store ADRs in the repo |

## Related Skills
- Peer: `develop:dev-quality-workflow` — full engineering quality cycle after architecture is set
- Before: `think:deep-thinking-workflow` — early-stage decision framing before Step 1
- After: `develop:spring-boot-engineer` or `develop:kotlin-specialist` — implementation after Step 7
