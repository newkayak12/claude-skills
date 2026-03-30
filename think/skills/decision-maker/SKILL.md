---
name: decision-maker
description: >-
  Use when facing a choice between options where the trade-offs aren't obvious.
  Triggers on: "A vs B 뭐가 나아?", "어떤 걸 써야 해?", "build vs buy", "이 아키텍처 괜찮아?",
  "Redis vs Postgres", "어떤 DB 골라야 해?", or any "should we adopt X?" question.
  Best for: technology selection, architecture decisions, irreversible investments.
  Not for: decisions already made (post-hoc justification), or trivially obvious choices.
scenarios:
  - "PostgreSQL vs MySQL, 어떤 걸 써야 해?"
  - "Should we build or buy this feature?"
  - "마이크로서비스로 전환해야 할까, 모놀리스 유지해야 할까?"
  - "We need to choose between REST and GraphQL"
  - "Redis 캐싱 쓸까, 아니면 in-process 캐싱 쓸까?"
  - "Should we go with AWS or GCP?"
compatibility:
  recommended:
    - think-tool        # forces explicit reasoning before scoring begins
  optional:
    - mcp-reasoner      # systematic multi-option evaluation, prevents anchoring
    - sequential-thinking  # for decisions with complex dependency chains
  remote_mcp_note: >-
    think-tool이 있으면 one-way-door 결정 전에 sunk-cost bias와 hidden assumption을 체계적으로 검토할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Decision Maker

Structured decision facilitation for technology and architecture choices, using the lightest framework that fits the decision's weight.

## When to Use

- "A vs B" comparisons (databases, frameworks, patterns, tools)
- Architecture direction decisions (microservices vs monolith, REST vs GraphQL)
- Build vs buy vs open-source evaluation
- "Should we adopt X?" questions
- Any decision where the tradeoffs aren't immediately obvious

**When NOT to use:** Trivially obvious choices, decisions already made (post-hoc justification), or purely opinion-based preferences with no objective criteria.

## Core Workflow

1. **Clarify the real question** — "What problem are we solving?" before jumping to options
2. **Assess decision weight** — reversible (two-way door) or irreversible (one-way door)?
3. **Pick the right framework** — match process complexity to decision weight
4. **Surface criteria** — what actually matters here? (performance, cost, team skill, timeline)
5. **Analyze** — apply framework to options. For 3+ options, research their characteristics in parallel before scoring begins. For one-way-door decisions with 3+ options, invoke mcp-reasoner before scoring begins — this prevents anchoring and produces an auditable evaluation trail.
6. **Recommend** — state a clear recommendation with top 2-3 reasons; don't hedge into uselessness

## Decision Weight Assessment

| Type | Description | Process |
|------|-------------|---------|
| **Two-Way Door** | Reversible; cost to change is low | Lightweight — quick pros/cons, decide fast |
| **One-Way Door** | Hard to reverse; high switching cost | Heavyweight — full matrix or ADR, involve stakeholders |

Examples of two-way doors: choosing a logging library, a linting config, an internal API design.
Examples of one-way doors: primary database engine, cloud provider lock-in, monolith vs microservices split.

## Frameworks

### 1. Pros/Cons (two-way door, low-stakes)

Best for: quick decisions, 2 options, low switching cost.

```
Option A                    Option B
+ Fast to implement         + Better long-term scalability
+ Team already knows it     + Industry standard
- Limited query flexibility - Steeper learning curve
- Vendor lock-in            - More ops overhead
```

Recommendation: **Option A** — team velocity matters most given the 3-week deadline; revisit at next architecture review.

### 2. Weighted Decision Matrix (one-way door, multiple options)

Best for: 3+ options, multiple stakeholders, criteria with different importance.

**Steps:**
1. List criteria (5 or fewer — more dilutes signal)
2. Assign weights (must sum to 100)
3. Score each option per criterion (1–5)
4. Compute weighted score: `sum(weight × score)`
5. For one-way-door decisions with 3+ options, use mcp-reasoner to systematically evaluate each option against all criteria before scoring. This prevents anchoring and improves auditability.
6. Sanity-check: does the top scorer match intuition? If not, re-examine weights.

Example: see `references/worked-examples.md` for a full database selection walkthrough using this format.

### 3. DACI (decisions with unclear ownership)

Best for: when it's unclear who decides, or multiple teams are affected.

| Role | Person/Team | Responsibility |
|------|-------------|----------------|
| **Driver** | Tech Lead | Runs the process, synthesizes input |
| **Approver** | Engineering Manager | Makes the final call |
| **Contributor** | Backend + Infra teams | Provide input and constraints |
| **Informed** | Product, Frontend | Notified of outcome |

Use DACI when a decision is stalling due to unclear ownership — assign the Approver first.

### 4. Reversibility Check (before committing)

Before finalizing a one-way door decision, ask:
- What does it cost to undo this in 12 months?
- Are we choosing this because it's right, or because we're already invested?
- Is the team comfortable they have enough information?

Use think-tool to work through the answers before proceeding — this step is specifically designed to surface sunk-cost bias and unstated assumptions.

If "not enough information" — define the smallest experiment to get it (spike, prototype, load test).

## Concrete Examples

See `references/worked-examples.md` for detailed examples: Microservices vs Monolith, Redis vs In-Process Cache, REST vs GraphQL.

## Output Format

For any decision, produce:

1. **Decision statement** — one sentence naming the choice being made
2. **Decision type** — two-way door or one-way door
3. **Framework used** — and why it fits this decision
4. **Analysis** — framework output (table, pros/cons, etc.)
5. **Recommendation** — clear, with top 2-3 reasons
6. **Conditions to revisit** — what would change this decision?

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Treating all decisions as one-way doors | Assess reversibility first; most decisions are two-way |
| Equal-weighted matrix (everything = 20%) | Forces weights; if it's really all equal, use pros/cons |
| Analysis paralysis on two-way doors | Timebox: 30 min max for reversible decisions |
| Recommendation buried under "it depends" | State the recommendation first, caveats after |
| Post-hoc justification | If the choice is already made, say so; skip the framework |
| Ignoring team capability as a criterion | "Best technology" your team can't operate is a bad choice |

## Quick Selector

```
Is the decision reversible at low cost?
  Yes → Pros/Cons → Decide within 30 min
  No  → How many options / stakeholders?
         2 options, 1 team → Weighted Matrix
         3+ options → Weighted Matrix (5 criteria max)
         Multiple teams, unclear owner → DACI first, then Matrix
         Not enough info → Define spike/experiment
```
