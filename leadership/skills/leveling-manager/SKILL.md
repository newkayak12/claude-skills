---
name: leveling-manager
description: >-
  Use when an engineering manager needs to evaluate an engineer's level fairly,
  build a promotion case with evidence, or align with peers in a calibration
  conversation. Triggers on: "write a promotion case", "calibration prep",
  "level rubric design",
license: MIT
metadata:
  author: wondelai
  version: "1.0.0"
scenarios:
  - "Help me write a promotion case for a Senior to Staff engineer with specific evidence"
  - "I need to prepare for calibration — how do I present my engineer's case against skepticism?"
  - "Design a level rubric for Senior and Staff engineers on my team"
  - "승진 케이스 어떻게 써야 해? 구체적인 증거 기반으로"
  - "캘리브레이션에서 내 엔지니어 승진 제안 어떻게 방어해?"
compatibility:
  recommended:
    - think-tool
  optional: []
  remote_mcp_note: >-
    think-tool이 있으면 승진 케이스 작성 시 증거가 실제 해당 레벨의 기준을 충족하는지,
    아니면 현재 레벨의 강한 성과인지 구분하는 판단 품질이 높아집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Engineering Leveling — Manager Framework

## When to Use / When Not to Use

**Use when:**
- Writing or reviewing a promotion case before a calibration cycle
- Designing or sharing level rubrics with your engineers
- Preparing to advocate for a promotion in a calibration session

**Not for:**
- IC promotion planning (use leveling-ic)
- Coaching 1-on-1 conversations (use 1-on-1-manager)
- Performance improvement plans (different from leveling)

## Process

1. **Define rubric** — ensure rubric exists and is shared with the engineer
2. **Collect evidence continuously** — running doc per engineer; STAR format; tag by rubric dimension
3. **Write the promotion case** — structure: executive summary + evidence by dimension (2-3 examples each) + developmental areas
4. **Apply the skeptic test** — read the case as someone who doesn't know this engineer; find the weak spots
5. **Calibration** — present evidence, not opinions; have additional examples ready; know when to yield vs. push back
6. **Communicate** — promotions: name what demonstrated readiness; not-yet: specific gap + path + timeline

## Output Template

Promotion case structure:
```
## Promotion Case: [Name] — [Current Level] → [Target Level]

### Executive Summary
[1 paragraph: specific claim with named evidence. Not "she's great" — "here are three initiatives that demonstrate Staff-level behavior."]

### Evidence by Dimension

**[Dimension 1 — e.g., System Design]**
- Example 1: [STAR format]
- Example 2: [STAR format]

**[Dimension 2 — e.g., Cross-team Influence]**
- Example 1: [STAR format]
- Example 2: [STAR format]

[Repeat for each rubric dimension]

### Developmental Areas
[Honest gap statement + why it is not a blocker, or what the plan is]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Generates promotion case draft from described evidence | Collects and validates actual evidence with direct observation |
| Writes rubric dimension definitions with observable behaviors | Makes the final call on readiness and timing |
| Prepares calibration arguments and backup examples | Advocates for the engineer in the actual calibration room |
| Drafts "not-yet" communication with specific gap + path | Has the promotion or not-yet conversation with the engineer |
| Scores your current leveling practice (0-10) | Builds the trust that makes these conversations land |

## Related Skills

- `../leveling-ic/SKILL.md` — understand what your ICs are working toward
- `../1-on-1-manager/SKILL.md` — 1-on-1 growth tracking is the source of continuous evidence

## Core Principle

**Leveling is not a judgment about a person — it is an assessment of demonstrated impact at a given scope.** The question is never "is this person good?" It is: "At what scope does this person consistently operate, with what level of autonomy, and what evidence supports this?" Levels describe patterns of behavior over time, not single events or potential.

**The foundation:** Most leveling systems fail because they conflate three things: potential, performance, and level. An engineer can be performing well at their current level without being ready for the next. A high-potential engineer is not automatically at the next level until they've demonstrated it. Calibration conversations fail when managers argue about these distinctions without shared definitions. Good leveling starts with a clear rubric, gathers evidence systematically, and writes the promotion case before advocating for it.

## Scoring

**Goal: 10/10.** When evaluating your leveling practice as a manager, rate 0-10. A 10/10 means you have a documented rubric, gather evidence continuously, write promotion cases grounded in specific examples, and represent your engineers effectively in calibration. Always provide the current score and specific improvements needed.

- **9-10:** Clear rubric shared with engineers, evidence gathered continuously, promotion cases written with specific examples, calibration participation is strong
- **7-8:** Rubric exists but isn't shared proactively; promotion cases are written but rely on recency; calibration is reactive
- **5-6:** Leveling is intuition-based; no rubric; promotion cases are thin; calibration is uncomfortable
- **3-4:** Leveling is opaque to engineers; promotions happen based on tenure or politics; no calibration
- **1-2:** No leveling framework; "good" vs "not good" is the only assessment; engineers don't know what's expected

## The Leveling Manager Framework

### 1. Level Definitions and Rubrics

**Core concept:** Every level in an engineering career ladder is defined by a combination of scope (what size problem?), autonomy (how much direction needed?), impact (what changes in the world?), and craft (how well does the technical work hold up?). A rubric translates these dimensions into specific, observable behaviors for each level.

**Why it works:** Without a rubric, leveling is subjective and inconsistent — different managers apply different standards, and engineers don't know what to work toward. A rubric creates a shared language: "operating at Staff level" means something specific, not "I feel like they're Staff."

**Key insights:**
- Typical engineering levels: Junior (L3/E3) → Mid (L4/E4) → Senior (L5/E5) → Staff (L6/E6) → Principal (L7/E7)
- The key inflection points: Junior→Mid (independence within tasks), Mid→Senior (independence within projects), Senior→Staff (influence across teams/systems)
- Rubric dimensions: Technical Execution, System Design, Project Leadership, Collaboration, Impact
- Each dimension should have 3-4 observable behaviors per level — specific enough to find evidence for
- Share the rubric with engineers: if they don't know what "Senior" looks like, they can't develop toward it
- Rubrics should be calibrated across managers, not defined by one person

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Level definition | Scope + autonomy + impact | Senior: "Independently owns and delivers multi-sprint projects; influences technical direction within the team; work is used as a standard by peers" |
| Rubric creation | Observable behaviors | "Staff — Technical Design: Designs systems that are adopted beyond their immediate team; identifies cross-system risks proactively; written design docs require minimal revision from principal+" |
| Sharing rubrics | Transparency | "Here's our level rubric — I want you to know exactly what we're looking for at each level" |
| Calibration alignment | Shared language | "When I say 'operates at Staff scope,' I mean the engineer regularly solves problems that span 2+ teams without being asked" |
| Level ambiguity | Name the dimension | "The disagreement is about impact, not craft. They're excellent technically — the question is whether their work influences people outside their team yet." |

### 2. Evidence Collection

**Core concept:** Promotion cases are won or lost in calibration based on the quality of evidence. Evidence is specific, behavioral, and tied to impact — not general impressions or tenure. Collecting evidence continuously, throughout the year, is dramatically more effective than scrambling at promotion time.

**Why it works:** Recency bias is the single biggest threat to fair leveling — managers remember the last three months more than the prior nine. Continuous evidence collection counters recency bias, catches growth that happened incrementally, and produces a promotion case that is hard to refute because it is grounded in facts.

**Key insights:**
- Keep a running doc per engineer: weekly or bi-weekly entries of specific examples with context
- After every significant event (incident, design review, launch, conflict), write a note: "What did they do? What was the impact? What does this demonstrate about their level?"
- Use the STAR format: Situation → Task → Action → Result
- Collect both positive evidence (behaviors at the target level) and developmental observations (gaps at the target level)
- Ask other managers, engineers, and stakeholders for input — don't be the only observer
- Quantify impact where possible: "The refactor they led reduced API latency by 40%, enabling the SLA upgrade for three enterprise customers"

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Running evidence doc | Weekly notes per engineer | "2026-03-12: Led the incident response for the DB outage. Coordinated across infra, backend, and SRE. RCA was clear and action items were specific. This is Staff-level cross-functional leadership." |
| STAR format | Structured evidence | "S: Q1 launch at risk due to auth service dependency. T: Block resolved without scope reduction. A: Re-architected auth integration to decouple timeline dependencies. R: Launch shipped on time; auth team adopted the pattern." |
| Soliciting input | 360 evidence | "Before I write the promotion case, I'm going to ask the tech lead of the platform team what their experience working with [name] has been" |
| Quantified impact | Numbers tell the story | "Cache layer they designed reduced infrastructure cost by 30% — $180K/year annualized. This was unsolicited and proactively identified." |
| Developmental observation | Honest gap tracking | "Design doc for the new service had scope that was too narrow — principal engineer had to expand it significantly. Not yet operating at Staff scope on system design." |

### 3. Writing the Promotion Case

**Core concept:** A promotion case is a structured document that argues, with evidence, that an engineer has consistently operated at the next level. It is not a performance review, not a list of projects, and not an expression of the manager's feelings. It is an evidence-based argument, written as if a skeptic will read it.

**Why it works:** Calibration panels are skeptical by design — their job is to maintain level standards across the organization. A promotion case that says "she's great and ready for Senior" will fail. A case that says "here are five specific examples across six months demonstrating Staff-level behavior in three rubric dimensions" will succeed, because it's hard to refute.

**Key insights:**
- Structure: Executive summary (1 paragraph) → Evidence by rubric dimension (3-5 paragraphs) → Summary of level rationale → Developmental areas
- Each rubric dimension needs at least 2-3 specific examples — no dimension should be supported by a single data point
- Write the executive summary last — it should synthesize the evidence, not preview vague impressions
- Address the developmental areas honestly: "Not yet at full scope on [dimension] — here's the plan" is more credible than pretending there are no gaps
- Write it as a document, not a list of bullet points — narrative is more persuasive and easier to follow
- Have another senior manager review it before submission — they'll see the gaps a sponsor can't

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Executive summary | One paragraph, specific claim | "Ji-won has consistently operated at the Staff level since Q3 2025. Across three major initiatives, she has driven cross-team technical decisions, proactively identified system-level risks, and produced design patterns adopted by two other teams. The evidence below supports promotion to L6." |
| Dimension evidence | 2-3 examples per rubric area | "Technical Design (Staff criteria): (1) Auth service decoupling design — adopted by platform team. (2) Cache architecture — saved $180K/yr, identified proactively. (3) Q1 system design doc set the bar for the team." |
| Addressing gaps | Honest and bounded | "System-level influence is strongest within the backend surface; cross-stack influence (mobile, data) is still developing. This is expected at the Staff entry point and is not a blocker for promotion." |
| Skeptic test | Read it as a critic | "If I were on the calibration panel and had never seen this engineer, would this case convince me? What questions would I ask?" |
| Pre-submission review | Peer manager read | "I'm going to send this to the Staff EM on the platform team — she'll tell me if the evidence is strong enough or if I'm missing something" |

### 4. Calibration Conversations

**Core concept:** Calibration is the process by which managers align on level standards across the organization. It is not a negotiation or an advocacy session — it is a conversation about whether a specific body of evidence meets a specific level definition. The manager's job is to represent the engineer fairly, not to win at all costs.

**Why it works:** Without calibration, each manager applies their own standards, and leveling becomes inconsistent. Engineers in some teams get promoted faster with less evidence; others are held to a higher bar. Calibration creates organizational fairness — the same bar applies regardless of team or manager.

**Key insights:**
- Know the level rubric cold before calibration — you need to speak to evidence against specific criteria
- Present evidence, not opinions: "Here are three examples of Staff-level behavior" not "I really believe she's ready"
- Be prepared for skepticism — have additional examples ready for the dimensions that will be questioned
- Know when to yield: if calibration reveals a genuine gap you missed, update your assessment — that's the system working
- Know when to push back: if calibration is applying an inconsistent standard, name it: "What would constitute sufficient evidence? Can we align on the bar?"
- Document calibration outcomes and share with engineers (appropriately) — they should know what was discussed and what would change the outcome

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Evidence presentation | Lead with examples | "I'll share three specific examples that demonstrate Staff-level system design — and then I want to discuss the impact dimension" |
| Handling skepticism | Have backup examples ready | "Fair question — here's a fourth example that specifically addresses the cross-team influence criterion" |
| Yielding gracefully | Model intellectual honesty | "You're right — that example doesn't meet the Staff bar for impact. I think the case is still there, but I'll acknowledge the gap is real." |
| Challenging inconsistency | Name the standard | "We approved [engineer A] at Staff with similar evidence last cycle — I want to make sure we're applying the same bar here" |
| Post-calibration feedback | Close the loop | "Here's what calibration said: [engineer] is performing well at Senior. The specific gap for Staff is [dimension]. Here's how we'll work on that." |

### 5. Communicating Leveling Decisions

**Core concept:** Whether the outcome is promotion, "not yet," or development feedback, the manager must communicate clearly, specifically, and with a path forward. Vague decisions ("you're not quite ready") destroy trust. Specific decisions ("the gap is system-level design, and here's what that looks like") enable growth.

**Why it works:** Engineers whose promotions are declined without clear rationale either leave or lose motivation. Engineers who receive specific, honest feedback about the gap — and a credible path to closing it — often grow faster than those who were promoted on schedule. The communication is as important as the decision.

**Key insights:**
- Promotions: name what demonstrated readiness — "what made this promotion clear was X, Y, Z"
- Not-yet decisions: name the specific gap, not a vague feeling — "the gap is X, which at Staff level looks like Y"
- Provide a timeframe and a plan: "Here's what I want to see in the next two quarters" + specific opportunities
- Don't sugarcoat a gap you privately believe is uncloseable — if the engineer has a genuine ceiling, have that harder conversation
- Separate the decision from the relationship: "I advocated for you; the calibration panel identified a gap that I think is worth discussing"
- Follow up in writing: decisions and plans should be in the shared 1-on-1 doc, not just spoken

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Promotion communication | Name what worked | "Calibration approved the promotion. What made it clear was: your leadership of the auth redesign, the cache architecture you proposed independently, and the pattern adoption across teams." |
| Not-yet communication | Specific gap + path | "Calibration said the evidence for impact at Staff scope wasn't there yet. Specifically: all strong examples are within our team. For Staff, we need to see influence outside our team. Here's how we can create that opportunity in Q2." |
| Gap communication | Concrete and observable | "The gap isn't technical skill — it's the scope of problems you're choosing. Staff engineers identify and propose solutions to problems before anyone asks them to. Let's work on that." |
| Timeline setting | Realistic and committed | "I think you could be ready for the next cycle — that's about 6 months. Here are the three things I want to see between now and then." |
| Written follow-up | Document the conversation | Add to 1-on-1 doc: "Promotion decision (2026-03): Calibration approved. Key evidence: [list]. Growth focus for Staff+: [dimension]." |

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| Promoting on potential, not demonstrated behavior | Sets the engineer up to fail; creates a credibility problem for the manager | Require evidence of consistently operating at the next level, not just glimpses |
| Promotion case built on recency | Last 3 months dominate; 9 months of evidence is lost | Keep running evidence notes year-round; reference them at promotion time |
| Vague promotion cases | Calibration panel can't evaluate; skeptics win | Every dimension requires 2-3 specific examples; no general impressions |
| Advocating without listening in calibration | Misses real gaps; damages credibility with peers | Listen to objections; have additional evidence ready; yield when the gap is real |
| Not sharing rubrics with engineers | Engineers can't develop toward unknown criteria | Share rubrics in 1-on-1s; review them together; let engineers self-assess |
| Sugarcoating a not-yet decision | Engineer doesn't change behavior; repeat cycles of disappointment | Be specific and honest about the gap; provide a concrete path forward |
| Conflating performance and level | High performer at L4 gets L5 promotion before demonstrating L5 scope | Keep performance and leveling discussions separate; both matter, neither substitutes for the other |

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Do you have a documented level rubric for each engineer you manage? | Leveling is intuition-based | Find or create the rubric; share it with engineers in next 1-on-1 |
| Do you keep running evidence notes throughout the year? | Promotion cases rely on recent memory | Start a per-engineer doc today; write the first entry about something that happened this week |
| Do your promotion cases include 2-3 examples per rubric dimension? | Cases are thin and rely on narrative | Audit your last promotion case; count the examples per dimension; strengthen any that have fewer than 2 |
| Do engineers know the specific gap between their current and next level? | Engineers are developing toward an unknown target | Share the rubric; discuss where they are on each dimension; name the gap specifically |
| Are you soliciting input from engineers and managers outside your team? | Evidence is one-dimensional | Ask 2-3 stakeholders for specific examples before writing the promotion case |
| Do you communicate not-yet decisions with a specific gap and path? | Engineers leave or disengage after declined promotions | Define the gap in observable terms; set a timeline; create opportunities to close it |

## Further Reading

- [*"An Elegant Puzzle: Systems of Engineering Management"*](https://www.amazon.com/Elegant-Puzzle-Systems-Engineering-Management/dp/1732265186) by Will Larson — engineering career ladders and calibration systems
- [*"The Manager's Path"*](https://www.amazon.com/Managers-Path-Leaders-Navigating-Growth/dp/1491973897) by Camille Fournier — leveling across the engineering career arc
- [*"High Output Management"*](https://www.amazon.com/High-Output-Management-Andrew-Grove/dp/0679762884) by Andy Grove — performance assessment and output thinking for managers
- [Gergely Orosz's Engineering Career Ladders](https://blog.pragmaticengineer.com/the-software-engineer-career-ladder/) — practical analysis of how real companies structure levels
