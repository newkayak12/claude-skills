---
name: pm-strategy-workflow
description: >-
  Use when you need to run the full PM strategy process end-to-end — from market
  analysis through to stakeholder communication and roadmap delivery. Triggers
  on: "PM workflow", "제품 전략 전체", "처음부터 GTM까지", "pm process start to finish",
  product strategy
type: workflow
theme: pm-strategy
scenarios:
  - "PM workflow 전체 돌려줘"
  - "처음부터 GTM까지 단계별로 가보자"
  - "product strategy full cycle"
  - "신제품 전략 프로세스 시작"
estimated_time: "4-12 hours (full cycle), 30-90 min per step"
compatibility:
  recommended:
    - sequential-thinking
    - think-tool
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    sequential-thinking MCP를 연결하면 각 단계 간 맥락이 유지됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# PM Strategy Workflow

Full product strategy process — 7 steps from competitive insight to stakeholder alignment.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| New product or feature set | Single deliverable (use individual skill) |
| Quarterly planning from scratch | Already mid-process — jump to the relevant step |
| Need to align team on full strategy | Iterating on an existing strategy |

---

## Workflow Overview

```
[1] Market & Competition
        ↓
[2] Product Definition
        ↓
[3] Feature Prioritization
        ↓
[4] Pricing & Monetization
        ↓
[5] Go-to-Market Planning
        ↓
[6] Roadmap Communication
        ↓
[7] Stakeholder Management
```

---

## Steps

### Step 1 — Competitive Analysis
**Skill:** `competitive-analysis`
**Output:** Competitor profiles, positioning gap, "only we" statement
**Skip if:** You have a recent (< 3 month) competitive landscape document

> "Step 1 시작할게요" 또는 "competitive analysis 바로 해줘"

---

### Step 2 — PRD Development
**Skill:** `prd-development`
**Input:** Step 1 positioning gap + product idea
**Output:** Full PRD with problem statement, user stories, success metrics
**Skip if:** PRD already exists

> "Step 2 시작" 또는 "PRD 작성해줘"

---

### Step 3 — Feature Prioritization
**Skill:** `feature-prioritization`
**Input:** PRD feature list
**Output:** RICE-scored backlog, MoSCoW breakdown, next-cycle scope
**Skip if:** Backlog is small (< 5 items) or priorities are already set

> "Step 3 시작" 또는 "feature prioritization 해줘"

---

### Step 4 — Pricing & Monetization Strategy
**Skill:** `pricing-monetization-strategy`
**Input:** Target segment from PRD + competitive pricing from Step 1
**Output:** Pricing model recommendation, tier structure, WTP validation plan
**Skip if:** Pricing is already decided or product is internal

> "Step 4 시작" 또는 "pricing strategy 잡아줘"

---

### Step 5 — Go-to-Market Planning
**Skill:** `go-to-market-planning`
**Input:** PRD + prioritized features + pricing model
**Output:** GTM brief, launch sequence, messaging framework, channel plan
**Skip if:** Already have a GTM brief

> "Step 5 시작" 또는 "GTM 계획 세워줘"

---

### Step 6 — Roadmap Communication
**Skill:** `roadmap-communication`
**Input:** Prioritized backlog + GTM timeline
**Output:** Audience-appropriate roadmap (exec / team / external), narrative framing
**Skip if:** Roadmap already communicated, just need updates

> "Step 6 시작" 또는 "roadmap 정리해줘"

---

### Step 7 — Stakeholder Management
**Skill:** `stakeholder-management`
**Input:** Roadmap + known objections
**Output:** Stakeholder map, influence strategy, communication plan
**Skip if:** Small team with direct access to all decision-makers

> "Step 7 시작" 또는 "stakeholder plan 짜줘"

---

## State Tracking

Tell me which step you're on and I'll pick up from there:
- "Step 3부터 시작" → feature prioritization으로 바로 진입
- Skip 조건에 해당하면 자동으로 다음 단계로 안내

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Frameworks, templates, analysis, drafts | Customer interviews, real data gathering |
| Scoring, ranking, trade-off analysis | Final priority decisions |
| Messaging drafts, slide outlines | Stakeholder conversations |
| Strategy documents | Sign-off and execution |

## Related Skills

- Individual skills: `competitive-analysis`, `prd-development`, `feature-prioritization`
- Adjacent: `think:deep-thinking-workflow` (for problem framing before Step 1)
- After: `develop:dev-quality-workflow` (when handing off to engineering)
