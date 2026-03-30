---
name: technical-feasibility-assessment
description: 'Rapid PM-level technical feasibility signal — assessing implementation risk, complexity, and make-vs-buy tradeoffs without full engineering involvement. Use when someone says "기술 가능성", "구현 가능한지", "개발 얼마나 걸려", "기술적 리스크", "엔지니어 없이 판단", "technical feasibility", "is this buildable", "how hard is this to build", "should we build or buy this", or needs to stress-test a product idea before investing in discovery or shaping. Also use during appetite-setting (Shape Up) when a bet needs a reality check before the betting table, or when writing the Constraints section of a PRD.'
license: MIT
metadata:
  author: wondelai
  version: "1.0.0"
---

# Technical Feasibility Assessment Framework

A PM-level rapid assessment of whether a product idea is technically feasible — identifying risks, complexity signals, and make-vs-buy tradeoffs before investing engineering time in discovery or scoping.

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

## Make vs. Buy vs. Partner Decision Matrix

Use this when evaluating a new capability the team doesn't currently have.

| Criterion | Build | Buy (COTS / SaaS) | Partner / OEM |
|-----------|-------|-------------------|---------------|
| Core differentiation | Yes — if this IS the product | No | Depends |
| Time to value | Slowest | Fastest | Medium |
| Customization need | High — build | Low — buy | Medium |
| Data ownership sensitivity | Build (keep data in-house) | Risk — review contract | Negotiate |
| Team has the skill | Prerequisite | Not required | Not required |
| Vendor market maturity | N/A | Buy if mature vendors exist | Consider if partner adds distribution |
| Long-term cost | High (maintenance) | Predictable (SaaS) | Revenue share |

**Decision heuristic:**
- If this capability directly delivers your core value proposition: Build
- If this is an enabling capability (payments, email, auth, monitoring): Buy
- If you need distribution or a platform integration you can't build: Partner
- If unsure: Buy first, build later if buy creates a ceiling

## Red Flags: Escalate to Engineering Immediately

Do not continue PM-level assessment. Get an engineering review before any commitment.

- Real-time data processing requirements at meaningful scale
- ML / AI / recommendation systems (more infrastructure than they appear)
- Any requirement touching security, encryption, or authentication flows
- Regulatory compliance (GDPR data deletion, PCI payment processing, HIPAA health data)
- Third-party integrations with enterprise systems (Salesforce, SAP, Workday, major ERP)
- "We just need to add X to the existing [legacy] system"
- Cross-service transactions or data consistency requirements
- Any feature that mentions "migrate" in the description
- Mobile features that need to work offline
- Any timeline the PM invented without engineering input

## Documenting Technical Risks in a PRD

The goal is to be honest about uncertainty without false precision. See `../prd-development/SKILL.md` for the full PRD format.

**PRD Technical Constraints Section format:**
```
Known constraints:
- [Constraint 1]: [one sentence description of the technical boundary or dependency]

Technical risks (unresolved):
- [Risk 1]: [description] | Likelihood: High / Medium / Low | Impact if realized: [what changes?]
- [Risk 2]: [description] | Likelihood: High / Medium / Low | Impact if realized: [what changes?]

Dependencies:
- [System or team]: [what we need from them and by when]

Engineering consultation needed before committing:
- [Specific question for engineering] — needed before [phase/milestone]

What we are NOT specifying here (intentionally left to engineering):
- Implementation approach
- Technology choices within constraints
- Specific architecture decisions
```

**The false precision trap:** Never write "this will take 2 weeks" in a PRD unless engineering has said so. Write "we believe this is medium complexity; engineering estimate needed before Q[X] planning." This preserves your credibility when the estimate comes back higher.

## Quick Reference: Complexity Signals

These are PM-observable signals that almost always indicate higher-than-expected complexity:

- Any feature that requires "syncing" between systems → consistency problem
- Any feature described as "just adding a field" to a legacy system → schema migration risk
- Any feature that uses the word "real-time" → infrastructure implications
- Any feature that involves "the algorithm will..." → ML pipeline, not a feature
- Any feature that requires user data migration → data quality + rollback risk
- Any feature requiring cross-team coordination → schedule risk, not just technical risk
- "We'll figure out the edge cases later" → they always cost more than the happy path

## Cross-Skill Connections

- **Feeds into:** `../feature-prioritization/SKILL.md` — effort dimension for prioritization scoring
- **Feeds into:** `../prd-development/SKILL.md` — constraints, dependencies, and technical risk sections
- **Feeds into:** `../go-to-market-planning/SKILL.md` — timeline realism check for launch planning
- **References:** `../architecture-designer/SKILL.md` (develop skill) for deeper architectural questions beyond PM-level assessment
- **Triggered when:** `../shape-up/SKILL.md` appetite-setting needs a reality check before the betting table
