---
name: leveling-ic
effort: high
description: >-
  Use when an IC wants to understand their current level, close gaps to the next
  level, and build a promotion-ready evidence portfolio. Triggers on: "what does
  senior mean in practice", "how do I get to staff", "promotion conversation
  with manager",
license: MIT
metadata:
  author: wondelai
  version: "1.0.0"
scenarios:
  - "What does operating at Staff level actually look like — and how far am I from it?"
  - "Help me build an evidence log for my Senior to Staff promotion"
  - "I want to have a promotion conversation with my manager — help me prepare"
  - "시니어 → 스태프 레벨업 어떻게 준비해야 해?"
  - "승진 근거 자료 만드는 법 알려줘"
compatibility:
  recommended:
    - think-tool
  optional: []
  remote_mcp_note: >-
    think-tool이 있으면 경험 사례가 실제로 해당 레벨의 증거인지 아니면 현재 레벨의 우수 성과인지
    구분하는 판단 품질이 높아집니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS map each evidence item to a specific level criterion, not to effort or tenure.
- ALWAYS distinguish 'strong at current level' from 'demonstrating next level behaviors'.
- NEVER conflate impact (outcomes) with output (tickets closed, lines written).
- NEVER build a promotion case that only lists strengths — gaps must be named and addressed.


# Engineering Leveling — IC Framework

## When to Use / When Not to Use

**Use when:**
- Unclear on what the next level (Senior, Staff, Principal) actually requires
- Building a STAR-format evidence log for a promotion cycle
- Preparing an explicit promotion conversation with your manager

**Not for:**
- Managers writing promotion cases (use leveling-manager)
- IC → management track transitions
- Performance improvement (distinct from leveling)

## Process

1. **Establish context** — current level, target level, timeline, rubric availability
2. **Quick diagnostic** — identify which of the 5 phases needs most attention
3. **Understand current level** — are you performing at it or fully operating at it?
4. **Map next-level criteria** — by dimension: Technical Execution, System Design, Project Leadership, Collaboration, Impact
5. **Start evidence log** — STAR format, tagged by rubric dimension; proactive work flagged separately
6. **Close gaps** — volunteer for specific opportunities that address the weakest dimension
7. **Promotion conversation** — open it explicitly; ask whether you're being submitted; get specifics on gaps

## Output Template

Evidence log entry format:
```
Date: [YYYY-MM-DD]
Situation: [context — what was happening, what was the problem?]
Task: [what was your specific responsibility?]
Action: [what did YOU do? — first person, specific decisions]
Result: [measurable outcome — numbers preferred]
Dimension: [Technical Execution / System Design / Project Leadership / Collaboration / Impact]
Proactive: [Yes / No — did someone ask you to do this, or did you identify it yourself?]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Explains what each level looks like in practice per dimension | Has the actual conversations with your manager |
| Writes STAR-format evidence entries from examples you describe | Identifies and pursues opportunities to close gaps |
| Diagnoses which evidence dimension is thinnest | Decides when to push for promotion vs. wait for more evidence |
| Drafts promotion conversation talking points | Builds the relationship that makes advocacy possible |
| Scores your current 5-phase readiness | Makes the final call on timing |

## Related Skills

- `../1-on-1-ic/SKILL.md` — drive career and promotion conversations in your 1-on-1s
- `../leveling-manager/SKILL.md` — understand what your manager is building the case with

## Core Principle

**Promotion is a recognition of work already done at the next level — not a reward for time served or a bet on potential.** The engineer who says "I've been doing great work for two years and deserve a promotion" is making a performance argument. The engineer who says "here are six months of evidence that I'm already operating at the next level" is making a leveling argument. Only the second one works in calibration.

**The foundation:** Most ICs have two blind spots. First: they don't know what the next level actually looks like in practice (rubrics are opaque or theoretical). Second: they assume good performance will be noticed and rewarded automatically. Both assumptions are wrong. You need to understand the criteria, actively work on the gaps, collect evidence as you go, and have an explicit conversation with your manager about timing and readiness.

## Session Intake

Before applying the framework, establish context with three questions:
1. **Current level:** "What's your current level title?" (Junior / Mid / Senior / Staff / Principal)
2. **Target level:** "What level are you working toward, and over what timeline?"
3. **Rubric access:** "Does your company have a published career ladder? If yes, can you share or describe the next-level criteria?"

Then use the Quick Diagnostic (at the bottom of this skill) to identify which of the five phases is most relevant. **Focus the conversation on the highest-leverage phase — don't walk through all five sections unless the IC explicitly wants a full review.**

## The Leveling IC Framework

### 1. Understanding Your Current Level

**Core concept:** Before thinking about the next level, get clear on what your current level actually means and whether you're fully operating at it. Engineers who are "performing" at their level are still developing within it — fluency, speed, and consistent reliability at current-level scope. Most engineers are at different points of development even within a level.

**Why it works:** ICs who jump straight to "how do I get to Senior" without understanding what "Mid" requires often have gaps they're unaware of. Understanding your current level gives you baseline clarity and helps you have a more productive conversation with your manager about where you actually are.

**Key insights:**
- Typical levels: Junior → Mid → Senior → Staff → Principal
- Junior: learns within defined tasks; needs close guidance; growing technical foundations
- Mid: independent within well-scoped tasks; owns stories end-to-end; growing into project independence
- Senior: independently owns multi-sprint projects; influences technical direction within the team; mentors peers; work is used as a reference
- Staff: cross-team influence; solves problems that span multiple teams; shapes technical direction at org level; proactively identifies system-level opportunities
- "Operating at" vs "performing well at": operating means you're consistently demonstrating the scope and autonomy of the level — not just technically competent
- Ask your manager: "On the rubric, which dimension do you think I'm strongest at? Which is least mature?"

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Self-assessment | Rate yourself per rubric dimension | "Technical execution: I'd say I'm solid Senior. System design: I'm still Mid — my designs get significant feedback before they're approved." |
| Manager conversation | Ask for honest assessment | "I'd like your honest read: where on the Senior rubric am I strongest? Where am I still developing?" |
| Rubric access | Get the actual document | "Do we have a published career ladder? I'd like to understand what each level looks like on each dimension." |
| Level fluency check | Are you fully Senior or growing into it? | "I can own a project independently — but I still check in frequently to validate my direction. That's probably 'developing Senior', not 'operating Senior'." |
| Gap within level | Identify before chasing next | "I'm technically strong at Senior level but I haven't mentored anyone consistently. That's a gap within the current level, not just a next-level requirement." |

### 2. Understanding Next-Level Criteria

**Core concept:** Get specific about what the next level requires — by rubric dimension, not as a general feeling. "Senior means more autonomy" is not a criterion. "Senior means independently delivering multi-sprint projects with minimal direction, influencing the team's technical approach, and being the reference point for peers on design decisions" is a criterion.

**Why it works:** Specific criteria let you self-assess against them, identify gaps with precision, and seek out opportunities that close those specific gaps. Vague criteria produce vague development — you work hard but in the wrong directions.

**Key insights:**
- Get the rubric from your manager or HR — if it doesn't exist, ask your manager to describe each dimension for the next level
- Common dimensions: Technical Execution, System Design, Project Leadership, Collaboration/Influence, Impact
- The key leveling shifts to understand:
  - Mid → Senior: individual task ownership → project ownership; peer advice → peer mentorship; team technical influence begins
  - Senior → Staff: team influence → cross-team influence; team-scoped problems → org-scoped problems; reactive problem-solving → proactive opportunity identification
- After understanding criteria, self-assess: "For each dimension, am I not there yet, partially there, or consistently there?"
- Ask your manager which dimension is the biggest gap — this is the highest-leverage question you can ask

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Criteria extraction | Dimension by dimension | "For Staff — System Design, what does 'operating at Staff level' look like? Can you give me an example of someone who does this well?" |
| Self-assessment grid | Rate each dimension | Create a 2x4 grid: dimensions vs. (Current, Next Level Required, My Gap); fill it in honestly |
| Key shift identification | Understand the inflection | "The biggest shift from Senior to Staff seems to be: moving from 'solve the problem I'm given' to 'identify the problems worth solving'" |
| Gap prioritization | Ask manager to rank | "Of all the dimensions, which one do you think is my biggest gap for Staff? I want to focus there." |
| Criteria examples | Ask for concrete instances | "Can you describe a recent situation where someone on the team demonstrated Staff-level impact? I want to understand what it looks like in practice." |

### 3. Evidence Collection

**Core concept:** Keep a running log of evidence — specific examples of work that demonstrates next-level behavior. Write entries throughout the year, not just before promotion conversations. The log serves three purposes: countering recency bias, building the promotion case, and giving you a clear picture of where your evidence is strong and weak.

**Why it works:** When promotion time comes, managers need specific examples to present in calibration. If you don't have them — or your manager doesn't — the promotion case is weak regardless of how good your work was. Engineers who proactively keep evidence logs give their managers the raw material for a compelling case.

**Key insights:**
- Use the STAR format: Situation → Task → Action → Result
- Write entries as close to the event as possible — detail fades quickly
- Tag each entry by rubric dimension: "This is system design evidence" or "This is cross-team influence evidence"
- Quantify results wherever possible: numbers make impact tangible in calibration
- Include "proactive" evidence separately — things you identified and did without being asked are particularly strong
- Share your log with your manager before promotion conversations — they are your advocate and need this material
- Review your log quarterly: which dimensions have strong evidence? Which are thin?

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Entry writing | STAR + dimension tag | "S: Auth service was creating a latency bottleneck for 3 dependent teams. T: No one had assigned this to me. A: Designed and proposed a decoupling approach, got buy-in from all 3 teams, led implementation. R: 40% latency reduction; pattern adopted by the data team. Dimension: Staff/Cross-team influence + System Design." |
| Proactive evidence | Flag unsolicited work | "I wasn't asked to do this — I identified it independently. This is the kind of proactive behavior I understand is characteristic of Staff." |
| Quantified impact | Add numbers | "Not just 'improved performance' — 'reduced P99 latency from 800ms to 120ms, enabling the SLA upgrade that closed the enterprise deal'" |
| Dimension audit | Quarterly review | "I have 5 entries for Technical Execution, 3 for System Design, but only 1 for Cross-team Influence — that's my thinnest dimension for Staff" |
| Manager share | Give them the material | "Here's my evidence log for the last 6 months — I've organized it by rubric dimension. I'd love your feedback on whether the Staff-level evidence is strong enough." |

### 4. Gap Closing

**Core concept:** Once you know your specific gaps, actively seek opportunities to close them. Don't wait for your manager to create these opportunities — propose them. The engineer who says "I want to work on cross-team influence — can I take the lead on the API design that affects the mobile and data teams?" is more promotable than the engineer who waits to be assigned that work.

**Why it works:** Opportunities don't always come to you on the right timeline for your promotion readiness. Creating your own opportunities — by understanding what you need and asking for it — compresses the timeline and demonstrates the proactivity that's characteristic of the next level.

**Key insights:**
- Match the opportunity to the gap: if your gap is system design, don't fill the gap with mentoring — find a design opportunity
- Volunteer explicitly: "I'd like to lead the design review for the new caching layer — I think it's a good opportunity for me to work on the system design gap we discussed"
- Cross-team opportunities for Staff: look for cross-functional projects, technical working groups, API design reviews that affect multiple teams
- Mentoring opportunities for Senior: offer to onboard the next new hire; run a lunch-and-learn on something you know well
- Proactive problem identification: write a short document identifying a system risk or improvement opportunity no one asked you to find — this is the clearest demonstration of next-level thinking
- Track gap-closing progress: every quarter, update your self-assessment and check if the gap is narrowing

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Volunteer for gaps | Propose, don't wait | "I noticed the platform team is designing the new event streaming architecture. I'd like to participate — it would help me work on the cross-team influence dimension we identified." |
| Proactive problem identification | Write the doc | "I wrote a short doc identifying a potential bottleneck in our queue system as we scale to 10M events/day. I want to share it with the team and get feedback on whether it's worth pursuing." |
| Mentoring initiation | Offer before being asked | "I'd like to help onboard the new engineer joining in March — I think it would be good for me and for them." |
| Cross-team contribution | Find the leverage point | "The mobile team's API review is happening Thursday — can I join and contribute the backend perspective? It's the kind of cross-team work I'm trying to demonstrate." |
| Progress check | Quarterly self-review | "Three months ago, cross-team influence was my weakest dimension. Since then: 2 cross-team contributions, 1 design review. Is the gap closing? What does my manager think?" |

### 5. Promotion Conversation

**Core concept:** Don't wait for your manager to raise the promotion topic — bring it yourself. The conversation has two parts: establishing shared understanding of timing and criteria (before you're ready), and presenting your case (when you believe you're ready). Both conversations should be explicit, evidence-based, and documented.

**Why it works:** Managers are managing many engineers across many priorities. Your promotion is your highest priority — it may not be theirs. By driving the conversation explicitly, you ensure the topic doesn't fall off the agenda and you create accountability for the timeline and criteria.

**Key insights:**
- Part 1 (before you're ready): "I want to work toward Staff in the next 12-18 months. Can we align on what I need to demonstrate and when we think the next cycle would be realistic?"
- Part 2 (when you think you're ready): "I've been collecting evidence for the last 6 months. I think I have a strong case — I'd like to walk you through it and get your honest assessment before the promotion cycle."
- Ask explicitly: "Are you planning to submit me for promotion this cycle?" — don't assume
- If the answer is no: "What specific evidence is missing? What would make you confident submitting me next cycle?"
- After calibration: ask your manager what was said and what the specific feedback was — even if the promotion was approved
- If you're consistently told "not yet" without specific gaps: ask for help understanding whether the path is realistic at this company and on this timeline

**Practice applications:**

| Context | Pattern | Example |
|---------|---------|---------|
| Opening the conversation | Explicit and early | "I want to talk about my path to Staff. I'm thinking about an 18-month timeline. Can we align on what I need to demonstrate?" |
| Presenting your case | Evidence-first | "I've organized my last 6 months of work by the Staff rubric dimensions. I'd like to walk you through what I think is the strongest evidence — and hear where you think the gaps are." |
| Getting explicit commitment | Ask directly | "Are you planning to put me in for promotion this cycle? If not, what would change that?" |
| Specific gap ask | After a "not yet" | "I understand — I want to make sure I'm developing in the right direction. What specific evidence would make you confident submitting me next cycle?" |
| Timeline pressure | Name it if needed | "I've been at Senior for 3 years. I want to understand: is there a realistic path to Staff here, or should I be thinking about what Staff looks like elsewhere?" |

## Common Mistakes

| Mistake | Why It Fails | Fix |
|---------|-------------|-----|
| Waiting to be noticed | Managers are busy; good work doesn't automatically produce promotion conversations | Drive the conversation explicitly; share your evidence log; ask for specific feedback |
| Vague growth goals | "I want to grow" doesn't help your manager create opportunities | Write specific gap statements: "My gap for Staff is cross-team influence — I need 3+ examples of driving outcomes across teams" |
| No evidence log | Manager has to reconstruct your case from memory; recency bias dominates | Start a STAR-format evidence log today; write an entry from this week |
| Closing performance gaps instead of leveling gaps | Good Senior performance ≠ evidence of Staff behavior | Understand the difference: more performance at current level vs. different scope and influence |
| Assuming tenure matters | Years of service is not evidence of leveling readiness | Promotion requires evidence of operating at the next level — time served doesn't count |
| Avoiding the direct question | "Am I being submitted?" is awkward but critical | Ask explicitly; vague optimism leads to surprise at promotion decisions |
| Taking a "not yet" without specifics | You can't close a gap you don't know about | Ask: "What specific evidence is missing? What would make you confident?" |

## Quick Diagnostic

| Question | If No | Action |
|----------|-------|--------|
| Do you know your company's level rubric for each dimension? | Criteria are opaque | Ask your manager for the rubric or career ladder; if it doesn't exist, ask them to describe next-level criteria per dimension |
| Have you done a self-assessment by rubric dimension? | Your gap is a feeling, not a diagnosis | Rate yourself 1-3 on each dimension at your target level; find the weakest dimension |
| Do you have a running evidence log? | Your case depends on your manager's memory | Start today: write 3 STAR entries from work you've done in the last 3 months |
| Have you discussed your promotion timeline with your manager explicitly? | Promotion timing is vague and assumed | Ask in next 1-on-1: "I want to work toward [level] — what timeline is realistic, and what do I need to demonstrate?" |
| Are you actively seeking opportunities that close your specific gaps? | You're doing good work, but not the right work for next-level evidence | Identify one opportunity in the next sprint that directly addresses your weakest dimension |
| Do you know whether you're being submitted this promotion cycle? | You're uncertain and hoping | Ask directly: "Are you planning to submit me this cycle? If not, what's the gap?" |
