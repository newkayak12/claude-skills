---
name: event-storming
description: 'Facilitates Event Storming workshops — the structured technique for exploring business domains, discovering bounded contexts, and aligning engineers with domain experts. Use when someone is starting a new product, untangling a legacy system, mapping how a business process actually works, or asking where to begin domain modeling — even if they do not name Event Storming.'
---

# Event Storming Facilitation

Event Storming is a workshop technique invented by Alberto Brandolini for rapidly exploring complex business domains. It produces a shared understanding across developers, domain experts, and stakeholders — in hours rather than weeks of documentation. Apply this skill when starting a new domain model, untangling a legacy system, or aligning a team on how a business process actually works.

## Why Event Storming Works

Traditional requirements documents hide the process inside nouns ("Order", "Invoice"). Event Storming forces the team to think in verbs — things that **happened** — which maps directly to how domains behave. Events are facts; they already occurred and cannot be undone. Building a model from events means building a model from truth.

The physical stickies (or their digital equivalents) create shared cognitive artifacts. When everyone can see and move the same stickies, disagreement surfaces immediately and cheaply — before a line of code is written.

## Sticky Legend

| Color | Type | Naming Convention |
|-------|------|-------------------|
| Orange | Domain Event | Past tense verb phrase: "Order Placed", "Payment Failed" |
| Blue | Command | Imperative: "Place Order", "Cancel Shipment" |
| Yellow | Actor / User | Role or persona: "Customer", "Warehouse Clerk" |
| Lilac / Purple | Policy / Business Rule | "Whenever X, then Y": "When payment confirmed, reserve stock" |
| Pink | Read Model / View | What the actor needs to see to decide: "Order Summary Page" |
| White | External System | Third-party system name: "Stripe", "FedEx API" |
| White (wide) | Aggregate | Noun that owns state and enforces invariants: "Order", "Account" |
| Red | Hotspot | Question or conflict needing resolution — mark and move on |

## Three Levels of Event Storming

### Level 1: Big Picture (2–4 hours)

**Goal:** Explore the entire business domain; discover bounded contexts and pain points.

**When to use:** Kicking off a new product, auditing an existing system, onboarding a new team.

**Steps:**
1. Invite 6–10 people: at least two domain experts and two developers. More experts than engineers is healthy.
2. Give everyone orange stickies. Ask: "What happens in this business?" Storm freely — put every event on the wall in roughly chronological order. No filtering.
3. Enforce past tense. "Order is placed" becomes "Order Placed". Wrong tense signals unclear thinking.
4. Cluster the timeline. Related events group naturally — these clusters hint at bounded contexts.
5. Mark red hotspots where experts disagree, where language shifts, or where nobody knows the answer.
6. Name the clusters. These are candidate bounded contexts. Boundaries belong where language changes or ownership is unclear.

**Output:** A roughly ordered timeline of domain events, candidate bounded contexts as swim lanes or regions, and a backlog of hotspots to resolve.

### Level 2: Process Level (2–3 hours)

**Goal:** Add commands, actors, and policies to understand who triggers what and why.

**When to use:** After Big Picture, before designing code structure.

**Steps:**
1. For each orange event, ask: "What caused this to happen?" Place a blue command to the left of the event.
2. Ask: "Who issued this command?" Place a yellow actor above the command.
3. Ask: "Is this command triggered by a rule rather than a person?" Place a lilac policy between the previous event and the command.
4. Ask: "What does the actor need to see before issuing this command?" Place a pink read model to the left of the actor.
5. Where commands cross system boundaries, place a white external system card.

**Reading the flow (left to right):**
```
[Read Model] → [Actor] → [Command] → [Policy] → [Domain Event]
```

**Hotspot rule:** When you reach a sticky that nobody can explain confidently, add a red hotspot. Do not spend more than 5 minutes resolving any single hotspot during the session — capture it and move on.

### Level 3: Design Level (2–4 hours, per bounded context)

**Goal:** Identify aggregates, define APIs between contexts, prepare for implementation.

**When to use:** Before writing code for a specific bounded context.

**Steps:**
1. Take the event/command pairs from Process Level and group them by aggregate. Which commands target the same state machine? That is your aggregate.
2. Name each aggregate (wide white card) using the ubiquitous language of that bounded context.
3. Define context boundaries: which events cross from one context into another? These become integration events (typically async/published).
4. For each aggregate, list: its invariants ("Order total cannot exceed credit limit"), its state transitions, and the commands it handles.
5. Identify which aggregates are eventually consistent with each other. These are candidates for the Saga or Outbox pattern.

**Output per bounded context:**
- Named aggregates with commands they handle
- Domain events they emit
- Published integration events crossing context boundaries
- Invariants and state machine

## Facilitation Tips

**Keep the timeline moving.** Silence means stickies, not discussion. Force stickies first, debate after.

**Enforce the language.** If two experts use different words for the same thing, that is not a synonym — it is a potential bounded context boundary. Write both words on a red hotspot.

**Do not design solutions.** Big Picture and Process Level are for discovery. Stop anyone who jumps to database schemas or REST endpoints.

**Re-order freely.** The timeline is not sacred. Move stickies when you discover events happened in a different order.

**Timebox.** Set a timer per phase. Running over budget means you found something important — schedule a follow-up, do not push through exhaustion.

## Common Mistakes

| Mistake | Why It Matters | Fix |
|---------|---------------|-----|
| Events named as nouns ("Order") | Nouns hide causality | Enforce past-tense verbs: "Order Placed" |
| Only developers in the room | Domain knowledge stays implicit | Require domain experts; they are the primary source |
| Skipping hotspots | Hidden disagreement poisons the model | Mark every disagreement; resolve after the session |
| Jumping to aggregates before events | Aggregates emerge from events, not the reverse | Complete Level 1 and 2 before Level 3 |
| One person controlling the wall | Social hierarchy silences dissent | Physically distribute stickies; anyone can place any sticky |
| Too large a bounded context | Monolith re-emerges in disguise | Split where language changes or team ownership changes |

## Bounded Context Output Template

After the workshop, document each bounded context:

```
Bounded Context: [Name]
Ubiquitous Language: [key terms and their definitions]
Commands: [list of commands handled]
Domain Events: [list of events emitted]
Integration Events (published): [events other contexts listen to]
Aggregates: [name, invariants, state transitions]
External Dependencies: [other contexts or systems consumed]
Hotspots Remaining: [open questions]
```

## Quick Facilitation Checklist

- [ ] Diverse participants: domain experts outnumber or equal developers
- [ ] Enough stickies and wall space (or digital board with swim lanes)
- [ ] Timer set per phase
- [ ] Red hotspot stickies available to everyone
- [ ] No laptops open during storming phases
- [ ] Photography or export taken at end of each phase
- [ ] Follow-up scheduled for hotspot resolution
