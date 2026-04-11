---
name: negotiation
effort: max
description: >-
  Use when someone needs to negotiate, persuade, or navigate a hard
  conversation. Triggers on: "연봉 협상", "salary negotiation", "계약 협상", "거절당했어",
  "설득해야 해", 협상 준비", "ask for a raise", "contract terms", "클라이언트 설득", "상사한테 어떻게
  말해".
scenarios:
  - "연봉 협상을 해야 하는데 어떻게 접근해야 해?"
  - "클라이언트가 가격을 너무 낮게 제시했어, 어떻게 대응하지?"
  - "I need to convince my manager to approve this project"
  - "계약 조건이 마음에 안 드는데 어떻게 협상해?"
  - "The other side keeps saying no — what do I do?"
  - "입찰에서 자꾸 떨어지는데 뭔가 전략이 필요해"
compatibility:
  recommended:
    - think-tool        # pre-negotiation reasoning about counterpart motivations and black swans
  optional:
    - sequential-thinking  # for multi-stage negotiation planning
  remote_mcp_note: >-
    think-tool이 있으면 협상 전 상대방 입장 분석과 Black Swan 탐색을 체계적으로 수행할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
related:
  - decision-maker
  - devils-advocate
  - first-principles
license: MIT
metadata:
  author: wondelai
  version: "1.1.1"
---
## Standing Mandates

- ALWAYS identify your BATNA before entering any negotiation.
- ALWAYS prepare at least two black swans — unknown drivers that could shift the counterpart's position.
- NEVER anchor on position; anchor on interests and let the counterpart fill in the position.
- NEVER treat the first offer as the floor — the real negotiation space is rarely visible at the start.


# Negotiation

Tactical empathy-based negotiation framework from FBI hostage negotiator Chris Voss. Transform any negotiation by understanding the emotional drivers behind decisions and using proven techniques to build rapport, uncover hidden information, and reach better outcomes.

## Core Principle

**People want to be understood and feel safe.** Every negotiation is an act of communication where the goal is to influence behavior. The most effective path to "yes" runs through empathy, active listening, and emotional intelligence -- not logic, arguments, or compromise.

**The foundation:** Treat every negotiation as a discovery process. Your assumptions are hypotheses to be tested, not truths to be defended. Focus on the other side's needs (respect, security, autonomy) rather than their stated positions. Never split the difference -- no deal is better than a bad deal.

## Scoring

**Goal: 10/10.** When reviewing or preparing negotiations, rate them 0-10 based on adherence to the principles below. A 10/10 means full tactical empathy engagement, calibrated questions prepared, accusation audit delivered, emotions labeled, "That's right" achieved, and Black Swans actively hunted; lower scores indicate missed opportunities for rapport, information gathering, or deal improvement. Always provide the current score and specific improvements needed to reach 10/10.

## Framework

### 1. Tactical Empathy

**Core concept:** Consciously imagine yourself in the counterpart's situation, then vocalize their perspective to create trust and openness.

**Why it works:** When people feel understood, brain chemistry shifts toward trust and cooperation. Empathy short-circuits defensive reactions and opens the door to genuine dialogue. It is not agreement -- you can understand their position while advocating for your own.

**Key insights:**
- Before responding, ask: "What is their world like right now?"
- Articulate their situation, pressures, and fears before stating your position
- Empathy must be genuine, not performed -- people detect fakeness instantly
- Combine with mirroring and labeling for maximum effect
- Unconditional positive regard: respect them as a person regardless of disagreement
- Stay calm and positive -- emotions are contagious; slow pace enables clear thinking


**Ethical boundary:** Use empathy to genuinely understand, not to manipulate emotions. Tactical empathy builds real relationships, not exploitative ones.

See: [references/techniques.md](references/techniques.md)

### 2. Mirroring

**Core concept:** Repeat the last 1-3 critical words your counterpart said, using a curious, upward-inflecting tone, then go silent.

**Why it works:** Mirroring creates familiarity and rapport by signaling deep listening. It prompts elaboration without direct questions, making people feel heard while revealing more information than they intended to share.

**Key insights:**
- Listen for the key phrase or emotion-laden words
- Repeat them back as a gentle question with upward inflection
- Wait silently (4+ seconds) for them to expand
- Works in person, on phone, and in written communication
- Combines powerfully with labeling and tactical silence
- The simplest technique but often the most effective for information gathering


**Ethical boundary:** Mirror to understand, not to manipulate people into revealing information they want to keep private.

See: [references/techniques.md](references/techniques.md)

### 3. Labeling

**Core concept:** Identify and verbalize the counterpart's emotions or perspective using neutral phrases: "It seems like...", "It sounds like...", "It looks like..."

**Why it works:** Naming emotions validates them and diffuses their power. Labeling negative emotions reduces their intensity; labeling positive emotions reinforces them. The tentative phrasing ("It seems like...") gives them room to correct you, which deepens the conversation either way.

**Key insights:**
- Always use third-person phrasing ("It seems like..."), never "I think you..."
- After labeling, be silent -- let them respond
- Labeling negative emotions diffuses them; labeling positive emotions amplifies them
- If your label is wrong, they'll correct you -- which is still valuable information
- Combine labels with tactical silence for maximum effect
- Watch for emotional shifts that signal you've hit the mark


**Ethical boundary:** Label emotions to show understanding, not to weaponize someone's feelings against them.

See: [references/techniques.md](references/techniques.md)

### 4. Calibrated Questions

**Core concept:** Open-ended "How...?" and "What...?" questions that shape the conversation while giving the counterpart the illusion of control.

**Why it works:** Calibrated questions engage the counterpart's problem-solving mind, making them feel in charge while you steer the dialogue. They avoid defensiveness that "Why?" creates (which sounds accusatory) and force the other side to consider your position without you stating it directly.

**Key insights:**
- Start with "How" or "What" -- avoid "Why" (sounds accusatory)
- "How am I supposed to do that?" is the most powerful pushback without saying no
- Questions should be genuinely collaborative, not sarcastic
- Use to uncover hidden constraints, needs, and decision-making processes
- Exception for "Why": use only when you want them to defend something favorable to you ("Why would you ever choose our company?")
- Follow every "yes" with "How...?" to ensure implementation commitment


**Ethical boundary:** Use calibrated questions to create genuine collaboration, not to trap people into commitments they don't want to make.

See: [references/techniques.md](references/techniques.md)

### 5. Accusation Audit

**Core concept:** Before negotiating, list and preemptively verbalize every negative thing the counterpart might think or say about you.

**Why it works:** Naming fears and criticisms before the other side does removes their power. It often triggers reassurance ("Oh, I don't think that...") or at minimum neutralizes objections. By addressing elephants in the room first, you demonstrate self-awareness and build trust.

**Key insights:**
- Brainstorm every negative they might think about you or your position before the meeting
- Deliver the audit early in the conversation, not after they've raised objections
- The list should feel slightly worse than what they actually think -- it overshoots on purpose
- Watch them relax as you address concerns they hadn't even voiced
- Particularly powerful when you're the party with less leverage
- Combine with tactical empathy for maximum disarming effect


**Ethical boundary:** Use accusation audits to build trust through transparency, not to preemptively shut down legitimate concerns.

See: [references/techniques.md](references/techniques.md)

### 6. "That's Right"

**Core concept:** Summarize the counterpart's position -- facts, emotions, and concerns -- so accurately that they respond with "That's right." This is the breakthrough moment in any negotiation.

**Why it works:** "That's right" signals that the person feels completely understood. It creates genuine rapport and shifts their mindset from adversarial to collaborative. It is fundamentally different from "You're right" (which often means they're dismissing you).

**Key insights:**
- "That's right" is the two most powerful words in negotiation
- "You're right" is dangerous -- it usually means "go away, I don't want to talk anymore"
- Listen deeply throughout the conversation before attempting a summary
- Include emotional subtext in your summary, not just facts
- If you get "You're right" instead, keep working -- you haven't truly connected yet
- Use the Rule of Three: confirm agreement 3 times in 3 different ways to ensure commitment
- Apply the "No" technique first -- let them say "No" to feel safe, then work toward "That's right"


**Ethical boundary:** Seek "That's right" through genuine understanding, not through manipulative reframing of their position.

See: [references/techniques.md](references/techniques.md)

### 7. Ackerman Bargaining

**Core concept:** A systematic monetary negotiation method using calculated offers in decreasing increments (65% -> 85% -> 95% -> 100%) with precise non-round numbers and a non-monetary bonus at the end.

**Why it works:** Decreasing increments signal that you're approaching your limit. Precise, non-round numbers ($47,235 vs $47,000) feel calculated and final -- as if you've truly pushed to your absolute maximum. The final non-monetary gift signals generosity at the limit, making it psychologically harder for them to ask for more.

**Key insights:**
- Set your target price first (what you actually want to pay/receive)
- Open at 65% of target to create room for concessions
- Raise in decreasing increments: 85% -> 95% -> 100%
- Use precise, non-round numbers on final offer ($10,230 not $10,000)
- Include a non-monetary bonus with final offer ("...and I'll include X")
- Never make concessions without getting something in return
- If they anchor with an extreme number, don't counter -- use calibrated questions: "How did you arrive at that figure?"


**Ethical boundary:** Use the Ackerman method for fair negotiations, not to lowball or exploit people who lack negotiation skills.

See: [references/techniques.md](references/techniques.md)

### 8. Black Swans

**Core concept:** Hidden, game-changing pieces of information that can transform a negotiation once discovered. Every negotiation has approximately three Black Swans lurking.

**Why it works:** Negotiations stall or fail when critical information remains hidden. Black Swans are the unknown unknowns -- secret constraints, hidden motivations, or unknown context -- that explain seemingly irrational behavior. Discovering even one can turn a stalemate into a breakthrough.

**Key insights:**
- Every negotiation has approximately 3 Black Swans lurking
- Types: secret constraints (boss said no more than X), hidden motivations (need this deal to save their job), unknown context (competitor just made a move)
- Stay curious; ask calibrated questions to surface them
- Watch for anomalies -- odd reactions, hesitations, or inconsistencies signal hidden factors
- Listen in unguarded moments (before/after meetings, casual conversation)
- If they seem irrational, diagnose: are they (1) ill-informed, (2) constrained, or (3) hiding something?
- Use three types of leverage -- positive (what they want), negative (what they fear), and normative (their own stated values) -- to surface hidden information


**Ethical boundary:** Hunt for Black Swans to create better outcomes for both sides, not to exploit private or sensitive information.

See: [references/techniques.md](references/techniques.md)

## Handling Common Situations

**They say "That's not fair":**
- Stop immediately: "I want to be fair. Have I done something unfair? Let's discuss it."

**They anchor with an extreme number:**
- Don't counter immediately; use calibrated questions: "How did you arrive at that figure?"

**They stop responding:**
- Send: "Have you given up on [the project]?" -- triggers "No" response

**They seem irrational:**
- Diagnose: Are they (1) ill-informed, (2) constrained, or (3) hiding something?
- Use calibrated questions to uncover which
