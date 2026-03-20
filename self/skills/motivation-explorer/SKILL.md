---
name: motivation-explorer
description: |
  Use when the user doesn't understand why they're doing something, has lost motivation, is burning out, or suspects their surface reason for pursuing a goal isn't the real reason. Triggers on "동기", "motivation", "왜 이걸 하는지 모르겠어", "진짜 이유", "내재적 동기", "무엇이 나를 움직이나", "번아웃 이유", "목표 의욕이 없어", "왜 열심히 하는지 모르겠어", "진짜 원하는 게 뭔지", "의욕이 사라졌어", "억지로 하는 것 같아", "남들 때문에 하는 것 같아". Also triggers when users express confusion about why they started something, why they're staying in something despite not wanting to, or why they can't seem to start something they "should" want. This skill does two things: separates intrinsic from extrinsic motivations, and peels back motivation layers to find the root drivers.
---

# Motivation Explorer

Why do you do what you do? The surface answer is rarely the real one. People pursue goals for layered, often contradictory reasons — and when the layers are unexamined, those goals feel either hollow (even when achieved) or mysteriously blocked (even when genuinely wanted). This skill is motivation archaeology: digging down to the real bedrock.

Two theoretical pillars work in combination here:

**Self-Determination Theory (SDT)** by Deci and Ryan: human motivation exists on a spectrum from external (doing it for reward or to avoid punishment) to internal (doing it because it is intrinsically meaningful). The degree of internalization determines the sustainability and quality of motivation. SDT also identifies three core psychological needs whose fulfillment predicts wellbeing: autonomy (I chose this), competence (I'm growing at this), and relatedness (this connects me to others).

**Motivational Interviewing (MI)** by Miller and Rollnick: ambivalence about change is normal and contains information. Exploring "change talk" vs "sustain talk" — the reasons to change vs reasons to stay — reveals what's really holding behavior in place.

## Part 1 — Intrinsic/Extrinsic Separation

### The Spectrum

External regulation → Introjected regulation → Identified regulation → Integrated regulation → Intrinsic motivation

Not all external motivation is bad, and not all motivation needs to be intrinsic. The question is: where on this spectrum does the user's current motivation sit, and is that enough to sustain what they're trying to do?

**External regulation:** "I do this for the money / because I'm afraid of what happens if I don't / because others expect it." Depletes over time. Produces compliance without engagement.

**Introjected regulation:** "I do this because I'll feel guilty or ashamed if I don't / to protect my self-esteem." Internal, but contingent — driven by avoiding a bad feeling rather than moving toward something meaningful. Produces effort but often chronic anxiety and resentment.

**Identified regulation:** "I do this because I agree it's important, even if it's not always pleasant." More stable. The person has genuinely accepted the goal's value.

**Integrated regulation:** "This is part of who I am." Most stable and energizing of the external-origin types.

**Intrinsic motivation:** "I do this because the activity itself is rewarding — for curiosity, joy, flow, expression." Self-sustaining. Produces the deepest engagement.

### Diagnostic Questions

Ask the user to apply these questions to the specific goal or activity in question:

1. *If there were no external reward (money, status, approval) and no external consequence for stopping — would you still do this? Why?*

2. *When you imagine achieving this goal, what is the primary feeling you expect? Relief? Pride? Joy? Validation from others? Safety?*
   - Relief/Safety → likely introjected or external
   - Pride → could be identified or introjected (pride for self vs pride for others' eyes)
   - Joy in the process → likely intrinsic
   - Validation → likely external

3. *Do you feel more energized or more depleted by working on this, on a day when no one is watching and there's no immediate deadline?*

4. *Which of these three feels most violated when you think about this goal?*
   - Autonomy: "I don't feel like I actually chose this"
   - Competence: "I don't believe I can actually do this"
   - Relatedness: "This doesn't connect me to anyone or anything I care about"

### SDT Needs Assessment

For each need, assess: nourished or starved by this goal/path?

| Need | Nourishing signals | Starving signals |
|------|--------------------|-----------------|
| Autonomy | "I chose this" / feels like expression | "I have to" / feels like obligation |
| Competence | Growth, challenge, mastery | Chronic overwhelm or boredom |
| Relatedness | Connects to people/purpose | Isolated, meaningless, disconnected |

A goal that starves all three psychological needs will not be sustained regardless of willpower.

## Part 2 — Motivation Layer Peeling

Surface motivations are often proxies for deeper ones. The deeper you go, the more useful (and sometimes more surprising) the motivations become.

### The Peeling Protocol

Take the stated motivation and ask "why does that matter to me?" or "what would that give me?" repeatedly, going deeper each time. Usually 3-5 layers reveal the root.

**Example:**
- Layer 1: "I want to be successful"
- Layer 2: "Because success means financial security"
- Layer 3: "Because financial insecurity is terrifying to me"
- Layer 4: "Because as a kid, money stress meant the adults were unavailable and angry"
- Root: "I want to feel safe and not be a burden"

The root motivation changes everything about how to approach the goal and what would actually satisfy it.

### Common Root Motivations

For the root motivation taxonomy, read `../references/root-motivations-and-fears.md`

Beneath most complex motivations, a small set of roots tend to appear:

**Worthiness:** "I want to prove I'm enough / smart enough / good enough."
Often drives high achievement, perfectionism, overwork. The problem: external achievement doesn't resolve the underlying belief. A worthiness root never gets satisfied by more results.

**Belonging:** "I want to be accepted, included, loved — not rejected."
Drives people-pleasing, conformity, suppression of authentic preferences. The goal is never fully satisfied because belonging that's conditional on performance feels precarious.

**Safety:** "I want to be protected from loss, instability, or uncertainty."
Drives risk-aversion, control behaviors, accumulation of resources or credentials beyond what's needed.

**Autonomy:** "I want to be free — to not be controlled, constrained, or obligated."
Drives resistance to commitment, difficulty with authority, high creative productivity when free.

**Meaning/Purpose:** "I want my existence to matter — to contribute to something larger than myself."
When this is the actual root, work feels alive even when hard; when it's not present, even prestigious work feels empty.

**Recognition:** "I want to be seen, acknowledged, admired."
Not inherently problematic — but when unexamined, drives choices that optimize for visibility over substance.

### Ambivalence Mapping (MI-derived)

When someone is stuck — both wanting something and not pursuing it — there is ambivalence. Map it explicitly:

**Change talk** (reasons to pursue this):
- What would be good about doing this?
- What would you gain?
- What is it costing you not to?

**Sustain talk** (reasons to stay put):
- What's working about the current situation?
- What would you lose if you changed?
- What's risky or scary about this?

Both are real. Both deserve respect. The goal is not to eliminate sustain talk but to understand its source — and to see whether the cost of staying exceeds the cost of changing.

## Output Format

```
Motivation Analysis
-------------------
Stated motivation: [what they say they want / why they say they're doing it]
Intrinsic/extrinsic read: [where on the spectrum, with reasoning]
SDT needs assessment:
  Autonomy: [nourished / starved — specific evidence]
  Competence: [nourished / starved]
  Relatedness: [nourished / starved]

Motivation layers:
  Layer 1 (surface): [stated reason]
  Layer 2: [what that gives]
  Layer 3: [what that protects or provides]
  Root: [the underlying driver — name it plainly]

Ambivalence map (if relevant):
  Change talk: [reasons to pursue]
  Sustain talk: [reasons to stay]
  The real blocker: [what the sustain talk is actually protecting]

Insight: [the single most important thing this analysis reveals]
Practical implication: [what this means for how to approach this goal or decision]
```

## The Key Insight to Deliver

Motivation problems are rarely about laziness or lack of discipline. They are usually about misalignment: between the goal and the real root driver, between the path and the psychological needs, or between what the person says they want and what they have actually chosen.

Name the misalignment plainly. That clarity is the most useful thing this skill can provide.
