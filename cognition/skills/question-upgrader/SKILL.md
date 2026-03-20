---
name: question-upgrader
description: |
  Use when someone is asking a question that is too narrow, too closed, or based on a hidden assumption that may be wrong. Trigger on "좋은 질문", "질문 개선", "question quality", "더 나은 질문", "메타 질문", "질문 만들기", "어떤 질문을 해야", "문제 설정", "질문 업그레이드", "이 문제를 어떻게 봐야", "뭘 물어봐야 할지 모르겠어", "질문이 맞는지 모르겠어", "어떻게 접근해야". Also trigger when someone asks a yes/no question about a complex topic, or when the framing of the question seems to be the obstacle — not the answer.
---

# Question Upgrader

The quality of your answer is bounded by the quality of your question. Most thinking gets stuck not because the answer is hard to find but because the question being asked is the wrong one — too closed, too assumptive, or aimed at the wrong level.

This skill does two things: upgrade the question you are asking, and question whether it is the right question at all.

## Why Questions Fail

**Type 1 — Too closed:** "Should I do X?" This invites a yes/no and forecloses exploration of why X is being considered, what alternatives exist, and what the real goal is.

**Type 2 — Assumptive:** "How do I get my team to work harder?" Assumes the problem is effort, not direction, motivation, tools, or clarity. Answering the question as asked reinforces the wrong assumption.

**Type 3 — Too broad:** "What is the best strategy?" Cannot be answered without massive context. The question is not useful until scoped.

**Type 4 — Solution-embedded:** "Should I use microservices?" Already names the solution. The underlying question ("how do I make this system more maintainable?") opens far more useful territory.

**Type 5 — Wrong level:** Asking tactical questions when the problem is strategic, or asking strategic questions when what is needed is a tactical decision right now.

---

## Part 1: Question Quality Upgrader

### The Upgrade Moves

**Move 1 — From yes/no to conditional:**
- Weak: "Should I quit my job?"
- Strong: "What would need to be true for leaving this job to be the right decision? What would need to be true for staying to be right?"

This forces enumeration of actual conditions rather than a binary answer.

**Move 2 — From how to why/what:**
- Weak: "How do I improve team morale?"
- Strong: "What is actually causing low morale? How do I know my diagnosis is correct?"

Answering "how" is premature if the "what" is misdiagnosed.

**Move 3 — Remove the embedded solution:**
- Weak: "Should I rewrite this in TypeScript?"
- Strong: "What problems am I trying to solve, and is this the best way to solve them?"

**Move 4 — Add stakes and time horizon:**
- Weak: "What should our pricing strategy be?"
- Strong: "What pricing strategy maximizes retention among our top 20% of users over the next 12 months, given that we cannot reduce features?"

Adding constraints often reveals the answer immediately, or reveals that the constraints need revisiting.

**Move 5 — Inversion:**
Instead of "How do I succeed at X?", ask "What would guarantee I fail at X?" Then avoid those things. Inversion surfaces blockers that forward thinking misses.

### Upgrade Table

| Weak question pattern | Upgrade move | Stronger form |
|---|---|---|
| "Should I do X?" | Conditional | "What would need to be true for X to be right?" |
| "How do I get X?" | Why/What first | "What is preventing X right now?" |
| "Is X good?" | Stakes + context | "Good for whom, by what measure, over what timeframe?" |
| "What is the best Y?" | Scope + constraints | "Best for [specific goal] given [specific constraints]?" |
| "How do I fix Z?" | Diagnosis | "Is Z actually the problem, or a symptom?" |

---

## Part 2: Meta-Question Generator

Meta-questions are questions about the question. Before investing in answering a question, it is worth asking whether the question is worth answering.

### The Core Meta-Questions

**1. Is this the right question?**
"Am I asking about the symptom or the root cause? If I answered this question perfectly, would the underlying problem be solved?"

**2. What assumption is this question making?**
Every question has at least one embedded assumption. Surface it explicitly.
- "Should I hire more engineers?" assumes more engineers is the solution. Is that assumption valid?
- "How do I make this meeting more productive?" assumes the meeting should exist. Should it?

**3. What question would be more useful here?**
Generate 3 alternative questions that address the same underlying concern at a different level or angle. Pick the one with the highest leverage.

**4. Who is best positioned to answer this?**
Sometimes the question is being asked of the wrong person, the wrong data source, or the wrong part of yourself (your analytical mind vs your accumulated experience).

**5. What would change if I had the answer?**
If answering the question would not change any decision or action, the question is academic — useful maybe, but not urgent.

**6. What am I afraid to ask?**
Often the most useful question is the one being avoided. What is the question that, if answered "yes," would be most uncomfortable? That question is usually the real one.

### Meta-Question Application: Worked Example

**Original question:** "어떻게 하면 더 좋은 개발자가 될 수 있을까요?"

Run meta-questions:

1. **Right question?** This is so broad it is hard to answer usefully. "Better" at what? In what timeframe? Compared to what baseline?

2. **Hidden assumption?** That becoming better is primarily about skills/techniques. But career trajectory often depends more on visibility, relationships, and project selection.

3. **Alternative questions that might be more useful:**
   - "What is the specific skill gap that is most limiting my current work?"
   - "What do the developers I most admire do differently from what I do today?"
   - "What feedback have I received most consistently that I have not acted on?"

4. **Best positioned to answer?** For the upgraded question: past performance reviews, a senior mentor, or a structured self-assessment — not a general AI query.

5. **What would change?** Answering the original question gives a generic list. Answering the upgraded questions gives a 90-day action plan.

6. **The avoided question:** "Am I actually investing enough time, or am I looking for a shortcut?"

---

## How to Use Both Parts Together

**MCP instruction:** If `sequential-thinking` is available, use it to enforce this order: (1) apply meta-questions (Part 2) to assess whether this is even the right question → (2) then apply upgrade moves (Part 1) to improve how the question is asked. Skipping meta-question analysis and going straight to surface-form upgrades polishes the wrong question.

1. Receive the question.
2. Run Part 2 first: is this the right question? What is the hidden assumption?
3. If the question is fundamentally misframed, surface the better question before upgrading the surface form.
4. If the question is directionally right but weakly formulated, apply Part 1 upgrade moves.
5. Present the upgraded question(s) to the user: "Here is a stronger version of what you're asking, and here is why it opens more useful territory."
6. Offer to answer the upgraded question, or let the user take it and run.

---

## Output Format

1. **Original question** (restate for reference)
2. **What makes it weak** (one sentence: closed/assumptive/embedded solution/wrong level)
3. **Hidden assumption** (what is being taken for granted)
4. **Upgraded question(s)** (1–3 stronger formulations)
5. **Why this upgrade unlocks better thinking** (one sentence per upgraded question)
6. **The question you might be avoiding** (always include — this is a default output, not optional)

---

## Constraints

**MUST DO**
- Name the specific weakness before upgrading — don't just replace without explaining why
- Surface the hidden assumption explicitly
- Offer at least one inversion or conditional form
- Keep upgraded questions concise — long questions are not better questions

**MUST NOT DO**
- Do not answer the original weak question — upgrade it first
- Do not generate more than 3 upgraded questions — choice overload defeats the purpose
- Do not upgrade a question that is already well-formed — confirm it is good and proceed
- Do not moralize about the original question — the user asked a reasonable question; you are helping them ask a sharper one
