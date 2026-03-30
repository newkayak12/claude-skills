---
name: event-storming
description: >-
  Use when someone is starting a new product, untangling a legacy system, mapping how
  a business process actually works, or asking where to begin domain modeling — even
  if they do not name Event Storming explicitly.
  Triggers on: "domain modeling", "bounded context discovery", "how does this business
  process work", "event storming", "map our domain", "legacy system audit",
  "도메인 모델링", "이벤트 스토밍", "바운디드 컨텍스트 찾기", "비즈니스 프로세스 정리".
  Best for: Big Picture exploration, Process Level modeling, Design Level aggregate discovery.
  Not for: generating implementation code — use microservices-architect or spring-boot-engineer after the workshop.
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional: []
  remote_mcp_note: >-
    think-tool이 있으면 바운디드 컨텍스트 경계 분석을 더 깊이 수행합니다.
    sequential-thinking은 Big Picture → Process Level → Design Level 순서를 강제합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Event Storming Facilitation

## When to Use / When Not to Use

**Use when:**
- Starting a new product and need to discover bounded contexts
- Auditing or untangling a legacy system
- Aligning engineers with domain experts before writing code
- Asking "where should our service boundaries be?"

**Do not use when:**
- You need implementation code — run Event Storming first, then use `microservices-architect` or `spring-boot-engineer`
- The domain is already well-modeled and stable

## Process

### Level 1: Big Picture (2–4 hours)
Goal: Explore the entire business domain; discover bounded contexts and pain points.

1. Invite 6–10 people: at least two domain experts and two developers
2. Storm domain events freely (orange stickies, past tense): "What happens in this business?"
3. Enforce past tense: "Order Placed", not "Order is placed"
4. Cluster the timeline — related events hint at bounded contexts
5. Mark red hotspots where experts disagree or language shifts
6. Name the clusters — these are candidate bounded contexts

### Level 2: Process Level (2–3 hours)
Goal: Add commands, actors, and policies to understand who triggers what and why.

For each orange event:
1. Ask "What caused this?" → blue Command to the left
2. Ask "Who issued this command?" → yellow Actor above
3. Ask "Is this triggered by a rule?" → lilac Policy between event and command
4. Ask "What does the actor need to see?" → pink Read Model to the left
5. Where commands cross system boundaries → white External System

Reading flow (left to right):
```
[Read Model] → [Actor] → [Command] → [Policy] → [Domain Event]
```

### Level 3: Design Level (2–4 hours, per bounded context)
Goal: Identify aggregates, define APIs, prepare for implementation.

1. Group event/command pairs by aggregate (which commands target the same state machine?)
2. Name each aggregate using the bounded context's ubiquitous language
3. Define context boundaries: which events cross from one context to another? (integration events)
4. For each aggregate: list invariants, state transitions, and commands handled
5. Identify eventually-consistent aggregates → candidates for Saga or Outbox pattern

## Output Template

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

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Facilitates question sequences for each sticky type | Gather domain experts and developers |
| Identifies bounded context candidate names | Confirm with domain experts using real business language |
| Spots red flag patterns (noun events, missing actors) | Resolve hotspots with the actual stakeholders |
| Drafts the Bounded Context Output Template | Fill in from the actual workshop results |
| Recommends Design Level aggregate names | Validate invariants against real business rules |

## Sticky Legend

| Color | Type | Naming Convention |
|-------|------|-------------------|
| Orange | Domain Event | Past tense: "Order Placed", "Payment Failed" |
| Blue | Command | Imperative: "Place Order", "Cancel Shipment" |
| Yellow | Actor / User | Role: "Customer", "Warehouse Clerk" |
| Lilac | Policy / Business Rule | "Whenever X, then Y" |
| Pink | Read Model / View | What the actor sees to decide |
| White | External System | Third-party name: "Stripe", "FedEx API" |
| White (wide) | Aggregate | Noun owning state and enforcing invariants |
| Red | Hotspot | Question or conflict — mark and move on |

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Events named as nouns ("Order") | Enforce past-tense verbs: "Order Placed" |
| Only developers in the room | Require domain experts — they are the primary source |
| Skipping hotspots | Mark every disagreement; resolve after the session |
| Jumping to aggregates before events | Complete Level 1 and 2 before Level 3 |
| One person controlling the wall | Distribute stickies physically; anyone can place any sticky |

## Facilitation Checklist

- [ ] Diverse participants: domain experts equal or outnumber developers
- [ ] Timer set per phase
- [ ] Red hotspot stickies available to everyone
- [ ] Photography or digital export taken at end of each phase
- [ ] Follow-up scheduled for hotspot resolution

## Related Skills

- `microservices-architect` — design service boundaries after bounded contexts are discovered
- `service-boundary-validator` — validate the boundaries against DDD and team topology principles
- `adr-writer` — document key decisions that emerge from the workshop
- `domain-driven-design` — deeper DDD concepts for aggregates and context mapping
