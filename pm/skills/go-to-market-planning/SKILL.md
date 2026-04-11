---
name: go-to-market-planning
effort: high
description: >-
  Use when a product or feature is near-complete and the team needs to answer:
  who do we target first, what do we say, where do we reach them, and how do we
  know the launch succeeded? Triggers on: "GTM plan", "launch strategy", "출시
  전략", 론칭 계획", "how
type: workflow
theme: pm-strategy
best_for:
  - "Planning a major product or feature launch end-to-end"
  - "Defining launch phases (beta → limited → full)"
  - "Aligning sales, marketing, and product on a launch narrative"
scenarios:
  - "We're shipping in 6 weeks — help me build a GTM plan."
  - "출시 전략을 짜야 하는데, 어디서부터 시작해야 할지 모르겠어."
  - "We have the PRD and we're building — now I need to figure out how to launch this."
  - "Who should we target first for this launch, and what do we say to them?"
  - "론칭 단계(베타→제한→전체)를 어떻게 나눌지 정해줘."
  - "Help me define success metrics specifically for the launch, not the product."
estimated_time: "90-180 min"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 비치헤드 세그먼트 선정과 채널 선택의 트레이드오프 논리를 검증하는 데 도움이 됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS define the beachhead segment before setting messaging or channel strategy.
- ALWAYS separate launch success metrics from product success metrics.
- NEVER write a GTM plan without defining what success looks like at 30, 60, and 90 days.
- NEVER conflate channel selection with message design — these are independent decisions.


## Purpose

A GTM plan answers:
1. **Who is the beachhead?** (first target segment — not everyone)
2. **What is the core message?** (what problem we solve, for whom, why now)
3. **Where do we reach them?** (channels)
4. **When and how do we roll out?** (phased launch timeline)
5. **How will we know if launch succeeded?** (launch-specific metrics)

This skill produces a **GTM Canvas** and a **Rollout Plan**.

---

## When to Use This

- After PRD completion — input from `../prd-development/SKILL.md`
- When competitive landscape is understood — input from `../competitive-analysis/SKILL.md`
- When pricing is defined (or being defined in parallel) — `../pricing-monetization-strategy/SKILL.md`
- Output feeds `../post-launch-retrospective/SKILL.md` as the baseline for measuring launch success
- Internal communication of the launch plan references `../roadmap-communication/SKILL.md`

## When NOT to Use This

- For minor feature releases (no formal GTM needed — use a release note + in-app announcement)
- Before product-market fit is established (pre-PMF: validate first, launch broadly second)
- As a substitute for a positioning or messaging strategy — this operationalizes messaging; it doesn't create it from scratch

---

## Step 1 — Define the Beachhead Segment (20 min)

**The most common GTM mistake:** trying to launch to everyone.

A beachhead is the smallest viable segment where you can win decisively, then expand from. Ask:

- Who has the pain most acutely?
- Who has the lowest switching cost or acquisition friction?
- Who, if they love us, will influence others?
- Who can we reach affordably through our existing channels?

### Segment Prioritization Grid

| Segment | Pain Intensity (1-5) | Reach Ease (1-5) | Strategic Value (1-5) | Score |
|---------|---------------------|-----------------|----------------------|-------|
| [Segment A] | | | | |
| [Segment B] | | | | |
| [Segment C] | | | | |

Score = sum of three dimensions. Launch to the top-scoring segment first.

---

## Step 2 — Craft Core Messaging (30 min)

Messaging must answer: **Why should [beachhead user] care, right now?**

### Message Framework

```
FOR: [Target user — be specific: job title, context, pain state]
WHO: [Problem they have]
OUR PRODUCT IS: [Category]
THAT: [Primary benefit / value delivered]
UNLIKE: [Status quo or key competitor]
WE: [Key differentiator — your "only we" from competitive-analysis]
```

Translate this into three message layers:

| Layer | Purpose | Length | Where Used |
|-------|---------|--------|-----------|
| **Tagline** | Instant recall | 5-8 words | Ads, top of landing page |
| **Elevator pitch** | First conversation | 2-3 sentences | Email subject, social copy |
| **Full value prop** | Informed decision | 1-2 paragraphs | Landing page body, sales deck |

### Message Validation Checklist

- [ ] Does it speak to the problem before the solution?
- [ ] Is it free of jargon the user wouldn't naturally use?
- [ ] Does it make a specific, credible claim — not "the best" or "the most powerful"?
- [ ] Would the target user nod in recognition when they read it?

---

## Step 3 — Select Launch Channels (20 min)

Match channels to where the beachhead segment actually lives and how they make buying/adoption decisions.

### Channel Selection Matrix

| Channel | Best For | Effort | Time to Impact |
|---------|---------|--------|---------------|
| Existing user base (in-app, email) | Feature launches to current users | Low | Fast |
| Organic SEO / content | High-intent discovery | High | Slow (3-6 months) |
| Paid search / social | Demand capture / generation | Medium | Medium |
| Product-led (viral, PLG loops) | Consumer / bottom-up SaaS | Medium | Medium |
| Partnerships / integrations | Ecosystem reach | High | Medium |
| Community (Slack, Discord, Reddit) | Developer / niche audiences | Medium | Medium |
| Sales-assisted / SDR outreach | Enterprise / high-ACV | High | Slow |
| PR / media | Awareness at scale | Medium | Fast (but one-shot) |
| Events / conferences | Relationship + awareness | High | Slow |

**Output:** Pick 2-3 primary channels and 1-2 supporting channels. Resist spreading across all of them.

---

## Step 4 — Define the Rollout Phases (30 min)

A phased rollout reduces risk and creates a learning loop before full exposure.

### Standard Three-Phase Rollout

#### Phase 1 — Beta (Internal / Invited)
- **Who:** Hand-picked users (existing power users, design partners, internal team)
- **Goal:** Catch critical bugs, validate core workflow, gather first testimonials
- **Duration:** 2-4 weeks
- **Success gate before advancing:** [Define specific criteria — e.g., "NPS > 40 from beta cohort", "zero P0 bugs for 5 business days"]

#### Phase 2 — Limited Launch (Controlled Expansion)
- **Who:** Waitlist, specific segment, or gated by invite / region / plan
- **Goal:** Validate acquisition funnel, activation rate, retention signal
- **Duration:** 2-4 weeks
- **Success gate before advancing:** [Define — e.g., "D7 retention ≥ 40%", "activation rate ≥ 60% within first session"]

#### Phase 3 — Full Launch
- **Who:** All eligible users / public availability
- **Goal:** Scale acquisition, drive awareness, collect social proof
- **Duration:** Ongoing
- **Launch amplification:** PR push, paid activation, community announcement

### Rollout Plan Template

```
## Launch Phases

| Phase | Start | End | Audience | Goal | Success Gate |
|-------|-------|-----|---------|------|-------------|
| Beta | [Date] | [Date] | [Who] | [Goal] | [Criteria] |
| Limited | [Date] | [Date] | [Who] | [Goal] | [Criteria] |
| Full | [Date] | — | All | Scale | [Criteria] |

## Pre-Launch Checklist (2 weeks before Full Launch)
- [ ] Onboarding flow tested end-to-end
- [ ] Support docs / FAQ published
- [ ] Pricing page live and accurate
- [ ] Analytics / tracking instrumented and verified
- [ ] CRM / sales team briefed
- [ ] Legal / compliance sign-off
- [ ] Rollback plan documented

## Launch Day Checklist
- [ ] Feature flags enabled / deployment confirmed
- [ ] Announcement emails / in-app messages queued
- [ ] Social posts scheduled
- [ ] PR embargo lifted (if applicable)
- [ ] On-call rotation active
- [ ] Real-time dashboard open and being monitored
```

---

## Step 5 — Define Launch Success Metrics (20 min)

Launch metrics are different from product health metrics. They measure the quality of the launch itself, not just the product.

### Metric Categories

| Category | Metric Type | Example |
|---------|------------|---------|
| **Awareness** | Reach the beachhead segment | Unique visitors to launch page, PR impressions |
| **Acquisition** | Convert interest to signup/install | Signup rate, trial starts, install count |
| **Activation** | First meaningful use | % who complete core action in first session |
| **Retention (early signal)** | Come back | D7 / D30 retention, week-2 return rate |
| **Revenue (if applicable)** | Paid conversion | Trial-to-paid %, MRR added in launch period |
| **Qualitative** | Sentiment | NPS from beta cohort, support ticket themes |

**Pick 1 primary launch metric + 3-5 secondary metrics.** The primary metric is the one you'll use to call the launch a success or not.

---
