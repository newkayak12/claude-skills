---
name: feature-prioritization
description: >-
  Scores and ranks features from a large backlog using frameworks like RICE, MoSCoW, and Value-Risk-Effort. Trigger on any of: "우선순위", "뭐부터 해야 해", "backlog 정리", "feature prioritization", "RICE", "what should we build first", "로드맵 우선순위", "P1이 너무 많아", or whenever someone has more to build than capacity to build it. Also trigger when a roadmap is being debated, stakeholders are pushing for different features, a backlog needs trimming, or someone is trying to decide between competing initiatives.
type: workflow
theme: pm-strategy
best_for:
  - "Scoring and ranking a large backlog with RICE or MoSCoW"
  - "Resolving stakeholder disagreements about what to build next"
  - "Trimming scope for a specific cycle or quarter"
scenarios:
  - "P1이 너무 많아. 이번 분기에 뭐부터 해야 할지 모르겠어."
  - "We have 50 items in the backlog. Help me figure out what to cut."
  - "두 팀이 서로 다른 기능을 원해. 우선순위 기준을 만들어줘."
estimated_time: "45-90 min"
---

# Feature Prioritization

Deciding what to build first — with a process that's defensible, data-informed, and repeatable.

## Core Principle

Prioritization is not ranking by enthusiasm. It is making trade-offs explicit, using consistent criteria, and being willing to say what you are NOT building and why. A prioritized list with no reasoning is just a to-do list. A prioritized list with shared criteria is a team decision.

---

## Framework 1: RICE Scoring

Use when you have a backlog of features and need a quantitative ranking to compare across initiatives.

**Formula:**
```
RICE Score = (Reach × Impact × Confidence) ÷ Effort
```

| Factor | Definition | Scale |
|--------|-----------|-------|
| **Reach** | How many users affected per quarter | Absolute number (e.g., 5,000 users/quarter) |
| **Impact** | How much it moves the target metric per user | 3 = massive, 2 = high, 1 = medium, 0.5 = low, 0.25 = minimal |
| **Confidence** | How confident are you in the estimates | 100% = high evidence, 80% = medium, 50% = low |
| **Effort** | Total person-months of work | Absolute number (e.g., 2 person-months) |

**Walkthrough example:**

Feature: In-app guided onboarding tour
- Reach: 3,000 new users/quarter
- Impact: 2 (high — directly targets activation, our primary KR)
- Confidence: 80% (we have qualitative data but no experiment yet)
- Effort: 1.5 person-months

```
RICE = (3,000 × 2 × 0.80) ÷ 1.5 = 4,800 ÷ 1.5 = 3,200
```

**Tips:**
- Use the same time horizon (quarter) for all features when calculating Reach
- If confidence is below 50%, consider running a discovery spike before scoring
- RICE scores are relative, not absolute — a score of 3,200 only means something when compared to other scores in the same backlog
- Recalculate after new evidence changes your confidence or impact estimates

---

## Framework 2: MoSCoW for Scope Decisions

Use when scoping a release, sprint, or MVP — you need to draw a clear in/out line.

| Label | Meaning | Criteria |
|-------|---------|----------|
| **Must Have** | Launch is impossible without this | Legal, safety, core user flow, contractual |
| **Should Have** | Important but launch is viable without it | Significantly improves experience; can follow in v1.1 |
| **Could Have** | Nice to have if time and effort allow | Delighter, edge case, minor improvement |
| **Won't Have (this time)** | Explicitly out of scope for this release | Future roadmap, deprioritized, not now |

**How to run a MoSCoW session:**

1. List every item under consideration
2. Timebox the "Must Have" sorting: if everything is Must Have, challenge each item — "what breaks if we don't ship this?"
3. Sort remaining items into Should/Could/Won't as a group, not solo
4. Document the Won't Haves with brief rationale — this is as important as the Must Haves

**Output format:**
```
Release: [Name] | Target date: [Date]

MUST HAVE
- [ ] Core checkout flow (no payment = no revenue)
- [ ] Email confirmation (regulatory requirement)

SHOULD HAVE
- [ ] Saved payment methods (reduces friction for returning users)
- [ ] Order history page (high-demand user request)

COULD HAVE
- [ ] Dark mode
- [ ] CSV export

WON'T HAVE (this release)
- [ ] Mobile app (separate initiative — Q3)
- [ ] Third-party integrations (dependencies not ready)
```

---

## Framework 3: Value-Risk-Effort Grid

Use when you need a visual, fast way to prioritize without scoring — good for workshops and backlog grooming sessions.

**Two-step process:**

Step 1 — Plot on a 2×2: Value (Y-axis) vs. Effort (X-axis)

| Quadrant | Label | Action |
|----------|-------|--------|
| High value, low effort | **Quick Wins** | Do first — no debate |
| High value, high effort | **Strategic Bets** | Plan carefully — these are your roadmap anchors |
| Low value, low effort | **Fill-ins** | Do when capacity allows; never let these block Quick Wins |
| Low value, high effort | **Time Sinks** | Deprioritize or kill — defend this quadrant ruthlessly |

Step 2 — Add a Risk overlay

For Strategic Bets only, add a risk score:
- Technical risk (do we know how to build it?)
- Market risk (do we know users want it?)
- Dependencies (does it require another team or vendor?)

High-risk Strategic Bets should be preceded by a discovery spike before full commitment.

---

## Handling "Everything Is P1"

This is the most common prioritization failure mode. Use these approaches:

**Technique 1 — Forced ranking**
> "I understand everything feels urgent. If you could only have ONE of these shipped in the next 6 weeks, which one would move your most important goal the most?"

Repeat until you have a ranked list. People find it much easier to choose between two options than to rank ten.

**Technique 2 — Show the trade-off explicitly**
> Create a table: [Feature A] vs. [Feature B]. For each, show estimated reach, impact, and effort. Ask stakeholders to agree on criteria before seeing the scores.

**Technique 3 — Capacity constraint as an anchor**
> "We have 4 engineer-weeks until the end of the quarter. These 7 features total 22 engineer-weeks of work. Which 4 weeks of work do we ship?"

Making the constraint concrete shifts the conversation from "what's important" (everything) to "what fits" (a real choice).

**Technique 4 — Defer with a commitment**
> "Feature X isn't in the next cycle. It IS in the planning horizon for Q3. I'll put it in the backlog with your context attached so it's not lost."

Documentation as commitment reduces the emotional stakes of being deprioritized.

---

## Connecting Prioritization to Evidence

Strong prioritization decisions are evidence-backed. Gather input from:

- **Competitive pressure data:** `../competitive-analysis/SKILL.md` — is a competitor shipping this?
- **Customer demand evidence:** `../customer-research-synthesis/SKILL.md` — how many users asked for this? How painfully?
- **Metric evidence:** `../metrics-interpretation/SKILL.md` — does data show this problem is real and large?
- **OKR alignment check:** `../okr-planning/SKILL.md` — does this feature directly move a current Key Result?
- **Stakeholder conflicts from prioritization:** `../stakeholder-management/SKILL.md` — when "everyone wants P1," the real problem is often stakeholder misalignment

---

## Output: Prioritized Backlog Format

```
Priority | Feature | RICE Score | Rationale | Quarter | Owner
---------|---------|-----------|-----------|---------|------
P1 | Guided onboarding | 3,200 | Directly drives activation KR; high confidence from user research | Q2 | [Name]
P2 | Saved payment methods | 2,100 | Reduces checkout friction; validated in usability sessions | Q2 | [Name]
P3 | Dark mode | 420 | Community request; low effort but low impact on KRs | Q3 | [Name]
Deferred | Third-party integrations | — | Dependency on vendor API not ready; revisit Q4 | Q4 | [Name]
```

**Include in every prioritized list:**
- The criteria used (RICE, MoSCoW, or explicit trade-off reasoning)
- What is NOT being built this cycle and why
- The OKR or goal each prioritized item serves
- Review date (when will this list be revisited?)

---

## Quick Diagnostic

| Signal | Problem | Action |
|--------|---------|--------|
| Every item is P1 | No shared criteria for priority | Run forced ranking or capacity-constraint exercise |
| Backlog keeps growing but nothing ships | Items added but never removed | Institute a "one in, one out" rule or quarterly backlog pruning |
| Stakeholders disagree on ranking | Misaligned on goals or criteria | Align on OKRs first; then re-run prioritization with shared criteria |
| High-RICE items keep getting bumped | Political pressure overriding data | Document each override; make the pattern visible to leadership |
| Team disagrees on effort estimates | Estimation variance is high | Run planning poker; break large items into smaller ones |
| Nothing in the backlog maps to a current OKR | Backlog is reactive, not strategic | Audit backlog against current OKRs; anything that doesn't map needs explicit justification |
