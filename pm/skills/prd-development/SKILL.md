---
name: prd-development
description: >-
  Use when turning scattered discovery notes, Slack threads, or stakeholder
  requests into a structured PRD that engineers can act on. Triggers on: "PRD
  작성", "기획서", 제품 요구사항 문서", "write a PRD", "product requirements document",
  "engineering handoff", "I
intent: >-
  Guide product managers through structured PRD creation by orchestrating problem
  framing, user research synthesis, solution definition, and success criteria into a
  cohesive document — moving from scattered notes to a clear source of truth.
type: workflow
theme: pm-artifacts
best_for:
  - "Writing a complete PRD from scratch"
  - "Structuring product requirements for an engineering handoff"
  - "Documenting a major new feature before development begins"
scenarios:
  - "I need a PRD for a new AI-powered recommendation feature in our e-commerce platform."
  - "I've completed a discovery sprint and need to turn the findings into a PRD my engineers can act on."
  - "PRD 템플릿에 맞춰 새 기능을 문서화해줘."
  - "Help me write the problem statement and success metrics for this initiative."
  - "기획서를 엔지니어가 바로 개발에 들어갈 수 있게 정리해줘."
  - "We have user research findings — help me turn them into a PRD."
estimated_time: "60-120 min"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 문제 정의와 성공 지표 간 일관성, 스코프 경계의 논리를 검증하는 데 도움이 됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Key Concepts

### What is a PRD?

A PRD (Product Requirements Document) is a structured document that answers:
1. **What problem are we solving?** (Problem statement)
2. **For whom?** (Target users/personas)
3. **Why now?** (Strategic context, business case)
4. **What are we building?** (Solution overview)
5. **How will we measure success?** (Metrics, success criteria)
6. **What are the requirements?** (User stories, acceptance criteria, constraints)
7. **What are we NOT building?** (Out of scope)

Use `template.md` for the full fill-in PRD structure.

### Anti-Patterns (What This Is NOT)
- **Not a detailed spec:** PRDs frame the problem and solution; they don't specify UI pixel-by-pixel
- **Not waterfall:** PRDs evolve as you learn; they're not frozen contracts
- **Not a substitute for collaboration:** PRDs complement conversation, not replace it

### When to Use This
- Starting a major feature or product initiative
- Aligning cross-functional teams on scope and requirements
- Documenting decisions for future reference
- Onboarding new team members to a project

### When NOT to Use This
- For small bug fixes or trivial features (overkill)
- When problem and solution are already clear and aligned (just write user stories)
- For continuous discovery experiments (use Lean UX Canvas instead)

---

### Facilitation Source of Truth

When running this workflow as a guided conversation, use [`workshop-facilitation`](../workshop-facilitation/SKILL.md) as the interaction protocol.

It defines:
- session heads-up + entry mode (Guided, Context dump, Best guess)
- one-question turns with plain-language prompts
- progress labels (for example, Context Qx/8 and Scoring Qx/5)
- interruption handling and pause/resume behavior
- numbered recommendations at decision points
- quick-select numbered response options for regular questions (include `Other (specify)` when useful)

This file defines the workflow sequence and domain-specific outputs. If there is a conflict, follow this file's workflow logic.

## Application

Use `template.md` for the full fill-in structure.

This workflow orchestrates **8 phases** over **2-4 days**, using multiple component and interactive skills.

**If a referenced component skill is not available,** Claude should apply the methodology described in that skill's phase inline using only the context provided here.

See `references/phase-examples.md` for worked examples for each phase.

---

## Phase 1: Executive Summary (30 minutes)

**Goal:** Write a one-paragraph overview for skimmers.

**Format:** "We're building [solution] for [persona] to solve [problem], which will result in [impact]."

- **Participants:** PM
- **Duration:** 30 minutes
- **Output:** One-paragraph summary

**Tip:** Write this first (forces clarity), but refine it last (after other sections are complete).

---

## Phase 2: Problem Statement (60 minutes)

**Goal:** Frame the customer problem with evidence.

**1. Write Problem Statement**
- **Use:** `skills/problem-statement/SKILL.md` (component)
- **Input:** Discovery insights from `skills/discovery-process/SKILL.md` or `skills/problem-framing-canvas/SKILL.md`
- **Output:** Structured problem statement (Who, What, Why, Evidence)

*See `references/phase-examples.md` — Phase 2 example*

**2. Add Supporting Context (Optional)**
- **Customer journey map:** `skills/customer-journey-mapping-workshop/SKILL.md`
- **Jobs-to-be-done:** `skills/jobs-to-be-done/SKILL.md`

### Outputs from Phase 2
- Problem statement: Who, what, why, evidence
- Supporting artifacts: Journey map, JTBD (if relevant)

---

## Phase 3: Target Users & Personas (30 minutes)

**Goal:** Define who you're building for.

- **Use:** `skills/proto-persona/SKILL.md` (component) output
- **Format:** Include persona name, role, goals, pain points, behaviors

*See `references/phase-examples.md` — Phase 3 example*

### Outputs from Phase 3
- Primary persona: Detailed profile
- Secondary personas: (if applicable)

---

## Phase 4: Strategic Context (45 minutes)

**Goal:** Explain why this matters to the business and why now.

**1. Document Business Goals** — Link feature to OKRs/strategic outcomes

**2. Size Market Opportunity (Optional)** — Use `skills/tam-sam-som-calculator/SKILL.md`

**3. Document Competitive Landscape (Optional)** — Competitor research, G2/Capterra reviews

**4. Explain "Why Now?"** — Urgency rationale tied to data

### Outputs from Phase 4
- Business goals, market opportunity, competitive context, why now

---

## Phase 5: Solution Overview (60 minutes)

**Goal:** Describe what you're building (high-level, not detailed spec).

**1. Write Solution Description** — High-level overview, 2-3 paragraphs

*See `references/phase-examples.md` — Phase 5 example*

**2. Add User Flows or Wireframes (Optional)** — For complex features

**3. Reference Story Map (Optional)** — `skills/user-story-mapping-workshop/SKILL.md`

### Outputs from Phase 5
- Solution description, user flows/wireframes (if applicable), story map (if applicable)

---

## Phase 6: Success Metrics (30 minutes)

**Goal:** Define how you'll measure success.

**1. Define Primary Metric** — The ONE metric this feature must move

**2. Define Secondary Metrics** — What else to monitor (but not optimize for)

**3. Define Guardrail Metrics** — What should NOT get worse

*See `references/phase-examples.md` — Phase 6 example*

### Outputs from Phase 6
- Primary metric, secondary metrics, guardrail metrics

---

## Phase 7: User Stories & Requirements (90-120 minutes)

**Goal:** Break solution into user stories with acceptance criteria.

**1. Write Epic Hypothesis**
- **Use:** `skills/epic-hypothesis/SKILL.md` (component)

**2. Break Down Epic into User Stories**
- **Use:** `skills/epic-breakdown-advisor/SKILL.md` (interactive - with Richard Lawrence's 9 patterns)

**3. Write User Stories**
- **Use:** `skills/user-story/SKILL.md` (component)
- **Format:** User story + acceptance criteria

*See `references/phase-examples.md` — Phase 7 example*

**4. Document Constraints & Edge Cases**

### Outputs from Phase 7
- Epic hypothesis, user stories (3-10 with acceptance criteria), constraints

---

## Phase 8: Out of Scope & Dependencies (30 minutes)

**Goal:** Define what you're NOT building and what you depend on.

**1. Document Out of Scope** — List features/requests explicitly excluded with rationale

**2. Document Dependencies** — Technical, external, and team dependencies

**3. Document Open Questions** — Unresolved decisions and areas requiring discovery

*See `references/phase-examples.md` — Phase 8 example*

### Outputs from Phase 8
- Out of scope, dependencies, risks, open questions

---

## Examples

See `examples/sample.md` for full PRD examples and `references/phase-examples.md` for per-phase worked examples.

---

## References

### Related Skills (Orchestrated by This Workflow)

**Phase 2:**
- `skills/problem-statement/SKILL.md` (component)
- `skills/problem-framing-canvas/SKILL.md` (interactive, for context)
- `skills/customer-journey-mapping-workshop/SKILL.md` (interactive, optional)

**Phase 3:**
- `skills/proto-persona/SKILL.md` (component)
- `skills/jobs-to-be-done/SKILL.md` (component, optional)

**Phase 4:**
- `skills/tam-sam-som-calculator/SKILL.md` (interactive, optional)

**Phase 5:**
- `skills/user-story-mapping-workshop/SKILL.md` (interactive, optional)

**Phase 7:**
- `skills/epic-hypothesis/SKILL.md` (component)
- `skills/epic-breakdown-advisor/SKILL.md` (interactive)
- `skills/user-story/SKILL.md` (component)

### Common Pitfalls
See `references/pitfalls.md` for symptom/consequence/fix detail on each pitfall.

### External Frameworks
- Martin Eriksson, "How to Write a Good PRD" (2012) — PRD structure
- Marty Cagan, *Inspired* (2017) — Product spec principles
- Amazon, "Working Backwards" (PR/FAQ format) — Alternative to PRD

---

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Guides 8-phase PRD structure with prompts and templates | Provides discovery findings, customer quotes, business context |
| Drafts problem statement, persona profiles, solution description | Validates scope with engineering and design partners |
| Writes success metrics (primary, secondary, guardrails) | Makes trade-off decisions on what is in vs. out of scope |
| Generates user stories and acceptance criteria | Gets stakeholder sign-off on the final document |
| Surfaces open questions and dependency gaps | Owns the living PRD and updates it as decisions are made |

## Related Skills

- `../customer-research-synthesis/SKILL.md` — feeds problem statement and JTBD into PRD Phase 2-3
- `../competitive-analysis/SKILL.md` — feeds strategic context into PRD Phase 4
- `../user-story-mapping-workshop/SKILL.md` — feeds solution overview into PRD Phase 5
- `../technical-feasibility-assessment/SKILL.md` — feeds constraints section in PRD Phase 8
- `../go-to-market-planning/SKILL.md` — receives completed PRD as primary input
- `../hypothesis-driven-dev/SKILL.md` — PRD success metrics define the hypothesis to test
