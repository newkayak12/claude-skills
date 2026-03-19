---
name: hypothesis-driven-dev
description: 'Design and run product experiments using assumption mapping and Build-Measure-Learn loops. Use when the user mentions "hypothesis", "write a hypothesis", "MVE", "minimum viable experiment", "fake door test", "concierge test", "assumption map", "validated learning", "assumption testing", "Build-Measure-Learn", "Lean Startup", or "falsifiable hypothesis". Covers experiment design, minimum viable experiments, and discovery loops.'
license: MIT
metadata:
  author: wondelai
  version: "1.0.0"
---

# Hypothesis-Driven Development Framework

A framework for making product decisions based on validated learning rather than opinion, authority, or tradition. Synthesizes Eric Ries's Build-Measure-Learn loop from *The Lean Startup* with Teresa Torres's Continuous Discovery framework, creating a disciplined path from assumption to evidence to decision.

## Core Principle

**Every product decision is a hypothesis. The question is whether you test it before or after building it.** Hypothesis-driven development makes the implicit explicit: "We believe [action] will result in [outcome] for [customer segment]. We'll know we're right when [measurable signal]." This structure separates what you know from what you assume, and forces you to design the smallest possible test.

**The foundation:** The core loop is Build-Measure-Learn: form a hypothesis → design the smallest viable test → measure the real signal → decide based on evidence. Teresa Torres adds the opportunity tree: start with the desired outcome → map the opportunity space → generate solution ideas → design experiments. Together, these frameworks create a disciplined alternative to building by instinct or stakeholder pressure.

## Agent Output

When a user asks to **write a hypothesis**, produce:
1. **The hypothesis** — using the four-part formula: "We believe [doing X] for [customer Y] will result in [outcome Z]. We'll know we're right when [metric M reaches level L]."
2. **Null hypothesis** — "We'll stop if [abandonment criteria]"
3. **Riskiest assumption** — one assumption to test first, before building
4. **Suggested MVE type** — concierge / fake door / prototype / A/B (matched to assumption type)

When a user asks to **evaluate their practice**, produce:
1. **Score (0-10)** using the rubric below
2. **Highest-leverage improvement**
3. **One concrete next experiment** they can run this week

## Scoring

**Goal: 10/10.** When evaluating a team's hypothesis-driven practice, rate 0-10. A 10/10 means the team explicitly states hypotheses before building, designs minimum viable experiments, measures real behavior (not surveys), and makes clear decisions based on results. Always provide the current score and specific improvements.

- **9-10:** All initiatives start with explicit hypotheses; experiments are designed for falsifiability; teams pivot based on evidence, not opinion
- **7-8:** Experiments happen but hypotheses are implicit; MVPs are too large; learning is acknowledged but not acted on
- **5-6:** Some A/B testing exists but as optimization, not discovery; major features shipped without validation
- **3-4:** "We'll see how users respond after launch" is the default discovery approach
- **1-2:** No experimentation culture; all product decisions made by authority or intuition; data used to justify, not decide

## The Hypothesis-Driven Framework

### 1. Hypothesis Formation

**Core concept:** A hypothesis is a structured, falsifiable prediction about what will happen if you take a specific action. A well-formed hypothesis has four parts: who the customer is, what action you're taking, what outcome you expect, and how you'll measure it. If any part is missing, the hypothesis cannot be tested.

**Why it works:** Vague intentions ("improve engagement") cannot be falsified, tested, or learned from. Explicit hypotheses force clarity about assumptions, define success in advance, and create the pre-mortem structure that prevents post-hoc rationalization ("we knew it would work").

**Key insights:**
- The formula: "We believe [doing X] for [customer Y] will result in [outcome Z]. We'll know we're right when [metric M reaches level L]."
- The hypothesis must be falsifiable: if there's no scenario in which it could be wrong, it's not a hypothesis
- Separate value hypotheses (do customers want this?) from growth hypotheses (will it spread?) from usability hypotheses (can they use it?)
- State the null hypothesis too: "We believe this won't work if..." — this sets your abandonment criteria
- Confidence level matters: are you 80% confident or 20%? That determines experiment investment
- The hardest part is writing the hypothesis before building, not after the results are in

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Feature hypothesis | Full four-part structure | "We believe adding in-app onboarding tooltips for new B2B users will increase 7-day activation from 23% to 35%. We'll know we're right when tooltips-group activation exceeds 35% in a 2-week A/B test." |
| Value hypothesis | Customer want | "We believe SMB owners want automated invoice reminders because late payments are their #1 cash flow problem." |
| Growth hypothesis | Acquisition/retention | "We believe users who invite a teammate in week 1 retain at 2x the rate of solo users." |
| Usability hypothesis | Interaction assumption | "We believe users can complete the new checkout flow without help in under 3 minutes." |
| Abandonment criteria | Pre-commit to stopping | "If the feature doesn't move 7-day retention by at least 5pp in 4 weeks, we remove it." |

### 2. Assumption Mapping

**Core concept:** Before designing any experiment, surface all assumptions embedded in your hypothesis. Map them on two axes: how critical they are to the hypothesis (if wrong, the whole bet fails) and how much evidence you already have. Prioritize testing assumptions that are high-criticality and low-evidence.

**Why it works:** Teams often jump to testing their solution when the riskiest assumption is about the problem. If your foundational assumption (customers have this pain) is wrong, no solution experiment will save you. Assumption mapping forces you to test in the right order.

**Key insights:**
- Two categories: desirability (do customers want it?), feasibility (can we build it?), viability (does it work for the business?)
- The riskiest assumption is not always the most obvious one — surface all assumptions first, then rank
- High-evidence assumptions (you have data, prior research, or existing product signals) need no new experiments
- Low-evidence, high-criticality assumptions should be tested before any engineering investment
- Never test two high-criticality assumptions in a single experiment — isolate the variable
- Assumption maps become living documents: update them as evidence comes in

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Assumption extraction | List all "we believe" statements | "We believe: (1) users don't read error messages, (2) they want inline help, (3) inline help reduces support tickets" |
| Risk ranking | Criticality × evidence matrix | "Assumption 1: low evidence, high criticality → test first. Assumption 3: medium evidence, medium criticality → test second." |
| Evidence audit | What do we already know? | "We have support ticket data showing 40% are 'how do I...' questions — this supports assumption 2 with existing evidence" |
| Experiment prioritization | Test the riskiest first | "Don't design the inline help UI until we know users will engage with it — test that assumption first" |
| Assumption invalidation | When evidence contradicts | "Data shows users do read error messages — drop assumption 1, redesign the experiment" |

### 3. Minimum Viable Experiments (MVE)

**Core concept:** A Minimum Viable Experiment is the smallest, fastest test that produces enough evidence to make a decision. It is not about building the minimum viable product — it is about designing the minimum effort to test a specific assumption. Concierge tests, fake door tests, wizard of oz, and landing page tests are all MVEs.

**Why it works:** Teams default to building because that's what they know how to do. But building is the most expensive form of learning. An MVE produces the same learning at a fraction of the cost, enabling many more experiments in the same time period.

**Key insights:**
- Concierge test: manually deliver the service before building the automation — proves value without tech
- Fake door / smoke test: create the button or landing page before building the feature — proves demand
- Wizard of Oz: simulate the product behavior behind the scenes — humans do what the algorithm will do
- Paper prototype / clickable mockup: test usability without any engineering
- A/B test: compare two versions in production — useful for optimization, not discovery
- The right MVE depends on the assumption: value hypotheses need concierge; usability hypotheses need prototypes; volume hypotheses need fake doors

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Value assumption | Concierge test | "Before building auto-reminders, manually send reminders via email for 10 customers — measure response rate" |
| Demand assumption | Fake door test | "Add 'Invoice Analytics' to the nav — measure click rate before building the feature" |
| Usability assumption | Clickable prototype | "Figma prototype of new checkout — 5 user sessions with think-aloud, before any engineering" |
| Scale assumption | Wizard of Oz | "Route 'AI suggestions' through a human reviewer for 2 weeks — prove value before building the model" |
| Optimization | A/B test in production | "Test two subject lines for invoice reminder emails — measure open rate and payment completion rate" |

### 4. Build-Measure-Learn Loop

**Core concept:** The Build-Measure-Learn loop is the operational cadence of hypothesis-driven development. Build: create the minimum necessary to test. Measure: collect the real signal (behavior, not opinion). Learn: decide based on evidence — persevere (the hypothesis was right), pivot (wrong on one assumption, change direction), or stop (the whole bet is wrong).

**Why it works:** Without an explicit loop, teams build → release → move on. Learning is implicit at best. The loop makes learning the explicit product of every cycle, and forces a decision point after every experiment: what do we now believe, and what do we do next?

**Key insights:**
- "Build" in the loop often means "design the smallest test" — not "write code"
- Measure real behavior, not reported preferences: what users do, not what they say they'd do
- Learning has three outputs: persevere (validated — keep going), pivot (one assumption wrong — change approach), stop (core hypothesis wrong — don't build this)
- Pivot ≠ failure: it's the correct response to disconfirming evidence. Failure is continuing without evidence.
- Pivot types: customer segment pivot, problem pivot, solution pivot, revenue model pivot
- Each loop should produce a documented decision: "We learned X. We are [persevering/pivoting/stopping] because Y."

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Full loop | BML cycle | Build: fake door for analytics. Measure: 18% of users clicked. Learn: demand confirmed — persevere to prototype. |
| Persevere decision | Evidence supports hypothesis | "Concierge reminders had 80% response rate — build the automation" |
| Pivot decision | Assumption wrong, direction changes | "Users don't want reminders — they want to see payment status. Pivot to payment tracking." |
| Stop decision | Core bet is wrong | "Even with reminders, no one paid faster — the problem isn't reminders, it's pricing. Stop." |
| Loop documentation | Learning record | "Experiment: fake door. Result: 3% CTR. Decision: demand too low — stop and reassess the opportunity" |

### 5. Opportunity Trees

**Core concept:** An opportunity tree is a visual map that connects the desired outcome (company or product goal) to the opportunity space (customer needs, pain points, desires), to solution ideas, to experiments. It organizes the discovery process so that every experiment connects back to the outcome the team is trying to achieve.

**Why it works:** Without an opportunity tree, experiments are disconnected: teams run tests based on intuition or stakeholder requests with no clear line to the business outcome. The tree creates a navigable map: "We're trying to achieve X. Here are the opportunities that serve X. Here are solutions for each opportunity. Here are the experiments to validate each solution."

**Key insights:**
- Level 1: Desired outcome — the metric or behavior change the team owns
- Level 2: Opportunities — customer needs, pain points, desires that serve the outcome (from interviews and research)
- Level 3: Solutions — specific ideas that address each opportunity (don't stop at one per opportunity)
- Level 4: Experiments — the MVEs that test each solution's assumptions
- The tree is updated continuously as new interviews produce new opportunities and evidence invalidates branches
- Never test solutions for opportunities that haven't been validated — the tree enforces the order

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Outcome definition | Top of tree | "Desired outcome: increase 30-day retention from 42% to 58%" |
| Opportunity discovery | Level 2, from interviews | "Opportunity: users don't understand what to do after signup — they feel lost" |
| Solution generation | Level 3, multiple per opportunity | "Solutions: (1) in-app checklist, (2) email drip, (3) progress bar, (4) product tour" |
| Experiment design | Level 4, one per solution assumption | "Experiment for solution 1: prototype the checklist, test with 5 new users, measure task completion" |
| Tree pruning | Remove invalidated branches | "3 interviews confirmed the 'feel lost' opportunity — other branches de-prioritized" |

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| Implicit hypotheses | Can't be falsified; post-hoc rationalization is inevitable | Write the hypothesis explicitly before designing the experiment |
| Testing the solution, not the assumption | Most critical assumptions are about the problem, not the feature | Run assumption mapping first; test the riskiest assumption, regardless of what that requires |
| Using surveys to measure behavior | People say one thing and do another | Measure real behavior: clicks, conversions, retention — not survey responses |
| MVE is not minimum | Teams build full features "to get good data" | Define the smallest test that answers the hypothesis question; build no more than that |
| No decision after the loop | Learning is acknowledged but doesn't change direction | Require a documented decision: persevere, pivot, or stop — after every experiment |
| Skipping the tree | Experiments don't connect to outcomes | Build the opportunity tree before running experiments; trace every experiment to an outcome |
| Pivoting too early | One bad data point triggers a direction change | Define the sample size and confidence threshold before running the experiment; don't pivot on noise |

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Is every initiative described as an explicit hypothesis? | Decisions are made by opinion or authority | Write the hypothesis before designing the solution: belief + customer + outcome + metric |
| Have the riskiest assumptions been identified and prioritized? | Teams jump to testing solutions before problems | Run assumption mapping; rank by criticality × evidence; test high-risk first |
| Are experiments designed to be minimum viable? | MVPs are too large and take too long | Ask: "What's the smallest thing that tests this specific assumption?" |
| Are real behavior metrics being measured (not surveys)? | Data is self-reported preference, not actual behavior | Instrument real behavior: click tracking, completion rates, retention, conversion |
| Is there a documented decision after each experiment? | Learning happens but direction doesn't change | Require a written learning record: what we tested, what we found, what we're doing next |
| Does the opportunity tree connect experiments to the desired outcome? | Experiments feel disconnected from business goals | Build or update the opportunity tree before the next experiment cycle |

## Further Reading

- [*"The Lean Startup"*](https://www.amazon.com/Lean-Startup-Entrepreneurs-Continuous-Innovation/dp/0307887898) by Eric Ries — the original Build-Measure-Learn framework
- [*"Continuous Discovery Habits"*](https://www.amazon.com/Continuous-Discovery-Habits-Discover-Products/dp/1736633309) by Teresa Torres — opportunity trees, assumption mapping, and weekly discovery cadence
- [*"Testing Business Ideas"*](https://www.amazon.com/Testing-Business-Ideas-David-Bland/dp/1119551447) by David Bland & Alex Osterwalder — a visual catalog of 44 experiment types
- [*"The Mom Test"*](https://www.amazon.com/Mom-Test-customers-business-everyone/dp/1492180742) by Rob Fitzpatrick — how to ask customer questions that produce real signal, not polite agreement

## About the Framework

Hypothesis-driven development synthesizes two lineages. Eric Ries developed the Build-Measure-Learn loop at IMVU and published *The Lean Startup* in 2011, applying lean manufacturing principles (Toyota Production System) to the startup product process. The core insight — that startups are engaged in a search for a repeatable, scalable business model, not executing a known plan — reframed product development as an experimental discipline. Teresa Torres, a product discovery coach, extended this into continuous practice with her opportunity tree framework, published in *Continuous Discovery Habits* (2021). Torres's contribution is operationalizing weekly discovery as a team ritual rather than a project phase. Together, these frameworks form the dominant approach to product experimentation in modern tech organizations.
