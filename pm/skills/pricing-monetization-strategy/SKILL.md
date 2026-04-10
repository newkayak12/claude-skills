---
name: pricing-monetization-strategy
description: >-
  Use when deciding how to charge for a product, evaluating a shift from one
  pricing model to another, or when a GTM plan needs pricing addressed before
  launch. Triggers on: "가격 전략", "요금제 설계", "pricing model", "freemium vs free
  trial", usage-based
type: workflow
theme: pm-strategy
best_for:
  - "Designing a new pricing model from scratch"
  - "Evaluating a shift from one pricing model to another"
  - "Structuring tier/packaging decisions for a SaaS product"
scenarios:
  - "We need to decide between freemium and a free trial — help me think through this."
  - "가격 전략을 세워야 해. 어떤 요금제 구조가 맞는지 모르겠어."
  - "We're adding a new feature — should it go in the current tier or create a new tier?"
  - "Help me design a 3-tier SaaS pricing structure for our B2B product."
  - "seat 기반에서 usage 기반으로 전환하는 게 맞는지 판단해줘."
  - "What's the right value metric for our AI product?"
estimated_time: "60-120 min"
compatibility:
  recommended:
    - think-tool
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 가격 모델 선택의 트레이드오프와 패키징 설계 논리를 체계적으로 검토하는 데 도움이 됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Purpose

Pricing is a product decision, not a finance decision. It signals value, shapes who buys, and determines growth mechanics. This skill answers:
1. **What model fits how customers receive value?** (pricing model)
2. **What is the right value metric?** (what you charge for)
3. **How do we structure tiers?** (packaging)
4. **What should we charge?** (price point)
5. **What are we optimizing for?** (growth, margin, ARR, retention)

This skill produces a **Pricing Model Recommendation** and a **Packaging Structure**.

---

## When to Use This

- When building a GTM plan — feeds `../go-to-market-planning/SKILL.md`
- When competitive pricing benchmarks are needed — input from `../competitive-analysis/SKILL.md`
- When customer research reveals willingness-to-pay signals — input from `../customer-research-synthesis/SKILL.md`
- When pricing is a core component of the PRD — references `../prd-development/SKILL.md`

## When NOT to Use This

- For pricing a services engagement or consulting project (different dynamics)
- As a substitute for actual WTP research — this gives you the framework; you still need to talk to customers
- When pricing is locked by leadership or legal contract — focus on packaging instead

---

## Step 1 — Understand the Value Exchange (20 min)

Before picking a model, understand how value is delivered and consumed.

### Value Delivery Questions

1. **When does the customer first experience value?** (immediately on signup? after setup? after a threshold of use?)
2. **How does value scale for the customer?** (more users? more data? more integrations? more output?)
3. **Is value delivered continuously or in discrete events?**
4. **Who is the economic buyer vs. the end user?** (they may differ — price to the buyer, sell to the user)
5. **How long does it take a customer to realize value?** (time-to-value affects trial vs. freemium choice)

---

## Step 2 — Select the Pricing Model (20 min)

### Pricing Model Taxonomy

| Model | Best Fit | Growth Mechanic | Risk |
|-------|---------|----------------|------|
| **Flat rate / one-time** | Simple tools, finite scope | Low — limited upsell | Revenue ceiling; no recurring |
| **Subscription (flat)** | Consistent value, predictable use | Retention-driven | Undercharges heavy users |
| **Per-seat** | Collaborative tools, team adoption | Viral — adding seats adds ARR | Discourages broad deployment |
| **Usage-based** | Infrastructure, API, AI tokens | Land small, expand naturally | Revenue unpredictability |
| **Tiered (feature-based)** | Products with clear value segments | Upsell to higher tier | Tier design is hard; wrong segmentation hurts |
| **Freemium** | PLG, high volume, self-serve | Virality and organic acquisition | High support cost; hard to convert |
| **Free trial (time-limited)** | Complex products needing time to show value | Urgency-driven conversion | Requires strong activation in trial window |
| **Hybrid (free tier + usage)** | Developer tools, AI products | Broad top of funnel; expand on value | Complexity; hard to communicate |

### Decision Framework

Answer these four questions to narrow the model:

| Question | If Yes → | If No → |
|---------|---------|---------|
| Can the customer experience meaningful value before paying? | Freemium or free trial | Paid-only or demo-gated |
| Does value scale with usage (not seats)? | Usage-based or hybrid | Seat-based or flat subscription |
| Is the buyer different from the user? | Tiered (buyer pays; user adopts) | PLG / usage-based |
| Is the product a workflow (daily use) or outcome (periodic)? | Subscription | Usage or outcome-based |

---

## Step 3 — Choose the Value Metric (15 min)

The value metric is **what you charge for**. It should:
- Correlate directly with the value the customer receives
- Scale naturally as the customer gets more value
- Be easy for the customer to understand and predict their bill
- Be hard for competitors to undercut (not pure commodity)

### Common Value Metrics by Category

| Category | Good Value Metrics |
|---------|------------------|
| Collaboration / productivity | Seats, active users |
| Infrastructure / API | Requests, compute time, storage GB |
| AI / LLM products | Tokens, generations, tasks completed |
| Marketing / analytics | Contacts, events tracked, reports exported |
| E-commerce / marketplace | GMV %, transactions, listings |
| Data / integration | Records synced, connectors, rows |

### Value Metric Validation Test

A good value metric passes all three:
1. **The customer understands it** — can they predict next month's bill?
2. **It grows with customer success** — more value = more usage = more revenue
3. **It aligns incentives** — you win when the customer wins, not when they fail

---

## Step 4 — Design the Packaging Structure (30 min)

Packaging = how you group features and value metrics into tiers.

### The Three-Tier Framework (Most Common SaaS)

| Tier | Purpose | Who It's For | Price Signal |
|------|---------|-------------|-------------|
| **Starter / Free** | Acquisition; remove the "try before buy" barrier | Individual user, small team, or developer | $0 or lowest paid tier |
| **Growth / Pro** | Core monetization; right-sizes for most paying customers | Growing team; the segment with the budget | Mid-range |
| **Enterprise / Scale** | Expands revenue ceiling; handles enterprise needs | Large org, security/compliance buyers, high usage | High / custom |

### Packaging Design Principles

1. **Each tier should have one natural buyer.** If two different personas both buy the middle tier, you may have a missing tier or a misaligned value metric.
2. **Put the feature that drives conversion in the first paid tier, not free.** The free/starter tier shows value; the paid tier captures it.
3. **Enterprise tier should have at least one feature that only enterprise buyers care about** (SSO, audit logs, SLA, custom contracts). This prevents enterprise buyers from getting stuck in mid-tier.
4. **Avoid "feature salami"** — don't split a single feature across tiers as artificial gatekeeping. Users will resent it.
5. **Limit tiers to three or four.** More than four tiers adds cognitive load and slows purchase decisions.

### Packaging Template

```
## [Product Name] Pricing Structure

### [Free / Starter Tier] — $[X]/mo
Target: [Who]
Value prop: [One sentence]
Includes:
- [Core capability — enough to show value]
- [Value metric limit: e.g., "up to 3 users" / "1,000 API calls/mo"]
Excludes (requires upgrade):
- [Key paid feature 1]
- [Key paid feature 2]

### [Growth / Pro Tier] — $[Y]/mo per [unit]
Target: [Who]
Value prop: [One sentence]
Includes everything in Starter, plus:
- [Feature that drives conversion]
- [Feature]
- [Value metric limit: e.g., "up to 25 users" / "100,000 API calls/mo"]

### [Enterprise / Scale Tier] — Custom / $[Z]/mo
Target: [Who]
Value prop: [One sentence]
Includes everything in Growth, plus:
- [SSO / SAML]
- [Audit logs / compliance]
- [Dedicated support / SLA]
- [Custom contracts / invoicing]
- Unlimited [value metric]
```

---

## Step 5 — Research Willingness to Pay (20 min)

Don't guess the price point. Use structured research.

### WTP Research Methods

#### Van Westendorp Price Sensitivity Meter (Fastest)
Ask 4 questions to 15-30 target customers:

1. At what price would this product be **so cheap** you'd question the quality?
2. At what price would this product be a **bargain** — great value?
3. At what price would this product start to feel **expensive**, but you'd still consider it?
4. At what price would this product be **too expensive** and you'd rule it out?

Plot responses to find the Acceptable Price Range (between "too cheap" and "too expensive" intersections).

#### Conjoint / Trade-off Research
Ask customers to choose between feature/price configurations. Reveals which features drive WTP and which don't.

#### Competitor Benchmarking
From `../competitive-analysis/SKILL.md`:
- Where do competitors price?
- What segment do they over/under-serve?
- Can you charge a premium for a differentiated capability, or must you match?

#### Sales/CS Interviews (Fastest for B2B)
Ask: "Have you ever lost a deal because of price? What was the threshold?" — even 5-10 conversations give strong signal.

---

## Step 6 — Common Pricing Anti-Patterns

| Anti-Pattern | Symptom | Fix |
|-------------|---------|-----|
| **Cost-plus pricing** | "Our infra cost is $X, so we charge $X + margin" | Customers pay for value delivered, not your costs. Use value-based pricing. |
| **Competitor copy** | Matching a competitor's price exactly without understanding your own value metric | Different value props justify different prices. Benchmark, don't copy. |
| **Freemium with no conversion mechanic** | Free users never hit a paywall; no natural upgrade moment | Design a trigger: usage limit, collaboration invite, feature gate — something drives the upgrade |
| **Too many tiers** | 5+ pricing tiers; customers can't choose | Collapse to 3 tiers. Decision paralysis kills conversion. |
| **Pricing page buried** | Users have to contact sales before they see pricing | Hiding price signals distrust. Show pricing for at least the self-serve tiers. |
| **Enterprise pricing with no floor** | "Contact us" with no anchor; enterprise buyers can't budget | Publish at least a "starting at" price to allow budgetary qualification |
| **Wrong value metric** | Charging per seat for a solo-use tool | Value metric must match how users consume value. Per-seat only works for collaborative tools. |
| **Set-and-forget pricing** | Pricing hasn't been revisited in 2+ years despite growth | Review pricing annually. As your product matures, your customers' WTP increases. |

---

## Output Format

### Pricing Model Recommendation

```
## Pricing Recommendation: [Product Name]

### Model: [Selected model]
Rationale: [2-3 sentences connecting model to how customers receive value]

### Value Metric: [What you charge for]
Rationale: [Why this metric scales with customer value]

### Tier Structure
[Table or list from packaging template above]

### Recommended Price Points
- [Tier 1]: $[X]/[unit/mo] — based on [WTP research / competitive benchmark]
- [Tier 2]: $[Y]/[unit/mo]
- [Tier 3]: Custom / $[Z]+

### Conversion Mechanic
[How free/trial users hit a natural upgrade moment]

### Open Questions
- [Question + owner + how to answer]

### Competitive Context
[Summary from ../competitive-analysis/SKILL.md — where this pricing sits vs. market]
```

---

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Maps value delivery questions to pricing model options | Conducts actual WTP research with target customers |
| Applies Van Westendorp or conjoint framing to existing data | Validates price points against competitive benchmarks |
| Designs tier structure and packaging template | Makes the final pricing decision (business, finance, legal input) |
| Identifies anti-patterns in existing pricing (cost-plus, wrong value metric) | Runs internal approval process for pricing changes |
| Connects pricing to GTM Canvas and PRD constraints section | Monitors conversion and churn after pricing changes |

## Standalone Inputs

If no customer research exists, provide:
- Target customer segment and job-to-be-done
- 3 WTP interview responses structured as: "I'd pay $X for this because..."
- Top 2-3 competitor price points and tier names

## Related Skills

- `../go-to-market-planning/SKILL.md` — pricing tier and entry point are required GTM Canvas inputs
- `../competitive-analysis/SKILL.md` — competitor pricing tiers anchor price point benchmarking
- `../prd-development/SKILL.md` — document pricing model in Phase 4 when it is a core product decision
- `../customer-research-synthesis/SKILL.md` — WTP signals extracted from research feed this skill
