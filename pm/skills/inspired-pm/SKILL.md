---
name: inspired-pm
description: 'Discover and validate the right product to build using continuous discovery, outcome-based thinking, and product vision. Use when the user mentions "product discovery", "what should we build", "customer interview", "opportunity assessment", "product vision", or "outcome vs output". Covers the four product risks, continuous discovery habits, and the product team model.'
license: MIT
metadata:
  author: wondelai
  version: "1.0.0"
---

# Inspired Product Management Framework

A framework for discovering and building products that customers love, based on Marty Cagan's definitive guide to modern product management. The core insight: most product failures are not execution failures — they are discovery failures. Teams build the wrong thing, and build it well.

## Core Principle

**Discovery is not a phase — it is a continuous discipline.** The old model (PMs gather requirements → engineers build → customers respond) fails because by the time you learn you built the wrong thing, you've wasted months and millions. The modern model runs discovery and delivery in parallel: while one set of ideas is being built, the next set is being discovered, validated, and shaped.

**The foundation:** Every product idea carries four risks. Value risk: will customers buy it? Usability risk: can they figure out how to use it? Feasibility risk: can we build it? Business viability risk: does it work for our business? The job of product discovery is to reduce these risks before committing to delivery. Not to eliminate them — to reduce them enough that the bet is worth taking.

## Scoring

**Goal: 10/10.** When evaluating a product team's discovery practice, rate 0-10 based on the principles below. A 10/10 means the team continuously discovers, validates, and delivers in parallel, with strong customer proximity and outcome ownership. Always provide the current score and specific improvements needed.

- **9-10:** Team runs weekly discovery, has direct customer access, owns outcomes not features, and validates all four risks before delivery
- **7-8:** Discovery happens but is episodic; customer access is mediated; output metrics dominate over outcome metrics
- **5-6:** Some user research exists but isn't continuous; PMs act as "feature owners" not outcome owners
- **3-4:** Discovery is a kickoff phase, not a habit; requirements come from stakeholders, not customers
- **1-2:** No discovery practice; team builds what it's told; no connection to customer behavior or outcomes

## The Inspired Framework

### 1. The Four Product Risks

**Core concept:** Every product initiative carries four risks that must be addressed in discovery: Value (will customers want this?), Usability (can they use it successfully?), Feasibility (can we build and maintain it?), and Business Viability (does it work for the business — legal, financial, marketing, sales?).

**Why it works:** Most teams address only feasibility (can engineering build it?) and skip the other three. The result is products that work technically but fail in market. Explicitly naming all four risks creates a checklist that forces complete discovery before commitment.

**Key insights:**
- Value risk is the hardest to assess and the most commonly skipped
- Usability risk cannot be assessed by PMs reading requirements — it requires prototype testing with real users
- Feasibility risk belongs to engineers, not PMs — engineers must be in discovery, not just delivery
- Business viability risk requires involving legal, finance, and go-to-market early, not as final approvers
- All four risks must be addressed for every significant initiative — not just "big bets"

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| New feature | Run four-risk checklist | "Will customers pay for this? Can they use it? Can we build it? Does legal allow it?" |
| Roadmap prioritization | Weight by risk profile | High value + high usability + proven feasibility = prioritize; high feasibility only = deprioritize |
| Sprint planning | Block delivery until value risk addressed | "We can't start building until we've validated that customers want this outcome" |
| Stakeholder request | Reframe as hypothesis | "Stakeholder wants feature X → what customer outcome does X serve? How do we validate?" |
| Post-launch analysis | Identify which risk materialized | "Usage is low — was it value (didn't want it), usability (couldn't use it), or visibility (didn't find it)?" |

### 2. Continuous Discovery

**Core concept:** Discovery is not a phase at the beginning of a project — it is a weekly discipline. Product teams should be in continuous contact with customers: conducting interviews, testing prototypes, analyzing usage data, and updating their understanding of the opportunity space.

**Why it works:** Customer needs, market context, and competitive dynamics change continuously. A discovery phase six months ago produced a model of the world that is now outdated. Continuous discovery keeps the team's model current and catches wrong assumptions before they become expensive delivery commitments.

**Key insights:**
- Weekly customer interviews are the baseline — not monthly or quarterly
- Interviews should explore problems, not validate solutions — "tell me about the last time you did X" not "would you use this?"
- Product trios (PM, designer, engineer) should all participate in discovery, not just the PM
- Opportunity trees map the space: desired outcome → opportunities → solutions → experiments
- The goal of continuous discovery is to shrink the gap between what you assume and what is true
- Teresa Torres's "continuous discovery habits" — weekly touchpoints with customers — is the operational framework

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Customer interviews | Problem-focused, not solution-focused | "Walk me through the last time you tried to do X. What happened?" |
| Opportunity mapping | Build an opportunity tree | Outcome → Opportunities → Solutions → Experiments (mapped visually) |
| Prototype testing | Test assumptions, not preferences | "Can you show me how you'd accomplish X?" not "Do you like this design?" |
| Usage analysis | Identify behavior gaps | "70% of users drop off at step 3 — what assumption is failing?" |
| Team rhythm | Weekly discovery ritual | Monday: review last week's learnings → align on this week's experiments |

### 3. Outcome Over Output

**Core concept:** Product teams should be held accountable for outcomes — measurable changes in customer behavior — not outputs (features shipped). A team that ships 20 features but moves no metrics has failed. A team that ships two features that move retention by 15% has succeeded.

**Why it works:** Output accountability creates perverse incentives: teams optimize for shipping speed and feature count, not customer value. Outcome accountability forces teams to connect their work to real-world behavior change and business results. It also makes prioritization honest: "will this feature move the metric?"

**Key insights:**
- Outcomes are measurable changes in customer or business behavior: retention, conversion, engagement, revenue
- Outputs are deliverables: features, code shipped, stories closed
- A good outcome metric is: leading (predicts future business results), influenceable (the team can move it), and owned (this team is responsible for it)
- OKRs operationalize outcome thinking: the "KR" is always a behavior change, never a feature delivery
- The product team's north star: "What customer behavior change will prove we delivered value?"
- Never commit to a feature; commit to an outcome and explore which features might achieve it

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Roadmap framing | Replace features with outcomes | "Increase 30-day retention from 40% to 55%" not "Build notification system" |
| Sprint goal | Outcome-framed goal | "This sprint: validate that users complete onboarding in under 5 minutes" |
| Stakeholder communication | Translate requests to outcomes | "You want a dashboard — what decision will that dashboard enable? That's the outcome." |
| Success criteria | Define before building | "We'll know this worked when X% of users do Y within Z days of launch" |
| Retrospective | Measure outcomes, not velocity | "Did we move the retention metric? By how much? What did we learn?" |

### 4. The Empowered Product Team

**Core concept:** The empowered product team model gives small, cross-functional teams (PM, designer, engineers) a problem to solve and the autonomy to discover the best solution. The contrast is the "feature team" model, where teams receive a feature backlog and execute it.

**Why it works:** The people closest to the problem, the technology, and the customers are best positioned to find solutions. Feature teams waste this proximity — they're just executors. Empowered teams apply the full intelligence of everyone on the team to the hardest problems.

**Key insights:**
- PM owns: "what to build and why" — not the roadmap, the problem
- Designer owns: "how customers will interact with it" — discovery partner, not pixel pusher
- Engineers own: "how it will be built" — must be in discovery, not just receiving specs
- Stakeholders provide: business context, constraints, and strategy — not solutions
- Team topology matters: teams aligned to customer outcomes, not to product areas or platforms
- The PM's job is to make the team successful, not to manage up or manage the backlog

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Team design | Align teams to outcomes | "Activation team owns: new user reaches first value moment within 7 days" |
| PM role | Coach discovery, don't dictate solutions | "Here's the problem and the constraint — how do we solve it?" |
| Engineer involvement | Bring engineers to customer interviews | Weekly: at least one engineer per customer interview, rotating |
| Stakeholder management | Input, not output | "What outcome do you need? We'll find the best solution." |
| Accountability | Outcome OKRs for the team | "Team is accountable for retention metric, not for feature list" |

### 5. Product Vision and Strategy

**Core concept:** Product vision is a compelling, 3-5 year picture of the future the product is trying to create. Product strategy is how you plan to get there — which markets, which customers, which problems first. Without vision, teams optimize locally. Without strategy, teams work in disconnected directions.

**Why it works:** Teams without a shared vision make locally rational but globally incoherent decisions. Vision aligns the team's daily choices with a long-term direction. Strategy makes the vision actionable by identifying where to focus now versus later.

**Key insights:**
- Vision should be inspiring enough to guide decisions when the PM isn't in the room
- Good vision statements describe the future customer state, not the product features
- Strategy is not a roadmap — it's a set of choices about where to compete and how to win
- The product strategy connects company strategy to team-level problem statements
- Vision stays stable for years; strategy evolves as you learn; roadmap changes quarterly
- Jeff Bezos's "working backwards" method: write the press release for the future state first

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Vision creation | Future customer state, not product features | "Every small business owner has a CFO-level view of their finances" not "Best accounting software" |
| Strategy framing | Where to focus | "We focus on solo freelancers first; enterprise later — here's why" |
| Roadmap alignment | Connect features to strategy | "This feature advances our 'reduce onboarding friction' strategic bet — here's how" |
| Team alignment | Vision as decision filter | "Does this initiative move us toward the vision? No? Then it's not a priority." |
| Working backwards | Write the future press release | "In 2027, our customers will say: ___ — what product creates that reality?" |

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| Building a roadmap of features, not outcomes | Teams optimize for shipping, not value | Replace feature roadmaps with outcome roadmaps: what behavior change do we want? |
| PMs as requirement-gatherers | Stakeholder demands replace customer insights | PMs must own the problem, not the backlog; get out of the building |
| Discovery as a phase | Insights become stale; teams build on outdated assumptions | Weekly customer contact as a non-negotiable team ritual |
| Engineers excluded from discovery | Feasibility risk surfaces late; creative solutions missed | Engineers in customer interviews weekly; discovery is a trio activity |
| Validating solutions instead of exploring problems | Confirmation bias; customers politely agree with your idea | Interview for problems: "Tell me about the last time you..." not "Would you use this?" |
| Confusing output with outcomes | 20 features shipped, no metric moved | Define outcome success criteria before building; track behavior change, not delivery |
| Stakeholders as customers | Internal needs replace market reality | Stakeholders are constraints, not customers; always go to the actual user |

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Does the team speak to real customers at least weekly? | Discovery is episodic or absent | Establish a weekly customer interview ritual with the full product trio |
| Are team goals framed as outcomes, not features? | Roadmap is a feature list | Rewrite goals as behavior changes: "X% of users will do Y" |
| Do engineers participate in discovery? | Discovery is PM-only; feasibility surprises in delivery | Rotate engineers into weekly customer interviews |
| Is there a documented product vision (3-5 years)? | Teams optimize locally with no shared direction | Create a vision statement focused on future customer state |
| Have all four risks been addressed for current initiatives? | Teams address feasibility only | Run a four-risk checklist for every significant initiative |
| Is the product strategy explicit about where NOT to focus? | Everything feels equally important | Write the "not now" list alongside the "focus here" list |
| Are prototypes tested with real users before engineering begins? | Design is validated internally only | User testing with target customers before any significant engineering investment |

## Further Reading

- [*"Inspired: How to Create Tech Products Customers Love"*](https://www.amazon.com/INSPIRED-Create-Tech-Products-Customers/dp/1119387507) by Marty Cagan (2nd edition, 2017)
- [*"Continuous Discovery Habits"*](https://www.amazon.com/Continuous-Discovery-Habits-Discover-Products/dp/1736633309) by Teresa Torres — operationalizes weekly discovery rituals
- [*"Empowered: Ordinary People, Extraordinary Products"*](https://www.amazon.com/EMPOWERED-Ordinary-People-Extraordinary-Products/dp/111969129X) by Marty Cagan & Chris Jones — the empowered team model in depth

## About the Author

**Marty Cagan** is a partner at the Silicon Valley Product Group (SVPG) and one of the most influential voices in modern product management. Before SVPG, he was VP of Product at eBay during its formative years and held product leadership roles at Netscape and HP. *Inspired* (first published 2008, second edition 2017) has become the de facto handbook for product managers at technology companies worldwide. Cagan's core argument — that most product failures are discovery failures, not delivery failures — has reshaped how high-performing product organizations think about their work. His follow-up book *Empowered* (2020, with Chris Jones) extends the framework to product leadership and team organization.
