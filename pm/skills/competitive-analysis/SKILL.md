---
name: competitive-analysis
effort: high
description: >-
  Use when making a product or business decision where knowing the competitive
  context changes the answer — before a launch, when writing strategy, or when
  articulating differentiation. Triggers on: "competitor analysis", "competitive
  landscape", how
type: workflow
theme: pm-strategy
best_for:
  - "Mapping competitor feature sets and positioning"
  - "Finding whitespace or differentiation opportunities in the market"
  - "Building the competitive section of a PRD or GTM plan"
scenarios:
  - "We're about to launch — who are the main competitors and how do we differentiate?"
  - "경쟁사 분석 해줘. 우리 제품이 어떻게 차별화될 수 있는지 알고 싶어."
  - "I need to understand the competitive landscape before writing the PRD strategic context."
  - "Help me build the competitive section for our GTM plan."
  - "경쟁사 대비 우리 포지셔닝을 정리해줘."
  - "Which whitespace can we own in this market?"
estimated_time: "60-120 min"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 포지셔닝 맵과 차별화 전략의 논리적 일관성을 검증하는 데 도움이 됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS distinguish current state from trajectory — a competitor's momentum matters as much as today's position.
- ALWAYS identify the primary differentiation axis before listing feature comparisons.
- NEVER treat feature parity as the goal — parity is table stakes, not differentiation.
- NEVER present analysis without a 'so what' recommendation the team can act on.


## Purpose

Competitive analysis answers three questions:
1. **Who is already solving this problem?** (competitive map)
2. **How do they compare to us?** (feature/positioning matrix)
3. **Where is the whitespace we can own?** (differentiation opportunity)

This skill produces two artifacts: **Competitor Profiles** and a **Positioning Gap Summary**.

---

## When to Use This

- Before writing a PRD — feeds Phase 4 (Strategic Context) in `../prd-development/SKILL.md`
- When `../product-discovery/SKILL.md` surfaces competitive gaps as an opportunity
- Before building a GTM plan in `../go-to-market-planning/SKILL.md`
- When pricing strategy requires market benchmarking — see `../pricing-monetization-strategy/SKILL.md`
- When a stakeholder asks "why would a customer choose us over X?"

## When NOT to Use This

- For internal-tool or back-office products with no external competitors
- As a substitute for actual user research (competitive analysis tells you what others built, not what users want)
- If you need a full market sizing exercise — use a TAM/SAM/SOM model instead

---

## Step 1 — Define the Competitive Universe (15 min)

Before analyzing anything, define scope.

### Competitor Types

| Type | Definition | Example |
|------|-----------|---------|
| **Direct** | Same target user, same problem, similar solution | Figma vs Sketch |
| **Indirect** | Same problem, different solution or delivery model | Notion vs. Confluence |
| **Substitute** | Different framing, but competes for the same job-to-be-done | Excel vs. Airtable |
| **Emerging** | Early-stage or category-adjacent players to watch | New AI-native entrants |

**Action:** List 3-8 competitors across these types. Avoid the trap of only analyzing the most obvious direct competitor.

---

## Step 2 — Gather Competitive Data (30-60 min)

### Primary Sources (Do This First)
- **Product itself:** Sign up for free trials; walk through the core workflow
- **Pricing pages:** Capture tiers, value metrics, and packaging
- **G2 / Capterra / Trustpilot reviews:** Read 1-star and 5-star reviews — they reveal real pain and real value
- **Job listings:** Engineering and PM job posts reveal where a competitor is investing
- **Changelog / release notes:** Shows velocity and recent strategic bets

### Secondary Sources
- **Crunchbase / PitchBook:** Funding stage, investor narrative
- **Investor decks (if public):** How the company positions itself to capital markets
- **Press releases and blog posts:** Messaging and positioning language
- **LinkedIn:** Team size by function — signals priorities

### What to Capture Per Competitor

For each competitor, collect:
- Target user (stated and actual)
- Core value proposition (in their own words)
- Key features (top 5-7 that define the product)
- Pricing model and entry price
- Stated differentiators / positioning
- Known weaknesses (from reviews, forums, community complaints)
- Recent strategic moves (funding, M&A, product announcements)

---

## Step 3 — Build the Feature Matrix (20 min)

Create a table with competitors as columns and key capabilities as rows.

### Feature Matrix Template

| Capability | Us | Competitor A | Competitor B | Competitor C |
|-----------|-----|-------------|-------------|-------------|
| [Core capability 1] | ✓ | ✓ | ✗ | ✓ |
| [Core capability 2] | ✓ | ✗ | ✓ | ✗ |
| [Core capability 3] | Partial | ✓ | ✓ | ✗ |
| [Differentiating capability] | ✓ | ✗ | ✗ | ✗ |
| [Table stakes capability] | ✓ | ✓ | ✓ | ✓ |
| Pricing model | — | — | — | — |
| Entry price | — | — | — | — |
| Target segment | — | — | — | — |

**Reading the matrix:**
- Rows where everyone has ✓ = table stakes (you must have these; they won't differentiate you)
- Rows where only you have ✓ = your moat (protect and invest)
- Rows where competitors have ✓ and you have ✗ = gap to evaluate (build, partner, or consciously ignore)

---

## Step 4 — Build the Positioning Map (15 min)

A 2x2 positioning map shows where each player sits on two axes that matter to your target customer.

### How to Choose Axes

Pick axes that:
1. Represent genuine trade-offs (not "quality vs. low quality")
2. Are meaningful to your target buyer
3. Create visible whitespace you can occupy

Common axis pairs:
- **Complexity vs. Power** (for tools)
- **Self-serve vs. Enterprise** (for SaaS go-to-market)
- **Breadth vs. Depth** (all-in-one vs. best-of-breed)
- **Price vs. Integration depth**

### Positioning Map Output

```
HIGH [Axis Y]
        |
  [B]   |        [A]
        |
--------+--------
        |
  [C]   |   [D = Us]
        |
LOW     |        HIGH [Axis X]
```

Label each competitor's position and annotate why they sit there.

---

## Step 5 — SWOT-Lite (15 min)

A focused SWOT — skip generic platitudes, focus on actionable insights.

| | Internal | External |
|-|---------|---------|
| **Positive** | **Strengths:** What we do better than anyone in this space | **Opportunities:** Gaps competitors aren't serving; emerging needs |
| **Negative** | **Weaknesses:** Gaps in our current offering vs. market expectation | **Threats:** Competitor moves, commoditization risk, category shifts |

**Rule:** Each cell should have 2-4 specific, evidence-backed points. No vague statements like "strong team."

---

## Step 6 — Identify Differentiation Strategy (20 min)

Based on the feature matrix, positioning map, and SWOT-lite, answer:

### The Three Differentiation Questions

1. **What is the one thing we can be best at?** (your spike)
2. **What will we intentionally NOT do well?** (your trade-off — this is required for a position to be credible)
3. **What is our "only we" statement?** ("Only [Company] can [capability] for [user] because [reason]")

### Common Differentiation Strategies

| Strategy | When It Works | Risk |
|---------|--------------|------|
| **Feature superiority** | Competitors are weak in a critical area you can own | Easy to copy |
| **Segment focus** | Broad competitors ignore a specific segment's real needs | Small TAM |
| **UX/simplicity** | Incumbents are complex; your user wants ease over power | Hard to justify to enterprise |
| **Ecosystem / integrations** | Your user lives in a specific stack; you integrate better | Dependency risk |
| **Price disruption** | Premium market with underserved price-sensitive segment | Margin pressure |
| **Vertical depth** | Horizontal tools ignore domain-specific workflows | Niche ceiling |

---

## Output Format

### Competitor Profile (one per competitor)

```
## [Competitor Name]

**Type:** Direct / Indirect / Substitute / Emerging
**Target User:** [Who they build for]
**Core Value Prop:** [Their own words or closest paraphrase]
**Entry Price:** [Tier name + price]
**Pricing Model:** [Freemium / seat-based / usage-based / etc.]

### Key Capabilities
1. [Capability]
2. [Capability]
3. [Capability]

### Known Weaknesses
- [Source: G2/Capterra/community]
- [Source: G2/Capterra/community]

### Recent Moves
- [Date]: [What they announced/shipped/raised]

### Positioning in One Sentence
[Company] is the [category] for [user] who needs [value], unlike [comparison] which [contrast].
```

### Positioning Gap Summary

```
## Positioning Gap Summary

### Table Stakes (must-have, not differentiating)
- [List features every player has]

### Our Differentiators (we have, competitors don't)
- [Feature/capability]: [Why it matters to the target user]

### Gaps to Evaluate (competitors have, we don't)
- [Feature/capability]: [Build / Partner / Ignore + rationale]

### Whitespace Opportunity
[Description of the positioning we can credibly own and why]

### Our "Only We" Statement
Only [Company] can [capability] for [user] because [reason].
```

---

## Connecting to Other Skills

- **Feed findings into PRD:** Paste the Positioning Gap Summary into Phase 4 of `../prd-development/SKILL.md`
- **Inform GTM messaging:** The "Only We" statement and differentiators become the core messaging in `../go-to-market-planning/SKILL.md`
- **Benchmark pricing:** Competitor pricing tiers feed the pricing model analysis in `../pricing-monetization-strategy/SKILL.md`
- **Validate with users:** If you found gaps competitors are missing, validate those are real user needs via `../product-discovery/SKILL.md`

---

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Builds competitor profile templates and feature matrix | Performs actual product trials and gathers pricing data |
| Drafts positioning map axes and whitespace analysis | Validates positioning with real customer interviews |
| Generates "Only We" statement drafts | Makes the final differentiation call based on business context |
| Identifies anti-patterns and strategic blind spots | Decides which competitive gaps are worth pursuing |
| Connects findings to PRD, GTM, and pricing frameworks | Synthesizes with internal knowledge not available to Claude |

## Standalone Inputs

If no prior competitive research exists, provide:
- List 3 direct competitors by name (Claude will structure the analysis from there)
- Your target user segment (one sentence)
- Your product's core job-to-be-done

## Common Anti-Patterns

| Anti-Pattern | Symptom | Fix |
|-------------|---------|-----|
| Only analyzing the most famous competitor | Analysis ignores the actual alternatives your users consider | Ask users "what did you use before / what else did you evaluate?" |
| Copying competitor features | Feature matrix becomes a copy list | Use matrix to identify gaps worth owning, not a checklist to replicate |
| Positioning on hygiene factors | "We're the most secure / most reliable" | Security and reliability are expected, not differentiating — find the real trade-off |
| Stale analysis | Competitive landscape from 18 months ago | Set a calendar reminder to refresh quarterly; check changelogs monthly |
| Ignoring negative reviews | Only reading what competitors say about themselves | G2 1-star reviews are your best market research |

## Related Skills

- `../prd-development/SKILL.md` — Paste the Positioning Gap Summary into Phase 4 (Strategic Context)
- `../go-to-market-planning/SKILL.md` — "Only We" statement and differentiators become GTM core messaging
- `../pricing-monetization-strategy/SKILL.md` — Competitor pricing tiers feed the pricing model analysis
- `../product-discovery/SKILL.md` — Validate competitive gaps as real user needs
