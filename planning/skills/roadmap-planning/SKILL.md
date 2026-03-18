---
name: roadmap-planning
description: Plan a strategic roadmap across prioritization, epic definition, stakeholder alignment, and sequencing. Use when turning strategy into a release plan that teams can execute.
intent: >-
  Guide product managers through strategic roadmap planning by orchestrating prioritization, epic definition, stakeholder alignment, and release sequencing skills into a structured process. Use this to move from disconnected feature requests to a cohesive, outcome-driven roadmap that aligns stakeholders, sequences work logically, and communicates strategic intent—avoiding "feature factory" roadmaps that lack strategic narrative or customer-centric framing.
type: workflow
theme: strategy-positioning
best_for:
  - "Building a strategic roadmap that survives exec review"
  - "Prioritizing competing initiatives across multiple teams"
  - "Planning and sequencing work for the next quarter or half-year"
scenarios:
  - "I have 15 competing initiatives and need to build a Q2 roadmap my exec team will actually approve"
  - "I'm planning our 6-month product roadmap and need to sequence work across 3 teams"
estimated_time: "1-2 weeks (active facilitation: 45-90 min/day)"
---

## Key Concepts

### What is Strategic Roadmap Planning?

Roadmap planning is the process of:
1. **Gathering inputs** — Customer problems, business goals, technical constraints
2. **Defining initiatives** — Epics with clear hypotheses and success metrics
3. **Prioritizing** — Rank initiatives by impact, effort, strategic fit
4. **Sequencing** — Organize into releases/quarters with logical dependencies
5. **Communicating** — Present roadmap to stakeholders with strategic narrative

For roadmap type descriptions (Now/Next/Later, Theme-Based, Timeline, Feature-List anti-pattern) and the rationale for this approach, see `references/roadmap-types.md`.

### Anti-Patterns (What This Is NOT)
- **Not a commitment:** Roadmaps are strategic plans, not contracts
- **Not a feature list:** Roadmaps frame problems, not just solutions
- **Not waterfall:** Roadmaps evolve quarterly based on learning

### When to Use This
- Annual or quarterly planning cycles
- After product strategy session (translate strategy to roadmap)
- Onboarding new stakeholders (align on direction)
- Reframing existing roadmap (shift from feature-driven to outcome-driven)

### When NOT to Use This
- For tactical sprint planning (use backlog instead)
- When strategy is unclear (run product-strategy-session first)
- When stakeholders expect date commitments (address expectations first)

---

### Facilitation Source of Truth

When running this workflow as a guided conversation, use [`workshop-facilitation`](../workshop-facilitation/SKILL.md) as the interaction protocol and delegate to [`agents/roadmap-coordinator.md`](./agents/roadmap-coordinator.md) for entry mode selection, Phase 1 intake question sequence, sub-skill handoff triggers, and loop-back conditions.

---

## Application

Use `template.md` for the full fill-in structure.

This workflow orchestrates **5 phases** over **1-2 weeks**, using multiple component and interactive skills.

---

## Phase 1: Gather Inputs (Day 1-2)

**Goal:** Collect business goals, customer problems, technical constraints, stakeholder requests.

The four input-gathering activities below are fully independent — collect them concurrently to reduce elapsed time.

### Activities

**1. Review Business Goals (OKRs, Strategic Initiatives)**
- **Source:** Company OKRs, exec strategy memos, board decks
- **Output:** 3-5 business outcomes to optimize for

**2. Review Customer Problems (Discovery Insights)**
- **Source:** Discovery interviews, support tickets, NPS feedback, churn surveys
- **Use:** Insights from `skills/discovery-process/SKILL.md` (if recently completed)
- **Output:** 3-5 validated customer problems

**3. Review Technical Constraints & Opportunities**
- **Source:** Engineering leadership, tech debt assessments
- **Output:** List of technical investments required

**4. Review Stakeholder Requests**
- **Source:** Sales, marketing, customer success, execs
- **Output:** List of stakeholder requests (not yet committed)

### Outputs from Phase 1

- Business outcomes: 3-5 OKRs or strategic goals
- Customer problems: 3-5 validated pain points
- Technical investments: Platform/tech debt items
- Stakeholder requests: Feature requests from internal teams

---

## Phase 2: Define Initiatives (Epics) (Day 3-4)

**Goal:** Turn inputs into epics with hypotheses, success metrics, and effort estimates.

### Activities

**1. Define Epic Hypotheses**
- **Use:** `skills/epic-hypothesis/SKILL.md` (component)
- **Format:** "We believe that [building X] for [persona] will achieve [outcome] because [assumption]."
- **Output:** 10-15 epic hypotheses

*See `examples/sample.md` — Example 3 for sample epic hypotheses*

**2. Estimate Effort (T-Shirt Sizing)**
- **S:** 1-2 weeks (1-2 engineers)
- **M:** 3-4 weeks (2-3 engineers)
- **L:** 2-3 months (3-5 engineers)
- **XL:** 3+ months (5+ engineers)
- **Output:** Effort estimate per epic

**3. Map to Business Outcomes**
- Tag each epic with primary business outcome (Retention, Acquisition, Engagement, etc.)

### Outputs from Phase 2

- 10-15 epics: Each with hypothesis, success metric, effort estimate
- Business outcome mapping: Which epics drive which OKRs

---

## Phase 3: Prioritize Initiatives (Day 5)

**Goal:** Rank epics by impact, effort, and strategic fit.

### Activities

**1. Choose Prioritization Framework**
- **Use:** `skills/prioritization-advisor/SKILL.md` (interactive)
- **Output:** Recommended framework (RICE, ICE, Value/Effort, etc.)

**2. Score Epics**
- Apply framework to all epics
- *See `examples/sample.md` — Example 4 for a RICE scoring table*

**3. Adjust for Strategic Fit**
- Review scores against business goals
- For any epic flagged for a potential strategic override: use the think tool to reason through the trade-off between RICE rank and strategic bet value before committing to the final ranked list. Surface the reasoning before presenting the output.

### Outputs from Phase 3

- Ranked backlog: Epics sorted by priority (RICE score + strategic adjustments)
- Top 10 epics: Highest-priority initiatives for roadmap

---

## Phase 4: Sequence Roadmap (Day 6-7)

**Goal:** Organize epics into quarters/releases with logical dependencies.

### Activities

**1. Map Dependencies**
- When the epic count exceeds 8, use sequential thinking to enumerate all epic pairs, check each pair for directional dependency, and produce a topologically sorted sequence before assigning epics to quarters.
- **Output:** Dependency graph (Epic A → Epic B → Epic C)

**2. Sequence by Quarter (or Release)**
- **Now (Q1):** Top 3-5 epics, no dependencies
- **Next (Q2):** Next 3-5 epics, may depend on Q1 completion
- **Later (Q3+):** Remaining epics, lower confidence

*See `examples/sample.md` — Example 5 for quarterly and Now/Next/Later roadmap formats*

**3. Validate with Engineering**
- Confirm sequencing is realistic (capacity, dependencies, hidden technical blockers)
- **Output:** Validated roadmap sequence

### Outputs from Phase 4

- Sequenced roadmap: Epics organized by Q1, Q2, Q3
- Dependency map: What depends on what
- Capacity check: Engineering agrees sequence is feasible

---

## Phase 5: Communicate Roadmap (Week 2)

**Goal:** Present roadmap to stakeholders, gather feedback, build alignment.

### Activities

**1. Create Roadmap Presentation**
- **Structure:**
  - Slide 1: Strategic context (business goals, customer problems)
  - Slides 2-3: Roadmap overview (Q1, Q2, Q3)
  - Slides 4-6: Deep dive per quarter (epics, hypotheses, success metrics)
  - Slide 7: What's NOT on roadmap (and why)
  - Slide 8: Dependencies and risks
- **Duration:** 2-3 hours to prepare

**2. Present to Stakeholders**
- **Audience:** Execs, product leadership, engineering, sales, marketing, CS
- **Focus:** Strategic narrative, outcome focus, flexibility framing

**3. Gather Feedback and Refine**
- Key questions: Do priorities align with business goals? Are we missing critical customer problems? Are dependencies clear?
- Based on feedback: Adjust priorities, add missing epics, clarify dependencies
- **Output:** Final roadmap v1.0

**4. Publish Roadmap**
- Internal: Confluence, Notion, Productboard, etc.
- External (Optional): Now/Next/Later format for customers

### Outputs from Phase 5

- Roadmap presentation: 30-45 min deck
- Stakeholder alignment: Feedback incorporated, concerns addressed
- Published roadmap: Accessible to team or customers

---

## Examples

See `examples/sample.md` for full roadmap examples including good vs. bad roadmap comparison, epic hypotheses, RICE scoring, and quarterly sequencing.

---

## References

### Related Skills (Orchestrated by This Workflow)

**Phase 2:**
- `skills/epic-hypothesis/SKILL.md` (component)

**Phase 3:**
- `skills/prioritization-advisor/SKILL.md` (interactive)

**Optional/Related:**
- `skills/product-strategy-session/SKILL.md` (workflow) — Run before roadmap planning to establish strategy
- `skills/discovery-process/SKILL.md` (workflow) — Provides customer problem inputs for Phase 1
- `skills/user-story-mapping-workshop/SKILL.md` (interactive) — For complex epics requiring release planning

### Anti-Patterns
See `references/anti-patterns.md` for symptom/consequence/fix detail on each roadmap pitfall.

### Roadmap Types
See `references/roadmap-types.md` for descriptions of Now/Next/Later, Theme-Based, Timeline, and Feature-Based roadmap formats.

### External Frameworks
- Bruce McCarthy, *Product Roadmaps Relaunched* (2017) — Outcome-driven roadmaps
- C. Todd Lombardo, *Product Roadmaps Relaunched* (2017) — Now/Next/Later framework
- Intercom, "RICE Prioritization" (2016) — Prioritization framework
