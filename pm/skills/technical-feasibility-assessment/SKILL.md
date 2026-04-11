---
name: technical-feasibility-assessment
effort: high
description: >-
  Use when a PM or product team needs a rapid feasibility signal on a feature
  idea before committing engineering time — assessing implementation risk,
  complexity, and make-vs-buy tradeoffs without full engineering involvement.
  Triggers on: "technical
license: MIT
metadata:
  author: wondelai
  version: "1.0.0"
scenarios:
  - "Product wants to build X — can you give me a quick technical feasibility read?"
  - "Help me assess whether this feature can be built in 2 sprints with our current stack"
  - "Run a feasibility check on this AI integration before we commit to the roadmap"
  - "이 기능이 우리 현재 스택으로 2스프린트 안에 가능한지 빠르게 평가해줘"
  - "로드맵 확정 전에 기술 타당성 검토를 도와줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 5개 가능성 차원(데이터, 인프라, 통합, 팀 역량, 시간)에 대한 판단의 품질이 높아집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS assess all five feasibility dimensions: data, infrastructure, integration, team capability, and timeline.
- ALWAYS surface the single highest-risk assumption explicitly.
- NEVER give a binary feasible/not-feasible answer without a confidence level.
- NEVER assess feasibility without knowing the team's current stack and capacity constraints.


# Technical Feasibility Assessment Framework

## When to Use / When Not to Use

**Use when:**
- Deciding whether to include a feature in the roadmap before engineering is consulted
- Running a reality check at a Shape Up betting table
- Writing the Constraints / Technical Dependencies section of a PRD
- Evaluating build vs. buy vs. partner for a new capability

**Not for:**
- Engineering sprint estimation or story pointing
- Detailed architecture design decisions
- Contract negotiation with vendors

## Process

1. **Describe the feature** — what it does, who it's for, any known constraints or deadlines
2. **Score 5 dimensions** — Data, Infrastructure, Integrations, Team Skill, Time (each: Low / Medium / High risk)
3. **Identify red flags** — any dimension flagging "escalate to engineering immediately"
4. **Make vs. buy recommendation** — based on differentiation, time-to-value, and team capability
5. **Document risks** — produce the PRD technical constraints section format

## Output Template

```
Feasibility Signal: [High / Medium / Low / Unknown]

Dimension scores:
- Data: [Low / Medium / High risk] — [one sentence rationale]
- Infrastructure: [Low / Medium / High risk] — [one sentence rationale]
- Integrations: [Low / Medium / High risk] — [one sentence rationale]
- Team Skill: [Low / Medium / High risk] — [one sentence rationale]
- Time: [Low / Medium / High risk] — [one sentence rationale]

Make vs. Buy recommendation: [Build / Buy / Partner] — [reasoning]

Red flags requiring engineering consultation before any commitment:
- [if any]

Recommended next step: [what to investigate before treating this as feasible]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Scores 5 feasibility dimensions with rationale | Validates signals with engineering before committing |
| Identifies red flags that require engineering consultation | Makes the final make-vs-buy decision |
| Recommends make vs. buy vs. partner | Signs off on timeline commitments |
| Produces PRD technical constraints section content | Negotiates vendor contracts if buying |
| Surfaces PM-observable complexity signals | Owns engineering relationship and escalation |

## Related Skills

- `../shape-up/SKILL.md` — use this before the betting table to set realistic appetite
- `../prd-development/SKILL.md` — output feeds directly into PRD constraints section
- `../feature-prioritization/SKILL.md` — effort signal informs prioritization scoring

## Core Principle

**A PM does not need to be an engineer to assess feasibility. They need to ask the right questions and know what the answers imply.** This skill gives PMs a structured signal — not a spec, not an estimate — that surfaces technical risk early enough to change direction before sunk cost sets in.

**What this is and isn't:**
- IS: a structured set of questions that surfaces complexity, risk, and uncertainty signals
- IS: a decision framework for make vs. buy vs. partner
- IS: guidance on what to escalate to engineering immediately vs. explore further
- IS NOT: a substitute for engineering estimation or technical design
- IS NOT: a way to commit to timelines without engineering sign-off

**When to use it:**
- Before committing a bet at the Shape Up betting table (`../shape-up/SKILL.md`)
- When writing the Constraints and Technical Dependencies section of a PRD (`../prd-development/SKILL.md`)
- Before including a feature in a roadmap that promises delivery timelines
- When evaluating build vs. buy tradeoffs for a new capability area

## Agent Output

When a user describes a feature or capability and asks for a feasibility assessment, produce:
1. **Feasibility signal** — High / Medium / Low / Unknown (with one-sentence rationale per dimension)
2. **Make vs. buy vs. partner recommendation** with reasoning
3. **Red flags requiring engineering consultation** — if any, name them explicitly
4. **Risk documentation** — the right format for inclusion in the PRD constraints section
5. **Recommended next step** — what to investigate before treating this as "feasible"

## The 5 Feasibility Dimensions

Run through all five before forming an overall signal. A single High-risk dimension can make an otherwise Simple initiative infeasible in the required timeline.

### 1. Data

**What to assess:** Does the data needed for this feature exist, is it accessible, and is it clean enough to use?

**Signal questions:**
- Does this feature require data we currently collect? If not, how long to instrument and accumulate?
- Does it require joining data across systems that don't currently communicate?
- Does it require third-party data? Is there a data sharing agreement in place?
- Does it require historical data at a scale we haven't validated?
- Does it require user-provided data that users are unlikely to supply?

**Risk signals:**
- "We'll need to collect new data for this" → add 1-3 months minimum before useful signal
- "It relies on [other team]'s data pipeline" → coordination risk; not in your control
- "We need X years of historical data" → migration risk; validate data quality before committing
- Real-time data requirements → infrastructure and latency implications; escalate to engineering

**Feasibility signal:** High risk if data collection, quality, or access is unresolved. Low risk if the feature operates on data already well-instrumented in production.

### 2. Infrastructure and Platform

**What to assess:** Does the current infrastructure support this? What would need to change?

**Signal questions:**
- Does this require new infrastructure (queues, caches, storage tiers, new services)?
- Does it require scale characteristics the current system hasn't been tested for?
- Does it need to work in environments (mobile, offline, specific regions) not currently served?
- Does it depend on a platform or service that has known reliability, rate limit, or cost issues?
- Does it require real-time processing where the current system is batch?

**Risk signals:**
- "We'd need to move to a new architecture" → this is a multi-quarter project; don't scope it as a feature
- "The system hasn't been load-tested at that scale" → escalate before committing to any public-facing rollout
- "It requires [region] infrastructure we don't have" → compliance and latency implications; legal review may be required
- Batch-to-real-time migrations are almost always underestimated

**Feasibility signal:** High risk if infrastructure changes are foundational. Low risk if the feature fits the current architecture.

### 3. Integrations

**What to assess:** Does this require connecting to external systems, APIs, or third-party services?

**Signal questions:**
- Does this require a third-party API? Is it well-documented, stable, and affordable at scale?
- Does it require integration with a system owned by another internal team?
- Is there an existing integration that could be extended, or is this net new?
- Does the integration have rate limits, SLA constraints, or data format quirks?
- Is the third-party vendor reliable, or is there dependency risk?

**Risk signals:**
- "It requires [ERP / legacy system] integration" → these are almost always 3-6x harder than estimated; require engineering review before any timeline commitment
- Undocumented or unofficial APIs → fragility risk; changes without notice; avoid unless you own the contract
- Internal team dependency with no agreed SLA → a coordination risk, not a technical risk, but it behaves the same
- "We'll use [new vendor] for this" → vendor evaluation, contract, and onboarding time is a separate risk; don't include it in the build estimate

**Feasibility signal:** High risk if integrations involve legacy systems, internal team dependencies, or uncontracted third-party services.

### 4. Team Skill

**What to assess:** Does the engineering team have experience with the required technology, and if not, what does the learning cost?

**Signal questions:**
- Does this require technology the team hasn't used in production before?
- Does it require specialized skills (ML, cryptography, real-time systems, mobile native) that are not currently on the team?
- Are there regulatory or security requirements that need specific expertise (HIPAA, PCI, GDPR)?
- Is the knowledge concentrated in one person who is also a dependency for other work?

**Risk signals:**
- "We'd need to hire for this" → it's not a feature timeline, it's a hiring + ramp timeline
- "Only [one engineer] knows this part of the system" → bus factor risk; budget extra time for knowledge transfer
- First-time ML / AI features are routinely 3-5x more complex than the PM imagines; data pipeline, model training, evaluation, and inference infrastructure are each substantial workstreams
- Regulatory expertise gaps (security, privacy, accessibility compliance) → legal and compliance review required before committing

**Feasibility signal:** High risk if required skills are absent from the team. Medium risk if skills exist but are concentrated or the technology is new to the team.

### 5. Time

**What to assess:** Is there a fixed deadline driving this? Is the deadline real (contractual, regulatory, market window) or artificial (stakeholder preference)?

**Signal questions:**
- Is there a hard external deadline? What is it anchored to?
- What is the consequence of missing the deadline vs. the consequence of shipping something poor?
- Has engineering been consulted on the timeline? What was their estimate?
- Is the timeline compressing quality, scope, or both?

**Risk signals:**
- "We need to ship by [date] for the customer contract" → escalate to engineering immediately; this is a committed deadline that changes the risk calculus
- "We should try to get this out by Q[X]" → this is a soft deadline; negotiate scope, not quality
- Engineering estimates that are 2x or more than stakeholder expectation → a conversation about scope or timeline is required before proceeding

**Feasibility signal:** Low risk if the timeline is flexible. High risk if deadline is fixed and engineering hasn't validated it.

## Overall Feasibility Signal

After scoring all 5 dimensions:

| Signal | Meaning | PM Action |
|--------|---------|-----------|
| Low risk across all 5 | Standard feature; proceed with shaping | Include in roadmap; write PRD constraints section |
| Medium risk on 1-2 dimensions | Proceed with flagged risks documented | Include risks in PRD; discuss mitigations with engineering in next sync |
| High risk on 1 dimension | Significant uncertainty; needs engineering input before committing | Do not commit to timeline until engineering has reviewed; spike may be needed |
| High risk on 2+ dimensions | This is not a feature, it's a project | Rescope dramatically OR start a separate discovery/spike track; do not include as a standard roadmap item |
