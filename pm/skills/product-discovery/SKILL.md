---
name: product-discovery
description: 'Use when someone is uncertain which product development approach fits their situation, wants to evaluate or improve their discovery process, or is deciding between continuous discovery and fixed-cycle planning. Acts as a meta-framework that diagnoses organizational context and routes to Inspired (Cagan) or Shape Up accordingly.'
license: MIT
metadata:
  author: wondelai
  version: "1.0.0"
---

# Product Discovery Framework

A meta-framework that routes product discovery work to the right methodology based on context. Two frameworks dominate modern product thinking: Marty Cagan's continuous discovery model (from *Inspired*) and Basecamp's Shape Up model. They are not competing — they answer different organizational situations. This skill diagnoses the context and applies the right one.

## Core Principle

**The right discovery process depends on your organizational context, team maturity, and planning horizon — not on ideology.** Continuous discovery (Cagan) works best for teams with direct customer access, a culture of outcome ownership, and the discipline to run weekly experiments. Shape Up works best for teams that want to escape the sprint treadmill, can shape work upfront, and are willing to kill a bet that doesn't ship. Most teams need elements of both.

**The foundation:** The two frameworks are complementary at different timescales. Shape Up answers "what do we build in the next six weeks?" — it is a planning and execution framework. Continuous discovery answers "are we building the right things?" — it is a learning and validation framework. A team can run Shape Up cycles while also doing continuous discovery to validate the bets they're placing at the betting table.

## Scoring

**Goal: 10/10.** When evaluating a team's product discovery practice, rate 0-10. A 10/10 means the team has a clear discovery methodology matched to their context, runs it consistently, and uses learning to inform what goes into the pipeline. Always provide the current score and specific improvements needed.

- **9-10:** Clear methodology matched to context; continuous learning feeding the pipeline; shaped or validated work enters every cycle
- **7-8:** Methodology exists but is partially applied; discovery and delivery are siloed rather than parallel
- **5-6:** Some discovery happens but it's episodic; most work enters the pipeline without validation
- **3-4:** No consistent discovery process; roadmap is driven by stakeholder requests or product intuition
- **1-2:** Delivery-only culture; "we'll see how users respond" is the discovery practice

## Framework Routing

### When to Use Inspired (Continuous Discovery)

Apply the continuous discovery model when:
- **Team has direct customer access** — PMs can conduct weekly interviews without heavy mediation
- **Outcome ownership is possible** — team can own a metric and be accountable for it
- **Discovery and delivery need to run in parallel** — you're building while also validating the next set of ideas
- **The problem space is exploratory** — you're still discovering which opportunities are worth pursuing
- **Team is cross-functional with design and engineering in discovery** — not just PM doing research

Core practices from Inspired to apply:
- Weekly customer interviews (full product trio)
- Opportunity tree mapping
- Four-risk validation before delivery commitment
- Outcome-based roadmaps

→ For full details: see `inspired-pm` skill

### When to Use Shape Up

Apply the Shape Up model when:
- **Sprints feel like a treadmill** — two-week cycles produce pressure without meaningful progress
- **Backlog is overwhelming** — a long backlog is creating cognitive debt and false commitments
- **Senior people can shape work upfront** — there are people with the domain knowledge and design sense to create pitched shapes
- **Teams need autonomy** — you want to stop assigning tasks and start empowering teams to own problems
- **Fixed-time scoping is the discipline you need** — appetite-based planning, not estimate-based planning

Core practices from Shape Up to apply:
- Six-week cycles with cool-down
- Appetite setting before shaping
- Pitched shapes with rabbit holes and no-gos
- Betting table (no backlog)
- Autonomous teams with hill charts

→ For full details: see `shape-up` skill

### When to Combine Both

The frameworks work together at different timescales:

| Timescale | Framework | Activity |
|-----------|-----------|---------|
| Weekly | Continuous Discovery | Customer interviews, assumption testing, opportunity tree updates |
| 6-week cycle | Shape Up | Betting table, shaped pitches, autonomous build cycles |
| Quarterly | Both | Discovery insights feed the pitch pipeline; pitches are validated bets, not wishful thinking |

The ideal combination: teams run weekly discovery (Cagan) to continuously validate the opportunity space, and use Shape Up cycles to ship the best-validated opportunities with appropriate appetite. The betting table becomes more confident when the pitches on the table have already been validated by discovery.

## The Discovery Diagnostic

Use these questions to route to the right framework:

### Question 1: What is your primary pain?
- A) "We build features but don't know if they're the right ones" → Continuous discovery deficit → **Inspired**
- B) "We're always in sprint planning hell and nothing feels meaningful" → Planning/execution deficit → **Shape Up**
- C) "Both" → Start with Shape Up for planning stability, add continuous discovery once the rhythm is established

### Question 2: What is your team's current practice?
- A) You run sprints and have a backlog → **Shape Up** will be the bigger change; start there
- B) You have no structured discovery → **Inspired** continuous discovery is the gap; start with weekly customer interviews
- C) You have some discovery but it's not connected to what gets built → Connect discovery to the pitch pipeline (combined model)

### Question 3: What maturity does your team have?
- A) Junior product team, little design capacity → **Shape Up** gives structure; shaping can be done by senior IC or manager
- B) Experienced product trio, strong design partnership → **Inspired** continuous discovery will be natural
- C) Mixed maturity → Shape Up for the planning rhythm; discovery practices at the PM level

## Common Anti-Patterns

| Anti-Pattern | Symptom | Fix |
|-------------|---------|-----|
| Discovery theater | User research happens but doesn't affect decisions | Connect discovery findings to the betting table: no pitch without supporting discovery |
| Sprint-as-discovery | Two-week sprints with "research spikes" — discovery is compressed and shallow | Separate discovery cadence (weekly, continuous) from delivery cadence (6-week cycles) |
| Backlog as strategy | Long backlog gives the illusion of a plan; items never get built | Shape Up: kill the backlog; pitch the ideas worth pursuing this cycle |
| Feature factory with discovery branding | Team calls itself "discovery-led" but ships a roadmap of features | Outcome-based: what behavior change are we targeting? That drives discovery, not a feature list |
| Validated solutions without validated problems | Teams test solutions before confirming the problem is real and worth solving | Opportunity tree: validate the opportunity before generating solutions |

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Do you know which framework fits your current context? | Using one framework dogmatically regardless of fit | Run the routing diagnostic above; pick the framework that addresses your actual pain |
| Is discovery connected to what actually gets built? | Discovery and delivery are parallel but disconnected | Make discovery output the input to the pitch pipeline or betting table |
| Are customer insights driving the pipeline, not just validating features after decisions are made? | Research is used to justify, not decide | Move research earlier: validate opportunities, not solutions |
| Does the team have a consistent cadence (weekly discovery OR 6-week cycles)? | Discovery is episodic; planning is chaotic | Pick one rhythm and establish it before optimizing |
| Is there an explicit decision point where discovery converts to commitment? | Ideas move to delivery without clear gates | Define the gate: what evidence is needed before a pitch is submitted or a commitment is made? |

## Further Reading

The two frameworks this skill routes between:

**Inspired (Continuous Discovery):**
- [*"Inspired: How to Create Tech Products Customers Love"*](https://www.amazon.com/INSPIRED-Create-Tech-Products-Customers/dp/1119387507) by Marty Cagan
- [*"Continuous Discovery Habits"*](https://www.amazon.com/Continuous-Discovery-Habits-Discover-Products/dp/1736633309) by Teresa Torres

**Shape Up:**
- [*"Shape Up: Stop Running in Circles and Ship Work That Matters"*](https://basecamp.com/shapeup) by Ryan Singer — free online

**Synthesis:**
- [*"Empowered: Ordinary People, Extraordinary Products"*](https://www.amazon.com/EMPOWERED-Ordinary-People-Extraordinary-Products/dp/111969129X) by Marty Cagan & Chris Jones
