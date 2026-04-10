---
name: roadmap-communication
description: >-
  Focuses on ARTIFACTS and MESSAGES: turning a prioritized plan into clear,
  audience-specific communication that lands with engineering, executives,
  customers, or sales. Use when the challenge is WHAT TO SAY — how to explain
  ordering decisions,...
license: MIT
scenarios:
  - "I need to communicate our product roadmap to stakeholders without committing to dates"
  - "Help me create a roadmap presentation that balances transparency with flexibility"
  - "Write a roadmap update email explaining why priorities shifted"
  - "이해관계자에게 로드맵을 공유해야 하는데 일정 약속 없이 전달하고 싶어"
  - "우선순위가 바뀐 이유를 로드맵 업데이트로 설명해줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool은 청중별 메시지 프레이밍과 민감한 우선순위 설명 방식을 고민할 때 유용합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
metadata:
  author: wondelai
  version: "1.0.0"
---

# Roadmap Communication Framework

A structured approach to translating roadmap decisions into audience-appropriate narratives — without overpromising, creating conflict, or losing credibility when plans change.

## Core Principle

**The roadmap is not the communication. The why behind the roadmap is.** Stakeholders don't resist roadmaps because they disagree with the features — they resist because they don't understand the logic. If you lead with dates and features, you invite negotiation on dates and features. If you lead with the problem you're solving and the evidence behind your choices, you invite alignment on outcomes.

**The communication challenge:** Different audiences need the same roadmap translated differently. Engineering needs uncertainty acknowledged. Executives need business impact up front. Customers need confidence in direction, not dates. Sales needs enough specificity to manage deals. One roadmap document cannot serve all four.

## Agent Output

When a user needs to communicate a roadmap, produce:
1. **Audience identification** — who is this for and what do they need from this conversation?
2. **Appropriate format** — the right artifact for that audience (see formats below)
3. **Prioritization narrative** — the "why this order" explanation specific to that audience
4. **Handling the hard questions** — pre-written answers to predictable pushback
5. **Pivot/delay script** if the user is communicating a change

## Audience-Specific Formats

### Engineering Teams

**What they need:** Enough context to make good technical decisions. Not surprised by pivots. Confidence that the PM has thought through dependencies.

**Format: Narrative + Dependencies**
```
Goal this quarter: [outcome in metric terms, not feature terms]
What we're building: [feature name]
Why this, why now: [connection to user evidence + business priority]
Constraints we know about: [tech debt, third-party limitations, timeline drivers]
What we're NOT building yet: [and why — this prevents scope creep]
Open questions for the team: [unresolved decisions that need engineering input]
```

**Key principle:** Acknowledge uncertainty explicitly. "We're targeting Q3 but the external API dependency is a risk" builds more trust than a confident date that slips.

### Executives / Leadership

**What they need:** Business impact, resource justification, strategic fit. Fast. No feature-level detail.

**Format: OKR-Linked Summary**
```
Strategic objective: [link to OKR from ../okr-planning/SKILL.md]
Roadmap bet: [1-2 sentence description of what we're doing]
Expected business impact: [metric + magnitude + timeframe]
Why this over alternatives: [the top 2 things we considered and deprioritized, with one-line rationale]
Resource requirement: [team, timeline, any cross-functional dependencies]
Confidence level: [High / Medium / Low with one-line reason]
Decision needed: [if you need exec input or sign-off]
```

**Key principle:** Executives who see the rejected alternatives trust the decision more than executives who only see the chosen path. Show your work, briefly.

### Customers / External Stakeholders

**What they need:** Confidence that their pain is understood and being addressed. Direction, not dates.

**Format: Now / Next / Later**
```
NOW (in progress or shipping this period):
- [Feature]: Addressing [specific user pain in customer language]

NEXT (validated, planned for next period):
- [Feature]: Will help you [job-to-be-done outcome]

LATER (on our radar, timing unconfirmed):
- [Theme, not specific feature]: We're exploring ways to [outcome]
  [Note: "Later" is intentionally vague — never date-commit here]

Not on the roadmap: [If a frequently-requested feature is explicitly excluded,
say so honestly — silence creates false hope]
```

**Key principle:** Never put dates in a customer-facing roadmap. "This quarter" is already too specific if you can't commit. Use "Now / Next / Later" — it signals direction without creating date commitments.

### Sales Teams

**What they need:** Enough specificity to manage customer expectations and close deals. Not so much detail they overpromise.

**Format: Sales Enablement Card**
```
Feature: [name]
Expected availability: [vague but honest — "H2 this year" or "on the roadmap for next half"]
What it solves for customers: [one-sentence customer problem statement]
Deals it unblocks: [if known — tie to specific requests or objections]
What to say: "[exact language sales can use without overpromitting]"
What NOT to say: "[common overpromise to avoid]"
Status: Committed / Likely / Exploring (never share "Committed" unless engineering has signed off)
```

**Key principle:** Give sales a script, not just a slide. "What to say" and "what not to say" prevents the overpromise-and-miss cycle that destroys customer trust.

## Now / Next / Later Framework

This is the most broadly applicable roadmap communication format. It works for all audiences except engineering (which needs more precision).

**Why it works:**
- "Now" creates confidence: something is actively happening
- "Next" signals priority without a date commitment
- "Later" absorbs requests without promising delivery
- The absence of dates removes the negotiating surface — stakeholders debate dates when they're present

**How to populate it:**
- Now = what has shipped this period + what is in active development
- Next = what has been shaped, resourced, and committed to — but not started
- Later = validated opportunities with no committed timeline
- Not on the roadmap = explicitly named requests that are consciously deprioritized (say this out loud)

**The "Later" trap:** Later becomes a commitment if you never move things out. Run a quarterly audit: items that have been in "Later" for 2+ cycles without moving should be explicitly removed or re-committed.

## Explaining "Why Not This?"

The most common roadmap conflict is a stakeholder whose request didn't make the list. These conversations fail when PMs get defensive or vague. Win them by being specific and evidence-driven.

**The four honest answers:**

1. **Evidence gap:** "We don't yet have enough customer signal to prioritize this confidently. Here's what we'd need to see to move it up: [specific evidence threshold]."

2. **Impact vs. effort tradeoff:** "We evaluated this against [competing item]. The expected impact is [X] vs. [Y], and the effort is [A] vs. [B]. Given our current capacity and goals, [competing item] wins this cycle — but here's when we'd revisit [their request]: [condition or date]."

3. **Strategic misalignment:** "This doesn't connect to our current objective of [OKR]. It might be the right thing to build, but not in this planning period. Here's when we'll revisit strategy: [next planning cycle]."

4. **Explicit deprioritization:** "We considered this and made a deliberate choice not to build it because [reason]. This isn't a 'later' — it's a conscious decision. If that assumption changes, we'll revisit."

**What never to say:**
- "It's on the backlog" (means nothing)
- "We'll get to it" (false hope)
- "That's a great idea" (then change nothing — erodes trust)

## Managing Roadmap Surprises

### Communicating a Pivot

A pivot means the original hypothesis was wrong. Communicate it as learning, not failure.

**Script structure:**
```
1. What we originally planned and why [the bet]
2. What we learned [the evidence that changed the direction]
3. What we're doing instead and why [the new bet]
4. What this means for [the stakeholder's specific concern]
5. What stays the same [anchoring on continuity reduces anxiety]
```

**Example:**
"We planned to build [Feature X] this quarter because we believed it would improve activation. After [experiment/data], we learned [what actually drives activation]. So we're shifting to [Feature Y] because it addresses the real driver. The timeline for your [related ask] is unchanged — this pivot doesn't affect that track."

### Communicating a Delay

Never announce a delay without a new plan.

**Script structure:**
```
1. What's delayed and by how long [specific, honest]
2. Why [one honest reason — not a list of excuses]
3. What you're doing to mitigate [shows ownership]
4. New expected date or "we'll update you by [date]" [never leave it open-ended]
5. What the impact is on [their specific concern] [answer this before they ask]
```

**What not to do:** Send a Slack message that says "X is delayed." That forces the recipient to ask follow-up questions. Send the full script — it respects their time.

### Communicating Scope Changes

When a feature ships smaller than originally described:

"We're shipping [Feature X] with [scope A and B] in [timeframe]. We've decided to defer [scope C] because [reason — quality, timeline, evidence we don't need it yet]. We'll evaluate [scope C] based on usage data from the initial release. Here's how to set expectations with [customers/sales]: [specific language]."

## Linking Roadmap to OKR Narrative

Every roadmap item should connect to a current OKR (see `../okr-planning/SKILL.md`). When stakeholders understand how a feature moves the key result, prioritization arguments become easier.

**Framing:**
"We're working on [feature] because it directly addresses [Key Result]. Our hypothesis is that it will move [metric] by [amount], which contributes [X%] toward [Key Result] target."

Items that don't connect to a current OKR are strong candidates for deprioritization. If you can't articulate the OKR connection, that's a signal to pause.

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| One roadmap for all audiences | Engineers get confused by business framing; execs don't care about technical detail | Create audience-specific versions from the same source document |
| Date commitments in customer-facing roadmaps | Dates slip; every slip is a trust erosion event | Use Now / Next / Later; no dates externally unless you can commit with high confidence |
| Silence on deprioritized requests | Stakeholders assume it's coming; hope builds then crashes | Explicitly name what's NOT on the roadmap and why |
| Announcing a delay without a new plan | Forces the receiver to do the anxiety work of imagining worst case | Always pair a delay with a new plan or a "we'll update you by [date]" commitment |
| Explaining prioritization with abstract frameworks | "We used RICE" doesn't build trust | Lead with evidence: "7 of our top 10 customers mentioned this in Q3 research" |

## Cross-Skill Connections

- **Input from:** `../feature-prioritization/SKILL.md` — the prioritized order with supporting evidence
- **Input from:** `planning:roadmap-planning` skill — the plan itself (timeline, sequencing, capacity)
- **Works alongside:** `../stakeholder-management/SKILL.md` — for managing specific relationship dynamics
- **References:** `../okr-planning/SKILL.md` — linking each roadmap item to an OKR narrative
