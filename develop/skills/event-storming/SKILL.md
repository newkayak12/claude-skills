---
name: event-storming
description: >-
  Use when starting a product, untangling legacy, or mapping a business process before code. Triggers on: "이벤트 스토밍",
  "도메인 이벤트 뽑아보자", "도메인 모델링 워크숍", "workshop with domain experts", "map our business flow".
scenarios:
  - "We're starting a new product and need to model the domain before writing code"
  - "Help me run an event storming workshop to discover bounded contexts"
  - "We need to understand our business domain events before designing the system"
  - "새 프로덕트 개발 전에 도메인 모델링을 해야 해"
  - "이벤트 스토밍 워크샵을 진행해줘"
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

## Standing Mandates

- NEVER supply the domain's events, rules, or terms yourself. Claude drafts candidates only from what the user or the
  code gave; anything else is `[확인 필요: ○○]` for the domain experts. (Scar: invented events read as domain
  knowledge, and the bounded contexts built on them came out as the model's guess about the business.)
- NEVER name an event as a noun or in present tense ("Order", "Order is placed"); past tense only (present-tense or noun stickies turn into entities, and the timeline disappears). Never jump to
  aggregates before events and commands are on the wall.
- Do NOT resolve a hotspot by picking a side. Mark it red, quote both meanings, and leave it for the people who disagree. (A hotspot Claude resolves hides the disagreement the workshop exists to surface.)
- Goal: each bounded context is documented in the template with its hotspots listed, and the closing tally recounts to
  the contexts; the run stops at the levels the user asked for.

# Event Storming Facilitation

Discovers bounded contexts by asking domain events, commands, and aggregates in order, with experts and developers.

**Not for** implementation code, or a domain that is already modelled and stable (`develop:domain-driven-design`);
checking whether service cuts hold (`develop:service-boundary-validator`); topology (`develop:architecture-designer`).

## Process

### Level 1: Big Picture (2–4 hours)
Outcome: the whole business domain, candidate bounded contexts, pain points.

1. Invite 6–10 people: at least two domain experts and two developers
2. Storm domain events (orange, past tense): "What happens in this business?"
3. Cluster the timeline; related events hint at bounded contexts
4. Mark red hotspots where experts disagree or language shifts
5. Name the clusters: candidate bounded contexts

**Glossary check (rules in `domain-driven-design/references/ubiquitous-language.md`; conflicting terms signal a context boundary):**
- A term that conflicts with the glossary gets both meanings quoted ("Glossary: 'Order' = confirmed purchase. Just now: 'Order' = cart.") and a red hotspot.
- When code exists, cross-check workshop terms against class and method names; name each mismatch (`cancel()` in code vs "void" in the room).
- Keep implementation detail (tables, endpoints) out of the glossary.

### Level 2: Process Level (2–3 hours)
Outcome: who triggers what and why. For each orange event:
1. "What caused this?" → blue Command to the left
2. "Who issued it?" → yellow Actor above
3. "Is it triggered by a rule?" → lilac Policy between event and command
4. "What does the actor need to see?" → pink Read Model to the left
5. Commands crossing system boundaries → white External System

Flow: `[Read Model] → [Actor] → [Command] → [Policy] → [Domain Event]`

### Level 3: Design Level (2–4 hours, per bounded context)
Outcome: aggregates, APIs, ready for implementation.
1. Group event/command pairs by aggregate (commands that target the same state machine)
2. Name each aggregate in the context's ubiquitous language
3. Define boundaries: which events cross contexts (integration events)
4. Per aggregate: invariants, state transitions, commands handled
5. Eventually-consistent aggregates → candidates for Saga or Outbox

## Sticky Legend

| Color | Type | Naming |
|-------|------|--------|
| Orange | Domain Event | Past tense: "Order Placed" |
| Blue | Command | Imperative: "Place Order" |
| Yellow | Actor | Role: "Warehouse Clerk" |
| Lilac | Policy | "Whenever X, then Y" |
| Pink | Read Model | What the actor sees to decide |
| White | External System | "Stripe", "FedEx API" |
| White (wide) | Aggregate | Noun owning state and invariants |
| Red | Hotspot | Question or conflict: mark and move on |

## Output Template

```
## Event storming — <domain>, levels <1–3 run>

Bounded Context: <name>
Ubiquitous Language: <term — definition>
Commands: <list> · Domain Events: <list>
Integration Events (published): <events other contexts listen to>
Aggregates: <name, invariants, state transitions>
External Dependencies: <contexts or systems consumed>
Hotspots Remaining: <question, both meanings quoted>

<n> contexts · <e> events · <h> hotspots open · <u> items [확인 필요]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Facilitates the question sequence per sticky type, drafts the template | Gather domain experts and developers; supply the events |
| Proposes context names, spots noun events and missing actors | Confirm names in real business language; resolve hotspots with stakeholders |
| Suggests aggregate names | Validate invariants against real business rules |

## Related Skills

- `develop:domain-driven-design` — deeper DDD for aggregates and context mapping
- `develop:service-boundary-validator` — validate service boundaries once contexts are found
- `write:plans` (ADR format) — record decisions that emerge from the workshop
