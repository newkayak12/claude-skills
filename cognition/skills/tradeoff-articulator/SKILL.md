---
name: tradeoff-articulator
description: |
  Use when someone is weighing options, comparing approaches, or making any decision where something is being given up. Trigger on "트레이드오프", "tradeoff", "장단점", "pros and cons", "무엇을 포기해야", "이 선택의 비용", "trade-off 분석", "균형점", "득실", "장점이 뭐야", "단점은". Also trigger whenever a user frames a decision as "obviously better" — that framing hides tradeoffs. This skill does NOT pick the best option; it makes explicit what is being traded so the user can decide with full information.
---

# Tradeoff Articulator

Every real choice costs something. The skill's job is not to recommend — it is to make the cost structure of each option visible, because people make bad decisions not from lack of intelligence but from invisible tradeoffs.

The difference from decision-making: decision tools help you choose. This tool helps you understand what you are choosing between.

## Core Principle: Nothing Is Free

When something looks like a free win ("option A is better in every way"), one of three things is true:

1. You have not identified all the axes yet.
2. One option is genuinely dominated — but you should verify this explicitly, not assume it.
3. The hidden cost is being paid by someone else, or by the future.

Always start by searching for the hidden cost before accepting any "free win" framing.

## Step-by-Step Process

### Step 1 — Identify the True Axes of Tradeoff

**MCP instruction:** If `think-tool` is available, use it before accepting the user's framing of the tradeoff axes. Ask: what axes does the user assume? Are there hidden axes they haven't named? Is this actually a free win, and if so, what is the hidden cost? Deliberate axis-searching here prevents the skill from just elaborating on the user's existing (possibly incomplete) framing.

Most people name only the obvious axis (speed vs cost, quality vs time). There are almost always more.

Probe with these questions:
- What do you care about that is NOT currently on the table?
- Who else is affected by this decision?
- What changes 1 year from now if you choose each option?
- What does each option make harder to do later (reversibility)?

Common hidden axes:
- **Reversibility** — can you undo this? What does undoing cost?
- **Optionality** — does this option keep more future paths open?
- **Cognitive load** — which is easier to maintain, explain, or reason about?
- **Risk profile** — variance, not just expected value. A safe 6 vs a 50/50 shot at 10 with a floor of 0.
- **Who pays** — cost shifted to users, teammates, future-you, or downstream systems.

### Step 2 — Build the Tradeoff Matrix

Once axes are identified, map each option against each axis. Do not score yet — describe qualitatively first.

```
Option        | Speed | Cost | Reversibility | Cognitive Load | Risk
Option A      |  +++  |  --  |     high      |      low       | low variance
Option B      |   +   |  +   |     low       |      high      | high upside
Option C      |  ---  |  ++  |     high      |      low       | very low
```

Flag any cell where the tradeoff is hidden or counterintuitive.

### Step 3 — Name the Opportunity Cost

For the leading option, state explicitly: **"Choosing X means giving up Y."**

Opportunity cost thinking forces specificity. "We're giving up some flexibility" is not useful. "We're giving up the ability to switch databases without a full rewrite, which costs an estimated 3–6 weeks if we need to do it in year 2" is useful.

Do this for every option, not just the one the user is leaning toward.

### Step 4 — Surface Multi-Criteria Conflicts

Find pairs of axes that pull in opposite directions. These are the real decisions.

Example: "You want both speed and reversibility. Option A is fast but irreversible. This is not a tradeoff you can optimize away — you have to decide which matters more in this specific context."

Name the conflict. Do not resolve it for the user unless asked.

### Step 5 — Check for Hidden Tradeoffs

Run these checks explicitly:

- **Short-term vs long-term:** Does the cheaper option now create technical debt, relationship debt, or process debt?
- **Local vs systemic:** Does the locally optimal choice create coordination costs elsewhere?
- **Explicit vs implicit cost:** Is any cost being absorbed silently (by a team member, by users with worse UX, by reduced reliability)?
- **Second-order effects:** What does each option make more likely to happen next?

## Worked Example

**Situation:** "Should we use a managed cloud service or self-host our database?"

Surface framing: cost vs control.

**Step 1 — Find hidden axes:**
- Operational expertise required (who on the team can maintain self-hosted Postgres at 2am?)
- Vendor lock-in and data portability
- Scaling ceiling
- Compliance and data residency

**Step 2 — Matrix:**

```
                  | Monthly Cost | Control | Ops Burden | Lock-in | Compliance Flexibility
Managed (RDS)     |    high      |   med   |    low     |   med   |         med
Self-hosted       |    low       |   high  |    high    |   none  |         high
Managed (Neon)    |    low       |   low   |    very low|   high  |         low
```

**Step 3 — Opportunity costs:**
- Managed: You are paying not just money but data portability and some configuration control.
- Self-hosted: You are paying with engineering hours and reliability risk. At current team size (3 engineers), this is ~4 hours/month expected + incident risk.

**Step 4 — Conflict:**
- You want low operational burden AND no vendor lock-in. These pull against each other. You must pick which is more important right now.

**Step 5 — Hidden cost:**
- Self-hosted looks cheap but the cost is latent: it only becomes visible when something breaks at the worst possible time.

## Output Format

Structure output as:

1. **Axes identified** (including any hidden ones you surfaced)
2. **Tradeoff matrix** (qualitative, not false-precision scores)
3. **Opportunity costs** (explicit "choosing X gives up Y" statements)
4. **The real conflict** (the axis pair where tension is unavoidable)
5. **Hidden costs** (what is invisible in the original framing)
6. Optional: "To decide, you need to answer: [the key question]"

Do NOT add a recommendation unless explicitly asked. The goal is informed decision-making, not outsourced decision-making.

## Constraints

**MUST DO**
- Name at least one hidden axis beyond what the user stated
- State opportunity costs in concrete terms, not vague gestures
- Identify where cost is being shifted rather than eliminated
- Distinguish "this option is better for your stated priorities" from "this option is objectively better"

**MUST NOT DO**
- Do not declare a winner
- Do not smooth over genuine tensions by calling one option "balanced"
- Do not use vague tradeoff language ("some pros and cons") — be specific
- Do not accept "free win" framings without interrogating them
